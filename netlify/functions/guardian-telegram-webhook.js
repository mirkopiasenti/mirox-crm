'use strict';

const crypto = require('node:crypto');
const { getAdminClient } = require('./_lib/require-auth');
const {
  cleanText,
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
  repositoryName,
  stagingBranch
} = require('./_lib/guardian-codex');
const {
  answerCallbackQuery,
  downloadTelegramFile,
  sendTelegramMessage,
  transcribeVoice
} = require('./_lib/telegram');

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
    .select('chat_id, incidente_attivo_id, ultimo_update_id')
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
      incidente_id: incident.id,
      approvazione_id: approval?.id || null,
      tipo_esecuzione: type,
      stato: 'in_coda',
      esecutore: 'codex',
      richiesta_da: 'telegram',
      modello: options.model || 'gpt-5.6-luna',
      sandbox: options.sandbox || 'read_only',
      repository: repositoryName(),
      branch_name: options.branch || stagingBranch(),
      base_commit_sha: options.baseCommit || null,
      workflow_name: options.workflow || null,
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
      risultato: { execution_id: execution.id, error: cleanText(message, 500) },
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
      ref: execution.branch_name || stagingBranch()
    });
    if (!dispatch.dispatched) {
      await failExecution(supabase, execution, 'Worker Codex non configurato nell’ambiente corrente.', 'worker_not_configured');
      await sendTelegramMessage(chatId, [
        `${incidentCode(incident.numero)}: approvazione registrata.`,
        'Il worker Codex non è ancora configurato nello staging; nessun file è stato modificato.'
      ].join('\n'));
      return false;
    }
    await supabase.from('kona_ai_esecuzioni').update({
      workflow_name: dispatch.workflow,
      repository: dispatch.repository,
      branch_name: dispatch.ref
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
    branch: String(process.env.MIROX_DEPLOY_ENV || '').trim().toLowerCase() === 'staging' ? stagingBranch() : 'main'
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
    motivazione: 'Preparazione modifica staging approvata esplicitamente tramite Telegram',
    decisa_at: now
  }).select('id').single();
  if (approvalError) throw approvalError;
  const { execution } = await createExecution(supabase, incident, approval, 'prepara_patch', {
    sandbox: 'workspace_write',
    branch: stagingBranch()
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
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} ha già test staging in corso.`);
    return;
  }
  const { data: patchExecution, error: patchError } = await supabase.from('kona_ai_esecuzioni')
    .select('branch_name, result_commit_sha')
    .eq('incidente_id', incident.id)
    .eq('tipo_esecuzione', 'prepara_patch')
    .eq('stato', 'completata')
    .order('completata_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (patchError) throw patchError;
  if (!patchExecution?.branch_name) {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} non ha ancora una modifica staging completata.`);
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
    motivazione: 'Test staging approvati esplicitamente tramite Telegram',
    decisa_at: now
  }).select('id').single();
  if (approvalError) throw approvalError;
  const { execution } = await createExecution(supabase, incident, approval, 'test_staging', {
    sandbox: 'read_only',
    branch: patchExecution.branch_name,
    baseCommit: patchExecution.result_commit_sha || null
  });
  await supabase.from('kona_ai_incidenti').update({ stato: 'in_test' }).eq('id', incident.id);
  await dispatchExecution(supabase, chatId, incident, execution);
}

async function prepareProductionRelease(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Richiesta non trovata');
  if (incident.stato === 'archiviato') {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} è archiviata e non può essere rilasciata.`);
    return;
  }
  const { data: testExecution, error: testError } = await supabase.from('kona_ai_esecuzioni')
    .select('branch_name, result_commit_sha')
    .eq('incidente_id', incident.id)
    .eq('tipo_esecuzione', 'test_staging')
    .eq('stato', 'completata')
    .order('completata_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (testError) throw testError;
  if (!testExecution?.branch_name) {
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} non ha ancora un test staging completato.`);
    return;
  }
  const now = new Date().toISOString();
  const { data: approval, error: approvalError } = await supabase.from('kona_ai_approvazioni').insert({
    incidente_id: incident.id,
    azione: 'rilascia_produzione',
    stato: 'approvata',
    richiesta_da: 'telegram',
    decisa_da_profile_id: ownerProfileId(),
    decisa_da_telegram_chat_id: chatId,
    motivazione: 'Preparazione rilascio approvata esplicitamente tramite Telegram; merge production resta manuale',
    decisa_at: now
  }).select('id').single();
  if (approvalError) throw approvalError;
  const { execution } = await createExecution(supabase, incident, approval, 'rilascio_produzione', {
    sandbox: 'read_only',
    branch: testExecution.branch_name,
    baseCommit: testExecution.result_commit_sha || null
  });
  await dispatchExecution(supabase, chatId, incident, execution);
}

async function handleCallback(supabase, update, chatId) {
  const query = update.callback_query;
  const [action, incidentId] = String(query.data || '').split(':');
  if (!UUID_RE.test(incidentId)) {
    await answerCallbackQuery(query.id, 'Comando non valido');
    return;
  }
  await answerCallbackQuery(query.id, 'Ricevuto');
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

async function handleOwnerConversation(supabase, chatId, session, text, metadata = {}) {
  const incidentId = session?.incidente_attivo_id;
  if (!incidentId) {
    await sendTelegramMessage(chatId, 'Nessuna richiesta attiva. Usa /richieste, /apri KG-000001, /nuovo descrizione oppure /nuovo_miglioria descrizione.');
    return;
  }
  const incident = await getIncident(supabase, incidentId);
  if (!incident) {
    await setActiveIncident(supabase, chatId, null);
    await sendTelegramMessage(chatId, 'La richiesta attiva non esiste più. Usa /richieste per sceglierne un’altra.');
    return;
  }
  if (incident.stato === 'archiviato') {
    await sendTelegramMessage(chatId, 'La richiesta attiva è archiviata. Aprine un’altra con /richieste.');
    return;
  }

  const previousMessages = await getMessages(supabase, incident.id, 60);
  const { error: ownerMessageError } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incident.id,
    canale: 'telegram',
    autore_tipo: 'mirko',
    autore_profile_id: ownerProfileId(),
    testo: cleanText(text, 4000),
    metadati: metadata
  });
  if (ownerMessageError) throw ownerMessageError;

  const guardian = await generateOwnerReply(incident, previousMessages, text);
  const { error: guardianMessageError } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incident.id,
    canale: 'guardian',
    autore_tipo: 'guardian',
    testo: guardian.reply,
    metadati: { suggested_action: guardian.suggestedAction }
  });
  if (guardianMessageError) throw guardianMessageError;

  let replyMarkup;
  if (guardian.suggestedAction === 'analizza_guardian') {
    replyMarkup = { inline_keyboard: [[{ text: 'Approva analisi Guardian', callback_data: `analyze:${incident.id}` }]] };
  } else if (guardian.suggestedAction === 'archivia') {
    replyMarkup = { inline_keyboard: [[{ text: 'Approva archiviazione', callback_data: `archive:${incident.id}` }]] };
  }
  await sendTelegramMessage(chatId, guardian.reply, { reply_markup: replyMarkup });
}

async function handleMessage(supabase, update, chatId, session) {
  const message = update.message;
  let text = cleanText(message?.text, 4000);
  let metadata = {};
  if (!text && message?.voice?.file_id) {
    await sendTelegramMessage(chatId, 'Trascrizione del vocale in corso.');
    const file = await downloadTelegramFile(message.voice.file_id);
    text = cleanText(await transcribeVoice(file), 4000);
    metadata = { input_type: 'voice', telegram_file_id: message.voice.file_id };
  }
  if (!text) {
    await sendTelegramMessage(chatId, 'Invia un messaggio di testo o un vocale.');
    return;
  }

  const lower = text.toLowerCase();
  if (lower === '/start' || lower === '/help') {
    await sendTelegramMessage(chatId, [
      'KONA AI Guardian è collegato soltanto a questa chat privata.',
      '',
      '/richieste mostra problemi e migliorie aperti',
      '/salute mostra lo stato tecnico dell\'Observer',
      '/apri KG-000001 apre una richiesta',
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
  return handleOwnerConversation(supabase, chatId, session, text, metadata);
}

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

  const supabase = getAdminClient();
  if (!supabase) return response(500, { ok: false });

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
