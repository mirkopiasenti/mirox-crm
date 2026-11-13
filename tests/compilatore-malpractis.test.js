'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PDFDocument } = require('pdf-lib');
const { extractText } = require('unpdf');
const Core = require('../js/malpractis-core');
const Permissions = require('../js/mirox-permissions-core');
const { generateMalpractisPdf, templatePath } = require('../netlify/functions/_lib/pdf-malpractis');
const { handle, search } = require('../netlify/functions/gestisci-malpractis')._test;
const { documentFixture, Element } = require('./permissions-dom-helper');
const ROOT = path.resolve(__dirname, '..');
function payload(overrides = {}) {
  return { intestatario: 'CLIENTE DIMOSTRATIVO', cf_piva: 'RSSMRA80A01H501U', codice_contratto: '123456789', codice_cliente: '1.2343245', documento_numero: 'CA12345AA', numero_fisso: '0442123456', cellulare: '3331234567', email: 'cliente@example.test', documento_tipo: 'ci', tipo_segnalazione: 'sollecito', stato_linea: 'nuova', motivi: Object.fromEntries(Core.reasons.map(r => [r.key, 'si'])), open_fiber: 'si', tim_prima: 'si', tim_seconda: 'no', conoscenza_cliente: 'si', descrizione: 'Esempio dimostrativo senza dati reali.\nIl tecnico non si è presentato.', primo_appuntamento: '2026-11-13T10:30', nuovo_appuntamento: '', data: '2026-11-13', ...overrides };
}
test('ogni campo e scelta pertinente è validato; dati fissi indipendenti dal payload', () => {
  for (const f of Core.fields) assert.throws(() => Core.validate(payload({ [f.key]: '' })), /obbligatorio/);
  assert.deepEqual(Core.dealer, { ragione_sociale: 'KONA TECH', codice: '9001415852' });
  for (const [key, value] of [['cf_piva', 'errato'], ['email', 'errata'], ['cellulare', '+12'], ['data', '2026-02-30'], ['primo_appuntamento', '2026-11-13T25:20'], ['documento_tipo', 'inventato'], ['conoscenza_cliente', ''], ['descrizione', '']]) {
    assert.throws(() => Core.validate(payload({ [key]: value })));
  }
  assert.throws(() => Core.validate(payload({ motivi: {} })), /scelta/);
  assert.throws(() => Core.validate(payload({ motivi: Object.fromEntries(Core.reasons.map(r => [r.key, 'no'])) })), /almeno un motivo/);
  const data = Core.validate(payload({ codice: 'altro', ragione_sociale: 'altro', stato_linea: 'attiva', tim_prima: 'no', tim_seconda: 'si' }));
  assert.equal(data.motivi.mai_contattato, 'no'); assert.equal(data.open_fiber, 'no');
  assert.equal(data.tim_prima, 'no'); assert.equal(data.tim_seconda, 'si');
  assert.equal(data.codice, undefined);
  assert.throws(() => Core.validate(payload({ stato_linea: 'attiva', tim_seconda: '' })), /seconda casella/);
});
test('prefill CRM solo dei dati presenti, senza inventare contratto o documento', () => {
  assert.deepEqual(Core.prefill({ ragione_sociale: 'AZIENDA TEST', cf_piva: '12345678901', cellulare: '3331234567', email: 'test@example.test' }), { intestatario: 'AZIENDA TEST', cf_piva: '12345678901', cellulare: '3331234567', email: 'test@example.test' });
});
test('PDF originale invariato e output a una pagina, dati fissi, celle e due TIM indipendenti', async () => {
  const before = fs.readFileSync(templatePath());
  for (const [first, second] of [['si', 'no'], ['no', 'si'], ['si', 'si']]) {
    const generated = await generateMalpractisPdf(payload({ stato_linea: 'attiva', tim_prima: first, tim_seconda: second }));
    const doc = await PDFDocument.load(generated.buffer);
    assert.equal(doc.getPageCount(), 1);
    const { text } = await extractText(new Uint8Array(generated.buffer), { mergePages: true });
    for (const value of ['KONA TECH', '9001415852', '1.2343245', 'CLIENTE DIMOSTRATIVO', '13/11/2026 - 10:30']) assert.ok(text.includes(value), value);
    // Gli stream aggiunti contengono le crocette alle due coordinate distinte.
    const streams = doc.getPage(0).node.Contents();
    const { decodePDFRawStream } = require('pdf-lib/cjs/core/streams/decode');
    const output = Array.from({ length: streams.size() }, (_, i) => decodePDFRawStream(doc.context.lookup(streams.get(i))).decode()).map(b => Buffer.from(b).toString()).join('\n');
    assert.equal(output.includes('303 370.19 Tm'), first === 'si');
    assert.equal(output.includes('303 354.09 Tm'), second === 'si');
  }
  assert.deepEqual(fs.readFileSync(templatePath()), before);
});
test('testi troppo lunghi non vengono troncati o sovrapposti al modulo', async () => {
  await assert.rejects(generateMalpractisPdf(payload({ descrizione: 'testo lungo '.repeat(99) })), /Descrizione troppo lunga/);
  await assert.rejects(generateMalpractisPdf(payload({ codice_contratto: 'W'.repeat(40) })), /Testo troppo lungo/);
  await assert.rejects(generateMalpractisPdf(payload({ descrizione: 'W'.repeat(200) })), /parola troppo lunga/);
});
test('API impone ACL prima di qualunque lettura e genera senza archivi o messaggi', async () => {
  let calls = 0;
  const event = { httpMethod: 'POST', body: JSON.stringify({ action: 'generate', modulo: payload() }) };
  const denied = await handle(event, { requireAuth: async (_, options) => { assert.equal(options.endpoint, 'gestisci-malpractis'); return { ok: false, status: 403, error: 'Negato' }; }, generate: () => { calls++; } });
  assert.equal(denied.statusCode, 403); assert.equal(calls, 0);
  const deps = { requireAuth: async () => ({ ok: true }), getAdminClient: () => { throw new Error('Generazione senza DB'); } };
  const result = await handle(event, deps);
  assert.equal(result.statusCode, 200); assert.ok(JSON.parse(result.body).pdf_base64); assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal((await handle({ ...event, body: '{' }, deps)).statusCode, 400);
  assert.equal((await handle({ ...event, body: JSON.stringify({ action: 'generate', modulo: {} }) }, deps)).statusCode, 400);
  assert.equal((await handle({ ...event, httpMethod: 'DELETE' }, deps)).statusCode, 405);
  assert.deepEqual(Permissions.endpointPages('gestisci-malpractis'), ['compilatore_malpractis']);
});
test('ricerca deduplica, limita i dati, distingue guasti da assenza e rifiuta wildcard sole', async () => {
  let fail = false;
  const row = { id: 'id', ragione_sociale: '<Cliente>', cf_piva: '12345678901', email: 'cliente@example.test' };
  const client = { from(table) { assert.equal(table, 'anagrafica'); return { select(fields) { assert.equal(fields, 'id,cf_piva,ragione_sociale,nome_referente,cellulare,email'); return this; }, ilike() { return this; }, async limit(n) { assert.equal(n, 12); return { data: [row], error: fail ? new Error('DB') : null }; } }; } };
  assert.equal((await search(client, 'Cliente')).length, 1);
  await assert.rejects(search(client, '%%'), /non valida/);
  fail = true; await assert.rejects(search(client, 'Cliente'), /Impossibile/);
});
function browserFixture() {
  const ids = ['compilerForm', 'searchCard', 'formCard', 'searchForm', 'searchButton', 'searchInput', 'searchState', 'searchResults', 'customerFields', 'reportFields', 'reasonFields', 'customerSummary', 'changeCustomer', 'generateState', 'generateButton', 'downloadPdf', 'descrizione', 'primo_appuntamento', 'nuovo_appuntamento', 'data'];
  const document = documentFixture(ids), $ = id => document.getElementById(id);
  const originalCreate = document.createElement;
  document.createElement = tag => { const node = originalCreate(tag); node.removeAttribute = key => delete node.attributes[key]; node.focus = () => {}; return node; };
  for (const id of ids) { $(id).removeAttribute = key => delete $(id).attributes[key]; $(id).focus = () => {}; }
  const all = () => { const nodes = []; const visit = n => { nodes.push(n); n.children.forEach(visit); }; visit(document.body); return nodes; };
  const compiler = $('compilerForm');
  compiler.querySelectorAll = selector => selector === 'input,select,textarea,button'
    ? all().filter(n => n.name || n.id === 'generateButton') : Element.prototype.querySelectorAll.call(compiler, selector);
  $('compilerForm').reset = () => { for (const n of all()) if (n.name) n.value = ''; };
  $('compilerForm').reportValidity = $('searchForm').reportValidity = () => true;
  for (const id of ['descrizione', 'primo_appuntamento', 'nuovo_appuntamento', 'data']) $(id).name = id;
  const requests = [], alerts = [];
  const context = { document, MalpractisCore: Core, Auth: { richiediAuth: async () => ({}) }, MiroxUI: { alert: async value => alerts.push(value) }, MiroxApi: { fetch: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) }, Intl, Date, FormData: class { constructor() { return all().filter(n => n.name && !n.disabled).map(n => [n.name, n.value])[Symbol.iterator](); } }, Uint8Array, Blob, atob, URL: { createObjectURL: () => 'blob:demo', revokeObjectURL() {} }, addEventListener() {} };
  // FormData è un iterabile, come nel browser.
  context.FormData = class { *[Symbol.iterator]() { for (const n of all()) if (n.name && !n.disabled) yield [n.name, n.value]; } };
  context.window = context;
  context.AbortSignal = AbortSignal;
  const ready = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/compilatore-malpractis.js'), 'utf8'), context);
  const emit = async (id, event) => { for (const fn of $(id).handlers[event] || []) await fn({ preventDefault() {}, target: $(id) }); };
  const respond = (i, data, ok = true) => requests[i].resolve({ ok, json: async () => data });
  return { $, emit, ready, requests, respond, alerts };
}
test('DOM reale dei listener: ricerca prima dei dati, risposte obsolete ignorate e errore senza bypass', async () => {
  const b = browserFixture(); await b.ready;
  b.$('searchInput').value = 'Cliente'; const old = b.emit('searchForm', 'submit');
  await b.emit('searchInput', 'input'); b.$('searchInput').value = 'Nuovo';
  const current = b.emit('searchForm', 'submit');
  b.respond(0, { success: true, anagrafiche: [] }); await old;
  assert.equal(b.$('formCard').hidden, true);
  b.respond(1, { error: 'Errore ricerca' }, false); await current;
  assert.equal(b.$('formCard').hidden, true); assert.equal(b.$('searchState').textContent, 'Errore ricerca');
  const retry = b.emit('searchForm', 'submit'); b.respond(2, { success: true, anagrafiche: [] }); await retry;
  assert.equal(b.$('formCard').hidden, false); assert.equal(b.$('intestatario').value, '');
});
test('DOM selezione sicura, due TIM separate, reset, doppio click e retry generazione', async () => {
  const b = browserFixture(); await b.ready;
  b.$('searchInput').value = 'Cliente'; const find = b.emit('searchForm', 'submit');
  b.respond(0, { success: true, anagrafiche: [{ display_name: '<Cliente>', cf_piva: '12345678901', prefill: { intestatario: '<Cliente>' } }] }); await find;
  await b.$('searchResults').children[0].click();
  assert.equal(b.$('intestatario').value, '<Cliente>');
  const p = payload({ stato_linea: 'attiva' });
  for (const [key, value] of Object.entries(p)) if (b.$(key)) b.$(key).value = value;
  for (const r of Core.reasons) b.$(r.key).value = 'si';
  await b.emit('stato_linea', 'change');
  assert.equal(b.$('tim_prima').disabled, false); assert.equal(b.$('tim_seconda').disabled, false);
  assert.equal(b.$('open_fiber').disabled, true); assert.equal(b.$('open_fiber').value, '');
  const first = b.emit('compilerForm', 'submit'); await b.emit('compilerForm', 'submit');
  assert.equal(b.requests.length, 2); assert.equal(b.$('changeCustomer').disabled, true);
  b.respond(1, { error: 'Errore temporaneo' }, false); await first;
  assert.equal(b.$('intestatario').value, p.intestatario); assert.equal(b.$('generateButton').disabled, false);
  const retry = b.emit('compilerForm', 'submit'); b.respond(2, { success: true, pdf_base64: 'JVBERg==', nome_file: 'demo.pdf' }); await retry;
  assert.equal(b.$('downloadPdf').hidden, false); assert.equal(b.$('downloadPdf').href, 'blob:demo');
  await b.emit('compilerForm', 'input'); assert.equal(b.$('downloadPdf').hidden, true);
  await b.emit('changeCustomer', 'click'); assert.equal(b.$('formCard').hidden, true); assert.equal(b.$('intestatario').value, '');
});
