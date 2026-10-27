'use strict';
// PostgreSQL in memoria, nessuna connessione a Supabase o dati reali.
const {PGlite}=require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE public.anagrafica(id uuid PRIMARY KEY);
 INSERT INTO public.anagrafica VALUES('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');`);
 const schema=async()=>(await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='anagrafica' ORDER BY ordinal_position")).rows;
 const before=await schema();
 await db.exec(fs.readFileSync(path.join(__dirname,'../database/20261027220802_anagrafica_codici_cliente_windtre.sql'),'utf8'));
 assert.deepEqual(await schema(),before);
 await db.exec('SET ROLE service_role');
 const insert=code=>db.query("INSERT INTO public.anagrafica_codici_cliente_windtre(anagrafica_id,codice_cliente) VALUES('10000000-0000-4000-8000-000000000001',$1) ON CONFLICT(anagrafica_id,codice_cliente) DO NOTHING",[code]);
 await insert('P00001');await insert('P00001');await insert('00002');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.anagrafica_codici_cliente_windtre')).rows[0].n,2);
 for(const bad of ['','p00001','P 00001','NONPRESENTE','<script>'])await assert.rejects(insert(bad),e=>e.code==='23514');
 await assert.rejects(db.exec("UPDATE public.anagrafica_codici_cliente_windtre SET codice_cliente='P99999'"),e=>e.code==='42501');
 await assert.rejects(db.exec('DELETE FROM public.anagrafica_codici_cliente_windtre'),e=>e.code==='42501');
 for(const role of ['anon','authenticated']){
  await db.exec('RESET ROLE; SET ROLE '+role);
  await assert.rejects(db.exec('SELECT * FROM public.anagrafica_codici_cliente_windtre'),e=>e.code==='42501');
  await assert.rejects(insert('P99999'),e=>e.code==='42501');
 }
 await db.exec('RESET ROLE');
 assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.anagrafica_codici_cliente_windtre'::regclass")).rows[0].relrowsecurity,true);
 await assert.rejects(db.exec("INSERT INTO public.anagrafica_codici_cliente_windtre(anagrafica_id,codice_cliente) VALUES('10000000-0000-4000-8000-000000000009','P00001')"),e=>e.code==='23503');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.anagrafica')).rows[0].n,2);
 console.log('OK piu codici/idempotenza/zeri iniziali, validazione, FK, RLS e permessi append-only; anagrafica invariata');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
