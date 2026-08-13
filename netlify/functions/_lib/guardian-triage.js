'use strict';

const { classifySignal, shouldOpenSignal } = require('./guardian-telemetry');

function criticalOperation(signal) {
  const operation = String(signal?.location?.operation || signal?.location?.function_name || '').toLowerCase();
  return ['login', 'finalize', 'finalizza', 'upload', 'otp', 'privacy', 'delete', 'elimina'].some((token) => operation.includes(token));
}

function transientNetworkSignal(signal) {
  return String(signal?.kind || '').toLowerCase() === 'network_error'
    && !Number(signal?.error_sample?.http_status || signal?.http_status || 0);
}

function evaluateSignal(signal, now = Date.now()) {
  const occurrenceCount = Number(signal?.occurrence_count || 0);
  const affectedActorCount = Number(signal?.affected_actor_count || 0);
  const isTransientNetwork = transientNetworkSignal(signal);
  const priority = isTransientNetwork
    ? occurrenceCount >= 5 && affectedActorCount >= 2
      ? 'alta'
      : occurrenceCount >= 3 || affectedActorCount >= 2
        ? 'media'
        : 'bassa'
    : classifySignal({
        occurrenceCount,
        affectedActorCount,
        kind: signal?.kind,
        severityHint: signal?.error_sample?.severity_hint || signal?.severity_hint || 'error',
        criticalOperation: criticalOperation(signal)
      });
  const shouldOpen = isTransientNetwork
    ? occurrenceCount >= 3 || affectedActorCount >= 2
    : shouldOpenSignal({
        occurrenceCount,
        affectedActorCount,
        priority,
        lastNotifiedAt: signal?.last_notified_at,
        now
      });
  return {
    priority,
    shouldOpen,
    immediate: priority === 'critica',
    digestOnly: priority === 'bassa' && !shouldOpen,
    transientNetwork: isTransientNetwork
  };
}

module.exports = { criticalOperation, evaluateSignal, transientNetworkSignal };
