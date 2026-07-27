const assert = require('node:assert/strict');
const test = require('node:test');

const kpiModule = require('../netlify/functions/admin-kpi-vendita-consumer.js');
const {
  SELECTED_MNP_LABEL,
  addContractToMetrics,
  buildProfileResolver,
  classifyMnp,
  emptyMetrics,
  parseStore,
  parseYear,
  romeMonthIndex,
  serializeMetrics
} = kpiModule._test;

test('il dettaglio MNP distingue standard e gestori selezionati', () => {
  assert.equal(classifyMnp('MNP Standard'), 'mnp_standard');
  assert.equal(classifyMnp(SELECTED_MNP_LABEL), 'mnp_selected');
  assert.equal(classifyMnp('MNP Iliad'), 'mnp_selected');
  assert.equal(classifyMnp('Nuovo numero'), null);
});

test('i conteggi Mobile usano il mese Europe/Rome e il flag smartphone', () => {
  const metrics = emptyMetrics();

  addContractToMetrics(metrics, {
    data_contratto: '2026-01-31T23:30:00.000Z',
    nome_opzione_snapshot: 'MNP Standard',
    dispositivo_associato: true
  });
  addContractToMetrics(metrics, {
    data_contratto: '2026-02-14T10:00:00.000Z',
    nome_opzione_snapshot: SELECTED_MNP_LABEL,
    dispositivo_associato: false
  });
  addContractToMetrics(metrics, {
    data_contratto: '2026-02-28T12:00:00.000Z',
    nome_opzione_snapshot: 'Nuovo numero',
    dispositivo_associato: true
  });

  const serialized = serializeMetrics(metrics);
  assert.equal(romeMonthIndex('2026-01-31T23:30:00.000Z'), 1);
  assert.equal(serialized.acquisitions.months[1], 3);
  assert.equal(serialized.acquisitions.total, 3);
  assert.equal(serialized.mnp_standard.months[1], 1);
  assert.equal(serialized.mnp_selected.months[1], 1);
  assert.equal(serialized.smartphone.months[1], 2);
});

test('il confronto operatori consolida i profili alias sul canonico', () => {
  const resolver = buildProfileResolver([
    { id: 'matteo', nome: 'Matteo', email: null, alias_di: null },
    { id: 'matteo-vecchio', nome: 'Matteo storico', email: null, alias_di: 'matteo' },
    { id: 'francesca', nome: null, email: 'francesca@example.com', alias_di: null }
  ]);

  assert.equal(resolver.canonicalId('matteo-vecchio'), 'matteo');
  assert.equal(resolver.label(resolver.canonicalId('matteo-vecchio')), 'Matteo');
  assert.equal(resolver.label('francesca'), 'francesca@example.com');
  assert.equal(resolver.label('__unassigned__'), 'Operatore non assegnato');
});

test('anno e punto vendita accettano soltanto i filtri previsti', () => {
  assert.equal(parseYear('2026'), 2026);
  assert.equal(parseStore('all'), 'all');
  assert.equal(parseStore('9001415852'), '9001415852');
  assert.equal(parseStore('9000822241'), '9000822241');
  assert.throws(() => parseYear('2019'), /Anno non valido/);
  assert.throws(() => parseStore('altro'), /Punto vendita non valido/);
});
