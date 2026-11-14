'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../js/segnalazione-mobile-core');
const Api = require('../netlify/functions/apri-segnalazione-mobile')._test;
const Permissions = require('../js/mirox-permissions-core');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = id(1), CONTRACT = id(2), REQUEST = id(3), PRACTICE = id(4), CUSTOMER = id(5);
const DATE = '2026-11-14T08:00:00+00:00';
function fixture() {
  const docs = [6, 7, 8].map((n, i) => ({ id: id(n), contratto_id: CONTRACT, pratica_id: PRACTICE, anagrafica_id: CUSTOMER,
    storage_bucket: 'contratti-vendita', storage_path: `pratica/contratto/${n}.pdf`, file_name: i < 2 ? 'documento.pdf' : 'PDA.pdf', file_size: 123, sha256: 'a'.repeat(64), uploaded_at: DATE }));
  const tables = { vendita_contratti: [{ id: CONTRACT, pratica_id: PRACTICE, anagrafica_id: CUSTOMER, categoria_id: id(10), categoria_snapshot: 'Mobile', updated_at: DATE,
    codice_contratto: '0001234', numero_telefono: '3201234567' }], vendita_categorie: [{ id: id(10), nome: 'Mobile' }],
    anagrafica: [{ id: CUSTOMER, ragione_sociale: 'Cliente sintetico', cf_piva: '12345678901', nome_referente: 'Referente sintetico', cellulare: '3331234567', email: 'test@example.invalid', comune: 'Comune', via: 'Via Prova', civico: '1' }],
    vendita_documenti: docs, anagrafica_codici_cliente_windtre: [{ anagrafica_id: CUSTOMER, codice_cliente: '1.00234' }], segnalazioni_mobile_richieste: [], segnalazioni: [] };
  const calls = [], copies = new Map();
  const state = { failCopy: 0, copyCount: 0, failRead: '', failFinalize: false, loseReply: false, missingInfo: false, wrongSize: false, mutate: false, deny: false };
  const client = { from(table) {
    const filters = []; let changes, single = false;
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, order() { return q; }, maybeSingle() { single = true; return q; }, single() { single = true; return q; }, update(value) { changes = value; return q; },
      then(resolve, reject) {
        calls.push({ table, changes });
        if (state.failRead === table) return Promise.resolve({ error: new Error('Read failed') }).then(resolve, reject);
        const rows = tables[table].filter(row => filters.every(([k,v]) => row[k] === v));
        if (changes) rows.forEach(row => Object.assign(row, changes));
        return Promise.resolve({ data: single ? rows[0] || null : rows.map(row => ({ ...row })) }).then(resolve, reject);
      } }; return q;
  }, async rpc(name, args) {
    calls.push({ rpc: name });
    const rows = tables.segnalazioni_mobile_richieste;
    if (name === 'prepara_segnalazione_mobile') {
      let r = rows.find(row => row.id === args.p_id);
      if (r?.lease_id) return { error: { message: 'MOBILE_BUSY' } };
      if (r && r.sorgente_sha256 !== args.p_sorgente) return { error: { message: 'MOBILE_SOURCE_CHANGED' } };
      if (!r) { r = { id: args.p_id, created_by: args.p_autore, richiesta_sha256: args.p_richiesta, sorgente_sha256: args.p_sorgente,
        dati: args.p_dati, allegati: args.p_allegati, segnalazione_id: 42, completata: false }; rows.push(r); }
      r.lease_id = args.p_lease;
      return { data: { ...r } };
    }
    if (state.failFinalize) return { error: new Error('DB offline') };
    const r = rows.find(row => row.id === args.p_id);
    assert.equal(r.lease_id, args.p_lease);
    assert.equal(copies.size, docs.length);
    tables.segnalazioni.push({ id: r.segnalazione_id, ...r.dati }); r.completata = true;
    return state.loseReply ? { error: new Error('Reply lost') } : { data: r.segnalazione_id };
  }, storage: { from(bucket) { return {
    async copy(src, dst, options) {
      calls.push({ copy: src, dst, bucket, options });
      state.copyCount++;
      if (state.failCopy === state.copyCount) return { error: { statusCode: '503' } };
      if (copies.has(dst)) return { error: { statusCode: '400', error: 'Duplicate' } };
      copies.set(dst, { src, bucket });
      if (state.mutate) tables.anagrafica[0].ragione_sociale = 'Cliente aggiornato';
      return { data: { path: dst } };
    }, async info(path) { return { error: state.missingInfo ? new Error('Missing') : null, data: copies.has(path) ? { size: state.wrongSize ? 1 : 123 } : null }; }
  }; } } };
  const deps = { getAdminClient: () => client, requireAuth: async (_, options) => {
    assert.equal(options.endpoint, 'apri-segnalazione-mobile'); return { ok: true, user: { id: AUTHOR }, profilo: { nome: 'Autore login' } };
  }, authorizePages: async (_, auth, pages) => { calls.push({ pages }); return state.deny ? { ok: false, status: 403, error: 'Accesso negato' } : auth; } };
  const send = async (extra = {}, overrides = {}) => {
    const r = await Api.handle({ httpMethod: 'POST', body: JSON.stringify({ request_id: REQUEST, contratto_id: CONTRACT, expected_updated_at: DATE, motivo: 'Reload Forever', note: '', ...extra }), ...overrides }, deps);
    return { status: r.statusCode, ...JSON.parse(r.body) };
  };
  return { tables, docs, calls, copies, state, deps, send };
}

test('Mobile: note condizionali e mappatura delle tre scelte confermate dal proprietario', () => {
  for (const motivo of ['Reload Forever', 'Professional Cloud']) {
    assert.deepEqual(Core.validate({ motivo, note: '  ' }), { motivo, note: '' });
    assert.deepEqual(Core.gestione(motivo), { gestione_pratica: 'ASK', tipo_ask: 'Normalizzazione' });
  }
  assert.throws(() => Core.validate({ motivo: 'Altro', note: ' \n ' }), /Inserisci le note/);
  assert.deepEqual(Core.validate({ motivo: 'Altro', note: '  Dettaglio\naggiuntivo  ' }), { motivo: 'Altro', note: 'Dettaglio\naggiuntivo' });
  assert.deepEqual(Core.gestione('Altro'), { gestione_pratica: 'Interna negozio', tipo_ask: null });
  for (const value of [{ motivo: 'No' }, { motivo: 'Altro', note: {} }, { motivo: 'Altro', note: 'x'.repeat(4001) }]) assert.throws(() => Core.validate(value));
  for (const category of ['Fisso', 'Customer Base', 'Energia', 'Mobile inventato', '']) assert.equal(Core.isMobile(category), false);
});
for (const motivo of Core.MOTIVI) test(`Mobile: ${motivo} crea Da gestire con autore login, dati e tutti i tre allegati senza collisioni di nome`, async () => {
  const f = fixture(), note = 'Note supplementari\nSeconda riga';
  const r = await f.send({ motivo, note, ragione_sociale: 'Contraffatto', operatore: 'Contraffatto', allegati: ['path esterno'] });
  assert.equal(r.status, 200); assert.equal(r.segnalazione_id, 42); assert.equal(r.allegati, 3);
  const [row] = f.tables.segnalazioni;
  assert.equal(row.stato, 'Da gestire'); assert.equal(row.operatore, 'Autore login'); assert.equal(row.ragione_sociale, 'Cliente sintetico');
  assert.equal(row.codice_fiscale_piva, '12345678901'); assert.equal(row.numero_contatto, '3331234567');
  assert.deepEqual({ gestione_pratica: row.gestione_pratica, tipo_ask: row.tipo_ask }, Core.gestione(motivo));
  for (const text of [motivo, note, 'Referente sintetico', 'test@example.invalid', '1.00234', '0001234', '3201234567', 'Via Prova 1 Comune']) assert.ok(row.dettagli_segnalazione.includes(text));
  assert.equal(f.copies.size, 3);
  for (const call of f.calls.filter(c => c.copy)) { assert.equal(call.bucket, 'contratti-vendita'); assert.equal(call.options.destinationBucket, 'segnalazioni-files'); assert.match(call.dst, /^segnalazione_42\//); }
  assert.deepEqual(f.calls.find(c => c.pages).pages, ['segnalazioni']);
});
test('Mobile: stesso request_id dopo errore di copia riprende i file e crea una sola segnalazione', async () => {
  const f = fixture(); f.state.failCopy = 2;
  assert.equal((await f.send()).status, 503); assert.equal(f.tables.segnalazioni.length, 0); assert.equal(f.copies.size, 1);
  f.state.failCopy = 0;
  assert.equal((await f.send()).status, 200); assert.equal(f.copies.size, 3); assert.equal(f.tables.segnalazioni.length, 1);
  const copies = f.state.copyCount;
  assert.equal((await f.send()).status, 200); assert.equal(f.state.copyCount, copies); assert.equal(f.tables.segnalazioni.length, 1);
});
test('Mobile: perdita della risposta dopo commit recupera il successo senza duplicati né nuove copie', async () => {
  const f = fixture(); f.state.loseReply = true;
  assert.equal((await f.send()).status, 503); assert.equal(f.tables.segnalazioni.length, 1);
  f.state.loseReply = false;
  assert.equal((await f.send()).status, 200); assert.equal(f.tables.segnalazioni.length, 1); assert.equal(f.state.copyCount, 3);
  assert.equal((await f.send({ note: 'dati differenti' })).status, 409);
  f.deps.requireAuth = async () => ({ ok: true, user: { id: id(99) }, profilo: { nome: 'Altro autore' } });
  assert.equal((await f.send()).status, 409);
});
test('Mobile: errori di Storage/info, dimensione o DB non pubblicano una pratica incompleta', async () => {
  for (const flag of ['missingInfo', 'wrongSize', 'failFinalize']) {
    const f = fixture(); f.state[flag] = true;
    assert.equal((await f.send()).status, 503); assert.equal(f.tables.segnalazioni.length, 0);
    f.state[flag] = false; assert.equal((await f.send()).status, 200); assert.equal(f.tables.segnalazioni.length, 1);
  }
});
test('Mobile: input, categorie, relazione allegati e dati obsoleti bloccano le scritture', async () => {
  for (const mutate of [
    f => { f.tables.vendita_categorie[0].nome = 'Customer Base'; },
    f => { f.tables.vendita_contratti[0].categoria_snapshot = 'Fisso'; },
    f => { f.tables.vendita_contratti[0].updated_at = 'nuovo'; },
    f => { f.tables.anagrafica[0].ragione_sociale = ''; },
    f => { f.tables.vendita_documenti = []; },
    f => { f.docs[0].anagrafica_id = id(99); },
    f => { f.docs[0].storage_bucket = 'altro'; },
    f => { f.docs[0].storage_path = '../cliente.pdf'; }
  ]) {
    const f = fixture(); mutate(f); const r = await f.send();
    assert.ok([400,409].includes(r.status)); assert.equal(r.reset_request, true); assert.equal(f.copies.size, 0); assert.equal(f.tables.segnalazioni_mobile_richieste.length, 0);
  }
  const f = fixture();
  for (const body of [{ motivo: 'Altro' }, { request_id: 'no' }, { motivo: 'Altro', note: 'x'.repeat(4001) }]) assert.equal((await f.send(body)).status, 400);
  assert.equal((await f.send({}, { body: '{' })).status, 400);
  assert.equal(f.copies.size, 0);
});
test('Mobile: letture fallite e mutazioni durante la copia impediscono il completamento', async () => {
  for (const table of ['vendita_documenti', 'anagrafica', 'anagrafica_codici_cliente_windtre']) {
    const f = fixture(); f.state.failRead = table;
    assert.equal((await f.send()).status, 503); assert.equal(f.tables.segnalazioni.length, 0);
  }
  const f = fixture(); f.state.mutate = true;
  const r = await f.send(); assert.equal(r.status, 409); assert.equal(r.reset_request, true); assert.equal(f.tables.segnalazioni.length, 0);
});
test('Mobile: JWT e due ACL obbligatorie prima di leggere clienti o scrivere', async () => {
  const f = fixture(); f.deps.requireAuth = async () => ({ ok: false, status: 401, error: 'JWT mancante' });
  assert.equal((await f.send()).status, 401); assert.equal(f.calls.length, 0);
  const g = fixture(); g.state.deny = true; assert.equal((await g.send()).status, 403); assert.equal(g.calls.filter(c => c.table || c.rpc).length, 0);
  assert.deepEqual(Permissions.endpointPages('apri-segnalazione-mobile', {}), ['verifica_contratti']);
});

function uiFixture() {
  class Element {
    constructor() { this.value = ''; this.disabled = false; this.hidden = true; this.textContent = ''; this.handlers = {}; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    async emit(name) { return this.handlers[name]?.(); }
    focus() {}
  }
  const memory = new Map(), modals = [], confirmations = [], alerts = [], requests = [], navigations = [];
  const state = { yes: true, response: null, confirm: null, network: null };
  const root = { MiroxSegnalazioneMobileCore: Core, MiroxSafe: { escapeHtml: s => String(s).replace(/</g, '&lt;') },
    crypto: { randomUUID: crypto.randomUUID }, sessionStorage: { getItem: k => memory.get(k), setItem: (k,v) => memory.set(k,v), removeItem: k => memory.delete(k) },
    location: { assign: s => navigations.push(s) }, MiroxApi: { async fetch(url, options) { requests.push({ url, body: JSON.parse(options.body) }); return state.network ? state.network() : state.response || { ok: true, json: async () => ({ success: true, segnalazione_id: 42, allegati: 3 }) }; } },
    MiroxUI: { _build(opts) {
      const fields = Object.fromEntries(['#mobileSegMotivo','#mobileSegNote','[data-mobile-submit]','[data-mobile-cancel]','[data-mobile-progress]','[data-mobile-error]','[data-mobile-note-label]','[data-mobile-gestione]','.mx-modal-x'].map(k => [k,new Element()]));
      const find = { querySelector: key => fields[key], style: {} };
      const m = { opts, fields, modal: { style: {} }, body: find, foot: find, head: find, closed: false, close() { if (!opts.canClose()) return; m.closed = true; opts.onClose(); } }; modals.push(m); return m;
    }, async confirm(msg, opts) { confirmations.push({msg,opts}); return state.confirm ? state.confirm() : state.yes; }, async alert(msg, opts) { alerts.push({msg,opts}); } }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/verifica-segnalazione-mobile'), 'utf8'), { window: root });
  const contract = { id: CONTRACT, updated_at: DATE, categoria_snapshot: 'Mobile', anagrafica: { ragione_sociale: '<Cliente>' } };
  const open = c => root.MiroxSegnalazioneMobile.open(c || contract, { autore: AUTHOR });
  const choose = (m, motivo, note = '') => { m.fields['#mobileSegMotivo'].value = motivo; m.fields['#mobileSegNote'].value = note; return m.fields['#mobileSegMotivo'].emit('change'); };
  const submit = m => m.fields['[data-mobile-submit]'].emit('click');
  return { root, open, choose, submit, modals, memory, requests, navigations, confirmations, alerts, state };
}
test('Mobile popup: solo Mobile, tre scelte, Altro richiede note; No conserva i valori senza inviare', async () => {
  const f = uiFixture(); assert.equal(f.open({ categoria_snapshot: 'Customer Base' }), null);
  const m = f.open(); assert.equal(f.open(), m); assert.match(m.opts.bodyHtml, /&lt;Cliente>/);
  await f.choose(m, 'Altro', '   '); assert.equal(m.fields['#mobileSegNote'].required, true);
  await f.submit(m); assert.equal(f.confirmations.length, 0); assert.equal(f.requests.length, 0);
  await f.choose(m, 'Professional Cloud', 'Nota facoltativa'); assert.equal(m.fields['#mobileSegNote'].required, false);
  f.state.yes = false; await f.submit(m);
  assert.equal(f.requests.length, 0); assert.equal(m.closed, false); assert.equal(m.fields['#mobileSegNote'].value, 'Nota facoltativa');
  assert.equal(f.confirmations[0].opts.okText, 'Sì'); assert.equal(f.confirmations[0].opts.cancelText, 'No');
});
test('Mobile popup: sì blocca chiusura/doppio clic, mostra spinner e conferma solo dopo il successo', async () => {
  const f = uiFixture(), m = f.open(); await f.choose(m, 'Reload Forever');
  let resolve; f.state.network = () => new Promise(r => { resolve = r; });
  const sending = f.submit(m); await new Promise(r => setImmediate(r));
  assert.equal(m.fields['[data-mobile-progress]'].hidden, false); assert.equal(m.fields['#mobileSegMotivo'].disabled, true);
  m.close(); assert.equal(m.closed, false); await f.submit(m); assert.equal(f.requests.length, 1); assert.equal(f.alerts.length, 0);
  resolve({ ok: true, json: async () => ({ success: true, segnalazione_id: 42, allegati: 3 }) }); await sending;
  assert.equal(m.closed, true); assert.match(f.alerts[0].msg, /#42.*Da gestire.*3 allegati/);
  assert.equal(f.navigations[0], '/moduli/segnalazioni.html?segnalazione_id=42'); assert.equal(f.memory.size, 0);
});
test('Mobile popup: errore conserva richiesta e note anche riaprendo; retry recupera senza cambiare UUID', async () => {
  const f = uiFixture(), m = f.open(); await f.choose(m, 'Altro', 'Una nota');
  f.state.network = async () => { throw new Error('Rete interrotta'); }; await f.submit(m);
  assert.equal(m.closed, false); assert.equal(f.alerts.length, 0); assert.equal(m.fields['[data-mobile-progress]'].hidden, true);
  assert.equal(m.fields['#mobileSegNote'].disabled, true); m.close();
  const retry = f.open(); assert.equal(retry.fields['#mobileSegNote'].value, 'Una nota');
  f.state.network = null; await f.submit(retry);
  assert.equal(f.requests[0].body.request_id, f.requests[1].body.request_id); assert.equal(f.requests[1].body.note, 'Una nota');
});
test('Mobile popup: errore validazione sicuro consente correzione, risposta malformata non mostra successo', async () => {
  const f = uiFixture(), m = f.open(); await f.choose(m, 'Reload Forever', 'Nota');
  f.state.response = { ok: false, json: async () => ({ error: 'Riapri dettaglio', reset_request: true }) }; await f.submit(m);
  assert.equal(m.fields['#mobileSegMotivo'].disabled, false); assert.equal(f.memory.size, 0);
  f.state.response = { ok: true, json: async () => ({ success: true }) }; await f.submit(m);
  assert.equal(f.alerts.length, 0); assert.equal(f.navigations.length, 0); assert.equal(m.closed, false);
});
