-- Additive: nessuna riscrittura dei contratti storici e nessun cambiamento CC/RLS.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.vendita_contratti
  ADD COLUMN codice_contratto text,
  ADD COLUMN costo_offerta_mensile numeric(7,2),
  ADD COLUMN portabilita boolean,
  ADD COLUMN numero_telefono text,
  ADD COLUMN numero_provvisorio text,
  ADD COLUMN numero_mnp text,
  ADD COLUMN operatore_provenienza text;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_codice_pda_formato CHECK (
    codice_contratto IS NULL OR codice_contratto ~ '^[A-Z0-9][A-Z0-9/-]{0,79}$'),
  ADD CONSTRAINT vendita_mobile_costo_valido CHECK (costo_offerta_mensile IS NULL OR costo_offerta_mensile >= 0),
  ADD CONSTRAINT vendita_mobile_numeri_validi CHECK (
    (numero_telefono IS NULL OR numero_telefono ~ '^3[0-9]{8,9}$') AND
    (numero_provvisorio IS NULL OR numero_provvisorio ~ '^3[0-9]{8,9}$') AND
    (numero_mnp IS NULL OR numero_mnp ~ '^3[0-9]{8,9}$')),
  ADD CONSTRAINT vendita_mobile_portabilita_coerente CHECK (
    (portabilita IS NULL AND numero_telefono IS NULL AND numero_provvisorio IS NULL AND numero_mnp IS NULL AND operatore_provenienza IS NULL AND costo_offerta_mensile IS NULL)
    OR (portabilita IS FALSE AND numero_telefono IS NOT NULL AND costo_offerta_mensile IS NOT NULL AND numero_provvisorio IS NULL AND numero_mnp IS NULL AND operatore_provenienza IS NULL)
    OR (portabilita IS TRUE AND numero_telefono IS NOT NULL AND numero_mnp = numero_telefono AND numero_mnp IS NOT NULL AND numero_provvisorio IS NOT NULL AND costo_offerta_mensile IS NOT NULL AND length(btrim(operatore_provenienza)) > 0 AND operatore_provenienza IS NOT NULL));
CREATE UNIQUE INDEX vendita_contratti_codice_pda_unique
  ON public.vendita_contratti(codice_contratto) WHERE codice_contratto IS NOT NULL;

-- Il controllo Fisso nasce soltanto dopo la verifica: il codice nuovo viene
-- copiato all'INSERT del controllo. Gli storici senza codice PDA restano identici.
CREATE FUNCTION public.vendita_pda_sync_controllo_fisso() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE tracked_code text; changed_count integer;
BEGIN
  SELECT codice_contratto INTO tracked_code FROM public.vendita_contratti WHERE id = NEW.contratto_id;
  IF tracked_code IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.cod_contratto := tracked_code;
  ELSIF NEW.cod_contratto IS DISTINCT FROM OLD.cod_contratto THEN
    NEW.cod_contratto := upper(regexp_replace(coalesce(NEW.cod_contratto, ''), '\s', '', 'g'));
    IF NEW.cod_contratto = '' THEN RAISE EXCEPTION 'Codice contratto obbligatorio' USING ERRCODE = '23514'; END IF;
    IF NEW.cod_contratto IS DISTINCT FROM tracked_code THEN
      UPDATE public.vendita_contratti SET codice_contratto = NEW.cod_contratto WHERE id = NEW.contratto_id;
      GET DIAGNOSTICS changed_count = ROW_COUNT;
      IF changed_count <> 1 THEN
        RAISE EXCEPTION 'Modificare il codice tramite Modifica codice PDA' USING ERRCODE = '42501';
      END IF;
    END IF;
  ELSE
    NEW.cod_contratto := tracked_code;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vendita_pda_controllo_fisso
  BEFORE INSERT OR UPDATE OF cod_contratto, contratto_id ON public.post_vendita_controllo_fissi
  FOR EACH ROW EXECUTE FUNCTION public.vendita_pda_sync_controllo_fisso();

CREATE FUNCTION public.vendita_pda_sync_fisso() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF pg_trigger_depth() > 1 OR NEW.codice_contratto IS NULL THEN RETURN NEW; END IF;
  UPDATE public.post_vendita_controllo_fissi SET cod_contratto = NEW.codice_contratto
    WHERE contratto_id = NEW.id AND cod_contratto IS DISTINCT FROM NEW.codice_contratto;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vendita_pda_fisso
  AFTER UPDATE OF codice_contratto ON public.vendita_contratti
  FOR EACH ROW WHEN (OLD.codice_contratto IS DISTINCT FROM NEW.codice_contratto)
  EXECUTE FUNCTION public.vendita_pda_sync_fisso();
REVOKE ALL ON FUNCTION public.vendita_pda_sync_controllo_fisso() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vendita_pda_sync_fisso() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_pda_sync_controllo_fisso() TO service_role;
GRANT EXECUTE ON FUNCTION public.vendita_pda_sync_fisso() TO service_role;
COMMIT;
