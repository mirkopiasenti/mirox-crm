'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Identity=require('../netlify/functions/_lib/identita-upload');
const {handler}=require('../netlify/functions/verifica-identita-upload');
const Docs=require('../netlify/functions/_lib/verifica-documenti');
const person={cf_piva:'RSSMRA80A01H501U',cluster:'Consumer',ragione_sociale:'Mario Rossi'};
const files=[new File(['%PDF-front'],'fronte.pdf'),new File(['%PDF-retro'],'retro.pdf')];
const digests=['%PDF-front','%PDF-retro'].map(v=>Identity.hash(Buffer.from(v)));
const result={stato:'da_correggere',errors:['Il codice fiscale letto non coincide.'],uncertain:[],data_firma:'2026-10-28',scadenza:'2030-01-01',cittadinanza:'ue',
  confronto:{campo_anagrafica:'Ragione sociale',nome_anagrafica:person.ragione_sociale,nomi_documenti:['Mario Rosi'],nome_informativo:true,fiscale_atteso:person.cf_piva,fiscali_documenti:[]}};
const receipt=()=>({version:1,at:Date.now(),user:'user',customer:person,documents:digests.map(sha256=>({sha256,pages:1})),result:structuredClone(result)});
const decision=()=>({action:'confirm_preview',preview_visualizzata:true,preview_sha256:digests,scadenza:'2030-01-01',cittadinanza:'ue'});
test('conferma preview supera esito OCR negativo e conserva lettura, esito e dichiarazione tracciata',()=>{
  const source=receipt(),confirmed=Identity.confirmPreview(source,decision());
  assert.equal(confirmed.result.stato,'manuale');assert.deepEqual(confirmed.result.errors,[]);
  assert.equal(confirmed.result.criterio_identita,'conferma_preview');assert.equal(confirmed.conferma.user,'user');
  assert.deepEqual(confirmed.esito_automatico,source.result);assert.deepEqual(confirmed.documents,source.documents);
  assert.equal(Identity.approved(confirmed),true);assert.equal(confirmed.conferma.modalita,'preview_manuale');
  const token=Identity.sign(confirmed,'fixture');
  assert.equal(Identity.verify(token,{user:'user',customer:person,secret:'fixture'}).conferma.preview_visualizzata,true);
});
test('preview richiede tutti i file esatti, data valida e scadenza dichiarata; nessuna approvazione generica',()=>{
  for(const patch of [{preview_visualizzata:false},{preview_sha256:[digests[0]]},{preview_sha256:['f'.repeat(64)]},{scadenza:'2020-01-01'},{scadenza:'2026-02-30'},{cittadinanza:'inventata'}]){
    assert.throws(()=>Identity.confirmPreview(receipt(),{...decision(),...patch}));
  }
  assert.throws(()=>Identity.confirmPreview({...receipt(),result:{...result,data_firma:'2099-01-01'}},decision()));
  assert.throws(()=>Identity.confirmPreview({...receipt(),result:{...result,stato:'coerente'}},decision()),/non concluso/);
  // Una scadenza OCR errata puo essere corretta dalla lettura personale del documento.
  assert.equal(Identity.confirmPreview({...receipt(),result:{...result,scadenza:'2020-01-01'}},decision()).result.scadenza,'2030-01-01');
});
test('conferma cittadinanza preview mantiene obbligo permesso Consumer VAR extra UE',()=>{
  const manual=Identity.confirmPreview(receipt(),{...decision(),cittadinanza:'extra_ue'});
  assert.equal(Identity.Core.needsPermit({categoria_snapshot:'Mobile',cluster_cliente:'Consumer',dispositivo_associato:true,tipo_acquisto:'VAR'},manual.result.cittadinanza),true);
  assert.equal(Identity.confirmPreview({...receipt(),result:{...result,stato:'coerente',cittadinanza:null}},decision()).result.stato,'manuale');
});
test('API conferma preview senza altre letture AI, con ricevuta autore/file non trasferibile',async()=>{
  let reads=0;const data=receipt();
  const deps={secret:'fixture',requireAuth:async()=>({ok:true,user:{id:'user'}}),extract:async()=>{reads++;throw Error('Non deve chiamare AI');}};
  const event={httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:Identity.sign(data,'fixture'),...decision()})};
  const out=await handler(event,deps);assert.equal(out.statusCode,200);assert.equal(reads,0);
  const signed=Identity.verify(JSON.parse(out.body).token,{user:'user',customer:person,secret:'fixture'});assert.equal(signed.result.stato,'manuale');
  assert.equal((await handler(event,{...deps,requireAuth:async()=>({ok:true,user:{id:'other'}})})).statusCode,409);
});
test('conferma preview riusata nella verifica successiva senza OCR identita solo con gli stessi byte',async()=>{
  let changed=false,reads=0;
  const db={storage:{from:()=>({download:async path=>({data:new Blob([changed?'%PDF-diverso':path==='front'?'%PDF-front':'%PDF-retro'])})})},
    from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null}),upsert:async()=>({data:null})})};
  const snapshot={contract:{cluster_cliente:'Consumer'},customer:person,practice:{identita_verifica_upload:Identity.confirmPreview(receipt(),decision())},
    documents:['front','retro'].map((path,index)=>({id:'id'+index,tipo_documento:'documento_identita',storage_bucket:'contratti-vendita',storage_path:path}))};
  const deps={pdfInfo:async()=>1,extract:async doc=>{reads++;return {id:doc.id,fields:{}};}};
  assert.equal((await Docs.readDocuments(db,snapshot,deps)).identityPrecheck.manuale,true);assert.equal(reads,0);
  changed=true;assert.equal((await Docs.readDocuments(db,snapshot,deps)).identityPrecheck,null);assert.equal(reads,2);
});
test('ricevuta manuale con stessi byte riusata anche quando il parser identita non riesce ad aprire il PDF',async()=>{
 let reads=0;
 const db={storage:{from:()=>({download:async()=>({data:new Blob(['%PDF-front'])})})},from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null}),upsert:async()=>({data:null})})};
 const data=receipt();data.documents=data.documents.slice(0,1);const input={...decision(),preview_sha256:[digests[0]]};
 const snapshot={contract:{cluster_cliente:'Consumer'},customer:person,practice:{identita_verifica_upload:Identity.confirmPreview(data,input)},documents:[{id:'i',tipo_documento:'documento_identita',storage_bucket:'contratti-vendita',storage_path:'id.pdf'}]};
 const out=await Docs.readDocuments(db,snapshot,{pdfInfo:async()=>{throw Error('PDF non leggibile dal parser');},extract:async()=>{reads++;}});
 assert.equal(out.identityPrecheck.manuale,true);assert.equal(reads,0);
});
function fixture({responseResult=result,count=2,firstError=null,initialResponse=null,confirmFailures=0,timerApi={}}={}){
  let builtResolve,modal,calls=0,alerts=0,posted,closed=0;const revoked=[],handlers={};
  const built=new Promise(resolve=>{builtResolve=resolve;});
  const controls={
    '[data-identity-expiry]':{value:'2030-01-01'},'[data-identity-country]':{value:'extra_ue'},
    '[data-identity-representative]':{value:person.cf_piva},
    '[data-identity-preview-status]':{textContent:''},'[data-identity-save]':{disabled:true},'[data-identity-cancel]':{}
  };
  for(const key of ['[data-identity-save]','[data-identity-cancel]'])controls[key].addEventListener=(_,fn)=>{handlers[key]=fn;};
  const frames=Array.from({length:count},()=>({events:{},addEventListener(key,fn){this.events[key]=fn;}}));
  const links=Array.from({length:count},()=>({events:{},addEventListener(key,fn){this.events[key]=fn;}}));
  const checks=Array.from({length:count},()=>({checked:false,disabled:true,events:{},addEventListener(key,fn){this.events[key]=fn;}}));
  const escape=v=>String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const window={MiroxSafe:{escapeHtml:escape},MiroxIdentitaCore:Identity.Core,
    MiroxUI:{alert:async()=>{alerts++;},_build:options=>{modal=options;builtResolve();return {body:{style:{},querySelector:key=>controls[key],querySelectorAll:key=>key==='[data-identity-open]'?links:key==='[data-identity-viewed]'?checks:frames},foot:{querySelector:key=>controls[key]},close(){closed++;options.onClose();}};}},
    MiroxApi:{fetch:async(_,options)=>{calls++;if(calls===1){if(firstError)throw firstError;return initialResponse||{ok:true,json:async()=>({success:true,token:'first',result:responseResult})};}if(confirmFailures-->0)throw new Error('Servizio temporaneamente non disponibile');posted=options.body instanceof FormData?{action:options.body.get('action'),...JSON.parse(options.body.get('conferma'))}:JSON.parse(options.body);return {ok:true,json:async()=>({success:true,token:'manual',result:{...responseResult,stato:'manuale'}})};}}
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/identita-upload-ui'),'utf8'),{window,crypto:require('node:crypto').webcrypto,Uint8Array,Date,FormData,URL:{createObjectURL:file=>'blob:'+file.name,revokeObjectURL:url=>revoked.push(url)},document:{getElementById:()=>({textContent:''})},...timerApi});
  return {window,built,frames,links,checks,controls,revoked,get closed(){return closed;},get modal(){return modal;},get calls(){return calls;},get alerts(){return alerts;},get posted(){return posted;},save:()=>handlers['[data-identity-save]'](),cancel:()=>handlers['[data-identity-cancel]']()};
}
test('UI mostra preview di tutti gli originali, conferma solo dopo caricamento e prosegue senza nuova OCR',async()=>{
  const f=fixture();const pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28',requireCitizenship:true});
  await f.built;
  assert.match(f.modal.bodyHtml,/Confermi che il documento visualizzato nella preview/);assert.match(f.modal.bodyHtml,/<iframe/);
  assert.match(f.modal.bodyHtml,/blob:fronte.pdf/);assert.match(f.modal.bodyHtml,/blob:retro.pdf/);
  assert.doesNotMatch(f.modal.bodyHtml,/data-identity-tax|data-identity-reason/);
  await f.save();assert.equal(f.calls,1);assert.equal(f.controls['[data-identity-save]'].disabled,true);
  f.frames[0].events.load();assert.equal(f.controls['[data-identity-save]'].disabled,true);
  f.frames[1].events.load();assert.equal(f.controls['[data-identity-save]'].disabled,false);
  f.controls['[data-identity-expiry]'].value='2020-01-01';await f.save();assert.equal(f.alerts,1);assert.equal(f.calls,1);
  f.controls['[data-identity-expiry]'].value='2030-01-01';await f.save();assert.equal((await pending).token,'manual');
  assert.equal(f.calls,2);assert.equal(f.posted.action,'confirm_preview');assert.equal(f.posted.cittadinanza,'extra_ue');
  assert.deepEqual([...f.posted.preview_sha256].sort(),[...digests].sort());assert.equal(f.revoked.length,2);
  await f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28',requireCitizenship:true});
  assert.equal(f.calls,2); // Aggiungi/Invia riusano la ricevuta: nessuna nuova OCR.
});
test('preview annullata o documento modificato non produce ricevuta; URL ripuliti e testo escaped',async()=>{
  const f=fixture({responseResult:{...result,errors:['<img src=x onerror=fail()>']}});
  const pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});await f.built;
  assert.match(f.modal.bodyHtml,/&lt;img/);assert.doesNotMatch(f.modal.bodyHtml,/<img/);
  f.cancel();await assert.rejects(pending,/annullata/);assert.equal(f.calls,1);assert.equal(f.revoked.length,2);assert.equal(f.window.MiroxIdentitaUpload.get(),null);
  const changed=fixture();const next=changed.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});await changed.built;
  changed.window.MiroxIdentitaUpload.invalidate();changed.frames.forEach(frame=>frame.events.load());await changed.save();
  await assert.rejects(next,/Dati cambiati/);assert.equal(changed.calls,1);assert.equal(changed.revoked.length,2);
});
test('preview non caricata resta bloccata anche dopo errore iframe e non aggira cittadinanza VAR',async()=>{
  const f=fixture();const pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28',requireCitizenship:true});await f.built;
  f.frames.forEach(frame=>frame.events.load());f.frames[1].events.error();await f.save();assert.equal(f.calls,1);
  f.frames[1].events.load();f.controls['[data-identity-country]'].value='';await f.save();assert.equal(f.alerts,1);assert.equal(f.calls,1);
  f.cancel();await assert.rejects(pending,/annullata/);
});
test('cambio documento chiude subito la vecchia anteprima e libera URL senza dover confermare',async()=>{
 const f=fixture(),pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});const rejected=assert.rejects(pending,/cambiati/);
 await f.built;f.window.MiroxIdentitaUpload.invalidate();assert.equal(f.closed,1);await rejected;
 assert.equal(f.revoked.length,2);f.frames.forEach(frame=>frame.events.load());await f.save();assert.equal(f.calls,1);
});
test('errori rete, HTTP e risposte non valide aprono sempre la preview e confermano via multipart senza OCR',{timeout:10000},async()=>{
 for(const options of [{firstError:new Error('Failed to fetch')},{initialResponse:{ok:false,json:async()=>({error:'I dati inseriti differiscono dall’anagrafica CRM'})}},{initialResponse:{ok:true,json:async()=>({success:true})}},{initialResponse:{ok:true,json:async()=>{throw Error('JSON invalido');}}}]){
  const f=fixture(options),pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});
  await f.built;assert.match(f.modal.bodyHtml,/Mario Rossi/);assert.match(f.modal.bodyHtml,/RSSMRA80A01H501U/);
  f.frames.forEach(frame=>frame.events.load());await f.save();assert.equal((await pending).result.stato,'manuale');
  assert.equal(f.posted.action,'confirm_preview');assert.equal(f.calls,2);
 }
});
test('registrazione manuale fallita conserva preview e file e permette di riprovare',{timeout:5000},async()=>{
 const f=fixture({confirmFailures:2}),pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});
 await f.built;f.frames.forEach(frame=>frame.events.load());await f.save();
 assert.equal(f.closed,0);assert.equal(f.revoked.length,0);assert.equal(f.controls['[data-identity-save]'].disabled,false);
 assert.match(f.controls['[data-identity-preview-status]'].textContent,/riprovare senza ricaricare/);
 assert.equal(f.window.MiroxIdentitaUpload.get(),null);await f.save();assert.equal((await pending).result.stato,'manuale');assert.equal(f.closed,1);
});
test('richiesta o corpo JSON che non risponde viene interrotto e apre la preview entro il limite',{timeout:5000},async()=>{
 for(const hangs of ['fetch','json']){
  const timers=[];let calls=0,signal,start;
  const started=new Promise(resolve=>{start=resolve;});
  const f=fixture({timerApi:{AbortController,setTimeout:(fn,ms)=>{assert.equal(ms,45000);timers.push(fn);return fn;},clearTimeout:()=>{}}});
  f.window.MiroxApi.fetch=async(_,options)=>{
   calls++;if(calls===1){signal=options.signal;start();return hangs==='fetch'?new Promise(()=>{}):{ok:true,json:()=>new Promise(()=>{})};}
   return {ok:true,json:async()=>({success:true,token:'manual',result:{...result,stato:'manuale'}})};
  };
  const pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});
  await started;timers[0]();await f.built;assert.equal(signal.aborted,true);
  f.frames.forEach(frame=>frame.events.load());await f.save();assert.equal((await pending).result.stato,'manuale');assert.equal(calls,2);
 }
});
test('viewer PDF non disponibile: apertura originale e attestazione esplicita di ogni file consentono conferma',{timeout:5000},async()=>{
 const f=fixture(),pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});
 await f.built;f.frames.forEach(frame=>frame.events.error());
 f.checks.forEach(check=>{check.checked=true;check.events.change();});assert.equal(f.controls['[data-identity-save]'].disabled,true);
 for(let i=0;i<files.length;i++){f.links[i].events.click();f.checks[i].checked=true;f.checks[i].events.change();}
 await f.save();assert.equal((await pending).result.stato,'manuale');
});
test('recupero UI dopo timeout usa API multipart reale e ricevuta firmata senza parser, OCR o barcode',{timeout:5000},async()=>{
 const f=fixture();let calls=0;
 f.window.MiroxApi.fetch=async(_,options)=>{
  if(++calls===1)throw Error('Timeout OCR');
  assert.ok(options.body instanceof FormData);assert.equal(options.body.get('action'),'manual_preview');
  const request=new Request('https://fixture.invalid',{method:'POST',body:options.body});
  const event={httpMethod:'POST',headers:{'content-type':request.headers.get('content-type')},body:Buffer.from(await request.arrayBuffer()).toString('base64'),isBase64Encoded:true};
  const out=await handler(event,{secret:'fixture',requireAuth:async()=>({ok:true,user:{id:'user'}}),
   db:{from:()=>({select(){return this;},ilike(){return this;},limit:async()=>({data:[{...person,ragione_sociale:'Nome CRM precedente'}]})})},
   pdfInfo:async()=>assert.fail('Nessun parser nel recupero manuale'),extract:async()=>assert.fail('Nessuna OCR'),readBarcode:async()=>assert.fail('Nessun barcode')});
  return new Response(out.body,{status:out.statusCode});
 };
 const pending=f.window.MiroxIdentitaUpload.ensure({files,customer:person,date:'2026-10-28'});await f.built;
 f.frames.forEach(frame=>frame.events.load());await f.save();const complete=await pending;
 const signed=Identity.verify(complete.token,{user:'user',customer:person,secret:'fixture'});
 assert.equal(signed.result.stato,'manuale');assert.equal(signed.crm_customer.ragione_sociale,'Nome CRM precedente');
 assert.deepEqual(signed.documents.map(d=>d.sha256).sort(),[...digests].sort());Identity.assertPractice(signed,person);
 assert.throws(()=>Identity.verify(complete.token,{user:'other',customer:person,secret:'fixture'}));
});
test('SDK Anthropic installato trasmette Haiku5.5 e tool forzato senza sampling obsoleto',async()=>{
  const Anthropic=require('@anthropic-ai/sdk').default;let request;
  const doc={id:'id',tipo_documento:'identita_upload',pages:1};
  const fields=Object.fromEntries(Docs.documentTool(doc).input_schema.properties.fields.required.map(key=>[key,null]));
  const client=new Anthropic({apiKey:'fixture-only',maxRetries:0,fetch:async(_,options)=>{
    request=JSON.parse(options.body);return new Response(JSON.stringify({id:'msg_fixture',type:'message',role:'assistant',model:'claude-haiku-5-5',content:[{type:'tool_use',id:'tool_fixture',name:'trascrivi_documento',input:{fields}}],stop_reason:'tool_use',stop_sequence:null,usage:{input_tokens:10,output_tokens:10}}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  await Docs.extractDocument(doc,Buffer.from('%PDF-fixture'),{client,pdfText:async()=>''});
  assert.equal(request.model,'claude-haiku-5-5');assert.equal(request.tool_choice.type,'tool');
  for(const key of ['temperature','top_p','top_k'])assert.equal(Object.hasOwn(request,key),false);
});
