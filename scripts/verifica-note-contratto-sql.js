'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.MIROX_PGLITE_MODULE||'@electric-sql/pglite');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function main(){
 const db=new PGlite();
 try{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
   CREATE TABLE public.vendita_contratti(id uuid PRIMARY KEY,stato_controllo text,note_controllo text,punti numeric);
   GRANT SELECT,DELETE ON public.vendita_contratti TO service_role;`);
  await db.query('INSERT INTO public.vendita_contratti VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[id(1),'controllato','Esito storico',5,id(2),'da_controllare',null,3]);
  const before=(await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows;
  await db.exec(fs.readFileSync(path.join(__dirname,'../database/20261116163541_note_contratto.sql'),'utf8'));
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.vendita_note_contratto'::regclass")).rows[0].relrowsecurity,true);
  for(const role of ['anon','authenticated']){
   await db.exec(`SET ROLE ${role}`);
   await assert.rejects(db.query('SELECT * FROM public.vendita_note_contratto'),/permission denied/);
   await assert.rejects(db.query('INSERT INTO public.vendita_note_contratto(id,contratto_id,testo,autore_id,autore_nome) VALUES($1,$2,$3,$4,$5)',[id(10),id(1),'Nota',id(3),'Autore']),/permission denied/);
   await db.exec('RESET ROLE');
  }
  const insert=(key,contract,text)=>db.query('INSERT INTO public.vendita_note_contratto(id,contratto_id,testo,autore_id,autore_nome,created_at) VALUES($1,$2,$3,$4,$5,$6)',[id(key),id(contract),text,id(3),'Autore login','2026-11-16T12:00:00.123456Z']);
  await db.exec('SET ROLE service_role');
  await insert(10,1,'Nota precedente\nSeconda riga');await insert(11,1,'Seconda annotazione');await insert(12,2,'Altro contratto');
  await assert.rejects(insert(10,1,'Non sovrascrivere'),/duplicate key/);
  await assert.rejects(insert(13,99,'Contratto inesistente'),/foreign key/);
  await assert.rejects(insert(13,1,''),/check constraint/);
  await assert.rejects(insert(13,1,'a'.repeat(4001)),/check constraint/);
  await assert.rejects(db.query('UPDATE public.vendita_note_contratto SET testo=$1 WHERE id=$2',['Cambio',id(10)]),/permission denied/);
  await assert.rejects(db.query('DELETE FROM public.vendita_note_contratto WHERE id=$1',[id(10)]),/permission denied/);
  const first=(await db.query('SELECT id,created_at::text AS cursor FROM public.vendita_note_contratto WHERE contratto_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[id(1)])).rows[0];
  assert.equal(first.id,id(11));
  const next=(await db.query('SELECT id,testo FROM public.vendita_note_contratto WHERE contratto_id=$1 AND (created_at<$2::timestamptz OR (created_at=$2::timestamptz AND id<$3::uuid)) ORDER BY created_at DESC,id DESC',[id(1),first.cursor,first.id])).rows;
  assert.equal(next.length,1);assert.equal(next[0].id,id(10));assert.equal(next[0].testo,'Nota precedente\nSeconda riga');
  assert.deepEqual((await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows,before);
  await db.exec('RESET ROLE;SET enable_seqscan=off;');
  const plan=(await db.query('EXPLAIN SELECT * FROM public.vendita_note_contratto WHERE contratto_id=$1 ORDER BY created_at DESC,id DESC LIMIT 51',[id(1)])).rows;
  assert.match(JSON.stringify(plan),/vendita_note_contratto_storico/);
  await db.exec('SET ROLE service_role;BEGIN');await db.query('DELETE FROM public.vendita_contratti WHERE id=$1',[id(1)]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.vendita_note_contratto WHERE contratto_id=$1',[id(1)])).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.vendita_note_contratto WHERE contratto_id=$1',[id(2)])).rows[0].n,1);
  await db.exec('ROLLBACK');assert.deepEqual((await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows,before);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.vendita_note_contratto')).rows[0].n,3);
  console.log('SQL note: RLS/grant, append-only, FK, cursori/indice, cascata isolata e rollback/storico verificati.');
 }finally{await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
