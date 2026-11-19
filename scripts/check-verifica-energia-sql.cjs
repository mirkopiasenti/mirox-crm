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
        SELECT coalesce(current_setting('test.verifica',true) = 'true' AND 'verifica_contratti' = ANY($1), false)
          OR coalesce(current_setting('test.lg',true) = 'true' AND 'controllo_lg' = ANY($1), false)
      $$;
      CREATE TABLE public.anagrafica (id uuid PRIMARY KEY, cf_piva text, cluster text);
      CREATE TABLE public.vendita_pratiche (id uuid PRIMARY KEY, stato_pratica text);
      CREATE TABLE public.vendita_categorie (id uuid PRIMARY KEY, nome text);
      CREATE TABLE public.profili (id uuid PRIMARY KEY, ruolo text, attivo boolean);
      CREATE TABLE public.vendita_contratti (
        id uuid PRIMARY KEY, anagrafica_id uuid REFERENCES public.anagrafica,
        pratica_id uuid REFERENCES public.vendita_pratiche, categoria_snapshot text, categoria_id uuid REFERENCES public.vendita_categorie,
        stato_controllo text, cluster_cliente text, pod_pdr text, numero_contratto_energia text,
        data_contratto timestamptz, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), updated_by uuid
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
    await load('20261112214904_vendita_energia_assicurazione_impianti.sql');
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

    await db.exec('RESET ROLE');
    await load('20261118170605_energia_priorita_riscontri.sql');
    await db.exec('BEGIN; SET LOCAL ROLE service_role');
    const nuova = fixtureId(41);
    await query(`INSERT INTO vendita_contratti (id,anagrafica_id,pratica_id,categoria_id,stato_controllo,cluster_cliente,pod_pdr,created_at)
      SELECT $2,anagrafica_id,pratica_id,categoria_id,stato_controllo,cluster_cliente,pod_pdr,created_at + interval '1 day'
      FROM vendita_contratti WHERE id=$1`, [pendente, nuova]);
    for (const [lease, retry, versione] of [["now() - interval '1 minute'", 'NULL', null], ['NULL', "now() - interval '1 minute'", firstSource]]) {
      await query(`UPDATE vendita_energia_verifiche SET contesto=vendita_energia_contesto_manuale($1), csv_id=$2,
        motivo='errore_lettura', riprova_at=${retry},
        lease=CASE WHEN ${lease} IS NULL THEN NULL ELSE gen_random_uuid() END, lease_until=${lease} WHERE contratto_id=$1`,
      [pendente, versione]);
      assert.deepEqual(await next(false), { contratto_id: nuova });
      assert.equal((await next()).contratto_id, nuova);
      assert.equal(await next(false), null);
      assert.equal(await next(), null);
      await query('UPDATE vendita_energia_verifiche SET lease=NULL,lease_until=NULL,contesto=vendita_energia_contesto_manuale($1),csv_id=$2 WHERE contratto_id=$1',
        [nuova, firstSource]);
      assert.deepEqual(await next(false), { contratto_id: pendente });
      await query('UPDATE vendita_energia_verifiche SET contesto=NULL,csv_id=NULL WHERE contratto_id=$1', [nuova]);
    }
    await db.exec('ROLLBACK; SET ROLE service_role');
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

    const previousProof = await query('SELECT * FROM vendita_energia_verifiche WHERE contratto_id=$1', [pendente]);
    await db.exec('RESET ROLE');
    await load('20261118190202_energia_conferma_punto_gestore.sql');
    const nextSupplier = (claim = true) => value('SELECT vendita_energia_prossimo_gestore($1) AS v', [claim]);
    const reject = (csvIssue = null, supplierIssue = null) => ({
      stato: 'da_verificare', motivo: csvIssue || supplierIssue, motivo_csv: csvIssue, motivo_fornitore: supplierIssue
    });
    const fields = () => query('SELECT pod_pdr, numero_contratto_energia, ex_fornitore FROM vendita_contratti WHERE id=$1', [pendente]);
    const fieldValues = (p, n, g) => [{ pod_pdr: p, numero_contratto_energia: n, ex_fornitore: g }];
    const replaceBill = async path => {
      await db.exec('RESET ROLE');
      await query('UPDATE vendita_documenti SET storage_path=$2 WHERE id=$1', [doc, path]);
      await db.exec('SET ROLE service_role');
      assert.equal(await phase(pendente), 'in_attesa_csv');
    };
    await db.exec("SET ROLE authenticated; SET test.verifica='true'");
    assert.deepEqual(await query('SELECT stato,motivo_csv,motivo_fornitore FROM vendita_energia_verifiche'),
      [{ stato: 'in_attesa_verifica', motivo_csv: null, motivo_fornitore: null }]);
    await assert.rejects(query('SELECT gestore_riscontrato FROM vendita_energia_verifiche'), { code: '42501' });
    await assert.rejects(nextSupplier(false), { code: '42501' });
    await db.exec('RESET ROLE; SET ROLE service_role');
    const [preserved] = await query('SELECT * FROM vendita_energia_verifiche WHERE contratto_id=$1', [pendente]);
    for (const [key, entry] of Object.entries(previousProof[0])) assert.deepEqual(preserved[key], entry);
    assert.equal(await nextSupplier(false), null);

    await db.exec('RESET ROLE; DELETE FROM vendita_energia_csv_righe; DELETE FROM vendita_energia_csv WHERE singleton');
    await replaceBill('test/prima-senza-csv.pdf');
    assert.equal(await next(), null);
    const beforeCsv = await nextSupplier();
    assert.equal(beforeCsv.csv_id, null);
    assert.deepEqual(await attempt(beforeCsv, errato, 'Argos'),
      { stato: 'in_attesa_csv', motivo: null, motivo_csv: null, motivo_fornitore: null });
    assert.deepEqual(await fields(), fieldValues(punto, null, 'Argos'));
    assert.equal(await nextSupplier(false), null);

    await csv(header + `${fiscale};;0008;${errato};Attivato;\n`, '1');
    const missed = await nextSupplier();
    assert.equal(missed.gestore, 'Argos');
    assert.deepEqual(await attempt(missed, null, missed.gestore), reject('csv_non_trovato'));
    assert.deepEqual(await fields(), fieldValues(punto, null, 'Argos'));
    assert.equal(await nextSupplier(false), null);

    await csv(source() + `${fiscale};;0010;${punto};Nuovo;\n`, '2');
    const ambiguous = await nextSupplier();
    assert.equal(ambiguous.gestore, 'Argos');
    assert.deepEqual(await attempt(ambiguous, null, ambiguous.gestore), reject('csv_ambiguo'));
    assert.deepEqual(await fields(), fieldValues(punto, null, 'Argos'));

    await csv(source(), '3');
    const nowMatched = await nextSupplier();
    assert.equal(nowMatched.gestore, 'Argos');
    assert.deepEqual(await attempt(nowMatched, null, nowMatched.gestore),
      { stato: 'in_attesa_verifica', motivo: null, motivo_csv: null, motivo_fornitore: null });
    assert.deepEqual(await fields(), fieldValues(punto, '0007', 'Argos'));
    await replaceBill('test/errore-lettura.pdf');
    const failed = await nextSupplier();
    assert.equal(failed.gestore, null);
    assert.deepEqual(await attempt(failed, null, null, 'errore_lettura'), reject(null, 'errore_lettura'));
    assert.deepEqual(await fields(), fieldValues(punto, '0007', null));
    assert.equal(await nextSupplier(false), null);
    await assert.rejects(confirm(pendente), { code: '40001' });

    const altroPunto = '00123456789034';
    await csv(header + `${fiscale};;0018;${altroPunto};Attivato;\n`, '4');
    const both = await nextSupplier();
    assert.deepEqual(await attempt(both, altroPunto, null, 'fornitore_incerto'), reject('csv_non_trovato', 'fornitore_incerto'));
    assert.deepEqual(await fields(), fieldValues(punto, null, null));
    const manual = { contratto_id: pendente, contesto: both.contesto, updated_at: await stamp(pendente), lease: null, csv_id: null };
    assert.deepEqual(await attempt(manual, altroPunto, 'Enel Energia', null, operatore),
      { stato: 'in_attesa_verifica', motivo: null, motivo_csv: null, motivo_fornitore: null });
    assert.deepEqual(await fields(), fieldValues(altroPunto, '0018', 'Enel Energia'));
    assert.equal(await value('SELECT vendita_energia_pronta($1,$2,$3,$4) AS v', [pendente, altroPunto, '0018', 'Enel Energia']), true);

    await db.exec('RESET ROLE');
    await load('20261110102143_vendita_stati_verifica_manuale.sql');
    await load('20261111131639_vendita_note_stato_verifica.sql');
    await load('20261118200410_energia_ocr_ia_esiti_manuali.sql');
    const setStatus = async (stato, previous = null, version = null, nota = null, id = pendente) =>
      value('SELECT vendita_imposta_stato_verifica_manuale($1,$2,$3,$4,$5,$6,$7) AS v',
        [id, stato, previous, await stamp(id), operatore, nota, version]);
    const ready = () => value('SELECT vendita_energia_pronta($1,$2,$3,$4) AS v', [pendente, altroPunto, '0018', 'Enel Energia']);
    await db.exec("SET ROLE authenticated; SET test.verifica='true'");
    await assert.rejects(setStatus('in_attesa_csv'), { code: '42501' });
    await db.exec('RESET ROLE; SET ROLE service_role');
    assert.equal(await ready(), true);
    assert.deepEqual(await setStatus('in_attesa_csv'), { stato: 'in_attesa_csv', motivo: null, versione: 1 });
    assert.equal(await ready(), false);
    await assert.rejects(confirm(pendente), { code: '40001' });
    await assert.rejects(setStatus('da_verificare', 'in_attesa_csv', 1, '   '), { code: '22023' });
    await assert.rejects(setStatus('da_confermare', 'in_attesa_csv', 1), { code: '22023' });
    const red = { stato: 'da_verificare', motivo: 'Controllo richiesto', versione: 2 };
    assert.deepEqual(await setStatus('da_verificare', 'in_attesa_csv', 1, '  Controllo richiesto  '), red);
    assert.deepEqual(await setStatus('da_verificare', 'in_attesa_csv', 1, 'Controllo richiesto'), red);
    assert.equal(await phase(pendente), 'in_attesa_verifica');
    assert.equal(await ready(), false);
    assert.deepEqual(await setStatus('in_attesa_verifica', 'da_verificare', 2),
      { stato: 'in_attesa_verifica', motivo: null, versione: 3 });
    assert.equal(await ready(), true);
    await replaceBill('test/revisione-gestore.pdf');
    assert.equal(await ready(), false);
    await assert.rejects(confirm(pendente), { code: '40001' });

    await query("UPDATE vendita_contratti SET stato_controllo='da_controllare' WHERE id=$1", [mobile]);
    await assert.rejects(setStatus('in_attesa_csv', null, null, null, mobile), { code: '22023' });
    assert.deepEqual(await setStatus('da_confermare', null, null, null, mobile),
      { stato: 'da_confermare', motivo: null, versione: 1 });

    await db.exec('RESET ROLE');
    await load('20261118213626_energia_modifiche_manuali.sql');
    await db.exec("SET ROLE authenticated; SET test.verifica='true'");
    await assert.rejects(query('SELECT numero_manuale FROM vendita_energia_verifiche'), { code: '42501' });
    await db.exec('RESET ROLE; SET ROLE service_role');

    const staleClaim = await nextSupplier();
    const nuovoPunto = '00123456789045';
    await query(`UPDATE vendita_contratti SET categoria_snapshot='Energia', pod_pdr=$2, numero_contratto_energia='0099',
      ex_fornitore='Iren Mercato', assicurazione_impianti=false, updated_by=$3 WHERE id=$1`, [pendente, nuovoPunto, operatore]);
    assert.equal(await attempt(staleClaim, null, 'Gestore superato'), null);
    await csv(header + `${fiscale};;0019;${nuovoPunto};Nuovo;\n`, '5');
    const unmatchedNumber = await nextSupplier();
    assert.equal(unmatchedNumber.gestore, 'Iren Mercato');
    assert.deepEqual(await attempt(unmatchedNumber, null, unmatchedNumber.gestore), reject('csv_numero_diverso'));
    assert.deepEqual(await fields(), fieldValues(nuovoPunto, '0099', 'Iren Mercato'));
    assert.equal(await value('SELECT assicurazione_impianti AS v FROM vendita_contratti WHERE id=$1', [pendente]), false);
    assert.equal(await nextSupplier(false), null);

    await csv(header + `${fiscale};;0019;${nuovoPunto};Nuovo;\n${fiscale};;0099;${nuovoPunto};Attivato;\n`, '6');
    const chosen = await nextSupplier();
    assert.equal(chosen.gestore, 'Iren Mercato');
    assert.deepEqual(await attempt(chosen, null, chosen.gestore),
      { stato: 'in_attesa_verifica', motivo: null, motivo_csv: null, motivo_fornitore: null });
    assert.equal(await value('SELECT lettura_da AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [pendente]), operatore);
    await query('UPDATE vendita_contratti SET assicurazione_impianti=true WHERE id=$1', [pendente]);
    assert.equal(await value('SELECT vendita_energia_pronta($1,$2,$3,$4) AS v', [pendente, nuovoPunto, '0099', 'Iren Mercato']), true);
    assert.equal(await nextSupplier(false), null);

    await confirm(pendente);
    const postSale = await outcome(pendente);
    await query(`UPDATE vendita_contratti SET pod_pdr=$2, numero_contratto_energia='0100',
      ex_fornitore='Argos', assicurazione_impianti=false WHERE id=$1`, [pendente, altroPunto]);
    assert.equal(await value('SELECT stato_controllo AS v FROM vendita_contratti WHERE id=$1', [pendente]), 'controllato');
    assert.deepEqual(await fields(), fieldValues(altroPunto, '0100', 'Argos'));
    assert.deepEqual(await outcome(pendente), postSale);
    assert.equal(await nextSupplier(false), null);

    await db.exec('RESET ROLE');
    await load('20261118215435_energia_tipo_pratica_csv.sql');
    await load('20261118220930_energia_tipo_pratica_ricerca.sql');
    const importTypes = rows => value('SELECT vendita_energia_importa_tipi($1) AS v', [JSON.stringify(rows)]);
    const typeOf = id => value('SELECT tipo_pratica_energia(c) AS v FROM vendita_contratti c WHERE id=$1', [id]);
    const beforeTypes = () => query(`SELECT
      (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM vendita_contratti c) AS contratti,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM post_vendita_controllo_lg l) AS lg,
      (SELECT to_jsonb(f) FROM vendita_energia_csv f WHERE singleton) AS fonte`);
    const snapshot = await beforeTypes();
    const types = [
      { numero: '0008', punto: errato, cf: fiscale, tipo_pratica: 'Switch-In' },
      { numero: '0100', punto: altroPunto, cf: fiscale, tipo_pratica: 'Voltura' },
      { numero: '0009', punto: fisso, cf: 'BNCANN80A01H501U', tipo_pratica: 'Attivazione' },
      { numero: '0007', punto, cf: fiscale, tipo_pratica: 'Attivazione' }
    ];
    await db.exec('SET ROLE service_role');
    assert.deepEqual(await importTypes(types), { tipi_aggiornati: 4 });
    assert.deepEqual(await importTypes(types), { tipi_aggiornati: 0 });
    assert.deepEqual(await beforeTypes(), snapshot);
    assert.equal(await typeOf(storico), 'Switch-In');
    assert.equal(await typeOf(pendente), 'Voltura');
    assert.equal(await typeOf(protetto), null);
    assert.equal(await typeOf(nonInviato), null);
    assert.equal(await typeOf(mobile), null);

    await db.exec("RESET ROLE; SET ROLE authenticated; SET test.verifica='false'");
    assert.equal(await typeOf(storico), null);
    await db.exec("SET test.verifica='true'");
    assert.equal(await typeOf(storico), 'Switch-In');
    await db.exec("SET test.verifica='false'; SET test.lg='true'");
    assert.equal(await typeOf(storico), 'Switch-In');
    await assert.rejects(query('SELECT * FROM mirox_private.energia_tipi_csv'), { code: '42501' });
    await assert.rejects(importTypes(types), { code: '42501' });

    await db.exec('RESET ROLE; SET ROLE service_role');
    const typeHeader = header.trimEnd() + ';Tipo Richiesta\n';
    const typeCsv = typeHeader + `${fiscale};;0008;${errato};Attivato;;Switch con Voltura\n`;
    assert.equal((await csv(typeCsv, '6')).duplicato, true);
    assert.equal(await typeOf(storico), 'Switch con Voltura');
    assert.deepEqual(await beforeTypes(), snapshot);
    await csv(typeHeader + `${fiscale};;0100;${altroPunto};Attivato;;Attivazione\n`, '7');
    assert.equal(await typeOf(storico), 'Switch con Voltura');
    assert.equal(await typeOf(pendente), 'Attivazione');
    await query(`UPDATE vendita_contratti SET numero_contratto_energia=NULL WHERE id=$1`, [pendente]);
    assert.equal(await typeOf(pendente), 'Attivazione');
    await importTypes([{ numero: '0101', punto: altroPunto, cf: fiscale, tipo_pratica: 'Voltura' }]);
    assert.equal(await typeOf(pendente), null);
    await query(`UPDATE vendita_contratti SET numero_contratto_energia='0101' WHERE id=$1`, [pendente]);
    assert.equal(await typeOf(pendente), 'Voltura');
    await importTypes([{ numero: '0101', punto: altroPunto, cf: fiscale, tipo_pratica: null }]);
    assert.equal(await typeOf(pendente), null);
    await query(`UPDATE vendita_contratti SET numero_contratto_energia='0102' WHERE id=$1`, [pendente]);
    await importTypes([{ numero: '0102', punto: '', cf: fiscale, tipo_pratica: 'Switch-In' }]);
    assert.equal(await typeOf(pendente), 'Switch-In');
    await importTypes([{ numero: '0102', punto: fisso, cf: fiscale, tipo_pratica: 'Voltura' }]);
    assert.equal(await typeOf(pendente), null);

    const [csvReady, csvMissing, csvAmbiguous, csvIncomplete, manualRed, csvLate, csvLg] =
      Array.from({ length: 7 }, (_, i) => fixtureId(50 + i));
    const sp = i => `0012345678910${i}`;
    const newEnergy = (id, supply, number = null) => query(`INSERT INTO vendita_contratti
      (id,anagrafica_id,pratica_id,categoria_snapshot,categoria_id,stato_controllo,cluster_cliente,pod_pdr,numero_contratto_energia)
      VALUES($1,$2,$3,'Energia',$4,'da_controllare','Consumer',$5,$6)`, [id, cliente, inviato, fixtureId(20), supply, number]);
    await newEnergy(csvReady, sp(1), '0999');
    await newEnergy(csvMissing, sp(2));
    await newEnergy(csvAmbiguous, sp(3));
    await newEnergy(csvIncomplete, sp(4));
    await newEnergy(manualRed, sp(5));
    await newEnergy(csvLg, sp(7));
    await setStatus('in_attesa_csv', null, null, null, csvReady);
    await setStatus('da_verificare', null, null, 'Nota operatore conservata', manualRed);
    await query(`INSERT INTO vendita_energia_verifiche(contratto_id,stato,motivo,motivo_fornitore)
      VALUES($1,'da_verificare','fornitore_incerto','fornitore_incerto')`, [csvReady]);

    await db.exec('RESET ROLE');
    await load('20261118223152_energia_verifica_solo_csv.sql');
    await db.exec('SET ROLE service_role');
    assert.equal(await nextSupplier(), null);
    assert.equal(await attempt({ contratto_id: csvReady, updated_at: await stamp(csvReady), contesto: {}, lease: fixtureId(65) }), null);
    assert.equal(await phase(csvReady), 'in_attesa_csv');
    const csvOnly = (content, hash = '8') => value('SELECT vendita_energia_importa_csv($1,$2,$3) AS v',
      [hash.repeat(64), operatore, JSON.stringify(parse(content, { requirePracticeType: true }))]);
    const currentTypeCsv = typeHeader + `;;0201;${sp(1)};Nuovo;;Switch-In\n`
      + `${fiscale};;0203;${sp(3)};Nuovo;;Attivazione\n${fiscale};;0293;${sp(3)};Attivato;;Voltura\n`
      + `${fiscale};;0204;${sp(4)};Attivato;;\n${fiscale};;0205;${sp(5)};Nuovo;;Voltura\n`
      + `${fiscale};;0206;${sp(6)};Nuovo;;Attivazione\n${fiscale};;0207;${sp(7)};Attivato;;Switch con Voltura\n`;
    const completedCsvImport = await csvOnly(currentTypeCsv);
    assert.equal(completedCsvImport.in_attesa_verifica, 2);
    assert.equal(completedCsvImport.da_verificare, 3);
    assert.equal(await phase(csvReady), 'in_attesa_verifica');
    assert.equal(await typeOf(csvReady), 'Switch-In');
    assert.equal(await value(`SELECT numero_contratto_energia AS v FROM vendita_contratti WHERE id=$1`, [csvReady]), '0201');
    assert.equal(await value(`SELECT ex_fornitore AS v FROM vendita_contratti WHERE id=$1`, [csvReady]), null);
    assert.equal(await value(`SELECT count(*)::int AS v FROM vendita_stati_verifica_manuale WHERE contratto_id=$1`, [csvReady]), 0);
    assert.equal(await value(`SELECT motivo AS v FROM vendita_stati_verifica_manuale WHERE contratto_id=$1`, [manualRed]), 'Nota operatore conservata');
    assert.equal(await phase(csvMissing), 'da_verificare');
    assert.match(await value('SELECT nota_csv AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [csvMissing]), /POD\/PDR.+non è presente/);
    assert.equal(await typeOf(csvMissing), null);
    assert.match(await value('SELECT nota_csv AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [csvAmbiguous]), /Più numeri/);
    assert.match(await value('SELECT nota_csv AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [csvIncomplete]), /tipo pratica/);
    assert.equal(await typeOf(storico), 'Switch con Voltura');
    assert.deepEqual(await outcome(protetto), [{ stato: 'NON TROVATO', stato_origine: 'manuale', esito_manuale_bloccato: true }]);

    await query(`INSERT INTO vendita_documenti (id,contratto_id,tipo_documento,storage_bucket,storage_path)
      VALUES($1,$2,'copia_bolletta','contratti-vendita','test/nuova-bolletta.pdf')`, [fixtureId(66), csvLg]);
    await query(`UPDATE vendita_contratti SET ex_fornitore='Manuale' WHERE id=$1`, [csvLg]);
    assert.equal(await phase(csvLg), 'in_attesa_verifica');
    await confirm(csvReady);
    await confirm(csvLg);
    assert.equal(await typeOf(csvReady), 'Switch-In');
    assert.equal(await typeOf(csvLg), 'Switch con Voltura');
    assert.deepEqual(await outcome(csvLg), [{ stato: 'Attivato', stato_origine: 'csv', esito_manuale_bloccato: false }]);

    await newEnergy(csvLate, sp(6));
    assert.equal(await typeOf(csvLate), null);
    const duplicateCsvImport = await csvOnly(currentTypeCsv);
    assert.equal(duplicateCsvImport.duplicato, true);
    assert.equal(duplicateCsvImport.in_attesa_verifica, 1);
    assert.equal(duplicateCsvImport.da_verificare, 0);
    assert.equal(await typeOf(csvLate), 'Attivazione');
    await query(`UPDATE vendita_contratti SET pod_pdr=$2 WHERE id=$1`, [csvMissing, sp(9)]);
    assert.equal(await phase(csvMissing), 'in_attesa_csv');
    assert.equal(await value('SELECT nota_csv AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [csvMissing]), null);

    await db.exec("RESET ROLE; SET ROLE authenticated; SET test.verifica='true'");
    assert.equal(await typeOf(csvReady), 'Switch-In');
    await assert.rejects(query('SELECT tipo_pratica_csv FROM vendita_energia_verifiche'), { code: '42501' });
    await db.exec("SET test.verifica='false'; SET test.lg='true'");
    assert.equal(await typeOf(csvReady), 'Switch-In');
    assert.deepEqual(await query('SELECT nota_csv FROM vendita_energia_verifiche'), []);

    await db.exec('RESET ROLE; CREATE TABLE public.vendita_verifiche (contratto_id uuid PRIMARY KEY)');
    const resetSQL = fs.readFileSync('database/ripristina_attesa_csv_energia.sql', 'utf8');
    const resetBefore = await query('SELECT * FROM vendita_energia_verifiche ORDER BY contratto_id');
    await db.exec(resetSQL);
    assert.deepEqual(await query('SELECT * FROM vendita_energia_verifiche ORDER BY contratto_id'), resetBefore);
    const hash = await value(`SELECT md5(jsonb_agg(jsonb_build_array(c.id,c.numero_contratto_energia,c.ex_fornitore,c.updated_at,to_jsonb(m))
      ORDER BY c.id)::text) AS v FROM vendita_contratti c JOIN vendita_pratiche p ON p.id=c.pratica_id
      LEFT JOIN vendita_stati_verifica_manuale m ON m.contratto_id=c.id
      WHERE p.stato_pratica='inviata' AND c.stato_controllo='da_controllare'
      AND mirox_private.energia_categoria(c.categoria_id,c.categoria_snapshot)`);
    const committedReset = resetSQL.replace("SET LOCAL lock_timeout", `SET LOCAL mirox.energia_reset_applica = 'yes';
SET LOCAL mirox.energia_reset_impronta = '${hash}';
SET LOCAL lock_timeout`).replace(/ROLLBACK;\s*$/, 'COMMIT;');
    await db.exec(committedReset);
    assert.equal(await phase(csvLate), 'in_attesa_csv');
    assert.equal(await typeOf(csvLate), null);
    assert.equal(await value('SELECT numero_contratto_energia AS v FROM vendita_contratti WHERE id=$1', [csvLate]), null);
    assert.equal(await typeOf(csvLg), 'Switch con Voltura');
    assert.deepEqual(await outcome(csvLg), [{ stato: 'Attivato', stato_origine: 'csv', esito_manuale_bloccato: false }]);

    await load('20261118230401_energia_csv_screma_duplicati.sql');
    await db.exec('SET ROLE service_role');
    const [dateMatch, otherDate, taxMatch, statusMatch, unresolved, manuallyHeld] =
      Array.from({ length: 6 }, (_, i) => fixtureId(80 + i));
    const supplyFor = n => `0012345678920${n}`;
    await newEnergy(dateMatch, supplyFor(1));
    await newEnergy(otherDate, supplyFor(1));
    await newEnergy(taxMatch, supplyFor(2));
    await newEnergy(statusMatch, supplyFor(3));
    await newEnergy(unresolved, supplyFor(4));
    await newEnergy(manuallyHeld, supplyFor(5));
    await query("UPDATE vendita_contratti SET data_contratto=$2 WHERE id=ANY($1::uuid[])",
      [[dateMatch, taxMatch, statusMatch, unresolved, manuallyHeld], '2026-11-18T23:30:00Z']);
    await query("UPDATE vendita_contratti SET data_contratto='2026-11-20T10:00:00Z' WHERE id=$1", [otherDate]);
    await query("INSERT INTO anagrafica VALUES($1,'00123456789','Business')", [fixtureId(90)]);
    await query("UPDATE vendita_contratti SET anagrafica_id=$2, cluster_cliente='Business' WHERE id=$1", [taxMatch, fixtureId(90)]);
    await setStatus('da_verificare', null, null, 'Decisione operatore', manuallyHeld);
    await query(`INSERT INTO vendita_energia_verifiche(contratto_id,stato,motivo,motivo_csv,nota_csv)
      VALUES($1,'da_verificare','csv_ambiguo','csv_ambiguo','Vecchio risultato automatico')`, [statusMatch]);

    const hDate = 'Codice Fiscale;Partita Iva;Proposta di Contratto;Tipo Richiesta;Data Firma;POD/PDR;Stato\n';
    const csvRow = (cf, iva, pc, type, day, point, state) => `${cf};${iva};${pc};${type};${day};${point};${state}\n`;
    await csvOnly(hDate
      + csvRow('', '', '0501', 'Switch-In', '19/11/2026', supplyFor(1), 'Nuovo')
      + csvRow(fiscale, '', '0502', 'Attivazione', '20/11/2026', supplyFor(1), 'Nuovo')
      + csvRow('', '123456789', '0521', 'Voltura', '19/11/2026', supplyFor(2), 'Nuovo')
      + csvRow(fiscale, '123456780', '0522', 'Attivazione', '19/11/2026', supplyFor(2), 'Nuovo')
      + csvRow(fiscale, '', '0531', 'Switch con Voltura', '19/11/2026', supplyFor(3), 'Nuovo')
      + csvRow(fiscale, '', '0531', 'Voltura', '19/11/2026', supplyFor(3), 'Annullato')
      + csvRow(fiscale, '', '0541', 'Attivazione', '19/11/2026', supplyFor(4), 'Nuovo')
      + csvRow(fiscale, '', '0542', 'Voltura', '19/11/2026', supplyFor(4), 'Attivato')
      + csvRow(fiscale, '', '0551', 'Voltura', '19/11/2026', supplyFor(5), 'Attivato'), '9');
    assert.equal(await typeOf(dateMatch), 'Switch-In');
    assert.equal(await typeOf(otherDate), 'Attivazione');
    assert.equal(await typeOf(taxMatch), 'Voltura');
    assert.equal(await typeOf(statusMatch), 'Switch con Voltura');
    assert.equal(await phase(statusMatch), 'in_attesa_verifica');
    assert.equal(await phase(unresolved), 'da_verificare');
    assert.match(await value('SELECT nota_csv AS v FROM vendita_energia_verifiche WHERE contratto_id=$1', [unresolved]), /Restano più righe/);
    assert.equal(await value('SELECT motivo AS v FROM vendita_stati_verifica_manuale WHERE contratto_id=$1', [manuallyHeld]), 'Decisione operatore');
    const heldCandidates = [
      { numero: '001', tipo_pratica: 'Voltura', data_firma: '2026-11-19', cf: fiscale, stato: 'Annullato' },
      { numero: '002', tipo_pratica: 'Attivazione', data_firma: '2026-11-19', cf: fiscale, stato: 'Annullato' }
    ];
    const reason = (day, identity) => value('SELECT nota AS v FROM mirox_private.energia_scegli_proposta($1,$2,$3,false)',
      [JSON.stringify(heldCandidates), day, identity]);
    assert.match(await reason('2026-11-20', fiscale), /Nessuna ha la Data Firma/);
    assert.match(await reason('2026-11-19', 'BNCANN80A01H501U'), /stesso codice fiscale/);
    assert.match(await reason('2026-11-19', fiscale), /tutte Annullato/);

    await db.exec('RESET ROLE');
    await load('20261119173949_energia_upload_bolletta_duplicati.sql');
    const availableCheck = points => value('SELECT vendita_energia_punto_caricato_oggi($1) AS v', [points]);
    const writeAt = (id, point, created, category = 'Energia') => query(`INSERT INTO vendita_contratti
      (id,anagrafica_id,pratica_id,categoria_snapshot,categoria_id,stato_controllo,cluster_cliente,pod_pdr,created_at)
      VALUES($1,$2,$3,$4,$5,'da_controllare','Consumer',$6,$7)`,
      [fixtureId(id), cliente, bozza, category, fixtureId(category === 'Mobile' ? 21 : 20), point, created]);
    await db.exec('SET ROLE authenticated');
    await assert.rejects(availableCheck([supplyFor(1)]), { code: '42501' });
    await db.exec('SET ROLE service_role');
    assert.equal(await availableCheck([supplyFor(1)]), true); // Duplicati storici già presenti.
    assert.equal(await availableCheck(['IT002E12345678']), false);
    const current = await value('SELECT statement_timestamp() AS v');
    await assert.rejects(writeAt(101, supplyFor(1), current), { code: '23505' });
    await query("UPDATE vendita_contratti SET data_contratto='2026-11-21' WHERE id=$1", [dateMatch]);
    const newPod = 'IT002E12345678';
    await writeAt(102, 'it002e 12345678', '2026-11-19T22:59:59Z');
    await writeAt(103, newPod, '2026-11-19T23:00:00Z', null); // Snapshot legacy, categoria Energia.
    await assert.rejects(writeAt(104, newPod, '2026-11-20T10:00:00Z'), { code: '23505' });
    await writeAt(104, newPod, '2026-11-20T10:00:00Z', 'Mobile');
    await writeAt(105, '00123456789300', '2026-07-01T21:59:59Z');
    await writeAt(106, '00123456789300', '2026-07-01T22:00:00Z');
    await assert.rejects(writeAt(107, '00123456789300', '2026-07-02T11:00:00Z'), { code: '23505' });
    await query("UPDATE vendita_contratti SET pod_pdr=$2 WHERE id=$1", [fixtureId(103), 'it002e12345678']);
    await writeAt(111, supplyFor(1), current, 'Mobile');
    await assert.rejects(query("UPDATE vendita_contratti SET categoria_snapshot='Energia' WHERE id=$1", [fixtureId(111)]), { code: '23505' });
    await writeAt(112, '00123456789302', '2026-07-02T11:00:00Z');
    await query("UPDATE vendita_contratti SET pod_pdr='00123456789300' WHERE id=$1", [fixtureId(112)]);
    await query('DELETE FROM vendita_contratti WHERE id=$1', [fixtureId(103)]);
    await writeAt(108, newPod, '2026-11-20T10:00:00Z'); // Una bozza annullata via rollback libera il punto.
    const atomicPoint = '00123456789301';
    await assert.rejects(query(`INSERT INTO vendita_contratti
      (id,categoria_snapshot,pod_pdr,created_at) VALUES ($1,'Energia',$3,$4),($2,'Energia',$3,$4)`,
      [fixtureId(109), fixtureId(110), atomicPoint, current]), { code: '23505' });
    assert.equal(await availableCheck([atomicPoint]), false);
    console.log('Verifica Energia SQL: migrazione, ACL, riscontro, esiti, concorrenza ottimistica e rollback verificati.');
  } finally {
    await db.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
