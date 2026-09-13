'use strict';

const { todayRomeStr } = require('./kona-cd-time');

// Retention dati KONA Call Director (idempotente, additive-only).
// - Arricchimenti e fonti web: 180 giorni (dati transitori).
// - Attivita' (task, eventi, sessioni, conferme): 365 giorni.
// - Aggregati (budget log, notifiche inviate, esecuzioni programmate): 730 giorni.
// - I job operativi completati/annullati: 90 giorni.
// Le tabelle core (appuntamenti_business, esclusioni attive, config) restano.
//
// `stati` limita la cancellazione agli stati TERMINALI: una coda rimasta ferma
// (kill-switch, cron non eseguito, staging riattivato dopo mesi) non deve essere
// cancellata insieme al lavoro ancora pendente.

const TABELLE = [
  { tabella: 'kona_call_director_arricchimento_fonti', giorni: 'retention_arricchimenti_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_arricchimenti', giorni: 'retention_arricchimenti_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_conferme', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_sessione_attivita', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_oauth_stati', giorni: 'retention_attivita_giorni', via: 'creato_at' },
  { tabella: 'kona_call_director_sessioni', giorni: 'retention_attivita_giorni', via: 'aperta_at' },
  { tabella: 'kona_call_director_task_eventi', giorni: 'retention_attivita_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_task', giorni: 'retention_attivita_giorni', via: 'created_at', stati: ['completato', 'annullato'] },
  { tabella: 'kona_call_director_esecuzioni_programmate', giorni: 'retention_aggregati_giorni', via: 'eseguita_at' },
  { tabella: 'kona_call_director_budget_log', giorni: 'retention_aggregati_giorni', via: 'created_at' },
  { tabella: 'kona_call_director_notifiche', giorni: 'retention_aggregati_giorni', via: 'created_at', stati: ['inviata', 'morta'] },
  { tabella: 'kona_call_director_budget_riserve', giorni: 'retention_aggregati_giorni', via: 'creato_at' },
  { tabella: 'kona_call_director_audit', giorni: 'retention_aggregati_giorni', via: 'creato_at' }
];

// Dimensione del lotto: il DELETE avviene per id, cosi' una tabella grande non
// produce un'unica transazione pesante.
const LOTTO = 500;

// Ritorna il numero di giorni per la chiave di config, con fallback.
function giorniPer(cfg, chiave) {
  const val = Number(cfg[chiave]);
  return Number.isFinite(val) && val > 0 ? val : { retention_arricchimenti_giorni: 180, retention_attivita_giorni: 365, retention_aggregati_giorni: 730 }[chiave];
}

// Elimina le righe piu' vecchie della soglia, a lotti di LOTTO.
// Idempotente. Se `stati` e' presente cancella solo quelle righe.
async function purga(supabase, tabella, via, cutoff, stati = null) {
  let eliminati = 0;
  for (let giro = 0; giro < 40; giro += 1) {
    let selectQuery = supabase.from(tabella).select('id').lte(via, cutoff).limit(LOTTO);
    if (Array.isArray(stati) && stati.length > 0) selectQuery = selectQuery.in('stato', stati);
    const { data, error } = await selectQuery;
    if (error) return { eliminati, errore: error.message };
    const ids = (data || []).map((r) => r.id).filter(Boolean);
    if (ids.length === 0) break;
    const { error: deleteError } = await supabase.from(tabella).delete().in('id', ids);
    if (deleteError) return { eliminati, errore: deleteError.message };
    eliminati += ids.length;
    if (ids.length < LOTTO) break;
  }
  return { eliminati };
}

// Esegue la retention completa per oggi. Ritorna { ok, eliminati: {...} }.
async function runRetention(supabase, cfg, { oggi } = {}) {
  const data = oggi || todayRomeStr();
  const risultati = {};
  let errore = null;
  for (const spec of TABELLE) {
    const giorni = giorniPer(cfg, spec.giorni);
    const cutoff = new Date(new Date(`${data}T00:00:00Z`).getTime() - giorni * 24 * 60 * 60 * 1000).toISOString();
    const esito = await purga(supabase, spec.tabella, spec.via, cutoff, spec.stati || null);
    risultati[spec.tabella] = esito.eliminati;
    if (esito.errore && !errore) errore = esito.errore;
  }

  // Job operativi: SOLO completati o annullati da piu' di 90 giorni.
  // Senza il filtro di stato veniva cancellato anche un job ancora `in_coda`.
  const jobCutoff = new Date(new Date(`${data}T00:00:00Z`).getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const jobEsito = await purga(supabase, 'kona_call_director_jobs', 'creato_at', jobCutoff, ['completato', 'annullato']);
  risultati.kona_call_director_jobs = jobEsito.eliminati;
  if (jobEsito.errore && !errore) errore = jobEsito.errore;

  return { ok: !errore, errore, eliminati: risultati };
}

module.exports = {
  LOTTO,
  TABELLE,
  giorniPer,
  purga,
  runRetention,
  _test: { giorniPer }
};
