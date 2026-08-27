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
  if (!supabase) return out;
  const { data, error } = await supabase
    .from('kona_call_director_budget_log')
    .select('attivita, costo_stimato_eur, web_ricerche')
    .eq('mese', key);
  if (error || !Array.isArray(data)) return out;
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
  if (!supabase) return 0;
  const { data, error } = await supabase
    .from('kona_call_director_budget_riserve')
    .select('importo_eur')
    .eq('mese', mese)
    .eq('stato', 'riservato')
    .gt('scadenza', new Date().toISOString());
  if (error || !Array.isArray(data)) return 0;
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
  const dialogo = Number(spesa.perAttivita.dialogo || 0);
  return {
    mese: key,
    budget,
    speso,
    riservato,
    rimasto,
    percentuale,
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
      piani: round2(Number(spesa.perAttivita.piano || 0)),
      analisi: round2(Number(spesa.perAttivita.analisi || 0)),
      altro: round2(Number(spesa.perAttivita.altro || 0))
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
  const { data: locked } = await supabase.rpc('kona_cd_try_advisory_lock', { p_chiave: `kona_cd_budget_${key}` });
  if (!locked) return { ok: false, motivo: 'lock' };

  const budget = Number(cfg.budget_mensile_eur) || 0;
  const spesa = await computeSpesaMensile(supabase, key);
  const riservato = await sommaRiserve(supabase, key);
  const disponibile = round2(clampPositive(budget - spesa.totale - riservato));
  const costo = Number(importoEur) || 0;
  if (costo <= 0) return { ok: false, motivo: 'importo_non_valido' };
  if (disponibile < costo) return { ok: false, motivo: 'hard_stop', disponibile };

  // Riserva di attivita': 'arricchimento' usa la riserva arricchimento (40),
  // tutte le altre attivita' (dialogo/analisi/piano/altro) la riserva
  // dialogo/analisi (10). Le attivita' non riconosciute ricadono in
  // riserva_dialogo per non aggirare il tetto.
  const att = attivita === 'arricchimento' ? 'arricchimento' : 'dialogo';
  if (att) {
    const spesoRiserva = att === 'arricchimento'
      ? Number(spesa.perAttivita.arricchimento || 0)
      : round2(Number(spesa.perAttivita.dialogo || 0) + Number(spesa.perAttivita.analisi || 0) + Number(spesa.perAttivita.piano || 0) + Number(spesa.perAttivita.altro || 0));
    const riserva = att === 'arricchimento'
      ? { budget: Number(cfg.riserva_arricchimento_eur) || 0, speso: round2(Number(spesa.perAttivita.arricchimento || 0)) }
      : { budget: Number(cfg.riserva_dialogo_eur) || 0, speso: spesoRiserva };
    const copertura = riservaCopre({ rimasto: round2(riserva.budget - riserva.speso) }, costo);
    if (!copertura.ok) return { ok: false, motivo: 'riserva_esaurita', riserva: att };
  }

  const { error } = await supabase.from('kona_call_director_budget_riserve').insert({
    chiave: String(chiave || '').slice(0, 120),
    mese: key,
    attivita: attivita || 'altro',
    importo_eur: round2(costo),
    stato: 'riservato',
    scadenza: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  if (error) return { ok: false, motivo: String(error.message || 'errore') };
  return { ok: true, disponibile: round2(clampPositive(disponibile - costo)) };
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

module.exports = {
  budgetSnapshot,
  clampPositive,
  computeSpesaMensile,
  consumaRiserva,
  liberaRiserva,
  newlyCrossedThresholds,
  riservaCopre,
  round2,
  sommaRiserve,
  tryReserveBudget,
  _test: { newlyCrossedThresholds, riservaCopre }
};
