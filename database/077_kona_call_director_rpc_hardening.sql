-- Migration 077 — KONA Call Director: hardening delle RPC (audit, secondo giro).
--
-- Oggetto: SOLO funzioni `kona_cd_*` del progetto di test KONA. Nessuna tabella
-- condivisa col Call Center, nessun DROP/RENAME, nessuna modifica a RLS.
-- Le tre funzioni vengono ricreate con `CREATE OR REPLACE` MANTENENDO la stessa
-- firma: il codice attuale continua a funzionare senza modifiche e, finche' la
-- migration non e' applicata, resta in vigore il comportamento precedente.
--
-- CONTENUTO
--   1. kona_cd_prenota_slot_v1 ....... lock e conflitti GLOBALI (finding C2)
--   2. kona_cd_reserve_budget_v1 ..... idempotenza corretta + tetto orario
--                                      atomico (finding D8 e B11)
--   3. kona_cd_correggi_esito_v1 ..... ruolo admin letto dal DB, non dal
--                                      chiamante (finding D14)
--
-- NON applicata ad alcun database da questa sessione.

BEGIN;

-- =============================================================================
-- 1. Prenotazione slot Business: serializzazione GLOBALE
-- =============================================================================
-- Problema: la chiave del lock e il controllo conflitti erano PER OPERATORE,
-- ma il token Google e il calendario sono unici (kona_call_director_google_token
-- id=1). Due operatrici che prenotavano lo stesso istante non si serializzavano:
-- entrambe passavano il controllo e creavano due eventi sovrapposti.
-- Fix: chiave di lock senza operatore e controllo conflitti su tutti gli
-- appuntamenti Business e su tutti gli appuntamenti del negozio.

CREATE OR REPLACE FUNCTION public.kona_cd_prenota_slot_v1(
  p_lead_id uuid,
  p_operatore_id uuid,
  p_data_ora timestamptz,
  p_durata_minuti integer DEFAULT 45,
  p_zona text DEFAULT NULL,
  p_buffer_minuti integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_chiave text;
  v_bs timestamptz;
  v_be timestamptz;
  v_conflitto boolean;
  v_id uuid;
BEGIN
  -- Chiave GLOBALE per giornata: il calendario e' unico, non per operatore.
  v_chiave := 'kona_cd_slot_' || to_char(p_data_ora AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD');
  IF NOT pg_try_advisory_xact_lock(hashtextextended(v_chiave, 0)) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'lock');
  END IF;

  v_bs := p_data_ora - make_interval(mins => COALESCE(p_buffer_minuti, 15));
  v_be := p_data_ora + make_interval(mins => COALESCE(p_durata_minuti, 45) + COALESCE(p_buffer_minuti, 15));

  SELECT EXISTS (
    SELECT 1 FROM kona_call_director_appuntamenti_business b
    WHERE b.stato IN ('proposto','confermato','da_riprogrammare')
      AND b.data_ora < v_be
      AND b.data_ora + make_interval(mins => COALESCE(b.durata_minuti, 45)) > v_bs
  ) OR EXISTS (
    SELECT 1 FROM appuntamenti a
    WHERE a.stato IN ('confermato','rischedulato')
      AND a.data_ora < v_be
      AND a.data_ora + make_interval(mins => COALESCE(a.durata_minuti, 30)) > v_bs
  ) INTO v_conflitto;

  IF v_conflitto THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'conflitto');
  END IF;

  INSERT INTO kona_call_director_appuntamenti_business
    (lead_id, operatore_id, data_ora, durata_minuti, zona, stato, sync_stato, creato_at)
  VALUES
    (p_lead_id, p_operatore_id, p_data_ora, COALESCE(p_durata_minuti, 45), p_zona, 'proposto', 'non_sincronizzato', now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_prenota_slot_v1(uuid, uuid, timestamptz, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_prenota_slot_v1(uuid, uuid, timestamptz, integer, text, integer) TO service_role;

-- =============================================================================
-- 2. Prenotazione budget: idempotenza corretta + tetto orario ATOMICO
-- =============================================================================
-- Problema D8: l'idempotenza scattava su QUALSIASI riga con la stessa chiave,
-- anche `liberato`/`consumato`: il chiamante credeva di avere budget prenotato
-- mentre la chiamata partiva senza copertura. Inoltre il confronto usava la
-- chiave intera mentre l'INSERT salvava `left(...,120)`.
-- Problema B11: il tetto orario era verificato in JS con un COUNT separato
-- dall'INSERT, quindi aggirabile con richieste concorrenti.
-- Fix: idempotenza solo su prenotazioni ATTIVE e chiave troncata in modo
-- coerente; conteggio delle prenotazioni dell'ultima ora nella STESSA
-- transazione, sotto lo stesso advisory lock del budget.

CREATE OR REPLACE FUNCTION public.kona_cd_reserve_budget_v1(
  p_chiave text,
  p_mese text,
  p_attivita text,
  p_importo_eur numeric,
  p_budget_totale_eur numeric,
  p_riserva_arricchimento_eur numeric,
  p_riserva_dialogo_eur numeric
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_chiave text;
  v_speso numeric := 0;
  v_riservato numeric := 0;
  v_speso_gruppo numeric := 0;
  v_riservato_gruppo numeric := 0;
  v_limite_gruppo numeric := 0;
  v_gruppo text;
  v_max_ora integer := 120;
  v_riserve_ora integer := 0;
BEGIN
  IF COALESCE(p_importo_eur, 0) <= 0 OR COALESCE(p_chiave, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'parametri_non_validi');
  END IF;
  -- Stessa normalizzazione usata nell'INSERT: senza questa, chiavi piu' lunghe
  -- di 120 caratteri non attivavano mai l'idempotenza.
  v_chiave := left(p_chiave, 120);

  PERFORM pg_advisory_xact_lock(hashtextextended('kona_cd_budget_' || p_mese, 0));

  -- Idempotenza SOLO su una prenotazione ancora attiva.
  IF EXISTS (
    SELECT 1 FROM public.kona_call_director_budget_riserve
    WHERE chiave = v_chiave AND stato = 'riservato' AND scadenza > now()
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotente', true);
  END IF;

  -- Tetto orario atomico (config `max_chiamate_openai_ora`; 0 = congelato).
  SELECT COALESCE(max_chiamate_openai_ora, 120) INTO v_max_ora
  FROM public.kona_call_director_config WHERE id = 1;
  v_max_ora := COALESCE(v_max_ora, 120);
  IF v_max_ora <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'rate_limited', 'max_ora', 0);
  END IF;
  SELECT count(*) INTO v_riserve_ora
  FROM public.kona_call_director_budget_riserve
  WHERE creato_at > now() - interval '1 hour';
  IF v_riserve_ora >= v_max_ora THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'rate_limited', 'max_ora', v_max_ora, 'usate', v_riserve_ora);
  END IF;

  SELECT COALESCE(sum(costo_stimato_eur), 0) INTO v_speso
  FROM public.kona_call_director_budget_log WHERE mese = p_mese;
  SELECT COALESCE(sum(importo_eur), 0) INTO v_riservato
  FROM public.kona_call_director_budget_riserve
  WHERE mese = p_mese AND stato = 'riservato' AND scadenza > now();

  IF v_speso + v_riservato + p_importo_eur > COALESCE(p_budget_totale_eur, 0) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'hard_stop',
      'disponibile', GREATEST(0, p_budget_totale_eur - v_speso - v_riservato));
  END IF;

  v_gruppo := CASE WHEN p_attivita = 'arricchimento' THEN 'arricchimento' ELSE 'dialogo' END;
  v_limite_gruppo := CASE WHEN v_gruppo = 'arricchimento'
    THEN COALESCE(p_riserva_arricchimento_eur, 0) ELSE COALESCE(p_riserva_dialogo_eur, 0) END;
  SELECT COALESCE(sum(costo_stimato_eur), 0) INTO v_speso_gruppo
  FROM public.kona_call_director_budget_log
  WHERE mese = p_mese
    AND (CASE WHEN v_gruppo = 'arricchimento' THEN attivita = 'arricchimento' ELSE attivita <> 'arricchimento' END);
  SELECT COALESCE(sum(importo_eur), 0) INTO v_riservato_gruppo
  FROM public.kona_call_director_budget_riserve
  WHERE mese = p_mese AND stato = 'riservato' AND scadenza > now()
    AND (CASE WHEN v_gruppo = 'arricchimento' THEN attivita = 'arricchimento' ELSE attivita <> 'arricchimento' END);

  IF v_speso_gruppo + v_riservato_gruppo + p_importo_eur > v_limite_gruppo THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'riserva_esaurita', 'riserva', v_gruppo);
  END IF;

  INSERT INTO public.kona_call_director_budget_riserve
    (chiave, mese, attivita, importo_eur, stato, scadenza)
  VALUES
    (v_chiave, p_mese, COALESCE(p_attivita, 'altro'), p_importo_eur,
     'riservato', now() + interval '10 minutes');

  RETURN jsonb_build_object('ok', true,
    'disponibile', GREATEST(0, p_budget_totale_eur - v_speso - v_riservato - p_importo_eur));
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_reserve_budget_v1(text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_reserve_budget_v1(text, text, text, numeric, numeric, numeric, numeric) TO service_role;

-- =============================================================================
-- 3. Correzione esito: ruolo admin letto dal DATABASE
-- =============================================================================
-- Problema D14: il bypass del controllo di proprieta' dipendeva da
-- `p_attore_admin`, un booleano fornito dal chiamante. Oggi `operator.js` lo
-- deriva correttamente dal JWT e l'EXECUTE e' riservato al service role, ma il
-- contratto e' fragile: un futuro chiamante che passasse `true` aprirebbe la
-- correzione delle chiamate altrui. Il parametro resta in firma per
-- compatibilita' ma viene IGNORATO: il ruolo si legge da `profili`.
-- Viene inoltre applicato il limite massimo di 500 caratteri alla motivazione
-- (prima solo il minimo, con errore DB invece di un 400 pulito).

CREATE OR REPLACE FUNCTION public.kona_cd_correggi_esito_v1(
  p_chiamata_id uuid,
  p_attore_id uuid,
  p_attore_admin boolean,
  p_esito_nuovo text,
  p_motivo text,
  p_data_ricontatto date DEFAULT NULL,
  p_fascia_ricontatto text DEFAULT NULL,
  p_canale text DEFAULT 'kona_inbound'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_chiamata public.chiamate%ROWTYPE;
  v_attore_admin boolean := false;
  v_esiti constant text[] := ARRAY[
    'non_risposto','non_interessato','passa_in_negozio',
    'ricontattare','appuntamento','passa_a_cerea'
  ];
BEGIN
  IF p_attore_id IS NULL OR p_chiamata_id IS NULL THEN
    RAISE EXCEPTION 'Identificativi mancanti';
  END IF;
  IF NOT (p_esito_nuovo = ANY(v_esiti)) THEN
    RAISE EXCEPTION 'Esito non valido';
  END IF;
  IF char_length(btrim(coalesce(p_motivo, ''))) < 3 THEN
    RAISE EXCEPTION 'Motivazione obbligatoria';
  END IF;
  IF char_length(btrim(coalesce(p_motivo, ''))) > 500 THEN
    RAISE EXCEPTION 'Motivazione troppo lunga (massimo 500 caratteri)';
  END IF;
  IF p_canale NOT IN ('kona_inbound','kona_storico','admin') THEN
    RAISE EXCEPTION 'Canale non valido';
  END IF;
  IF p_esito_nuovo = 'ricontattare'
     AND (p_data_ricontatto IS NULL OR p_fascia_ricontatto NOT IN ('Mattina','Pomeriggio')) THEN
    RAISE EXCEPTION 'Data e fascia ricontatto obbligatorie';
  END IF;

  -- Il ruolo NON arriva dal chiamante: si legge dal profilo.
  SELECT (ruolo = 'admin') INTO v_attore_admin
  FROM public.profili WHERE id = p_attore_id;
  v_attore_admin := COALESCE(v_attore_admin, false);

  SELECT * INTO v_chiamata
  FROM public.chiamate
  WHERE id = p_chiamata_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Chiamata non trovata'; END IF;
  IF NOT v_attore_admin AND v_chiamata.operatore_id <> p_attore_id THEN
    RAISE EXCEPTION 'Chiamata di altro operatore';
  END IF;
  IF (v_chiamata.data_ora AT TIME ZONE 'Europe/Rome')::date
     <> (now() AT TIME ZONE 'Europe/Rome')::date THEN
    RAISE EXCEPTION 'La chiamata non e modificabile oltre la giornata corrente';
  END IF;
  IF v_chiamata.esito = p_esito_nuovo THEN
    RAISE EXCEPTION 'Il nuovo esito coincide con quello corrente';
  END IF;

  INSERT INTO public.kona_call_director_correzioni_esito
    (chiamata_id, operatore_id, esito_precedente, esito_nuovo, motivo, canale)
  VALUES
    (v_chiamata.id, p_attore_id, v_chiamata.esito, p_esito_nuovo, btrim(p_motivo), p_canale);

  UPDATE public.chiamate
  SET esito = p_esito_nuovo,
      data_ricontatto = CASE WHEN p_esito_nuovo = 'ricontattare' THEN p_data_ricontatto ELSE NULL END,
      fascia_ricontatto = CASE WHEN p_esito_nuovo = 'ricontattare' THEN p_fascia_ricontatto ELSE NULL END,
      passaggio_stato = CASE
        WHEN p_esito_nuovo IN ('passa_in_negozio','passa_a_cerea') THEN 'in_attesa'
        ELSE NULL
      END,
      rilavorazione_stato = CASE
        WHEN p_esito_nuovo IN ('non_risposto','ricontattare','passa_in_negozio','passa_a_cerea') THEN 'da_lavorare'
        ELSE 'non_applicabile'
      END,
      updated_at = now()
  WHERE id = v_chiamata.id;

  RETURN jsonb_build_object(
    'ok', true,
    'chiamata_id', v_chiamata.id,
    'esito_precedente', v_chiamata.esito,
    'esito_nuovo', p_esito_nuovo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_correggi_esito_v1(uuid, uuid, boolean, text, text, date, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_correggi_esito_v1(uuid, uuid, boolean, text, text, date, text, text)
  TO service_role;

-- =============================================================================
-- 4. Acquisizione job: il recupero del lease incrementa i tentativi
-- =============================================================================
-- Problema B5: la RPC riacquisiva un job `in_corso` con lease scaduto SENZA
-- toccare `tentativi`. Il limite di 4 tentativi vive solo in `failJob` (JS),
-- quindi un job che faceva scadere il lease (crash dell'istanza, timeout) non
-- raggiungeva mai la soglia e ripeteva le chiamate OpenAI pagate senza fine.
-- Fix: al recupero di un lease scaduto `tentativi` viene incrementato; oltre la
-- soglia il job diventa `annullato` (dead-letter) e non viene piu' ripescato.
-- La soglia 4 e' allineata a MAX_TENTATIVI di `kona-cd-arricchimento.js`.

CREATE OR REPLACE FUNCTION public.kona_cd_acquire_job_v1(
  p_tipo text,
  p_lease_owner text,
  p_lease_minuti integer DEFAULT 10
) RETURNS SETOF public.kona_call_director_jobs
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidato AS (
    SELECT j.id, (j.stato = 'in_corso') AS recupero
    FROM public.kona_call_director_jobs j
    WHERE j.tipo = p_tipo
      AND j.prossimo_tentativo_at <= now()
      AND (
        j.stato IN ('in_coda','fallito')
        OR (j.stato = 'in_corso' AND j.lease_until < now())
      )
    ORDER BY j.prossimo_tentativo_at, j.creato_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  UPDATE public.kona_call_director_jobs j
  SET stato = CASE
        WHEN c.recupero AND j.tentativi + 1 >= 4 THEN 'annullato'
        ELSE 'in_corso'
      END,
      tentativi = CASE WHEN c.recupero THEN j.tentativi + 1 ELSE j.tentativi END,
      lease_owner = left(COALESCE(p_lease_owner, 'dispatcher'), 120),
      lease_until = now() + make_interval(mins => GREATEST(1, COALESCE(p_lease_minuti, 10))),
      risultato = CASE
        WHEN c.recupero AND j.tentativi + 1 >= 4
          THEN COALESCE(j.risultato, '{}'::jsonb) || jsonb_build_object('dead_letter', 'lease_scaduto_ripetuto')
        ELSE j.risultato
      END
  FROM candidato c
  WHERE j.id = c.id
  RETURNING j.*;
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_acquire_job_v1(text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_acquire_job_v1(text, text, integer) TO service_role;

COMMIT;
