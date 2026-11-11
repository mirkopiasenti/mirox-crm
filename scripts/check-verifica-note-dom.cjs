'use strict';
// NODE_PATH=/private/tmp/mirox-verifica-note-qa/node_modules node scripts/check-verifica-note-dom.cjs
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { parseHTML } = require('linkedom');

const page = fs.readFileSync('moduli/verifica_contratti.html', 'utf8');
const { document, HTMLElement, Event, HTMLSelectElement } = parseHTML(page);
// LinkeDOM espone solo il getter di select.value. La fixture seleziona le opzioni
// come farebbe il controllo nativo e mantiene il codice della pagina originale.
const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
Object.defineProperty(HTMLSelectElement.prototype, 'value', {
  get: selectValue.get,
  set(value) {
    for (const option of this.options) {
      if (option.value === value) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
    }
  }
});
const window = {
  location: new URL('https://crm.example/moduli/verifica_contratti'),
  MiroxPda: { isPda: () => false }
};
const context = vm.createContext({ document, window, HTMLElement, URL, URLSearchParams, Intl, Date, console,
  setTimeout, clearTimeout, db: {} });
const source = [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('const sb = db;'));
const tick = () => new Promise(resolve => setImmediate(resolve));
let calls = 0, fail = false;
window.MiroxApi = { async fetch(url, options) {
  assert.equal(url, '/.netlify/functions/gestisci-vendita-contratto');
  calls++;
  if (fail) throw new Error('Connessione non disponibile');
  const input = JSON.parse(options.body);
  return { ok: true, json: async () => ({ success: true, stato: input.stato,
    motivo: input.stato === 'da_verificare' ? input.motivo : null,
    versione: (input.versione_revisione_attesa || 0) + 1 }) };
} };

(async () => {
  vm.runInContext(fs.readFileSync('js/mirox-safe.js', 'utf8'), context);
  context.MiroxSafe = window.MiroxSafe;
  vm.runInContext(fs.readFileSync('js/mirox-ui.js', 'utf8'), context);
  vm.runInContext(source.slice(0, source.lastIndexOf('// INIT')), context);
  const state = vm.runInContext('VCState', context);
  const contract = { id: '11111111-1111-4111-8111-111111111111', categoria_snapshot: 'Mobile',
    stato_controllo: 'da_controllare', updated_at: '2026-11-11T12:00:00Z', anagrafica: { ragione_sociale: 'Esempio sintetico' } };
  state.daVerificare = [contract];
  state.caricamenti.daVerificare = 'loaded';
  context.apriPopupDettaglio(contract, { categorie: [], offerte: [], opzioni: [], offerteOpzioni: [],
    reload: [], allegati: [], profili: [], isReadOnly: false, stateKey: 'daVerificare' });
  const detail = window.__currentVerificaModal;
  const trigger = detail.body.querySelector('[data-vc-cambia-stato]');
  assert.ok(trigger.classList.contains('vc-cambia-stato'));
  assert.equal(detail.body.querySelector('.det-section').querySelector('button'), trigger);
  assert.match(detail.body.querySelector('[data-vc-stato-corrente]').textContent, /In attesa/);
  trigger.click();
  assert.equal(document.querySelectorAll('.mx-overlay').length, 2);
  let editor = document.querySelectorAll('.mx-overlay')[1];
  const select = editor.querySelector('#vc_nuovo_stato');
  const reason = editor.querySelector('#vc_motivo_stato');
  const save = editor.querySelector('[data-vc-salva]');
  select.value = 'da_verificare';
  select.dispatchEvent(new Event('change'));
  assert.equal(reason.required, true);
  assert.equal(editor.querySelector('[data-vc-motivo]').hidden, false);
  save.click();
  await tick();
  assert.equal(calls, 0);
  assert.match(editor.querySelector('[data-vc-stato-errore]').textContent, /motivazione/);
  reason.value = '<img src=x onerror=alert(1)>\nManca il documento.';
  fail = true;
  save.click();
  await tick();
  assert.equal(document.querySelectorAll('.mx-overlay').length, 2);
  assert.equal(reason.value, '<img src=x onerror=alert(1)>\nManca il documento.');
  fail = false;
  save.click();
  await tick();
  assert.equal(document.querySelectorAll('.mx-overlay').length, 1);
  assert.match(detail.body.querySelector('[data-vc-stato-corrente]').textContent, /Da verificare/);
  assert.equal(document.querySelectorAll('.vc-leggi-motivo').length, 1);
  context.leggiMotivoVerifica(contract.id);
  const reader = document.querySelectorAll('.mx-overlay')[1];
  assert.equal(reader.querySelector('.vc-motivo-testo').textContent, reason.value);
  assert.equal(reader.querySelector('img'), null);
  assert.equal(reader.querySelector('textarea'), null);
  assert.equal(reader.querySelector('select'), null);
  assert.equal(reader.querySelectorAll('.mx-modal-foot button').length, 1);
  const escape = new Event('keydown');
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  document.dispatchEvent(escape);
  assert.equal(document.querySelectorAll('.mx-overlay').length, 1);
  assert.equal(detail.overlay.isConnected, true);

  trigger.click();
  editor = document.querySelectorAll('.mx-overlay')[1];
  assert.equal(editor.querySelector('#vc_motivo_stato').value, reason.value);
  editor.querySelector('#vc_nuovo_stato').value = 'da_confermare';
  editor.querySelector('#vc_nuovo_stato').dispatchEvent(new Event('change'));
  assert.equal(editor.querySelector('[data-vc-motivo]').hidden, true);
  editor.querySelector('[data-vc-salva]').click();
  await tick();
  assert.equal(contract.revisione.stato, 'da_confermare');
  assert.equal(contract.revisione.motivo, null);
  assert.equal(document.querySelectorAll('.vc-leggi-motivo').length, 0);
  detail.close();
  detail.close();
  assert.equal(document.querySelectorAll('.mx-overlay').length, 0);

  for (const [tab, category] of [
    ['mobile', 'Mobile'], ['fisso', 'Fisso'], ['cb', 'Customer Base'],
    ['energia', 'Energia'], ['assicurazioni', 'Assicurazioni'], ['allarme', 'Allarmi']
  ]) {
    const row = { ...contract, categoria_snapshot: category,
      revisione: { stato: 'da_verificare', motivo: 'Motivazione ' + category, versione: 1 } };
    state.daVerificare = [row];
    context.switchTabVC(tab, document.querySelector(`.nav-tab[data-tab="${tab}"]`));
    assert.equal(document.querySelectorAll('.vc-leggi-motivo').length, 1);
    context.leggiMotivoVerifica(row.id);
    assert.equal(document.querySelector('.vc-motivo-testo').textContent, 'Motivazione ' + category);
    document.querySelector('[data-vc-chiudi]').click();
  }
  const legacy = { ...contract, revisione: { stato: 'da_verificare', motivo: null, versione: 1 } };
  state.daVerificare = [legacy];
  context.leggiMotivoVerifica(legacy.id);
  assert.match(document.querySelector('.vc-motivo-testo').textContent, /Nessuna motivazione registrata/);
  document.querySelector('[data-vc-chiudi]').click();
  assert.equal(document.querySelectorAll('.mx-overlay').length, 0);
  console.log('Note verifica: DOM reale, motivazione obbligatoria, errore/retry, lettura protetta, legacy e popup sovrapposti verificati.');
})().catch(error => { console.error(error); process.exitCode = 1; });
