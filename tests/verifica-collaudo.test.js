'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../js/verifica-contratti-core');
const { handler: api } = require('../netlify/functions/gestisci-verifica-automatica');
const { handler: cron } = require('../netlify/functions/cron-verifica-contratti');
const ID = '11111111-1111-4111-8111-111111111111';

test('collaudo diurno accoda solo il contratto scelto prima del suo turno serale', async () => {
  const changes = [], dispatches = [], tables = [];
  const later = new Date(Date.now() + 86400000).toISOString();
  const review = { revisione: 3, primo_turno_at: later, primo_tentativo_at: null, ultimo_tentativo_at: null };
  const db = { async rpc(name) { assert.equal(name, 'vendita_verifica_sync'); return { data: null }; }, from(table) {
    tables.push(table);
    const q = { select() { return q; }, eq() { return q; }, or() { return q; }, update(patch) { changes.push({ table, patch }); return q; }, async single() {
      return { data: table === 'vendita_verifica_config' ? { modalita: 'collaudo' } : table === 'vendita_contratti' ? { id: ID, stato_controllo: 'da_controllare', pratica_id: ID }
        : table === 'vendita_pratiche' ? { stato_pratica: 'inviata' } : review };
    }, async maybeSingle() { return { data: { contratto_id: ID } }; } }; return q;
  } };
  const before = Date.now();
  const res = await api({ httpMethod: 'POST', body: JSON.stringify({ action: 'preview', contratto_id: ID }) }, {
    db, requireAuth: async () => ({ ok: true, profilo: { id: ID, ruolo: 'admin' } }), nudge: async payload => dispatches.push(payload)
  });
  assert.equal(res.statusCode, 202); assert.equal(JSON.parse(res.body).collaudo, true);
  assert.equal(changes.length, 1); assert.equal(changes[0].table, 'vendita_verifiche');
  assert.equal(changes[0].patch.modalita_job, 'collaudo');
  assert.ok(Date.parse(changes[0].patch.prossimo_at) >= before);
  assert.ok(Date.parse(changes[0].patch.prossimo_at) < Date.parse(later));
  assert.equal(review.primo_tentativo_at, null);
  assert.deepEqual(dispatches, [{ id: ID, test: true }]);
  assert.ok(!tables.includes('vendita_verifica_notifiche'));
});

test('cron in collaudo recupera la prova richiesta senza avviare backlog o notifiche', async () => {
  const tables = [], dispatches = [];
  const db = { from(table) { tables.push(table); const q = { select() { return q; }, eq() { return q; }, in() { return q; }, lte() { return q; }, lt() { return q; }, or() { return q; },
    async single() { return { data: { modalita: 'collaudo' } }; }, async limit() { return { data: [{ contratto_id: ID }] }; } }; return q; },
    async rpc() { assert.fail('Nessun avvio del backlog automatico in collaudo'); } };
  const res = await cron({}, { db, nudge: async p => dispatches.push(p) });
  assert.equal(res.statusCode, 200); assert.deepEqual(dispatches, [{ id: ID, test: true }]);
  assert.ok(!tables.includes('vendita_verifica_notifiche'));
});

for (const focused of ['button', 'date']) test(`polling dettaglio con focus ${focused}: esito aggiornato e data in modifica protetta`, async () => {
  let rendered = '';
  const active = { matches: selector => focused === 'date' && selector === 'input[data-vc-date]' };
  const section = { contains: node => node === active, set outerHTML(value) { rendered = value; } };
  const data = { success: true, modalita: 'collaudo', admin: true, csv: null, notifications: [], reviews: [{ contratto_id: ID,
    esito: 'da_controllare', risultato: { esito: 'da_verificare', errors: [{ message: 'Nuovo esito disponibile' }], checks: [], waiting: [], patch: {} } }] };
  const window = { MiroxSafe: { escapeHtml: s => String(s) }, MiroxVerificaCore: Core,
    MiroxApi: { fetch: async () => ({ ok: true, json: async () => data }) },
    __currentVerificaContratto: { id: ID, stato_controllo: 'da_controllare' }, __currentVerificaModal: { body: { querySelector: () => section } } };
  const context = vm.createContext({ window, document: { hidden: true, activeElement: active, getElementById: () => null, addEventListener() {} }, setTimeout() {} });
  vm.runInContext(fs.readFileSync(require.resolve('../js/verifica-contratti-automatica.js'), 'utf8'), context);
  await window.MiroxVerificaAuto.refresh();
  assert.equal(rendered.includes('Nuovo esito disponibile'), focused === 'button');
});
