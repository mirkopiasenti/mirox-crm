-- Migration 058
-- Rende verificabile e non aggirabile l'integrità dei punteggi contratto.
--
-- Il trigger vendita_calcola_punteggio_totale continua a calcolare i valori;
-- i CHECK impediscono la persistenza di componenti/totali incoerenti anche in
-- caso di future modifiche al codice. Il trigger audit registra da ora in poi
-- gli snapshot alla creazione e ogni variazione dei quattro componenti.

BEGIN;

ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_contratti_punteggio_gara_totale_coerente_chk
  CHECK (
    punteggio_gara_totale =
      coalesce(punteggio_gara_offerta, 0) +
      coalesce(punteggio_gara_opzione, 0)
  ) NOT VALID;

ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_contratti_punteggio_extra_totale_coerente_chk
  CHECK (
    punteggio_extra_gara_totale =
      coalesce(punteggio_extra_gara_offerta, 0) +
      coalesce(punteggio_extra_gara_opzione, 0)
  ) NOT VALID;

ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_contratti_punteggio_legacy_coerente_chk
  CHECK (
    punteggio_offerta = coalesce(punteggio_gara_offerta, 0)
    AND punteggio_opzione = coalesce(punteggio_gara_opzione, 0)
    AND punteggio_extra = 0
    AND punteggio_totale = punteggio_gara_totale
  ) NOT VALID;

ALTER TABLE public.vendita_contratti
  VALIDATE CONSTRAINT vendita_contratti_punteggio_gara_totale_coerente_chk;

ALTER TABLE public.vendita_contratti
  VALIDATE CONSTRAINT vendita_contratti_punteggio_extra_totale_coerente_chk;

ALTER TABLE public.vendita_contratti
  VALIDATE CONSTRAINT vendita_contratti_punteggio_legacy_coerente_chk;

CREATE OR REPLACE FUNCTION public.vendita_audit_punteggi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_action text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.punteggio_gara_offerta IS NOT DISTINCT FROM NEW.punteggio_gara_offerta
     AND OLD.punteggio_gara_opzione IS NOT DISTINCT FROM NEW.punteggio_gara_opzione
     AND OLD.punteggio_extra_gara_offerta IS NOT DISTINCT FROM NEW.punteggio_extra_gara_offerta
     AND OLD.punteggio_extra_gara_opzione IS NOT DISTINCT FROM NEW.punteggio_extra_gara_opzione THEN
    RETURN NEW;
  END IF;

  v_old := CASE
    WHEN TG_OP = 'INSERT' THEN NULL
    ELSE jsonb_build_object(
      'categoria_id', OLD.categoria_id,
      'offerta_id', OLD.offerta_id,
      'opzione_id', OLD.opzione_id,
      'punteggio_gara_offerta', OLD.punteggio_gara_offerta,
      'punteggio_gara_opzione', OLD.punteggio_gara_opzione,
      'punteggio_gara_totale', OLD.punteggio_gara_totale,
      'punteggio_extra_gara_offerta', OLD.punteggio_extra_gara_offerta,
      'punteggio_extra_gara_opzione', OLD.punteggio_extra_gara_opzione,
      'punteggio_extra_gara_totale', OLD.punteggio_extra_gara_totale
    )
  END;

  v_new := jsonb_build_object(
    'categoria_id', NEW.categoria_id,
    'offerta_id', NEW.offerta_id,
    'opzione_id', NEW.opzione_id,
    'punteggio_gara_offerta', NEW.punteggio_gara_offerta,
    'punteggio_gara_opzione', NEW.punteggio_gara_opzione,
    'punteggio_gara_totale', NEW.punteggio_gara_totale,
    'punteggio_extra_gara_offerta', NEW.punteggio_extra_gara_offerta,
    'punteggio_extra_gara_opzione', NEW.punteggio_extra_gara_opzione,
    'punteggio_extra_gara_totale', NEW.punteggio_extra_gara_totale
  );

  v_action := CASE
    WHEN TG_OP = 'INSERT' THEN 'punteggio_insert'
    ELSE 'punteggio_update'
  END;

  INSERT INTO public.vendita_log_modifiche (
    tabella,
    record_id,
    azione,
    dati_precedenti,
    dati_nuovi,
    created_by
  )
  VALUES (
    'vendita_contratti',
    NEW.id,
    v_action,
    v_old,
    v_new,
    coalesce(NEW.updated_by, NEW.controllato_da, NEW.operatore_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vendita_contratti_audit_punteggi
  ON public.vendita_contratti;

CREATE TRIGGER trg_vendita_contratti_audit_punteggi
AFTER INSERT OR UPDATE OF
  punteggio_gara_offerta,
  punteggio_gara_opzione,
  punteggio_extra_gara_offerta,
  punteggio_extra_gara_opzione
ON public.vendita_contratti
FOR EACH ROW
EXECUTE FUNCTION public.vendita_audit_punteggi();

REVOKE ALL ON FUNCTION public.vendita_audit_punteggi()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.vendita_audit_punteggi()
  TO service_role;

COMMIT;
