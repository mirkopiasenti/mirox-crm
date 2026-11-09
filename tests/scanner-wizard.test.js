'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require.resolve('../moduli/upload-contratti-vendita.html'),'utf8');
function declaration(name,next){return html.slice(html.indexOf(' function '+name+'('),html.indexOf('\n function '+next+'('));}
test('nuova pratica rimuove il documento e invalida la verifica solo dopo conferma',()=>{
 const elements=new Map();let invalidations=0,overlay;const cleared=[];
 const element=key=>{if(!elements.has(key))elements.set(key,{value:'passaporto',checked:true,disabled:true,style:{},classList:{add(){},remove(){}}});return elements.get(key);};
 const context={window:{},document:{getElementById:element},refs:new Proxy({},{get:(_,key)=>element(key)}),state:{cart:{}},runtimeState:{search:{},documentsRevision:0,replacingCartIdentity:true},praticaFiles:{documento_identita:[{}]},showConfirmOverlay:value=>{overlay=value;}};
 for(const name of ['setClusterValue','resetOrigineAutoRilevata','resetContractFields','clearInputFile','renderOfferte','renderOpzioni','renderReload','renderDynamicSections','renderCarrello','updateUploadVisibility','updateStep3ActionsLabels','applyClusterFieldVisibility','goToStep','clearDraftFromSession','setMessage'])context[name]=()=>{};
 context.invalidateIdentitySelection=()=>{invalidations++;};
 context.clearInputFile=input=>cleared.push(input);
 vm.runInNewContext(declaration('startNuovaPraticaFromCart','buildInvioPayload')+';startNuovaPraticaFromCart();',context);
 assert.ok(overlay);assert.equal(invalidations,0);assert.equal(context.praticaFiles.documento_identita.length,1);
 vm.runInNewContext(declaration('resetFullPracticeForm','renderDynamicSections')+';resetFullPracticeForm();',context);
 assert.equal(invalidations,1);assert.equal(context.praticaFiles.documento_identita,null);
 assert.equal(context.runtimeState.replacingCartIdentity,false);assert.equal(context.runtimeState.documentsRevision,1);
 assert.ok(cleared.includes(element('fileDocumentoIdentita')));
});
test('upload porta al carrello dopo la verifica e attende gli allegati obbligatori',async()=>{
 const start=html.indexOf(' async function continueFromDocuments()');
 const source=html.slice(start,html.indexOf(' function currentNeedsPermit()',start));
 const sim=[];let verified=0,adds=0,step=true,settle;
 const context={inDocumentsStep:()=>step,getIdentityFiles:()=>[{}],runtimeState:{documentsRevision:0},
  ensureIdentityUpload:async()=>{verified++;if(settle)await settle;},updateUploadVisibility(){},getCurrentDocumentRequirements:()=>({copia_sim_mnp:true}),
  isCurrentCategoriaPda:()=>false,getInputFiles:()=>sim,refs:{},currentNeedsPermit:()=>false,
  addContrattoToCart:async({current})=>{assert.equal(current(),true);adds++;step=false;},showUserError:error=>assert.fail(error)};
 vm.runInNewContext(source,context);
 await context.continueFromDocuments();
 assert.equal(verified,1);assert.equal(adds,0);
 let release;settle=new Promise(resolve=>{release=resolve;});
 const obsolete=context.continueFromDocuments();
 context.runtimeState.documentsRevision++;
 sim.push({});
 const current=context.continueFromDocuments();
 release();
 await Promise.all([obsolete,current]);
 assert.equal(adds,1);
});
test('allegati oltre limite fermati prima della creazione pratica, limite esatto ammesso',()=>{
 const source=declaration('assertValidFile','formatFileSize'),context={File};vm.runInNewContext(source,context);
 const accepted=new File([new Uint8Array(4*1024*1024)],'documento.pdf',{type:'application/pdf'}),large=new File([new Uint8Array(4*1024*1024+1)],'originale.pdf',{type:'application/pdf'});
 context.assertValidFile(accepted,'Documento');assert.throws(()=>context.assertValidFile(large,'Documento'),/4 MB/);
});
