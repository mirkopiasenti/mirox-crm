'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _test: webhook } = require('../netlify/functions/guardian-telegram-webhook');
const { _test: observer } = require('../netlify/functions/cron-guardian-observer');
const { _test: worker } = require('../netlify/functions/guardian-codex-worker');
const { preflight } = require('../.github/codex/openai-preflight');
const { hashLeaseToken } = require('../netlify/functions/_lib/guardian-codex');
const { conversationText } = require('../netlify/functions/_lib/kona-ai-guardian');

const incidentId = '11111111-1111-4111-8111-111111111111';
const executionId = '22222222-2222-4222-8222-222222222222';
const chatId = '123';
const lease = 'l'.repeat(64);

// In-memory PostgREST fixture runs the actual orchestration, including conditional writes.
function database(seed = {}) {
  const tables = structuredClone(seed);
  const db = { tables, from(name) {
    tables[name] ||= [];
    let filters = [], sorting, cap, single = false, operation, values, upsertOptions;
    const q = {
      select() { return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, v) { filters.push(r => v.includes(r[k])); return q; },
      lte(k, v) { filters.push(r => r[k] <= v); return q; },
      order(k, { ascending = true } = {}) { sorting = [k, ascending]; return q; },
      limit(n) { cap = n; return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      insert(v) { operation = 'insert'; values = v; return q; },
      update(v) { operation = 'update'; values = v; return q; },
      upsert(v, options) { operation = 'upsert'; values = v; upsertOptions = options; return q; },
      then(resolve, reject) {
        try {
          let rows = tables[name].filter(r => filters.every(f => f(r)));
          if (operation === 'insert' || operation === 'upsert') {
            let existing = operation === 'upsert' && tables[name].find(r => r[upsertOptions?.onConflict] === values[upsertOptions?.onConflict]);
            if (existing) { if (!upsertOptions?.ignoreDuplicates) Object.assign(existing, values); rows = [existing]; }
            else { const r = { id: name + tables[name].length, numero: 99, created_at: new Date().toISOString(), ...structuredClone(values) }; tables[name].push(r); rows = [r]; }
          } else if (operation === 'update') rows.forEach(r => Object.assign(r, structuredClone(values)));
          if (sorting) rows.sort((a,b) => String(a[sorting[0]]).localeCompare(String(b[sorting[0]])) * (sorting[1] ? 1 : -1));
          if (cap !== undefined) rows = rows.slice(0, cap);
          resolve({ data: structuredClone(single ? rows[0] || null : rows), error: null });
        } catch (error) { reject(error); }
      }
    };
    return q;
  } };
  return db;
}

function network(t, { openaiStatus = 200 } = {}) {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, opts) => {
    const body = JSON.parse(opts.body || '{}');
    calls.push({ url, body });
    if (url === 'https://api.openai.com/v1/responses') return {
      ok: openaiStatus === 200, status: openaiStatus,
      json: async () => openaiStatus === 200
        ? { output_text: JSON.stringify({ reply: 'Parliamone.\n\nLa causa va verificata.', suggested_action: 'nessuna' }) }
        : { error: { code: 'invalid_api_key', message: 'Incorrect API key provided: sk-secret-never-expose' } }
    };
    if (url.includes('api.telegram.org')) return { ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) };
    throw new Error('unexpected network request');
  });
  for (const [k,v] of Object.entries({ OPENAI_API_KEY: 'synthetic-test-key', TELEGRAM_GUARDIAN_BOT_TOKEN: 'synthetic-bot-token', TELEGRAM_GUARDIAN_OWNER_CHAT_ID: chatId })) {
    const prev = process.env[k]; process.env[k] = v;
    t.after(() => { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; });
  }
  return calls;
}

function conversationSeed(state = 'ricevuto') {
  return {
    kona_ai_telegram_sessioni: [{ chat_id: chatId, conversazione: [] }],
    kona_ai_incidenti: [{ id: incidentId, numero: 9, stato: state, titolo: 'Errore CRM', riepilogo_ai: 'Un errore da verificare' }]
  };
}

test('il proprietario conversa senza ticket e conserva la memoria tra messaggi', async t => {
  const calls = network(t);
  const db = database({ kona_ai_telegram_sessioni: [{ chat_id: chatId, conversazione: [] }] });
  await webhook.handleOwnerConversation(db, chatId, db.tables.kona_ai_telegram_sessioni[0], 'Come miglioriamo Guardian?');
  await webhook.handleOwnerConversation(db, chatId, db.tables.kona_ai_telegram_sessioni[0], 'E per la conversazione?');
  const aiCalls = calls.filter(c => c.url.includes('/responses'));
  assert.equal(aiCalls.length, 2);
  assert(aiCalls[1].body.input.some(i => i.content === 'Come miglioriamo Guardian?'));
  assert(aiCalls[1].body.input.some(i => i.role === 'assistant' && i.content.includes('\n\n')));
  assert.equal(db.tables.kona_ai_incidenti.length, 0);
  assert.equal(db.tables.kona_ai_telegram_sessioni[0].conversazione.length, 4);
});

test('Perché su un caso archiviato risponde con il contesto tecnico senza riaprirlo', async t => {
  const calls = network(t);
  const seed = conversationSeed('archiviato');
  seed.kona_ai_esecuzioni = [{ incidente_id: incidentId, stato: 'fallita', codice_errore: 'openai_invalid_key', messaggio_errore: 'Chiave rifiutata', created_at: '2026-09-04' }];
  const db = database(seed);
  await webhook.handleOwnerConversation(db, chatId, { incidente_attivo_id: incidentId }, 'Perché?');
  const ai = calls.find(c => c.url.includes('/responses')).body;
  assert.match(ai.input[0].content, /openai_invalid_key/);
  assert.equal(db.tables.kona_ai_incidenti[0].stato, 'archiviato');
  assert.equal(db.tables.kona_ai_messaggi.length, 2);
  assert.doesNotMatch(calls.at(-1).body.text, /Aprine un.altra|richiesta attiva.*archiviata/i);
});

test('una risposta alla notifica seleziona quel caso anche con altro ticket attivo', async () => {
  const db = database({ ...conversationSeed(), kona_ai_notifiche: [{ telegram_message_id: 88, incidente_id: incidentId }] });
  const incident = await webhook.resolveConversationIncident(db, chatId, { incidente_attivo_id: 'obsolete-id' }, 'Perché?', { message_id: 88 });
  assert.equal(incident.id, incidentId);
  assert.equal(db.tables.kona_ai_telegram_sessioni[0].incidente_attivo_id, incidentId);
});

test('un riferimento KG sconosciuto non attribuisce il messaggio al vecchio caso', async () => {
  const db = database(conversationSeed());
  assert.equal(await webhook.resolveConversationIncident(db, chatId, { incidente_attivo_id: incidentId }, 'Parliamo di KG-999999'), null);
  assert.equal(await webhook.resolveConversationIncident(db, chatId, { incidente_attivo_id: incidentId }, 'Confronta KG-000009 e KG-000010'), null);
});

test('la chiave chat non valida produce una spiegazione distinta e conserva la domanda', async t => {
  const calls = network(t, { openaiStatus: 401 });
  const db = database({ kona_ai_telegram_sessioni: [{ chat_id: chatId, conversazione: [] }] });
  await webhook.handleOwnerConversation(db, chatId, {}, 'Ci sei?');
  assert.match(calls.at(-1).body.text, /chiave della chat Netlify/);
  assert.doesNotMatch(JSON.stringify(db.tables) + calls.at(-1).body.text, /sk-secret/);
  assert.equal(db.tables.kona_ai_telegram_sessioni[0].conversazione[0].text, 'Ci sei?');
});

test('il preflight classifica 401 e modello inaccessibile senza riflettere la chiave', async () => {
  const request = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 'invalid_api_key', message: 'secret-data' } }) });
  assert.deepEqual(await preflight({ apiKey: 'synthetic', model: 'gpt-5.6-luna', request }), { ready: false, error_code: 'openai_invalid_key' });
  assert.deepEqual(await preflight({ apiKey: '', model: 'gpt-5.6-luna', request }), { ready: false, error_code: 'openai_key_missing' });
  assert.equal((await preflight({ apiKey: 'synthetic', model: 'injected\nmodel', request })).error_code, 'openai_model_unavailable');
});

test('un fallimento automatico già registrato non riparte al cron successivo', async () => {
  const seed = conversationSeed();
  seed.kona_ai_esecuzioni = [{ id: executionId, incidente_id: incidentId, tipo_esecuzione: 'analisi_automatica', stato: 'fallita' }];
  seed.kona_ai_segnali = [{ id: 'signal', incidente_id: incidentId, stato: 'osservando' }];
  const db = database(seed);
  await observer.processSignal(db, db.tables.kona_ai_segnali[0], 0);
  assert.equal(db.tables.kona_ai_esecuzioni.length, 1);
  assert.equal(db.tables.kona_ai_segnali[0].stato, 'notificato');
  assert.equal(db.tables.kona_ai_notifiche, undefined);
});

test('fallimento worker terminale consegna l’errore e non rimette il segnale in osservazione', async () => {
  const seed = conversationSeed();
  seed.kona_ai_esecuzioni = [{ id: executionId, incidente_id: incidentId, tipo_esecuzione: 'analisi_automatica', stato: 'in_esecuzione', lease_token_hash: hashLeaseToken(lease), lease_expires_at: new Date(Date.now()+60000).toISOString(), workflow_run_id: 36591962525 }];
  seed.kona_ai_segnali = [{ id: 'signal', incidente_id: incidentId, stato: 'in_analisi' }];
  const db = database(seed);
  const body = { execution_id: executionId, lease_token: lease, success: false, error_code: 'openai_invalid_key', error: 'Chiave rifiutata' };
  assert.equal((await worker.recordResult(db, body)).statusCode, 200);
  assert.equal(db.tables.kona_ai_segnali[0].stato, 'notificato');
  assert.match(db.tables.kona_ai_notifiche[0].payload.text, /OPENAI_API_KEY_CODEX_WORKER/);
  assert.match(db.tables.kona_ai_notifiche[0].payload.text, /36591962525/);
  assert.equal((await worker.recordResult(db, body)).statusCode, 409);
  assert.equal(db.tables.kona_ai_notifiche.length, 1);
});

test('una scansione preventiva fallita produce la notifica finale anche senza segnale', async () => {
  const seed = conversationSeed();
  seed.kona_ai_esecuzioni = [{ id: executionId, incidente_id: incidentId, tipo_esecuzione: 'scansione_migliorie', stato: 'in_esecuzione', lease_token_hash: hashLeaseToken(lease) }];
  const db = database(seed);
  await worker.recordResult(db, { execution_id: executionId, lease_token: lease, success: false });
  assert.equal(db.tables.kona_ai_notifiche.length, 1);
  assert.equal(db.tables.kona_ai_notifiche[0].segnale_id, null);
});

test('il contesto Codex conserva gli ultimi 60 messaggi in ordine cronologico', async () => {
  const seed = conversationSeed();
  seed.kona_ai_messaggi = Array.from({ length: 100 }, (_, n) => ({ incidente_id: incidentId, testo: 'Messaggio '+n, created_at: String(n).padStart(3,'0') }));
  const result = await worker.loadContext(database(seed), { incidente_id: incidentId });
  assert.equal(result.conversation.length, 60);
  assert.equal(result.conversation[0].text, 'Messaggio 40');
  assert.equal(result.conversation.at(-1).text, 'Messaggio 99');
});

test('un guasto di configurazione sospende gli automatismi fino a un’analisi manuale riuscita', async () => {
  const db = database({ kona_ai_esecuzioni: [{ stato: 'fallita', tipo_esecuzione: 'analisi_automatica', codice_errore: 'openai_invalid_key', completata_at: '2026-09-29' }] });
  assert.equal(await observer.automaticWorkerBlocked(db), true);
  db.tables.kona_ai_esecuzioni.push({ stato: 'completata', tipo_esecuzione: 'analisi_codex', completata_at: '2026-10-05' });
  assert.equal(await observer.automaticWorkerBlocked(db), false);
});

test('il testo della conversazione conserva paragrafi e rimuove chiavi', () => {
  assert.equal(conversationText('Prima riga\n\nSeconda riga'), 'Prima riga\n\nSeconda riga');
  assert.doesNotMatch(conversationText('sk-'+ 'a'.repeat(35)), /sk-/);
});

test('il worker rifiuta destinazioni dell’altro ambiente e URL ambigui', () => {
  const { validWorkerTarget } = require('../.github/codex/worker-target');
  const prod = 'https://mirox-crm.it/.netlify/functions/guardian-codex-worker';
  const staging = 'https://mirox-crm-staging.netlify.app/.netlify/functions/guardian-codex-worker';
  assert.equal(validWorkerTarget(prod, 'production'), true);
  assert.equal(validWorkerTarget(staging, 'staging'), true);
  assert.equal(validWorkerTarget(prod, 'staging'), false);
  assert.equal(validWorkerTarget(staging, 'production'), false);
  assert.equal(validWorkerTarget(prod+'?redirect=other', 'production'), false);
  assert.equal(validWorkerTarget('https://mirox-crm.it.evil.invalid/.netlify/functions/guardian-codex-worker', 'production'), false);
});

test('due cron concorrenti consegnano una notifica una sola volta', async t => {
  const calls = network(t);
  const db = database({ kona_ai_notifiche: [{ id: 'outbox', stato: 'in_coda', tentativi: 0, prossimo_tentativo_at: '2026-01-01', payload: { text: 'Risultato' } }] });
  await Promise.all([observer.processOutbox(db), observer.processOutbox(db)]);
  assert.equal(calls.length, 1);
  assert.equal(db.tables.kona_ai_notifiche[0].stato, 'inviata');
});

test('il risultato tardivo di un worker non riapre una richiesta archiviata', async () => {
  const seed = conversationSeed('archiviato');
  seed.kona_ai_esecuzioni = [{ id: executionId, incidente_id: incidentId, tipo_esecuzione: 'scansione_migliorie', stato: 'in_esecuzione', lease_token_hash: hashLeaseToken(lease) }];
  const db = database(seed);
  await worker.recordResult(db, { execution_id: executionId, lease_token: lease, success: false });
  assert.equal(db.tables.kona_ai_incidenti[0].stato, 'archiviato');
  assert.equal(db.tables.kona_ai_esecuzioni[0].stato, 'fallita');
  assert.doesNotMatch(db.tables.kona_ai_notifiche[0].payload.text, /resta aperta/);
});
