-- Migration 074 — audit correzioni esito e failover KONA Call Director.
--
-- SOLO staging/test in questa fase. Non applicare a production senza una
-- conferma separata. Le tabelle sono server-only: il browser passa sempre
-- dalle Netlify Functions autenticate.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kona_call_director_correzioni_esito (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chiamata_id uuid NOT NULL REFERENCES public.chiamate(id) ON DELETE RESTRICT,
  operatore_id uuid NOT NULL REFERENCES public.profili(id) ON DELETE RESTRICT,
  esito_precedente text NOT NULL,
  esito_nuovo text NOT NULL,
  motivo text NOT NULL CHECK (char_length(btrim(motivo)) BETWEEN 3 AND 500),
  canale text NOT NULL DEFAULT 'kona_inbound' CHECK (canale IN ('kona_inbound','kona_storico','admin')),
  creato_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_cd_correzioni_chiamata
  ON public.kona_call_director_correzioni_esito(chiamata_id, creato_at DESC);
CREATE INDEX IF NOT EXISTS idx_kona_cd_correzioni_operatore
  ON public.kona_call_director_correzioni_esito(operatore_id, creato_at DESC);

COMMENT ON TABLE public.kona_call_director_correzioni_esito IS
  'Audit append-only delle correzioni in giornata degli esiti canonici chiamate.';

ALTER TABLE public.kona_call_director_correzioni_esito ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kona_call_director_correzioni_esito FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.kona_call_director_correzioni_esito TO service_role;

CREATE OR REPLACE FUNCTION public.kona_cd_correzioni_immutabili()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'kona_call_director_correzioni_esito e append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_kona_cd_correzioni_no_update
  ON public.kona_call_director_correzioni_esito;
CREATE TRIGGER trg_kona_cd_correzioni_no_update
BEFORE UPDATE ON public.kona_call_director_correzioni_esito
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_correzioni_immutabili();

DROP TRIGGER IF EXISTS trg_kona_cd_correzioni_no_delete
  ON public.kona_call_director_correzioni_esito;
CREATE TRIGGER trg_kona_cd_correzioni_no_delete
BEFORE DELETE ON public.kona_call_director_correzioni_esito
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_correzioni_immutabili();

CREATE TABLE IF NOT EXISTS public.kona_call_director_failover (
  profilo_id uuid PRIMARY KEY REFERENCES public.profili(id) ON DELETE CASCADE,
  codice text NOT NULL,
  dettaglio_tecnico text,
  attivato_at timestamptz NOT NULL DEFAULT now(),
  scade_at timestamptz NOT NULL,
  risolto_at timestamptz,
  CHECK (scade_at > attivato_at)
);

CREATE INDEX IF NOT EXISTS idx_kona_cd_failover_attivo
  ON public.kona_call_director_failover(scade_at)
  WHERE risolto_at IS NULL;

COMMENT ON TABLE public.kona_call_director_failover IS
  'Bypass manuale temporaneo e server-side quando il servizio AI KONA non e disponibile.';

ALTER TABLE public.kona_call_director_failover ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kona_call_director_failover FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.kona_call_director_failover TO service_role;

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
  IF p_canale NOT IN ('kona_inbound','kona_storico','admin') THEN
    RAISE EXCEPTION 'Canale non valido';
  END IF;
  IF p_esito_nuovo = 'ricontattare'
     AND (p_data_ricontatto IS NULL OR p_fascia_ricontatto NOT IN ('Mattina','Pomeriggio')) THEN
    RAISE EXCEPTION 'Data e fascia ricontatto obbligatorie';
  END IF;

  SELECT * INTO v_chiamata
  FROM public.chiamate
  WHERE id = p_chiamata_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Chiamata non trovata'; END IF;
  IF NOT coalesce(p_attore_admin, false) AND v_chiamata.operatore_id <> p_attore_id THEN
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

REVOKE ALL ON FUNCTION public.kona_cd_correggi_esito_v1(uuid,uuid,boolean,text,text,date,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_correggi_esito_v1(uuid,uuid,boolean,text,text,date,text,text)
  TO service_role;

COMMIT;
