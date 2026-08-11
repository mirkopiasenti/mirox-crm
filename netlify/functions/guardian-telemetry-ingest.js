'use strict';

const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const {
  actorHash,
  classifySignal,
  environment,
  sanitizeEvent,
  text
} = require('./_lib/guardian-telemetry');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};
const MAX_EVENTS = 20;
const MAX_BODY_BYTES = 64 * 1024;

function response(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function parseBody(event) {
  const raw = String(event?.body || '');
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return null;
  try {
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body;
  } catch (_) {
    return null;
  }
}

function releaseMatch(query, releaseSha) {
  return releaseSha ? query.eq('release_commit_sha', releaseSha) : query.is('release_commit_sha', null);
}

async function findSignal(supabase, event) {
  let query = supabase
    .from('kona_ai_segnali')
    .select('*')
    .eq('ambiente', event.ambiente)
    .eq('fingerprint', event.fingerprint);
  query = releaseMatch(query, event.release_commit_sha);
  return query.maybeSingle();
}

async function getOrCreateSignal(supabase, event) {
  const existing = await findSignal(supabase, event);
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data;

  const priority = classifySignal({
    occurrenceCount: 1,
    affectedActorCount: event.actor_hash ? 1 : 0,
    kind: event.kind,
    severityHint: event.severity_hint,
    criticalOperation: event.context.action_key === 'login' || event.context.action_key === 'finalize_pratica'
  });
  const { data, error } = await supabase.from('kona_ai_segnali').insert({
    ambiente: event.ambiente,
    fingerprint: event.fingerprint,
    stato: 'osservando',
    priorita: priority,
    kind: event.kind,
    source: event.source,
    release_commit_sha: event.release_commit_sha,
    deploy_id: event.deploy_id,
    location: event.location,
    error_sample: event.error,
    occurrence_count: 0,
    affected_actor_count: 0
  }).select('*').single();
  if (!error) return data;
  const retry = await findSignal(supabase, event);
  if (retry.error) throw retry.error;
  if (!retry.data) throw error;
  return retry.data;
}

async function insertEvent(supabase, event, signal, auth) {
  const { data, error } = await supabase.from('kona_ai_eventi_tecnici').insert({
    event_id: event.event_id,
    segnale_id: signal.id,
    ambiente: event.ambiente,
    kind: event.kind,
    source: event.source,
    severity_hint: event.severity_hint,
    occurred_at: event.occurred_at,
    release_commit_sha: event.release_commit_sha,
    deploy_id: event.deploy_id,
    request_id: event.request_id,
    actor_hash: event.actor_hash,
    location: event.location,
    error: event.error,
    context: event.context
  }).select('id').maybeSingle();
  if (!error) return { inserted: Boolean(data), duplicate: false };
  if (/duplicate key|unique constraint/i.test(String(error.message || ''))) {
    return { inserted: false, duplicate: true };
  }
  throw error;
}

async function updateSignal(supabase, signal, event, inserted) {
  if (!inserted) return signal;
  const nextCount = Number(signal.occurrence_count || 0) + 1;
  const actorAdded = event.actor_hash && !(signal.error_sample?.actor_hashes || []).includes(event.actor_hash);
  const actorCount = Number(signal.affected_actor_count || 0) + (actorAdded ? 1 : 0);
  const actorHashes = Array.isArray(signal.error_sample?.actor_hashes)
    ? signal.error_sample.actor_hashes.slice(0, 4)
    : [];
  if (event.actor_hash && actorAdded && actorHashes.length < 4) actorHashes.push(event.actor_hash);
  const priority = classifySignal({
    occurrenceCount: nextCount,
    affectedActorCount: actorCount,
    kind: event.kind,
    severityHint: event.severity_hint,
    criticalOperation: event.context.action_key === 'login' || event.context.action_key === 'finalize_pratica'
  });
  const { data, error } = await supabase.from('kona_ai_segnali').update({
    priorita: priority,
    occurrence_count: nextCount,
    affected_actor_count: actorCount,
    last_seen_at: event.occurred_at,
    error_sample: { ...event.error, actor_hashes: actorHashes }
  }).eq('id', signal.id).select('*').single();
  if (error) throw error;
  return data;
}

async function ingest(supabase, auth, events) {
  const accepted = [];
  for (const raw of events) {
    const event = sanitizeEvent(raw, { actorHash: actorHash(auth.user?.id) });
    event.ambiente = environment();
    const signal = await getOrCreateSignal(supabase, event);
    const inserted = await insertEvent(supabase, event, signal, auth);
    const updated = await updateSignal(supabase, signal, event, inserted.inserted);
    accepted.push({ event_id: event.event_id, duplicate: inserted.duplicate, fingerprint: event.fingerprint, priority: updated.priorita });
  }
  return accepted;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Metodo non consentito' });
  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { ok: false, error: auth.error });
  const body = parseBody(event);
  if (!body) return response(413, { ok: false, error: 'Payload non valido o troppo grande' });
  const events = Array.isArray(body.events) ? body.events : [body.event || body];
  if (!events.length || events.length > MAX_EVENTS) return response(400, { ok: false, error: `Sono ammessi da 1 a ${MAX_EVENTS} eventi` });
  const supabase = getAdminClient();
  if (!supabase) return response(500, { ok: false, error: 'Database Guardian non configurato' });
  try {
    const accepted = await ingest(supabase, auth, events);
    return response(202, { ok: true, accepted });
  } catch (error) {
    console.error('guardian-telemetry-ingest:', text(error?.message || error, 500));
    return response(500, { ok: false, error: 'Telemetria non acquisita' });
  }
};

module.exports = { handler, ingestTelemetryEvents: ingest, _test: { parseBody, ingest } };
