'use strict';

const { requireAuth } = require('./require-auth');
const { isUuid, parseJson } = require('./kona-cd-util');

// Interruttore di sicurezza a livello env (kill-switch indipendente dal DB).
// Fail closed: KONA parte solo con valore esplicito "true"; variabile assente,
// vuota o diversa da true significa spento, qualunque sia la config DB.
function envHardEnabled() {
  const value = String(process.env.KONA_CALL_DIRECTOR_ENABLED || '').trim().toLowerCase();
  return value === 'true';
}

const CONFIG_DEFAULTS = {
  attivo_globale: false,
  modalita_osservazione: true,
  budget_mensile_eur: 50,
  riserva_arricchimento_eur: 40,
  riserva_dialogo_eur: 10,
  modello_openai: 'gpt-5.6-luna',
  // Prezzi ufficiali OpenAI al 2026-08-27: GPT-5.6 Luna input $0.20/M,
  // output $1.20/M, web search reasoning $10.00/1000 chiamate. Verificabili
  // da admin in kona_call_director_config.prezzi_openai.
  prezzi_openai: { 'gpt-5.6-luna': { input: 0.20, output: 1.20, web_search: 0.01 } },
  // Fattore conservativo per convertire i prezzi OpenAI in USD nel budget EUR.
  usd_to_eur: 1,
  soglie_budget: [70, 85, 95, 100],
  max_chiamate_openai_ora: 120,
  giorni_lavorativi: [1, 2, 3, 4, 5],
  ferie: [],
  orario_mattina: { inizio: '09:00', fine: '12:30' },
  orario_pomeriggio: { inizio: '15:30', fine: '19:00' },
  orario_stop_business: '18:00',
  durata_sessione_business_minuti: 90,
  durata_appuntamento_minuti: 45,
  distanza_km_indicativa: 20,
  richieste_web_max_per_lead: 2,
  lead_notte_obiettivo: 50,
  soglia_lead_minime: 50,
  soglia_affidabilita_arricchimento: 0.6,
  orario_inizio_arricchimento: '02:00',
  orario_report_sera: '19:10',
  orario_reminder_sera: '20:00',
  orario_reminder_mattina: '08:00',
  orario_piano_default: '08:30',
  conferme_ore: ['09:00', '11:30', '15:30', '18:00'],
  calendario_google_id: null,
  giorni_orizzonte_calendario: 14,
  orario_calendario_inizio: '08:30',
  orario_calendario_fine: '19:00',
  localita_riferimento: 'Legnago',
  localita_partenza: 'Casaleone',
  tempi_trasferta_minuti: 15,
  buffer_appuntamento_minuti: 15,
  tentativi_massimi: 3,
  retention_arricchimenti_giorni: 180,
  retention_attivita_giorni: 365,
  retention_aggregati_giorni: 730,
  notifiche_immediate: {
    appuntamento_annullato: true,
    quattro_non_risposti: true,
    calendario_non_disponibile: true,
    sync_fallito: true,
    lead_sotto_soglia: true,
    attivita_fuori_standard: true,
    budget: true
  }
};

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Carica (e normalizza) la config globale. Non lancia se la tabella manca:
// torna i default. In staging la tabella puo' non essere ancora migrata.
async function getConfig(supabase) {
  let row = null;
  if (supabase) {
    const { data, error } = await supabase
      .from('kona_call_director_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle();
    if (!error && data) row = data;
  }
  const cfg = { ...CONFIG_DEFAULTS };
  if (row) {
    cfg.attivo_globale = row.attivo_globale !== false;
    cfg.modalita_osservazione = row.modalita_osservazione !== false;
    cfg.budget_mensile_eur = num(row.budget_mensile_eur, cfg.budget_mensile_eur);
    cfg.riserva_arricchimento_eur = num(row.riserva_arricchimento_eur, cfg.riserva_arricchimento_eur);
    cfg.riserva_dialogo_eur = num(row.riserva_dialogo_eur, cfg.riserva_dialogo_eur);
    cfg.modello_openai = String(row.modello_openai || cfg.modello_openai);
    cfg.prezzi_openai = parseJson(row.prezzi_openai, cfg.prezzi_openai) || {};
    cfg.usd_to_eur = num(row.usd_to_eur, cfg.usd_to_eur);
    cfg.soglie_budget = Array.isArray(row.soglie_budget) ? row.soglie_budget : cfg.soglie_budget;
    cfg.max_chiamate_openai_ora = num(row.max_chiamate_openai_ora, cfg.max_chiamate_openai_ora);
    cfg.giorni_lavorativi = Array.isArray(row.giorni_lavorativi) ? row.giorni_lavorativi : cfg.giorni_lavorativi;
    cfg.ferie = Array.isArray(row.ferie) ? row.ferie : cfg.ferie;
    cfg.orario_mattina = parseJson(row.orario_mattina, cfg.orario_mattina) || cfg.orario_mattina;
    cfg.orario_pomeriggio = parseJson(row.orario_pomeriggio, cfg.orario_pomeriggio) || cfg.orario_pomeriggio;
    cfg.orario_stop_business = String(row.orario_stop_business || cfg.orario_stop_business);
    cfg.durata_sessione_business_minuti = num(row.durata_sessione_business_minuti, cfg.durata_sessione_business_minuti);
    cfg.durata_appuntamento_minuti = num(row.durata_appuntamento_minuti, cfg.durata_appuntamento_minuti);
    cfg.distanza_km_indicativa = num(row.distanza_km_indicativa, cfg.distanza_km_indicativa);
    cfg.richieste_web_max_per_lead = num(row.richieste_web_max_per_lead, cfg.richieste_web_max_per_lead);
    cfg.lead_notte_obiettivo = num(row.lead_notte_obiettivo, cfg.lead_notte_obiettivo);
    cfg.soglia_lead_minime = num(row.soglia_lead_minime, cfg.soglia_lead_minime);
    cfg.soglia_affidabilita_arricchimento = num(row.soglia_affidabilita_arricchimento, cfg.soglia_affidabilita_arricchimento);
    cfg.orario_inizio_arricchimento = String(row.orario_inizio_arricchimento || cfg.orario_inizio_arricchimento);
    cfg.orario_report_sera = String(row.orario_report_sera || cfg.orario_report_sera);
    cfg.orario_reminder_sera = String(row.orario_reminder_sera || cfg.orario_reminder_sera);
    cfg.orario_reminder_mattina = String(row.orario_reminder_mattina || cfg.orario_reminder_mattina);
    cfg.orario_piano_default = String(row.orario_piano_default || cfg.orario_piano_default);
    cfg.conferme_ore = Array.isArray(row.conferme_ore) ? row.conferme_ore : cfg.conferme_ore;
    cfg.calendario_google_id = row.calendario_google_id || null;
    cfg.giorni_orizzonte_calendario = num(row.giorni_orizzonte_calendario, cfg.giorni_orizzonte_calendario);
    cfg.orario_calendario_inizio = String(row.orario_calendario_inizio || cfg.orario_calendario_inizio);
    cfg.orario_calendario_fine = String(row.orario_calendario_fine || cfg.orario_calendario_fine);
    cfg.localita_riferimento = String(row.localita_riferimento || cfg.localita_riferimento);
    cfg.localita_partenza = String(row.localita_partenza || cfg.localita_partenza);
    cfg.tempi_trasferta_minuti = num(row.tempi_trasferta_minuti, cfg.tempi_trasferta_minuti);
    cfg.buffer_appuntamento_minuti = num(row.buffer_appuntamento_minuti, cfg.buffer_appuntamento_minuti);
    cfg.tentativi_massimi = num(row.tentativi_massimi, cfg.tentativi_massimi);
    cfg.retention_arricchimenti_giorni = num(row.retention_arricchimenti_giorni, cfg.retention_arricchimenti_giorni);
    cfg.retention_attivita_giorni = num(row.retention_attivita_giorni, cfg.retention_attivita_giorni);
    cfg.retention_aggregati_giorni = num(row.retention_aggregati_giorni, cfg.retention_aggregati_giorni);
    cfg.notifiche_immediate = parseJson(row.notifiche_immediate, cfg.notifiche_immediate) || cfg.notifiche_immediate;
  }
  const envModel = String(process.env.KONA_CALL_DIRECTOR_OPENAI_MODEL || '').trim();
  if (envModel) cfg.modello_openai = envModel;
  return cfg;
}

// Abilitazione per profilo (nessun UUID hardcodato).
async function profileRow(supabase, profiloId) {
  if (!isUuid(profiloId)) return null;
  const { data, error } = await supabase
    .from('kona_call_director_profili')
    .select('*')
    .eq('profilo_id', profiloId)
    .maybeSingle();
  if (error) return null;
  return data;
}

// L'operatore puo' usare KONA? Richiede: kill-switch env, attivo_globale,
// profilo attivo e abilitato per KONA.
async function canUse(supabase, profilo, user) {
  if (!envHardEnabled()) return { ok: false, reason: 'enabled_env_off' };
  const cfg = await getConfig(supabase);
  if (!cfg.attivo_globale) return { ok: false, reason: 'global_off' };
  if (!profilo || profilo.attivo === false) return { ok: false, reason: 'profilo_inattivo' };
  const profiloId = String(profilo.alias_di || profilo.id || user?.id || '').toLowerCase();
  if (!isUuid(profiloId)) return { ok: false, reason: 'profilo_mancante' };
  const row = await profileRow(supabase, profiloId);
  if (!row || row.abilitato !== true) return { ok: false, reason: 'profilo_off' };
  return { ok: true, cfg, profiloId, row };
}

// Guard combinato per le functions autenticate: requireAuth + canUse + adminOnly.
// Ritorna { ok:true, auth, cfg, profiloId, row } oppure una response pronta.
async function authAndEnabled(event, { supabase, adminOnly = false, response }) {
  const auth = await requireAuth(event, { adminOnly });
  if (!auth.ok) return { response: response(auth.status, { ok: false, error: auth.error }) };
  const check = await canUse(supabase, auth.profilo, auth.user);
  if (!check.ok) {
    const message = check.reason === 'adminOnly'
      ? 'Accesso riservato agli amministratori.'
      : check.reason === 'global_off' || check.reason === 'enabled_env_off'
        ? 'KONA Call Director e\' disattivato.'
        : 'Il tuo profilo non e\' abilitato a KONA Call Director.';
    return { response: response(403, { ok: false, error: message, reason: check.reason }) };
  }
  return { ok: true, auth, cfg: check.cfg, profiloId: check.profiloId, row: check.row };
}

module.exports = {
  CONFIG_DEFAULTS,
  authAndEnabled,
  canUse,
  envHardEnabled,
  getConfig,
  profileRow
};
