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
  return { intestatario: 'CLIENTE DIMOSTRATIVO', cf_piva: 'RSSMRA80A01H501U', codice_contratto: '123456789', codice_cliente: '1.2343245', documento_numero: 'CA12345AA', numero_fisso: '0442123456', cellulare: '3331234567', email: 'cliente@example.test', documento_tipo: 'ci', tipo_segnalazione: 'sollecito', stato_linea: 'nuova', motivi: Object.fromEntries(Core.reasons.map(r => [r.key, r.key === (overrides.stato_linea === 'attiva' ? 'informazioni_false' : 'mai_contattato') ? 'si' : 'no'])), open_fiber: 'si', tim_prima: 'si', tim_seconda: 'no', conoscenza_cliente: 'si', descrizione: 'Esempio dimostrativo senza dati reali.\nIl tecnico non si è presentato.', primo_appuntamento: '2026-11-13T10:30', nuovo_appuntamento: '', data: '2026-11-13', ...overrides };
}
const AUTHOR = '10000000-0000-4000-8000-000000000001';
const REQUEST = '10000000-0000-4000-8000-000000000002';
function archiveFixture() {
  const rows = new Map(), uploads = [], removed = [], signed = [];
  const state = { uploadError: false, insertError: false, signedError: false };
  const client = { from(table) {
    assert.equal(table, 'malpractis_generati');
    let id, inserted, fields, range = [0, 49];
    const result = () => ({ data: [...rows.values()].slice(range[0], range[1] + 1).map(row => Object.fromEntries(fields.split(',').map(key => [key, row[key]]))), count: rows.size });
    return { select(value) { fields = value; return this; }, eq(_, value) { id = value; return this; }, order() { return this; }, range(a, b) { range = [a,b]; return Promise.resolve(result()); },
      async maybeSingle() { return { data: rows.get(id) || null }; },
      insert(row) { inserted = { ...row, created_at: '2026-11-13T11:00:00Z' }; return this; },
      async single() { if (state.insertError) return { error: new Error('Insert fallita') }; rows.set(inserted.id, inserted); return { data: Object.fromEntries(fields.split(',').map(key => [key, inserted[key]])) }; }
    };
  }, storage: { from(bucket) { assert.equal(bucket, 'malpractis-files'); return {
    async upload(path, bytes) { uploads.push({ path, bytes }); return { error: state.uploadError ? new Error('Upload fallito') : null }; },
    async remove(paths) { removed.push(...paths); return {}; },
    async createSignedUrl(path, ttl) { signed.push({ path, ttl }); return { data: state.signedError ? null : { signedUrl: 'https://example.test/stored.pdf' } }; }
  }; } } };
  return { client, rows, uploads, removed, signed, state, deps: { requireAuth: async () => ({ ok: true, user: { id: AUTHOR }, profilo: { nome: 'Operatore Test' } }), getAdminClient: () => client } };
}
test('ogni campo e scelta pertinente è validato; dati fissi indipendenti dal payload', () => {
  for (const f of Core.fields) assert.throws(() => Core.validate(payload({ [f.key]: '' })), /obbligatorio/);
  assert.deepEqual(Core.dealer, { ragione_sociale: 'KONA TECH', codice: '9001415852' });
  for (const [key, value] of [['cf_piva', 'errato'], ['email', 'errata'], ['cellulare', '+12'], ['data', '2026-02-30'], ['primo_appuntamento', '2026-11-13T25:20'], ['documento_tipo', 'inventato'], ['conoscenza_cliente', ''], ['descrizione', '']]) {
    assert.throws(() => Core.validate(payload({ [key]: value })));
  }
  assert.throws(() => Core.validate(payload({ motivi: {} })), /scelta/);
  assert.throws(() => Core.validate(payload({ motivi: Object.fromEntries(Core.reasons.map(r => [r.key, 'no'])) })), /un solo motivo/);
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
test('API impone ACL prima delle operazioni e archivia senza messaggi', async () => {
  let calls = 0;
  const event = { httpMethod: 'POST', body: JSON.stringify({ action: 'generate', modulo: payload() }) };
  const denied = await handle(event, { requireAuth: async (_, options) => { assert.equal(options.endpoint, 'gestisci-malpractis'); return { ok: false, status: 403, error: 'Negato' }; }, generate: () => { calls++; } });
  assert.equal(denied.statusCode, 403); assert.equal(calls, 0);
  const archive = archiveFixture(); const deps = { requireAuth: async () => ({ ok: true, user: { id: AUTHOR }, profilo: { nome: 'Operatore Test' } }), getAdminClient: () => archive.client };
  event.body = JSON.stringify({ action: 'generate', request_id: REQUEST, modulo: payload() });
  const result = await handle(event, deps);
  assert.equal(result.statusCode, 200); assert.ok(JSON.parse(result.body).signed_url); assert.equal(result.headers['Cache-Control'], 'no-store');
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
  const ids = ['compilerForm', 'searchCard', 'formCard', 'searchForm', 'searchButton', 'searchInput', 'searchState', 'searchResults', 'customerFields', 'reportFields', 'reasonFields', 'reasonSection', 'reasonLegend', 'operatorSection', 'operatorFields', 'compilerPanel', 'historyPanel', 'historyRows', 'historyState', 'tabCompiler', 'tabHistory', 'refreshHistory', 'loadMoreHistory', 'customerSummary', 'changeCustomer', 'generateState', 'generateButton', 'downloadPdf', 'descrizione', 'primo_appuntamento', 'nuovo_appuntamento', 'data'];
  const document = documentFixture(ids), $ = id => document.getElementById(id);
  const originalCreate = document.createElement;
  document.createElement = tag => { const node = originalCreate(tag); node.removeAttribute = key => delete node.attributes[key]; node.focus = () => {}; return node; };
  for (const id of ids) { $(id).removeAttribute = key => delete $(id).attributes[key]; $(id).focus = () => {}; }
  const all = () => { const nodes = []; const visit = n => { nodes.push(n); n.children.forEach(visit); }; visit(document.body); return nodes; };
  const compiler = $('compilerForm');
  compiler.querySelectorAll = selector => selector === 'input,select,textarea,button'
    ? all().filter(n => n.name || n.id === 'generateButton') : Element.prototype.querySelectorAll.call(compiler, selector);
  $('compilerForm').reset = () => { for (const n of all()) if (n.name) { if (n.type === 'radio') n.checked = false; else n.value = ''; } };
  $('compilerForm').reportValidity = $('searchForm').reportValidity = () => true;
  for (const id of ['descrizione', 'primo_appuntamento', 'nuovo_appuntamento', 'data']) $(id).name = id;
  const requests = [], alerts = [];
  const context = { document, MalpractisCore: Core, Auth: { richiediAuth: async () => ({}) }, MiroxUI: { alert: async value => alerts.push(value) }, MiroxApi: { fetch: (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject })) }, Intl, Date, FormData: class { constructor() { return all().filter(n => n.name && !n.disabled).map(n => [n.name, n.value])[Symbol.iterator](); } }, Uint8Array, Blob, atob, URL: { createObjectURL: () => 'https://example.test/demo.pdf', revokeObjectURL() {} }, addEventListener() {} };
  // FormData è un iterabile, come nel browser.
  context.FormData = class { *[Symbol.iterator]() { for (const n of all()) if (n.name && !n.disabled && (n.type !== 'radio' || n.checked)) yield [n.name, n.value]; } };
  context.window = context;
  context.AbortSignal = AbortSignal; context.crypto = require('node:crypto'); context.URL = URL;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/mirox-safe.js'), 'utf8'), context);
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
  await b.emit('stato_linea', 'change');
  b.$('motivo_informazioni_false').checked = true;
  assert.equal(b.$('tim_prima').disabled, false); assert.equal(b.$('tim_seconda').disabled, false);
  assert.equal(b.$('open_fiber').disabled, true); assert.equal(b.$('open_fiber').value, '');
  const first = b.emit('compilerForm', 'submit'); await b.emit('compilerForm', 'submit');
  assert.equal(b.requests.length, 2); assert.equal(b.$('changeCustomer').disabled, true);
  b.respond(1, { error: 'Errore temporaneo' }, false); await first;
  assert.equal(b.$('intestatario').value, p.intestatario); assert.equal(b.$('generateButton').disabled, false);
  const retry = b.emit('compilerForm', 'submit'); b.respond(2, { success: true, signed_url: 'https://example.test/demo.pdf' }); await retry;
  assert.equal(b.$('downloadPdf').hidden, false); assert.equal(b.$('downloadPdf').href, 'https://example.test/demo.pdf');
  await b.emit('compilerForm', 'input'); assert.equal(b.$('downloadPdf').hidden, true);
  await b.emit('changeCustomer', 'click'); assert.equal(b.$('formCard').hidden, true); assert.equal(b.$('intestatario').value, '');
});

test('selezione unica: rifiuta più problematiche e voci della colonna opposta', () => {
  const p = payload(); p.motivi.tecnico_assente = 'si';
  assert.throws(() => Core.validate(p), /un solo motivo/);
  p.motivi.tecnico_assente = 'no'; p.motivi.informazioni_false = 'si';
  assert.throws(() => Core.validate(p), /stato della linea/);
});
test('ogni problematica genera soltanto la propria crocetta nella colonna corretta', async () => {
  const { decodePDFRawStream } = require('pdf-lib/cjs/core/streams/decode');
  for (const reason of Core.reasons) {
    const p = payload({ stato_linea: reason.group, motivi: Object.fromEntries(Core.reasons.map(r => [r.key, r.key === reason.key ? 'si' : 'no'])) });
    const generated = await generateMalpractisPdf(p), doc = await PDFDocument.load(generated.buffer);
    const contents = doc.getPage(0).node.Contents();
    // Considera tutti gli stream, perché pdf-lib separa apertura/chiusura dello stato grafico.
    const joined = Array.from({length: contents.size()}, (_,i) => Buffer.from(decodePDFRawStream(doc.context.lookup(contents.get(i))).decode()).toString()).join('\n');
    for (const r of Core.reasons) {
      const y = Number((841.89 - r.top - 1).toFixed(2));
      const positions = [...joined.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm/g)];
      assert.equal(positions.some(m => Math.abs(Number(m[1]) - r.x + 2.5) < .001 && Math.abs(Number(m[2]) - y) < .001), r.key === reason.key, `${reason.key}/${r.key}`);
    }
  }
});
test('archivio: retry idempotente, autore server, listing senza snapshot e duplicazione', async () => {
  const a = archiveFixture(), event = { httpMethod: 'POST', body: JSON.stringify({ action: 'generate', request_id: REQUEST, modulo: payload(), created_by: 'inventato' }) };
  assert.equal((await handle(event, a.deps)).statusCode, 200);
  assert.equal((await handle(event, a.deps)).statusCode, 200);
  assert.equal(a.uploads.length, 1); assert.equal(a.rows.size, 1); assert.equal(a.rows.get(REQUEST).created_by, AUTHOR);
  assert.equal(a.signed[0].ttl, 300);
  const list = JSON.parse((await handle({ httpMethod: 'GET', queryStringParameters: { action: 'list' } }, a.deps)).body);
  assert.equal(list.moduli.length, 1); assert.equal(list.moduli[0].dati_compilazione, undefined); assert.equal(list.moduli[0].storage_path, undefined);
  const copy = JSON.parse((await handle({ ...event, body: JSON.stringify({ action: 'duplicate_data', id: REQUEST }) }, a.deps)).body);
  assert.equal(copy.modulo.cf_piva, payload().cf_piva);
  assert.equal((await handle({ ...event, body: JSON.stringify({ action: 'signed_url', id: REQUEST }) }, a.deps)).statusCode, 200);
  assert.equal((await handle({ ...event, body: JSON.stringify({ action: 'generate', request_id: REQUEST, modulo: payload({ intestatario: 'ALTRO CLIENTE' }) }) }, a.deps)).statusCode, 409);
  assert.equal((await handle(event, { ...a.deps, requireAuth: async () => ({ ok: true, user: { id: 'altro-account' } }) })).statusCode, 409);
});
test('fallimenti upload/registro/firma non producono storico falso o duplicati al retry', async () => {
  const event = { httpMethod: 'POST', body: JSON.stringify({ action: 'generate', request_id: REQUEST, modulo: payload() }) };
  for (const failure of ['uploadError', 'insertError']) {
    const a = archiveFixture(); a.state[failure] = true;
    assert.equal((await handle(event, a.deps)).statusCode, 503); assert.equal(a.rows.size, 0);
    assert.equal(a.removed.length, failure === 'insertError' ? 1 : 0);
  }
  const a = archiveFixture(); a.state.signedError = true;
  assert.equal((await handle(event, a.deps)).statusCode, 503); assert.equal(a.rows.size, 1);
  a.state.signedError = false;
  assert.equal((await handle(event, a.deps)).statusCode, 200); assert.equal(a.uploads.length, 1);
});
test('DOM elenco radio filtrato: cambio linea elimina il motivo precedente', async () => {
  const b = browserFixture(); await b.ready;
  b.$('stato_linea').value = 'nuova'; await b.emit('stato_linea', 'change');
  for (const r of Core.reasons) { const input = b.$(`motivo_${r.key}`); assert.equal(input.type, 'radio'); assert.equal(input.name, 'motivo'); assert.equal(input.disabled, r.group !== 'nuova'); }
  b.$('motivo_mai_contattato').checked = true;
  b.$('stato_linea').value = 'attiva'; await b.emit('stato_linea', 'change');
  assert.equal(b.$('motivo_mai_contattato').checked, false);
  assert.equal(b.$('motivo_mai_contattato').disabled, true);
  assert.equal(b.$('motivo_informazioni_false').disabled, false);
  assert.equal(b.$('motivo_informazioni_false').checked, false);
});
test('DOM storico: errore distinto da vuoto, rendering sicuro, duplicazione dopo ricerca stessa anagrafica', async () => {
  const b = browserFixture(); await b.ready;
  const load = b.emit('tabHistory', 'click');
  b.respond(0, { error: 'Storico non disponibile' }, false); await new Promise(setImmediate);
  assert.equal(b.$('historyState').textContent, 'Storico non disponibile');
  const retry = b.emit('refreshHistory', 'click');
  b.respond(1, { success: true, moduli: [{ id: REQUEST, intestatario: '<Cliente>', cf_piva: payload().cf_piva, numero_fisso: '0442123456', stato_linea: 'nuova', created_at: '2026-11-13T11:00:00Z' }], has_more: false }); await new Promise(setImmediate);
  assert.equal(b.$('historyRows').children[0].children[1].textContent, '<Cliente>');
  const duplicate = b.$('historyRows').children[0].children[5].children[1].click();
  b.respond(2, { success: true, modulo: Core.validate(payload()) }); await duplicate;
  assert.equal(b.$('formCard').hidden, true); assert.equal(b.$('searchInput').value, payload().cf_piva);
  const find = b.emit('searchForm', 'submit'); b.respond(3, { success: true, anagrafiche: [{ display_name: 'Cliente', cf_piva: payload().cf_piva, prefill: { intestatario: 'Cliente' } }] }); await find;
  await b.$('searchResults').children[0].click();
  assert.equal(b.$('intestatario').value, payload().intestatario); assert.equal(b.$('descrizione').value, payload().descrizione);
  assert.equal(b.$('motivo_mai_contattato').checked, true); assert.equal(b.$('motivo_informazioni_false').checked, false);
});
