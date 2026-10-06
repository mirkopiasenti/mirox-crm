BEGIN;
-- Only two configuration tables; no dynamic SQL, DDL, DELETE, customer or CC writes.
CREATE OR REPLACE FUNCTION public.guardian_catalog_apply_v1(p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE item jsonb; prior jsonb; current_name text; new_id bigint;
  offer_ids jsonb := '[]'; row_ids jsonb := '[]'; updated_ids jsonb := '[]';
BEGIN
  IF p_plan->>'version' IS DISTINCT FROM '1' OR (p_plan - ARRAY['version','offers','daily_rows','daily_updates']) <> '{}'::jsonb
    OR jsonb_typeof(p_plan->'offers') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_plan->'daily_rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_plan->'daily_updates') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'offers')>10 OR jsonb_array_length(p_plan->'daily_rows')>10
    OR jsonb_array_length(p_plan->'daily_updates')>10
    OR jsonb_array_length(p_plan->'offers')+jsonb_array_length(p_plan->'daily_rows')+jsonb_array_length(p_plan->'daily_updates')=0
  THEN RAISE EXCEPTION 'Piano catalogo non valido'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'offers') LOOP
    IF NOT (item ?& ARRAY['id','categoria_id','cluster_cliente','nome_offerta','punteggio_gara','punteggio_extra_gara','abilita_dispositivo','abilita_switch_sim'])
      OR (item - ARRAY['id','categoria_id','cluster_cliente','nome_offerta','descrizione','punteggio_gara','punteggio_extra_gara','abilita_dispositivo','abilita_switch_sim']) <> '{}'::jsonb
      OR item->>'cluster_cliente' NOT IN ('Consumer','Business','Turista')
      OR length(coalesce(item->>'nome_offerta','')) NOT BETWEEN 3 AND 180
      OR length(coalesce(item->>'descrizione',''))>1000
      OR jsonb_typeof(item->'punteggio_gara') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'punteggio_extra_gara') IS DISTINCT FROM 'number'
      OR jsonb_typeof(item->'abilita_dispositivo') IS DISTINCT FROM 'boolean'
      OR jsonb_typeof(item->'abilita_switch_sim') IS DISTINCT FROM 'boolean'
      OR (item->>'punteggio_gara')::numeric NOT BETWEEN 0 AND 1000
      OR (item->>'punteggio_extra_gara')::numeric NOT BETWEEN 0 AND 1000
    THEN RAISE EXCEPTION 'Offerta nel piano non valida'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vendita_categorie WHERE id=(item->>'categoria_id')::uuid AND attiva)
      OR EXISTS(SELECT 1 FROM public.vendita_offerte WHERE id=(item->>'id')::uuid OR
        (categoria_id=(item->>'categoria_id')::uuid AND cluster_cliente=item->>'cluster_cliente' AND nome_offerta=item->>'nome_offerta'))
    THEN RAISE EXCEPTION 'Categoria assente o offerta gia esistente'; END IF;
    INSERT INTO public.vendita_offerte(id,categoria_id,cluster_cliente,nome_offerta,descrizione,punteggio_gara,punteggio_extra_gara,abilita_dispositivo,abilita_switch_sim,attiva)
    VALUES((item->>'id')::uuid,(item->>'categoria_id')::uuid,item->>'cluster_cliente',item->>'nome_offerta',item->>'descrizione',
      (item->>'punteggio_gara')::numeric,(item->>'punteggio_extra_gara')::numeric,(item->>'abilita_dispositivo')::boolean,(item->>'abilita_switch_sim')::boolean,true);
    offer_ids := offer_ids || jsonb_build_array(item->>'id');
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'daily_updates') ORDER BY (value->>'id')::bigint LOOP
    IF NOT (item ?& ARRAY['id','expected_name','expected_rule','rule']) OR
      (item - ARRAY['id','expected_name','expected_rule','rule']) <> '{}'::jsonb OR
      jsonb_typeof(item->'expected_rule') IS DISTINCT FROM 'object' OR jsonb_typeof(item->'rule') IS DISTINCT FROM 'object'
      OR octet_length((item->'rule')::text)>4000 THEN RAISE EXCEPTION 'Aggiornamento riga non valido'; END IF;
    SELECT regola,nome INTO prior,current_name FROM public.dashboard_righe_giornaliera WHERE id=(item->>'id')::bigint FOR UPDATE;
    IF NOT FOUND OR prior IS DISTINCT FROM item->'expected_rule' OR current_name IS DISTINCT FROM item->>'expected_name'
    THEN RAISE EXCEPTION 'Configurazione giornaliera cambiata dopo la revisione'; END IF;
    UPDATE public.dashboard_righe_giornaliera SET regola=item->'rule' WHERE id=(item->>'id')::bigint;
    updated_ids := updated_ids || jsonb_build_array((item->>'id')::bigint);
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'daily_rows') LOOP
    IF NOT (item ?& ARRAY['name','group','color','order','rule']) OR
      (item - ARRAY['name','group','color','order','rule']) <> '{}'::jsonb OR
      length(coalesce(item->>'name','')) NOT BETWEEN 3 AND 180 OR length(coalesce(item->>'group','')) NOT BETWEEN 3 AND 100 OR
      coalesce(item->>'color','') !~ '^#[0-9A-Fa-f]{6}$' OR jsonb_typeof(item->'rule') IS DISTINCT FROM 'object'
      OR octet_length((item->'rule')::text)>4000 OR jsonb_typeof(item->'order') IS DISTINCT FROM 'number' OR (item->>'order')::integer NOT BETWEEN 0 AND 100000
    THEN RAISE EXCEPTION 'Nuova riga giornaliera non valida'; END IF;
    IF EXISTS(SELECT 1 FROM public.dashboard_righe_giornaliera WHERE nome=item->>'name' AND gruppo=item->>'group')
    THEN RAISE EXCEPTION 'Riga giornaliera gia esistente'; END IF;
    INSERT INTO public.dashboard_righe_giornaliera(nome,gruppo,colore_hex,ordine,regola,attiva)
    VALUES(item->>'name',item->>'group',item->>'color',(item->>'order')::integer,item->'rule',true) RETURNING id INTO new_id;
    row_ids := row_ids || jsonb_build_array(new_id);
  END LOOP;
  RETURN jsonb_build_object('offers',offer_ids,'daily_rows',row_ids,'daily_updates',updated_ids);
END $fn$;
REVOKE ALL ON FUNCTION public.guardian_catalog_apply_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.guardian_apply_reviewed_catalog(p_execution_id uuid,p_lease_token text,p_head_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '10s' AS $fn$
DECLARE execution public.kona_ai_esecuzioni%ROWTYPE; approval public.kona_ai_approvazioni%ROWTYPE;
  patch public.kona_ai_esecuzioni%ROWTYPE; source public.kona_ai_approvazioni%ROWTYPE;
  contract jsonb; reference jsonb; review jsonb; plan jsonb; outcome jsonb; tested public.kona_ai_esecuzioni%ROWTYPE;
BEGIN
  SELECT * INTO execution FROM public.kona_ai_esecuzioni WHERE id=p_execution_id FOR UPDATE;
  IF p_lease_token IS NULL OR p_lease_token !~ '^[a-f0-9]{64}$' OR p_head_sha IS NULL OR p_head_sha !~ '^[a-f0-9]{40}$'
    OR NOT FOUND OR execution.tipo_esecuzione <> 'rilascio_produzione' OR execution.stato <> 'in_esecuzione'
    OR execution.lease_expires_at IS NULL OR execution.lease_expires_at <= now()
    OR execution.lease_token_hash IS DISTINCT FROM encode(extensions.digest(p_lease_token,'sha256'),'hex')
  THEN RAISE EXCEPTION 'Lease rilascio assente o scaduto'; END IF;
  SELECT * INTO approval FROM public.kona_ai_approvazioni WHERE id=execution.approvazione_id FOR UPDATE;
  IF NOT FOUND OR approval.azione <> 'rilascia_produzione' OR approval.stato <> 'approvata'
    OR approval.decisa_at IS NULL OR approval.scade_at IS NULL OR approval.scade_at <= now()
    OR approval.decisa_da_profile_id IS NULL OR approval.decisa_da_telegram_chat_id IS NULL
    OR approval.incidente_id IS DISTINCT FROM execution.incidente_id
  THEN RAISE EXCEPTION 'Conferma finale catalogo assente o scaduta'; END IF;
  PERFORM 1 FROM public.kona_ai_incidenti WHERE id=execution.incidente_id AND stato IN ('ricevuto','in_analisi','in_attesa_approvazione','fix_approvato','in_lavorazione','in_test') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Richiesta catalogo chiusa'; END IF;
  contract := approval.risultato->'release_contract'; reference := contract->'catalog_plan';
  IF reference IS NULL OR contract->>'head_sha' IS DISTINCT FROM p_head_sha
    OR execution.base_commit_sha IS DISTINCT FROM p_head_sha OR reference->>'head_sha' IS DISTINCT FROM p_head_sha
  THEN RAISE EXCEPTION 'Piano non legato alla versione approvata'; END IF;
  SELECT * INTO tested FROM public.kona_ai_esecuzioni WHERE id=(contract->>'test_execution_id')::uuid;
  IF NOT FOUND OR tested.stato <> 'completata' OR tested.tipo_esecuzione <> 'test_staging'
    OR tested.result_commit_sha IS DISTINCT FROM p_head_sha OR tested.incidente_id IS DISTINCT FROM execution.incidente_id
    OR tested.risultato->>'tests' IS DISTINCT FROM 'success' OR tested.risultato->>'install' IS DISTINCT FROM 'success'
    OR tested.risultato->>'smoke' IS DISTINCT FROM 'success' OR tested.risultato->>'tested_base_sha' IS DISTINCT FROM contract->>'base_sha'
  THEN RAISE EXCEPTION 'Test del piano approvato assenti'; END IF;
  SELECT * INTO patch FROM public.kona_ai_esecuzioni WHERE id=(reference->>'patch_execution_id')::uuid;
  SELECT * INTO source FROM public.kona_ai_approvazioni WHERE id=patch.approvazione_id FOR SHARE;
  review := source.risultato->'catalog_review';
  IF reference->>'hash' IS NULL OR reference->>'hash' !~ '^[a-f0-9]{64}$' OR source.azione IS DISTINCT FROM 'prepara_fix'
    OR source.stato NOT IN ('approvata','eseguita') OR patch.incidente_id IS DISTINCT FROM execution.incidente_id OR source.incidente_id IS DISTINCT FROM execution.incidente_id
    OR source.id::text IS DISTINCT FROM reference->>'patch_approval_id'
    OR source.decisa_da_profile_id IS DISTINCT FROM approval.decisa_da_profile_id
    OR source.decisa_da_telegram_chat_id IS DISTINCT FROM approval.decisa_da_telegram_chat_id
    OR review->>'reviewed_by' IS DISTINCT FROM 'codex_local' OR review->>'head_sha' IS DISTINCT FROM p_head_sha
    OR review->>'hash' IS DISTINCT FROM reference->>'hash'
    OR encode(extensions.digest(review->>'plan_json','sha256'),'hex') IS DISTINCT FROM reference->>'hash'
    OR octet_length(review->>'plan_json')>40000
  THEN RAISE EXCEPTION 'Revisione catalogo assente o cambiata'; END IF;
  IF approval.risultato->'catalog_applied'->>'hash'=reference->>'hash' THEN
    RETURN approval.risultato->'catalog_applied';
  END IF;
  plan := (review->>'plan_json')::jsonb;
  outcome := public.guardian_catalog_apply_v1(plan);
  outcome := outcome || jsonb_build_object('hash',reference->>'hash','head_sha',p_head_sha,'applied_at',now(),'ok',true);
  UPDATE public.kona_ai_approvazioni SET risultato=risultato || jsonb_build_object('catalog_applied',outcome) WHERE id=approval.id;
  RETURN outcome;
END $fn$;
REVOKE ALL ON FUNCTION public.guardian_apply_reviewed_catalog(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guardian_apply_reviewed_catalog(uuid,text,text) TO service_role;
COMMENT ON FUNCTION public.guardian_apply_reviewed_catalog(uuid,text,text) IS 'Solo catalogo revisionato e consenso finale Telegram: lease/SHA/test/precondizioni, transazione atomica e checkpoint. Nessun SQL libero o tabelle CC.';
NOTIFY pgrst,'reload schema';
COMMIT;
