'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const Csv = require('../netlify/functions/_lib/energia-csv');
const Bill = require('../netlify/functions/_lib/energia-bolletta');
const Review = require('../netlify/functions/_lib/energia-verifica');
const { endpointPages } = require('../js/mirox-permissions-core');

const fiscale = 'RSSMRA80A01H501U';
const context = { fiscale, business: false };
const pdr = '00123456789012';
const pod = 'IT001E12345678';
const billLines = ['Fornitore: Enel Energia', `PDR: ${pdr}`, `Codice fiscale cliente: ${fiscale}`];
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

test('la bolletta individua un solo punto e distingue venditore, distributore e fiscale cliente', () => {
  assert.deepEqual(Bill.parseText('Distributore: E-Distribuzione\n' + billLines.join('\n'), context), { punto: pdr, gestore: 'Enel Energia', ocr: false });
  assert.equal(Bill.parseText([...billLines, `POD: ${pod}`].join('\n'), context).motivo, 'bolletta_ambigua');
  assert.equal(Bill.parseText(billLines.join('\n'), { ...context, fiscale: 'BNCANN80A01H501U' }).motivo, 'intestatario_diverso');
  assert.equal(Bill.parseText(`Distributore: E-Distribuzione\nPOD: ${pod} Altro campo`, context).motivo, 'fornitore_incerto');
  assert.equal(Bill.parseText('Fornitore: Enel Energia\nPDR: O0123456789012', context, { ocr: true }).motivo, 'punto_incerto');
});

test('bolletta con più forniture: riscontra il servizio e il punto letto, anche con più POD', () => {
  const otherPod = 'IT001E87654321';
  const dual = [
    'Accendi Energia Mercato Luce e Gas',
    'POD di seguito, dati per l’energia elettrica',
    pod,
    'Punto di riconsegna (PDR) della fornitura',
    pdr,
    `Codice POD ${otherPod}`,
    'Distributore: E-Distribuzione'
  ].join('\n');
  const seller = 'Accendi Luce & Gas';
  assert.deepEqual(Bill.parseText(dual, { ...context, famiglia: 'gas' }), { punto: pdr, gestore: seller, ocr: false });
  assert.deepEqual(Bill.parseText(dual, { ...context, famiglia: 'luce', punto_dichiarato: otherPod }), { punto: otherPod, gestore: seller, ocr: false });
  assert.equal(Bill.parseText(dual, { ...context, famiglia: 'luce', punto_dichiarato: 'IT001E90807654' }).motivo, 'bolletta_ambigua');
  assert.deepEqual(Bill.parseText(`Scrivi a Acea Energia SpA – Casella Postale\nPOD: ${pod}\nInformativa privacy per la transizione a Plenitude S.p.A.`, context),
    { punto: pod, gestore: 'Acea Energia', ocr: false });
  assert.equal(Bill.familyForOffer('Offerta Energia Gas'), 'gas');
  assert.equal(Bill.familyForOffer('Luce e Gas'), null);
});

test('uno stesso allegato può essere letto una volta e riscontrato per due forniture distinte', async () => {
  const bytes = Buffer.from('%PDF-test non reale');
  const db = { storage: { from() { return { async download() { return { data: new Blob([bytes]) }; } }; } } };
  const documents = [{ bucket: 'contratti-vendita', path: 'test/bolletta.pdf' }];
  let reads = 0;
  const deps = {
    cache: new Map(),
    openPdf: async () => ({ loadingTask: { destroy() {} } }),
    extractPdf: async () => {
      reads++;
      return [`Accendi Energia Mercato Luce e Gas\nPOD: ${pod}\nPDR: ${pdr}`];
    }
  };
  for (const [famiglia, punto] of [['luce', pod], ['gas', pdr]]) {
    const result = await Bill.readBill(db, { ...context, documenti: documents, famiglia }, deps);
    assert.equal(result.punto, punto);
  }
  assert.equal(reads, 1);
});

test('PDF con testo e PDF scansionato sono letti localmente', { timeout: 25_000 }, async () => {
  const direct = await PDFDocument.create();
  const page = direct.addPage([700, 400]), font = await direct.embedFont(StandardFonts.Helvetica);
  billLines.forEach((line, i) => page.drawText(line, { x: 45, y: 330 - i * 50, font, size: 20 }));
  assert.deepEqual(await Bill.fromBytes(Buffer.from(await direct.save()), context), { punto: pdr, gestore: 'Enel Energia', ocr: false });

  const canvas = createCanvas(1500, 430);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 430);
  ctx.fillStyle = 'black'; ctx.font = '44px sans-serif';
  billLines.forEach((line, i) => ctx.fillText(line, 55, 80 + i * 70));
  const scan = await PDFDocument.create(), image = await scan.embedPng(canvas.toBuffer('image/png'));
  scan.addPage([750, 215]).drawImage(image, { x: 0, y: 0, width: 750, height: 215 });
  assert.deepEqual(await Bill.fromBytes(Buffer.from(await scan.save()), context), { punto: pdr, gestore: 'Enel Energia', ocr: true });
});

test('la lettura mirata termina sulla prova documentale e usa solo le proposte della fonte del lavoro', { timeout: 25_000 }, async () => {
  const scan = await PDFDocument.create();
  for (const lines of [['Fornitore: Enel Energia'], [`PDR: ${pdr}`, `Codice fiscale cliente: ${fiscale}`]]) {
    const canvas = createCanvas(1500, 350);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1500, 350);
    ctx.fillStyle = 'black'; ctx.font = '44px sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, 55, 80 + i * 70));
    const image = await scan.embedPng(canvas.toBuffer('image/png'));
    scan.addPage([750, 175]).drawImage(image, { x: 0, y: 0, width: 750, height: 175 });
  }
  scan.addPage([750, 175]);
  const bytes = Buffer.from(await scan.save());
  const expected = { punto: pdr, gestore: 'Enel Energia', ocr: true };

  for (const [declared, proposals, expectReadAll] of [
    [pdr, [{ numero: '0007' }], false],
    [pdr, [{ numero: '0007' }, { numero: '0012' }], true],
    ['00123456789013', [{ numero: '0008' }], true]
  ]) {
    const filters = [];
    const db = {
      from(table) {
        if (table === 'vendita_contratti') return { select: () => ({ eq: () => ({
          maybeSingle: async () => ({ data: { pod_pdr: declared, nome_offerta_snapshot: 'Offerta Gas' } })
        }) }) };
        assert.equal(table, 'vendita_energia_csv_righe');
        const query = {
          eq(key, val) { filters.push([key, val]); return this; },
          then(resolve) { return Promise.resolve({ data: proposals }).then(resolve); }
        };
        return { select: () => query };
      },
      storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]) }) }) }
    };
    const cache = new Map();
    let pages = 0;
    const { renderPageAsImage } = require('unpdf');
    const result = await Bill.readBill(db, { ...context, documenti: [{ bucket: 'contratti-vendita', path: 'test/bolletta.pdf' }] }, {
      contrattoId: 'contratto', csvId: 'versione-corrente', cache,
      render(...args) { pages++; return renderPageAsImage(...args); }
    });
    assert.deepEqual(result, expected);
    assert.deepEqual(filters, [['fonte_id', 'versione-corrente'], ['punto', declared], ['cf', fiscale]]);
    assert.equal(pages, expectReadAll ? 3 : 2);
    assert.equal(cache.size, expectReadAll ? 1 : 0);
  }
});

test('un punto letto in una colonna separata può solo confermare un abbinamento già provato nel CSV', { timeout: 25_000 }, async () => {
  const canvas = createCanvas(1600, 700);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1600, 700);
  ctx.fillStyle = 'black'; ctx.font = '48px sans-serif';
  ctx.fillText('Fornitore: Enel Energia', 45, 90);
  ctx.fillText('Dati della fornitura', 45, 185);
  ctx.fillText(pdr, 920, 460);
  const image = canvas.toBuffer('image/png');
  const proven = { ...context, famiglia: 'gas', punto_dichiarato: pdr, dichiarato_csv_univoco: true };
  assert.deepEqual(await Bill.fromBytes(image, proven), { punto: pdr, gestore: 'Enel Energia', ocr: true });
  assert.equal((await Bill.fromBytes(image, { ...proven, dichiarato_csv_univoco: false })).motivo, 'punto_incerto');
  assert.equal((await Bill.fromBytes(image, { ...proven, punto_dichiarato: '00123456789013' })).motivo, 'punto_incerto');
});

test('import condiviso da Verifica Contratti e riscontro manuale richiedono la sua ACL', () => {
  const event = action => ({ body: JSON.stringify({ action }) });
  assert.deepEqual(endpointPages('gestisci-controllo-lg', event('import_shared_csv')), ['verifica_contratti']);
  assert.deepEqual(endpointPages('gestisci-controllo-lg', event('set_manual_outcome')), ['controllo_lg']);
  assert.deepEqual(endpointPages('gestisci-vendita-contratto', event('riscontro_energia')), ['verifica_contratti']);
});

test('la coda usa prove server-side, non approva contratti e registra un tentativo fallito', async () => {
  const calls = [];
  const db = { async rpc(name, args) {
    calls.push([name, args]);
    if (name === 'vendita_energia_prossimo') {
      return { data: calls.length < 3 ? { contratto_id: 'fixture', lease: 'job', contesto: context, csv_id: 'file', updated_at: '2026-11-18T14:00:00Z' } : null };
    }
    return { data: { stato: 'in_attesa_csv', motivo: 'errore_lettura' } };
  }};
  let csvId;
  await Review.drain(db, async (_db, _context, options) => {
    csvId = options.csvId;
    throw new Error('lettura fixture');
  });
  assert.equal(csvId, 'file');
  assert.deepEqual(calls.map(([name]) => name), ['vendita_energia_prossimo', 'vendita_energia_riscontra', 'vendita_energia_prossimo']);
  assert.equal(calls[1][1].p_punto, null);
  assert.equal(calls[1][1].p_motivo, 'errore_lettura');
  assert.equal(calls[1][1].p_lease, 'job');
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
