'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSignal } = require('../netlify/functions/_lib/guardian-triage');
const { preliminaryText } = require('../netlify/functions/cron-guardian-observer');
const { handler: telemetryHandler } = require('../netlify/functions/guardian-telemetry-ingest');
const { _test: workerTest } = require('../netlify/functions/guardian-codex-worker');

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

test('il collector telemetria esporta un handler caricabile dal worker', () => {
  assert.equal(typeof telemetryHandler, 'function');
});

test('un singolo errore di rete durante un upload resta in osservazione', () => {
  const result = evaluateSignal({
    kind: 'network_error',
    occurrence_count: 1,
    affected_actor_count: 1,
    location: { operation: 'upload_documento' },
    error_sample: { severity_hint: 'error', message: 'Failed to fetch' }
  });
  assert.equal(result.priority, 'bassa');
  assert.equal(result.shouldOpen, false);
  assert.equal(result.immediate, false);
  assert.equal(result.transientNetwork, true);
});

test('un errore di rete ripetuto viene aperto senza diventare critico', () => {
  const result = evaluateSignal({
    kind: 'network_error',
    occurrence_count: 3,
    affected_actor_count: 1,
    location: { operation: 'upload_documento' },
    error_sample: { severity_hint: 'error', message: 'Failed to fetch' }
  });
  assert.equal(result.priority, 'media');
  assert.equal(result.shouldOpen, true);
  assert.equal(result.immediate, false);
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
  assert.match(message, /Che cosa è successo/);
  assert.match(message, /Cosa faccio ora/);
  assert.doesNotMatch(message, /read-only|network_error|Failed to fetch/i);
  assert.doesNotMatch(message, /password|Bearer|@/i);
});

test('l’esito Observer chiede un solo dato in linguaggio semplice e non propone patch', () => {
  const execution = {
    tipo_esecuzione: 'analisi_automatica',
    incidente_id: 'incident-id'
  };
  const result = {
    summary: 'Non è possibile confermare un problema del CRM da un solo tentativo non riuscito.',
    missing_data: ['Indica quale pulsante hai premuto e che cosa è comparso sullo schermo.'],
    safe_to_prepare_patch: false,
    blocked: false
  };
  const message = workerTest.resultMessage(execution, { result, summary: result.summary }, true);
  const keyboard = workerTest.keyboardForExecution(execution, result);
  const buttons = JSON.stringify(keyboard);
  assert.match(message, /Che cosa significa/);
  assert.match(message, /Informazione necessaria/);
  assert.match(message, /quale pulsante/i);
  assert.match(buttons, /Aggiungi informazioni/);
  assert.doesNotMatch(buttons, /Prepara modifica staging/);
});

test('una patch che richiede informazioni è un esito normale senza pulsante test', () => {
  const execution = { tipo_esecuzione: 'prepara_patch', incidente_id: 'incident-id' };
  const body = {
    summary: 'Quale operazione stavi eseguendo e che cosa ti aspettavi?',
    result: { needs_information: true }
  };
  const message = workerTest.resultMessage(execution, body, true);
  const buttons = JSON.stringify(workerTest.keyboardForExecution(execution, body.result));
  assert.match(message, /non ci sono ancora informazioni sufficienti/i);
  assert.match(buttons, /Aggiungi informazioni/);
  assert.doesNotMatch(buttons, /Avvia test staging/);
});
