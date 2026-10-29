'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Core=require('../js/planning-core');
const {handle}=require('../netlify/functions/gestisci-planning')._test;
const {generatePdf}=require('../netlify/functions/_lib/planning-pdf');
const ID=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doc=()=>Core.generate('2026-11',Core.defaultConfig(),'matteo');
const entry=(d,date='2026-11-03',id='matteo')=>d.entries.find(e=>e.date===date&&e.employeeId===id);
const absence=(extra={})=>({type:'permessi',fullDay:false,start:'10:00',end:'11:30',code:'',...extra});
function fixture({admin=true,linked=true}={}){
  const config=Core.defaultConfig();if(linked)config.employees[0].profileId=ID(2);
  const state={profile:{id:ID(admin?1:2),ruolo:admin?'admin':'operatore',attivo:true},config:{documento:config,versione:1},row:null,audit:[],error:null,calls:[]};
  const client={from(table){state.calls.push(table);const filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},order(){return this;},limit(){return this;},in(){return this;},single(){return this;},maybeSingle(){return this;},then(resolve){
    let data=table==='profili'?state.profile:table==='personale_planning_config'?state.config:table==='personale_planning_mesi'?state.row:state.audit;
    if(table==='profili'&&filters.attivo===true)data=[state.profile];
    return Promise.resolve({data,error:state.error}).then(resolve);
  }};},async rpc(name,args){state.calls.push({name,args});if(state.error)return {error:state.error};
    if(name==='personale_salva_mese'){
      if((state.row?.versione||0)!==args.p_versione)return {error:{code:'40001'}};
      const version=args.p_versione+1;state.row={...state.row,mese:args.p_mese,versione:version,bozza:Core.clone(args.p_documento)};
      if(args.p_pubblica)Object.assign(state.row,{pubblicato:Core.clone(args.p_documento),pubblicato_versione:version,pubblicato_at:'2026-10-29T20:00:00Z'});
      return {data:state.row};
    }return {data:{versione:2}};
  }};
  const deps={requireAuth:async()=>({ok:true,user:{id:state.profile.id},profilo:{ruolo:'admin',attivo:true}}),getAdminClient:()=>client};
  return {state,deps};
}
const get=params=>({httpMethod:'GET',queryStringParameters:params});
const post=params=>({httpMethod:'POST',body:JSON.stringify(params)});
const body=res=>JSON.parse(res.body);
test('novembre: calendario UTC completo, domeniche e date non valide',()=>{
  assert.equal(Core.dates('2026-11').length,30);assert.equal(Core.weekday('2026-11-01'),0);
  assert.equal(Core.holiday('2026-11-01'),'Ognissanti');assert.equal(Core.holiday('2027-03-29'),'Lunedì dell’Angelo');
  for(const m of ['2026-10','2026-13','2026-1','2027-02-01','no'])assert.throws(()=>Core.month(m));
});
test('settimane: fasce corrette, alternanza manuale e ore contrattuali distinte',()=>{
  const d=doc();assert.deepEqual(entry(d,'2026-11-02').slots,[['15:30','19:30']]);
  assert.deepEqual(entry(d,'2026-11-07','vincenzo').slots,[['09:00','12:30']]);
  assert.deepEqual(entry(d,'2026-11-09','vincenzo').slots,[['15:30','19:30']]);
  assert.deepEqual(entry(d,'2026-11-14').slots,[['09:30','12:30']]);
  const week=d.entries.filter(e=>e.employeeId==='matteo'&&e.date>='2026-11-02'&&e.date<='2026-11-07');
  assert.equal(week.reduce((s,e)=>s+Core.slotMinutes(e.slots),0),2310);
  assert.equal(d.employees[0].contractMinutes,2400);
  assert.equal(d.entries.filter(e=>e.employeeId==='isabella'&&e.date>='2026-11-02'&&e.date<='2026-11-07').reduce((s,e)=>s+Core.slotMinutes(e.slots),0),2100);
  assert.equal(Core.generate('2026-11',Core.defaultConfig()).firstMondayOff,null);
});
test('alternanza segue le settimane anche se il mese inizia a metà settimana',()=>{
  const d=Core.generate('2026-12',Core.defaultConfig(),'matteo');
  assert.equal(Core.slotMinutes(entry(d,'2026-12-05','matteo').slots),180);
  assert.equal(Core.slotMinutes(entry(d,'2026-12-05','vincenzo').slots),420);
});
test('configurazione: nessun Francesca, niente riuso nomi/account, fine rapporto conserva storico',()=>{
  const c=Core.defaultConfig();assert.deepEqual(c.employees.map(e=>e.name),['Matteo','Vincenzo','Isabella']);
  c.employees[0].profileId=ID(2);c.employees[1].profileId=ID(2);assert.throws(()=>Core.validateConfig(c),/associato/);
  c.employees[1].profileId=null;c.employees[0].until='2026-11';assert.equal(Core.generate('2026-12',c).employees.length,2);
});
test('fasce: rifiuta overlap, inversioni, orari inesistenti; conserva minuti',()=>{
  assert.equal(Core.slotMinutes(Core.parseSlots('09:30-12:30;15:30-19:00')),390);
  for(const text of ['12:00-09:00','09:00-12:30;12:00-13:00','25:00-26:00','09:00'])assert.throws(()=>Core.parseSlots(text));
});
test('assenza parziale: sottrae solo il turno, senza contare pausa o straordinari automatici',()=>{
  const d=doc(),e=entry(d);e.absences=[absence({start:'12:00',end:'16:00'})];
  const valid=Core.validateDocument(d);assert.equal(Core.absenceMinutes(entry(valid)),60);
  assert.deepEqual(Core.availableSlots(e),[['09:30','12:00'],['16:00','19:30']]);
  assert.equal(Core.summary(valid,'matteo').extra,0);
});
test('assenze e consuntivi: intera giornata, zero ore e extra manuale separato',()=>{
  const d=doc(),e=entry(d);e.absences=[absence({type:'ferie',fullDay:true,start:null,end:null})];
  assert.equal(Core.absenceMinutes(e),420);assert.deepEqual(Core.availableSlots(e),[]);
  e.workedMinutes=0;e.extraMinutes=60;Core.validateDocument(d);assert.equal(Core.summary(d,'matteo').extra,60);
  e.workedMinutes=30;assert.throws(()=>Core.validateDocument(d),/superano/);
});
test('rifiuta assenze sovrapposte, assenze sul riposo e valori non finiti',()=>{
  const d=doc(),e=entry(d);e.absences=[absence(),absence()];assert.throws(()=>Core.validateDocument(d),/sovrappongono/);
  e.absences=[absence({start:'13:00',end:'14:00'})];assert.throws(()=>Core.validateDocument(d),/fuori/);
  e.absences=[];e.extraMinutes=Infinity;assert.throws(()=>Core.validateDocument(d));
  e.extraMinutes=0;e.workedMinutes=-1;assert.throws(()=>Core.validateDocument(d));
});
test('giorni duplicati/incompleti e dati fuori mese vengono respinti',()=>{
  const d=doc();d.entries.pop();assert.throws(()=>Core.validateDocument(d),/incompleto/);
  const d2=doc();d2.entries[0]=Core.clone(d2.entries[1]);assert.throws(()=>Core.validateDocument(d2),/duplicato/);
});
test('proiezione personale: nessuna causale, codice, nota, contratto o altro dipendente',()=>{
  const d=doc();entry(d).absences=[absence({type:'malattia',code:'SEGRETO-CODICE'})];entry(d).note='NOTA-PRIVATA';
  const p=Core.publicDocument(d,'matteo'),serialized=JSON.stringify(p);
  assert.equal(p.employees.length,1);assert.equal(p.entries.length,30);assert.equal(p.entries[2].absentMinutes,90);
  for(const forbidden of ['SEGRETO','PRIVATA','malattia','Vincenzo','Isabella','contractMinutes','workedMinutes'])assert.ok(!serialized.includes(forbidden));
});
test('API richiede autenticazione e rilegge sempre ruolo e attivazione',async()=>{
  const f=fixture();assert.equal((await handle(get({action:'config'}),{...f.deps,requireAuth:async()=>({ok:false,status:401,error:'Login'})})).statusCode,401);
  f.state.profile.attivo=false;assert.equal((await handle(get({action:'config'}),f.deps)).statusCode,403);
});
test('API dipendente: solo snapshot pubblicato proprio e nessuna bozza',async()=>{
  const f=fixture({admin:false});const published=doc();entry(published).note='privato';
  const draft=Core.clone(published);entry(draft).slots=[['10:00','11:00']];f.state.row={bozza:draft,pubblicato:published,pubblicato_at:'2026-10-29T20:00:00Z'};
  const res=await handle(get({month:'2026-11',employeeId:'vincenzo'}),f.deps);assert.equal(res.statusCode,200);
  const data=body(res);assert.equal(data.document.employees[0].id,'matteo');assert.deepEqual(data.document.entries[2].slots,[['09:30','12:30'],['15:30','19:30']]);assert.ok(!res.body.includes('privato'));
});
test('API account non collegato e dipendente non pubblicato: nessuna esposizione',async()=>{
  const f=fixture({admin:false,linked:false});assert.equal((await handle(get({month:'2026-11'}),f.deps)).statusCode,403);
  const f2=fixture({admin:false});assert.equal(body(await handle(get({month:'2026-11'}),f2.deps)).document,null);
});
test('API nega modifica, configurazione e PDF altrui ai non admin anche con ruolo cache admin',async()=>{
  const f=fixture({admin:false});
  assert.equal((await handle(post({action:'save'}),f.deps)).statusCode,403);
  assert.equal((await handle(get({action:'config'}),f.deps)).statusCode,403);
  for(const params of [{type:'hours'},{type:'collective'},{type:'personal',employeeId:'vincenzo'},{type:'personal',source:'draft'}])assert.equal((await handle(get({action:'pdf',month:'2026-11',...params}),f.deps)).statusCode,403);
});
test('API salva e pubblica con CAS; una revisione conserva snapshot precedente e conflitti409',async()=>{
  const f=fixture(),d=doc();
  assert.equal((await handle(post({action:'publish',month:d.month,version:0,document:d}),f.deps)).statusCode,200);
  const before=JSON.stringify(f.state.row.pubblicato);entry(d).note='revisione';
  assert.equal((await handle(post({action:'save',month:d.month,version:1,document:d}),f.deps)).statusCode,200);
  assert.equal(JSON.stringify(f.state.row.pubblicato),before);
  assert.equal((await handle(post({action:'save',month:d.month,version:1,document:d}),f.deps)).statusCode,409);
});
test('API blocca pubblicazione senza assegnazione iniziale e mese discordante',async()=>{
  const f=fixture(),d=Core.generate('2026-11',Core.defaultConfig());
  assert.equal((await handle(post({action:'publish',month:d.month,version:0,document:d}),f.deps)).statusCode,400);
  assert.equal((await handle(post({action:'save',month:'2026-12',version:0,document:d}),f.deps)).statusCode,400);
});
test('PDF personale e collettivo non contengono codici/causali; scheda ore admin li include',async()=>{
  const {getDocumentProxy,extractText}=require('unpdf'),d=doc();entry(d).absences=[absence({type:'malattia',code:'CODICE-PRIVATO-123'})];entry(d).note='NOTA-SEGRETA';
  for(const type of ['personal','collective','hours']){
    const buffer=await generatePdf(d,{type,employeeId:'matteo',draft:true});assert.equal(buffer.subarray(0,4).toString(),'%PDF');
    const proxy=await getDocumentProxy(new Uint8Array(buffer));assert.equal(proxy.numPages,1);const text=(await extractText(proxy,{mergePages:true})).text;await proxy.destroy?.();
    assert.match(text,/BOZZA/);assert.ok(!text.includes('NOTA-SEGRETA'));
    if(type==='hours')assert.match(text,/CODICE-PRIVATO-123/);else{assert.ok(!text.includes('CODICE-PRIVATO'));assert.ok(!text.includes('Malattia'));}
    if(type==='personal')assert.ok(!text.includes('Vincenzo'));
  }
});
test('migration nuova privata, RPC INVOKER, audit atomico e nessuna modifica tabelle condivise',()=>{
  const sql=fs.readFileSync(path.join(__dirname,'../database/20261029200010_personale_planning.sql'),'utf8');
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g)||[]).length,3);assert.equal((sql.match(/SECURITY INVOKER/g)||[]).length,2);
  assert.match(sql,/FROM PUBLIC, anon, authenticated/);assert.match(sql,/versione=p_versione/);assert.match(sql,/ERRCODE = '40001'/);
  assert.doesNotMatch(sql,/ALTER TABLE public\.(?:profili|anagrafica|orari_standard)\b|SECURITY DEFINER|CREATE POLICY/i);
});

test('PDF collettivo con piu dipendenti e nomi lunghi resta nei margini di stampa', async()=>{
  const config=Core.defaultConfig();
  for(let i=0;i<5;i++)config.employees.push({...Core.clone(config.employees[2]),id:`persona-${i}`,name:`Dipendente ${i} ${'W'.repeat(60)}`});
  const document=Core.generate('2026-11',config,'matteo');
  const {getDocumentProxy}=require('unpdf');
  const pdf=await getDocumentProxy(new Uint8Array(await generatePdf(document,{type:'collective'})));
  let content='';
  for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n),viewport=page.getViewport({scale:1}),text=await page.getTextContent();content+=text.items.map(i=>i.str||'').join('');
    for(const item of text.items.filter(i=>i.str?.trim()))assert.ok(item.transform[4]+item.width<=viewport.width-25,`Testo oltre margine: ${item.str}`);
    const firstDay=text.items.find(i=>/^(Dom|Lun|Mar|Mer|Gio|Ven|Sab) \d{2}\/\d{2}$/.test(i.str));
    if(firstDay)for(const item of text.items.filter(i=>i.str?.includes('W')))assert.ok(item.transform[5]>firstDay.transform[5]+5,'Intestazione lunga sovrapposta ai giorni');
  }
  for(const employee of document.employees)assert.ok(content.replace(/\s/g,'').includes(employee.name.replace(/\s/g,'')),`Nome troncato nel PDF: ${employee.name}`);
  await pdf.destroy?.();
});
