'use strict';
const fs=require('node:fs'),path=require('node:path');
const dir=path.resolve('.backup-private/fisso-20261117');
const plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'),'utf8'));
const before=JSON.parse(fs.readFileSync(path.join(dir,'before.json'),'utf8'));
const literal=value=>"'"+JSON.stringify(value).replace(/'/g,"''")+"'::jsonb";
if(!plan.length || plan.length!==before.contracts.length || new Set(plan.map(p=>p.id)).size!==plan.length)throw new Error('Piano incompleto o duplicato');
for(const p of plan){
 if(!before.contracts.some(c=>c.id===p.id && c.updated_at===p.expected_updated_at))throw new Error('Versione sorgente non valida');
 if(Object.keys(p.patch).some(k=>!['tecnologia_fisso','professional_box','codice_cliente_fisso','codice_pos_fisso','codice_contratto'].includes(k)))throw new Error('Campo non consentito');
}
const sql=`BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
LOCK TABLE public.vendita_contratti IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.post_vendita_controllo_fissi IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE _fisso_plan ON COMMIT DROP AS SELECT x.* FROM jsonb_to_recordset(${literal(plan.map(({id,expected_updated_at,patch})=>({id,expected_updated_at,patch})))}) AS x(id uuid,expected_updated_at timestamptz,patch jsonb);
CREATE TEMP TABLE _fisso_source ON COMMIT DROP AS SELECT x.* FROM jsonb_to_recordset(${literal(before.documents)}) AS x(id uuid,contratto_id uuid,pratica_id uuid,anagrafica_id uuid,tipo_documento text,storage_bucket text,storage_path text,file_name text,mime_type text,file_size bigint,uploaded_at timestamptz,uploaded_by uuid,sha256 text);
DO $$ BEGIN
 IF (SELECT count(*) FROM _fisso_plan)<>${plan.length} OR EXISTS(SELECT 1 FROM _fisso_plan p LEFT JOIN public.vendita_contratti c ON c.id=p.id WHERE c.id IS NULL OR c.categoria_snapshot<>'Fisso' OR c.updated_at IS DISTINCT FROM p.expected_updated_at) THEN RAISE EXCEPTION 'Piano obsoleto: rileggere i contratti'; END IF;
 IF EXISTS(SELECT 1 FROM _fisso_source s LEFT JOIN public.vendita_documenti d ON d.id=s.id WHERE d.id IS NULL OR ROW(d.contratto_id,d.storage_bucket,d.storage_path,d.sha256,d.file_size,d.uploaded_at) IS DISTINCT FROM ROW(s.contratto_id,s.storage_bucket,s.storage_path,s.sha256,s.file_size,s.uploaded_at)) THEN RAISE EXCEPTION 'Documenti sorgente modificati'; END IF;
 IF EXISTS(SELECT 1 FROM public.vendita_documenti d JOIN _fisso_plan p ON p.id=d.contratto_id WHERE d.tipo_documento='contratto' AND NOT EXISTS(SELECT 1 FROM _fisso_source s WHERE s.id=d.id)) THEN RAISE EXCEPTION 'Nuove PDA dopo il piano'; END IF;
END $$;
CREATE TEMP TABLE _fisso_before_contract ON COMMIT DROP AS SELECT c.id,c.codice_contratto,to_jsonb(c)-ARRAY['tecnologia_fisso','professional_box','codice_cliente_fisso','codice_pos_fisso','codice_contratto','updated_at'] AS value FROM public.vendita_contratti c;
CREATE TEMP TABLE _fisso_before_post ON COMMIT DROP AS SELECT f.id,to_jsonb(f)-ARRAY['codice_cliente','tecnologia','cod_contratto','cod_pos','updated_at'] AS value FROM public.post_vendita_controllo_fissi f;
CREATE TEMP TABLE _fisso_before_other(name text PRIMARY KEY,value text) ON COMMIT DROP;
DO $$ DECLARE t text;v text;BEGIN
 FOREACH t IN ARRAY ARRAY['anagrafica','profili','vendita_pratiche','vendita_documenti','vendita_offerte','vendita_opzioni','vendita_verifiche','vendita_verifica_documenti','vendita_verifica_esecuzioni','vendita_verifica_notifiche','vendita_stati_verifica_manuale','vendita_log_modifiche','anagrafica_codici_cliente_windtre'] LOOP
 EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'''') ) FROM public.%I x',t) INTO v;
 INSERT INTO _fisso_before_other VALUES(t,v);
 END LOOP;
END $$;
SELECT set_config('mirox.verifica_commit','yes',true);
DO $$ DECLARE n integer;BEGIN
 UPDATE public.vendita_contratti c SET
 tecnologia_fisso=p.patch->>'tecnologia_fisso',professional_box=(p.patch->>'professional_box')::boolean,
 codice_cliente_fisso=p.patch->>'codice_cliente_fisso',codice_pos_fisso='9001415852',
 codice_contratto=CASE WHEN c.codice_contratto IS NULL THEN COALESCE(p.patch->>'codice_contratto',c.codice_contratto) ELSE c.codice_contratto END
 FROM _fisso_plan p WHERE c.id=p.id AND c.updated_at=p.expected_updated_at;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>${plan.length} THEN RAISE EXCEPTION 'Numero aggiornamenti inatteso: %',n;END IF;
END $$;
DO $$ DECLARE r record;v text;BEGIN
 IF EXISTS(SELECT 1 FROM _fisso_before_contract b FULL JOIN public.vendita_contratti c ON c.id=b.id WHERE b.id IS NULL OR c.id IS NULL OR b.value IS DISTINCT FROM to_jsonb(c)-ARRAY['tecnologia_fisso','professional_box','codice_cliente_fisso','codice_pos_fisso','codice_contratto','updated_at'] OR (b.codice_contratto IS NOT NULL AND b.codice_contratto IS DISTINCT FROM c.codice_contratto)) THEN RAISE EXCEPTION 'Stati, punti o dati contratto estranei modificati';END IF;
 IF EXISTS(SELECT 1 FROM _fisso_before_post b FULL JOIN public.post_vendita_controllo_fissi f ON f.id=b.id WHERE b.id IS NULL OR f.id IS NULL OR b.value IS DISTINCT FROM to_jsonb(f)-ARRAY['codice_cliente','tecnologia','cod_contratto','cod_pos','updated_at']) THEN RAISE EXCEPTION 'Stati, date, chat o dati postvendita estranei modificati';END IF;
 IF EXISTS(SELECT 1 FROM _fisso_plan p JOIN public.vendita_contratti c ON c.id=p.id WHERE ROW(c.tecnologia_fisso,c.professional_box,c.codice_cliente_fisso,c.codice_pos_fisso) IS DISTINCT FROM ROW(p.patch->>'tecnologia_fisso',(p.patch->>'professional_box')::boolean,p.patch->>'codice_cliente_fisso','9001415852'::text))THEN RAISE EXCEPTION 'Dati non persistiti come previsto';END IF;
 FOR r IN SELECT * FROM _fisso_before_other LOOP
 EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text)::text,'''') ) FROM public.%I x',r.name) INTO v;
 IF v IS DISTINCT FROM r.value THEN RAISE EXCEPTION 'Tabella estranea modificata: %',r.name;END IF;
 END LOOP;
END $$;
SELECT count(*) AS contratti_allineati,count(*) FILTER(WHERE tecnologia_fisso IS NOT NULL) AS tecnologie_complete,count(*) FILTER(WHERE professional_box) AS professional_box FROM public.vendita_contratti WHERE id IN(SELECT id FROM _fisso_plan);
`;
const commit=process.argv.includes('--commit');
fs.writeFileSync(path.join(dir,commit?'apply.sql':'preflight.sql'),sql+(commit?'COMMIT;':'ROLLBACK;')+'\n',{mode:0o600});
console.log(JSON.stringify({modalita:commit?'applicazione':'preflight con rollback',contratti:plan.length,codici_nuovi:plan.filter(p=>p.patch.codice_contratto).length,casi_da_verificare:plan.filter(p=>p.issues.length).length}));
