'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {requirementHash,developmentMandate}=require('../netlify/functions/_lib/guardian-development');
const webhook=require('../netlify/functions/guardian-telegram-webhook')._test;
const worker=require('../netlify/functions/guardian-codex-worker')._test;
const {hashLeaseToken}=require('../netlify/functions/_lib/guardian-codex');
const incidentId='11111111-1111-4111-8111-111111111111',lease='l'.repeat(64),head='a'.repeat(40),base='b'.repeat(40);
function subset(value,wanted) {return Object.entries(wanted).every(([k,v])=>v && typeof v==='object' ? subset(value?.[k],v) : value?.[k]===v);}
function database(seed = {}) {
  const tables = structuredClone(seed);
  const db = { tables, from(name) {
    tables[name] ||= [];
    let filters = [], sorting, cap, single = false, operation, values, upsertOptions;
    const q = {
      select() { return q; },
      eq(k, v) { filters.push(r => r[k] === v); return q; },
      in(k, v) { filters.push(r => v.includes(r[k])); return q; },
      contains(k,v) { filters.push(r => subset(r[k],v)); return q; },
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
            if(operation==='insert' && name==='kona_ai_esecuzioni' && tables[name].some(r=>r.incidente_id===values.incidente_id && r.tipo_esecuzione===values.tipo_esecuzione && ['in_coda','in_esecuzione'].includes(r.stato))) {resolve({data:null,error:{code:'23505'}});return;}
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
function seed() {return {kona_ai_incidenti:[{id:incidentId,numero:23,tipo_richiesta:'miglioria',stato:'ricevuto',titolo:'Due righe',riepilogo_ai:'Due righe Day by Day e opzioni Customer Base'}],kona_ai_telegram_sessioni:[{chat_id:'123',incidente_attivo_id:incidentId,conversazione:[]}]};}
function network(t) {
 const calls=[];
 for(const [key,value] of Object.entries({TELEGRAM_GUARDIAN_OWNER_CHAT_ID:'123',TELEGRAM_GUARDIAN_BOT_TOKEN:'test',GUARDIAN_GITHUB_TOKEN:'test',OPENAI_API_KEY:'test'})) {
  const previous=process.env[key];process.env[key]=value;t.after(()=>previous===undefined ? delete process.env[key]:process.env[key]=previous);
 }
 t.mock.method(global,'fetch',async(url,opts={})=>{
  const body=JSON.parse(opts.body || '{}');calls.push({url,body});let result={};
  if(url.includes('api.telegram.org'))result={ok:true,result:{message_id:42}};
  else if(url.includes('/dispatches'))result={};
  else if(url.endsWith('/git/ref/heads/main'))result={object:{sha:base}};
  else if(url.endsWith('/pulls/33'))result={state:'open',merged:false,number:33,changed_files:1,base:{ref:'main',repo:{full_name:'mirkopiasenti/mirox-crm'}},head:{ref:'codex/kg-fixture',sha:head,repo:{full_name:'mirkopiasenti/mirox-crm'}}};
  else if(url.includes('/pulls/33/files'))result=[{filename:'js/example.js'}];
  else if(url.includes('api.openai.com'))result={output_text:JSON.stringify({reply:'Possiamo svilupparla.',suggested_action:'proponi_sviluppo',request_type:'invariata',request_summary:''})};
  else throw Error('unexpected '+url);
  return {ok:true,status:200,json:async()=>result};
 });return calls;
}
function running(db,execution) {const current=db.tables.kona_ai_esecuzioni.find(r=>r.id===execution.id);Object.assign(current,{stato:'in_esecuzione',lease_token_hash:hashLeaseToken(lease),lease_expires_at:new Date(Date.now()+60000).toISOString()});return current;}
async function patch(t,db) {network(t);await webhook.approveWork(db,'123',incidentId,{source:'telegram_text',sourceId:44});return running(db,db.tables.kona_ai_esecuzioni[0]);}
const dispatches=calls=>calls.filter(c=>c.url.includes('/dispatches'));
test('mandati espliciti avviano sviluppo, citazioni/negazioni/condizioni e domande non lo avviano',()=>{
 for(const phrase of ['Procedi con l’implementazione di questa cosa','Procedi con lo sviluppo','Implementala','Sviluppa questa funzione','OK, procedi con il lavoro'])assert(developmentMandate(phrase),phrase);
 for(const phrase of ['Non procedere con lo sviluppo','Se va bene procedi con lo sviluppo','Mi hai detto “procedi con lo sviluppo”','Puoi svilupparla?','Procedi con lo sviluppo quando ti do conferma','Voglio solo capire'])assert(!developmentMandate(phrase),phrase);
});
test('comando reale del proprietario salta analisi conversazionale e crea un solo workflow patch',async t=>{
 const calls=network(t),db=database(seed());
 await webhook.handleOwnerConversation(db,'123',db.tables.kona_ai_telegram_sessioni[0],'Procedi con l’implementazione di questa cosa',{telegram_message_id:44});
 assert.equal(dispatches(calls).length,1);assert.equal(dispatches(calls)[0].body.inputs.requested_type,'prepara_patch');
 assert(!calls.some(c=>c.url.includes('api.openai.com')));
 assert.equal(db.tables.kona_ai_approvazioni[0].risultato.development.auto_test,true);
 await webhook.approveWork(db,'123',incidentId,{sourceId:44});assert.equal(dispatches(calls).length,1);
});
test('una richiesta libera propone sviluppo con pulsante senza dispatch del modello',async t=>{
 const calls=network(t),db=database(seed());
 await webhook.handleOwnerConversation(db,'123',db.tables.kona_ai_telegram_sessioni[0],'Puoi svilupparla?');
 assert.equal(dispatches(calls).length,0);assert(calls.some(c=>c.body.reply_markup?.inline_keyboard[0][0].callback_data==='approve_work:'+incidentId));
});
test('vecchio pulsante Analisi Guardian ora legge davvero il repository',async t=>{
 const calls=network(t),db=database(seed());
 await webhook.handleCallback(db,{callback_query:{id:'callback',data:'analyze:'+incidentId}},'123');
 assert.equal(dispatches(calls)[0].body.inputs.requested_type,'analisi_codex');
});
test('patch completata prosegue ai test e propone pubblicazione, senza merge o deploy automatico',async t=>{
 const calls=network(t),db=database(seed());await webhook.approveWork(db,'123',incidentId);
 const e=running(db,db.tables.kona_ai_esecuzioni[0]);
 await worker.recordResult(db,{execution_id:e.id,lease_token:lease,success:true,result_commit_sha:head,branch_name:'codex/kg-fixture',pull_request_url:'https://github.com/mirkopiasenti/mirox-crm/pull/33',result:{has_changes:true}});
 assert.deepEqual(dispatches(calls).map(c=>c.body.inputs.requested_type),['prepara_patch','test_staging']);
 await webhook.resumeDevelopmentTests(db);assert.equal(dispatches(calls).length,2);
 const verified=running(db,db.tables.kona_ai_esecuzioni[1]);
 await worker.recordResult(db,{execution_id:verified.id,lease_token:lease,success:true,result_commit_sha:head,result:{tested_base_sha:base,install:'success',tests:'success',smoke:'success'}});
 assert(calls.some(c=>c.body.reply_markup?.inline_keyboard[0][0].callback_data.startsWith('publish_production:')));
 assert(!calls.some(c=>c.url.endsWith('/merge')));assert.equal(dispatches(calls).length,2);
});
for(const outcome of ['needs_information','blocked','no_changes'])test(outcome+' ferma la catena senza ripetere analisi o test',async t=>{
 const calls=network(t),db=database(seed());await webhook.approveWork(db,'123',incidentId);const e=running(db,db.tables.kona_ai_esecuzioni[0]);
 await worker.recordResult(db,{execution_id:e.id,lease_token:lease,success:true,result:{[outcome]:true}});
 await webhook.resumeDevelopmentTests(db);assert.equal(dispatches(calls).length,1);
});
test('consenso assente/forgiato e requisito cambiato impediscono prosecuzione',async t=>{
 const calls=network(t),db=database(seed());await webhook.approveWork(db,'123',incidentId);const e=running(db,db.tables.kona_ai_esecuzioni[0]);
 db.tables.kona_ai_incidenti[0].riepilogo_ai='Requisito nuovo';
 await worker.recordResult(db,{execution_id:e.id,lease_token:lease,success:true,result_commit_sha:head,branch_name:'codex/kg-fixture',result:{development:{auto_test:true,owner_chat_id:'123',requirement_hash:requirementHash(db.tables.kona_ai_incidenti[0])}}});
 assert.equal(dispatches(calls).length,1);
 await assert.rejects(webhook.startStagingTests(db,'123',incidentId,{automatic:true,patchId:e.id}),/Requisito cambiato/);
 await assert.rejects(webhook.approveWork(db,'999',incidentId),/autorizzato/);
});
test('cron recupera un passaggio interrotto senza ripetere un test fallito',async t=>{
 const calls=network(t),db=database(seed());await webhook.approveWork(db,'123',incidentId);const e=db.tables.kona_ai_esecuzioni[0];
 Object.assign(e,{stato:'completata',result_commit_sha:head,branch_name:'codex/kg-fixture',completata_at:new Date().toISOString()});
 db.tables.kona_ai_approvazioni[0].stato='eseguita';
 await webhook.resumeDevelopmentTests(db);assert.equal(dispatches(calls).length,2);
 db.tables.kona_ai_esecuzioni[1].stato='fallita';
 await webhook.resumeDevelopmentTests(db);assert.equal(dispatches(calls).length,2);
});
test('retry vocale dopo completamento conserva il consenso originale senza seconda patch',async t=>{
 const calls=network(t),db=database(seed());await webhook.approveWork(db,'123',incidentId,{source:'telegram_voice',sourceId:'voice-job'});
 db.tables.kona_ai_esecuzioni[0].stato='fallita';await webhook.approveWork(db,'123',incidentId,{source:'telegram_voice',sourceId:'voice-job'});
 assert.equal(dispatches(calls).length,1);assert.equal(db.tables.kona_ai_approvazioni.length,1);
});

test('avvii concorrenti sfruttano il vincolo attivo DB e dispatchano una sola patch',async t=>{
 const calls=network(t),db=database(seed());
 await Promise.all([webhook.approveWork(db,'123',incidentId),webhook.approveWork(db,'123',incidentId)]);
 assert.equal(dispatches(calls).length,1);assert.equal(db.tables.kona_ai_esecuzioni.length,1);
});
test('una patch pronta viene riutilizzata e non genera una seconda implementazione',async t=>{
 const calls=network(t),db=database(seed());await webhook.approveWork(db,'123',incidentId);const e=running(db,db.tables.kona_ai_esecuzioni[0]);
 await worker.recordResult(db,{execution_id:e.id,lease_token:lease,success:true,result_commit_sha:head,branch_name:'codex/kg-fixture',result:{has_changes:true}});
 await webhook.approveWork(db,'123',incidentId);
 assert.equal(dispatches(calls).length,2);assert.equal(db.tables.kona_ai_esecuzioni.filter(r=>r.tipo_esecuzione==='prepara_patch').length,1);
});
