'use strict';

const crypto = require('node:crypto');
const { getAdminClient } = require('./_lib/require-auth');
const {
  cleanText,
  conversationText,
  generateGuardianAnalysis,
  generateOwnerReply,
  guardianAnalysisKeyboard,
  incidentCode,
  incidentNotificationKeyboard,
  OPEN_INCIDENT_STATES,
  requestType,
  requestTypeLabel
} = require('./_lib/kona-ai-guardian');
const {
  dispatchWorkflow,
  publicationKeyboard,
  repositoryName,
  baseBranch
} = require('./_lib/guardian-codex');
const {
  answerCallbackQuery,
  sendTelegramMessage,
} = require('./_lib/telegram');

const { REPOSITORY, SHA, BRANCH, validateContract, inspectPull, parsePullNumber } = require('./_lib/guardian-release');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(statusCode, payload = { ok: true }) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}

function secretsMatch(received, expected) {
  const left = Buffer.from(String(received || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function ownerProfileId() {
  const value = String(process.env.KONA_AI_OWNER_PROFILE_ID || '').trim();
  return UUID_RE.test(value) ? value.toLowerCase() : null;
}

function getChatId(update) {
  return String(
    update?.message?.chat?.id
      || update?.callback_query?.message?.chat?.id
      || ''
  );
}

async function claimUpdate(supabase, chatId, updateId) {
  const { data, error } = await supabase
    .from('kona_ai_telegram_sessioni')
    .select('chat_id, incidente_attivo_id, ultimo_update_id, conversazione')
    .eq('chat_id', chatId)
    .maybeSingle();
  if (error) throw error;
  if (data && Number(data.ultimo_update_id || -1) >= Number(updateId)) {
    return { duplicate: true, session: data };
  }
  const { data: session, error: upsertError } = await supabase
    .from('kona_ai_telegram_sessioni')
    .upsert({
      chat_id: chatId,
      incidente_attivo_id: data?.incidente_attivo_id || null,
      ultimo_update_id: updateId
    }, { onConflict: 'chat_id' })
    .select('*')
    .single();
  if (upsertError) throw upsertError;
  return { duplicate: false, session };
}

async function setActiveIncident(supabase, chatId, incidentId) {
  const { error } = await supabase
    .from('kona_ai_telegram_sessioni')
    .upsert({ chat_id: chatId, incidente_attivo_id: incidentId }, { onConflict: 'chat_id' });
  if (error) throw error;
}

async function getIncident(supabase, incidentId) {
  const { data, error } = await supabase
    .from('kona_ai_incidenti')
    .select('*')
    .eq('id', incidentId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getMessages(supabase, incidentId, limit = 40) {
  const { data, error } = await supabase
    .from('kona_ai_messaggi')
    .select('id, canale, autore_tipo, testo, created_at')
    .eq('incidente_id', incidentId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).reverse();
}

function compactIncident(incident) {
  return [
    `${incidentCode(incident.numero)} · ${incident.priorita} · ${incident.stato}`,
    `Tipo: ${requestTypeLabel(incident.tipo_richiesta)}`,
    incident.titolo || (requestType(incident.tipo_richiesta) === 'miglioria' ? 'Miglioria CRM' : 'Problema CRM'),
    incident.riepilogo_ai || incident.descrizione_iniziale
  ].join('\n');
}

async function listOpenIncidents(supabase, chatId) {
  const { data, error } = await supabase
    .from('kona_ai_incidenti')
    .select('id, numero, stato, priorita, tipo_richiesta, titolo, descrizione_iniziale, riepilogo_ai')
    .in('stato', OPEN_INCIDENT_STATES)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  if (!data?.length) {
    await sendTelegramMessage(chatId, 'Non ci sono richieste aperte.');
    return;
  }
  await sendTelegramMessage(chatId, [
    'Richieste aperte:',
    '',
    ...data.map((item) => `${incidentCode(item.numero)} · ${requestTypeLabel(item.tipo_richiesta)} · ${item.priorita} · ${item.titolo || 'Senza titolo'}`),
    '',
    'Usa /apri KG-000001 per entrare in una conversazione.'
  ].join('\n'));
}

async function observerHealth(supabase, chatId) {
  const ambiente = String(process.env.MIROX_DEPLOY_ENV || 'production').trim() === 'staging'
    ? 'staging'
    : 'production';
  try {
    const [checkpointResult, queuedResult, runningResult, notificationResult, signalResult] = await Promise.all([
      supabase
        .from('kona_ai_observer_checkpoint')
        .select('ultima_esecuzione_at, ultimo_esito, budget_giornaliero, budget_data')
        .eq('ambiente', ambiente)
        .eq('tipo', 'observer')
        .maybeSingle(),
      supabase
        .from('kona_ai_esecuzioni')
        .select('id', { count: 'exact', head: true })
        .in('stato', ['in_coda']),
      supabase
        .from('kona_ai_esecuzioni')
        .select('id', { count: 'exact', head: true })
        .in('stato', ['in_esecuzione']),
      supabase
        .from('kona_ai_notifiche')
        .select('id', { count: 'exact', head: true })
        .in('stato', ['in_coda', 'in_invio', 'fallita']),
      supabase
        .from('kona_ai_segnali')
        .select('id', { count: 'exact', head: true })
        .eq('ambiente', ambiente)
    ]);
    const queryError = [checkpointResult, queuedResult, runningResult, notificationResult, signalResult]
      .map((result) => result.error)
      .find(Boolean);
    if (queryError) throw queryError;

    const checkpoint = checkpointResult.data;
    await sendTelegramMessage(chatId, [
      `Guardian Observer · ${ambiente}`,
      `Stato: ${checkpoint ? (checkpoint.ultimo_esito || 'configurato') : 'in attesa della prima scansione'}`,
      `Ultima scansione: ${checkpoint?.ultima_esecuzione_at || 'mai'}`,
      `Budget usato oggi: ${checkpoint?.budget_giornaliero || 0}`,
      `Esecuzioni in coda: ${queuedResult.count || 0}`,
      `Esecuzioni in corso: ${runningResult.count || 0}`,
      `Notifiche da inviare: ${notificationResult.count || 0}`,
      `Segnali osservati: ${signalResult.count || 0}`
    ].join('\n'));
  } catch (error) {
    console.error('guardian observer health:', error);
    await sendTelegramMessage(chatId, 'Guardian Observer non è ancora attivo. Verifica che la migration 068 sia stata applicata nello staging e che il cron sia configurato.');
  }
}

async function openIncident(supabase, chatId, incident) {
  await setActiveIncident(supabase, chatId, incident.id);
  const messages = await getMessages(supabase, incident.id, 12);
  const history = messages.slice(-6).map((item) => {
    const author = item.autore_tipo === 'guardian' ? 'Guardian' : item.autore_tipo === 'mirko' ? 'Mirko' : 'Operatore';
    return `${author}: ${cleanText(item.testo, 700)}`;
  });
  await sendTelegramMessage(chatId, [
    compactIncident(incident),
    '',
    ...(history.length ? ['Ultimi messaggi:', ...history] : []),
    '',
    'Da ora i tuoi messaggi e vocali saranno collegati a questa richiesta.'
  ].join('\n'), { reply_markup: incidentNotificationKeyboard(incident.id) });
}

async function openByCode(supabase, chatId, command) {
  const match = /KG-(\d{1,12})/i.exec(command);
  if (!match) {
    await sendTelegramMessage(chatId, 'Formato non valido. Esempio: /apri KG-000001');
    return;
  }
  const numero = Number.parseInt(match[1], 10);
  const { data, error } = await supabase
    .from('kona_ai_incidenti')
    .select('*')
    .eq('numero', numero)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    await sendTelegramMessage(chatId, 'Richiesta non trovata.');
    return;
  }
  await openIncident(supabase, chatId, data);
}

async function createTelegramIncident(supabase, chatId, text, requestedType = 'problema') {
  const description = cleanText(text, 4000);
  const type = requestType(requestedType);
  if (description.length < 3) {
    await sendTelegramMessage(chatId, type === 'miglioria'
      ? 'Scrivi /nuovo_miglioria seguito dalla descrizione della proposta.'
      : 'Scrivi /nuovo seguito dalla descrizione del problema.');
    return;
  }
  const title = description.length > 90 ? `${description.slice(0, 87)}...` : description;
  const { data: incident, error } = await supabase
    .from('kona_ai_incidenti')
    .insert({
      stato: 'ricevuto',
      priorita: 'media',
      tipo_richiesta: type,
      sorgente: 'telegram',
      titolo: title,
      descrizione_iniziale: description,
      riepilogo_ai: description,
      reporter_id: ownerProfileId(),
      reporter_nome: 'Mirko',
      telegram_chat_id: chatId,
      ricevuto_at: new Date().toISOString(),
      notificato_telegram_at: new Date().toISOString()
    })
    .select('*')
    .single();
  if (error) throw error;
  const { error: messageError } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incident.id,
    canale: 'telegram',
    autore_tipo: 'mirko',
    autore_profile_id: ownerProfileId(),
    testo: description,
    metadati: { request_type: type }
  });
  if (messageError) throw messageError;
  await setActiveIncident(supabase, chatId, incident.id);
  await sendTelegramMessage(chatId, `Creata richiesta ${incidentCode(incident.numero)} (${requestTypeLabel(type)}). La conversazione è ora attiva.`, {
    reply_markup: incidentNotificationKeyboard(incident.id)
  });
}

async function archiveIncident(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Richiesta non trovata');
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase
    .from('kona_ai_approvazioni')
    .insert({
      incidente_id: incident.id,
      azione: 'archivia',
      stato: 'eseguita',
      richiesta_da: 'telegram',
      decisa_da_profile_id: ownerProfileId(),
      decisa_da_telegram_chat_id: chatId,
      motivazione: 'Approvazione esplicita tramite pulsante Telegram',
      decisa_at: now,
      eseguita_at: now
    })
    .select('id')
    .single();
  if (approvalError) throw approvalError;
  const { error } = await supabase
    .from('kona_ai_incidenti')
    .update({ stato: 'archiviato', archiviato_at: now })
    .eq('id', incident.id);
  if (error) throw error;
  const { error: auditError } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incident.id,
    canale: 'sistema',
    autore_tipo: 'sistema',
    testo: 'Richiesta archiviata da Mirko tramite Telegram.',
    metadati: { approval_id: approval.id }
  });
  if (auditError) throw auditError;
  await setActiveIncident(supabase, chatId, null);
  await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} archiviato.`);
}

async function analyzeIncident(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Richiesta non trovata');
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase
    .from('kona_ai_approvazioni')
    .insert({
      incidente_id: incident.id,
      azione: 'analizza_guardian',
      stato: 'approvata',
      richiesta_da: 'telegram',
      decisa_da_profile_id: ownerProfileId(),
      decisa_da_telegram_chat_id: chatId,
      motivazione: 'Approvazione esplicita tramite pulsante Telegram',
      decisa_at: now
    })
    .select('id')
    .single();
  if (approvalError) throw approvalError;
  await supabase.from('kona_ai_incidenti').update({ stato: 'in_analisi' }).eq('id', incident.id);
  await sendTelegramMessage(chatId, `Analisi Guardian avviata per ${incidentCode(incident.numero)}.`);

  try {
    const messages = await getMessages(supabase, incident.id, 80);
    const analysis = await generateGuardianAnalysis(incident, messages);
    const { data: savedMessage, error: messageError } = await supabase
      .from('kona_ai_messaggi')
      .insert({
        incidente_id: incident.id,
        canale: 'guardian',
        autore_tipo: 'guardian',
        testo: analysis,
        metadati: { approval_id: approval.id, analysis_type: 'guardian' }
      })
      .select('id')
      .single();
    if (messageError) throw messageError;
    await supabase.from('kona_ai_approvazioni').update({
      stato: 'eseguita',
      eseguita_at: new Date().toISOString(),
      risultato: { message_id: savedMessage.id }
    }).eq('id', approval.id);
    await supabase.from('kona_ai_incidenti').update({ stato: 'ricevuto' }).eq('id', incident.id);
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)}\nTipo: ${requestTypeLabel(incident.tipo_richiesta)}\n\n${analysis}`, {
      reply_markup: guardianAnalysisKeyboard(incident.id)
    });
  } catch (error) {
    await supabase.from('kona_ai_approvazioni').update({
      stato: 'fallita',
      eseguita_at: new Date().toISOString(),
      risultato: { error: cleanText(error?.message || String(error), 500) }
    }).eq('id', approval.id);
    await supabase.from('kona_ai_incidenti').update({ stato: 'ricevuto' }).eq('id', incident.id);
    throw error;
  }
}

async function createExecution(supabase, incident, approval, type, options = {}) {
  const { data: active, error: activeError } = await supabase
    .from('kona_ai_esecuzioni')
    .select('*')
    .eq('incidente_id', incident.id)
    .eq('tipo_esecuzione', type)
    .in('stato', ['in_coda', 'in_esecuzione'])
    .maybeSingle();
  if (activeError) throw activeError;
  if (active) return { execution: active, created: false };

  const { data: execution, error } = await supabase
    .from('kona_ai_esecuzioni')
    .insert({
      ...(options.id ? { id: options.id } : {}),
      incidente_id: incident.id,
      approvazione_id: approval?.id || null,
      tipo_esecuzione: type,
      stato: 'in_coda',
      esecutore: 'codex',
      richiesta_da: 'telegram',
      modello: options.model || 'gpt-5.6-luna',
      sandbox: options.sandbox || 'read_only',
      repository: repositoryName(),
      branch_name: options.branch || baseBranch(),
      base_commit_sha: options.baseCommit || null,
      workflow_name: options.workflow || null,
      pull_request_url: options.pullRequest || null,
      risultato: { requested_from: 'telegram' },
      timeout_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
    })
    .select('*')
    .single();
  if (error) throw error;
  return { execution, created: true };
}

async function failExecution(supabase, execution, message, code = 'dispatch_failed') {
  const now = new Date().toISOString();
  await supabase.from('kona_ai_esecuzioni').update({
    stato: 'fallita',
    codice_errore: code,
    messaggio_errore: cleanText(message, 2000),
    completata_at: now,
    risultato: { dispatch: 'not_started' }
  }).eq('id', execution.id).eq('stato', 'in_coda');
  if (execution.approvazione_id) {
    await supabase.from('kona_ai_approvazioni').update({
      stato: 'fallita',
      ...(execution.tipo_esecuzione === 'rilascio_produzione' ? {} : { risultato: { execution_id: execution.id, error: cleanText(message, 500) } }),
      eseguita_at: now
    }).eq('id', execution.approvazione_id);
  }
  await supabase.from('kona_ai_incidenti').update({ stato: 'ricevuto' }).eq('id', execution.incidente_id);
}

async function dispatchExecution(supabase, chatId, incident, execution) {
  try {
    const dispatch = await dispatchWorkflow({
      executionId: execution.id,
      type: execution.tipo_esecuzione,
      ref: execution.tipo_esecuzione === 'rilascio_produzione' ? baseBranch() : execution.branch_name || baseBranch()
    });
    if (!dispatch.dispatched) {
      await failExecution(supabase, execution, 'Worker Codex non configurato nell’ambiente corrente.', 'worker_not_configured');
      await sendTelegramMessage(chatId, [
        `${incidentCode(incident.numero)}: approvazione registrata.`,
        'Il worker Codex non è ancora configurato in produzione; nessun file è stato modificato.'
      ].join('\n'));
      return false;
    }
    await supabase.from('kona_ai_esecuzioni').update({
      workflow_name: dispatch.workflow,
      repository: dispatch.repository,
      branch_name: execution.tipo_esecuzione === 'rilascio_produzione' ? execution.branch_name : dispatch.ref
    }).eq('id', execution.id).eq('stato', 'in_coda');
    await sendTelegramMessage(chatId, [
      `${incidentCode(incident.numero)}: esecuzione Codex avviata.`,
      `Fase: ${execution.tipo_esecuzione}.`,
      'Ti notificherò il risultato qui su Telegram.'
    ].join('\n'));
    return true;
  } catch (error) {
    await failExecution(supabase, execution, error?.message || String(error));
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)}: avvio Codex fallito. Nessun file è stato modificato.`);
    return false;
  }
}

async function startCodexAnalysis(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Richiesta non trovata');
  if (incident.stato === 'archiviato') {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} è archiviata e non può essere analizzata.`);
    return;
  }
  const { data: active, error: activeError } = await supabase
    .from('kona_ai_esecuzioni')
    .select('id, stato')
    .eq('incidente_id', incident.id)
    .eq('tipo_esecuzione', 'analisi_codex')
    .in('stato', ['in_coda', 'in_esecuzione'])
    .maybeSingle();
  if (activeError) throw activeError;
  if (active) {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} ha già un’analisi Codex in corso.`);
    return;
  }
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase.from('kona_ai_approvazioni').insert({
    incidente_id: incident.id,
    azione: 'analizza_codex',
    stato: 'approvata',
    richiesta_da: 'telegram',
    decisa_da_profile_id: ownerProfileId(),
    decisa_da_telegram_chat_id: chatId,
    motivazione: 'Analisi Codex read-only approvata esplicitamente tramite Telegram',
    decisa_at: now
  }).select('id').single();
  if (approvalError) throw approvalError;
  const { execution } = await createExecution(supabase, incident, approval, 'analisi_codex', {
    sandbox: 'read_only',
    branch: String(process.env.MIROX_DEPLOY_ENV || '').trim().toLowerCase() === 'staging' ? baseBranch() : 'main'
  });
  await supabase.from('kona_ai_incidenti').update({ stato: 'in_analisi' }).eq('id', incident.id);
  await dispatchExecution(supabase, chatId, incident, execution);
}

async function approveWork(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Richiesta non trovata');
  if (incident.stato === 'archiviato') {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} è archiviata e non può essere modificata.`);
    return;
  }
  const { data: existingApproval, error: existingError } = await supabase
    .from('kona_ai_approvazioni')
    .select('id')
    .eq('incidente_id', incident.id)
    .eq('azione', 'prepara_fix')
    .in('stato', ['approvata', 'eseguita'])
    .maybeSingle();
  if (existingError) throw existingError;
  if (existingApproval) {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} ha già una modifica approvata o in lavorazione.`);
    return;
  }
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase.from('kona_ai_approvazioni').insert({
    incidente_id: incident.id,
    azione: 'prepara_fix',
    stato: 'approvata',
    richiesta_da: 'telegram',
    decisa_da_profile_id: ownerProfileId(),
    decisa_da_telegram_chat_id: chatId,
    motivazione: 'Preparazione modifica approvata esplicitamente tramite Telegram',
    decisa_at: now
  }).select('id').single();
  if (approvalError) throw approvalError;
  const { execution } = await createExecution(supabase, incident, approval, 'prepara_patch', {
    sandbox: 'workspace_write',
    branch: baseBranch()
  });
  await supabase.from('kona_ai_incidenti').update({ stato: 'fix_approvato' }).eq('id', incident.id);
  await dispatchExecution(supabase, chatId, incident, execution);
}

async function startStagingTests(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Richiesta non trovata');
  if (incident.stato === 'archiviato') {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} è archiviata e non può essere testata.`);
    return;
  }
  const { data: active, error: activeError } = await supabase.from('kona_ai_esecuzioni')
    .select('id').eq('incidente_id', incident.id).eq('tipo_esecuzione', 'test_staging')
    .in('stato', ['in_coda', 'in_esecuzione']).maybeSingle();
  if (activeError) throw activeError;
  if (active) {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} ha già test della branch in corso.`);
    return;
  }
  const { data: patchExecution, error: patchError } = await supabase.from('kona_ai_esecuzioni')
    .select('branch_name, result_commit_sha, pull_request_url')
    .eq('incidente_id', incident.id)
    .eq('tipo_esecuzione', 'prepara_patch')
    .eq('stato', 'completata')
    .order('completata_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (patchError) throw patchError;
  if (!BRANCH.test(patchExecution?.branch_name || '') || !SHA.test(patchExecution?.result_commit_sha || '')) {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} non ha ancora una modifica completata.`);
    return;
  }
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase.from('kona_ai_approvazioni').insert({
    incidente_id: incident.id,
    azione: 'test_staging',
    stato: 'approvata',
    richiesta_da: 'telegram',
    decisa_da_profile_id: ownerProfileId(),
    decisa_da_telegram_chat_id: chatId,
    motivazione: 'Test della branch approvati esplicitamente tramite Telegram',
    decisa_at: now
  }).select('id').single();
  if (approvalError) throw approvalError;
  const { execution } = await createExecution(supabase, incident, approval, 'test_staging', {
    sandbox: 'read_only',
    branch: patchExecution.branch_name,
    baseCommit: patchExecution.result_commit_sha,
    pullRequest: patchExecution.pull_request_url
  });
  await supabase.from('kona_ai_incidenti').update({ stato: 'in_test' }).eq('id', incident.id);
  await dispatchExecution(supabase, chatId, incident, execution);
}

async function latestSuccessfulTest(supabase, incidentId) {
  const { data, error } = await supabase.from('kona_ai_esecuzioni').select('*')
    .eq('incidente_id', incidentId).eq('tipo_esecuzione', 'test_staging')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data || data.stato !== 'completata' || !BRANCH.test(data.branch_name || '') || !SHA.test(data.result_commit_sha || '')
    || !SHA.test(data.risultato?.tested_base_sha || '') || data.risultato.tests !== 'success'
    || data.risultato.install !== 'success' || data.risultato.smoke !== 'success') {
    throw new Error('La modifica richiede una nuova verifica prima della pubblicazione. Premi Verifica modifica.');
  }
  return data;
}

async function prepareProductionRelease(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident || !OPEN_INCIDENT_STATES.includes(incident.stato)) throw new Error('La richiesta è chiusa o non disponibile.');
  const tested = await latestSuccessfulTest(supabase, incident.id);
  const contract = validateContract({ repository: REPOSITORY, base_branch: 'main',
    branch: tested.branch_name, head_sha: tested.result_commit_sha, base_sha: tested.risultato.tested_base_sha,
    pull_request_url: tested.pull_request_url, pull_number: parsePullNumber(tested.pull_request_url),
    test_execution_id: tested.id, incident_id: incident.id });
  await inspectPull(contract);
  const now = new Date().toISOString();
  const { error: staleError } = await supabase.from('kona_ai_approvazioni').update({ stato: 'scaduta' })
    .eq('incidente_id', incident.id).eq('azione', 'rilascia_produzione').eq('stato', 'in_attesa');
  if (staleError) throw staleError;
  const { data: approval, error } = await supabase.from('kona_ai_approvazioni').insert({
    incidente_id: incident.id, azione: 'rilascia_produzione', stato: 'in_attesa', richiesta_da: 'telegram',
    motivazione: 'Conferma finale richiesta per la versione verificata della modifica.',
    risultato: { release_contract: contract }, scade_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
  }).select('*').single();
  if (error) throw error;
  const text = `${incidentCode(incident.numero)}: modifica verificata e pronta.\n\n${conversationText(incident.titolo || incident.riepilogo_ai, 600)}\nProposta: ${contract.pull_request_url}\nVersione verificata: ${contract.head_sha.slice(0, 12)}\n\nPremendo Pubblica in produzione approvi il merge su GitHub e il rilascio del CRM. Ti comunicherò quando sarà online. Puoi anche rispondere a questo messaggio con “OK pubblica”. La conferma scade tra un’ora.`;
  const sent = await sendTelegramMessage(chatId, text, { reply_markup: publicationKeyboard(approval.id, incident.id) });
  const { error: bindError } = await supabase.from('kona_ai_approvazioni')
    .update({ risultato: { release_contract: contract, telegram_message_id: sent?.message_id || null } })
    .eq('id', approval.id).eq('stato', 'in_attesa');
  if (bindError) throw bindError;
  const { error: auditError } = await supabase.from('kona_ai_messaggi').insert({ incidente_id: incident.id, canale: 'sistema', autore_tipo: 'guardian',
    testo: text, metadati: { approval_id: approval.id, head_sha: contract.head_sha, base_sha: contract.base_sha } });
  if (auditError) throw auditError;
}

async function publishProduction(supabase, chatId, approvalId) {
  if (String(chatId) !== String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '')) throw new Error('Pubblicazione non autorizzata.');
  const { data: approval, error } = await supabase.from('kona_ai_approvazioni').select('*').eq('id', approvalId).maybeSingle();
  if (error) throw error;
  if (!approval || approval.azione !== 'rilascia_produzione') throw new Error('Conferma di pubblicazione non valida.');
  if (approval.stato !== 'in_attesa') {
    await sendTelegramMessage(chatId, 'Questa conferma è già stata utilizzata o è scaduta. Nessun nuovo rilascio avviato.'); return;
  }
  if (!(Date.parse(approval.scade_at) > Date.now())) throw new Error('La conferma è scaduta. Richiedi una nuova proposta di pubblicazione.');
  const incident = await getIncident(supabase, approval.incidente_id);
  if (!incident || !OPEN_INCIDENT_STATES.includes(incident.stato)) throw new Error('La richiesta è chiusa e non può essere pubblicata.');
  const contract = validateContract(approval.risultato?.release_contract);
  const tested = await latestSuccessfulTest(supabase, incident.id);
  if (contract.incident_id !== incident.id || tested.id !== contract.test_execution_id
    || tested.result_commit_sha !== contract.head_sha || tested.risultato.tested_base_sha !== contract.base_sha) {
    throw new Error('La versione verificata è cambiata. Richiedi una nuova proposta.');
  }
  await inspectPull(contract);
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase.from('kona_ai_approvazioni').update({
    stato: 'approvata', decisa_at: now, decisa_da_profile_id: ownerProfileId(), decisa_da_telegram_chat_id: chatId,
    motivazione: 'Pubblicazione finale approvata esplicitamente su Telegram per commit ' + contract.head_sha
  }).eq('id', approval.id).eq('stato', 'in_attesa').gt('scade_at', now).select('*').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) { await sendTelegramMessage(chatId, 'Conferma già presa in carico.'); return; }
  let releaseExecution;
  try {
    const { execution, created } = await createExecution(supabase, incident, claimed, 'rilascio_produzione', {
      id: claimed.id, sandbox: 'read_only', branch: contract.branch, baseCommit: contract.head_sha,
      pullRequest: contract.pull_request_url
    });
    if (!created) throw new Error('Un rilascio è già in corso su questa richiesta.');
    releaseExecution = execution;
    await setActiveIncident(supabase, chatId, incident.id);
    const { error: auditError } = await supabase.from('kona_ai_messaggi').insert({ incidente_id: incident.id, canale: 'telegram', autore_tipo: 'mirko',
      testo: 'Pubblicazione in produzione approvata su Telegram.', metadati: { approval_id: claimed.id, head_sha: contract.head_sha, base_sha: contract.base_sha } });
    if (auditError) throw auditError;
    await dispatchExecution(supabase, chatId, incident, execution);
  } catch (failure) {
    if (releaseExecution) await failExecution(supabase, releaseExecution, failure.message);
    await supabase.from('kona_ai_approvazioni').update({ stato: 'fallita' }).eq('id', claimed.id).eq('stato', 'approvata');
    throw failure;
  }
}

async function handleCallback(supabase, update, chatId) {
  const query = update.callback_query;
  const [action, incidentId] = String(query.data || '').split(':');
  if (!UUID_RE.test(incidentId)) {
    await answerCallbackQuery(query.id, 'Comando non valido');
    return;
  }
  await answerCallbackQuery(query.id, 'Ricevuto');
  if(action==='retry_voice') {
    const voice=require('./_lib/guardian-voice');
    const retried=await voice.retry(supabase,chatId,incidentId);
    if(!retried) {await sendTelegramMessage(chatId,'Il vocale è già in elaborazione o è stato completato.');return;}
    try {await voice.nudge();} catch(_) {}
    await sendTelegramMessage(chatId,'Vocale rimesso in coda. Se la risposta precedente era già arrivata, potresti riceverne una seconda copia.');
    return;
  }
  if (action === 'publish_production') {
    await publishProduction(supabase, chatId, incidentId);
    return;
  }
  if (action !== 'archive') {
    await setActiveIncident(supabase, chatId, incidentId);
  }
  if (action === 'open') {
    const incident = await getIncident(supabase, incidentId);
    if (!incident) throw new Error('Richiesta non trovata');
    await openIncident(supabase, chatId, incident);
    return;
  }
  if (action === 'analyze') {
    await analyzeIncident(supabase, chatId, incidentId);
    return;
  }
  if (action === 'analyze_codex') {
    await startCodexAnalysis(supabase, chatId, incidentId);
    return;
  }
  if (action === 'approve_work') {
    await approveWork(supabase, chatId, incidentId);
    return;
  }
  if (action === 'test_staging') {
    await startStagingTests(supabase, chatId, incidentId);
    return;
  }
  if (action === 'release_production') {
    await prepareProductionRelease(supabase, chatId, incidentId);
    return;
  }
  if (action === 'archive') {
    await archiveIncident(supabase, chatId, incidentId);
  }
}

async function resolveConversationIncident(supabase, chatId, session, text, replyTo) {
  const codes = [...new Set([...text.matchAll(/\bKG-(\d{1,12})\b/gi)].map((m) => Number(m[1])))];
  // Several explicit cases belong to the general comparison, not one arbitrary ticket.
  if (codes.length > 1) return null;
  if (codes.length === 1) {
    const { data, error } = await supabase.from('kona_ai_incidenti').select('*').eq('numero', codes[0]).maybeSingle();
    if (error) throw error;
    if (data) await setActiveIncident(supabase, chatId, data.id);
    return data;
  }
  if (replyTo?.message_id) {
    const { data: notification, error } = await supabase.from('kona_ai_notifiche')
      .select('incidente_id').eq('telegram_message_id', replyTo.message_id).maybeSingle();
    if (error) throw error;
    let id = notification?.incidente_id;
    if (!id) {
      const { data, error: incidentError } = await supabase.from('kona_ai_incidenti')
        .select('id').eq('telegram_chat_id', chatId).eq('telegram_message_id', replyTo.message_id).maybeSingle();
      if (incidentError) throw incidentError;
      id = data?.id;
    }
    if (id) {
      const incident = await getIncident(supabase, id);
      if (incident) await setActiveIncident(supabase, chatId, id);
      return incident;
    }
  }
  return session?.incidente_attivo_id ? getIncident(supabase, session.incidente_attivo_id) : null;
}

async function ownerContext(supabase, incident, session) {
  const { data: recent, error } = await supabase.from('kona_ai_incidenti')
    .select('id, numero, stato, tipo_richiesta, titolo, riepilogo_ai, updated_at')
    .order('updated_at', { ascending: false }).limit(12);
  if (error) throw error;
  let query = supabase.from('kona_ai_esecuzioni')
    .select('incidente_id, tipo_esecuzione, stato, modello, codice_errore, messaggio_errore, workflow_run_id, created_at, completata_at')
    .order('created_at', { ascending: false }).limit(12);
  if (incident) query = query.eq('incidente_id', incident.id);
  const { data: executions, error: executionError } = await query;
  if (executionError) throw executionError;
  return {
    history: Array.isArray(session?.conversazione) ? session.conversazione : [],
    incidents: (recent || []).map((i) => ({
      code: incidentCode(i.numero), status: i.stato, type: i.tipo_richiesta,
      title: conversationText(i.titolo, 180), summary: conversationText(i.riepilogo_ai, 700), updated_at: i.updated_at
    })),
    executions: (executions || []).map((e) => ({
      code: incident?.id === e.incidente_id ? incidentCode(incident.numero)
        : incidentCode((recent || []).find((i) => i.id === e.incidente_id)?.numero),
      type: e.tipo_esecuzione, status: e.stato, model: e.modello,
      error_code: e.codice_errore, error: conversationText(e.messaggio_errore, 700),
      created_at: e.created_at, completed_at: e.completata_at,
      workflow_run_id: e.workflow_run_id
    }))
  };
}

async function saveConversation(supabase, chatId, history) {
  const { error } = await supabase.from('kona_ai_telegram_sessioni')
    .update({ conversazione: history.slice(-30) }).eq('chat_id', chatId);
  if (error) throw error;
}

async function handleOwnerConversation(supabase, chatId, session, text, metadata = {}, replyTo = null, options = {}) {
  const incident = await resolveConversationIncident(supabase, chatId, session, text, replyTo);
  const previousMessages = incident ? await getMessages(supabase, incident.id, 60) : [];
  const context = await ownerContext(supabase, incident, session);
  const cached = options.jobId && context.history.find(item => item.job_id === options.jobId && item.author === 'guardian');
  if (cached && options.deferDelivery) return { text: cached.text, reply_markup: cached.reply_markup };
  const history = [...context.history.filter(item => !options.jobId || item.job_id !== options.jobId), { ...(options.jobId ? {job_id:options.jobId}: {}), at: new Date().toISOString(), author: 'mirko', text: conversationText(text), incident_id: incident?.id || null }];
  // Preserve the question even if the provider is unavailable.
  await saveConversation(supabase, chatId, history);
  if (incident) {
    const writer=supabase.from('kona_ai_messaggi');
    const row={ ...(options.jobId ? {id:options.jobId}: {}),
      incidente_id: incident.id, canale: 'telegram', autore_tipo: 'mirko',
      autore_profile_id: ownerProfileId(), testo: conversationText(text), metadati: metadata
    };
    const {error}=await (options.jobId ? writer.upsert(row,{onConflict:'id',ignoreDuplicates:true}):writer.insert(row));
    if (error) throw error;
  }
  let guardian;
  try {
    guardian = await generateOwnerReply(incident, previousMessages, text, context);
  } catch (error) {
    if(options.deferDelivery) throw error;
    console.warn('Guardian conversazione:', cleanText(error?.code || 'provider_unavailable', 100));
    const reason = error?.code === 'openai_invalid_key'
      ? 'OpenAI rifiuta la chiave della chat Netlify. Va verificata OPENAI_API_KEY, separata dalla chiave del worker GitHub.'
      : error?.code === 'openai_quota_exceeded' ? 'OpenAI segnala quota o credito esaurito per la chat.'
      : 'Non riesco a rispondere con OpenAI in questo momento.';
    guardian = { reply: `${reason} Ho conservato il tuo messaggio e potremo riprendere da qui.`, suggestedAction: 'nessuna' };
  }
  if (incident && guardian.requestType && (guardian.requestType !== incident.tipo_richiesta || guardian.requestSummary !== incident.riepilogo_ai)
    && guardian.requestSummary && ['raccolta','ricevuto','in_attesa_approvazione'].includes(incident.stato)) {
    const {data:updated,error}=await supabase.from('kona_ai_incidenti').update({tipo_richiesta:guardian.requestType,
      riepilogo_ai:guardian.requestSummary}).eq('id',incident.id).eq('tipo_richiesta',incident.tipo_richiesta)
      .in('stato',['raccolta','ricevuto','in_attesa_approvazione']).select('id').maybeSingle();
    if(error)throw error;
    if(updated) {
      const {error:approvalError}=await supabase.from('kona_ai_approvazioni').update({stato:'scaduta'})
        .eq('incidente_id',incident.id).eq('stato','in_attesa');
      if(approvalError)throw approvalError;
      const {error:auditError}=await supabase.from('kona_ai_messaggi').insert({incidente_id:incident.id,
        canale:'sistema',autore_tipo:'guardian',testo:guardian.requestType !== incident.tipo_richiesta
          ? 'Tipologia aggiornata dopo il chiarimento del proprietario: '+guardian.requestType
          : 'Requisito aggiornato dopo il chiarimento del proprietario.',
        metadati:{previous_type:incident.tipo_richiesta,request_type:guardian.requestType,voice_job_id:options.jobId || null}});
      if(auditError)throw auditError;
    }
  }
  history.push({ ...(options.jobId ? {job_id:options.jobId}: {}), at: new Date().toISOString(), author: 'guardian', text: guardian.reply, incident_id: incident?.id || null });
  if (incident) {
    let replyId;
    if(options.jobId) {
      const h=crypto.createHash('sha256').update('guardian:'+options.jobId).digest('hex');
      replyId=h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);
    }
    const row={...(replyId ? {id:replyId}: {}), incidente_id: incident.id, canale: 'guardian', autore_tipo: 'guardian',
      testo: guardian.reply, metadati: { suggested_action: guardian.suggestedAction, voice_job_id:options.jobId || null }};
    const writer=supabase.from('kona_ai_messaggi');
    const {error}=await (replyId ? writer.upsert(row,{onConflict:'id',ignoreDuplicates:true}):writer.insert(row));
    if (error) throw error;
  }
  let replyMarkup;
  if (incident && incident.stato !== 'archiviato' && guardian.suggestedAction === 'analizza_guardian') {
    replyMarkup = { inline_keyboard: [[{ text: 'Analisi Guardian', callback_data: `analyze:${incident.id}` }]] };
  } else if (incident && incident.stato !== 'archiviato' && guardian.suggestedAction === 'archivia') {
    replyMarkup = { inline_keyboard: [[{ text: 'Archivia', callback_data: `archive:${incident.id}` }]] };
  }
  if(options.jobId && replyMarkup) history[history.length-1].reply_markup=replyMarkup;
  await saveConversation(supabase,chatId,history);
  if (options.deferDelivery) return {text:guardian.reply, ...(replyMarkup ? {reply_markup:replyMarkup}: {})};
  await sendTelegramMessage(chatId, guardian.reply, { reply_markup: replyMarkup });
}

async function handleMessage(supabase, update, chatId, session) {
  const message = update.message;
  let text = conversationText(message?.text, 4000);
  let metadata = {};
  if (!text) {
    await sendTelegramMessage(chatId, 'Invia un messaggio di testo o un vocale.');
    return;
  }

  if (/^ok[ ,]*pubblica[.!]?$/i.test(text.trim()) && message.reply_to_message?.message_id) {
    const { data: pending, error } = await supabase.from('kona_ai_approvazioni').select('id, risultato')
      .eq('azione', 'rilascia_produzione').eq('stato', 'in_attesa').gt('scade_at', new Date().toISOString());
    if (error) throw error;
    const target = (pending || []).find(a => a.risultato?.telegram_message_id === message.reply_to_message.message_id);
    if (!target) throw new Error('Questa risposta non è collegata a una conferma di pubblicazione valida.');
    return publishProduction(supabase, chatId, target.id);
  }
  if (/^\/pubblica\s+KG-\d+$/i.test(text.trim())) {
    const numero = Number(text.match(/KG-(\d+)/i)[1]);
    const { data: incident, error } = await supabase.from('kona_ai_incidenti').select('id').eq('numero', numero).maybeSingle();
    if (error) throw error;
    if (!incident) throw new Error('Richiesta non trovata.');
    return prepareProductionRelease(supabase, chatId, incident.id);
  }
  const lower = text.toLowerCase();
  if (lower === '/start' || lower === '/help') {
    await sendTelegramMessage(chatId, [
      'Parlami liberamente del CRM e delle richieste, anche senza aprirne una. Puoi rispondere alle notifiche o citare un codice KG quando serve.',
      'I comandi sono scorciatoie facoltative; le azioni operative restano confermate dai pulsanti.',
      '',
      '/richieste mostra problemi e migliorie aperti',
      '/salute mostra lo stato tecnico dell\'Observer',
      '/apri KG-000001 apre una richiesta',
      '/pubblica KG-000001 mostra la conferma finale della modifica verificata',
      '/nuovo descrizione crea un problema da Telegram',
      '/nuovo_miglioria descrizione crea una miglioria da Telegram',
      '',
      'Puoi usare testo o messaggi vocali. Non è attiva una conversazione vocale dal vivo.'
    ].join('\n'));
    return;
  }
  if (lower === '/salute') return observerHealth(supabase, chatId);
  if (lower === '/incidenti' || lower === '/richieste') return listOpenIncidents(supabase, chatId);
  if (lower.startsWith('/apri')) return openByCode(supabase, chatId, text);
  if (lower.startsWith('/nuovo_miglioria')) {
    return createTelegramIncident(supabase, chatId, text.replace(/^\/nuovo_miglioria\s*/i, ''), 'miglioria');
  }
  if (lower.startsWith('/nuovo')) {
    return createTelegramIncident(supabase, chatId, text.replace(/^\/nuovo\s*/i, ''), 'problema');
  }
  return handleOwnerConversation(supabase, chatId, session, text, metadata, message.reply_to_message);
}

async function handleVoiceUpdate(supabase,update,chatId,deps={}) {
    const ownerChatId=String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '');
    const message=update.message;
    if (String(chatId)!==ownerChatId || message.chat?.type!=='private' || String(message.from?.id)!==ownerChatId || message.from?.is_bot) return response(200,{ok:true});
    try {
      const voice=require('./_lib/guardian-voice');
      const id=await (deps.enqueue || voice.enqueue)(supabase,update,chatId);
      if(id) {
        try { await (deps.send || sendTelegramMessage)(chatId,'Vocale ricevuto e accodato. Sto trascrivendo la tua spiegazione; ti rispondo qui appena è pronta.'); } catch (_) {}
        try { await (deps.nudge || voice.nudge)(); } catch (_) { console.warn('Guardian: vocale accodato, recupero dal cron'); }
      }
      return response(200,{ok:true});
    } catch (_) { return response(503,{ok:false}); }
  }


exports._test = { handleVoiceUpdate, handleOwnerConversation, resolveConversationIncident, ownerContext, publishProduction, prepareProductionRelease, latestSuccessfulTest, handleMessage, handleCallback };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { ok: false });
  const expectedSecret = String(process.env.TELEGRAM_GUARDIAN_WEBHOOK_SECRET || '').trim();
  const receivedSecret = event.headers?.['x-telegram-bot-api-secret-token']
    || event.headers?.['X-Telegram-Bot-Api-Secret-Token'];
  if (!expectedSecret || !secretsMatch(receivedSecret, expectedSecret)) {
    return response(401, { ok: false });
  }

  let update;
  try {
    update = JSON.parse(event.body || '{}');
  } catch (_) {
    return response(400, { ok: false });
  }
  const chatId = getChatId(update);
  const ownerChatId = String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '').trim();
  if (!chatId || !ownerChatId || chatId !== ownerChatId) {
    return response(200, { ok: true });
  }

  const source = update.callback_query || update.message;
  if ((String(update.callback_query?.data || '').startsWith('publish_production:')
    || /^ok[ ,]*pubblica[.!]?$/i.test(String(update.message?.text || '').trim()))
    && String(source?.from?.id || '') !== ownerChatId) return response(200, { ok: true });

  const supabase = getAdminClient();
  if (!supabase) return response(500, { ok: false });

  if (update.message?.voice?.file_id) return handleVoiceUpdate(supabase,update,chatId);

  try {
    const claimed = await claimUpdate(supabase, chatId, update.update_id);
    if (claimed.duplicate) return response(200, { ok: true });
    if (update.callback_query) {
      await handleCallback(supabase, update, chatId);
    } else if (update.message) {
      await handleMessage(supabase, update, chatId, claimed.session);
    }
  } catch (error) {
    console.error('guardian-telegram-webhook:', error);
    try {
      await sendTelegramMessage(chatId, `Guardian non ha completato l’operazione: ${cleanText(error?.message || String(error), 500)}`);
    } catch (_) {
      // Telegram potrebbe essere la sorgente dell'errore: il webhook deve comunque chiudersi.
    }
  }
  return response(200, { ok: true });
};
