'use strict';
// NODE_PATH=/private/tmp/mirox-cc-planning-qa/node_modules node scripts/check-cc-planning-sql.cjs
// PostgreSQL WASM isolato: nessuna connessione o scrittura production.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const Core=require('../js/planning-core');
const migration=fs.readFileSync('database/20261104214454_cc_disponibilita_planning.sql','utf8');
const baseline=fs.readFileSync('database/069_baseline_allineamento.sql','utf8');
const legacy=baseline.match(/CREATE FUNCTION public.get_slot_disponibili\(p_data date\)[\s\S]*?\n\$\$;/)[0];
const publicBooking=fs.readFileSync('database/055_privacy_24_mesi_prenotazioni_atomiche.sql','utf8')
  .match(/CREATE OR REPLACE FUNCTION public.public_prenota_appuntamento_v1\([\s\S]*?\n\$fn\$;/)[0];
const actor='00000000-0000-4000-8000-000000000001';
const document=()=>Core.generate('2026-11',Core.defaultConfig(),'matteo');
const day=(d,id='matteo',date='2026-11-10')=>d.entries.find(e=>e.date===date&&e.employeeId===id);
const stamp=(time,date='2026-11-10',zone='+01:00')=>`${date}T${time}:00${zone}`;
const db=new PGlite();
let checks=0;
const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
async function run(){
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE profili(id uuid PRIMARY KEY,attivo boolean,ruolo text);
    INSERT INTO profili VALUES('${actor}',true,'admin');
    CREATE TABLE impostazioni(chiave text PRIMARY KEY,valore text);
    INSERT INTO impostazioni VALUES ('durata_slot','15'),('durata_appuntamento','30'),('buffer_appuntamenti','0'),('anticipo_minimo','0'),('anticipo_massimo','60');
    CREATE TABLE orari_standard(giorno integer,ora_inizio time,ora_fine time,attivo boolean);
    INSERT INTO orari_standard SELECT g,'09:00'::time,'12:30'::time,true FROM generate_series(1,6)g;
    INSERT INTO orari_standard SELECT g,'15:30'::time,'19:30'::time,true FROM generate_series(1,6)g;
    CREATE TABLE blocchi(tipo text,data_inizio date,data_fine date,ora_inizio time,ora_fine time);
    CREATE TABLE slot_bloccati(data_ora timestamptz,scadenza timestamptz);
    CREATE TABLE appuntamenti(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),data_ora timestamptz,durata_minuti integer DEFAULT 30,
      stato text DEFAULT 'confermato',nome text,telefono text,motivo text,note text,codice_fiscale text,fonte text,storico jsonb DEFAULT '[]');
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT ON profili,impostazioni TO service_role;
    GRANT SELECT,INSERT,UPDATE ON appuntamenti TO authenticated,service_role;`);
  await db.exec(fs.readFileSync('database/20261029200010_personale_planning.sql','utf8'));
  // Fissa solo NOW nella fixture per rendere la griglia legacy ripetibile nel tempo.
  await db.exec(legacy.replaceAll('NOW()',"'2026-11-01T00:00:00Z'::timestamptz"));
  await db.exec(publicBooking);
  const original=(await db.query("select pg_get_functiondef('get_slot_disponibili(date)'::regprocedure) as definition")).rows[0].definition;
  const publicOriginal=(await db.query("select pg_get_functiondef('public_prenota_appuntamento_v1(text,text,text,text,timestamptz)'::regprocedure) as definition")).rows[0].definition;
  // Un appuntamento esistente fuori presenza deve sopravvivere alla migration.
  const old=(await db.query('insert into appuntamenti(data_ora,note) values($1,$2) returning id',[stamp('09:00'),'esistente'])).rows[0].id;
  await db.exec(migration);
  equal((await db.query("select pg_get_functiondef('get_slot_disponibili(date)'::regprocedure) as definition")).rows[0].definition,original);
  equal((await db.query("select pg_get_functiondef('public_prenota_appuntamento_v1(text,text,text,text,timestamptz)'::regprocedure) as definition")).rows[0].definition,publicOriginal);
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const available=async(date='2026-11-10')=>(await scalar('select mirox_cc_slot_disponibili_v1($1) as slots',[date])).map(s=>new Date(s).toISOString());
  const legacySlots=async(date='2026-11-10')=>(await scalar('select get_slot_disponibili($1) as slots',[date])).map(s=>new Date(s).toISOString());
  const contains=(slots,time,date)=>slots.includes(new Date(stamp(time,date)).toISOString());
  const save=async(d,publish=true)=>db.query(`insert into personale_planning_mesi(mese,versione,bozza,pubblicato,pubblicato_versione,pubblicato_at)
    values($1,1,$2,$3,case when $3::jsonb is null then null else 1 end,case when $3::jsonb is null then null else now() end)
    on conflict(mese) do update set bozza=excluded.bozza,pubblicato=excluded.pubblicato,
      pubblicato_versione=excluded.pubblicato_versione,pubblicato_at=excluded.pubblicato_at`,[`${d.month}-01`,JSON.stringify(d),publish?JSON.stringify(d):null]);
  const presence=async(d,time,duration=30)=>scalar("select mirox_cc_privato.presenza_v1($1,$2::timestamptz at time zone 'Europe/Rome',($2::timestamptz+make_interval(mins=>$3)) at time zone 'Europe/Rome')",[d,stamp(time),duration]);
  const insert=(time,duration=30,date='2026-11-10')=>db.query('insert into appuntamenti(data_ora,durata_minuti) values($1,$2) returning id',[stamp(time,date),duration]);
  const reject=async(p,pattern=/slot_non_disponibile_planning/)=>{await assert.rejects(p,pattern);checks++;};
  equal(await available(),await legacySlots());
  let d=document();day(d).offsite=true;await save(d,false);
  equal(await available(),await legacySlots()); // bozza senza prima approvazione
  d=document();await save(d);
  let slots=await available();equal(contains(slots,'09:00'),false);equal(contains(slots,'09:30'),true);
  equal(contains(slots,'11:30'),true);equal(contains(slots,'11:45'),false);equal(contains(slots,'12:00'),false);
  equal(contains(slots,'15:30'),true);equal(contains(slots,'19:00'),true);equal(contains(slots,'19:15'),false);
  await reject(()=>insert('09:00'));await reject(()=>insert('11:45'));await reject(()=>insert('11:30',45));
  const booked=(await insert('09:30')).rows[0].id;equal(contains(await available(),'09:30'),false);
  await db.query('update appuntamenti set stato=$1 where id=$2',['annullato',booked]);
  equal(contains(await available(),'09:30'),true);
  // Precisione al minuto/secondo e fasce adiacenti, senza attraversare pause.
  equal(await presence(d,'11:30'),true);equal(await presence(d,'11:31'),false);
  day(d).slots=[['09:30','10:00'],['10:00','12:00']];equal(await presence(d,'09:45'),true);
  day(d).slots=[['09:30','10:00'],['10:01','12:00']];equal(await presence(d,'09:45'),false);
  // Permesso su un operatore basta; una pausa coperta dall'assenza non cambia il pomeriggio successivo.
  for(const id of ['matteo','vincenzo']){
    d=document();day(d,id).absences=[{type:'permessi',fullDay:false,start:'10:00',end:'10:30',code:''}];await save(d);
    slots=await available();equal(contains(slots,'09:30'),true);equal(contains(slots,'09:45'),false);
    equal(contains(slots,'10:00'),false);equal(contains(slots,'10:30'),true);await reject(()=>insert('09:45'));
    for(const type of ['ferie','permessi','malattia']){
      d=document();day(d,id).absences=[{type,fullDay:true,start:null,end:null,code:''}];await save(d);equal(await available(),[]);await reject(()=>insert('10:30'));
    }
    d=document();day(d,id).slots=[];await save(d);equal(await available(),[]);
    d=document();day(d,id).slots=[];day(d,id).closed=true;await save(d);equal(await available(),[]);
    d=document();day(d,id).offsite=true;day(d,id).slots=[['08:00','18:00']];await save(d);equal(await available(),[]);await reject(()=>insert('10:30'));
  }
  d=document();day(d,'isabella').offsite=true;day(d).workedMinutes=0;day(d).extraMinutes=120;day(d).details='Formazione';await save(d);
  equal(contains(await available(),'10:30'),true); // nessuna inferenza da note/ore o da altre persone
  d=document();for(const e of d.entries)delete e.offsite;await save(d);equal(contains(await available(),'10:30'),true);
  // Le revisioni in bozza non cambiano lo snapshot pubblicato.
  const draft=Core.clone(d);day(draft).offsite=true;
  await db.query('update personale_planning_mesi set bozza=$1 where mese=$2',[draft,'2026-11-01']);equal(contains(await available(),'10:30'),true);
  await save(draft);equal(await available(),[]);await reject(()=>insert('10:30'));
  // Gli esiti, le note, l'annullamento e la chiusura storica continuano a funzionare.
  await db.query('update appuntamenti set note=$1 where id=$2',['rettifica',old]);
  await db.query("update appuntamenti set stato='rischedulato' where id=$1",[old]);
  await reject(()=>db.query("update appuntamenti set stato='confermato' where id=$1",[old]));
  equal(await scalar('select count(*)::integer from appuntamenti where id=$1',[old]),1);
  await save(document());await db.query("update appuntamenti set stato='confermato' where id=$1",[booked]);
  await save(draft);
  await db.query("update appuntamenti set stato='confermato',note='esito' where id=$1",[booked]); // no spostamento
  await reject(()=>db.query('update appuntamenti set data_ora=$1 where id=$2',[stamp('10:00'),booked]));
  await reject(()=>db.query('update appuntamenti set durata_minuti=45 where id=$1',[booked]));
  // La RPC pubblica storica rimane atomica e il nuovo trigger rifiuta slot obsoleti.
  await reject(()=>db.query('select public_prenota_appuntamento_v1($1,$2,$3,$4,$5)',['Test','123456','Fisso','',stamp('10:30')]));
  await save(document());
  const publicId=await scalar('select public_prenota_appuntamento_v1($1,$2,$3,$4,$5)',['Test','123456','Fisso','',stamp('10:30')]);
  equal(typeof publicId,'string');
  await reject(()=>db.query('select public_prenota_appuntamento_v1($1,$2,$3,$4,$5)',['Test','123456','Fisso','',stamp('10:30')]),/slot_non_disponibile/);
  // Blocchi standard, occupazione/buffer e lock temporanei sono ancora vincolanti.
  await db.exec("insert into blocchi values('fascia','2026-11-10','2026-11-10','16:00','17:00')");
  equal(contains(await available(),'15:30'),true);equal(contains(await available(),'15:45'),false);equal(contains(await available(),'16:30'),false);
  await db.exec("insert into blocchi values('giornata','2026-11-11','2026-11-11',null,null)");equal(await available('2026-11-11'),[]);
  await db.query("insert into slot_bloccati values($1,now()+interval '1 hour')",[stamp('18:00')]);equal(contains(await available(),'18:00'),false);
  await db.exec("update impostazioni set valore='15' where chiave='buffer_appuntamenti'");equal(contains(await available(),'11:00'),false);
  // Mesi indipendenti e roster esplicito: Isabella non sostituisce un venditore.
  equal(await available('2026-12-01'),await legacySlots('2026-12-01'));
  // Alternanza: mattina del lunedi e pomeriggio del sabato non hanno entrambi.
  equal(contains(await available('2026-11-09'),'09:30','2026-11-09'),false);
  equal(contains(await available('2026-11-09'),'15:30','2026-11-09'),true);
  equal(contains(await available('2026-11-07'),'15:30','2026-11-07'),false);
  d=document();day(d).absences=[{type:'permessi',fullDay:false,start:'12:00',end:'16:00'}];await save(d);
  equal(contains(await available(),'11:30'),true);equal(contains(await available(),'15:30'),false);equal(contains(await available(),'16:00'),false); // blocco legacy 16-17 ancora attivo
  // Ora legale: stessi orari locali in estate, qualunque timezone della connessione.
  const summer=Core.generate('2027-07',Core.defaultConfig(),'matteo');await save(summer);
  equal(await scalar("select mirox_cc_privato.presenza_v1($1,$2::timestamptz at time zone 'Europe/Rome',($2::timestamptz+interval '30 minutes') at time zone 'Europe/Rome')",[summer,'2027-07-06T11:30:00+02:00']),true);
  equal(await scalar("select mirox_cc_privato.presenza_v1($1,$2::timestamptz at time zone 'Europe/Rome',($2::timestamptz+interval '30 minutes') at time zone 'Europe/Rome')",[summer,'2027-07-06T11:45:00+02:00']),false);
  d=document();d.employees=d.employees.filter(e=>e.id!=='vincenzo');await save(d);equal(await available(),[]);
  d=document();day(d).slots=null;await save(d);await reject(()=>available(),/planning_non_valido/);
  // Europe/Rome indipendente dal TimeZone della connessione (novembre solare).
  await save(document());await db.exec("set timezone='America/New_York'");equal(contains(await available(),'11:30'),true);
  // Privilegi: API solo service_role, tabelle Personale ancora private; trigger anche su INSERT diretto authenticated.
  await db.exec('set role authenticated');
  await reject(()=>available(),/permission denied/);
  await reject(()=>db.query('select pubblicato from personale_planning_mesi'),/permission denied/);
  await reject(()=>insert('09:00'),/Accesso negato/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);
  await reject(()=>insert('09:00'));
  await insert('17:30'); // trigger privato eseguibile solo come trigger, non come RPC
  await reject(()=>db.query('select mirox_cc_privato.verifica_appuntamento_v1()'),/permission denied/);
  await db.exec('reset role; set role service_role');equal(contains(await available(),'11:30'),true);
  await db.exec('reset role');
  await db.exec('begin');await insert('18:30');
  equal(await scalar("select exists(select 1 from pg_locks where relation='personale_planning_mesi'::regclass and mode='ShareLock' and granted)"),true);
  await db.exec('rollback');
  await db.exec('set role anon');await reject(()=>available(),/permission denied/);await db.exec('reset role');
  equal(await scalar("select count(*)::integer from pg_trigger where tgrelid='appuntamenti'::regclass and tgname='trg_mirox_cc_planning'"),1);
  if(process.argv[2]){
    const rows=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),output=[];
    for(const {planning,availability} of rows)for(const record of availability){
      let accepted=0;
      for(const s of record.slots){
        const date=new Date(s),finish=new Date(date.getTime()+30*60000);
        const sql=await scalar("select mirox_cc_privato.presenza_v1($1,$2::timestamptz at time zone 'Europe/Rome',$3::timestamptz at time zone 'Europe/Rome')",[planning,date.toISOString(),finish.toISOString()]);
        const time=date.toLocaleTimeString('en-GB',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
        const start=Core.minutes(time);
        const js=['matteo','vincenzo'].every(id=>{
          const e=planning.entries.find(e=>e.employeeId===id&&e.date===record.date);
          if(!e||e.closed||e.offsite)return false;
          const ranges=Core.availableSlots(e).map(pair=>pair.map(Core.minutes));
          return Array.from({length:30},(_,i)=>start+i).every(m=>ranges.some(([l,r])=>l<=m&&m<r));
        });
        equal(sql,js);if(sql)accepted++;
      }
      output.push({date:record.date,before:record.slots.length,after:accepted});
    }
    console.log('Replay locale su proiezione production priva di note/causali/clienti:',JSON.stringify(output));
  }
  console.log(`SQL CC/planning: ${checks} verifiche riuscite; migration, filtro legacy, assenze, fuori negozio, snapshot, trigger, pubblico e privilegi.`);
}
run().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;}).finally(()=>db.close());
