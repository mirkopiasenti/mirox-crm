'use strict';
const { PGlite } = require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
(async () => {
 const db = new PGlite(); let checks = 0;
 const check = (a,b) => { assert.deepEqual(a,b); checks++; };
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
   CREATE TABLE public.profili(id uuid PRIMARY KEY,nome text);
   INSERT INTO public.profili VALUES('10000000-0000-4000-8000-000000000001','Operatore test');
   CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
   CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   INSERT INTO storage.buckets VALUES('precedente','precedente',false,100,ARRAY['application/pdf']);
   CREATE TABLE storage.objects(id int PRIMARY KEY,bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   GRANT ALL ON storage.objects TO anon,authenticated,service_role;
   CREATE POLICY vecchia ON storage.objects FOR SELECT TO authenticated USING(bucket_id='precedente');
   INSERT INTO storage.objects VALUES(1,'precedente'),(2,'malpractis-files');`);
  const before = (await db.query('SELECT * FROM storage.buckets ORDER BY id')).rows;
  const profiles = (await db.query('SELECT * FROM public.profili')).rows;
  const policies = (await db.query('SELECT * FROM pg_policies ORDER BY policyname')).rows;
  const sql = fs.readFileSync(path.join(__dirname,'../database/20261113111030_malpractis_storico.sql'),'utf8');
  await db.exec(sql);
  check((await db.query("SELECT * FROM storage.buckets WHERE id <> 'malpractis-files' ORDER BY id")).rows, before);
  check((await db.query('SELECT * FROM public.profili')).rows,profiles);
  check((await db.query('SELECT * FROM pg_policies ORDER BY policyname')).rows, policies);
  check((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.malpractis_generati'::regclass")).rows[0].relrowsecurity,true);
  check((await db.query("SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='malpractis-files'")).rows,[{public:false,file_size_limit:5242880,allowed_mime_types:['application/pdf']}]);
  for (const role of ['anon','authenticated']) {
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(db.exec('SELECT * FROM public.malpractis_generati'),e=>e.code==='42501'); checks++;
   check((await db.query("SELECT * FROM storage.objects WHERE bucket_id='malpractis-files'")).rows,[]);
   await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE service_role');
  await db.query(`INSERT INTO public.malpractis_generati(id,intestatario,cf_piva,numero_fisso,stato_linea,dati_compilazione,richiesta_sha256,storage_path,nome_file,pdf_sha256,template_versione,created_by,created_by_nome)
   VALUES('10000000-0000-4000-8000-000000000002','Demo','12345678901','0442123456','nuova','{}',$1,'demo/test.pdf','test.pdf',$1,'ask-03-2020-v2','10000000-0000-4000-8000-000000000001','Operatore test')`,['a'.repeat(64)]);
  check((await db.query('SELECT count(*)::int n FROM public.malpractis_generati')).rows[0].n,1);
  for (const command of ['UPDATE public.malpractis_generati SET intestatario=\'No\'','DELETE FROM public.malpractis_generati']) { await assert.rejects(db.exec(command),e=>e.code==='42501'); checks++; }
  await db.exec('RESET ROLE');
  // Il bucket duplicato interrompe l'intera nuova migration, senza cambiare lo storico esistente.
  await assert.rejects(db.exec(sql),e=>e.code==='42P07'); checks++; await db.exec('ROLLBACK');
  check((await db.query('SELECT count(*)::int n FROM public.malpractis_generati')).rows[0].n,1);
  console.log(`OK ${checks} verifiche SQL: RLS/grant, bucket privato, isolamento, scrittura server e rollback`);
 } finally { await db.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
