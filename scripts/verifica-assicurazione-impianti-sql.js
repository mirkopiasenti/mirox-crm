'use strict';
// PostgreSQL isolato in memoria, nessuna connessione a production.
const { PGlite } = require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
(async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.vendita_contratti(id integer PRIMARY KEY, categoria_snapshot text, cluster_cliente text);
      INSERT INTO public.vendita_contratti VALUES (1,'Energia','Consumer'),(2,'Energia','Business'),
      (3,'Fisso','Consumer'),(4,'Mobile','Business'),(5,NULL,NULL);`);
    const before = (await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows;
    await db.exec(fs.readFileSync(path.join(__dirname, '../database/20261112214904_vendita_energia_assicurazione_impianti.sql'), 'utf8'));
    assert.deepEqual((await db.query('SELECT id,categoria_snapshot,cluster_cliente FROM public.vendita_contratti ORDER BY id')).rows, before);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.vendita_contratti WHERE assicurazione_impianti IS NULL')).rows[0].n, 5);
    for (const id of [1, 2]) for (const value of [true, false, null]) {
      await db.query('UPDATE public.vendita_contratti SET assicurazione_impianti=$1 WHERE id=$2', [value, id]);
      assert.equal((await db.query('SELECT assicurazione_impianti FROM public.vendita_contratti WHERE id=$1', [id])).rows[0].assicurazione_impianti, value);
    }
    for (const id of [3, 4, 5]) for (const value of [true, false]) {
      await assert.rejects(db.query('UPDATE public.vendita_contratti SET assicurazione_impianti=$1 WHERE id=$2', [value, id]), e => e.code === '23514');
    }
    await db.exec("UPDATE public.vendita_contratti SET assicurazione_impianti=false WHERE id=1");
    await assert.rejects(db.exec("UPDATE public.vendita_contratti SET categoria_snapshot='Fisso' WHERE id=1"), e => e.code === '23514');
    await db.exec("UPDATE public.vendita_contratti SET categoria_snapshot='Fisso', assicurazione_impianti=NULL WHERE id=1");
    const column = (await db.query("SELECT is_nullable,column_default,data_type FROM information_schema.columns WHERE table_name='vendita_contratti' AND column_name='assicurazione_impianti'")).rows[0];
    assert.deepEqual(column, { is_nullable: 'YES', column_default: null, data_type: 'boolean' });
    console.log('OK: storico invariato, Sì/No distinti, Consumer/Business, categorie escluse e cambio categoria.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
