'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PDFDocument } = require('pdf-lib');
const { renderPageAsImage } = require('unpdf');
const Writer = require('zxing-wasm/writer');
const Barcode = require('../netlify/functions/_lib/identita-barcode');
const Identity = require('../netlify/functions/_lib/identita-upload');
const { handler } = require('../netlify/functions/verifica-identita-upload');

const cf = 'RSSMRA80A01H501U';
const consumer = { cf_piva: cf, cluster: 'Consumer', ragione_sociale: 'Mario Rossi' };
const business = { cf_piva: '12345678901', cluster: 'Business', ragione_sociale: 'Azienda', nome_referente: 'Referente già in anagrafica' };
const path = 'temp/01234567-89ab-cdef-0123-456789abcdef/pda.pdf';
const pdfPlaceholder = Buffer.from('%PDF-fixture');
const secret = 'fixture';
const readOnlyDb = customer => ({
  from: () => ({ select() { return this; }, ilike() { return this; }, limit: async () => ({ data: [customer] }) }),
  storage: { from: () => ({ download: async () => ({ data: new Blob([pdfPlaceholder]) }) }) }
});
const auth = async () => ({ ok: true, user: { id: 'operatore' } });
const forbiddenOcr = async () => assert.fail('L’upload identità deve usare soltanto il barcode');
const pda = 'Partita IVA / Cod. Fiscale Azienda: 12345678901\nCodice Contratto: 0000123456789\nDATI DEL LEGALE RAPPRESENTANTE O DEL DELEGATO\nNome e cognome: Mario Rossi\nCodice Fiscale: ' + cf;
const decoder = (value, complete = true) => async () => ({ complete, values: value ? [{ value, page: 1, format: 'Code39' }] : [] });

async function upload(customer, bytes, overrides = {}) {
  const form = new FormData();
  form.append('action', 'barcode');
  form.append('cliente', JSON.stringify(customer));
  if (customer.cluster === 'Business') form.append('pda_paths', JSON.stringify([path]));
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), 'documento.pdf');
  const request = new Request('https://fixture.invalid', { method: 'POST', body: form });
  return handler({ httpMethod: 'POST', headers: { 'content-type': request.headers.get('content-type') },
    isBase64Encoded: true, body: Buffer.from(await request.arrayBuffer()).toString('base64') },
  { secret, requireAuth: auth, db: readOnlyDb(customer), extract: forbiddenOcr, ...overrides });
}
function confirm(token, input) {
  return handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...input }) },
    { secret, requireAuth: auth, extract: forbiddenOcr });
}
function receipt(response, customer) {
  assert.equal(response.statusCode, 200, response.body);
  return Identity.verify(JSON.parse(response.body).token, { secret, user: 'operatore', customer });
}
async function syntheticPdf() {
  Writer.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm')) } });
  const code = await Writer.writeBarcode(cf, { format: 'Code39', scale: 4 });
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(await code.image.arrayBuffer());
  pdf.addPage([595, 842]).drawImage(image, { x: 370, y: 100, width: 115, height: 24 });
  return Buffer.from(await pdf.save());
}

test('barcode Consumer dal PDF reale e zoom dal ritaglio anche quando la pagina intera è troppo piccola', async () => {
  const bytes = await syntheticPdf();
  const lowResolution = (data, page, options) => renderPageAsImage(data, page, { ...options, width: 210 });
  const full = await Barcode.readPdf(bytes, { render: lowResolution });
  assert.equal(full.values.length, 0);
  const zoom = (data, options) => Barcode.readPdf(data, { ...options, render: lowResolution });
  const result = receipt(await upload(consumer, bytes, { readBarcode: zoom }), consumer);
  assert.equal(result.result.stato, 'coerente');
  assert.equal(result.result.criterio_identita, 'barcode_fiscale');
  assert.equal(result.result.scadenza, undefined);
  assert.equal(result.result.data_firma, undefined);
  assert.equal(result.documents[0].sha256, Identity.hash(bytes));
});
test('il CF Business viene dalla PDA e rimane separato dal nome referente', async () => {
  const result = receipt(await upload(business, pdfPlaceholder, {
    pdfInfo: async () => 1, pdfText: async () => pda, readBarcode: decoder(cf), extractBusiness: forbiddenOcr
  }), business);
  assert.equal(result.result.stato, 'coerente');
  assert.equal(result.result.fiscale_atteso, cf);
  assert.equal(result.business_identity.cf_rappresentante, cf);
  assert.equal(result.customer.nome_referente, business.nome_referente);
  assert.equal(result.business_identity.pdas[0].path, path);
  const wrong = await upload(business, pdfPlaceholder, {
    pdfInfo: async () => 1, pdfText: async () => pda.replace(business.cf_piva, '98765432109'), readBarcode: decoder(cf)
  });
  assert.equal(wrong.statusCode, 400);
  assert.equal(JSON.parse(wrong.body).code, 'pda_conflict');
});
test('CF discordante richiede preview, conserva l’esito e firma il manuale senza date', async () => {
  const out = await upload(consumer, pdfPlaceholder, { readBarcode: decoder('VRDLGI85T10F205K') });
  const automatic = receipt(out, consumer);
  assert.equal(automatic.result.barcode_stato, 'diverso');
  assert.equal(Identity.approved(automatic), false);
  const token = JSON.parse(out.body).token;
  const input = { action: 'confirm_preview', preview_visualizzata: true, preview_sha256: [Identity.hash(pdfPlaceholder)] };
  assert.equal((await confirm(token, { ...input, preview_sha256: [] })).statusCode, 400);
  const manual = receipt(await confirm(token, input), consumer);
  assert.equal(manual.result.stato, 'manuale');
  assert.equal(manual.result.scadenza, undefined);
  assert.equal(manual.esito_automatico.barcode_stato, 'diverso');
});
test('lettura incompleta e barcode assente rimangono manuali; cittadinanza VAR distinta dal barcode', async () => {
  for (const readBarcode of [decoder(null), decoder(cf, false)]) {
    const result = receipt(await upload(consumer, pdfPlaceholder, { readBarcode }), consumer);
    assert.equal(result.result.barcode_stato, 'illeggibile');
    assert.equal(Identity.approved(result), false);
  }
  const out = await upload(consumer, pdfPlaceholder, { readBarcode: decoder(cf) });
  const after = receipt(await confirm(JSON.parse(out.body).token, { action: 'barcode_citizenship', cittadinanza: 'extra_ue' }), consumer);
  assert.equal(after.result.stato, 'coerente');
  assert.equal(after.result.cittadinanza, 'extra_ue');
});
