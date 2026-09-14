'use strict';

const { monthRomeKey, todayRomeStr } = require('./kona-cd-time');

// Budget mensile di KONA Call Director (default 50 euro/mese, di cui 10
// riservati all'assistente Telegram).
//
// DTO UNICO `budgetSnapshot` (API, UI, report e Telegram usano gli STESSI
// campi): mese, budget, speso, riservato, rimasto, percentuale, per_attivita,
// n_chiamate, telegram_messaggi, web_ricerche, riserva_arricchimento,
// riserva_dialogo, riserva_telegram, extra.
//
// Prenotazione ATOMICA: tryReserveBudget chiama la RPC
// `kona_cd_reserve_budget_v2` (o `kona_cd_reserve_budget_v1` come fallback,
// finche' la migration 078 non e' applicata), che prende da se' un advisory
// lock di transazione sul mese
// e blocca a budget totale esaurito (hard stop), quando la riserva di attivita'
// non copre il costo e quando il tetto orario e' raggiunto. Mai sforamenti
// concorrenti. La v2 aggiunge la terza riserva (telegram) e separa il tetto
// orario Telegram da quello OpenAI.
// NB: la RPC `kona_cd_try_advisory_lock` NON e' usata e non e' utilizzabile per
// serializzare due chiamate JS separate: un lock xact acquisito dentro una RPC
// viene rilasciato alla fine di quella RPC.
//
// Prezzo/modello sconosciuto: estimateCost ritorna ok:false; il chiamante
// DEVE fallire (mai conteggiare zero).
//
// Prezzi di riferimento (fonti ufficiali, aggiornati 2026-09):
//   OpenAI GPT-5.6 Luna: input $0.20/M token, output $1.20/M token,
//   web search reasoning $10.00/1000 chiamate (+ token del contenuto).
//   DeepSeek V4.1 Flash (deepseek-flash): input $0.30/M token, output
//   $1.20/M token (tariffa peak: stima conservativa, l'off-peak costa la meta').
// I seed sono in kona_call_director_config.prezzi_openai / .prezzi_deepseek.

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
    nTelegram: 0,
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
    if (attivita === 'telegram') out.nTelegram += 1;
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
  const telegram = Number(spesa.perAttivita.telegram || 0);
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
    // Riserva dedicata all'assistente Telegram (DeepSeek). Fuori dal conteggio
    // `dialogo`: un tetto da 10 EUR/mese che si mescolasse al budget OpenAI non
    // sarebbe piu' verificabile.
    riserva_telegram: {
      budget: Number(cfg.riserva_telegram_eur) || 0,
      speso: round2(telegram),
      rimasto: round2(clampPositive((Number(cfg.riserva_telegram_eur) || 0) - telegram))
    },
    // Messaggi Telegram effettivamente interpretati dall'IA nel mese.
    telegram_messaggi: spesa.nTelegram,
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

// La RPC di prenotazione non esiste ancora su questo database?
// PostgREST risponde PGRST202 ("Could not find the function") quando una
// migration non e' stata applicata: e' l'unico caso in cui accettiamo il
// fallback alla v1. Un errore diverso resta un errore.
function funzioneAssente(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === 'PGRST202'
    || /could not find the function/i.test(message)
    || /function .* does not exist/i.test(message);
}

// Spesa e prenotazioni ATTIVE del mese per una singola attivita'.
// Serve al pre-controllo della riserva Telegram quando la RPC v2 non e' ancora
// applicata: senza, il tetto da 10 EUR/mese non sarebbe verificato.
async function spesaAttivita(supabase, mese, attivita) {
  if (!supabase) throw new Error('Supabase mancante per il budget');
  const key = mese || monthRomeKey(todayRomeStr());
  const nome = String(attivita || 'altro');
  const { data, error } = await supabase
    .from('kona_call_director_budget_log')
    .select('costo_stimato_eur')
    .eq('mese', key)
    .eq('attivita', nome);
  if (error || !Array.isArray(data)) throw new Error(`budget_log: ${error?.message || 'lettura fallita'}`);
  const speso = round6(data.reduce((sum, r) => sum + (Number(r.costo_stimato_eur) || 0), 0));
  const { data: riserve, error: riserveError } = await supabase
    .from('kona_call_director_budget_riserve')
    .select('importo_eur')
    .eq('mese', key)
    .eq('attivita', nome)
    .eq('stato', 'riservato')
    .gt('scadenza', new Date().toISOString());
  if (riserveError || !Array.isArray(riserve)) throw new Error(`budget_riserve: ${riserveError?.message || 'lettura fallita'}`);
  const riservato = round6(riserve.reduce((sum, r) => sum + (Number(r.importo_eur) || 0), 0));
  return { speso, riservato };
}

// Prenotazione ATOMICA del budget (hard stop totale + riserve per attivita').
// chiave: identificatore unico dell'operazione (idempotenza/riuso).
//
// RPC v2 quando disponibile (riserva Telegram dedicata + tetto orario Telegram
// separato da quello OpenAI); fallback alla v1 finche' la migration 078 non e'
// applicata. Nel fallback il tetto Telegram e' verificato QUI, prima della
// prenotazione: non e' atomico, ma lo scarto massimo e' il costo di un singolo
// messaggio (frazioni di centesimo).
async function tryReserveBudget({ supabase, cfg, mese, attivita, importoEur, chiave }) {
  if (!supabase) return { ok: false, motivo: 'supabase_mancante' };
  const key = mese || monthRomeKey(todayRomeStr());
  const costo = Number(importoEur) || 0;
  if (costo <= 0) return { ok: false, motivo: 'importo_non_valido' };
  const nomeAttivita = attivita || 'altro';
  const riservaTelegram = Number(cfg.riserva_telegram_eur) || 0;
  const parametriComuni = {
    p_chiave: String(chiave || '').slice(0, 120),
    p_mese: key,
    p_attivita: nomeAttivita,
    p_importo_eur: round6(costo),
    p_budget_totale_eur: Number(cfg.budget_mensile_eur) || 0,
    p_riserva_arricchimento_eur: Number(cfg.riserva_arricchimento_eur) || 0,
    p_riserva_dialogo_eur: Number(cfg.riserva_dialogo_eur) || 0
  };

  let telegramBloccato = null;
  if (nomeAttivita === 'telegram') {
    try {
      const stato = await spesaAttivita(supabase, key, 'telegram');
      if (stato.speso + stato.riservato + costo > riservaTelegram) {
        telegramBloccato = { ok: false, motivo: 'riserva_esaurita', riserva: 'telegram' };
      }
    } catch (e) {
      return { ok: false, motivo: e?.message || 'lettura_riserva_fallita' };
    }
  }

  const v2 = await supabase.rpc('kona_cd_reserve_budget_v2', {
    ...parametriComuni,
    p_riserva_telegram_eur: riservaTelegram,
    p_max_telegram_ora: Number(cfg.max_messaggi_telegram_ora) || 0
  });
  if (!v2.error) {
    if (!v2.data) return { ok: false, motivo: 'rpc_budget_fallita' };
    const esito = typeof v2.data === 'object' ? v2.data : { ok: false, motivo: 'risposta_budget_non_valida' };
    // Il pre-controllo Telegram non deve MASCHERARE un rifiuto piu' forte
    // (hard stop totale): se la RPC ha rifiutato, vale il suo motivo.
    if (esito.ok && telegramBloccato) return telegramBloccato;
    return esito;
  }
  if (!funzioneAssente(v2.error)) return { ok: false, motivo: v2.error.message || 'rpc_budget_fallita' };
  if (telegramBloccato) return telegramBloccato;

  const { data, error } = await supabase.rpc('kona_cd_reserve_budget_v1', parametriComuni);
  if (error || !data) return { ok: false, motivo: error?.message || 'rpc_budget_fallita' };
  return typeof data === 'object' ? data : { ok: false, motivo: 'risposta_budget_non_valida' };
}

// Libera una prenotazione in ogni percorso terminale. NON esiste una variante
// "consuma": il costo reale va nel registro `budget_log` (unica fonte dello
// speso) e la riserva serve soltanto a impedire sforamenti concorrenti durante
// la chiamata. La vecchia `consumaRiserva` era codice morto che suggeriva un
// doppio conteggio che non avviene.
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
  funzioneAssente,
  liberaRiserva,
  newlyCrossedThresholds,
  notifyBudgetThresholds,
  riservaCopre,
  round2,
  round6,
  sommaRiserve,
  spesaAttivita,
  tryReserveBudget,
  _test: { funzioneAssente, newlyCrossedThresholds, riservaCopre, spesaAttivita }
};
