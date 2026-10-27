'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'), 'utf8');
const loader = page.slice(page.indexOf('async function caricaContratti('), page.indexOf('\nfunction applicaFiltri'));
const renderer = page.slice(page.indexOf('function renderListaContratti('), page.indexOf('\nasync function caricaCategorie('));
function fixture({ failure = false, deferred = false } = {}) {
  const nodes = { listaDaVerificare: { innerHTML: '' }, listaVerificati: { innerHTML: '' } };
  const state = { daVerificare: [], verificati: [], caricamenti: { daVerificare: 'idle', verificati: 'idle' } };
  const counts = {}, calls = []; let release;
  const db = { from(table) {
    assert.equal(table, 'vendita_contratti');
    const call = { table, selection: '', filters: {} }; calls.push(call);
    const q = { select(value) { call.selection = value; return q; }, eq(key, value) { call.filters[key] = value; return q; },
      order() {
        // Production RLS exposes contracts and hides every practice from browser.
        const hiddenByJoin = /pratica:|vendita_pratiche|pratica_id!inner/.test(call.selection) || 'pratica.stato_pratica' in call.filters;
        const response = failure ? { error: new Error('Lettura non riuscita') } : { data: hiddenByJoin ? [] : [{ id: 'example', stato_controllo: call.filters.stato_controllo, anagrafica: { ragione_sociale: 'Cliente esempio' } }] };
        return deferred ? new Promise(resolve => { release = () => resolve(response); }) : Promise.resolve(response);
      } };
    return q;
  } };
  const context = vm.createContext({ VCState: state, sb: db, document: { getElementById: id => nodes[id] }, window: {},
    console: { log() {}, warn() {}, error() {} }, applicaFiltri: rows => rows,
    setCount: (id, n) => { counts[id] = n; }, escapeHtml: value => String(value || ''), fmtDateTime: () => '27/10/2026', getContrattoCluster: () => 'Consumer' });
  vm.runInContext(loader + '\n' + renderer, context);
  return { context, state, nodes, counts, calls, release: () => release() };
}
for (const status of ['da_controllare', 'controllato']) {
  test(`elenco ${status} carica i contratti anche se RLS nasconde tutte le pratiche`, async () => {
    const f = fixture(); await f.context.caricaContratti(status);
    const key = status === 'controllato' ? 'verificati' : 'daVerificare';
    const node = status === 'controllato' ? 'listaVerificati' : 'listaDaVerificare';
    assert.equal(f.state[key].length, 1); assert.ok(f.nodes[node].innerHTML.includes('Cliente esempio'));
    assert.equal(f.calls.length, 1); assert.equal(f.state.caricamenti[key], 'loaded');
  });
}
test('polling esiti conserva un errore di caricamento invece di mostrare lista vuota', async () => {
  const f = fixture({ failure: true }); await f.context.caricaContratti('da_controllare');
  const error = f.nodes.listaDaVerificare.innerHTML;
  f.context.renderListaContratti('daVerificare');
  assert.equal(f.nodes.listaDaVerificare.innerHTML, error); assert.ok(error.includes('Errore caricamento'));
});
test('polling esiti non sostituisce una lettura ancora pendente', async () => {
  const f = fixture({ deferred: true }); const pending = f.context.caricaContratti('controllato');
  const loading = f.nodes.listaVerificati.innerHTML;
  f.context.renderListaContratti('verificati'); assert.equal(f.nodes.listaVerificati.innerHTML, loading);
  f.release(); await pending;
  assert.ok(f.nodes.listaVerificati.innerHTML.includes('Cliente esempio'));
});
