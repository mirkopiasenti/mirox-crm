'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { sectionFields, readPdfFields } = require('../netlify/functions/_lib/pda-pdf-text');
const { normalizeResult, mergePdfResult } = require('../netlify/functions/ocr-pda')._test;
const Pda = require('../js/vendita-pda-core');
const { normalizeContractInput } = require('../netlify/functions/crea-vendita-pratica-carrello')._test;
const source = fs.readFileSync(path.join(__dirname, '../moduli/upload-contratti-vendita.html'), 'utf8');
const keys = ['reload_exchange', 'reload_forever'];
const sim = options => 'DATI DELLA SIM WINDTRE\nNumero di telefono: 3331234567\nPiano Telefonico: New Basic\nOpzioni/servizi: '
  + options + '\nCosto attivazione offerta Easy pay: pagamento a rate\nData: 13/11/2026';

test('Reload: presenza indipendente, nomi commerciali, maiuscole e a capo nella sola SIM contrattuale', () => {
  for (const [text, exchange, forever] of [['Pack 5G Reload exChange - Reload exChange', true, false],
    ['Reload Forever Basic', false, true], ['RELOAD\nEXCHANGE - reload\nforever Basic', true, true],
    ['Segreteria Telefonica - Smartphone Reload', false, false]]) {
    const fields = sectionFields(sim(text));
    assert.equal(fields.reload_exchange, exchange); assert.equal(fields.reload_forever, forever);
  }
  const outside = 'Condizioni Reload Exchange e Reload Forever Basic\nSMARTPHONE RELOAD SI [X] NO [ ]';
  assert.equal(sectionFields(outside).reload_exchange, undefined);
  const prevalidation = 'DATI DELLA SIM WINDTRE\nNumero di telefono: 3331234567\nDATI CLIENTE\n' + outside;
  const fields = sectionFields(prevalidation + '\n' + sim('Segreteria') + '\n' + outside);
  assert.equal(fields.reload_exchange, false); assert.equal(fields.reload_forever, false);
});

test('Reload: assenza non dimostrata, lista troncata, testo illeggibile e SIM discordanti restano incerti', () => {
  for (const text of ['DATI DELLA SIM WINDTRE\nPiano Telefonico: New Basic',
    sim('Segreteria').split('\nCosto attivazione')[0], sim('Segreteria \uFFFD')]) {
    for (const key of keys) assert.equal(sectionFields(text)[key], undefined);
  }
  for (const key of keys) assert.equal(sectionFields(sim('Segreteria'), false)[key], undefined);
  assert.equal(sectionFields(sim('Reload Exchange') + '\n' + sim('Segreteria')).reload_exchange, null);
  assert.equal(sectionFields(sim('Reload Forever') + '\n' + sim('Segreteria')).reload_forever, null);
  assert.equal(sectionFields(sim('Reload Exchange') + '\n' + sim('Reload Exchange')).reload_exchange, true);
});

test('Reload: merge conserva presenza testuale e non inventa un No contro lettura AI positiva o incerta', () => {
  for (const key of keys) {
    assert.equal(normalizeResult({ [key]: 'true' })[key], true);
    assert.equal(normalizeResult({ [key]: 'false' })[key], false);
    assert.equal(normalizeResult({ [key]: 'forse' })[key], null);
    for (const visual of [true, null, undefined]) assert.equal(mergePdfResult({ [key]: visual }, { [key]: false })[key], null);
    assert.equal(mergePdfResult({ [key]: false }, { [key]: false })[key], false);
    assert.equal(mergePdfResult({}, { [key]: true })[key], true);
    assert.equal(mergePdfResult({ [key]: true }, { [key]: null })[key], null);
    assert.equal(mergePdfResult({ [key]: true }, {})[key], true);
  }
});

test('PDF sintetico vero: opzioni a capo recuperate anche con content stream fuori ordine', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage();
  const lines = sim('Pack 5G Reload exChange - Reload\nForever Basic').split('\n');
  for (const i of [4, 0, 6, 2, 1, 5, 3]) page.drawText(lines[i], { x: 30, y: 750 - 18 * i, size: 9, font });
  const fields = await readPdfFields(await pdf.save());
  assert.equal(fields.reload_exchange, true); assert.equal(fields.reload_forever, true);
});

function fixture(category = 'Mobile') {
  const root = { dataset: {}, addEventListener() {} };
  const field = () => ({ checked: false, dataset: {}, addEventListener(type, fn) { this[type] = fn; } });
  const refs = { reloadExchange: field(), reloadForever: field(), offerta: { value: 'offer' }, cluster: { value: 'Consumer' } };
  const runtimeState = { pdaRevision: 1, editingTempId: null };
  let resolve, questions = [], saves = 0;
  const ctx = { refs, runtimeState, document: { getElementById: () => root }, getCategoriaName: () => category,
    isCategory: (a, b) => a === b, queueDraftSave() { saves++; }, window: { MiroxPda: Pda,
      MiroxPdaUI: { formHtml: () => '', bindForm() {}, readForm: () => ({}) },
      MiroxUI: { confirm(text, options) { questions.push({ text, options }); return new Promise(r => { resolve = r; }); } } } };
  const start = source.indexOf(' async function confirmReloadFlagChange('), end = source.indexOf(' function isOfferFlagEnabled(', start);
  const a = source.indexOf(' function renderPdaFields(data)'), b = source.indexOf(' async function checkPendingCode()', a);
  vm.runInNewContext(source.slice(start, end) + source.slice(a, b)
    + ';this.render=renderPdaFields;this.read=readPdaFields;this.change=confirmReloadFlagChange;', ctx);
  const listeners = source.split('\n').filter(line => /refs\.reload(?:Exchange|Forever)\.addEventListener\('change'/.test(line)).join('\n');
  vm.runInNewContext(listeners, ctx);
  return { refs, root, runtimeState, render: ctx.render, read: ctx.read, decide: v => resolve(v), questions,
    setCategory(value) { category = value; }, get saves() { return saves; } };
}

for (const [key, ref] of [['reload_exchange', 'reloadExchange']]) {
  for (const previous of [true, false]) for (const accepted of [true, false])
    test(`${key} ${previous ? 'disattivazione' : 'attivazione'}: ${accepted ? 'conferma' : 'annulla'}`, async () => {
      const ui = fixture(); ui.render({ [key]: previous });
      const field = ui.refs[ref]; field.checked = !previous;
      const pending = field.change();
      assert.equal(field.checked, previous); assert.equal(ui.read()[key], previous); assert.equal(ui.saves, 0);
      assert.match(ui.questions[0].text, previous ? /disattivare/ : /attivare/);
      ui.decide(accepted); await pending;
      assert.equal(field.checked, accepted ? !previous : previous); assert.equal(ui.saves, accepted ? 1 : 0);
      // Anche una seconda correzione manuale deve richiedere conferma.
      field.checked = !field.checked; const second = field.change();
      assert.equal(ui.questions.length, 2); ui.decide(false); await second;
      assert.equal(field.checked, accepted ? !previous : previous);
    });
}

test('Reload: compilazione automatica, restore, cambio cluster, nuova PDA e altre categorie senza popup', () => {
  const ui = fixture(); ui.render({ reload_exchange: true, reload_forever: true });
  assert.equal(ui.refs.reloadExchange.checked, true); assert.equal(ui.refs.reloadForever.checked, true);
  const draft = JSON.parse(JSON.stringify(ui.read())); ui.render(draft);
  assert.equal(ui.refs.reloadForever.checked, true);
  ui.refs.cluster.value = 'Business'; ui.render(); assert.equal(ui.refs.reloadExchange.checked, true);
  assert.equal(normalizeContractInput({ ...draft, categoria_id: 'cat', offerta_id: 'offer' }, 0).reload_forever, true);
  ui.render({ reload_exchange: false, reload_forever: true });
  assert.equal(ui.refs.reloadExchange.checked, false); assert.equal(ui.refs.reloadForever.checked, true);
  ui.render({}); assert.equal(ui.refs.reloadForever.checked, false);
  ui.setCategory('Fisso'); ui.render({ reload_exchange: true }); assert.equal(ui.refs.reloadExchange.checked, false);
  ui.setCategory('Customer Base'); ui.render({ reload_forever: true }); assert.equal(ui.refs.reloadForever.checked, true);
  assert.equal(ui.questions.length, 0);
});

test('Reload: doppi cambi bloccati e conferme tardive scartate su PDA, contratto, offerta, cluster o reset', async () => {
  for (const scenario of ['pda', 'contratto', 'offerta', 'cluster', 'categoria', 'reset']) {
    const ui = fixture(); ui.render({ reload_exchange: true });
    const field = ui.refs.reloadExchange; field.checked = false; const pending = field.change();
    field.checked = false; await field.change(); assert.equal(ui.questions.length, 1); assert.equal(field.checked, true);
    if (scenario === 'pda') ui.runtimeState.pdaRevision++;
    if (scenario === 'contratto') ui.runtimeState.editingTempId = 'other';
    if (scenario === 'offerta') ui.refs.offerta.value = 'other';
    if (scenario === 'cluster') ui.refs.cluster.value = 'Business';
    if (scenario === 'categoria') ui.setCategory('Fisso');
    if (scenario === 'reset') ui.render({ reload_exchange: true });
    ui.decide(true); await pending; assert.equal(field.checked, true); assert.equal(ui.saves, 0);
  }
});

test('Reload: carrello, payload di invio e backend conservano i due valori indipendenti', () => {
  const start = source.indexOf(' function buildInvioPayload()'), end = source.indexOf(' async function inviaPratica()', start);
  for (const category of ['Mobile', 'Customer Base']) for (const exchange of [true, false]) for (const forever of [true, false]) {
    const item = { codice_contratto: 'TEST001', codice_cliente: 'P0001', categoria_nome: category, categoria_id: 'cat', offerta_id: 'offer',
      costo_offerta_mensile: 12.99, numero_telefono: '3331234567', numero_provvisorio: null, portabilita: false, reload_exchange: exchange, reload_forever: forever, reload_forever_gestione: forever ? 'Mantieni attiva' : null, flags: {}, files: {} };
    const ctx = { window: { MiroxPda: Pda, MiroxIdentitaCore: require('../js/identita-upload-core'),
      MiroxIdentitaUpload: { get: () => ({ token: 'fixture', result: { cittadinanza: 'ue' } }) } },
      state: { cart: { contratti: [item] } }, getClienteFormData: () => ({ cluster: 'Consumer' }), validateClienteData() {},
      praticaFiles: { documento_identita: [{}] }, runtimeState: {}, refs: { originePratica: { value: 'spontaneo' }, operatoreId: { value: 'operator' } },
      CODICE_RIVENDITORE_DEFAULT: '9001415852' };
    vm.runInNewContext(source.slice(start, end) + ';this.payload=buildInvioPayload;', ctx);
    const saved = normalizeContractInput(ctx.payload().contratti[0], 0);
    assert.equal(saved.reload_exchange, exchange); assert.equal(saved.reload_forever, forever);
    assert.equal(saved.reload_forever_gestione, forever ? 'Mantieni attiva' : null);
  }
});
