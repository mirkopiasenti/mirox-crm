'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Element } = require('./permissions-dom-helper');
const page = fs.readFileSync(require.resolve('../moduli/segnalazioni.html'), 'utf8');
const source = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("const BUCKET='segnalazioni-files'"));
const CF = 'RSSMRA80A01H501U', PIVA = '01114601006';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture({ profile = { id: 'synthetic', nome: 'Vincenzo', attivo: true }, lookup, confirmation = false, logoutError = null, records = [] } = {}) {
  const nodes = {}, calls = [], timers = new Map(); let timerId = 0;
  for (const m of page.matchAll(/\bid="([\w-]+)"/g)) {
    const n = nodes[m[1]] = new Element('div'); n.style = {}; n.innerHTML = ''; n.remove = () => {}; n.appendChild = node => n.append(node);
  }
  const auth = { _profilo: profile, _permessi: {}, richiediAuth: async () => profile, getProfilo: () => auth._profilo, _indexPath: () => '../index.html' };
  const db = { auth: { async signOut(opts) { calls.push({ logout: opts }); return { error: logoutError }; } }, from(table) {
    const call = { table, filters: {} }; calls.push(call);
    const q = {
      select(value, opts) { call.select = value; call.options = opts; return q; },
      eq(k, v) { call.filters[k] = v; return q; }, ilike(k, v) { call.filters[k] = v; return q; },
      in(k, v) { call.filters[k] = v; return q; }, not(k, op, v) { call.notNull = k; return q; }, order() { return q; }, limit() { return q; },
      insert(data) { call.insert = data; return q; }, update(data) { call.update = data; return q; },
      single() { return q; },
      then(resolve, reject) {
        const result = table === 'anagrafica' ? (lookup ? lookup(call) : { data: [{ cf_piva: call.filters.cf_piva, ragione_sociale: 'Cliente sintetico', cellulare: '3331234567' }] }) : call.insert ? { data: { id: 999 } } : { data: records.filter(r => Object.entries(call.filters).every(([k,v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v) && (!call.notNull || r[call.notNull] != null)), count: records.filter(r => Object.entries(call.filters).every(([k,v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v)).length };
        return Promise.resolve(result).then(resolve, reject);
      }
    }; return q;
  }, storage: { from() { return { list: async () => ({ data: [] }) }; } } };
  const document = { getElementById: id => nodes[id], querySelectorAll: () => [], addEventListener() {}, createElement() { const n = new Element(); n.remove = () => {}; return n; } };
  nodes.formNuova.reportValidity = () => ['ragioneSociale', 'tel', 'cf', 'dettagli', 'gestionePratica'].every(id => nodes[id].value);
  nodes.formNuova.reset = () => { nodes.formNuova.emit('reset'); ['ragioneSociale', 'tel', 'cf', 'dettagli', 'gestionePratica'].forEach(id => { nodes[id].value = ''; }); nodes.operatore.value = nodes.operatore.defaultValue; };
  const window = { db, location: { href: '' }, MiroxUI: { async confirm(msg, opts) { calls.push({ confirm: msg, opts }); return confirmation; } } };
  const context = vm.createContext({ window, document, Auth: auth, console, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id) });
  vm.runInContext(fs.readFileSync(require.resolve('../js/mirox-safe.js'), 'utf8'), context);
  context.MiroxSafe = window.MiroxSafe;
  vm.runInContext(fs.readFileSync(require.resolve('../js/anagrafica-helper.js'), 'utf8'), context);
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const input = async (id, value) => { nodes[id].value = value; await nodes[id].emit('input'); };
  const submit = async () => { await nodes.formNuova.handlers.submit[0]({ target: nodes.formNuova, preventDefault() {} }); };
  return { nodes, context, calls, run, input, submit, timers, ready: () => run('authReady') };
}

test('Segnalazioni: CF/PIVA precede gli altri dati, operatore non selezionabile, nessuna urgenza o Escalation nella UI', () => {
  const html = page.slice(0, page.indexOf('// Auth guard'));
  assert.ok(html.indexOf('id="cf"') < html.indexOf('id="ragioneSociale"'));
  assert.ok(html.indexOf('id="cf"') < html.indexOf('id="tel"'));
  assert.match(html, /<input[^>]*id="operatore" readonly/);
  assert.doesNotMatch(html, /Urgenza|Urgente|Normale|Escalation|<select[^>]*id="operatore"/);
});
for (const tax of [CF, PIVA]) test(`Segnalazioni: ricerca esatta ${tax.length === 16 ? 'CF' : 'PIVA'}, autocompilazione e correzioni conservate`, async () => {
  const f = fixture(); await f.ready(); await f.input('cf', tax.toLowerCase());
  await f.context.cercaCliente();
  assert.equal(f.nodes.ragioneSociale.value, 'Cliente sintetico');
  assert.equal(f.nodes.tel.value, '3331234567');
  await f.input('tel', '3339999999'); await f.context.cercaCliente();
  assert.equal(f.nodes.tel.value, '3339999999');
  assert.equal(f.calls.filter(c => c.table === 'anagrafica').length, 1);
  assert.equal(f.calls.find(c => c.table === 'anagrafica').filters.cf_piva, tax);
});
test('Segnalazioni: cambio CF invalida dati precedenti e risposte obsolete, reset invalida anche la ricerca pendente', async () => {
  const a = deferred(), b = deferred();
  const f = fixture({ lookup: c => c.filters.cf_piva === CF ? a.promise : b.promise });
  await f.ready(); await f.input('cf', CF); const first = f.context.cercaCliente(); await tick();
  await f.input('cf', PIVA); const second = f.context.cercaCliente(); await tick();
  b.resolve({ data: [{ cf_piva: PIVA, ragione_sociale: 'Cliente B', cellulare: '3332222222' }] }); await second;
  a.resolve({ data: [{ cf_piva: CF, ragione_sociale: 'Cliente A' }] }); await first;
  assert.equal(f.nodes.ragioneSociale.value, 'Cliente B');
  await f.input('cf', ''); assert.equal(f.nodes.ragioneSociale.value, ''); assert.equal(f.nodes.tel.value, '');
  const pending = deferred(); const g = fixture({ lookup: () => pending.promise }); await g.ready();
  await g.input('cf', CF); const req = g.context.cercaCliente(); await tick(); g.nodes.formNuova.reset();
  pending.resolve({ data: [{ cf_piva: CF, ragione_sociale: 'Vecchio' }] }); await req;
  assert.equal(g.nodes.ragioneSociale.value, '');
});
test('Segnalazioni: la ricerca pendente non sovrascrive una correzione manuale', async () => {
  const result = deferred(); const f = fixture({ lookup: () => result.promise }); await f.ready();
  await f.input('cf', CF); const p = f.context.cercaCliente(); await tick(); await f.input('tel', '3339999999');
  result.resolve({ data: [{ cf_piva: CF, ragione_sociale: 'Cliente', cellulare: '3331234567' }] }); await p;
  assert.equal(f.nodes.tel.value, '3339999999'); assert.equal(f.nodes.ragioneSociale.value, 'Cliente');
});
test('Segnalazioni: nessun risultato consente inserimento manuale, errori e risposta malformata richiedono retry', async () => {
  let mode = 'error'; const f = fixture({ lookup: () => mode === 'error' ? { error: new Error('offline') } : mode === 'bad' ? { data: [{ cf_piva: PIVA }] } : { data: [] } });
  await f.ready(); await f.input('cf', CF);
  assert.equal(await f.context.cercaCliente(), false); assert.match(f.nodes.clienteStatus.textContent, /riprovare/);
  mode = 'bad'; assert.equal(await f.context.cercaCliente(), false);
  mode = 'empty'; assert.equal(await f.context.cercaCliente(), true); assert.match(f.nodes.clienteStatus.textContent, /non presente/);
  await f.input('ragioneSociale', 'Cliente nuovo'); await f.input('tel', '3331234567');
  assert.equal(f.nodes.ragioneSociale.value, 'Cliente nuovo');
});
test('Segnalazioni: autore dal profilo, correzioni nel payload, nessuna urgenza e doppio invio bloccato', async () => {
  const f = fixture(); await f.ready(); assert.equal(f.nodes.operatore.value, 'Vincenzo');
  await f.input('cf', CF); await f.context.cercaCliente(); await f.input('ragioneSociale', 'Nome corretto'); await f.input('tel', '3339999999');
  f.nodes.dettagli.value = 'Richiesta sintetica'; f.nodes.gestionePratica.value = '159'; f.nodes.operatore.value = 'Nome alterato';
  await Promise.all([f.submit(), f.submit()]);
  const inserts = f.calls.filter(c => c.insert); assert.equal(inserts.length, 1);
  assert.equal(inserts[0].insert.stato, 'Da gestire'); assert.equal('assegnatario' in inserts[0].insert, false);
  assert.equal(inserts[0].insert.operatore, 'Vincenzo'); assert.equal(inserts[0].insert.numero_contatto, '3339999999');
  assert.equal(inserts[0].insert.ragione_sociale, 'Nome corretto'); assert.equal('urgenza' in inserts[0].insert, false);
  assert.equal(f.nodes.operatore.value, 'Vincenzo'); assert.equal(f.nodes.clienteStatus.textContent, '');
});
test('Segnalazioni: profilo assente o ricerca fallita non inseriscono record', async () => {
  for (const options of [{ profile: null }, { profile: { nome: '' } }, { lookup: () => ({ error: new Error('offline') }) }]) {
    const f = fixture(options); await f.ready(); await f.input('cf', CF); await f.submit();
    assert.equal(f.calls.filter(c => c.insert).length, 0);
  }
});
test('Segnalazioni: Cambia annullato conserva sessione, Logout confermato torna al login, errore non reindirizza', async () => {
  for (const [confirmation, logoutError] of [[false, null], [true, null], [true, new Error('offline')]]) {
    const f = fixture({ confirmation, logoutError }); await f.ready(); await f.context.cambiaUtenza();
    assert.match(f.calls.find(c => c.confirm).confirm, /Per cambiare utenza devi fare logout/);
    assert.equal(f.calls.find(c => c.confirm).opts.okText, 'Logout');
    assert.equal(f.calls.filter(c => c.logout).length, confirmation ? 1 : 0);
    assert.equal(f.context.window.location.href, confirmation && !logoutError ? '../index.html' : '');
    if (confirmation) assert.equal(f.calls.find(c => c.logout).logout.scope, 'local');
  }
});
test('Segnalazioni: tutte le tabelle e i dettagli eliminano urgenza; storico Escalation visibile in corso e chiudibile', async () => {
  const f = fixture(); await f.ready();
  const row = { id: 42, stato: 'Escalation', urgenza: 'Urgente', ragione_sociale: 'Cliente sintetico', storico_chat: [] };
  f.context.row = row; f.run('dataGest=[row];dataRiep=[row]');
  f.context.renderGest([row]); f.nodes.fRiepHideChiusi.checked = true;
  f.nodes.fRiepStato.value = 'Segnalazione in Corso'; f.context.filterRiepilogo();
  for (const [id, cols] of [['tbGest', 6], ['tbRiep', 6]]) {
    assert.equal((f.nodes[id].innerHTML.match(/<td[ >]/g) || []).length, cols);
    assert.doesNotMatch(f.nodes[id].innerHTML, /Urgente|Urgenza|Escalation/);
  }
  await f.context.openGest(42); await f.context.openRiep(42);
  for (const id of ['modalGestBody', 'modalRiepBody']) assert.doesNotMatch(f.nodes[id].innerHTML, /Urgenza|Urgente|Escalation/);
  f.nodes.rStato.value = 'Escalation'; await f.context.salvaRiep(); assert.equal(f.calls.filter(c => c.update).length, 0);
  f.nodes.rStato.value = 'Chiuso'; await f.context.salvaRiep();
  assert.equal(f.calls.find(c => c.update).update.stato, 'Chiuso'); assert.ok(f.calls.find(c => c.update).update.data_chiusura);
});

test('Segnalazioni: rimuove tab, azioni, campi assegnatario e ogni chiamata email dalla pagina', () => {
  assert.doesNotMatch(page, /MiroxMailer|mirox-mailer|mirox-send-email|assegnatario|Assegnatario|dataAss|modalAss|loadAss|renderAss|cambiaAssegnatario|selAss|data-tab="assegnazione"/);
  assert.equal((page.match(/<th>Operatore<\/th>/g) || []).length, 2);
  assert.match(page, /id="askOperatore" readonly/);
});
test('Segnalazioni: Da gestire comprende nuove richieste e i due stati storici, con contatore concorde', async () => {
  const records = ['Da gestire','In attesa Assegnazione','Assegnata','Segnalazione in Corso','Chiuso'].map((stato, i) => ({id:i+1,stato,operatore:'Vincenzo',ragione_sociale:'Cliente '+i}));
  const f = fixture({records}); await f.ready(); await f.context.loadGest(); await f.context.updateCounters();
  assert.equal(f.run('dataGest.length'), 3);
  assert.equal(f.nodes.cntGest.textContent, '3');
  assert.equal((f.nodes.tbGest.innerHTML.match(/>Da gestire<\/span>/g) || []).length, 3);
  assert.doesNotMatch(f.nodes.tbGest.innerHTML, /Assegnata|In attesa Assegnazione/);
});
test('Segnalazioni: colonne, dettagli e filtri usano l’autore originale, mai il precedente assegnatario', async () => {
  const rows = [
    {id:1,stato:'Assegnata',operatore:'Matteo',assegnatario:'Mirko',ragione_sociale:'Cliente A'},
    {id:2,stato:'Assegnata',operatore:'Vincenzo',assegnatario:'Francesca',ragione_sociale:'Cliente B'},
    {id:3,stato:'Assegnata',operatore:null,assegnatario:'Mirko',ragione_sociale:'Cliente C'}
  ];
  const f = fixture(); await f.ready(); f.context.rows=rows; f.run('dataGest=rows;dataRiep=rows');
  f.context.renderGest(rows); f.context.renderRiep(rows);
  for(const id of ['tbGest','tbRiep']) {
    assert.match(f.nodes[id].innerHTML, /Matteo/); assert.match(f.nodes[id].innerHTML, /Vincenzo/);
    assert.doesNotMatch(f.nodes[id].innerHTML, /Mirko|Francesca/);
  }
  f.context.popolaOperatori('fGestOperatore',rows);
  assert.match(f.nodes.fGestOperatore.innerHTML, /Matteo/); assert.match(f.nodes.fGestOperatore.innerHTML, /Vincenzo/);
  assert.doesNotMatch(f.nodes.fGestOperatore.innerHTML, /Mirko|Francesca/);
  f.nodes.fGestOperatore.value='Matteo'; f.context.filterGestione();
  assert.match(f.nodes.tbGest.innerHTML, /Cliente A/); assert.doesNotMatch(f.nodes.tbGest.innerHTML, /Cliente B|Cliente C/);
  await f.context.openGest(1); await f.context.openRiep(1);
  for(const id of ['modalGestBody','modalRiepBody']) assert.doesNotMatch(f.nodes[id].innerHTML, /Assegnatario|Mirko/);
});
test('Segnalazioni: ASK manuale salva l’operatore autenticato senza assegnazione o email', async () => {
  const f=fixture(); await f.ready(); f.nodes.askCf.value=CF; f.nodes.askRagioneSociale.value='Cliente';
  f.nodes.askTipo.value='Guasti'; f.nodes.askNum.value='ASK sintetico'; f.nodes.askFiles.files=[]; f.nodes.askOperatore.value='Alterato';
  await f.nodes.formAsk.handlers.submit[0]({preventDefault(){}});
  const call=f.calls.find(c=>c.insert); assert.ok(call);
  assert.equal(call.insert.operatore,'Vincenzo'); assert.equal(call.insert.stato,'Chiuso'); assert.equal('assegnatario' in call.insert,false);
});
test('Email Segnalazioni: il server rifiuta anche vecchi client senza invocare il mailer, gli altri template continuano', async () => {
  let sent=0;
  const module={exports:{}};
  const code=fs.readFileSync(require.resolve('../netlify/functions/mirox-send-email.js'),'utf8');
  vm.runInNewContext(code,{module,exports:module.exports,console,require(name){
    if(name==='./_lib/require-auth')return {requireAuth:async()=>({ok:true})};
    if(name==='./_lib/mailer')return {sendEmail:async()=>{sent++;return {ok:true,messageId:'synthetic'};}};
    throw new Error(name);
  }});
  for(const body of [{template:'segnalazione_assegnata',to:'test@example.invalid'},{html:'test',related_table:'segnalazioni',to:'test@example.invalid'}]){
    const result=await module.exports.handler({httpMethod:'POST',body:JSON.stringify(body)});
    assert.equal(result.statusCode,410); assert.equal(sent,0);
  }
  const result=await module.exports.handler({httpMethod:'POST',body:JSON.stringify({template:'ordine_smartphone_nuovo',to:'test@example.invalid'})});
  assert.equal(result.statusCode,200); assert.equal(sent,1);
});
