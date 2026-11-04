'use strict';
// NODE_PATH=/private/tmp/mirox-cc-planning-qa/node_modules node scripts/check-cc-planning-dom.cjs
const {parseHTML}=require('linkedom');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
const script=file=>[...fs.readFileSync(file,'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('function caricaSlotSposta')||s.includes('function loadSlots'));
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function setup(file){
  const {document,window}=parseHTML(fs.readFileSync(file,'utf8'));const pending=[],toasts=[];
  const context=vm.createContext({document,window,Date,setTimeout,console,Utils:{escapeHtml:esc,showLoading(){},hideLoading(){},toast:m=>toasts.push(m)},
    MiroxCcDisponibilita:{slots:()=>{const d=deferred();pending.push(d);return d.promise;},errorMessage:()=> 'Planning non disponibile'}});
  return{document,context,pending,toasts};
}
async function run(){
  // Prenotazione interna: una risposta vecchia non deve riaprire orari ne conservare lo slot precedente.
  let f=setup('moduli/call-center/prenota-interno.html');
  vm.runInContext("let state={data:null,slot:null,currentMonth:new Date('2026-11-01T12:00:00Z')};let slotsRequest=0;"+script('moduli/call-center/prenota-interno.html').split('function changeMonth')[1].replace(/^/,'function changeMonth'),f.context);
  vm.runInContext("state.data='2026-11-10';state.slot='precedente'",f.context);
  const old=vm.runInContext("loadSlots('2026-11-10')",f.context);
  assert.equal(vm.runInContext('state.slot',f.context),null);
  vm.runInContext("state.data='2026-11-11'",f.context);const fresh=vm.runInContext("loadSlots('2026-11-11')",f.context);
  f.pending[1].resolve({data:[],error:null});await fresh;
  f.pending[0].resolve({data:['2026-11-10T09:30:00+01:00'],error:null});await old;
  assert.equal(f.document.querySelectorAll('.slot').length,0);assert.match(f.document.getElementById('slotsGrid').textContent,/Nessuno slot/);
  const error=vm.runInContext("loadSlots('2026-11-11')",f.context);f.pending[2].resolve({data:null,error:new Error('offline')});await error;
  assert.ok(f.document.querySelector('[role=alert]'));assert.equal(f.document.getElementById('btnConferma').style.display,'none');
  vm.runInContext("state.slot='precedente';changeMonth(1)",f.context);assert.equal(vm.runInContext('state.slot',f.context),null);
  // Spostamenti: cambiare data invalida anche la selezione vecchia se il caricamento fallisce.
  f=setup('moduli/call-center/appuntamenti.html');
  const source=script('moduli/call-center/appuntamenti.html');
  vm.runInContext("let slotSelezionato='precedente';let selezionato={id:'originale',data_ora:'2026-11-10T09:30:00+01:00'};"+source.slice(source.indexOf('let slotsSpostaRequest')),f.context);
  f.document.getElementById('spostaData').value='2026-11-11';const first=vm.runInContext('caricaSlotSposta()',f.context);
  assert.equal(vm.runInContext('slotSelezionato',f.context),null);
  f.document.getElementById('spostaData').value='2026-11-12';const second=vm.runInContext('caricaSlotSposta()',f.context);
  f.pending[1].resolve({data:[],error:null});await second;f.pending[0].resolve({data:['2026-11-11T09:30:00+01:00'],error:null});await first;
  assert.equal(f.document.getElementById('spostaSlots').querySelectorAll('button').length,0);
  const failed=vm.runInContext('caricaSlotSposta()',f.context);f.pending[2].resolve({data:null,error:new Error('offline')});await failed;
  assert.ok(f.document.querySelector('[role=alert]'));assert.equal(vm.runInContext('slotSelezionato',f.context),null);
  // Un rifiuto del trigger sul nuovo appuntamento non modifica quello originale.
  vm.runInContext("slotSelezionato='2026-11-12T09:30:00+01:00'",f.context);
  let mutations=0;f.context.db={from(table){assert.equal(table,'appuntamenti');mutations++;return{insert(){return{select(){return{single:async()=>({error:{message:'slot_non_disponibile_planning'}})};}};}};}};
  await vm.runInContext('confermaSpostamento()',f.context);assert.equal(mutations,1);assert.equal(f.toasts.at(-1),'Planning non disponibile');
  // Outbound: stessa protezione sulle risposte fuori ordine e sul cambio mese.
  f=setup('moduli/call-center/prenota-interno-outbound.html');
  vm.runInContext(fs.readFileSync('moduli/call-center/js/prenota-interno-outbound.js','utf8').split("document.addEventListener('DOMContentLoaded'")[0],f.context);
  vm.runInContext("PrenotaInternoOutbound.state.data='2026-11-10';PrenotaInternoOutbound.state.slot='precedente'",f.context);
  const a=vm.runInContext("PrenotaInternoOutbound.loadSlots('2026-11-10')",f.context);
  assert.equal(vm.runInContext('PrenotaInternoOutbound.state.slot',f.context),null);
  vm.runInContext("PrenotaInternoOutbound.state.data='2026-11-11'",f.context);const b=vm.runInContext("PrenotaInternoOutbound.loadSlots('2026-11-11')",f.context);
  f.pending[1].resolve({data:[],error:null});await b;f.pending[0].resolve({data:['2026-11-10T09:30:00+01:00'],error:null});await a;
  assert.equal(f.document.querySelectorAll('.slot').length,0);
  vm.runInContext("PrenotaInternoOutbound.state.slot='precedente';PrenotaInternoOutbound.changeMonth(1)",f.context);
  assert.equal(vm.runInContext('PrenotaInternoOutbound.state.slot',f.context),null);
  console.log('DOM CC senza browser: risposte invertite, selezioni invalidate, errori, cambio mese e spostamento rifiutato senza modifica originale verificati sui tre flussi.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
