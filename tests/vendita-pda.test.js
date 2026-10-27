'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Pda = require('../js/vendita-pda-core');
const serverPda = require('../netlify/functions/_lib/pda-contract');
const { normalizeResult } = require('../netlify/functions/ocr-pda')._test;
const mobile = { codice_contratto: ' 00ab 123 ', costo_offerta_mensile: '9,99',
  portabilita: false, numero_telefono: '+39 333 1234567' };
const id = '11111111-1111-4111-8111-111111111111';

test('identificatori PDA: conserva lettere, zeri e separatori; non accetta markup o numeri convertiti', () => {
  assert.equal(Pda.code(' 00ab 123/4-5 '), '00AB123/4-5');
  for (const bad of [null, '', 1234, 'a'.repeat(81), '<img>', '123;drop']) assert.equal(Pda.code(bad), null);
  for (const bad of ['9.999', '-1', '9,99 EUR', '1e2', 'Infinity', '1.000,00']) assert.equal(Pda.money(bad), null);
  assert.equal(Pda.money('0,00'), 0);
  assert.equal(Pda.phone('0039 333 123456'), '333123456');
  assert.equal(Pda.phone('393331234567'), '3331234567');
  assert.equal(Pda.phone('39333123456'), '333123456');
  assert.equal(Pda.phone('3931234567'), '3931234567');
  assert.equal(Pda.phone('3933312345678'), null);
});

test('Mobile nuovo numero e portabilita mantengono numerazioni distinte dal contatto OTP', () => {
  assert.deepEqual(Pda.validate(mobile, 'Mobile'), { codice_contratto: '00AB123',
    costo_offerta_mensile: 9.99, portabilita: false, numero_telefono: '3331234567',
    numero_provvisorio: null, numero_mnp: null, operatore_provenienza: null });
  const mnp = { ...mobile, portabilita: true, numero_telefono: '3491234567',
    numero_mnp: '3491234567', numero_provvisorio: '3931234567', operatore_provenienza: ' Vodafone ' };
  assert.equal(Pda.validate(mnp, 'Mobile').operatore_provenienza, 'Vodafone');
  for (const key of ['numero_mnp', 'numero_provvisorio', 'operatore_provenienza', 'costo_offerta_mensile']) {
    assert.throws(() => Pda.validate({ ...mnp, [key]: null }, 'Mobile'));
  }
  assert.throws(() => Pda.validate({ ...mnp, numero_mnp: '3481234567' }, 'Mobile'), /coerente/);
  assert.throws(() => Pda.validate({ ...mobile, portabilita: null }, 'Mobile'), /Seleziona/);
});

test('Customer Base e Fisso richiedono solo codice; storico vuoto modificabile senza backfill', () => {
  for (const category of ['Customer Base', 'Fisso']) {
    const result = Pda.validate(mobile, category);
    assert.equal(result.codice_contratto, '00AB123');
    assert.ok(Pda.FIELDS.slice(1).every(k => result[k] === null));
    assert.throws(() => Pda.validate({}, category), /Codice/);
  }
  assert.equal(Pda.validate({}, 'Mobile', { requireCode: false, allowLegacy: true }).codice_contratto, null);
  assert.throws(() => Pda.validate({}, 'Mobile', { allowLegacy: true }), /Codice/);
  assert.equal(Pda.validate({}, 'Energia').codice_contratto, null);
});

test('OCR mantiene contatto firma, SIM, provvisorio e MNP separati e non inventa costo mancante', () => {
  const result = normalizeResult({ cellulare: '+393351234567', codice_contratto: '0012 abc',
    numero_sim: '+393931234567', portabilita: true, numero_mnp: '+393491234567',
    operatore_provenienza: 'Vodafone', costo_offerta_mensile: '9,99' });
  assert.equal(result.cellulare, '3351234567');
  assert.equal(result.numero_telefono, '3491234567');
  assert.equal(result.numero_provvisorio, '3931234567');
  assert.equal(result.costo_offerta_mensile, 9.99);
  const partial = normalizeResult({ numero_sim: '3931234567', portabilita: false });
  assert.equal(partial.numero_telefono, '3931234567');
  assert.equal(partial.cellulare, null);
  assert.equal(partial.numero_mnp, null);
  assert.equal(partial.costo_offerta_mensile, null);
  const ambiguous = normalizeResult({ numero_sim: '3931234567', portabilita: true });
  assert.equal(ambiguous.numero_telefono, null);
  assert.equal(ambiguous.numero_provvisorio, '3931234567');
});

function duplicateDb(rows, failure) {
  return { from(table) {
    assert.equal(table, 'vendita_contratti');
    let code, exclude;
    const q = { select() { return q; }, eq(k,v) { assert.equal(k,'codice_contratto'); code=v; return q; },
      neq(k,v) { assert.equal(k,'id'); exclude=v; return q; },
      async limit() { return failure ? { error: new Error('DB non disponibile') }
        : { data: rows.filter(r => r.codice_contratto === code && r.id !== exclude).slice(0,1) }; } };
    return q;
  } };
}
test('duplicati globali: KO/storico/altro negozio restano bloccanti, errori DB non significano assenza', async () => {
  const existing = { id, codice_contratto:'00AB123', stato:'KO', codice_rivenditore:'altro', data_contratto:'2020-01-01' };
  const db=duplicateDb([existing]);
  assert.equal((await serverPda.findDuplicate(db,'00ab 123')).id,id);
  await assert.rejects(serverPda.assertAvailable(db,'00ab123'), e => e.statusCode===409 && e.error_code==='contratto_duplicato');
  assert.equal(await serverPda.findDuplicate(db,'00ab123',id),null);
  await assert.rejects(serverPda.findDuplicate(duplicateDb([],true),'ABC'),/DB non disponibile/);
  assert.equal(serverPda.isDuplicateViolation({code:'23505',message:'index vendita_contratti_codice_pda_unique'}),true);
  assert.equal(serverPda.isDuplicateViolation({code:'23505',message:'altro indice'}),false);
});

function loadHandler(file, db) {
  const module = { exports: {} };
  const filename=path.join(__dirname,'../netlify/functions/',file);
  const nativeRequire=require('node:module').createRequire(filename);
  vm.runInNewContext(fs.readFileSync(filename,'utf8'), { module, exports:module.exports, Buffer, Date, Intl,
    console:{log(){},warn(){},error(){}},process:{env:{SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'}},
    require(name) {
      if(name==='@supabase/supabase-js') return {createClient:()=>db};
      if(name==='./_lib/require-auth') return {requireAuth:async()=>({ok:true,profilo:{id,ruolo:'operatore'}}),getAdminClient:()=>db};
      return nativeRequire(name);
    }
  },{filename});
  return module.exports;
}
function event(body) { return {httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}; }

test('create blocca codice mancante/duplicati nel carrello prima di qualsiasi scrittura',async()=>{
  for(const scenario of ['missing','cart','stored','db-failure']) {
    let writes=0;
    const db=duplicateDb(scenario==='stored'?[{id,codice_contratto:'00AB123'}]:[],scenario==='db-failure');
    const orig=db.from;
    db.from=table=>{
      if(table==='vendita_categorie')return {select(){return this;},async in(){return {data:[{id:'cat',nome:'Customer Base'}]};}};
      if(table==='vendita_contratti')return orig(table);
      writes++;throw new Error('Scrittura prematura '+table);
    };
    const api=loadHandler('crea-vendita-pratica-carrello.js',db);
    const c={categoria_id:'cat',offerta_id:'offer',codice_contratto:scenario==='missing'?null:'00AB123'};
    const response=await api.handler(event({cliente:{cf_piva:'RSSMRA80A01H501U',ragione_sociale:'Cliente test',
      cluster:'Consumer',cellulare:'3331234567',email:'test@example.invalid'},contratti:scenario==='cart'?[c,c]:[c]}));
    assert.equal(response.statusCode,scenario==='missing'?400:scenario==='db-failure'?500:409,scenario);
    assert.equal(writes,0);
  }
});

test('editor PDA disponibile agli operatori senza alterare punteggi/stato/anagrafica',async()=>{
  const current={id,categoria_snapshot:'Customer Base',codice_contratto:'OLD',stato_controllo:'controllato',punteggio_gara_totale:12};
  let patch;
  const db={from(table){assert.equal(table,'vendita_contratti');let update;
    const q={select(){return q;},eq(){return q;},neq(){return q;},async limit(){return {data:[]};},
      async maybeSingle(){return {data:update ? {...current,...update} : current};},update(v){update=v;patch=v;return q;},async single(){return {data:{...current,...update}};}};return q;}};
  const api=loadHandler('gestisci-vendita-contratto.js',db);
  const response=await api.handler(event({action:'update_pda',contratto_id:id,contratto:{codice_contratto:' 00new ',stato_controllo:'da_controllare',punteggio_gara_totale:999}}));
  assert.equal(response.statusCode,200);
  const data=JSON.parse(response.body).contratto;
  assert.equal(data.codice_contratto,'00NEW');assert.equal(data.stato_controllo,'controllato');assert.equal(data.punteggio_gara_totale,12);
  assert.equal(patch.stato_controllo,undefined);assert.equal(patch.punteggio_gara_totale,undefined);
});

test('editor PDA respinge collisione concorrente tramite vincolo DB senza successo apparente',async()=>{
  const db={from(){let updating=false;const q={select(){return q;},eq(){return q;},neq(){return q;},async limit(){return {data:[]};},
    async maybeSingle(){return updating ? {error:{code:'23505',message:'vendita_contratti_codice_pda_unique'}} : {data:{id,categoria_snapshot:'Fisso',codice_contratto:'OLD'}};},update(){updating=true;return q;}};return q;}};
  const api=loadHandler('gestisci-vendita-contratto.js',db);
  const response=await api.handler(event({action:'update_pda',contratto_id:id,contratto:{codice_contratto:'NEW'}}));
  assert.equal(response.statusCode,409);assert.equal(JSON.parse(response.body).error_code,'contratto_duplicato');
});

function pdaWizardFixture({ completed = false, duplicate = false, manual = false, stale = false, differentClient = false, incomplete = false, ocrFailure = false, missingCode = false, customerCode = null, cancelCustomer = false, staleCustomer = false } = {}) {
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const start=source.indexOf(' async function processPda(useAi)');
  const end=source.indexOf(" refs.btnPdaAnalyzeAi.addEventListener",start);
  const runtimeState={anagraficaCompleted:completed,pdaRevision:1,processingPda:false,editingTempId:null};
  const calls=[]; let contact='3350000000', form;
  const refs={filePda:{files:[{}]},btnPdaAnalyzeAi:{},btnPdaSkipAi:{},codiceRivenditore:{},cfPiva:{value:'RSSMRA80A01H501U'}};
  const response={...mobile,cellulare:'3359999999',codice_contratto:'NEW',cf_piva:differentClient?'VRDLGI80A01H501U':null,codice_rivenditore:'9000822241',codice_cliente:customerCode};
  if(incomplete)response.numero_telefono=null;
  if(missingCode)response.codice_contratto=null;
  const ctx={runtimeState,refs,window:{MiroxPda:Pda,MiroxPdaUI:{
    async askCode(){calls.push('ask-code');return 'MANUAL';},
    async askCustomerCode(){calls.push('ask-customer-code');if(staleCustomer)runtimeState.pdaRevision++;return cancelCustomer?null:'P0001234567';},
    async askContact(){calls.push('ask-contact');return '3351234567';},
    async checkCode(code){calls.push('check:'+code);return !duplicate;}
  },MiroxUI:{async alert(){calls.push('alert');}}},state:{cart:{contratti:[]}},CODICE_RIVENDITORE_DEFAULT:'9001415852',
    normalizeCfPiva:v=>String(v||'').trim().toUpperCase(),getCategoriaName:()=> 'Mobile',isCategory:(a,b)=>a===b,showLoadingOverlay(){},hideLoadingOverlay(){},
    async chiamaOcr(){calls.push('ocr');if(ocrFailure)throw new Error('OCR non disponibile');if(stale)runtimeState.pdaRevision++;return response;},
    async uploadPdaStaging(){calls.push('upload');return {storage_path:'temp/test.pdf'};},
    applyOcrToAnagrafica(data){calls.push('anagrafica');contact=data.cellulare;},
    renderPdaFields(data){form=data;},goToStep(step){calls.push('step:'+step);},queueDraftSave(){},showUserError(msg){throw new Error(msg);}};
  vm.runInNewContext(source.slice(start,end)+'\nthis.processPda=processPda;',ctx);
  return {async run(){await ctx.processPda(!manual);},calls,runtimeState,get contact(){return contact;},get form(){return form;},get dealer(){return refs.codiceRivenditore.value;}};
}
test('wizard multi-contratto analizza ogni PDA preservando il contatto della prima pratica',async()=>{
  const first=pdaWizardFixture();await first.run();assert.equal(first.contact,'3359999999');assert.equal(first.dealer,'9001415852');assert.ok(first.calls.includes('step:2'));
  const second=pdaWizardFixture({completed:true});await second.run();assert.equal(second.contact,'3350000000');
  assert.ok(second.calls.includes('ocr'));assert.ok(second.calls.includes('step:3'));assert.equal(second.form.codice_contratto,'NEW');assert.equal(second.form.pda_lettura,'ai');
  assert.ok(!second.calls.includes('ask-contact'));assert.ok(!second.calls.includes('anagrafica'));
});
test('wizard manuale chiede codice e controlla duplicati prima di contatto e upload',async()=>{
  const ui=pdaWizardFixture({manual:true});await ui.run();
  assert.deepEqual(ui.calls,['ask-code','check:MANUAL','ask-customer-code','ask-contact','upload','anagrafica','step:2']);assert.equal(ui.form.pda_lettura,'manuale');
  const duplicate=pdaWizardFixture({manual:true,duplicate:true});await duplicate.run();
  assert.deepEqual(duplicate.calls,['ask-code','check:MANUAL']);assert.equal(duplicate.runtimeState.pendingPda,undefined);
});
test('wizard ignora risposte OCR tardive dopo la sostituzione del documento',async()=>{
  const ui=pdaWizardFixture({stale:true});await ui.run();
  assert.deepEqual(ui.calls,['ocr']);assert.equal(ui.form,undefined);assert.equal(ui.contact,'3350000000');
  assert.equal(ui.runtimeState.processingPda,false);
});

test('editor PDA rileva dati obsoleti e non sovrascrive le modifiche di un altro operatore',async()=>{
  let writes=0;
  const db={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{id,categoria_snapshot:'Fisso',codice_contratto:'CURRENT',updated_at:'2026-10-27T10:00:00Z'}};},update(){writes++;return q;}};return q;}};
  const api=loadHandler('gestisci-vendita-contratto.js',db);
  const response=await api.handler(event({action:'update_pda',contratto_id:id,expected_updated_at:'2026-10-26T10:00:00Z',contratto:{codice_contratto:'STALE'}}));
  assert.equal(response.statusCode,409);assert.equal(writes,0);
  assert.match(JSON.parse(response.body).error,/altro operatore/);
});

for (const failRollback of [false,true]) test(`collisione durante INSERT: rollback bozza ${failRollback?'fallito segnalato':'riuscito'}`,async()=>{
  let inserted=0,deleted=0,savedCode;
  const db={from(table){let operation='select',payload;
    function result(single=false){
      if(table==='vendita_categorie')return {data:[{id:'cat',nome:'Mobile'}]};
      if(table==='vendita_offerte')return {data:[{id:'offer',categoria_id:'cat',nome_offerta:'SIM prova',cluster_cliente:'Consumer',punteggio_gara:1,punteggio_extra_gara:0}]};
      if(table==='anagrafica')return {data:single?{id}:[]};
      if(table==='vendita_consensi_privacy')return {data:single?{id}:[]};
      if(table==='vendita_pratiche'){
        if(operation==='insert'){inserted++;return {data:{id,stato_pratica:'bozza'}};}
        if(operation==='delete'){deleted++;return failRollback?{error:new Error('DB non disponibile durante rollback')}:{data:{id}};}
        return {data:single?{id}:[]};
      }
      if(table==='vendita_contratti' && operation==='insert'){savedCode=payload.codice_contratto;return {error:{code:'23505',message:'vendita_contratti_codice_pda_unique'}};}
      return {data:[]};
    }
    const q={select(){return q;},eq(){return q;},in(){return q;},ilike(){return q;},is(){return q;},gt(){return q;},order(){return q;},limit(){return q;},
      insert(v){operation='insert';payload=v;return q;},update(v){operation='update';payload=v;return q;},delete(){operation='delete';return q;},
      async single(){return result(true);},async maybeSingle(){return result(true);},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};
    return q;
  }};
  const api=loadHandler('crea-vendita-pratica-carrello.js',db);
  const response=await api.handler(event({cliente:{cf_piva:'RSSMRA80A01H501U',ragione_sociale:'Cliente prova',cluster:'Consumer',cellulare:'3350000000',email:'test@example.invalid'},
    contratti:[{...mobile,categoria_id:'cat',offerta_id:'offer',tipo_firma:'elettronica'}]}));
  assert.equal(response.statusCode,409,response.body);assert.equal(inserted,1);assert.equal(deleted,1);assert.equal(savedCode,'00AB123');
  const body=JSON.parse(response.body);assert.equal(body.rollback_failed,failRollback);
  if(failRollback)assert.match(body.error,/Ripristino.*incompleto/);
});

test('Turista mostra i nuovi dati PDA senza esporre scelte catalogo o saltare la conferma Mobile',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const start=source.indexOf(' function renderWizardLayout()'),end=source.indexOf(' function renderFirmaSelection()',start);
  const hidden={};
  const element=name=>({classList:{toggle(k,v){if(k==='hidden')hidden[name]=v;},add(){}},querySelector(){return element('catalogo');}});
  const refs=new Proxy({cluster:{value:'Turista'}},{get:(o,k)=>o[k] ||= element(k)});
  const uiState={view:'wizard',step:3};
  vm.runInNewContext(source.slice(start,end)+'\nrenderWizardLayout();',{refs,uiState,
    runtimeState:{anagraficaCompleted:true},isTuristaCluster:()=>true,isCurrentCategoriaPda:()=>true,
    renderDynamicSections(){},applyClusterFieldVisibility(){},renderStepIndicator(){},updateUploadVisibility(){}});
  assert.equal(uiState.step,3);assert.equal(hidden.sectionContratto,false);assert.equal(hidden.actionsContratto,false);assert.equal(hidden.catalogo,true);
});

test('un secondo PDA di altro cliente viene fermato prima di upload o cambio anagrafica',async()=>{
  const ui=pdaWizardFixture({completed:true,differentClient:true});
  await assert.rejects(ui.run(),/cliente diverso/);
  assert.deepEqual(ui.calls,['ocr']);assert.equal(ui.contact,'3350000000');
});

test('editor impedisce di cancellare in blocco i dati Mobile gia registrati',async()=>{
  let writes=0;
  const db={from(){const q={select(){return q;},eq(){return q;},async maybeSingle(){return {data:{...Pda.validate(mobile,'Mobile'),id,categoria_snapshot:'Mobile'}};},update(){writes++;return q;}};return q;}};
  const api=loadHandler('gestisci-vendita-contratto.js',db);
  const empty=Object.fromEntries(Pda.FIELDS.slice(1).map(k=>[k,null]));
  const response=await api.handler(event({action:'update_pda',contratto_id:id,contratto:empty}));
  assert.equal(response.statusCode,400);assert.match(JSON.parse(response.body).error,/Costo mensile/);assert.equal(writes,0);
});

test('duplicato al submit chiude il loader e non raccoglie consenso o crea bozze',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const start=source.indexOf(' async function inviaPratica()'),end=source.indexOf(" refs.cluster.addEventListener",start);
  const runtimeState={isSubmitting:false},refs={btnInviaPratica:{},btnAddToCart:{}};
  let overlay=false,privacy=0;
  const ctx={runtimeState,refs,state:{cart:{contratti:[{temp_id:'one',codice_contratto:'DUP'}]}},
    window:{MiroxPdaUI:{async checkCode(){assert.equal(overlay,false);return false;}}},
    showLoadingOverlay(){overlay=true;},hideLoadingOverlay(){overlay=false;},
    buildInvioPayload(){return {cliente:{},contratti:[]};},async ensureConsensoPrivacy(){privacy++;}};
  vm.runInNewContext(source.slice(start,end)+'\nthis.submit=inviaPratica;',ctx);
  await ctx.submit();assert.equal(overlay,false);assert.equal(privacy,0);
  assert.equal(runtimeState.isSubmitting,false);assert.equal(refs.btnInviaPratica.disabled,false);
});

test('editor non permette di annullare un salvataggio mentre la richiesta e in corso',async()=>{
  const callbacks={},fields=[{dataset:{pdaField:'codice_contratto'},value:'NEW'}];
  let resolveHttp,closed=false,options;
  const cancel={disabled:false,addEventListener(type,fn){callbacks.cancel=fn;}},save={disabled:false,addEventListener(type,fn){callbacks.save=fn;}};
  const http=new Promise(resolve=>{resolveHttp=resolve;});
  const modal={body:{querySelectorAll(){return fields;},querySelector(){return null;}},
    foot:{querySelector(selector){return selector.includes('cancel')?cancel:save;}},close(){closed=true;options.onClose();}};
  const window={MiroxPda:Pda,MiroxSafe:{escapeHtml:v=>v,isUuid:()=>true},MiroxApi:{fetch:()=>http},
    MiroxUI:{_build(opts){options=opts;return modal;}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/vendita-pda-ui.js'),'utf8'),{window});
  const result=window.MiroxPdaUI.edit({id,categoria_snapshot:'Fisso',codice_contratto:'OLD'});
  const saving=callbacks.save();
  assert.equal(options.closable,false);assert.equal(save.disabled,true);assert.equal(cancel.disabled,true);assert.equal(closed,false);
  resolveHttp({ok:true,json:async()=>({success:true,contratto:{id,codice_contratto:'NEW'}})});
  await saving;assert.equal((await result).codice_contratto,'NEW');assert.equal(closed,true);
});

for(const [file,endMarker] of [['verifica_contratti.html','  // Trick:'],['controllo_fissi.html','  // FIX scroll:']])
test(`aprire dati PDA da ${file} non scarta le altre modifiche non salvate`,async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli',file),'utf8');
  const start=source.indexOf('  let pdaOtherFieldsDirty = false;'),end=source.indexOf(endMarker,start);
  assert.ok(start>=0&&end>start);
  const events={};let edit,closed=false,toasts=0;
  const m={body:{addEventListener(name,fn){events[name]=fn;},querySelector(){return {addEventListener(name,fn){edit=fn;}};}},close(){closed=true;}};
  const ui={toast(){toasts++;}};
  vm.runInNewContext(source.slice(start,end),{m,window:{MiroxUI:ui},MiroxUI:ui});
  events.input();await edit();assert.equal(closed,false);assert.equal(toasts,1);
});

for (const failOperator of [false,true]) test(`duplicato senza FK operatore usa lookup esplicito (${failOperator?'nome indisponibile':'nome disponibile'})`,async()=>{
  const row={id,codice_contratto:'EXISTING',operatore_id:'operator'};
  const db={from(table){const q={select(columns){if(table==='vendita_contratti')assert.ok(!columns.includes('('));return q;},eq(){return q;},
    async limit(){return {data:[row]};},async maybeSingle(){assert.equal(table,'profili');return failOperator?{error:new Error('profilo non leggibile')}:{data:{nome:'Operatore prova'}};}};return q;}};
  const result=await serverPda.findDuplicate(db,'EXISTING');assert.equal(result.id,id);
  assert.equal(result.operatore.nome,failOperator?'Operatore non disponibile':'Operatore prova');
  await assert.rejects(serverPda.assertAvailable(db,'EXISTING'),e=>e.statusCode===409);
});

for(const scenario of ['lookup-tardivo','candidati-tardivi','corrente']) test(`reinserimento asincrono: ${scenario}`,async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const a=source.indexOf(' async function checkAndOfferReinserimento()'),b=source.indexOf(' function refreshUploadBox',a);
  const runtimeState={anagraficaId:scenario==='lookup-tardivo'?null:'first',pdaRevision:1,editingTempId:null,pendingReinserimento:{contratto_id:'nuovo'}};
  const uiState={view:'wizard',step:3},refs={cfPiva:{value:'FIRST'}};let resolvePending,shown=0;
  const pending=new Promise(resolve=>{resolvePending=resolve;});
  const ctx={runtimeState,uiState,refs,console:{log(){},warn(){}},getSelectedCategoria:()=>({id:'cat',nome:'Fisso'}),normalizeCfPiva:v=>v,
    isItalianFiscalCode:()=>true,isItalianVatNumber:()=>false,fetchJsonOrTechnicalError:()=>pending,
    checkReinserimento:()=>scenario==='lookup-tardivo'?Promise.resolve([]):pending,showReinserimentoOverlay(){shown++;}};
  vm.runInNewContext(source.slice(a,b)+'\nthis.check=checkAndOfferReinserimento;',ctx);
  const run=ctx.check();
  if(scenario!=='corrente'){runtimeState.pdaRevision++;runtimeState.anagraficaId=null;refs.cfPiva.value='SECOND';uiState.step=1;}
  resolvePending(scenario==='lookup-tardivo'?{found:true,data:{id:'first'}}:[{contratto_id:'old'}]);await run;
  assert.equal(shown,scenario==='corrente'?1:0);
  if(scenario!=='corrente'){assert.equal(runtimeState.anagraficaId,null);assert.equal(runtimeState.pendingReinserimento.contratto_id,'nuovo');}
});


test('AI incompleta si ferma prima dello staging e non apre campi manuali in automatico',async()=>{
  const ui=pdaWizardFixture({incomplete:true});
  await assert.rejects(ui.run(),/Lettura AI incompleta.*Continua senza AI/);
  assert.deepEqual(ui.calls,['ocr']);assert.equal(ui.form,undefined);
  const failed=pdaWizardFixture({ocrFailure:true});await failed.run();
  assert.deepEqual(failed.calls,['ocr','alert']);assert.equal(failed.form,undefined);
  const noCode=pdaWizardFixture({missingCode:true});await assert.rejects(noCode.run(),/codice contratto non leggibile/);
  assert.deepEqual(noCode.calls,['ocr']);assert.equal(noCode.form,undefined);
});

function pdaUiFixture(){
  const window={MiroxPda:Pda,MiroxSafe:{escapeHtml:v=>String(v).replace(/</g,'&lt;').replace(/"/g,'&quot;')}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/vendita-pda-ui.js'),'utf8'),{window});
  return window.MiroxPdaUI;
}
test('wizard Mobile: costo solo hidden, campi telefonici nascosti AI e visibili manuali',()=>{
  const ui=pdaUiFixture(),data=Pda.validate(mobile,'Mobile');
  for(const reading of ['ai','manuale']){
    const html=ui.formHtml(data,'Mobile',{wizard:true,reading});
    assert.match(html,/<input type="hidden" data-pda-field="costo_offerta_mensile" value="9.99">/);
    assert.doesNotMatch(html,/Costo mensile base offerta/);
    assert.equal(html.includes('<div data-pda-mobile hidden>'),reading==='ai');
    assert.match(html,/Numero di cellulare/);assert.doesNotMatch(html,/Numero del contratto/);
  }
  for(const category of ['Mobile','Fisso','Customer Base']){
    const ai=ui.formHtml(data,category,{wizard:true,reading:'ai'});
    assert.match(ai,/<input type="hidden" data-pda-field="codice_contratto" value="00AB123">/);
    assert.doesNotMatch(ai,/Codice contratto/);
    assert.match(ui.formHtml(data,category,{wizard:true,reading:'manuale'}),/Codice contratto/);
    assert.match(ui.formHtml(data,category),/Codice contratto/);
    assert.equal(ui.summary({...data,pda_lettura:'ai',costo_offerta_mensile:null,numero_telefono:null},{wizard:true}),'');
  }
  const editor=ui.formHtml(data,'Mobile');assert.match(editor,/Costo mensile base offerta/);
  assert.doesNotMatch(editor,/<div data-pda-mobile hidden>/);
});
test('manuale alterna cellulare/provvisorio e MNP senza confondere le numerazioni salvate',()=>{
  const ui=pdaUiFixture(),callbacks={},details=[{},{}],label={};
  const fields=[{dataset:{pdaField:'portabilita'},value:'false',addEventListener(k,v){callbacks[k]=v;}},
    {dataset:{pdaField:'numero_telefono'},value:'3491234567'},
    {dataset:{pdaField:'numero_provvisorio'},value:'3931234567'},
    {dataset:{pdaField:'costo_offerta_mensile'},value:'9.99'}];
  const root={querySelector:s=>s.includes('portabilita')?fields[0]:label,
    querySelectorAll:s=>s==='[data-pda-mnp]'?details:fields};
  ui.bindForm(root);assert.equal(label.textContent,'Numero di cellulare *');assert.ok(details.every(d=>d.hidden));
  fields[0].value='true';callbacks.change();assert.equal(label.textContent,'Numero da portare (MNP) *');
  assert.ok(details.every(d=>!d.hidden));
  const saved=ui.readForm(root);assert.equal(saved.numero_mnp,'3491234567');assert.equal(saved.numero_provvisorio,'3931234567');
  assert.equal(saved.costo_offerta_mensile,'9.99');
});
test('riepilogo upload nasconde costo e dati AI conservandoli per gli editor post-vendita',()=>{
  const ui=pdaUiFixture(),data={...Pda.validate(mobile,'Mobile'),pda_lettura:'ai'};
  const hidden=ui.summary(data,{wizard:true});assert.doesNotMatch(hidden,/Codice contratto|00AB123/);
  assert.doesNotMatch(hidden,/Costo mensile|Numero di cellulare|3331234567/);
  assert.match(ui.summary({...data,pda_lettura:'manuale'},{wizard:true}),/Numero di cellulare/);
  assert.match(ui.summary(data),/Costo mensile offerta/);
});
test('lettura AI/manuale e valori nascosti sopravvivono al restore e al reset della stessa categoria',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const a=source.indexOf(' function renderPdaFields(data)'),b=source.indexOf(' async function checkPendingCode()',a);
  const root={dataset:{},addEventListener(){}};let last;
  const ctx={refs:{},document:{getElementById:()=>root},getCategoriaName:()=> 'Mobile',queueDraftSave(){},window:{MiroxPda:Pda,
    MiroxPdaUI:{formHtml(data,cat,options){last={data,options};return 'form';},bindForm(){},readForm(){return last.data;}}}};
  vm.runInNewContext(source.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
  ctx.render({...mobile,pda_lettura:'ai'});assert.equal(last.options.reading,'ai');assert.equal(ctx.read().costo_offerta_mensile,9.99);
  const draft=JSON.parse(JSON.stringify(ctx.read()));ctx.render({});assert.equal(last.options.reading,'manuale');
  ctx.render(draft);assert.equal(last.options.reading,'ai');assert.equal(ctx.read().numero_telefono,'3331234567');
  ctx.render();assert.equal(last.options.reading,'ai');
});

test('payload server conserva i valori PDA nascosti senza inviare metadati UI',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8');
  const a=source.indexOf(' function buildInvioPayload()'),b=source.indexOf(' async function inviaPratica()',a);
  const item={...Pda.validate({...mobile,portabilita:true,numero_telefono:'3491234567',numero_mnp:'3491234567',numero_provvisorio:'3931234567',operatore_provenienza:'Vodafone'},'Mobile'),
    codice_cliente:'P0001234567',pda_lettura:'ai',pda_dispositivo_auto:false,pda_dispositivo_manuale:true,pda_tipo_attivazione_auto:'Portabilita',pda_tipo_attivazione_manuale:true,categoria_nome:'Mobile',categoria_id:'cat',offerta_id:'offer',flags:{},files:{},codice_rivenditore:'9000822241'};
  const state={cart:{contratti:[item]}},cliente={cf_piva:'RSSMRA80A01H501U'};
  const ctx={window:{MiroxPda:Pda},state,getClienteFormData:()=>cliente,validateClienteData(){},
    praticaFiles:{documento_identita:[{}]},runtimeState:{},refs:{originePratica:{value:'spontaneo'},operatoreId:{value:'operator'}},
    CODICI_RIVENDITORE:['9001415852'],CODICE_RIVENDITORE_DEFAULT:'9001415852'};
  vm.runInNewContext(source.slice(a,b)+';this.payload=buildInvioPayload;',ctx);
  const saved=ctx.payload().contratti[0];
  for(const key of Pda.FIELDS)assert.equal(saved[key],item[key],key);
  assert.equal(saved.pda_lettura,undefined);assert.equal(saved.pda_dispositivo_auto,undefined);assert.equal(saved.pda_dispositivo_manuale,undefined);assert.equal(saved.pda_tipo_attivazione_auto,undefined);assert.equal(saved.pda_tipo_attivazione_manuale,undefined);assert.equal(saved.codice_rivenditore,'9001415852');
});

test('codice cliente AI acquisito da ogni PDA, senza modificare OTP della prima pratica',async()=>{
 for(const completed of [false,true]){
  const ui=pdaWizardFixture({completed,customerCode:'P 0001234567'});await ui.run();
  assert.equal(ui.form.codice_cliente,'P0001234567');assert.ok(!ui.calls.includes('ask-customer-code'));
  if(completed)assert.equal(ui.contact,'3350000000');
 }
});
test('codice cliente manuale annullato o risposta tardiva fermano lo staging',async()=>{
 for(const opts of [{cancelCustomer:true},{staleCustomer:true}]){
  const ui=pdaWizardFixture({manual:true,...opts});await ui.run();assert.ok(ui.calls.includes('ask-customer-code'));assert.ok(!ui.calls.includes('upload'));
 }
});
