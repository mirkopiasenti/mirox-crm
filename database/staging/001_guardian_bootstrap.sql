-- Bootstrap one-shot del progetto Supabase Mirox CRM - Staging.
-- NON eseguire in produzione: il guard iniziale rifiuta qualsiasi database
-- che contenga gia' tabelle applicative nello schema public.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
  ) THEN
    RAISE EXCEPTION
      'Bootstrap staging interrotto: lo schema public contiene gia'' tabelle';
  END IF;
END;
$$;

CREATE TABLE public.profili (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 160),
  ruolo text NOT NULL DEFAULT 'operatore' CHECK (ruolo IN ('admin', 'operatore')),
  attivo boolean NOT NULL DEFAULT true,
  pagine_accessibili jsonb NOT NULL DEFAULT '{}'::jsonb,
  colore text,
  in_gara boolean NOT NULL DEFAULT false,
  ordine_gara integer NOT NULL DEFAULT 0,
  alias_di uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profili_alias_di_no_self CHECK (alias_di IS NULL OR alias_di <> id)
);

CREATE INDEX idx_profili_alias_di
  ON public.profili(alias_di)
  WHERE alias_di IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mirox_staging_touch_profili()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profili_updated_at
BEFORE UPDATE ON public.profili
FOR EACH ROW EXECUTE FUNCTION public.mirox_staging_touch_profili();

ALTER TABLE public.profili ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profili FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mirox_staging_touch_profili() FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.profili TO authenticated;
GRANT ALL ON TABLE public.profili TO service_role;
GRANT EXECUTE ON FUNCTION public.mirox_staging_touch_profili() TO service_role;

CREATE POLICY profili_select_own
ON public.profili
FOR SELECT
TO authenticated
USING (auth.uid() = id);

COMMENT ON TABLE public.profili IS
  'Profili minimi del solo staging Guardian; nessun dato cliente di produzione.';

COMMIT;
