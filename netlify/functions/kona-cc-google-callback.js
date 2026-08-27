/**
 * Callback OAuth Google per KONA Call Director (GET, pubblico).
 *
 * Non richiede auth: e' il redirect del consenso Google. Verifica lo state
 * firmato HMAC con NONCE + SCADENZA (single-use), scambia il code, cifra il
 * refresh token (chiave env separata) e salva il record server-only. Infine
 * redirige all'admin page. Nessun segreto nella response e nessun input non
 * escapato nell'HTML (anti-XSS).
 */

const { createClient } = require('@supabase/supabase-js');

const { exchangeCode, storeToken } = require('./_lib/kona-cd-google');
const { verifyState, consumaState } = require('./kona-call-director-google');
const { cleanLog } = require('./_lib/kona-cd-util');

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function html(message, ok = true) {
  const title = ok ? 'Collegamento Google completato' : 'Collegamento Google non riuscito';
  return {
    statusCode: ok ? 200 : 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:640px;margin:0 auto"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a href="/admin-kona-call-director.html">Torna al pannello KONA Call Director</a></p></body></html>`
  };
}

function redirect(location) {
  return { statusCode: 302, headers: { Location: location, 'Content-Type': 'text/plain; charset=utf-8' }, body: '' };
}

exports.handler = async (event) => {
  const url = new URL(event.rawUrl || `https://localhost${event.path}`);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';

  if (error) return html(`Google ha rifiutato la connessione (${error}).`, false);
  if (!code) return html('Codice di autorizzazione mancante.', false);

  const verificato = verifyState(state);
  if (!verificato) return html('Stato OAuth non valido o scaduto: richiedi una nuova connessione dal pannello admin.', false);

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return html('Configurazione Supabase mancante.', false);
  const client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Single-use: se il nonce e' gia' stato consumato, rifiuta.
  if (!(await consumaState(client, verificato.nonce))) {
    return html('Richiesta gia' + ' elaborata: richiedi una nuova connessione.', false);
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) return html('Google non ha restituito un refresh token. Rivolgersi alla connessione di un account con accesso offline.', false);

    const salvato = await storeToken(client, { refreshToken: tokens.refresh_token, collegatoDa: verificato.pid });
    if (!salvato) return html('Salvataggio del token non riuscito.', false);

    await client.from('kona_call_director_google_token').update({
      ultimo_sync_at: new Date().toISOString(),
      ultimo_sync_esito: 'ok'
    }).eq('id', 1);

    return redirect('/admin-kona-call-director.html?google=connesso');
  } catch (e) {
    return html(cleanLog(`Errore nello scambio del codice: ${e?.message || 'errore'}`, 300), false);
  }
};
