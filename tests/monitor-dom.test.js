'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {documentFixture}=require('./permissions-dom-helper');
const {buildSnapshot}=require('../netlify/functions/_lib/monitor-snapshot');
const {fakeDb,fixture}=require('./monitor-helpers.cjs');
const core=require('../js/monitor-core');
const root=path.resolve(__dirname,'..');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function page({local=true}={}) {
  const ids=[...fs.readFileSync(path.join(root,'monitor.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  const document=documentFixture(ids);for(const id of ids)document.getElementById(id).style={};document.getElementById('monitorStage').scrollHeight=2200;
  document.querySelector=selector=>selector==='meta[name="mirox-monitor-session"]'?(local?{content:'nonce'}:null):null;
  const clock=[],timers=[],state={value:{stato:'non_associato'},reloads:0,calls:[]};
  const location={hostname:local?'127.0.0.1':'mirox-crm.it',port:local?'8765':'',reload:()=>state.reloads++};
  const window={MiroxMonitorCore:core};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/mirox-safe.js'),'utf8'),{window});
  const context={window,document,location,innerWidth:1080,innerHeight:1920,Intl,Date,AbortSignal,addEventListener:()=>{},setInterval:fn=>clock.push(fn),setTimeout:fn=>timers.push(fn),MiroxApi:{fetch:async(url,opts)=>{state.calls.push({url,opts});return {ok:!state.denied,status:state.denied?403:200,json:async()=>state.value};}}};
  vm.runInNewContext(fs.readFileSync(path.join(root,'js/monitor.js'),'utf8'),context);await flush();
  return {state,document,timers,clock};
}
test('UI reale: pagina remota priva di sessione non richiede dati; postazione propone associazione',async()=>{const remote=await page({local:false});assert.equal(remote.state.calls.length,0);assert.equal(remote.document.getElementById('monitorPairForm').hidden,true);const local=await page();assert.equal(local.document.getElementById('monitorPair').hidden,false);assert.match(local.document.getElementById('monitorHealth').textContent,/associare/);});
test('UI reale: caricamento atomico, escaping, Day completo, revoca oscura e riavvio servizio ricarica',async()=>{const p=await buildSnapshot(fakeDb(fixture()),new Date());p.data=core.dateKey();p.aggiornato_il=new Date().toISOString();p.day[0].nome='<img src=x onerror=evil()> ';p.postazione='TV Test';const x=await page();x.state.value={stato:'attivo',snapshot:p};x.timers.shift()();await flush();assert.equal(x.document.getElementById('monitorData').hidden,false);assert.equal(x.document.getElementById('monitorPair').hidden,true);assert.match(x.document.getElementById('dayTable').innerHTML,/&lt;img/);assert.doesNotMatch(x.document.getElementById('dayTable').innerHTML,/<img src=x/);assert.match(x.document.getElementById('dayTable').innerHTML,/VUOTA/);assert.match(x.document.getElementById('monthBusiness').innerHTML,/pt/);x.state.value={stato:'revocato',snapshot:null};x.timers.shift()();await flush();assert.equal(x.document.getElementById('monitorData').hidden,true);assert.equal(x.document.getElementById('monitorPair').hidden,false);x.state.denied=true;x.timers.shift()();await flush();assert.equal(x.state.reloads,1);});
