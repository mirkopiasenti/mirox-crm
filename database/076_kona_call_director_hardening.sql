-- Migration 076 — KONA Call Director: hardening emerso dall'audit.
--
-- CONTESTO
--   Correzioni lato database per i difetti trovati nell'audit del progetto in
--   test KONA Call Director. Il codice corrispondente e' gia' aggiornato nello
--   stesso commit; questa migration rende effettive le parti che richiedono
--   uno schema diverso.
--
-- ATTENZIONE — ORDINE DI APPLICAZIONE
--   * La sezione 1 modifica una VISTA CONDIVISA col Call Center in produzione
--     (`vw_rilavorazione_ricontatti_unificata`). La modifica e' ADDITIVA
--     (aggiunge una colonna in coda, nessun DROP, nessuna semantica cambiata)
--     ma va applicata SOLO dopo conferma esplicita dell'utente.
--   * Le sezioni 2-4 riguardano solo oggetti `kona_call_director_*` /
--     `kona_cd_*` del progetto di test e non toccano nulla del Call Center.
--   * NON e' stata applicata a nessun database remoto da questo intervento.
--
-- NON eseguire su production senza aver prima applicato 073 e 075: il codice
-- usa `non_presentato` (075) e l'esito sessione `appuntamento` (073).

BEGIN;

-- =============================================================================
-- 1. Vista ricontatti: esporre `anagrafica_id` (colonna in coda)
-- =============================================================================
-- Perche': `kona-cd-engine.js` legge `row.anagrafica_id` per collegare
-- blacklist ed esclusioni al CLIENTE (non alla singola chiamata) sui ricontatti
-- standard. La vista non la esponeva, quindi il valore era sempre undefined e
-- un cliente escluso poteva rientrare con una nuova riga in `chiamate`.
-- Nota: il codice legge gia' `row.telefono`; la vista non viene rinominata.

CREATE OR REPLACE VIEW public.vw_rilavorazione_ricontatti_unificata AS
 SELECT 'standard'::text AS origine_tipo,
    c.id AS origine_id,
    NULL::uuid AS lead_id,
    c.id AS chiamata_origine_id,
    c.nome_cliente,
    COALESCE(a.ragione_sociale, c.nome_cliente) AS ragione_sociale_view,
    c.cf_piva,
    c.cellulare AS telefono,
    c.operatore_id,
    c.operatore_nome,
    c.esito,
    c.note,
    c.copertura,
    c.motivo_chiamata,
    c.data_ora,
    c.data_ricontatto,
    c.fascia_ricontatto,
    c.rilavorazione_stato,
    c.anagrafica_id
   FROM (public.chiamate c
     LEFT JOIN public.anagrafica a ON ((a.id = c.anagrafica_id)))
  WHERE ((c.esito = ANY (ARRAY['non_risposto'::text, 'ricontattare'::text])) AND (c.rilavorazione_stato = 'da_lavorare'::text))
UNION ALL
 SELECT 'outbound_business'::text AS origine_tipo,
    o.id AS origine_id,
    o.lead_id,
    o.id AS chiamata_origine_id,
    COALESCE(l.ragione_sociale, o.ragione_sociale_snapshot) AS nome_cliente,
    COALESCE(l.ragione_sociale, o.ragione_sociale_snapshot) AS ragione_sociale_view,
    COALESCE(NULLIF(l.partita_iva, ''::text), NULLIF(l.codice_fiscale, ''::text)) AS cf_piva,
    COALESCE(NULLIF(l.telefono_raw, ''::text), o.telefono_snapshot) AS telefono,
    o.operatore_id,
    o.operatore_nome,
    o.esito,
    o.note,
    NULL::text AS copertura,
    'Outbound business'::text AS motivo_chiamata,
    o.data_ora,
    COALESCE(o.data_ricontatto, ((o.data_ora AT TIME ZONE 'Europe/Rome'::text))::date) AS data_ricontatto,
    o.fascia_ricontatto,
    o.rilavorazione_stato,
    o.anagrafica_id
   FROM (public.call_center_lead_outbound_chiamate o
     LEFT JOIN public.call_center_lead_outbound l ON ((l.id = o.lead_id)))
  WHERE ((o.esito = ANY (ARRAY['non_risposto'::text, 'ricontattare'::text])) AND (o.rilavorazione_stato = 'da_lavorare'::text));

-- =============================================================================
-- 2. Audit append-only
-- =============================================================================
-- Perche': `kona_call_director_audit` e `kona_call_director_task_eventi`
-- registrano decisioni (toggle globale, abilitazioni, failover, esiti) ma non
-- avevano alcuna protezione: qualunque scrittura con service role poteva
-- modificare o cancellare le righe. La 074 aveva gia' introdotto lo standard
-- opposto per `correzioni_esito`.

CREATE OR REPLACE FUNCTION public.kona_cd_registri_immutabili()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% e'' append-only: UPDATE e DELETE non sono consentiti', TG_TABLE_NAME;
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_registri_immutabili() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_registri_immutabili() TO service_role;

DROP TRIGGER IF EXISTS trg_kona_cd_audit_no_update ON public.kona_call_director_audit;
DROP TRIGGER IF EXISTS trg_kona_cd_audit_no_delete ON public.kona_call_director_audit;
CREATE TRIGGER trg_kona_cd_audit_no_update BEFORE UPDATE ON public.kona_call_director_audit
  FOR EACH ROW EXECUTE FUNCTION public.kona_cd_registri_immutabili();
CREATE TRIGGER trg_kona_cd_audit_no_delete BEFORE DELETE ON public.kona_call_director_audit
  FOR EACH ROW EXECUTE FUNCTION public.kona_cd_registri_immutabili();

DROP TRIGGER IF EXISTS trg_kona_cd_task_eventi_no_update ON public.kona_call_director_task_eventi;
DROP TRIGGER IF EXISTS trg_kona_cd_task_eventi_no_delete ON public.kona_call_director_task_eventi;
CREATE TRIGGER trg_kona_cd_task_eventi_no_update BEFORE UPDATE ON public.kona_call_director_task_eventi
  FOR EACH ROW EXECUTE FUNCTION public.kona_cd_registri_immutabili();
CREATE TRIGGER trg_kona_cd_task_eventi_no_delete BEFORE DELETE ON public.kona_call_director_task_eventi
  FOR EACH ROW EXECUTE FUNCTION public.kona_cd_registri_immutabili();

-- =============================================================================
-- 3. Indici allineati agli stati realmente scritti dal codice
-- =============================================================================
-- Perche': il codice non scrive MAI `in_coda` sui task (materializza
-- direttamente 'attivo'), mentre gli indici parziali includevano quello stato
-- e non coprivano le query reali (task completati per operatore, coda job).

CREATE INDEX IF NOT EXISTS idx_kona_cd_task_operatore_stato
  ON public.kona_call_director_task(operatore_id, stato, data);

CREATE INDEX IF NOT EXISTS idx_kona_cd_jobs_tipo_stato_pr
  ON public.kona_call_director_jobs(tipo, stato, prossimo_tentativo_at);

CREATE INDEX IF NOT EXISTS idx_kona_cd_notifiche_stato_pr
  ON public.kona_call_director_notifiche(stato, prossimo_tentativo_at);

-- =============================================================================
-- 4. Prenotazione negozio ATOMICA per KONA
-- =============================================================================
-- Perche': `prenota_negozio` (task) e `negozio_prenota` (dialog) facevano
-- check-then-insert su `appuntamenti`: fra il controllo dello slot e l'INSERT
-- non c'era alcun lock, quindi due richieste concorrenti (KONA + form pubblico,
-- o due click ravvicinati) potevano occupare lo stesso slot. Il flusso pubblico
-- usa gia' una RPC con advisory lock; questa e' l'equivalente per il negozio.
--
-- Nota: il controllo conflitti e' GLOBALE (tutti gli operatori), perche' il
-- calendario del negozio e' unico e condiviso.

CREATE OR REPLACE FUNCTION public.kona_cd_prenota_negozio_v1(
  p_nome text,
  p_codice_fiscale text,
  p_telefono text,
  p_motivo text,
  p_note text,
  p_anagrafica_id uuid,
  p_operatore_id uuid,
  p_operatore_nome text,
  p_data_ora timestamptz,
  p_durata_minuti integer DEFAULT 30,
  p_lead_outbound_id uuid DEFAULT NULL,
  p_originato_da_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_chiave text;
  v_durata integer;
  v_conflitto boolean;
  v_id uuid;
BEGIN
  IF p_data_ora IS NULL OR p_operatore_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'parametri_non_validi');
  END IF;
  v_durata := GREATEST(5, COALESCE(p_durata_minuti, 30));

  -- Lock per giornata (Europe/Rome): serializza le prenotazioni dello stesso
  -- giorno senza bloccare giorni diversi.
  v_chiave := 'kona_cd_negozio_' || to_char(p_data_ora AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD');
  IF NOT pg_try_advisory_xact_lock(hashtextextended(v_chiave, 0)) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'lock');
  END IF;

  -- Ricontrollo conflitti NELLA STESSA TRANSAZIONE dell'INSERT.
  SELECT EXISTS (
    SELECT 1 FROM public.appuntamenti a
    WHERE a.stato IN ('confermato', 'rischedulato')
      AND a.data_ora < p_data_ora + make_interval(mins => v_durata)
      AND a.data_ora + make_interval(mins => COALESCE(a.durata_minuti, 30)) > p_data_ora
  ) INTO v_conflitto;

  IF v_conflitto THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'conflitto');
  END IF;

  INSERT INTO public.appuntamenti (
    nome, codice_fiscale, telefono, motivo, note, anagrafica_id,
    fissato_da_operatore_id, fissato_da_nome, data_ora, durata_minuti,
    fonte, stato, lead_outbound_id, originato_da_id
  ) VALUES (
    left(COALESCE(p_nome, 'Cliente'), 120),
    NULLIF(left(COALESCE(p_codice_fiscale, ''), 16), ''),
    NULLIF(left(COALESCE(p_telefono, ''), 40), ''),
    NULLIF(left(COALESCE(p_motivo, ''), 300), ''),
    NULLIF(left(COALESCE(p_note, ''), 500), ''),
    p_anagrafica_id,
    p_operatore_id,
    NULLIF(left(COALESCE(p_operatore_nome, ''), 120), ''),
    p_data_ora,
    v_durata,
    'interno',
    'confermato',
    p_lead_outbound_id,
    p_originato_da_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_prenota_negozio_v1(text, text, text, text, text, uuid, uuid, text, timestamptz, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_prenota_negozio_v1(text, text, text, text, text, uuid, uuid, text, timestamptz, integer, uuid, uuid) TO service_role;

COMMIT;
