// QA locale: pacchetti privati temporanei, mai in dist e nessun servizio esterno chiamato.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url)),req=createRequire(new URL('../package.json',import.meta.url));
const {zipFunction}=await import(process.env.MIROX_ZISI_MODULE||'@netlify/zip-it-and-ship-it');
const {unzipSync}=req('fflate'),output=fs.mkdtempSync(path.join(os.tmpdir(),'mirox-scanner-package-'));
const external=JSON.parse(fs.readFileSync(path.join(root,'netlify.toml'),'utf8').match(/external_node_modules\s*=\s*(\[[^\n]+\])/)[1]);
let identityZip;
for(const name of ['scanner-documenti','verifica-identita-upload','upload-vendita-documento','verifica-contratti-background']){
 const packed=await zipFunction(path.join(root,'netlify/functions',name+'.js'),output,{basePath:root,archiveFormat:'zip',config:{'*':{nodeBundler:'esbuild',nodeVersion:'22.x',externalNodeModules:external}}});
 assert.ok(packed?.path);const names=[];unzipSync(fs.readFileSync(packed.path),{filter:file=>{names.push(file.name);return false;}});
 assert.ok(names.some(n=>n.endsWith('zxing_reader.wasm')),name+': WASM assente');
 assert.ok(names.some(n=>n.includes('@napi-rs/canvas-')&&n.endsWith('.node')),name+': Canvas nativo assente');
 if(name==='verifica-identita-upload')identityZip=packed.path;
 console.log(name+': pacchetto e asset verificati');
}
const extracted=path.join(output,'isolato');fs.mkdirSync(extracted);
for(const [name,bytes]of Object.entries(unzipSync(fs.readFileSync(identityZip)))){
 const target=path.resolve(extracted,name);assert.ok(target.startsWith(extracted+path.sep));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
}
const api=req(path.join(extracted,'verifica-identita-upload.js')),{PDFDocument}=req('pdf-lib'),writer=req('zxing-wasm/writer');
writer.prepareZXingModule({overrides:{wasmBinary:fs.readFileSync(req.resolve('zxing-wasm/writer/zxing_writer.wasm'))}});
const cf='RSSMRA80A01H501U',customer={cf_piva:cf,cluster:'Consumer',ragione_sociale:'Mario Rossi'};
const code=await writer.writeBarcode(cf,{format:'Code39',scale:4}),pdf=await PDFDocument.create(),img=await pdf.embedPng(await code.image.arrayBuffer());
pdf.addPage([700,450]);pdf.addPage([700,450]).drawImage(img,{x:40,y:100,width:620,height:120});
const fields=Object.fromEntries(Object.entries({nome:'Mario Rosi',fiscale:'OCRERRATO',nascita:'1980-01-01',scadenza:'2030-01-01',tipo_identita:'carta_identita',numero_documento:'CA1234567',cittadinanza:'IT',fronte_presente:true,retro_presente:true,tessera_fronte_presente:false,tessera_retro_presente:false}).map(([key,value])=>[key,{value,page:key==='retro_presente'?2:1,quote:'Dato sintetico QA'}]));
const result=await api.handler({httpMethod:'POST',headers:{}},{requireAuth:async()=>({ok:true,user:{id:'fixture'}}),db:{from(){return {select(){return this;},ilike(){return this;},limit:async()=>({data:[customer]})};}},secret:'fixture',multipart:async()=>({files:[{buffer:Buffer.from(await pdf.save())}],fields:{cliente:JSON.stringify(customer),data_firma:'2026-10-29',pacchetto:JSON.stringify({tipo:'cie'})}}),extract:async()=>({fields})});
assert.equal(result.statusCode,200);assert.equal(JSON.parse(result.body).result.criterio_identita,'barcode_fiscale');assert.equal(JSON.parse(result.body).result.stato,'coerente');
const mailer=req(path.join(extracted,'node_modules/nodemailer'));
const transport=mailer.createTransport({streamTransport:true,buffer:true});
const composed=await transport.sendMail({from:'fixture@example.invalid',to:'destinatario@example.invalid',subject:'QA bundle',text:'Contenuto sintetico'});
assert.ok(Buffer.isBuffer(composed.message));assert.match(composed.message.toString(),/QA bundle/);transport.close();
console.log('Bundle isolato: PDF/Canvas/WASM/ricevuta funzionanti. Piattaforma QA: '+process.platform+'/'+process.arch+'. Output privato: '+output);
