'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const {PDFDocument,PDFArray,PDFName,decodePDFRawStream}=require('pdf-lib');
const Core=require('../js/subentri-core');
const {generateSubentroPdf,resolveTemplatePath}=require('../netlify/functions/_lib/pdf-subentro');
const {handle,validateManifest,validateFile,readMultipart}=require('../netlify/functions/gestisci-subentri')._test;
const {sample}=require('./fixtures/subentro');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const id='33333333-3333-4333-8333-333333333333';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
function normalizedText(pdf,pageIndex) {
  const page=pdf.getPage(pageIndex);const contents=page.node.Contents();const streams=contents instanceof PDFArray?contents.asArray():[contents];
  return streams.map(ref=>{const value=pdf.context.lookup(ref);return Buffer.from(decodePDFRawStream(value).decode()).toString();}).join('\n');
}
function drawnText(operators) {return [...operators.matchAll(/<([\dA-F]+)>\s*Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1')).join('');}

test('subentri: normalizzazione, doppio soggetto e soli IBAN/bollettino',()=>{
  const value=Core.validatePayload(sample());assert.equal(value.cedente_ragione_sociale,'AZIENDA ESEMPIO SRL');assert.equal(value.subentrante_nome,'GIULIA');assert.equal(value.numeri.length,5);
  assert.throws(()=>Core.validatePayload({...sample(),pagamento:'carta'}),/Pagamento non valido/);
  assert.throws(()=>Core.validatePayload({...sample(),tipo:'mobile_fisso_privato'}),/non è ancora disponibile/);
  assert.throws(()=>Core.validatePayload({...sample(),cedente_nome:''}),/obbligatorio/);
  assert.throws(()=>Core.validatePayload({...sample(),subentrante_codice_fiscale:'123'}),/formato non valido/);
});
test('subentri: bollettino e professionista non conservano dati di banca o impresa inattivi',()=>{
  const value=Core.validatePayload({...sample(),pagamento:'bollettino',cedente_tipo:'professionista',banca:'',iban:'',cedente_ragione_sociale:''});
  assert.equal(value.banca,undefined);assert.equal(value.iban,undefined);assert.equal(value.conto_intestatario,undefined);assert.equal(value.cedente_ragione_sociale,undefined);
});
test('subentri: IBAN checksum, date, scelte consensi e numeri duplicati sono verificati',()=>{
  assert.throws(()=>Core.validatePayload({...sample(),iban:'IT60X0542811101000000123457'}),/IBAN non valido/);
  assert.throws(()=>Core.validatePayload({...sample(),subentrante_data_nascita:'1990-02-30'}),/data non valida/);
  assert.throws(()=>Core.validatePayload({...sample(),subentrante_documento_rilascio:'1980-01-01'}),/precede la nascita/);
  assert.throws(()=>Core.validatePayload({...sample(),numeri:['+39 3200000001','3200000001']}),/più volte/);
  assert.throws(()=>Core.validatePayload({...sample(),consensi:{...sample().consensi,windtre:undefined}}),/Sì oppure No/);
  assert.equal(Core.validatePayload({...sample(),data:'',subentrante_localita:''}).data,'');
});
test('subentri: genera 1, 2, 3 e 25 pagine e mantiene i soli numeri della pagina',async()=>{
  for(const count of [1,4,5,9,100]) {
    const result=await generateSubentroPdf(sample(count),{createdAt:'2026-10-18T10:00:00Z'});const pdf=await PDFDocument.load(result.buffer);assert.equal(pdf.getPageCount(),Math.ceil(count/4));assert.ok(result.buffer.length<4*1024*1024);
    if(count===5) {
      const first=drawnText(normalizedText(pdf,0)),second=drawnText(normalizedText(pdf,1));
      assert.match(first,/3200000001320000000232000000033200000004/);assert.doesNotMatch(first,/3200000005/);
      assert.match(second,/3200000005/);assert.doesNotMatch(second,/3200000001/);assert.match(second,/GIULIA/);assert.match(second,/PAGINA 2\/2/);
    }
  }
});
test('subentri: PDF identico nei retry della stessa bozza, firme non compilate',async()=>{
  const options={createdAt:'2026-10-18T10:00:00Z'};const first=await generateSubentroPdf(sample(),options);const second=await generateSubentroPdf(sample(),options);assert.equal(hash(first.buffer),hash(second.buffer));
  const pdf=await PDFDocument.load(first.buffer);const text=drawnText(normalizedText(pdf,0));assert.doesNotMatch(text,/FIRMA|DOMICILIAZIONE|CARTA DI CREDITO/);
});
test('subentri: codice cliente testuale fino a dieci caratteri conservato nel PDF',async()=>{
  for(const code of ['A','00Ab.1/_-#','P101063727','W'.repeat(10)]) {
    const raw={...sample(5),codice_cliente:` ${code} `};
    assert.equal(Core.validatePayload(raw).codice_cliente,code);
    const {buffer}=await generateSubentroPdf(raw);
    const pdf=await PDFDocument.load(buffer);
    for(let page=0;page<2;page++) assert.ok(drawnText(normalizedText(pdf,page)).includes(code));
  }
  assert.throws(()=>Core.validatePayload({...sample(),codice_cliente:'A\n1'}),/non supportati/);
});
test('subentri: un carattere per casella e generazione bloccata oltre dieci',async()=>{
  const raw={...sample(1),codice_cliente:'P101063727'};
  const {buffer}=await generateSubentroPdf(raw);
  const pdf=await PDFDocument.load(buffer);
  const content=normalizedText(pdf,0);
  const runs=[...content.matchAll(/<([\dA-F]+)>\s*Tj/g)].map(match=>Buffer.from(match[1],'hex').toString('latin1'));
  assert.deepEqual(runs.slice(0,10),[...raw.codice_cliente]);
  const oversized={...raw,codice_cliente:'P1010637274'};
  assert.throws(()=>Core.validatePayload(oversized),/massimo 10 caratteri/);
  await assert.rejects(generateSubentroPdf(oversized),/massimo 10 caratteri/);
});
test('subentri: manifest richiede le tre categorie, limiti e path generati dal server',()=>{
  const manifest=['identita','tessera_sanitaria','visura'].map(tipo=>({id:crypto.randomUUID(),tipo,nome:'prova.pdf',mime:'application/pdf',size:20,sha256:'a'.repeat(64),storage_path:'../../altro'}));
  const result=validateManifest(manifest,'2026/test');assert.match(result[0].storage_path,/^2026\/test\/allegati\//);
  assert.throws(()=>validateManifest(manifest.slice(0,2),'test'),/Allega/);
  assert.throws(()=>validateManifest(manifest.map((x,i)=>i===2?{...x,tipo:'identita'}:x),'test'),/Visura camerale/);
  assert.throws(()=>validateManifest(manifest.map(x=>({...x,size:5*1024*1024})),'test'),/4 MiB/);
});
test('subentri: standard ammette solo manifest vuoto e le modalità devono essere valide',()=>{
  assert.equal(Core.validateMode('standard'),'standard');assert.equal(Core.validateMode('invia_pratica'),'invia_pratica');
  for(const mode of [undefined,null,'','altro'])assert.throws(()=>Core.validateMode(mode),/Scegli Invia pratica/);
  assert.deepEqual(validateManifest([],'2026/test','standard'),[]);
  for(const manifest of [undefined,null,[{tipo:'visura'}]])assert.throws(()=>validateManifest(manifest,'2026/test','standard'),/non prevede allegati/);
});

function memoryStore({anagrafiche=[],searchError=false}={}) {
  const rows=new Map(),files=new Map();const mutations=[],finalizations=[];let failSigning=false,failFinalization=false;
  class Query {
    constructor(table){this.table=table;this.filters=[];this.operation='select';this.columns='*';}
    select(columns='*',opts={}){this.columns=columns;this.count=opts.count;return this;}
    eq(key,value){this.filters.push(row=>row[key]===value);return this;}
    in(key,values){this.filters.push(row=>values.includes(row[key]));return this;}
    ilike(key,value){this.filters.push(row=>String(row[key]||'').toUpperCase()===value.toUpperCase());return this;}
    order(){return this;}
    range(from,to){this.rangeValues=[from,to];return this;}
    limit(){return this;}
    maybeSingle(){this.one=true;return this;}
    insert(value){this.operation='insert';this.value=value;return this;}
    update(value){this.operation='update';this.value=value;return this;}
    then(resolve,reject){return Promise.resolve().then(()=>this.exec()).then(resolve,reject);}
    exec(){
      if(this.table==='anagrafica')return searchError?{error:{code:'query_failed'}}:{data:anagrafiche.filter(row=>this.filters.every(filter=>filter(row))),error:null};
      if(this.operation==='insert') {
        if(rows.has(this.value.id))return {error:{code:'23505'}};
        rows.set(this.value.id,{...clone(this.value),created_at:'2026-10-18T10:00:00Z'});mutations.push('insert');return {data:null,error:null};
      }
      const matches=[...rows.values()].filter(row=>this.filters.every(filter=>filter(row)));
      if(this.operation==='update'){matches.forEach(row=>Object.assign(row,clone(this.value)));mutations.push('update');return {data:null,error:null};}
      let values=matches.map(row=>this.columns==='*'?clone(row):Object.fromEntries(this.columns.split(',').map(key=>[key.trim(),row[key.trim()]])));
      const count=values.length;if(this.rangeValues)values=values.slice(this.rangeValues[0],this.rangeValues[1]+1);
      return {data:this.one?(values[0]||null):values,count,error:null};
    }
  }
  const supabase={from:table=>new Query(table),async rpc(name,args) {
    assert.equal(name,'subentri_finalizza_con_anagrafiche');
    finalizations.push(args);
    if(failFinalization)return {error:{code:'transaction_failed'}};
    const row=rows.get(args.p_id);
    assert.equal(row.created_by,args.p_operatore);
    assert.notEqual(row.tipo,Core.TYPE_1928);
    const kind=row.tipo.slice('mobile_'.length).replaceAll('_','-')+(row.mortis_causa?'-mortis-causa':'');
    Object.assign(row,{stato:'generato',storage_path:`${row.storage_prefix}/subentro.pdf`,nome_file:`subentro-${kind}-${row.id}.pdf`,
      pdf_sha256:args.p_pdf_sha256,template_versione:args.p_template_versione,numero_pagine:args.p_numero_pagine});
    mutations.push('update');
    return {error:null};
  },storage:{from:bucket=>({
    async upload(path,bytes){assert.equal(bucket,'subentri-files');if(files.has(path))return {error:{message:'The resource already exists'}};files.set(path,Buffer.from(bytes));return {error:null};},
    async download(path){const value=files.get(path);return value?{data:new Blob([value]),error:null}:{data:null,error:{message:'not found'}};},
    async createSignedUrl(path){return failSigning?{error:{message:'temporary failure'}}:{data:{signedUrl:`https://storage.example/${path}?token=test`},error:null};}
  })}};
  return {rows,files,mutations,finalizations,supabase,setFailSigning:value=>{failSigning=value;},
    setFailFinalization:value=>{failFinalization=value;}};
}
async function request(store,body,{user=owner,method='POST',query={},denied=false}={}) {
  const result=await handle({httpMethod:method,body:JSON.stringify(body||{}),headers:{},queryStringParameters:query},{requireAuth:async()=>denied?{ok:false,status:401,error:'Sessione richiesta'}:{ok:true,user:{id:user},profilo:{nome:'Operatore Test'}},getAdminClient:()=>store.supabase});
  return {status:result.statusCode,...JSON.parse(result.body)};
}
async function draft(store) {
  const doc=await PDFDocument.create();doc.addPage();const bytes=Buffer.from(await doc.save());
  const manifest=['identita','tessera_sanitaria','visura'].map(tipo=>({id:crypto.randomUUID(),tipo,nome:'test.pdf',mime:'application/pdf',size:bytes.length,sha256:hash(bytes)}));
  const body={action:'create',id,subentro:sample(),documenti:manifest};assert.equal((await request(store,body)).status,200);
  return {body,bytes,row:store.rows.get(id)};
}
function multipart(row,entry,bytes) {
  const boundary='mirox-boundary';const start=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="id"\r\n\r\n${row.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="document_id"\r\n\r\n${entry.id}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`);
  return {httpMethod:'POST',headers:{'content-type':`multipart/form-data; boundary=${boundary}`},body:Buffer.concat([start,bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]).toString('base64'),isBase64Encoded:true};
}
async function upload(store,event,user=owner) {const result=await handle(event,{requireAuth:async()=>({ok:true,user:{id:user},profilo:{nome:'Test'}}),getAdminClient:()=>store.supabase});return {status:result.statusCode,...JSON.parse(result.body)};}

test('subentri: standard genera e archivia solo il PDF senza upload, con retry e storico',async()=>{
  const store=memoryStore();const body={action:'create',id,subentro:sample(),modalita_compilazione:'standard',documenti:[]};
  assert.equal((await request(store,body)).status,200);assert.equal((await request(store,body)).status,200);
  assert.equal(store.rows.get(id).modalita_compilazione,'standard');assert.equal(store.files.size,0);
  assert.equal((await request(store,{action:'finalize',id},{user:other})).status,404);
  const result=await request(store,{action:'finalize',id});assert.equal(result.status,200);assert.equal(result.subentro.modalita_compilazione,'standard');assert.equal(result.subentro.numero_pagine,2);
  assert.equal((await request(store,{action:'finalize',id})).status,200);assert.equal(store.files.size,1);assert.equal(store.rows.size,1);
  const list=await request(store,null,{method:'GET'});assert.equal(list.subentri[0].modalita_compilazione,'standard');
  assert.deepEqual((await request(store,{action:'documents',id})).documenti,[]);
  assert.equal((await request(store,{action:'duplicate_data',id})).subentro.modalita_compilazione,undefined);
});
test('subentri: invia pratica richiede i documenti e la modalità non può cambiare nei retry o finalize',async()=>{
  const store=memoryStore();const base={action:'create',id,subentro:sample(),documenti:[]};
  assert.equal((await request(store,{...base,modalita_compilazione:'invia_pratica'})).status,400);
  assert.equal((await request(store,{...base,modalita_compilazione:'altro'})).status,400);
  assert.equal((await request(store,{...base,modalita_compilazione:null})).status,400);assert.equal(store.rows.size,0);
  const {body}=await draft(store);assert.equal(store.rows.get(id).modalita_compilazione,'invia_pratica');
  assert.equal((await request(store,{...body,modalita_compilazione:'invia_pratica'})).status,200);
  assert.equal((await request(store,{...base,modalita_compilazione:'standard'})).status,409);
  assert.equal((await request(store,{action:'finalize',id,modalita_compilazione:'standard'})).status,409);assert.equal(store.files.size,0);
  store.rows.get(id).documenti=[];
  assert.equal((await request(store,{action:'finalize',id})).status,400);assert.equal(store.rows.get(id).stato,'bozza');
});
test('subentri: standard rifiuta documenti e upload diretti anche con richiesta forgiata',async()=>{
  const store=memoryStore();const {body,bytes}=await draft(store);
  const standardId=crypto.randomUUID();const standard={...body,id:standardId,modalita_compilazione:'standard'};
  assert.equal((await request(store,standard)).status,400);assert.equal(store.rows.size,1);
  assert.equal((await request(store,{...standard,documenti:[]})).status,200);
  assert.equal((await upload(store,multipart(store.rows.get(standardId),body.documenti[0],bytes))).status,400);assert.equal(store.files.size,0);
});
test('subentri: tutti i dati richiedono auth prima di leggere o scrivere',async()=>{
  const store=memoryStore();for(const body of [{action:'create'},{action:'finalize',id},{action:'signed_url',id}])assert.equal((await request(store,body,{denied:true})).status,401);assert.equal(store.rows.size,0);assert.equal(store.files.size,0);
});
test('subentri: creazione idempotente, protezione della bozza e payload immutabile',async()=>{
  const store=memoryStore();const {body}=await draft(store);
  assert.equal((await request(store,body)).status,200);assert.equal(store.rows.size,1);
  assert.equal((await request(store,body,{user:other})).status,403);
  assert.equal((await request(store,{...body,subentro:{...body.subentro,cedente_nome:'Altro'}})).status,409);
  assert.equal(store.mutations.length,1);
});
test('subentri: nessun PDF nello storico prima del caricamento completo e verificato',async()=>{
  const store=memoryStore();await draft(store);
  assert.equal((await request(store,{action:'finalize',id})).status,409);assert.equal(store.rows.get(id).stato,'bozza');
  const list=await request(store,null,{method:'GET'});assert.equal(list.subentri.length,0);
  assert.equal((await request(store,{action:'signed_url',id})).status,404);
});
test('subentri: upload ripetibile, rifiuta altri operatori e byte diversi dal manifest',async()=>{
  const store=memoryStore();const {bytes,row}=await draft(store);const entry=row.documenti[0];const event=multipart(row,entry,bytes);
  assert.equal((await upload(store,event,other)).status,404);assert.equal(store.files.size,0);
  assert.equal((await upload(store,event)).status,200);assert.equal((await upload(store,event)).status,200);assert.equal(store.files.size,1);
  assert.equal((await upload(store,multipart(row,entry,Buffer.from('%PDF-falso')))).status,400);
  await assert.rejects(validateFile({size:8,buffer:Buffer.from('FAKEFAKE'),mime:'image/png'},{size:8,sha256:hash(Buffer.from('FAKEFAKE')),mime:'image/png'}),/PNG/);
});
test('subentri: flusso completo e retry finale producono una sola pratica con documenti protetti',async()=>{
  const store=memoryStore();const {bytes,row}=await draft(store);
  for(const entry of row.documenti)assert.equal((await upload(store,multipart(row,entry,bytes))).status,200);
  const result=await request(store,{action:'finalize',id});assert.equal(result.status,200);assert.equal(result.subentro.numero_pagine,2);assert.equal(store.files.size,4);assert.equal(store.rows.get(id).stato,'generato');
  const retry=await request(store,{action:'finalize',id});assert.equal(retry.status,200);assert.equal(store.files.size,4);
  assert.equal(store.finalizations.length,1);
  const list=await request(store,null,{method:'GET'});assert.equal(list.subentri.length,1);assert.equal(list.subentri[0].dati_compilazione,undefined);assert.equal(list.subentri[0].documenti,undefined);
  const docs=await request(store,{action:'documents',id});assert.equal(docs.documenti.length,3);assert.equal(docs.documenti[0].storage_path,undefined);
  const link=await request(store,{action:'signed_url',id,document_id:row.documenti[0].id});assert.match(link.signed_url,/token=test/);
  assert.equal((await request(store,{action:'signed_url',id,document_id:crypto.randomUUID()})).status,404);
  const duplicate=await request(store,{action:'duplicate_data',id});assert.equal(duplicate.subentro.cedente_nome,'LUCA');assert.equal(duplicate.documenti,undefined);
});
test('subentri: se il censimento fallisce la pratica resta in bozza e il retry riusa il PDF',async()=>{
  const store=memoryStore();
  const body={action:'create',id,subentro:{...sample(),codice_cliente:'w3.01234/#'},modalita_compilazione:'standard',documenti:[]};
  assert.equal((await request(store,body)).status,200);
  assert.equal(store.finalizations.length,0);
  store.setFailFinalization(true);
  assert.equal((await request(store,{action:'finalize',id})).status,500);
  assert.equal(store.rows.get(id).stato,'bozza');
  assert.equal((await request(store,null,{method:'GET'})).subentri.length,0);
  assert.equal(store.files.size,1);
  const [storedPdf]=store.files.values();
  assert.equal(store.finalizations[0].p_pdf_sha256,hash(storedPdf));
  store.setFailFinalization(false);
  assert.equal((await request(store,{action:'finalize',id})).status,200);
  assert.equal(store.rows.get(id).stato,'generato');
  assert.equal(store.files.size,1);
  assert.deepEqual(store.finalizations[1],store.finalizations[0]);
});
test('subentri: il retry rifiuta un PDF diverso da quello della stessa bozza',async()=>{
  const store=memoryStore();
  const body={action:'create',id,subentro:sample(1),modalita_compilazione:'standard',documenti:[]};
  assert.equal((await request(store,body)).status,200);
  const row=store.rows.get(id);
  const path=`${row.storage_prefix}/subentro.pdf`;
  const pdf=await generateSubentroPdf(body.subentro,{createdAt:row.created_at});
  store.files.set(path,Buffer.from('%PDF-non-corrispondente'));
  assert.equal((await request(store,{action:'finalize',id})).status,409);
  assert.equal(store.finalizations.length,0);
  store.files.set(path,pdf.buffer);
  assert.equal((await request(store,{action:'finalize',id})).status,200);
  assert.equal(store.finalizations[0].p_pdf_sha256,hash(pdf.buffer));
  assert.deepEqual(store.files.get(path),pdf.buffer);
});
test('subentri: codice oltre dieci rifiutato in creazione e nelle bozze precedenti, storico accessibile',async()=>{
  const store=memoryStore();
  const body={action:'create',id,subentro:sample(1),modalita_compilazione:'standard',documenti:[]};
  const longCode='P1010637274';
  for(const mode of ['standard','invia_pratica']) {
    const result=await request(store,{...body,modalita_compilazione:mode,subentro:{...body.subentro,codice_cliente:longCode}});
    assert.equal(result.status,400);
    assert.match(result.error,/massimo 10 caratteri/);
  }
  assert.equal(store.rows.size,0);
  assert.equal((await request(store,body)).status,200);
  const row=store.rows.get(id);
  row.dati_compilazione.codice_cliente=longCode;
  const result=await request(store,{action:'finalize',id});
  assert.equal(result.status,400);
  assert.match(result.error,/massimo 10 caratteri/);
  assert.equal(store.files.size,0);
  assert.equal(store.finalizations.length,0);
  assert.equal(row.stato,'bozza');

  Object.assign(row,{stato:'generato',storage_path:`${row.storage_prefix}/subentro.pdf`});
  assert.equal((await request(store,{action:'signed_url',id})).status,200);
  const duplicate=await request(store,{action:'duplicate_data',id});
  assert.equal(duplicate.subentro.codice_cliente,longCode);
});
test('subentri: un errore signed URL non trasforma un salvataggio riuscito in un duplicato',async()=>{
  const store=memoryStore();const {bytes,row}=await draft(store);for(const entry of row.documenti)await upload(store,multipart(row,entry,bytes));
  store.setFailSigning(true);const result=await request(store,{action:'finalize',id});assert.equal(result.status,200);assert.equal(result.signed_url,null);assert.equal(store.rows.size,1);
});
test('subentri: finalizzazione verifica il checksum anche di un allegato già caricato',async()=>{
  const store=memoryStore();const {bytes,row}=await draft(store);for(const entry of row.documenti)await upload(store,multipart(row,entry,bytes));
  store.files.set(row.documenti[0].storage_path,Buffer.from('%PDF-corrotto'));
  assert.equal((await request(store,{action:'finalize',id})).status,409);assert.equal(store.rows.get(id).stato,'bozza');
});

test('subentri: ricerche distinte per cluster e fallimento DB bloccante',async()=>{
  const rows=[{id:owner,cluster:'Business',cf_piva:'00000000000',ragione_sociale:'Azienda Test',nome_referente:'Luca Esempio'},{id:other,cluster:'Consumer',cf_piva:'CMPGLI90A41L781X',ragione_sociale:'Giulia Campione'}];
  const store=memoryStore({anagrafiche:rows});
  const cedente=await request(store,null,{method:'GET',query:{action:'search_anagrafica',ruolo:'cedente',q:'00000000000'}});
  assert.equal(cedente.anagrafiche.length,1);assert.equal(cedente.anagrafiche[0].cluster,'business');assert.equal(cedente.anagrafiche[0].prefill.nome,'Luca');
  const subentrante=await request(store,null,{method:'GET',query:{action:'search_anagrafica',ruolo:'subentrante',q:'cmpgli90a41l781x'}});
  assert.equal(subentrante.anagrafiche.length,1);assert.equal(subentrante.anagrafiche[0].cf_piva,'CMPGLI90A41L781X');
  const broken=await request(memoryStore({searchError:true}),null,{method:'GET',query:{action:'search_anagrafica',ruolo:'cedente',q:'00000000000'}});
  assert.equal(broken.status,500);assert.equal(broken.anagrafiche,undefined);assert.doesNotMatch(broken.error,/query_failed/);
});
test('subentri: IBAN estero e professionista su PDF, limiti e caratteri non stampabili',async()=>{
  const pdf=await generateSubentroPdf({...sample(1),cedente_tipo:'professionista',iban:'DE89370400440532013000'});
  const document=await PDFDocument.load(pdf.buffer);const text=drawnText(normalizedText(document,0));assert.match(text,/DE89370400440532013000/);assert.doesNotMatch(text,/AZIENDA ESEMPIO/);
  assert.throws(()=>Core.validatePayload({...sample(),cedente_nome:'PROVA\u{1f600}'}),/caratteri non supportati/);
  assert.throws(()=>Core.validatePayload(sample(101)),/da 1 a 100/);
  assert.equal(Core.validatePayload({...sample(),data:'2030-01-01'}).data,'2030-01-01');
});
test('subentri: multipart richiede un solo file e rifiuta dimensioni oltre limite',async()=>{
  await assert.rejects(readMultipart({body:Buffer.alloc(4*1024*1024+65537).toString('base64'),isBase64Encoded:true,headers:{'content-type':'multipart/form-data; boundary=test'}}),/4 MiB/);
  await assert.rejects(readMultipart({body:'bad',headers:{'content-type':'multipart/form-data'}}),/multipart non valido/);
});

test('subentri: ricerca cedente solo P.IVA completa e subentrante solo CF personale',()=>{
  assert.equal(Core.validateSearchIdentifier('cedente',' 00000000000 '),'00000000000');
  assert.equal(Core.validateSearchIdentifier('subentrante',' cmpgli90a41l781x '),'CMPGLI90A41L781X');
  assert.equal(Core.validateSearchIdentifier('subentrante','CMPGLIVLARMLTSMX'),'CMPGLIVLARMLTSMX');
  for(const value of ['CMPGLI90A41L781X','AZIENDA TEST','0000','0000000000%','000000000000'])assert.throws(()=>Core.validateSearchIdentifier('cedente',value),/partita IVA completa/);
  for(const value of ['00000000000','0000000000000000','GIULIA CAMPIONE','CMPGLI90A41L781','CMPGLI90Z41L781X'])assert.throws(()=>Core.validateSearchIdentifier('subentrante',value),/codice fiscale personale completo/);
});
test('subentri: la Function rifiuta identificativi del ruolo sbagliato prima di interrogare il CRM',async()=>{
  let queried=false;
  const dependencies={requireAuth:async()=>({ok:true,user:{id:owner},profilo:{nome:'Test'}}),getAdminClient:()=>({from(){queried=true;throw new Error('Non deve interrogare il CRM');}})};
  for(const [ruolo,q] of [['cedente','CMPGLI90A41L781X'],['cedente','Azienda'],['subentrante','00000000000'],['subentrante','0000000000000000']]) {
    const response=await handle({httpMethod:'GET',queryStringParameters:{action:'search_anagrafica',ruolo,q}},dependencies);
    assert.equal(response.statusCode,400);assert.equal(queried,false);
  }
});
test('subentri: ricerca esatta senza corrispondenza non restituisce altre P.IVA o CF',async()=>{
  const store=memoryStore({anagrafiche:[{id:owner,cluster:'Business',cf_piva:'00000000000',ragione_sociale:'Azienda Test'}]});
  const result=await request(store,null,{method:'GET',query:{action:'search_anagrafica',ruolo:'cedente',q:'00000000001'}});
  assert.equal(result.status,200);assert.deepEqual(result.anagrafiche,[]);
});

function samplePrivate(mortisCausa, count=4) {
  return {...sample(count), tipo:Core.PRIVATE_TYPE, mortis_causa:mortisCausa,
    dichiarazione_mortis:'Dichiaro che il cedente Luca Esempio è deceduto a Legnago il 15/10/2026.',
    dichiarante_domicilio_comune:'Cerea', dichiarante_domicilio_provincia:'VR',
    dichiarante_domicilio_via:'Via Esempio', dichiarante_domicilio_civico:'10'};
}

test('subentri tra privati: scelta esplicita, due CF distinti e soli dati pertinenti',()=>{
  const ordinary=Core.validatePayload(samplePrivate(false));
  assert.equal(ordinary.mortis_causa,false);
  for(const key of ['cedente_tipo','cedente_partita_iva','cedente_ragione_sociale','dichiarazione_mortis']) {
    assert.equal(Object.hasOwn(ordinary,key),false);
  }
  for(const value of [undefined,'true',null]) assert.throws(()=>Core.validatePayload(samplePrivate(value)),/Indica Sì oppure No/);
  assert.throws(()=>Core.validatePayload({...samplePrivate(false),cedente_codice_fiscale:'00000000000'}),/Codice fiscale/);
  assert.throws(()=>Core.validatePayload({...samplePrivate(false),cedente_codice_fiscale:ordinary.subentrante_codice_fiscale}),/codici fiscali diversi/);
  assert.throws(()=>Core.validatePayload({...samplePrivate(true),dichiarazione_mortis:''}),/Testo della dichiarazione.*obbligatorio/);
  assert.throws(()=>Core.validatePayload(samplePrivate(true,5)),/da 1 a 4/);
  assert.equal(Core.validatePayload({...samplePrivate(true),cedente_telefono:''}).cedente_telefono,'');
  assert.equal(Core.validatePayload(samplePrivate(false,5)).numeri.length,5);
});

test('subentri tra privati: dichiarazione compilata come seconda pagina soltanto per mortis causa',async()=>{
  const createdAt='2026-10-18T10:00:00Z';
  const ordinary=await generateSubentroPdf(samplePrivate(false),{createdAt});
  const mortis=await generateSubentroPdf(samplePrivate(true),{createdAt});
  const pdf=await PDFDocument.load(mortis.buffer);
  assert.equal(ordinary.pageCount,1);
  assert.equal(mortis.pageCount,2);
  assert.equal(pdf.getPageCount(),2);
  assert.deepEqual(pdf.getPages().map(page=>page.node.Annots()?.size()||0),[0,0]);
  assert.match(drawnText(normalizedText(pdf,0)),/LUCAESEMPIO/);
  assert.doesNotMatch(drawnText(normalizedText(pdf,0)),/AZIENDA ESEMPIO SRL/);
  const declaration=drawnText(normalizedText(pdf,1));
  assert.match(declaration,/CAMPIONEGIULIAVERONAVR01\/01\/1990/);
  assert.match(declaration,/DICHIARO CHE IL CEDENTE LUCA ESEMPIO È DECEDUTO A LEGNAGO IL 15\/10\/2026/);
  assert.match(declaration,/CEREAVRVIA ESEMPIO10/);
  assert.deepEqual(mortis.buffer,(await generateSubentroPdf(samplePrivate(true),{createdAt})).buffer);
  await assert.rejects(generateSubentroPdf({...samplePrivate(true),dichiarazione_mortis:'W '.repeat(270)}),/sei righe disponibili/);
});

test('subentri tra privati: il cedente si cerca in Consumer/Turista con il CF',async()=>{
  const q=sample().cedente_codice_fiscale;
  const store=memoryStore({anagrafiche:[
    {id:owner,cluster:'Turista',cf_piva:q,nome_referente:'Luca Esempio'},
    {id:other,cluster:'Business',cf_piva:q,nome_referente:'Business da escludere'}
  ]});
  const query={action:'search_anagrafica',tipo:Core.PRIVATE_TYPE,ruolo:'cedente',q:q.toLowerCase()};
  const result=await request(store,null,{method:'GET',query});
  assert.equal(result.status,200);
  assert.deepEqual(result.anagrafiche.map(item=>item.id),[owner]);
  assert.equal(result.anagrafiche[0].prefill.codice_fiscale,q);
  assert.equal((await request(store,null,{method:'GET',query:{...query,q:'00000000000'}})).status,400);
});

test('subentri tra privati: invia pratica archivia il certificato separato e lo storico mostra mortis causa',async()=>{
  const store=memoryStore();
  const file=await PDFDocument.create();
  file.addPage();
  const bytes=Buffer.from(await file.save());
  const manifest=['identita_cedente','identita_cessionario','certificato_morte'].map(tipo=>({
    id:crypto.randomUUID(),tipo,nome:'test.pdf',mime:'application/pdf',size:bytes.length,sha256:hash(bytes)
  }));
  const body={action:'create',id,subentro:samplePrivate(true),modalita_compilazione:'invia_pratica',documenti:manifest};
  assert.equal((await request(store,{...body,documenti:manifest.slice(0,2)})).status,400);
  assert.equal((await request(store,body)).status,200);
  assert.equal((await request(store,{...body,subentro:samplePrivate(false),documenti:manifest.slice(0,2)})).status,409);
  const row=store.rows.get(id);
  assert.equal(row.cedente_partita_iva,null);
  assert.equal(row.cedente_codice_fiscale,body.subentro.cedente_codice_fiscale);
  for(const entry of row.documenti.slice(0,2)) assert.equal((await upload(store,multipart(row,entry,bytes))).status,200);
  assert.equal((await request(store,{action:'finalize',id})).status,409);
  assert.equal((await upload(store,multipart(row,row.documenti[2],bytes))).status,200);
  const generated=await request(store,{action:'finalize',id});
  assert.equal(generated.status,200);
  assert.equal(generated.subentro.numero_pagine,2);
  assert.match(generated.subentro.nome_file,/privato-privato-mortis-causa/);
  assert.equal((await request(store,{action:'finalize',id})).status,200);
  assert.equal(store.files.size,4);
  const listing=await request(store,null,{method:'GET'});
  assert.equal(listing.subentri[0].mortis_causa,true);
  assert.equal(listing.subentri[0].cedente_codice_fiscale,row.cedente_codice_fiscale);
  assert.equal(listing.subentri[0].dati_compilazione,undefined);
  const duplicate=(await request(store,{action:'duplicate_data',id})).subentro;
  assert.equal(duplicate.tipo,Core.PRIVATE_TYPE);
  assert.equal(duplicate.mortis_causa,undefined);
  assert.equal(duplicate.dichiarazione_mortis,undefined);
  assert.equal(duplicate.dichiarante_domicilio_comune,undefined);

  const standardId=crypto.randomUUID();
  assert.equal((await request(store,{...body,id:standardId,modalita_compilazione:'standard',documenti:[]})).status,200);
  const standard=await request(store,{action:'finalize',id:standardId});
  assert.equal(standard.status,200);
  assert.equal(standard.subentro.numero_pagine,2);
  assert.deepEqual((await request(store,{action:'documents',id:standardId})).documenti,[]);

  const ordinaryId=crypto.randomUUID();
  const ordinary={...body,id:ordinaryId,subentro:samplePrivate(false),documenti:manifest.slice(0,2)};
  assert.equal((await request(store,{...ordinary,documenti:manifest})).status,400);
  assert.equal((await request(store,ordinary)).status,200);
  const ordinaryRow=store.rows.get(ordinaryId);
  for(const entry of ordinaryRow.documenti) assert.equal((await upload(store,multipart(ordinaryRow,entry,bytes))).status,200);
  const ordinaryPdf=await request(store,{action:'finalize',id:ordinaryId});
  assert.equal(ordinaryPdf.status,200);
  assert.equal(ordinaryPdf.subentro.numero_pagine,1);
});

function sampleToBusiness(mortisCausa, tipo='impresa') {
  return {...samplePrivate(mortisCausa),tipo:Core.TO_BUSINESS_TYPE,subentrante_tipo:tipo,
    subentrante_partita_iva:'01234567890',subentrante_ragione_sociale:'Officina Esempio SRL',
    subentrante_telefono_impresa:'0442123456',subentrante_sede_via:'Via Artigiani',
    subentrante_sede_civico:'27',subentrante_sede_localita:'Zona Industriale',
    subentrante_sede_cap:'37053',subentrante_sede_comune:'Cerea',subentrante_sede_provincia:'VR'};
}

test('subentri Privato a Microbusiness: identifica il privato per CF e il cessionario per P.IVA',async()=>{
  const cedente = sample().cedente_codice_fiscale;
  const partitaIva = sampleToBusiness(false).subentrante_partita_iva;
  const store = memoryStore({anagrafiche:[
    {id:owner,cluster:'Consumer',cf_piva:cedente,nome_referente:'Luca Esempio'},
    {id:other,cluster:'Business',cf_piva:partitaIva,ragione_sociale:'Officina Esempio SRL',via:'Via Artigiani'},
    {id,cluster:'Consumer',cf_piva:partitaIva,ragione_sociale:'Da escludere'}
  ]});
  const find = (ruolo,q) => request(store,null,{method:'GET',query:{action:'search_anagrafica',tipo:Core.TO_BUSINESS_TYPE,ruolo,q}});
  assert.deepEqual((await find('cedente',cedente)).anagrafiche.map(item=>item.id),[owner]);
  const recipient = await find('subentrante',partitaIva);
  assert.deepEqual(recipient.anagrafiche.map(item=>item.id),[other]);
  assert.equal(recipient.anagrafiche[0].prefill.partita_iva,partitaIva);
  assert.equal(recipient.anagrafiche[0].prefill.via,'Via Artigiani');
  assert.equal((await find('cedente',partitaIva)).status,400);
  assert.equal((await find('subentrante',cedente)).status,400);
});

test('subentri Privato a Microbusiness: compila Partita IVA e sede nel blocco pertinente',async()=>{
  const business = sampleToBusiness(false);
  assert.throws(()=>Core.validatePayload({...business,mortis_causa:undefined}),/Indica Sì oppure No/);
  assert.throws(()=>Core.validatePayload({...business,subentrante_tipo:''}),/Per il cessionario/);
  assert.throws(()=>Core.validatePayload({...business,subentrante_partita_iva:business.subentrante_codice_fiscale}),/Partita IVA del cessionario/);
  assert.throws(()=>Core.validatePayload({...business,subentrante_sede_cap:''}),/CAP della sede legale/);
  assert.equal(Core.validatePayload({...business,cedente_codice_fiscale:business.subentrante_codice_fiscale}).subentrante_partita_iva,business.subentrante_partita_iva);
  assert.throws(()=>Core.validatePayload({...business,mortis_causa:true,cedente_codice_fiscale:business.subentrante_codice_fiscale}),/codici fiscali diversi/);
  const companyCase={...sampleToBusiness(true),pagamento:'bollettino'};
  const personCase={...sampleToBusiness(false,'professionista'),pagamento:'bollettino'};
  const company=await generateSubentroPdf(companyCase);
  const person=await generateSubentroPdf(personCase);
  assert.equal(company.pageCount,2);
  assert.equal(person.pageCount,1);
  const companyPdf=await PDFDocument.load(company.buffer);
  const companyText=drawnText(normalizedText(companyPdf,0));
  const personText=drawnText(normalizedText(await PDFDocument.load(person.buffer),0));
  assert.match(companyText,/OFFICINA ESEMPIO SRL012345678900442123456VIA ARTIGIANI27ZONA INDUSTRIALE37053CEREAVR/);
  assert.match(personText,/01234567890/);
  assert.doesNotMatch(personText,/OFFICINA ESEMPIO SRL|VIA ARTIGIANI/);
  assert.equal(Object.hasOwn(person.data,'subentrante_sede_via'),false);
  const declarant=drawnText(normalizedText(companyPdf,1));
  assert.match(declarant,/CAMPIONEGIULIAVERONAVR01\/01\/1990LEGNAGOVRVIA DELLA PROVA/);
  assert.doesNotMatch(declarant,/OFFICINA ESEMPIO SRL|VIA ARTIGIANI/);
});

test('subentri Privato a Microbusiness: visura obbligatoria, certificato per mortis causa e storico con P.IVA',async()=>{
  const store=memoryStore();
  const attachment=await PDFDocument.create();
  attachment.addPage();
  const bytes=Buffer.from(await attachment.save());
  const manifest=['identita_cedente','identita_cessionario','visura','certificato_morte'].map(tipo=>({
    id:crypto.randomUUID(),tipo,nome:'test.pdf',mime:'application/pdf',size:bytes.length,sha256:hash(bytes)
  }));
  for(const mortis of [false,true]) {
    const subentro=sampleToBusiness(mortis);
    const rowId=crypto.randomUUID();
    const documenti=mortis?manifest:manifest.slice(0,3);
    const body={action:'create',id:rowId,subentro,modalita_compilazione:'invia_pratica',documenti};
    assert.match((await request(store,{...body,documenti:documenti.filter(entry=>entry.tipo!=='visura')})).error,/Visura camerale/);
    if(mortis) assert.match((await request(store,{...body,documenti:manifest.slice(0,3)})).error,/Certificato di morte/);
    else assert.equal((await request(store,{...body,documenti:manifest})).status,400);
    assert.equal((await request(store,body)).status,200);
    assert.equal((await request(store,body)).status,200);
    const row=store.rows.get(rowId);
    for(const entry of row.documenti) assert.equal((await upload(store,multipart(row,entry,bytes))).status,200);
    const result=await request(store,{action:'finalize',id:rowId});
    assert.equal(result.status,200);
    assert.equal(result.subentro.numero_pagine,mortis?2:1);
    assert.match(result.subentro.nome_file,new RegExp('^subentro-privato-microbusiness'+(mortis?'-mortis-causa':'')+'-'+rowId));
    const found=(await request(store,null,{method:'GET'})).subentri.find(item=>item.id===rowId);
    assert.equal(found.subentrante_partita_iva,subentro.subentrante_partita_iva);
    assert.equal(found.subentrante_ragione_sociale,'OFFICINA ESEMPIO SRL');
    const duplicate=(await request(store,{action:'duplicate_data',id:rowId})).subentro;
    assert.equal(duplicate.subentrante_partita_iva,subentro.subentrante_partita_iva);
    assert.equal(duplicate.dichiarazione_mortis,undefined);
  }
  const extra=Array.from({length:9},(_,i)=>({...manifest[i%4],id:crypto.randomUUID()}));
  assert.throws(()=>validateManifest([...manifest,...extra],'test','invia_pratica',Core.TO_BUSINESS_TYPE,true),/massimo 12 file/);
});

function sampleBothBusiness(mortisCausa, cedenteTipo='impresa', subentranteTipo='impresa') {
  return {...sampleToBusiness(mortisCausa,subentranteTipo),tipo:Core.BUSINESS_TYPE,cedente_tipo:cedenteTipo,
    cedente_partita_iva:'10987654321'};
}

test('subentri tra Microbusiness: cerca entrambi per P.IVA nel cluster Business',async()=>{
  const input=sampleBothBusiness(false);
  const store=memoryStore({anagrafiche:[
    {id:owner,cluster:'Business',cf_piva:input.cedente_partita_iva,ragione_sociale:'Azienda Esempio SRL'},
    {id:other,cluster:'Business',cf_piva:input.subentrante_partita_iva,ragione_sociale:'Officina Esempio SRL'},
    {id,cluster:'Consumer',cf_piva:input.cedente_partita_iva,nome_referente:'Da escludere'}
  ]});
  const search=(ruolo,q)=>request(store,null,{method:'GET',query:{action:'search_anagrafica',tipo:Core.BUSINESS_TYPE,ruolo,q}});
  assert.deepEqual((await search('cedente',input.cedente_partita_iva)).anagrafiche.map(row=>row.id),[owner]);
  assert.deepEqual((await search('subentrante',input.subentrante_partita_iva)).anagrafiche.map(row=>row.id),[other]);
  assert.equal((await search('cedente',input.cedente_codice_fiscale)).status,400);
  assert.equal((await search('subentrante',input.subentrante_codice_fiscale)).status,400);
});

test('subentri tra Microbusiness: due partite IVA distinte e i due riquadri corretti nel PDF',async()=>{
  const input=sampleBothBusiness(false);
  assert.throws(()=>Core.validatePayload({...input,mortis_causa:undefined}),/Indica Sì oppure No/);
  assert.throws(()=>Core.validatePayload({...input,cedente_tipo:''}),/Seleziona impresa/);
  assert.throws(()=>Core.validatePayload({...input,subentrante_tipo:''}),/Per il cessionario/);
  assert.throws(()=>Core.validatePayload({...input,subentrante_partita_iva:input.cedente_partita_iva}),/partite IVA diverse/);
  assert.doesNotThrow(()=>Core.validatePayload({...input,subentrante_codice_fiscale:input.cedente_codice_fiscale}));
  assert.throws(()=>Core.validatePayload({...input,mortis_causa:true,subentrante_codice_fiscale:input.cedente_codice_fiscale}),/codici fiscali diversi/);
  const ordinary=await generateSubentroPdf({...sampleBothBusiness(false,'impresa','professionista'),pagamento:'bollettino'});
  const mortis=await generateSubentroPdf({...sampleBothBusiness(true,'professionista','impresa'),cedente_telefono:''});
  assert.equal(ordinary.pageCount,1);
  assert.equal(mortis.pageCount,2);
  const ordinaryText=drawnText(normalizedText(await PDFDocument.load(ordinary.buffer),0));
  assert.match(ordinaryText,/AZIENDA ESEMPIO SRL10987654321/);
  assert.match(ordinaryText,/01234567890/);
  assert.doesNotMatch(ordinaryText,/OFFICINA ESEMPIO SRL/);
  const mortisPdf=await PDFDocument.load(mortis.buffer);
  const mortisText=drawnText(normalizedText(mortisPdf,0));
  assert.match(mortisText,/SMPLCU80A01F205Q10987654321/);
  assert.match(mortisText,/OFFICINA ESEMPIO SRL01234567890/);
  assert.doesNotMatch(mortisText,/AZIENDA ESEMPIO SRL/);
  assert.match(drawnText(normalizedText(mortisPdf,1)),/CAMPIONEGIULIA/);
});

test('subentri tra Microbusiness: visure separate e certificato nel ramo mortis causa',async()=>{
  const store=memoryStore();
  const attachment=await PDFDocument.create();
  attachment.addPage();
  const bytes=Buffer.from(await attachment.save());
  const manifest=['identita_cedente','identita_cessionario','visura_cedente','visura_cessionario','certificato_morte'].map(tipo=>({
    id:crypto.randomUUID(),tipo,nome:'test.pdf',mime:'application/pdf',size:bytes.length,sha256:hash(bytes)
  }));
  for(const mortis of [false,true]) {
    const rowId=crypto.randomUUID();
    const subentro=sampleBothBusiness(mortis);
    const documenti=mortis?manifest:manifest.slice(0,4);
    const body={action:'create',id:rowId,subentro,modalita_compilazione:'invia_pratica',documenti};
    for(const [index,party] of [[2,'cedente'],[3,'cessionario']]) {
      const missing=documenti.map((entry,i)=>i===index?{...entry,tipo:'identita_cedente'}:entry);
      assert.match((await request(store,{...body,documenti:missing})).error,new RegExp('Visura camerale del '+party));
    }
    if(mortis) assert.match((await request(store,{...body,documenti:manifest.slice(0,4)})).error,/Certificato di morte/);
    else assert.equal((await request(store,{...body,documenti:manifest})).status,400);
    assert.equal((await request(store,body)).status,200);
    assert.equal((await request(store,body)).status,200);
    const row=store.rows.get(rowId);
    assert.equal(row.cedente_partita_iva,subentro.cedente_partita_iva);
    assert.equal(Object.hasOwn(row,'cedente_codice_fiscale'),false);
    for(const entry of row.documenti) assert.equal((await upload(store,multipart(row,entry,bytes))).status,200);
    const result=await request(store,{action:'finalize',id:rowId});
    assert.equal(result.status,200);
    assert.equal(result.subentro.numero_pagine,mortis?2:1);
    const listed=(await request(store,null,{method:'GET'})).subentri.find(item=>item.id===rowId);
    assert.equal(listed.cedente_partita_iva,subentro.cedente_partita_iva);
    assert.equal(listed.subentrante_partita_iva,subentro.subentrante_partita_iva);
    assert.equal(listed.mortis_causa,mortis);
    const duplicate=(await request(store,{action:'duplicate_data',id:rowId})).subentro;
    assert.equal(duplicate.tipo,Core.BUSINESS_TYPE);
    assert.equal(duplicate.mortis_causa,undefined);
    assert.equal(duplicate.dichiarazione_mortis,undefined);
  }
});

test('subentri 1928: la procedura PEC è un PDF dietro la stessa autorizzazione della Function',async()=>{
  const event={httpMethod:'GET',queryStringParameters:{action:'procedura_1928'}};
  const noDatabase=()=>{throw new Error('La procedura non deve interrogare l’archivio');};
  const denied=await handle(event,{requireAuth:async()=>({ok:false,status:403,error:'Accesso negato'}),getAdminClient:noDatabase});
  assert.equal(denied.statusCode,403);
  assert.equal(denied.isBase64Encoded,undefined);
  const response=await handle(event,{requireAuth:async()=>({ok:true}),getAdminClient:noDatabase});
  assert.equal(response.statusCode,200);
  assert.equal(response.headers['Content-Type'],'application/pdf');
  assert.equal(response.headers['Cache-Control'],'no-store');
  assert.equal(response.isBase64Encoded,true);
  assert.deepEqual(Buffer.from(response.body,'base64'),fs.readFileSync(resolveTemplatePath('procedura-invio-pec-1928.pdf')));
});

test('subentri 1928: archivia i tre gruppi verificati, senza dati del modulo né PDF generato',async()=>{
  const store=memoryStore();
  const attachment=await PDFDocument.create();
  attachment.addPage();
  const bytes=Buffer.from(await attachment.save());
  const groups=['documenti_rappresentante','visura_azienda','documenti_intestatario'];
  const manifest=groups.map(tipo=>({
    id:crypto.randomUUID(),tipo,nome:'test.pdf',mime:'application/pdf',size:bytes.length,sha256:hash(bytes)
  }));
  const body={action:'create',id,subentro:{tipo:Core.TYPE_1928},documenti:manifest,modalita_compilazione:'invia_pratica'};
  assert.equal((await request(store,{...body,modalita_compilazione:'standard',documenti:[]})).status,400);
  for(const missing of manifest) {
    assert.equal((await request(store,{...body,documenti:manifest.filter(entry=>entry!==missing)})).status,400);
  }
  assert.equal(store.rows.size,0);
  assert.equal((await request(store,{...body,subentro:{...sample(),tipo:Core.TYPE_1928,mortis_causa:true}})).status,200);
  const row=store.rows.get(id);
  assert.deepEqual(row.dati_compilazione,{tipo:Core.TYPE_1928});
  assert.deepEqual(row.numeri,[]);
  assert.equal(row.stato,'bozza');
  assert.equal((await request(store,null,{method:'GET'})).subentri.length,0);
  assert.equal((await request(store,{action:'documents',id})).status,404);
  assert.equal((await request(store,body)).status,200);
  assert.equal((await request(store,{action:'finalize',id},{user:other})).status,404);
  for(const entry of row.documenti.slice(0,2)) {
    assert.equal((await upload(store,multipart(row,entry,bytes))).status,200);
  }
  assert.equal((await request(store,{action:'finalize',id})).status,409);
  const third=row.documenti[2];
  assert.equal((await upload(store,multipart(row,third,bytes))).status,200);
  store.files.set(third.storage_path,Buffer.from('file alterato'));
  assert.equal((await request(store,{action:'finalize',id})).status,409);
  assert.equal(row.stato,'bozza');
  store.files.set(third.storage_path,bytes);
  const closed=await request(store,{action:'finalize',id});
  assert.equal(closed.status,200);
  assert.equal(closed.subentro.stato,'archiviato');
  assert.equal(store.finalizations.length,0);
  assert.equal(closed.subentro.numero_pagine,null);
  assert.equal(closed.signed_url,null);
  assert.equal(store.files.size,3);
  assert.equal((await request(store,{action:'finalize',id})).subentro.stato,'archiviato');
  assert.equal((await request(store,body)).stato,'archiviato');
  assert.equal((await upload(store,multipart(row,third,bytes))).status,409);
  const [summary]=(await request(store,null,{method:'GET'})).subentri;
  assert.equal(summary.tipo,Core.TYPE_1928);
  assert.equal(summary.cedente_nome,undefined);
  assert.equal(summary.subentrante_codice_fiscale,undefined);
  assert.deepEqual((await request(store,{action:'documents',id})).documenti.map(entry=>entry.tipo),groups);
  assert.equal((await request(store,{action:'signed_url',id})).status,404);
  assert.equal((await request(store,{action:'signed_url',id,document_id:third.id})).status,200);
  assert.equal((await request(store,{action:'duplicate_data',id})).status,400);
  assert.throws(()=>Core.validateSearchIdentifier('cedente','01234567890',Core.TYPE_1928),/solo gli allegati/);
  await assert.rejects(generateSubentroPdf({tipo:Core.TYPE_1928}),/solo gli allegati/);
});
