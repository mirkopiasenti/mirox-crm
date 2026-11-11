'use strict';
// NODE_PATH=/private/tmp/mirox-verifica-note-qa/node_modules node scripts/check-verifica-note-sql.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync('database/20261111131639_vendita_note_stato_verifica.sql', 'utf8');
const initial = fs.readFileSync('database/20261110102143_vendita_stati_verifica_manuale.sql', 'utf8');
const contract = '11111111-1111-4111-8111-111111111111';
const legacy = '22222222-2222-4222-8222-222222222222';
const author = '33333333-3333-4333-8333-333333333333';
const otherAuthor = '44444444-4444-4444-8444-444444444444';
const stamp = '2026-11-11T12:00:00Z';

(async () => {
  const db = new PGlite();
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const reject = async (query, code) => {
    await assert.rejects(query, error => error.code === code);
    checks++;
  };
  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA mirox_private;
      CREATE FUNCTION mirox_private.can_pages(text[]) RETURNS boolean LANGUAGE sql AS $$
        SELECT current_setting('test.page_allowed', true) = 'true'
      $$;
      CREATE TABLE public.vendita_contratti (
        id uuid PRIMARY KEY, stato_controllo text NOT NULL, updated_at timestamptz NOT NULL
      );
      GRANT USAGE ON SCHEMA public, mirox_private TO authenticated, service_role;
      GRANT SELECT, UPDATE ON public.vendita_contratti TO authenticated, service_role;
    `);
    await db.exec(initial);
    await db.query("INSERT INTO vendita_contratti VALUES ($1,'da_controllare',$3),($2,'da_controllare',$3)", [contract, legacy, stamp]);
    await db.query("INSERT INTO vendita_stati_verifica_manuale (contratto_id,stato,aggiornato_da) VALUES ($1,'da_verificare',$2)", [legacy, author]);
    const before = (await db.query('SELECT contratto_id,stato,aggiornato_da,aggiornato_at FROM vendita_stati_verifica_manuale')).rows;
    await db.exec(migration);
    equal((await db.query('SELECT contratto_id,stato,aggiornato_da,aggiornato_at FROM vendita_stati_verifica_manuale')).rows, before);
    equal((await db.query('SELECT motivo,versione::integer FROM vendita_stati_verifica_manuale')).rows[0], { motivo: null, versione: 1 });
    const save = async (state, reason, version, previous, actor = author, id = contract, date = stamp) => {
      const result = await db.query(`
        SELECT public.vendita_imposta_stato_verifica_manuale(
          $1::uuid,$2::text,$3::text,$4::timestamptz,$5::uuid,$6::text,$7::bigint
        ) AS value`, [id, state, previous, date, actor, reason, version]);
      return result.rows[0].value;
    };
    await db.exec('SET ROLE service_role');
    await reject(db.query("INSERT INTO vendita_stati_verifica_manuale (contratto_id,stato,aggiornato_da) VALUES ($1,'da_verificare',$2)", [contract, author]), '23514');
    for (const reason of [null, '', ' \n\t ', 'a'.repeat(2001)]) {
      await reject(save('da_verificare', reason, null, null), '22023');
    }
    await reject(save(null, 'Nota', null, null), '22023');
    await reject(save('da_confermare', null, 0, null), '22023');
    await reject(save('da_verificare', null, 1, 'da_verificare', author, legacy), '22023');
    equal(await save('da_confermare', null, null, null), { stato: 'da_confermare', motivo: null, versione: 1 });
    equal(await save('da_verificare', '  Documento mancante\n', 1, 'da_confermare'),
      { stato: 'da_verificare', motivo: 'Documento mancante', versione: 2 });
    equal(await save('da_verificare', 'Controllare il PDF', 2, 'da_verificare'),
      { stato: 'da_verificare', motivo: 'Controllare il PDF', versione: 3 });
    await reject(save('da_verificare', 'Nota da un dettaglio vecchio', 2, 'da_verificare'), '40001');
    await reject(save('da_verificare', 'Controllare il PDF', 2, 'da_verificare', otherAuthor), '40001');
    equal(await save('da_verificare', 'Controllare il PDF', 2, 'da_verificare'),
      { stato: 'da_verificare', motivo: 'Controllare il PDF', versione: 3 });
    equal(await save('da_verificare', 'Controllare il PDF', 3, 'da_verificare'),
      { stato: 'da_verificare', motivo: 'Controllare il PDF', versione: 3 });
    equal(await save('da_confermare', 'Motivo precedente', 3, 'da_verificare'),
      { stato: 'da_confermare', motivo: null, versione: 4 });
    await reject(save('da_verificare', 'Nuova nota', 4, 'da_confermare', author, contract, '2026-11-10T12:00:00Z'), '40001');
    await reject(db.query('SELECT vendita_imposta_stato_verifica_manuale($1,$2,$3,$4,$5)',
      [contract, 'da_verificare', 'da_confermare', stamp, author]), '40001');
    await db.query("UPDATE vendita_contratti SET stato_controllo='controllato' WHERE id=$1", [contract]);
    equal((await db.query('SELECT count(*)::integer AS n FROM vendita_stati_verifica_manuale WHERE contratto_id=$1', [contract])).rows[0].n, 0);
    await reject(save('da_verificare', 'Nota', null, null), '40001');
    await db.query("UPDATE vendita_contratti SET stato_controllo='da_controllare' WHERE id=$1", [contract]);
    equal(await save('da_verificare', 'Nota dopo riapertura', null, null),
      { stato: 'da_verificare', motivo: 'Nota dopo riapertura', versione: 1 });

    await db.exec("SET ROLE authenticated; SET test.page_allowed='true'");
    equal((await db.query('SELECT motivo FROM vendita_stati_verifica_manuale WHERE contratto_id=$1', [contract])).rows[0].motivo, 'Nota dopo riapertura');
    await reject(save('da_confermare', null, 1, 'da_verificare'), '42501');
    await reject(db.query("UPDATE vendita_stati_verifica_manuale SET motivo='Modifica diretta' WHERE contratto_id=$1", [contract]), '42501');
    await db.exec("SET test.page_allowed='false'");
    equal((await db.query('SELECT motivo FROM vendita_stati_verifica_manuale')).rows.length, 0);
    await db.exec('SET ROLE anon');
    await reject(save('da_confermare', null, 1, 'da_verificare'), '42501');
    await reject(db.query('SELECT motivo FROM vendita_stati_verifica_manuale'), '42501');
    console.log(`Note verifica: ${checks} controlli SQL isolati superati.`);
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
