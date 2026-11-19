BEGIN;

SET LOCAL lock_timeout = '3s';

-- La protezione atomica si applica alle nuove chiavi. Le eventuali ripetizioni
-- storiche restano integre e il trigger le considera nelle nuove ricerche.
ALTER TABLE public.vendita_contratti
  ADD COLUMN energia_chiave_giornaliera_protetta boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX vendita_energia_punto_giornaliero_unique
  ON public.vendita_contratti (
    ((created_at AT TIME ZONE 'Europe/Rome')::date),
    (upper(regexp_replace(pod_pdr, '[[:space:]]+', '', 'g')))
  )
  WHERE energia_chiave_giornaliera_protetta;

CREATE FUNCTION mirox_private.vendita_energia_punto_presente(p_punti text[], p_giorno date, p_escludi uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendita_contratti AS c
    WHERE c.pod_pdr IS NOT NULL
      AND coalesce(lower(nullif(btrim(c.categoria_snapshot), '')) = 'energia',
        mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot))
      AND upper(regexp_replace(c.pod_pdr, '[[:space:]]+', '', 'g')) = ANY(p_punti)
      AND (c.created_at AT TIME ZONE 'Europe/Rome')::date = p_giorno
      AND c.id IS DISTINCT FROM p_escludi
  );
$$;

CREATE FUNCTION public.vendita_energia_punto_caricato_oggi(p_punti text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT mirox_private.vendita_energia_punto_presente(
    p_punti, (statement_timestamp() AT TIME ZONE 'Europe/Rome')::date, NULL
  );
$$;

CREATE FUNCTION mirox_private.vendita_energia_blocca_punto_giornaliero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_punto text := upper(regexp_replace(NEW.pod_pdr, '[[:space:]]+', '', 'g'));
  v_giorno date := (NEW.created_at AT TIME ZONE 'Europe/Rome')::date;
  v_energia boolean := coalesce(lower(nullif(btrim(NEW.categoria_snapshot), '')) = 'energia',
    mirox_private.energia_categoria(NEW.categoria_id, NEW.categoria_snapshot));
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF v_energia IS NOT DISTINCT FROM coalesce(lower(nullif(btrim(OLD.categoria_snapshot), '')) = 'energia',
      mirox_private.energia_categoria(OLD.categoria_id, OLD.categoria_snapshot))
      AND v_punto IS NOT DISTINCT FROM upper(regexp_replace(OLD.pod_pdr, '[[:space:]]+', '', 'g'))
      AND v_giorno IS NOT DISTINCT FROM (OLD.created_at AT TIME ZONE 'Europe/Rome')::date THEN
      NEW.energia_chiave_giornaliera_protetta := OLD.energia_chiave_giornaliera_protetta;
      RETURN NEW;
    END IF;
    IF v_giorno IS DISTINCT FROM (statement_timestamp() AT TIME ZONE 'Europe/Rome')::date THEN
      NEW.energia_chiave_giornaliera_protetta := false;
      RETURN NEW;
    END IF;
  END IF;

  NEW.energia_chiave_giornaliera_protetta := COALESCE(
    v_energia
    AND v_punto ~ '^(IT[0-9]{3}E[A-Z0-9]{8,10}|[0-9]{14})$'
    AND v_giorno IS NOT NULL, false
  );
  IF NEW.energia_chiave_giornaliera_protetta
    AND mirox_private.vendita_energia_punto_presente(ARRAY[v_punto], v_giorno, NEW.id) THEN
    RAISE EXCEPTION 'Per questo POD/PDR è già stata caricata una pratica nello stesso giorno di inserimento.'
      USING ERRCODE = '23505', CONSTRAINT = 'vendita_energia_punto_giornaliero_unique';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION mirox_private.vendita_energia_punto_presente(text[], date, uuid),
  public.vendita_energia_punto_caricato_oggi(text[]),
  mirox_private.vendita_energia_blocca_punto_giornaliero() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mirox_private.vendita_energia_punto_presente(text[], date, uuid),
  public.vendita_energia_punto_caricato_oggi(text[]) TO service_role;

CREATE TRIGGER trg_vendita_energia_punto_giornaliero
  BEFORE INSERT OR UPDATE OF pod_pdr, categoria_snapshot, categoria_id, created_at, energia_chiave_giornaliera_protetta
  ON public.vendita_contratti
  FOR EACH ROW EXECUTE FUNCTION mirox_private.vendita_energia_blocca_punto_giornaliero();

COMMIT;
