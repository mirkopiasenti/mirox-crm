'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeResult } = require('../netlify/functions/ocr-pda')._test;
const Pda = require('../js/vendita-pda-core');
const source = fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');

test('OCR distingue presenza, assenza esplicita e lettura incompleta o contraddittoria',()=>{
  assert.equal(normalizeResult({}).dispositivo_presente,null);
  assert.equal(normalizeResult({dispositivo_presente:null}).dispositivo_presente,null);
  assert.equal(normalizeResult({dispositivo_presente:true}).dispositivo_presente,null);
  assert.equal(normalizeResult({dispositivo_presente:false}).dispositivo_presente,false);
  assert.equal(normalizeResult({dispositivo_presente:true,imei:'123456789012345'}).dispositivo_presente,true);
  assert.equal(normalizeResult({dispositivo_presente:false,imei:'123456789012345'}).dispositivo_presente,null);
  assert.equal(normalizeResult({dispositivo_presente:true,imei:'non leggibile'}).dispositivo_presente,null);
});

function fixture(auto='true'){
  const a=source.indexOf(' function maybeSelectOcrDevice('),b=source.indexOf(' // Auto-compila i campi dispositivo',a);
  const root={dataset:{pdaDeviceAuto:auto,pdaDeviceManual:'false'}};
  const refs={dispositivoAssociato:{value:auto==='true'?'false':'true',disabled:false},offerta:{value:'offer'},imei:{value:'123456789012345'}};
  const runtimeState={pdaRevision:1,editingTempId:null,ocrDeviceApplied:true};let decide,renders=0,saves=0,questions=0;
  const ctx={root,refs,runtimeState,document:{getElementById:()=>root},window:{MiroxUI:{confirm(){questions++;return new Promise(resolve=>{decide=resolve;});}}},
    renderDynamicSections(){renders++;if(refs.dispositivoAssociato.value!=='true')refs.imei.value='';},queueDraftSave(){saves++;}};
  vm.runInNewContext(source.slice(a,b)+';this.select=maybeSelectOcrDevice;this.change=confirmDeviceChange;',ctx);
  return {root,refs,runtimeState,select:ctx.select,change:ctx.change,decide:v=>decide(v),get renders(){return renders;},get saves(){return saves;},get questions(){return questions;}};
}

test('preseleziona sia Si sia No, lascia vuoto l incerto e rispetta override e dispositivo obbligatorio',()=>{
  for(const value of ['true','false','']){
    const ui=fixture(value);ui.select(true);assert.equal(ui.refs.dispositivoAssociato.value,value);
    ui.root.dataset.pdaDeviceManual='true';ui.refs.dispositivoAssociato.value='manual';ui.select(true);assert.equal(ui.refs.dispositivoAssociato.value,'manual');
    ui.root.dataset.pdaDeviceManual='false';ui.refs.dispositivoAssociato.disabled=true;ui.refs.dispositivoAssociato.value='true';ui.select(true);assert.equal(ui.refs.dispositivoAssociato.value,'true');
  }
});

for(const auto of ['true','false'])for(const accepted of [true,false])
test(`conferma dispositivo ${auto==='true'?'Si verso No':'No verso Si'}: ${accepted?'confermata':'annullata'}`,async()=>{
  const ui=fixture(auto),selected=ui.refs.dispositivoAssociato.value,run=ui.change();
  assert.equal(ui.refs.dispositivoAssociato.value,auto);assert.equal(ui.refs.imei.value,'123456789012345');
  assert.equal(ui.root.dataset.pdaDeviceManual,'false');assert.equal(ui.renders,0);assert.equal(ui.saves,0);
  ui.decide(accepted);await run;
  assert.equal(ui.refs.dispositivoAssociato.value,accepted?selected:auto);
  assert.equal(ui.root.dataset.pdaDeviceManual,accepted?'true':'false');
  assert.equal(ui.renders,accepted?1:0);assert.equal(ui.saves,accepted?1:0);
  if(!accepted)assert.equal(ui.refs.imei.value,'123456789012345');
  assert.equal(ui.root.dataset.pdaDevicePending,undefined);
});

test('conferme tardive e doppio cambio non alterano una nuova PDA, offerta o contratto',async()=>{
  for(const scenario of ['pda','offerta','contratto','reset']){
    const ui=fixture(),pending=ui.change();ui.refs.dispositivoAssociato.value='false';await ui.change();
    assert.equal(ui.questions,1);assert.equal(ui.refs.dispositivoAssociato.value,'true');
    if(scenario==='pda')ui.runtimeState.pdaRevision++;
    if(scenario==='offerta')ui.refs.offerta.value='other';
    if(scenario==='contratto')ui.runtimeState.editingTempId='other';
    if(scenario==='reset')delete ui.root.dataset.pdaDevicePending;
    ui.refs.dispositivoAssociato.value='other';ui.decide(true);await pending;
    assert.equal(ui.refs.dispositivoAssociato.value,'other');assert.equal(ui.renders,0);
  }
});

test('scelta incerta o gia manuale resta modificabile; dispositivo obbligatorio non si disattiva',async()=>{
  for(const scenario of ['incerto','manuale','identico','obbligatorio']){
    const ui=fixture();if(scenario==='incerto')ui.root.dataset.pdaDeviceAuto='';
    if(scenario==='manuale')ui.root.dataset.pdaDeviceManual='true';
    if(scenario==='identico')ui.refs.dispositivoAssociato.value='true';
    if(scenario==='obbligatorio')ui.refs.dispositivoAssociato.disabled=true;
    await ui.change();assert.equal(ui.questions,0);
    if(scenario==='obbligatorio')assert.equal(ui.refs.dispositivoAssociato.value,'true');
  }
});

test('metadati dispositivo conservano automatismo e override nel restore, nuovo PDA li azzera',()=>{
  const a=source.indexOf(' function renderPdaFields(data)'),b=source.indexOf(' async function checkPendingCode()',a),root={dataset:{},addEventListener(){}};
  const ctx={document:{getElementById:()=>root},getCategoriaName:()=> 'Mobile',queueDraftSave(){},window:{MiroxPda:Pda,
    MiroxPdaUI:{formHtml:()=>'',bindForm(){},readForm:()=>({})}}};
  vm.runInNewContext(source.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
  ctx.render({pda_dispositivo_auto:false,pda_dispositivo_manuale:false,dispositivo_associato:'false'});
  assert.equal(ctx.read().pda_dispositivo_auto,false);assert.equal(ctx.read().pda_dispositivo_manuale,false);
  const draft=JSON.parse(JSON.stringify(ctx.read()));ctx.render(draft);assert.equal(ctx.read().pda_dispositivo_auto,false);
  ctx.render({...draft,pda_dispositivo_manuale:true});assert.equal(ctx.read().pda_dispositivo_manuale,true);
  ctx.render({dispositivo_associato:false});assert.equal(ctx.read().pda_dispositivo_manuale,true);
  ctx.render({});assert.equal(ctx.read().pda_dispositivo_auto,null);assert.equal(ctx.read().pda_dispositivo_manuale,false);
});

test('precompilazione positiva non sovrascrive acquisto vincolato o override del dispositivo',()=>{
  const a=source.indexOf(' function maybeApplyOcrDevice()'),b=source.indexOf(' // ===== EVENT HANDLERS',a);
  const root={dataset:{pdaDeviceManual:'false'}};
  const refs=new Proxy({tipoAcquisto:{value:'Finanziamento',disabled:true}}, {get:(o,k)=>o[k] ||= {value:'',classList:{contains:()=>false,remove(){},toggle(){}}}});
  const runtimeState={lastOcrData:{dispositivo_presente:true,tipo_acquisto:'VAR',imei:'123456789012345',prezzo_device:'100'},ocrDeviceApplied:false};
  const fields={document:{getElementById:()=>root},runtimeState,refs,isFwaIndoor:()=>false,window:{}};
  vm.runInNewContext(source.slice(a,b)+';this.apply=maybeApplyOcrDevice;',fields);
  fields.apply();assert.equal(refs.dispositivoAssociato.value,'true');assert.equal(refs.tipoAcquisto.value,'Finanziamento');
  root.dataset.pdaDeviceManual='true';refs.dispositivoAssociato.value='false';runtimeState.ocrDeviceApplied=false;
  fields.apply();assert.equal(refs.dispositivoAssociato.value,'false');
});
