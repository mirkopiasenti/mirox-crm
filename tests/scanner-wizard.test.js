'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../moduli/upload-contratti-vendita.html'),'utf8');
function declaration(name,next){return html.slice(html.indexOf(' function '+name+'('),html.indexOf('\n function '+next+'('));}
test('nuova pratica ripristina CIE/QR e tessera facoltativa, annullare la conferma non invalida nulla',()=>{
 const elements=new Map();let invalidations=0,overlay;
 const element=key=>{if(!elements.has(key))elements.set(key,{value:'passaporto',checked:true,disabled:true,style:{},classList:{add(){},remove(){}}});return elements.get(key);};
 const context={scannerChoice:'pdf',window:{MiroxScannerUI:{invalidate(){invalidations++;}},MiroxIdentitaUpload:{invalidate(){}}},document:{getElementById:element},refs:new Proxy({},{get:(_,key)=>element(key)}),state:{cart:{}},runtimeState:{search:{}},praticaFiles:{},showConfirmOverlay:value=>{overlay=value;}};
 for(const name of ['setClusterValue','resetOrigineAutoRilevata','resetContractFields','clearInputFile','renderOfferte','renderOpzioni','renderReload','renderDynamicSections','renderCarrello','updateUploadVisibility','updateStep3ActionsLabels','applyClusterFieldVisibility','goToStep','clearDraftFromSession','setMessage'])context[name]=()=>{};
 vm.runInNewContext(declaration('startNuovaPraticaFromCart','buildInvioPayload')+';startNuovaPraticaFromCart();',context);
 assert.ok(overlay);assert.equal(invalidations,0);assert.equal(context.scannerChoice,'pdf');
 vm.runInNewContext(declaration('resetFullPracticeForm','renderDynamicSections')+';resetFullPracticeForm();',context);
 assert.equal(context.scannerChoice,null);assert.equal(invalidations,1);assert.equal(element('scannerTipoDocumento').value,'cie');assert.equal(element('scannerTessera').checked,false);assert.equal(element('scannerTessera').disabled,false);
});
