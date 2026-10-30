'use strict';
require('node:test').mock.method(require('../netlify/functions/_lib/identita-barcode'),'readPdf',async()=>({attempted:false,complete:true,conflict:false,values:[]}));
const test=require('node:test'),assert=require('node:assert/strict');
const Business=require('../netlify/functions/_lib/pda-business-identity');
const Identity=require('../netlify/functions/_lib/identita-upload');
const Docs=require('../netlify/functions/_lib/verifica-documenti');
const {handler}=require('../netlify/functions/verifica-identita-upload');
const company={cf_piva:'01234567890',cluster:'Business',ragione_sociale:'Azienda dimostrativa',nome_referente:'Mario'};
const person='RSSMRA80A01H501U';
const path='temp/11111111-1111-4111-8111-111111111111/pda.pdf';
const mobile=(tax=person,code='C001')=>'PAGINA PDF 1\nCodice Contratto: '+code+'\nPartita IVA/Cod. Fiscale Azienda: 01234567890\nDATI DEL RAPPRESENTANTE LEGALE\nCognome: Rossi Nome: Mario\nCodice Fiscale: '+tax+'\nDATI FIRMA ELETTRONICA\nCodice Fiscale: VRDLGI80A01H501Z';
const fixed=()=>"PAGINA PDF 1\nNumero Contratto C001\nDati dell'Azienda\nPartita IVA/Cod.Fiscale Azienda: 01234567890\nDati del Legale Rappresentante o del Delegato\nCodice Fiscale: "+person+'\nModalità di pagamento\nCodice Fiscale: VRDLGI80A01H501Z';
const bytes=Buffer.from('%PDF-pda');
const dbFor=(body=bytes)=>({storage:{from:()=>({download:async()=>({data:new Blob([body])})})}});
const ev=value=>({value,page:1,quote:'Dato dimostrativo esplicito'});
const idReading=()=>({fields:Object.fromEntries(Object.entries({nome:'Nome OCR errato',fiscale:person,nascita:'1980-01-01',scadenza:'2030-01-01',tipo_identita:'carta_identita',numero_documento:'CA1234567',cittadinanza:'IT',fronte_presente:true,retro_presente:true}).map(([key,value])=>[key,ev(value)]))});
test('Business Mobile e Fisso separano CF rappresentante da PIVA, SEPA e altri soggetti con prova di pagina',()=>{
  for(const text of [mobile(),fixed()]){const f=Business.fields(text);assert.equal(f.fiscale.value,company.cf_piva);assert.equal(f.firmatario_fiscale.value,person);assert.equal(f.codice_contratto.value,'C001');assert.equal(f.firmatario_fiscale.page,1);}
  const ambiguous=Business.evidence(mobile()+'\n'+mobile('VRDLGI80A01H501Z'));
  assert.ok(ambiguous.ambiguous.includes('firmatario_fiscale'));assert.equal(ambiguous.fields.firmatario_fiscale,null);
  assert.equal(Business.fields('PAGINA PDF 1\n\n'+mobile().replace('PAGINA PDF 1','PAGINA PDF 3')).firmatario_fiscale.page,3);
});
test('fallback Business completa la scansione senza sostituire dati digitali discordanti',async()=>{
  const deps={pdfInfo:async()=>1,pdfText:async()=>mobile().replace('Codice Contratto: C001',''),
    extractBusiness:async()=>({fields:{fiscale:ev(company.cf_piva),codice_contratto:ev('C001'),firmatario_fiscale:ev(person)}})};
  assert.equal((await Business.load(dbFor(),[path],company,deps)).cf_rappresentante,person);
  await assert.rejects(Business.load(dbFor(),[path],company,{...deps,extractBusiness:async()=>({fields:{fiscale:ev(company.cf_piva),codice_contratto:ev('C001'),firmatario_fiscale:ev('VRDLGI80A01H501Z')}})}),/discordanti/);
});
test('lettura Business digitale valida azienda prima di usare CF persona e rifiuta percorsi/CF discordanti',async()=>{
  const deps={pdfInfo:async()=>1,pdfText:async()=>mobile(),extractBusiness:async()=>assert.fail('Digitale completo: nessuna AI')};
  const proof=await Business.load(dbFor(),[path],company,deps);
  assert.equal(proof.cf_rappresentante,person);assert.equal(proof.pdas[0].sha256,Identity.hash(bytes));
  await assert.rejects(Business.load(dbFor(),['../pda.pdf'],company,deps),/Riferimenti/);
  await assert.rejects(Business.load(dbFor(),[path],{...company,cf_piva:'99999999999'},deps),/aziendale/);
  await assert.rejects(Business.load(dbFor(),[path],company,{...deps,pdfText:async()=>mobile()+'\n'+mobile('VRDLGI80A01H501Z')}),/discordanti/);
});
test('fonti con rappresentanti diversi non possono condividere un unico documento nella pratica',async()=>{
  let count=0;
  await assert.rejects(Business.load(dbFor(),[path,path.replace('pda.pdf','pda2.pdf')],company,{pdfInfo:async()=>1,pdfText:async()=>mobile(count++?'VRDLGI80A01H501Z':person,count===1?'C001':'C002')}),/rappresentanti diversi/);
});
test('CF Business personale corrisponde al documento: nome informativo; mai confronto con la PIVA',()=>{
  const result=Identity.Core.evaluate([idReading()],{...company,cf_rappresentante:person},'2026-10-28');
  assert.equal(result.stato,'coerente');assert.equal(result.criterio_identita,'cf_rappresentante_pda');
  assert.equal(Identity.Core.evaluate([idReading()],{...company,cf_rappresentante:'VRDLGI80A01H501Z'},'2026-10-28').stato,'da_correggere');
  assert.equal(Identity.Core.evaluate([idReading()],{...company,cf_rappresentante:company.cf_piva},'2026-10-28').stato,'da_correggere');
});
test('CF manuale Business usa il rappresentante della ricevuta, mai la PIVA aziendale',()=>{
  const reading=idReading();reading.fields.fiscale=null;
  const result=Identity.Core.evaluate([reading],{...company,cf_rappresentante:person},'2026-10-28');
  assert.equal(result.stato,'da_confermare');assert.deepEqual(result.errors,[]);
  const data={customer:company,business_identity:{cf_rappresentante:person},result};
  assert.throws(()=>Identity.confirm(data,{motivo:'CF personale verificato',codice_fiscale_verificato:company.cf_piva}),/codice fiscale/);
  assert.equal(Identity.confirm(data,{motivo:'CF personale verificato',codice_fiscale_verificato:person}).conferma.codice_fiscale_verificato,person);
});
test('API Business genera ricevuta firmata con CF letto nella PDA, azienda CRM e digest della fonte',async()=>{
  const db={...dbFor(),from:()=>({select(){return this;},ilike(){return this;},limit:async()=>({data:[company]})})};
  const out=await handler({httpMethod:'POST',headers:{}},{db,secret:'fixture',requireAuth:async()=>({ok:true,user:{id:'user'}}),
    multipart:async()=>({fields:{cliente:JSON.stringify(company),data_firma:'2026-10-28',pda_paths:JSON.stringify([path])},files:[{buffer:Buffer.from('%PDF-id')}]}),
    pdfInfo:async()=>1,pdfText:async()=>mobile(),extract:async()=>idReading()});
  assert.equal(out.statusCode,200);const receipt=Identity.verify(JSON.parse(out.body).token,{user:'user',secret:'fixture',customer:company});
  assert.equal(receipt.business_identity.cf_rappresentante,person);assert.equal(receipt.customer.cf_piva,company.cf_piva);assert.equal(receipt.result.stato,'coerente');
});
test('create/finalize Business verificano codice contratto e byte prima delle scritture',async()=>{
  const business=await Business.load(dbFor(),[path],company,{pdfInfo:async()=>1,pdfText:async()=>mobile()});
  const check={business_identity:business},contracts=[{id:'c',categoria_snapshot:'Mobile',codice_contratto:'C001',pda_temp_path:path}];
  await Business.assertSources(dbFor(),check,company,contracts);
  await assert.rejects(Business.assertSources(dbFor(Buffer.from('Modificata')),check,company,contracts),/cambiata/);
  await assert.rejects(Business.assertSources(dbFor(),check,company,[{...contracts[0],codice_contratto:'ALTRO'}]),/tutte le PDA/);
  await assert.rejects(Business.assertSources(dbFor(),{},company,contracts),/tutte le PDA/);
  const documents=[{contratto_id:'c',tipo_documento:'contratto',sha256:business.pdas[0].sha256,storage_bucket:'contratti-vendita',storage_path:'final/pda.pdf'}];
  await Business.assertSources(dbFor(),check,company,contracts,documents);
  await assert.rejects(Business.assertSources(dbFor(),check,company,contracts,[{...documents[0],sha256:'f'.repeat(64)}]),/non coincide/);
});
test('riuso Business dell’identita richiede anche gli stessi byte della PDA del singolo contratto',async()=>{
  const idBytes=Buffer.from('%PDF-id'),pdaBytes=Buffer.from('%PDF-pda');let changed=false,reads=0;
  const db={storage:{from:()=>({download:async p=>({data:new Blob([p==='id.pdf'?idBytes:changed?Buffer.from('PDA diversa'):pdaBytes])})})},
    from:()=>({select(){return this;},eq(){return this;},maybeSingle:async()=>({data:null}),upsert:async()=>({data:null})})};
  const identity={version:1,customer:company,result:{stato:'coerente',scadenza:'2030-01-01'},documents:[{sha256:Identity.hash(idBytes)}],business_identity:{cf_rappresentante:person,pdas:[{codice_contratto:'C001',sha256:Identity.hash(pdaBytes)}]}};
  const snapshot={contract:{cluster_cliente:'Business',categoria_snapshot:'Mobile',codice_contratto:'C001'},customer:company,practice:{identita_verifica_upload:identity},documents:[{id:'i',tipo_documento:'documento_identita',storage_bucket:'contratti-vendita',storage_path:'id.pdf'},{id:'p',tipo_documento:'contratto',storage_bucket:'contratti-vendita',storage_path:'pda.pdf'}]};
  const deps={pdfInfo:async()=>1,extract:async doc=>{reads++;return {id:doc.id,fields:{}};}};
  assert.equal((await Docs.readDocuments(db,snapshot,deps)).identityPrecheck.cf_rappresentante,person);assert.equal(reads,1);
  changed=true;const next=await Docs.readDocuments(db,snapshot,deps);assert.equal(next.identityPrecheck,null);assert.equal(next.extracted.documents.length,2);
});
test('PDA Business non leggibile passa a conferma manuale con CF rappresentante e mantiene vincoli create/finalize',async()=>{
 const id=Buffer.from('%PDF-id');let ocr=0;
 const db={...dbFor(),from:()=>({select(){return this;},ilike(){return this;},limit:async()=>({data:[company]})})};
 const deps={db,secret:'fixture',requireAuth:async()=>({ok:true,user:{id:'user'}}),
  multipart:async()=>({fields:{cliente:JSON.stringify(company),data_firma:'2026-10-28',pda_paths:JSON.stringify([path])},files:[{buffer:id}]}),
  pdfInfo:async()=>1,pdfText:async()=>'',extractBusiness:async()=>{ocr++;throw Error('Provider non disponibile');},extract:async()=>assert.fail('Passa al manuale senza OCR identita')};
 const out=await handler({httpMethod:'POST',headers:{}},deps);assert.equal(out.statusCode,200);assert.equal(ocr,1);
 const body=JSON.parse(out.body),pending=Identity.verify(body.token,{user:'user',customer:company,secret:'fixture'});
 assert.equal(body.result.stato,'da_confermare');assert.equal(body.result.richiede_cf_rappresentante,true);
 const decision={preview_visualizzata:true,preview_sha256:[Identity.hash(id)],scadenza:'2030-01-01'};
 assert.throws(()=>Identity.confirmPreview(pending,decision),/CF del rappresentante/);
 const confirmed=Identity.confirmPreview(pending,{...decision,cf_rappresentante_verificato:person,rappresentante_verificato:true});
 assert.equal(confirmed.business_identity.cf_rappresentante,person);assert.equal(confirmed.business_identity.manuale,true);
 const contracts=[{id:'c',categoria_snapshot:'Mobile',codice_contratto:'C001',pda_temp_path:path}];
 await assert.rejects(Business.assertSources(db,pending,company,contracts),/tutte le PDA/);
 await Business.assertSources(db,confirmed,company,contracts);assert.equal(confirmed.business_identity.pdas[0].codice_contratto,'C001');
 const documents=[{contratto_id:'c',tipo_documento:'contratto',sha256:Identity.hash(bytes),storage_bucket:'contratti-vendita',storage_path:'final/pda.pdf'}];
 await Business.assertSources(db,confirmed,company,contracts,documents);
 await assert.rejects(Business.assertSources(dbFor(Buffer.from('%PDF-altra')),confirmed,company,contracts,documents),/cambiata/);
 await assert.rejects(Business.assertSources(db,confirmed,company,[{...contracts[0],codice_contratto:'C002'}]),/codici contratto diversi/);
 await assert.rejects(Business.loadManual(db,['../file.pdf'],company),/Riferimenti/);
});
test('recupero Business attraversa multipart reale con tutti i sei campi, senza alcuna lettura automatica',async()=>{
 const id=Buffer.from('%PDF-documento');const form=new FormData();
 for(const [key,value] of Object.entries({cliente:JSON.stringify(company),data_firma:'2026-10-28',pda_paths:JSON.stringify([path]),pacchetto:JSON.stringify({tipo:'cie'}),action:'manual_preview',conferma:JSON.stringify({preview_visualizzata:true,preview_sha256:[Identity.hash(id)],scadenza:'2030-01-01',cf_rappresentante_verificato:person,rappresentante_verificato:true})}))form.append(key,value);
 form.append('file',new Blob([id],{type:'application/pdf'}),'id.pdf');
 const request=new Request('https://fixture.invalid',{method:'POST',body:form});
 const event={httpMethod:'POST',headers:{'content-type':request.headers.get('content-type')},body:Buffer.from(await request.arrayBuffer()).toString('base64'),isBase64Encoded:true};
 const db={...dbFor(),from:()=>({select(){return this;},ilike(){return this;},limit:async()=>({data:[company]})})};
 const deps={db,secret:'fixture',requireAuth:async()=>({ok:true,user:{id:'user'}}),pdfInfo:async()=>assert.fail('Nessun parser'),extract:async()=>assert.fail('Nessuna OCR')};
 const out=await handler(event,deps);assert.equal(out.statusCode,200);
 const signed=Identity.verify(JSON.parse(out.body).token,{user:'user',customer:company,secret:'fixture'});
 assert.equal(signed.result.stato,'manuale');assert.equal(signed.business_identity.cf_rappresentante,person);assert.equal(signed.business_identity.pdas[0].sha256,Identity.hash(bytes));
 assert.equal((await handler(event,{...deps,requireAuth:async()=>({ok:false,status:403,error:'Non autorizzato'})})).statusCode,403);
});
