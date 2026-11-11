'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { Element } = require('./permissions-dom-helper');
const page = fs.readFileSync(require.resolve('../moduli/verifica_contratti.html'), 'utf8');
const stateSetup = page.slice(page.indexOf('const CATEGORIE_IN_ATTESA'), page.indexOf('// UTILITY'));
const navigation = page.slice(page.indexOf('async function apriPraticaRichiesta()'), page.indexOf('async function caricaContratti('));
const loader = page.slice(page.indexOf('async function caricaContratti('), page.indexOf('\nfunction applicaFiltri'));
const renderer = page.slice(page.indexOf('function applicaFiltri('), page.indexOf('\nasync function caricaCategorie('));
const statusEditor = page.slice(page.indexOf('function collegaCambioStato('), page.indexOf('\nasync function caricaNuovoAllegato('));

test('Verifica Contratti espone la conferma manuale e lascia scollegato il collaudo automatico', () => {
  assert.doesNotMatch(page, /vcAutomatico|MiroxVerificaAuto|verifica-contratti-automatica|gestisci-verifica-automatica/);
  assert.match(page, /onclick="confermaVerifica\([^"]+\)">Conferma verifica<\/button>/);
  assert.match(page, /data-tab="mobile"[^>]*>In Attesa - Mobile /);
});

function fixture({ failure = false, deferred = false, review = null } = {}) {
  const nodes = { listaDaVerificare: { innerHTML: '' }, listaVerificati: { innerHTML: '' } };
  const counts = {}, calls = []; let release;
  const db = { from(table) {
    assert.equal(table, 'vendita_contratti');
    const call = { table, selection: '', filters: {} }; calls.push(call);
    const q = { select(value) { call.selection = value; return q; }, eq(key, value) { call.filters[key] = value; return q; },
      order() {
        // Production RLS exposes contracts and hides every practice from browser.
        const hiddenByJoin = /pratica:|vendita_pratiche|pratica_id!inner/.test(call.selection) || 'pratica.stato_pratica' in call.filters;
        const response = failure ? { error: new Error('Lettura non riuscita') } : { data: hiddenByJoin ? [] : [{ id: 'example', categoria_snapshot: 'Mobile', stato_controllo: call.filters.stato_controllo, revisione: review, anagrafica: { ragione_sociale: 'Cliente esempio' } }] };
        return deferred ? new Promise(resolve => { release = () => resolve(response); }) : Promise.resolve(response);
      } };
    return q;
  } };
  const context = vm.createContext({ sb: db, document: { getElementById: id => nodes[id] }, window: {},
    console: { log() {}, warn() {}, error() {} }, normalizeImei: value => value || '',
    setCount: (id, n) => { counts[id] = n; }, escapeHtml: value => String(value || ''), fmtDateTime: () => '27/10/2026', getContrattoCluster: () => 'Consumer' });
  vm.runInContext([stateSetup, navigation, loader, renderer].join('\n'), context);
  const state = vm.runInContext('VCState', context);
  return { context, state, nodes, counts, calls, release: () => release() };
}
for (const status of ['da_controllare', 'controllato']) {
  test(`elenco ${status} carica i contratti anche se RLS nasconde tutte le pratiche`, async () => {
    const f = fixture(); await f.context.caricaContratti(status);
    const key = status === 'controllato' ? 'verificati' : 'daVerificare';
    const node = status === 'controllato' ? 'listaVerificati' : 'listaDaVerificare';
    assert.equal(f.state[key].length, 1); assert.ok(f.nodes[node].innerHTML.includes('Cliente esempio'));
    assert.ok(f.nodes[node].innerHTML.includes(status === 'controllato' ? '>Controllato</span>' : '>In attesa</span>'));
    assert.equal(f.calls[0].selection.includes('revisione:vendita_stati_verifica_manuale(stato,motivo,versione)'), status === 'da_controllare');
    assert.match(f.nodes[node].innerHTML, /<th>Stato<\/th>/);
    if (status === 'da_controllare') assert.match(f.nodes[node].innerHTML, /class="stato-pill da_controllare">In attesa<\/span>/);
    assert.equal(f.calls.length, 1); assert.equal(f.state.caricamenti[key], 'loaded');
  });
}
test('il filtro Esito seleziona le etichette in attesa e si combina con gli altri filtri', () => {
  const f = fixture();
  const statuses = [
    ['da_controllare', 'In attesa', null],
    ['da_verificare', 'Da verificare', { stato: 'da_verificare' }],
    ['da_confermare', 'Da confermare', { stato: 'da_confermare' }]
  ];
  const dropdown = page.match(/<select id="filterEsitoDaVerificare">([\s\S]*?)<\/select>/)[1];
  assert.match(dropdown, /<option value="">Tutti gli esiti<\/option>/);
  f.state.daVerificare = statuses.map(([id, , revisione]) => ({
    id, revisione, stato_controllo: 'da_controllare', categoria_snapshot: 'Mobile', anagrafica: { ragione_sociale: 'Cliente ' + id }
  }));
  f.state.daVerificare.push({ id: 'storico', stato_controllo: 'da_controllare', categoria_snapshot: 'Fisso' });
  f.state.verificati = [{ id: 'controllato', stato_controllo: 'controllato' }];
  f.state.caricamenti.daVerificare = 'loaded';
  let change;
  f.nodes.filterEsitoDaVerificare = { addEventListener(event, callback) {
    assert.equal(event, 'change');
    change = callback;
  } };
  vm.runInContext(page.match(/document\.getElementById\('filterEsitoDaVerificare'\)\.addEventListener\([\s\S]*?\n}\);/)[0], f.context);
  const select = value => change({ target: { value } });
  const visibleIds = () => [...f.nodes.listaDaVerificare.innerHTML.matchAll(/apriDettaglioContratto\('([^']+)'/g)].map(match => match[1]);
  for (const [id, label] of statuses) {
    assert.ok(dropdown.includes(`<option value="${id}">${label}</option>`));
    select(id);
    assert.deepEqual(visibleIds(), [id]);
    assert.ok(f.nodes.listaDaVerificare.innerHTML.includes(`>${label}</span>`));
    assert.equal(f.counts['cntInAttesa-mobile'], 3);
    assert.equal(f.counts['cntInAttesa-fisso'], 1);
  }
  assert.equal(f.context.applicaFiltri(f.state.verificati, 'verificati').length, 1);
  f.state.searchDaVerificare = 'assente';
  select('da_confermare');
  assert.match(f.nodes.listaDaVerificare.innerHTML, /Nessun contratto/);
  f.state.searchDaVerificare = '';
  select('da_controllare');
  assert.deepEqual(visibleIds(), ['da_controllare']);
  select('');
  assert.equal(visibleIds().length, 3);
});
test('le sei schede hanno contratti e contatori distinti e il deep-link seleziona la categoria', async () => {
  const f = fixture();
  const categories = [
    ['mobile', 'Mobile', ' Mobile '], ['fisso', 'Fisso', 'Fisso'],
    ['cb', 'CB', 'Customer Base'], ['energia', 'Energia', null],
    ['assicurazioni', 'Assicurazioni', 'Assicurazioni'], ['allarme', 'Allarme', 'Allarmi']
  ];
  f.state.categorie = [{ id: 'catalogo-energia', nome: 'Energia' }];
  f.state.daVerificare = categories.map(([id, , categoria_snapshot]) => ({
    id, categoria_snapshot, categoria_id: id === 'energia' ? 'catalogo-energia' : null, stato_controllo: 'da_controllare'
  }));
  f.state.verificati = [{ id: 'chiuso', categoria_snapshot: 'Mobile', stato_controllo: 'controllato' }];
  f.state.caricamenti.daVerificare = f.state.caricamenti.verificati = 'loaded';
  f.nodes['tab-da-verificare'] = new Element();
  f.nodes['tab-verificati'] = new Element();
  const buttons = Object.fromEntries([...categories.map(([id]) => id), 'verificati'].map(id => [id, new Element('button')]));
  f.context.document.querySelectorAll = () => Object.values(buttons);
  f.context.document.querySelector = selector => buttons[selector.match(/data-tab="([^"]+)"/)[1]];
  for (const [id, label] of categories) {
    assert.ok(page.includes(`switchTabVC('${id}', this)">In Attesa - ${label} <span id="cntInAttesa-${id}"`));
    f.context.switchTabVC(id, buttons[id]);
    const ids = [...f.nodes.listaDaVerificare.innerHTML.matchAll(/apriDettaglioContratto\('([^']+)'/g)].map(match => match[1]);
    assert.deepEqual(ids, [id]);
    assert.equal(f.counts['cntInAttesa-' + id], 1);
    assert.equal(buttons[id].getAttribute('aria-pressed'), 'true');
  }
  f.context.getContrattoIdRichiesto = () => 'energia';
  f.context.apriDettaglioContratto = async (id, stateKey) => {
    assert.equal(id, 'energia');
    assert.equal(stateKey, 'daVerificare');
    assert.equal(buttons.energia.getAttribute('aria-pressed'), 'true');
  };
  await f.context.apriPraticaRichiesta();
  f.context.switchTabVC('verificati', buttons.verificati);
  f.context.renderListaContratti('verificati');
  assert.equal(buttons.energia.getAttribute('aria-pressed'), 'false');
  assert.equal(f.nodes['tab-da-verificare'].classList.contains('active'), false);
  assert.equal(f.nodes['tab-verificati'].classList.contains('active'), true);
  assert.match(f.nodes.listaVerificati.innerHTML, /apriDettaglioContratto\('chiuso', 'verificati'\)/);
});
test('il popup richiede la motivazione, conserva la bozza in errore e aggiorna lo stato solo dopo Salva', async () => {
  const f = fixture();
  await f.context.caricaContratti('da_controllare');
  const contract = f.state.daVerificare[0];
  const control = () => {
    const node = new Element();
    node.focus = () => {};
    return node;
  };
  const toggle = control(), current = control();
  let popup, builds = 0;
  const controls = Object.fromEntries([
    '#vc_nuovo_stato', '[data-vc-motivo]', '#vc_motivo_stato', '[data-vc-stato-errore]',
    '[data-vc-salva]', '[data-vc-annulla]'
  ].map(key => [key, control()]));
  f.context.window.MiroxUI = { _build(options) {
    builds++;
    popup = { options, closed: false, modal: { setAttribute() {}, style: {} },
      body: { querySelector: key => controls[key], style: {} }, foot: { querySelector: key => controls[key] },
      close() { if (options.canClose()) { this.closed = true; options.onClose(); } }
    };
    return popup;
  } };
  vm.runInContext(statusEditor, f.context);
  f.context.collegaCambioStato({ querySelector: key => key === '[data-vc-cambia-stato]' ? toggle : current }, contract);
  await toggle.emit('click');
  assert.equal(builds, 1);
  assert.equal(toggle.disabled, true);
  const select = controls['#vc_nuovo_stato'], note = controls['#vc_motivo_stato'];
  const save = controls['[data-vc-salva]'], error = controls['[data-vc-stato-errore]'];
  let calls = 0, finish;
  f.context.gestisciVenditaContratto = payload => {
    calls++;
    assert.equal(payload.motivo, 'Documento da integrare');
    assert.equal(payload.versione_revisione_attesa, null);
    assert.equal(payload.stato_atteso, null);
    return new Promise(resolve => { finish = resolve; });
  };
  await save.emit('click');
  assert.match(error.textContent, /Seleziona/);
  select.value = 'da_verificare'; await select.emit('change');
  assert.equal(controls['[data-vc-motivo]'].hidden, false);
  assert.equal(note.required, true);
  note.value = '  	  ';
  await save.emit('click');
  assert.match(error.textContent, /motivazione/);
  assert.equal(calls, 0);
  note.value = 'Documento da integrare';
  const pending = save.emit('click');
  await save.emit('click');
  popup.close();
  assert.equal(calls, 1);
  assert.equal(popup.closed, false);
  assert.equal(contract.revisione, null);
  finish({ stato: 'da_verificare', motivo: note.value, versione: 1 });
  await pending;
  assert.equal(contract.revisione.motivo, note.value);
  assert.equal(popup.closed, true);
  assert.match(f.nodes.listaDaVerificare.innerHTML, /leggiMotivoVerifica/);
  assert.equal(contract.stato_controllo, 'da_controllare');

  await toggle.emit('click');
  select.value = 'da_confermare'; await select.emit('change');
  assert.equal(controls['[data-vc-motivo]'].hidden, true);
  assert.equal(note.required, false);
  f.context.gestisciVenditaContratto = async payload => {
    assert.equal(payload.motivo, null);
    assert.equal(payload.versione_revisione_attesa, 1);
    throw new Error('Riapri il dettaglio.');
  };
  await save.emit('click');
  assert.equal(error.textContent, 'Riapri il dettaglio.');
  assert.equal(note.value, 'Documento da integrare');
  assert.equal(contract.revisione.stato, 'da_verificare');
  assert.equal(popup.closed, false);
  f.context.gestisciVenditaContratto = async () => ({ stato: 'da_confermare', motivo: null, versione: 2 });
  await save.emit('click');
  assert.equal(popup.closed, true);
  assert.equal(toggle.disabled, false);
  assert.match(current.innerHTML, /Da confermare/);
  assert.doesNotMatch(f.nodes.listaDaVerificare.innerHTML, /leggiMotivoVerifica/);
});
test('l’API limita lo stato operativo e tratta i conflitti come 409', async () => {
  const { setManualReviewStatus } = require('../netlify/functions/gestisci-vendita-contratto')._test;
  const id = '11111111-1111-4111-8111-111111111111';
  const auth = { user: { id } };
  const body = { contratto_id: id, stato: 'da_verificare', stato_atteso: null, expected_updated_at: '2026-11-10T09:00:00Z', motivo: 'Documento da integrare', versione_revisione_attesa: null };
  let calls = 0;
  const supabase = { async rpc(name, params) {
    calls++;
    assert.equal(name, 'vendita_imposta_stato_verifica_manuale');
    assert.deepEqual(params, { p_contratto_id: id, p_stato: body.stato, p_stato_atteso: null,
      p_versione_attesa: body.expected_updated_at, p_autore: id, p_motivo: body.motivo, p_versione_revisione_attesa: null });
    return { data: { stato: body.stato, motivo: body.motivo, versione: 1 } };
  } };
  assert.equal((await setManualReviewStatus({ supabase, auth, body: { ...body, stato: 'controllato' } })).statusCode, 400);
  for (const patch of [{ motivo: '' }, { motivo: '  \n  ' }, { motivo: 'a'.repeat(2001) }, { motivo: {} }, { versione_revisione_attesa: -1 }]) {
    assert.equal((await setManualReviewStatus({ supabase, auth, body: { ...body, ...patch } })).statusCode, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await setManualReviewStatus({ supabase, auth, body: { ...body, versione_revisione_attesa: undefined } })).statusCode, 409);
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
