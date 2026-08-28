/**
 * KONA Call Director — Google Calendar (POST, auth).
 *
 * Azioni:
 *   connetti          -> admin: URL OAuth Google (state firmato HMAC, no storage)
 *   stato_connessione -> token presente? ultimo sync?
 *   disconnetti       -> admin: rimuove il token cifrato
 *
 * Il token non esce mai dal server. Il browser riceve solo gli slot
 * pre-calcolati da /kona-call-director-dialog (cerca_slot).
 */

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { requireAuth } = require('./_lib/require-auth');
const { buildAuthUrl, hasToken, oauthConfig } = require('./_lib/kona-cd-google');
const { isUuid, jsonError, jsonOk, readJsonBody } = require('./_lib/kona-cd-util');

// State OAuth: pid + nonce + exp, firmato HMAC (nonce/expiry/single-use).
const STATE_TTL_MS = 10 * 60 * 1000;

function signState(profiloId) {
  const secret = String(process.env.KONA_CALL_DIRECTOR_GOOGLE_CLIENT_SECRET || '');
  const pid = String(profiloId).toLowerCase();
  const nonce = crypto.randomBytes(12).toString('hex');
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${pid}.${nonce}.${exp}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
  return `${payload}.${sig}`;
}

// Verifica firma + scadenza. Ritorna { pid, nonce } oppure null.
function verifyState(state) {
  const parts = String(state || '').split('.');
  if (parts.length !== 4) return null;
  const [pid, nonce, exp, sig] = parts;
  if (!isUuid(pid) || !nonce || !/^\d+$/.test(exp)) return null;
  if (Number(exp) < Date.now()) return null; // scaduto
  const payload = `${pid}.${nonce}.${exp}`;
  const secret = String(process.env.KONA_CALL_DIRECTOR_GOOGLE_CLIENT_SECRET || '');
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 24);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? { pid, nonce } : null;
}

// Single-use: registra il nonce; se gia' usato ritorna false.
async function consumaState(client, nonce, profiloId) {
  const { data, error } = await client.rpc('kona_cd_consume_oauth_state_v1', {
    p_nonce: nonce, p_profilo_id: profiloId
  });
  return !error && data === true;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonError(405, 'Metodo non consentito');

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const auth = await requireAuth(event);
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const profiloId = String(auth.profilo.alias_di || auth.profilo.id || auth.user.id || '').toLowerCase();

  const body = await readJsonBody(event);
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'connetti': {
        if (auth.profilo.ruolo !== 'admin') return jsonError(403, 'Accesso riservato agli amministratori.');
        const conf = oauthConfig();
        if (!conf.isConfigured) return jsonError(409, 'Google OAuth non configurato (env)');
        const state = signState(profiloId);
        const [, nonce, exp] = state.split('.');
        const { error: stateError } = await client.from('kona_call_director_oauth_stati').insert({
          nonce,
          profilo_id: profiloId,
          expires_at: new Date(Number(exp)).toISOString()
        });
        if (stateError) return jsonError(500, 'Impossibile iniziare la connessione OAuth');
        const urlAuth = buildAuthUrl({ state });
        return jsonOk({ auth_url: urlAuth });
      }

      case 'stato_connessione': {
        const { data: token } = await client.from('kona_call_director_google_token').select('id, collegato_at, collegato_da, ultimo_sync_at, ultimo_sync_esito, scopes').eq('id', 1).maybeSingle();
        return jsonOk({
          collegato: Boolean(token),
          collegato_at: token?.collegato_at || null,
          ultimo_sync_at: token?.ultimo_sync_at || null,
          ultimo_sync_esito: token?.ultimo_sync_esito || null
        });
      }

      case 'disconnetti': {
        if (auth.profilo.ruolo !== 'admin') return jsonError(403, 'Accesso riservato agli amministratori.');
        const { error } = await client.from('kona_call_director_google_token').delete().eq('id', 1);
        if (error) return jsonError(500, error.message);
        return jsonOk({ disconnesso: true });
      }

      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};

exports.consumaState = consumaState;
exports.signState = signState;
exports.verifyState = verifyState;
exports._test = { signState, verifyState };
