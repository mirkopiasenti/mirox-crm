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
test('barcode letto da fotografia JPEG ruotata incorporata nel PDF come sul telefono',async()=>{
 const {createCanvas,loadImage}=require('@napi-rs/canvas');
 const out=await Writer.writeBarcode(cf,{format:'Code39',scale:4}),source=await loadImage(Buffer.from(await out.image.arrayBuffer()));
 const canvas=createCanvas(1600,1000),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1600,1000);ctx.translate(1600,1000);ctx.rotate(Math.PI);ctx.drawImage(source,100,300,1400,250);
 const pdf=await PDFDocument.create(),jpg=await pdf.embedJpg(await canvas.encode('jpeg',94));pdf.addPage([1600,1000]).drawImage(jpg,{x:0,y:0,width:1600,height:1000});
 const result=await Barcode.readPdf(Buffer.from(await pdf.save()));assert.equal(result.complete,true);assert.equal(result.values[0].value,cf);
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
  const id=Barcode.apply(reading({fiscale:cf}),{attempted:true,complete:true,values:[],conflict:false});
  const ts=Barcode.apply(reading({tipo_identita:'tessera_sanitaria',numero_documento:'NUMEROTESSERA',scadenza:'2020-01-01'}),codes);
  const result=Identity.Core.evaluate([id,ts],person,'2026-10-29');assert.equal(result.stato,'coerente');assert.equal(result.criterio_identita,'barcode_fiscale');
  assert.equal(Identity.Core.evaluate([ts],person,'2026-10-29').stato,'da_confermare');
  assert.equal(Identity.Core.evaluate([Barcode.apply(reading(),{attempted:true,complete:true,values:[],conflict:false}),ts],person,'2026-10-29').stato,'da_confermare');
  const missing=Identity.Core.evaluate([Barcode.apply(reading({fiscale:cf}),{attempted:true,complete:true,values:[],conflict:false})],person,'2026-10-29');assert.equal(missing.stato,'da_confermare');
});
function dbFixture(){
 const rows=new Map(),files=new Map(),calls=[];let removedFail=false,ambiguousReady=false,blockedRead=false,uploadCount=0,savedCustomer=null;
 const db={storage:{from:()=>({upload:async(path,bytes)=>{uploadCount++;if(files.has(path))return {error:{message:'Exists'}};files.set(path,Buffer.from(bytes));return {data:{path}};},download:async path=>files.has(path)?{data:new Blob([files.get(path)])}:{error:{message:'Missing'}},remove:async paths=>{if(removedFail)return {error:{message:'Unavailable'}};paths.forEach(p=>files.delete(p));return {data:[]};}})},from(table){
  let filters=[],operation='select',payload,limit=Infinity;
  const q={select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},lt(k,v){filters.push(r=>r[k]<v);return q;},ilike(){return q;},limit(n){limit=n;return q;},insert(v){operation='insert';payload=v;return q;},update(v){operation='update';payload=v;return q;},delete(){operation='delete';return q;},maybeSingle(){return execute(true);},then(resolve,reject){return execute(false).then(resolve,reject);}};
  async function execute(single){calls.push({table,operation});if(table==='anagrafica')return {data:savedCustomer?[savedCustomer]:[]};let values=[...rows.values()].filter(r=>filters.every(f=>f(r))).slice(0,limit);
   if(operation==='select'&&blockedRead)return {error:{code:'NETWORK',message:'Rilettura non disponibile'}};
   if(operation==='insert'){rows.set(payload.id,{...payload,created_at:new Date().toISOString()});values=[payload];}
   if(operation==='update')values.forEach(r=>Object.assign(r,payload));if(operation==='delete')values.forEach(r=>rows.delete(r.id));
   if(operation==='update'&&payload.stato==='pronta'&&ambiguousReady){ambiguousReady=false;return {error:{code:'NETWORK',message:'Risposta persa dopo commit'}};}
   return {data:single?(values[0]||null):values.map(r=>({...r}))};}
  return q;
 }};
 return {db,rows,files,calls,get uploadCount(){return uploadCount;},set savedCustomer(v){savedCustomer=v;},set removedFail(v){removedFail=v;},set ambiguousReady(v){ambiguousReady=v;},set blockedRead(v){blockedRead=v;}};
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
test('risposta DB persa dopo commit upload non elimina il PDF gia registrato pronto',async()=>{
 const f=dbFixture(),s=await create(f),row=await Sessions.get(f.db,s.id,{user:'user'}),bytes=await pdfCodes([cf,cf]);
 f.ambiguousReady=true;await Sessions.upload(f.db,row,bytes,{pdfInfo:async()=>2});
 const ready=await Sessions.get(f.db,s.id,{user:'user'});assert.equal(ready.stato,'pronta');assert.equal(f.files.size,1);
 assert.deepEqual(await Sessions.download(f.db,ready,person),bytes);
 const unknown=dbFixture(),u=await create(unknown),before=await Sessions.get(unknown.db,u.id,{user:'user'});unknown.ambiguousReady=true;unknown.blockedRead=true;
 await assert.rejects(Sessions.upload(unknown.db,before,bytes,{pdfInfo:async()=>2}),/non disponibile/);
 assert.equal(unknown.files.size,1);assert.equal(unknown.rows.get(u.id).stato,'pronta');
});
test('decoder esamina la seconda scala anche se la prima ha gia letto un CF',async()=>{
 let calls=0;
 const result=await Barcode.readPdf(await pdfCodes([cf]),{render:async()=>new Uint8Array([1]),decode:async()=>[{text:++calls===1?cf:other,format:'Code39'}]});
 assert.equal(calls,2);assert.equal(result.conflict,true);
});
test('API scanner richiede JWT desktop e autorizzazione owner sul telefono; token non valido senza accessi DB',async()=>{
 const f=dbFixture();const denied=await Api.handler({httpMethod:'POST',headers:{},body:'{}'},{db:f.db,requireAuth:async()=>({ok:false,status:401,error:'No JWT'})});assert.equal(denied.statusCode,401);
 const bad=await Api.handler({httpMethod:'POST',headers:{'x-scanner-token':'invalido','x-scanner-id':'00000000-0000-0000-0000-000000000000'},body:'{}'},{db:f.db,secret:'fixture'});assert.equal(bad.statusCode,403);assert.equal(f.calls.length,0);
 const s=await create(f);const deniedOwner=await Api.handler({httpMethod:'POST',headers:{'x-scanner-token':s.token,'x-scanner-id':s.id},body:'{}'},{db:f.db,secret:'fixture',authorizeOwner:async()=>({ok:false,status:403,error:'Account disabilitato'})});assert.equal(deniedOwner.statusCode,403);
});
test('errore temporaneo database esposto come503 per consentire il retry del PC',async()=>{
 const db={from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({error:{code:'NETWORK'}})};}};
 const result=await Api.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'status',id:'11111111-1111-4111-8111-111111111111'})},{db,requireAuth:async()=>({ok:true,user:{id:'user'}})});
 assert.equal(result.statusCode,503);assert.doesNotMatch(result.body,/NETWORK/);
});
test('pagina mobile senza storage locale, PDF vendorizzato e fotocamera limitata alla pagina scanner',()=>{
 const mobile=fs.readFileSync(require.resolve('../js/scanner-documenti-mobile.js'),'utf8'),html=fs.readFileSync(require.resolve('../moduli/scanner-documenti.html'),'utf8');
 assert.doesNotMatch(mobile,/localStorage|sessionStorage|indexedDB|\.download\s*=/);assert.match(mobile,/history.replaceState/);assert.match(mobile,/getUserMedia/);assert.match(mobile,/getTracks\(\).forEach/);assert.match(mobile,/MiroxApi.fetch/);assert.doesNotMatch(html,/type="file"/);
 const config=fs.readFileSync(require.resolve('../netlify.toml'),'utf8');assert.match(config,/for = "\/moduli\/scanner-documenti.html"/);const headers=fs.readFileSync(require.resolve('../dist/_headers'),'utf8');assert.match(headers,/\/moduli\/scanner-documenti.html\n  Permissions-Policy: camera=\(self\)/);assert.match(headers,/\/dashboard.html\n  Permissions-Policy: camera=\(\)/);
 assert.doesNotMatch(config,/^\s*Permissions-Policy\s*=/m);
 const policies=[...headers.matchAll(/^(\/[^\n]*)\n  Permissions-Policy: ([^\n]+)/gm)];assert.ok(policies.length>10);
 for(const [,route,policy] of policies){assert.equal((policy.match(/camera=/g)||[]).length,1);assert.match(policy,/microphone=\(\), geolocation=\(\), payment=\(\), usb=\(\), browsing-topics=\(\)/);assert.match(policy,route.startsWith('/moduli/scanner-documenti')?/^camera=\(self\),/:/^camera=\(\),/);}
});
test('errore generazione QR non lascia sessioni invisibili che impediscono nuovi tentativi',async()=>{
 const f=dbFixture();await assert.rejects(Sessions.create(f.db,'user',person,{tipo:'cie'},{secret:'fixture',qr:async()=>{throw Error('Generatore non disponibile');}}));
 assert.equal(f.rows.size,0);
});
test('cancellazione proprietario ritentabile anche dopo revoca o scadenza, nessuna riapertura telefono',async()=>{
 const f=dbFixture(),s=await create(f);const row=f.rows.get(s.id);row.expires_at='2020-01-01T00:00:00Z';row.stato='annullata';f.files.set(Sessions.pathFor(s.id),Buffer.from('%PDF-test'));
 const result=await Api.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'cancel',id:s.id})},{db:f.db,requireAuth:async()=>({ok:true,user:{id:'user'}})});
 assert.equal(result.statusCode,200);assert.equal(f.files.size,0);
 await assert.rejects(Sessions.get(f.db,s.id,{token:s.token,secret:'fixture',allowInactive:true}),/scaduto|annullato/);
 const otherOwner=await Api.handler({httpMethod:'POST',headers:{},body:JSON.stringify({action:'cancel',id:s.id})},{db:f.db,requireAuth:async()=>({ok:true,user:{id:'other'}})});assert.equal(otherOwner.statusCode,403);
});
test('download vincolato anche al cluster e UUID malformato rifiutato prima della query',async()=>{
 const f=dbFixture(),s=await create(f),row=f.rows.get(s.id);await Sessions.upload(f.db,row,Buffer.from('%PDF-fixture'),{pdfInfo:async()=>2});
 await assert.rejects(Sessions.download(f.db,row,{...person,cluster:'Turista'}),/anagrafica/);
 const before=f.calls.length;await assert.rejects(Sessions.get(f.db,'-'.repeat(36),{user:'user'}));assert.equal(f.calls.length,before);
 const saved=dbFixture();saved.savedCustomer={...person,cluster:'Turista'};await assert.rejects(create(saved),/anagrafica/);
});
test('scadenza durante validazione PDF blocca upload prima di scrivere lo Storage',async()=>{
 const f=dbFixture(),s=await create(f),row=f.rows.get(s.id);
 await assert.rejects(Sessions.upload(f.db,row,Buffer.from('%PDF-fixture'),{pdfInfo:async()=>{row.expires_at='2020-01-01T00:00:00Z';return 2;}}),/scadut/);
 assert.equal(f.uploadCount,0);
});
test('multipart interrotto rifiutato senza errore stream non gestito su scanner e fallback identita',()=>{
 const {spawnSync}=require('node:child_process');
 for(const name of ['scanner-documenti','verifica-identita-upload','upload-vendita-documento']){
   const code=`const api=require('./netlify/functions/${name}');const body='--b\\r\\nContent-Disposition: form-data; name="file"; filename="id.pdf"\\r\\nContent-Type: application/pdf\\r\\n\\r\\n%PDF-incompleto';(api._test.multipart||api._test.readMultipart)({headers:{'content-type':'multipart/form-data; boundary=b'},body}).then(()=>process.exit(2),()=>console.log('rifiutato'));`;
   const child=spawnSync(process.execPath,['-e',code],{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8'});
   assert.equal(child.status,0,child.stderr);assert.match(child.stdout,/rifiutato/);
 }
});
test('CF solo sulla tessera non approva un diverso documento; CIE con barcode proprio resta automatica',()=>{
 const empty={attempted:true,complete:true,conflict:false,values:[]},tax={attempted:true,complete:true,conflict:false,values:[{value:cf,page:1,format:'Code39'}]};
 const id=Barcode.apply(reading({fiscale:other,nome:'Luigi Verdi'}),empty),ts=Barcode.apply(reading({tipo_identita:'tessera_sanitaria'}),tax);
 assert.equal(Identity.Core.evaluate([id,ts],person,'2026-10-29').stato,'da_confermare');
 assert.equal(Identity.Core.evaluate([Barcode.apply(reading(),tax)],person,'2026-10-29').stato,'coerente');
});
test('CF solo tessera: confronto nome e nascita tra i due documenti, ordine/accenti normalizzati; dubbio manuale',()=>{
 const f=(value,page=1)=>({value,page,quote:'Dato sintetico indipendente'});
 const id={fields:{nome:f('Mario Rossi'),nascita:f('1980-01-01'),fiscale:null,tipo_identita:f('patente'),numero_documento:f('AB123456'),scadenza:f('2030-01-01'),fronte_presente:f(true),retro_presente:f(true,2),cittadinanza:f('IT')},barcode:{attempted:true,complete:true,conflict:false,values:[]}};
 const ts={fields:{tipo_identita:f('tessera_sanitaria'),tessera_nome:f('Ròssi Màrio'),tessera_nascita:f('1980-01-01'),tessera_fiscale:f(cf),tessera_fronte_presente:f(true),tessera_retro_presente:f(true,2)},barcode:{attempted:true,complete:true,conflict:false,values:[{value:cf,page:2,format:'Code39'}]}};
 assert.equal(Identity.Core.evaluate([id,ts],person,'2026-10-29').stato,'coerente');
 for(const patch of [{nome:f('Mario Rosi')},{nascita:f('1980-01-02')},{nascita:null},{fiscale:f(other)}])assert.equal(Identity.Core.evaluate([{...id,fields:{...id.fields,...patch}},ts],person,'2026-10-29').stato,'da_confermare');
 const missing=structuredClone(ts);missing.fields.tessera_nascita=null;assert.equal(Identity.Core.evaluate([id,missing],person,'2026-10-29').stato,'da_confermare');
 const combined={fields:{...id.fields,tessera_nome:f('Rossi Mario',3),tessera_nascita:f('1980-01-01',3),tessera_fiscale:f(cf,3),tessera_fronte_presente:f(true,3),tessera_retro_presente:f(true,4)},barcode:{attempted:true,complete:true,conflict:false,values:[{value:cf,page:4,format:'Code39'}]}};
 assert.equal(Identity.Core.evaluate([combined],person,'2026-10-29').stato,'coerente');
});
test('tessera obbligatoria con fronte incerto richiede preview, non basta il numero di pagine',async()=>{
 const readingId=reading({fiscale:cf,tessera_fronte_presente:false,tessera_retro_presente:true});
 const api=require('../netlify/functions/verifica-identita-upload'),f=dbFixture();
 const out=await api.handler({httpMethod:'POST',headers:{}},{db:f.db,secret:'fixture',requireAuth:async()=>({ok:true,user:{id:'user'}}),pdfInfo:async()=>4,
 multipart:async()=>({files:[{buffer:Buffer.from('%PDF-fixture')}],fields:{cliente:JSON.stringify(person),data_firma:'2026-10-29',pacchetto:JSON.stringify({tipo:'cie',tessera_sanitaria:true})}}),extract:async()=>readingId,readBarcode:async()=>({attempted:true,complete:true,conflict:false,values:[{value:cf,page:1,format:'Code39'}]})});
 assert.equal(JSON.parse(out.body).result.stato,'da_confermare');
});
test('PDF fotografico usa due risoluzioni distinte nel decoder, anche con pagina larga2400punti',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([2400,1500]);const widths=[];
 await Barcode.readPdf(Buffer.from(await pdf.save()),{render:async(_,__,opts)=>{widths.push(opts.width);return new Uint8Array([1]);},decode:async()=>[]});
 assert.deepEqual(widths,[1800,2600]);
});
