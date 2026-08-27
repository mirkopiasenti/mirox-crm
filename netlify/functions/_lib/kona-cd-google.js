'use strict';

const { decryptSecret, encryptSecret } = require('./kona-cd-crypto');
const { addDaysStr, isWorkingDay, parseHHmm, romeToUtc, todayRomeStr } = require('./kona-cd-time');

// Integrazione Google Calendar (solo lato server).
// - Connessione OAuth esclusivamente admin (nessuna chiave nel frontend).
// - Refresh token cifrato in DB con chiave env separata (kona-cd-crypto).
// - Scopi minimi: free/busy read + scrittura eventi Mirox.
// - Il browser riceve SOLO slot pre-calcolati, mai token Google.

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events'
].join(' ');

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_ID = 'primary';

function oauthConfig() {
  const clientId = String(process.env.KONA_CALL_DIRECTOR_GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.KONA_CALL_DIRECTOR_GOOGLE_CLIENT_SECRET || '').trim();
  const redirectUri = String(process.env.KONA_CALL_DIRECTOR_GOOGLE_REDIRECT_URI || '').trim();
  return { clientId, clientSecret, redirectUri, isConfigured: Boolean(clientId && clientSecret && redirectUri) };
}

function buildAuthUrl({ state, accessType = 'offline' }) {
  const { clientId, redirectUri } = oauthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: accessType,
    prompt: 'consent',
    ...(state ? { state } : {})
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = oauthConfig();
  if (!clientId || !clientSecret) throw new Error('Google OAuth non configurato');
  const body = new URLSearchParams({ ...params, client_id: clientId, client_secret: clientSecret });
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error_description || data.error || `Google token ${response.status}`);
  }
  return data;
}

async function exchangeCode(code) {
  const { redirectUri } = oauthConfig();
  return tokenRequest({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  });
}

// Salva (o aggiorna) il refresh token cifrato. Ritorna boolean.
async function storeToken(supabase, { refreshToken, scopes = SCOPES, collegatoDa }) {
  const encrypted = encryptSecret(refreshToken);
  if (!encrypted) return false;
  const record = {
    id: 1,
    refresh_token_cipher: encrypted.cipher,
    token_iv: encrypted.iv,
    token_tag: encrypted.tag,
    scopes: Array.isArray(scopes) ? scopes : [scopes],
    collegato_at: new Date().toISOString(),
    collegato_da: collegatoDa || null
  };
  const { error } = await supabase.from('kona_call_director_google_token').upsert(record, { onConflict: 'id' });
  return !error;
}

async function getRefreshToken(supabase) {
  const { data, error } = await supabase
    .from('kona_call_director_google_token')
    .select('*')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return null;
  return decryptSecret({
    cipher: data.refresh_token_cipher,
    iv: data.token_iv,
    tag: data.token_tag
  });
}

async function hasToken(supabase) {
  const refresh = await getRefreshToken(supabase);
  return Boolean(refresh);
}

// Ottiene un access token fresco via refresh. Ritorna la stringa o null.
async function getAccessToken(supabase) {
  const refreshToken = await getRefreshToken(supabase);
  if (!refreshToken) return null;
  try {
    const data = await tokenRequest({
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    });
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      // Rotazione rara del refresh token: aggiornare il record cifrato.
      await storeToken(supabase, { refreshToken: data.refresh_token, scopes: SCOPES });
    }
    return data.access_token || null;
  } catch {
    return null;
  }
}

async function googleRequest(accessToken, url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data?.error?.message || `Google API ${response.status}`);
    err.code = data?.error?.code;
    err.status = response.status;
    throw err;
  }
  return data;
}

async function freeBusy(accessToken, { calendarId = CALENDAR_ID, timeMin, timeMax }) {
  const data = await googleRequest(accessToken, `${CALENDAR_API}/freeBusy`, {
    method: 'POST',
    body: { timeMin, timeMax, items: [{ id: calendarId }] }
  });
  return (data.calendars?.[calendarId]?.busy || []).map((b) => ({ start: b.start, end: b.end }));
}

async function listEvents(accessToken, { calendarId = CALENDAR_ID, timeMin, timeMax }) {
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true' });
  const data = await googleRequest(accessToken, `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  return data.items || [];
}

async function insertEvent(accessToken, { calendarId = CALENDAR_ID, summary, start, end, description, konaId }) {
  const body = {
    summary,
    start: { dateTime: start, timeZone: 'Europe/Rome' },
    end: { dateTime: end, timeZone: 'Europe/Rome' },
    ...(description ? { description } : {}),
    ...(konaId ? { extendedProperties: { private: { kona_id: konaId } } } : {})
  };
  const data = await googleRequest(accessToken, `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST',
    body
  });
  return { id: data.id, htmlLink: data.htmlLink || null };
}

// Cerca un evento Google per il kona_id privato (idempotenza).
async function findEventByKonaId(accessToken, { calendarId = CALENDAR_ID, konaId, timeMin, timeMax }) {
  if (!konaId) return null;
  const params = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', maxResults: '10' });
  const data = await googleRequest(accessToken, `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`);
  for (const item of data.items || []) {
    if (item?.extendedProperties?.private?.kona_id === konaId) return item;
  }
  return null;
}

// Aggiorna data/ora di un evento esistente.
async function updateEventTime(accessToken, { calendarId = CALENDAR_ID, eventId, start, end }) {
  await googleRequest(accessToken, `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'PATCH',
    body: { start: { dateTime: start, timeZone: 'Europe/Rome' }, end: { dateTime: end, timeZone: 'Europe/Rome' } }
  });
  return true;
}

async function deleteEvent(accessToken, { calendarId = CALENDAR_ID, eventId }) {
  await googleRequest(accessToken, `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE'
  });
  return true;
}

// Candidati slot: giorni lavorativi entro l'orizzonte, partenze ogni 15 min,
// durata configurata, vincolo su conflitti (busy Google + appuntamenti Mirox)
// con buffer prima/dopo. Il chiamante aggiunge trasferta/raggruppamento zona.
function computeSlots({
  cfg,
  dataInizio = todayRomeStr(),
  giorni,
  busyIntervals = [],
  appuntamentiConflitto = [],
  bufferMinuti = null
}) {
  const durata = Number(cfg.durata_appuntamento_minuti) || 45;
  const buffer = Number.isInteger(bufferMinuti) ? bufferMinuti : (Number(cfg.buffer_appuntamento_minuti) || 15);
  const orizzonte = Number(giorni) || Number(cfg.giorni_orizzonte_calendario) || 14;
  const inizioMin = parseHHmm(cfg.orario_calendario_inizio) ?? (8 * 60 + 30);
  const fineMin = parseHHmm(cfg.orario_calendario_fine) ?? (19 * 60);
  const step = 15;
  const slots = [];

  const busy = busyIntervals
    .filter((b) => b && b.start && b.end)
    .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
  const conflicts = appuntamentiConflitto
    .filter((a) => a && a.data_ora && a.data_ora_fine)
    .map((a) => ({ start: new Date(a.data_ora), end: new Date(a.data_ora_fine) }));

  const overlaps = (span) => {
    for (const item of busy) {
      if (span.start < item.end && item.start < span.end) return true;
    }
    for (const item of conflicts) {
      if (span.start < item.end && item.start < span.end) return true;
    }
    return false;
  };

  const now = Date.now();
  for (let i = 0; i < orizzonte; i += 1) {
    const giorno = addDaysStr(dataInizio, i);
    if (!isWorkingDay(giorno, cfg.giorni_lavorativi || [1, 2, 3, 4, 5])) continue;
    for (let minute = inizioMin; minute + durata <= fineMin; minute += step) {
      const start = romeToUtc(giorno, `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`);
      const end = new Date(start.getTime() + durata * 60000);
      if (start.getTime() <= now) continue; // niente slot passati
      const span = { start: new Date(start.getTime() - buffer * 60000), end: new Date(end.getTime() + buffer * 60000) };
      if (overlaps(span)) continue;
      slots.push({ giorno, start, end });
    }
  }
  return slots;
}

// Ri-verifica finale dello slot PRIMA della conferma: free/busy Google
// (obbligatorio: errori => non disponibile) + conflitti Mirox con BUFFER.
// La serializzazione atomica (lock + INSERT) e' fatta dalla RPC
// kona_cd_prenota_slot_v1: qui si controllano busy e conflitti con il buffer.
async function verifySlotAvailability({ supabase, cfg, start, end, accessToken, calendarId = CALENDAR_ID, appuntamentiConflitto = [] }) {
  const buffer = Number(cfg.buffer_appuntamento_minuti) || 15;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const spanStart = new Date(startMs - buffer * 60000).toISOString();
  const spanEnd = new Date(endMs + buffer * 60000).toISOString();

  if (!accessToken) return { ok: false, reason: 'no_token' };
  let busy = [];
  try {
    busy = await freeBusy(accessToken, { calendarId, timeMin: spanStart, timeMax: spanEnd });
  } catch {
    return { ok: false, reason: 'google_unavailable' }; // fail-closed
  }
  for (const b of busy) {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (startMs < be && bs < endMs) return { ok: false, reason: 'busy' };
  }
  for (const a of appuntamentiConflitto) {
    const as = new Date(a.data_ora).getTime();
    const ae = new Date(a.data_ora_fine).getTime();
    if (startMs < ae && as < endMs) return { ok: false, reason: 'conflitto_mirox' };
  }
  return { ok: true };
}

module.exports = {
  CALENDAR_ID,
  SCOPES,
  buildAuthUrl,
  computeSlots,
  deleteEvent,
  exchangeCode,
  findEventByKonaId,
  freeBusy,
  getAccessToken,
  getRefreshToken,
  googleRequest,
  hasToken,
  insertEvent,
  listEvents,
  oauthConfig,
  storeToken,
  tokenRequest,
  updateEventTime,
  verifySlotAvailability,
  _test: { computeSlots }
};
