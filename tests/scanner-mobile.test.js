'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../js/scanner-documenti-core');
test('telefono acquisisce fronte/retro in memoria, invia PDF idempotente e rilascia fotocamera e immagini',async()=>{
 const elements=new Map(),handlers={},revoked=[],uploads=[];let stopped=0,saves=0,replaced=false;
 function element(id){if(elements.has(id))return elements.get(id);const el={id,hidden:false,disabled:false,value:'',textContent:'',videoWidth:1920,videoHeight:1080,events:{},addEventListener(type,fn){this.events[type]=fn;},replaceChildren(){},append(){},play:async()=>{}};elements.set(id,el);return el;}
 const document={hidden:false,getElementById:element,addEventListener(type,fn){handlers[type]=fn;},createElement(type){if(type==='canvas')return {getContext:()=>({drawImage(){}}),toBlob:fn=>fn(new Blob(['jpeg-fixture'],{type:'image/jpeg'}))};return element('dynamic'+elements.size);}};
 let apiCalls=0;
 const window={MiroxScannerCore:Core,addEventListener(type,fn){handlers[type]=fn;},MiroxApi:{fetch:async(_,opts)=>{apiCalls++;if(apiCalls===1)return {ok:true,json:async()=>({success:true,stato:'aperta',cliente:'Cliente dimostrativo',pacchetto:{tipo:'cie'},expires_at:new Date(Date.now()+60000).toISOString()})};uploads.push(Buffer.from(await opts.body.get('file').arrayBuffer()));return {ok:apiCalls!==2,json:async()=>apiCalls===2?{success:false,error:'Rete interrotta'}:{success:true}};}}};
 const PDFLib={PDFDocument:{create:async()=>({embedJpg:async()=>({width:100,height:60}),addPage:()=>({drawImage(){}}),save:async()=>{saves++;return new Uint8Array(Buffer.from('%PDF-dimostrativo'));}})}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/scanner-documenti-mobile'),'utf8'),{window,document,location:{hash:'#id=fixture&token=secret',pathname:'/moduli/scanner-documenti.html'},history:{replaceState(){replaced=true;}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){stopped++;}}]})}},URLSearchParams,Date,Blob,FormData,PDFLib,URL:{createObjectURL:()=>`blob:${elements.size}`,revokeObjectURL:url=>revoked.push(url)}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(replaced,true);assert.equal(element('scanCapture').hidden,false);
 await element('scanStart').events.click();await element('scanTake').events.click();await element('scanTake').events.click();assert.equal(element('scanSend').hidden,false);
 await element('scanSend').events.click();assert.match(element('scanStatus').textContent,/Rete interrotta/);
 await element('scanSend').events.click();assert.equal(saves,1);assert.equal(uploads.length,2);assert.deepEqual(uploads[0],uploads[1]);
 assert.match(element('scanStatus').textContent,/inviato al CRM/);assert.equal(element('scanCapture').hidden,true);assert.equal(stopped,1);assert.equal(revoked.length,2);
});
function delayedFixture({deferPhoto=false,deferPdf=false}={}){
 const elements=new Map(),handlers={},blobs=new Map();let serial=0,photo=0,releasePhoto,releasePdf,uploads=0;
 function element(id){if(elements.has(id))return elements.get(id);const el={id,children:[],events:{},videoWidth:1920,videoHeight:1080,addEventListener(k,f){this.events[k]=f;},replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);},play:async()=>{}};elements.set(id,el);return el;}
 const document={hidden:false,getElementById:element,addEventListener(k,f){handlers[k]=f;},createElement(type){if(type==='canvas')return {getContext:()=>({drawImage(){}}),toBlob(fn){const blob=new Blob(['foto'+(++photo)]);if(deferPhoto&&photo===2)releasePhoto=()=>fn(blob);else fn(blob);}};return element(type+(++serial));}};
 const window={MiroxScannerCore:Core,addEventListener(k,f){handlers[k]=f;},MiroxApi:{fetch:async(_,opts)=>{if(opts.body instanceof FormData){uploads++;return {ok:true,json:async()=>({success:true})};}return {ok:true,json:async()=>({success:true,stato:'aperta',pacchetto:{tipo:'cie'},expires_at:new Date(Date.now()+60000).toISOString()})};}}};
 const PDFLib={PDFDocument:{create:async()=>({embedJpg:async()=>deferPdf?new Promise(resolve=>{releasePdf=()=>resolve({width:100,height:60});}):({width:100,height:60}),addPage:()=>({drawImage(){}}),save:async()=>new Uint8Array(Buffer.from('%PDF-test'))})}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../js/scanner-documenti-mobile'),'utf8'),{window,document,location:{hash:'#id=fixture&token=secret',pathname:'/moduli/scanner-documenti.html'},history:{replaceState(){}},navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}},URLSearchParams,Date,Blob,FormData,PDFLib,URL:{createObjectURL(blob){const key='blob:'+(++serial);blobs.set(key,blob);return key;},revokeObjectURL:key=>blobs.delete(key)}});
 return {element,handlers,blobs,get uploads(){return uploads;},releasePhoto:()=>releasePhoto(),releasePdf:()=>releasePdf()};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('ripeti scatto durante elaborazione retro non sovrascrive il fronte',async()=>{
 const f=delayedFixture({deferPhoto:true});await tick();await f.element('scanStart').events.click();await f.element('scanTake').events.click();
 const second=f.element('scanTake').events.click();const redo=f.element('scanThumbnails').children[0].children[2];redo.events.click();f.releasePhoto();await second;
 const thumbs=f.element('scanThumbnails').children;assert.equal(thumbs.length,2);
 assert.equal(await f.blobs.get(thumbs[0].children[0].src).text(),'foto1');assert.equal(await f.blobs.get(thumbs[1].children[0].src).text(),'foto2');
});
test('abbandono pagina durante preparazione PDF non ricrea file o avvia invio tardivo',async()=>{
 const f=delayedFixture({deferPdf:true});await tick();await f.element('scanStart').events.click();await f.element('scanTake').events.click();await f.element('scanTake').events.click();
 const sending=f.element('scanSend').events.click();await tick();f.handlers.pagehide();f.releasePdf();await tick();
 // Anche il vecchio ciclo che proseguisse sulla seconda foto deve poter terminare.
 f.releasePdf();await sending;assert.equal(f.uploads,0);assert.equal(f.blobs.size,0);
});
