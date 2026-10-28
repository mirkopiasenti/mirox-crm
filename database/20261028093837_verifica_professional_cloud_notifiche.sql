-- Promemoria Professional Cloud dopo verifica automatica positiva.
-- Nessun backfill, cambio modalita o invio; grant/RLS/RPC CC invariati.
BEGIN;
ALTER TABLE public.vendita_verifica_notifiche
 ADD CONSTRAINT vendita_verifica_notifiche_tipo_cloud_check
 CHECK (tipo IN ('problemi','reload','professional_cloud'));
ALTER TABLE public.vendita_verifica_notifiche
 DROP CONSTRAINT vendita_verifica_notifiche_tipo_check;

CREATE OR REPLACE FUNCTION public.vendita_verifica_concludi(p_id uuid,p_token uuid,p_revision bigint,p_updated timestamptz,
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
 IF NOT p_test AND outcome='controllato'
 AND c.categoria_snapshot IN ('Mobile','Fisso') AND c.cluster_cliente='Business'
 AND c.professional_cloud IS TRUE AND c.professional_cloud_gestione='Richiedi disattivazione' THEN
  INSERT INTO public.vendita_verifica_notifiche(contratto_id,dedupe_key,tipo,destinatario,payload)
  VALUES(p_id,p_id::text||':professional_cloud','professional_cloud','mirko.piasenti@gmail.com',
    jsonb_build_object('cliente',a->>'ragione_sociale','revision',p_revision)) ON CONFLICT DO NOTHING;
 END IF;
 RETURN true;
END $$;

COMMIT;
