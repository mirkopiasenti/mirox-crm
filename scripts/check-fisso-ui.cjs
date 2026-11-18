'use strict';
// DOM Node reale, senza browser. Dipendenza QA installata soltanto nello scratch.
const {parseHTML}=require('linkedom');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const F=require('../js/fisso-core');
function setup(cluster='Business'){
 const {window}=parseHTML('<html><body><div id="root"></div></body></html>');let modal,closed=0;
 window.MiroxFisso=F;window.MiroxPda=require('../js/vendita-pda-core');window.MiroxSafe={escapeHtml:v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
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
  const optionSelect=window.document.createElement('select');root.after(optionSelect);
  const refs={cluster:{value:'Business'},codiceCliente:{value:''},offerta:{value:''},opzione:optionSelect};
  const offers=['FTTC','FTTH - Fritz Box','FWA - OUTDOOR','FWA - Fritz Box'].map((nome_offerta,i)=>({id:String(i),nome_offerta,cluster_cliente:'Business'}));
  const state={opzioni:offers.map(o=>({id:o.id+'-option',nome_opzione:'Opzione '+o.id})),
   offerte_opzioni:offers.map(o=>({offerta_id:o.id,opzione_id:o.id+'-option'}))};
  const source=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
  const ctx={window,document:window.document,refs,runtimeState:{pdaRevision:1},getCategoriaName:()=> 'Fisso',
   state,setReloadFlags(){},queueDraftSave(){},renderDynamicSections(){},maybeSelectMobileOption(){},
   optionHtml:(id,label)=>`<option value="${id}">${label}</option>`,isCategory:(a,b)=>a===b,filteredOfferte:()=>offers};
  vm.createContext(ctx);vm.runInContext(html.slice(a,b)+html.slice(r,s)+html.slice(f,g)
   +source(' function getLinkedOpzioniIdsForOfferta(', ' function getLinkedReloadIdsForOfferta(')
   +source(' function filteredOpzioni(', ' function filteredReload(')
   +source(' function renderOpzioni(', ' function maybeSelectMobileOption(')
   +';this.render=renderPdaFields;this.read=readPdaFields;this.sync=syncFixedOffer;',ctx);
  ctx.render({tecnologia_fisso:'FTTC 200',professional_box:false,codice_cliente_fisso:'P0001',codice_cliente:'P0001',codice_contratto:'001',pda_lettura:'ai'});
  ctx.sync();assert.equal(refs.offerta.value,'0');
  assert.equal(optionSelect.options.length,2);optionSelect.value='0-option';
  ctx.sync();assert.equal(optionSelect.value,'0-option');
  const saved=ctx.read();assert.equal(saved.tecnologia_fisso,'FTTC 200');assert.equal(saved.codice_contratto,'001');
  ctx.render(saved);assert.equal(ctx.read().tecnologia_fisso,'FTTC 200');
  const pending=x.ui.askBox(root);x.modal.foot.querySelector('[data-fixed-yes]').click();assert.equal(await pending,true);
  ctx.sync();assert.equal(refs.offerta.value,'1');assert.equal(ctx.read().tecnologia_fisso,'FTTC 200 - Professional Box');
  assert.equal(optionSelect.options[1].value,'1-option');assert.equal(optionSelect.value,'');
  ctx.render({tecnologia_fisso:'FWA Indoor',professional_box:false,codice_cliente_fisso:'P0001',codice_cliente:'P0001',codice_contratto:'001'});
  ctx.sync();assert.equal(refs.offerta.value,'2');assert.equal(optionSelect.options[1].value,'2-option');
  optionSelect.value='2-option';ctx.sync();assert.equal(optionSelect.value,'2-option');
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
  const clusterStart=source.indexOf('function getContrattoCluster('),clusterEnd=source.indexOf('// Converte un ISO',clusterStart);
  vm.createContext(ctx);vm.runInContext(source.slice(clusterStart,clusterEnd)+source.slice(a,b)+';applyVisibilityRules();',ctx);
  assert.equal(window.document.getElementById('vc_dispositivo_associato').value,'true');
  assert.equal(window.document.getElementById('vc_tipo_acquisto').disabled,true);
  assert.equal(window.document.getElementById('vc_field_imei').style.display,'');
  assert.equal(window.document.getElementById('vc_field_finanziaria').style.display,'none');
  category='Mobile';vm.runInContext('applyVisibilityRules();',ctx);
  assert.equal(root.hidden,true);assert.equal(window.document.getElementById('vc_field_offerta').hidden,false);
 }
 // Dettaglio completo Mobile Business: binding reale, popup Cloud e payload generale.
 {
  const {window}=parseHTML('<html><body></body></html>'),document=window.document,dialogs=[],questions=[];
  // Linkedom non implementa la proprieta checked dei checkbox nativi.
  Object.defineProperty(window.HTMLInputElement.prototype,'checked',{configurable:true,get(){return this.hasAttribute('checked');},set(value){this.toggleAttribute('checked',Boolean(value));}});
  window.MiroxPda=require('../js/vendita-pda-core');window.MiroxFisso=F;
  window.MiroxSafe={escapeHtml:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;')};
  window.MiroxSegnalazioneMobileCore={isSupported:()=>false};
  window.MiroxContrattoNoteUI={mount:()=>({isSaving:()=>false,dispose(){}})};
  window.MiroxUI={confirm(text){return new Promise(resolve=>questions.push({text,resolve}));},_build(options){
   const modal=document.createElement('div');modal.innerHTML='<div data-body>'+options.bodyHtml+'</div><footer>'+options.footerHtml+'</footer>';document.body.append(modal);
   const result={modal,body:modal.querySelector('[data-body]'),foot:modal.querySelector('footer'),close(){modal.remove();options.onClose?.();}};
   dialogs.push(result);return result;
  }};
  vm.runInNewContext(fs.readFileSync('js/vendita-pda-ui.js','utf8'),{window,Event:window.Event});
  const source=fs.readFileSync('moduli/verifica_contratti.html','utf8');
  const slice=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
  const ctx={window,document,renderCodiciCliente:()=>'',toLocalDatetimeInput:()=>'',fmtDateTime:()=>'',renderStatoContratto:()=>'',
   escapeHtml:window.MiroxSafe.escapeHtml,bottoneEliminaContrattoHtml:()=>'',getProfiloCorrenteVC:async()=>null,gestisciVenditaContratto(){},
   collegaCambioStato(){},renderAllegatiPopup(){},syncFixedSection(){},_categoriaNomeSelezionato:()=> 'Mobile',_offertaNomeSelezionata:()=>'',
   _isCat:(a,b)=>a.toLowerCase()===b.toLowerCase(),_show(id,visible){const el=document.getElementById(id);if(el)el.style.display=visible?'':'none';}};
  vm.createContext(ctx);vm.runInContext(slice('function getContrattoCluster(', '// Converte un ISO')
   +slice('function apriPopupDettaglio(', '// VISIBILITÀ DINAMICA DEI CAMPI')
   +slice('function applyVisibilityRules()', '// Ripopola la tendina Offerte')
   +slice('function leggiPayloadDalPopup()', '// CONFERMA VERIFICA')+';this.open=apriPopupDettaglio;this.read=leggiPayloadDalPopup;',ctx);
  const row={id:'fixture',cluster_cliente:'Business',categoria_snapshot:'Mobile',categoria_id:'cat',offerta_id:'offer',professional_cloud:false};
  const opts={categorie:[{id:'cat',nome:'Mobile'}],offerte:[{id:'offer',nome_offerta:'Professional Full'}],opzioni:[],offerteOpzioni:[],reload:[],allegati:[],profili:[],isReadOnly:false};
  ctx.open(row,opts);const main=dialogs[0],flag=main.body.querySelector('#vc_professional_cloud');
  assert.equal(flag.disabled,false);assert.equal(document.getElementById('vc_field_professional_cloud').style.display,'');
  assert.equal(document.getElementById('vc_field_reload_forever').style.display,'none');
  flag.checked=true;flag.dispatchEvent(new window.Event('change',{bubbles:true}));assert.equal(flag.checked,false);
  questions.shift().resolve(true);await new Promise(resolve=>setImmediate(resolve));
  dialogs[1].foot.querySelector('[data-cloud-stop]').click();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(flag.checked,true);assert.equal(document.getElementById('vc_professional_cloud_gestione').value,'Richiedi disattivazione');
  assert.equal(document.getElementById('vc_field_professional_cloud_gestione').style.display,'');
  const payload=ctx.read().contratto;assert.equal(payload.professional_cloud,true);assert.equal(payload.professional_cloud_gestione,'Richiedi disattivazione');
  flag.checked=false;flag.dispatchEvent(new window.Event('change',{bubbles:true}));questions.shift().resolve(false);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(flag.checked,true);main.close();
  ctx.open({...row,professional_cloud:null},opts);assert.equal(document.getElementById('vc_professional_cloud').indeterminate,true);
  assert.equal(ctx.read().contratto.professional_cloud,null);window.__currentVerificaModal.close();
  const count=dialogs.length;ctx.open({...row,professional_cloud:true,professional_cloud_gestione:'Mantieni attiva'},{...opts,isReadOnly:true});
  assert.equal(document.getElementById('vc_professional_cloud').disabled,true);assert.equal(dialogs.length,count+1);window.__currentVerificaModal.close();
 }
 console.log('DOM Fisso/Cloud: Si/No, suffisso, annulla, risposte obsolete, restore/catalogo/opzioni OCR-Box, FWA Indoor Business, dettaglio Cloud completo/popup/payload/NULL/readonly verificati');
})().catch(error=>{console.error(error);process.exitCode=1;});
