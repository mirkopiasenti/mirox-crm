'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../js/dashboard-report-core');
const reports=require('../netlify/functions/_lib/target-reports');
const telegram=require('../netlify/functions/_lib/target-telegram');
const dialogue=require('../netlify/functions/_lib/target-dialogue');
const queue=require('../netlify/functions/_lib/target-queue');
const webhook=require('../netlify/functions/target-telegram-webhook');
const worker=require('../netlify/functions/target-worker-background');
const cron=require('../netlify/functions/cron-target-reports');
const NOW=new Date('2026-10-05T17:45:00Z');
const fastPause=async()=>{};
const ENV={TARGET_ENABLED:'true',MIROX_DEPLOY_ENV:'production',BRANCH:'main',CONTEXT:'production',TELEGRAM_TARGET_BOT_TOKEN:'synthetic-token',TELEGRAM_TARGET_OWNER_CHAT_ID:'123',TELEGRAM_TARGET_WEBHOOK_SECRET:'a'.repeat(40),TARGET_WORKER_SECRET:'b'.repeat(40),OPENAI_TARGET_API_KEY:'synthetic-target-openai',OPENAI_API_KEY:'synthetic-guardian-openai'};
function env(fn) {return async()=>{const saved={...process.env};Object.assign(process.env,ENV);try{await fn();}finally{for(const k of Object.keys(process.env)) if(!(k in saved)) delete process.env[k];Object.assign(process.env,saved);}};}
function fakeDb(initial={}) {
  const tables=structuredClone(initial),log=[];let nextId=0;
  const db={tables,log,fail:null,from(table){
    tables[table]||=[];
    let action='read',fields='',values,filters=[],orders=[],range=null,limit=null,single=false;
    const q={select(f){fields=f;return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},gte(k,v){filters.push(r=>r[k]>=v);return q;},lte(k,v){filters.push(r=>r[k]<=v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},or(text){const [a,b]=text.split(',');const key=a.split('.')[0],date=b.split('.lt.')[1];filters.push(r=>r[key]==null||r[key]<date);return q;},order(k,opts={}){orders.push([k,opts.ascending!==false]);return q;},range(a,b){range=[a,b];return q;},limit(n){limit=n;return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},insert(v){action='insert';values=v;return q;},upsert(v){action='upsert';values=v;return q;},update(v){action='update';values=v;return q;},delete(){action='delete';return q;},then(resolve,reject){
      try {
        log.push({table,action,fields,values});
        if(db.fail?.({table,action,fields,values})) return Promise.resolve({data:null,error:{code:'synthetic_error'}}).then(resolve,reject);
        let rows=tables[table].filter(r=>filters.every(f=>f(r)));
        if(action==='insert') {
          if(tables[table].some(r=>r.dedupe_key===values.dedupe_key)) return Promise.resolve({data:null,error:{code:'23505'}}).then(resolve,reject);
          const r={id:String(++nextId),stato:'in_coda',messaggi:[],inviati:0,in_flight:false,tentativi:0,next_attempt_at:'2020-01-01T00:00:00Z',created_at:new Date().toISOString(),...values};tables[table].push(r);rows=[r];
        } else if(action==='upsert') {
          const existing=tables[table].find(r=>r.chat_id===values.chat_id);
          if(!existing) tables[table].push({conversazione:[],lease_until:null,updated_at:new Date().toISOString(),...values});rows=[];
        } else if(action==='update') rows.forEach(r=>Object.assign(r,values));
        else if(action==='delete') tables[table]=tables[table].filter(r=>!rows.includes(r));
        rows.sort((a,b)=>{for(const [k,asc] of orders) {if(a[k]<b[k]) return asc?-1:1;if(a[k]>b[k]) return asc?1:-1;}return 0;});
        if(range) rows=rows.slice(range[0],range[1]+1);if(limit!==null) rows=rows.slice(0,limit);
        const data=single?(rows[0]||null):rows;
        return Promise.resolve({data:structuredClone(data),error:null}).then(resolve,reject);
      } catch(e){return Promise.reject(e).then(resolve,reject);}
    }};return q;
  }};return db;
}
function contract(id,cat,extra={}) {return {id,operatore_id:'op',categoria_snapshot:cat,data_contratto:'2026-10-05T12:00:00Z',codice_rivenditore:core.LEGNAGO,stato_inserimento:'nuovo',cluster_cliente:'Consumer',punteggio_gara_totale:1,punteggio_extra_gara_totale:2,...extra};}
function fixture() {
  return {vendita_contratti:[contract('a','Mobile'),contract('b','Mobile',{codice_rivenditore:'9000822241'}),contract('c','Mobile',{stato_inserimento:'reinserimento'}),contract('d','Fisso'),contract('e','Fisso',{data_contratto:'2026-09-05T12:00:00Z'}),contract('f','Energia'),contract('g','Allarmi'),contract('h','Assicurazioni',{punteggio_gara_totale:3})],
    profili:[{id:'op',nome:'MIRKO',attivo:true,in_gara:true},{id:'alias',nome:'Vecchio',attivo:true,alias_di:'op'}],
    dashboard_righe_giornaliera:[{id:1,nome:'Mobili',ordine:1,attiva:true,regola:{categoria:'Mobile'}},{id:2,nome:'Nessuna',ordine:2,attiva:true,regola:{categoria:'Nessuna'}}],
    gara_metriche:['Mobile','Fisso','Energia','Allarmi','Assicurazioni'].map((cat,i)=>({id:i+1,nome:cat,ordine:i,attiva:true,tabella:'avanzamento_standard',regola:{categoria:cat}})).concat([{id:6,nome:'EXTRA GARA P.IVA',ordine:1,attiva:true,tabella:'avanzamento_extra_piva',regola:{cluster:'Business'}}]),
    gara_obiettivi_mensili:[{id:1,anno:2026,mese:10,metrica_id:1,operatore_id:null,obiettivo:26}],
    post_vendita_controllo_fissi:[{id:'pv1',contratto_id:'d',stato:'In Attivazione',tecnologia:'FTTH'},{id:'pv2',contratto_id:'e',stato:'Attivo',tecnologia:'FTTC',data_attivazione:'2026-10-05'}],
    post_vendita_controllo_lg:[{id:'lg',contratto_id:'f',stato:'Rifiutato'}],post_vendita_controllo_allarmi:[{id:'all',contratto_id:'g',stato:'OK'}],
    chiamate:[{id:'c1',operatore_id:'op',esito:'non_risposto',data_ora:'2026-10-05T08:00:00.000Z'},{id:'c2',operatore_id:'alias',esito:'ricontattare',data_ora:'2026-10-05T09:00:00.000Z'}],
    call_center_lead_outbound_chiamate:[{id:'o1',operatore_id:'op',esito:'non_interessato',data_ora:'2026-10-05T10:00:00.000Z'}],
    appuntamenti:[{id:'ap1',fissato_da_operatore_id:'op',created_at:'2026-10-05T09:00:00.000Z',data_ora:'2026-10-15T09:00:00Z',originato_da_id:null,chiamata_outbound_id:null},{id:'ap2',fissato_da_operatore_id:'op',created_at:'2026-10-05T10:00:00.000Z',originato_da_id:'ap-old',chiamata_outbound_id:'o1'}]};
}
test('calendario italiano: 19:45, sabato, domenica, Pasquetta e cambi ora',()=> {
  assert.equal(reports.due(new Date('2026-10-05T17:44:59Z')),false);
  assert.equal(reports.due(NOW),true);
  assert.equal(reports.due(new Date('2026-12-07T18:45:00Z')),true);
  assert.equal(reports.due(new Date('2026-12-08T18:45:00Z')),false);
  assert.equal(reports.due(new Date('2026-10-10T17:45:00Z')),true);
  assert.equal(reports.due(new Date('2026-10-11T17:45:00Z')),false);
  assert.equal(core.isWorkday('2026-04-06'),false);
  assert.equal(core.isWorkday('2027-03-29'),false);
  assert.equal((Date.parse(reports.romeMidnight('2026-03-30'))-Date.parse(reports.romeMidnight('2026-03-29')))/3600000,23);
  assert.equal((Date.parse(reports.romeMidnight('2026-10-26'))-Date.parse(reports.romeMidnight('2026-10-25')))/3600000,25);
});
test('andamento: soglia esatta, arrotondamento, raggiunto e obiettivo assente',()=> {
  assert.deepEqual(core.workingDays(2026,10,'2026-10-05'),{total:27,elapsed:4});
  assert.equal(core.progress(4,27,2026,10,'2026-10-05').andamento,'IN LINEA');
  assert.equal(core.progress(2.8,27,2026,10,'2026-10-05').eccedenza,-2);
  assert.equal(core.progress(5.2,27,2026,10,'2026-10-05').eccedenza,2);
  assert.equal(core.progress(27,27,2026,10,'2026-10-05').eccedenza,null);
  assert.equal(core.progress(2,0,2026,10,'2026-10-05').andamento,'OBIETTIVO NON CONFIGURATO');
});
test('report completi: Legnago, zero omessi, FTTC fuori mese contratto, stati, punteggi, alias e fissati',async()=> {
  const db=fakeDb(fixture()),p=await reports.buildReports(db,'2026-10-05',NOW);
  assert.equal(p.vendite.totale,1);assert.equal(p.vendite.categorie.length,1);
  assert.equal(p.mensile.find(r=>r.nome==='Fisso').punteggio,2);
  assert.equal(p.mensile.find(r=>r.nome==='Energia').punteggio,0);
  assert.equal(p.mensile.find(r=>r.nome==='Assicurazioni').punteggio,3);
  assert.deepEqual(p.chiamate.totale,{fatte:3,risposte:2,non_risposte:1,fissati:1,spostamenti:1});
  assert.equal(p.chiamate.operatori.length,1);
  assert.equal(p.chiamate.canali[1].totale.fissati,0);
  assert.equal(reports.formatReports(p).length,3);
  assert.doesNotMatch(JSON.stringify(p),/anagrafica_id|imei|cf_piva|voice_id/);
  assert.ok(db.log.every(q=>q.action==='read'));
});
test('paginazione oltre 1000 e errori post-vendita non diventano report parziali',async()=> {
  const db=fakeDb({x:Array.from({length:1501},(_,i)=>({id:String(i).padStart(5,'0')}))});
  assert.equal((await reports.paged(db,'x','id')).length,1501);
  const broken=fakeDb(fixture());broken.fail=q=>q.table==='post_vendita_controllo_lg';
  await assert.rejects(reports.buildReports(broken,'2026-10-05',NOW),/Lettura/);
});
test('FISSI Standard: Cerea e pendenti anche prima della verifica, KO/reinserimenti esclusi, pagina e Target coerenti',async()=> {
  const f=fixture();
  f.gara_obiettivi_mensili.push({id:2,anno:2026,mese:10,metrica_id:2,operatore_id:null,obiettivo:13});
  f.vendita_contratti.find(c=>c.id==='d').cluster_cliente='Business';
  f.profili.push({id:'cerea',nome:'CEREA',attivo:true,in_gara:false},
    {id:'cerea-old',nome:'Alias Cerea',attivo:true,alias_di:'cerea'},
    {id:'fttc-op',nome:'SOLO FTTC',attivo:true,in_gara:false});
  const add=(id,store,status,technology,patch={},activation)=> {
    f.vendita_contratti.push(contract(id,'Fisso',{codice_rivenditore:store,...patch}));
    if(status!==null) f.post_vendita_controllo_fissi.push({id:'pv-'+id,contratto_id:id,stato:status,tecnologia:technology,data_attivazione:activation});
  };
  add('lg-pending',core.LEGNAGO,'Da completare',null,{cluster_cliente:'Business',punteggio_gara_totale:2});
  add('ce-pending',core.CEREA,'Da completare','FTTH_OF',{operatore_id:'cerea-old',cluster_cliente:'Business',punteggio_gara_totale:2.5});
  add('ce-active',core.CEREA,'Attivo','FWA OUT',{operatore_id:'cerea',punteggio_gara_totale:3});
  add('ce-fttc',core.CEREA,'Attivo','FTTC',{operatore_id:'fttc-op',data_contratto:'2026-09-05T12:00:00Z',punteggio_gara_totale:1.5},'2026-10-03');
  for(const store of [core.LEGNAGO,core.CEREA]) {
    add(store+'-ko',store,'KO','FTTH_OF');
    add(store+'-reinsert',store,'Attivo','FTTH_OF',{stato_inserimento:'reinserimento'});
    add(store+'-fttc-reinsert',store,'Attivo','FTTC',{stato_inserimento:'reinserimento',data_contratto:'2026-09-05T12:00:00Z'},'2026-10-03');
    add(store+'-fttc-pending',store,'Da completare','FTTC');
    add(store+'-fttc-next',store,'Attivo','FTTC',{},'2026-11-01');
    add(store+'-missing',store,null,null);
    add(store+'-missing-reinsert',store,null,null,{stato_inserimento:'reinserimento'});
  }
  f.vendita_contratti.push(contract('ce-mobile','Mobile',{operatore_id:'cerea',codice_rivenditore:core.CEREA,cluster_cliente:'Business'}));
  const p=await reports.buildReports(fakeDb(f),'2026-10-05',NOW);
  const fixed=p.mensile.find(r=>r.nome==='Fisso');
  assert.equal(fixed.pezzi,8);assert.equal(fixed.punteggio,13);
  assert.equal(fixed.andamento,'RAGGIUNTO');
  assert.equal(p.mensile.find(r=>r.nome==='Mobile').pezzi,1);
  assert.equal(p.mensile.find(r=>r.nome==='EXTRA GARA P.IVA').punteggio,2);
  assert.equal(p.vendite.totale,1);

  // Esegue il caricamento reale del browser: deve includere anche operatori Cerea
  // non in gara e l'operatore che ha solo una FTTC firmata il mese precedente.
  const html=fs.readFileSync(require('node:path').join(__dirname,'../moduli/dashboard_pezzi.html'),'utf8');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const sb'));
  const ctx=vm.createContext({db:fakeDb(f),MiroxDashboardReport:core});
  vm.runInContext(script.split('(function init()')[0],ctx);
  vm.runInContext('DPState.anno=2026; DPState.mese=10;',ctx);
  await vm.runInContext('caricaDatiMensili()',ctx);
  const state=vm.runInContext('DPState',ctx);
  assert.deepEqual(Array.from(state.operatoriAttiviMese,p=>p.id).sort(),['cerea','fttc-op','op']);
  const browser=core.monthlyRows(state,'2026-10-05');
  const browserFixed=browser.find(r=>r.nome==='Fisso');
  assert.equal(browserFixed.attuale,8);assert.equal(browserFixed.punteggio,13);
  const perOperator=Object.fromEntries(state.operatoriAttiviMese.map((op,i)=>[op.id,browserFixed.conteggi[i]]));
  assert.deepEqual(perOperator,{op:5,cerea:2,'fttc-op':1});
  const byName=(a,b)=>a.nome.localeCompare(b.nome);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.map(({nome,tabella,attuale,punteggio,obiettivo,andamento,eccedenza})=>
    ({nome,tabella,pezzi:attuale,punteggio,obiettivo,andamento,eccedenza})).sort(byName))),[...p.mensile].sort(byName));
});
test('errore di lettura controlli nel browser blocca il conteggio invece di includere i KO come pendenti',async()=> {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../moduli/dashboard_pezzi.html'),'utf8');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const sb'));
  for(const failedRead of ['stati','attivazioni','contratti-attivati']) {
    const db=fakeDb(fixture());
    db.fail=q=>q.action==='read' && (failedRead==='stati' ? q.table==='post_vendita_controllo_fissi' && q.fields.includes('tecnologia')
      : failedRead==='attivazioni' ? q.table==='post_vendita_controllo_fissi' && q.fields==='contratto_id'
      : q.table==='vendita_contratti' && !q.fields.includes('nome_offerta_snapshot'));
    const ctx=vm.createContext({db,MiroxDashboardReport:core});
    vm.runInContext(script.split('(function init()')[0],ctx);
    vm.runInContext('DPState.anno=2026; DPState.mese=10;',ctx);
    await assert.rejects(vm.runInContext('caricaDatiMensili()',ctx),e=>e.code==='synthetic_error');
    assert.equal(vm.runInContext('DPState.loadedMonthKey',ctx),null);
  }
});
test('date manuali validate e richiesta naturale report di ieri',()=> {
  assert.throws(()=>reports.validateDate('2026-02-30',NOW));
  assert.throws(()=>reports.validateDate('2026-10-06',NOW));
  assert.deepEqual(queue.command('mandami il report di ieri',NOW),{action:'report',date:'2026-10-04'});
  assert.deepEqual(queue.command('/report 2026-10-01',NOW),{action:'report',date:'2026-10-01'});
  assert.equal(queue.command('Come possiamo migliorare questo mese?',NOW),null);
});
test('accesso webhook: secret, proprietario, gruppo e deduplicazione',env(async()=> {
  const db=fakeDb();let nudges=0;
  const event={httpMethod:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':ENV.TELEGRAM_TARGET_WEBHOOK_SECRET},body:JSON.stringify({update_id:1,message:{chat:{type:'private',id:123},from:{id:123},text:'/report'}})};
  const deps={db,nudge:async()=>{nudges++;}};
  assert.equal((await webhook.handler({...event,headers:{}},deps)).statusCode,403);
  const alien=JSON.parse(event.body);alien.message.from.id=456;
  await webhook.handler({...event,body:JSON.stringify(alien)},deps);assert.equal(db.tables.mirox_target_jobs,undefined);
  const group=JSON.parse(event.body);group.message.chat.type='group';
  await webhook.handler({...event,body:JSON.stringify(group)},deps);assert.equal(nudges,0);
  assert.equal((await webhook.handler(event,deps)).statusCode,200);
  await webhook.handler(event,deps);assert.equal(nudges,1);assert.equal(db.tables.mirox_target_jobs.length,1);
}));
test('guard production e HMAC: Target resta spento senza configurazione e su preview',env(async()=> {
  assert.equal(telegram.configured(),true);
  assert.equal(telegram.configured({...ENV,BRANCH:'preview'}),false);
  assert.equal(telegram.configured({...ENV,CONTEXT:'deploy-preview'}),false);
  assert.equal(telegram.configured({...ENV,TARGET_ENABLED:'false'}),false);
  const body=JSON.stringify({ts:Date.now()});
  assert.equal(telegram.verify(body,telegram.sign(body)),true);
  assert.equal(telegram.verify(body+' ',telegram.sign(body)),false);
  assert.equal(telegram.verify(body,telegram.sign(body),Date.now()+600000),false);
  assert.equal((await worker.handler({httpMethod:'POST',body,headers:{}})).statusCode,403);
  process.env.TARGET_ENABLED='false';
  assert.equal(JSON.parse((await cron.handler({httpMethod:'POST'})).body).skipped,true);
}));
test('cron deduplica la sera e esclude domeniche/festivi',env(async()=> {
  const db=fakeDb();let nudges=0;const deps={db,now:NOW,nudge:async()=>{nudges++;}};
  await cron.handler({},deps);await cron.handler({},deps);
  assert.equal(db.tables.mirox_target_jobs.length,1);assert.equal(nudges,2);
  const empty=fakeDb();await cron.handler({},{...deps,db:empty,now:new Date('2026-12-08T18:45:00Z')});
  assert.equal(empty.tables.mirox_target_jobs.length,0);
}));
test('coda: tre messaggi ordinati, checkpoint, memoria e niente duplicati',env(async()=> {
  const db=fakeDb();await queue.enqueue(db,{key:'day',chat:'123',tipo:'report',payload:{data:'2026-10-05'}});
  const sent=[],p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);
  await queue.processQueue(db,{pause:fastPause,read:async()=>p,send:async text=>sent.push(text)});
  assert.equal(sent.length,3);assert.match(sent[0],/Vendite/);assert.match(sent[1].text,/Call Center/);assert.match(sent[2].text,/Avanzamento/);assert.equal(sent[1].type,'photo');assert.equal(sent[2].type,'photo');
  assert.equal(db.tables.mirox_target_jobs[0].inviati,3);assert.equal(db.tables.mirox_target_jobs[0].stato,'inviato');
  await queue.processQueue(db,{pause:fastPause,send:async()=>assert.fail('doppio invio')});
  assert.equal(db.tables.mirox_target_sessioni[0].conversazione.length,3);
}));
test('coda: 429 riprende dal messaggio mancante, errore ambiguo sospende',env(async()=> {
  const db=fakeDb();await queue.enqueue(db,{key:'retry',chat:'123',tipo:'report',payload:{data:'2026-10-05'}});
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);let calls=0;
  await queue.processQueue(db,{pause:fastPause,read:async()=>p,send:async()=> {calls++;if(calls===2){const e=new Error('telegram_429');e.retryable=true;throw e;}}});
  assert.equal(db.tables.mirox_target_jobs[0].inviati,1);
  db.tables.mirox_target_jobs[0].next_attempt_at='2020-01-01T00:00:00Z';
  const remaining=[];await queue.processQueue(db,{pause:fastPause,send:async text=>remaining.push(text)});
  assert.equal(remaining.length,2);assert.match(remaining[0].text,/Call Center/);
  await queue.enqueue(db,{key:'uncertain',chat:'123',tipo:'dialogo',payload:{testo:'/start'}});
  await queue.processQueue(db,{pause:fastPause,send:async()=>{const e=new Error('telegram_ambiguous');e.ambiguous=true;throw e;}});
  assert.equal(db.tables.mirox_target_jobs[1].stato,'incerto');
  await queue.processQueue(db,{pause:fastPause,send:async()=>assert.fail('retry ambiguo')});
}));
test('claim della sessione impedisce due worker e checkpoint perso non viene reinviato',env(async()=> {
  const db=fakeDb();await queue.enqueue(db,{key:'one',chat:'123',tipo:'dialogo',payload:{testo:'/start'}});
  let started,release;const began=new Promise(r=>started=r),hold=new Promise(r=>release=r);
  const first=queue.processQueue(db,{pause:fastPause,send:async()=>{started();await hold;}});await began;
  assert.deepEqual(await queue.processQueue(db),{busy:true});release();await first;
  await queue.enqueue(db,{key:'lost',chat:'123',tipo:'dialogo',payload:{testo:'/start'}});
  Object.assign(db.tables.mirox_target_jobs[1],{stato:'in_corso',in_flight:true,messaggi:['test']});
  await queue.processQueue(db,{pause:fastPause,send:async()=>assert.fail('doppio invio dopo crash')});
  assert.equal(db.tables.mirox_target_jobs[1].stato,'incerto');
}));
test('Telegram: testo lungo conservato integralmente in un solo allegato; errore rete ambiguo',env(async()=> {
  let captured;const text='a'.repeat(5000);
  await telegram.send(text,async(url,opts)=>{captured={url,opts};return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};});
  assert.match(captured.url,/sendDocument$/);assert.equal(await captured.opts.body.get('document').text(),text);
  await assert.rejects(telegram.send('ciao',async()=>{throw new Error('network');}),e=>e.ambiguous===true);
}));
test('dialogo Responses: memoria, dati freschi, tool read-only e confronto su due date',env(async()=> {
  let calls=0;const reads=[],requests=[];
  const fetcher=async(url,opts)=> {
    assert.equal(opts.headers.Authorization,'Bearer synthetic-target-openai');
    requests.push(JSON.parse(opts.body));calls++;
    const output=calls<3?[{type:'function_call',name:'leggi_report',call_id:'c'+calls,arguments:JSON.stringify({data:calls===1?'2026-10-05':'2026-10-04'})}]:[{type:'message',content:[{type:'output_text',text:'Oggi il totale è maggiore di ieri.'}]}];
    return {ok:true,json:async()=>({status:'completed',output})};
  };
  const answer=await dialogue.reply(null,'Confronta oggi e ieri',[{role:'user',content:'Parliamo di chiamate'}],{now:NOW,fetcher,read:async date=>{reads.push(date);return {totale:3};}});
  assert.match(answer,/maggiore/);assert.deepEqual(reads,['2026-10-05','2026-10-04']);
  assert.equal(requests[0].store,false);assert.deepEqual(requests[0].tools.map(t=>t.name),['leggi_report','invia_report']);
  assert.equal(requests[2].input.filter(i=>i.type==='function_call_output').length,2);
  assert.equal(requests[0].input[0].content,'Parliamo di chiamate');
}));
test('OpenAI dedicata: vocali Target e nessun fallback sulla chiave Guardian',env(async()=> {
  const file={bytes:new Uint8Array([1,2,3]),mimeType:'audio/ogg',filename:'vocale.ogg'};
  let called=0;
  const fetcher=async(url,opts)=> {
    called++;assert.match(url,/audio\/transcriptions$/);
    assert.equal(opts.headers.Authorization,'Bearer synthetic-target-openai');
    assert.equal(opts.body.get('model'),'gpt-transcribe');
    assert.equal(opts.body.get('languages[]'),'it');
    assert.match(opts.body.get('prompt'),/MIROX AI - Target/);
    assert.doesNotMatch(opts.body.get('prompt'),/Guardian/);
    return {ok:true,json:async()=>({text:'Come vanno le vendite?'})};
  };
  assert.equal(await dialogue.transcribe(file,fetcher),'Come vanno le vendite?');
  assert.equal(called,1);
  delete process.env.OPENAI_TARGET_API_KEY;
  await assert.rejects(dialogue.transcribe(file,()=>assert.fail('chiave Guardian usata')),/openai_target_not_configured/);
  await assert.rejects(dialogue.reply(null,'ciao',[],{fetcher:()=>assert.fail('chiave Guardian usata')}),/openai_target_not_configured/);
}));
test('schema Target server-only: niente alterazione di tabelle CC o RPC esistenti',()=> {
  const sql=fs.readFileSync(require('node:path').join(__dirname,'../database/20261005185700_mirox_ai_target.sql'),'utf8');
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/g);assert.match(sql,/FROM PUBLIC,anon,authenticated/);
  assert.match(sql,/TO service_role/);assert.doesNotMatch(sql,/ALTER TABLE public\.(profili|chiamate|appuntamenti|anagrafica)\b|SECURITY DEFINER|CREATE.*FUNCTION/i);
});
test('renderer browser usa lo stesso motore e conserva le sezioni Standard/P.IVA',()=> {
  const html=fs.readFileSync(require('node:path').join(__dirname,'../moduli/dashboard_pezzi.html'),'utf8');
  const script=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const sb'));
  const nodes=new Map();
  const document={getElementById(id){if(!nodes.has(id)) nodes.set(id,{innerHTML:'',textContent:''});return nodes.get(id);}};
  const ctx=vm.createContext({db:{},document,MiroxDashboardReport:core,MiroxSafe:{escapeHtml:v=>String(v??'')}});
  vm.runInContext(script.split('(function init()')[0],ctx);
  const f=fixture(),state=reports.monthlyState(f.vendita_contratti,f.gara_metriche,f.gara_obiettivi_mensili,f.profili,{fisso:f.post_vendita_controllo_fissi,energia:f.post_vendita_controllo_lg,allarmi:f.post_vendita_controllo_allarmi},[f.vendita_contratti.find(c=>c.id==='e')],2026,10);
  Object.assign(vm.runInContext('DPState',ctx),state);
  vm.runInContext("isoOggi = () => '2026-10-05'; renderAvanzamento();",ctx);
  const output=nodes.get('tabContentAvanzamento').innerHTML;
  assert.match(output,/>Avanzamento<\/h3>/);assert.match(output,/>Avanzamento P\.IVA<\/h3>/);
  assert.match(output,/>IN RITARDO<\/td>/);assert.match(output,/>-3<\/td>/);
  assert.match(output,/>EXTRA GARA P\.IVA<\/td>/);
});
test('per una data storica del mese il mensile segue la pagina attuale, non inventa uno snapshot',async()=> {
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-01',NOW);
  assert.equal(p.vendite.totale,0);
  assert.equal(p.mensile.find(r=>r.nome==='Mobile').eccedenza,-3);
  assert.match(p.criteri,/non fotografia storica/);
});
test('checkpoint fallito dopo invio riuscito: stato incerto e nessun reinvio',env(async()=> {
  const db=fakeDb();await queue.enqueue(db,{key:'checkpoint',chat:'123',tipo:'dialogo',payload:{testo:'/start'}});
  db.fail=q=>q.action==='update'&&q.table==='mirox_target_jobs'&&q.values?.inviati===1;
  let count=0;await queue.processQueue(db,{pause:fastPause,send:async()=>{count++;}});
  assert.equal(db.tables.mirox_target_jobs[0].stato,'incerto');assert.equal(count,1);
  db.fail=null;await queue.processQueue(db,{send:async()=>assert.fail('reinvio di messaggio gia consegnato')});
}));
test('retry in attesa conserva ordine del dialogo, senza far passare i messaggi successivi',env(async()=> {
  const db=fakeDb();await queue.enqueue(db,{key:'first',chat:'123',tipo:'dialogo',payload:{testo:'/start'}});
  await queue.enqueue(db,{key:'second',chat:'123',tipo:'dialogo',payload:{testo:'Perche oggi siamo indietro?'}});
  db.tables.mirox_target_jobs[0].next_attempt_at='2099-01-01T00:00:00Z';
  const result=await queue.processQueue(db,{send:async()=>assert.fail('ordine saltato'),reply:async()=>assert.fail('conversazione fuori ordine')});
  assert.equal(result.completed,0);
}));

test('impaginazione: vendite spaziate, categorie senza pezzi escluse e tre formati compatibili',async()=> {
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);
  p.vendite.categorie.push({nome:'Seconda categoria',totale:2,operatori:{Anna:1,Luca:1}},{nome:'Categoria a zero',totale:0,operatori:{Anna:0}});p.vendite.totale=3;
  const messages=reports.formatReportMessages(p);
  assert.match(messages[0],/TOTALE GIORNATA: 3 pezzi/);
  assert.match(messages[0],/MIRKO: 1\n\nSeconda categoria\nTotale: 2 pezzi\n  Anna: 1\n  Luca: 1/);
  assert.doesNotMatch(messages[0],/Categoria a zero/);
  assert.deepEqual(messages.map(m=>typeof m==='string'?'text':m.type),['text','image','image']);
  assert.equal(telegram.prepareMessage('vecchio job testuale'),'vecchio job testuale');
});
test('immagini: PNG reali, nomi escapati, spostamenti e valori mensili senza inventare obiettivi',async()=> {
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);
  p.chiamate.operatori[0].nome='<image href="https://example.test"/> & operatore con nome molto lungo';
  p.mensile=[{nome:'Ritardo',punteggio:2.5,obiettivo:10,andamento:'IN RITARDO',eccedenza:-2},{nome:'Positivo',punteggio:6,obiettivo:10,andamento:'IN LINEA',eccedenza:3},{nome:'Raggiunto',punteggio:10,obiettivo:10,andamento:'RAGGIUNTO',eccedenza:null},{nome:'Assente',punteggio:0,obiettivo:0,andamento:'OBIETTIVO NON CONFIGURATO',eccedenza:null}];
  const messages=reports.formatReportMessages(p);
  assert.match(messages[1].svg,/&lt;image/);assert.match(messages[1].svg,/href=&quot;/);assert.doesNotMatch(messages[1].svg,/<image\b/);
  assert.match(messages[1].svg,/Spostamenti complessivi: 1/);
  assert.match(messages[2].svg,/>-2<\/text>/);assert.match(messages[2].svg,/>\+3<\/text>/);
  assert.match(messages[2].svg,/1 categoria senza obiettivo/);assert.match(messages[2].svg,/RAGGIUNTO/);
  assert.match(messages[2].svg,/#ae3439/);assert.match(messages[2].svg,/#137547/);
  for(const message of messages.slice(1)) {
    const photo=telegram.prepareMessage(message);
    assert.equal(photo.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(photo.bytes.readUInt32BE(16),message.width);assert.equal(photo.bytes.readUInt32BE(20),message.height);
  }
  assert.throws(()=>telegram.prepareMessage({...messages[1],svg:'<svg><image href="https://example.test"/></svg>'}),/target_image_invalid/);
  assert.throws(()=>telegram.prepareMessage({...messages[1],height:50001}),/target_image_invalid/);
});
test('Telegram: foto PNG e report fuori limiti in un singolo documento PNG',env(async()=> {
  const image={type:'photo',bytes:Buffer.from('synthetic PNG'),width:960,height:2600,filename:'report.png',caption:'Andamento mensile',text:'Alternativa testuale'};
  const capture=async(url,opts)=>{assert.equal(opts.body.get('caption'),image.caption);assert.equal(opts.body.get('chat_id'),'123');const name=url.endsWith('sendPhoto')?'photo':'document';assert.equal(opts.body.get(name).type,'image/png');assert.equal(opts.body.get(name).name,'report.png');assert.equal(await opts.body.get(name).text(),'synthetic PNG');return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};};
  const methods=[];const fetcher=async(url,opts)=>{methods.push(url.split('/').pop());return capture(url,opts);};
  await telegram.send(image,fetcher);await telegram.send({...image,height:10000},fetcher);
  assert.deepEqual(methods,['sendPhoto','sendDocument']);
}));
test('rasterizzazione fallita prima del checkpoint: retry sicuro senza duplicare le vendite',env(async()=> {
  const db=fakeDb();await queue.enqueue(db,{key:'render-fails',chat:'123',tipo:'report',payload:{data:'2026-10-05'}});
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW),sent=[];
  await queue.processQueue(db,{read:async()=>p,pause:fastPause,prepareMessage:m=>{if(typeof m!=='string')throw new Error('target_image_fonts_missing');return m;},send:async m=>sent.push(m)});
  const job=db.tables.mirox_target_jobs[0];assert.equal(job.inviati,1);assert.equal(job.in_flight,false);assert.equal(job.stato,'in_coda');assert.equal(sent.length,1);
  job.next_attempt_at='2020-01-01T00:00:00Z';
  await queue.processQueue(db,{pause:fastPause,read:async()=>assert.fail('snapshot riletto'),send:async m=>sent.push(m)});
  assert.equal(sent.length,3);assert.equal(job.stato,'inviato');
  const history=db.tables.mirox_target_sessioni[0].conversazione;
  assert.ok(history.every(m=>typeof m.content==='string'));assert.doesNotMatch(JSON.stringify(history),/<svg|89504e47|font-family/);
}));
test('comandi singoli mantengono il formato testo/foto nelle richieste manuali',env(async()=> {
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW),db=fakeDb();
  for(const [action,type] of [['vendite','string'],['chiamate','object'],['mese','object']]) {
    const prepared=await queue.prepare(db,{tipo:'dialogo',payload:{testo:`/${action}`}},{conversazione:[],updated_at:NOW.toISOString()},{now:NOW,read:async()=>p});
    assert.equal(prepared.messages.length,1);assert.equal(typeof prepared.messages[0],type);
  }
}));

test('richiesta segnalata e varianti naturali: tre report originali senza sintesi AI',env(async()=> {
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);
  for(const text of ['Rimandami il report completo di oggi (tutti e 3)','Inviami tutti i report aggiornati di oggi!','Reinviami il report completo di ieri (tutti e tre).','Report di oggi']) {
    const expected=/ieri/.test(text)?'2026-10-04':'2026-10-05';
    assert.deepEqual(queue.command(text,NOW),{action:'report',date:expected});
    const prepared=await queue.prepare(fakeDb(),{tipo:'dialogo',payload:{testo:text}},{conversazione:[],updated_at:NOW.toISOString()},{now:NOW,read:async date=>{assert.equal(date,expected);return p;},reply:async()=>assert.fail('richiesta trasformata in sintesi AI')});
    assert.deepEqual(prepared.messages.map(m=>typeof m==='string'?'text':m.type),['text','image','image']);
  }
  assert.equal(queue.command('Non rimandami il report, spiegami il ritardo',NOW),null);
  assert.equal(queue.command('Spiegami il report completo di oggi',NOW),null);
  assert.throws(()=>queue.command('Rimandami il report completo del 2026-02-30 (tutti e 3)',NOW));
}));
test('dialogo: invia_report restituisce intento validato e la coda genera i formati originali',env(async()=> {
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);
  for(const [tipo,expected] of [['report',['text','image','image']],['vendite',['text']],['chiamate',['image']],['mese',['image']]]) {
    let calls=0,reads=0;
    const reply=(db,text,history)=>dialogue.reply(db,text,history,{now:NOW,read:async()=>assert.fail('dati mandati al modello per generare report'),fetcher:async(url,opts)=> {
      calls++;const body=JSON.parse(opts.body);assert.equal(body.tools[1].strict,true);assert.equal(body.parallel_tool_calls,false);
      return {ok:true,json:async()=>({status:'completed',output:[{type:'function_call',name:'invia_report',call_id:'send1',arguments:JSON.stringify({data:'2026-10-05',tipo})}]})};
    }});
    const prepared=await queue.prepare(fakeDb(),{tipo:'dialogo',payload:{testo:'Per favore puoi farmi arrivare il riepilogo che ti ho chiesto?'}},{conversazione:[],updated_at:NOW.toISOString()},{now:NOW,read:async()=>{reads++;return p;},reply});
    assert.deepEqual(prepared.messages.map(m=>typeof m==='string'?'text':m.type),expected);assert.equal(calls,1);assert.equal(reads,1);
  }
}));
test('dialogo: invio con data/tipo/tool non validi non crea un report',env(async()=> {
  for(const [name,args] of [['invia_report',{data:'2026-10-06',tipo:'report'}],['invia_report',{data:'2026-10-05',tipo:'clienti'}],['invia_report',{data:'2026-10-05',tipo:'report',chat_id:'456'}],['invia_a_tutti',{data:'2026-10-05',tipo:'report'}]]) {
    let calls=0;
    const result=await dialogue.reply(null,'Vorrei i report',[],{now:NOW,read:async()=>assert.fail('lettura per tool invalido'),fetcher:async(url,opts)=> {
      const body=JSON.parse(opts.body);calls++;
      if(calls===2) {assert.match(body.input.at(-1).output,/Dati non disponibili/);return {ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Serve una data e un tipo di report validi.'}]}]})};}
      return {ok:true,json:async()=>({status:'completed',output:[{type:'function_call',name,call_id:'bad',arguments:JSON.stringify(args)}]})};
    }});
    assert.equal(typeof result,'string');assert.equal(calls,2);
  }
  await assert.rejects(queue.prepare(fakeDb(),{tipo:'dialogo',payload:{testo:'Vorrei i riepiloghi'}},{conversazione:[],updated_at:NOW.toISOString()},{now:NOW,reply:async()=>({report:{data:'2026-10-05',tipo:'altro'}}),read:async()=>assert.fail('tipo invalido')}),/target_report_intent_invalid/);
}));
test('richiesta naturale: coda invia tre messaggi e al retry conserva snapshot e memoria testuale',env(async()=> {
  const db=fakeDb(),text='Rimandami il report completo di oggi (tutti e 3)';
  await queue.enqueue(db,{key:'natural',chat:'123',tipo:'dialogo',payload:{testo:text}});
  const p=await reports.buildReports(fakeDb(fixture()),'2026-10-05',NOW);let calls=0;
  await queue.processQueue(db,{now:NOW,pause:fastPause,read:async()=>p,reply:async()=>assert.fail('AI sul percorso diretto'),send:async()=>{calls++;if(calls===3){const e=new Error('telegram_429');e.retryable=true;throw e;}}});
  const job=db.tables.mirox_target_jobs[0];assert.equal(job.inviati,2);assert.equal(job.stato,'in_coda');job.next_attempt_at='2020-01-01T00:00:00Z';
  await queue.processQueue(db,{now:NOW,pause:fastPause,read:async()=>assert.fail('rilettura snapshot'),reply:async()=>assert.fail('seconda interpretazione'),send:async m=>{calls++;assert.equal(m.type,'photo');assert.match(m.text,/Avanzamento/);}});
  assert.equal(calls,4);assert.equal(job.stato,'inviato');
  const history=db.tables.mirox_target_sessioni[0].conversazione;assert.equal(history[0].content,text);assert.equal(history.length,4);assert.ok(history.every(m=>typeof m.content==='string'));
}));
