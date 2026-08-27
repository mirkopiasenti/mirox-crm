'use strict';

// Utility condivise KONA Call Director.
// Nessun dato personale deve finire nei log: usare cleanLog().

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function jsonOk(data) {
  return response(200, { ok: true, ...data });
}

function jsonError(statusCode, error, extra = {}) {
  return response(statusCode, { ok: false, error, ...extra });
}

function cleanText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

// Chiavi di oggetti da ELIMINARE dai log (segreti / materiale crittografico).
const SECRET_KEYS = new Set([
  'password', 'pass', 'secret', 'client_secret', 'api_key', 'apikey',
  'authorization', 'bearer', 'token', 'access_token', 'refresh_token',
  'refresh_token_cipher', 'token_iv', 'token_tag', 'service_role',
  'service_role_key', 'private_key', 'webhook_secret', 'openai_key',
  'google_client_secret', 'google_token_key', 'cipher', 'iv', 'tag'
]);

function isSecretKey(key) {
  const k = String(key || '').toLowerCase();
  return SECRET_KEYS.has(k);
}

// Mascheratura PII su stringa (telefono, email, CF, P.IVA).
function maskPiiString(value, maxLength) {
  return String(value)
    .replace(/\+?\d[\d\s.-]{8,}\d/g, '[telefono]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g, '[cf]')
    .replace(/\b\d{11}\b/g, '[piva]')
    .slice(0, maxLength);
}

// Sanitizzazione ricorsiva: PRESERVA oggetti e array (JSONB strutturato),
// maschera PII, elimina le chiavi segrete, gestisce profondita', lunghezza,
// tipi non serializzabili e cicli. Accetta sia (value, maxLength) sia
// (value, { maxLength, maxDepth }).
function cleanLog(value, opts = {}) {
  if (typeof opts === 'number') opts = { maxLength: opts };
  const maxLength = Number.isInteger(opts.maxLength) ? opts.maxLength : 500;
  const maxDepth = Number.isInteger(opts.maxDepth) ? opts.maxDepth : 6;
  const maxKeys = Number.isInteger(opts.maxKeys) ? opts.maxKeys : 200;
  const seen = new WeakSet();

  function sanitize(node, depth) {
    if (node === null || node === undefined) return node;
    const type = typeof node;
    if (type === 'string') return maskPiiString(node, maxLength);
    if (type === 'number' || type === 'boolean') return node;
    if (type === 'bigint') return Number(node).toString();
    if (depth > maxDepth) return '[profondita]';
    if (type === 'object') {
      if (seen.has(node)) return '[circolare]';
      seen.add(node);
      try {
        if (node instanceof Date) return node.toISOString();
        if (node instanceof RegExp) return String(node).slice(0, maxLength);
        if (Array.isArray(node)) {
          return node.slice(0, maxLength).map((item) => sanitize(item, depth + 1));
        }
        const keys = Object.keys(node).slice(0, maxKeys);
        const out = {};
        for (const key of keys) {
          if (isSecretKey(key)) continue;
          const val = node[key];
          if (typeof val === 'function' || typeof val === 'symbol') continue;
          out[key] = sanitize(val, depth + 1);
        }
        return out;
      } finally {
        seen.delete(node);
      }
    }
    return String(node).slice(0, maxLength);
  }

  return sanitize(value, 0);
}

function isUuid(value) {
  return UUID_RE.test(String(value || '').toLowerCase());
}

function parseJson(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'si', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parseNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getBearer(event) {
  const header = String(event?.headers?.['authorization'] || event?.headers?.['Authorization'] || '').trim();
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

async function readJsonBody(event) {
  if (!event?.body) return {};
  const raw = typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
  return parseJson(raw, {});
}

function env(name, fallback = null) {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

function isStaging() {
  return String(process.env.MIROX_DEPLOY_ENV || '').trim() === 'staging';
}

function safeProfileId(profilo, user) {
  const value = profilo?.alias_di || profilo?.id || user?.id;
  return isUuid(value) ? String(value).toLowerCase() : null;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = {
  CORS_HEADERS,
  UUID_RE,
  cleanLog,
  cleanText,
  env,
  getBearer,
  isBlank,
  isStaging,
  isUuid,
  jsonError,
  jsonOk,
  nowIso,
  parseBoolean,
  parseJson,
  parseNumber,
  readJsonBody,
  response,
  safeProfileId,
  _test: { isSecretKey, maskPiiString }
};
