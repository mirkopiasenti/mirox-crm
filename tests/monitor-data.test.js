'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createDirectSource,validateDataConfig,probeDataConfig,minimize,CONTRACT_FIELDS}=require('../tools/monitor-windows/monitor-data.cjs');
const {directConfig,directFixture,fakeDb,fixture}=require('./monitor-helpers.cjs');
const Report=require('../js/monitor-report-core'),Core=require('../js/monitor-core');
const {buildSnapshot}=require('../netlify/functions/_lib/monitor-snapshot');
const SECRET='a'.repeat(64),reply=(value,status=200)=>new Response(JSON.stringify(value),{status});
test('config dati: solo HTTPS/progetto esplicito e chiave pubblica; mai service_role o origine arbitraria',()=>{
  const c=directConfig();assert.deepEqual(validateDataConfig(c),c);
  for(const url of ['http://abcdefghijklmnopqrst.supabase.co','https://evil.example','https://user@abcdefghijklmnopqrst.supabase.co','https://abcdefghijklmnopqrst.supabase.co/path','https://abcdefghijklmnopqrst.supabase.co?x=1'])assert.throws(()=>validateDataConfig({...c,url}));
  for(const anonKey of ['sb_secret_synthetic-private-key',c.anonKey.replace(c.anonKey.split('.')[1],Buffer.from(JSON.stringify({role:'service_role',ref:'abcdefghijklmnopqrst'})).toString('base64url')),c.anonKey.replace(c.anonKey.split('.')[1],Buffer.from(JSON.stringify({role:'anon',ref:'differentprojectref00'})).toString('base64url'))])assert.throws(()=>validateDataConfig({...c,anonKey}));
});
test('poll ordinario: 1000 controlli solo Supabase, trasferimento completo soltanto alla prima revisione',async()=>{
  const calls=[],first=directFixture();let full=0;
  const source=createDirectSource({config:directConfig(),remote:async(url,options)=>{
    calls.push({url,options});const request=JSON.parse(options.body);
    assert.equal(request.p_token,SECRET);assert.equal(options.redirect,'error');assert.ok(!JSON.stringify(options.headers).includes(SECRET));
    if(request.p_revisione===null){full++;return reply(first);}
    assert.equal(request.p_revisione,first.revisione);
    return reply({versione:2,data:first.data,revisione:first.revisione,invariato:true,postazione:'TV Legnago',verificato_il:'2026-11-05T15:00:00Z'});
  }});
  for(let i=0;i<1000;i++){const p=await source.read(SECRET);assert.equal(p.contratti.length,1);assert.ok(!JSON.stringify(p).includes(SECRET));}
  assert.equal(full,1);assert.equal(calls.length,1000);assert.ok(calls.every(c=>c.url===directConfig().url+'/rest/v1/rpc/mirox_monitor_leggi'));
  const last=await source.read(SECRET);assert.equal(last.aggiornato_il,first.aggiornato_il);assert.equal(last.verificato_il,'2026-11-05T15:00:00Z');
  assert.equal(Core.freshness(last,new Date(last.verificato_il)).stale,false);
});
test('revoca anche con revisione invariata: niente dati riutilizzati, nessun fallback Netlify',async()=>{
  let revoked=false,calls=0;const source=createDirectSource({config:directConfig(),remote:async()=>{calls++;return revoked?reply({code:'42501',message:SECRET},401):reply(directFixture());}});
  await source.read(SECRET);revoked=true;await assert.rejects(()=>source.read(SECRET),e=>e.status===403&&!e.message.includes(SECRET));assert.equal(calls,2);
});
test('reset e cambio credenziale richiedono dati completi, risposta invariata senza cache rifiutata',async()=>{
  const bodies=[];let unchanged=false;
  const source=createDirectSource({config:directConfig(),remote:async(_,o)=>{bodies.push(JSON.parse(o.body));return reply({...directFixture(),invariato:unchanged});}});
  await source.read(SECRET);await source.read('b'.repeat(64));assert.equal(bodies[1].p_revisione,null);
  source.reset();unchanged=true;await assert.rejects(()=>source.read(SECRET),/Copia locale/);assert.equal(bodies[2].p_revisione,null);
});
test('risposte parziali, errori di schema, redirect e stream troppo grandi non diventano zeri',async()=>{
  const bad=[{...directFixture(),post:null},{...directFixture(),contratti:null},{...directFixture(),invariato:undefined},{...directFixture(),versione:9},{...directFixture(),revisione:'wrong'}];
  for(const data of bad){const source=createDirectSource({config:directConfig(),remote:async()=>reply(data)});await assert.rejects(()=>source.read(SECRET));}
  const redirected=createDirectSource({config:directConfig(),remote:async()=>({ok:true,redirected:true})});await assert.rejects(()=>redirected.read(SECRET),/Origine/);
  const huge=createDirectSource({config:directConfig(),remote:async()=>new Response('x'.repeat(4*1024*1024+1))});await assert.rejects(()=>huge.read(SECRET),/estesa/);
});
test('minimizzazione: ID contratto pseudonimizzati, join conservati e campi clienti/credenziali rimossi',()=>{
  const p=directFixture();p.token=SECRET;p.contratti[0].codice_fiscale='RISERVATO';p.contratti[0].numero_telefono='RISERVATO';p.profili[0].username='RISERVATO';
  p.fttc=[{...p.contratti[0]}];p.post.fisso=[{contratto_id:p.contratti[0].id,stato:'Attivo',tecnologia:'FTTC',codice_cliente:'RISERVATO'}];
  const safe=minimize(p);assert.equal(safe.contratti[0].id,'c1');assert.equal(safe.fttc[0].id,'c1');assert.equal(safe.post.fisso[0].contratto_id,'c1');
  assert.doesNotMatch(JSON.stringify(safe),/RISERVATO|DA NON ESPORRE|SEGRETO|token|telefono/);assert.equal(safe.profili[0].id,p.profili[0].id);
  assert.deepEqual(CONTRACT_FIELDS,require('../js/dashboard-report-core').CONTRACT_FIELDS.split(','));
});
test('calcolo nel browser: stessi numeri e perimetri del backend precedente, input immutati',async()=>{
  const p=directFixture(),before=structuredClone(p);const actual=Report.build(minimize(p));
  const expected=await buildSnapshot(fakeDb(fixture()),new Date(p.aggiornato_il));
  for(const k of ['day','operatori','totale_day','mensile','agenda'])assert.deepEqual(actual[k],expected[k]);
  assert.deepEqual(p,before);assert.throws(()=>Report.build({...p,post:{}}));
});

test('scritture estranee: nuova revisione MVCC con stesso hash dati riusa la copia locale',async()=>{
  const first=directFixture();let calls=0;
  const revision=first.data+':'+'c'.repeat(32)+':'+'b'.repeat(32);
  const source=createDirectSource({config:directConfig(),remote:async()=>reply(calls++?{versione:2,data:first.data,revisione:revision,invariato:true,postazione:first.postazione,verificato_il:first.verificato_il}:first)});
  await source.read(SECRET);const cached=await source.read(SECRET);assert.equal(cached.revisione,revision);assert.equal(cached.contratti[0].id,'c1');
});

test('preflight installer: migrazione presente prima di fermare il vecchio servizio, nessuna credenziale reale usata',async()=>{
  let body;
  assert.equal(await probeDataConfig(directConfig(),{remote:async(_,options)=>{body=JSON.parse(options.body);return reply({code:'42501',message:'Postazione non associata o revocata.'},401);}}),true);
  assert.deepEqual(body,{p_token:'',p_revisione:null});
  for(const [data,status] of [[{code:'PGRST202'},404],[{code:'42501',message:'permission denied'},403],[{},200]])await assert.rejects(()=>probeDataConfig(directConfig(),{remote:async()=>reply(data,status)}));
});
