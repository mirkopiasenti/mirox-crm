'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pda = require('../js/vendita-pda-core');
const {normalizeContractInput, validateCategorySpecificRules} = require('../netlify/functions/crea-vendita-pratica-carrello')._test;
const uiSource = fs.readFileSync(path.join(__dirname, '../js/vendita-pda-ui.js'), 'utf8');
const upload = fs.readFileSync(path.join(__dirname, '../moduli/upload-contratti-vendita.html'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function element(value = '') {
  const listeners = new Map();
  return { value, checked: false, disabled: false, hidden: false, dataset: {},
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatchEvent(event) { for (const fn of [...listeners.get(event.type) || []]) void fn(event); },
    async emit(type) { await Promise.all([...listeners.get(type) || []].map(fn => fn({type, stopPropagation(){}}))); }
  };
}
function fixture(active = false, actionValue = '') {
  const root = element(), flag = element(), action = element(actionValue), management = element(), chooseButton = element();
  flag.checked = active;
  let stamp = 'initial', saves = 0;
  const questions = [], modals = [];
  const window = {MiroxPda: Pda, MiroxSafe: {escapeHtml: v => String(v)}, MiroxUI: {
    confirm(text) { return new Promise(resolve => questions.push({text, resolve})); },
    _build(opts) {
      const buttons = {};
      const modal = {opts, buttons, foot: {querySelector(key) { return buttons[key] ||= element(); }}, close() { opts.onClose(); }};
      modals.push(modal); return modal;
    }
  }};
  vm.runInNewContext(uiSource, {window, Event});
  const options = {flag, action, management, chooseButton, context: () => stamp, onChange() {saves++;}};
  const bind = () => window.MiroxPdaUI.bindReloadForever(root, options);
  return {root, flag, action, management, chooseButton, window, options, questions, modals, bind,
    setStamp(value) {stamp = value;}, get saves() {return saves;},
    answer(value) {questions.shift().resolve(value);},
    async choose(value) {const modal = modals.shift(); assert.ok(modal); if (value == null) modal.close(); else await modal.buttons[value === 'Mantieni attiva' ? '[data-reload-keep]' : '[data-reload-stop]'].emit('click'); await tick();}
  };
}

test('Reload Forever: nuovo upload richiede decisione, storico nullable e scope indipendente dal cluster', () => {
  for (const category of ['Mobile', 'Customer Base']) {
    assert.throws(() => Pda.validateReloadForever({reload_forever: true}, category, {required:true}), /Seleziona/);
    assert.equal(Pda.validateReloadForever({reload_forever:true}, category).reload_forever_gestione, null);
    for (const action of Pda.CLOUD_ACTIONS) {
      const raw = {categoria_id:'cat', offerta_id:'offer', reload_forever:true, reload_forever_gestione:action};
      const normalized = normalizeContractInput(raw, 0);
      validateCategorySpecificRules({contract:normalized, category:{nome:category}, offer:{nome_offerta:'Solo SIM'}, index:0});
      assert.equal(normalized.reload_forever_gestione, action);
    }
    for (const action of ['Altro', 123, {}, 'Mantieni attiva']) {
      const invalid = {reload_forever:action === 'Mantieni attiva' ? false : true, reload_forever_gestione:action};
      assert.throws(() => Pda.validateReloadForever(invalid, category), /non valida/);
    }
  }
  assert.throws(() => Pda.validateReloadForever({reload_forever:true, reload_forever_gestione:'Mantieni attiva'}, 'Fisso'), /non valida/);
  const missing = normalizeContractInput({categoria_id:'cat', offerta_id:'offer', reload_forever:true}, 0);
  assert.throws(() => validateCategorySpecificRules({contract:missing, category:{nome:'Mobile'}, offer:{}, index:0}), /Seleziona/);
});

for (const decision of ['Mantieni attiva', 'Richiedi disattivazione', null])
test('Reload Forever rilevata: popup iniziale '+(decision || 'chiuso senza scelta'), async () => {
  const ui = fixture(true); ui.bind();
  assert.equal(ui.modals.length, 1); assert.match(ui.modals[0].opts.title, /Reload Forever/);
  assert.equal(ui.flag.checked, true); assert.equal(ui.action.value, '');
  await ui.choose(decision);
  assert.equal(ui.flag.checked, true); assert.equal(ui.action.value, decision || '');
  assert.equal(ui.saves, decision ? 1 : 0); assert.equal(ui.management.hidden, false);
});

test('Reload Forever assente o gestione gia salvata: nessun popup automatico', () => {
  for (const [active, action] of [[false,''], [true,'Mantieni attiva'], [true,'Richiedi disattivazione']]) {
    const ui = fixture(active, action); ui.bind(); assert.equal(ui.modals.length, 0);
    assert.equal(ui.management.hidden, !active); assert.equal(ui.action.value, action);
  }
});

for (const accept of [false,true]) test('Reload Forever da Si a No: '+(accept?'conferma':'annulla'), async () => {
  const ui = fixture(true,'Richiedi disattivazione'); ui.bind(); ui.flag.checked = false;
  const run = ui.flag.emit('change'); assert.equal(ui.flag.checked,true); assert.equal(ui.action.value,'Richiedi disattivazione');
  ui.answer(accept); await run;
  assert.equal(ui.flag.checked,!accept); assert.equal(ui.action.value,accept?'':'Richiedi disattivazione');
  assert.equal(ui.saves,accept?1:0); assert.equal(ui.modals.length,0);
});

for (const decision of ['Mantieni attiva','Richiedi disattivazione',null])
test('Reload Forever da No a Si: conferma poi gestione '+(decision || 'annullata'), async () => {
  const ui=fixture();ui.bind();ui.flag.checked=true;
  const run=ui.flag.emit('change');assert.equal(ui.flag.checked,false);ui.answer(true);await tick();
  assert.equal(ui.flag.checked,false);assert.equal(ui.saves,0);await ui.choose(decision);await run;
  assert.equal(ui.flag.checked,Boolean(decision));assert.equal(ui.action.value,decision||'');assert.equal(ui.saves,decision?1:0);
});

test('Reload Forever da No a Si annullato non apre gestione e resta No',async()=>{
  const ui=fixture();ui.bind();ui.flag.checked=true;const run=ui.flag.emit('change');ui.answer(false);await run;
  assert.equal(ui.flag.checked,false);assert.equal(ui.modals.length,0);
});

for(const accepted of [false,true])test('modifica gestione registrata: '+(accepted?'conferma':'annulla'),async()=>{
  const ui=fixture(true,'Mantieni attiva');ui.bind();ui.action.value='Richiedi disattivazione';
  const run=ui.action.emit('change');assert.equal(ui.action.value,'Mantieni attiva');ui.answer(accepted);await run;
  assert.equal(ui.action.value,accepted?'Richiedi disattivazione':'Mantieni attiva');
  assert.equal(ui.saves,accepted?1:0);
});

test('bottone Scegli gestione: apertura, scelta e conferma del cambio',async()=>{
  const ui=fixture(true,'Mantieni attiva');ui.bind();const run=ui.chooseButton.emit('click');
  await ui.choose('Richiedi disattivazione');assert.equal(ui.action.value,'Mantieni attiva');ui.answer(true);await run;
  assert.equal(ui.action.value,'Richiedi disattivazione');assert.equal(ui.saves,1);
});

test('doppi cambi, conferme tardive, modal chiuso e rebind non modificano un altro contesto',async()=>{
  for(const change of ['stamp','disconnected','rebind']){
    const ui=fixture(true,'Mantieni attiva');ui.bind();ui.flag.checked=false;const run=ui.flag.emit('change');
    ui.flag.checked=false;await ui.flag.emit('change');assert.equal(ui.questions.length,1);assert.equal(ui.flag.checked,true);
    if(change==='stamp')ui.setStamp('other');if(change==='disconnected')ui.root.isConnected=false;if(change==='rebind')ui.bind();
    ui.answer(true);await run;assert.equal(ui.flag.checked,true);assert.equal(ui.action.value,'Mantieni attiva');assert.equal(ui.saves,0);
  }
});

test('scelta automatica tardiva scartata dopo nuova PDA e readonly senza popup',async()=>{
  const ui=fixture(true);ui.bind();ui.setStamp('other');await ui.choose('Mantieni attiva');assert.equal(ui.action.value,'');
  const read=fixture(true);read.flag.disabled=true;read.action.disabled=true;read.bind();assert.equal(read.modals.length,0);
});

test('Upload reale: render automatico, gestione scelta, restore e reset per contratto senza perdere Exchange',async()=>{
  const ui=fixture(),fields=element();
  const refs={reloadForever:ui.flag,reloadForeverGestione:ui.action,fieldReloadForeverGestione:ui.management,btnReloadForeverGestione:ui.chooseButton,
    fieldReloadFlags:ui.root,reloadExchange:element(),cluster:{value:'Consumer'},offerta:{value:'offer'}};
  const runtimeState={pdaRevision:1,editingTempId:null};
  Object.assign(ui.window.MiroxPdaUI,{formHtml:()=>'',bindForm(){},readForm:()=>({})});
  const ctx={refs,runtimeState,window:ui.window,document:{getElementById:()=>fields},getCategoriaName:()=> 'Mobile',isCategory:(a,b)=>a===b,queueDraftSave(){}};
  const a=upload.indexOf(' function renderPdaFields(data)'),b=upload.indexOf(' async function checkPendingCode()',a);
  vm.runInNewContext(upload.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
  ctx.render({reload_exchange:true,reload_forever:true});await ui.choose('Richiedi disattivazione');
  const saved=JSON.parse(JSON.stringify(ctx.read()));assert.equal(saved.reload_forever_gestione,'Richiedi disattivazione');
  ctx.render(saved);assert.equal(ui.modals.length,0);assert.equal(ctx.read().reload_forever_gestione,'Richiedi disattivazione');
  assert.equal(refs.reloadExchange.checked,true);ctx.render({});assert.equal(ui.flag.checked,false);assert.equal(ui.action.value,'');
});

function loadHandler(file, db) {
  const filename=path.join(__dirname,'../netlify/functions/',file),nativeRequire=require('node:module').createRequire(filename),module={exports:{}};
  const id='11111111-1111-4111-8111-111111111111';
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,Buffer,Date,Intl,
    process:{env:{SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},console:{log(){},warn(){},error(){}},
    require(name){
      if(name==='@supabase/supabase-js')return {createClient:()=>db};
      if(name==='./_lib/require-auth')return {requireAuth:async()=>({ok:true,profilo:{id,ruolo:'operatore'}}),getAdminClient:()=>db};
      if(name==='./_lib/verifica-worker')return {changed:async()=>{},wake:async()=>{}};
      return nativeRequire(name);
    }});
  return module.exports.handler;
}
const event=body=>({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

test('API create respinge Reload Forever senza decisione prima di ogni scrittura',async()=>{
  const db={from(table){assert.equal(table,'vendita_categorie');return {select(){return this;},async in(){return {data:[{id:'cat',nome:'Customer Base'}]};}};}};
  const handler=loadHandler('crea-vendita-pratica-carrello.js',db);
  const result=await handler(event({cliente:{cf_piva:'RSSMRA80A01H501U',ragione_sociale:'Test',cluster:'Consumer',cellulare:'3331234567',email:'test@example.invalid'},
    contratti:[{categoria_id:'cat',offerta_id:'offer',codice_contratto:'TEST001',reload_forever:true}]}));
  assert.equal(result.statusCode,400);assert.match(JSON.parse(result.body).error,/gestione Reload Forever/);
});

test('API Verifica salva la gestione e conserva storico senza inventarla; rifiuta incoerenze e revisioni obsolete',async()=>{
  const id='11111111-1111-4111-8111-111111111111';
  for(const scenario of ['save','legacy','missing','inactive','invalid','stale']){
    const current={id,categoria_id:'cat',categoria_snapshot:'Mobile',cluster_cliente:'Consumer',stato_controllo:'da_controllare',updated_at:'2026-11-13T10:00:00Z',reload_forever:scenario!=='missing',reload_forever_gestione:null};
    for(const key of ['punteggio_gara_offerta','punteggio_gara_opzione','punteggio_extra_gara_offerta','punteggio_extra_gara_opzione','punteggio_gara_totale','punteggio_extra_gara_totale','punteggio_offerta','punteggio_opzione','punteggio_extra','punteggio_totale'])current[key]=0;
    let written;
    const db={from(table){assert.equal(table,'vendita_contratti');let patch;
      const q={select(){return q;},eq(){return q;},update(value){patch=value;written=value;return q;},async maybeSingle(){return {data:{...current,...patch}};}};return q;}};
    const handler=loadHandler('gestisci-vendita-contratto.js',db);
    const contract=scenario==='legacy'?{}:scenario==='missing'?{reload_forever:true}:scenario==='inactive'?{reload_forever:false,reload_forever_gestione:'Mantieni attiva'}:
      {reload_forever:true,reload_forever_gestione:scenario==='invalid'?'Altro':'Richiedi disattivazione'};
    const result=await handler(event({action:'update',mode:'save',contratto_id:id,expected_updated_at:scenario==='stale'?'old':current.updated_at,contratto:contract}));
    if(['save','legacy'].includes(scenario)){
      assert.equal(result.statusCode,200);assert.equal(written.reload_forever_gestione,scenario==='legacy'?null:'Richiedi disattivazione');
      assert.equal(written.stato_controllo,undefined);assert.equal(written.punteggio_gara_totale,undefined);
    }else{assert.equal(result.statusCode,scenario==='stale'?409:400);assert.equal(written,undefined);}
  }
});

test('Verifica Contratti: dettaglio rende la scelta e payload preserva entrambe le decisioni/null senza confonderle con la spunta',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/verifica_contratti.html'),'utf8');
  const a=source.indexOf('        <div class="det-field" id="vc_field_reload_forever">'),b=source.indexOf('\n    <div class="det-section">',a);
  const start=source.indexOf('function leggiPayloadDalPopup()'),end=source.indexOf('// CONFERMA VERIFICA',start);
  for(const decision of [...Pda.CLOUD_ACTIONS,null]){
    const ctx={c:{reload_forever:true,reload_forever_gestione:decision},disabled:'disabled',window:{MiroxPda:Pda},escapeHtml:v=>String(v)};
    vm.runInNewContext('this.html=`'+source.slice(a,b)+'`;',ctx);
    assert.match(ctx.html,/Gestione Reload Forever/);assert.match(ctx.html,/vc_reload_forever_gestione" disabled/);
    if(decision)assert.ok(ctx.html.includes('value="'+decision+'" selected'));
    const fields={vc_categoria_id:{value:'cat'},vc_reload_forever:{value:'',checked:true},vc_reload_forever_gestione:{value:decision||''}};
    const payloadCtx={window:{},document:{getElementById:key=>fields[key],querySelector:()=>({textContent:'Mobile'})}};
    vm.runInNewContext(source.slice(start,end)+';this.payload=leggiPayloadDalPopup;',payloadCtx);
    assert.equal(payloadCtx.payload().contratto.reload_forever_gestione,decision);
    fields.vc_reload_forever.checked=false;assert.equal(payloadCtx.payload().contratto.reload_forever_gestione,null);
  }
});
