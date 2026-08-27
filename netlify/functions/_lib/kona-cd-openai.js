'use strict';

const { cleanLog, cleanText, env } = require('./kona-cd-util');
const { monthRomeKey, todayRomeStr } = require('./kona-cd-time');
const { tryReserveBudget, liberaRiserva } = require('./kona-cd-budget');

// Wrapper OpenAI Responses API per KONA Call Director.
// - Solo server-side, mai chiavi nel frontend.
// - Output strutturato (JSON schema strict) trattato come NON FIDATO:
//   validazione esplicita, istruzioni nelle pagine web ignorate.
// - Timeout + retry limitato + fallback deterministico a cura del chiamante.
// - PRENOTAZIONE BUDGET ATOMICA prima della chiamata (tryReserveBudget):
//   hard stop totale + riserve per attivita'; mai sforamenti concorrenti.
// - Prezzo/modello sconosciuto: fallisce in sicurezza (mai conteggiare zero).
// - Rate limit per-ora sulle chiamate a pagamento.
// - web_search SOLO per lead Business, mai per dati Consumer identificativi.
// - max_tool_calls=2 per web_search (mai piu' di due ricerche per chiamata).

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_RETRIES = 1;
const RETRY_DELAY_MS = 1200;

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) return String(content.text).trim();
    }
  }
  return '';
}

function countWebSearches(payload) {
  let count = 0;
  for (const item of payload?.output || []) {
    if (item?.type === 'web_search_call') count += 1;
  }
  return count;
}

// Fonti EFFETTIVE delle ricerche web (dall'API, mai dal testo del modello).
// Formato Responses API: output[].action.sources[].{title,url}
function webSearchSources(payload) {
  const out = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'web_search_call') continue;
    for (const source of item?.action?.sources || []) {
      if (source && String(source.url || '').startsWith('http')) {
        out.push({
          url: String(source.url).slice(0, 500),
          title: String(source.title || '').slice(0, 300) || null
        });
      }
    }
  }
  return out.slice(0, 10);
}

function typeMatches(expected, value) {
  if (expected === 'string') return typeof value === 'string';
  if (expected === 'boolean') return typeof value === 'boolean';
  if (expected === 'number') return typeof value === 'number';
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (expected === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return true;
}

// Validazione top-level dello schema (required + tipi). Il parsing JSON strict
// e' gia' garantito dall'API; qui difendiamo il chiamante da output anomali.
function validateStructured(value, schema) {
  if (!schema || typeof schema !== 'object') return { ok: true };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'output non oggetto' };
  }
  if (schema.type === 'object' && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (!(key in value)) return { ok: false, error: `campo richiesto mancante: ${key}` };
    }
  }
  const properties = schema.properties || {};
  for (const [key, prop] of Object.entries(properties)) {
    if (value[key] === undefined) continue;
    const expected = Array.isArray(prop.type) ? prop.type : [prop.type];
    if (expected.includes('null') && value[key] === null) continue;
    const nonNull = expected.filter((t) => t !== 'null');
    if (nonNull.length === 1 && !typeMatches(nonNull[0], value[key])) {
      return { ok: false, error: `tipo non valido per ${key}: atteso ${nonNull.join('/')}` };
    }
  }
  return { ok: true };
}

// Costo per il modello (prezzi da config, mai hardcodati).
// Ritorna { ok:false } se modello o prezzi sconosciuti/non numerici: il
// chiamante DEVE fallire (mai conteggiare zero).
function estimateCost(cfg, model, usage, webCount) {
  const prices = (cfg && cfg.prezzi_openai && cfg.prezzi_openai[model]) || null;
  if (!prices) return { ok: false, motivo: 'prezzo_non_configurato', model };
  const inputPrice = Number(prices.input) / 1e6;
  const outputPrice = Number(prices.output) / 1e6;
  const webPrice = Number(prices.web_search || 0);
  if (![inputPrice, outputPrice, webPrice].every((n) => Number.isFinite(n) && n >= 0)) {
    return { ok: false, motivo: 'prezzo_non_valido', model };
  }
  const eur = (usage.input_tokens || 0) * inputPrice + (usage.output_tokens || 0) * outputPrice + (webCount || 0) * webPrice;
  return { ok: true, eur: Math.round(eur * 1e6) / 1e6, note: null };
}

// Stima conservativa del costo POTENZIALE (usata per la prenotazione prima
// della chiamata): input dalla lunghezza, output dal massimo consentito,
// web dal limite di tool. Fail-safe se il prezzo non e' noto.
function estimatePotential(cfg, model, { inputLen, maxOutputTokens, webCount }) {
  const prices = (cfg && cfg.prezzi_openai && cfg.prezzi_openai[model]) || null;
  if (!prices) return { ok: false, motivo: 'prezzo_non_configurato', model };
  const inputPrice = Number(prices.input) / 1e6;
  const outputPrice = Number(prices.output) / 1e6;
  const webPrice = Number(prices.web_search || 0);
  if (![inputPrice, outputPrice, webPrice].every((n) => Number.isFinite(n) && n >= 0)) {
    return { ok: false, motivo: 'prezzo_non_valido', model };
  }
  const inputTokens = Math.ceil((Number(inputLen) || 0) / 4);
  const eur = inputTokens * inputPrice + (Number(maxOutputTokens) || 0) * outputPrice + (Number(webCount) || 0) * webPrice;
  return { ok: true, eur: Math.max(0.0001, Math.round(eur * 1e6) / 1e6) };
}

async function logUsage({ supabase, cfg, activity = 'altro', model, usage, webCount, costEur, details = {} }) {
  if (!supabase) return;
  const today = todayRomeStr();
  const record = {
    data: today,
    mese: monthRomeKey(today),
    attivita: activity,
    modello: model || null,
    input_tokens: usage?.input_tokens || 0,
    output_tokens: usage?.output_tokens || 0,
    web_ricerche: webCount || 0,
    costo_stimato_eur: costEur || 0,
    dettagli: cleanLog(details)
  };
  await supabase.from('kona_call_director_budget_log').insert(record);
}

// Rate limit per-ora sulle chiamate a pagamento (default 120/h).
async function rateLimitOk(supabase, cfg) {
  if (!supabase) return true;
  const max = Number(cfg.max_chiamate_openai_ora) || 120;
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('kona_call_director_budget_log')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since);
  if (error) return false; // fail-closed
  return Number(count) < max;
}

// Chiamata Responses API con output JSON strict. webSearch=true abilita
// web_search_preview con max_tool_calls=2 (solo contesto Business).
// Ritorna { ok:true, value, usage, webCount, webSources, costEur, note }
// oppure { ok:false, error_code, error }.
async function openaiStructured({
  supabase,
  cfg,
  activity = 'altro',
  name,
  instructions,
  input,
  schema,
  maxOutputTokens = 700,
  webSearch = false,
  maxToolCalls = 2,
  details = {}
}) {
  const apiKey = env('KONA_CALL_DIRECTOR_OPENAI_API_KEY') || env('OPENAI_API_KEY');
  if (!apiKey) return { ok: false, error_code: 'no_api_key', error: 'OPENAI_API_KEY non configurata' };
  const model = (cfg && cfg.modello_openai) || env('KONA_CALL_DIRECTOR_OPENAI_MODEL') || 'gpt-5.6-luna';

  // Fail-safe: prezzo/modello sconosciuto -> blocca PRIMA di spendere.
  const potenziale = estimatePotential(cfg, model, {
    inputLen: String(input || '').length,
    maxOutputTokens,
    webCount: webSearch ? Math.min(Number(maxToolCalls) || 2, 2) : 0
  });
  if (!potenziale.ok) {
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'budget_prezzo_ignoto', motivo: potenziale.motivo } });
    return { ok: false, error_code: 'budget_prezzo_ignoto', error: potenziale.motivo };
  }

  // Rate limit per-ora (fail-closed).
  if (!(await rateLimitOk(supabase, cfg))) {
    return { ok: false, error_code: 'rate_limited', error: 'Troppe chiamate OpenAI nell\'ultima ora' };
  }

  // PRENOTAZIONE BUDGET ATOMICA prima della chiamata.
  const chiave = `${activity}:${String(name || 'kona').slice(0, 40)}:${require('crypto').randomUUID()}`;
  const riserva = await tryReserveBudget({
    supabase, cfg, mese: monthRomeKey(todayRomeStr()), attivita: activity,
    importoEur: potenziale.eur, chiave
  });
  if (!riserva.ok) {
    const code = riserva.motivo === 'hard_stop' ? 'budget_esaurito' : riserva.motivo === 'riserva_esaurita' ? 'budget_riserva_esaurita' : 'budget_non_disponibile';
    await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: code, motivo: riserva.motivo } });
    return { ok: false, error_code: code, error: riserva.motivo };
  }
  // In ogni percorso terminale liberiamo la prenotazione: il costo reale va
  // nel registro budget_log (unica fonte di verita' dello speso).
  const libera = () => liberaRiserva(supabase, chiave);

  const body = {
    model,
    instructions: cleanText(instructions, 8000),
    input,
    max_output_tokens: maxOutputTokens,
    store: false,
    text: { format: { type: 'json_schema', name: String(name || 'kona_call_director').slice(0, 64), strict: true, schema } }
  };
  if (webSearch) body.tools = [{ type: 'web_search_preview', max_tool_calls: Math.min(Number(maxToolCalls) || 2, 2) }];

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
    let response;
    try {
      response = await fetch(RESPONSES_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45000)
      });
    } catch (error) {
      lastError = error;
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        if (attempt < MAX_RETRIES) continue;
        await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'timeout' } });
        await libera();
        return { ok: false, error_code: 'timeout', error: 'Richiesta OpenAI in timeout' };
      }
      if (attempt < MAX_RETRIES) continue;
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'network_error' } });
      await libera();
      return { ok: false, error_code: 'network_error', error: 'Errore di rete verso OpenAI' };
    }

    const payload = await response.json().catch(() => ({}));
    const status = response.status;
    if (status === 429 || status === 503 || status === 529) {
      lastError = payload?.error?.message || `OpenAI ${status}`;
      if (attempt < MAX_RETRIES) continue;
      const code = status === 429 ? 'rate_limited' : 'unavailable';
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: code } });
      await libera();
      return { ok: false, error_code: code, error: lastError };
    }
    if (!response.ok) {
      lastError = payload?.error?.message || `OpenAI ${status}`;
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'error' } });
      await libera();
      const code = status === 401 || status === 403 ? 'auth_error' : status === 400 ? 'invalid_request' : 'generic_error';
      return { ok: false, error_code: code, error: lastError };
    }

    const output = extractOutputText(payload);
    if (!output) {
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'empty_output' } });
      await libera();
      return { ok: false, error_code: 'empty_output', error: 'OpenAI non ha restituito un testo strutturato' };
    }

    let value;
    try {
      value = JSON.parse(output);
    } catch {
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'invalid_json' } });
      await libera();
      return { ok: false, error_code: 'invalid_json', error: 'Risposta OpenAI non valida' };
    }
    const validation = validateStructured(value, schema);
    if (!validation.ok) {
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'schema_invalid' } });
      await libera();
      return { ok: false, error_code: 'schema_invalid', error: validation.error };
    }

    const usage = {
      input_tokens: Number(payload?.usage?.input_tokens || 0),
      output_tokens: Number(payload?.usage?.output_tokens || 0),
      total_tokens: Number(payload?.usage?.total_tokens || 0)
    };
    const webCount = countWebSearches(payload);
    const webSources = webSearchSources(payload);
    const cost = estimateCost(cfg, model, usage, webCount);
    if (!cost.ok) {
      await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'budget_prezzo_ignoto' } });
      await libera();
      return { ok: false, error_code: 'budget_prezzo_ignoto', error: cost.motivo };
    }
    await logUsage({
      supabase, cfg, activity, model, usage, webCount,
      costEur: cost.eur,
      details: { ...details, esito: 'ok', costo_note: cost.note }
    });
    await libera();
    return { ok: true, value, usage, webCount, webSources, costEur: cost.eur, note: cost.note };
  }
  await logUsage({ supabase, cfg, activity, model, details: { ...details, esito: 'exhausted', errore: cleanLog(lastError?.message || String(lastError), 400) } });
  await libera();
  return { ok: false, error_code: 'generic_error', error: 'Chiamata OpenAI non riuscita' };
}

module.exports = {
  estimateCost,
  estimatePotential,
  extractOutputText,
  logUsage,
  openaiStructured,
  validateStructured,
  webSearchSources,
  _test: { countWebSearches, estimateCost, estimatePotential, validateStructured, webSearchSources }
};
