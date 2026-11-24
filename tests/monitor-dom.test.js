'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {documentFixture}=require('./permissions-dom-helper');
const {buildSnapshot}=require('../netlify/functions/_lib/monitor-snapshot');
const {fakeDb,fixture,directFixture}=require('./monitor-helpers.cjs');
const core=require('../js/monitor-core');
const root=path.resolve(__dirname,'..');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function page({local=true,release=null,now=Date.now()}={}) {
  const ids=[...fs.readFileSync(path.join(root,'monitor.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const document=documentFixture(ids);for(const id of ids)document.getElementById(id).style={};document.getElementById('monitorStage').scrollHeight=2200;
  document.querySelector=selector=>selector==='meta[name="mirox-monitor-session"]'?(local?{content:'nonce'}:null):selector==='meta[name="mirox-monitor-release"]'&&release?{content:release}:null;
  const clock=[],timers=[],timerDelays=[],intervalDelays=[],state={value:{stato:'non_associato'},reloads:0,calls:[],now};
  class PageDate extends Date {constructor(...args){super(...(args.length?args:[state.now]));}static now(){return state.now;}}
  const location={hostname:local?'127.0.0.1':'mirox-crm.it',port:local?'8765':'',reload:()=>state.reloads++};
  const window={MiroxMonitorCore:core,MiroxMonitorReport:require('../js/monitor-report-core')};
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

 test('UI diretta: dati tecnici calcolati nel browser, heartbeat senza ricalcolo e revoca',async()=>{
  const x=await page();const date=core.dateKey(new Date(x.state.now));const p=directFixture(date);p.aggiornato_il=new Date(x.state.now).toISOString();p.verificato_il=p.aggiornato_il;
  x.state.value={stato:'attivo',snapshot:p};x.timers.shift()();await flush();
  assert.equal(x.document.getElementById('monitorData').hidden,false);assert.match(x.document.getElementById('dayTable').innerHTML,/VUOTA/);
  const html=x.document.getElementById('dayTable').innerHTML;x.state.now+=70000;p.verificato_il=new Date(x.state.now).toISOString();
  x.timers.shift()();await flush();assert.equal(x.document.getElementById('dayTable').innerHTML,html);assert.match(x.document.getElementById('monitorHealth').textContent,/Connesso/);
  x.state.value={stato:'revocato',snapshot:null};x.timers.shift()();await flush();assert.equal(x.document.getElementById('monitorData').hidden,true);
 });

test('sprint sul Monitor: usa i KPI correnti, mostra i traguardi e torna al mensile a dicembre',async()=>{
  const x=await page({now:Date.parse('2026-11-30T22:59:57Z')});
  const p=directFixture('2026-11-30');
  const initial=(points,rule)=>({...rule,mirox_sprint_novembre_2026:points});
  p.metriche=[
    {...p.metriche[0],id:9,regola:initial(1.5,{categoria:'Mobile'})},
    {id:12,nome:'FISSI',tabella:'avanzamento_standard',regola:initial(0,{categoria:'Fisso'})},
    {id:13,nome:'LUCE & GAS',tabella:'avanzamento_standard',regola:initial(0,{categoria:'Energia'})},
    {id:21,nome:'EXTRA GARA P.IVA',tabella:'avanzamento_extra_piva',regola:initial(1,{cluster:'Business'})}
  ];
  const node=id=>x.document.getElementById(id);
  async function refresh(payload) {
    const stamp=new Date(x.state.now).toISOString();
    x.state.value={stato:'attivo',snapshot:{...payload,revisione:stamp,aggiornato_il:stamp,verificato_il:stamp}};
    x.timers.shift()();
    await flush();
  }
  await refresh(p);
  assert.equal(node('monitorMonth').hidden,true);
  assert.equal(node('monitorSprint').hidden,false);
  assert.equal(node('sprintScore').textContent,'0/4');
  assert.match(node('sprintGoals').innerHTML,/<strong>30<\/strong>/);
  x.state.now+=1000;
  p.contratti.push(
    {...p.contratti[0],id:'business',punteggio_gara_totale:1.25,punteggio_extra_gara_totale:13},
    {...p.contratti[0],id:'fisso',categoria_snapshot:'Fisso',punteggio_gara_totale:8,punteggio_extra_gara_totale:9},
    {...p.contratti[0],id:'energia',categoria_snapshot:'Energia'}
  );
  p.post.energia=[{contratto_id:'energia',stato:'Rifiutato'}];
  await refresh(p);
  assert.equal(node('sprintScore').textContent,'2/4');
  assert.match(node('sprintGoals').innerHTML,/<strong>28,75<\/strong>/);
  assert.match(node('sprintGoals').innerHTML,/<progress aria-label="Avanzamento Business" max="12" value="12"/);
  assert.match(node('sprintGoals').innerHTML,/<progress aria-label="Avanzamento Luce &amp; Gas" max="5" value="0"/);

  x.state.now+=1000;
  p.post.fisso=[{contratto_id:'fisso',stato:'KO',tecnologia:'FWA'}];
  await refresh(p);
  assert.equal(node('sprintScore').textContent,'1/4','un KO fa riemergere il residuo');
  x.state.now+=1000;
  x.clock[x.intervalDelays.indexOf(1000)]();
  assert.equal(node('monitorSprint').hidden,true);
  assert.equal(node('monitorMonth').hidden,false);
  await refresh({...p,data:'2026-12-01',contratti:[]});
  assert.equal(node('monitorData').hidden,false);
  assert.equal(node('monitorMonth').hidden,false);
  assert.equal(node('monthTitle').textContent,'dicembre 2026');
});
