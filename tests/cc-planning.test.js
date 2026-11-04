'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../js/planning-core');
const {handle,validDate}=require('../netlify/functions/gestisci-disponibilita-cc')._test;
const Public=require('../netlify/functions/public-prenota')._test;
const get=data=>({httpMethod:'GET',queryStringParameters:{data}});
function fixture(profile={attivo:true,ruolo:'operatore',pagine_accessibili:{prenota_interno:true}}){
  const calls=[];const state={profile,error:null,slots:['2026-11-10T09:30:00+01:00']};
  const db={from(){return{select(){return this;},eq(){return this;},single:async()=>({data:state.profile,error:state.error})};},
    rpc:async(name,args)=>{calls.push({name,args});return{data:state.slots,error:state.error};}};
  return{state,calls,db,deps:{requireAuth:async()=>({ok:true,user:{id:'user'}}),getAdminClient:()=>db}};
}
test('fuori negozio: normalizza storico, persiste la scelta e conserva ore e proiezione privata',()=>{
  const d=Core.generate('2026-11',Core.defaultConfig(),'matteo');for(const e of d.entries)delete e.offsite;
  let clean=Core.validateDocument(d);assert.equal(clean.entries[0].offsite,false);
  const e=d.entries.find(e=>e.date==='2026-11-10'&&e.employeeId==='matteo');e.offsite=true;
  clean=Core.validateDocument(d);assert.equal(clean.entries.find(e=>e.date==='2026-11-10'&&e.employeeId==='matteo').offsite,true);
  assert.deepEqual(Core.summary(clean,'matteo'),Core.summary(Core.generate('2026-11',Core.defaultConfig(),'matteo'),'matteo'));
  assert.deepEqual(Core.availableSlots(e),e.slots);
  assert.ok(!JSON.stringify(Core.publicDocument(clean,'matteo')).includes('offsite'));
  for(const value of ['true',null,1,{}]){e.offsite=value;assert.throws(()=>Core.validateDocument(d),/Fuori negozio/);}
});
test('date CC: rifiuta rollover, input incompleti e date impossibili',()=>{
  for(const date of ['2026-11-10','2028-02-29'])assert.equal(validDate(date),true);
  for(const date of ['2026-02-29','2026-11-31','2026-13-01','2026-1-01',null,'2026-11-10T00:00:00Z'])assert.equal(validDate(date),false);
});
test('API CC: autenticazione, profilo fresco e permessi CC; niente planning nella risposta',async()=>{
  const f=fixture();let response=await handle(get('2026-11-10'),f.deps);
  assert.equal(response.statusCode,200);assert.equal(response.headers['Cache-Control'],'no-store');
  assert.deepEqual(JSON.parse(response.body),{ok:true,slots:f.state.slots});
  assert.deepEqual(f.calls,[{name:'mirox_cc_slot_disponibili_v1',args:{p_data:'2026-11-10'}}]);
  f.state.profile.attivo=false;assert.equal((await handle(get('2026-11-10'),f.deps)).statusCode,403);
  f.state.profile={attivo:true,ruolo:'operatore',pagine_accessibili:{}};assert.equal((await handle(get('2026-11-10'),f.deps)).statusCode,403);
  f.state.profile={attivo:true,ruolo:'admin'};assert.equal((await handle(get('2026-11-10'),f.deps)).statusCode,200);
  assert.equal((await handle(get('2026-11-10'),{...f.deps,requireAuth:async()=>({ok:false,status:401,error:'Login'})})).statusCode,401);
  assert.equal((await handle(get('2026-11-31'),f.deps)).statusCode,400);
  assert.equal((await handle({httpMethod:'POST'},f.deps)).statusCode,405);
});
test('API CC: errori di lettura restano bloccanti, senza fallback legacy o dati interni',async()=>{
  const f=fixture();f.state.error={message:'SEGRETO'};
  const response=await handle(get('2026-11-10'),f.deps);assert.equal(response.statusCode,503);assert.ok(!response.body.includes('SEGRETO'));
  const pub=await Public.handleGetSlots(get('2026-11-10'),{rpc:async()=>({error:f.state.error})});
  assert.equal(pub.statusCode,503);assert.ok(!pub.body.includes('SEGRETO'));
});
test('pubblico: filtro comune e slot obsoleto respinto al salvataggio come conflitto',async()=>{
  const f=fixture();const res=await Public.handleGetSlots(get('2026-11-10'),f.db);assert.equal(res.statusCode,200);
  assert.equal(f.calls[0].name,'mirox_cc_slot_disponibili_v1');
  const post={body:JSON.stringify({nome:'Test',telefono:'123456',motivo:'Fisso',data_ora:'2026-11-10T09:30:00+01:00'})};
  const response=await Public.handlePost(post,{rpc:async()=>({error:{message:'slot_non_disponibile_planning'}})});
  assert.equal(response.statusCode,409);
});
test('client CC: passa da MiroxApi, distingue slot vuoti da errori e non ripiega su Supabase',async()=>{
  const calls=[];let response={ok:true,json:async()=>({ok:true,slots:[]})};
  const window={MiroxApi:{fetch:async(...args)=>{calls.push(args);if(response instanceof Error)throw response;return response;}}};
  vm.runInNewContext(fs.readFileSync('js/cc-disponibilita.js','utf8'),{window});
  assert.equal((await window.MiroxCcDisponibilita.slots('2026-11-10')).error,null);
  assert.match(calls[0][0],/gestisci-disponibilita-cc\?data=2026-11-10/);
  response={ok:false,json:async()=>({error:'Riprovare'})};assert.ok((await window.MiroxCcDisponibilita.slots('2026-11-10')).error);
  response=new Error('offline');assert.equal((await window.MiroxCcDisponibilita.slots('2026-11-10')).data,null);
  assert.match(window.MiroxCcDisponibilita.errorMessage({message:'slot_non_disponibile_planning'}),/planning approvato/);
});
