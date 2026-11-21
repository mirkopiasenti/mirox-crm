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
  ensureIdentityUpload:async()=>{verified++;if(settle)await settle;},updateUploadVisibility(){},getCurrentDocumentRequirements:()=>({documento_identita:true,copia_sim_mnp:true}),
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
test('upload Luce & Gas attende solo la bolletta',async()=>{
 const start=html.indexOf(' async function continueFromDocuments()');
 const source=html.slice(start,html.indexOf(' function currentNeedsPermit()',start));
 const bills=[];let adds=0;
 const context={inDocumentsStep:()=>true,getIdentityFiles:()=>[],runtimeState:{documentsRevision:0},
  ensureIdentityUpload:async()=>assert.fail('Controllo identità richiesto per Energia'),updateUploadVisibility(){},
  getCurrentDocumentRequirements:()=>({documento_identita:false,copia_bolletta:true}),
  isCurrentCategoriaPda:()=>false,getInputFiles:()=>bills,refs:{},currentNeedsPermit:()=>false,
  addContrattoToCart:async()=>{adds++;},showUserError:error=>assert.fail(error)};
 vm.runInNewContext(source,context);
 await context.continueFromDocuments();
 assert.equal(adds,0);
 bills.push({});
 await context.continueFromDocuments();
 assert.equal(adds,1);
});
test('Invia pratica carica la bolletta senza ricevuta Energia e il permesso nel carrello misto VAR extra UE', async () => {
 const source = html.slice(html.indexOf(' function isEnergyCartItem('), html.indexOf(" refs.cluster.addEventListener('change'"));
 const pdf = new File(['%PDF-1.7'], 'prova.pdf', { type: 'application/pdf' });
 for (const mixed of [false, true]) {
  const energy = { temp_id: 'energia', categoria_nome: 'Energia', files: { bolletta: [pdf] } };
  const mobile = { temp_id: 'mobile', categoria_nome: 'Mobile', dispositivo_associato: true, tipo_acquisto: 'VAR',
   files: { permesso_soggiorno: [pdf] } };
  const contracts = mixed ? [energy, mobile] : [energy];
  const identity = mixed ? { result: { cittadinanza: 'extra_ue' } } : null;
  const calls = [];
  const noop = () => {};
  const context = {
   File, state: { cart: { contratti: contracts } }, uiState: { view: 'cart' }, praticaFiles: {},
   runtimeState: {}, refs: { btnInviaPratica: {}, btnOpenCarrello: {} },
   window: {
    MiroxEnergia: require('../js/energia-core'),
    MiroxIdentitaCore: require('../js/identita-upload-core'),
    MiroxIdentitaUpload: { get: () => identity },
    setTimeout: noop
   },
   async ensureIdentityUpload() { calls.push('identità'); return identity; },
   getCartIdentityFiles: () => [pdf],
   async ensureConsensoPrivacy() { calls.push('consenso'); return { consenso_id: 'consenso' }; },
   async fetchJsonOrTechnicalError(url, options) {
    const payload = JSON.parse(options.body);
    assert.equal(url, '/.netlify/functions/crea-vendita-pratica-carrello');
    calls.push(payload.action || 'create');
    if (payload.action) return { finalized: true };
    assert.equal(payload.pratica.consenso_id, 'consenso');
    return { pratica_id: 'pratica', contratti: contracts.map(item => ({ temp_id: item.temp_id,
     contratto_id: item.temp_id, categoria_snapshot: item.categoria_nome })) };
   },
   async uploadDocumentoOrTechnicalError({ file, tipo_documento, contratto_id }) {
    assert.equal(file, pdf);
    calls.push(tipo_documento + ':' + contratto_id);
    return { success: true };
   },
   getProgressiveDocumentFileName: () => 'copia_bolletta.pdf',
   assertValidFile: noop, setMessage: noop, showLoadingOverlay: noop, hideLoadingOverlay: noop,
   updateLoadingOverlay: noop, markTechnicalChecking: noop, markTechnicalConnected: noop,
   clearDraftFromSession: noop, resetFullPracticeForm: noop, goToSalesHome: noop, setOverlayActions: noop,
   setResult(result) { assert.equal(result.success, true, result.error); },
   showSuccessOverlay() { calls.push('successo'); },
   isTechnicalError: () => false
  };
  vm.runInNewContext(source + '\nthis.submit = inviaPratica;', context);
  context.buildInvioPayload = () => ({ cliente: { cluster: 'Consumer' }, contratti: contracts });
  await context.submit();
  assert.deepEqual(calls, mixed
   ? ['identità', 'consenso', 'create', 'documento_identita:mobile', 'copia_bolletta:energia', 'permesso_soggiorno:mobile', 'finalize', 'successo']
   : ['consenso', 'create', 'copia_bolletta:energia', 'finalize', 'successo']);
 }
});
test('allegati oltre limite fermati prima della creazione pratica, limite esatto ammesso',()=>{
 const source=declaration('assertValidFile','formatFileSize'),context={File};vm.runInNewContext(source,context);
 const accepted=new File([new Uint8Array(4*1024*1024)],'documento.pdf',{type:'application/pdf'}),large=new File([new Uint8Array(4*1024*1024+1)],'originale.pdf',{type:'application/pdf'});
 context.assertValidFile(accepted,'Documento');assert.throws(()=>context.assertValidFile(large,'Documento'),/4 MB/);
});
