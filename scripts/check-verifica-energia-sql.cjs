'use strict';

// Installare PGlite in una cartella temporanea e impostare NODE_PATH.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { parse } = require('../netlify/functions/_lib/energia-csv');

const fixtureId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [cliente, inviato, bozza, pendente, storico, protetto, mobile, nonInviato, operatore] = Array.from({ length: 9 }, (_, i) => fixtureId(i + 1));
const punto = '00123456789012';
const errato = '00123456789013';
const fisso = 'IT001E12345678';
const fiscale = 'RSSMRA80A01H501U';
const header = 'Codice Fiscale;Partita Iva;Proposta di Contratto;POD/PDR;Stato;Causale stato pratica\n';
const source = (state = 'In lavorazione') => header
  + `${fiscale};;0007;${punto};${state};\n${fiscale};;0008;${errato};Attivato;\n${fiscale};;0009;${fisso};Rifiutato;Esito fixture\n`;

async function main() {
  const db = new PGlite();
  const query = async (sql, params) => (await db.query(sql, params)).rows;
  const value = async (sql, params) => (await query(sql, params))[0].v;
  const load = name => db.exec(fs.readFileSync('database/' + name, 'utf8'));
  const csv = (content, hash = 'a') => value('SELECT vendita_energia_importa_csv($1,$2,$3) AS v', [hash.repeat(64), operatore, JSON.stringify(parse(content))]);
  const next = (claim = true) => value('SELECT vendita_energia_prossimo($1) AS v', [claim]);
  const stamp = id => value('SELECT updated_at::text AS v FROM vendita_contratti WHERE id=$1', [id]);
  const phase = id => value('SELECT stato AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [id]);
  const confirm = id => query("UPDATE vendita_contratti SET stato_controllo='controllato' WHERE id=$1 RETURNING id", [id]);
  const outcome = id => query('SELECT stato, stato_origine, esito_manuale_bloccato FROM post_vendita_controllo_lg WHERE contratto_id=$1', [id]);
  const attempt = (claim, supply = punto, supplier = 'Enel Energia', issue = null, author = null) =>
    value('SELECT vendita_energia_riscontra($1,$2,$3,$4,$5,$6,$7,$8,$9) AS v',
      [claim.contratto_id, claim.updated_at, JSON.stringify(claim.contesto), claim.lease, claim.csv_id, supply, supplier, issue, author]);

  try {
    await db.exec(`
      CREATE ROLE anon;
      CREATE ROLE authenticated;
      CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT current_setting('role') $$;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
      CREATE SCHEMA mirox_private;
      CREATE FUNCTION mirox_private.can_pages(text[]) RETURNS boolean LANGUAGE sql AS $$
        SELECT current_setting('test.verifica',true) = 'true' AND 'verifica_contratti' = ANY($1)
      $$;
      CREATE TABLE public.anagrafica (id uuid PRIMARY KEY, cf_piva text, cluster text);
      CREATE TABLE public.vendita_pratiche (id uuid PRIMARY KEY, stato_pratica text);
      CREATE TABLE public.vendita_categorie (id uuid PRIMARY KEY, nome text);
      CREATE TABLE public.profili (id uuid PRIMARY KEY, ruolo text, attivo boolean);
      CREATE TABLE public.vendita_contratti (
        id uuid PRIMARY KEY, anagrafica_id uuid REFERENCES public.anagrafica,
        pratica_id uuid REFERENCES public.vendita_pratiche, categoria_snapshot text, categoria_id uuid REFERENCES public.vendita_categorie,
        stato_controllo text, cluster_cliente text, pod_pdr text, numero_contratto_energia text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE public.vendita_documenti (
        id uuid PRIMARY KEY, contratto_id uuid REFERENCES public.vendita_contratti,
        tipo_documento text, storage_bucket text, storage_path text, uploaded_at timestamptz DEFAULT now(),
        sha256 text, file_size bigint
      );
      CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
      CREATE TRIGGER touch_vendita BEFORE UPDATE ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
      GRANT USAGE ON SCHEMA public, mirox_private, auth TO authenticated, service_role;
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    `);
    await load('019_post_vendita_controllo_lg.sql');
    await load('020_lg_csv_import_fields.sql');
    await load('062_controllo_lg_esiti_manuali.sql');
    await db.exec('GRANT SELECT, UPDATE, INSERT, DELETE ON ALL TABLES IN SCHEMA public TO service_role');
    await query("INSERT INTO anagrafica VALUES ($1,$2,'Consumer')", [cliente, fiscale]);
    await query("INSERT INTO vendita_pratiche VALUES ($1,'inviata'),($2,'bozza')", [inviato, bozza]);
    await query("INSERT INTO vendita_categorie VALUES ($1,'Energia'),($2,'Mobile')", [fixtureId(20), fixtureId(21)]);
    await query("INSERT INTO profili VALUES ($1,'admin',true)", [operatore]);
    for (const [id, pratica, tipo, stato, supply, pc] of [
      [pendente, inviato, 'Energia', 'da_controllare', errato, null],
      [storico, inviato, 'Energia', 'controllato', errato, '0008'],
      [protetto, inviato, 'Energia', 'controllato', fisso, '0009'],
      [mobile, inviato, 'Mobile', 'da_controllare', null, null],
      [nonInviato, bozza, 'Energia', 'da_controllare', punto, null]
    ]) {
      await query('INSERT INTO vendita_contratti (id,anagrafica_id,pratica_id,categoria_snapshot,categoria_id,stato_controllo,cluster_cliente,pod_pdr,numero_contratto_energia) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, cliente, pratica, tipo, fixtureId(tipo === 'Energia' ? 20 : 21), stato, 'Consumer', supply, pc]);
    }
    const doc = fixtureId(30);
    await query('UPDATE vendita_contratti SET categoria_snapshot=NULL WHERE id=$1', [pendente]);
    const attach = path => query("INSERT INTO vendita_documenti (id,contratto_id,tipo_documento,storage_bucket,storage_path,file_size) VALUES($1,$2,'copia_bolletta','contratti-vendita',$3,400)", [doc, pendente, path]);
    await attach('test/bolletta.pdf');
    await db.exec('SET ROLE service_role');
    await query("INSERT INTO post_vendita_controllo_lg (contratto_id,pratica_id,anagrafica_id,stato) VALUES($1,$3,$4,'Nuovo'),($2,$3,$4,'Nuovo')", [storico, protetto, inviato, cliente]);
    await query("UPDATE post_vendita_controllo_lg SET stato='NON TROVATO',stato_origine='manuale',esito_manuale_bloccato=true,esito_manuale_note='Esito manuale',esito_manuale_at=now(),esito_manuale_da=$2 WHERE contratto_id=$1", [protetto, operatore]);
    await db.exec('RESET ROLE');
    const before = await query('SELECT * FROM vendita_contratti ORDER BY id');
    await load('20261118142349_verifica_energia_csv.sql');
    assert.deepEqual(await query('SELECT * FROM vendita_contratti ORDER BY id'), before);
    assert.deepEqual(await query('SELECT contratto_id,stato FROM vendita_energia_verifiche'), [{ contratto_id: pendente, stato: 'in_attesa_csv' }]);
    assert.equal(await next(false), null);

    await db.exec('SET ROLE authenticated');
    assert.deepEqual(await query('SELECT stato FROM vendita_energia_verifiche'), []);
    await db.exec("SET test.verifica='true'");
    assert.deepEqual(await query('SELECT stato FROM vendita_energia_verifiche'), [{ stato: 'in_attesa_csv' }]);
    await assert.rejects(query('SELECT contesto FROM vendita_energia_verifiche'), { code: '42501' });
    await assert.rejects(next(false), { code: '42501' });
    await assert.rejects(query('SELECT numero FROM vendita_energia_csv_righe'), { code: '42501' });
    await db.exec('RESET ROLE; SET ROLE service_role');
    await assert.rejects(confirm(pendente), { code: '40001' });

    const hotfix = '20261118152048_energia_csv_sostituzione_fonte.sql';
    const testUpgrade = process.argv.includes('--backfill-fonte');
    if (!testUpgrade) {
      await db.exec('RESET ROLE');
      await load(hotfix);
      await db.exec('SET ROLE service_role');
    }
    let imported = await csv(source());
    assert.equal(imported.aggiornati, 1);
    assert.equal(imported.protetti, 1);
    assert.deepEqual(await outcome(storico), [{ stato: 'Attivato', stato_origine: 'csv', esito_manuale_bloccato: false }]);
    assert.deepEqual(await outcome(protetto), [{ stato: 'NON TROVATO', stato_origine: 'manuale', esito_manuale_bloccato: true }]);
    if (testUpgrade) {
      const previousRows = await query('SELECT numero, punto, stato FROM vendita_energia_csv_righe ORDER BY numero');
      await db.exec('RESET ROLE');
      await load(hotfix);
      await db.exec('SET ROLE service_role');
      assert.deepEqual(await query('SELECT numero, punto, stato FROM vendita_energia_csv_righe ORDER BY numero'), previousRows);
    }
    const firstSource = await value('SELECT id AS v FROM vendita_energia_csv', []);
    assert.equal(await value('SELECT count(*)::integer AS v FROM vendita_energia_csv_righe WHERE fonte_id=$1', [firstSource]), 3);
    assert.equal((await csv(source())).duplicato, true);
    const stale = await next();
    assert.equal(stale.contratto_id, pendente);
    assert.equal(stale.contesto.documenti[0].path, 'test/bolletta.pdf');
    assert.equal(await next(), null);
    await db.exec('RESET ROLE');
    await query("UPDATE vendita_documenti SET storage_path='test/corretta.pdf' WHERE id=$1", [doc]);
    await db.exec('SET ROLE service_role');
    assert.equal(await attempt(stale), null);

    imported = await csv(source() + `${fiscale};;0010;${punto};Nuovo;\n`, 'b');
    assert.equal(await value('SELECT count(*)::integer AS v FROM vendita_energia_csv_righe WHERE fonte_id=$1', [firstSource]), 0);
    assert.equal(await value('SELECT count(*)::integer AS v FROM vendita_energia_csv_righe r JOIN vendita_energia_csv f ON f.id=r.fonte_id', []), 4);
    assert.equal((await attempt(await next())).motivo, 'csv_ambiguo');
    assert.equal(await phase(pendente), 'in_attesa_csv');
    assert.equal(await next(), null);
    assert.equal((await query('SELECT pod_pdr, numero_contratto_energia FROM vendita_contratti WHERE id=$1', [pendente]))[0].pod_pdr, errato);
    await csv(source() + `${fiscale};;0007;${punto};Rifiutato;Motivo fixture\n`, 'c');
    assert.deepEqual(await attempt(await next()), { stato: 'in_attesa_verifica', motivo: null });
    assert.deepEqual(await query('SELECT pod_pdr,numero_contratto_energia,ex_fornitore FROM vendita_contratti WHERE id=$1', [pendente]),
      [{ pod_pdr: punto, numero_contratto_energia: '0007', ex_fornitore: 'Enel Energia' }]);
    assert.equal(await value('SELECT punto_originale AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [pendente]), errato);
    assert.deepEqual(await outcome(pendente), []);
    assert.equal(await value('SELECT vendita_energia_pronta($1,$2,$3,$4) AS v', [pendente, punto, '0007', 'Enel Energia']), true);
    await assert.rejects(query("UPDATE vendita_contratti SET stato_controllo='controllato',numero_contratto_energia='0099' WHERE id=$1", [pendente]), { code: '40001' });

    // Se l'export successivo non include più la fornitura, la conferma usa
    // l'esito già riscontrato e la data del caricamento che lo ha fornito.
    await csv(header + `${fiscale};;0008;${errato};Attivato;\n`, 'd');
    await confirm(pendente);
    assert.deepEqual(await outcome(pendente), [{ stato: 'Rifiutato', stato_origine: 'csv', esito_manuale_bloccato: false }]);
    assert.equal(await value('SELECT causale_stato_pratica AS v FROM post_vendita_controllo_lg WHERE contratto_id=$1', [pendente]), 'Motivo fixture');
    await confirm(mobile);
    assert.deepEqual(await outcome(mobile), []);
    await query("UPDATE vendita_contratti SET stato_controllo='da_controllare' WHERE id=$1", [pendente]);
    assert.deepEqual(await query('SELECT stato FROM vendita_energia_verifiche WHERE contratto_id=$1', [pendente]), []);
    await assert.rejects(confirm(pendente), { code: '40001' });
    assert.equal(await value('SELECT stato_controllo AS v FROM vendita_contratti WHERE id=$1', [nonInviato]), 'da_controllare');

    await assert.rejects(value('SELECT vendita_energia_importa_csv($1,$2,$3) AS v',
      ['e'.repeat(64), operatore, JSON.stringify([{ numero: '100', punto: '', cf: fiscale, piva: '' }])]), { code: '22023' });
    assert.equal(await value('SELECT sha256 AS v FROM vendita_energia_csv', []), 'd'.repeat(64));
    assert.equal(await value('SELECT count(*)::integer AS v FROM vendita_energia_csv_righe r JOIN vendita_energia_csv f ON f.id=r.fonte_id', []), 1);

    // Riesame manuale usa il medesimo confronto server contro il CSV e
    // richiede una revisione ancora corrente.
    await csv(source('Attivato'), 'f');
    const context = await value('SELECT vendita_energia_contesto_manuale($1) AS v', [pendente]);
    const previous = await stamp(pendente);
    assert.deepEqual(await attempt({ contratto_id: pendente, contesto: context, updated_at: previous, lease: null, csv_id: null }, punto, 'Enel Energia', null, operatore),
      { stato: 'in_attesa_verifica', motivo: null });
    assert.equal(await value('SELECT lettura_da AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [pendente]), operatore);
    assert.equal(await next(), null);
    console.log('Verifica Energia SQL: migrazione, ACL, riscontro, esiti, concorrenza ottimistica e rollback verificati.');
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
