'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Core = require('../js/segnalazione-mobile-core');
const Api = require('../netlify/functions/apri-segnalazione-mobile')._test;
const Permissions = require('../js/mirox-permissions-core');
const { authorizePages } = require('../netlify/functions/_lib/page-permissions');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AUTHOR = id(1), CONTRACT = id(2), REQUEST = id(3), PRACTICE = id(4), CUSTOMER = id(5);
const DATE = '2026-11-14T08:00:00+00:00';
function fixture(category = 'Mobile') {
  const docs = [6, 7, 8].map((n, i) => ({ id: id(n), contratto_id: CONTRACT, pratica_id: PRACTICE, anagrafica_id: CUSTOMER,
    storage_bucket: 'contratti-vendita', storage_path: `pratica/contratto/${n}.pdf`, file_name: i < 2 ? 'documento.pdf' : 'PDA.pdf', file_size: 123, sha256: 'a'.repeat(64), uploaded_at: DATE }));
  const tables = { vendita_contratti: [{ id: CONTRACT, pratica_id: PRACTICE, anagrafica_id: CUSTOMER, categoria_id: id(10), categoria_snapshot: category, updated_at: DATE,
    codice_contratto: '0001234', numero_telefono: '3201234567' }], vendita_categorie: [{ id: id(10), nome: category }],
    anagrafica: [{ id: CUSTOMER, ragione_sociale: 'Cliente sintetico', cf_piva: '12345678901', nome_referente: 'Referente sintetico', cellulare: '3331234567', email: 'test@example.invalid', comune: 'Comune', via: 'Via Prova', civico: '1' }],
    vendita_documenti: docs, anagrafica_codici_cliente_windtre: [{ anagrafica_id: CUSTOMER, codice_cliente: '1.00234' }], segnalazioni_mobile_richieste: [], segnalazioni: [],
    profili: [{ id: AUTHOR, nome: 'Autore login', ruolo: 'operatore', attivo: true }],
    mirox_permessi_utente: [{ utente_id: AUTHOR, pagine: { verifica_contratti: true, segnalazioni: false }, versione: 1 }] };
  const calls = [], copies = new Map();
  const state = { failCopy: 0, copyCount: 0, failRead: '', failFinalize: false, loseReply: false, missingInfo: false, wrongSize: false, mutate: false };
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
  const deps = { getAdminClient: () => client, requireAuth: async (event, options) => {
    assert.equal(options.endpoint, 'apri-segnalazione-mobile');
    return authorizePages(client, { ok: true, user: { id: AUTHOR }, profilo: { nome: 'Profilo in cache' } }, Permissions.endpointPages(options.endpoint, event));
  } };
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
test('Fisso: sole Professional Cloud e Altro, mai Reload; note e gestione come Mobile',()=>{
  assert.deepEqual(Core.motivi('Fisso'),['Professional Cloud','Altro']);
  assert.deepEqual(Core.motivi('Mobile'),Core.MOTIVI);
  assert.equal(Core.isSupported(' FISSO '),true);assert.equal(Core.isSupported('Energia'),false);
  assert.deepEqual(Core.validate({motivo:'Professional Cloud',note:'  '},'Fisso'),{motivo:'Professional Cloud',note:''});
  assert.throws(()=>Core.validate({motivo:'Altro'},'Fisso'),/Inserisci le note/);
  for(const motivo of ['Reload Forever','Reload Basic','Reload Exchange'])assert.throws(()=>Core.validate({motivo},'Fisso'),/motivo/);
});
for(const motivo of ['Professional Cloud','Altro'])test(`Fisso: ${motivo} crea la segnalazione con dati, riferimento Fisso e tutti gli allegati`,async()=>{
  const f=fixture('Fisso'),note=motivo==='Altro'?'Nota necessaria':'';
  const result=await f.send({motivo,note});assert.equal(result.status,200);
  const row=f.tables.segnalazioni[0];assert.equal(row.stato,'Da gestire');
  assert.deepEqual({gestione_pratica:row.gestione_pratica,tipo_ask:row.tipo_ask},Core.gestione(motivo));
  assert.ok(row.dettagli_segnalazione.includes('Contratto Fisso: 0001234'));
  assert.ok(row.dettagli_segnalazione.includes(motivo));assert.ok(row.dettagli_segnalazione.includes('1.00234'));
  if(note)assert.ok(row.dettagli_segnalazione.includes(note));
  assert.equal(row.operatore,'Autore login');assert.equal(row.ragione_sociale,'Cliente sintetico');assert.equal(f.copies.size,3);
  assert.equal(f.tables.mirox_permessi_utente[0].pagine.segnalazioni,false);
});
test('Fisso: categoria forgiata non abilita Reload e non prenota richieste o copie',async()=>{
  const f=fixture('Fisso');const r=await f.send({motivo:'Reload Forever',categoria_snapshot:'Mobile'});
  assert.equal(r.status,400);assert.equal(r.reset_request,true);assert.equal(f.copies.size,0);
  assert.equal(f.tables.segnalazioni_mobile_richieste.length,0);assert.equal(f.calls.some(c=>c.rpc),false);
  assert.equal((await f.send({motivo:'Altro',note:' '})).status,400);
});
test('Customer Base: Reload Forever e Altro creano Da gestire con i dati e gli allegati del contratto', async () => {
  const cases = [
    { motivo: 'Reload Forever', note: '', gestione_pratica: 'ASK', tipo_ask: 'Normalizzazione' },
    { motivo: 'Altro', note: 'Dettaglio della richiesta', gestione_pratica: 'Interna negozio', tipo_ask: null }
  ];
  for (const { motivo, note, gestione_pratica, tipo_ask } of cases) {
    const f = fixture('Customer Base');
    const result = await f.send({ motivo, note });
    assert.equal(result.status, 200);
    assert.equal(result.allegati, 3);
    const [row] = f.tables.segnalazioni;
    assert.equal(row.stato, 'Da gestire');
    assert.equal(row.gestione_pratica, gestione_pratica);
    assert.equal(row.tipo_ask, tipo_ask);
    assert.match(row.dettagli_segnalazione, /Contratto Customer Base: 0001234/);
    assert.ok(row.dettagli_segnalazione.includes(motivo));
    if (note) assert.ok(row.dettagli_segnalazione.includes(note));
    assert.equal(f.copies.size, 3);
  }
});
test('Customer Base: Professional Cloud, Altro senza nota e categorie incoerenti non creano segnalazioni', async () => {
  const f = fixture('Customer Base');
  assert.equal((await f.send({ motivo: 'Professional Cloud', categoria_snapshot: 'Mobile' })).status, 400);
  assert.equal((await f.send({ motivo: 'Altro', note: ' ' })).status, 400);
  f.tables.vendita_categorie[0].nome = 'Mobile';
  assert.equal((await f.send()).status, 400);
  assert.equal(f.calls.some(call => call.rpc || call.copy), false);
});
test('Fisso: copia parziale e risposta persa recuperano la stessa richiesta senza duplicare segnalazioni',async()=>{
  const f=fixture('Fisso');f.state.failCopy=2;
  assert.equal((await f.send({motivo:'Professional Cloud'})).status,503);assert.equal(f.copies.size,1);assert.equal(f.tables.segnalazioni.length,0);
  f.state.failCopy=0;f.state.loseReply=true;
  assert.equal((await f.send({motivo:'Professional Cloud'})).status,503);assert.equal(f.tables.segnalazioni.length,1);
  f.state.loseReply=false;assert.equal((await f.send({motivo:'Professional Cloud'})).status,200);
  assert.equal(f.tables.segnalazioni.length,1);assert.equal(f.copies.size,3);
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
  assert.equal(f.tables.mirox_permessi_utente[0].pagine.segnalazioni, false);
  assert.equal(Permissions.can(f.tables.profili[0], f.tables.mirox_permessi_utente[0].pagine, 'segnalazioni'), false);
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
test('Mobile: JWT e ACL Verifica fresche obbligatorie; Segnalazioni da sola non abilita l’apertura', async () => {
  const f = fixture(); f.deps.requireAuth = async () => ({ ok: false, status: 401, error: 'JWT mancante' });
  assert.equal((await f.send()).status, 401); assert.equal(f.calls.length, 0);
  const g = fixture(); g.tables.mirox_permessi_utente[0].pagine = { verifica_contratti: false, segnalazioni: true };
  assert.equal((await g.send()).status, 403);
  assert.equal(g.calls.filter(c => c.rpc || (c.table && !['profili','mirox_permessi_utente'].includes(c.table))).length, 0);
  assert.deepEqual(Permissions.endpointPages('apri-segnalazione-mobile', {}), ['verifica_contratti']);
});

test('Mobile: revoca Verifica, account disabilitato o errore ACL bloccano anche il retry già completato', async () => {
  for (const change of [f => { f.tables.mirox_permessi_utente[0].pagine.verifica_contratti = false; },
    f => { f.tables.profili[0].attivo = false; }, f => { f.state.failRead = 'mirox_permessi_utente'; }]) {
    const f = fixture(); assert.equal((await f.send()).status, 200); change(f); f.calls.length = 0;
    assert.ok([403,503].includes((await f.send()).status));
    assert.equal(f.calls.filter(c => c.rpc || (c.table && !['profili','mirox_permessi_utente'].includes(c.table))).length, 0);
    assert.equal(f.tables.segnalazioni.length, 1); assert.equal(f.state.copyCount, 3);
  }
});

test('Pulsante visibile nelle categorie supportate con sola Verifica Contratti', () => {
  const page = fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'), 'utf8');
  const line = page.split('\n').find(s => s.includes('data-apri-segnalazione-mobile>'));
  const condition = line.slice(line.indexOf('${') + 2, line.indexOf(" ? '<div"));
  for (const pages of [{ verifica_contratti: true, segnalazioni: false }, { verifica_contratti: false, segnalazioni: true }, {}]) {
    const profile = { ruolo: 'operatore', attivo: true };
    const allowedPath = path => Permissions.can(profile, pages, Permissions.pageForPath(path).key);
    const context = { window: { MiroxSegnalazioneMobileCore: Core, MiroxPermissionsUI: { allowedPath } }, c: { categoria_snapshot: 'Mobile' } };
    assert.equal(vm.runInNewContext(condition, context), pages.verifica_contratti === true);
    context.c.categoria_snapshot = 'Fisso';assert.equal(vm.runInNewContext(condition, context),pages.verifica_contratti===true);
    if (pages.verifica_contratti) assert.equal(allowedPath('/moduli/segnalazioni.html'), false);
    context.c.categoria_snapshot = 'Customer Base'; assert.equal(vm.runInNewContext(condition, context), pages.verifica_contratti === true);
    context.c.categoria_snapshot = 'Energia'; assert.equal(vm.runInNewContext(condition, context), false);
  }
});

function uiFixture(category = 'Mobile') {
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
  const contract = { id: CONTRACT, updated_at: DATE, categoria_snapshot: category, anagrafica: { ragione_sociale: '<Cliente>' } };
  const open = c => root.MiroxSegnalazioneMobile.open(c || contract, { autore: AUTHOR });
  const choose = (m, motivo, note = '') => { m.fields['#mobileSegMotivo'].value = motivo; m.fields['#mobileSegNote'].value = note; return m.fields['#mobileSegMotivo'].emit('change'); };
  const submit = m => m.fields['[data-mobile-submit]'].emit('click');
  return { root, open, choose, submit, modals, memory, requests, navigations, confirmations, alerts, state };
}
test('Mobile popup: tre scelte, Altro richiede note; No conserva i valori senza inviare', async () => {
  const f = uiFixture(); assert.equal(f.open({ categoria_snapshot: 'Energia' }), null);
  const m = f.open(); assert.equal(f.open(), m); assert.match(m.opts.bodyHtml, /&lt;Cliente>/);
  await f.choose(m, 'Altro', '   '); assert.equal(m.fields['#mobileSegNote'].required, true);
  await f.submit(m); assert.equal(f.confirmations.length, 0); assert.equal(f.requests.length, 0);
  await f.choose(m, 'Professional Cloud', 'Nota facoltativa'); assert.equal(m.fields['#mobileSegNote'].required, false);
  f.state.yes = false; await f.submit(m);
  assert.equal(f.requests.length, 0); assert.equal(m.closed, false); assert.equal(m.fields['#mobileSegNote'].value, 'Nota facoltativa');
  assert.equal(f.confirmations[0].opts.okText, 'Sì'); assert.equal(f.confirmations[0].opts.cancelText, 'No');
});
test('Fisso popup: due sole scelte, note condizionali, Reload respinta e No conserva i valori',async()=>{
  const f=uiFixture('Fisso'),m=f.open();assert.match(m.opts.bodyHtml,/<option>Professional Cloud<\/option>/);assert.match(m.opts.bodyHtml,/<option>Altro<\/option>/);
  assert.doesNotMatch(m.opts.bodyHtml,/Reload/);
  await f.choose(m,'Reload Forever');await f.submit(m);assert.equal(f.confirmations.length,0);assert.equal(f.requests.length,0);
  await f.choose(m,'Altro','  ');await f.submit(m);assert.equal(m.fields['#mobileSegNote'].required,true);assert.equal(f.confirmations.length,0);
  await f.choose(m,'Professional Cloud','Nota facoltativa');assert.equal(m.fields['#mobileSegNote'].required,false);
  f.state.yes=false;await f.submit(m);assert.equal(f.requests.length,0);assert.equal(m.closed,false);assert.equal(m.fields['#mobileSegNote'].value,'Nota facoltativa');
});
test('Fisso popup: cache separata dal Mobile, retry conserva UUID e note senza riproporre Reload',async()=>{
  const f=uiFixture(),mobile=f.open();await f.choose(mobile,'Reload Forever','Nota Mobile');
  f.state.network=async()=>{throw new Error('Rete interrotta');};await f.submit(mobile);mobile.close();
  const fixed={id:CONTRACT,updated_at:DATE,categoria_snapshot:'Fisso',anagrafica:{ragione_sociale:'Cliente'}};
  const first=f.open(fixed);assert.equal(first.fields['#mobileSegMotivo'].value,'');assert.doesNotMatch(first.opts.bodyHtml,/Reload/);
  await f.choose(first,'Professional Cloud','Nota Fisso');await f.submit(first);first.close();
  const retry=f.open(fixed);assert.equal(retry.fields['#mobileSegNote'].value,'Nota Fisso');
  f.state.network=null;await f.submit(retry);
  assert.equal(f.requests[1].body.request_id,f.requests[2].body.request_id);assert.notEqual(f.requests[0].body.request_id,f.requests[1].body.request_id);
  assert.equal(f.memory.size,1);assert.equal([...f.memory.keys()][0].startsWith('mirox-segnalazione-mobile:'),true);
});
for (const category of ['Mobile','Fisso','Customer Base']) test(`${category} popup: sì blocca i doppi clic e conferma il successo lasciando aperto il contratto senza navigazione`, async () => {
  const f = uiFixture(category);
  let openSignal;
  const parent = { closed: false, fields: { cliente: 'Cliente sintetico', telefono: '3331234567' }, body: {
    scrollTop: 180, querySelector() { return { addEventListener(_, handler) { openSignal = handler; } }; }
  }, close() { this.closed = true; } };
  const page = fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'), 'utf8');
  const start = page.indexOf("  m.body.querySelector('[data-apri-segnalazione-mobile]')");
  const end = page.indexOf("  m.body.querySelector('[data-edit-pda]')", start);
  vm.runInNewContext(page.slice(start, end), { m: parent, window: f.root, pdaOtherFieldsDirty: false,
    c: { id: CONTRACT, updated_at: DATE, categoria_snapshot: category, anagrafica: { ragione_sociale: 'Cliente sintetico' } },
    getProfiloCorrenteVC: async () => ({ id: AUTHOR }) });
  await openSignal();
  const m = f.modals[0];
  if (category === 'Customer Base') {
    assert.deepEqual(Array.from(m.opts.bodyHtml.matchAll(/<option>([^<]+)<\/option>/g), match => match[1]), ['Reload Forever', 'Altro']);
  }
  await f.choose(m, category==='Fisso'?'Professional Cloud':'Reload Forever');
  let resolve; f.state.network = () => new Promise(r => { resolve = r; });
  const sending = f.submit(m); await new Promise(r => setImmediate(r));
  assert.equal(m.fields['[data-mobile-progress]'].hidden, false); assert.equal(m.fields['#mobileSegMotivo'].disabled, true);
  m.close(); assert.equal(m.closed, false); await f.submit(m); assert.equal(f.requests.length, 1); assert.equal(f.alerts.length, 0);
  resolve({ ok: true, json: async () => ({ success: true, segnalazione_id: 42, allegati: 3 }) }); await sending;
  assert.equal(m.closed, true); assert.match(f.alerts[0].msg, /#42.*Da gestire.*3 allegati/);
  assert.equal(f.navigations.length, 0); assert.equal(f.memory.size, 0);
  assert.equal(parent.closed, false); assert.equal(parent.body.scrollTop, 180);
  assert.deepEqual(parent.fields, { cliente: 'Cliente sintetico', telefono: '3331234567' });
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
