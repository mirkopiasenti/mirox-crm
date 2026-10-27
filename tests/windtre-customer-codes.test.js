'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Pda=require('../js/vendita-pda-core');
const {customerCodeFields,readPdfFields}=require('../netlify/functions/_lib/pda-pdf-text');
const {saveCodes,TABLE}=require('../netlify/functions/_lib/windtre-customer-codes');
const {normalizeResult}=require('../netlify/functions/ocr-pda')._test;
const {PDFDocument,StandardFonts}=require('pdf-lib');
const id='10000000-0000-4000-8000-000000000001';

test('codici cliente testuali: prefisso e zeri, deduplica, input invalido senza conversioni numeriche',()=>{
 assert.equal(Pda.customerCode(' p 0001234567 '),'P0001234567');
 assert.equal(Pda.customerCode('0000012345'),'0000012345');
 assert.equal(Pda.customerCode(12345),null);assert.equal(Pda.customerCode('NON PRESENTE'),null);
 assert.throws(()=>Pda.customerCode('',true),/obbligatorio/);
 assert.deepEqual(Pda.customerCodes(['P00001','p 00001','00002']),['P00001','00002']);
 assert.throws(()=>Pda.customerCodes('P00001'),/Elenco/);assert.throws(()=>Pda.customerCodes(['<script>']),/non valido/);
 assert.equal(normalizeResult({codice_cliente:'P 00001',codice_contratto:'C00002'}).codice_cliente,'P00001');
});
test('etichetta cliente distinta da contratto/POS; assenza, discordanza e ripetizioni trattate senza inventare',()=>{
 assert.deepEqual(customerCodeFields('Codice Cliente: P 0001234567 Codice Contratto: 99999999'),{codice_cliente:'P0001234567'});
 assert.deepEqual(customerCodeFields('Numero Contratto: 1234\nCodice POS: 9001415852'),{});
 assert.deepEqual(customerCodeFields('Codice Cliente:\n'),{});
 assert.equal(customerCodeFields('Codice Cliente: P0001\nCodice Cliente: P0001').codice_cliente,'P0001');
 assert.equal(customerCodeFields('Codice Cliente: P0001\nCodice Cliente: P0002').codice_cliente,null);
 assert.equal(customerCodeFields('Codice Cliente: NON PRESENTE').codice_cliente,null);
});
test('PDF testuale: codice cliente letto anche senza sezioni SIM e senza confonderlo con codice contratto',async()=>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage();
 page.drawText('Codice Cliente: P 0000012345 Codice Contratto: C99999',{x:30,y:700,size:10,font});
 const data=await readPdfFields(await pdf.save());assert.equal(data.codice_cliente,'P0000012345');assert.equal(data.codice_contratto,undefined);
});
test('append idempotente: piu codici, nessuna sostituzione o update e nessuna scrittura per lista vuota',async()=>{
 const stored=new Set(['P00001']);let calls=0;
 const db={from(name){assert.equal(name,TABLE);return {async upsert(rows,options){calls++;
 assert.equal(options.ignoreDuplicates,true);assert.equal(options.onConflict,'anagrafica_id,codice_cliente');
 rows.forEach(r=>{assert.equal(r.anagrafica_id,id);stored.add(r.codice_cliente);});return {};}};}};
 await Promise.all([saveCodes(db,id,['P00002']),saveCodes(db,id,['P00003','P00002'])]);await saveCodes(db,id,[]);
 assert.equal(calls,2);assert.deepEqual([...stored].sort(),['P00001','P00002','P00003']);
 await assert.rejects(saveCodes({from(){return {async upsert(){return {error:{message:'db'}};}};}},id,['P00002']),/non riuscita/);
});
function api(db){
 const filename=path.join(__dirname,'../netlify/functions/garantisci-anagrafica.js'),module={exports:{}};
 const native=require('node:module').createRequire(filename);
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,process:{env:{SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'}},require(name){
 if(name==='@supabase/supabase-js')return {createClient:()=>db};
 if(name==='./_lib/require-auth')return {requireAuth:async()=>({ok:true,profilo:{id}})};
 return native(name);
 }});return module.exports.handler;
}
for(const existing of [true,false])test(`garantisci anagrafica ${existing?'esistente':'nuova'} conserva e aggiunge codici senza nuovi campi sulla tabella condivisa`,async()=>{
 const cliente={cf_piva:'RSSMRA80A01H501U',cluster:'Consumer',ragione_sociale:'Test',cellulare:'3331234567',email:'test@example.invalid'};
 const stored=new Set(['P00001']);let anaWrites=0;
 const db={from(table){if(table===TABLE)return {async upsert(rows){rows.forEach(r=>stored.add(r.codice_cliente));return {};}};
 assert.equal(table,'anagrafica');const q={select(){return q;},ilike(){return q;},async limit(){return {data:existing?[{id,...cliente}]:[]};},
 insert(row){anaWrites++;assert.equal(row.codici_cliente_windtre,undefined);assert.equal(row.codice_cliente,undefined);return q;},async single(){return {data:{id}};},update(){throw new Error('Nessun aggiornamento anagrafico previsto');}};return q;}};
 const handler=api(db),result=await handler({httpMethod:'POST',body:JSON.stringify({cliente:{...cliente,codici_cliente_windtre:['P00002','P00001']}})});
 assert.equal(result.statusCode,200);assert.equal(anaWrites,existing?0:1);assert.deepEqual([...stored].sort(),['P00001','P00002']);
});
test('codici anagrafici invalidi bloccano prima di qualsiasi scrittura',async()=>{
 const result=await api({from(){throw new Error('Non deve interrogare DB');}})({httpMethod:'POST',body:JSON.stringify({cliente:{codici_cliente_windtre:['<script>']}})});
 assert.equal(result.statusCode,400);
});
test('codice cliente corrente sopravvive a correzione, restore e reset della stessa categoria',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8'),a=source.indexOf(' function renderPdaFields(data)'),b=source.indexOf(' async function checkPendingCode()',a);
 const root={dataset:{},addEventListener(){}},refs={codiceCliente:{value:''}};
 const ctx={refs,document:{getElementById:()=>root},getCategoriaName:()=> 'Fisso',queueDraftSave(){},window:{MiroxPda:Pda,MiroxPdaUI:{formHtml:()=>'',bindForm(){},readForm:()=>({})}}};
 vm.runInNewContext(source.slice(a,b)+';this.render=renderPdaFields;this.read=readPdaFields;',ctx);
 ctx.render({codice_cliente:'P00001'});assert.equal(refs.codiceCliente.value,'P00001');
 refs.codiceCliente.value='P00002';ctx.render();const saved=ctx.read();assert.equal(saved.codice_cliente,'P00002');
 ctx.render(saved);assert.equal(ctx.read().codice_cliente,'P00002');ctx.render({});assert.equal(ctx.read().codice_cliente,null);
});
for(const [category,value] of [['Fisso',null],['Customer Base','<invalid>'],['Energia','P00001']])
test(`create: ${category} respinge codice cliente ${value===null?'mancante':'non ammesso'} prima delle scritture`,async()=>{
 const filename=path.join(__dirname,'../netlify/functions/crea-vendita-pratica-carrello.js'),module={exports:{}},native=require('node:module').createRequire(filename);
 const db={from(table){assert.equal(table,'vendita_categorie');return {select(){return this;},async in(){return {data:[{id:'cat',nome:category}]};}};}};
 vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,Buffer,Date,Intl,console:{log(){},warn(){},error(){}},process:{env:{SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'}},require(name){
 if(name==='@supabase/supabase-js')return {createClient:()=>db};
 if(name==='./_lib/require-auth')return {requireAuth:async()=>({ok:true,profilo:{id,ruolo:'operatore'}})};
 return native(name);
 }});
 const result=await module.exports.handler({httpMethod:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({cliente:{cf_piva:'RSSMRA80A01H501U',cluster:'Consumer',ragione_sociale:'Test',cellulare:'3331234567',email:'test@example.invalid'},contratti:[{categoria_id:'cat',offerta_id:'offer',codice_contratto:Pda.isPda(category)?'CONTRATTO1':null,codice_cliente:value}]})});
 assert.equal(result.statusCode,400);assert.match(JSON.parse(result.body).error,/Codice cliente/);
});
test('serializer anagrafico conserva piu codici di PDA diverse senza sommare dati delle altre categorie',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../moduli/upload-contratti-vendita.html'),'utf8'),a=source.indexOf(' function getClienteFormData()'),b=source.indexOf(' function validateClienteData(',a);
 const refs={};for(const key of ['cfPiva','cluster','ragioneSociale','nomeReferente','cellulare','email','provincia','comune','via','civico'])refs[key]={value:''};
 const ctx={refs,window:{MiroxPda:Pda},state:{cart:{contratti:[{categoria_nome:'Mobile',codice_cliente:'P00001'},{categoria_nome:'Fisso',codice_cliente:'P00002'},{categoria_nome:'Energia',codice_cliente:'P00099'}]}},normalizeCfPiva:v=>v,normalizeClusterValue:v=>v,isTuristaCluster:()=>false,getCategoriaName:()=> 'Customer Base',readPdaFields:()=>({codice_cliente:'P00001'})};
 vm.runInNewContext(source.slice(a,b)+';this.read=getClienteFormData;',ctx);
 assert.deepEqual(Array.from(ctx.read().codici_cliente_windtre),['P00001','P00002']);
});
