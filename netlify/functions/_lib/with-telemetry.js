'use strict';

const { ingestTelemetryEvents } = require('../guardian-telemetry-ingest');

async function captureServerError({ supabase, error, functionName, operation, auth, kind = 'function_exception', severityHint = 'error', requestId }) {
  if (!supabase) return false;
  try {
    await ingestTelemetryEvents(supabase, auth || { user: null }, [{
      kind,
      source: 'netlify',
      severity_hint: severityHint,
      occurred_at: new Date().toISOString(),
      release: {
        commit_sha: process.env.COMMIT_REF || process.env.COMMIT_SHA || null,
        deploy_id: process.env.DEPLOY_ID || null
      },
      correlation: { request_id: requestId || null },
      location: { function_name: functionName, operation },
      error: {
        code: error?.code || null,
        message: error?.message || String(error || 'Errore'),
        stack: error?.stack || '',
        http_status: error?.status || null,
        retriable: true
      },
      context: { action_key: operation, retriable: true }
    }]);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { captureServerError };
