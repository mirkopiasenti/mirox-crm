-- Migration 078 — KONA Call Director: assistente Telegram con DeepSeek V4.1 Flash.
--
-- Oggetto: SOLO oggetti `kona_call_director_*` del progetto di test KONA.
-- Nessuna tabella condivisa col Call Center, nessun DROP di dati, nessun RENAME,
-- nessuna modifica a RLS. Tutto ADDITIVO e idempotente.
--
-- PERCHE'
-- Il bot Telegram di KONA Call Director passa da un elenco rigido di comandi a
-- un dialogo in linguaggio naturale. L'interpretazione del messaggio e' fatta
-- da DeepSeek V4.1 Flash (modello `deepseek-flash`, API compatibile OpenAI),
-- mentre la ricerca dei dati aziendali su web resta su OpenAI. DeepSeek non ha
-- ricerca web e non trascrive audio: la trascrizione dei vocali Telegram e'
-- stata rimossa dal progetto.
--
-- CONTENUTO
--   1. config: riserva di spesa dedicata a Telegram (default 10 EUR/mese),
--      tetto orario dei messaggi, modello e prezzi DeepSeek, provider per
--      attivita'
--   2. budget_log: l'attivita' `telegram` diventa un valore ammesso
--   3. RPC kona_cd_reserve_budget_v2: terza riserva (Telegram) e tetto orario
--      Telegram separato da quello OpenAI
--
-- NB: la RPC v1 resta in vigore e invariata. Il codice la usa come fallback
-- finche' questa migration non e' applicata.
--
-- NON applicata ad alcun database da questa sessione: va eseguita a mano sul
-- database di test, come le 076 e 077.

BEGIN;

-- =============================================================================
-- 1. Configurazione: riserva Telegram, tetto messaggi, provider DeepSeek
-- =============================================================================

ALTER TABLE public.kona_call_director_config
  ADD COLUMN IF NOT EXISTS riserva_telegram_eur numeric(10,2) NOT NULL DEFAULT 10.00
    CHECK (riserva_telegram_eur >= 0);

ALTER TABLE public.kona_call_director_config
  ADD COLUMN IF NOT EXISTS max_messaggi_telegram_ora integer NOT NULL DEFAULT 60
    CHECK (max_messaggi_telegram_ora >= 0);

ALTER TABLE public.kona_call_director_config
  ADD COLUMN IF NOT EXISTS modello_deepseek text NOT NULL DEFAULT 'deepseek-flash';

-- Prezzi ufficiali DeepSeek al 2026-09 (fonte: api-docs.deepseek.com/quick_start/pricing).
-- Tariffa PEAK (la piu' cara, usata per una stima conservativa):
--   deepseek-flash: input $0.30 / 1M token, output $1.20 / 1M token.
-- La tariffa off-peak e' la meta'. Stima sempre al rialzo, mai al ribasso.
ALTER TABLE public.kona_call_director_config
  ADD COLUMN IF NOT EXISTS prezzi_deepseek jsonb NOT NULL
    DEFAULT '{"deepseek-flash":{"input":0.30,"output":1.20}}'::jsonb;

-- Provider per attivita': default DeepSeek SOLO per il dialogo Telegram.
-- Le attivita' non elencate restano su OpenAI (arricchimento con ricerca web,
-- valutazione degli skip, piano, analisi). Cosi' il passaggio di provider e'
-- una riga di configurazione, non una modifica di codice.
ALTER TABLE public.kona_call_director_config
  ADD COLUMN IF NOT EXISTS provider_per_attivita jsonb NOT NULL
    DEFAULT '{"telegram":"deepseek"}'::jsonb;

COMMENT ON COLUMN public.kona_call_director_config.riserva_telegram_eur IS
  'Tetto di spesa mensile dedicato all''assistente Telegram (default 10 EUR).
  E'' una riserva SEPARATA dal budget totale: l''assistente si blocca quando la
  consuma, senza intaccare il budget di arricchimento.';
COMMENT ON COLUMN public.kona_call_director_config.max_messaggi_telegram_ora IS
  'Tetto orario dei messaggi Telegram interpretati dall''IA (0 = assistente
  congelato). Separato da max_chiamate_openai_ora: un messaggio Telegram non
  consuma il tetto orario delle chiamate OpenAI.';
COMMENT ON COLUMN public.kona_call_director_config.modello_deepseek IS
  'Modello DeepSeek usato dall''assistente Telegram. Il nome ufficiale del
  modello V4.1 Flash e'' `deepseek-flash`.';
COMMENT ON COLUMN public.kona_call_director_config.prezzi_deepseek IS
  'Stime di costo DeepSeek in USD per 1M token (tariffa peak, conservativa).
  Verificare contro la pagina prezzi ufficiale prima di attivare i conti.';
COMMENT ON COLUMN public.kona_call_director_config.provider_per_attivita IS
  'Provider IA per attivita (openai|deepseek). Default: telegram su deepseek,
  tutte le altre su openai.';

-- =============================================================================
-- 2. Registro budget: `telegram` diventa un'attivita' ammessa
-- =============================================================================
-- Il vincolo era anonimo: Postgres lo ha nominato
-- `kona_call_director_budget_log_attivita_check`. Il valore nuovo e' ADDITIVO
-- (tutte le righe esistenti continuano a passare) e serve a distinguere la
-- spesa Telegram da quella OpenAI, cosi' il tetto da 10 EUR/mese e'
-- calcolabile e verificabile.

ALTER TABLE public.kona_call_director_budget_log
  DROP CONSTRAINT IF EXISTS kona_call_director_budget_log_attivita_check;

ALTER TABLE public.kona_call_director_budget_log
  ADD CONSTRAINT kona_call_director_budget_log_attivita_check
  CHECK (attivita IN ('arricchimento','dialogo','piano','analisi','altro','telegram'));

COMMENT ON COLUMN public.kona_call_director_budget_log.attivita IS
  'Attivita'' pagata: arricchimento (OpenAI + ricerca web), dialogo/piano/
  analisi/altro (OpenAI), telegram (assistente Telegram su DeepSeek).';

-- =============================================================================
-- 3. RPC di prenotazione budget v2: riserva Telegram dedicata
-- =============================================================================
-- Perche' una v2 e non una modifica della v1 (regola di progetto: mai
-- modificare una RPC esistente, solo aggiungerne di nuove con nome nuovo):
--   * terzo gruppo di spesa `telegram`, con la sua riserva;
--   * tetto orario Telegram separato da quello OpenAI. Nella v1 il tetto orario
--     conta TUTTE le prenotazioni dell'ultima ora: con l'assistente Telegram
--     attivo, una raffica di messaggi avrebbe potuto consumare il tetto delle
--     chiamate OpenAI (e viceversa). La v2 esclude `telegram` dal conteggio
--     globale e lo conta a parte.
-- Tutto il resto (idempotenza, advisory lock, hard stop totale) resta identico.

CREATE OR REPLACE FUNCTION public.kona_cd_reserve_budget_v2(
  p_chiave text,
  p_mese text,
  p_attivita text,
  p_importo_eur numeric,
  p_budget_totale_eur numeric,
  p_riserva_arricchimento_eur numeric,
  p_riserva_dialogo_eur numeric,
  p_riserva_telegram_eur numeric DEFAULT 0,
  p_max_telegram_ora integer DEFAULT 60
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
  v_max_tg_ora integer := 60;
  v_riserve_ora integer := 0;
  v_riserve_tg_ora integer := 0;
BEGIN
  IF COALESCE(p_importo_eur, 0) <= 0 OR COALESCE(p_chiave, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'parametri_non_validi');
  END IF;
  v_chiave := left(p_chiave, 120);

  PERFORM pg_advisory_xact_lock(hashtextextended('kona_cd_budget_' || p_mese, 0));

  -- Idempotenza SOLO su una prenotazione ancora attiva.
  IF EXISTS (
    SELECT 1 FROM public.kona_call_director_budget_riserve
    WHERE chiave = v_chiave AND stato = 'riservato' AND scadenza > now()
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotente', true);
  END IF;

  -- Tetto orario dei messaggi Telegram (attivita' = 'telegram').
  SELECT COALESCE(max_messaggi_telegram_ora, 60) INTO v_max_tg_ora
  FROM public.kona_call_director_config WHERE id = 1;
  v_max_tg_ora := COALESCE(v_max_tg_ora, 60);
  IF p_attivita = 'telegram' THEN
    IF v_max_tg_ora <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'rate_limited', 'max_ora', 0, 'canale', 'telegram');
    END IF;
    SELECT count(*) INTO v_riserve_tg_ora
    FROM public.kona_call_director_budget_riserve
    WHERE creato_at > now() - interval '1 hour' AND attivita = 'telegram';
    IF v_riserve_tg_ora >= v_max_tg_ora THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'rate_limited',
        'max_ora', v_max_tg_ora, 'usate', v_riserve_tg_ora, 'canale', 'telegram');
    END IF;
  END IF;

  -- Tetto orario delle chiamate OpenAI: l'assistente Telegram non lo consuma.
  SELECT COALESCE(max_chiamate_openai_ora, 120) INTO v_max_ora
  FROM public.kona_call_director_config WHERE id = 1;
  v_max_ora := COALESCE(v_max_ora, 120);
  IF p_attivita <> 'telegram' THEN
    IF v_max_ora <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'rate_limited', 'max_ora', 0, 'canale', 'openai');
    END IF;
    SELECT count(*) INTO v_riserve_ora
    FROM public.kona_call_director_budget_riserve
    WHERE creato_at > now() - interval '1 hour' AND attivita <> 'telegram';
    IF v_riserve_ora >= v_max_ora THEN
      RETURN jsonb_build_object('ok', false, 'motivo', 'rate_limited',
        'max_ora', v_max_ora, 'usate', v_riserve_ora, 'canale', 'openai');
    END IF;
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

  v_gruppo := CASE
    WHEN p_attivita = 'arricchimento' THEN 'arricchimento'
    WHEN p_attivita = 'telegram' THEN 'telegram'
    ELSE 'dialogo'
  END;

  IF v_gruppo = 'arricchimento' THEN
    v_limite_gruppo := COALESCE(p_riserva_arricchimento_eur, 0);
  ELSIF v_gruppo = 'telegram' THEN
    v_limite_gruppo := COALESCE(p_riserva_telegram_eur, 0);
  ELSE
    v_limite_gruppo := COALESCE(p_riserva_dialogo_eur, 0);
  END IF;

  SELECT COALESCE(sum(costo_stimato_eur), 0) INTO v_speso_gruppo
  FROM public.kona_call_director_budget_log
  WHERE mese = p_mese
    AND (CASE
      WHEN v_gruppo = 'arricchimento' THEN attivita = 'arricchimento'
      WHEN v_gruppo = 'telegram' THEN attivita = 'telegram'
      ELSE attivita NOT IN ('arricchimento','telegram')
    END);

  SELECT COALESCE(sum(importo_eur), 0) INTO v_riservato_gruppo
  FROM public.kona_call_director_budget_riserve
  WHERE mese = p_mese AND stato = 'riservato' AND scadenza > now()
    AND (CASE
      WHEN v_gruppo = 'arricchimento' THEN attivita = 'arricchimento'
      WHEN v_gruppo = 'telegram' THEN attivita = 'telegram'
      ELSE attivita NOT IN ('arricchimento','telegram')
    END);

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

REVOKE ALL ON FUNCTION public.kona_cd_reserve_budget_v2(text, text, text, numeric, numeric, numeric, numeric, numeric, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_reserve_budget_v2(text, text, text, numeric, numeric, numeric, numeric, numeric, integer) TO service_role;

COMMENT ON FUNCTION public.kona_cd_reserve_budget_v2(text, text, text, numeric, numeric, numeric, numeric, numeric, integer) IS
  'Prenotazione budget KONA con tre riserve (arricchimento, dialogo, telegram)
  e tetti orari separati OpenAI/Telegram. Sostituisce kona_cd_reserve_budget_v1
  per le chiamate dell''assistente Telegram; la v1 resta attiva per le altre.';

COMMIT;
