'use strict';

const REPOSITORY = 'mirkopiasenti/mirox-crm';
const PRODUCTION_URL = 'https://mirox-crm.it';
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BRANCH = /^codex\/kg-[a-zA-Z0-9_-]+$/;

function releaseError(code, message) {
  return Object.assign(new Error(message), { code });
}
function parsePullNumber(url) {
  const match = String(url || '').match(/^https:\/\/github\.com\/mirkopiasenti\/mirox-crm\/pull\/([1-9][0-9]*)$/);
  return match && Number.isSafeInteger(Number(match[1])) ? Number(match[1]) : null;
}
function validateContract(c) {
  if (!c || !UUID.test(c.incident_id || '') || !UUID.test(c.test_execution_id || '') || c.repository !== REPOSITORY || c.base_branch !== 'main' || !BRANCH.test(c.branch || '')
    || !SHA.test(c.head_sha || '') || !SHA.test(c.base_sha || '') || !parsePullNumber(c.pull_request_url)
    || parsePullNumber(c.pull_request_url) !== c.pull_number) {
    throw releaseError('invalid_release_contract', 'La proposta di pubblicazione non è completa. Ripeti la verifica.');
  }
  return c;
}
function protectedPath(path) {
  return /(^|\/)(\.env(?:\.|$)|netlify\.toml$|package(?:-lock)?\.json$)/.test(path)
    || path.startsWith('.github/') || /^database\/.*\.sql$/i.test(path);
}
function verifyPull(c, pr, currentBase) {
  validateContract(c);
  if (!pr || pr.state !== 'open' || pr.merged || pr.base?.repo?.full_name !== REPOSITORY
    || pr.head?.repo?.full_name !== REPOSITORY || pr.base?.ref !== 'main' || pr.head?.ref !== c.branch
    || pr.number !== c.pull_number || pr.head.sha !== c.head_sha || currentBase !== c.base_sha) {
    throw releaseError('release_changed', 'La modifica o la produzione sono cambiate. Ripeti i test prima di pubblicare.');
  }
}
function verifyFiles(files, expectedCount) {
  if (!files.length || files.length !== expectedCount || files.some(f => protectedPath(f.filename) || (f.previous_filename && protectedPath(f.previous_filename)))) {
    throw releaseError('protected_release', 'La proposta include file protetti o un elenco incompleto. Serve una revisione da Codex.');
  }
}
async function githubRequest(path, { token = process.env.GUARDIAN_GITHUB_TOKEN, method = 'GET', body, request = fetch } = {}) {
  if (!token) throw releaseError('github_not_configured', 'GitHub non è configurato per il rilascio.');
  const response = await request('https://api.github.com' + path, { method,
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw releaseError('github_release_failed', 'GitHub non ha completato il controllo o la pubblicazione (HTTP ' + response.status + ').');
  return data;
}
async function inspectPull(contract, options = {}) {
  const root = '/repos/' + REPOSITORY;
  const [pr, base] = await Promise.all([
    githubRequest(root + '/pulls/' + contract.pull_number, options),
    githubRequest(root + '/git/ref/heads/main', options)
  ]);
  verifyPull(contract, pr, base.object?.sha);
  if (pr.changed_files > 300) throw releaseError('release_too_large', 'La proposta è troppo ampia per una pubblicazione automatica.');
  const files = [];
  for (let page = 1; files.length < pr.changed_files; page++) {
    const batch = await githubRequest(root + '/pulls/' + pr.number + '/files?per_page=100&page=' + page, options);
    if (!Array.isArray(batch) || !batch.length) break;
    files.push(...batch);
  }
  verifyFiles(files, pr.changed_files);
  return pr;
}
function parsePublishedInfo(source) {
  const match = String(source || '').match(/window\.MiroxEnvironmentInfo\s*=\s*(\{[^;]+\});/);
  try { return match ? JSON.parse(match[1]) : null; } catch (_) { return null; }
}
module.exports = { REPOSITORY, PRODUCTION_URL, SHA, BRANCH, releaseError, parsePullNumber,
  validateContract, protectedPath, verifyPull, verifyFiles, githubRequest, inspectPull, parsePublishedInfo };
