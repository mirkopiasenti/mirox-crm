'use strict';

const { monthRomeKey, todayRomeStr } = require('./kona-cd-time');

// Budget mensile OpenAI di KONA Call Director (default 50 euro/mese).
//
// DTO UNICO `budgetSnapshot` (API, UI, report e Telegram usano gli STESSI
// campi): mese, budget, speso, riservato, rimasto, percentuale, per_attivita,
// n_chiamate, web_ricerche, riserva_arricchimento, riserva_dialogo, extra.
//
// Prenotazione ATOMICA: tryReserveBudget serializza via advisory lock di
// transazione (kona_cd_try_advisory_lock) e blocca a budget totale esaurito
// (hard stop) o quando la riserva di attivita' non copre il costo. Mai
// sforamenti concorrenti.
//
// Prezzo/modello sconosciuto: estimateCost ritorna ok:false; il chiamante
// DEVE fallire (mai conteggiare zero).
//
// Prezzi di riferimento (fonti ufficiali OpenAI, aggiornati 2026-08-27):
//   GPT-5.6 Luna: input $0.20/M token, output $1.20/M token,
//   web search reasoning $10.00/1000 chiamate (+ token del contenuto).
// Il seed e' in kona_call_director_config.prezzi_openai (verificabile).

function round2(n) {
  return Math.round(n * 100) / 100;
}

function round6(n) {
  return Math.round(n * 1000000) / 1000000;
}

function clampPositive(n) {
  return n > 0 ? n : 0;
}

// Totale mensile + dettaglio per attivita' (costo_stimato_eur).
async function computeSpesaMensile(supabase, mese) {
  const key = mese || monthRomeKey(todayRomeStr());
  const out = {
    mese: key,
    totale: 0,
    perAttivita: {},
    nChiamate: 0,
    nWebSearch: 0
  };
  if (!supabase) throw new Error('Supabase mancante per il budget');
  const { data, error } = await supabase
    .from('kona_call_director_budget_log')
    .select('attivita, costo_stimato_eur, web_ricerche')
    .eq('mese', key);
  if (error || !Array.isArray(data)) throw new Error(`budget_log: ${error?.message || 'lettura fallita'}`);
  for (const row of data) {
    const costo = Number(row.costo_stimato_eur) || 0;
    out.totale = round2(out.totale + costo);
    const attivita = String(row.attivita || 'altro');
    out.perAttivita[attivita] = round2((out.perAttivita[attivita] || 0) + costo);
    out.nChiamate += 1;
    out.nWebSearch += Number(row.web_ricerche) || 0;
  }
  return out;
}

// Somma delle prenotazioni attive (non scadute) del mese.
async function sommaRiserve(supabase, mese) {
  if (!supabase) throw new Error('Supabase mancante per il budget');
  const { data, error } = await supabase
    .from('kona_call_director_budget_riserve')
    .select('importo_eur')
    .eq('mese', mese)
    .eq('stato', 'riservato')
    .gt('scadenza', new Date().toISOString());
  if (error || !Array.isArray(data)) throw new Error(`budget_riserve: ${error?.message || 'lettura fallita'}`);
  return round2(data.reduce((sum, r) => sum + (Number(r.importo_eur) || 0), 0));
}

// DTO UNICO budget mensile.
async function budgetSnapshot(supabase, cfg, mese) {
  const key = mese || monthRomeKey(todayRomeStr());
  const spesa = await computeSpesaMensile(supabase, key);
  const budget = Number(cfg.budget_mensile_eur) || 0;
  const speso = round2(spesa.totale);
  const riservato = await sommaRiserve(supabase, key);
  const rimasto = round2(clampPositive(budget - speso - riservato));
  const percentuale = budget > 0 ? round2((speso / budget) * 100) : 0;
  const arricchimento = Number(spesa.perAttivita.arricchimento || 0);
  const piano = Number(spesa.perAttivita.piano || 0);
  const analisi = Number(spesa.perAttivita.analisi || 0);
  const altro = Number(spesa.perAttivita.altro || 0);
  const dialogo = round2(Number(spesa.perAttivita.dialogo || 0) + piano + analisi + altro);
  return {
    mese: key,
    budget,
    speso,
    riservato,
    rimasto,
    percentuale,
    soglie_budget: Array.isArray(cfg.soglie_budget) ? cfg.soglie_budget : [],
    per_attivita: spesa.perAttivita,
    n_chiamate: spesa.nChiamate,
    web_ricerche: spesa.nWebSearch,
    riserva_arricchimento: {
      budget: Number(cfg.riserva_arricchimento_eur) || 0,
      speso: round2(arricchimento),
      rimasto: round2(clampPositive((Number(cfg.riserva_arricchimento_eur) || 0) - arricchimento))
    },
    riserva_dialogo: {
      budget: Number(cfg.riserva_dialogo_eur) || 0,
      speso: round2(dialogo),
      rimasto: round2(clampPositive((Number(cfg.riserva_dialogo_eur) || 0) - dialogo))
    },
    extra: {
      piani: round2(piano),
      analisi: round2(analisi),
      altro: round2(altro)
    }
  };
}

// La riserva copre il costo stimato dell'attivita'? Ritorna { ok, rimasto }.
function riservaCopre(riserva, costoCandidato) {
  const costo = Number(costoCandidato) || 0;
  const rimasto = Number(riserva.rimasto) || 0;
  if (costo <= 0) return { ok: true, rimasto };
  return { ok: rimasto >= costo, rimasto };
}

// Prenotazione ATOMICA del budget (hard stop totale + riserve per attivita').
// chiave: identificatore unico dell'operazione (idempotenza/riuso).
async function tryReserveBudget({ supabase, cfg, mese, attivita, importoEur, chiave }) {
  if (!supabase) return { ok: false, motivo: 'supabase_mancante' };
  const key = mese || monthRomeKey(todayRomeStr());
  const costo = Number(importoEur) || 0;
  if (costo <= 0) return { ok: false, motivo: 'importo_non_valido' };
  const { data, error } = await supabase.rpc('kona_cd_reserve_budget_v1', {
    p_chiave: String(chiave || '').slice(0, 120),
    p_mese: key,
    p_attivita: attivita || 'altro',
    p_importo_eur: round6(costo),
    p_budget_totale_eur: Number(cfg.budget_mensile_eur) || 0,
    p_riserva_arricchimento_eur: Number(cfg.riserva_arricchimento_eur) || 0,
    p_riserva_dialogo_eur: Number(cfg.riserva_dialogo_eur) || 0
  });
  if (error || !data) return { ok: false, motivo: error?.message || 'rpc_budget_fallita' };
  return typeof data === 'object' ? data : { ok: false, motivo: 'risposta_budget_non_valida' };
}

// Consuma (a fine chiamata riuscita) o libera (a fallimento) una prenotazione.
async function consumaRiserva(supabase, chiave) {
  if (!supabase || !chiave) return;
  await supabase.from('kona_call_director_budget_riserve').update({ stato: 'consumato' }).eq('chiave', chiave).eq('stato', 'riservato');
}

async function liberaRiserva(supabase, chiave) {
  if (!supabase || !chiave) return;
  await supabase.from('kona_call_director_budget_riserve').update({ stato: 'liberato' }).eq('chiave', chiave).eq('stato', 'riservato');
}

// Soglie appena superate (nuove), basate su quelle gia' notificate.
function newlyCrossedThresholds(snapshot, soglieNotificate = []) {
  const soglie = (snapshot && snapshot.soglie_budget) || [];
  const crossed = [];
  const known = new Set(soglieNotificate.map((n) => Number(n)));
  for (const soglia of soglie) {
    const s = Number(soglia);
    if (snapshot.percentuale >= s && !known.has(s)) crossed.push(s);
  }
  return crossed;
}

async function notifyBudgetThresholds(supabase, cfg) {
  if (!cfg?.notifiche_immediate?.budget) return [];
  const snapshot = await budgetSnapshot(supabase, cfg);
  const crossed = newlyCrossedThresholds(snapshot, []);
  if (crossed.length === 0) return [];
  const { enqueueNotifica } = require('./kona-cd-notifiche');
  for (const soglia of crossed) {
    await enqueueNotifica(supabase, {
      dedupeKey: `budget_${snapshot.mese}_${soglia}`,
      testo: `KONA Call Director: budget OpenAI al ${snapshot.percentuale}% (soglia ${soglia}%). Rimangono EUR ${snapshot.rimasto}.`,
      extra: { mese: snapshot.mese, soglia, percentuale: snapshot.percentuale, rimasto: snapshot.rimasto }
    });
  }
  return crossed;
}

module.exports = {
  budgetSnapshot,
  clampPositive,
  computeSpesaMensile,
  consumaRiserva,
  liberaRiserva,
  newlyCrossedThresholds,
  notifyBudgetThresholds,
  riservaCopre,
  round2,
  round6,
  sommaRiserve,
  tryReserveBudget,
  _test: { newlyCrossedThresholds, riservaCopre }
};
