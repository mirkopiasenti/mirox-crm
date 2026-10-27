-- Additivo, server-only. Nessuna tabella, RPC o policy condivisa col CC modificata.
BEGIN;
CREATE TABLE public.vendita_verifica_config (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 modalita text NOT NULL DEFAULT 'collaudo' CHECK(modalita IN ('spenta','collaudo','attiva')),
 updated_by uuid,
 updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.vendita_verifica_config(id) VALUES(true);
CREATE TABLE public.vendita_verifiche (
 contratto_id uuid PRIMARY KEY REFERENCES public.vendita_contratti(id) ON DELETE CASCADE,
 esito text NOT NULL DEFAULT 'da_controllare' CHECK(esito IN ('da_controllare','da_verificare','in_attesa_csv','controllato')),
 revisione bigint NOT NULL DEFAULT 0,
 prossimo_at timestamptz NOT NULL,
 primo_turno_at timestamptz NOT NULL,
 primo_tentativo_at timestamptz,
 ultimo_tentativo_at timestamptz,
 stato_job text NOT NULL DEFAULT 'in_coda' CHECK(stato_job IN ('in_coda','in_corso','fermo','errore')),
 modalita_job text NOT NULL DEFAULT 'automatica' CHECK(modalita_job IN ('automatica','collaudo')),
 lock_token uuid,
 lock_until timestamptz,
 tentativi integer NOT NULL DEFAULT 0,
 data_firma date,
 data_firma_da uuid,
 data_firma_at timestamptz,
 motivi jsonb NOT NULL DEFAULT '[]',
 risultato jsonb,
 errore_codice text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendita_verifiche_coda ON public.vendita_verifiche(prossimo_at) WHERE stato_job IN ('in_coda','in_corso','errore');
CREATE TABLE public.vendita_verifica_csv (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 nome_file text NOT NULL,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 testo text NOT NULL CHECK(octet_length(testo)<=4194304),
 righe jsonb NOT NULL CHECK(jsonb_typeof(righe)='array'),
 uploaded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vendita_verifica_esecuzioni (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contratto_id uuid NOT NULL REFERENCES public.vendita_contratti(id) ON DELETE CASCADE,
 revisione bigint NOT NULL,
 modalita text NOT NULL,
 esito text NOT NULL,
 risultato jsonb NOT NULL,
 impronta text NOT NULL,
 documenti jsonb NOT NULL,
 modello text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.vendita_verifica_documenti (
 documento_id uuid NOT NULL REFERENCES public.vendita_documenti(id) ON DELETE CASCADE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 versione text NOT NULL,
 lettura jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(documento_id,sha256,versione)
);
CREATE TABLE public.vendita_verifica_notifiche (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 contratto_id uuid NOT NULL REFERENCES public.vendita_contratti(id) ON DELETE CASCADE,
 dedupe_key text NOT NULL UNIQUE,
 tipo text NOT NULL CHECK(tipo IN ('problemi','reload')),
 destinatario text NOT NULL,
 payload jsonb NOT NULL,
 stato text NOT NULL DEFAULT 'in_coda' CHECK(stato IN ('in_coda','in_corso','inviata','incerta','fallita','superata')),
 tentativi integer NOT NULL DEFAULT 0,
 prossimo_at timestamptz NOT NULL DEFAULT now(),
 lock_token uuid,
 gestita_da uuid,
 gestita_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendita_verifica_notifiche_coda ON public.vendita_verifica_notifiche(prossimo_at) WHERE stato='in_coda';
ALTER TABLE public.vendita_verifica_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_verifiche ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_verifica_csv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_verifica_esecuzioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_verifica_documenti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_verifica_notifiche ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendita_verifica_config,public.vendita_verifiche,public.vendita_verifica_csv,public.vendita_verifica_esecuzioni,public.vendita_verifica_documenti,public.vendita_verifica_notifiche FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.vendita_verifica_config,public.vendita_verifiche,public.vendita_verifica_csv,public.vendita_verifica_esecuzioni,public.vendita_verifica_documenti,public.vendita_verifica_notifiche TO service_role;

CREATE FUNCTION public.vendita_verifica_sync() RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.vendita_verifiche(contratto_id,prossimo_at,primo_turno_at)
 SELECT c.id,due.at,due.at
 FROM public.vendita_contratti c JOIN public.vendita_pratiche p ON p.id=c.pratica_id
 CROSS JOIN LATERAL (SELECT ((date_trunc('day',now() AT TIME ZONE 'Europe/Rome')
   + interval '21 hours' + CASE WHEN (now() AT TIME ZONE 'Europe/Rome')::time >= time '21:00' THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Europe/Rome')
 AS at) due
 WHERE p.stato_pratica='inviata' AND c.stato_controllo='da_controllare'
 ON CONFLICT(contratto_id) DO NOTHING;
 -- Read-only comparison of the shared customer; no trigger or write on anagrafica.
 UPDATE public.vendita_verifiche v SET revisione=v.revisione+1,prossimo_at=now(),stato_job='in_coda',tentativi=0
 FROM public.vendita_contratti c,public.anagrafica a WHERE c.id=v.contratto_id AND a.id=c.anagrafica_id
 AND c.stato_controllo='da_controllare' AND v.primo_tentativo_at IS NOT NULL AND v.stato_job='fermo'
 AND v.risultato ? 'source_customer_updated_at'
 AND (v.risultato->>'source_customer_updated_at')::timestamptz IS DISTINCT FROM a.updated_at;
$$;

CREATE FUNCTION public.vendita_verifica_invalida() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 IF current_setting('mirox.verifica_commit',true)='yes' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='vendita_contratti' THEN
   v_id:=NEW.id;
   -- Ignore a no-op save. Changes of attribution/totals alone do not change documentary evidence.
   IF (to_jsonb(NEW)-ARRAY['updated_at','updated_by','controllato_da','controllato_at'])
       IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['updated_at','updated_by','controllato_da','controllato_at']) THEN RETURN NULL; END IF;
 ELSE
   v_id:=CASE WHEN TG_OP='DELETE' THEN OLD.contratto_id ELSE NEW.contratto_id END;
 END IF;
 UPDATE public.vendita_verifiche SET revisione=revisione+1,
   esito=CASE WHEN TG_TABLE_NAME='vendita_contratti' AND esito='controllato' THEN 'da_controllare' ELSE esito END,
   stato_job=CASE WHEN primo_tentativo_at IS NOT NULL THEN 'in_coda' ELSE stato_job END,
   prossimo_at=CASE WHEN primo_tentativo_at IS NOT NULL THEN now() ELSE prossimo_at END,
   lock_token=NULL,lock_until=NULL,tentativi=0,errore_codice=NULL,updated_at=now()
 WHERE contratto_id=v_id AND (esito<>'controllato' OR EXISTS(SELECT 1 FROM public.vendita_contratti WHERE id=v_id AND stato_controllo='da_controllare'));
 RETURN NULL;
END $$;
CREATE TRIGGER trg_verifica_contratto_invalida AFTER UPDATE ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.vendita_verifica_invalida();
CREATE TRIGGER trg_verifica_documento_invalida AFTER INSERT OR UPDATE OR DELETE ON public.vendita_documenti FOR EACH ROW EXECUTE FUNCTION public.vendita_verifica_invalida();

CREATE FUNCTION public.vendita_verifica_pratica_inviata() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE due timestamptz;
BEGIN
 IF NEW.stato_pratica='inviata' AND OLD.stato_pratica IS DISTINCT FROM 'inviata' THEN
  due:=((date_trunc('day',now() AT TIME ZONE 'Europe/Rome')+interval '21 hours'
    + CASE WHEN (now() AT TIME ZONE 'Europe/Rome')::time>=time '21:00' THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE 'Europe/Rome');
  INSERT INTO public.vendita_verifiche(contratto_id,prossimo_at,primo_turno_at)
  SELECT id,due,due FROM public.vendita_contratti WHERE pratica_id=NEW.id AND stato_controllo='da_controllare'
  ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER trg_verifica_pratica_inviata AFTER UPDATE OF stato_pratica ON public.vendita_pratiche FOR EACH ROW EXECUTE FUNCTION public.vendita_verifica_pratica_inviata();

CREATE FUNCTION public.vendita_verifica_claim(p_id uuid DEFAULT NULL, p_test boolean DEFAULT false) RETURNS SETOF public.vendita_verifiche
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v public.vendita_verifiche; mode text;
BEGIN
 SELECT modalita INTO mode FROM public.vendita_verifica_config WHERE id FOR UPDATE;
 IF p_test IS NULL OR mode IS NULL OR mode='spenta' OR (NOT p_test AND mode<>'attiva') THEN RETURN; END IF;
 IF (SELECT count(*) FROM public.vendita_verifiche WHERE stato_job='in_corso' AND lock_until>now())>=2 THEN RETURN; END IF;
 SELECT q.* INTO v FROM public.vendita_verifiche q JOIN public.vendita_contratti c ON c.id=q.contratto_id
 JOIN public.vendita_pratiche p ON p.id=c.pratica_id
 WHERE (p_id IS NULL OR q.contratto_id=p_id) AND p.stato_pratica='inviata' AND c.stato_controllo='da_controllare'
 AND q.stato_job IN ('in_coda','errore','in_corso') AND q.prossimo_at<=now()
 AND (q.lock_until IS NULL OR q.lock_until<now()) AND q.tentativi<5
 AND (NOT p_test OR q.modalita_job='collaudo')
 AND (p_test OR q.modalita_job='automatica')
 ORDER BY q.prossimo_at FOR UPDATE OF q SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.vendita_verifiche SET lock_token=gen_random_uuid(),lock_until=now()+interval '12 minutes',
  stato_job='in_corso',primo_tentativo_at=CASE WHEN p_test THEN primo_tentativo_at ELSE coalesce(primo_tentativo_at,now()) END,ultimo_tentativo_at=now(),
  modalita_job=CASE WHEN p_test THEN 'collaudo' ELSE 'automatica' END,tentativi=tentativi+1,updated_at=now()
 WHERE contratto_id=v.contratto_id RETURNING * INTO v;
 RETURN NEXT v;
END $$;

CREATE FUNCTION public.vendita_verifica_concludi(p_id uuid,p_token uuid,p_revision bigint,p_updated timestamptz,
 p_customer jsonb,p_result jsonb,p_fingerprint text,p_docs jsonb,p_model text,p_test boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c public.vendita_contratti; v public.vendita_verifiche; a jsonb; patch jsonb; mode text; outcome text;
BEGIN
 PERFORM pg_advisory_xact_lock(728423101);
 SELECT * INTO c FROM public.vendita_contratti WHERE id=p_id FOR UPDATE;
 SELECT * INTO v FROM public.vendita_verifiche WHERE contratto_id=p_id FOR UPDATE;
 SELECT modalita INTO mode FROM public.vendita_verifica_config WHERE id FOR SHARE;
 IF c.id IS NULL OR c.stato_controllo<>'da_controllare' OR c.updated_at IS DISTINCT FROM p_updated
 OR v.lock_token IS DISTINCT FROM p_token OR v.revisione<>p_revision OR v.lock_until<now()
 OR p_test IS NULL OR mode IS NULL OR mode='spenta' OR (NOT p_test AND mode<>'attiva') THEN RETURN false; END IF;
 SELECT jsonb_build_object('id',id,'cf_piva',cf_piva,'cluster',cluster,'ragione_sociale',ragione_sociale,'nome_referente',nome_referente,'updated_at',updated_at)
 INTO a FROM public.anagrafica WHERE id=c.anagrafica_id FOR SHARE;
 IF (a-'updated_at') IS DISTINCT FROM (p_customer-'updated_at')
 OR (a->>'updated_at')::timestamptz IS DISTINCT FROM (p_customer->>'updated_at')::timestamptz THEN
  UPDATE public.vendita_verifiche SET lock_token=NULL,lock_until=NULL,stato_job='in_coda',prossimo_at=now(),revisione=revisione+1 WHERE contratto_id=p_id;
  RETURN false;
 END IF;
 outcome:=p_result->>'esito'; patch:=p_result->'patch';
 IF outcome IS NULL OR outcome NOT IN ('controllato','da_verificare','in_attesa_csv') OR jsonb_typeof(patch) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Esito non valido'; END IF;
 INSERT INTO public.vendita_verifica_esecuzioni(contratto_id,revisione,modalita,esito,risultato,impronta,documenti,modello)
 VALUES(p_id,p_revision,CASE WHEN p_test THEN 'collaudo' ELSE 'automatica' END,outcome,p_result,p_fingerprint,p_docs,p_model);
 IF NOT p_test AND outcome='controllato' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(patch) k WHERE k NOT IN ('codice_contratto','numero_contratto_energia','ex_fornitore',
    'costo_offerta_mensile','portabilita','numero_telefono','numero_provvisorio','numero_mnp','operatore_provenienza','tipo_attivazione','imei','fascia_prezzo','tipo_acquisto')) THEN RAISE EXCEPTION 'Correzione non ammessa'; END IF;
  PERFORM set_config('mirox.verifica_commit','yes',true);
  UPDATE public.vendita_contratti SET
   codice_contratto=coalesce(codice_contratto,patch->>'codice_contratto'),
   numero_contratto_energia=coalesce(nullif(trim(numero_contratto_energia),''),patch->>'numero_contratto_energia'),
   ex_fornitore=coalesce(nullif(trim(ex_fornitore),''),patch->>'ex_fornitore'),
   costo_offerta_mensile=coalesce(costo_offerta_mensile,(patch->>'costo_offerta_mensile')::numeric),
   portabilita=coalesce(portabilita,(patch->>'portabilita')::boolean),
   numero_telefono=coalesce(nullif(trim(numero_telefono),''),patch->>'numero_telefono'),
   numero_provvisorio=coalesce(nullif(trim(numero_provvisorio),''),patch->>'numero_provvisorio'),
   numero_mnp=coalesce(nullif(trim(numero_mnp),''),patch->>'numero_mnp'),
   operatore_provenienza=coalesce(nullif(trim(operatore_provenienza),''),patch->>'operatore_provenienza'),
   tipo_attivazione=coalesce(nullif(trim(tipo_attivazione),''),patch->>'tipo_attivazione'),
   imei=coalesce(nullif(trim(imei),''),patch->>'imei'),
   fascia_prezzo=coalesce(nullif(trim(fascia_prezzo),''),patch->>'fascia_prezzo'),
   tipo_acquisto=coalesce(nullif(trim(tipo_acquisto),''),patch->>'tipo_acquisto'),
   stato_controllo='controllato',controllato_da=NULL,controllato_at=now(),updated_by=NULL,
   note_controllo='Verifica automatica documentale '||(p_result->>'version')
  WHERE id=p_id;
  PERFORM set_config('mirox.verifica_commit','no',true);
 END IF;
 UPDATE public.vendita_verifiche SET esito=CASE WHEN p_test THEN esito ELSE outcome END,
  risultato=p_result,motivi=coalesce(p_result->'errors','[]')||coalesce(p_result->'waiting','[]'),
  lock_token=NULL,lock_until=NULL,stato_job=CASE WHEN p_test THEN 'in_coda' ELSE 'fermo' END,
  modalita_job='automatica',prossimo_at=CASE WHEN p_test THEN greatest(primo_turno_at,now()) ELSE prossimo_at END,
  tentativi=CASE WHEN p_test THEN 0 ELSE tentativi END,errore_codice=NULL,updated_at=now() WHERE contratto_id=p_id;
 IF NOT p_test AND outcome='da_verificare' THEN
  INSERT INTO public.vendita_verifica_notifiche(contratto_id,dedupe_key,tipo,destinatario,payload)
  VALUES(p_id,p_id::text||':problemi:'||md5((p_result->'errors')::text),'problemi','mirko.piasenti@mail.com',
    jsonb_build_object('cliente',a->>'ragione_sociale','motivi',p_result->'errors','revision',p_revision)) ON CONFLICT DO NOTHING;
 ELSIF NOT p_test AND outcome='controllato' AND p_result->>'notify_reload'='true' THEN
  INSERT INTO public.vendita_verifica_notifiche(contratto_id,dedupe_key,tipo,destinatario,payload)
  VALUES(p_id,p_id::text||':reload','reload','info@konatech.it',jsonb_build_object('cliente',a->>'ragione_sociale','revision',p_revision)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN true;
END $$;

CREATE FUNCTION public.vendita_verifica_import_csv(p_name text,p_hash text,p_text text,p_rows jsonb,p_user uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_id uuid;
BEGIN
 -- Serializes import vs completion so a superseded CSV cannot be approved silently.
 PERFORM pg_advisory_xact_lock(728423101);
 INSERT INTO public.vendita_verifica_csv(nome_file,sha256,testo,righe,uploaded_by) VALUES(p_name,p_hash,p_text,p_rows,p_user) RETURNING id INTO v_id;
 UPDATE public.vendita_verifiche q SET revisione=revisione+1,prossimo_at=now(),stato_job='in_coda',lock_token=NULL,lock_until=NULL,tentativi=0,updated_at=now()
 FROM public.vendita_contratti c WHERE c.id=q.contratto_id AND c.categoria_snapshot='Energia' AND c.stato_controllo='da_controllare'
 AND q.primo_tentativo_at IS NOT NULL AND q.esito<>'controllato';
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.vendita_verifica_sync(), public.vendita_verifica_invalida(), public.vendita_verifica_claim(uuid,boolean),
 public.vendita_verifica_concludi(uuid,uuid,bigint,timestamptz,jsonb,jsonb,text,jsonb,text,boolean),public.vendita_verifica_import_csv(text,text,text,jsonb,uuid),public.vendita_verifica_pratica_inviata() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_verifica_sync(),public.vendita_verifica_invalida(),public.vendita_verifica_claim(uuid,boolean),
 public.vendita_verifica_concludi(uuid,uuid,bigint,timestamptz,jsonb,jsonb,text,jsonb,text,boolean),public.vendita_verifica_import_csv(text,text,text,jsonb,uuid),public.vendita_verifica_pratica_inviata() TO service_role;
SELECT public.vendita_verifica_sync();
COMMIT;
