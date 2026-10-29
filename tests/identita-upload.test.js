'use strict';
require('node:test').mock.method(require('../netlify/functions/_lib/identita-barcode'),'readPdf',async()=>({attempted:false,complete:true,conflict:false,values:[]}));
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../js/identita-upload-core');
const Identity = require('../netlify/functions/_lib/identita-upload');
const Docs = require('../netlify/functions/_lib/verifica-documenti');
const Worker = require('../netlify/functions/_lib/verifica-worker');
const { handler } = require('../netlify/functions/verifica-identita-upload');
const person = { cf_piva: 'RSSMRA80A01H501U', cluster: 'Consumer', ragione_sociale: 'Mario Rossi' };
const evidence = value => ({ value, page: 1, quote: String(value) + ' dal documento' });
function reading(patch = {}) {
  return { fields: Object.fromEntries(Object.entries({ nome: 'Mario Rossi', fiscale: person.cf_piva, nascita: '1980-01-01',
    scadenza: '2030-01-01', tipo_identita: 'carta_identita', numero_documento: 'AZ1234567', cittadinanza: 'IT', fronte_presente: true, retro_presente: true, ...patch })
    .map(([key, value]) => [key, value === null ? null : evidence(value)])) };
}
const contract = { categoria_snapshot: 'Mobile', cluster_cliente: 'Consumer', dispositivo_associato: true, tipo_acquisto: 'VAR' };
test('identita Consumer: solo CF esatto; CF assente richiede conferma esplicita anche con nome corretto', () => {
  assert.equal(Core.evaluate([reading()], person, '2026-10-27').stato, 'coerente');
  assert.equal(Core.evaluate([reading({ nome: 'Rossi Mario' })], person, '2026-10-27').stato, 'coerente');
  for(const nome of ['Luigi Verdi',null])assert.equal(Core.evaluate([reading({nome})],person,'2026-10-27').stato,'coerente');
  assert.equal(Core.evaluate([reading({fiscale:'VRDLGI80A01H501Z'})],person,'2026-10-27').stato,'da_correggere');
  assert.equal(Core.evaluate([reading({ fiscale: null })], person, '2026-10-27').stato, 'da_confermare');
  assert.equal(Core.evaluate([reading({ fiscale: null, nascita: null })], person, '2026-10-27').stato, 'da_confermare');
  assert.equal(Core.evaluate([reading(), reading({ nome: 'Altra Persona' })], person, '2026-10-27').stato, 'coerente');
  assert.equal(Core.evaluate([reading({fiscale:null,nome:'Altro Nome'})],person,'2026-10-27').stato,'da_confermare');
  assert.equal(Core.evaluate([reading(), reading({ numero_documento: 'ALTRO123' })], person, '2026-10-27').stato, 'da_correggere');
});
test('Business confronta Nome referente, non societa o partita IVA', () => {
  const business = { cf_piva: '01234567890', cluster: 'Business', ragione_sociale: 'Societa esempio', nome_referente: 'Mario Rossi' };
  assert.equal(Core.evaluate([reading()], business, '2026-10-27').stato, 'coerente');
  assert.equal(Core.evaluate([reading()], { ...business, nome_referente: 'Altro Referente' }, '2026-10-27').stato, 'da_correggere');
  assert.notEqual(Core.evaluate([reading()], { ...business, nome_referente: null }, '2026-10-27').stato, 'coerente');
});
test('confronto identita espone nome anagrafico e nome trascritto senza cambiare il blocco', () => {
  const result=Core.evaluate([reading({nome:'Mario Rosi',fiscale:null})],person,'2026-10-27');
  assert.equal(result.stato,'da_confermare');
  assert.equal(result.cf_da_confermare,true);
  assert.deepEqual(result.confronto,{campo_anagrafica:'Ragione sociale',nome_informativo:true,fiscale_atteso:person.cf_piva,fiscali_documenti:[],nome_anagrafica:'Mario Rossi',nomi_documenti:['Mario Rosi']});
  const business={cf_piva:'01234567890',cluster:'Business',ragione_sociale:'Societa esempio',nome_referente:'Mario Rossi'};
  assert.equal(Core.evaluate([reading()],business,'2026-10-27').confronto.campo_anagrafica,'Nome referente');
  assert.equal(Core.evaluate([reading()],business,'2026-10-27').confronto.nome_anagrafica,'Mario Rossi');
});
test('fronte/retro, tipo riconosciuto e validita alla firma: nessun uso della data upload', () => {
  assert.equal(Core.evaluate([reading({ retro_presente: false })], person, '2026-10-27').stato, 'da_confermare');
  assert.equal(Core.evaluate([reading({ tipo_identita: 'passaporto', retro_presente: false })], person, '2026-10-27').stato, 'coerente');
  assert.equal(Core.evaluate([reading({ scadenza: '2026-10-27' })], person, '2026-10-27').stato, 'coerente');
  assert.equal(Core.evaluate([reading({ scadenza: '2026-10-26' })], person, '2026-10-27').stato, 'da_correggere');
  for (const value of ['', '2026-02-30', '2099-01-01']) assert.equal(Core.evaluate([reading()], person, value).stato, 'da_correggere');
});
test('cittadinanza esplicita UE/extra UE, distinta da residenza, rilascio e nascita', () => {
  assert.equal(Core.EU.length, 27);
  for (const value of ['IT', 'FR', 'BG', 'IT,MA']) assert.equal(Core.citizenship(value), 'ue');
  for (const value of ['MA', 'GB', 'CH', 'NO']) assert.equal(Core.citizenship(value), 'extra_ue');
  for (const value of ['', 'italiana', 'ITA', 'ZZ', 'UE']) assert.equal(Core.citizenship(value), null);
  assert.equal(Core.evaluate([reading({ cittadinanza: null })], person, '2026-10-27').cittadinanza, null);
  assert.equal(Core.needsPermit(contract, 'extra_ue'), true);
  for (const patch of [{ categoria_snapshot: 'Fisso' }, { categoria_snapshot: 'Customer Base' }, { cluster_cliente: 'Business' },
    { cluster_cliente: 'Turista' }, { dispositivo_associato: false }, { tipo_acquisto: 'Finanziamento' }]) assert.equal(Core.needsPermit({ ...contract, ...patch }, 'extra_ue'), false);
  for (const group of ['ue', null]) assert.equal(Core.needsPermit(contract, group), false);
});
test('ricevuta HMAC legata a utente, anagrafica e tempo; manomissioni rifiutate', () => {
  const data = { version: 1, at: 100000, user: 'user', customer: person, result: { stato: 'coerente' } };
  const token = Identity.sign(data, 'fixture-secret');
  const options = { user: 'user', customer: person, now: 100100, secret: 'fixture-secret' };
  assert.equal(Identity.verify(token, options).user, 'user');
  for (const patch of [{ user: 'other' }, { customer: { ...person, ragione_sociale: 'Altro Cliente' } },
    { now: 100000 + 5 * 3600000 }, { secret: 'wrong' }]) assert.throws(() => Identity.verify(token, { ...options, ...patch }), /Ripeti il controllo/);
  assert.throws(() => Identity.verify(token + 'x', options), /Ripeti il controllo/);
  assert.throws(() => Identity.assertPractice(data, { ...person, cf_piva: 'ALTRO' }), /anagrafica/);
});
test('conferma manuale tracciata solo per lettura incerta; problemi certi non aggirabili', () => {
  const result = Core.evaluate([reading({ fiscale: null, nascita: null, scadenza: null, cittadinanza: null })], person, '2026-10-27');
  const data = { user: 'user', customer: person, result };
  assert.throws(() => Identity.confirm(data, {}), /Descrivi/);
  assert.throws(() => Identity.confirm(data, { motivo: 'Verificato sul documento', scadenza: '2026-01-01' }), /scadenza/);
  const confirmed = Identity.confirm(data, { motivo: 'Confronto manuale con anagrafica CRM', scadenza: '2030-01-01', cittadinanza: 'extra_ue', codice_fiscale_verificato: person.cf_piva });
  assert.equal(confirmed.result.stato, 'manuale'); assert.equal(confirmed.conferma.user, 'user');
  assert.equal(confirmed.result.cittadinanza, 'extra_ue');
  assert.throws(() => Identity.confirm({ ...data, result: { ...result, stato: 'da_correggere' } }, { motivo: 'Controllo manuale' }), /Correggi/);
});
test('lettura non disponibile diventa conferma manuale, PDF invalido resta bloccante', async () => {
  const files = [{ buffer: Buffer.from('%PDF-front') }, { buffer: Buffer.from('%PDF-back') }];
  const result = await Identity.analyze(files, person, '2026-10-27', { pdfInfo: async () => 1, extract: async () => { throw new Error('provider offline'); } });
  assert.equal(result.documents.length, 2); assert.equal(result.result.stato, 'da_confermare');
  assert.notEqual(result.documents[0].sha256, result.documents[1].sha256);
  await assert.rejects(Identity.analyze(files, person, '2026-10-27', { pdfInfo: async () => { throw new Error('PDF invalido'); } }), /PDF invalido/);
});
test('CF non letto recuperato da seconda lettura indipendente: il nome discordante non blocca', async () => {
  let calls=0;
  const out=await Identity.analyze([{buffer:Buffer.from('%PDF-identity')}],person,'2026-10-27',{pdfInfo:async()=>1,extract:async doc=>{
    calls++;assert.equal(Object.hasOwn(doc,'customer'),false);
    if(calls===1)return reading({nome:'Mario Rosi',fiscale:null});
    assert.equal(doc.identity_tax_review,true);return reading({nome:'Mario Rosi'});
  }});
  assert.equal(calls,2);assert.equal(out.result.stato,'coerente');assert.deepEqual(out.result.errors,[]);
  assert.equal(out.result.cf_da_confermare,false);assert.equal(out.result.criterio_identita,'codice_fiscale');
  assert.equal(out.documents[0].seconda_lettura_cf.fields.fiscale.value,person.cf_piva);
});
test('ricontrollo CF assente non sostituisce carta diversa, dati discordanti o errori del servizio', async () => {
  for(const patch of [{numero_documento:'ALTRO123'},{scadenza:'2020-01-01'},{fiscale:null},null]){
    let calls=0;const out=await Identity.analyze([{buffer:Buffer.from('%PDF-identity')}],person,'2026-10-27',{pdfInfo:async()=>1,extract:async()=>{
      calls++;if(calls===1)return reading({nome:'Mario Rosi',fiscale:null});if(patch===null)throw Error('Servizio non disponibile');return reading(patch);
    }});
    assert.equal(calls,2);assert.equal(out.result.stato,'da_confermare');assert.equal(out.result.cf_da_confermare,true);
  }
  const out=await Identity.analyze([{buffer:Buffer.from('%PDF-identity')}],person,'2026-10-27',{pdfInfo:async()=>1,extract:async doc=>reading({fiscale:doc.identity_tax_review?'VRDLGI80A01H501Z':null})});
  assert.equal(out.result.stato,'da_correggere');assert.ok(out.result.errors.some(e=>e.includes('codice fiscale')));
});
test('CF manuale obbligatorio esatto e tracciato, senza fidarsi del nome OCR',()=>{
  const result=Core.evaluate([reading({nome:'Mario Rosi',fiscale:null})],person,'2026-10-27');
  const data={user:'user',customer:person,result};
  for(const value of [null,'VRDLGI80A01H501Z'])assert.throws(()=>Identity.confirm(data,{motivo:'CF controllato personalmente',codice_fiscale_verificato:value}),/codice fiscale/);
  const confirmed=Identity.confirm(data,{motivo:'CF controllato personalmente',codice_fiscale_verificato:person.cf_piva});
  assert.equal(confirmed.result.stato,'manuale');assert.equal(confirmed.conferma.codice_fiscale_verificato,person.cf_piva);
});
test('CF identico e scadenza valida evitano il ricontrollo nome; CF diverso o scaduto restano bloccanti', async () => {
  let calls=0;const out=await Identity.analyze([{buffer:Buffer.from('%PDF-identity')}],person,'2026-10-27',{pdfInfo:async()=>1,extract:async()=>{calls++;return reading({nome:'Mario Rosi'});}});
  assert.equal(calls,1);assert.equal(out.result.stato,'coerente');assert.equal(out.result.criterio_identita,'codice_fiscale');assert.equal(out.result.confronto.nome_informativo,true);
  assert.equal(Core.evaluate([reading({scadenza:'2020-01-01',nome:null})],person,'2026-10-27').stato,'da_correggere');
});
test('nuova API richiede permessi; confronto con CRM prima di AI e nessuna scrittura anagrafica', async () => {
  assert.equal((await handler({ httpMethod: 'POST' }, { requireAuth: async () => ({ ok: false, status: 403 }) })).statusCode, 403);
  let reads = 0;
  const db = { from(table) { assert.equal(table, 'anagrafica'); return { select() { return this; }, ilike() { return this; },
    async limit() { return { data: [{ ...person, ragione_sociale: 'Nome CRM differente' }] }; } }; } };
  const response = await handler({ httpMethod: 'POST', headers: {} }, { db,
    requireAuth: async () => ({ ok: true, user: { id: 'user' } }), multipart: async () => ({ fields: { cliente: JSON.stringify(person), data_firma: '2026-10-27' }, files: [] }),
    extract: async () => { reads++; } });
  assert.equal(response.statusCode, 400); assert.match(JSON.parse(response.body).error, /anagrafica CRM/); assert.equal(reads, 0);
});
test('passaporto e Turista usano PDF e preview manuale senza chiamare OCR o barcode',async()=>{
  for(const [cluster,tipo]of[['Consumer','passaporto'],['Turista','cie']]){
    const cliente={...person,cluster};let reads=0;
    const response=await handler({httpMethod:'POST',headers:{}},{secret:'fixture',db:{from(){return {select(){return this;},ilike(){return this;},limit:async()=>({data:[cliente]})};}},
      requireAuth:async()=>({ok:true,user:{id:'user'}}),pdfInfo:async()=>2,
      multipart:async()=>({fields:{cliente:JSON.stringify(cliente),data_firma:'2026-10-27',pacchetto:JSON.stringify({tipo})},files:[{buffer:Buffer.from('%PDF-fixture')}]}),
      extract:async()=>{reads++;return reading();},readBarcode:async()=>{reads++;return {};}});
    assert.equal(response.statusCode,200);assert.equal(reads,0);assert.equal(JSON.parse(response.body).result.stato,'da_confermare');
  }
});
test('API produce ricevuta verificabile dei PDF e registra la conferma manuale della cittadinanza assente', async () => {
  const db = { from() { return { select() { return this; }, ilike() { return this; }, limit: async () => ({ data: [person] }) }; } };
  const deps = { db, secret: 'fixture', requireAuth: async () => ({ ok: true, user: { id: 'user' } }),
    multipart: async () => ({ fields: { cliente: JSON.stringify(person), data_firma: '2026-10-27' }, files: [{ buffer: Buffer.from('%PDF-valid') }] }),
    pdfInfo: async () => 1, extract: async () => reading({ cittadinanza: null }) };
  const response = await handler({ httpMethod: 'POST', headers: {} }, deps);
  assert.equal(response.statusCode, 200);
  const { token } = JSON.parse(response.body);
  const data = Identity.verify(token, { user: 'user', customer: person, secret: 'fixture' });
  assert.equal(data.documents[0].sha256, Identity.hash(Buffer.from('%PDF-valid')));
  assert.equal(data.result.cittadinanza, null);
  const confirmation = await handler({ httpMethod: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, cittadinanza: 'extra_ue', motivo: 'Cittadinanza riscontrata nel documento originale' }) }, deps);
  assert.equal(confirmation.statusCode, 200);
  const confirmed = Identity.verify(JSON.parse(confirmation.body).token, { user: 'user', secret: 'fixture' });
  assert.equal(confirmed.result.cittadinanza, 'extra_ue'); assert.equal(confirmed.conferma.manuale, true);
});
test('riuso serale solo con stessi byte e anagrafica; permesso presente senza nuova lettura AI', async () => {
  const bytes = Buffer.from('%PDF-identity'); const digest = Identity.hash(bytes);
  const snapshot = { customer: person, practice: { identita_verifica_upload: { version: 1, customer: person,
    result: { stato: 'coerente', scadenza: '2030-01-01' }, documents: [{ sha256: digest }] } },
    documents: [{ id: 'identity', tipo_documento: 'documento_identita', storage_bucket: 'contratti-vendita', storage_path: 'identity.pdf' }] };
  let reads = 0;
  const db = { storage: { from() { return { download: async () => ({ data: new Blob([bytes]) }) }; } },
    from() { return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: null }), upsert: async () => ({ data: null }) }; } };
  const deps = { pdfInfo: async () => 1, extract: async doc => { reads++; return { id: doc.id, fields: {} }; } };
  assert.equal((await Docs.readDocuments(db, snapshot, deps)).identityPrecheck.scadenza, '2030-01-01'); assert.equal(reads, 0);
  const changed = { ...snapshot, customer: { ...person, ragione_sociale: 'Nome cambiato' } };
  assert.equal((await Docs.readDocuments(db, changed, deps)).identityPrecheck, null); assert.equal(reads, 1);
  const incomplete = { ...snapshot, practice: { identita_verifica_upload: { ...snapshot.practice.identita_verifica_upload,
    documents: [{ sha256: digest }, { sha256: 'f'.repeat(64) }] } } };
  const fallback = await Docs.readDocuments(db, incomplete, deps);
  assert.equal(fallback.identityPrecheck, null); assert.equal(fallback.extracted.documents.length, 1); assert.equal(reads, 2);
  const required = { contract, practice: { identita_verifica_upload: { result: { cittadinanza: 'extra_ue' } } }, documentRules: [] };
  assert.ok(Worker.requiredDocuments(required, { documents: [] }).some(e => e.code === 'allegato_permesso_soggiorno'));
  assert.equal(Worker.requiredDocuments(required, { documents: [{ tipo_documento: 'permesso_soggiorno' }] }).length, 0);
});
test('UI scarta una risposta tardiva dopo cambio anagrafica o documento', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const window = { MiroxSafe: { escapeHtml: String }, MiroxIdentitaCore: Core,
    MiroxApi: { fetch: async () => { await pending; return { ok: true, json: async () => ({ success: true, token: 'fixture', result: { stato: 'coerente', cittadinanza: 'ue' } }) }; } } };
  const ctx = { window, crypto: require('node:crypto').webcrypto, Uint8Array, Date, FormData,
    document: { getElementById: () => ({ textContent: '' }) } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/identita-upload-ui'), 'utf8'), ctx);
  let current = true;
  const result = window.MiroxIdentitaUpload.ensure({ files: [new File(['%PDF-test'], 'id.pdf')], customer: person, date: '2026-10-27', current: () => current });
  current = false; finish();
  await assert.rejects(result, /cambiati/); assert.equal(window.MiroxIdentitaUpload.get(), null);
});
test('UI invalida il controllo anche quando i file cambiano durante il calcolo hash', async () => {
  let finish;
  const bytes = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const window = { MiroxSafe: { escapeHtml: String }, MiroxIdentitaCore: Core,
    MiroxApi: { fetch: async () => { calls++; throw new Error('Non deve inviare'); } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/identita-upload-ui'), 'utf8'),
    { window, crypto: require('node:crypto').webcrypto, Uint8Array, Date, FormData });
  const result = window.MiroxIdentitaUpload.ensure({ files: [{ arrayBuffer: () => bytes }], customer: person, date: '2026-10-27' });
  window.MiroxIdentitaUpload.invalidate();
  finish(new Uint8Array([1, 2, 3]).buffer);
  await assert.rejects(result, /cambiati/); assert.equal(calls, 0);
});
test('diagnostica legacy mostra nomi escaped senza inserirli nel messaggio errore',()=>{
  let modal;
  const window={MiroxSafe:{escapeHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')},MiroxUI:{_build:options=>{modal=options;}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/identita-upload-ui'),'utf8'),{window});
  const error=Object.assign(new Error('Controllo non concluso'),{identityComparison:{campo_anagrafica:'Ragione sociale',nome_anagrafica:'Mario Rossi',nomi_documenti:['<img src=x>']}});
  assert.equal(window.MiroxIdentitaUpload.showError(error),true);
  assert.match(modal.bodyHtml,/Mario Rossi/);assert.match(modal.bodyHtml,/&lt;img/);assert.doesNotMatch(modal.bodyHtml,/<img/);
  assert.doesNotMatch(error.message,/Mario|img/);
});
