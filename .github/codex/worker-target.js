'use strict';

function validWorkerTarget(value, environment) {
  try {
    const url = new URL(value);
    const host = environment === 'production' ? 'mirox-crm.it'
      : environment === 'staging' ? 'mirox-crm-staging.netlify.app' : null;
    return Boolean(host && url.protocol === 'https:' && url.hostname === host
      && !url.port && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === '/.netlify/functions/guardian-codex-worker');
  } catch (_) { return false; }
}

if (require.main === module && !validWorkerTarget(process.env.GUARDIAN_WORKER_URL, process.env.TARGET_ENVIRONMENT)) {
  console.error('Worker Guardian non coerente con l’ambiente richiesto. Nessun claim eseguito.');
  process.exitCode = 1;
}
module.exports = { validWorkerTarget };
