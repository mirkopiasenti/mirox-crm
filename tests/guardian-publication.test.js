'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const release = require('../netlify/functions/_lib/guardian-release');
const { publish } = require('../.github/codex/guardian-publish');
const { _test: webhook } = require('../netlify/functions/guardian-telegram-webhook');
const { _test: worker } = require('../netlify/functions/guardian-codex-worker');
const { hashLeaseToken } = require('../netlify/functions/_lib/guardian-codex');
const incidentId = '11111111-1111-4111-8111-111111111111';
const testId = '22222222-2222-4222-8222-222222222222';
const approvalId = '33333333-3333-4333-8333-333333333333';
const head = 'a'.repeat(40), base = 'b'.repeat(40), merged = 'c'.repeat(40);
const contract = { repository: release.REPOSITORY, base_branch: 'main', branch: 'codex/kg-test',
  head_sha: head, base_sha: base, pull_number: 22, pull_request_url: 'https://github.com/mirkopiasenti/mirox-crm/pull/22',
  incident_id: incidentId, test_execution_id: testId };
const pr = { state: 'open', merged: false, number: 22, changed_files: 1, mergeable: true, draft: false,
  base: { ref: 'main', repo: { full_name: release.REPOSITORY } },
  head: { ref: contract.branch, sha: head, repo: { full_name: release.REPOSITORY } } };
function database(seed = {}) {
  const tables = structuredClone(seed);
  const db = { tables, from(name) {
    tables[name] ||= [];
    let filters = [], sorting, cap, single = false, operation, values, upsertOptions;
    const q = {
      select() { return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, v) { filters.push(r => v.includes(r[k])); return q; },
      gt(k, v) { filters.push(r => r[k] > v); return q; },
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
            else { const r = { id: require('node:crypto').randomUUID(), numero: 99, created_at: new Date().toISOString(), ...structuredClone(values) }; tables[name].push(r); rows = [r]; }
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


function seed() { return {
  kona_ai_incidenti: [{ id: incidentId, numero: 22, stato: 'in_test', titolo: 'Collaudo', tipo_richiesta: 'problema' }],
  kona_ai_approvazioni: [{ id: approvalId, incidente_id: incidentId, azione: 'rilascia_produzione', stato: 'in_attesa',
    scade_at: new Date(Date.now()+3600000).toISOString(), risultato: { release_contract: contract, telegram_message_id: 42 } }],
  kona_ai_esecuzioni: [{ id: testId, incidente_id: incidentId, tipo_esecuzione: 'test_staging', stato: 'completata',
    branch_name: contract.branch, result_commit_sha: head, pull_request_url: contract.pull_request_url,
    risultato: { tested_base_sha: base, install: 'success', tests: 'success', smoke: 'success' } }]
}; }
function network(t, overrides = {}) {
  const calls = [];
  for (const [key, value] of Object.entries({ TELEGRAM_GUARDIAN_OWNER_CHAT_ID: '123', TELEGRAM_GUARDIAN_BOT_TOKEN: 'test', GUARDIAN_GITHUB_TOKEN: 'test' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
  t.mock.method(global, 'fetch', async (url, opts = {}) => {
    calls.push({url, body: JSON.parse(opts.body || '{}')});
    let body;
    if (url.includes('api.telegram.org')) body = { ok: true, result: { message_id: 42 } };
    else if (url.endsWith('/git/ref/heads/main')) body = { object: { sha: overrides.base || base } };
    else if (url.endsWith('/pulls/22')) body = overrides.pr || pr;
    else if (url.includes('/pulls/22/files')) body = [{ filename: overrides.file || 'js/example.js' }];
    else if(url.includes('/commits/'))body={parents:[{sha:base},{sha:head}]};
    else if(url.includes('/js/config.js'))return {ok:true,text:async()=> 'window.MiroxEnvironmentInfo = '+JSON.stringify({environment:'production',commit_sha:overrides.liveSha || merged})+';'};
    else if (url.includes('/dispatches')) body = {};
    else throw new Error('unexpected request: '+url);
    return {ok:true, status:200, json: async () => body};
  });
  return calls;
}
function runner({ live = true, health = true, changed = false, expire = false, mergeError = false } = {}) {
  const calls = [], terminal = [];
  return { calls, terminal, options: {
    token:'test', maxPolls:2, pause:async()=>{},
    inspect:async c => { release.verifyPull(c, pr, changed ? merged : base); return pr; },
    github:async (path, opts = {}) => {
      calls.push({path, method:opts.method});
      if (path.endsWith('/git/ref/heads/main')) return {object:{sha:base}};
      if (path.endsWith('/merge')) { if (mergeError) throw new Error('merge rejected'); return {merged:true,sha:merged}; }
      if (path.includes('/commits/')) return {parents:[{sha:base},{sha:head}]};
      if (path.endsWith('/pulls/22')) return pr;
      throw new Error('unexpected '+path);
    },
    request:async()=>({ok:true,text:async()=> 'window.MiroxEnvironmentInfo = '+JSON.stringify({environment:'production',commit_sha:live?merged:base,deploy_id:'deploy-22'})+';'}),
    worker:async(action, body)=>{
      calls.push({action});
      if (action === 'claim') return {lease_token:'l'.repeat(64),context:{release_contract:contract}};
      if (action === 'release_authorization') { if(expire) throw new Error('Approval expired'); return {release_contract:contract}; }
      if (action === 'health') return {ok:health};
      if (action === 'result') terminal.push(body);
      return {ok:true};
    }
  }};
}

test('contratto e PR rifiutano altri repo, versioni cambiate e path protetti anche rinominati', () => {
  assert.throws(()=>release.validateContract({...contract,repository:'other/repo'}));
  assert.throws(()=>release.verifyPull(contract,{...pr,head:{...pr.head,sha:merged}},base));
  assert.throws(()=>release.verifyPull(contract,pr,merged));
  assert.throws(()=>release.verifyPull(contract,{...pr,head:{...pr.head,repo:{full_name:'other/repo'}}},base));
  for(const path of ['.github/codex/run.js','.github/workflows/x.yml','.env','nested/.env.local','package.json','package-lock.json','database/081.sql','netlify.toml']) {
    assert.throws(()=>release.verifyFiles([{filename:path}],1));
    assert.throws(()=>release.verifyFiles([{filename:'js/x.js',previous_filename:path}],1));
  }
  assert.throws(()=>release.verifyFiles([{filename:'js/x.js'}],2));
  release.verifyFiles([{filename:'js/x.js'}],1);
});

test('la proposta finale crea solo un pulsante, senza dispatch o merge', async t => {
  const calls=network(t), db=database(seed());
  await webhook.prepareProductionRelease(db,'123',incidentId);
  assert.equal(db.tables.kona_ai_approvazioni[0].stato,'scaduta');
  assert.equal(db.tables.kona_ai_approvazioni[1].stato,'in_attesa');
  assert(calls.some(c=>c.body.reply_markup?.inline_keyboard[0][0].callback_data.startsWith('publish_production:')));
  assert(!calls.some(c=>c.url.includes('/dispatches') || c.url.endsWith('/merge')));
});

test('doppia conferma concorrente crea un solo rilascio e dispatch del workflow su main', async t => {
  const calls=network(t),db=database(seed());
  await Promise.all([webhook.publishProduction(db,'123',approvalId),webhook.publishProduction(db,'123',approvalId)]);
  const dispatch=calls.filter(c=>c.url.includes('/dispatches'));
  assert.equal(dispatch.length,1); assert.equal(dispatch[0].body.ref,'main');
  assert.equal(db.tables.kona_ai_esecuzioni.filter(e=>e.tipo_esecuzione==='rilascio_produzione').length,1);
  assert.equal(db.tables.kona_ai_approvazioni[0].stato,'approvata');
});

for (const scenario of ['unauthorized','expired','closed','failed-tests','changed-production','protected-file']) {
  test('conferma blocca '+scenario+' prima del dispatch',async t=>{
    const overrides=scenario==='changed-production'?{base:merged}:scenario==='protected-file'?{file:'database/x.sql'}:{};
    const calls=network(t,overrides), s=seed();
    if(scenario==='expired') s.kona_ai_approvazioni[0].scade_at='2000-01-01';
    if(scenario==='closed') s.kona_ai_incidenti[0].stato='archiviato';
    if(scenario==='failed-tests') s.kona_ai_esecuzioni[0].risultato.tests='failure';
    await assert.rejects(webhook.publishProduction(database(s),scenario==='unauthorized'?'999':'123',approvalId));
    assert(!calls.some(c=>c.url.includes('/dispatches')));
  });
}

test('OK pubblica deve rispondere al messaggio di conferma preciso',async t=>{
  const calls=network(t),db=database(seed());
  await assert.rejects(webhook.handleMessage(db,{message:{text:'OK pubblica',reply_to_message:{message_id:999}}},'123',{}));
  assert(!calls.some(c=>c.url.includes('/dispatches')));
  await webhook.handleMessage(db,{message:{text:'OK pubblica',reply_to_message:{message_id:42}}},'123',{});
  assert.equal(calls.filter(c=>c.url.includes('/dispatches')).length,1);
});

test('worker verifica proprietario, test e autorizzazione anche al momento del merge',async t=>{
  network(t); const s=seed();
  Object.assign(s.kona_ai_approvazioni[0],{stato:'approvata',decisa_da_telegram_chat_id:'123',decisa_at:new Date().toISOString()});
  const e={tipo_esecuzione:'rilascio_produzione',approvazione_id:approvalId,incidente_id:incidentId,base_commit_sha:head,branch_name:contract.branch,pull_request_url:contract.pull_request_url};
  assert.deepEqual(await worker.releaseAuthorization(database(s),e),contract);
  s.kona_ai_approvazioni[0].decisa_da_telegram_chat_id='999';
  await assert.rejects(worker.releaseAuthorization(database(s),e));
});

test('pubblicazione verifica commit online e salute prima di dichiarare successo',async()=>{
  const run=runner(); const result=await publish(run.options);
  assert.equal(result.deploy_status,'ready'); assert.equal(result.health_ok,true);
  assert.equal(run.terminal[0].success,true); assert.equal(run.terminal[0].result_commit_sha,merged);
});
for(const [scenario,options,mergedExpected] of [ ['base cambiata',{changed:true},false],['approvazione scaduta',{expire:true},false],
  ['merge rifiutato',{mergeError:true},false],['deploy assente',{live:false},true],['salute fallita',{health:false},true] ]) {
  test('runner distingue '+scenario+' da una pubblicazione riuscita',async()=>{
    const run=runner(options); await assert.rejects(publish(run.options));
    assert.equal(run.terminal[0].success,false);assert.equal(run.terminal[0].result.merged,mergedExpected);
    if(!mergedExpected) assert(!run.calls.some(c=>c.method==='PUT') || options.mergeError);
  });
}

test('risultato chiude il caso solo con deploy verificato e conserva contratto e notifica persistente', async t=>{
  network(t);
  for(const ready of [true,false]) {
    const s=seed(),lease='l'.repeat(64);
    s.kona_ai_esecuzioni.push({id:approvalId,incidente_id:incidentId,approvazione_id:approvalId,tipo_esecuzione:'rilascio_produzione',stato:'in_esecuzione',
      lease_token_hash:hashLeaseToken(lease),lease_expires_at:new Date(Date.now()+3600000).toISOString(),branch_name:contract.branch,pull_request_url:contract.pull_request_url});
    const db=database(s);
    await worker.recordResult(db,{execution_id:approvalId,lease_token:lease,success:true,result_commit_sha:merged,
      result:{merged:true,merge_commit_sha:merged,deploy_status:ready?'ready':'unconfirmed',health_ok:ready}});
    assert.equal(db.tables.kona_ai_incidenti[0].stato,ready?'risolto':'in_lavorazione');
    assert.deepEqual(db.tables.kona_ai_approvazioni[0].risultato.release_contract,contract);
    assert.equal(db.tables.kona_ai_notifiche[0].dedupe_key,'release:result:'+approvalId);
    assert.match(db.tables.kona_ai_notifiche[0].payload.text,ready ? /pubblicata in produzione/ : /rilascio del CRM non è confermato/);
  }
});

const {validateReview}=require('../netlify/functions/_lib/guardian-catalog-plan');
const sourcePatchId='55555555-5555-4555-8555-555555555555',sourceApprovalId='44444444-4444-4444-8444-444444444444';
const catalogPlan={version:1,offers:[{id:'66666666-6666-4666-8666-666666666666',categoria_id:'77777777-7777-4777-8777-777777777777',cluster_cliente:'Consumer',nome_offerta:'Cambio Piano + Telefono VAR',punteggio_gara:1,punteggio_extra_gara:0,abilita_dispositivo:true,abilita_switch_sim:false}],daily_rows:[],daily_updates:[]};
const planJson=JSON.stringify(catalogPlan),planHash=require('node:crypto').createHash('sha256').update(planJson).digest('hex');
const review={head_sha:head,hash:planHash,plan_json:planJson,reviewed_by:'codex_local',summary:'Due combinazioni a1punto complessivo'};
const reference={patch_execution_id:sourcePatchId,patch_approval_id:sourceApprovalId,head_sha:head,hash:planHash,summary:review.summary};
function catalogSeed(){const data=seed();
 data.kona_ai_esecuzioni[0].risultato.development={patch_execution_id:sourcePatchId,auto_test:true,owner_chat_id:'123',requirement_hash:require('../netlify/functions/_lib/guardian-development').requirementHash(data.kona_ai_incidenti[0])};
 data.kona_ai_esecuzioni.push({id:sourcePatchId,incidente_id:incidentId,approvazione_id:sourceApprovalId,risultato:{catalog_required:true}});
 data.kona_ai_approvazioni.push({id:sourceApprovalId,incidente_id:incidentId,risultato:{catalog_review:structuredClone(review)}});
 data.kona_ai_approvazioni[0].risultato.release_contract={...contract,catalog_plan:structuredClone(reference)};return data;}
test('piano catalogo richiede digest, revisore, SHA e schema chiuso',()=>{
 assert.equal(validateReview(review,head).offers[0].punteggio_gara,1);
 for(const changed of [{...review,head_sha:merged},{...review,reviewed_by:'worker'},{...review,plan_json:planJson.replace('VAR','FINANZIATO')}])assert.throws(()=>validateReview(changed,head));
 const invalid=JSON.stringify({...catalogPlan,sql:'delete from profili'});
 assert.throws(()=>validateReview({...review,plan_json:invalid,hash:require('node:crypto').createHash('sha256').update(invalid).digest('hex')},head));
});
test('proposta Telegram comprende piano dati revisionato, senza applicarlo',async t=>{
 const calls=network(t),db=database(catalogSeed());await webhook.prepareProductionRelease(db,'123',incidentId);
 assert(calls.some(c=>c.body.text?.includes('Piano dati revisionato: Due combinazioni')));
 assert(!calls.some(c=>c.url.includes('/dispatches')));
});
test('cambio del piano dopo la conferma rifiuta il dispatch',async t=>{
 const calls=network(t),data=catalogSeed();data.kona_ai_approvazioni[1].risultato.catalog_review.summary='Altro piano';
 await assert.rejects(webhook.publishProduction(database(data),'123',approvalId),/revisione catalogo/);
 assert(!calls.some(c=>c.url.includes('/dispatches')));
});
for(const liveSha of [merged,base])test('applicazione catalogo verifica versione online '+liveSha[0],async t=>{
 network(t,{pr:{...pr,merged:true,merge_commit_sha:merged},liveSha});const data=catalogSeed();
 const execution={id:'88888888-8888-4888-8888-888888888888',incidente_id:incidentId,approvazione_id:approvalId,tipo_esecuzione:'rilascio_produzione',stato:'in_esecuzione',base_commit_sha:head,branch_name:contract.branch,pull_request_url:contract.pull_request_url,lease_token_hash:hashLeaseToken('l'.repeat(64)),lease_expires_at:new Date(Date.now()+60000).toISOString()};
 data.kona_ai_esecuzioni.push(execution);Object.assign(data.kona_ai_approvazioni[0],{stato:'approvata',decisa_at:new Date().toISOString(),decisa_da_telegram_chat_id:'123'});
 const db=database(data);let applied=0;db.rpc=async(name,args)=>{assert.equal(name,'guardian_apply_reviewed_catalog');assert.equal(args.p_head_sha,head);applied++;return {data:{ok:true,hash:planHash},error:null};};
 const body={execution_id:execution.id,lease_token:'l'.repeat(64),merge_commit_sha:merged,sql:'IGNORATO'};
 if(liveSha===merged){const response=await worker.applyCatalog(db,body);assert.equal(response.statusCode,200);assert.equal(applied,1);}
 else{await assert.rejects(worker.applyCatalog(db,body),/non online/);assert.equal(applied,0);}
});
for(const fail of [false,true])test('runner applica piano dopo deploy e prima della salute; errore='+fail,async()=>{
 const r=runner(),original=r.options.worker,c={...contract,catalog_plan:reference};
 r.options.worker=async(action,payload)=>{
  if(action==='claim'){const data=await original(action,payload);data.context.release_contract=c;return data;}
  if(action==='release_authorization')return {release_contract:c};
  if(action==='apply_catalog'){r.calls.push({action});if(fail)throw Error('piano cambiato');return {ok:true,catalog:{ok:true,hash:planHash}};}
  return original(action,payload);
 };
 if(fail){await assert.rejects(publish(r.options),/piano cambiato/);assert.equal(r.terminal[0].success,false);assert(!r.calls.some(c=>c.action==='health'));}
 else{await publish(r.options);assert(r.calls.findIndex(c=>c.action==='apply_catalog')<r.calls.findIndex(c=>c.action==='health'));assert.equal(r.terminal[0].result.catalog_applied.hash,planHash);}
});
for(const applied of [false,true])test('risultato catalogo chiude il caso solo con checkpoint server='+applied,async t=>{
 network(t);const data=catalogSeed();data.kona_ai_approvazioni[0].stato='approvata';
 if(applied)data.kona_ai_approvazioni[0].risultato.catalog_applied={ok:true,hash:planHash};
 data.kona_ai_esecuzioni.push({id:approvalId,incidente_id:incidentId,approvazione_id:approvalId,tipo_esecuzione:'rilascio_produzione',stato:'in_esecuzione',lease_token_hash:hashLeaseToken('l'.repeat(64)),lease_expires_at:new Date(Date.now()+60000).toISOString()});
 const db=database(data);
 await worker.recordResult(db,{execution_id:approvalId,lease_token:'l'.repeat(64),success:true,result_commit_sha:merged,result:{merged:true,merge_commit_sha:merged,deploy_status:'ready',health_ok:true,catalog_applied:{ok:true,hash:planHash}}});
 assert.equal(db.tables.kona_ai_incidenti[0].stato,applied?'risolto':'in_lavorazione');
});
