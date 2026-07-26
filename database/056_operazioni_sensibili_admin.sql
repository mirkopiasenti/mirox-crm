-- Migration 056
-- Rende realmente admin-only:
--   1. la creazione di rimborsi manuali;
--   2. il passaggio di una pratica Apri/Chiudi allo stato KO.
--
-- Applicare dopo il deploy della function gestisci-operazioni-post-vendita e
-- dei relativi refactor frontend.

BEGIN;

-- Tutte le scritture dei rimborsi passano dal backend autenticato. In questo
-- modo un operatore non può aggirare la action admin-only creando direttamente
-- dal browser una riga già Consegnata e priva del PDF firmato.
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'post_vendita_gestione_rimborsi'
      AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.post_vendita_gestione_rimborsi',
      p.policyname
    );
  END LOOP;
END
$$;

DROP POLICY IF EXISTS post_vendita_gestione_rimborsi_authenticated_select
  ON public.post_vendita_gestione_rimborsi;

CREATE POLICY post_vendita_gestione_rimborsi_authenticated_select
  ON public.post_vendita_gestione_rimborsi
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE
  ON TABLE public.post_vendita_gestione_rimborsi
  FROM anon, authenticated;
GRANT SELECT
  ON TABLE public.post_vendita_gestione_rimborsi
  TO authenticated;
GRANT ALL
  ON TABLE public.post_vendita_gestione_rimborsi
  TO service_role;

-- Anche la generazione dei codici rimborso è ora soltanto server-side.
REVOKE ALL ON FUNCTION public.genera_codice_rimborso()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.genera_codice_rimborso()
  TO service_role;

-- Difesa DB per Apri/Chiudi: le scritture ordinarie restano disponibili agli
-- operatori, ma INSERT/UPDATE che introducono lo stato KO richiedono un admin.
-- La service_role della Netlify Function è ammessa perché il ruolo admin è già
-- stato verificato da requireAuth prima dell'UPDATE.
CREATE OR REPLACE FUNCTION public.mirox_guard_apri_chiudi_ko_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_is_admin boolean := false;
BEGIN
  IF NEW.stato IS DISTINCT FROM 'KO' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.stato IS NOT DISTINCT FROM NEW.stato THEN
    RETURN NEW;
  END IF;

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

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Operazione riservata agli amministratori'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mirox_guard_apri_chiudi_ko_admin()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_vendita_apri_chiudi_ko_admin_insert
  ON public.vendita_apri_chiudi;
CREATE TRIGGER trg_vendita_apri_chiudi_ko_admin_insert
  BEFORE INSERT
  ON public.vendita_apri_chiudi
  FOR EACH ROW
  EXECUTE FUNCTION public.mirox_guard_apri_chiudi_ko_admin();

DROP TRIGGER IF EXISTS trg_vendita_apri_chiudi_ko_admin_update
  ON public.vendita_apri_chiudi;
CREATE TRIGGER trg_vendita_apri_chiudi_ko_admin_update
  BEFORE UPDATE OF stato
  ON public.vendita_apri_chiudi
  FOR EACH ROW
  EXECUTE FUNCTION public.mirox_guard_apri_chiudi_ko_admin();

COMMIT;
