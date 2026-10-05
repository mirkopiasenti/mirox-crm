'use strict';

const fs = require('node:fs');

function classify(status, code) {
  if (status === 401 || code === 'invalid_api_key') return 'openai_invalid_key';
  if (status === 403 || status === 404 || code === 'model_not_found') return 'openai_model_unavailable';
  if (code === 'insufficient_quota') return 'openai_quota_exceeded';
  return 'openai_unavailable';
}

async function preflight({ apiKey, model, request = fetch }) {
  if (!apiKey) return { ready: false, error_code: 'openai_key_missing' };
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model || '')) return { ready: false, error_code: 'openai_model_unavailable' };
  try {
    const response = await request(`https://api.openai.com/v1/models/${model}`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000)
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok ? { ready: true, error_code: '' }
      : { ready: false, error_code: classify(response.status, payload.error?.code) };
  } catch (_) {
    return { ready: false, error_code: 'openai_unavailable' };
  }
}

if (require.main === module) {
  preflight({ apiKey: process.env.OPENAI_API_KEY_CODEX_WORKER?.trim(), model: process.env.CODEX_MODEL }).then((result) => {
    // Never print provider bodies, headers, key fragments or exception messages.
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `ready=${result.ready}\nerror_code=${result.error_code}\n`);
    console.log(result.ready ? 'OpenAI: chiave e modello accessibili.' : `OpenAI: ${result.error_code}`);
  });
}

module.exports = { preflight, classify };
