'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {getCustomerCodes}=require('../netlify/functions/gestisci-vendita-contratto')._test;
const Core=require('../js/mirox-permissions-core');
const id='11111111-1111-4111-8111-111111111111';
function dbFixture({codes=['P001','1.2343245'],missing=false,failure=false}={}){
 const calls=[];
 return {calls,db:{from(table){calls.push(table);const q={select(columns){calls.push(columns);return q;},eq(key,value){calls.push([key,value]);return q;},
  async maybeSingle(){return {data:missing?null:{anagrafica_id:id}};},async order(column){assert.equal(column,'codice_cliente');return failure?{error:new Error('private database error')}:{data:codes.map(codice_cliente=>({codice_cliente}))};}};return q;}}};
}
test('codici cliente: lookup dal contratto al registro conserva lettere, punti e zeri senza scritture',async()=>{
 const f=dbFixture(),response=await getCustomerCodes({supabase:f.db,body:{contratto_id:id}});
 assert.equal(response.statusCode,200);assert.deepEqual(JSON.parse(response.body).codici_cliente,['P001','1.2343245']);
 assert.deepEqual(f.calls.filter(x=>typeof x==='string'),['vendita_contratti','anagrafica_id','anagrafica_codici_cliente_windtre','codice_cliente']);
});
test('registro vuoto, contratto assente, UUID invalido ed errore DB restano distinti',async()=>{
 const empty=dbFixture({codes:[]});assert.deepEqual(JSON.parse((await getCustomerCodes({supabase:empty.db,body:{contratto_id:id}})).body).codici_cliente,[]);
 const missing=dbFixture({missing:true});assert.equal((await getCustomerCodes({supabase:missing.db,body:{contratto_id:id}})).statusCode,404);
 const invalid=dbFixture();assert.equal((await getCustomerCodes({supabase:invalid.db,body:{contratto_id:'bad'}})).statusCode,400);assert.equal(invalid.calls.length,0);
 const bad=dbFixture({failure:true});await assert.rejects(getCustomerCodes({supabase:bad.db,body:{contratto_id:id}}),/Impossibile leggere/);
});
test('lettura codici cliente richiede la ACL Verifica Contratti',()=>{
 assert.deepEqual(Core.endpointPages('gestisci-vendita-contratto',{body:JSON.stringify({action:'get_codici_cliente'})}),['verifica_contratti']);
});
test('dettaglio: codici escaped, duplicati eliminati e dato non disponibile esplicito',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../moduli/verifica_contratti.html'),'utf8');
 const a=source.indexOf('function renderCodiciCliente('),b=source.indexOf('function leggiPayloadDalPopup()',a);
 const ctx={escapeHtml:s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
 vm.runInNewContext(source.slice(a,b)+';this.render=renderCodiciCliente;',ctx);
 const html=ctx.render(['P001','1.2343245','P001','<img src=x>']);
 assert.match(html,/Codice cliente WindTre/);assert.match(html,/1\.2343245/);assert.equal((html.match(/P001/g)||[]).length,1);assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
 assert.match(ctx.render(),/Non disponibile/);assert.doesNotMatch(html,/<input|<select|<textarea/);
});
