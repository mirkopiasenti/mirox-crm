'use strict';
// NODE_PATH=/private/tmp/mirox-energia-qa/node_modules node scripts/check-monitor-diretto-sql.cjs
// Solo PGlite locale, fixture sintetiche: nessun collegamento production.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {CONTRACT_FIELDS}=require('../js/dashboard-report-core');
const {minimize,createDirectSource}=require('../tools/monitor-windows/monitor-data.cjs');
const Report=require('../js/monitor-report-core');
const db=new PGlite(),token='a'.repeat(64),hash=crypto.createHash('sha256').update(token).digest('hex');
const admin='11111111-1111-4111-8111-111111111111',cid='22222222-2222-4222-8222-222222222222',old='33333333-3333-4333-8333-333333333333';
let checks=0;
const query=async(sql,args)=>(await db.query(sql,args)).rows;
async function check(sql,expected){assert.deepEqual(await query(sql),expected);checks++;}
async function denied(sql,args){await assert.rejects(()=>query(sql,args));checks++;}
async function read(revision=null){return (await query('SELECT public.mirox_monitor_leggi($1,$2) AS d',[token,revision]))[0].d;}
async function insert(table,row){const keys=Object.keys(row);await query(`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>'$'+(i+1)).join(',')})`,Object.values(row).map(v=>v&&typeof v==='object'?JSON.stringify(v):v));}
(async()=>{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.profili(id uuid PRIMARY KEY,nome text,ruolo text,attivo boolean,in_gara boolean,alias_di uuid,username text);
    CREATE TABLE public.dashboard_righe_giornaliera(id bigint PRIMARY KEY,nome text,gruppo text,colore_hex text,ordine int,regola jsonb,attiva boolean);
    CREATE TABLE public.gara_metriche(id bigint PRIMARY KEY,nome text,tabella text,ordine int,regola jsonb,punteggio_campo text,attiva boolean);
    CREATE TABLE public.gara_obiettivi_mensili(id bigint PRIMARY KEY,metrica_id bigint,operatore_id uuid,obiettivo int,anno int,mese int);
    CREATE TABLE public.post_vendita_controllo_fissi(id uuid DEFAULT gen_random_uuid(),contratto_id uuid,stato text,tecnologia text,data_attivazione date);
    CREATE TABLE public.post_vendita_controllo_lg(id uuid DEFAULT gen_random_uuid(),contratto_id uuid,stato text,ultimo_csv_upload_at timestamptz);
    CREATE TABLE public.post_vendita_controllo_allarmi(id uuid DEFAULT gen_random_uuid(),contratto_id uuid,stato text);
    CREATE TABLE public.appuntamenti(id uuid PRIMARY KEY,stato text,data_ora timestamptz,durata_minuti int,presentato text,nome text,telefono text,note text);`);
  const booleans=new Set(['dispositivo_associato','kolme','reload_exchange','reinserimento_fisso_finalizzato']);
  const columns=CONTRACT_FIELDS.split(',').map(k=>k+' '+(['id','operatore_id'].includes(k)?'uuid':k==='data_contratto'?'timestamptz':booleans.has(k)?'boolean':k.startsWith('punteggio')?'numeric':'text'));
  await db.exec('CREATE TABLE public.vendita_contratti('+columns.join(',')+',anagrafica_id uuid,numero_telefono text,note_controllo text);');
  await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;");
  await insert('profili',{id:admin,nome:'Mirko',ruolo:'admin',attivo:true,in_gara:true,username:'RISERVATO'});
  const [{day,start,year,month}]=await query("SELECT (now() AT TIME ZONE 'Europe/Rome')::date::text AS day,date_trunc('month',now() AT TIME ZONE 'Europe/Rome')::date::text AS start,extract(year FROM now() AT TIME ZONE 'Europe/Rome')::int AS year,extract(month FROM now() AT TIME ZONE 'Europe/Rome')::int AS month");
  await insert('vendita_contratti',{id:cid,operatore_id:admin,cluster_cliente:'Business',categoria_snapshot:'Mobile',data_contratto:day+'T12:00:00Z',stato_inserimento:'nuovo',codice_rivenditore:'9001415852',punteggio_gara_totale:1.5,punteggio_extra_gara_totale:1,numero_telefono:'RISERVATO',note_controllo:'RISERVATO'});
  await insert('vendita_contratti',{id:old,operatore_id:admin,categoria_snapshot:'Fisso',data_contratto:'2020-01-01T12:00:00Z',stato_inserimento:'reinserimento',reinserimento_fisso_finalizzato:true,codice_rivenditore:'9000822241',punteggio_gara_totale:1.25});
  await insert('post_vendita_controllo_fissi',{contratto_id:old,stato:'Attivo',tecnologia:'FTTC',data_attivazione:start});
  await insert('post_vendita_controllo_lg',{contratto_id:cid,stato:'In lavorazione',ultimo_csv_upload_at:day+'T09:00:00Z'});
  await insert('dashboard_righe_giornaliera',{id:1,nome:'MOBILE',gruppo:'Mobile',ordine:1,regola:{categoria:'Mobile'},attiva:true});
  await insert('gara_metriche',{id:1,nome:'MOBILE',tabella:'avanzamento_standard',ordine:1,regola:{categoria:'Mobile'},punteggio_campo:'punteggio_gara_totale',attiva:true});
  await insert('gara_metriche',{id:2,nome:'FISSI',tabella:'avanzamento_standard',ordine:2,regola:{categoria:'Fisso'},punteggio_campo:'punteggio_gara_totale',attiva:true});
  await insert('gara_obiettivi_mensili',{id:1,anno:year,mese:month,metrica_id:1,obiettivo:30});
  await insert('appuntamenti',{id:cid,stato:'confermato',data_ora:day+'T12:00:00Z',durata_minuti:30,nome:'RISERVATO',telefono:'RISERVATO',note:'RISERVATO'});
  for(const name of ['profili','vendita_contratti','dashboard_righe_giornaliera','gara_metriche','gara_obiettivi_mensili','post_vendita_controllo_fissi','post_vendita_controllo_lg','post_vendita_controllo_allarmi','appuntamenti'])await db.exec('ALTER TABLE public.'+name+' ENABLE ROW LEVEL SECURITY;');
  const before=await query('SELECT to_jsonb(c) AS d FROM public.vendita_contratti c ORDER BY id');
  await db.exec(fs.readFileSync('database/20261105123113_monitor_kpi_dispositivi.sql','utf8'));
  await db.exec(fs.readFileSync('database/20261105131304_monitor_privilegi_service_role.sql','utf8'));
  await insert('mirox_monitor_dispositivi',{nome:'TV Test',stato:'attivo',token_hash:hash,creato_da:admin});
  const t0=performance.now();
  await db.exec(fs.readFileSync('database/20261118223737_monitor_diretto_supabase.sql','utf8'));checks++;
  for(const role of ['anon','authenticated']){
    await db.exec('SET ROLE '+role);
    for(const table of ['vendita_contratti','appuntamenti','profili','mirox_monitor_dispositivi','dashboard_righe_giornaliera','gara_metriche','gara_obiettivi_mensili','post_vendita_controllo_fissi','post_vendita_controllo_lg','post_vendita_controllo_allarmi'])await denied('SELECT * FROM public.'+table);
    await denied('SELECT * FROM public.mirox_monitor_dispositivi');
    for(const bad of [null,'wrong','b'.repeat(64)])await denied('SELECT public.mirox_monitor_leggi($1,NULL)',[bad]);
    const first=await read();assert.equal(first.invariato,false);assert.equal(first.data,day);assert.equal(first.contratti.length,1);assert.equal(first.fttc.length,1);assert.equal(first.agenda[0].id,cid.slice(0,8));checks++;
    assert.doesNotMatch(JSON.stringify(first),/RISERVATO|anagrafica_id|numero_telefono|username|token_hash/);checks++;
    const result=Report.build(minimize(first));assert.equal(result.totale_day,1);assert.equal(result.mensile.find(r=>r.nome==='FISSI').punti,1.25);checks++;
    const unchanged=await read(first.revisione);assert.equal(unchanged.invariato,true);assert.ok(!('contratti' in unchanged));assert.ok(!('agenda' in unchanged));checks++;
    let revision=unchanged.revisione;for(let i=0;i<100;i++){const next=await read(revision);assert.equal(next.invariato,true);assert.ok(!('contratti' in next));revision=next.revisione;}checks++;
    await denied('SELECT public.mirox_monitor_leggi($1,$2)',[token,'x'.repeat(101)]);
    const ref='abcdefghijklmnopqrst',anonKey='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'anon',ref})).toString('base64url')+'.synthetic';
    let wireCalls=0;
    const source=createDirectSource({config:{url:'https://'+ref+'.supabase.co',anonKey},remote:async(url,options)=>{
      assert.equal(url,'https://'+ref+'.supabase.co/rest/v1/rpc/mirox_monitor_leggi');wireCalls++;
      const args=JSON.parse(options.body);const data=(await query('SELECT public.mirox_monitor_leggi($1,$2) AS d',[args.p_token,args.p_revisione]))[0].d;
      return new Response(JSON.stringify(data),{status:200});
    }});
    const wireFirst=await source.read(token),wireNext=await source.read(token);
    assert.equal(wireCalls,2);assert.deepEqual(Report.build(wireFirst).mensile,Report.build(wireNext).mensile);checks++;

    await db.exec('RESET ROLE');
  }
  const initial=await read();
  await db.exec('BEGIN');await query("UPDATE public.vendita_contratti SET punteggio_gara_totale=2 WHERE id=$1",[cid]);
  const changed=await read(initial.revisione);assert.equal(changed.invariato,false);assert.equal(changed.contratti[0].punteggio_gara_totale,2);checks++;
  await db.exec('ROLLBACK');assert.equal((await read(initial.revisione)).invariato,true);checks++;
  await query("UPDATE public.appuntamenti SET presentato='si' WHERE id=$1",[cid]);
  const agenda=await read(initial.revisione);assert.equal(agenda.invariato,false);assert.equal(Report.build(minimize(agenda)).agenda.presentati,1);checks++;
  await db.exec('BEGIN');await db.exec('TRUNCATE public.appuntamenti');assert.equal((await read(agenda.revisione)).agenda.length,0);checks++;await db.exec('ROLLBACK');
  for(const sql of [
    "UPDATE public.dashboard_righe_giornaliera SET nome=nome||'x'",
    "UPDATE public.gara_metriche SET nome=nome||'x'",
    'UPDATE public.gara_obiettivi_mensili SET obiettivo=obiettivo+1',
    "UPDATE public.profili SET nome=nome||'x'",
    "UPDATE public.post_vendita_controllo_fissi SET stato='KO'",
    "UPDATE public.post_vendita_controllo_lg SET stato='Annullato'",
    "INSERT INTO public.post_vendita_controllo_allarmi(contratto_id,stato) VALUES('"+cid+"','OK')"
  ]){
    const previous=await read();await db.exec('BEGIN');await db.exec(sql);
    const next=await read(previous.revisione);assert.equal(next.invariato,false);assert.notEqual(next.revisione,previous.revisione);checks++;await db.exec('ROLLBACK');
  }
  // Un'altra tabella scritta cambia MVCC, ma non fa trasferire gli stessi dati.
  await db.exec('CREATE TABLE public.estranea(id int)');const beforeOther=await read();
  await db.exec('INSERT INTO public.estranea VALUES(1)');const other=await read(beforeOther.revisione);
  assert.equal(other.invariato,true);assert.ok(!('contratti' in other));checks++;
  await check("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'mirox_monitor_%'",[{n:0}]);
  await check("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='mirox_monitor_privato'",[{n:0}]);
  await query("UPDATE public.mirox_monitor_dispositivi SET stato='revocato' WHERE token_hash=$1",[hash]);
  await db.exec('SET ROLE anon');await denied('SELECT public.mirox_monitor_leggi($1,$2)',[token,agenda.revisione]);await db.exec('RESET ROLE');
  assert.deepEqual(await query('SELECT to_jsonb(c) AS d FROM public.vendita_contratti c ORDER BY id'),before);checks++;
  await check("SELECT prosecdef AS definer FROM pg_proc WHERE oid='public.mirox_monitor_leggi(text,text)'::regprocedure",[{definer:false}]);
  await check("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public'",[{n:0}]);
  await check("SELECT has_schema_privilege('anon','mirox_monitor_privato','CREATE') AS permesso",[{permesso:false}]);
  await check("SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace WHERE (ns.nspname='mirox_monitor_privato' AND p.proname='leggi' OR ns.nspname='public' AND p.proname='mirox_monitor_leggi') AND p.proconfig @> ARRAY['search_path=\"\"']",[{n:2}]);
  await db.exec(fs.readFileSync('database/20261124215619_monitor_sprint_novembre.sql','utf8'));
  await query("UPDATE public.mirox_monitor_dispositivi SET stato='attivo' WHERE token_hash=$1",[hash]);
  const beforeSprint=await read();
  await query('INSERT INTO mirox_monitor_privato.sprint_novembre_2026 VALUES (1,12.75)');
  for(const role of ['anon','authenticated','service_role']){
    await db.exec('SET ROLE '+role);
    await denied('SELECT * FROM mirox_monitor_privato.sprint_novembre_2026');
    await denied('SELECT public.mirox_monitor_leggi($1,NULL)',['b'.repeat(64)]);
    const current=await read(beforeSprint.revisione);
    if(day>='2026-11-24'&&day<'2026-12-01'){
      assert.equal(current.metriche.find(m=>m.id===1).regola.mirox_sprint_novembre_2026,12.75);
      assert.equal(minimize(current).metriche.find(m=>m.id===1).regola.mirox_sprint_novembre_2026,12.75);
      assert.equal((await read(current.revisione)).invariato,true);
    }else{
      assert.equal(current.invariato,true);
      assert.ok(!JSON.stringify(await read()).includes('mirox_sprint_novembre_2026'));
    }
    checks+=3;
    await db.exec('RESET ROLE');
  }
  await check("SELECT regola FROM public.gara_metriche WHERE id=1",[{regola:{categoria:'Mobile'}}]);
  console.log('Monitor diretto SQL: '+checks+' verifiche riuscite ('+Math.round(performance.now()-t0)+'ms), nessun collegamento production.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.close());
