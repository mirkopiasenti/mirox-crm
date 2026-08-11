'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifySignal,
  fingerprint,
  sanitizeEvent,
  shouldOpenSignal
} = require('../netlify/functions/_lib/guardian-telemetry');

test('Guardian ripulisce segreti, URL e dati variabili dagli eventi', () => {
  const event = sanitizeEvent({
    event_id: '3b241101-e2bb-4255-8caf-4136c566a962',
    kind: 'http_5xx',
    occurred_at: new Date().toISOString(),
    error: {
      code: 'db_error',
      message: 'Bearer super-secret password=abc123 https://example.test/client/123',
      stack: 'Error at https://example.test/a/123 (file.js:88:3)'
    },
    location: { page_path: '/moduli/test.html?token=secret', operation: 'salva_pratica' },
    context: { action_key: 'salva_pratica', customer_name: 'Mario Rossi', duration_ms: 50 }
  }, { actorHash: 'actor-hash' });

  assert.match(event.error.message, /redacted-token/);
  assert.doesNotMatch(event.error.message, /abc123/);
  assert.doesNotMatch(event.error.stack, /https:\/\//);
  assert.equal(event.location.page_path, '/moduli/test.html');
  assert.equal(event.context.customer_name, undefined);
  assert.equal(event.actor_hash, 'actor-hash');
  assert.equal(event.fingerprint.length, 64);
});

test('eventi con dati variabili hanno lo stesso fingerprint', () => {
  const base = {
    kind: 'function_exception',
    location: { module: 'upload-contratti', operation: 'salva' },
    error: { code: 'db_error', message: 'timeout record 123' }
  };
  assert.equal(fingerprint(sanitizeEvent(base)), fingerprint(sanitizeEvent({
    ...base,
    error: { code: 'db_error', message: 'timeout record 456' }
  })));
});

test("le soglie aprono un segnale solo quando c'e evidenza sufficiente", () => {
  assert.equal(classifySignal({ occurrenceCount: 1, affectedActorCount: 1, kind: 'http_5xx' }), 'bassa');
  assert.equal(classifySignal({ occurrenceCount: 3, affectedActorCount: 1, kind: 'http_5xx' }), 'media');
  assert.equal(classifySignal({ occurrenceCount: 2, affectedActorCount: 2, kind: 'http_5xx' }), 'alta');
  assert.equal(classifySignal({ occurrenceCount: 1, affectedActorCount: 1, kind: 'cron_error', severityHint: 'error' }), 'alta');
  assert.equal(shouldOpenSignal({ occurrenceCount: 2, affectedActorCount: 1, priority: 'alta' }), true);
  assert.equal(shouldOpenSignal({ occurrenceCount: 1, affectedActorCount: 1, priority: 'bassa' }), false);
});
