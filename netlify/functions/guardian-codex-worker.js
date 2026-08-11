'use strict';

const { getAdminClient } = require('./_lib/require-auth');
const {
  analysisKeyboard,
  cleanWorkerText,
  createLeaseToken,
  hashLeaseToken,
  parseWorkerBody,
  patchKeyboard,
  testKeyboard,
  verifyWorkerRequest
} = require('./_lib/guardian-codex');
const {
  cleanText,
  incidentCode,
  requestTypeLabel
} = require('./_lib/kona-ai-guardian');
const { sendTelegramMessage } = require('./_lib/telegram');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXECUTION_TYPES = new Set(['analisi_codex', 'prepara_patch', 'test_staging', 'rilascio_produzione']);
const ACTIVE_STATES = new Set(['in_coda', 'in_esecuzione']);
const LEASE_MINUTES = 15;

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function nowIso() {
  return new Date().toISOString();
}

function datePlusMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isUuid(value) {
  return UUID_RE.test(String(value || ''));
}

function sanitizeValue(value, depth = 0) {
  if (depth > 2) return null;
  if (typeof value === 'string') return cleanWorkerText(value, 4000);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 50).map(([key, item]) => [cleanWorkerText(key, 100), sanitizeValue(item, depth + 1)])
    );
  }
  return null;
}

function executionType(value) {
  const type = cleanWorkerText(value, 40);
  return EXECUTION_TYPES.has(type) ? type : null;
}

async function loadExecution(supabase, executionId) {
  const { data, error } = await supabase
    .from('kona_ai_esecuzioni')
    .select('*')
    .eq('id', executionId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadContext(supabase, execution) {
  const { data: incident, error: incidentError } = await supabase
    .from('kona_ai_incidenti')
    .select('id, numero, tipo_richiesta, stato, priorita, titolo, descrizione_iniziale, riepilogo_ai, riepilogo_risoluzione, pagina_path, pagina_titolo, contesto_client, created_at, updated_at')
    .eq('id', execution.incidente_id)
    .maybeSingle();
  if (incidentError) throw incidentError;
  if (!incident) throw new Error('Richiesta Guardian non trovata');

  const { data: messages, error: messagesError } = await supabase
    .from('kona_ai_messaggi')
    .select('canale, autore_tipo, testo, metadati, created_at')
    .eq('incidente_id', incident.id)
    .order('created_at', { ascending: true })
    .limit(60);
  if (messagesError) throw messagesError;

  return {
    execution: {
      id: execution.id,
      type: execution.tipo_esecuzione,
      base_commit_sha: execution.base_commit_sha,
      branch_name: execution.branch_name,
      repository: execution.repository,
      model: execution.modello,
      sandbox: execution.sandbox
    },
    incident: {
      code: incidentCode(incident.numero),
      type: incident.tipo_richiesta,
      status: incident.stato,
      priority: incident.priorita,
      title: cleanWorkerText(incident.titolo, 180),
      initial_description: cleanWorkerText(incident.descrizione_iniziale, 4000),
      summary: cleanWorkerText(incident.riepilogo_ai, 2200),
      resolution_summary: cleanWorkerText(incident.riepilogo_risoluzione, 2200),
      page_path: cleanWorkerText(incident.pagina_path, 300),
      page_title: cleanWorkerText(incident.pagina_titolo, 200),
      client_context: sanitizeValue(incident.contesto_client)
    },
    conversation: (messages || []).map((item) => ({
      channel: item.canale,
      author: item.autore_tipo,
      text: cleanWorkerText(item.testo, 4000),
      metadata: sanitizeValue(item.metadati),
      created_at: item.created_at
    }))
  };
}

async function claimExecution(supabase, body) {
  const executionId = String(body.execution_id || '').trim();
  if (!isUuid(executionId)) return response(400, { ok: false, error: 'execution_id non valido' });
  const execution = await loadExecution(supabase, executionId);
  if (!execution) return response(404, { ok: false, error: 'Esecuzione non trovata' });
  if (!ACTIVE_STATES.has(execution.stato)) {
    return response(409, { ok: false, error: `Esecuzione non disponibile nello stato ${execution.stato}` });
  }
  if (execution.stato === 'in_esecuzione' && execution.lease_expires_at && new Date(execution.lease_expires_at).getTime() > Date.now()) {
    return response(409, { ok: false, error: 'Esecuzione già presa in carico' });
  }
  const leaseToken = createLeaseToken();
  const now = nowIso();
  const values = {
    stato: 'in_esecuzione',
    lease_token_hash: hashLeaseToken(leaseToken),
    lease_expires_at: datePlusMinutes(LEASE_MINUTES),
    heartbeat_at: now,
    avviata_at: execution.avviata_at || now,
    tentativi: Number(execution.tentativi || 0) + 1,
    workflow_run_id: Number.isSafeInteger(Number(body.workflow_run_id)) ? Number(body.workflow_run_id) : execution.workflow_run_id
  };
  const { data: claimed, error } = await supabase
    .from('kona_ai_esecuzioni')
    .update(values)
    .eq('id', execution.id)
    .eq('stato', execution.stato)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!claimed) return response(409, { ok: false, error: 'Esecuzione già presa in carico' });
  const context = await loadContext(supabase, claimed);
  return response(200, { ok: true, lease_token: leaseToken, context });
}

async function requireLease(supabase, body) {
  const executionId = String(body.execution_id || '').trim();
  const leaseToken = String(body.lease_token || '').trim();
  if (!isUuid(executionId) || leaseToken.length < 32) {
    return { error: response(400, { ok: false, error: 'Lease non valido' }) };
  }
  const execution = await loadExecution(supabase, executionId);
  if (!execution) return { error: response(404, { ok: false, error: 'Esecuzione non trovata' }) };
  if (execution.stato !== 'in_esecuzione' || execution.lease_token_hash !== hashLeaseToken(leaseToken)) {
    return { error: response(409, { ok: false, error: 'Lease scaduto o non valido' }) };
  }
  if (execution.lease_expires_at && new Date(execution.lease_expires_at).getTime() <= Date.now()) {
    return { error: response(409, { ok: false, error: 'Lease scaduto' }) };
  }
  return { execution, leaseToken };
}

async function heartbeatExecution(supabase, body) {
  const lease = await requireLease(supabase, body);
  if (lease.error) return lease.error;
  const now = nowIso();
  const { error } = await supabase
    .from('kona_ai_esecuzioni')
    .update({
      heartbeat_at: now,
      lease_expires_at: datePlusMinutes(LEASE_MINUTES),
      risultato: sanitizeValue(body.progress || {})
    })
    .eq('id', lease.execution.id)
    .eq('stato', 'in_esecuzione')
    .eq('lease_token_hash', hashLeaseToken(lease.leaseToken));
  if (error) throw error;
  return response(200, { ok: true, heartbeat_at: now });
}

function resultMessage(execution, body, success) {
  const prefix = success ? 'Codex ha completato' : 'Codex non ha completato';
  const phase = execution.tipo_esecuzione === 'analisi_codex'
    ? 'l’analisi del repository'
    : execution.tipo_esecuzione === 'prepara_patch'
      ? 'la preparazione della modifica staging'
      : execution.tipo_esecuzione === 'test_staging'
        ? 'i test dello staging'
        : 'la preparazione del rilascio';
  const summary = cleanWorkerText(body.message || body.summary, 5000);
  return `${prefix} ${phase}.${summary ? `\n\n${summary}` : ''}`.slice(0, 7800);
}

function keyboardForExecution(execution) {
  if (execution.tipo_esecuzione === 'analisi_codex') return analysisKeyboard(execution.incidente_id);
  if (execution.tipo_esecuzione === 'prepara_patch') return patchKeyboard(execution.incidente_id);
  if (execution.tipo_esecuzione === 'test_staging') return testKeyboard(execution.incidente_id);
  return undefined;
}

async function recordResult(supabase, body) {
  const lease = await requireLease(supabase, body);
  if (lease.error) return lease.error;
  const execution = lease.execution;
  const success = body.success === true;
  const now = nowIso();
  const safeResult = sanitizeValue(body.result || {}) || {};
  const update = {
    stato: success ? 'completata' : 'fallita',
    risultato: safeResult,
    codice_errore: success ? null : cleanWorkerText(body.error_code, 120) || 'worker_failed',
    messaggio_errore: success ? null : cleanWorkerText(body.error || body.message, 2000),
    result_commit_sha: cleanWorkerText(body.result_commit_sha, 128) || null,
    branch_name: cleanWorkerText(body.branch_name, 255) || null,
    pull_request_url: cleanWorkerText(body.pull_request_url, 500) || null,
    completata_at: now,
    heartbeat_at: now,
    lease_token_hash: null,
    lease_expires_at: null
  };
  const { data: saved, error } = await supabase
    .from('kona_ai_esecuzioni')
    .update(update)
    .eq('id', execution.id)
    .eq('stato', 'in_esecuzione')
    .eq('lease_token_hash', hashLeaseToken(lease.leaseToken))
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!saved) return response(409, { ok: false, error: 'Esecuzione già conclusa o lease scaduto' });

  const incidentState = success
    ? execution.tipo_esecuzione === 'analisi_codex'
      ? 'in_attesa_approvazione'
      : execution.tipo_esecuzione === 'prepara_patch'
        ? 'in_lavorazione'
        : execution.tipo_esecuzione === 'test_staging'
          ? 'in_test'
          : 'in_lavorazione'
    : 'ricevuto';
  await supabase.from('kona_ai_incidenti').update({ stato: incidentState }).eq('id', execution.incidente_id);
  if (execution.approvazione_id) {
    await supabase.from('kona_ai_approvazioni').update({
      stato: success ? 'eseguita' : 'fallita',
      risultato: { execution_id: execution.id, result: safeResult },
      eseguita_at: now
    }).eq('id', execution.approvazione_id);
  }
  const text = resultMessage(execution, body, success);
  const { error: messageError } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: execution.incidente_id,
    canale: 'codex',
    autore_tipo: 'codex',
    testo: text,
    metadati: {
      execution_id: execution.id,
      execution_type: execution.tipo_esecuzione,
      success,
      result_commit_sha: update.result_commit_sha,
      branch_name: update.branch_name,
      pull_request_url: update.pull_request_url
    }
  });
  if (messageError) throw messageError;

  const chatId = String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '').trim();
  if (chatId) {
    const { data: incident } = await supabase
      .from('kona_ai_incidenti')
      .select('numero, tipo_richiesta')
      .eq('id', execution.incidente_id)
      .maybeSingle();
    const heading = incident
      ? `${incidentCode(incident.numero)} · ${requestTypeLabel(incident.tipo_richiesta)}`
      : 'Guardian';
    try {
      await sendTelegramMessage(chatId, `${heading}\n\n${text}`, {
        reply_markup: success ? keyboardForExecution(execution) : undefined
      });
    } catch (telegramError) {
      console.warn('Notifica Telegram esito Codex non inviata:', telegramError?.message || String(telegramError));
    }
  }
  return response(200, { ok: true, execution_id: saved.id, state: saved.stato });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Metodo non consentito' });
  if (!verifyWorkerRequest(event)) return response(401, { ok: false, error: 'Worker non autorizzato' });
  const body = parseWorkerBody(event);
  if (!body) return response(400, { ok: false, error: 'JSON non valido' });
  const supabase = getAdminClient();
  if (!supabase) return response(500, { ok: false, error: 'Database non configurato' });
  try {
    if (body.action === 'claim') return await claimExecution(supabase, body);
    if (body.action === 'heartbeat') return await heartbeatExecution(supabase, body);
    if (body.action === 'result') return await recordResult(supabase, body);
    return response(400, { ok: false, error: 'Azione worker non valida' });
  } catch (error) {
    console.error('guardian-codex-worker:', error);
    return response(500, { ok: false, error: 'Errore interno del worker' });
  }
};
