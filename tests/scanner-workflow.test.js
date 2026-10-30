'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createRequire}=require('node:module'),{PDFDocument}=require('pdf-lib'),Writer=require('zxing-wasm/writer');
const Scanner=require('../netlify/functions/scanner-documenti'),IdentityApi=require('../netlify/functions/verifica-identita-upload'),Identity=require('../netlify/functions/_lib/identita-upload'),Docs=require('../netlify/functions/_lib/verifica-documenti'),Core=require('../js/verifica-contratti-core');
const {storeIdentityForContracts}=require('../netlify/functions/upload-vendita-documento')._test;
const cf='RSSMRA80A01H501U',owner={id:crypto.randomUUID(),cf_piva:cf,cluster:'Consumer',ragione_sociale:'Mario Rossi'},actor='operatore-test';
const evidence=(value,page=1)=>({value,page,quote:'Dato sintetico di prova'});
function database(){
 const tables=new Map([['anagrafica',[owner]]]),files=new Map();
 const storage={async upload(k,b){if(files.has(k))return {error:{message:'Exists'}};files.set(k,Buffer.from(b));return {data:{path:k}};},async copy(a,b){files.set(b,Buffer.from(files.get(a)));return {data:{path:b}};},async download(k){return files.has(k)?{data:new Blob([files.get(k)])}:{error:{message:'Missing'}};},async remove(keys){keys.forEach(k=>files.delete(k));return {data:[]};}};
 const db={tables,files,storage:{from:()=>storage},rpc:async()=>({data:{}}),from(table){
  let filters=[],op='select',payload,limit=Infinity;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},ilike(k,v){filters.push(r=>String(r[k]).toLowerCase()===String(v).toLowerCase());return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},order(){return q;},limit(n){limit=n;return q;},insert(p){op='insert';payload=p;return q;},upsert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},delete(){op='delete';return q;},single:()=>run(true),maybeSingle:()=>run(true),then(a,b){return run().then(a,b);}};
  async function run(single=false){const all=tables.get(table)||[];let found=all.filter(r=>filters.every(f=>f(r))).slice(0,limit);
   if(op==='insert'){found=(Array.isArray(payload)?payload:[payload]).map(r=>({id:crypto.randomUUID(),created_at:new Date().toISOString(),...r}));all.push(...found);}
   if(op==='update')found.forEach(r=>Object.assign(r,payload));tables.set(table,op==='delete'?all.filter(r=>!found.includes(r)):all);
   return {data:single?(found[0]||null):found.map(r=>({...r}))};}return q;
 }};return db;
}
async function multipart(form){const request=new Request('https://fixture.invalid',{method:'POST',body:form});return {httpMethod:'POST',headers:{'content-type':request.headers.get('content-type')},isBase64Encoded:true,body:Buffer.from(await request.arrayBuffer()).toString('base64')};}
function finalizer(db){const file=require.resolve('../netlify/functions/crea-vendita-pratica-carrello'),real=createRequire(file),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,exports:module.exports,Buffer,console:{log(){}},process:{env:{SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture'}},require(id){if(id==='@supabase/supabase-js')return {createClient:()=>db};if(id==='./_lib/require-auth')return {requireAuth:async()=>({ok:true,user:{id:actor},profilo:{ruolo:'admin'}})};return real(id);}});return module.exports.handler;
}
async function identityPdf(){Writer.prepareZXingModule({overrides:{wasmBinary:fs.readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm'))}});const code=await Writer.writeBarcode(cf,{format:'Code39',scale:4}),pdf=await PDFDocument.create(),image=await pdf.embedPng(await code.image.arrayBuffer());pdf.addPage([700,450]).drawText('DOCUMENTO SINTETICO - SCADENZA 2030-01-01');pdf.addPage([700,450]).drawImage(image,{x:40,y:100,width:620,height:120});return Buffer.from(await pdf.save());}
test('flusso completo: QR -> multipart -> CF reale -> ricevuta -> tre copie -> finalize perso -> recupero -> verifica successiva',async()=>{
 const db=database(),bytes=await identityPdf();let link;
 const auth=async()=>({ok:true,user:{id:actor}}),secret='fixture',event=input=>({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 const created=await Scanner.handler(event({action:'create',cliente:owner,pacchetto:{tipo:'cie'}}),{db,requireAuth:auth,secret,qr:async url=>{link=url;return 'data:image/png;base64,fixture';}});assert.equal(created.statusCode,200,created.body);
 const session=JSON.parse(created.body),token=new URLSearchParams(new URL(link).hash.slice(1)).get('token');
 const form=new FormData();form.append('file',new Blob([bytes],{type:'application/pdf'}),'documento.pdf');const phone=await multipart(form);Object.assign(phone.headers,{'x-scanner-id':session.id,'x-scanner-token':token});
 assert.equal((await Scanner.handler(phone,{db,secret,authorizeOwner:async()=>({ok:true})})).statusCode,200);
 const download=await Scanner.handler(event({action:'download',id:session.id,cliente:owner}),{db,secret,requireAuth:auth});assert.equal(download.statusCode,200);const received=Buffer.from(download.body,'base64');assert.deepEqual(received,bytes);
 const checkForm=new FormData();checkForm.append('cliente',JSON.stringify(owner));checkForm.append('data_firma','2026-10-29');checkForm.append('pacchetto',JSON.stringify({tipo:'cie'}));checkForm.append('file',new Blob([received]),'id.pdf');
 const fields=Object.fromEntries(Object.entries({nome:'Mario Rosi',fiscale:'OCRERRATO',nascita:'1980-01-01',scadenza:'2030-01-01',tipo_identita:'carta_identita',numero_documento:'CA1234567',cittadinanza:'IT',fronte_presente:true,retro_presente:true}).map(([k,v])=>[k,evidence(v,k==='retro_presente'?2:1)]));
 const checked=await IdentityApi.handler(await multipart(checkForm),{db,requireAuth:auth,secret,extract:async()=>({fields})});assert.equal(checked.statusCode,200,checked.body);const data=JSON.parse(checked.body);assert.equal(data.result.stato,'coerente');assert.equal(data.result.criterio_identita,'barcode_fiscale');
 const receipt=Identity.verify(data.token,{user:actor,customer:owner,secret}),pratica=crypto.randomUUID();Identity.assertPractice(receipt,owner);
 db.tables.set('vendita_pratiche',[{id:pratica,anagrafica_id:owner.id,operatore_id:actor,stato_pratica:'bozza',identita_verifica_upload:receipt}]);
 const contracts=Array.from({length:3},(_,i)=>({id:crypto.randomUUID(),pratica_id:pratica,anagrafica_id:owner.id,cluster_cliente:'Consumer',categoria_snapshot:'Customer Base',codice_contratto:'PDA'+i,tipo_firma:'elettronica'}));db.tables.set('vendita_contratti',contracts);
 const rows=await storeIdentityForContracts({supabase:db,contracts,payload:{pratica_id:pratica,anagrafica_id:owner.id,contratto_id:contracts[0].id,tipo_documento:'documento_identita',storage_bucket:'contratti-vendita',storage_path:pratica+'/id.pdf',file_name:'id.pdf',sha256:Identity.hash(received)},buffer:received});
 assert.equal(rows.length,3);for(const r of rows)assert.deepEqual(db.files.get(r.storage_path),bytes);
 const finalize=finalizer(db);assert.equal((await finalize(event({action:'finalize',pratica_id:pratica}))).statusCode,200);
 const recovered=await finalize(event({action:'rollback_upload_failure',pratica_id:pratica}));assert.equal(JSON.parse(recovered.body).already_finalized,true);assert.equal(db.tables.get('vendita_pratiche')[0].stato_pratica,'inviata');assert.equal(db.tables.get('vendita_documenti').length,3);
 const pda=await PDFDocument.create();pda.addPage().drawText('PDA SINTETICA');const pdaBytes=Buffer.from(await pda.save()),pdaDoc={id:crypto.randomUUID(),tipo_documento:'contratto',storage_bucket:'contratti-vendita',storage_path:pratica+'/pda.pdf'};db.files.set(pdaDoc.storage_path,pdaBytes);
 let identityReads=0;const contract=contracts[0],snapshot={contract,customer:owner,practice:db.tables.get('vendita_pratiche')[0],documents:[rows[0],pdaDoc]};
 const read=await Docs.readDocuments(db,snapshot,{extract:async doc=>{if(doc.tipo_documento==='documento_identita')identityReads++;return {id:doc.id,fields:{fiscale:evidence(cf),intestatario_nome:evidence('Mario Rossi'),codice_contratto:evidence(contract.codice_contratto),data_firma:evidence('2026-10-29')}};}});
 assert.equal(identityReads,0);assert.equal(read.identityPrecheck.manuale,false);const evaluated=Core.evaluate({...snapshot,...read});assert.equal(evaluated.esito,'controllato',JSON.stringify(evaluated.errors));
});
