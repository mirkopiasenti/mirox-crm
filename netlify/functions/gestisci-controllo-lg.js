'use strict';

const { requireAuth, getAdminClient } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL_STATUSES = new Set([
  'Nuovo',
  'In lavorazione',
  'In attivazione',
  'Attivato',
  'Annullato',
  'Rifiutato'
]);
const ADMIN_ACTIONS = new Set(['set_manual_outcome', 'unlock_manual_outcome']);
const AUTHENTICATED_ACTIONS = new Set(['csv_update_batch', ...ADMIN_ACTIONS]);
const CSV_BATCH_SIZE = 50;

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

function cleanText(value, maxLength, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error('Campo obbligatorio mancante');
  if (text.length > maxLength) {
    throw new Error(`Testo troppo lungo (massimo ${maxLength} caratteri)`);
  }
  return text || null;
}

function validUuid(value, fieldName = 'id') {
  const id = String(value || '').trim().toLowerCase();
  if (!UUID_RE.test(id)) throw new Error(`${fieldName} non valido`);
  return id;
}

function authenticatedProfileId(auth) {
  // Per l'audit serve l'account che ha eseguito davvero l'azione, non
  // l'eventuale profilo canonico usato per consolidare i KPI.
  const value = auth?.profilo?.id || auth?.user?.id;
  return UUID_RE.test(String(value || '')) ? String(value).toLowerCase() : null;
}

function parseManualOutcome(body) {
  const id = validUuid(body.id);
  const stato = cleanText(body.stato, 100, { required: true });
  if (!MANUAL_STATUSES.has(stato)) throw new Error('Stato manuale non valido');
  const note = cleanText(body.note, 2000, { required: true });
  if (note.length < 5) throw new Error('La motivazione deve contenere almeno 5 caratteri');
  return { id, stato, note };
}

function parseCsvUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Aggiornamento CSV non valido');
  }
  const id = validUuid(value.id);
  const stato = cleanText(value.stato, 100, { required: true });
  return {
    id,
    stato,
    causale_stato_pratica: cleanText(value.causale_stato_pratica, 4000),
    messaggio_esito_sap: cleanText(value.messaggio_esito_sap, 4000),
    causa_annullamento: cleanText(value.causa_annullamento, 4000)
  };
}

function parseCsvBatch(body) {
  if (!Array.isArray(body.updates) || body.updates.length === 0) {
    throw new Error('Nessun aggiornamento CSV ricevuto');
  }
  if (body.updates.length > CSV_BATCH_SIZE) {
    throw new Error(`Massimo ${CSV_BATCH_SIZE} aggiornamenti per richiesta`);
  }
  const updates = body.updates.map(parseCsvUpdate);
  if (new Set(updates.map((item) => item.id)).size !== updates.length) {
    throw new Error('Il batch contiene ID duplicati');
  }
  return updates;
}

async function setManualOutcome({ supabase, auth, body }) {
  let input;
  let adminId;
  try {
    input = parseManualOutcome(body);
    adminId = authenticatedProfileId(auth);
    if (!adminId) throw new Error('Profilo amministratore privo di identificativo valido');
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('post_vendita_controllo_lg')
    .update({
      stato: input.stato,
      stato_origine: 'manuale',
      esito_manuale_bloccato: true,
      esito_manuale_note: input.note,
      esito_manuale_at: now,
      esito_manuale_da: adminId,
      esito_manuale_sbloccato_at: null,
      esito_manuale_sbloccato_da: null,
      causale_stato_pratica: null,
      messaggio_esito_sap: null,
      causa_annullamento: null
    })
    .eq('id', input.id)
    .select(`
      id, stato, stato_origine, esito_manuale_bloccato,
      esito_manuale_note, esito_manuale_at, esito_manuale_da,
      esito_manuale_sbloccato_at, esito_manuale_sbloccato_da
    `)
    .maybeSingle();
  if (error) throw error;
  if (!data) return response(404, { success: false, error: 'Riga Controllo L&G non trovata' });

  return response(200, { success: true, row: data });
}

async function unlockManualOutcome({ supabase, auth, body }) {
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
    .from('post_vendita_controllo_lg')
    .update({
      esito_manuale_bloccato: false,
      esito_manuale_sbloccato_at: new Date().toISOString(),
      esito_manuale_sbloccato_da: adminId
    })
    .eq('id', id)
    .eq('esito_manuale_bloccato', true)
    .select(`
      id, stato, stato_origine, esito_manuale_bloccato,
      esito_manuale_note, esito_manuale_at, esito_manuale_da,
      esito_manuale_sbloccato_at, esito_manuale_sbloccato_da
    `)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return response(409, {
      success: false,
      error: 'Esito manuale non trovato oppure aggiornamento CSV già riattivato'
    });
  }

  return response(200, { success: true, row: data });
}

async function applyCsvUpdate({ supabase, profileId, item }) {
  const isRejected = item.stato === 'Rifiutato';
  const { data, error } = await supabase
    .from('post_vendita_controllo_lg')
    .update({
      stato: item.stato,
      stato_origine: 'csv',
      causale_stato_pratica: isRejected ? item.causale_stato_pratica : null,
      messaggio_esito_sap: isRejected ? item.messaggio_esito_sap : null,
      causa_annullamento: isRejected ? item.causa_annullamento : null,
      ultimo_csv_upload_at: new Date().toISOString(),
      ultimo_csv_upload_da: profileId
    })
    .eq('id', item.id)
    .eq('esito_manuale_bloccato', false)
    .select('id')
    .maybeSingle();

  if (error) {
    return { id: item.id, status: 'error', error: error.message || 'Errore aggiornamento' };
  }
  if (!data) return { id: item.id, status: 'manual_protected' };
  return { id: item.id, status: 'updated' };
}

async function updateCsvBatch({ supabase, auth, body }) {
  let updates;
  let profileId;
  try {
    updates = parseCsvBatch(body);
    profileId = authenticatedProfileId(auth);
    if (!profileId) throw new Error('Profilo autenticato privo di identificativo valido');
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const results = await Promise.all(
    updates.map((item) => applyCsvUpdate({ supabase, profileId, item }))
  );
  return response(200, {
    success: true,
    updated_ids: results.filter((item) => item.status === 'updated').map((item) => item.id),
    manual_protected_ids: results
      .filter((item) => item.status === 'manual_protected')
      .map((item) => item.id),
    errors: results
      .filter((item) => item.status === 'error')
      .map((item) => ({ id: item.id, error: item.error }))
  });
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
  if (!AUTHENTICATED_ACTIONS.has(action)) {
    return response(400, { success: false, error: 'Azione non valida' });
  }

  const auth = await requireAuth(event, { adminOnly: ADMIN_ACTIONS.has(action) });
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const supabase = getAdminClient();
  if (!supabase) {
    return response(500, { success: false, error: 'Configurazione server incompleta' });
  }

  try {
    if (action === 'set_manual_outcome') {
      return await setManualOutcome({ supabase, auth, body });
    }
    if (action === 'unlock_manual_outcome') {
      return await unlockManualOutcome({ supabase, auth, body });
    }
    return await updateCsvBatch({ supabase, auth, body });
  } catch (error) {
    console.error('gestisci-controllo-lg:', error);
    return response(500, {
      success: false,
      error: error?.message || 'Errore interno durante la gestione Controllo L&G'
    });
  }
};

exports._test = {
  ADMIN_ACTIONS,
  AUTHENTICATED_ACTIONS,
  CSV_BATCH_SIZE,
  MANUAL_STATUSES,
  cleanText,
  parseCsvBatch,
  parseCsvUpdate,
  parseManualOutcome,
  validUuid
};
