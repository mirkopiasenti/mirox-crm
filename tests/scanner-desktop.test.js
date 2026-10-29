'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(respond){
 const calls=[],timers=new Map(),modals=[];let next=0;
 const element=()=>({innerHTML:'',_text:'',get textContent(){return this._text;},set textContent(value){this._text=value;this.innerHTML='';},listeners:{},addEventListener(k,f){this.listeners[k]=f;}});
 const window={MiroxScannerCore:require('../js/scanner-documenti-core'),MiroxSafe:{escapeHtml:v=>v},MiroxApi:{fetch:async(_,options)=>{const input=JSON.parse(options.body);calls.push(input);return respond(input);}},MiroxUI:{_build(options){
  const box=element(),info=element(),pdf=element(),renew=element(),retry=element(),type=element(),health=element(),m={box,info,pdf,renew,retry,type,health,body:{querySelector:selector=>selector==='[data-scan-type]'?type:selector==='[data-scan-health]'?health:selector==='[data-scan-status]'?info:box},foot:{querySelector:selector=>selector==='[data-scan-pdf]'?pdf:selector==='[data-scan-retry]'?retry:renew},closed:false,close(){this.closed=true;options.onClose();}};modals.push(m);return m;
 }}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/scanner-documenti-ui'),'utf8'),{window,File,setTimeout(fn){const key=++next;timers.set(key,fn);return key;},clearTimeout:key=>timers.delete(key)});
 return {ui:window.MiroxScannerUI,calls,timers,modals,async poll(){const [key,fn]=timers.entries().next().value;timers.delete(key);await fn();}};
}
const response=data=>({ok:true,json:async()=>({success:true,...data})});
const options={customer:{ragione_sociale:'Cliente dimostrativo'},pacchetto:{tipo:'cie'}};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('QR desktop: PDF ricevuto solo nella sessione corrente e cancellazione dopo trasferimento',async()=>{
 let attached;
 const f=fixture(async input=>input.action==='create'?response({id:'uno',qr:'data:image/png;base64,fixture'}):input.action==='status'?response({stato:'pronta'}):input.action==='download'?{ok:true,blob:async()=>new Blob(['%PDF-fixture'],{type:'application/pdf'})}:response({}));
 await f.ui.open({...options,onPdf:file=>{attached=file;}});await f.poll();await tick();
 assert.equal(attached.name,'documento-smartphone.pdf');assert.equal(await attached.text(),'%PDF-fixture');assert.equal(f.modals[0].closed,true);
 assert.deepEqual(f.calls.map(c=>c.action),['create','status','download','cancel']);assert.equal(f.timers.size,0);
});
test('QR desktop: fallback esplicito invalida il QR; rinnovo possibile anche dopo scadenza',async()=>{
 let n=0,fallback=0;
 const f=fixture(async input=>input.action==='create'?response({id:String(++n),qr:'data:image/png;base64,fixture'}):input.action==='cancel'&&input.id==='1'?{ok:false,json:async()=>({error:'QR scaduto'})}:response({}));
 await f.ui.open({...options,onFallback:()=>{fallback++;}});f.modals[0].renew.listeners.click();await tick();
 assert.equal(n,2);assert.equal(f.timers.size,1);f.modals[0].pdf.listeners.click();await tick();
 assert.equal(fallback,1);assert.equal(f.modals[0].closed,true);assert.equal(f.calls.at(-1).id,'2');assert.equal(f.timers.size,0);
});
test('QR desktop: risultato tardivo dopo cambio cliente non viene associato al nuovo cliente',async()=>{
 let release,attached=0;
 const f=fixture(async input=>input.action==='create'?response({id:'uno',qr:'data:image/png;base64,fixture'}):input.action==='status'?response({stato:'pronta'}):input.action==='download'?new Promise(resolve=>{release=()=>resolve({ok:true,blob:async()=>new Blob(['%PDF-fixture'])});}):response({}));
 await f.ui.open({...options,onPdf:()=>{attached++;}});const pending=f.poll();await tick();f.ui.invalidate();release();await pending;
 assert.equal(attached,0);assert.equal(f.modals[0].closed,true);assert.equal(f.timers.size,0);
});
test('QR desktop: chiusura durante creazione revoca anche la sessione arrivata tardi',async()=>{
 let release;
 const f=fixture(async input=>input.action==='create'?new Promise(resolve=>{release=()=>resolve(response({id:'tardiva',qr:'data:image/png;base64,fixture'}));}):response({}));
 const opening=f.ui.open(options);f.ui.invalidate();release();await opening;
 assert.equal(f.calls.at(-1).action,'cancel');assert.equal(f.calls.at(-1).id,'tardiva');assert.equal(f.timers.size,0);
});
test('QR desktop: tipo documento modificabile nel popup, tessera obbligatoria e passaporto manuale',async()=>{
 let packet,fallback=0,n=0;
 const f=fixture(async input=>input.action==='create'?response({id:String(++n),qr:'data:image/png;base64,fixture'}):response({}));
 await f.ui.open({...options,onPackageChange:value=>{packet=value;},onFallback:()=>{fallback++;}});
 const m=f.modals[0];m.type.value='patente';m.type.listeners.change();await tick();
 assert.equal(packet.tipo,'patente');assert.equal(packet.tessera_sanitaria,true);assert.equal(m.health.disabled,true);assert.equal(f.calls.filter(c=>c.action==='create').at(-1).pacchetto.tessera_sanitaria,true);
 m.type.value='passaporto';m.type.listeners.change();await tick();assert.equal(fallback,1);assert.equal(m.closed,true);assert.equal(n,2);
});
test('QR desktop: riapertura immediata mentre la vecchia creazione e ancora pendente',async()=>{
 let release,n=0;
 const f=fixture(async input=>input.action==='create'&&++n===1?new Promise(resolve=>{release=()=>resolve(response({id:'vecchia',qr:'data:image/png;base64,fixture'}));}):input.action==='create'?response({id:'nuova',qr:'data:image/png;base64,fixture'}):response({}));
 const old=f.ui.open(options);f.ui.invalidate();const next=f.ui.open(options);
 assert.equal(f.modals.length,2);await next;release();await old;
 assert.equal(f.modals[1].closed,false);assert.equal(f.timers.size,1);
 assert.equal((await f.ui.open(options)),f.modals[1]);
});
test('QR desktop: errore rete su stato o download ritentato senza perdere scansione o rigenerare QR',async()=>{
 let states=0,downloads=0,attached;
 const f=fixture(async input=>input.action==='create'?response({id:'uno',qr:'data:image/png;base64,fixture'}):input.action==='status'&&++states===1?{ok:false,status:503,json:async()=>({error:'Rete temporaneamente indisponibile'})}:input.action==='status'?response({stato:'pronta'}):input.action==='download'&&++downloads===1?Promise.reject(Error('Rete interrotta')):input.action==='download'?{ok:true,blob:async()=>new Blob(['%PDF-fixture'])}:response({}));
 await f.ui.open({...options,onPdf:file=>{attached=file;}});await f.poll();assert.equal(f.timers.size,1);assert.match(f.modals[0].box.innerHTML,/<img/);assert.match(f.modals[0].info.textContent,/Rete/);
 await f.poll();assert.equal(f.timers.size,1);await f.poll();
 assert.equal(attached.name,'documento-smartphone.pdf');assert.equal(f.calls.filter(c=>c.action==='create').length,1);assert.equal(downloads,2);
});
test('QR desktop: dopo retry automatici esauriti si puo riprendere la stessa ricezione; scadenza non ritentata',async()=>{
 let offline=true,attached;
 const f=fixture(async input=>input.action==='create'?response({id:'uno',qr:'data:image/png;base64,fixture'}):input.action==='status'&&offline?{ok:false,status:503,json:async()=>({error:'Rete assente'})}:input.action==='status'?response({stato:'pronta'}):input.action==='download'?{ok:true,blob:async()=>new Blob(['%PDF-fixture'])}:response({}));
 await f.ui.open({...options,onPdf:file=>{attached=file;}});for(let i=0;i<4;i++)await f.poll();assert.equal(f.timers.size,0);
 offline=false;f.modals[0].retry.listeners.click();await tick();assert.equal(attached.name,'documento-smartphone.pdf');assert.equal(f.calls.filter(c=>c.action==='create').length,1);
 const expired=fixture(async input=>input.action==='create'?response({id:'uno',qr:'data:image/png;base64,fixture'}):{ok:false,status:410,json:async()=>({error:'QR scaduto'})});
 await expired.ui.open(options);await expired.poll();assert.equal(expired.timers.size,0);
});
