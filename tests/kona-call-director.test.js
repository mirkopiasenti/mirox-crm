'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');

const L = (f) => require(path.resolve(__dirname, '..', 'netlify/functions/_lib', f));

const time = L('kona-cd-time');
const util = L('kona-cd-util');
const config = L('kona-cd-config');
const budget = L('kona-cd-budget');
const cryptoLib = L('kona-cd-crypto');
const openai = L('kona-cd-openai');
const scoring = L('kona-cd-scoring');
const engine = L('kona-cd-engine');
const conferme = L('kona-cd-conferme');
const arr = L('kona-cd-arricchimento');
const ret = L('kona-cd-retention');
const notif = L('kona-cd-notifiche');
const google = L('kona-cd-google');
const report = L('kona-cd-report');
const telegram = L('kona-cd-telegram');
const dist = L('kona-cd-distances');

const PROFILO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LEAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHIAMATA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const APP_BUSINESS = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

// -- Mock Supabase -------------------------------------------------------------

class Q {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.selectCols = '*';
    this.mode = null;
    this.op = null;
    this.value = null;
    this.conflict = null;
    this.head = false;
    this.limitN = null;
  }
  select(cols, opts) {
    this.selectCols = cols;
    if (opts) { this.head = Boolean(opts.head); this.countMode = opts.count; }
    return this;
  }
  eq(k, v) { this.filters.push(['eq', k, v]); return this; }
  is(k, v) { this.filters.push(['is', k, v]); return this; }
  in(k, v) { this.filters.push(['in', k, v]); return this; }
  contains(k, v) { this.filters.push(['contains', k, v]); return this; }
  not(k, v) { this.filters.push(['not', k, v]); return this; }
  gte(k, v) { this.filters.push(['gte', k, v]); return this; }
  lte(k, v) { this.filters.push(['lte', k, v]); return this; }
  gt(k, v) { this.filters.push(['gt', k, v]); return this; }
  lt(k, v) { this.filters.push(['lt', k, v]); return this; }
  filter(k, op, v) { this.filters.push(['filter', k, op, v]); return this; }
  or(expr) { this.filters.push(['or', expr]); return this; }
  order(k, o) { this.orderBy = [k, o]; return this; }
  limit(n) { this.limitN = n; return this; }
  onConflict(c) { this.conflict = c; return this; }
  ignore() { this.ignoreFlag = true; return this; }
  insert(v) { this.op = 'insert'; this.value = v; return this; }
  update(v) { this.op = 'update'; this.value = v; return this; }
  delete() { this.op = 'delete'; return this; }
  upsert(v, o) { this.op = 'upsert'; this.value = v; this.upsertOpt = o || {}; return this; }
  maybeSingle() { this.mode = 'maybeSingle'; return this._run(); }
  single() { this.mode = 'single'; return this._run(); }
  then(resolve, reject) { return this._run().then(resolve, reject); }
  async _run() {
    const key = `${this.table}.${this.op || 'select'}`;
    const handler = this.db._handlers[key];
    let result;
    if (handler) result = handler(this);
    else {
      const selKey = `${this.table}.select`;
      if (this.db._handlers[selKey]) result = this.db._handlers[selKey](this);
      else if (this.mode === 'single') return { data: null, error: { message: 'no rows', code: 'PGRST116' } };
      else if (this.head) return { count: 0, data: null, error: null };
      else return { data: this.mode === 'maybeSingle' ? null : [], error: null };
    }
    if (result && result.data && this.mode === 'maybeSingle' && Array.isArray(result.data)) {
      result.data = result.data[0] || null; // PostgREST maybeSingle -> singolo oggetto
    }
    if (result && result.data && this.mode === 'single' && Array.isArray(result.data)) {
      result.data = result.data[0] || null;
    }
    return result;
  }
}

function makeSupabase(handlers) {
  const wrapped = {};
  for (const [key, fn] of Object.entries(handlers || {})) {
    wrapped[key] = typeof fn === 'function' ? fn : () => fn;
  }
  return {
    _handlers: wrapped,
    rpc: async (name, params) => {
      const handler = wrapped['rpc.' + name];
      if (handler) return handler({ name, params });
      if (name === 'kona_cd_reserve_budget_v1') return { data: { ok: true }, error: null };
      if (name === 'kona_cd_acquire_job_v1') return { data: [], error: null };
      return { data: true, error: null };
    },
    from(table) { return new Q(this, table); }
  };
}

function baseCfg() {
  return {
    attivo_globale: true,
    modalita_osservazione: true,
    budget_mensile_eur: 50,
    riserva_arricchimento_eur: 40,
    riserva_dialogo_eur: 10,
    modello_openai: 'gpt-5.6-luna',
    usd_to_eur: 1,
    prezzi_openai: { 'gpt-5.6-luna': { input: 0.20, output: 1.20, web_search: 0.01 } },
    soglie_budget: [70, 85, 95, 100],
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
    max_chiamate_openai_ora: 120,
    conferme_ore: ['09:00', '11:30', '15:30', '18:00'],
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
    notifiche_immediate: { budget: true }
  };
}

function taskAttivo(tipo, extra) {
  return {
    id: 't1',
    data: '2026-08-27',
    operatore_id: PROFILO,
    tipo,
    sorgente_id: CHIAMATA,
    sorgente_tipo: 'chiamata',
    payload: { chiamata_id: CHIAMATA, anagrafica_id: null },
    stato: 'attivo',
    tentativi: 0,
    ...extra
  };
}

function mockFetchFor(routes) {
  const real = global.fetch;
  global.fetch = async (url, options) => {
    const key = String(url);
    for (const [match, handler] of routes) {
      if (key.includes(match)) return handler(url, options);
    }
    throw new Error('fetch non mockato: ' + key);
  };
  return () => { global.fetch = real; };
}

function telegramOk() {
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
}

function openaiOkPayload() {
  return {
    id: 'resp_1',
    status: 'completed',
    usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 },
    output: [
      { type: 'web_search_call', id: 'w1', action: { sources: [{ url: 'https://fonte1.it/azienda', title: 'Fonte 1' }] } },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ email: 'info@esempio.it', telefono: '0456020222', telefono_extra: null, sito_internet: 'https://esempio.it', indirizzo: 'Via Roma 1', cap: '37045', localita: 'Legnago', categoria: 'Ferramenta', partita_iva: null, affidabilita: 0.9 }) }] }
    ]
  };
}

// =============================================================================
// Tempo (Europe/Rome, DST-safe)
// =============================================================================

test('romeToUtc: offset invernale ed estivo', () => {
  assert.equal(time.romeToUtc('2026-01-15', '09:30').toISOString(), '2026-01-15T08:30:00.000Z');
  assert.equal(time.romeToUtc('2026-07-15', '09:30').toISOString(), '2026-07-15T07:30:00.000Z');
});

test('addDaysStr attraversa il mese', () => {
  assert.equal(time.addDaysStr('2026-08-31', 1), '2026-09-01');
});

test('romeDayRange ritorna UTC corretto', () => {
  const range = time.romeDayRange('2026-07-15');
  assert.equal(range.start.toISOString(), '2026-07-14T22:00:00.000Z');
  assert.equal(range.end.toISOString(), '2026-07-15T22:00:00.000Z');
});

test('isWorkingDay esclude domenica e include lunedi', () => {
  assert.equal(time.isWorkingDay('2026-08-23', [1, 2, 3, 4, 5]), false);
  assert.equal(time.isWorkingDay('2026-08-24', [1, 2, 3, 4, 5]), true);
});

test('parseHHmm accetta e rifiuta formati', () => {
  assert.equal(time.parseHHmm('09:00'), 540);
  assert.equal(time.parseHHmm('25:00'), null);
  assert.equal(time.parseHHmm('9:00'), 540);
});

// =============================================================================
// Util: cleanLog STRUTTURATO (problema #1) + sanitizzazione
// =============================================================================

test('cleanLog preserva oggetti e array (JSONB strutturato)', () => {
  const out = util.cleanLog({ testo: 'riga 1\nriga 2', numeri: [1, 2, 3], nested: { a: true } });
  assert.equal(typeof out, 'object');
  assert.equal(out.testo, 'riga 1\nriga 2');
  assert.deepEqual(out.numeri, [1, 2, 3]);
  assert.equal(out.nested.a, true);
});

test('cleanLog maschera PII e droppa chiavi segrete', () => {
  const out = util.cleanLog({
    nome: 'Tizio Caio',
    telefono: '333 123 4567',
    email: 'pino@esempio.it',
    cf: 'RSSMRA80A01H501U',
    piva: '01234567890',
    refresh_token: 'tokensegreto',
    password: 'secret',
    ok: true
  });
  assert.ok(!String(out.telefono).includes('333 123 4567'));
  assert.ok(!String(out.email).includes('pino@esempio.it'));
  assert.ok(!String(out.cf).includes('RSSMRA80A01H501U'));
  assert.ok(!String(out.piva).includes('01234567890'));
  assert.equal(out.refresh_token, undefined);
  assert.equal(out.password, undefined);
  assert.equal(out.ok, true);
});

test('cleanLog gestisce cicli e profondita', () => {
  const obj = { a: 1 };
  obj.self = obj;
  const out = util.cleanLog(obj);
  assert.equal(out.a, 1);
  assert.equal(out.self, '[circolare]');
  const deep = util.cleanLog({ l1: { l2: { l3: { l4: { l5: { l6: { l7: 'x' } } } } } } }, { maxDepth: 4 });
  assert.equal(deep.l1.l2.l3.l4.l5, '[profondita]');
});

test('isUuid/parseBoolean/safeProfileId', () => {
  assert.equal(util.isUuid(PROFILO), true);
  assert.equal(util.isUuid('no'), false);
  assert.equal(util.parseBoolean('SI'), true);
  assert.equal(util.parseBoolean('no'), false);
  assert.equal(util.safeProfileId({ id: CHIAMATA, alias_di: PROFILO }, {}), PROFILO);
});

test('parseJson accetta sia testo JSON sia JSONB gia deserializzato', () => {
  const jsonb = { a: 1, nested: { ok: true } };
  assert.equal(util.parseJson('{"a":1}').a, 1);
  assert.equal(util.parseJson(jsonb), jsonb);
  assert.deepEqual(util.parseJson(['lun', 'mar']), ['lun', 'mar']);
});

// =============================================================================
// Config
// =============================================================================

test('default: nasce disattivato, osservazione, prezzi ufficiali, soglia 50', () => {
  assert.equal(config.CONFIG_DEFAULTS.attivo_globale, false);
  assert.equal(config.CONFIG_DEFAULTS.modalita_osservazione, true);
  assert.equal(config.CONFIG_DEFAULTS.budget_mensile_eur, 50);
  assert.equal(config.CONFIG_DEFAULTS.soglia_lead_minime, 50);
  assert.equal(config.CONFIG_DEFAULTS.prezzi_openai['gpt-5.6-luna'].input, 0.20);
  assert.equal(config.CONFIG_DEFAULTS.prezzi_openai['gpt-5.6-luna'].output, 1.20);
  assert.equal(config.CONFIG_DEFAULTS.prezzi_openai['gpt-5.6-luna'].web_search, 0.01);
  assert.equal(config.CONFIG_DEFAULTS.orario_stop_business, '18:00');
});

test('envHardEnabled: richiede true esplicito e altrimenti blocca', () => {
  const prev = process.env.KONA_CALL_DIRECTOR_ENABLED;
  process.env.KONA_CALL_DIRECTOR_ENABLED = 'true';
  assert.equal(config.envHardEnabled(), true);
  process.env.KONA_CALL_DIRECTOR_ENABLED = 'false';
  assert.equal(config.envHardEnabled(), false);
  delete process.env.KONA_CALL_DIRECTOR_ENABLED;
  assert.equal(config.envHardEnabled(), false);
  if (prev === undefined) delete process.env.KONA_CALL_DIRECTOR_ENABLED;
  else process.env.KONA_CALL_DIRECTOR_ENABLED = prev;
});

// =============================================================================
// Crypto
// =============================================================================

test('crypto roundtrip AES-GCM', () => {
  const prev = process.env.KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY;
  process.env.KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY = 'a'.repeat(64);
  const enc = cryptoLib.encryptSecret('refresh-token-1');
  assert.equal(cryptoLib.decryptSecret(enc), 'refresh-token-1');
  process.env.KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY = 'b'.repeat(64);
  assert.equal(cryptoLib.decryptSecret(enc), null);
  if (prev) process.env.KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY = prev; else delete process.env.KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY;
});

// =============================================================================
// Budget: DTO unico, hard stop, riserve, soglie
// =============================================================================

test('budgetSnapshot: DTO unico per API/UI/report/Telegram', async () => {
  const db = makeSupabase({
    'kona_call_director_budget_log.select': () => ({ data: [
      { attivita: 'arricchimento', costo_stimato_eur: 2.5, web_ricerche: 3 },
      { attivita: 'dialogo', costo_stimato_eur: 1.25, web_ricerche: 0 },
      { attivita: 'piano', costo_stimato_eur: 0.5, web_ricerche: 0 },
      { attivita: 'analisi', costo_stimato_eur: 0.75, web_ricerche: 0 },
      { attivita: 'altro', costo_stimato_eur: 0.25, web_ricerche: 0 }
    ] }),
    'kona_call_director_budget_riserve.select': () => ({ data: [{ importo_eur: 0.5 }] })
  });
  const snap = await budget.budgetSnapshot(db, baseCfg(), '2026-08');
  assert.equal(snap.mese, '2026-08');
  assert.equal(snap.budget, 50);
  assert.equal(snap.speso, 5.25);
  assert.equal(snap.riservato, 0.5);
  assert.equal(snap.rimasto, 44.25);
  assert.equal(snap.percentuale, 10.5);
  assert.deepEqual(snap.per_attivita, { arricchimento: 2.5, dialogo: 1.25, piano: 0.5, analisi: 0.75, altro: 0.25 });
  assert.equal(snap.web_ricerche, 3);
  assert.equal(snap.riserva_arricchimento.rimasto, 37.5);
  assert.equal(snap.riserva_dialogo.speso, 2.75);
  assert.equal(snap.riserva_dialogo.rimasto, 7.25);
  assert.deepEqual(snap.extra, { piani: 0.5, analisi: 0.75, altro: 0.25 });
});

test('migration 072: gli indici di retry rispettano fallita/fallito dei CHECK', () => {
  const migrazione = fs.readFileSync(path.resolve(__dirname, '..', 'database/072_kona_call_director.sql'), 'utf8');
  assert.match(migrazione, /idx_kona_call_director_notifiche_coda[\s\S]*?WHERE stato IN \('in_coda','fallita'\);/);
  assert.match(migrazione, /idx_kona_call_director_jobs_coda[\s\S]*?WHERE stato IN \('in_coda','fallito'\);/);
});

test('migration 072: la config aggiorna aggiornato_at senza cercare updated_at', () => {
  const migrazione = fs.readFileSync(path.resolve(__dirname, '..', 'database/072_kona_call_director.sql'), 'utf8');
  assert.match(migrazione, /kona_call_director_touch_config_aggiornato_at\(\)[\s\S]*?NEW\.aggiornato_at := now\(\);/);
  assert.match(migrazione, /trg_kona_cd_config_updated_at[\s\S]*?EXECUTE FUNCTION public\.kona_call_director_touch_config_aggiornato_at\(\);/);
});

test('migration 073: aggiunge solo l esito Consumer appuntamento al CHECK', () => {
  const migrazione = fs.readFileSync(path.resolve(__dirname, '..', 'database/073_kona_call_director_consumer_appuntamento.sql'), 'utf8');
  assert.match(migrazione, /ALTER TABLE public\.kona_call_director_sessione_attivita[\s\S]*ADD CONSTRAINT kona_call_director_sessione_attivita_esito_check/);
  assert.match(migrazione, /'altro',[\s\S]*'appuntamento'/);
  assert.doesNotMatch(migrazione, /DROP\s+(?:TABLE|COLUMN)/i);
});

test('bootstrap staging: il login legge solo il proprio profilo', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'staging', '003_kona_call_director_bootstrap.sql'), 'utf8');
  assert.match(sql, /GRANT SELECT ON TABLE public\.profili TO authenticated/i);
  assert.match(sql, /CREATE POLICY profili_select_proprio_staging[\s\S]*FOR SELECT[\s\S]*TO authenticated[\s\S]*USING \(id = auth\.uid\(\)\)/i);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|ALL) ON TABLE public\.kona_call_director_/i);
});

test('tryReserveBudget: hard stop quando il budget totale e\' esaurito', async () => {
  let chiamate = 0;
  const db = makeSupabase({
    'rpc.kona_cd_reserve_budget_v1': ({ params }) => {
      chiamate += 1;
      assert.equal(params.p_importo_eur, 1);
      return { data: { ok: false, motivo: 'hard_stop' }, error: null };
    }
  });
  const esito = await budget.tryReserveBudget({ supabase: db, cfg: baseCfg(), mese: '2026-08', attivita: 'arricchimento', importoEur: 1, chiave: 'k1' });
  assert.equal(esito.ok, false);
  assert.equal(esito.motivo, 'hard_stop');
  assert.equal(chiamate, 1);
});

test('tryReserveBudget: prenota e libera/consuma', async () => {
  let prenotazioni = 0;
  const db = makeSupabase({
    'rpc.kona_cd_reserve_budget_v1': () => { prenotazioni += 1; return { data: { ok: true, disponibile: 8 }, error: null }; },
    'kona_call_director_budget_riserve.update': () => ({ data: [], error: null })
  });
  const esito = await budget.tryReserveBudget({ supabase: db, cfg: baseCfg(), mese: '2026-08', attivita: 'dialogo', importoEur: 2, chiave: 'k2' });
  assert.equal(esito.ok, true);
  assert.equal(prenotazioni, 1);
  await budget.liberaRiserva(db, 'k2');
});

test('alert budget 70/85/95/100 deduplicati', () => {
  const snapshot = { percentuale: 90, soglie_budget: [70, 85, 95, 100] };
  assert.deepEqual(budget._test.newlyCrossedThresholds(snapshot, [70]), [85]);
  assert.deepEqual(budget._test.newlyCrossedThresholds({ percentuale: 100, soglie_budget: [70, 85, 95, 100] }, [70, 85, 95]), [100]);
  assert.deepEqual(budget._test.newlyCrossedThresholds({ percentuale: 50, soglie_budget: [70, 85, 95, 100] }, []), []);
});

test('riservaCopre', () => {
  const r = budget.riservaCopre({ rimasto: 12.5 }, 3.2);
  assert.equal(r.ok, true);
  assert.equal(r.rimasto, 12.5);
  assert.equal(budget.round6(0.0001234), 0.000123);
});

// =============================================================================
// OpenAI: fail-safe, prenotazione, fonti reali
// =============================================================================

test('estimateCost fail-safe per prezzo/modello sconosciuto', () => {
  const cfg = { usd_to_eur: 1, prezzi_openai: { 'gpt-5.6-luna': { input: 0.2, output: 1.2, web_search: 0.01 } } };
  const ok = openai._test.estimateCost(cfg, 'gpt-5.6-luna', { input_tokens: 1000, output_tokens: 100 }, 1);
  assert.equal(ok.ok, true);
  assert.equal(openai._test.estimateCost({ prezzi_openai: {} }, 'unknown', { input_tokens: 1, output_tokens: 1 }, 0).ok, false);
  assert.equal(openai._test.estimatePotential({ prezzi_openai: {} }, 'unknown', {}).ok, false);
});

test('webSearchSources estrae le fonti REALI dall\'API', () => {
  const payload = { output: [{ type: 'web_search_call', action: { sources: [{ url: 'https://a.it', title: 'A' }] } }, { type: 'message', content: [] }] };
  const src = openai._test.webSearchSources(payload);
  assert.equal(src.length, 1);
  assert.equal(src[0].url, 'https://a.it');
});

test('validateStructured richiede i campi obbligatori', () => {
  const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };
  assert.equal(openai._test.validateStructured({ a: 'x' }, schema).ok, true);
  assert.equal(openai._test.validateStructured({ b: 'y' }, schema).ok, false);
  assert.equal(openai._test.validateStructured('x', schema).ok, false);
});

test('openaiStructured: successo + log budget + prenotazione', async () => {
  let requestBody = null;
  const restore = mockFetchFor([['api.openai.com', (_url, options) => {
    requestBody = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => openaiOkPayload() };
  }]]);
  const prevKey = process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
  process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = 'test-key';
  const inserted = [];
  const db = makeSupabase({
    'kona_call_director_budget_riserve.insert': () => ({ data: null, error: null }),
    'kona_call_director_budget_riserve.update': () => ({ data: null, error: null }),
    'kona_call_director_budget_log.insert': (q) => { inserted.push(q.value); return { data: null, error: null }; },
    'kona_call_director_budget_log.select': () => ({ count: 0, data: null, error: null })
  });
  const cfg = baseCfg();
  const schema = { type: 'object', properties: { email: { type: ['string', 'null'] }, telefono: { type: ['string', 'null'] }, telefono_extra: { type: ['string', 'null'] }, sito_internet: { type: ['string', 'null'] }, indirizzo: { type: ['string', 'null'] }, cap: { type: ['string', 'null'] }, localita: { type: ['string', 'null'] }, categoria: { type: ['string', 'null'] }, partita_iva: { type: ['string', 'null'] }, affidabilita: { type: 'number' } }, required: ['email', 'telefono', 'telefono_extra', 'sito_internet', 'indirizzo', 'cap', 'localita', 'categoria', 'partita_iva', 'affidabilita'], additionalProperties: false };
  const res = await openai.openaiStructured({ supabase: db, cfg, activity: 'arricchimento', name: 'kona_lead_enrichment', instructions: 'x', input: '{}', schema, webSearch: true, maxToolCalls: 2 });
  assert.equal(res.ok, true);
  assert.equal(res.webCount, 1);
  assert.equal(res.webSources.length, 1);
  assert.equal(res.webSources[0].url, 'https://fonte1.it/azienda');
  assert.ok(res.costEur > 0);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].attivita, 'arricchimento');
  assert.equal(requestBody.max_tool_calls, 2);
  assert.deepEqual(requestBody.include, ['web_search_call.action.sources']);
  assert.deepEqual(requestBody.tools, [{ type: 'web_search_preview' }]);
  restore();
  if (prevKey) process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = prevKey; else delete process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
});

test('openaiStructured: budget esaurito blocca PRIMA della chiamata', async () => {
  const prevKey = process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
  process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = 'test-key';
  let chiamate = 0;
  const db = makeSupabase({
    'rpc.kona_cd_reserve_budget_v1': () => ({ data: { ok: false, motivo: 'hard_stop' }, error: null }),
    'kona_call_director_budget_log.select': () => ({ count: 0, data: null, error: null }),
    'kona_call_director_budget_log.insert': () => { chiamate += 1; return { data: null, error: null }; }
  });
  const cfg = baseCfg();
  cfg.budget_mensile_eur = 0; // budget a zero
  const restore = mockFetchFor([['api.openai.com', () => { throw new Error('non deve chiamare'); }]]);
  const res = await openai.openaiStructured({ supabase: db, cfg, activity: 'arricchimento', name: 't', instructions: 'x', input: '{}', schema: { type: 'object', properties: {}, required: [], additionalProperties: false }, webSearch: false });
  assert.equal(res.ok, false);
  assert.ok(['budget_esaurito', 'budget_non_disponibile', 'hard_stop'].includes(res.error_code));
  restore();
  if (prevKey) process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = prevKey; else delete process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
});

test('openaiStructured: prezzo sconosciuto -> budget_prezzo_ignoto', async () => {
  const prevKey = process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
  process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = 'test-key';
  const db = makeSupabase({ 'kona_call_director_budget_log.insert': () => ({ data: null, error: null }) });
  const cfg = baseCfg();
  cfg.prezzi_openai = {};
  const res = await openai.openaiStructured({ supabase: db, cfg, activity: 'arricchimento', name: 't', instructions: 'x', input: '{}', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } });
  assert.equal(res.ok, false);
  assert.equal(res.error_code, 'budget_prezzo_ignoto');
  if (prevKey) process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = prevKey; else delete process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
});

test('openaiStructured: JSON non valido -> invalid_json', async () => {
  const restore = mockFetchFor([['api.openai.com', () => ({ ok: true, status: 200, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'non-json' }] }] }) })]]);
  const prevKey = process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
  process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = 'test-key';
  const db = makeSupabase({
    'kona_call_director_budget_log.select': () => ({ count: 0, data: null, error: null }),
    'kona_call_director_budget_log.insert': () => ({ data: null, error: null }),
    'kona_call_director_budget_riserve.insert': () => ({ data: null, error: null }),
    'kona_call_director_budget_riserve.update': () => ({ data: null, error: null })
  });
  const res = await openai.openaiStructured({ supabase: db, cfg: baseCfg(), activity: 'dialogo', name: 't', instructions: 'x', input: '{}', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } });
  assert.equal(res.ok, false);
  assert.equal(res.error_code, 'invalid_json');
  restore();
  if (prevKey) process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = prevKey; else delete process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
});

test('openaiStructured: chiave assente -> no_api_key (nessuna rete)', async () => {
  const prevKey = process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
  delete process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY;
  const db = makeSupabase({});
  const res = await openai.openaiStructured({ supabase: db, cfg: baseCfg(), activity: 'analisi', name: 't', instructions: 'x', input: '{}', schema: { type: 'object', properties: {}, required: [], additionalProperties: false } });
  assert.equal(res.ok, false);
  assert.equal(res.error_code, 'no_api_key');
  if (prevKey) process.env.KONA_CALL_DIRECTOR_OPENAI_API_KEY = prevKey;
});

// =============================================================================
// Conferme
// =============================================================================

test('finestreConferme ordina e parsa le ore', () => {
  const f = conferme.finestreConferme({ conferme_ore: ['15:30', '09:00', '18:00', '11:30'] });
  assert.deepEqual(f.map((w) => w.orario), ['09:00', '11:30', '15:30', '18:00']);
});

test('finestraAttiva seleziona la finestra corrente', () => {
  const cfg = { conferme_ore: ['09:00', '11:30', '15:30', '18:00'] };
  assert.equal(conferme.finestraAttiva(cfg, { hh: 8, mm: 59 }), null);
  assert.equal(conferme.finestraAttiva(cfg, { hh: 9, mm: 0 }).orario, '09:00');
  assert.equal(conferme.finestraAttiva(cfg, { hh: 12, mm: 0 }).orario, '11:30');
  assert.equal(conferme.finestraAttiva(cfg, { hh: 18, mm: 0 }).orario, '18:00');
});

test('tentativoEsaurito: soglia = numero finestre (4)', () => {
  const cfg = { conferme_ore: ['09:00', '11:30', '15:30', '18:00'] };
  assert.equal(conferme.tentativoEsaurito(cfg, 3), false);
  assert.equal(conferme.tentativoEsaurito(cfg, 4), true);
});

// =============================================================================
// Arricchimento
// =============================================================================

test('validaCampo: email/PIVA/CAP/telefono/sito', () => {
  assert.equal(arr.validaCampo('email', 'X@Y.IT'), 'x@y.it');
  assert.equal(arr.validaCampo('email', 'no'), null);
  assert.equal(arr.validaCampo('partita_iva', '01234567890'), '01234567890');
  assert.equal(arr.validaCampo('cap', '37045'), '37045');
  assert.equal(arr.validaCampo('telefono', '045 602 02 22'), '0456020222');
  assert.equal(arr.validaCampo('telefono_raw', '0456020222'), '0456020222');
  assert.equal(arr.validaCampo('sito_internet', 'javascript:alert(1)'), null);
});

test('campiMancanti: telefono_raw e\' il campo sorgente', () => {
  const lead = { email: '', sito_internet: '', indirizzo: 'Via X', cap: '37045', localita: 'Legnago', categoria: 'Ferramenta', telefono_raw: '0456020222', partita_iva: '01234567890', codice_fiscale: 'RSSMRA80A01H501U' };
  assert.deepEqual(arr.campiMancanti(lead), ['email', 'sito_internet']);
});

test('applicaValori: mai sovrascrivere i valori esistenti', () => {
  const lead = { email: '', telefono_raw: '0456020222', categoria: 'Ferramenta' };
  const { patch, valoriApplicati } = arr.applicaValori(lead, { email: 'nuova@esempio.it', telefono_raw: '3339998888', categoria: 'Altro' });
  assert.deepEqual(patch, { email: 'nuova@esempio.it' });
  assert.equal(patch.telefono_raw, undefined);
  assert.deepEqual(valoriApplicati, { email: 'nuova@esempio.it' });
});

test('startArricchimento: solo lead chiamabili e incompleti, dedup job, soglia 50', async () => {
  const created = [];
  const db = makeSupabase({
    'kona_call_director_arricchimenti.select': () => ({ data: [] }),
    'kona_call_director_jobs.select': () => ({ data: [{ payload: { lead_id: 'lead-gia-in-coda' } }] }),
    'call_center_lead_outbound.select': () => ({
      data: [
        { id: 'lead-incompleto', created_at: '2026-08-01', telefono_raw: '0456020222', email: null, sito_internet: '', indirizzo: '', cap: '', localita: '', categoria: '', partita_iva: '', codice_fiscale: '' },
        { id: 'lead-completo', created_at: '2026-08-02', telefono_raw: '0456020222', email: 'a@b.it', sito_internet: 'https://x.it', indirizzo: 'Via X', cap: '37045', localita: 'Legnago', categoria: 'Bar', partita_iva: '01234567890', codice_fiscale: 'RSSMRA80A01H501U' },
        { id: 'lead-gia-in-coda', created_at: '2026-08-03', telefono_raw: '', email: '', sito_internet: '', indirizzo: '', cap: '', localita: '', categoria: '', partita_iva: '', codice_fiscale: '' }
      ]
    }),
    'kona_call_director_jobs.insert': (q) => { created.push(q.value); return { data: null, error: null }; }
  });
  const res = await arr.startArricchimento(db, baseCfg(), '2026-08-27');
  assert.equal(res.ok, true);
  // solo il lead incompleto e non in coda
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.lead_id, 'lead-incompleto');
  assert.equal(res.anomalia, true); // 1 < soglia 50
});

test('acquireJob: pick atomico + lease recovery', async () => {
  const db = makeSupabase({
    'rpc.kona_cd_acquire_job_v1': () => ({ data: [{ id: 'j1', stato: 'in_corso' }], error: null })
  });
  const job = await arr.acquireJob(db, { tipo: 'arricchimento_batch', leaseOwner: 'dispatcher' });
  assert.equal(job.id, 'j1');
});

test('acquireJob: nessun job acquisibile -> null', async () => {
  const db = makeSupabase({
    'rpc.kona_cd_acquire_job_v1': () => ({ data: [], error: null })
  });
  const job = await arr.acquireJob(db, { tipo: 'arricchimento_batch', leaseOwner: 'dispatcher' });
  assert.equal(job, null);
});

// =============================================================================
// Retention / Notifiche / Telegram
// =============================================================================

test('giorniPer usa la config con fallback', () => {
  assert.equal(ret.giorniPer(baseCfg(), 'retention_arricchimenti_giorni'), 180);
  assert.equal(ret.giorniPer({}, 'retention_arricchimenti_giorni'), 180);
});

test('retention: elimina per colonna corretta', async () => {
  const db = makeSupabase({
    'kona_call_director_task.select': (q) => (q.head ? { count: 2, error: null } : { data: [], error: null }),
    'kona_call_director_task.delete': () => ({ data: null, error: null })
  });
  const res = await ret.purga(db, 'kona_call_director_task', 'created_at', '2026-01-01T00:00:00Z');
  assert.equal(res.eliminati, 2);
});

test('sanitizeForTelegram preserva le newline e maschera PII', () => {
  const out = telegram.sanitizeForTelegram('Riga 1\nRiga 2\nTel 333 123 4567');
  assert.ok(out.includes('Riga 1\nRiga 2'));
  assert.ok(!out.includes('333 123 4567'));
});

test('timingSafeEqualText', () => {
  assert.equal(telegram._test.timingSafeEqualText('s', 's'), true);
  assert.equal(telegram._test.timingSafeEqualText('a', 'bb'), false);
});

test('enqueueNotifica rifiuta testo vuoto', async () => {
  const db = makeSupabase({ 'kona_call_director_notifiche.upsert': () => ({ data: null, error: null }) });
  const bad = await notif.enqueueNotifica(db, { dedupeKey: 'k', testo: '   ' });
  assert.equal(bad.ok, false);
});

test('flusso notifica -> worker -> invio Telegram', async () => {
  const restore = mockFetchFor([['api.telegram.org', telegramOk]]);
  const prevToken = process.env.KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN;
  const prevOwner = process.env.KONA_CALL_DIRECTOR_OWNER_CHAT_ID;
  process.env.KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN = 'bot';
  process.env.KONA_CALL_DIRECTOR_OWNER_CHAT_ID = '12345';
  const db = makeSupabase({
    'kona_call_director_notifiche.select': () => ({ data: [{ id: 'n1', stato: 'in_coda', tentativi: 0, payload: { testo: 'Report senza PII' }, prossimo_tentativo_at: '2026-08-27T00:00:00Z' }] }),
    'kona_call_director_notifiche.update': () => ({ data: [{ id: 'n1' }], error: null })
  });
  const res = await notif.processaNotifiche(db, { limite: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.inviate, 1);
  restore();
  if (prevToken) process.env.KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN = prevToken; else delete process.env.KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN;
  if (prevOwner) process.env.KONA_CALL_DIRECTOR_OWNER_CHAT_ID = prevOwner; else delete process.env.KONA_CALL_DIRECTOR_OWNER_CHAT_ID;
});

// =============================================================================
// Google: slot, verify fail-closed, distanze
// =============================================================================

test('computeSlots: giorni lavorativi, buffer, niente slot passati', () => {
  const cfg = baseCfg();
  const slots = google._test.computeSlots({
    cfg, dataInizio: '2026-08-24', giorni: 3,
    busyIntervals: [{ start: '2026-08-24T07:00:00Z', end: '2026-08-24T10:00:00Z' }],
    bufferMinuti: 15, now: Date.UTC(2026, 7, 24, 6, 0, 0)
  });
  const lun = slots.filter((s) => s.giorno === '2026-08-24');
  assert.ok(lun.every((s) => new Date(s.start).getTime() >= Date.parse('2026-08-24T10:00:00Z')));
});

test('computeSlots: quattordici giorni espongono almeno dieci date lavorative', () => {
  const cfg = baseCfg();
  const slots = google._test.computeSlots({
    cfg, dataInizio: '2026-08-31', giorni: 14,
    busyIntervals: [], bufferMinuti: 15, now: Date.UTC(2026, 7, 30, 6, 0, 0)
  });
  assert.ok(new Set(slots.map((s) => s.giorno)).size >= 10);
});

test('verifySlotAvailability: senza token -> no_token; errore FreeBusy -> fail-closed', async () => {
  const cfg = baseCfg();
  const noToken = await google.verifySlotAvailability({ supabase: makeSupabase({}), cfg, start: '2026-08-27T09:00:00Z', end: '2026-08-27T09:45:00Z', accessToken: null });
  assert.equal(noToken.ok, false);
  assert.equal(noToken.reason, 'no_token');
  const googleError = await google.verifySlotAvailability({ supabase: makeSupabase({}), cfg, start: '2026-08-27T09:00:00Z', end: '2026-08-27T09:45:00Z', accessToken: 'tok' });
  assert.equal(googleError.ok, false);
  assert.equal(googleError.reason, 'google_unavailable');
});

test('verifySlotAvailability: appuntamento iniziato prima dello slot ancora in corso', async () => {
  const restore = mockFetchFor([['googleapis.com', () => ({ ok: true, status: 200, json: async () => ({ calendars: { primary: { busy: [] } } }) })]]);
  const cfg = baseCfg();
  const busy = { start: '2026-08-27T08:30:00Z', end: '2026-08-27T09:10:00Z' };
  const res = await google.verifySlotAvailability({
    supabase: makeSupabase({}),
    cfg,
    start: '2026-08-27T09:00:00Z',
    end: '2026-08-27T09:45:00Z',
    accessToken: 'tok',
    appuntamentiConflitto: [{ data_ora: busy.start, data_ora_fine: busy.end }]
  });
  // Con freeBusy vuoto, l'appuntamento Mirox iniziato alle 08:30 e ancora in
  // corso alle 09:00 deve bloccare lo slot (conflitto con buffer).
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'conflitto_mirox');
  restore();
});

test('distanze: stesso comune -> 0, dataset assente -> null', async () => {
  const db = makeSupabase({ 'kona_call_director_comuni.select': () => ({ data: [] }) });
  assert.equal(await dist.distanzaKm(db, 'Legnago', 'Legnago'), 0);
  assert.equal(await dist.distanzaKm(db, 'Legnago', 'Cerea'), null);
  assert.equal(dist._test.cacheKey('Legnago', 'VR'), 'legnago|vr');
});

// =============================================================================
// Motore: blacklist fail-closed, esclusioni, tentativi persistenti
// =============================================================================

test('normTel e telefoniUnici', () => {
  assert.equal(engine._test.normTel('+39 333 123 4567'), '3331234567');
  assert.equal(engine._test.normTel('045 602 02 22'), '0456020222');
  assert.deepEqual(engine._test.telefoniUnici(['+39 333 123 4567', '3331234567', null]), ['3331234567']);
});

test('pureBlacklisted confronta CF e TUTTI i numeri', () => {
  const rows = [{ cf_piva: 'BBB', cellulare: '3330000000' }];
  assert.equal(engine._test.pureBlacklisted(rows, { cf_piva: 'bbb', telefoni: ['3331112222'] }), true);
  assert.equal(engine._test.pureBlacklisted(rows, { cf_piva: '', telefoni: ['3330000000'] }), true);
  assert.equal(engine._test.pureBlacklisted(rows, { cf_piva: '', telefoni: ['3331112222'] }), false);
});

test('pureEscluso matcha lead/anagrafica/chiamata', () => {
  const rows = [{ lead_id: LEAD, anagrafica_id: null, chiamata_id: null }];
  assert.equal(engine._test.pureEscluso(rows, { leadId: LEAD }), true);
  assert.equal(engine._test.pureEscluso(rows, { chiamataId: CHIAMATA }), false);
});

test('materializeNextTask: errore blacklist -> FAIL-CLOSED, nessun task', async () => {
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'blacklist.select': () => ({ data: null, error: { message: 'db giu' } }),
    'kona_call_director_task.insert': () => ({ data: { id: 't1' }, error: null })
  });
  const res = await engine.materializeNextTask({ supabase: db, cfg: baseCfg(), profiloId: PROFILO, oggi: '2026-08-27', oraParts: { hh: 10, mm: 0 } });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'blacklist_check_failed');
});

test('FLUSSO REALE: blacklist -> impossibile riproporre', async () => {
  // 1) materializza un candidato lead
  const blacklistRows = [];
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'blacklist.select': (q) => {
      // addBlacklist usa .eq('cf_piva') per il controllo esistenza -> non esistente
      const haFiltroCf = q.filters.some(([op, k]) => op === 'eq' && k === 'cf_piva');
      if (haFiltroCf) return { data: null };
      return { data: blacklistRows };
    },
    'kona_call_director_esclusioni.select': () => ({ data: [] }),
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] }),
    'chiamate.select': () => ({ data: [] }),
    'call_center_lead_outbound.select': () => ({
      data: [{ id: LEAD, ragione_sociale: 'Bar Roma', telefono_raw: '3331234567', telefono_norm: '', email: '', localita: '', provincia: '', categoria: 'Bar', partita_iva: '', codice_fiscale: 'BARROMA01G23H456Z', zona: '', stato_lead: 'nuovo', pinned: false, do_not_call: false, prossimo_followup_at: null, times_seen: 0, first_import_at: '2026-08-01' }]
    }),
    'kona_call_director_task.insert': () => ({ data: { id: 't1', tipo: 'sessione_business', sorgente_id: LEAD, sorgente_tipo: 'lead', operatore_id: PROFILO, payload: { lead_id: LEAD }, stato: 'attivo' }, error: null }),
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null }),
    'blacklist.insert': () => { blacklistRows.push({ cf_piva: 'BARROMA01G23H456Z', cellulare: '3331234567' }); return { data: null, error: null }; },
    'kona_call_director_esclusioni.insert': () => ({ data: null, error: null }),
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'call_center_lead_outbound.update': () => ({ data: [], error: null })
  });
  const primo = await engine.materializeNextTask({ supabase: db, cfg: baseCfg(), profiloId: PROFILO, oggi: '2026-08-27', oraParts: { hh: 10, mm: 0 } });
  assert.equal(primo.ok, true);

  // 2) l'operatrice segnala in blacklist (persistenza REALE)
  const task = primo.task;
  const esito = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task, profiloId: PROFILO, esito: 'blacklist', dettagli: { cf_piva: 'BARROMA01G23H456Z', telefoni: ['3331234567'], nome: 'Bar Roma' } });
  assert.equal(esito.ok, true);
  assert.equal(blacklistRows.length, 1); // inserita nella blacklist reale

  // 3) riproposizione -> bloccata (nessun nuovo task)
  const secondo = await engine.materializeNextTask({ supabase: db, cfg: baseCfg(), profiloId: PROFILO, oggi: '2026-08-27', oraParts: { hh: 10, mm: 0 } });
  assert.equal(secondo.ok, false);
  assert.equal(secondo.noop, true);
});

test('FLUSSO REALE: materializzazione -> non risposto -> esaurimento dopo 3 (tentativi persistenti)', async () => {
  let nonRispostiCount = 0;
  const db = makeSupabase({
    'kona_call_director_task.select': (q) => {
      const haEsitoNonRisposto = q.filters.some(([op, k, opv, val]) => op === 'filter' && k === 'esito->>esito' && val === 'non_risposto');
      if (haEsitoNonRisposto) return { data: Array.from({ length: nonRispostiCount }, (_, i) => ({ id: `prev-${i}` })) };
      return { data: null };
    },
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null }),
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'chiamate.select': () => ({ data: { id: CHIAMATA, operatore_id: PROFILO, operatore_nome: 'Isabella', cf_piva: 'CF1', nome_cliente: 'Cliente', cellulare: '3331112222', esito: 'ricontattare', motivo_chiamata: 'Richiamo' }, error: null }),
    'chiamate.insert': () => ({ data: { id: 'nuova-chiamata' }, error: null }),
    'chiamate.update': () => ({ data: [], error: null }),
    'blacklist.select': () => ({ data: [] }),
    'kona_call_director_esclusioni.select': () => ({ data: [] }),
    'kona_call_director_conferme.select': () => ({ count: 0, data: null, error: null })
  });
  const cfg = baseCfg();
  let esaurito = false;
  for (let i = 0; i < 3; i += 1) {
    nonRispostiCount = i; // 0, 1, 2 tentativi precedenti -> tentativo 1, 2, 3
    const res = await engine.registerEsito({ supabase: db, cfg, task: taskAttivo('ricontatto_programmato'), profiloId: PROFILO, esito: 'non_risposto', dettagli: {} });
    assert.equal(res.ok, true);
    assert.equal(res.tentativo, i + 1);
    if (i === 2) {
      assert.equal(res.esaurito, true);
      esaurito = true;
    }
  }
  assert.equal(esaurito, true);
});

test('FLUSSO REALE: conferma -> 4 tentativi -> Telegram -> NESSUN auto-cancel', async () => {
  const aggiornamentiBiz = [];
  const confermeInserite = [];
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'kona_call_director_conferme.select': () => ({ count: confermeInserite.length, data: null, error: null }),
    'kona_call_director_conferme.upsert': (q) => { confermeInserite.push(q.value); return { data: null, error: null }; },
    'kona_call_director_appuntamenti_business.update': (q) => { aggiornamentiBiz.push(q.value); return { data: [], error: null }; },
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null })
  });
  const cfg = baseCfg();
  const task = taskAttivo('conferma_appuntamento_business', {
    sorgente_tipo: 'appuntamento_business', sorgente_id: APP_BUSINESS,
    payload: { appuntamento_business_id: APP_BUSINESS, lead_id: LEAD, zona: 'Verona', data_ora: '2026-08-28T09:00:00Z' }
  });
  let notifica = false;
  for (let i = 0; i < 4; i += 1) {
    const res = await engine.registerEsito({ supabase: db, cfg, task, profiloId: PROFILO, esito: 'non_risposto', dettagli: {} });
    assert.equal(res.ok, true);
    assert.equal(res.tentativo, i + 1);
    if (res.notifica === 'conferma_non_risposti_esauriti') notifica = true;
  }
  assert.equal(notifica, true);
  // nessun auto-cancel: mai impostato stato 'annullato' sull'appuntamento
  assert.ok(!aggiornamentiBiz.some((p) => p.stato === 'annullato'));
});

test('registerEsito: esito non valido / skip senza spiegazione / ownership', async () => {
  const db = makeSupabase({});
  const bad = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task: taskAttivo('ricontatto_programmato'), profiloId: PROFILO, esito: 'foobar', dettagli: {} });
  assert.equal(bad.ok, false);
  const skip = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task: taskAttivo('ricontatto_programmato'), profiloId: PROFILO, esito: 'skip', dettagli: { skip_reason: 'altro', spiegazione: '' } });
  assert.equal(skip.ok, false);
  const altrui = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task: taskAttivo('ricontatto_programmato'), profiloId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', esito: 'non_risposto', dettagli: {} });
  assert.equal(altrui.ok, false);
  assert.equal(altrui.error, 'task_non_proprio');
});

test('sospensione/ripresa senza task multipli (indice unico attivo+sospeso)', async () => {
  // Il vincolo e' in migration (ux_kona_call_director_task_attivo su stato IN attivo,sospeso).
  const migrazione = fs.readFileSync(path.resolve(__dirname, '..', 'database/072_kona_call_director.sql'), 'utf8');
  const index = migrazione.match(/CREATE UNIQUE INDEX IF NOT EXISTS ux_kona_call_director_task_attivo[\s\S]*?WHERE stato IN \('attivo','sospeso'\);/);
  assert.ok(index, 'indice unico deve coprire attivo e sospeso');
  // getTaskLavorabile considera entrambi gli stati
  const db = makeSupabase({ 'kona_call_director_task.select': (q) => (q.mode === 'maybeSingle' && q.filters.some(([op, k]) => op === 'in' && k === 'stato') ? { data: { id: 't1', stato: 'sospeso' } } : { data: null }) });
  const lavorabile = await engine.getTaskLavorabile(db, PROFILO);
  assert.equal(lavorabile.stato, 'sospeso');
});

test('Business standard bloccato alle 18:00 (orario_stop_business)', async () => {
  // con stop a 00:00 l'ora corrente e' sempre >= -> nessun candidato sessione_business
  const cfg = baseCfg();
  cfg.orario_stop_business = '00:00';
  const db = makeSupabase({
    'call_center_lead_outbound.select': () => ({ data: [{ id: LEAD, ragione_sociale: 'A', telefono_raw: '333', telefono_norm: '', email: '', localita: '', provincia: '', categoria: 'Bar', partita_iva: '', codice_fiscale: '', zona: '', stato_lead: 'nuovo', pinned: false, do_not_call: false, prossimo_followup_at: null, times_seen: 0, first_import_at: '2026-08-01' }] }),
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] }),
    'chiamate.select': () => ({ data: [] }),
    'call_center_lead_outbound_chiamate.select': () => ({ data: [] }),
    'vw_rilavorazione_ricontatti_unificata.select': () => ({ data: [] })
  });
  const candidati = await engine.buildCandidates(db, cfg, { profiloId: PROFILO, oggi: '2026-08-27', oraParts: { hh: 10, mm: 0 } });
  assert.ok(!candidati.some((c) => c.tipo === 'sessione_business' && c.priority === 7));
});

test('Business standard bloccato senza categorie approvate nel piano', async () => {
  const cfg = baseCfg();
  cfg.orario_stop_business = null;
  let leadQueryEseguita = false;
  const db = makeSupabase({
    'kona_call_director_piani.select': () => ({ data: null, error: null }),
    'call_center_lead_outbound.select': () => {
      leadQueryEseguita = true;
      return { data: [{ id: LEAD, ragione_sociale: 'A', telefono_raw: '333', categoria: 'Bar', stato_lead: 'nuovo', pinned: false, do_not_call: false }] };
    }
  });
  const candidati = await engine.buildCandidates(db, cfg, { profiloId: PROFILO, oggi: '2026-08-27' });
  assert.equal(leadQueryEseguita, true, 'la campagna urgente continua a interrogare i lead pinned');
  assert.ok(!candidati.some((c) => c.tipo === 'sessione_business'));
});

test('Business standard usa esclusivamente le categorie del piano approvato', async () => {
  const cfg = baseCfg();
  cfg.orario_stop_business = null;
  let lettureLead = 0;
  const db = makeSupabase({
    'kona_call_director_piani.select': () => ({ data: { contenuto: { categorie_approvate: ['Bar'] }, stato: 'approvato' }, error: null }),
    'call_center_lead_outbound.select': (q) => {
      lettureLead += 1;
      if (q.filters.some(([op, key, value]) => op === 'eq' && key === 'pinned' && value === true)) return { data: [] };
      return { data: [
        { id: LEAD, ragione_sociale: 'Bar A', telefono_raw: '333', localita: 'Legnago', provincia: 'VR', categoria: 'Bar', stato_lead: 'nuovo', pinned: false, do_not_call: false },
        { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ragione_sociale: 'Studio B', telefono_raw: '334', localita: 'Legnago', provincia: 'VR', categoria: 'Commercialista', stato_lead: 'nuovo', pinned: false, do_not_call: false }
      ] };
    },
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] }),
    'kona_call_director_arricchimenti.select': () => ({ data: [] }),
    'kona_call_director_comuni.select': () => ({ data: [] })
  });
  const candidati = await engine.buildCandidates(db, cfg, { profiloId: PROFILO, oggi: '2026-08-27' });
  assert.ok(lettureLead >= 2);
  const standard = candidati.filter((c) => c.tipo === 'sessione_business');
  assert.equal(standard.length, 1);
  assert.equal(standard[0].nome, 'Bar A');
});

test('ricontatti dalla sorgente unificata (standard + outbound business)', async () => {
  const db = makeSupabase({
    'vw_rilavorazione_ricontatti_unificata.select': () => ({
      data: [
        { origine_tipo: 'standard', origine_id: CHIAMATA, lead_id: null, nome_cliente: 'Tizio', telefono: '3331112222', cf_piva: 'CF1', operatore_id: PROFILO, esito: 'ricontattare', data_ricontatto: null, fascia_ricontatto: null, motivo_chiamata: 'Telefono CB', note: 'Richiamare', data_ora: '2026-08-20T09:00:00Z', rilavorazione_stato: 'da_lavorare' },
        { origine_tipo: 'outbound_business', origine_id: 'e1', lead_id: LEAD, nome_cliente: 'Bar Roma', telefono: '3339998888', cf_piva: 'BARROMA01G23H456Z', operatore_id: PROFILO, esito: 'ricontattare', data_ricontatto: null, fascia_ricontatto: null, motivo_chiamata: 'Outbound business', note: null, data_ora: '2026-08-21T10:00:00Z', rilavorazione_stato: 'da_lavorare' }
      ]
    }),
    'chiamate.select': () => ({ data: [] }),
    'call_center_lead_outbound.select': () => ({ data: [] }),
    'call_center_lead_outbound_chiamate.select': () => ({ data: [] }),
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] })
  });
  const cfg = baseCfg();
  const candidati = await engine.buildCandidates(db, cfg, { profiloId: PROFILO, oggi: '2026-08-27', oraParts: { hh: 10, mm: 0 } });
  const ricontatti = candidati.filter((c) => c.tipo === 'ricontatto_programmato');
  assert.equal(ricontatti.length, 2);
  assert.ok(ricontatti.some((c) => c.sorgenteTipo === 'chiamata'));
  assert.ok(ricontatti.some((c) => c.sorgenteTipo === 'lead_outbound_chiamata'));
});

test('rilavorazioni KONA: non presentati e passaggi usano gli stessi filtri del manuale', async () => {
  let filtriAppuntamenti = [];
  let filtriPassaggi = [];
  const db = makeSupabase({
    'vw_rilavorazione_ricontatti_unificata.select': () => ({ data: [] }),
    'appuntamenti.select': (q) => {
      filtriAppuntamenti = q.filters;
      return { data: [{
        id: APP_BUSINESS, nome: 'Cliente Test', codice_fiscale: 'TSTKNA26A00Z001A', telefono: '0000001001',
        motivo: 'Appuntamento test', note: null, anagrafica_id: null, fissato_da_operatore_id: PROFILO,
        chiamata_id: CHIAMATA, data_ora: '2026-08-26T09:00:00Z', durata_minuti: 30,
        stato: 'confermato', presentato: 'no', non_presentato_stato: 'da_lavorare'
      }] };
    },
    'chiamate.select': (q) => {
      filtriPassaggi = q.filters;
      return { data: [{ id: CHIAMATA, cf_piva: 'CF1', nome_cliente: 'Passaggio Test', cellulare: '3331112222', anagrafica_id: null, esito: 'passa_in_negozio', passaggio_stato: 'in_attesa', data_ora: '2026-08-25T09:00:00Z' }] };
    },
    'call_center_lead_outbound.select': () => ({ data: [] }),
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] })
  });
  const candidati = await engine.buildCandidates(db, baseCfg(), { profiloId: PROFILO, oggi: '2026-08-27' });
  assert.ok(candidati.some((c) => c.tipo === 'non_presentato' && c.sorgenteTipo === 'appuntamento'));
  assert.ok(candidati.some((c) => c.tipo === 'passa_in_negozio'));
  assert.ok(filtriAppuntamenti.some(([op, key, value]) => op === 'eq' && key === 'presentato' && value === 'no'));
  assert.ok(filtriAppuntamenti.some(([op, key, value]) => op === 'eq' && key === 'non_presentato_stato' && value === 'da_lavorare'));
  assert.ok(filtriAppuntamenti.some(([op, key, value]) => op === 'eq' && key === 'stato' && value === 'confermato'));
  const filtroStati = filtriPassaggi.find(([op, key]) => op === 'in' && key === 'passaggio_stato');
  assert.deepEqual(filtroStati[2], ['in_attesa']);
});

test('rilavorazioni KONA: Presentato replica gli aggiornamenti manuali senza creare chiamate', async () => {
  const patchChiamate = [];
  const patchAppuntamenti = [];
  let nuoveChiamate = 0;
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'chiamate.update': (q) => { patchChiamate.push(q.value); return { data: [], error: null }; },
    'appuntamenti.update': (q) => { patchAppuntamenti.push(q.value); return { data: [], error: null }; },
    'chiamate.insert': () => { nuoveChiamate += 1; return { data: { id: 'nuova' }, error: null }; },
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null })
  });
  const passaggio = await engine.registerEsito({
    supabase: db, cfg: baseCfg(), task: taskAttivo('passa_a_cerea'), profiloId: PROFILO, esito: 'presentato', dettagli: {}
  });
  const nonPresentato = await engine.registerEsito({
    supabase: db, cfg: baseCfg(),
    task: taskAttivo('non_presentato', { sorgente_tipo: 'appuntamento', sorgente_id: APP_BUSINESS, payload: { appuntamento_id: APP_BUSINESS } }),
    profiloId: PROFILO, esito: 'presentato', dettagli: {}
  });
  assert.equal(passaggio.ok, true);
  assert.equal(nonPresentato.ok, true);
  assert.equal(nuoveChiamate, 0);
  assert.deepEqual(patchChiamate[0], { passaggio_stato: 'passato', rilavorazione_stato: 'completato' });
  assert.equal(patchAppuntamenti[0].presentato, 'si');
  assert.equal(patchAppuntamenti[0].non_presentato_stato, 'presentato');
  assert.ok(patchAppuntamenti[0].presentato_at);
});

test('rilavorazioni KONA: ricontatto di un non presentato crea la chiamata canonica e chiude la sorgente', async () => {
  const inserite = [];
  const patchAppuntamenti = [];
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'appuntamenti.select': () => ({ data: {
      id: APP_BUSINESS, nome: 'Cliente Test', codice_fiscale: 'TSTKNA26A00Z001A', telefono: '0000001001',
      motivo: 'Appuntamento test', note: 'Nota test', anagrafica_id: null, chiamata_id: CHIAMATA,
      fissato_da_nome: 'Isabella'
    }, error: null }),
    'chiamate.select': () => ({ data: { id: CHIAMATA, copertura: 'Fibra', motivo_chiamata: 'Motivo origine' }, error: null }),
    'profili.select': () => ({ data: { nome: 'Isabella' }, error: null }),
    'chiamate.insert': (q) => { inserite.push(q.value); return { data: { id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }, error: null }; },
    'appuntamenti.update': (q) => { patchAppuntamenti.push(q.value); return { data: [], error: null }; },
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null })
  });
  const task = taskAttivo('non_presentato', { sorgente_tipo: 'appuntamento', sorgente_id: APP_BUSINESS, payload: { appuntamento_id: APP_BUSINESS } });
  const res = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task, profiloId: PROFILO, esito: 'non_interessato', dettagli: { motivo: 'Non interessato' } });
  assert.equal(res.ok, true);
  assert.equal(inserite.length, 1);
  assert.equal(inserite[0].copertura, 'Fibra');
  assert.equal(inserite[0].rilavorazione_stato, 'completato');
  assert.deepEqual(patchAppuntamenti[0], { non_presentato_stato: 'lavorato' });
});

test('dettaglio contatto KONA mostra l indirizzo canonico dell anagrafica', async () => {
  const db = makeSupabase({
    'chiamate.select': () => ({ data: { id: CHIAMATA, nome_cliente: 'Cliente Test', cellulare: '3331234567', cf_piva: 'TSTKNA26A00Z001A', anagrafica_id: LEAD, esito: 'ricontattare' } }),
    'anagrafica.select': () => ({ data: { id: LEAD, cf_piva: 'TSTKNA26A00Z001A', comune: 'LEGNAGO', provincia: 'VR', via: 'VIA ROMA', civico: '10', email: 'test@example.test' } })
  });
  const dettaglio = await engine.getTaskDettaglio(db, taskAttivo('ricontatto_programmato', { payload: { anagrafica_id: LEAD } }));
  assert.equal(dettaglio.contatto.indirizzo, 'VIA ROMA 10');
  assert.equal(dettaglio.contatto.localita, 'LEGNAGO');
  assert.equal(dettaglio.contatto.provincia, 'VR');
});

test('esito Business: registra chiamata outbound + attivita\' + storico', async () => {
  const chiamateOutbound = [];
  const attivita = [];
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'profili.select': () => ({ data: { nome: 'Isabella' } }),
    'call_center_lead_outbound.select': () => ({ data: { id: LEAD, ragione_sociale: 'Bar Roma', telefono_raw: '3331234567', telefono_norm: '3331234567', localita: 'Legnago', provincia: 'VR' }, error: null }),
    'call_center_lead_outbound_chiamate.insert': (q) => { chiamateOutbound.push(q.value); return { data: { id: 'ch1' }, error: null }; },
    'call_center_lead_outbound_attivita.insert': (q) => { attivita.push(q.value); return { data: null, error: null }; },
    'call_center_lead_outbound.update': () => ({ data: [], error: null }),
    'call_center_lead_outbound_chiamate.update': () => ({ data: [], error: null }),
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null }),
    'kona_call_director_esclusioni.insert': () => ({ data: null, error: null }),
    'kona_call_director_conferme.select': () => ({ count: 0, data: null, error: null })
  });
  const task = taskAttivo('sessione_business', { sorgente_tipo: 'lead', sorgente_id: LEAD, payload: { lead_id: LEAD, zona: 'Legnago' } });
  const res = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task, profiloId: PROFILO, esito: 'non_interessato', dettagli: { motivo: 'Non interessato' } });
  assert.equal(res.ok, true);
  assert.equal(chiamateOutbound.length, 1);
  assert.equal(chiamateOutbound[0].esito, 'non_interessato');
  assert.equal(attivita.length, 1);
  assert.equal(attivita[0].tipo, 'esito');
});

test('esito Business Ricontattare: conserva data/fascia manuale e resta da lavorare', async () => {
  const chiamateOutbound = [];
  const db = makeSupabase({
    'kona_call_director_task.select': () => ({ data: null }),
    'profili.select': () => ({ data: { nome: 'Isabella' } }),
    'call_center_lead_outbound.select': () => ({ data: { id: LEAD, ragione_sociale: 'Bar Roma', telefono_raw: '3331234567', telefono_norm: '3331234567', localita: 'Legnago', provincia: 'VR' }, error: null }),
    'call_center_lead_outbound_chiamate.insert': (q) => { chiamateOutbound.push(q.value); return { data: { id: 'ch-ricontatto' }, error: null }; },
    'call_center_lead_outbound_attivita.insert': () => ({ data: null, error: null }),
    'call_center_lead_outbound.update': () => ({ data: [], error: null }),
    'kona_call_director_task.update': () => ({ data: { id: 't1' }, error: null }),
    'kona_call_director_task_eventi.insert': () => ({ data: null, error: null }),
    'kona_call_director_conferme.select': () => ({ count: 0, data: null, error: null })
  });
  const task = taskAttivo('sessione_business', { sorgente_tipo: 'lead', sorgente_id: LEAD, payload: { lead_id: LEAD } });
  const dettagli = { dettagli: { data_ricontatto: '2026-08-30', fascia_ricontatto: 'Pomeriggio' } };
  const res = await engine.registerEsito({ supabase: db, cfg: baseCfg(), task, profiloId: PROFILO, esito: 'ricontattare', dettagli });
  assert.equal(res.ok, true);
  assert.deepEqual(res.ricontatto, { data: '2026-08-30', fascia: 'Pomeriggio' });
  assert.equal(chiamateOutbound[0].data_ricontatto, '2026-08-30');
  assert.equal(chiamateOutbound[0].fascia_ricontatto, 'Pomeriggio');
  assert.equal(chiamateOutbound[0].rilavorazione_stato, 'da_lavorare');
});

test('esito conferma: dettaglio contatto completo senza eventi privati', async () => {
  const db = makeSupabase({
    'kona_call_director_appuntamenti_business.select': () => ({ data: { id: APP_BUSINESS, lead_id: LEAD, operatore_id: PROFILO, data_ora: '2026-08-28T09:00:00Z', durata_minuti: 45, zona: 'Verona', stato: 'proposto', sync_stato: 'sincronizzato', google_event_id: 'evt-1' } }),
    'call_center_lead_outbound.select': () => ({ data: { id: LEAD, ragione_sociale: 'Bar Roma', telefono_raw: '3331234567', telefono_norm: '3331234567', email: 'info@bar.it', localita: 'Verona', provincia: 'VR', categoria: 'Bar', partita_iva: null, codice_fiscale: 'BARROMA01G23H456Z', stato_lead: 'nuovo' } })
  });
  const task = taskAttivo('conferma_appuntamento_business', { sorgente_tipo: 'appuntamento_business', sorgente_id: APP_BUSINESS, payload: { appuntamento_business_id: APP_BUSINESS, lead_id: LEAD } });
  const dettaglio = await engine.getTaskDettaglio(db, task);
  assert.equal(dettaglio.contatto.nome, 'Bar Roma');
  assert.equal(dettaglio.contatto.cellulare, '3331234567');
  assert.equal(dettaglio.contatto.appuntamento.data_ora, '2026-08-28T09:00:00Z');
  assert.equal(dettaglio.contatto.appuntamento.sync_stato, 'sincronizzato');
  assert.equal(dettaglio.contatto.appuntamento.google_event_id, undefined); // mai esporre l'id privato
});

// =============================================================================
// Google OAuth state (nonce/expiry/single-use) + XSS callback
// =============================================================================

test('signState/verifyState: firma + scadenza + single-use', async () => {
  const g = require(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-google.js'));
  process.env.KONA_CALL_DIRECTOR_GOOGLE_CLIENT_SECRET = 'client-secret-test';
  const state = g.signState(PROFILO);
  const ok = g.verifyState(state);
  assert.equal(ok.pid, PROFILO.toLowerCase());
  assert.ok(ok.nonce);
  assert.equal(g.verifyState('bad'), null);
  assert.equal(g.verifyState(state.slice(0, -2) + 'xx'), null);
  // single-use
  const db = makeSupabase({
    'kona_call_director_oauth_stati.upsert': (q) => ({ data: null, error: q.value.nonce === 'usato' ? { message: 'conflict' } : null })
  });
  assert.equal(await g.consumaState(db, 'nuovo'), true);
});

test('callback Google: XSS riflesso prevenuto (error escapato)', async () => {
  const cb = require(path.resolve(__dirname, '..', 'netlify/functions/kona-cc-google-callback.js'));
  const res = await cb.handler({ rawUrl: 'https://x/.netlify/functions/kona-cc-google-callback?error=<script>alert(1)</script>' });
  assert.equal(res.statusCode, 400);
  assert.ok(!res.body.includes('<script>alert(1)</script>'));
  assert.ok(res.body.includes('&lt;script&gt;'));
});

// =============================================================================
// Report / piano
// =============================================================================

test('propostaPianoGiorno raggruppa per zona e ordina per numerosita', async () => {
  const db = makeSupabase({
    'kona_call_director_appuntamenti_business.select': () => ({
      data: [
        { id: 'a1', lead_id: LEAD, data_ora: '2026-08-27T08:30:00Z', durata_minuti: 45, zona: 'Verona', stato: 'proposto' },
        { id: 'a2', lead_id: LEAD, data_ora: '2026-08-27T09:30:00Z', durata_minuti: 45, zona: 'Verona', stato: 'proposto' },
        { id: 'a3', lead_id: LEAD, data_ora: '2026-08-27T10:30:00Z', durata_minuti: 45, zona: 'Legnago', stato: 'confermato' }
      ]
    }),
    'call_center_lead_outbound.select': () => ({ data: [{ id: LEAD, localita: 'Verona', provincia: 'VR' }] }),
    'kona_call_director_comuni.select': () => ({ data: [] })
  });
  const res = await report.propostaPianoGiorno(db, baseCfg(), { data: '2026-08-27' });
  assert.equal(res.totale, 3);
  assert.equal(res.perZona[0].zona, 'Verona');
  assert.equal(res.perZona[0].n, 2);
});

test('salvaPiano e pianoDi', async () => {
  const db = makeSupabase({
    'kona_call_director_piani.upsert': () => ({ data: null, error: null }),
    'kona_call_director_piani.select': () => ({ data: { data: '2026-08-28', operatore_id: PROFILO, stato: 'proposta', sorgente: 'openai', contenuto: { totale: 2 } } })
  });
  const salva = await report.salvaPiano(db, { data: '2026-08-28', operatoreId: PROFILO, contenuto: { totale: 2 }, sorgente: 'openai', stato: 'proposta' });
  assert.equal(salva.ok, true);
  const piano = await report.pianoDi(db, { data: '2026-08-28', operatoreId: PROFILO });
  assert.equal(piano.stato, 'proposta');
});

// =============================================================================
// Frontend: ID HTML univoci, budget toFixed guard
// =============================================================================

test('prossimo contatto restituisce il task gia attivo senza svuotare la UI', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-task.js'),
    'utf8'
  );
  assert.match(source, /esito\.reason === 'task_attivo'/);
  assert.match(source, /task: corrente\.dettaglio, motivo: 'task_attivo'/);
});

test('operatore: nessun ID HTML duplicato e niente "Isabella"/script telefonici', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/kona-call-director.html'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const duplicati = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(duplicati, []);
  assert.ok(!/Isabella/.test(html));
  assert.ok(!/window\.(alert|confirm|prompt)/.test(html));
});

test('nessuna funzione genera script telefonici (niente azione messaggio/suggerisci)', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  const dialog = fs.readFileSync(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-dialog.js'), 'utf8');
  assert.ok(!/suggerisci/.test(js), 'nessuna funzione suggerisci nel frontend');
  assert.ok(!/case 'messaggio'/.test(dialog), 'nessuna action messaggio nel backend');
  assert.ok(!/Suggerisci la frase da dire/.test(dialog), 'nessuna istruzione di script al modello');
});

test('operatore JS: macchina a stati, toFixed sicuro, calendar solo su appuntamento', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  assert.ok(!/\.speso\.toFixed/.test(js) || /num\(_stato\.budget\.speso\)\.toFixed/.test(js));
  assert.ok(/apriCalendar/.test(js));
  assert.ok(/registraConsumer/.test(js));
  assert.ok(/azioneAppuntamento/.test(js));
  assert.ok(/avviaChiamate/.test(js));
  // calendario esposto SOLO nel ramo esito Appuntamento Business
  assert.ok(/if \(esito === 'appuntamento'\)/.test(js));
  assert.ok(/if \(eBusiness\(\)\)/.test(js));
  assert.ok(/apriNegozioTask\(\)/.test(js));
  // nessuna sezione Consumer/Calendar sempre visibile: una sola schermata
  assert.ok(/data-screen/.test(js) === false || /\.kona-screen/.test(js));
});

test('operatore: una sola schermata visibile alla volta (stato .active)', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/kona-call-director.html'), 'utf8');
  assert.match(js, /classList\.toggle\('active', s\.getAttribute\('data-screen'\) === screen\)/);
  // gli screen partono tutti nascosti (display:none) e si attivano via .active
  assert.match(html, /\.kona-screen \{ display: none; \}/);
  assert.match(html, /\.kona-screen\.active \{ display: block/);
});

test('operatore: nessun fetch diretto e nessuna emoji', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/kona-call-director.html'), 'utf8');
  assert.ok(!/(?<![\w.])fetch\s*\(/.test(js), 'nessun fetch diretto, solo MiroxApi.fetch');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), 'nessuna emoji nell\'HTML');
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(js), 'nessuna emoji nel JS');
});

test('admin: DTO budget coerente (speso/budget/rimasto) e nuovi campi config', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'admin-kona-call-director.html'), 'utf8');
  assert.ok(/b\.speso/.test(js));
  assert.ok(/b\.budget/.test(js));
  assert.ok(/b\.rimasto/.test(js));
  assert.ok(/orario_stop_business/.test(js));
  assert.ok(/prezzi_openai/.test(js));
  assert.ok(/data-json/.test(js) || /dataset\.json/.test(js));
  assert.ok(/richieste_web_max_per_lead/.test(js));
});

// =============================================================================
// Staging / cron: opt-in esplicito
// =============================================================================

test('dispatcher: in staging termina senza opt-in esplicito', async () => {
  const d = require(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-dispatcher.js'));
  const prevEnv = process.env.MIROX_DEPLOY_ENV;
  const prevRun = process.env.KONA_CALL_DIRECTOR_STAGING_RUN;
  process.env.MIROX_DEPLOY_ENV = 'staging';
  delete process.env.KONA_CALL_DIRECTOR_STAGING_RUN;
  const res = await d.handler({ headers: {}, queryStringParameters: {} });
  const body = JSON.parse(res.body);
  assert.equal(body.skipped, 'staging');
  if (prevEnv) process.env.MIROX_DEPLOY_ENV = prevEnv; else delete process.env.MIROX_DEPLOY_ENV;
  if (prevRun) process.env.KONA_CALL_DIRECTOR_STAGING_RUN = prevRun; else delete process.env.KONA_CALL_DIRECTOR_STAGING_RUN;
});

test('dispatcher: cron secret non valido -> 401', async () => {
  const d = require(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-dispatcher.js'));
  const prev = process.env.KONA_CALL_DIRECTOR_CRON_SECRET;
  process.env.KONA_CALL_DIRECTOR_CRON_SECRET = 'segreto';
  const res = await d.handler({ headers: { 'x-kona-cd-cron-secret': 'sbagliato' }, queryStringParameters: {} });
  assert.equal(res.statusCode, 401);
  if (prev) process.env.KONA_CALL_DIRECTOR_CRON_SECRET = prev; else delete process.env.KONA_CALL_DIRECTOR_CRON_SECRET;
});

// =============================================================================
// Briefing giornata (macchina a stati: nessuna categoria vuota mostrata)
// =============================================================================

test('briefingGiornata: senza candidati non espone categorie vuote', async () => {
  const db = makeSupabase({
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] }),
    'kona_call_director_conferme.select': () => ({ data: [] }),
    'vw_rilavorazione_ricontatti_unificata.select': () => ({ data: [] }),
    'chiamate.select': () => ({ data: [] }),
    'call_center_lead_outbound.select': () => ({ data: [] }),
    'kona_call_director_arricchimenti.select': () => ({ data: [] }),
    'kona_call_director_sessioni.select': () => ({ data: null }),
    'kona_call_director_piani.select': () => ({ data: null })
  });
  const res = await engine.briefingGiornata(db, baseCfg(), { profiloId: PROFILO, oggi: '2026-08-27' });
  assert.deepEqual(res.mattina, []);
  assert.deepEqual(res.pomeriggio, []);
  assert.equal(res.business.conteggio, 0);
  assert.equal(res.conferme, 0);
  assert.equal(res.consumer, null);
  assert.ok(res.saluto);
});

test('briefingGiornata: mattina/pomeriggio separati, solo categorie con conteggio', async () => {
  const db = makeSupabase({
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] }),
    'kona_call_director_conferme.select': () => ({ data: [] }),
    'vw_rilavorazione_ricontatti_unificata.select': () => ({
      data: [
        { origine_tipo: 'standard', origine_id: CHIAMATA, lead_id: null, nome_cliente: 'Tizio', telefono: '333', cf_piva: 'CF1', operatore_id: PROFILO, esito: 'ricontattare', data_ricontatto: null, fascia_ricontatto: null, motivo_chiamata: 'x', note: null, data_ora: '2026-08-20T09:00:00Z', rilavorazione_stato: 'da_lavorare' }
      ]
    }),
    'chiamate.select': () => ({ data: [] }),
    'call_center_lead_outbound.select': () => ({ data: [] }),
    'kona_call_director_arricchimenti.select': () => ({ data: [] }),
    'kona_call_director_sessioni.select': () => ({ data: { categoria: 'telefoni_omaggio' } }),
    'kona_call_director_piani.select': () => ({ data: null })
  });
  const res = await engine.briefingGiornata(db, baseCfg(), { profiloId: PROFILO, oggi: '2026-08-27' });
  // fascia null -> ricontatto disponibile sia mattina sia pomeriggio
  assert.ok(res.mattina.some((a) => a.tipo === 'ricontatto_programmato' && a.conteggio === 1));
  assert.ok(res.pomeriggio.some((a) => a.tipo === 'ricontatto_programmato' && a.conteggio === 1));
  assert.ok(res.mattina.every((a) => a.conteggio > 0));
  assert.ok(res.pomeriggio.every((a) => a.conteggio > 0));
  assert.equal(res.consumer.modalita, 'telefoni_omaggio');
});

test('briefingGiornata: consumer deriva dal piano, non dalla sessione aperta a mano', async () => {
  const db = makeSupabase({
    'kona_call_director_appuntamenti_business.select': () => ({ data: [] }),
    'kona_call_director_conferme.select': () => ({ data: [] }),
    'vw_rilavorazione_ricontatti_unificata.select': () => ({ data: [] }),
    'chiamate.select': () => ({ data: [] }),
    'call_center_lead_outbound.select': () => ({ data: [] }),
    'kona_call_director_arricchimenti.select': () => ({ data: [] }),
    'kona_call_director_sessioni.select': () => ({ data: null }),
    'kona_call_director_piani.select': () => ({ data: { stato: 'applicato', sorgente: 'default', contenuto: { consumer: 'fibra_fwa', categorie_approvate: ['bar'] } } })
  });
  const res = await engine.briefingGiornata(db, baseCfg(), { profiloId: PROFILO, oggi: '2026-08-27' });
  assert.equal(res.consumer.modalita, 'fibra_fwa');
  assert.deepEqual(res.categorie_approvate, ['bar']);
});

test('categoria Consumer: supporta campo canonico, legacy Telegram e fallback sessione', () => {
  const categoria = engine._test.categoriaConsumerPiano;
  assert.equal(categoria({ consumer: 'fibra_fwa' }, 'telefoni_omaggio'), 'fibra_fwa');
  assert.equal(categoria({ categoria_sessione: 'telefoni_omaggio' }, null), 'telefoni_omaggio');
  assert.equal(categoria({}, 'fibra_fwa'), 'fibra_fwa');
  assert.equal(categoria({ categoria_sessione: 'business' }, null), null);
});

test('riepilogoRilavorazioni raggruppa ricontatti e non risposti senza categorie vuote', () => {
  const riep = engine._test.riepilogoRilavorazioni([
    { esito: 'ricontattare' },
    { esito: 'non_risposto' },
    { esito: 'ricontattare' }
  ]);
  assert.equal(riep.find((a) => a.tipo === 'ricontatto_programmato').conteggio, 2);
  assert.equal(riep.find((a) => a.tipo === 'auto_non_risposto').conteggio, 1);
  assert.ok(riep.every((a) => a.conteggio > 0));
});

test('briefingGiornata: etichette coprono tutti i tipi di attivita', () => {
  const e = engine._test.ETICHETTE_ATTIVITA;
  ['conferma_appuntamento_business', 'ricontatto_programmato', 'auto_non_risposto', 'non_presentato', 'passa_a_cerea', 'passa_in_negozio', 'campagna_urgente', 'sessione_business'].forEach((t) => {
    assert.ok(e[t], 'manca etichetta per ' + t);
  });
});

test('migration 075: aggiunge solo il tipo task non_presentato', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '..', 'database/075_kona_call_director_parita_rilavorazioni.sql'), 'utf8');
  assert.match(sql, /'non_presentato'/);
  assert.match(sql, /kona_call_director_task_tipo_check/);
  assert.doesNotMatch(sql, /DROP\s+(TABLE|COLUMN)/i);
});

test('macchina a stati: transizione per famiglie, non fra task della stessa famiglia', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  assert.ok(/function famiglia\(tipo\)/.test(js));
  assert.ok(/Le rilavorazioni previste sono terminate/.test(js));
  assert.ok(/I lead Business standard sono terminati/.test(js));
  // confronto per famiglia (nuovaFamiglia !== _prevFamiglia), non per tipo
  assert.ok(/nuovaFamiglia !== _prevFamiglia/.test(js));
});

test('frontend: esito Consumer Appuntamento e calendario negozio', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/kona-call-director.html'), 'utf8');
  assert.ok(/esito: 'appuntamento', label: 'Appuntamento'/.test(js), 'esito Appuntamento in ESITI_CONSUMER');
  assert.ok(/apriNegozio/.test(js), 'apriNegozio definita');
  assert.ok(/negozio_slot/.test(js), 'riusa negozio_slot');
  assert.ok(/negozio_prenota/.test(js), 'riusa negozio_prenota');
  assert.ok(/data-screen="negozio"/.test(html), 'screen negozio presente');
});

test('frontend: avvio automatico della sessione Consumer dal piano (avvia_consumer)', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  assert.ok(/action: 'avvia_consumer'/.test(js), 'avvia_consumer chiamato dal frontend');
});

test('riprogrammazione Business: una sola operazione di calendario (niente proponi)', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  const confermaSlot = js.slice(js.indexOf('async function confermaSlot'), js.indexOf('async function azioneAppuntamento'));
  const branchStart = confermaSlot.indexOf('if (_riprogrammaAppId)');
  const branchEnd = confermaSlot.indexOf('} else {', branchStart);
  const ramoRiprogramma = confermaSlot.slice(branchStart, branchEnd);
  const ramoNuovo = confermaSlot.slice(branchEnd);
  assert.ok(/riprogramma_appuntamento/.test(ramoRiprogramma));
  assert.ok(!/proponi_appuntamento/.test(ramoRiprogramma), 'il ramo riprogrammazione non crea un nuovo appuntamento');
  assert.ok(/proponi_appuntamento/.test(ramoNuovo), 'la proposta resta nel solo ramo nuovo appuntamento');
});

test('prenotazione negozio: richiede sessione e compensa se il log Consumer fallisce', () => {
  const dialog = fs.readFileSync(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-dialog.js'), 'utf8');
  const taskFn = fs.readFileSync(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-task.js'), 'utf8');
  const prenota = dialog.slice(dialog.indexOf('async function azioneNegozioPrenota'), dialog.length);
  assert.ok(prenota.indexOf("from('kona_call_director_sessioni')") < prenota.indexOf("from('appuntamenti').insert"), 'sessione verificata prima della prenotazione');
  assert.match(prenota, /if \(attivitaError\)[\s\S]*from\('appuntamenti'\)\.delete\(\)\.eq\('id', appuntamento\.id\)/);
  assert.match(prenota, /telefono\.replace\(\/\\D\/g, ''\)\.length < 6/);
  assert.match(taskFn, /case 'prenota_negozio'/);
  assert.match(taskFn, /tipiAmmessi = \['ricontatto_programmato', 'auto_non_risposto', 'non_presentato', 'passa_a_cerea', 'passa_in_negozio'\]/);
  assert.match(taskFn, /registerEsito\([\s\S]*esito: 'appuntamento'/);
  assert.match(taskFn, /if \(!registrato\.ok\)[\s\S]*from\('appuntamenti'\)\.delete\(\)/);
});

test('frontend: ricontatto assegnato dal backend mostrato (ricontattoAssegnato)', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  assert.ok(/Ricontatto pianificato/.test(js), 'messaggio di conferma follow-up');
  assert.ok(/res\.esito && res\.esito\.ricontatto/.test(js), 'legge il ricontatto dal backend');
});

test('ricontatto manuale: valida giorno/fascia e rifiuta date passate', () => {
  assert.deepEqual(
    engine.ricontattoRichiesto(baseCfg(), '2026-08-29', { dettagli: { data_ricontatto: '2026-08-29', fascia_ricontatto: 'Mattina' } }),
    { data: '2026-08-29', fascia: 'Mattina' }
  );
  assert.throws(() => engine.ricontattoRichiesto(baseCfg(), '2026-08-29', { dettagli: { data_ricontatto: '2026-08-28', fascia_ricontatto: 'Mattina' } }), /ricontatto_manuale_non_valido/);
  assert.throws(() => engine.ricontattoRichiesto(baseCfg(), '2026-08-29', { dettagli: { data_ricontatto: '2026-08-30', fascia_ricontatto: 'Sera' } }), /ricontatto_manuale_non_valido/);
});

test('frontend affidabile: loading globale e salvataggio interno evitano il blocco annidato', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/kona-call-director.html'), 'utf8');
  const api = js.slice(js.indexOf('async function apiFetch'), js.indexOf('// -- Macchina a stati'));
  const slot = js.slice(js.indexOf('async function confermaSlot'), js.indexOf('async function azioneAppuntamento'));
  assert.match(api, /mostraCaricamento\(\)/);
  assert.match(api, /finally[\s\S]*nascondiCaricamento\(\)/);
  assert.match(slot, /salvaEsitoInterno\('appuntamento'/);
  assert.doesNotMatch(slot, /await salvaEsito\('appuntamento'/);
  assert.match(slot, /finally[\s\S]*_salvataggioInCorso = false/);
  assert.match(html, /id="konaRicontattoManuale"/);
  assert.match(html, /id="konaFollowupData"/);
});

test('calendario Business: nessun taglio ai primi 30 slot e retry idempotente per task', () => {
  const dialog = fs.readFileSync(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-dialog.js'), 'utf8');
  assert.doesNotMatch(dialog, /slots\.slice\(0, 30\)/);
  assert.match(dialog, /giorni_disponibili/);
  assert.match(dialog, /contains\('esito', \{ task_id: taskId \}\)/);
  assert.match(dialog, /riutilizzato: true/);
});

// =============================================================================
// Routing per profilo + scrittura canonica Consumer
// =============================================================================

test('mappaEsitoConsumer: esiti Consumer -> esiti canonici chiamate', () => {
  assert.equal(engine.mappaEsitoConsumer('non_risposto'), 'non_risposto');
  assert.equal(engine.mappaEsitoConsumer('non_interessato'), 'non_interessato');
  assert.equal(engine.mappaEsitoConsumer('passa_in_negozio'), 'passa_in_negozio');
  assert.equal(engine.mappaEsitoConsumer('interessato'), 'ricontattare');
  assert.equal(engine.mappaEsitoConsumer('appuntamento'), 'appuntamento');
  assert.equal(engine.mappaEsitoConsumer('altro'), 'non_interessato');
});

test('registraChiamataConsumerCanonica scrive nella tabella canonica chiamate', async () => {
  const inserted = [];
  const db = makeSupabase({
    'anagrafica.select': () => ({ data: null }),
    'chiamate.insert': (q) => { inserted.push(q.value); return { data: { id: 'ch-canonica' }, error: null }; }
  });
  const id = await engine.registraChiamataConsumerCanonica(db, baseCfg(), {
    operatoreId: PROFILO,
    operatoreNome: 'Isabella',
    cfPiva: 'RSSMRA80A01H501U',
    nomeCliente: 'Mario Rossi',
    cellulare: '3331234567',
    esito: 'non_risposto',
    motivo: 'Telefoni omaggio'
  });
  assert.equal(id, 'ch-canonica');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].cf_piva, 'RSSMRA80A01H501U');
  assert.equal(inserted[0].esito, 'non_risposto');
  assert.equal(inserted[0].rilavorazione_stato, undefined, 'lascia al trigger canonico la classificazione rilavorazione');
});

test('registraChiamataConsumerCanonica: ricontattare assegna data/fascia', async () => {
  const inserted = [];
  const db = makeSupabase({
    'anagrafica.select': () => ({ data: null }),
    'chiamate.insert': (q) => { inserted.push(q.value); return { data: { id: 'ch-2' }, error: null }; }
  });
  await engine.registraChiamataConsumerCanonica(db, baseCfg(), {
    operatoreId: PROFILO, operatoreNome: 'Isabella',
    cfPiva: 'CF1', nomeCliente: 'X', cellulare: '333', esito: 'interessato'
  });
  assert.equal(inserted[0].esito, 'ricontattare');
  assert.ok(inserted[0].data_ricontatto);
  assert.ok(inserted[0].fascia_ricontatto);
});

test('kona-call-director-route: routing per ruolo e abilitazione', () => {
  const route = require(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-route.js'));
  const d = route._test.decideRoute;
  // operatrice abilitata NON admin -> kona_only
  assert.deepEqual(d({ isAdmin: false, canUseOk: true }), { kona_only: true, admin: false, abilitato: true, manual_fallback: false });
  // admin (anche se abilitato) -> manuale + controllo KONA
  assert.deepEqual(d({ isAdmin: true, canUseOk: true }), { kona_only: false, admin: true, abilitato: true, manual_fallback: false });
  // profilo non abilitato -> manuale
  assert.deepEqual(d({ isAdmin: false, canUseOk: false }), { kona_only: false, admin: false, abilitato: false, manual_fallback: false });
  assert.deepEqual(d({ isAdmin: false, canUseOk: true, manualFallback: true }), { kona_only: false, admin: false, abilitato: true, manual_fallback: true });
});

test('cc-header: operatrice KONA non vede la navigazione manuale (redirect + adminOnly)', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'js/cc-header.js'), 'utf8');
  assert.ok(/ROUTE_URL/.test(js));
  assert.ok(/route\.kona_only/.test(js));
  assert.ok(/kona-call-director\.html/.test(js) && /root\.location\.href/.test(js));
  // KONA CD visibile solo agli admin
  assert.ok(/perm: 'kona_call_director'[\s\S]*adminOnly: true/.test(js));
  // nessuna tab manuale nel ramo kona_only (renderMinimal)
  assert.ok(/renderMinimal/.test(js));
  assert.ok(/MiroxApi\.fetch/.test(js), 'routing usa il wrapper autenticato');
  assert.ok(!/await\s+fetch\(ROUTE_URL/.test(js), 'nessun fetch diretto per il routing');
  assert.ok(/!isAdmin && !route\.resolved/.test(js), 'routing non verificato blocca il manuale per i non-admin');
  assert.ok(/document\.querySelectorAll\('\.cc-main'\)[\s\S]*main\.hidden = true/.test(js));
});

test('cc-header: la pagina agente nasconde le tab manuali anche agli admin', () => {
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'js/cc-header.js'), 'utf8');
  assert.match(
    js,
    /if \(currentPage\(\) === 'kona-call-director\.html'\) \{\s*renderMinimal\(container, profilo\);\s*return;\s*\}/
  );
  const guardAgente = js.indexOf("currentPage() === 'kona-call-director.html'");
  const fetchRouting = js.indexOf('const route = await fetchRoute()', guardAgente);
  assert.ok(guardAgente >= 0 && fetchRouting > guardAgente, 'la shell KONA viene scelta prima del routing admin/manuale');
});

test('migration 074: audit esiti append-only, failover server-only e RPC atomica', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '..', 'database/074_kona_call_director_agente_unificato.sql'), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.kona_call_director_correzioni_esito/);
  assert.match(sql, /trg_kona_cd_correzioni_no_update/);
  assert.match(sql, /trg_kona_cd_correzioni_no_delete/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.kona_call_director_failover/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.kona_cd_correggi_esito_v1/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.kona_call_director_correzioni_esito FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN)/i);
});

test('operazioni unificate: validazione CF/PIVA e failover solo per errori AI ammessi', () => {
  const operator = require(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-operator.js'))._test;
  assert.equal(operator.validaCfPiva('RSSMRA80A01H501U'), 'RSSMRA80A01H501U');
  assert.equal(operator.validaCfPiva('01234567890'), '01234567890');
  assert.equal(operator.validaCfPiva('non-valido'), null);
  assert.equal(operator.AI_FAILOVER_CODES.has('unavailable'), true);
  assert.equal(operator.AI_FAILOVER_CODES.has('invalid_request'), false);
});

test('frontend unificato: Consumer, ricerca inbound, storico e correzione restano dentro KONA', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/kona-call-director.html'), 'utf8');
  const js = fs.readFileSync(path.resolve(__dirname, '..', 'moduli/call-center/js/kona-call-director.js'), 'utf8');
  assert.match(html, /id="konaConsumerCf"/);
  assert.match(html, /id="modalKonaRicerca"/);
  assert.match(html, /id="modalKonaCorrezione"/);
  assert.doesNotMatch(html, /Apri Registra Chiamata/);
  assert.match(js, /action: 'cerca_consumer'/);
  assert.match(js, /action: 'salva_consumer'/);
  assert.match(js, /action: 'cerca_inbound'/);
  assert.match(js, /action: 'correggi_esito'/);
  assert.match(js, /action: 'attiva_failover'/);
  assert.match(js, /classList\.contains\('modal-overlay'\)[\s\S]*classList\.add\('active'\)/);
  assert.match(js, /classList\.contains\('modal-overlay'\)[\s\S]*classList\.remove\('active'\)/);
  assert.doesNotMatch(js, /root\.location\.href = 'registra-chiamata\.html'/);
});

test('Consumer canonico: upsert anagrafica e rollback di chiamata/appuntamento sono espliciti', () => {
  const operator = fs.readFileSync(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-operator.js'), 'utf8');
  const dialog = fs.readFileSync(path.resolve(__dirname, '..', 'netlify/functions/kona-call-director-dialog.js'), 'utf8');
  assert.match(operator, /upsertAnagraficaConsumer/);
  assert.match(operator, /from\('chiamate'\)\.delete\(\)\.eq\('id', chiamataId\)/);
  assert.match(dialog, /upsertAnagraficaConsumer/);
  assert.match(dialog, /if \(attivitaError\)[\s\S]*from\('chiamate'\)\.delete\(\)\.eq\('id', chiamataId\)/);
});
