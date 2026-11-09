'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {documentFixture}=require('./permissions-dom-helper');
const {buildSnapshot}=require('../netlify/functions/_lib/monitor-snapshot');
const {fakeDb,fixture}=require('./monitor-helpers.cjs');
const core=require('../js/monitor-core');
const root=path.resolve(__dirname,'..');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function page({local=true,release=null}={}) {
  const ids=[...fs.readFileSync(path.join(root,'monitor.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const document=documentFixture(ids);for(const id of ids)document.getElementById(id).style={};document.getElementById('monitorStage').scrollHeight=2200;
  document.querySelector=selector=>selector==='meta[name="mirox-monitor-session"]'?(local?{content:'nonce'}:null):selector==='meta[name="mirox-monitor-release"]'&&release?{content:release}:null;
  const clock=[],timers=[],timerDelays=[],intervalDelays=[],state={value:{stato:'non_associato'},reloads:0,calls:[],now:Date.now()};
  class PageDate extends Date {constructor(...args){super(...(args.length?args:[state.now]));}static now(){return state.now;}}
  const location={hostname:local?'127.0.0.1':'mirox-crm.it',port:local?'8765':'',reload:()=>state.reloads++};
  const window={MiroxMonitorCore:core};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/mirox-safe.js'),'utf8'),{window});
  const context={window,document,location,innerWidth:1080,innerHeight:1920,Intl,Date:PageDate,AbortSignal,addEventListener:()=>{},setInterval:(fn,ms)=>{intervalDelays.push(ms);clock.push(fn);},setTimeout:(fn,ms)=>{timerDelays.push(ms);timers.push(fn);},MiroxApi:{fetch:async(url,opts)=>{state.calls.push({url,opts});return {ok:!state.denied,status:state.denied?403:200,json:async()=>state.value};}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/monitor.js'),'utf8'),context);await flush();
  return {state,document,timers,clock,timerDelays,intervalDelays};
}
test('UI reale: pagina remota priva di sessione non richiede dati; postazione propone associazione',async()=>{const remote=await page({local:false});assert.equal(remote.state.calls.length,0);assert.equal(remote.document.getElementById('monitorPairForm').hidden,true);const local=await page();assert.equal(local.document.getElementById('monitorPair').hidden,false);assert.match(local.document.getElementById('monitorHealth').textContent,/associare/);});
test('UI: il layout applica il margine superiore e riserva spazio sotto il contenuto',async()=>{
  const {document}=await page();
  const stage=document.getElementById('monitorStage');
  const top=parseFloat(stage.style.top);
  const scale=Number(stage.style.transform.match(/^scale\((.+)\)$/)[1]);
  assert.equal(top,1920*0.03);
  assert.ok(top+stage.scrollHeight*scale<=1920*0.975);
});
test('UI reale: caricamento atomico, escaping, Day completo, revoca oscura e riavvio servizio ricarica',async()=>{const p=await buildSnapshot(fakeDb(fixture()),new Date());p.data=core.dateKey();p.aggiornato_il=new Date().toISOString();p.day[0].nome='<img src=x onerror=evil()> ';p.postazione='TV Test';const x=await page();x.state.value={stato:'attivo',snapshot:p};x.timers.shift()();await flush();assert.equal(x.document.getElementById('monitorData').hidden,false);assert.equal(x.document.getElementById('monitorPair').hidden,true);assert.match(x.document.getElementById('dayTable').innerHTML,/&lt;img/);assert.doesNotMatch(x.document.getElementById('dayTable').innerHTML,/<img src=x/);assert.match(x.document.getElementById('dayTable').innerHTML,/VUOTA/);assert.match(x.document.getElementById('monthBusiness').innerHTML,/pt/);x.state.value={stato:'revocato',snapshot:null};x.timers.shift()();await flush();assert.equal(x.document.getElementById('monitorData').hidden,true);assert.equal(x.document.getElementById('monitorPair').hidden,false);x.state.denied=true;x.timers.shift()();await flush();assert.equal(x.state.reloads,1);});

test('UI: poll1s, conferma versione solo dopo rendering e reload automatico dopo pubblicazione',async()=>{
  const x=await page({release:'a'.repeat(64)});
  assert.equal(x.timerDelays[0],1000);
  const beat=x.clock[x.intervalDelays.indexOf(5000)];beat();await flush();
  const body=JSON.parse(x.state.calls.filter(c=>c.url==='/api/heartbeat').at(-1).opts.body);
  assert.equal(body.pagina_versione,'a'.repeat(64));
  x.state.value={stato:'non_associato',pagina_versione:'b'.repeat(64)};
  x.timers.shift()();await flush();assert.equal(x.state.reloads,1);assert.equal(x.timers.length,0);
});

test('UI: una pagina che fallisce il rendering non conferma il nuovo rilascio',async()=>{
  const x=await page({release:'a'.repeat(64)});
  x.state.value={stato:'attivo',snapshot:{aggiornato_il:new Date().toISOString()}};
  x.timers.shift()();await flush();
  x.clock[x.intervalDelays.indexOf(5000)]();await flush();
  const body=JSON.parse(x.state.calls.filter(c=>c.url==='/api/heartbeat').at(-1).opts.body);
  assert.equal(body.pagina_versione,'a'.repeat(64));assert.equal(body.rendering,false);assert.equal(body.errore_render,true);
});

test('agenda: ripetuti refresh non accelerano il cambio pagina di15secondi reali',async()=>{
  const x=await page();const p=await buildSnapshot(fakeDb(fixture()),new Date(x.state.now));p.data=core.dateKey(new Date(x.state.now));p.aggiornato_il=new Date(x.state.now).toISOString();p.postazione='TV';
  const slots=Array.from({length:8},(_,i)=>({codice:'A-'+i,ora:new Date(x.state.now+600000+i*60000).toISOString(),durata:30}));
  slots[7].codice='<img src=x onerror=evil()>';
  p.agenda={totale:9,presentati:1,non_presentati:0,in_attesa:8,appuntamenti:slots};
  x.state.value={stato:'attivo',snapshot:p};x.timers.shift()();await flush();
  const next=x.document.getElementById('agendaNext');
  const list=x.document.getElementById('agendaList');
  assert.equal(x.document.getElementById('agendaPage').textContent,'1 / 2');
  assert.match(next.innerHTML,/A-0/);
  assert.equal([...list.innerHTML.matchAll(/<li /g)].length,6);
  assert.match(list.innerHTML,/A-6/);
  const tick=x.clock[x.intervalDelays.indexOf(1000)];for(let i=0;i<40;i++)tick();
  assert.equal(x.document.getElementById('agendaPage').textContent,'1 / 2');
  x.state.now+=15000;tick();assert.equal(x.document.getElementById('agendaPage').textContent,'2 / 2');
  assert.match(next.innerHTML,/A-0/);
  assert.equal([...list.innerHTML.matchAll(/<li /g)].length,1);
  assert.match(list.innerHTML,/&lt;img/);
  assert.doesNotMatch(list.innerHTML,/<img/);
  p.agenda.appuntamenti=[];
  tick();
  assert.match(next.innerHTML,/Nessun appuntamento in attesa/);
  assert.equal(list.innerHTML,'');
  assert.equal(x.document.getElementById('agendaPage').textContent,'');
});

test('attesa primo snapshot: heartbeat vivo ma rendering non confermato, senza falso errore pagina',async()=>{
  const x=await page({release:'a'.repeat(64)});x.state.value={stato:'caricamento',snapshot:null};x.timers.shift()();await flush();
  x.clock[x.intervalDelays.indexOf(5000)]();await flush();const body=JSON.parse(x.state.calls.filter(c=>c.url==='/api/heartbeat').at(-1).opts.body);
  assert.equal(body.pagina_versione,'a'.repeat(64));assert.equal(body.rendering,false);assert.equal(body.errore_render,false);
});
