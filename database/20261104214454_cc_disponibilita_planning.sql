-- Disponibilita CC: filtro additivo e controllo finale, senza sostituire RPC legacy.
-- NON applicare in produzione senza conferma: aggiunge un trigger su appuntamenti.
BEGIN;
CREATE SCHEMA mirox_cc_privato;
REVOKE ALL ON SCHEMA mirox_cc_privato FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA mirox_cc_privato TO service_role;

-- Motore puro: stessi turni meno assenze del planning, senza note o consuntivi.
CREATE FUNCTION mirox_cc_privato.presenza_v1(p_documento jsonb, p_inizio timestamp, p_fine timestamp)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_id text; v_day jsonb; v_pair jsonb; v_absence jsonb; v_count integer;
  v_available tsmultirange; v_start timestamp; v_end timestamp;
BEGIN
  -- Assenza reale di pubblicazione: conserva la disponibilita precedente.
  IF p_documento IS NULL THEN RETURN true; END IF;
  IF jsonb_typeof(p_documento) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_documento->'employees') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_documento->'entries') IS DISTINCT FROM 'array'
    OR (p_documento->>'month') IS DISTINCT FROM to_char(p_inizio,'YYYY-MM') THEN
    RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023';
  END IF;
  IF p_inizio IS NULL OR p_fine IS NULL OR p_fine <= p_inizio OR p_fine::date <> p_inizio::date THEN RETURN false; END IF;
  FOREACH v_id IN ARRAY ARRAY['matteo','vincenzo'] LOOP
    SELECT count(*) INTO v_count FROM jsonb_array_elements(p_documento->'employees') e WHERE e->>'id'=v_id;
    IF v_count <> 1 THEN RETURN false; END IF;
    SELECT count(*) INTO v_count FROM jsonb_array_elements(p_documento->'entries') e
      WHERE e->>'employeeId'=v_id AND e->>'date'=to_char(p_inizio,'YYYY-MM-DD');
    IF v_count <> 1 THEN RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023'; END IF;
    SELECT e INTO v_day FROM jsonb_array_elements(p_documento->'entries') e
      WHERE e->>'employeeId'=v_id AND e->>'date'=to_char(p_inizio,'YYYY-MM-DD');
    IF jsonb_typeof(v_day->'closed') IS DISTINCT FROM 'boolean'
      OR (v_day ? 'offsite' AND jsonb_typeof(v_day->'offsite') IS DISTINCT FROM 'boolean')
      OR jsonb_typeof(v_day->'slots') IS DISTINCT FROM 'array'
      OR jsonb_typeof(v_day->'absences') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023';
    END IF;
    IF (v_day->>'closed')::boolean OR coalesce((v_day->>'offsite')::boolean,false) THEN RETURN false; END IF;
    v_available := '{}'::tsmultirange;
    FOR v_pair IN SELECT value FROM jsonb_array_elements(v_day->'slots') LOOP
      IF jsonb_typeof(v_pair) IS DISTINCT FROM 'array' OR jsonb_array_length(v_pair) <> 2
        OR coalesce(v_pair->>0,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR coalesce(v_pair->>1,'') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023';
      END IF;
      v_start := p_inizio::date + (v_pair->>0)::time; v_end := p_inizio::date + (v_pair->>1)::time;
      IF v_end <= v_start THEN RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023'; END IF;
      v_available := v_available + tsmultirange(tsrange(v_start,v_end,'[)'));
    END LOOP;
    FOR v_absence IN SELECT value FROM jsonb_array_elements(v_day->'absences') LOOP
      IF jsonb_typeof(v_absence->'fullDay') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023';
      END IF;
      IF (v_absence->>'fullDay')::boolean THEN RETURN false; END IF;
      IF coalesce(v_absence->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        OR coalesce(v_absence->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
        RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023';
      END IF;
      v_start := p_inizio::date + (v_absence->>'start')::time; v_end := p_inizio::date + (v_absence->>'end')::time;
      IF v_end <= v_start THEN RAISE EXCEPTION 'planning_non_valido' USING ERRCODE='22023'; END IF;
      v_available := v_available - tsmultirange(tsrange(v_start,v_end,'[)'));
    END LOOP;
    IF NOT (v_available @> tsrange(p_inizio,p_fine,'[)')) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION mirox_cc_privato.presenza_v1(jsonb,timestamp,timestamp) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION mirox_cc_privato.presenza_v1(jsonb,timestamp,timestamp) TO service_role;

CREATE FUNCTION public.mirox_cc_slot_disponibili_v1(p_data date)
-- La RPC legacy usa nomi non qualificati: conserva il suo search_path atteso.
RETURNS timestamptz[] LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE v_documento jsonb; v_slots timestamptz[]; v_durata integer;
BEGIN
  IF p_data IS NULL THEN RAISE EXCEPTION 'data_non_valida' USING ERRCODE='22023'; END IF;
  SELECT pubblicato INTO v_documento FROM public.personale_planning_mesi WHERE mese=date_trunc('month',p_data)::date;
  -- Chiusure, griglia, anticipo, buffer, occupazione e lock temporanei restano legacy.
  v_slots := public.get_slot_disponibili(p_data);
  IF v_documento IS NULL THEN RETURN coalesce(v_slots,'{}'); END IF;
  SELECT valore::integer INTO v_durata FROM public.impostazioni WHERE chiave='durata_appuntamento';
  IF v_durata IS NULL OR v_durata <= 0 OR v_durata > 1440 THEN
    RAISE EXCEPTION 'durata_non_valida' USING ERRCODE='22023';
  END IF;
  RETURN ARRAY(SELECT s FROM unnest(v_slots) s WHERE mirox_cc_privato.presenza_v1(v_documento,
    s AT TIME ZONE 'Europe/Rome',(s + make_interval(mins=>v_durata)) AT TIME ZONE 'Europe/Rome'));
END;
$$;
REVOKE ALL ON FUNCTION public.mirox_cc_slot_disponibili_v1(date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mirox_cc_slot_disponibili_v1(date) TO service_role;

-- Necessario al confine DB per coprire anche i vecchi client e la RPC pubblica.
-- Definer confinato nello schema privato: nessun nuovo accesso ai dati Personale.
CREATE FUNCTION mirox_cc_privato.verifica_appuntamento_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_documento jsonb;
BEGIN
  IF NEW.stato IS DISTINCT FROM 'confermato' THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    IF OLD.stato='confermato' AND OLD.data_ora IS NOT DISTINCT FROM NEW.data_ora
      AND OLD.durata_minuti IS NOT DISTINCT FROM NEW.durata_minuti THEN RETURN NEW; END IF;
  END IF;
  IF current_setting('role',true) IN ('authenticated','anon') AND
    (auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.profili WHERE id=auth.uid() AND attivo IS TRUE)) THEN
    RAISE EXCEPTION 'Accesso negato' USING ERRCODE='42501';
  END IF;
  -- SHARE serializza la lettura con salvataggi/pubblicazioni (anche il primo INSERT
  -- del mese). Non modifica il planning; lock tenuto solo durante il salvataggio.
  LOCK TABLE public.personale_planning_mesi IN SHARE MODE;
  SELECT pubblicato INTO v_documento FROM public.personale_planning_mesi
    WHERE mese=date_trunc('month',NEW.data_ora AT TIME ZONE 'Europe/Rome')::date;
  IF v_documento IS NULL THEN RETURN NEW; END IF;
  IF NEW.data_ora IS NULL OR NEW.durata_minuti IS NULL OR NEW.durata_minuti <= 0 OR NEW.durata_minuti > 1440
    OR NOT mirox_cc_privato.presenza_v1(v_documento,NEW.data_ora AT TIME ZONE 'Europe/Rome',
      (NEW.data_ora + make_interval(mins=>NEW.durata_minuti)) AT TIME ZONE 'Europe/Rome') THEN
    RAISE EXCEPTION 'slot_non_disponibile_planning' USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION mirox_cc_privato.verifica_appuntamento_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_mirox_cc_planning BEFORE INSERT OR UPDATE OF data_ora,durata_minuti,stato ON public.appuntamenti
  FOR EACH ROW EXECUTE FUNCTION mirox_cc_privato.verifica_appuntamento_v1();
COMMIT;
