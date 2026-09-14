'use strict';

const { cleanLog, cleanText, env } = require('./kona-cd-util');
const { monthRomeKey, todayRomeStr } = require('./kona-cd-time');
const { tryReserveBudget, liberaRiserva, notifyBudgetThresholds } = require('./kona-cd-budget');
const { estimateCostCon, estimatePotentialCon, logUsage, validateStructured } = require('./kona-cd-openai');

// Wrapper DeepSeek (API compatibile OpenAI, endpoint /chat/completions) per
// KONA Call Director. Nasce per l'assistente Telegram in linguaggio naturale.
//
// Differenze rispetto a OpenAI, tutte volute:
// - Nessuna ricerca web: DeepSeek non la offre. Il dispatcher `kona-cd-ai.js`
//   RIFIUTA la richiesta se un chiamante la chiede su questo provider, invece
//   di degradare in silenzio (l'arricchimento aziendale resta su OpenAI).
// - Nessuna trascrizione audio: i vocali Telegram non sono supportati.
// - Output JSON tramite `response_format: {type:'json_object'}` (non esiste il
//   json_schema strict di OpenAI): la conformita' dello schema e' verificata da
//   `validateStructured`, e la documentazione DeepSeek richiede la parola "json"
//   nel prompt.
// - Thinking mode DISATTIVATA: il default di DeepSeek e' thinking con effort
//   "high", che produrrebbe catena di pensiero (costo e latenza) su ogni
//   messaggio Telegram. Qui serve una risposta breve e immediata.
//
// Invarianti condivise con il wrapper OpenAI:
// - solo server-side, mai chiavi nel frontend;
// - output del modello trattato come NON fidato;
// - PRENOTAZIONE BUDGET ATOMICA prima della chiamata e rilascio in ogni
//   percorso terminale; il costo reale va nel registro `budget_log`;
// - prezzo/modello sconosciuto = fallimento, mai costo zero.

const CHAT_URL = 'https://api.deepseek.com/chat/completions';
const MODELLO_DEFAULT = 'deepseek-flash';

function getApiKey() {
  return env('KONA_CALL_DIRECTOR_DEEPSEEK_API_KEY') || env('DEEPSEEK_API_KEY');
}

// La chiave e' presente in questo processo? Le env di Netlify entrano nel
// processo delle function solo con un NUOVO deploy: dopo aver aggiunto la
// variabile serve un redeploy, altrimenti qui risulta ancora assente.
function isConfigured() {
  return Boolean(getApiKey());
}

// Nome della variabile mancante, per un messaggio diagnostico utile.
const ENV_CHIAVE = 'KONA_CALL_DIRECTOR_DEEPSEEK_API_KEY';

function modelloDeepseek(cfg) {
  return String(cfg?.modello_deepseek || env('KONA_CALL_DIRECTOR_DEEPSEEK_MODEL') || MODELLO_DEFAULT).trim()
    || MODELLO_DEFAULT;
}

// Estrae il contenuto testuale dalla risposta chat-completions.
function extractContent(payload) {
  return String(payload?.choices?.[0]?.message?.content || '').trim();
}

function extractUsage(payload) {
  const u = payload?.usage || {};
  return {
    input_tokens: Number(u.prompt_tokens || 0),
    output_tokens: Number(u.completion_tokens || 0),
    total_tokens: Number(u.total_tokens || 0)
  };
}

// Esempio di JSON costruito dallo schema. La documentazione DeepSeek chiede di
// accompagnare il `json_object` con un esempio della forma attesa: senza, il
// modello deve indovinare struttura e nomi dei campi (OpenAI non ne ha bisogno
// perche' impone lo schema strict, DeepSeek no).
function esempioDaSchema(schema) {
  if (!schema || typeof schema !== 'object') return null;
  const tipo = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  if (tipo === 'object' || schema.properties) {
    const out = {};
    for (const [key, prop] of Object.entries(schema.properties || {})) out[key] = esempioDaSchema(prop);
    return out;
  }
  if (tipo === 'array') return schema.items ? [esempioDaSchema(schema.items)] : [];
  if (tipo === 'number' || tipo === 'integer') return 0;
  if (tipo === 'boolean') return false;
  if (tipo === 'null') return null;
  return '';
}

// Il JSON output di DeepSeek richiede che il prompt contenga la parola "json".
// L'istruzione viene AGGIUNTA qui, non lasciata al chiamante: cosi' la
// richiesta resta valida anche se un domani cambia il prompt dell'assistente.
function istruzioniConJson(instructions, schema) {
  const base = cleanText(instructions, 8000);
  const parti = [];
  if (!/json/i.test(base)) parti.push('Rispondi esclusivamente con un oggetto json valido, senza testo fuori dal json.');
  const esempio = schema ? esempioDaSchema(schema) : null;
  if (esempio && Object.keys(esempio).length > 0) {
    parti.push(`Esempio di json atteso: ${JSON.stringify(esempio)}`);
  }
  // Il testo dell'esempio contiene comunque la parola "json": il vincolo della
  // documentazione DeepSeek e' soddisfatto in ogni caso.
  return [base, ...parti].join(' ');
}

function numOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Pre-controllo del tetto orario dei messaggi Telegram. La verifica
// AUTOREVOLE resta nella RPC di prenotazione (v2): questo e' solo un filtro
// anticipato che evita di prenotare budget per un messaggio che verra' rifiutato.
async function rateLimitTelegramOk(supabase, cfg) {
  if (!supabase) return true;
  const max = Math.max(0, numOr(cfg.max_messaggi_telegram_ora, 60));
  if (max === 0) return false; // 0 = assistente Telegram congelato
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('kona_call_director_budget_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .eq('attivita', 'telegram')
    .gt('costo_stimato_eur', 0);
  if (error) return false; // fail-closed
  return Number(count) < max;
}

// Chiamata DeepSeek con output JSON. Ritorna
// { ok:true, value, usage, costEur } oppure { ok:false, error_code, error }.
async function deepseekStructured({
  supabase,
  cfg,
  activity = 'telegram',
  name,
  instructions,
  input,
  schema,
  maxOutputTokens = 500,
  details = {}
}) {
  const apiKey = getApiKey();
  if (!apiKey) return { ok: false, error_code: 'no_api_key', error: 'KONA_CALL_DIRECTOR_DEEPSEEK_API_KEY non configurata' };
  const model = modelloDeepseek(cfg);

  // Fail-safe: prezzo/modello sconosciuto -> blocca PRIMA di spendere.
  const potenziale = estimatePotentialCon(cfg?.prezzi_deepseek, cfg, model, {
    inputLen: String(input || '').length + String(instructions || '').length,
    maxOutputTokens,
    webCount: 0
  });
  if (!potenziale.ok) {
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'budget_prezzo_ignoto', motivo: potenziale.motivo, provider: 'deepseek' } });
    return { ok: false, error_code: 'budget_prezzo_ignoto', error: potenziale.motivo };
  }

  // Il tetto orario dei MESSAGGI vale solo per l'assistente Telegram: piano e
  // analisi sono chiamate di sistema e hanno gia' il proprio tetto (le
  // prenotazioni non-telegram, applicato atomicamente dalla RPC di budget).
  if (activity === 'telegram' && !(await rateLimitTelegramOk(supabase, cfg))) {
    return { ok: false, error_code: 'rate_limited', error: 'Troppi messaggi Telegram nell\'ultima ora' };
  }

  const chiave = `${activity}:${String(name || 'kona').slice(0, 40)}:${require('crypto').randomUUID()}`;
  const riserva = await tryReserveBudget({
    supabase, cfg, mese: monthRomeKey(todayRomeStr()), attivita: activity,
    importoEur: potenziale.eur, chiave
  });
  if (!riserva.ok) {
    const code = riserva.motivo === 'hard_stop' ? 'budget_esaurito'
      : riserva.motivo === 'riserva_esaurita' ? 'budget_riserva_esaurita'
        : riserva.motivo === 'rate_limited' ? 'rate_limited'
          : 'budget_non_disponibile';
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: code, motivo: riserva.motivo, provider: 'deepseek' } });
    return { ok: false, error_code: code, error: riserva.motivo };
  }
  const libera = () => liberaRiserva(supabase, chiave);

  const body = {
    model,
    messages: [
      { role: 'system', content: istruzioniConJson(instructions, schema) },
      { role: 'user', content: cleanText(input, 20000) }
    ],
    response_format: { type: 'json_object' },
    max_tokens: maxOutputTokens,
    // Non-thinking: risposta rapida e senza catena di pensiero fatturata.
    thinking: { type: 'disabled' },
    stream: false
  };

  let response;
  try {
    response = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    const timeout = error?.name === 'AbortError' || error?.name === 'TimeoutError';
    const code = timeout ? 'timeout' : 'network_error';
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: code, provider: 'deepseek' } });
    await libera();
    return {
      ok: false,
      error_code: code,
      error: timeout ? 'Richiesta DeepSeek in timeout' : 'Errore di rete verso DeepSeek'
    };
  }

  const payload = await response.json().catch(() => ({}));
  const status = response.status;
  if (status === 429 || status === 503 || status === 529) {
    const code = status === 429 ? 'rate_limited' : 'unavailable';
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: code, provider: 'deepseek' } });
    await libera();
    return { ok: false, error_code: code, error: payload?.error?.message || `DeepSeek ${status}` };
  }
  if (!response.ok) {
    const code = status === 401 || status === 403 ? 'auth_error' : status === 400 ? 'invalid_request' : 'generic_error';
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: code, provider: 'deepseek' } });
    await libera();
    return { ok: false, error_code: code, error: payload?.error?.message || `DeepSeek ${status}` };
  }

  // Da qui la risposta e' 2xx: i token sono fatturati anche se l'output non e'
  // utilizzabile. Uso e costo si calcolano PRIMA del parsing, cosi' ogni
  // percorso terminale li registra.
  const usage = extractUsage(payload);
  const cost = estimateCostCon(cfg?.prezzi_deepseek, cfg, model, usage, 0);
  const costEur = cost.ok ? cost.eur : 0;
  const output = extractContent(payload);

  if (!output) {
    // La documentazione DeepSeek segnala che il JSON output puo' tornare vuoto.
    await logUsage({ supabase, cfg, activity, model, usage, costEur, details: { ...details, esito: 'empty_output', provider: 'deepseek' } });
    await libera();
    return { ok: false, error_code: 'empty_output', error: 'DeepSeek non ha restituito un testo strutturato' };
  }

  let value;
  try {
    value = JSON.parse(output);
  } catch {
    await logUsage({ supabase, cfg, activity, model, usage, costEur, details: { ...details, esito: 'invalid_json', provider: 'deepseek' } });
    await libera();
    return { ok: false, error_code: 'invalid_json', error: 'Risposta DeepSeek non valida' };
  }
  const validation = validateStructured(value, schema);
  if (!validation.ok) {
    await logUsage({ supabase, cfg, activity, model, usage, costEur, details: { ...details, esito: 'schema_invalid', provider: 'deepseek' } });
    await libera();
    return { ok: false, error_code: 'schema_invalid', error: validation.error };
  }
  if (!cost.ok) {
    await logUsage({ supabase, cfg, activity, model, usage, details: { ...details, esito: 'budget_prezzo_ignoto', provider: 'deepseek' } });
    await libera();
    return { ok: false, error_code: 'budget_prezzo_ignoto', error: cost.motivo };
  }

  try {
    await logUsage({
      supabase, cfg, activity, model, usage,
      costEur: cost.eur,
      details: { ...details, esito: 'ok', provider: 'deepseek', costo_note: cost.note }
    });
    await notifyBudgetThresholds(supabase, cfg).catch(() => null);
  } finally {
    await libera();
  }
  return { ok: true, value, usage, costEur: cost.eur, provider: 'deepseek' };
}

module.exports = {
  CHAT_URL,
  ENV_CHIAVE,
  MODELLO_DEFAULT,
  deepseekStructured,
  esempioDaSchema,
  extractContent,
  extractUsage,
  getApiKey,
  isConfigured,
  istruzioniConJson,
  modelloDeepseek,
  rateLimitTelegramOk,
  _test: { esempioDaSchema, extractContent, extractUsage, istruzioniConJson, modelloDeepseek }
};
