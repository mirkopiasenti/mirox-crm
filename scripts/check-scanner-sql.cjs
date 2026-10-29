'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const modulePath=process.env.MIROX_PGLITE_MODULE||'@electric-sql/pglite';
(async()=>{
 const {PGlite}=require(modulePath),db=new PGlite();
 try{
  await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;');
  const filename=fs.readdirSync(path.join(__dirname,'../database')).find(name=>name.endsWith('_scanner_documenti.sql'));
  await db.exec(fs.readFileSync(path.join(__dirname,'../database',filename),'utf8'));
  const table=(await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.vendita_scanner_sessioni'::regclass")).rows[0];assert.equal(table.relrowsecurity,true);
  for(const role of ['anon','authenticated']){
    for(const permission of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await db.query("SELECT has_table_privilege($1,'public.vendita_scanner_sessioni',$2) ok",[role,permission])).rows[0].ok,false);
  }
  assert.equal((await db.query("SELECT has_table_privilege('service_role','public.vendita_scanner_sessioni','SELECT,INSERT,UPDATE,DELETE') ok")).rows[0].ok,true);
  await db.exec('SET ROLE service_role');
  const id='11111111-1111-4111-8111-111111111111';
  await db.query("INSERT INTO public.vendita_scanner_sessioni(id,operatore_id,cliente_snapshot,pacchetto,token_hash,expires_at) VALUES($1,$1,'{}','{}',$2,now()+interval '10 minutes')",[id,'a'.repeat(64)]);
  const cas=()=>db.query("UPDATE public.vendita_scanner_sessioni SET stato='in_caricamento' WHERE id=$1 AND stato='aperta' RETURNING id",[id]);
  assert.equal((await cas()).rows.length,1);assert.equal((await cas()).rows.length,0);
  await assert.rejects(db.query("UPDATE public.vendita_scanner_sessioni SET stato='sbagliato' WHERE id=$1",[id]),/check constraint/);
  await db.exec('RESET ROLE;SET ROLE authenticated');await assert.rejects(db.query('SELECT * FROM public.vendita_scanner_sessioni'),/permission denied/);
  console.log('Scanner SQL: migration, RLS/ACL service-only, vincoli e CAS verificati.');
 }finally{await db.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
