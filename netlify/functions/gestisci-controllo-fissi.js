'use strict';

const { requireAuth, getAdminClient } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_ACTIONS = new Set(['reopen_activation']);

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function parseBody(event) {
  try {
    const parsed = JSON.parse(event.body || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function validUuid(value, fieldName = 'id') {
  const id = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error(`${fieldName} non valido`);
  return id;
}

function authenticatedProfileId(auth) {
  const value = auth?.profilo?.id || auth?.user?.id;
  return UUID_RE.test(String(value || '')) ? String(value).toLowerCase() : null;
}

async function reopenActivation({ supabase, auth, body }) {
  let id;
  let adminId;
  try {
    id = validUuid(body.id);
    adminId = authenticatedProfileId(auth);
    if (!adminId) throw new Error('Profilo amministratore privo di identificativo valido');
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const { data, error } = await supabase
    .from('post_vendita_controllo_fissi')
    .update({
      stato: 'In Attivazione',
      data_attivazione: null,
      motivo_ko: null,
      stato_cambiato_at: new Date().toISOString(),
      stato_cambiato_da: adminId
    })
    .eq('id', id)
    .eq('stato', 'Attivo')
    .select('id, stato, attivazione_prevista, data_attivazione, motivo_ko, stato_cambiato_at, stato_cambiato_da')
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    return response(409, {
      success: false,
      error: 'La pratica non è più nello stato Attivo oppure non è stata trovata'
    });
  }

  return response(200, { success: true, row: data });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const body = parseBody(event);
  if (!body) return response(400, { success: false, error: 'Body JSON non valido' });

  const action = String(body.action || '').trim();
  if (!ADMIN_ACTIONS.has(action)) {
    return response(400, { success: false, error: 'Azione non valida' });
  }

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const supabase = getAdminClient();
  if (!supabase) {
    return response(500, { success: false, error: 'Configurazione server incompleta' });
  }

  try {
    return await reopenActivation({ supabase, auth, body });
  } catch (error) {
    console.error('gestisci-controllo-fissi:', error);
    return response(500, {
      success: false,
      error: error?.message || 'Errore interno durante la gestione Controllo Fissi'
    });
  }
};

exports._test = {
  ADMIN_ACTIONS,
  authenticatedProfileId,
  parseBody,
  validUuid
};
