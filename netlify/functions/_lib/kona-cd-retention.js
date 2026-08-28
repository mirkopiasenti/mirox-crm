'use strict';

const { todayRomeStr } = require('./kona-cd-time');

// Retention dati KONA Call Director (idempotente, additive-only).
// - Arricchimenti e fonti web: 180 giorni (dati transitori).
// - Attivita' (task, eventi, sessioni, conferme): 365 giorni.
// - Aggregati (budget log, notifiche inviate, esecuzioni programmate): 730 giorni.
// - I job operativi completati/annullati: 90 giorni.
// Le tabelle core (appuntamenti_business, esclusioni attive, config) restano.

const TABELLE = [
  { tabella: 'kona_call_director_arricchimento_fonti', giorni: 'retention_arricchimenti_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_arricchimenti', giorni: 'retention_arricchimenti_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_conferme', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_sessione_attivita', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_oauth_stati', giorni: 'retention_attivita_giorni', via: 'creato_at' },
  { tabella: 'kona_call_director_sessioni', giorni: 'retention_attivita_giorni', via: 'aperta_at' },
  { tabella: 'kona_call_director_task_eventi', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_task', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_esecuzioni_programmate', giorni: 'retention_aggregati_giorni', via: 'eseguita_at' },
  { tabella: 'kona_call_director_budget_log', giorni: 'retention_aggregati_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_notifiche', giorni: 'retention_aggregati_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_budget_riserve', giorni: 'retention_aggregati_giorni', via: 'creato_at' },
  { tabella: 'kona_call_director_audit', giorni: 'retention_aggregati_giorni', via: 'creato_at' }
];

// Ritorna il numero di giorni per la chiave di config, con fallback.
function giorniPer(cfg, chiave) {
  const val = Number(cfg[chiave]);
  return Number.isFinite(val) && val > 0 ? val : { retention_arricchimenti_giorni: 180, retention_attivita_giorni: 365, retention_aggregati_giorni: 730 }[chiave];
}

// Elimina le righe piu' vecchie della soglia. Idempotente: un delete unico
// preceduto da un count (LIMIT su DELETE via PostgREST non e' affidabile).
async function purga(supabase, tabella, via, cutoff) {
  const { count } = await supabase.from(tabella).select('id', { count: 'exact', head: true }).lte(via, cutoff);
  const { error } = await supabase.from(tabella).delete().lte(via, cutoff);
  if (error) return { eliminati: 0, errore: error.message };
  return { eliminati: Number(count) || 0 };
}

// Esegue la retention completa per oggi. Ritorna { ok, eliminati: {...} }.
async function runRetention(supabase, cfg, { oggi } = {}) {
  const data = oggi || todayRomeStr();
  const risultati = {};
  let errore = null;
  for (const spec of TABELLE) {
    const giorni = giorniPer(cfg, spec.giorni);
    const cutoff = new Date(new Date(`${data}T00:00:00Z`).getTime() - giorni * 24 * 60 * 60 * 1000).toISOString();
    const esito = await purga(supabase, spec.tabella, spec.via, cutoff);
    risultati[spec.tabella] = esito.eliminati;
    if (esito.errore && !errore) errore = esito.errore;
  }

  // Job operativi: completati o annullati da piu' di 90 giorni (colonna creato_at).
  const jobCutoff = new Date(new Date(`${data}T00:00:00Z`).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const jobEsito = await purga(supabase, 'kona_call_director_jobs', 'creato_at', jobCutoff);
  risultati.kona_call_director_jobs = jobEsito.eliminati;
  if (jobEsito.errore && !errore) errore = jobEsito.errore;

  return { ok: !errore, errore, eliminati: risultati };
}

module.exports = {
  TABELLE,
  giorniPer,
  purga,
  runRetention,
  _test: { giorniPer }
};
