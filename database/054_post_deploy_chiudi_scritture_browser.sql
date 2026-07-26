-- Migration 054
-- Revoca le scritture browser sostituite dalle Netlify Functions.
--
-- IMPORTANTE: applicare SOLO DOPO il deploy di:
--   - upload-documento-modulo
--   - gestisci-vendita-contratto
--   - refactor dei sette moduli frontend

BEGIN;

-- L'admin UI usa ora la v2 SECURITY DEFINER con controllo ruolo.
REVOKE ALL ON FUNCTION public.applica_alias_backfill(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- vendita_contratti resta leggibile agli authenticated, ma UPDATE passa dalla
-- function gestisci-vendita-contratto.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vendita_contratti'
      AND cmd = 'UPDATE'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.vendita_contratti',
      p.policyname
    );
  END LOOP;

  -- INSERT/DELETE documenti passano rispettivamente da
  -- upload-vendita-documento e gestisci-vendita-contratto.
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vendita_documenti'
      AND cmd IN ('INSERT', 'DELETE')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.vendita_documenti',
      p.policyname
    );
  END LOOP;

  -- Rimuove solo le policy di scrittura che citano i bucket dati serviti dalle
  -- nuove functions. Le policy SELECT e il bucket moduli-template restano.
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND (
        COALESCE(qual, '') || ' ' || COALESCE(with_check, '')
      ) ~ '(contratti-vendita|segnalazioni-files|apri-chiudi-files|switch-sim-files|comodato-files|rimborsi-files|protecta-files)'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON storage.objects',
      p.policyname
    );
  END LOOP;
END
$$;

COMMIT;
