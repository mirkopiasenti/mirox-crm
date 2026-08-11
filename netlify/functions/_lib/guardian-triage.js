'use strict';

const { classifySignal, shouldOpenSignal } = require('./guardian-telemetry');

function criticalOperation(signal) {
  const operation = String(signal?.location?.operation || signal?.location?.function_name || '').toLowerCase();
  return ['login', 'finalize', 'finalizza', 'upload', 'otp', 'privacy', 'delete', 'elimina'].some((token) => operation.includes(token));
}

function evaluateSignal(signal, now = Date.now()) {
  const priority = classifySignal({
    occurrenceCount: Number(signal?.occurrence_count || 0),
    affectedActorCount: Number(signal?.affected_actor_count || 0),
    kind: signal?.kind,
    severityHint: signal?.error_sample?.severity_hint || signal?.severity_hint || 'error',
    criticalOperation: criticalOperation(signal)
  });
  const shouldOpen = shouldOpenSignal({
    occurrenceCount: Number(signal?.occurrence_count || 0),
    affectedActorCount: Number(signal?.affected_actor_count || 0),
    priority,
    lastNotifiedAt: signal?.last_notified_at,
    now
  });
  return {
    priority,
    shouldOpen,
    immediate: priority === 'critica',
    digestOnly: priority === 'bassa' && !shouldOpen
  };
}

module.exports = { criticalOperation, evaluateSignal };
