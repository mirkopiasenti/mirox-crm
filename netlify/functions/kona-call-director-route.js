/**
 * KONA Call Director — routing per profilo (GET, auth, leggero).
 *
 * Decide quale interfaccia mostrare, SENZA budget/briefing:
 *   kona_only = KONA globalmente attivo + profilo abilitato + NON admin.
 *   admin     = ruolo admin (mantiene il manuale + controllo KONA).
 *
 * Usato da js/cc-header.js e dal guard di redirect delle pagine manuali.
 * Il controllo non e' cosmetico: ruolo e abilitazione sono verificati server-side.
 */

const { createClient } = require('@supabase/supabase-js');
const { canUse } = require('./_lib/kona-cd-config');
const { requireAuth } = require('./_lib/require-auth');
const { jsonError, jsonOk } = require('./_lib/kona-cd-util');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'GET') return jsonError(405, 'Metodo non consentito');

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const auth = await requireAuth(event);
  if (!auth.ok) return jsonError(auth.status, auth.error);

  const isAdmin = auth.profilo?.ruolo === 'admin';
  const check = await canUse(client, auth.profilo, auth.user);
  let manualFallback = false;
  let fallbackScadeAt = null;
  if (check.ok) {
    const { data: failover } = await client.from('kona_call_director_failover')
      .select('scade_at,risolto_at').eq('profilo_id', check.profiloId).maybeSingle();
    manualFallback = Boolean(failover && !failover.risolto_at && Date.parse(failover.scade_at) > Date.now());
    fallbackScadeAt = manualFallback ? failover.scade_at : null;
  }
  const routing = decideRoute({ isAdmin, canUseOk: Boolean(check.ok), manualFallback });

  return jsonOk({
    kona_only: routing.kona_only,
    admin: routing.admin,
    abilitato: routing.abilitato,
    manual_fallback: routing.manual_fallback,
    fallback_scade_at: fallbackScadeAt,
    motivo: check.ok ? null : check.reason
  });
};

// Decisione di routing pura: KONA-only solo per operatrici abilitate NON admin.
function decideRoute({ isAdmin, canUseOk, manualFallback = false }) {
  return {
    kona_only: Boolean(canUseOk) && !Boolean(isAdmin) && !Boolean(manualFallback),
    admin: Boolean(isAdmin),
    abilitato: Boolean(canUseOk),
    manual_fallback: Boolean(manualFallback)
  };
}

module.exports._test = { decideRoute };
