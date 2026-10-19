'use strict';
const crypto = require('node:crypto');
const Busboy = require('busboy');
const { PDFDocument } = require('pdf-lib');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { generateSubentroPdf } = require('./_lib/pdf-subentro');
const { validatePayload, validateMode, validateSearchIdentifier, ValidationError, DOCUMENTI } = require('../../js/subentri-core');
const BUCKET = 'subentri-files';
const TABLE = 'subentri_generati';
const MAX_FILE = 4 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = {'application/pdf':'.pdf','image/jpeg':'.jpg','image/png':'.png'};
const SUMMARY = 'id, tipo, modalita_compilazione, cedente_nome, cedente_partita_iva, subentrante_nome, subentrante_cognome, subentrante_codice_fiscale, numeri, nome_file, numero_pagine, created_at, created_by_nome';
const HEADERS = {'Content-Type':'application/json','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
function response(statusCode,payload) { return {statusCode,headers:HEADERS,body:JSON.stringify(payload)}; }
function fail(message,status=400) { const error=new ValidationError(message); error.status=status; throw error; }
function uuid(value) { if(!UUID.test(String(value||''))) fail('Identificativo non valido'); return value.toLowerCase(); }
function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function checkError(result) { if(result.error) throw result.error; return result.data; }
function parseBody(event) {
  if(Buffer.byteLength(event.body||'')>200000) fail('Richiesta troppo grande');
  try { const value=JSON.parse(event.body||'{}'); if(value && typeof value==='object' && !Array.isArray(value)) return value; } catch(_) { /* errore validazione ripulito */ }
  fail('Payload JSON non valido');
}
function validateManifest(input,prefix,mode='invia_pratica') {
  validateMode(mode);
  if(mode==='standard') {
    if(!Array.isArray(input)||input.length) fail('La compilazione standard non prevede allegati');
    return [];
  }
  if(!Array.isArray(input)||input.length<3||input.length>12) fail('Allega carta d’identità, tessera sanitaria e visura (massimo 12 file)');
  const ids=new Set(); const counts={};
  const result=input.map(item=>{
    if(!item||typeof item!=='object') fail('Allegato non valido');
    const id=uuid(item.id);
    if(ids.has(id)) fail('Identificativo allegato duplicato'); ids.add(id);
    if(!Object.hasOwn(DOCUMENTI,item.tipo)) fail('Categoria allegato non valida');
    counts[item.tipo]=(counts[item.tipo]||0)+1;
    if(counts[item.tipo]>4) fail('Massimo quattro file per categoria documentale');
    if(!Object.hasOwn(TYPES,item.mime)) fail('Allega soltanto PDF, JPEG o PNG');
    if(!Number.isSafeInteger(item.size)||item.size<1||item.size>MAX_FILE) fail('Ogni allegato deve essere al massimo 4 MiB');
    if(typeof item.sha256!=='string'||!/^[a-f0-9]{64}$/.test(item.sha256)) fail('Checksum allegato non valido');
    const name=String(item.nome||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
    if(!name||name.length>180) fail('Nome allegato non valido (massimo 180 caratteri)');
    return {id,tipo:item.tipo,nome:name,mime:item.mime,size:item.size,sha256:item.sha256,storage_path:`${prefix}/allegati/${id}${TYPES[item.mime]}`};
  });
  for(const type of Object.keys(DOCUMENTI)) if(!counts[type]) fail(`Documento obbligatorio: ${DOCUMENTI[type]}`);
  return result;
}
async function ownedDraft(supabase,id,auth) {
  const data=checkError(await supabase.from(TABLE).select('*').eq('id',uuid(id)).eq('created_by',auth.user.id).maybeSingle());
  if(!data) fail('Compilazione non trovata',404);
  return data;
}
async function generatedRecord(supabase,id) {
  const row=checkError(await supabase.from(TABLE).select('*').eq('id',uuid(id)).eq('stato','generato').maybeSingle());
  if(!row) fail('Subentro non trovato',404);
  return row;
}
async function signed(supabase,path) {
  const result=checkError(await supabase.storage.from(BUCKET).createSignedUrl(path,300));
  if(!result?.signedUrl) throw new Error('Signed URL mancante');
  return result.signedUrl;
}
async function readyResponse(supabase,row) {
  let url=null;
  try {url=await signed(supabase,row.storage_path);} catch(_) { /* il salvataggio è concluso, il link può essere richiesto dallo storico */ }
  return response(200,{success:true,subentro:{id:row.id,nome_file:row.nome_file,numero_pagine:row.numero_pagine,modalita_compilazione:row.modalita_compilazione},signed_url:url});
}
async function create({supabase,auth,body}) {
  const id=uuid(body.id); const data=validatePayload(body.subentro);
  // I client già aperti prima dell'introduzione della scelta richiedono tutti gli allegati.
  const mode=validateMode(body.modalita_compilazione===undefined?'invia_pratica':body.modalita_compilazione);
  // Prima di qualsiasi scrittura, verifica anche l'effettiva stampabilità.
  await generateSubentroPdf(data);
  const existing=checkError(await supabase.from(TABLE).select('*').eq('id',id).maybeSingle());
  const prefix=existing?.storage_prefix||`${new Date().getUTCFullYear()}/${id}`;
  const documenti=validateManifest(body.documenti,prefix,mode);
  // Conserva l'hash dei retry delle bozze con documenti create dalla versione precedente.
  const hash=digest(JSON.stringify({data,documenti,...(mode==='standard'?{modalita_compilazione:mode}:{})}));
  if(existing) {
    if(existing.created_by!==auth.user.id) fail('Compilazione non disponibile',403);
    if(existing.modalita_compilazione!==mode||existing.request_sha256!==hash) fail('I dati sono cambiati: avvia una nuova compilazione',409);
    return response(200,{success:true,id,stato:existing.stato});
  }
  const row={id,tipo:data.tipo,stato:'bozza',cedente_nome:data.cedente_ragione_sociale||`${data.cedente_nome} ${data.cedente_cognome}`,cedente_partita_iva:data.cedente_partita_iva,
    subentrante_nome:data.subentrante_nome,subentrante_cognome:data.subentrante_cognome,subentrante_codice_fiscale:data.subentrante_codice_fiscale,numeri:data.numeri,
    dati_compilazione:data,documenti,modalita_compilazione:mode,request_sha256:hash,storage_prefix:prefix,created_by:auth.user.id,created_by_nome:String(auth.profilo.nome||'Operatore Mirox').slice(0,250)};
  const result=await supabase.from(TABLE).insert(row);
  if(result.error?.code==='23505') {
    const concurrent=await ownedDraft(supabase,id,auth);
    if(concurrent.modalita_compilazione!==mode||concurrent.request_sha256!==hash) fail('Compilazione già presente con dati diversi',409);
    return response(200,{success:true,id,stato:concurrent.stato});
  }
  checkError(result);
  return response(200,{success:true,id,stato:'bozza'});
}
function readMultipart(event) {
  return new Promise((resolve,reject)=>{
    const bytes=event.isBase64Encoded?Buffer.from(event.body||'','base64'):Buffer.from(event.body||'','binary');
    if(bytes.length>MAX_FILE+65536) return reject(new ValidationError('Il file supera il limite di 4 MiB'));
    let parser;
    try { parser=Busboy({headers:{'content-type':event.headers?.['content-type']||event.headers?.['Content-Type']||''},limits:{fileSize:MAX_FILE+1,files:1,fields:2,parts:4,fieldSize:100}}); } catch(_) { return reject(new ValidationError('Upload multipart non valido')); }
    const fields={}; let file=null; let invalid=false;
    parser.on('field',(name,value,info)=>{if(!['id','document_id'].includes(name)||Object.hasOwn(fields,name)||info.valueTruncated) invalid=true; fields[name]=value;});
    parser.on('file',(name,stream,info)=>{
      if(name!=='file'||file) invalid=true;
      const chunks=[]; let size=0;
      stream.on('limit',()=>{invalid=true;}); stream.on('error',reject);
      stream.on('data',chunk=>{size+=chunk.length;chunks.push(chunk);});
      stream.on('end',()=>{file={buffer:Buffer.concat(chunks),size,mime:info.mimeType};});
    });
    for(const limit of ['filesLimit','fieldsLimit','partsLimit']) parser.on(limit,()=>{invalid=true;});
    parser.on('error',()=>reject(new ValidationError('Upload multipart non valido')));
    parser.on('close',()=>{if(invalid||!file||file.size<1||file.size>MAX_FILE) reject(new ValidationError('Allegato non valido o troppo grande (massimo 4 MiB)')); else resolve({fields,file});});
    parser.end(bytes);
  });
}
async function validateFile(file,manifest) {
  if(file.size!==manifest.size||digest(file.buffer)!==manifest.sha256||file.mime!==manifest.mime) fail('Allegato diverso da quello previsto: riseleziona i documenti');
  if(manifest.mime==='application/pdf') {
    if(file.buffer.subarray(0,5).toString()!=='%PDF-') fail('Il file non è un PDF valido');
    try {const pdf=await PDFDocument.load(file.buffer);if(!pdf.getPageCount()) fail('PDF vuoto');} catch(_) {fail('PDF non leggibile o protetto da password');}
  } else if(manifest.mime==='image/jpeg') {
    if(file.buffer.length<4||!file.buffer.subarray(0,3).equals(Buffer.from([255,216,255]))) fail('Immagine JPEG non valida');
  } else if(!file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail('Immagine PNG non valida');
}
async function downloadVerified(supabase,path,hash,size) {
  const result=await supabase.storage.from(BUCKET).download(path);
  if(result.error||!result.data) fail('Allegato non disponibile: riprova il caricamento prima di generare',409);
  const bytes=Buffer.from(await result.data.arrayBuffer());
  if((size!==undefined&&bytes.length!==size)||digest(bytes)!==hash) fail('Verifica dell’allegato non riuscita: riprova il caricamento',409);
  return bytes;
}
async function upload({supabase,auth,event}) {
  const {fields,file}=await readMultipart(event);
  const row=await ownedDraft(supabase,fields.id,auth);
  if(row.stato!=='bozza') fail('Il subentro è già stato generato',409);
  if(validateMode(row.modalita_compilazione)==='standard') fail('La compilazione standard non prevede allegati');
  const entry=row.documenti.find(item=>item.id===uuid(fields.document_id));
  if(!entry) fail('Allegato non previsto');
  await validateFile(file,entry);
  const result=await supabase.storage.from(BUCKET).upload(entry.storage_path,file.buffer,{contentType:entry.mime,upsert:false,metadata:{uploaded_by:auth.user.id,subentro_id:row.id}});
  if(result.error) {
    if(!/already exists|duplicate|resource.*exists/i.test(String(result.error.message||result.error.error||''))) throw result.error;
    await downloadVerified(supabase,entry.storage_path,entry.sha256,entry.size);
  }
  return response(200,{success:true,document_id:entry.id});
}
async function finalize({supabase,auth,body}) {
  const row=await ownedDraft(supabase,body.id,auth);
  if(row.stato==='generato') return readyResponse(supabase,row);
  validateManifest(row.documenti,row.storage_prefix,row.modalita_compilazione);
  for(const entry of row.documenti) await downloadVerified(supabase,entry.storage_path,entry.sha256,entry.size);
  const pdf=await generateSubentroPdf(row.dati_compilazione,{createdAt:row.created_at});
  if(pdf.buffer.length>MAX_FILE) fail('Il PDF generato supera il limite del documento');
  const path=`${row.storage_prefix}/subentro.pdf`;
  const hash=digest(pdf.buffer);
  const result=await supabase.storage.from(BUCKET).upload(path,pdf.buffer,{contentType:'application/pdf',upsert:false,metadata:{created_by:auth.user.id,subentro_id:row.id}});
  if(result.error) {
    if(!/already exists|duplicate|resource.*exists/i.test(String(result.error.message||result.error.error||''))) throw result.error;
    await downloadVerified(supabase,path,hash,pdf.buffer.length);
  }
  const filename=`subentro-microbusiness-privato-${row.id}.pdf`;
  checkError(await supabase.from(TABLE).update({stato:'generato',storage_path:path,nome_file:filename,pdf_sha256:hash,template_versione:pdf.templateVersion,numero_pagine:pdf.pageCount,generato_at:new Date().toISOString()}).eq('id',row.id).eq('stato','bozza').eq('created_by',auth.user.id));
  return readyResponse(supabase,await ownedDraft(supabase,row.id,auth));
}
function buildAnagraficaResult(row) {
  const business=String(row.cluster).toLowerCase()==='business'||/^\d{11}$/.test(row.cf_piva||'');
  const parts=String(row.nome_referente||(!business?row.ragione_sociale:'')||'').trim().split(/\s+/).filter(Boolean);
  return {id:row.id,cluster:business?'business':'consumer',display_name:String(row.ragione_sociale||row.nome_referente||row.cf_piva||''),cf_piva:String(row.cf_piva||''),
    prefill:{nome:parts[0]||'',cognome:parts.slice(1).join(' '),telefono:String(row.cellulare||''),via:String(row.via||''),civico:String(row.civico||''),comune:String(row.comune||''),provincia:String(row.provincia||''),ragione_sociale:business?String(row.ragione_sociale||''):'',codice_fiscale:business?'':String(row.cf_piva||''),partita_iva:business?String(row.cf_piva||''):''}};
}
async function search({supabase,event}) {
  const {q,ruolo}=event.queryStringParameters||{};
  const query=validateSearchIdentifier(ruolo,q);
  const search=supabase.from('anagrafica').select('id, cluster, cf_piva, ragione_sociale, nome_referente, cellulare, via, civico, comune, provincia');
  const scoped=ruolo==='cedente'?search.eq('cluster','Business'):search.in('cluster',['Consumer','Turista']);
  // Nessun wildcard: la ricerca accetta esclusivamente l'identificativo completo.
  const result=await scoped.ilike('cf_piva',query).limit(20);
  const items=new Map();
  for(const row of checkError(result)||[]) {
    const item=buildAnagraficaResult(row);
    if((ruolo==='cedente')===(item.cluster==='business')) items.set(item.id,item);
  }
  return response(200,{success:true,anagrafiche:[...items.values()].sort((a,b)=>a.display_name.localeCompare(b.display_name,'it')).slice(0,20)});
}
async function list({supabase,event}) {
  const page=Math.max(1,Math.min(10000,parseInt(event.queryStringParameters?.page||'1',10)||1));
  const result=await supabase.from(TABLE).select(SUMMARY,{count:'exact'}).eq('stato','generato').order('created_at',{ascending:false}).order('id',{ascending:false}).range((page-1)*50,page*50-1);
  return response(200,{success:true,subentri:checkError(result)||[],page,has_more:page*50<(result.count||0)});
}
async function detail({supabase,body}) {
  const row=await generatedRecord(supabase,body.id);
  if(body.action==='duplicate_data') return response(200,{success:true,subentro:row.dati_compilazione});
  if(body.action==='documents') return response(200,{success:true,documenti:row.documenti.map(({id,tipo,nome,mime})=>({id,tipo,nome,mime}))});
  const file=body.document_id?row.documenti.find(item=>item.id===uuid(body.document_id)):null;
  if(body.document_id&&!file) fail('Allegato non trovato',404);
  return response(200,{success:true,signed_url:await signed(supabase,file?file.storage_path:row.storage_path),nome_file:file?file.nome:row.nome_file});
}
async function handle(event,{requireAuth:authenticate=requireAuth,getAdminClient:client=getAdminClient}={}) {
  if(event.httpMethod==='OPTIONS') return response(200,{success:true});
  if(!['GET','POST'].includes(event.httpMethod)) return response(405,{success:false,error:'Metodo non consentito'});
  const auth=await authenticate(event);
  if(!auth.ok) return response(auth.status,{success:false,error:auth.error});
  const supabase=client();
  try {
    const context={supabase,auth,event};
    if(event.httpMethod==='GET') {
      if(event.queryStringParameters?.action==='search_anagrafica') return await search(context);
      if(event.queryStringParameters?.action && event.queryStringParameters.action!=='list') fail('Azione non valida');
      return await list(context);
    }
    if(/multipart\/form-data/i.test(event.headers?.['content-type']||event.headers?.['Content-Type']||'')) return await upload(context);
    context.body=parseBody(event);
    switch(context.body.action) {
      case 'create': return await create(context);
      case 'finalize': return await finalize(context);
      case 'signed_url': case 'documents': case 'duplicate_data': return await detail(context);
      default: fail('Azione non valida');
    }
  } catch(error) {
    if(error instanceof ValidationError) return response(error.status||400,{success:false,error:error.message});
    console.error('Errore gestisci-subentri',String(error?.code||'server_error').slice(0,40));
    return response(500,{success:false,error:'Operazione non riuscita. Riprova; i dati già caricati sono conservati.'});
  }
}
exports.handler=event=>handle(event);
exports._test={handle,validateManifest,validateFile,readMultipart,buildAnagraficaResult,MAX_FILE};
