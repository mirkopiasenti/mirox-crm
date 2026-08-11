'use strict';

const crypto = require('node:crypto');

const DEFAULT_REPOSITORY = 'mirkopiasenti/mirox-crm';
const DEFAULT_STAGING_BRANCH = 'codex/kona-ai-guardian-staging';
const WORKFLOW_BY_TYPE = {
  analisi_codex: 'guardian-codex-analysis.yml',
  analisi_automatica: 'guardian-observer-analysis.yml',
  scansione_migliorie: 'guardian-observer-analysis.yml',
  prepara_patch: 'guardian-codex-patch.yml',
  test_staging: 'guardian-codex-test.yml',
  rilascio_produzione: 'guardian-codex-release.yml'
};

function cleanWorkerText(value, maxLength = 2000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[redacted-key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted-token]')
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, '[redacted-telegram-token]')
    .trim()
    .slice(0, maxLength);
}

function workerSecret() {
  return String(process.env.GUARDIAN_WORKER_SECRET || '').trim();
}

function hmacSignature(rawBody) {
  const secret = workerSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(String(rawBody || ''), 'utf8').digest('hex');
}

function signaturesMatch(received, expected) {
  const left = Buffer.from(String(received || '').trim().toLowerCase());
  const right = Buffer.from(String(expected || '').trim().toLowerCase());
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyWorkerRequest(event) {
  const expected = hmacSignature(event?.body || '');
  const received = event?.headers?.['x-guardian-worker-signature']
    || event?.headers?.['X-Guardian-Worker-Signature'];
  return Boolean(expected) && signaturesMatch(received, expected);
}

function hashLeaseToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function createLeaseToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseWorkerBody(event) {
  try {
    const body = JSON.parse(event?.body || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch (_) {
    return null;
  }
}

function repositoryName() {
  return cleanWorkerText(process.env.GUARDIAN_GITHUB_REPOSITORY || DEFAULT_REPOSITORY, 200);
}

function stagingBranch() {
  return cleanWorkerText(process.env.GUARDIAN_STAGING_BRANCH || DEFAULT_STAGING_BRANCH, 255);
}

function workflowForType(type) {
  return WORKFLOW_BY_TYPE[type] || null;
}

async function dispatchWorkflow({ executionId, type, ref = stagingBranch(), commitSha = null }) {
  const token = String(process.env.GUARDIAN_GITHUB_TOKEN || '').trim();
  const repository = repositoryName();
  const workflow = cleanWorkerText(
    process.env[`GUARDIAN_${String(type || '').toUpperCase()}_WORKFLOW` || '']
      || workflowForType(type),
    255
  );
  if (!token || !repository || !workflow) {
    return { dispatched: false, reason: 'not_configured', repository, workflow };
  }
  const url = `https://api.github.com/repos/${repository}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;
  const inputs = {
    execution_id: String(executionId),
    requested_type: String(type)
  };
  if (commitSha) inputs.commit_sha = String(commitSha);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'mirox-guardian-worker'
    },
    body: JSON.stringify({ ref, inputs }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    const detail = cleanWorkerText(await response.text().catch(() => ''), 500);
    throw new Error(`GitHub workflow dispatch ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return { dispatched: true, repository, workflow, ref };
}

function analysisKeyboard(incidentId) {
  return {
    inline_keyboard: [
      [{ text: 'Prepara modifica staging', callback_data: `approve_work:${incidentId}` }],
      [{ text: 'Apri conversazione', callback_data: `open:${incidentId}` }],
      [{ text: 'Archivia', callback_data: `archive:${incidentId}` }]
    ]
  };
}

function observerKeyboard(incidentId) {
  return {
    inline_keyboard: [
      [{ text: 'Prepara modifica staging', callback_data: `approve_work:${incidentId}` }],
      [{ text: 'Apri conversazione', callback_data: `open:${incidentId}` }],
      [{ text: 'Archivia', callback_data: `archive:${incidentId}` }]
    ]
  };
}

function patchKeyboard(incidentId) {
  return {
    inline_keyboard: [
      [{ text: 'Avvia test staging', callback_data: `test_staging:${incidentId}` }],
      [{ text: 'Apri conversazione', callback_data: `open:${incidentId}` }],
      [{ text: 'Archivia', callback_data: `archive:${incidentId}` }]
    ]
  };
}

function testKeyboard(incidentId) {
  return {
    inline_keyboard: [
      [{ text: 'Prepara rilascio produzione', callback_data: `release_production:${incidentId}` }],
      [{ text: 'Apri conversazione', callback_data: `open:${incidentId}` }],
      [{ text: 'Archivia', callback_data: `archive:${incidentId}` }]
    ]
  };
}

module.exports = {
  analysisKeyboard,
  observerKeyboard,
  cleanWorkerText,
  createLeaseToken,
  dispatchWorkflow,
  hashLeaseToken,
  hmacSignature,
  parseWorkerBody,
  patchKeyboard,
  repositoryName,
  stagingBranch,
  testKeyboard,
  verifyWorkerRequest,
  workflowForType
};
