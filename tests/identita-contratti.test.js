'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { storeIdentityForContracts } = require('../netlify/functions/upload-vendita-documento')._test;
const { planBackfill, copyContractIdentity } = require('../scripts/backfill-identita-contratti');

const pratica = '11111111-1111-4111-8111-111111111111';
const cliente = '22222222-2222-4222-8222-222222222222';
const contracts = [1,2,3].map(n => ({ id: `00000000-0000-4000-8000-00000000000${n}`,
  pratica_id: pratica, anagrafica_id: cliente }));
const payload = { pratica_id: pratica, anagrafica_id: cliente, contratto_id: contracts[0].id,
  tipo_documento: 'documento_identita', storage_bucket: 'contratti-vendita',
  storage_path: '2026/10/pratica/documento_identita.pdf', file_name: 'documento_identita.pdf', uploaded_by: 'operatore' };

function uploadFixture(failure) {
  const files = new Map(), rows = [], removed = [];
  const storage = {
    async upload(key, bytes, options) {
      assert.equal(options.upsert, false);
      if (failure === 'upload') return { error: new Error('collisione') };
      files.set(key, bytes); return {};
    },
    async copy(source, target) {
      if (failure === 'copy' && files.size === 2) return { error: new Error('copia fallita') };
      assert.ok(files.has(source)); assert.ok(!files.has(target));
      files.set(target, files.get(source)); return {};
    },
    async remove(keys) { removed.push(...keys); keys.forEach(k => files.delete(k)); return {}; }
  };
  const db = { storage: { from: () => storage }, from: () => ({ insert(batch) {
    return { async select() {
      if (failure === 'insert') return { error: new Error('vincolo DB') };
      assert.equal(new Set(batch.map(r => r.storage_path)).size, batch.length);
      rows.push(...batch.map((r,i) => ({ ...r, id: `doc-${i}` })));
      if(['insert_lost','read_lost'].includes(failure))return {error:new Error('Risposta persa dopo commit')};
      return { data: rows };
    } };
  },select(){return {eq(){return this;},in:async()=>failure==='read_lost'?{error:new Error('Rilettura non disponibile')}:{data:rows}};} }) };
  return { db, files, rows, removed };
}

for (const count of [1,3]) test(`identita su ${count} contratti: file indipendenti e autore preservato`, async () => {
  const fixture = uploadFixture();
  const bytes = Buffer.from('%PDF-test');
  const docs = await storeIdentityForContracts({ supabase: fixture.db, contracts: contracts.slice(0,count), payload, buffer: bytes });
  assert.equal(docs.length, count);
  assert.equal(fixture.files.size, count);
  assert.deepEqual(docs.map(d => d.contratto_id), contracts.slice(0,count).map(c => c.id));
  for (const doc of docs) {
    assert.equal(doc.uploaded_by, 'operatore');
    assert.equal(fixture.files.get(doc.storage_path), bytes);
  }
  fixture.files.delete(docs[0].storage_path);
  assert.equal(fixture.files.size, count - 1);
});

for (const failure of ['upload','copy','insert']) test(`errore ${failure}: nessuna associazione parziale e nessun originale eliminato`, async () => {
  const fixture = uploadFixture(failure);
  fixture.files.set('documento-preesistente.pdf', Buffer.from('originale'));
  // La copia fallisce sul primo duplicato con questo originale presente.
  await assert.rejects(storeIdentityForContracts({ supabase: fixture.db, contracts, payload, buffer: Buffer.from('%PDF-test') }));
  assert.equal(fixture.rows.length, 0);
  assert.deepEqual([...fixture.files.keys()], ['documento-preesistente.pdf']);
  assert.ok(!fixture.removed.includes('documento-preesistente.pdf'));
});

test('un contratto di un altro cliente/pratica e rifiutato prima di scrivere', async () => {
  const fixture = uploadFixture();
  await assert.rejects(storeIdentityForContracts({ supabase: fixture.db,
    contracts: [contracts[0], { ...contracts[1], anagrafica_id: 'altro' }], payload, buffer: Buffer.from('%PDF-test') }));
  assert.equal(fixture.files.size, 0);
});
test('copia identita permanente: commit riuscito con risposta persa non cancella gli originali registrati',async()=>{
 const bytes=Buffer.from('%PDF-sintetico'),sha256=require('node:crypto').createHash('sha256').update(bytes).digest('hex');
 const f=uploadFixture('insert_lost');const docs=await storeIdentityForContracts({supabase:f.db,contracts,payload:{...payload,sha256},buffer:bytes});
 assert.equal(docs.length,3);assert.equal(f.files.size,3);assert.equal(f.removed.length,0);
 const unknown=uploadFixture('read_lost');await assert.rejects(storeIdentityForContracts({supabase:unknown.db,contracts,payload:{...payload,sha256},buffer:bytes}));
 assert.equal(unknown.files.size,3);assert.equal(unknown.removed.length,0);
});

test('retroattivo conserva fronte/retro e ignora documenti di altre pratiche/clienti', () => {
  const doc = { ...payload, id: 'doc-1', mime_type: 'application/pdf', uploaded_at: '2026-07-01' };
  const plan = planBackfill([...contracts, { ...contracts[0], id: 'esterno', pratica_id: 'altra' }],
    [doc, { ...doc, id: 'doc-2', storage_path: '2026/10/pratica/retro.pdf' },
      { ...doc, id: 'doc-3', anagrafica_id: 'altro', contratto_id: 'altro', uploaded_at: '2026-06-01' }]);
  assert.equal(plan.recoverable.length, 2);
  assert.equal(plan.unresolved.length, 1);
  assert.equal(plan.unresolved[0].id, 'esterno');
  assert.deepEqual(plan.recoverable[0].documents.map(d => d.source.id), ['doc-1','doc-2']);
  assert.equal(new Set(plan.recoverable.flatMap(r => r.documents.map(d => d.storage_path))).size, 4);
});

test('retroattivo ripetuto lascia invariati i contratti gia coperti', () => {
  const docs = contracts.map((c,i) => ({ ...payload, id: `d${i}`, contratto_id: c.id,
    mime_type: 'application/pdf', uploaded_at: '2026-07-01' }));
  assert.equal(planBackfill(contracts, docs).missing, 0);
});

test('riuso esplicitamente autorizzato sceglie il documento piu recente dello stesso cliente e la cartella destinataria', () => {
  const target = { ...contracts[1], pratica_id: 'altra-pratica', storage_base_path: '2026/07/destinazione/' };
  const doc = { ...payload, id: 'vecchio', mime_type: 'application/pdf', uploaded_at: '2026-07-01' };
  const docs = [doc, { ...doc, id: 'recente', uploaded_at: '2026-10-01' },
    { ...doc, id: 'cliente-diverso', anagrafica_id: 'altro', uploaded_at: '2026-10-05' }];
  assert.equal(planBackfill([target], docs).unresolved.length, 1);
  const item = planBackfill([target], docs, { allowSameClient: true }).recoverable[0];
  assert.equal(item.sameClient, true);
  assert.equal(item.documents[0].source.id, 'recente');
  assert.ok(item.documents[0].storage_path.startsWith('2026/07/destinazione/'));
});

for (const failure of [null,'readback','insert']) test(`bonifica verifica i byte e compensa errori (${failure || 'successo'})`, async () => {
  const contract = { ...contracts[1], data_contratto: '2026-07-01T10:00:00Z' };
  const source = { ...payload, id: 'sorgente', file_size: 9, mime_type: 'application/pdf', uploaded_at: '2026-07-01' };
  const item = planBackfill([contract], [source]).recoverable[0];
  const files = new Map([[source.storage_path, Buffer.from('%PDF-test')]]);
  let inserted;
  const db = { storage: { from: () => ({
    async download(key) { return { data: new Blob([files.get(key)]) }; },
    async copy(src,dst) { files.set(dst, failure === 'readback' ? Buffer.from('%PDF-wrong') : files.get(src)); return {}; },
    async remove(keys) { keys.forEach(k => files.delete(k)); return {}; }
  }) }, from(table) {
    let rows, filters = [];
    const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; },
      insert(r) { rows = r; return q; }, async single() { return { data: table === 'vendita_contratti' ? contract : source }; },
      then(resolve,reject) { return Promise.resolve(rows ?
        failure === 'insert' ? { error: new Error('DB') } : (inserted = rows, { data: rows }) : { data: [] }).then(resolve,reject); }
    }; return q;
  } };
  if (failure) {
    await assert.rejects(copyContractIdentity(db, item));
    assert.equal(files.size, 1);
    assert.equal(inserted, undefined);
  } else {
    const result = await copyContractIdentity(db, item);
    assert.equal(files.size, 2);
    assert.equal(result.checks[0].size, 9);
    assert.equal(result.checks[0].sha256.length, 64);
    assert.equal(inserted[0].uploaded_at, source.uploaded_at);
    assert.equal(inserted[0].contratto_id, contract.id);
  }
  assert.deepEqual(files.get(source.storage_path), Buffer.from('%PDF-test'));
});

function finalizeFixture({ identityIds, readError = false, check = null, fileDocs = [], customer = null, contractPatch = {} }) {
  let finalized = false, ccCalls = 0;
  const practice = { id: pratica, anagrafica_id: cliente, operatore_id: 'user', stato_pratica: 'bozza', identita_verifica_upload: check };
  const db = { from(table) {
    let update = false; const filters = [];
    const q = { select() { return q; }, eq(key, value) { filters.push([key, value]); return q; }, update() { update = true; return q; },
      async single() { return { data: customer }; },
      async maybeSingle() { if (update) finalized = true; return { data: update ? { id: pratica } : practice }; },
      then(resolve, reject) {
        let data = table === 'vendita_contratti' ? contracts.map(c => ({ ...c, ...contractPatch })) : check ? fileDocs : identityIds.map(contratto_id => ({ contratto_id }));
        if (check && table === 'vendita_documenti') for (const [key, value] of filters) {
          if (key === 'tipo_documento') data = data.filter(row => row[key] === value);
        }
        return Promise.resolve(readError ? { error: new Error('DB offline') } : { data }).then(resolve,reject);
      }
    }; return q;
  }, async rpc() { ccCalls++; return { data: {} }; } };
  const module = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../netlify/functions/crea-vendita-pratica-carrello.js'), 'utf8');
  vm.runInNewContext(source, { module, exports: module.exports, Buffer, console: { log() {} },
    process: { env: { SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'private' } },
    require(id) {
      if (id === './_lib/windtre-customer-codes') return require('../netlify/functions/_lib/windtre-customer-codes');
        if (id === './_lib/identita-upload') return require('../netlify/functions/_lib/identita-upload');
        if (id === './_lib/pda-business-identity') return require('../netlify/functions/_lib/pda-business-identity');
      if (id === './_lib/pda-contract') return require('../netlify/functions/_lib/pda-contract');
      if (id === '../../js/customer-base-device') return require('../js/customer-base-device');
      if (id === '@supabase/supabase-js') return { createClient: () => db };
      if (id === './_lib/require-auth') return { requireAuth: async () => ({ ok: true, user: { id: 'user' }, profilo: { ruolo: 'admin' } }) };
      if (id === './_lib/privacy-config') return { INFORMATIVE_VERSIONI_CORRENTI: [] };
      if (id === './_lib/score-integrity') return {};
      throw new Error(id);
    } });
  return { handler: module.exports.handler, get finalized() { return finalized; }, get ccCalls() { return ccCalls; } };
}

test('finalize nuovo upload verifica hash di tutti i PDF, anagrafica e permesso Consumer VAR extra UE lato server', async () => {
  const owner = { cf_piva: 'RSSMRA80A01H501U', cluster: 'Consumer', ragione_sociale: 'Mario Rossi' };
  const check = { version: 1, customer: owner, result: { stato: 'coerente', cittadinanza: 'extra_ue' }, documents: [{ sha256: 'a'.repeat(64) }] };
  const docs = contracts.flatMap(c => [{ contratto_id: c.id, tipo_documento: 'documento_identita', sha256: 'a'.repeat(64) },
    { contratto_id: c.id, tipo_documento: 'permesso_soggiorno', sha256: 'b'.repeat(64) }]);
  const mobile = { categoria_snapshot: 'Mobile', cluster_cliente: 'Consumer', dispositivo_associato: true, tipo_acquisto: 'VAR' };
  for (const scenario of [
    { status: 200 },
    { status: 409, fileDocs: docs.filter(d => d.tipo_documento !== 'permesso_soggiorno') },
    { status: 409, fileDocs: docs.map(d => ({ ...d, sha256: 'c'.repeat(64) })) },
    { status: 409, customer: { ...owner, ragione_sociale: 'Altra persona' } },
    { status: 409, check: { ...check, result: { ...check.result, cittadinanza: null } } },
    { status: 200, contractPatch: { ...mobile, tipo_acquisto: 'Finanziamento' }, fileDocs: docs.filter(d => d.tipo_documento !== 'permesso_soggiorno') }
  ]) {
    const fixture = finalizeFixture({ identityIds: [], check, customer: owner, fileDocs: docs, contractPatch: mobile, ...scenario });
    const response = await fixture.handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'finalize', pratica_id: pratica }) });
    assert.equal(response.statusCode, scenario.status, response.body);
    assert.equal(fixture.finalized, scenario.status === 200); assert.equal(fixture.ccCalls, scenario.status === 200 ? 1 : 0);
  }
});

for (const scenario of [
  { ids: [contracts[0].id], status: 409 },
  { ids: contracts.map(c => c.id), status: 200 },
  { ids: contracts.map(c => c.id), readError: true, status: 500 }
]) test(`finalizzazione controlla ogni riga prima di chiudere eventi CC (${scenario.status})`, async () => {
  const fixture = finalizeFixture({ identityIds: scenario.ids, readError: scenario.readError });
  const result = await fixture.handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'finalize', pratica_id: pratica }) });
  assert.equal(result.statusCode, scenario.status);
  assert.equal(fixture.finalized, scenario.status === 200);
  assert.equal(fixture.ccCalls, scenario.status === 200 ? 1 : 0);
});
