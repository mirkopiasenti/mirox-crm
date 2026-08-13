'use strict';

const { getAdminClient } = require('./_lib/require-auth');
const { dispatchWorkflow, observerKeyboard, repositoryName, stagingBranch } = require('./_lib/guardian-codex');
const { incidentCode, requestTypeLabel } = require('./_lib/kona-ai-guardian');
const { environment, retryDelay, text } = require('./_lib/guardian-telemetry');
const { evaluateSignal } = require('./_lib/guardian-triage');
const { isTelegramConfigured, sendTelegramMessage } = require('./_lib/telegram');

const schedule = '*/5 * * * *';
const MAX_SIGNALS_PER_RUN = 3;
const MAX_OUTBOX_PER_RUN = 20;
const DEFAULT_DAILY_BUDGET = 10;
const WEEKLY_SCAN_MS = 7 * 24 * 60 * 60 * 1000;

function isEnabled() {
  return String(process.env.GUARDIAN_OBSERVER_ENABLED || 'true').trim().toLowerCase() !== 'false';
}

function nowIso() { return new Date().toISOString(); }

function priorityLabel(value) {
  return ({ bassa: 'da osservare', media: 'da verificare', alta: 'importante', critica: 'urgente' })[value] || 'da verificare';
}

function signalExplanation(signal) {
  if (signal.kind === 'network_error') {
    return 'Un operatore non è riuscito a completare una comunicazione tra il CRM e il server. Può dipendere dalla connessione, da un’interruzione momentanea o dal servizio chiamato.';
  }
  if (signal.kind === 'http_5xx' || signal.kind === 'function_exception') {
    return 'Il CRM ha ricevuto un errore dal server durante un’operazione.';
  }
  if (signal.kind === 'timeout') {
    return 'Un’operazione del CRM ha impiegato troppo tempo e non si è conclusa.';
  }
  return 'Il CRM ha rilevato un comportamento tecnico da verificare.';
}

function preliminaryText(incident, signal, analysisQueued) {
  const moduleName = signal.location?.module || signal.location?.function_name || signal.location?.page_path || 'area non identificata';
  const spread = Number(signal.affected_actor_count || 0) <= 1
    ? `Per ora è successo ${signal.occurrence_count} volta/e a un solo operatore.`
    : `È successo ${signal.occurrence_count} volta/e e coinvolge ${signal.affected_actor_count} operatori.`;
  return [
    `Guardian automatico · ${incidentCode(incident.numero)}`,
    `${requestTypeLabel(incident.tipo_richiesta)} ${priorityLabel(signal.priorita)} · ${signal.ambiente === 'production' ? 'CRM ufficiale' : 'ambiente di prova'}`,
    '',
    'Che cosa è successo',
    signalExplanation(signal),
    '',
    `Dove: ${moduleName}.`,
    spread,
    '',
    analysisQueued
      ? 'Cosa faccio ora: controllo il codice senza modificarlo e ti invio una spiegazione semplice qui su Telegram.'
      : 'Cosa faccio ora: conservo la segnalazione e riprovo il controllo automatico appena il servizio è disponibile.'
  ].join('\n').slice(0, 3900);
}

async function checkpoint(supabase, type) {
  const env = environment();
  const { data, error } = await supabase.from('kona_ai_observer_checkpoint')
    .select('*').eq('ambiente', env).eq('tipo', type).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: created, error: createError } = await supabase.from('kona_ai_observer_checkpoint')
    .insert({ ambiente: env, tipo: type, budget_data: new Date().toISOString().slice(0, 10) })
    .select('*').single();
  if (createError) throw createError;
  return created;
}

async function refreshBudget(supabase, current) {
  const today = new Date().toISOString().slice(0, 10);
  if (current.budget_data === today) return current;
  const { data, error } = await supabase.from('kona_ai_observer_checkpoint').update({ budget_data: today, budget_giornaliero: 0 })
    .eq('id', current.id).select('*').single();
  if (error) throw error;
  return data;
}

async function loadCandidateSignals(supabase) {
  const { data, error } = await supabase.from('kona_ai_segnali')
    .select('*')
    .in('stato', ['nuovo', 'osservando'])
    .order('last_seen_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((signal) => {
    const evaluation = evaluateSignal(signal);
    return evaluation.shouldOpen ? { ...signal, priorita: evaluation.priority } : null;
  }).filter(Boolean);
}

async function createIncident(supabase, signal) {
  const description = [
    `Rilevazione automatica ${signal.kind} (${signal.ambiente}).`,
    `Fingerprint: ${signal.fingerprint}.`,
    `Occorrenze: ${signal.occurrence_count}; operatori coinvolti: ${signal.affected_actor_count}.`,
    text(signal.error_sample?.message || 'Errore tecnico senza messaggio.', 600)
  ].join(' ');
  const { data, error } = await supabase.from('kona_ai_incidenti').insert({
    stato: 'in_analisi',
    priorita: signal.priorita,
    sorgente: 'monitoraggio',
    tipo_richiesta: 'problema',
    titolo: `Rilevazione automatica ${signal.kind}`.slice(0, 180),
    descrizione_iniziale: description.slice(0, 4000),
    riepilogo_ai: 'Analisi automatica Guardian in corso.',
    reporter_nome: 'Sistema Mirox',
    pagina_path: signal.location?.page_path || null,
    pagina_titolo: null,
    user_agent: null,
    contesto_client: {
      ambiente: signal.ambiente,
      fingerprint: signal.fingerprint,
      release_commit_sha: signal.release_commit_sha,
      occurrence_count: signal.occurrence_count,
      affected_actor_count: signal.affected_actor_count
    }
  }).select('*').single();
  if (error) throw error;
  return data;
}

async function createExecution(supabase, incident, signal) {
  const type = 'analisi_automatica';
  const { data, error } = await supabase.from('kona_ai_esecuzioni').insert({
    incidente_id: incident.id,
    tipo_esecuzione: type,
    stato: 'in_coda',
    esecutore: 'codex',
    richiesta_da: 'sistema',
    modello: process.env.GUARDIAN_OBSERVER_MODEL || 'gpt-5.6-luna',
    sandbox: 'read_only',
    repository: repositoryName(),
    workflow_name: 'guardian-observer-analysis.yml',
    base_commit_sha: signal.release_commit_sha || null,
    input_hash: signal.fingerprint
  }).select('*').single();
  if (error) throw error;
  return data;
}

async function enqueueNotification(supabase, incident, signal, analysisQueued) {
  const dedupeKey = `observer:${signal.id}:${analysisQueued ? 'analysis' : 'preliminary'}`;
  const payload = {
    text: preliminaryText(incident, signal, analysisQueued),
    reply_markup: observerKeyboard(incident.id, { allowPatch: false })
  };
  const { error } = await supabase.from('kona_ai_notifiche').upsert({
    incidente_id: incident.id,
    segnale_id: signal.id,
    dedupe_key: dedupeKey,
    payload,
    stato: 'in_coda',
    prossimo_tentativo_at: nowIso()
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  if (error) throw error;
}

async function processSignal(supabase, signal, budget) {
  let incident = null;
  let analysisQueued = false;
  if (signal.incidente_id) {
    const { data, error } = await supabase.from('kona_ai_incidenti').select('*').eq('id', signal.incidente_id).maybeSingle();
    if (error) throw error;
    incident = data;
  }
  if (!incident) {
    incident = await createIncident(supabase, signal);
    await supabase.from('kona_ai_segnali').update({ incidente_id: incident.id, priorita: signal.priorita, stato: 'in_analisi' }).eq('id', signal.id);
  }
  const maxBudget = Number(process.env.GUARDIAN_OBSERVER_DAILY_BUDGET || DEFAULT_DAILY_BUDGET);
  if (budget < maxBudget) {
    try {
      const execution = await createExecution(supabase, incident, signal);
      const dispatched = await dispatchWorkflow({
        executionId: execution.id,
        type: 'analisi_automatica',
        ref: process.env.GUARDIAN_OBSERVER_REF || stagingBranch(),
        commitSha: signal.release_commit_sha
      });
      if (dispatched.dispatched) {
        analysisQueued = true;
        await supabase.from('kona_ai_observer_checkpoint').update({ budget_giornaliero: budget + 1 }).eq('ambiente', environment()).eq('tipo', 'observer');
      } else {
        await supabase.from('kona_ai_esecuzioni').update({ stato: 'fallita', codice_errore: 'observer_not_configured', messaggio_errore: 'Workflow automatico non configurato', completata_at: nowIso() }).eq('id', execution.id);
      }
    } catch (error) {
      await supabase.from('kona_ai_segnali').update({ stato: 'notificato' }).eq('id', signal.id);
      await supabase.from('kona_ai_messaggi').insert({
        incidente_id: incident.id,
        canale: 'sistema',
        autore_tipo: 'sistema',
        testo: `Avvio analisi automatica non riuscito: ${text(error?.message || error, 800)}`,
        metadati: { source: 'guardian-observer' }
      });
    }
  }
  await supabase.from('kona_ai_segnali').update({ stato: analysisQueued ? 'in_analisi' : 'notificato', last_notified_at: nowIso() }).eq('id', signal.id);
  await enqueueNotification(supabase, incident, signal, analysisQueued);
  return { incidentId: incident.id, analysisQueued };
}

async function processOutbox(supabase) {
  if (!isTelegramConfigured()) return { sent: 0, failed: 0, skipped: true };
  const now = nowIso();
  const { data, error } = await supabase.from('kona_ai_notifiche').select('*')
    .in('stato', ['in_coda', 'fallita'])
    .lte('prossimo_tentativo_at', now)
    .order('created_at', { ascending: true }).limit(MAX_OUTBOX_PER_RUN);
  if (error) throw error;
  let sent = 0;
  let failed = 0;
  const chatId = String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '').trim();
  for (const item of data || []) {
    const attempts = Number(item.tentativi || 0) + 1;
    await supabase.from('kona_ai_notifiche').update({ stato: 'in_invio', tentativi: attempts }).eq('id', item.id).in('stato', ['in_coda', 'fallita']);
    try {
      const result = await sendTelegramMessage(chatId, item.payload?.text || 'Guardian: nuova notifica.', {
        reply_markup: item.payload?.reply_markup
      });
      await supabase.from('kona_ai_notifiche').update({ stato: 'inviata', telegram_message_id: result?.message_id || null, inviata_at: nowIso(), ultimo_errore: null }).eq('id', item.id);
      if (item.incidente_id) await supabase.from('kona_ai_incidenti').update({ telegram_chat_id: chatId, telegram_message_id: result?.message_id || null, notificato_telegram_at: nowIso() }).eq('id', item.incidente_id);
      sent += 1;
    } catch (error) {
      const dead = attempts >= 8;
      await supabase.from('kona_ai_notifiche').update({ stato: dead ? 'morta' : 'fallita', prossimo_tentativo_at: new Date(Date.now() + retryDelay(attempts)).toISOString(), ultimo_errore: text(error?.message || error, 500) }).eq('id', item.id);
      failed += 1;
    }
  }
  return { sent, failed, skipped: false };
}

async function maybeScheduleImprovementScan(supabase) {
  if (String(process.env.GUARDIAN_OBSERVER_WEEKLY_SCAN || 'true').trim().toLowerCase() === 'false') return false;
  let scanCheckpoint = await checkpoint(supabase, 'scansione_migliorie');
  const last = scanCheckpoint.ultima_esecuzione_at ? new Date(scanCheckpoint.ultima_esecuzione_at).getTime() : 0;
  if (last && Date.now() - last < WEEKLY_SCAN_MS) return false;
  const { data: incident, error: incidentError } = await supabase.from('kona_ai_incidenti').insert({
    stato: 'in_analisi',
    priorita: 'bassa',
    sorgente: 'monitoraggio',
    tipo_richiesta: 'miglioria',
    titolo: 'Scansione preventiva Guardian',
    descrizione_iniziale: 'Scansione periodica read-only delle modifiche recenti per individuare migliorie concrete del CRM.',
    riepilogo_ai: 'Scansione preventiva in corso.',
    reporter_nome: 'Sistema Mirox',
    contesto_client: { observer_scan: 'weekly_improvements', ambiente: environment() }
  }).select('*').single();
  if (incidentError) throw incidentError;
  const { data: execution, error: executionError } = await supabase.from('kona_ai_esecuzioni').insert({
    incidente_id: incident.id,
    tipo_esecuzione: 'scansione_migliorie',
    stato: 'in_coda',
    esecutore: 'codex',
    richiesta_da: 'sistema',
    modello: process.env.GUARDIAN_OBSERVER_MODEL || 'gpt-5.6-luna',
    sandbox: 'read_only',
    repository: repositoryName(),
    workflow_name: 'guardian-observer-analysis.yml'
  }).select('*').single();
  if (executionError) throw executionError;
  let dispatched = false;
  try {
    const result = await dispatchWorkflow({
      executionId: execution.id,
      type: 'scansione_migliorie',
      ref: process.env.GUARDIAN_OBSERVER_REF || stagingBranch()
    });
    dispatched = result.dispatched;
    if (!dispatched) {
      await supabase.from('kona_ai_esecuzioni').update({ stato: 'fallita', codice_errore: 'observer_not_configured', messaggio_errore: 'Workflow Observer non configurato', completata_at: nowIso() }).eq('id', execution.id);
    }
  } catch (error) {
    await supabase.from('kona_ai_esecuzioni').update({ stato: 'fallita', codice_errore: 'observer_dispatch_failed', messaggio_errore: text(error?.message || error, 1200), completata_at: nowIso() }).eq('id', execution.id);
  }
  await supabase.from('kona_ai_observer_checkpoint').update({ ultima_esecuzione_at: nowIso(), ultimo_esito: dispatched ? 'dispatched' : 'not_configured' }).eq('id', scanCheckpoint.id);
  await supabase.from('kona_ai_notifiche').upsert({
    incidente_id: incident.id,
    dedupe_key: `observer:weekly:${incident.id}`,
    payload: { text: `${incidentCode(incident.numero)}\n\nScansione preventiva Guardian ${dispatched ? 'avviata in sola lettura' : 'registrata ma non ancora avviata'}.` },
    stato: 'in_coda',
    prossimo_tentativo_at: nowIso()
  }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  return true;
}

const handler = async () => {
  if (!isEnabled()) return { statusCode: 200, body: JSON.stringify({ ok: true, disabled: true }) };
  const supabase = getAdminClient();
  if (!supabase) return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Database Guardian non configurato' }) };
  try {
    let observerCheckpoint = await checkpoint(supabase, 'observer');
    observerCheckpoint = await refreshBudget(supabase, observerCheckpoint);
    const candidates = await loadCandidateSignals(supabase);
    let processed = 0;
    for (const signal of candidates.slice(0, MAX_SIGNALS_PER_RUN)) {
      await processSignal(supabase, signal, Number(observerCheckpoint.budget_giornaliero || 0) + processed);
      processed += 1;
    }
    const weeklyScan = await maybeScheduleImprovementScan(supabase);
    const outbox = await processOutbox(supabase);
    await supabase.from('kona_ai_observer_checkpoint').update({ ultima_esecuzione_at: nowIso(), ultimo_esito: 'ok', dettagli: { segnali_processati: processed, scansione_migliorie: weeklyScan, outbox } }).eq('id', observerCheckpoint.id);
    return { statusCode: 200, body: JSON.stringify({ ok: true, environment: environment(), signals: processed, weekly_scan: weeklyScan, outbox }) };
  } catch (error) {
    console.error('cron-guardian-observer:', text(error?.message || error, 800));
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: 'Observer non completato' }) };
  }
};

module.exports = { handler, schedule, preliminaryText, _test: { evaluateSignal, maybeScheduleImprovementScan, preliminaryText, retryDelay } };
