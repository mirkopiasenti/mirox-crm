-- Migration 055
-- Privacy a 24 mesi, prenotazioni pubbliche atomiche e rate limit persistente.
--
-- Compatibilita' Call Center:
--   - nessuna colonna/RPC esistente viene rimossa o modificata;
--   - public_prenota_appuntamento_v1 e' una RPC nuova, invocabile solo dalla
--     service_role usata dalla Netlify Function;
--   - get_slot_disponibili(date) resta invariata per il Call Center legacy.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Consensi privacy: validita' massima 24 mesi
-- ---------------------------------------------------------------------------

UPDATE public.vendita_consensi_privacy
SET valido_fino_al = LEAST(
  valido_fino_al,
  COALESCE(otp_confermato_at, created_at) + interval '24 months'
)
WHERE stato = 'confermato'
  AND valido_fino_al IS NOT NULL
  AND valido_fino_al > COALESCE(otp_confermato_at, created_at) + interval '24 months';

COMMENT ON TABLE public.vendita_consensi_privacy IS
  'Documenti di presa visione dell''informativa e consensi marketing raccolti dal wizard vendita tramite OTP SMS o modulo cartaceo. Riutilizzo massimo 24 mesi, salvo revoca o scadenza anticipata.';

COMMENT ON COLUMN public.vendita_consensi_privacy.valido_fino_al IS
  'Scadenza del riutilizzo dell''informativa/consenso: conferma o creazione + massimo 24 mesi.';

COMMENT ON COLUMN public.vendita_consensi_privacy.consenso_contratto IS
  'Presa visione dell''informativa per trattamenti contrattuali/legali; non costituisce consenso GDPR quale base giuridica del contratto.';

COMMENT ON COLUMN public.vendita_consensi_privacy.consenso_marketing IS
  'Consenso facoltativo e revocabile al marketing diretto sui canali dichiarati, valido al massimo 24 mesi.';

-- ---------------------------------------------------------------------------
-- 2. Rate limit pubblico persistente
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.mirox_public_rate_limits (
  scope text NOT NULL,
  fingerprint_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, fingerprint_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_mirox_public_rate_limits_expires
  ON public.mirox_public_rate_limits (expires_at);

ALTER TABLE public.mirox_public_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mirox_public_rate_limits
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mirox_public_rate_limits
  TO service_role;

COMMENT ON TABLE public.mirox_public_rate_limits IS
  'Contatori temporanei per rate limit degli endpoint pubblici. La fingerprint e'' SHA256 dell''IP e non contiene l''IP in chiaro.';

CREATE OR REPLACE FUNCTION public.mirox_public_rate_limit_v1(
  p_scope text,
  p_fingerprint_hash text,
  p_window_seconds integer,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_count integer;
  v_retry_after integer;
BEGIN
  IF p_scope IS NULL OR length(btrim(p_scope)) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'scope_non_valido' USING ERRCODE = '22023';
  END IF;
  IF p_fingerprint_hash IS NULL OR p_fingerprint_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'fingerprint_non_valida' USING ERRCODE = '22023';
  END IF;
  IF p_window_seconds NOT BETWEEN 10 AND 86400 OR p_limit NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'limite_non_valido' USING ERRCODE = '22023';
  END IF;

  v_window_start := to_timestamp(
    floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds
  );
  v_expires_at := v_window_start + make_interval(secs => p_window_seconds);

  INSERT INTO public.mirox_public_rate_limits (
    scope,
    fingerprint_hash,
    window_start,
    request_count,
    expires_at
  )
  VALUES (
    btrim(p_scope),
    p_fingerprint_hash,
    v_window_start,
    1,
    v_expires_at
  )
  ON CONFLICT (scope, fingerprint_hash, window_start)
  DO UPDATE SET
    request_count = public.mirox_public_rate_limits.request_count + 1,
    expires_at = EXCLUDED.expires_at
  RETURNING request_count INTO v_count;

  v_retry_after := greatest(
    1,
    ceil(extract(epoch FROM (v_expires_at - v_now)))::integer
  );

  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'request_count', v_count,
    'limit', p_limit,
    'retry_after_seconds', v_retry_after
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.mirox_public_rate_limit_v1(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mirox_public_rate_limit_v1(text, text, integer, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Inserimento appuntamento pubblico atomico
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.public_prenota_appuntamento_v1(
  p_nome text,
  p_telefono text,
  p_motivo text,
  p_note text,
  p_data_ora timestamptz
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_id text;
  v_giorno date;
  v_storico jsonb;
  v_storico_type text;
BEGIN
  IF p_data_ora IS NULL THEN
    RAISE EXCEPTION 'slot_non_valido' USING ERRCODE = '22023';
  END IF;

  -- Timestamp equivalenti producono la stessa chiave: le richieste concorrenti
  -- sul medesimo slot vengono serializzate fino al commit della prima.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('mirox-public-prenota:' || p_data_ora::text, 0)
  );

  v_giorno := (p_data_ora AT TIME ZONE 'Europe/Rome')::date;

  IF NOT EXISTS (
    SELECT 1
    FROM unnest(public.get_slot_disponibili(v_giorno)) AS slot(data_ora)
    WHERE slot.data_ora::timestamptz = p_data_ora
  ) THEN
    RAISE EXCEPTION 'slot_non_disponibile' USING ERRCODE = 'P0001';
  END IF;

  v_storico := jsonb_build_array(jsonb_build_object(
    'azione', 'prenotazione online',
    'data', clock_timestamp()
  ));

  -- Lo schema storico del Call Center puo' avere `storico` text oppure jsonb.
  -- La scelta viene fatta a runtime senza cambiare la tabella condivisa.
  SELECT a.atttypid::regtype::text
  INTO v_storico_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.appuntamenti'::regclass
    AND a.attname = 'storico'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF v_storico_type = 'jsonb' THEN
    EXECUTE
      'INSERT INTO public.appuntamenti
         (nome, telefono, motivo, note, codice_fiscale, data_ora, fonte, stato, storico)
       VALUES ($1, $2, $3, $4, NULL, $5, ''pubblico'', ''confermato'', $6::jsonb)
       RETURNING id::text'
    INTO v_id
    USING p_nome, p_telefono, p_motivo, p_note, p_data_ora, v_storico;
  ELSIF v_storico_type = 'json' THEN
    EXECUTE
      'INSERT INTO public.appuntamenti
         (nome, telefono, motivo, note, codice_fiscale, data_ora, fonte, stato, storico)
       VALUES ($1, $2, $3, $4, NULL, $5, ''pubblico'', ''confermato'', $6::json)
       RETURNING id::text'
    INTO v_id
    USING p_nome, p_telefono, p_motivo, p_note, p_data_ora, v_storico;
  ELSE
    EXECUTE
      'INSERT INTO public.appuntamenti
         (nome, telefono, motivo, note, codice_fiscale, data_ora, fonte, stato, storico)
       VALUES ($1, $2, $3, $4, NULL, $5, ''pubblico'', ''confermato'', $6::text)
       RETURNING id::text'
    INTO v_id
    USING p_nome, p_telefono, p_motivo, p_note, p_data_ora, v_storico;
  END IF;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.public_prenota_appuntamento_v1(
  text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_prenota_appuntamento_v1(
  text, text, text, text, timestamptz
) TO service_role;

COMMIT;
