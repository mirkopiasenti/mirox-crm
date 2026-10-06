'use strict';

const { getAdminClient } = require('./_lib/require-auth');
const { validateContract, SHA } = require('./_lib/guardian-release');
const {validDevelopment}=require('./_lib/guardian-development');
const { guardianHealth } = require('./_lib/guardian-health');
const {
  analysisKeyboard,
  cleanWorkerText,
  createLeaseToken,
  hashLeaseToken,
  parseWorkerBody,
  repositoryName,
  patchKeyboard,
  observerKeyboard,
  testKeyboard,
  verifyWorkerRequest
} = require('./_lib/guardian-codex');
const {
  cleanText,
  guardianAnalysisKeyboard,
  OPEN_INCIDENT_STATES,
  incidentCode,
  requestTypeLabel
} = require('./_lib/kona-ai-guardian');
const { sendTelegramMessage } = require('./_lib/telegram');
const { captureServerError } = require('./_lib/with-telemetry');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXECUTION_TYPES = new Set(['analisi_codex', 'analisi_automatica', 'scansione_migliorie', 'prepara_patch', 'test_staging', 'rilascio_produzione']);
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

async function releaseAuthorization(supabase, execution) {
  if (execution.tipo_esecuzione !== 'rilascio_produzione') throw new Error('Esecuzione non di pubblicazione');
  const { data: approval, error } = await supabase.from('kona_ai_approvazioni').select('*')
    .eq('id', execution.approvazione_id).maybeSingle();
  if (error) throw error;
  const owner = String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '');
  if (!owner || !approval || approval.stato !== 'approvata' || approval.azione !== 'rilascia_produzione'
    || String(approval.decisa_da_telegram_chat_id) !== owner || !approval.decisa_at
    || !(Date.parse(approval.scade_at) > Date.now())) throw new Error('Approvazione finale assente o scaduta');
  const contract = validateContract(approval.risultato?.release_contract);
  if (approval.incidente_id !== execution.incidente_id || contract.incident_id !== execution.incidente_id
    || contract.head_sha !== execution.base_commit_sha || contract.branch !== execution.branch_name
    || contract.pull_request_url !== execution.pull_request_url) throw new Error('Versione non approvata');
  const {data: currentIncident,error: currentError}=await supabase.from('kona_ai_incidenti').select('*').eq('id',execution.incidente_id).maybeSingle();
  if(currentError)throw currentError;
  const { data: tested, error: testError } = await supabase.from('kona_ai_esecuzioni').select('*')
    .eq('id', contract.test_execution_id).maybeSingle();
  if (testError) throw testError;
  if(tested?.risultato?.development && (!currentIncident || !validDevelopment(tested.risultato.development,currentIncident,owner)))throw new Error('Requisito cambiato dopo i test');
  if (!tested || tested.incidente_id !== execution.incidente_id || tested.tipo_esecuzione !== 'test_staging'
    || tested.stato !== 'completata' || tested.branch_name !== contract.branch
    || tested.pull_request_url !== contract.pull_request_url || tested.result_commit_sha !== contract.head_sha
    || tested.risultato?.tested_base_sha !== contract.base_sha || tested.risultato?.tests !== 'success'
    || tested.risultato?.install !== 'success' || tested.risultato?.smoke !== 'success') throw new Error('Test della versione approvata assenti');
  const { data: incident, error: incidentError } = await supabase.from('kona_ai_incidenti').select('stato')
    .eq('id', execution.incidente_id).maybeSingle();
  if (incidentError) throw incidentError;
  if (!incident || !OPEN_INCIDENT_STATES.includes(incident.stato)) throw new Error('Richiesta chiusa');
  return contract;
}

async function catalogContext(supabase, incident) {
  if(!/customer base|day by day|catalogo|offert|puntegg|gare/i.test([incident.titolo,incident.riepilogo_ai].join(' ')))return null;
  const [offers,metrics,dailyRows]=await Promise.all([
    supabase.from('vendita_offerte').select('id,categoria_id,cluster_cliente,nome_offerta,punteggio_gara,punteggio_extra_gara,abilita_dispositivo,abilita_switch_sim,attiva').limit(250),
    supabase.from('gara_metriche').select('id,nome,tabella,gruppo,ordine,punti_per_pezzo,punteggio_campo,regola,attiva').limit(250),
    supabase.from('dashboard_righe_giornaliera').select('id,nome,gruppo,colore_hex,ordine,regola').limit(250)
  ]);
  if(offers.error || metrics.error || dailyRows.error)throw new Error('Snapshot catalogo non disponibile');
  return {read_only:true,captured_at:nowIso(),offers:offers.data || [],metrics:metrics.data || [],daily_rows:dailyRows.data || [],
    truncated:[offers,metrics,dailyRows].some(result=>result.data?.length===250)};
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
    .order('created_at', { ascending: false })
    .limit(60);
  if (messagesError) throw messagesError;

  return {
    configuration: execution.tipo_esecuzione === 'prepara_patch' || execution.tipo_esecuzione === 'analisi_codex'
      ? await catalogContext(supabase,incident):null,
    ...(execution.tipo_esecuzione === 'rilascio_produzione' ? { release_contract: await releaseAuthorization(supabase, execution) } : {}),
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
    conversation: (messages || []).reverse().map((item) => ({
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
  if (execution.tipo_esecuzione === 'rilascio_produzione') await releaseAuthorization(supabase, execution);
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
  if (execution.tipo_esecuzione === 'rilascio_produzione') {
    const result = body.result || {};
    if (success) return `Modifica pubblicata in produzione. GitHub aggiornato e versione online verificata (${String(result.merge_commit_sha).slice(0, 12)}). Controlli Guardian superati.\n${execution.pull_request_url || ''}`;
    return result.merged === true
      ? `GitHub è stato aggiornato, ma il rilascio del CRM non è confermato. ${cleanWorkerText(body.error, 700)}\nServe una verifica del deploy. La segnalazione resta aperta.`
      : `Pubblicazione interrotta prima del merge. ${cleanWorkerText(body.error, 700)}\nLa segnalazione resta aperta: ripeti la verifica prima di approvare nuovamente.`;
  }
  const noChanges = success
    && execution.tipo_esecuzione === 'prepara_patch'
    && body?.result?.no_changes === true;
  const needsInformation = success
    && execution.tipo_esecuzione === 'prepara_patch'
    && body?.result?.needs_information === true;
  const blocked = success
    && execution.tipo_esecuzione === 'prepara_patch'
    && body?.result?.blocked === true;
  if (!success) {
    const descriptions = {
      openai_invalid_key: 'OpenAI rifiuta la chiave API del worker GitHub. Va sostituita OPENAI_API_KEY_CODEX_WORKER con una chiave valida.',
      openai_key_missing: 'Manca la chiave OpenAI del worker GitHub (OPENAI_API_KEY_CODEX_WORKER).',
      openai_model_unavailable: 'Il modello configurato non e disponibile per la chiave del worker. Va verificato il modello e il suo accesso.',
      openai_quota_exceeded: 'OpenAI ha rifiutato la richiesta per quota o credito esaurito. Va verificato il progetto API.',
      openai_unavailable: 'Il servizio OpenAI non e raggiungibile o ha restituito un errore temporaneo.'
    };
    const explanation = descriptions[body.error_code] || cleanWorkerText(body.error || body.message, 900)
      || 'Il workflow non ha restituito una diagnosi utilizzabile. La causa tecnica va verificata nel log GitHub.';
    const run = Number(execution.workflow_run_id);
    const link = Number.isSafeInteger(run) && run > 0
      ? `\nLog: https://github.com/${repositoryName()}/actions/runs/${run}` : '';
    return `Il controllo non e riuscito. ${explanation}${link}\n\nConservo la segnalazione. Non ripeto automaticamente la stessa analisi; dopo il ripristino puoi avviare un controllo manuale.`;
  }
  const summary = cleanWorkerText(body.message || body.summary, 5000)
    .replace(/^ESITO_PATCH:\s*(?:MODIFICA_PREPARATA|GIA_PRESENTE|RICHIEDE_INFORMAZIONI|BLOCCATA)\s*/i, '');
  if (noChanges) {
    return `Codex ha verificato la richiesta: il comportamento risulta già presente nel codice corrente. Nessun file è stato modificato e non serve una pull request.${summary ? `\n\n${summary}` : ''}`.slice(0, 7800);
  }
  if (needsInformation) {
    return [
      'Non ho preparato una modifica perché non ci sono ancora informazioni sufficienti per correggere il problema in sicurezza.',
      summary ? `\nCosa manca\n${summary}` : '',
      '\nProssimo passo\nPremi “Aggiungi informazioni” e rispondi alla domanda indicata. Dopo la risposta potremo ripetere la preparazione della modifica.'
    ].join('').slice(0, 7800);
  }
  if(blocked && body.pull_request_url) {
    return `Ho conservato la proposta nella branch di revisione: ${cleanWorkerText(body.pull_request_url,500)}.\n\nServe una revisione dei cambi al database prima della pubblicazione. Non ho eseguito SQL, merge o deploy e non serve ripetere l’analisi.\n\n${summary}`.slice(0,7800);
  }
  if (blocked) {
    return [
      'Non ho preparato una modifica automatica perché questa richiesta richiede una verifica manuale o riguarda un’area protetta.',
      summary ? `\n\n${summary}` : '',
      '\n\nNessun file è stato modificato.'
    ].join('').slice(0, 7800);
  }
  if (success && (execution.tipo_esecuzione === 'analisi_automatica' || execution.tipo_esecuzione === 'scansione_migliorie')) {
    const result = body?.result && typeof body.result === 'object' ? body.result : {};
    const missing = Array.isArray(result.missing_data)
      ? result.missing_data.map((item) => cleanWorkerText(item, 500)).filter(Boolean)
      : [];
    const safeToPatch = result.safe_to_prepare_patch === true && result.blocked !== true && missing.length === 0;
    return [
      'Codex ha completato il controllo automatico del codice.',
      '',
      'Che cosa significa',
      cleanWorkerText(result.summary || summary || 'Il controllo non ha prodotto una conclusione descrittiva.', 2200),
      '',
      safeToPatch
        ? 'Conclusione: ci sono elementi sufficienti per valutare una modifica.'
        : 'Conclusione: non ci sono ancora elementi sufficienti per preparare una modifica sicura.',
      missing.length ? `\nInformazione necessaria\n${missing[0]}` : '',
      safeToPatch
        ? '\nProssimo passo\nPuoi chiedermi di preparare la modifica.'
        : '\nProssimo passo\nPremi “Aggiungi informazioni” e rispondi alla domanda indicata.'
    ].filter(Boolean).join('\n').slice(0, 7800);
  }
  const prefix = success ? 'Codex ha completato' : 'Codex non ha completato';
  const phase = execution.tipo_esecuzione === 'analisi_codex'
    ? 'l’analisi del repository'
    : execution.tipo_esecuzione === 'analisi_automatica'
      ? 'l’analisi automatica del repository'
      : execution.tipo_esecuzione === 'scansione_migliorie'
        ? 'la scansione preventiva delle migliorie'
    : execution.tipo_esecuzione === 'prepara_patch'
      ? 'la preparazione della modifica'
      : execution.tipo_esecuzione === 'test_staging'
        ? 'i test della branch'
        : 'la preparazione del rilascio';
  return `${prefix} ${phase}.${summary ? `\n\n${summary}` : ''}`.slice(0, 7800);
}

function noChangeKeyboard(incidentId) {
  return {
    inline_keyboard: [
      [{ text: 'Apri conversazione', callback_data: `open:${incidentId}` }],
      [{ text: 'Archivia', callback_data: `archive:${incidentId}` }]
    ]
  };
}

function keyboardForExecution(execution, result) {
  if (execution.tipo_esecuzione === 'analisi_codex') return analysisKeyboard(execution.incidente_id);
  if (execution.tipo_esecuzione === 'analisi_automatica' || execution.tipo_esecuzione === 'scansione_migliorie') {
    const missing = Array.isArray(result?.missing_data) && result.missing_data.length > 0;
    const allowPatch = result?.safe_to_prepare_patch === true && result?.blocked !== true && !missing;
    return observerKeyboard(execution.incidente_id, {
      allowPatch,
      needsInformation: !allowPatch
    });
  }
  if (execution.tipo_esecuzione === 'prepara_patch'
    && result?.needs_information === true) {
    return observerKeyboard(execution.incidente_id, {
      allowPatch: false,
      needsInformation: true
    });
  }
  if (execution.tipo_esecuzione === 'prepara_patch'
    && (result?.no_changes === true || result?.blocked === true)) {
    return noChangeKeyboard(execution.incidente_id);
  }
  if (execution.tipo_esecuzione === 'prepara_patch') return patchKeyboard(execution.incidente_id);
  if (execution.tipo_esecuzione === 'test_staging') return testKeyboard(execution.incidente_id);
  return undefined;
}

async function recordResult(supabase, body) {
  const lease = await requireLease(supabase, body);
  if (lease.error) return lease.error;
  const execution = lease.execution;
  const publication = execution.tipo_esecuzione === 'rilascio_produzione';
  const releaseResult = body.result || {};
  const success = body.success === true && (!publication || (releaseResult.merged === true
    && releaseResult.deploy_status === 'ready' && releaseResult.health_ok === true
    && SHA.test(releaseResult.merge_commit_sha || '') && body.result_commit_sha === releaseResult.merge_commit_sha));
  const now = nowIso();
  const safeResult = sanitizeValue(body.result || {}) || {};
  delete safeResult.development; // Authority is server-owned, never supplied by the worker.
  if(execution.risultato?.development)safeResult.development=execution.risultato.development;
  const noChanges = success
    && execution.tipo_esecuzione === 'prepara_patch'
    && safeResult.no_changes === true;
  const needsInformation = success
    && execution.tipo_esecuzione === 'prepara_patch'
    && safeResult.needs_information === true;
  const blocked = success
    && execution.tipo_esecuzione === 'prepara_patch'
    && safeResult.blocked === true;
  const update = {
    stato: success ? 'completata' : 'fallita',
    risultato: safeResult,
    codice_errore: success ? null : cleanWorkerText(body.error_code, 120) || 'worker_failed',
    messaggio_errore: success ? null : cleanWorkerText(body.error || body.message, 2000),
    result_commit_sha: cleanWorkerText(body.result_commit_sha, 128) || null,
    branch_name: cleanWorkerText(body.branch_name, 255) || execution.branch_name || null,
    pull_request_url: cleanWorkerText(body.pull_request_url, 500) || execution.pull_request_url || null,
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
      || execution.tipo_esecuzione === 'analisi_automatica'
      || execution.tipo_esecuzione === 'scansione_migliorie'
      ? 'in_attesa_approvazione'
      : execution.tipo_esecuzione === 'prepara_patch'
        ? noChanges || needsInformation || blocked ? 'ricevuto' : 'in_lavorazione'
        : execution.tipo_esecuzione === 'test_staging'
          ? 'in_test'
          : 'risolto'
    : publication && safeResult.merged === true ? 'in_lavorazione' : 'ricevuto';
  const { error: incidentError } = await supabase.from('kona_ai_incidenti')
    .update({ stato: incidentState, ...(publication && success ? { riepilogo_risoluzione: 'Pubblicazione approvata su Telegram, merge e deploy verificati: ' + safeResult.merge_commit_sha } : {}) }).eq('id', execution.incidente_id)
    .in('stato', OPEN_INCIDENT_STATES);
  if (incidentError) throw incidentError;
  if (execution.approvazione_id) {
    const { data: approval, error: approvalError } = await supabase.from('kona_ai_approvazioni').select('risultato').eq('id', execution.approvazione_id).maybeSingle();
    if (approvalError) throw approvalError;
    const { error: savedApprovalError } = await supabase.from('kona_ai_approvazioni').update({
      stato: success ? 'eseguita' : 'fallita',
      risultato: { ...(approval?.risultato || {}), execution_id: execution.id, result: safeResult },
      eseguita_at: now
    }).eq('id', execution.approvazione_id);
    if (savedApprovalError) throw savedApprovalError;
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
  const { data: incident } = await supabase
    .from('kona_ai_incidenti')
    .select('numero, tipo_richiesta')
    .eq('id', execution.incidente_id)
    .maybeSingle();
  const heading = incident
    ? `${incidentCode(incident.numero)} · ${requestTypeLabel(incident.tipo_richiesta)}`
    : 'Guardian';
  const observerExecution = execution.tipo_esecuzione === 'analisi_automatica'
    || execution.tipo_esecuzione === 'scansione_migliorie';
  if (observerExecution || publication || safeResult.development?.auto_test === true) {
    const { data: signal, error: signalError } = await supabase.from('kona_ai_segnali')
      .select('id').eq('incidente_id', execution.incidente_id).maybeSingle();
    if (signalError) throw signalError;
    if (signal?.id) {
      const { error } = await supabase.from('kona_ai_segnali').update({
        stato: 'notificato', last_analyzed_at: now
      }).eq('id', signal.id);
      if (error) throw error;
    }
    const { error: notificationError } = await supabase.from('kona_ai_notifiche').upsert({
      incidente_id: execution.incidente_id,
      segnale_id: signal?.id || null,
      dedupe_key: `${publication ? 'release' : 'observer'}:result:${execution.id}`,
      payload: { text: `${heading}\n\n${text}`, reply_markup: success
        ? keyboardForExecution(execution, safeResult)
        : guardianAnalysisKeyboard(execution.incidente_id) },
      stato: 'in_coda', prossimo_tentativo_at: now
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
    if (notificationError) throw notificationError;
  } else if (chatId) {
    try {
      await sendTelegramMessage(chatId, `${heading}\n\n${text}`, {
        reply_markup: success ? keyboardForExecution(execution, safeResult) : undefined
      });
    } catch (telegramError) {
      console.warn('Notifica Telegram esito Codex non inviata:', telegramError?.message || String(telegramError));
    }
  }
  if(success && execution.tipo_esecuzione==='prepara_patch' && safeResult.development?.auto_test
    && !noChanges && !needsInformation && !blocked) {
    try {await require('./guardian-telegram-webhook')._test.startStagingTests(supabase,chatId,execution.incidente_id,{automatic:true,patchId:execution.id});}
    catch(error) {
      console.warn('Guardian: prosecuzione test rimandata:',cleanWorkerText(error.message,150));
      const {error: notificationError}=await supabase.from('kona_ai_notifiche').upsert({
        incidente_id:execution.incidente_id,dedupe_key:`development:continuation:${execution.id}`,
        payload:{text:`${heading}\nLa modifica è stata preparata, ma i test non sono partiti: ${cleanWorkerText(error.message,500)}`,reply_markup:patchKeyboard(execution.incidente_id)},
        stato:'in_coda',prossimo_tentativo_at:now
      },{onConflict:'dedupe_key',ignoreDuplicates:true});
      if(notificationError)throw notificationError;
    }
  }
  if (success && execution.tipo_esecuzione === 'test_staging') {
    try {
      const { prepareProductionRelease } = require('./guardian-telegram-webhook')._test;
      await prepareProductionRelease(supabase, chatId, execution.incidente_id);
    } catch (proposalError) {
      // Passing tests remain passing even when the final proposal needs another attempt.
      console.warn('Proposta finale Guardian non preparata:', proposalError.code || 'proposal_unavailable');
      const { error: proposalNotificationError } = await supabase.from('kona_ai_notifiche').upsert({
        incidente_id: execution.incidente_id, dedupe_key: `release:proposal:${execution.id}`,
        payload: { text: `${heading}\nTest superati, ma la conferma finale di pubblicazione non è disponibile: ${cleanWorkerText(proposalError.message, 500)}.`,
          reply_markup: testKeyboard(execution.incidente_id) },
        stato: 'in_coda', prossimo_tentativo_at: now
      }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (proposalNotificationError) throw proposalNotificationError;
    }
  }
  return response(200, { ok: true, execution_id: saved.id, state: saved.stato });
}

exports._test = { catalogContext, keyboardForExecution, resultMessage, recordResult, loadContext, releaseAuthorization };

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { ok: false, error: 'Metodo non consentito' });
  if (!verifyWorkerRequest(event)) return response(401, { ok: false, error: 'Worker non autorizzato' });
  const body = parseWorkerBody(event);
  if (!body) return response(400, { ok: false, error: 'JSON non valido' });
  const supabase = getAdminClient();
  if (!supabase) return response(500, { ok: false, error: 'Database non configurato' });
  try {
    if (body.action === 'health') return response(200, await guardianHealth(supabase));
    if (body.action === 'claim') return await claimExecution(supabase, body);
    if (body.action === 'release_authorization') {
      const lease = await requireLease(supabase, body);
      if (lease.error) return lease.error;
      return response(200, { ok: true, release_contract: await releaseAuthorization(supabase, lease.execution) });
    }
    if (body.action === 'heartbeat') return await heartbeatExecution(supabase, body);
    if (body.action === 'result') return await recordResult(supabase, body);
    return response(400, { ok: false, error: 'Azione worker non valida' });
  } catch (error) {
    console.error('guardian-codex-worker:', error);
    await captureServerError({
      supabase,
      error,
      functionName: 'guardian-codex-worker',
      operation: body.action || 'worker',
      kind: 'provider_error',
      severityHint: 'error',
      auth: { user: null }
    });
    return response(500, { ok: false, error: 'Errore interno del worker' });
  }
};
