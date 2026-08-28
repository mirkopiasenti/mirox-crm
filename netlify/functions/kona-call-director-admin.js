/**
 * KONA Call Director — amministrazione (POST, admin-only).
 *
 * Azioni:
 *   stato               -> panoramica globale (interruttori, budget, operatori)
 *   toggle_globale      -> { attivo } interruttore globale di sicurezza
 *   modalita_osservazione -> { attivo } prime due settimane senza giudizi
 *   elenco_profili      -> operatori con stato abilitazione KONA
 *   abilita_profilo     -> { profilo_id, abilitato, in_osservazione }
 *   config              -> GET (stato) o SAVE (patch su campi allowlist)
 *   budget              -> snapshot budget del mese
 *   sospensione         -> sospensione immediata: globale off + task attivi in sospeso
 *
 * Nessun UUID hardcodato: gli operatori sono identificati da profilo_id validato.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');
const { getConfig } = require('./_lib/kona-cd-config');
const { budgetSnapshot } = require('./_lib/kona-cd-budget');
const { monthRomeKey, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, isUuid, jsonError, jsonOk, parseBoolean, parseJson, parseNumber, readJsonBody } = require('./_lib/kona-cd-util');

// Campi di config modificabili da admin (allowlist, niente campi arbitrari).
const CONFIG_EDITABILI = {
  attivo_globale: 'bool',
  modalita_osservazione: 'bool',
  budget_mensile_eur: 'num',
  usd_to_eur: 'num',
  riserva_arricchimento_eur: 'num',
  riserva_dialogo_eur: 'num',
  modello_openai: 'str',
  prezzi_openai: 'json',
  soglie_budget: 'json',
  giorni_lavorativi: 'json',
  orario_mattina: 'json',
  orario_pomeriggio: 'json',
  durata_appuntamento_minuti: 'num',
  distanza_km_indicativa: 'num',
  richieste_web_max_per_lead: 'num',
  lead_notte_obiettivo: 'num',
  soglia_lead_minime: 'num',
  orario_inizio_arricchimento: 'str',
  orario_report_sera: 'str',
  orario_reminder_sera: 'str',
  orario_reminder_mattina: 'str',
  orario_piano_default: 'str',
  conferme_ore: 'json',
  calendario_google_id: 'str',
  giorni_orizzonte_calendario: 'num',
  orario_calendario_inizio: 'str',
  orario_calendario_fine: 'str',
  localita_riferimento: 'str',
  localita_partenza: 'str',
  tempi_trasferta_minuti: 'num',
  buffer_appuntamento_minuti: 'num',
  tentativi_massimi: 'num',
  retention_arricchimenti_giorni: 'num',
  retention_attivita_giorni: 'num',
  retention_aggregati_giorni: 'num',
  notifiche_immediate: 'json',
  soglia_affidabilita_arricchimento: 'num',
  max_chiamate_openai_ora: 'num',
  orario_stop_business: 'str',
  durata_sessione_business_minuti: 'num',
  ferie: 'json'
};


function orarioValido(value) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  return Boolean(m && Number(m[1]) <= 23 && Number(m[2]) <= 59);
}

function dataIsoValida(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text;
}

function validaConfigPatch(cfg) {
  const nonNegative = [
    'budget_mensile_eur', 'riserva_arricchimento_eur', 'riserva_dialogo_eur',
    'lead_notte_obiettivo', 'soglia_lead_minime', 'distanza_km_indicativa'
  ];
  if (nonNegative.some((k) => !Number.isFinite(Number(cfg[k])) || Number(cfg[k]) < 0)) {
    return 'Valore numerico negativo o non valido nella configurazione';
  }
  if (Number(cfg.riserva_arricchimento_eur) + Number(cfg.riserva_dialogo_eur) > Number(cfg.budget_mensile_eur)) {
    return 'La somma delle riserve non puo superare il budget mensile';
  }
  if (!Number.isFinite(Number(cfg.usd_to_eur)) || Number(cfg.usd_to_eur) <= 0) return 'usd_to_eur deve essere maggiore di zero';
  if (Number(cfg.richieste_web_max_per_lead) < 0 || Number(cfg.richieste_web_max_per_lead) > 10) return 'richieste_web_max_per_lead deve essere tra 0 e 10';
  if (Number(cfg.soglia_affidabilita_arricchimento) < 0 || Number(cfg.soglia_affidabilita_arricchimento) > 1) return 'soglia_affidabilita_arricchimento deve essere tra 0 e 1';
  if (Number(cfg.durata_sessione_business_minuti) < 15 || Number(cfg.durata_sessione_business_minuti) > 240) return 'durata_sessione_business_minuti deve essere tra 15 e 240';
  const campiOrario = ['orario_stop_business', 'orario_inizio_arricchimento', 'orario_report_sera', 'orario_reminder_sera', 'orario_reminder_mattina', 'orario_piano_default', 'orario_calendario_inizio', 'orario_calendario_fine'];
  if (campiOrario.some((k) => !orarioValido(cfg[k]))) return 'Uno o piu orari non sono validi (formato HH:MM)';
  if (!Array.isArray(cfg.giorni_lavorativi) || cfg.giorni_lavorativi.length === 0 || new Set(cfg.giorni_lavorativi.map(Number)).size !== cfg.giorni_lavorativi.length || cfg.giorni_lavorativi.some((g) => !Number.isInteger(Number(g)) || Number(g) < 0 || Number(g) > 6)) return 'giorni_lavorativi non valido';
  if (!Array.isArray(cfg.soglie_budget) || cfg.soglie_budget.length === 0 || cfg.soglie_budget.some((s) => !Number.isFinite(Number(s)) || Number(s) < 0 || Number(s) > 100) || cfg.soglie_budget.some((s, i) => i > 0 && Number(s) <= Number(cfg.soglie_budget[i - 1]))) return 'soglie_budget non valido';
  if (!Array.isArray(cfg.ferie) || cfg.ferie.some((d) => !dataIsoValida(d))) return 'ferie non valido';
  const prezzi = cfg.prezzi_openai;
  if (!prezzi || typeof prezzi !== 'object' || Array.isArray(prezzi) || !prezzi[cfg.modello_openai]) return 'prezzi_openai deve includere il modello configurato';
  const prezzoModello = prezzi[cfg.modello_openai];
  if (!prezzoModello || ['input', 'output', 'web_search'].some((k) => !Number.isFinite(Number(prezzoModello[k])) || Number(prezzoModello[k]) < 0)) return 'prezzi_openai non valido';
  if (!Array.isArray(cfg.conferme_ore) || cfg.conferme_ore.some((o) => !orarioValido(o))) return 'conferme_ore non valido';
  for (const fascia of [cfg.orario_mattina, cfg.orario_pomeriggio]) {
    if (!fascia || !orarioValido(fascia.inizio) || !orarioValido(fascia.fine) || fascia.inizio >= fascia.fine) return 'Fascia operativa non valida';
  }
  return null;
}
async function audita(client, adminId, azione, dettagli = {}) {
  await client.from('kona_call_director_audit').insert({
    azione,
    dettagli: cleanLog(dettagli),
    autore: adminId
  });
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

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return jsonError(auth.status, auth.error);
  const adminId = String(auth.profilo.id || auth.user.id || '').toLowerCase();

  const body = await readJsonBody(event);
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'stato': {
        const cfg = await getConfig(client);
        const operatori = await elencoOperatori(client);
        const budget = await budgetSnapshot(client, cfg, monthRomeKey(todayRomeStr()));
        return jsonOk({
          attivo_globale: cfg.attivo_globale,
          modalita_osservazione: cfg.modalita_osservazione,
          budget,
          operatori,
          config: configPublic(cfg)
        });
      }

      case 'toggle_globale': {
        const attivo = parseBoolean(body.attivo, null);
        if (attivo === null) return jsonError(400, 'Campo attivo mancante');
        const { error } = await client.from('kona_call_director_config').upsert({ id: 1, attivo_globale: attivo, aggiornato_at: new Date().toISOString(), aggiornato_da: adminId }, { onConflict: 'id' });
        if (error) return jsonError(500, error.message);
        await audita(client, adminId, 'toggle_globale', { attivo });
        return jsonOk({ attivo_globale: attivo });
      }

      case 'modalita_osservazione': {
        const attivo = parseBoolean(body.attivo, null);
        if (attivo === null) return jsonError(400, 'Campo attivo mancante');
        const { error } = await client.from('kona_call_director_config').upsert({ id: 1, modalita_osservazione: attivo, aggiornato_at: new Date().toISOString(), aggiornato_da: adminId }, { onConflict: 'id' });
        if (error) return jsonError(500, error.message);
        await audita(client, adminId, 'modalita_osservazione', { attivo });
        return jsonOk({ modalita_osservazione: attivo });
      }

      case 'elenco_profili': {
        const operatori = await elencoOperatori(client);
        return jsonOk({ operatori });
      }

      case 'abilita_profilo': {
        const profiloId = String(body.profilo_id || '').toLowerCase();
        if (!isUuid(profiloId)) return jsonError(400, 'profilo_id non valido');
        const abilitato = parseBoolean(body.abilitato, null);
        const inOsservazione = parseBoolean(body.in_osservazione, null);
        if (abilitato === null && inOsservazione === null) return jsonError(400, 'Nessun campo da aggiornare');
        const record = { profilo_id: profiloId };
        if (abilitato !== null) record.abilitato = abilitato;
        if (inOsservazione !== null) record.in_osservazione = inOsservazione;
        if (abilitato === true) record.abilitato_at = new Date().toISOString();
        if (abilitato === true) record.abilitato_da = adminId;
        const { error } = await client.from('kona_call_director_profili').upsert(record, { onConflict: 'profilo_id' });
        if (error) return jsonError(500, error.message);
        await audita(client, adminId, 'abilita_profilo', { profilo_id: profiloId, abilitato, in_osservazione });
        return jsonOk({ profilo_id: profiloId, abilitato, in_osservazione });
      }

      case 'config': {
        if (body.get === true) {
          const cfg = await getConfig(client);
          return jsonOk({ config: configPublic(cfg) });
        }
        const patch = {};
        for (const [campo, tipo] of Object.entries(CONFIG_EDITABILI)) {
          if (!(campo in body)) continue;
          if (tipo === 'bool') {
            const v = parseBoolean(body[campo], null);
            if (v !== null) patch[campo] = v;
          } else if (tipo === 'num') {
            const v = parseNumber(body[campo], null);
            if (v !== null) patch[campo] = v;
          } else if (tipo === 'json') {
            const v = parseJson(body[campo], null);
            if (v !== null) patch[campo] = Array.isArray(v) || typeof v === 'object' ? v : null;
          } else {
            patch[campo] = String(body[campo]).slice(0, 200);
          }
        }
        if (Object.keys(patch).length === 0) return jsonError(400, 'Nessun campo valido da aggiornare');
        const erroreConfig = validaConfigPatch({ ...(await getConfig(client)), ...patch });
        if (erroreConfig) return jsonError(400, erroreConfig);
        patch.id = 1;
        patch.aggiornato_at = new Date().toISOString();
        patch.aggiornato_da = adminId;
        const { error } = await client.from('kona_call_director_config').upsert(patch, { onConflict: 'id' });
        if (error) return jsonError(500, error.message);
        await audita(client, adminId, 'config', { aggiornati: Object.keys(patch).filter((k) => k !== 'id' && k !== 'aggiornato_at' && k !== 'aggiornato_da') });
        return jsonOk({ aggiornati: Object.keys(patch).filter((k) => k !== 'id' && k !== 'aggiornato_at' && k !== 'aggiornato_da') });
      }

      case 'budget': {
        const cfg = await getConfig(client);
        const budget = await budgetSnapshot(client, cfg, monthRomeKey(todayRomeStr()));
        return jsonOk({ budget });
      }

      case 'sospensione': {
        // Sospensione immediata: globale off + task attivi in stato sospeso.
        const { error: cfgErr } = await client.from('kona_call_director_config').upsert({ id: 1, attivo_globale: false, aggiornato_at: new Date().toISOString(), aggiornato_da: adminId }, { onConflict: 'id' });
        if (cfgErr) return jsonError(500, cfgErr.message);
        const { error: taskErr } = await client.from('kona_call_director_task').update({ stato: 'sospeso' }).eq('stato', 'attivo');
        if (taskErr) return jsonError(500, taskErr.message);
        await audita(client, adminId, 'sospensione', {});
        return jsonOk({ sospeso: true });
      }

      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};

async function elencoOperatori(client) {
  const [profili, kona] = await Promise.all([
    client.from('profili').select('id, nome, attivo').order('nome'),
    client.from('kona_call_director_profili').select('*')
  ]);
  const konaById = new Map((kona.data || []).map((r) => [String(r.profilo_id).toLowerCase(), r]));
  return (profili.data || []).map((p) => {
    const k = konaById.get(String(p.id).toLowerCase());
    return {
      profilo_id: p.id,
      nome: p.nome,
      attivo_crm: p.attivo,
      abilitato: Boolean(k?.abilitato),
      in_osservazione: k ? k.in_osservazione !== false : true,
      abilitato_at: k?.abilitato_at || null,
      ultimo_task_at: k?.ultimo_task_at || null
    };
  });
}

// Config operativa esposta soltanto all'admin; credenziali e token restano esclusi.
function configPublic(cfg) {
  return {
    attivo_globale: cfg.attivo_globale,
    modalita_osservazione: cfg.modalita_osservazione,
    budget_mensile_eur: cfg.budget_mensile_eur,
    usd_to_eur: cfg.usd_to_eur,
    riserva_arricchimento_eur: cfg.riserva_arricchimento_eur,
    riserva_dialogo_eur: cfg.riserva_dialogo_eur,
    modello_openai: cfg.modello_openai,
    prezzi_openai: cfg.prezzi_openai,
    soglie_budget: cfg.soglie_budget,
    giorni_lavorativi: cfg.giorni_lavorativi,
    ferie: cfg.ferie,
    orario_mattina: cfg.orario_mattina,
    orario_pomeriggio: cfg.orario_pomeriggio,
    orario_stop_business: cfg.orario_stop_business,
    durata_sessione_business_minuti: cfg.durata_sessione_business_minuti,
    durata_appuntamento_minuti: cfg.durata_appuntamento_minuti,
    distanza_km_indicativa: cfg.distanza_km_indicativa,
    richieste_web_max_per_lead: cfg.richieste_web_max_per_lead,
    lead_notte_obiettivo: cfg.lead_notte_obiettivo,
    soglia_lead_minime: cfg.soglia_lead_minime,
    soglia_affidabilita_arricchimento: cfg.soglia_affidabilita_arricchimento,
    max_chiamate_openai_ora: cfg.max_chiamate_openai_ora,
    orario_inizio_arricchimento: cfg.orario_inizio_arricchimento,
    orario_report_sera: cfg.orario_report_sera,
    orario_reminder_sera: cfg.orario_reminder_sera,
    orario_reminder_mattina: cfg.orario_reminder_mattina,
    orario_piano_default: cfg.orario_piano_default,
    conferme_ore: cfg.conferme_ore,
    giorni_orizzonte_calendario: cfg.giorni_orizzonte_calendario,
    orario_calendario_inizio: cfg.orario_calendario_inizio,
    orario_calendario_fine: cfg.orario_calendario_fine,
    localita_riferimento: cfg.localita_riferimento,
    localita_partenza: cfg.localita_partenza,
    tempi_trasferta_minuti: cfg.tempi_trasferta_minuti,
    buffer_appuntamento_minuti: cfg.buffer_appuntamento_minuti,
    tentativi_massimi: cfg.tentativi_massimi,
    retention_arricchimenti_giorni: cfg.retention_arricchimenti_giorni,
    retention_attivita_giorni: cfg.retention_attivita_giorni,
    retention_aggregati_giorni: cfg.retention_aggregati_giorni,
    notifiche_immediate: cfg.notifiche_immediate
  };
}
