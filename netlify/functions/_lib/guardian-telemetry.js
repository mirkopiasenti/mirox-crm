'use strict';

const crypto = require('node:crypto');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_SHA_RE = /^[0-9a-f]{7,128}$/i;
const ALLOWED_KINDS = new Set([
  'frontend_exception',
  'unhandled_rejection',
  'http_5xx',
  'network_error',
  'timeout',
  'function_exception',
  'provider_error',
  'cron_error',
  'ci_failure',
  'performance'
]);
const SEVERITIES = new Set(['info', 'warning', 'error', 'critical']);
const SAFE_CONTEXT_KEYS = new Set([
  'action_key',
  'browser_family',
  'viewport_bucket',
  'online',
  'duration_ms',
  'retriable'
]);

function text(value, max = 500) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/gi, '[redacted-key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted-token]')
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, '[redacted-telegram-token]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]')
    .replace(/\b(?:password|passwd|token|secret|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function environment() {
  const value = String(process.env.MIROX_DEPLOY_ENV || '').trim().toLowerCase();
  return value === 'staging' ? 'staging' : 'production';
}

function actorHash(value) {
  const actor = text(value, 200);
  const secret = String(process.env.GUARDIAN_TELEMETRY_HASH_SECRET || process.env.GUARDIAN_WORKER_SECRET || '').trim();
  if (!actor || !secret) return null;
  return crypto.createHmac('sha256', secret).update(actor, 'utf8').digest('hex');
}

function normalizeStack(value) {
  return text(value, 4000)
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/\b\d{2,}\b/g, '[n]');
}

function safeLocation(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const path = text(input.page_path, 300).split(/[?#]/)[0];
  const result = {
    page_path: path.startsWith('/') ? path : null,
    module: text(input.module, 120) || null,
    function_name: text(input.function_name, 160) || null,
    operation: text(input.operation, 160) || null,
    file: text(input.file, 300) || null,
    line: Number.isInteger(Number(input.line)) ? Math.max(0, Math.min(Number(input.line), 100000)) : null,
    column: Number.isInteger(Number(input.column)) ? Math.max(0, Math.min(Number(input.column), 100000)) : null
  };
  return result;
}

function safeContext(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of SAFE_CONTEXT_KEYS) {
    if (!(key in input)) continue;
    if (key === 'online' || key === 'retriable') result[key] = Boolean(input[key]);
    else if (key === 'duration_ms') result[key] = Math.max(0, Math.min(Number(input[key]) || 0, 3600000));
    else result[key] = text(input[key], 120) || null;
  }
  return result;
}

function safeBreadcrumbs(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-10).map((item) => ({
    action_key: text(item?.action_key, 120) || 'unknown',
    age_ms: Math.max(0, Math.min(Number(item?.age_ms) || 0, 86400000))
  }));
}

function parseOccurredAt(value) {
  const parsed = new Date(value || Date.now());
  if (!Number.isFinite(parsed.getTime())) return new Date().toISOString();
  const min = Date.now() - 24 * 60 * 60 * 1000;
  const max = Date.now() + 5 * 60 * 1000;
  return new Date(Math.max(min, Math.min(max, parsed.getTime()))).toISOString();
}

function sanitizeEvent(input, options = {}) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const kind = ALLOWED_KINDS.has(raw.kind) ? raw.kind : 'function_exception';
  const severity = SEVERITIES.has(raw.severity_hint) ? raw.severity_hint : 'error';
  const release = raw.release && typeof raw.release === 'object' ? raw.release : {};
  const error = raw.error && typeof raw.error === 'object' ? raw.error : {};
  const eventId = UUID_RE.test(String(raw.event_id || '')) ? String(raw.event_id).toLowerCase() : crypto.randomUUID();
  const commit = HEX_SHA_RE.test(String(options.commitSha || release.commit_sha || ''))
    ? String(options.commitSha || release.commit_sha).toLowerCase()
    : null;
  const requestId = text(options.requestId || raw.correlation?.request_id, 120) || null;
  const sanitized = {
    event_id: eventId,
    kind,
    source: text(options.source || raw.source || 'mirox', 40) || 'mirox',
    severity_hint: severity,
    occurred_at: parseOccurredAt(raw.occurred_at),
    release_commit_sha: commit,
    deploy_id: text(options.deployId || release.deploy_id, 160) || null,
    request_id: requestId,
    actor_hash: options.actorHash || actorHash(raw.actor_id || raw.actor_hash),
    location: safeLocation(raw.location),
    error: {
      code: text(error.code, 160) || null,
      message: text(error.message, 500) || 'Errore non specificato',
      stack: normalizeStack(error.stack),
      http_status: Number.isInteger(Number(error.http_status)) ? Math.max(0, Math.min(Number(error.http_status), 599)) : null,
      retriable: Boolean(error.retriable)
    },
    context: {
      ...safeContext(raw.context),
      breadcrumbs: safeBreadcrumbs(raw.breadcrumbs)
    }
  };
  sanitized.fingerprint = fingerprint(sanitized);
  return sanitized;
}

function normalizeForFingerprint(value) {
  return text(value, 1200)
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/g, '[id]')
    .replace(/\b\d+\b/g, '[n]')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(event) {
  const location = event.location || {};
  const error = event.error || {};
  const stable = [
    event.kind,
    normalizeForFingerprint(error.code),
    normalizeForFingerprint(location.module || location.function_name || location.page_path),
    normalizeForFingerprint(location.operation),
    error.http_status || '',
    normalizeForFingerprint(error.stack || error.message)
  ].join('|');
  return crypto.createHash('sha256').update(stable, 'utf8').digest('hex');
}

function classifySignal({ occurrenceCount = 1, affectedActorCount = 1, kind, severityHint = 'error', criticalOperation = false }) {
  if (severityHint === 'critical' || criticalOperation) return 'critica';
  if (kind === 'cron_error' || kind === 'ci_failure') return 'alta';
  if (occurrenceCount >= 2 && affectedActorCount >= 2) return 'alta';
  if (occurrenceCount >= 3) return 'media';
  return 'bassa';
}

function shouldOpenSignal({ occurrenceCount, affectedActorCount, priority, lastNotifiedAt, now = Date.now() }) {
  if (priority === 'critica') return true;
  if (priority === 'alta') return occurrenceCount >= 2 || affectedActorCount >= 2;
  if (priority === 'media') return occurrenceCount >= 3;
  if (!lastNotifiedAt) return false;
  return now - new Date(lastNotifiedAt).getTime() > 24 * 60 * 60 * 1000 && occurrenceCount >= 5;
}

function retryDelay(attempts) {
  const minutes = [1, 5, 15, 60][Math.min(Math.max(Number(attempts) || 0, 0), 3)];
  return minutes * 60 * 1000;
}

module.exports = {
  ALLOWED_KINDS,
  actorHash,
  classifySignal,
  environment,
  fingerprint,
  retryDelay,
  safeContext,
  safeLocation,
  sanitizeEvent,
  shouldOpenSignal,
  text
};
