'use strict';

const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const {
  cleanText,
  generateIntakeReply,
  incidentCode,
  notifyOwnerOfIncident,
  profileId,
  profileName,
  requestType
} = require('./_lib/kona-ai-guardian');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function parseBody(event) {
  try {
    const body = JSON.parse(event.body || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch (_) {
    return null;
  }
}

function safePagePath(value) {
  const raw = cleanText(value, 500);
  if (!raw) return null;
  try {
    const url = new URL(raw, 'https://www.mirox-crm.it');
    return url.pathname.startsWith('/') ? url.pathname.slice(0, 300) : null;
  } catch (_) {
    return null;
  }
}

function safeClientContext(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const width = Number.parseInt(input.viewport_width, 10);
  const height = Number.parseInt(input.viewport_height, 10);
  return {
    viewport_width: Number.isFinite(width) ? Math.max(0, Math.min(width, 10000)) : null,
    viewport_height: Number.isFinite(height) ? Math.max(0, Math.min(height, 10000)) : null,
    language: cleanText(input.language, 30) || null
  };
}

async function getAccessibleIncident(supabase, incidentId, auth) {
  const { data, error } = await supabase
    .from('kona_ai_incidenti')
    .select('*')
    .eq('id', incidentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { status: 404, error: 'Richiesta non trovata' };

  const isAdmin = auth.profilo?.ruolo === 'admin';
  if (!isAdmin && data.reporter_id !== profileId(auth)) {
    return { status: 403, error: 'Non puoi accedere a questa richiesta' };
  }
  return { incident: data };
}

async function loadMessages(supabase, incidentId) {
  const { data, error } = await supabase
    .from('kona_ai_messaggi')
    .select('id, canale, autore_tipo, testo, metadati, created_at')
    .eq('incidente_id', incidentId)
    .order('created_at', { ascending: false })
    .limit(80);
  if (error) throw error;
  return (data || []).reverse();
}

async function processIntake(supabase, incident) {
  const messages = await loadMessages(supabase, incident.id);
  const result = await generateIntakeReply(messages, incident);

  const { data: guardianMessage, error: messageError } = await supabase
    .from('kona_ai_messaggi')
    .insert({
      incidente_id: incident.id,
      canale: 'guardian',
      autore_tipo: 'guardian',
      testo: result.reply,
      metadati: { intake_complete: result.complete }
    })
    .select('id, canale, autore_tipo, testo, metadati, created_at')
    .single();
  if (messageError) throw messageError;

  const updates = {
    priorita: result.priority || incident.priorita,
    ...(result.title ? { titolo: result.title } : {}),
    ...(result.summary ? { riepilogo_ai: result.summary } : {})
  };
  if (result.complete && incident.stato === 'raccolta') {
    updates.stato = 'ricevuto';
    updates.ricevuto_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from('kona_ai_incidenti')
    .update(updates)
    .eq('id', incident.id)
    .select('*')
    .single();
  if (updateError) throw updateError;

  if (result.complete && !updated.notificato_telegram_at) {
    try {
      const notification = await notifyOwnerOfIncident(updated);
      if (notification.sent) {
        const now = new Date().toISOString();
        await supabase
          .from('kona_ai_incidenti')
          .update({
            telegram_chat_id: notification.chatId,
            telegram_message_id: notification.messageId,
            notificato_telegram_at: now
          })
          .eq('id', updated.id)
          .is('notificato_telegram_at', null);
        updated.notificato_telegram_at = now;
      }
    } catch (error) {
      console.warn('Notifica Telegram Guardian non inviata:', error?.message || String(error));
    }
  }

  return { incident: updated, message: guardianMessage, complete: result.complete };
}

async function createIncident(supabase, auth, body) {
  const message = cleanText(body.message, 4000);
  if (message.length < 3) {
    return response(400, { success: false, error: 'Descrivi la richiesta con almeno 3 caratteri' });
  }
  const type = requestType(body.request_type, null);
  if (!type) return response(400, { success: false, error: 'Tipo di richiesta non valido' });
  const reporterId = profileId(auth);
  if (!reporterId) return response(400, { success: false, error: 'Profilo autenticato non valido' });

  const pagePath = safePagePath(body.context?.page_path);
  const record = {
    sorgente: 'crm',
    stato: 'raccolta',
    priorita: 'media',
    tipo_richiesta: type,
    descrizione_iniziale: message,
    reporter_id: reporterId,
    reporter_nome: profileName(auth),
    pagina_path: pagePath,
    pagina_titolo: cleanText(body.context?.page_title, 200) || null,
    user_agent: cleanText(body.context?.user_agent, 500) || null,
    contesto_client: safeClientContext(body.context)
  };

  const { data: incident, error: incidentError } = await supabase
    .from('kona_ai_incidenti')
    .insert(record)
    .select('*')
    .single();
  if (incidentError) throw incidentError;

  const { error: messageError } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incident.id,
    canale: 'crm',
    autore_tipo: 'operatore',
    autore_profile_id: reporterId,
    testo: message,
    metadati: { page_path: pagePath, request_type: type }
  });
  if (messageError) {
    await supabase.from('kona_ai_incidenti').delete().eq('id', incident.id);
    throw messageError;
  }

  const intake = await processIntake(supabase, incident);
  return response(201, {
    success: true,
    incident: {
      id: intake.incident.id,
      code: incidentCode(intake.incident.numero),
      status: intake.incident.stato,
      priority: intake.incident.priorita,
      request_type: intake.incident.tipo_richiesta
    },
    reply: intake.message.testo,
    complete: intake.complete
  });
}

async function addMessage(supabase, auth, body) {
  const incidentId = String(body.incident_id || '').trim();
  const message = cleanText(body.message, 4000);
  if (!UUID_RE.test(incidentId)) return response(400, { success: false, error: 'Identificativo richiesta non valido' });
  if (message.length < 1) return response(400, { success: false, error: 'Scrivi un messaggio' });

  const access = await getAccessibleIncident(supabase, incidentId, auth);
  if (!access.incident) return response(access.status, { success: false, error: access.error });
  if (['risolto', 'archiviato'].includes(access.incident.stato)) {
    return response(409, { success: false, error: 'La richiesta è chiusa e non accetta altri messaggi' });
  }

  const { error } = await supabase.from('kona_ai_messaggi').insert({
    incidente_id: incidentId,
    canale: 'crm',
    autore_tipo: 'operatore',
    autore_profile_id: profileId(auth),
    testo: message
  });
  if (error) throw error;

  const intake = await processIntake(supabase, access.incident);
  return response(200, {
    success: true,
    incident: {
      id: intake.incident.id,
      code: incidentCode(intake.incident.numero),
      status: intake.incident.stato,
      priority: intake.incident.priorita,
      request_type: intake.incident.tipo_richiesta
    },
    reply: intake.message.testo,
    complete: intake.complete
  });
}

async function getIncident(supabase, auth, incidentId) {
  if (!UUID_RE.test(incidentId)) return response(400, { success: false, error: 'Identificativo richiesta non valido' });
  const access = await getAccessibleIncident(supabase, incidentId, auth);
  if (!access.incident) return response(access.status, { success: false, error: access.error });
  const messages = await loadMessages(supabase, incidentId);
  return response(200, {
    success: true,
    incident: { ...access.incident, code: incidentCode(access.incident.numero) },
    messages
  });
}

async function listIncidents(supabase, auth) {
  let query = supabase
    .from('kona_ai_incidenti')
    .select('id, numero, stato, priorita, tipo_richiesta, titolo, riepilogo_ai, reporter_nome, pagina_path, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);
  if (auth.profilo?.ruolo !== 'admin') query = query.eq('reporter_id', profileId(auth));
  const { data, error } = await query;
  if (error) throw error;
  return response(200, {
    success: true,
    incidents: (data || []).map((item) => ({ ...item, code: incidentCode(item.numero) }))
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(204, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return response(405, { success: false, error: 'Metodo non consentito' });
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });
  const supabase = getAdminClient();

  try {
    if (event.httpMethod === 'GET') {
      const incidentId = String(event.queryStringParameters?.id || '').trim();
      return incidentId
        ? await getIncident(supabase, auth, incidentId)
        : await listIncidents(supabase, auth);
    }

    const body = parseBody(event);
    if (!body) return response(400, { success: false, error: 'JSON non valido' });
    const action = String(body.action || 'create');
    if (action === 'create') return await createIncident(supabase, auth, body);
    if (action === 'message') return await addMessage(supabase, auth, body);
    return response(400, { success: false, error: 'Azione non valida' });
  } catch (error) {
    console.error('guardian-incidents:', error);
    return response(500, { success: false, error: 'Errore interno nella gestione della richiesta' });
  }
};
