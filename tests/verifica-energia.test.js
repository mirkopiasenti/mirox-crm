'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const fs = require('node:fs');
const vm = require('node:vm');
const Csv = require('../netlify/functions/_lib/energia-csv');
const Bill = require('../netlify/functions/_lib/energia-bolletta');
const Review = require('../netlify/functions/_lib/energia-verifica');
const { endpointPages } = require('../js/mirox-permissions-core');

const fiscale = 'RSSMRA80A01H501U';
const context = { fiscale, business: false };
const pdr = '00123456789012';
const pod = 'IT001E12345678';
const billLines = ['Fornitore: Enel Energia', `Codice fiscale cliente: ${fiscale}`];
const header = 'A;B;C;D;Codice Fiscale;Partita Iva;G;Proposta di Contratto;POD;PDR;Stato;Causale stato pratica;Messaggio esito da SAP;Causa Annullamento\n';

test('export WindTre: proposta in H come testo, PIVA normalizzata, punti separati e gerarchia esiti per la stessa fornitura', () => {
  const rows = Csv.parse('\uFEFF' + header
    + `;;;;${fiscale};;x;"0007";;${pdr};Attivato;;;\n`
    + `;;;;${fiscale};;x;0007;;${pdr};Rifiutato;"causa; dettaglio";"riga 1\nriga 2";annullata\n`
    + `;;;;;123456789;x;0007;${pod};;Nuovo;testo;testo;testo\n`);
  assert.deepEqual(rows, [
    { numero: '0007', punto: pdr, cf: fiscale, piva: '', stato: 'Rifiutato', causale: 'causa; dettaglio', messaggio: 'riga 1\nriga 2', annullamento: 'annullata' },
    { numero: '0007', punto: pod, cf: '', piva: '00123456789', stato: 'Nuovo', causale: null, messaggio: null, annullamento: null }
  ]);
  assert.throws(() => Csv.parse(header + 'riga;non;valida'), /colonne/i);
  assert.throws(() => Csv.parse('Proposta di Contratto;Codice Fiscale;Partita Iva;Stato\n07;' + fiscale + ';;Nuovo'), /POD\/PDR/);
});

test('riconosce il venditore anche con più forniture e distingue distributore, intestatario e riferimenti di servizio', () => {
  assert.deepEqual(Bill.parseText(['Distributore: E-Distribuzione', ...billLines, `PDR: ${pdr}`, `POD: ${pod}`].join('\n'), context),
    { gestore: 'Enel Energia' });
  assert.equal(Bill.parseText(billLines.join('\n'), { ...context, fiscale: 'BNCANN80A01H501U' }).motivo, 'intestatario_diverso');
  assert.equal(Bill.parseText(`Distributore: E-Distribuzione\nPOD: ${pod}`, context).motivo, 'fornitore_incerto');
  assert.deepEqual(Bill.parseText('Accendi Energia Mercato Luce e Gas', context), { gestore: 'Accendi Luce & Gas' });
  assert.deepEqual(Bill.parseText('Scrivi a Acea Energia SpA – Casella Postale\nInformativa privacy per la transizione a Plenitude S.p.A.', context),
    { gestore: 'Acea Energia' });
  assert.equal(Bill.parseText('Fornitore: Enel Energia\nFornitore: Argos', context).motivo, 'bolletta_ambigua');
});

test('la lettura dello stesso allegato si riusa e verifica il fiscale per ogni pratica', async () => {
  const bytes = Buffer.from('%PDF-test non reale');
  const db = { storage: { from() { return { async download() { return { data: new Blob([bytes]) }; } }; } } };
  const documenti = [{ bucket: 'contratti-vendita', path: 'test/bolletta.pdf' }];
  let reads = 0;
  const deps = {
    cache: new Map(),
    openPdf: async () => ({ loadingTask: { destroy() {} } }),
    extractPdf: async () => { reads++; return billLines; }
  };
  assert.deepEqual(await Bill.readBill(db, { ...context, documenti }, deps), { gestore: 'Enel Energia' });
  assert.deepEqual(await Bill.readBill(db, { ...context, fiscale: 'BNCANN80A01H501U', documenti }, deps), { motivo: 'intestatario_diverso' });
  assert.equal(reads, 1);
});

test('il gestore viene letto localmente nel testo e nella prima pagina scansionata, anche senza codice', { timeout: 25_000 }, async () => {
  const direct = await PDFDocument.create();
  const page = direct.addPage([700, 400]), font = await direct.embedFont(StandardFonts.Helvetica);
  billLines.forEach((line, i) => page.drawText(line, { x: 45, y: 330 - i * 50, font, size: 20 }));
  assert.deepEqual(await Bill.fromBytes(Buffer.from(await direct.save()), context), { gestore: 'Enel Energia' });

  const canvas = createCanvas(1500, 430);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 430);
  ctx.fillStyle = 'black'; ctx.font = '44px sans-serif';
  billLines.forEach((line, i) => ctx.fillText(line, 55, 80 + i * 70));
  const scan = await PDFDocument.create(), image = await scan.embedPng(canvas.toBuffer('image/png'));
  scan.addPage([750, 215]).drawImage(image, { x: 0, y: 0, width: 750, height: 215 });
  for (let i = 0; i < 19; i++) scan.addPage([750, 215]);
  let rendered = 0;
  const render = (...args) => { rendered++; return require('unpdf').renderPageAsImage(...args); };
  assert.deepEqual(await Bill.fromBytes(Buffer.from(await scan.save()), context, { render }), { gestore: 'Enel Energia' });
  assert.equal(rendered, 1);
});

function visionReading(input) {
  return { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'leggi_gestore', input }] };
}

test('la richiesta IA contiene ritagli realmente orientati, senza PDF, e accetta il nome citato dal fornitore', { timeout: 25_000 }, async () => {
  const upright = createCanvas(1000, 1400);
  const ctx = upright.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1000, 1400);
  ctx.fillStyle = 'black'; ctx.font = '46px sans-serif';
  ctx.fillText('Fornitore: Enel Energia', 50, 140);
  ctx.fillText('Informazioni del cliente', 300, 700);
  const sideways = createCanvas(1400, 1000);
  const rot = sideways.getContext('2d');
  rot.fillStyle = 'white'; rot.fillRect(0, 0, 1400, 1000);
  rot.translate(700, 500); rot.rotate(94 * Math.PI / 180); rot.drawImage(upright, -500, -700);
  const iaClient = { messages: { async create(payload, options) {
    assert.equal(options.maxRetries, 0);
    assert.equal(payload.model, 'claude-haiku-5-5');
    assert.equal(payload.max_tokens, 220);
    assert.ok(payload.messages[0].content.every(block => ['image', 'text'].includes(block.type)));
    const images = payload.messages[0].content.filter(block => block.type === 'image');
    assert.equal(images.length, 4);
    for (const { source } of images) {
      assert.equal(source.media_type, 'image/jpeg');
      const image = await loadImage(Buffer.from(source.data, 'base64'));
      assert.ok(image.width <= 1450 && image.height <= 475);
    }
    const uprightHeader = Buffer.from(images[3].source.data, 'base64');
    assert.deepEqual(await Bill.fromBytes(uprightHeader, context), { gestore: 'Enel Energia' });
    return visionReading({ esito: 'letto', gestore: 'Enel Energia', citazione: 'Fornitore: Enel Energia', immagine: 4 });
  } } };
  assert.deepEqual(await Bill.fromBytes(sideways.toBuffer('image/png'), context, { iaClient }), { gestore: 'Enel Energia' });
});

test('la seconda richiesta IA cerca in fondo e sulla seconda pagina, e respinge citazioni incongruenti', async () => {
  const scan = await PDFDocument.create();
  const canvas = createCanvas(450, 600);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 450, 600);
  ctx.fillStyle = 'black'; ctx.font = '36px sans-serif';
  ctx.fillText('ARGOS', 50, 540);
  const image = await scan.embedPng(canvas.toBuffer('image/png'));
  for (let i = 0; i < 2; i++) scan.addPage([450, 600]).drawImage(image, { x: 0, y: 0, width: 450, height: 600 });
  let calls = 0;
  const iaClient = { messages: { async create(payload) {
    const count = payload.messages[0].content.filter(block => block.type === 'image').length;
    assert.equal(count, calls++ ? 8 : 4);
    return visionReading(calls === 1
      ? { esito: 'letto', gestore: 'Enel Energia', citazione: 'Distributore: Enel Energia', immagine: 1 }
      : { esito: 'letto', gestore: 'Argos', citazione: 'Argos S.r.l.', immagine: 1 });
  } } };
  const bytes = Buffer.from(await scan.save());
  assert.deepEqual(await Bill.fromBytes(bytes, context, { iaClient }), { gestore: 'Argos' });
  assert.equal(calls, 2);
  const rendered = [];
  const render = (...args) => {
    rendered.push(args[1]);
    if (args[1] === 1) throw new Error('pagina di prova danneggiata');
    return require('unpdf').renderPageAsImage(...args);
  };
  const client = { messages: { async create() {
    return visionReading({ esito: 'letto', gestore: 'Argos', citazione: 'Argos S.r.l.', immagine: 1 });
  } } };
  assert.deepEqual(await Bill.fromBytes(bytes, context, { iaClient: client, render }), { gestore: 'Argos' });
  assert.deepEqual(rendered, [1, 2]);
});

test('import condiviso da Verifica Contratti e riscontro manuale richiedono la sua ACL', () => {
  const event = action => ({ body: JSON.stringify({ action }) });
  assert.deepEqual(endpointPages('gestisci-controllo-lg', event('import_shared_csv')), ['verifica_contratti']);
  assert.deepEqual(endpointPages('gestisci-controllo-lg', event('set_manual_outcome')), ['controllo_lg']);
  assert.deepEqual(endpointPages('gestisci-vendita-contratto', event('riscontro_energia')), ['verifica_contratti']);
  assert.deepEqual(endpointPages('gestisci-vendita-contratto', { body: JSON.stringify({ action: 'update', mode: 'save_energy' }) }), ['verifica_contratti']);
});

test('i quattro campi Energia sono modificabili anche nei Verificati e No arriva come booleano', () => {
  const page = fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'), 'utf8');
  const a = page.indexOf('function leggiDatiEnergia()');
  const b = page.indexOf('// CONFERMA VERIFICA', a);
  const inputs = { vc_pod_pdr: pdr, vc_numero_contratto_energia: '0018', vc_ex_fornitore: 'Argos', vc_assicurazione_impianti: 'false' };
  const fixture = { document: { getElementById: id => ({ value: inputs[id] }) } };
  vm.runInNewContext(page.slice(a, b), fixture);
  assert.deepEqual({ ...fixture.leggiDatiEnergia() },
    { pod_pdr: pdr, numero_contratto_energia: '0018', ex_fornitore: 'Argos', assicurazione_impianti: false });
  assert.match(page, /Salva dati Energia/);
  assert.match(page, /<select id="vc_assicurazione_impianti"/);
  for (const field of ['pod_pdr', 'numero_contratto_energia', 'ex_fornitore']) {
    const input = page.match(new RegExp(`<input[^\n]+id="vc_${field}"[^\n]+`))[0];
    assert.doesNotMatch(input, /readonly/);
  }
});

test('il salvataggio Energia accetta un operatore con accesso, limita lo storico ai quattro campi e verifica la versione', async () => {
  const { updateContract } = require('../netlify/functions/gestisci-vendita-contratto')._test;
  const id = '00000000-0000-4000-8000-000000000017';
  const scoreFields = ['punteggio_gara_offerta', 'punteggio_gara_opzione', 'punteggio_extra_gara_offerta', 'punteggio_extra_gara_opzione',
    'punteggio_gara_totale', 'punteggio_extra_gara_totale', 'punteggio_offerta', 'punteggio_opzione', 'punteggio_extra', 'punteggio_totale'];
  let current = { id, categoria_snapshot: 'Energia', stato_controllo: 'controllato', cluster_cliente: 'Consumer',
    updated_at: '2026-11-18T22:00:00Z', ...Object.fromEntries(scoreFields.map(field => [field, 0])) };
  let saved, canVerify = true;
  const supabase = { from(table) {
    if (table === 'profili') return { select() { return this; }, eq() { return this; },
      async single() { return { data: { id, ruolo: 'operatore', attivo: true } }; } };
    if (table === 'mirox_permessi_utente') return { select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { pagine: { verifica_contratti: canVerify } } }; } };
    assert.equal(table, 'vendita_contratti');
    let patch;
    return { select() { return this; }, eq() { return this; },
      update(fields) { saved = patch = fields; return this; },
      async maybeSingle() { return { data: { ...current, ...patch } }; } };
  } };
  const auth = { ok: true, user: { id }, profilo: { ruolo: 'operatore' } };
  const body = { contratto_id: id, expected_updated_at: current.updated_at, mode: 'save_energy',
    anagrafica: { ragione_sociale: 'Non salvare' },
    contratto: { pod_pdr: '00 123456789012', numero_contratto_energia: '0018', ex_fornitore: ' Argos ',
      assicurazione_impianti: false, categoria_id: 'estranea' } };
  assert.equal((await updateContract({ supabase, auth, body })).statusCode, 200);
  assert.deepEqual(saved, { pod_pdr: pdr, numero_contratto_energia: '0018', ex_fornitore: 'Argos', assicurazione_impianti: false, updated_by: id });
  saved = null;
  assert.equal((await updateContract({ supabase, auth, body: { ...body, expected_updated_at: '2020-01-01' } })).statusCode, 409);
  await assert.rejects(updateContract({ supabase, auth, body: { ...body, contratto: { pod_pdr: '111' } } }), { statusCode: 400 });
  current = { ...current, categoria_snapshot: 'Mobile' };
  assert.equal((await updateContract({ supabase, auth, body })).statusCode, 400);
  assert.equal(saved, null);
  current = { ...current, categoria_snapshot: 'Energia', stato_controllo: 'da_controllare' };
  const pending = { ...body, mode: 'save', contratto: { assicurazione_impianti: true }, anagrafica: {} };
  assert.equal((await updateContract({ supabase, auth, body: pending })).statusCode, 200);
  assert.equal(saved.assicurazione_impianti, true);
  assert.equal(saved.stato_controllo, undefined);
  saved = null;
  canVerify = false;
  assert.equal((await updateContract({ supabase, auth, body: pending })).statusCode, 403);
  assert.equal(saved, null);
});

test('la coda invia solo gestore o esito di lettura e non rilegge una prova valida', async () => {
  const jobs = [
    { gestore: 'Enel Energia' },
    { lettura_scaduta: true },
    {},
    {}
  ];
  const calls = [];
  const db = { async rpc(name, args) {
    if (name === 'vendita_energia_prossimo_gestore') {
      if (!jobs.length) return { data: null };
      return { data: { contratto_id: 'fixture', lease: 'job', contesto: context, csv_id: 'file', ...jobs.shift() } };
    }
    assert.equal(name, 'vendita_energia_riscontra');
    calls.push(args);
    return { data: { stato: 'da_verificare' } };
  }};
  let reads = 0;
  await Review.drain(db, async () => {
    if (reads++ === 0) return { gestore: 'Argos', punto: 'IT001E87654321' };
    throw new Error('lettura fixture');
  });
  assert.equal(reads, 2);
  assert.deepEqual(calls.map(job => [job.p_punto, job.p_gestore, job.p_motivo]), [
    [null, 'Enel Energia', null],
    [null, null, 'errore_lettura'],
    [null, 'Argos', null],
    [null, null, 'errore_lettura']
  ]);
  assert.ok(calls.every(job => job.p_lease === 'job' && job.p_csv_id === 'file'));
});

test('riscontro manuale richiede attestazione e revisione, passa al DB solo POD/PDR e gestore', async () => {
  const calls = [];
  const db = { async rpc(name, payload) {
    calls.push([name, payload]);
    return { data: name === 'vendita_energia_contesto_manuale' ? context : { stato: 'in_attesa_verifica', motivo: null } };
  }};
  const input = { contratto_id: 'fixture', expected_updated_at: '2026-11-18T14:00:00Z', pod_pdr: pdr, ex_fornitore: 'Enel Energia', numero_contratto_energia: 'valore non autorizzato' };
  await assert.rejects(Review.manual(db, input, 'operatore'), { statusCode: 400 });
  assert.equal(calls.length, 0);
  assert.equal((await Review.manual(db, { ...input, attestazione: true }, 'operatore')).stato, 'in_attesa_verifica');
  assert.equal(calls[1][1].p_punto, pdr);
  assert.equal(calls[1][1].p_autore, 'operatore');
  assert.equal(calls[1][1].p_numero, undefined);
});
