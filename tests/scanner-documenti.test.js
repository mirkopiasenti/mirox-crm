'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {PDFDocument}=require('pdf-lib'),Writer=require('zxing-wasm/writer');
const Barcode=require('../netlify/functions/_lib/identita-barcode'),Identity=require('../netlify/functions/_lib/identita-upload'),Core=require('../js/scanner-documenti-core');
const Sessions=require('../netlify/functions/_lib/scanner-sessioni'),Api=require('../netlify/functions/scanner-documenti');
const cf='RSSMRA80A01H501U',person={cf_piva:cf,cluster:'Consumer',ragione_sociale:'Mario Rossi'};
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const other='ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(s=>'VRDLGI80A01H501'+s).find(v=>Barcode.validTax(v));
Writer.prepareZXingModule({overrides:{wasmBinary:fs.readFileSync(require.resolve('zxing-wasm/writer/zxing_writer.wasm'))}});
async function pdfCodes(values,format='Code39'){
  const pdf=await PDFDocument.create();
  for(const value of values){const out=await Writer.writeBarcode(value,{format,scale:4});assert.equal(out.error,'');const png=await pdf.embedPng(await out.image.arrayBuffer());pdf.addPage([700,450]).drawImage(png,{x:40,y:100,width:620,height:120});}
  return Buffer.from(await pdf.save());
}
const field=v=>({value:v,page:1,quote:'Dato sintetico'});
const reading=(patch={})=>({fields:Object.fromEntries(Object.entries({nome:'Nome OCR errato',fiscale:other,tipo_identita:'carta_identita',numero_documento:'CA1234567',scadenza:'2030-01-01',nascita:'1980-01-01',fronte_presente:true,retro_presente:true,cittadinanza:'IT',...patch}).map(([k,v])=>[k,v===null?null:field(v)]))});
test('combinazioni scanner: CIE sola/facoltativa TS, cartacea e patente obbligano TS, passaporto PDF',()=>{
  for(const tipo of ['cartacea','patente'])assert.equal(Core.sides({tipo,tessera_sanitaria:false}).length,4);
  assert.equal(Core.sides({tipo:'cie'}).length,2);assert.equal(Core.sides({tipo:'cie',tessera_sanitaria:true}).length,4);
  assert.throws(()=>Core.sides({tipo:'passaporto'}),/PDF/);assert.throws(()=>Core.manifest({tipo:'inventato'}));
  for(const [w,h]of[[1920,1080],[1080,1920]]){const c=Core.crop(w,h);assert.ok(c.x>=0&&c.y>=0);assert.ok(c.x+c.width<=w+.01);assert.ok(Math.abs(c.width/c.height-85.6/53.98)<.001);}
});
test('barcode Code39 e Code128 letti dai byte PDF reali con pagina, senza usare OCR o dati CRM',async()=>{
  for(const format of ['Code39','Code128']){const bytes=await pdfCodes([cf],format);const result=await Barcode.readPdf(bytes);assert.equal(result.complete,true);assert.equal(result.values[0].value,cf);assert.equal(result.values[0].page,1);assert.equal(result.conflict,false);}
});
test('barcode CF con checksum errato non diventa un dato corretto; barcode distinti sono discordanti',async()=>{
  assert.equal(Barcode.validTax(cf.slice(0,-1)+'A'),null);assert.equal(Barcode.validTax('01234567890'),null);
  const bad=await Barcode.readPdf(await pdfCodes([cf.slice(0,-1)+'A']));assert.equal(bad.values.length,0);assert.equal(bad.complete,true);
  const distinct=await Barcode.readPdf(await pdfCodes([cf,other]));assert.equal(distinct.conflict,true);
  const evaluated=Identity.Core.evaluate([Barcode.apply(reading(),distinct)],person,'2026-10-29');assert.equal(evaluated.stato,'da_correggere');
});
test('budget barcode esaurito forza manuale senza avviare il renderer',async()=>{
 let renders=0;const result=await Barcode.readPdf(Buffer.from('%PDF-fixture'),{deadline:Date.now()-1,render:async()=>{renders++;}});
 assert.equal(renders,0);assert.equal(result.complete,false);assert.equal(result.values.length,0);
});
test('CF barcode prevale sulla lettera sbagliata AI, tessera sanitaria non impone tipo/scadenza/numero tessera',async()=>{
  const codes=await Barcode.readPdf(await pdfCodes([cf]));
  const id=Barcode.apply(reading(),{attempted:true,complete:true,values:[],conflict:false});
  const ts=Barcode.apply(reading({tipo_identita:'tessera_sanitaria',numero_documento:'NUMEROTESSERA',scadenza:'2020-01-01'}),codes);
  const result=Identity.Core.evaluate([id,ts],person,'2026-10-29');assert.equal(result.stato,'coerente');assert.equal(result.criterio_identita,'barcode_fiscale');
  assert.equal(Identity.Core.evaluate([ts],person,'2026-10-29').stato,'da_confermare');
  const missing=Identity.Core.evaluate([Barcode.apply(reading({fiscale:cf}),{attempted:true,complete:true,values:[],conflict:false})],person,'2026-10-29');assert.equal(missing.stato,'da_confermare');
});
function dbFixture(){
 const rows=new Map(),files=new Map(),calls=[];let removedFail=false;
 const db={storage:{from:()=>({upload:async(path,bytes)=>{if(files.has(path))return {error:{message:'Exists'}};files.set(path,Buffer.from(bytes));return {data:{path}};},download:async path=>files.has(path)?{data:new Blob([files.get(path)])}:{error:{message:'Missing'}},remove:async paths=>{if(removedFail)return {error:{message:'Unavailable'}};paths.forEach(p=>files.delete(p));return {data:[]};}})},from(table){
  let filters=[],operation='select',payload,limit=Infinity;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},ilike(){return q;},limit(n){limit=n;return q;},insert(v){operation='insert';payload=v;return q;},update(v){operation='update';payload=v;return q;},delete(){operation='delete';return q;},maybeSingle(){return execute(true);},then(resolve,reject){return execute(false).then(resolve,reject);}};
  async function execute(single){calls.push({table,operation});if(table==='anagrafica')return {data:[]};let values=[...rows.values()].filter(r=>filters.every(f=>f(r))).slice(0,limit);
   if(operation==='insert'){rows.set(payload.id,{...payload,created_at:new Date().toISOString()});values=[payload];}
   if(operation==='update')values.forEach(r=>Object.assign(r,payload));if(operation==='delete')values.forEach(r=>rows.delete(r.id));
   return {data:single?(values[0]||null):values.map(r=>({...r}))};}
  return q;
 }};
 return {db,rows,files,calls,set removedFail(v){removedFail=v;}};
}
async function create(f,pacchetto={tipo:'cie'}){let link;const result=await Sessions.create(f.db,'user',person,pacchetto,{secret:'fixture',origin:'https://mirox-crm.it',qr:async url=>{link=url;return 'data:image/png;base64,fixture';}});const parts=new URLSearchParams(new URL(link).hash.slice(1));return {...result,token:parts.get('token')};}
test('QR conserva token solo come hash, URL senza query e owner/anagrafica/TTL vincolati',async()=>{
 const f=dbFixture(),s=await create(f),row=f.rows.get(s.id);assert.equal(row.token_hash,hash(s.token));assert.equal(Object.values(row).includes(s.token),false);assert.equal(row.operatore_id,'user');
 assert.equal(Sessions.validToken(s.id,s.token,'fixture'),true);assert.equal(Sessions.validToken(s.id,s.token,'wrong'),false);
 assert.equal((await Sessions.get(f.db,s.id,{token:s.token,secret:'fixture'})).id,s.id);
 await assert.rejects(Sessions.get(f.db,s.id,{user:'other'}),/disponibile/);
 await assert.rejects(Sessions.get(f.db,s.id,{token:s.token,secret:'fixture',now:Date.now()+Core.TTL_MS+1000}),/scaduto/);
 const reads=f.calls.length;await assert.rejects(Sessions.get(f.db,s.id,{token:s.token+'x',secret:'fixture'}));assert.equal(f.calls.length,reads);
});
test('upload atomico/idempotente e download con hash, cliente e cancellazione; una pratica non riceve altri PDF',async()=>{
 const f=dbFixture(),s=await create(f),bytes=await pdfCodes([cf,cf]);let row=await Sessions.get(f.db,s.id,{user:'user'});
 await assert.rejects(Sessions.upload(f.db,row,bytes,{pdfInfo:async()=>1}),/fronte/);
 await Sessions.upload(f.db,row,bytes,{pdfInfo:async()=>2});row=await Sessions.get(f.db,s.id,{user:'user'});
 assert.equal(row.stato,'pronta');await Sessions.upload(f.db,row,bytes,{pdfInfo:async()=>2});
 await assert.rejects(Sessions.upload(f.db,row,Buffer.from('%PDF-altro'),{pdfInfo:async()=>2}),/già/);
 await assert.rejects(Sessions.download(f.db,row,{...person,cf_piva:other}),/anagrafica/);
 assert.deepEqual(await Sessions.download(f.db,row,person),bytes);
 f.files.set(Sessions.pathFor(s.id),Buffer.from('alterato'));await assert.rejects(Sessions.download(f.db,row,person),/integro/);
 await Sessions.cancel(f.db,row);assert.equal(f.files.size,0);await assert.rejects(Sessions.get(f.db,s.id,{user:'user'}),/annullato/);
});
test('tessera fronte/retro obbligatoria, cleanup non perde i riferimenti se Storage non risponde',async()=>{
 const f=dbFixture(),s=await create(f,{tipo:'patente'}),row=f.rows.get(s.id),bytes=await pdfCodes([cf]);
 await assert.rejects(Sessions.upload(f.db,row,bytes,{pdfInfo:async()=>2}),/fronte/);
 f.files.set(Sessions.pathFor(s.id),bytes);row.expires_at='2020-01-01T00:00:00Z';f.removedFail=true;
 await assert.rejects(Sessions.cleanup(f.db));assert.equal(f.rows.size,1);assert.equal(f.files.size,1);
 f.removedFail=false;assert.equal(await Sessions.cleanup(f.db),1);assert.equal(f.files.size,0);assert.equal(f.rows.size,0);
});
test('API scanner richiede JWT desktop e autorizzazione owner sul telefono; token non valido senza accessi DB',async()=>{
 const f=dbFixture();const denied=await Api.handler({httpMethod:'POST',headers:{},body:'{}'},{db:f.db,requireAuth:async()=>({ok:false,status:401,error:'No JWT'})});assert.equal(denied.statusCode,401);
 const bad=await Api.handler({httpMethod:'POST',headers:{'x-scanner-token':'invalido','x-scanner-id':'00000000-0000-0000-0000-000000000000'},body:'{}'},{db:f.db,secret:'fixture'});assert.equal(bad.statusCode,403);assert.equal(f.calls.length,0);
 const s=await create(f);const deniedOwner=await Api.handler({httpMethod:'POST',headers:{'x-scanner-token':s.token,'x-scanner-id':s.id},body:'{}'},{db:f.db,secret:'fixture',authorizeOwner:async()=>({ok:false,status:403,error:'Account disabilitato'})});assert.equal(deniedOwner.statusCode,403);
});
test('pagina mobile senza storage locale, PDF vendorizzato e fotocamera limitata alla pagina scanner',()=>{
 const mobile=fs.readFileSync(require.resolve('../js/scanner-documenti-mobile.js'),'utf8'),html=fs.readFileSync(require.resolve('../moduli/scanner-documenti.html'),'utf8');
 assert.doesNotMatch(mobile,/localStorage|sessionStorage|indexedDB|\.download\s*=/);assert.match(mobile,/history.replaceState/);assert.match(mobile,/getUserMedia/);assert.match(mobile,/getTracks\(\).forEach/);assert.match(mobile,/MiroxApi.fetch/);assert.doesNotMatch(html,/type="file"/);
 const config=fs.readFileSync(require.resolve('../netlify.toml'),'utf8');assert.match(config,/for = "\/moduli\/scanner-documenti.html"/);const headers=fs.readFileSync(require.resolve('../dist/_headers'),'utf8');assert.match(headers,/\/moduli\/scanner-documenti.html\n  Permissions-Policy: camera=\(self\)/);assert.match(headers,/\/dashboard.html\n  Permissions-Policy: camera=\(\)/);
});
