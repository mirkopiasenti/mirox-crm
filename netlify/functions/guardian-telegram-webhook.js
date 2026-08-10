'use strict';

const crypto = require('node:crypto');
const { getAdminClient } = require('./_lib/require-auth');
const {
  cleanText,
  generateGuardianAnalysis,
  generateOwnerReply,
  incidentCode,
  incidentNotificationKeyboard,
  OPEN_INCIDENT_STATES
} = require('./_lib/kona-ai-guardian');
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
    incident.titolo || 'Problema CRM',
    incident.riepilogo_ai || incident.descrizione_iniziale
  ].join('\n');
}

async function listOpenIncidents(supabase, chatId) {
  const { data, error } = await supabase
    .from('kona_ai_incidenti')
    .select('id, numero, stato, priorita, titolo, descrizione_iniziale, riepilogo_ai')
    .in('stato', OPEN_INCIDENT_STATES)
    .order('updated_at', { ascending: false })
    .limit(10);
  if (error) throw error;
  if (!data?.length) {
    await sendTelegramMessage(chatId, 'Non ci sono incidenti aperti.');
    return;
  }
  await sendTelegramMessage(chatId, [
    'Incidenti aperti:',
    '',
    ...data.map((item) => `${incidentCode(item.numero)} · ${item.priorita} · ${item.titolo || 'Problema CRM'}`),
    '',
    'Usa /apri KG-000001 per entrare in una conversazione.'
  ].join('\n'));
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
    'Da ora i tuoi messaggi e vocali saranno collegati a questo incidente.'
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
    await sendTelegramMessage(chatId, 'Incidente non trovato.');
    return;
  }
  await openIncident(supabase, chatId, data);
}

async function createTelegramIncident(supabase, chatId, text) {
  const description = cleanText(text, 4000);
  if (description.length < 3) {
    await sendTelegramMessage(chatId, 'Scrivi /nuovo seguito dalla descrizione del problema.');
    return;
  }
  const title = description.length > 90 ? `${description.slice(0, 87)}...` : description;
  const { data: incident, error } = await supabase
    .from('kona_ai_incidenti')
    .insert({
      stato: 'ricevuto',
      priorita: 'media',
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
    testo: description
  });
  if (messageError) throw messageError;
  await setActiveIncident(supabase, chatId, incident.id);
  await sendTelegramMessage(chatId, `Creato ${incidentCode(incident.numero)}. La conversazione è ora attiva.`, {
    reply_markup: incidentNotificationKeyboard(incident.id)
  });
}

async function archiveIncident(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Incidente non trovato');
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
  await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incident.id,
    canale: 'sistema',
    autore_tipo: 'sistema',
    testo: 'Incidente archiviato da Mirko tramite Telegram.',
    metadati: { approval_id: approval.id }
  });
  await sendTelegramMessage(chatId, `${incidentCode(incident.numero)} archiviato.`);
}

async function analyzeIncident(supabase, chatId, incidentId) {
  const incident = await getIncident(supabase, incidentId);
  if (!incident) throw new Error('Incidente non trovato');
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
    await sendTelegramMessage(chatId, `${incidentCode(incident.numero)}\n\n${analysis}`);
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

async function handleCallback(supabase, update, chatId) {
  const query = update.callback_query;
  const [action, incidentId] = String(query.data || '').split(':');
  if (!UUID_RE.test(incidentId)) {
    await answerCallbackQuery(query.id, 'Comando non valido');
    return;
  }
  await answerCallbackQuery(query.id, 'Ricevuto');
  if (action === 'open') {
    const incident = await getIncident(supabase, incidentId);
    if (!incident) throw new Error('Incidente non trovato');
    await openIncident(supabase, chatId, incident);
    return;
  }
  if (action === 'analyze') {
    await analyzeIncident(supabase, chatId, incidentId);
    return;
  }
  if (action === 'archive') {
    await archiveIncident(supabase, chatId, incidentId);
  }
}

async function handleOwnerConversation(supabase, chatId, session, text, metadata = {}) {
  const incidentId = session?.incidente_attivo_id;
  if (!incidentId) {
    await sendTelegramMessage(chatId, 'Nessun incidente attivo. Usa /incidenti, /apri KG-000001 oppure /nuovo descrizione.');
    return;
  }
  const incident = await getIncident(supabase, incidentId);
  if (!incident) {
    await setActiveIncident(supabase, chatId, null);
    await sendTelegramMessage(chatId, 'L’incidente attivo non esiste più. Usa /incidenti per sceglierne un altro.');
    return;
  }
  if (incident.stato === 'archiviato') {
    await sendTelegramMessage(chatId, 'L’incidente attivo è archiviato. Aprine un altro con /incidenti.');
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
      '/incidenti mostra i problemi aperti',
      '/apri KG-000001 apre una conversazione',
      '/nuovo descrizione crea un problema da Telegram',
      '',
      'Puoi usare testo o messaggi vocali. Non è attiva una conversazione vocale dal vivo.'
    ].join('\n'));
    return;
  }
  if (lower === '/incidenti') return listOpenIncidents(supabase, chatId);
  if (lower.startsWith('/apri')) return openByCode(supabase, chatId, text);
  if (lower.startsWith('/nuovo')) return createTelegramIncident(supabase, chatId, text.replace(/^\/nuovo\s*/i, ''));
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
