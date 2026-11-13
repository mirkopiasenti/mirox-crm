'use strict';
// Solo PostgreSQL in memoria, senza connessioni o dati production.
const {PGlite} = require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.vendita_contratti(id integer PRIMARY KEY, categoria_snapshot text, reload_forever boolean NOT NULL DEFAULT false, note text);
    INSERT INTO public.vendita_contratti VALUES (1,'Mobile',true,'storico'),(2,'Customer Base',true,'storico'),(3,'Fisso',false,'immutato'),(4,NULL,true,'legacy'),(5,'Mobile',false,'immutato');
    ALTER TABLE public.vendita_contratti ENABLE ROW LEVEL SECURITY;`);
  const before = (await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows;
  const sql = fs.readFileSync(path.join(__dirname, '../database/20261113100628_reload_forever_gestione.sql'), 'utf8');
  await db.exec(sql);
  assert.deepEqual((await db.query('SELECT id,categoria_snapshot,reload_forever,note FROM public.vendita_contratti ORDER BY id')).rows, before);
  assert.equal((await db.query('SELECT count(*)::int n FROM public.vendita_contratti WHERE reload_forever_gestione IS NULL')).rows[0].n, 5);
  for (const id of [1,2]) for (const action of ['Mantieni attiva','Richiedi disattivazione']) {
    await db.query('UPDATE public.vendita_contratti SET reload_forever_gestione=$1 WHERE id=$2', [action,id]);
  }
  for (const id of [3,4,5]) for (const action of ['Mantieni attiva','Richiedi disattivazione','Altro']) {
    await assert.rejects(db.query('UPDATE public.vendita_contratti SET reload_forever_gestione=$1 WHERE id=$2', [action,id]), e => e.code === '23514');
  }
  for (const action of ['Altro','', 'Mantieni attiva ']) await assert.rejects(db.query('UPDATE public.vendita_contratti SET reload_forever_gestione=$1 WHERE id=1', [action]), e => e.code === '23514');
  await assert.rejects(db.exec('UPDATE public.vendita_contratti SET reload_forever=false WHERE id=1'), e => e.code === '23514');
  await db.exec('UPDATE public.vendita_contratti SET reload_forever=false,reload_forever_gestione=NULL WHERE id=1');
  await db.exec("INSERT INTO public.vendita_contratti(id,categoria_snapshot,reload_forever) VALUES(6,'Mobile',true)");
  assert.equal((await db.query('SELECT reload_forever_gestione FROM public.vendita_contratti WHERE id=6')).rows[0].reload_forever_gestione,null);
  assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.vendita_contratti'::regclass")).rows[0].relrowsecurity,true);
  console.log('OK: migration additiva, storico e RLS invariati, client precedenti compatibili, decisioni/scope/coerenza protetti');
  await db.close();
})().catch(error => {console.error(error);process.exitCode=1;});
