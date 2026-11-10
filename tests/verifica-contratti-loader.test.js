'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'), 'utf8');
const loader = page.slice(page.indexOf('async function caricaContratti('), page.indexOf('\nfunction applicaFiltri'));
const renderer = page.slice(page.indexOf('function renderStatoContratto('), page.indexOf('\nasync function caricaCategorie('));
const statusEditor = page.slice(page.indexOf('function collegaCambioStato('), page.indexOf('\nasync function caricaNuovoAllegato('));

test('Verifica Contratti espone la conferma manuale e lascia scollegato il collaudo automatico', () => {
  assert.doesNotMatch(page, /vcAutomatico|MiroxVerificaAuto|verifica-contratti-automatica|gestisci-verifica-automatica/);
  assert.match(page, /onclick="confermaVerifica\([^"]+\)">Conferma verifica<\/button>/);
});

function fixture({ failure = false, deferred = false, review = null } = {}) {
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
        const response = failure ? { error: new Error('Lettura non riuscita') } : { data: hiddenByJoin ? [] : [{ id: 'example', stato_controllo: call.filters.stato_controllo, revisione: review, anagrafica: { ragione_sociale: 'Cliente esempio' } }] };
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
    assert.ok(f.nodes[node].innerHTML.includes(status === 'controllato' ? '>Controllato</span>' : '>Da controllare</span>'));
    assert.equal(f.calls[0].selection.includes('revisione:vendita_stati_verifica_manuale(stato)'), status === 'da_controllare');
    assert.match(f.nodes[node].innerHTML, /<th>Stato<\/th>/);
    if (status === 'da_controllare') assert.match(f.nodes[node].innerHTML, /<td><span class="stato-pill da_controllare">Da controllare<\/span><\/td>/);
    assert.equal(f.calls.length, 1); assert.equal(f.state.caricamenti[key], 'loaded');
  });
}
test('la scelta dello stato aggiorna il badge solo dopo il salvataggio e mantiene la riga in attesa', async () => {
  const f = fixture({ review: { stato: 'da_verificare' } });
  await f.context.caricaContratti('da_controllare');
  const contract = f.state.daVerificare[0];
  const control = (props = {}) => ({ events: {}, ...props, addEventListener(event, callback) { this.events[event] = callback; } });
  const red = control({ dataset: { vcNuovoStato: 'da_verificare' } });
  const green = control({ dataset: { vcNuovoStato: 'da_confermare' } });
  const toggle = control({ setAttribute(key, value) { this[key] = value; }, focus() {} });
  const options = control({ hidden: true, querySelectorAll: () => [red, green] });
  const current = { innerHTML: '' }, error = { textContent: '' };
  const elements = { '[data-vc-cambia-stato]': toggle, '#vc_stato_opzioni': options,
    '[data-vc-stato-corrente]': current, '[data-vc-stato-errore]': error };
  f.context.gestisciVenditaContratto = async payload => {
    assert.equal(payload.stato_atteso, 'da_verificare');
    assert.equal(payload.action, 'set_stato_verifica_manuale');
    assert.equal(payload.stato, 'da_confermare');
    throw new Error('Riapri il dettaglio.');
  };
  vm.runInContext(statusEditor, f.context);
  f.context.collegaCambioStato({ querySelector: selector => elements[selector] }, contract);
  toggle.events.click();
  assert.equal(toggle['aria-expanded'], 'true');
  assert.match(f.nodes.listaDaVerificare.innerHTML, /class="stato-pill da_verificare">Da verificare/);
  await green.events.click();
  assert.equal(error.textContent, 'Riapri il dettaglio.');
  assert.equal(contract.revisione.stato, 'da_verificare');
  f.context.gestisciVenditaContratto = async () => ({ stato: 'da_confermare' });
  await green.events.click();
  assert.match(f.nodes.listaDaVerificare.innerHTML, /class="stato-pill da_confermare">Da confermare/);
  assert.match(current.innerHTML, /Da confermare/);
  assert.equal(toggle['aria-expanded'], 'false');
  assert.equal(contract.stato_controllo, 'da_controllare');
});
test('l’API limita lo stato operativo e tratta i conflitti come 409', async () => {
  const { setManualReviewStatus } = require('../netlify/functions/gestisci-vendita-contratto')._test;
  const id = '11111111-1111-4111-8111-111111111111';
  const auth = { user: { id } };
  const body = { contratto_id: id, stato: 'da_verificare', stato_atteso: null, expected_updated_at: '2026-11-10T09:00:00Z' };
  let calls = 0;
  const supabase = { async rpc(name, params) {
    calls++;
    assert.equal(name, 'vendita_imposta_stato_verifica_manuale');
    assert.deepEqual(params, { p_contratto_id: id, p_stato: body.stato, p_stato_atteso: null,
      p_versione_attesa: body.expected_updated_at, p_autore: id });
    return { data: body.stato };
  } };
  assert.equal((await setManualReviewStatus({ supabase, auth, body: { ...body, stato: 'controllato' } })).statusCode, 400);
  assert.equal(calls, 0);
  assert.equal(JSON.parse((await setManualReviewStatus({ supabase, auth, body })).body).stato, body.stato);
  supabase.rpc = async () => ({ error: { code: '40001', message: 'Riapri il dettaglio.' } });
  assert.equal((await setManualReviewStatus({ supabase, auth, body })).statusCode, 409);
});
test('il rendering conserva un errore di caricamento invece di mostrare lista vuota', async () => {
  const f = fixture({ failure: true }); await f.context.caricaContratti('da_controllare');
  const error = f.nodes.listaDaVerificare.innerHTML;
  f.context.renderListaContratti('daVerificare');
  assert.equal(f.nodes.listaDaVerificare.innerHTML, error); assert.ok(error.includes('Errore caricamento'));
});
test('il rendering conserva una lettura ancora pendente', async () => {
  const f = fixture({ deferred: true }); const pending = f.context.caricaContratti('controllato');
  const loading = f.nodes.listaVerificati.innerHTML;
  f.context.renderListaContratti('verificati'); assert.equal(f.nodes.listaVerificati.innerHTML, loading);
  f.release(); await pending;
  assert.ok(f.nodes.listaVerificati.innerHTML.includes('Cliente esempio'));
});
