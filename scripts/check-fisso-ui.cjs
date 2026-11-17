'use strict';
// DOM Node reale, senza browser. Dipendenza QA installata soltanto nello scratch.
const {parseHTML}=require('linkedom');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const F=require('../js/fisso-core');
function setup(cluster='Business'){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');let modal,closed=0;
 window.MiroxFisso=F;window.MiroxSafe={escapeHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
 window.MiroxUI={_build(options){
   const foot=window.document.createElement('div');foot.innerHTML=options.footerHtml;
   const current={foot,options,close(){closed++;options.onClose?.();}};modal=current;return current;
 }};
 vm.runInNewContext(fs.readFileSync('js/fisso-ui.js','utf8'),{window,Event:window.Event});
 const root=window.document.getElementById('root');
 root.innerHTML=window.MiroxFissoUI.form({tecnologia_fisso:'FTTC 100',codice_cliente_fisso:'P0001'},cluster,{wizard:true});
 let changes=0;window.MiroxFissoUI.bind(root,{onFixedChange:()=>changes++});
 return {window,root,ui:window.MiroxFissoUI,get modal(){return modal;},get changes(){return changes;},get closed(){return closed;}};
}
(async()=>{
 for(const answer of [true,false]){
  const x=setup();assert.equal(x.ui.read(x.root).professional_box,null);
  assert.equal(x.root.querySelector('[data-fixed-base]').tagName,'INPUT');
  assert.equal(x.root.querySelector('[data-fixed-base]').hasAttribute('readonly'),true);
  const pending=x.ui.askBox(x.root);assert.equal(await x.ui.askBox(x.root),false);
  x.modal.foot.querySelector(answer?'[data-fixed-yes]':'[data-fixed-no]').click();
  assert.equal(await pending,true);const saved=x.ui.read(x.root);
  assert.equal(saved.professional_box,answer);assert.equal(saved.tecnologia_fisso,'FTTC 100'+(answer?' - Professional Box':''));
  assert.equal(saved.codice_cliente_fisso,'P0001');assert.equal(saved.codice_pos_fisso,'9001415852');
  assert.equal(x.changes,1);
 }
 {const x=setup(),pending=x.ui.askBox(x.root);x.modal.close();assert.equal(await pending,false);assert.equal(x.ui.read(x.root).professional_box,null);}
 {const x=setup();let revision=1;const pending=x.ui.askBox(x.root,()=>revision);revision++;x.modal.foot.querySelector('[data-fixed-yes]').click();assert.equal(await pending,false);assert.equal(x.ui.read(x.root).professional_box,null);}
 {const x=setup('Consumer');assert.equal(await x.ui.askBox(x.root),true);assert.equal(x.modal,undefined);assert.equal(x.ui.read(x.root).professional_box,false);}
 // Collegamento reale fra widget PDA, restore e catalogo dell'upload.
 {
  const x=setup(),{window,root}=x;
  const proto=window.HTMLSelectElement.prototype,descriptor=Object.getOwnPropertyDescriptor(proto,'value');
  Object.defineProperty(proto,'value',{configurable:true,get:descriptor.get,set(value){for(const opt of this.querySelectorAll('option')){if(opt.getAttribute('value')===String(value))opt.setAttribute('selected','');else opt.removeAttribute('selected');}}});
  window.MiroxPda=require('../js/vendita-pda-core');
  vm.runInNewContext(fs.readFileSync('js/vendita-pda-ui.js','utf8'),{window,Event:window.Event});
  const html=fs.readFileSync('moduli/upload-contratti-vendita.html','utf8');
  const a=html.indexOf(' function renderPdaFields('),b=html.indexOf(' function setReloadFlags(',a);
  const r=html.indexOf(' function readPdaFields('),s=html.indexOf(' async function checkPendingCode(',r);
  const f=html.indexOf(' function syncFixedOffer('),g=html.indexOf(' function renderDynamicSections(',f);
  root.id='pdaContractFields';
  const refs={cluster:{value:'Business'},codiceCliente:{value:''},offerta:{value:''}};
  const offers=['FTTC','FTTH - Fritz Box'].map((nome_offerta,i)=>({id:String(i),nome_offerta,cluster_cliente:'Business'}));
  const ctx={window,document:window.document,refs,runtimeState:{pdaRevision:1},getCategoriaName:()=> 'Fisso',
   setReloadFlags(){},queueDraftSave(){},renderDynamicSections(){},renderOpzioni(){},isCategory:(a,b)=>a===b,filteredOfferte:()=>offers};
  vm.createContext(ctx);vm.runInContext(html.slice(a,b)+html.slice(r,s)+html.slice(f,g)+';this.render=renderPdaFields;this.read=readPdaFields;this.sync=syncFixedOffer;',ctx);
  ctx.render({tecnologia_fisso:'FTTC 200',professional_box:false,codice_cliente_fisso:'P0001',codice_cliente:'P0001',codice_contratto:'001',pda_lettura:'ai'});
  ctx.sync();assert.equal(refs.offerta.value,'0');
  const saved=ctx.read();assert.equal(saved.tecnologia_fisso,'FTTC 200');assert.equal(saved.codice_contratto,'001');
  ctx.render(saved);assert.equal(ctx.read().tecnologia_fisso,'FTTC 200');
  const pending=x.ui.askBox(root);x.modal.foot.querySelector('[data-fixed-yes]').click();assert.equal(await pending,true);
  ctx.sync();assert.equal(refs.offerta.value,'1');assert.equal(ctx.read().tecnologia_fisso,'FTTC 200 - Professional Box');
  ctx.render({tecnologia_fisso:'FTTH OF-FWCOP',codice_cliente_fisso:'P0002',codice_cliente:'P0002',codice_contratto:'002'});
  assert.equal(ctx.read().professional_box,null);assert.equal(ctx.read().codice_contratto,'002');
 }
 {
  const x=setup(),{window,root}=x;
  root.dataset.verificaFixed='';
  root.innerHTML=x.ui.form({tecnologia_fisso:'FWA Indoor',professional_box:false,codice_cliente_fisso:'P0001'},'Business');
  assert.equal(root.querySelector('[data-fixed-base]').tagName,'SELECT');
  const fields=window.document.createElement('div');fields.innerHTML='<div id="vc_field_offerta"></div><select id="vc_dispositivo_associato"><option value="false" selected>No</option><option value="true">Si</option></select><select id="vc_tipo_acquisto"><option value="VAR">VAR</option></select><div id="vc_section_device"></div><div id="vc_field_imei"></div><div id="vc_field_finanziaria"></div>';
  root.after(fields);
  window.__currentVerificaContratto={id:'fixture',cluster_cliente:'Business',tecnologia_fisso:'FWA Indoor'};
  window.__currentVerificaCataloghi={offerte:[]};
  let category='Fisso';
  const source=fs.readFileSync('moduli/verifica_contratti.html','utf8');const a=source.indexOf('function syncFixedSection()'),b=source.indexOf('// Ripopola la tendina Offerte',a);
  const ctx={window,document:window.document,_isCat:(a,b)=>a.toLowerCase().includes(b.toLowerCase()),_categoriaNomeSelezionato:()=>category,_offertaNomeSelezionata:()=> 'FWA - OUTDOOR',_show(id,visible){const el=window.document.getElementById(id);if(el)el.style.display=visible?'':'none';},repopulateOpzioni(){}};
  vm.createContext(ctx);vm.runInContext(source.slice(a,b)+';applyVisibilityRules();',ctx);
  assert.equal(window.document.getElementById('vc_dispositivo_associato').value,'true');
  assert.equal(window.document.getElementById('vc_tipo_acquisto').disabled,true);
  assert.equal(window.document.getElementById('vc_field_imei').style.display,'');
  assert.equal(window.document.getElementById('vc_field_finanziaria').style.display,'none');
  category='Mobile';vm.runInContext('applyVisibilityRules();',ctx);
  assert.equal(root.hidden,true);assert.equal(window.document.getElementById('vc_field_offerta').hidden,false);
 }
 console.log('DOM Fisso: Si/No, suffisso, annullamento, doppio click, risposta obsoleta, restore/catalogo, FWA Indoor Business e cambio categoria verificati');
})().catch(error=>{console.error(error);process.exitCode=1;});
