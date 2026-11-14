-- Uscita Vincenzo da novembre2026, autorizzata14/11/2026.
-- CC: sola presenza Matteo, appuntamenti/dati/privilegi/trigger conservati.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='mirox_cc_privato.presenza_v1(jsonb,timestamp,timestamp)'::regprocedure
    AND NOT prosecdef AND md5(prosrc) IN ('7bfb35b29097ad4d7103f155a9e33b12','95213a983bd0f384e8954b9be1555ef9'))
    OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.personale_salva_mese(uuid,date,integer,jsonb,boolean)'::regprocedure
    AND NOT prosecdef AND md5(prosrc) IN ('fe49494794c9a5d9396168da3cf437c0','151f2d1fd98ffa312f00f83ff1f89125')) THEN
    RAISE EXCEPTION 'Funzioni diverse dal preflight: non sovrascrivere';
  END IF;
END;
$guard$;
CREATE OR REPLACE FUNCTION mirox_cc_privato.presenza_v1(p_documento jsonb, p_inizio timestamp, p_fine timestamp)
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
  FOREACH v_id IN ARRAY CASE WHEN p_inizio >= timestamp '2026-11-01'
    THEN ARRAY['matteo'] ELSE ARRAY['matteo','vincenzo'] END LOOP
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

CREATE OR REPLACE FUNCTION public.personale_salva_mese(p_autore uuid, p_mese date, p_versione integer, p_documento jsonb, p_pubblica boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row public.personale_planning_mesi;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profili WHERE id = p_autore AND attivo IS TRUE AND ruolo = 'admin') THEN
    RAISE EXCEPTION 'Accesso negato' USING ERRCODE = '42501';
  END IF;
  IF p_versione IS NULL OR p_versione < 0 OR p_mese IS NULL OR p_mese < DATE '2026-11-01' OR extract(day FROM p_mese) <> 1
    OR p_pubblica IS NULL OR p_documento IS NULL OR jsonb_typeof(p_documento) <> 'object'
    OR (p_documento->>'month') IS DISTINCT FROM to_char(p_mese,'YYYY-MM') THEN
    RAISE EXCEPTION 'Planning non valido' USING ERRCODE = '22023';
  END IF;
  -- Il roster operativo non contiene più la coppia alternata. L'API valida
  -- l'eventuale alternanza; gli snapshot conservano i dipendenti archiviati.
  IF p_versione = 0 THEN
    BEGIN
      INSERT INTO public.personale_planning_mesi(mese,versione,bozza) VALUES (p_mese,1,p_documento) RETURNING * INTO v_row;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Planning modificato' USING ERRCODE = '40001'; END;
  ELSE
    UPDATE public.personale_planning_mesi SET versione=versione+1, bozza=p_documento, updated_at=now()
      WHERE mese=p_mese AND versione=p_versione RETURNING * INTO v_row;
    IF NOT FOUND THEN RAISE EXCEPTION 'Planning modificato' USING ERRCODE = '40001'; END IF;
  END IF;
  IF p_pubblica THEN
    UPDATE public.personale_planning_mesi SET pubblicato=p_documento, pubblicato_versione=versione, pubblicato_at=now()
      WHERE mese=p_mese RETURNING * INTO v_row;
  END IF;
  INSERT INTO public.personale_planning_audit(autore_id,mese,versione,azione)
    VALUES (p_autore,p_mese,v_row.versione,CASE WHEN p_pubblica THEN 'pubblicazione' ELSE 'salvataggio' END);
  RETURN to_jsonb(v_row);
END;
$$;
COMMIT;
