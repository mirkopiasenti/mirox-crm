'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { uploadPrivacyPdf } = require('../netlify/functions/_lib/privacy-pdf-storage');
const read = name => fs.readFileSync(require('node:path').join(__dirname, '..', name), 'utf8');
const timeout = { statusCode: '544', message: 'The connection to the database timed out' };

test('Storage riprova una sola volta il DatabaseTimeout osservato in settembre', async () => {
  const paths = [];
  const result = await uploadPrivacyPdf({ upload: async (path, data, opts) => {
    paths.push(path); assert.equal(opts.upsert, false);
    return { error: paths.length === 1 ? timeout : null };
  } }, 'private.pdf', Buffer.from('%PDF-test'), async () => {});
  assert.equal(result.error, null);
  assert.deepEqual(paths, ['private.pdf', 'private.pdf']);
});

test('Storage verifica i byte quando il retry incontra un file salvato prima del timeout', async () => {
  for (const same of [true, false]) {
    let count = 0;
    const bytes = Buffer.from('%PDF-test');
    const result = await uploadPrivacyPdf({
      upload: async () => ({ error: ++count === 1 ? timeout : { statusCode: 409, message: 'already exists' } }),
      download: async () => ({ data: new Blob([same ? bytes : 'different']), error: null })
    }, 'private.pdf', bytes, async () => {});
    assert.equal(!result.error, same);
    assert.equal(count, 2);
  }
});

test('Storage non ripete errori permanenti e termina dopo due timeout', async () => {
  for (const error of [{ statusCode: 403, message: 'Forbidden' }, timeout]) {
    let calls = 0;
    const result = await uploadPrivacyPdf({ upload: async () => { calls++; return { error }; } }, 'p', Buffer.from('pdf'), async () => {});
    assert.equal(calls, error === timeout ? 2 : 1);
    assert.equal(result.error, error);
  }
});

function api(fetcher, online = true) {
  const window = { navigator: { onLine: online }, location: { pathname: '/dashboard' }, db: { auth: {
    getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    onAuthStateChange() {}
  } } };
  const context = vm.createContext({ window, fetch: fetcher, Date, Math, console, setTimeout: fn => fn(), setInterval() {}, DOMException });
  vm.runInContext(read('js/mirox-api.js'), context);
  return window.MiroxApi;
}

test('catalogo GET recupera rete e 503, ma non ripete POST, 500, abort o offline', async () => {
  for (const failure of [new TypeError('Failed to fetch'), { status: 503 }]) {
    let calls = 0;
    const client = api(async () => { if (++calls === 1) { if (failure instanceof Error) throw failure; return failure; } return { status: 200 }; });
    assert.equal((await client.fetch('/.netlify/functions/vendita-config', { __miroxReadRetry: true })).status, 200);
    assert.equal(calls, 2);
  }
  for (const scenario of [
    { method: 'POST', status: 503 }, { method: 'GET', status: 500 },
    { method: 'GET', error: new DOMException('stop', 'AbortError') },
    { method: 'GET', error: new TypeError('Load failed'), online: false }
  ]) {
    let calls = 0;
    const client = api(async () => { calls++; if (scenario.error) throw scenario.error; return { status: scenario.status }; }, scenario.online);
    const result = client.fetch('/.netlify/functions/vendita-config', { __miroxReadRetry: true, method: scenario.method });
    if (scenario.error) await assert.rejects(result); else await result;
    assert.equal(calls, 1);
  }
});

function otpFixture({ race, saveError, rereadError, attemptError } = {}) {
  const id = '11111111-1111-4111-8111-111111111111';
  const row = { id, modalita: 'otp_sms', stato: 'pending', otp_salt: 's',
    otp_hash: crypto.createHash('sha256').update('123456:s').digest('hex'), otp_tentativi: 0,
    otp_scade_at: '2099-01-01', snapshot_anagrafica: {} };
  const removed = [], errors = [], uploads = [];
  let reads = 0;
  const db = { storage: { from: () => ({ remove: async paths => { removed.push(...paths); return { error: null }; } }) }, from() {
    let patch, filters = [];
    const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; },
      update(v) { patch = v; return q; }, maybeSingle: async () => {
        if (!patch) { if (++reads > 1 && rereadError) return { error: { message: 'unavailable' } }; return { data: { ...row }, error: null }; }
        if (patch.stato === 'confermato' && race) Object.assign(row, race);
        if (patch.stato === 'confermato' && saveError === 'committed') { Object.assign(row, patch); return { error: { message: 'response lost' } }; }
        if (patch.stato === 'confermato' && saveError) return { error: { message: 'response lost' } };
        if (patch.otp_tentativi && attemptError) return { error: { message: 'unavailable' } };
        if (!filters.every(([k,v]) => row[k] === v)) return { data: null, error: null };
        Object.assign(row, patch); return { data: { id }, error: null };
      } }; return q;
  } };
  const module = { exports: {} };
  const deps = {
    '@supabase/supabase-js': { createClient: () => db }, crypto,
    './_lib/require-auth': { requireAuth: async () => ({ ok: true, profilo: { nome: 'Synthetic' } }) },
    './_lib/pdf-consenso': { generateConsensoPdf: async () => ({ buffer: Buffer.from('%PDF-test'), hash: 'hash' }), INFORMATIVA_VERSIONE_DIGITALE: 'test' },
    './_lib/privacy-pdf-storage': { uploadPrivacyPdf: async (_, path) => { uploads.push(path); return { error: null }; }, isStorageConflict: () => false, isTemporaryStorageError: () => false },
    './_lib/with-telemetry': { captureServerError: async info => errors.push(info) }
  };
  vm.runInNewContext(read('netlify/functions/verifica-otp-privacy.js'), {
    exports: module.exports, module, process: { env: { SUPABASE_URL: 'test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' } }, Buffer, Date,
    require: key => { assert(key in deps, key); return deps[key]; }
  });
  return { row, removed, errors, uploads, run: async (otp = '123456') => {
    const response = await module.exports.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ consenso_id: id, otp }) });
    return { status: response.statusCode, ...JSON.parse(response.body) };
  } };
}

test('OTP conferma normalmente e la seconda richiesta restituisce lo stesso PDF', async () => {
  const f = otpFixture();
  const first = await f.run(), second = await f.run();
  assert.equal(first.success, true); assert.equal(second.gia_confermato, true);
  assert.equal(first.pdf_storage_path, second.pdf_storage_path);
  assert.equal(f.uploads.length, 1);
});

test('OTP conserva il PDF quando la risposta DB persa nasconde un commit riuscito', async () => {
  const f = otpFixture({ saveError: 'committed' });
  assert.equal((await f.run()).success, true);
  assert.deepEqual(f.removed, []);
});

test('OTP concorrente restituisce la conferma vincente senza sovrascriverla', async () => {
  const f = otpFixture({ race: { stato: 'confermato', pdf_storage_path: 'winner.pdf', pdf_filename: 'winner.pdf' } });
  assert.equal((await f.run()).pdf_storage_path, 'winner.pdf');
  assert.equal(f.row.pdf_storage_path, 'winner.pdf');
  assert.deepEqual(f.removed, f.uploads);
});

test('OTP revocato durante upload non viene confermato e il PDF nuovo viene compensato', async () => {
  const f = otpFixture({ race: { stato: 'revocato' } });
  assert.equal((await f.run()).status, 410);
  assert.equal(f.row.stato, 'revocato');
  assert.deepEqual(f.removed, f.uploads);
});

test('OTP non elimina un PDF quando il risultato DB non è verificabile', async () => {
  const f = otpFixture({ saveError: true, rereadError: true });
  const result = await f.run();
  assert.equal(result.status, 503);
  assert.equal(result.error_code, 'privacy_confirm_save_failed');
  assert.deepEqual(f.removed, []);
  assert.equal(f.errors[0].operation, 'confirm_consenso');
});

test('OTP segnala un errore di salvataggio del tentativo senza dichiararlo registrato', async () => {
  const f = otpFixture({ attemptError: true });
  assert.equal((await f.run('999999')).status, 503);
  assert.equal(f.row.otp_tentativi, 0);
});

test('UI OTP ignora Enter ripetuti mentre la verifica è in corso e consente recupero dopo errore', async () => {
  const source = read('moduli/upload-contratti-vendita.html');
  const start = source.indexOf('     let verificationInFlight');
  const end = source.indexOf('     otpInputs.forEach', start);
  let settle, calls = 0;
  const verifyBtn = {}, resendBtn = {};
  const context = vm.createContext({ verifyBtn, resendBtn, otpInputs: '123456'.split('').map(value => ({ value })), consensoId: 'id',
    resendCooldown: 0, timerHandle: null, cooldownHandle: null, setStatus() {},
    MiroxApi: { fetch: () => { calls++; return new Promise(resolve => { settle = resolve; }); } } });
  vm.runInContext(source.slice(start,end), context);
  const first = vm.runInContext('verifyOtp()', context);
  await vm.runInContext('verifyOtp()', context);
  assert.equal(calls, 1); assert.equal(resendBtn.disabled, true);
  settle({ ok: false, status: 503, json: async () => ({}) }); await first;
  assert.equal(verifyBtn.disabled, false); assert.equal(resendBtn.disabled, false);
  const retry = vm.runInContext('verifyOtp()', context);
  assert.equal(calls, 2); settle({ ok: false, status: 503, json: async () => ({}) }); await retry;
});
