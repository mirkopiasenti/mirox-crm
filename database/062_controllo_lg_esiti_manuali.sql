-- Migration 062
-- Esiti manuali protetti per il modulo Controllo L&G.
-- Le colonne distinguono lo stato proveniente dal CSV da quello impostato da
-- un admin e consentono di bloccare gli upload finche' un admin non riattiva
-- esplicitamente l'automatismo.

BEGIN;

ALTER TABLE public.post_vendita_controllo_lg
  ADD COLUMN IF NOT EXISTS stato_origine text NOT NULL DEFAULT 'csv',
  ADD COLUMN IF NOT EXISTS esito_manuale_bloccato boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS esito_manuale_note text,
  ADD COLUMN IF NOT EXISTS esito_manuale_at timestamptz,
  ADD COLUMN IF NOT EXISTS esito_manuale_da uuid,
  ADD COLUMN IF NOT EXISTS esito_manuale_sbloccato_at timestamptz,
  ADD COLUMN IF NOT EXISTS esito_manuale_sbloccato_da uuid;

ALTER TABLE public.post_vendita_controllo_lg
  DROP CONSTRAINT IF EXISTS pvlg_stato_origine_chk,
  DROP CONSTRAINT IF EXISTS pvlg_esito_manuale_coerenza_chk,
  DROP CONSTRAINT IF EXISTS post_vendita_controllo_lg_esito_manuale_da_fkey,
  DROP CONSTRAINT IF EXISTS post_vendita_controllo_lg_esito_manuale_sbloccato_da_fkey;

ALTER TABLE public.post_vendita_controllo_lg
  ADD CONSTRAINT post_vendita_controllo_lg_esito_manuale_da_fkey
    FOREIGN KEY (esito_manuale_da)
    REFERENCES public.profili(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT post_vendita_controllo_lg_esito_manuale_sbloccato_da_fkey
    FOREIGN KEY (esito_manuale_sbloccato_da)
    REFERENCES public.profili(id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT pvlg_stato_origine_chk
    CHECK (stato_origine IN ('csv', 'manuale')),
  ADD CONSTRAINT pvlg_esito_manuale_coerenza_chk
    CHECK (
      esito_manuale_bloccato IS NOT TRUE
      OR (
        stato_origine = 'manuale'
        AND COALESCE(length(btrim(stato)), 0) > 0
        AND COALESCE(length(btrim(esito_manuale_note)), 0) >= 5
        AND esito_manuale_at IS NOT NULL
        AND esito_manuale_da IS NOT NULL
      )
    );

COMMENT ON COLUMN public.post_vendita_controllo_lg.stato_origine IS
  'Origine dello stato corrente: csv oppure manuale.';
COMMENT ON COLUMN public.post_vendita_controllo_lg.esito_manuale_bloccato IS
  'Se true gli upload CSV non possono sovrascrivere lo stato finche un admin non riattiva l automatismo.';
COMMENT ON COLUMN public.post_vendita_controllo_lg.esito_manuale_note IS
  'Motivazione obbligatoria dell ultimo esito manuale.';
COMMENT ON COLUMN public.post_vendita_controllo_lg.esito_manuale_at IS
  'Timestamp dell ultimo esito manuale.';
COMMENT ON COLUMN public.post_vendita_controllo_lg.esito_manuale_da IS
  'Profilo admin che ha registrato l ultimo esito manuale.';
COMMENT ON COLUMN public.post_vendita_controllo_lg.esito_manuale_sbloccato_at IS
  'Timestamp dell ultima riattivazione degli aggiornamenti CSV.';
COMMENT ON COLUMN public.post_vendita_controllo_lg.esito_manuale_sbloccato_da IS
  'Profilo admin che ha riattivato gli aggiornamenti CSV.';

CREATE INDEX IF NOT EXISTS idx_pvlg_esito_manuale_bloccato
  ON public.post_vendita_controllo_lg(esito_manuale_bloccato)
  WHERE esito_manuale_bloccato = true;

-- Difesa DB: gli operatori autenticati possono mantenere le scritture CSV
-- legacy sulle righe non protette, ma non possono creare, modificare o
-- rimuovere un esito manuale. La Netlify Function usa service_role dopo aver
-- verificato il ruolo applicativo con requireAuth.
CREATE OR REPLACE FUNCTION public.mirox_guard_controllo_lg_esito_manuale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_admin boolean := false;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.profili p
    WHERE p.id = auth.uid()
      AND p.ruolo = 'admin'
      AND p.attivo IS DISTINCT FROM false
  )
  INTO v_is_admin;

  IF TG_OP = 'INSERT' THEN
    IF (
      NEW.esito_manuale_bloccato
      OR NEW.stato_origine = 'manuale'
      OR NEW.esito_manuale_note IS NOT NULL
      OR NEW.esito_manuale_at IS NOT NULL
      OR NEW.esito_manuale_da IS NOT NULL
    ) AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Operazione riservata agli amministratori'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.esito_manuale_bloccato AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Esito manuale protetto: aggiornamento CSV non consentito'
      USING ERRCODE = '42501';
  END IF;

  IF (
    NEW.stato_origine IS DISTINCT FROM OLD.stato_origine
    OR NEW.esito_manuale_bloccato IS DISTINCT FROM OLD.esito_manuale_bloccato
    OR NEW.esito_manuale_note IS DISTINCT FROM OLD.esito_manuale_note
    OR NEW.esito_manuale_at IS DISTINCT FROM OLD.esito_manuale_at
    OR NEW.esito_manuale_da IS DISTINCT FROM OLD.esito_manuale_da
    OR NEW.esito_manuale_sbloccato_at IS DISTINCT FROM OLD.esito_manuale_sbloccato_at
    OR NEW.esito_manuale_sbloccato_da IS DISTINCT FROM OLD.esito_manuale_sbloccato_da
  ) AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Operazione riservata agli amministratori'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mirox_guard_controllo_lg_esito_manuale()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pvlg_esito_manuale_guard
  ON public.post_vendita_controllo_lg;
CREATE TRIGGER trg_pvlg_esito_manuale_guard
  BEFORE INSERT OR UPDATE
  ON public.post_vendita_controllo_lg
  FOR EACH ROW
  EXECUTE FUNCTION public.mirox_guard_controllo_lg_esito_manuale();

COMMIT;
