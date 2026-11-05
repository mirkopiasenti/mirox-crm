-- Monitor dedicati: nessuna modifica a profili/appuntamenti/RPC/RLS legacy.
BEGIN;
CREATE TABLE public.mirox_monitor_dispositivi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  negozio text NOT NULL DEFAULT '9001415852' CHECK (negozio = '9001415852'),
  stato text NOT NULL DEFAULT 'in_attesa' CHECK (stato IN ('in_attesa','attivo','revocato')),
  token_hash text UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  pairing_hash text UNIQUE CHECK (pairing_hash ~ '^[a-f0-9]{64}$'),
  pairing_expires_at timestamptz,
  creato_da uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  CHECK ((stato = 'in_attesa' AND pairing_hash IS NOT NULL AND pairing_expires_at IS NOT NULL AND token_hash IS NULL)
    OR (stato = 'attivo' AND token_hash IS NOT NULL AND pairing_hash IS NULL AND pairing_expires_at IS NULL)
    OR stato = 'revocato')
);
CREATE TABLE public.mirox_monitor_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispositivo_id uuid NOT NULL REFERENCES public.mirox_monitor_dispositivi(id),
  azione text NOT NULL CHECK (azione IN ('crea','associa','revoca')),
  autore_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mirox_monitor_rate (
  chiave text PRIMARY KEY CHECK (chiave ~ '^[a-f0-9]{64}$'),
  finestra timestamptz NOT NULL,
  tentativi integer NOT NULL CHECK (tentativi BETWEEN 1 AND 21)
);
ALTER TABLE public.mirox_monitor_dispositivi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirox_monitor_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirox_monitor_rate ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mirox_monitor_dispositivi,public.mirox_monitor_audit,public.mirox_monitor_rate FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.mirox_monitor_dispositivi TO service_role;
GRANT SELECT,INSERT ON public.mirox_monitor_audit TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.mirox_monitor_rate TO service_role;

CREATE FUNCTION public.mirox_monitor_amministra(p_admin uuid,p_azione text,p_id uuid DEFAULT NULL,p_nome text DEFAULT NULL,p_pairing_hash text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE d public.mirox_monitor_dispositivi;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profili WHERE id=p_admin AND ruolo='admin' AND attivo IS NOT FALSE) THEN
    RAISE EXCEPTION 'Accesso negato' USING ERRCODE='42501';
  END IF;
  IF p_azione='crea' THEN
    IF p_nome IS NULL OR length(btrim(p_nome)) NOT BETWEEN 1 AND 80 OR p_pairing_hash IS NULL OR p_pairing_hash !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'Dati non validi' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.mirox_monitor_dispositivi(nome,creato_da,pairing_hash,pairing_expires_at)
      VALUES(btrim(p_nome),p_admin,p_pairing_hash,now()+interval '15 minutes') RETURNING * INTO d;
  ELSIF p_azione='revoca' THEN
    UPDATE public.mirox_monitor_dispositivi SET stato='revocato',revoked_at=now(),pairing_hash=NULL,pairing_expires_at=NULL
      WHERE id=p_id AND stato<>'revocato' RETURNING * INTO d;
    IF d.id IS NULL THEN
      SELECT * INTO d FROM public.mirox_monitor_dispositivi WHERE id=p_id AND stato='revocato';
      IF d.id IS NULL THEN RAISE EXCEPTION 'Monitor non trovato' USING ERRCODE='22023'; END IF;
      RETURN jsonb_build_object('id',d.id,'stato',d.stato);
    END IF;
  ELSE RAISE EXCEPTION 'Azione non valida' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.mirox_monitor_audit(dispositivo_id,azione,autore_id) VALUES(d.id,p_azione,p_admin);
  RETURN jsonb_build_object('id',d.id,'nome',d.nome,'stato',d.stato,'pairing_expires_at',d.pairing_expires_at);
END $$;

CREATE FUNCTION public.mirox_monitor_associa(p_pairing_hash text,p_token_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_pairing_hash IS NULL OR p_pairing_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Associazione non valida' USING ERRCODE='22023';
  END IF;
  -- Recupero idempotente dopo risposta persa: non emette un nuovo segreto.
  SELECT id INTO v_id FROM public.mirox_monitor_dispositivi WHERE token_hash=p_token_hash AND stato='attivo';
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  UPDATE public.mirox_monitor_dispositivi SET stato='attivo',token_hash=p_token_hash,
    pairing_hash=NULL,pairing_expires_at=NULL,activated_at=now()
    WHERE pairing_hash=p_pairing_hash AND stato='in_attesa' AND pairing_expires_at>now() RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Codice scaduto o non valido' USING ERRCODE='22023'; END IF;
  INSERT INTO public.mirox_monitor_audit(dispositivo_id,azione) VALUES(v_id,'associa');
  RETURN v_id;
END $$;

CREATE FUNCTION public.mirox_monitor_limita(p_chiave text)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_n integer;
BEGIN
  IF p_chiave IS NULL OR p_chiave !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  DELETE FROM public.mirox_monitor_rate WHERE finestra<now()-interval '1 day';
  IF NOT EXISTS (SELECT 1 FROM public.mirox_monitor_rate WHERE chiave=p_chiave)
    AND (SELECT count(*) FROM public.mirox_monitor_rate)>=10000 THEN RETURN false; END IF;
  INSERT INTO public.mirox_monitor_rate AS r(chiave,finestra,tentativi) VALUES(p_chiave,now(),1)
    ON CONFLICT(chiave) DO UPDATE SET
      finestra=CASE WHEN r.finestra<now()-interval '15 minutes' THEN now() ELSE r.finestra END,
      tentativi=CASE WHEN r.finestra<now()-interval '15 minutes' THEN 1 ELSE least(r.tentativi+1,21) END
    RETURNING tentativi INTO v_n;
  RETURN v_n<=20;
END $$;
REVOKE ALL ON FUNCTION public.mirox_monitor_amministra(uuid,text,uuid,text,text),public.mirox_monitor_associa(text,text),public.mirox_monitor_limita(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mirox_monitor_amministra(uuid,text,uuid,text,text),public.mirox_monitor_associa(text,text),public.mirox_monitor_limita(text) TO service_role;
COMMIT;
