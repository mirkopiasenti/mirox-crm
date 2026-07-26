/**
 * Endpoint pubblico per il form `prenota.html` (prenotazioni dal sito/social).
 *
 * Sostituisce le chiamate dirette da anon a Supabase, in modo che dopo la
 * Fase C dell'hardening le tabelle CC-shared (appuntamenti, slot_bloccati,
 * blocchi, orari_standard, impostazioni) possano essere chiuse a {anon}.
 *
 * GET  /.netlify/functions/public-prenota?action=slots&data=YYYY-MM-DD
 *      -> { ok: true, slots: ['2026-06-25T09:00:00+02:00', ...] }
 *
 * POST /.netlify/functions/public-prenota
 *      body: { nome, telefono, motivo, note?, data_ora }
 *      -> { ok: true, id }
 *
 * NON richiede auth (e' pubblico). Per limitare abuse:
 *   - Validazione campi server-side (formato date, lunghezze, motivi ammessi)
 *   - Rate limiting persistente su Postgres, per fingerprint SHA256 dell'IP
 *   - Prenotazione atomica via RPC con lock sullo slot e re-check nello stesso
 *     commit, per impedire due prenotazioni pubbliche concorrenti
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
};

const MAX_NOME = 100;
const MAX_TEL = 32;
const MAX_NOTE = 500;
const RATE_WINDOW_SECONDS = 10 * 60;
const RATE_GET_MAX = 60;
const RATE_POST_MAX = 6;

const MOTIVI_AMMESSI = new Set([
    'Telefono CB', 'Fisso', 'P.iva', 'Energy', 'Duferco', 'Altro',
    'Info linea fissa', 'Info linea mobile', 'Info offerta', 'Info costi',
    'Reclamo', 'Disdetta', 'Cambio operatore', 'Assistenza tecnica',
    'Pagamento', 'Documenti',
    'Contratti Aziendali', 'Telefonia Mobile', 'Internet Casa', 'Luce&Gas',
    'Allarmi', 'Assicurazioni'
]);

function reply(statusCode, payload, extraHeaders = {}) {
    return {
        statusCode,
        headers: { ...CORS_HEADERS, ...extraHeaders },
        body: JSON.stringify(payload)
    };
}

function getClientIp(event) {
    const h = event.headers || {};
    const fwd = h['x-forwarded-for'] || h['X-Forwarded-For'] || '';
    if (fwd) return String(fwd).split(',')[0].trim();
    return String(h['x-real-ip'] || h['client-ip'] || 'unknown').trim();
}

async function checkRateLimit(db, event) {
    const method = event.httpMethod === 'POST' ? 'POST' : 'GET';
    const fingerprint = crypto
        .createHash('sha256')
        .update(getClientIp(event))
        .digest('hex');
    const { data, error } = await db.rpc('mirox_public_rate_limit_v1', {
        p_scope: `public-prenota:${method.toLowerCase()}`,
        p_fingerprint_hash: fingerprint,
        p_window_seconds: RATE_WINDOW_SECONDS,
        p_limit: method === 'POST' ? RATE_POST_MAX : RATE_GET_MAX
    });
    if (error) throw error;
    return {
        allowed: data?.allowed === true,
        retryAfter: Math.max(1, Number(data?.retry_after_seconds) || RATE_WINDOW_SECONDS)
    };
}

function rateLimitError(result) {
    if (result.allowed) return null;
    return reply(
        429,
        { ok: false, error: 'Troppe richieste, riprova fra qualche minuto' },
        { 'Retry-After': String(result.retryAfter) }
    );
}

function isAllowedMotivo(motivo) {
    return MOTIVI_AMMESSI.has(motivo);
}

function isSafePublicDateTime(value) {
    if (typeof value !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
        return false;
    }
    return !Number.isNaN(new Date(value).getTime());
}

function getClient() {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
    return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

function cleanString(value, maxLen) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!s) return null;
    return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function isIsoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function handleGetSlots(event, db) {
    const params = event.queryStringParameters || {};
    const data = params.data;
    if (!isIsoDate(data)) return reply(400, { ok: false, error: 'Parametro data non valido (atteso YYYY-MM-DD)' });
    try {
        const { data: slots, error } = await db.rpc('get_slot_disponibili', { p_data: data });
        if (error) return reply(500, { ok: false, error: error.message });
        return reply(200, { ok: true, slots: slots || [] });
    } catch (e) {
        return reply(500, { ok: false, error: e?.message || 'Errore caricamento slot' });
    }
}

async function handlePost(event, db) {
    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch (e) { return reply(400, { ok: false, error: 'Body JSON non valido' }); }

    const nome = cleanString(body.nome, MAX_NOME);
    const telefono = cleanString(body.telefono, MAX_TEL);
    const motivo = cleanString(body.motivo, 64);
    const note = cleanString(body.note, MAX_NOTE);
    const dataOra = body.data_ora;

    if (!nome) return reply(400, { ok: false, error: 'Nome obbligatorio' });
    if (!telefono || telefono.replace(/\D/g, '').length < 6) return reply(400, { ok: false, error: 'Telefono non valido' });
    if (!motivo) return reply(400, { ok: false, error: 'Motivo obbligatorio' });
    if (!isSafePublicDateTime(dataOra)) return reply(400, { ok: false, error: 'Slot data/ora non valido' });

    if (!isAllowedMotivo(motivo)) {
        return reply(400, { ok: false, error: 'Motivo non valido' });
    }

    try {
        const { data, error } = await db.rpc('public_prenota_appuntamento_v1', {
            p_nome: nome,
            p_telefono: telefono,
            p_motivo: motivo,
            p_note: note || null,
            p_data_ora: dataOra
        });
        if (error) {
            if (/slot_non_disponibile/i.test(error.message || '')) {
                return reply(409, { ok: false, error: 'Slot non più disponibile, scegline un altro' });
            }
            console.error('public-prenota RPC error:', error.code || 'unknown');
            return reply(500, { ok: false, error: 'Errore durante la creazione dell’appuntamento' });
        }
        if (!data) {
            return reply(409, { ok: false, error: 'Slot non piu\' disponibile, scegline un altro' });
        }
        return reply(200, { ok: true, id: data });
    } catch (e) {
        console.error('public-prenota unexpected error:', e?.message || e);
        return reply(500, { ok: false, error: 'Errore durante la creazione dell’appuntamento' });
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS_HEADERS, body: '' };

    const db = getClient();
    if (!db) return reply(500, { ok: false, error: 'Configurazione server incompleta' });

    try {
        const limited = rateLimitError(await checkRateLimit(db, event));
        if (limited) return limited;
    } catch (error) {
        console.error('public-prenota rate limit error:', error?.code || error?.message || 'unknown');
        return reply(503, { ok: false, error: 'Servizio temporaneamente non disponibile' });
    }

    if (event.httpMethod === 'GET') {
        const action = (event.queryStringParameters || {}).action || 'slots';
        if (action === 'slots') return handleGetSlots(event, db);
        return reply(400, { ok: false, error: 'Azione GET non supportata' });
    }

    if (event.httpMethod === 'POST') {
        return handlePost(event, db);
    }

    return reply(405, { ok: false, error: 'Metodo non consentito' });
};

exports._test = {
    cleanString,
    getClientIp,
    isAllowedMotivo,
    isIsoDate,
    isSafePublicDateTime
};
