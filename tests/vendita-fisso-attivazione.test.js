'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const { fixedActivationFields, readPdfFields } = require('../netlify/functions/_lib/pda-pdf-text');
const { normalizeResult } = require('../netlify/functions/ocr-pda')._test;
const Pda = require('../js/vendita-pda-core');
const source = fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
const header='Linea telefonica su cui attivare il servizio Offerta (*)\n';
const section=(a,b)=>header+a+' Su una nuova linea telefonica\n'+b+' Sul Numero di Telefono: 0123456789\nCodice Migrazione : ABC';

test('caselle Fisso: distingue nuova attivazione e portabilita da segni testuali, anche codifica WindTre',()=>{
  for(const [yes,no] of [['Y\uFFFF','N\uFFFF'],['[X]','[ ]'],['\u2611','\u2610']]){
    assert.equal(fixedActivationFields(section(yes,no)).tipo_attivazione_fisso,'Nuova Attivazione');
    assert.equal(fixedActivationFields(section(no,yes)).tipo_attivazione_fisso,'Portabilita');
  }
  assert.equal(normalizeResult({tipo_attivazione_fisso:'Portabilit\u00e0'}).tipo_attivazione_fisso,'Portabilita');
  assert.equal(normalizeResult({tipo_attivazione_fisso:'Altro'}).tipo_attivazione_fisso,null);
});
test('caselle ambigue o vuote non producono una scelta; numero e migrazione da soli non bastano',()=>{
  assert.equal(fixedActivationFields(section('Y\uFFFF','Y\uFFFF')).tipo_attivazione_fisso,null);
  assert.equal(fixedActivationFields(section('N\uFFFF','N\uFFFF')).tipo_attivazione_fisso,null);
  assert.deepEqual(fixedActivationFields(section('','')),{});
  assert.deepEqual(fixedActivationFields('Numero di telefono: 0123456789\nCodice Migrazione: ABC'),{});
  assert.equal(fixedActivationFields(section('Y\uFFFF','N\uFFFF')+'\n'+section('N\uFFFF','Y\uFFFF')).tipo_attivazione_fisso,null);
});
test('PDF sintetico completo recupera la casella portabilita anche se il testo e scritto fuori ordine',async()=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage();
  page.drawText('[X] Sul Numero di Telefono: 0123456789',{x:30,y:660,size:10,font});
  page.drawText('Linea telefonica su cui attivare il servizio',{x:30,y:700,size:10,font});
  page.drawText('[ ] Su una nuova linea telefonica',{x:30,y:680,size:10,font});
  page.drawText('Codice Migrazione: ABC',{x:30,y:640,size:10,font});
  const fields=await readPdfFields(await pdf.save());
  assert.equal(fields.tipo_attivazione_fisso,'Portabilita');assert.equal(fields.portabilita,undefined);
});

function fixture(auto='Nuova Attivazione'){
  const a=source.indexOf(' function maybeSelectFixedActivation()'),b=source.indexOf(' // Scegli Si/No',a);
  const root={dataset:{pdaFixedActivationAuto:auto,pdaFixedActivationManual:'false'}};
  const refs={tipoAttivazione:{value:auto==='Portabilita'?'Nuova Attivazione':'Portabilita'},offerta:{value:'offer'}};
  const runtimeState={pdaRevision:1,editingTempId:null};let decide,questions=0,renders=0,saves=0;
  const ctx={refs,runtimeState,document:{getElementById:()=>root},isCategory:(a,b)=>a===b,getCategoriaName:()=> 'Fisso',
    window:{MiroxUI:{confirm(){questions++;return new Promise(resolve=>{decide=resolve;});}}},renderDynamicSections(){renders++;},queueDraftSave(){saves++;}};
  vm.runInNewContext(source.slice(a,b)+';this.select=maybeSelectFixedActivation;this.change=confirmFixedActivationChange;',ctx);
  return {root,refs,runtimeState,select:ctx.select,change:ctx.change,decide:v=>decide(v),get questions(){return questions;},get renders(){return renders;},get saves(){return saves;}};
}
test('tipo Fisso preselezionato, incerto vuoto e correzione manuale rispettata',()=>{
  for(const value of ['Nuova Attivazione','Portabilita','']){
    const ui=fixture(value);ui.select();assert.equal(ui.refs.tipoAttivazione.value,value);
    ui.root.dataset.pdaFixedActivationManual='true';ui.refs.tipoAttivazione.value='manual';ui.select();assert.equal(ui.refs.tipoAttivazione.value,'manual');
  }
});
for(const auto of ['Nuova Attivazione','Portabilita'])for(const accepted of [true,false])
test(`tipo Fisso ${auto}: ${accepted?'conferma modifica':'annulla conserva'}`,async()=>{
  const ui=fixture(auto),selected=ui.refs.tipoAttivazione.value,run=ui.change();
  assert.equal(ui.refs.tipoAttivazione.value,auto);assert.equal(ui.renders,0);assert.equal(ui.saves,0);
  ui.decide(accepted);await run;
  assert.equal(ui.refs.tipoAttivazione.value,accepted?selected:auto);
  assert.equal(ui.root.dataset.pdaFixedActivationManual,accepted?'true':'false');
  assert.equal(ui.renders,accepted?1:0);assert.equal(ui.root.dataset.pdaFixedActivationPending,undefined);
});
test('cambi tardivi o ripetuti non si applicano a nuova PDA/offerta/contratto',async()=>{
  for(const scenario of ['pda','offerta','contratto','reset']){
    const ui=fixture(),pending=ui.change();ui.refs.tipoAttivazione.value='Portabilita';await ui.change();assert.equal(ui.questions,1);
    if(scenario==='pda')ui.runtimeState.pdaRevision++;if(scenario==='offerta')ui.refs.offerta.value='other';
    if(scenario==='contratto')ui.runtimeState.editingTempId='other';if(scenario==='reset')delete ui.root.dataset.pdaFixedActivationPending;
    ui.refs.tipoAttivazione.value='other';ui.decide(true);await pending;assert.equal(ui.refs.tipoAttivazione.value,'other');assert.equal(ui.renders,0);
  }
});
test('stato automatico e manuale conservati al restore, vecchie scelte preservate, nuova PDA pulita',()=>{
  const a=source.indexOf(' function renderPdaFields(data)'),b=source.indexOf(' async function checkPendingCode()',a),root={dataset:{},addEventListener(){}};
  const ctx={refs:{},document:{getElementById:()=>root},getCategoriaName:()=> 'Fisso',queueDraftSave(){},window:{MiroxPda:Pda,MiroxPdaUI:{formHtml:()=>'',bindForm(){},readForm:()=>({})}}};
  vm.runInNewContext(source.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
  ctx.render({pda_tipo_attivazione_auto:'Portabilita',pda_tipo_attivazione_manuale:false});
  const draft=JSON.parse(JSON.stringify(ctx.read()));ctx.render(draft);assert.equal(ctx.read().pda_tipo_attivazione_auto,'Portabilita');
  assert.equal(ctx.read().pda_tipo_attivazione_manuale,false);
  ctx.render({...draft,pda_tipo_attivazione_manuale:true});assert.equal(ctx.read().pda_tipo_attivazione_manuale,true);
  ctx.render({tipo_attivazione:'Nuova Attivazione'});assert.equal(ctx.read().pda_tipo_attivazione_manuale,true);
  ctx.render({});assert.equal(ctx.read().pda_tipo_attivazione_auto,null);assert.equal(ctx.read().pda_tipo_attivazione_manuale,false);
});
