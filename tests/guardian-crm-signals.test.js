'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('Ticket apre Lavorata per nomi con apostrofi e contenuto che sembra codice', () => {
  const nodes = new Map();
  const button = { dataset: { ticketId: '55' }, addEventListener(type, fn) { this[type] = fn; } };
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: '', style: {}, value: '', disabled: false,
        classList: { add() {}, remove() {} }, querySelectorAll: () => [button] });
      return nodes.get(id);
    },
    querySelectorAll: () => []
  };
  const window = { addEventListener() {} };
  const context = vm.createContext({ document, window, db: {}, setTimeout() {}, Date, console });
  vm.runInContext(read('js/mirox-safe.js'), context);
  context.MiroxSafe = window.MiroxSafe;
  const scripts = [...read('moduli/ticket.html').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
  vm.runInContext(scripts.at(-1)[1], context);
  const name = `D'Angelo "Cliente" <img src=x onerror=throwError()>`;
  vm.runInContext('allTickets = '+JSON.stringify([{ rowIndex: 55, intestatario: name, stato: 'Da gestire' }])+'; renderTickets();', context);
  assert.doesNotMatch(nodes.get('ticketList').innerHTML, /onclick="openLavorataModal/);
  assert.match(nodes.get('ticketList').innerHTML, /&lt;img/);
  button.click();
  assert.equal(nodes.get('lavorataClienteName').textContent, name);
  assert.equal(vm.runInContext('currentLavorataIndex', context), 55);
});

test('Apri/Chiudi passa da SIM si a no senza cercare info-sim e azzera anteprima', () => {
  const source = read('moduli/apri_chiudi.html');
  const start = source.indexOf(' function toggleSimSection(');
  assert(start >= 0);
  const end = source.indexOf('// Validazione numero sim', start);
  const removed = [];
  const nodes = {};
  for (const id of ['numero-sim-section', 'upload-sim-section', 'numero-sim', 'doc-sim']) nodes[id] = {
    checked: false, required: true, value: 'old', classList: { add() {}, remove(v) { removed.push(v); } }
  };
  // Use the current IDs discovered by the function, with a strict failure for obsolete nodes.
  const ids = [...source.slice(start,end).matchAll(/getElementById\('([^']+)'\)/g)].map(m=>m[1]);
  ids.forEach(id => { nodes[id] ||= { checked: false, required: true, value: 'old', classList: { add() {}, remove(v) { removed.push(v); } } }; });
  let rendered;
  const context = vm.createContext({ document: { getElementById: id => nodes[id] || null }, renderFileList: tipo => { rendered = tipo; } });
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('toggleSimSection()', context);
  assert.equal(nodes['numero-sim'].required, false);
  assert.equal(nodes['numero-sim'].value, '');
  assert.equal(nodes['doc-sim'].required, false);
  assert.equal(nodes['doc-sim'].value, '');
  assert.equal(rendered, 'sim');
});

test('Comodato non esegue il controllo Apps Script dismesso all’avvio', () => {
  assert.doesNotMatch(read('moduli/dispositivi_comodato.html'), /APPS_SCRIPT_URL/);
});
