'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSignal } = require('../netlify/functions/_lib/guardian-triage');
const { preliminaryText } = require('../netlify/functions/cron-guardian-observer');

test('Observer considera critiche le operazioni dati sensibili', () => {
  const result = evaluateSignal({
    kind: 'http_5xx',
    occurrence_count: 1,
    affected_actor_count: 1,
    location: { operation: 'finalizza_pratica' },
    error_sample: { severity_hint: 'error' }
  });
  assert.equal(result.priority, 'critica');
  assert.equal(result.immediate, true);
});

test('notifica preliminare non contiene stack o identificativi personali', () => {
  const message = preliminaryText(
    { numero: 12, tipo_richiesta: 'problema' },
    {
      priorita: 'alta',
      ambiente: 'staging',
      occurrence_count: 4,
      affected_actor_count: 2,
      location: { module: 'upload-contratti' },
      error_sample: { message: 'HTTP 500 salvataggio fallito' }
    },
    true
  );
  assert.match(message, /KG-000012/);
  assert.match(message, /analisi read-only/);
  assert.doesNotMatch(message, /password|Bearer|@/i);
});
