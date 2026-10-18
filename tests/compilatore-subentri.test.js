'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PDFDocument,PDFArray,PDFName,decodePDFRawStream}=require('pdf-lib');
const Core=require('../js/subentri-core');
const {generateSubentroPdf}=require('../netlify/functions/_lib/pdf-subentro');
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
  assert.throws(()=>Core.validatePayload({...sample(),tipo:'mobile_privato_privato'}),/non è ancora disponibile/);
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
test('subentri: manifest richiede le tre categorie, limiti e path generati dal server',()=>{
  const manifest=['identita','tessera_sanitaria','visura'].map(tipo=>({id:crypto.randomUUID(),tipo,nome:'prova.pdf',mime:'application/pdf',size:20,sha256:'a'.repeat(64),storage_path:'../../altro'}));
  const result=validateManifest(manifest,'2026/test');assert.match(result[0].storage_path,/^2026\/test\/allegati\//);
  assert.throws(()=>validateManifest(manifest.slice(0,2),'test'),/Allega/);
  assert.throws(()=>validateManifest(manifest.map((x,i)=>i===2?{...x,tipo:'identita'}:x),'test'),/Visura camerale/);
  assert.throws(()=>validateManifest(manifest.map(x=>({...x,size:5*1024*1024})),'test'),/4 MiB/);
});

function memoryStore({anagrafiche=[],searchError=false}={}) {
  const rows=new Map(),files=new Map();const mutations=[];let failSigning=false;
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
  const supabase={from:table=>new Query(table),storage:{from:bucket=>({
    async upload(path,bytes){assert.equal(bucket,'subentri-files');if(files.has(path))return {error:{message:'The resource already exists'}};files.set(path,Buffer.from(bytes));return {error:null};},
    async download(path){const value=files.get(path);return value?{data:new Blob([value]),error:null}:{data:null,error:{message:'not found'}};},
    async createSignedUrl(path){return failSigning?{error:{message:'temporary failure'}}:{data:{signedUrl:`https://storage.example/${path}?token=test`},error:null};}
  })}};
  return {rows,files,mutations,supabase,setFailSigning:value=>{failSigning=value;}};
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
  const list=await request(store,null,{method:'GET'});assert.equal(list.subentri.length,1);assert.equal(list.subentri[0].dati_compilazione,undefined);assert.equal(list.subentri[0].documenti,undefined);
  const docs=await request(store,{action:'documents',id});assert.equal(docs.documenti.length,3);assert.equal(docs.documenti[0].storage_path,undefined);
  const link=await request(store,{action:'signed_url',id,document_id:row.documenti[0].id});assert.match(link.signed_url,/token=test/);
  assert.equal((await request(store,{action:'signed_url',id,document_id:crypto.randomUUID()})).status,404);
  const duplicate=await request(store,{action:'duplicate_data',id});assert.equal(duplicate.subentro.cedente_nome,'LUCA');assert.equal(duplicate.documenti,undefined);
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
