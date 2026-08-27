/**
 * KONA Call Director — stato per l'operatore (GET, auth).
 *
 * Ritorna l'abilitazione del profilo, la modalita' osservazione, il budget del
 * mese e un riepilogo della giornata. Nessun dato personale: e' un endpoint di
 * stato, il dettaglio contatto arriva da /kona-call-director-task (attivo).
 */

const { canUse, getConfig } = require('./_lib/kona-cd-config');
const { budgetSnapshot } = require('./_lib/kona-cd-budget');
const { requireAuth } = require('./_lib/require-auth');
const { reportGiornaliero } = require('./_lib/kona-cd-report');
const { monthRomeKey, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, jsonError, jsonOk } = require('./_lib/kona-cd-util');
const { createClient } = require('@supabase/supabase-js');

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

  try {
    const check = await canUse(client, auth.profilo, auth.user);
    if (!check.ok) return jsonOk({ abilitato: false, motivo: check.reason });

    const cfg = check.cfg;
    const data = todayRomeStr();
    const [budget, report, sessione] = await Promise.all([
      budgetSnapshot(client, cfg, monthRomeKey(data)),
      reportGiornaliero(client, cfg, { data }),
      client.from('kona_call_director_sessioni').select('categoria, tipo').eq('data', data).eq('operatore_id', profiloId).eq('stato', 'attiva').limit(1).maybeSingle()
    ]);

    return jsonOk({
      abilitato: true,
      modalita_osservazione: cfg.modalita_osservazione !== false,
      data,
      consumer_modalita: sessione?.data?.categoria || null,
      budget: {
        mese: budget.mese,
        budget: budget.budget,
        speso: budget.speso,
        riservato: budget.riservato,
        rimasto: budget.rimasto,
        percentuale: budget.percentuale,
        per_attivita: cleanLog(budget.per_attivita),
        web_ricerche: budget.web_ricerche
      },
      oggi: {
        task_totali: report.task.totali,
        conferme_totali: report.conferme.totali,
        appuntamenti: report.appuntamenti_business.totali
      },
      config: {
        tentativi_massimi: cfg.tentativi_massimi,
        orario_mattina: cfg.orario_mattina,
        orario_pomeriggio: cfg.orario_pomeriggio,
        conferme_ore: cfg.conferme_ore,
        durata_appuntamento_minuti: cfg.durata_appuntamento_minuti,
        distanza_km_indicativa: cfg.distanza_km_indicativa
      }
    });
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};
