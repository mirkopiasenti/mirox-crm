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
