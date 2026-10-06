'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const voice=require('../netlify/functions/_lib/guardian-voice');
const {handler}=require('../netlify/functions/guardian-voice-background');
const {transcribeVoice}=require('../netlify/functions/_lib/telegram');
const { _test: webhook }=require('../netlify/functions/guardian-telegram-webhook');
const incident='11111111-1111-4111-8111-111111111111';
const jobId='22222222-2222-4222-8222-222222222222';
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
            else { if(name==='kona_ai_vocali_jobs' && tables[name].some(r=>r.update_id===values.update_id)){resolve({data:null,error:{code:'23505'}});return;} const r = { id: require('node:crypto').randomUUID(), numero: 99, created_at: new Date().toISOString(), ...structuredClone(values) }; tables[name].push(r); rows = [r]; }
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



function env(t) {
 for(const [k,v] of Object.entries({TELEGRAM_GUARDIAN_OWNER_CHAT_ID:'123',GUARDIAN_WORKER_SECRET:'test-secret',OPENAI_API_KEY:'test-key',TELEGRAM_GUARDIAN_BOT_TOKEN:'test'})){
  const old=process.env[k];process.env[k]=v;t.after(()=>old===undefined?delete process.env[k]:process.env[k]=old);
 }
}
function seeded(extra={}) {return database({kona_ai_vocali_jobs:[{id:jobId,update_id:9,chat_id:'123',incidente_id:incident,file_id:'voice-file',stato:'in_coda',tentativi:0,
 next_attempt_at:'2000-01-01',created_at:'2026-10-06',in_flight:false,...extra}],kona_ai_telegram_sessioni:[{chat_id:'123',incidente_attivo_id:'changed-ticket',conversazione:[]} ]});}
function deps(overrides={}) {return {download:async()=>({bytes:new Uint8Array([1])}),transcribe:async()=> 'È una nuova funzionalità da aggiungere.',
 conversation:async()=>({text:'È una miglioria, approfondiamo il requisito.'}),send:async()=>({message_id:44}),...overrides};}

test('vocale accodato conserva la richiesta originale e deduplica il medesimo update',async t=>{
 env(t);const db=database({kona_ai_telegram_sessioni:[{chat_id:'123',incidente_attivo_id:incident}]});
 const update={update_id:99,message:{voice:{file_id:'file',file_size:100}}};
 assert(await voice.enqueue(db,update,'123'));assert.equal(await voice.enqueue(db,update,'123'),null);
 assert.equal(db.tables.kona_ai_vocali_jobs.length,1);assert.equal(db.tables.kona_ai_vocali_jobs[0].incidente_id,incident);
 await assert.rejects(voice.enqueue(db,{...update,update_id:-1},'123'));
});

test('worker richiede HMAC e timestamp fresco, senza chiamare la coda per richieste anonime',async t=>{
 env(t);const body=JSON.stringify({timestamp:Date.now()});
 assert.equal((await handler({httpMethod:'POST',body,headers:{}})).statusCode,403);
 assert.equal(voice.validRequest(body,voice.signature(body)),true);
 const old=JSON.stringify({timestamp:Date.now()-600000});assert.equal(voice.validRequest(old,voice.signature(old)),false);
 assert.equal((await handler({httpMethod:'GET'})).statusCode,405);
});

test('vocale viene trascritto in background con timeout separato e con contesto acquisito alla ricezione',async t=>{
 env(t);const db=seeded();let sent;
 await voice.processQueue(db,deps({transcribe:async(file,options)=>{assert.equal(options.timeoutMs,180000);return 'Nuova implementazione';},
 conversation:async(db,chat,session,text,metadata,reply,options)=>{
   assert.equal(session.incidente_attivo_id,incident);assert.equal(text,'Nuova implementazione');assert.equal(options.deferDelivery,true);
   assert.equal(metadata.voice_job_id,jobId);return {text:'Approfondiamo la miglioria.'};},send:async(chat,text)=>{sent=text;return {message_id:44};}}));
 assert.equal(sent,'Approfondiamo la miglioria.');assert.equal(db.tables.kona_ai_vocali_jobs[0].stato,'inviato');
 assert.equal(db.tables.kona_ai_vocali_jobs[0].telegram_message_id,44);
});

test('timeout conserva file e job e accoda un avviso con retry, senza fingere una trascrizione',async t=>{
 env(t);const db=seeded();
 await voice.processQueue(db,deps({transcribe:async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}}));
 const job=db.tables.kona_ai_vocali_jobs[0];assert.equal(job.stato,'in_coda');assert.equal(job.file_id,'voice-file');assert.equal(job.errore_codice,'transcription_timeout');
 assert.equal(job.transcript,undefined);assert.equal(db.tables.kona_ai_notifiche.length,1);
});

test('retry della risposta riusa la trascrizione salvata senza un secondo invio audio a OpenAI',async t=>{
 env(t);const db=seeded({transcript:'Già trascritto'});let attempt=0,download=0;
 const options=deps({download:async()=>{download++;throw new Error('must not download');},conversation:async()=>{if(++attempt===1)throw new Error('OpenAI temporaneo');return {text:'Risposta pronta'};}});
 await voice.processQueue(db,options);const job=db.tables.kona_ai_vocali_jobs[0];assert.equal(job.transcript,'Già trascritto');
 job.next_attempt_at='2000-01-01';await voice.processQueue(db,options);assert.equal(download,0);assert.equal(attempt,2);assert.equal(job.stato,'inviato');
});

test('due worker concorrenti prendono in carico il vocale una sola volta',async t=>{
 env(t);const db=seeded();let count=0;
 await Promise.all([voice.processQueue(db,deps({transcribe:async()=>{count++;await new Promise(r=>setTimeout(r,5));return 'Test';}})),voice.processQueue(db,deps())]);
 assert.equal(count,1);assert.equal(db.tables.kona_ai_vocali_jobs[0].stato,'inviato');
});

test('delivery ambiguo conserva la risposta e ferma il retry che duplichererebbe il messaggio',async t=>{
 env(t);const db=seeded();let sends=0;
 const options=deps({send:async()=>{sends++;throw new Error('connection lost');}});
 await voice.processQueue(db,options);await voice.processQueue(db,options);
 const job=db.tables.kona_ai_vocali_jobs[0];assert.equal(job.stato,'incerto');assert(job.risposta.text);assert.equal(sends,1);
});

test('429 esplicito riprova la sola consegna con risposta già salvata',async t=>{
 env(t);const db=seeded();let ai=0,sends=0;
 const options=deps({conversation:async()=>{ai++;return {text:'Pronta'};},send:async()=>{if(++sends===1)throw Object.assign(new Error('rate limit'),{telegramRejected:true,status:429});return {message_id:50};}});
 await voice.processQueue(db,options);db.tables.kona_ai_vocali_jobs[0].next_attempt_at='2000-01-01';await voice.processQueue(db,options);
 assert.equal(ai,1);assert.equal(sends,2);assert.equal(db.tables.kona_ai_vocali_jobs[0].stato,'inviato');
});

test('lease scaduto con invio in corso viene sospeso come incerto',async t=>{
 env(t);const db=seeded({stato:'in_corso',lease_until:'2000-01-01',in_flight:true});let sends=0;
 await voice.processQueue(db,deps({send:async()=>{sends++;}}));assert.equal(sends,0);assert.equal(db.tables.kona_ai_vocali_jobs[0].stato,'incerto');
});

test('quinto errore termina i retry conservando audio, trascrizione e avviso',async t=>{
 env(t);const db=seeded({tentativi:4,transcript:'Conservata'});
 await voice.processQueue(db,deps({conversation:async()=>{throw new Error('offline');}}));assert.equal(db.tables.kona_ai_vocali_jobs[0].stato,'fallito');assert.equal(db.tables.kona_ai_vocali_jobs[0].transcript,'Conservata');
});

test('API trascrizione usa timeout configurabile e il modello Guardian esistente',async t=>{
 env(t);const text=await transcribeVoice({bytes:new Uint8Array([1]),mimeType:'audio/ogg',filename:'vocale.ogg'}, {timeoutMs:180000,request:async(url,opts)=>{
 assert.equal(opts.body.get('model'),'gpt-transcribe');assert.equal(opts.body.get('languages[]'),'it');return {ok:true,json:async()=>({text:'Test'})};}});assert.equal(text,'Test');
});

test('chiarimento del proprietario riclassifica il caso senza perdere storico o avviare codice',async t=>{
 env(t);const db=database({kona_ai_incidenti:[{id:incident,numero:23,stato:'ricevuto',tipo_richiesta:'problema'}],kona_ai_telegram_sessioni:[{chat_id:'123',conversazione:[]}],kona_ai_approvazioni:[{incidente_id:incident,stato:'in_attesa'}]});
 t.mock.method(global,'fetch',async(url)=>{
  assert.equal(url,'https://api.openai.com/v1/responses');return {ok:true,json:async()=>({output_text:JSON.stringify({reply:'Capito: serve una nuova funzionalità. Quale comportamento vuoi aggiungere?',suggested_action:'nessuna',request_type:'miglioria',request_summary:'Aggiungere un nuovo comportamento al CRM.'})})};
 });
 const response=await webhook.handleOwnerConversation(db,'123',{incidente_attivo_id:incident},'Non è un bug ma una nuova implementazione.',{},null,{jobId,deferDelivery:true});
 assert.match(response.text,/nuova funzionalità/);assert.equal(db.tables.kona_ai_incidenti[0].tipo_richiesta,'miglioria');
 assert.equal(db.tables.kona_ai_approvazioni[0].stato,'scaduta');assert.equal(db.tables.kona_ai_messaggi.length,3);
 assert.equal(db.tables.kona_ai_messaggi[0].id,jobId);
 const again=await webhook.handleOwnerConversation(db,'123',db.tables.kona_ai_telegram_sessioni[0],'Non è un bug',{},null,{jobId,deferDelivery:true});assert.equal(again.text,response.text);
 assert.equal(db.tables.kona_ai_messaggi.length,3);
});


test('webhook risponde solo dopo salvataggio e un enqueue fallito rimane ritentabile da Telegram',async t=>{
 env(t);const db=database({kona_ai_telegram_sessioni:[{chat_id:'123',incidente_attivo_id:incident}]});
 const update={update_id:123,message:{from:{id:123},chat:{type:'private'},voice:{file_id:'file',file_size:100}}};
 let ack=0,nudged=0;
 const deps={send:async()=>{assert.equal(db.tables.kona_ai_vocali_jobs.length,1);ack++;},nudge:async()=>{nudged++;}};
 assert.equal((await webhook.handleVoiceUpdate(db,update,'123',deps)).statusCode,200);
 assert.equal((await webhook.handleVoiceUpdate(db,update,'123',deps)).statusCode,200);assert.equal(ack,1);assert.equal(nudged,1);
 assert.equal((await webhook.handleVoiceUpdate(db,{...update,update_id:124},'123',{enqueue:async()=>{throw new Error('db down');}})).statusCode,503);
 assert.equal((await webhook.handleVoiceUpdate(db,{...update,message:{...update.message,from:{id:999}}},'123',deps)).statusCode,200);assert.equal(nudged,1);
});

test('ripresa manuale richiede proprietario e stato sospeso, conserva trascrizione e risposta',async t=>{
 env(t);const db=seeded({stato:'incerto',in_flight:true,transcript:'Salvata',risposta:{text:'Pronta'}});
 await assert.rejects(voice.retry(db,'999',jobId));assert(await voice.retry(db,'123',jobId));
 assert.equal(db.tables.kona_ai_vocali_jobs[0].transcript,'Salvata');assert.equal(db.tables.kona_ai_vocali_jobs[0].in_flight,false);
 assert.equal(await voice.retry(db,'123',jobId),null);
});
