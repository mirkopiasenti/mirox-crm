'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pda = require('../js/vendita-pda-core');
const options = [
  {id:'none',nome_opzione:'Nessuna opzione',punteggio_gara:0},
  {id:'standard',nome_opzione:'MNP',punteggio_gara:0},
  {id:'promo',nome_opzione:'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali',punteggio_gara:1}
];

test('opzione Mobile distingue nuovo numero, quattro gestori promozionali e altri operatori',()=>{
  assert.equal(Pda.mobileOptionId({portabilita:false},options),'none');
  for(const operator of ['Iliad','ILIAD ITALIA S.p.A.','CoopVoce','Coop Voce','Coop Italia','PosteMobile','Poste Mobile','PostePay S.p.A.','Tiscali Mobile']){
    assert.equal(Pda.mobileOptionId({portabilita:true,operatore_provenienza:operator},options),'promo',operator);
  }
  for(const operator of ['Vodafone','TIM','Fastweb','Very Mobile','ho. Mobile','Kena','Operatore diverso']){
    assert.equal(Pda.mobileOptionId({portabilita:true,operatore_provenienza:operator},options),'standard',operator);
  }
});

test('preselezione usa soltanto opzioni collegate e univoche senza indovinare un gestore mancante',()=>{
  assert.equal(Pda.mobileOptionId({portabilita:null},options),null);
  assert.equal(Pda.mobileOptionId({portabilita:true,operatore_provenienza:''},options),null);
  assert.equal(Pda.mobileOptionId({portabilita:false},[]),null);
  assert.equal(Pda.mobileOptionId({portabilita:false},[options[1],options[2]]),null);
  assert.equal(Pda.mobileOptionId({portabilita:true,operatore_provenienza:'Iliad'},[options[1]],options),null);
  assert.equal(Pda.mobileOptionId({portabilita:false},[options[0],{...options[0],id:'other'}]),null);
  const copy=JSON.stringify(options);Pda.mobileOptionId({portabilita:true,operatore_provenienza:'PosteMobile'},options);
  assert.equal(JSON.stringify(options),copy);
});

test('render opzioni preseleziona ma conserva correzioni e selezione vuota esplicita dell operatore',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const a=source.indexOf(' function renderOpzioni('),b=source.indexOf(' function renderReload(',a);
  const root={dataset:{pdaOptionManual:'false'}},refs={opzione:{value:''},offerta:{value:'offer'}};
  let data={portabilita:true,operatore_provenienza:'Iliad'},category='Mobile',rows=options;
  const ctx={refs,state:{opzioni:options},window:{MiroxPda:Pda},document:{getElementById:()=>root},getCategoriaName:()=>category,isCategory:(a,b)=>a===b,
    filteredOpzioni:()=>rows,readPdaFields:()=>data,optionHtml:(id,label)=>id+label};
  vm.runInNewContext(source.slice(a,b)+';this.render=renderOpzioni;this.suggest=maybeSelectMobileOption;',ctx);
  ctx.render();assert.equal(refs.opzione.value,'promo');
  refs.opzione.value='standard';root.dataset.pdaOptionManual='true';ctx.render();assert.equal(refs.opzione.value,'standard');
  data.operatore_provenienza='PosteMobile';ctx.suggest();assert.equal(refs.opzione.value,'standard');
  refs.opzione.value='';ctx.render();assert.equal(refs.opzione.value,'');
  root.dataset.pdaOptionManual='false';ctx.suggest();assert.equal(refs.opzione.value,'promo');
  data={portabilita:false};ctx.suggest();assert.equal(refs.opzione.value,'none');
  category='Customer Base';refs.opzione.value='standard';ctx.suggest();assert.equal(refs.opzione.value,'standard');
  category='Mobile';rows=[];ctx.render();assert.equal(refs.opzione.value,'');
});

test('override Mobile si ripristina, vecchie scelte si conservano e un nuovo PDA azzera il blocco manuale',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const a=source.indexOf(' function renderPdaFields(data)'),b=source.indexOf(' async function checkPendingCode()',a);
  const root={dataset:{},addEventListener(){}};
  const ctx={document:{getElementById:()=>root},getCategoriaName:()=> 'Mobile',queueDraftSave(){},window:{MiroxPda:Pda,
    MiroxPdaUI:{formHtml:()=>'',bindForm(){},readForm:()=>({})}}};
  vm.runInNewContext(source.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
  ctx.render({pda_lettura:'ai',pda_opzione_manuale:true,opzione_id:'standard'});
  assert.equal(ctx.read().pda_opzione_manuale,true);ctx.render();assert.equal(ctx.read().pda_opzione_manuale,true);
  ctx.render({opzione_id:'promo'});assert.equal(ctx.read().pda_opzione_manuale,true);
  ctx.render({opzione_id:'promo',pda_opzione_manuale:false});assert.equal(ctx.read().pda_opzione_manuale,false);
  ctx.render({});assert.equal(ctx.read().pda_opzione_manuale,false);
});
