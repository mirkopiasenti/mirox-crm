BEGIN;
CREATE TABLE public.personale_planning_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  versione integer NOT NULL CHECK (versione > 0),
  documento jsonb NOT NULL CHECK (jsonb_typeof(documento) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.personale_planning_mesi (
  mese date PRIMARY KEY CHECK (mese >= DATE '2026-11-01' AND extract(day FROM mese) = 1),
  versione integer NOT NULL CHECK (versione > 0),
  bozza jsonb NOT NULL CHECK (jsonb_typeof(bozza) = 'object'),
  pubblicato jsonb CHECK (pubblicato IS NULL OR jsonb_typeof(pubblicato) = 'object'),
  pubblicato_versione integer,
  pubblicato_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.personale_planning_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  autore_id uuid NOT NULL,
  mese date,
  versione integer NOT NULL,
  azione text NOT NULL CHECK (azione IN ('configurazione','salvataggio','pubblicazione')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX personale_planning_audit_mese_idx ON public.personale_planning_audit (mese, id DESC);
ALTER TABLE public.personale_planning_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personale_planning_mesi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personale_planning_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.personale_planning_config, public.personale_planning_mesi, public.personale_planning_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.personale_planning_config, public.personale_planning_mesi TO service_role;
GRANT SELECT, INSERT ON public.personale_planning_audit TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.personale_planning_audit_id_seq TO service_role;

CREATE FUNCTION public.personale_salva_config(p_autore uuid, p_versione integer, p_documento jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_versione integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profili WHERE id = p_autore AND attivo IS TRUE AND ruolo = 'admin') THEN
    RAISE EXCEPTION 'Accesso negato' USING ERRCODE = '42501';
  END IF;
  IF p_versione IS NULL OR p_versione < 0 OR p_documento IS NULL OR jsonb_typeof(p_documento) <> 'object' THEN
    RAISE EXCEPTION 'Configurazione non valida' USING ERRCODE = '22023';
  END IF;
  IF p_versione = 0 THEN
    BEGIN
      INSERT INTO public.personale_planning_config(id,versione,documento) VALUES (true,1,p_documento) RETURNING versione INTO v_versione;
    EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Configurazione modificata' USING ERRCODE = '40001'; END;
  ELSE
    UPDATE public.personale_planning_config SET versione=versione+1, documento=p_documento, updated_at=now()
      WHERE id=true AND versione=p_versione RETURNING versione INTO v_versione;
    IF NOT FOUND THEN RAISE EXCEPTION 'Configurazione modificata' USING ERRCODE = '40001'; END IF;
  END IF;
  INSERT INTO public.personale_planning_audit(autore_id,versione,azione) VALUES (p_autore,v_versione,'configurazione');
  RETURN jsonb_build_object('versione',v_versione);
END;
$$;
CREATE FUNCTION public.personale_salva_mese(p_autore uuid, p_mese date, p_versione integer, p_documento jsonb, p_pubblica boolean)
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
  IF p_pubblica AND coalesce(p_documento->>'firstMondayOff','') NOT IN ('matteo','vincenzo') THEN
    RAISE EXCEPTION 'Assegnare alternanza iniziale' USING ERRCODE = '22023';
  END IF;
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
REVOKE ALL ON FUNCTION public.personale_salva_config(uuid,integer,jsonb), public.personale_salva_mese(uuid,date,integer,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.personale_salva_config(uuid,integer,jsonb), public.personale_salva_mese(uuid,date,integer,jsonb,boolean) TO service_role;
COMMIT;
