'use strict';
// NODE_PATH=/private/tmp/mirox-monitor-qa/node_modules node scripts/check-monitor-sql.cjs
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const db=new PGlite(),admin='00000000-0000-4000-8000-000000000001',operator='00000000-0000-4000-8000-000000000002';
const hash=n=>String(n).padStart(64,'0');let checks=0;
async function query(sql){return (await db.query(sql)).rows;}
async function equal(sql,expected){assert.deepEqual(await query(sql),expected);checks++;}
async function denied(sql){await assert.rejects(()=>db.query(sql));checks++;}
(async()=>{
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE profili(id uuid PRIMARY KEY,ruolo text,attivo boolean);INSERT INTO profili VALUES('${admin}','admin',true),('${operator}','operatore',true);GRANT SELECT ON profili TO service_role;`);
  const before=await query('SELECT * FROM profili ORDER BY id');
  await db.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;');
  await db.exec(fs.readFileSync('database/20261105123113_monitor_kpi_dispositivi.sql','utf8'));
  // Riproduce i default production, poi verifica la restrizione esplicita.
  await equal("SELECT has_table_privilege('service_role','public.mirox_monitor_audit','DELETE') AS consentito",[{consentito:true}]);
  await db.exec(fs.readFileSync('database/20261105131304_monitor_privilegi_service_role.sql','utf8'));
  await equal("SELECT has_table_privilege('service_role','public.mirox_monitor_audit','UPDATE') AS consentito,has_table_privilege('service_role','public.mirox_monitor_audit','DELETE') AS cancellabile",[{consentito:false,cancellabile:false}]);
  await equal("SELECT has_table_privilege('service_role','public.mirox_monitor_dispositivi','DELETE') AS cancellabile,has_table_privilege('service_role','public.mirox_monitor_dispositivi','TRUNCATE') AS troncabile",[{cancellabile:false,troncabile:false}]);
  for(const role of ['anon','authenticated']){await db.exec(`SET ROLE ${role}`);for(const table of ['mirox_monitor_dispositivi','mirox_monitor_audit','mirox_monitor_rate'])await denied('SELECT * FROM '+table);await denied(`SELECT mirox_monitor_associa('${hash(1)}','${hash(2)}')`);await denied(`SELECT mirox_monitor_amministra('${admin}','crea',NULL,'TV','${hash(1)}')`);await db.exec('RESET ROLE');}
  await db.exec('SET ROLE service_role');
  await denied(`SELECT mirox_monitor_amministra('${operator}','crea',NULL,'TV','${hash(1)}')`);
  const [{d}]=await query(`SELECT mirox_monitor_amministra('${admin}','crea',NULL,'TV Legnago','${hash(1)}') AS d`);
  await equal(`SELECT stato,token_hash,round(extract(epoch from pairing_expires_at-created_at)/60)::int AS ttl FROM mirox_monitor_dispositivi WHERE id='${d.id}'`,[{stato:'in_attesa',token_hash:null,ttl:15}]);
  await denied(`SELECT mirox_monitor_associa('${hash(9)}','${hash(2)}')`);
  await equal(`SELECT mirox_monitor_associa('${hash(1)}','${hash(2)}') AS id`,[{id:d.id}]);
  await equal(`SELECT mirox_monitor_associa('${hash(1)}','${hash(2)}') AS id`,[{id:d.id}]);
  await denied(`SELECT mirox_monitor_associa('${hash(1)}','${hash(3)}')`);
  await equal(`SELECT stato,pairing_hash,pairing_expires_at FROM mirox_monitor_dispositivi WHERE id='${d.id}'`,[{stato:'attivo',pairing_hash:null,pairing_expires_at:null}]);
  await equal(`SELECT count(*)::int AS n FROM mirox_monitor_audit WHERE dispositivo_id='${d.id}' AND azione='associa'`,[{n:1}]);
  await query(`SELECT mirox_monitor_amministra('${admin}','revoca','${d.id}')`);
  await query(`SELECT mirox_monitor_amministra('${admin}','revoca','${d.id}')`);
  await denied(`SELECT mirox_monitor_associa('${hash(1)}','${hash(2)}')`);
  await equal(`SELECT count(*)::int AS n FROM mirox_monitor_audit WHERE dispositivo_id='${d.id}' AND azione='revoca'`,[{n:1}]);
  const replacement=(await query(`SELECT mirox_monitor_amministra('${admin}','crea',NULL,'Riassociazione','${hash(6)}') AS d`))[0].d;
  // Riproduce l'errore23505 production: stato locale legacy pending, hash revocato.
  await assert.rejects(()=>query(`SELECT mirox_monitor_associa('${hash(6)}','${hash(2)}')`),error=>error.code==='23505'&&error.message.includes('mirox_monitor_dispositivi_token_hash_key'));checks++;
  await equal(`SELECT stato FROM mirox_monitor_dispositivi WHERE id='${replacement.id}'`,[{stato:'in_attesa'}]);
  await equal(`SELECT stato,token_hash FROM mirox_monitor_dispositivi WHERE id='${d.id}'`,[{stato:'revocato',token_hash:hash(2)}]);
  await equal(`SELECT mirox_monitor_associa('${hash(6)}','${hash(7)}') AS id`,[{id:replacement.id}]);
  await equal(`SELECT count(*)::int AS n FROM mirox_monitor_audit WHERE dispositivo_id='${replacement.id}' AND azione='associa'`,[{n:1}]);
  const expired=(await query(`SELECT mirox_monitor_amministra('${admin}','crea',NULL,'Scaduto','${hash(4)}') AS d`))[0].d;
  await query(`UPDATE mirox_monitor_dispositivi SET pairing_expires_at=now()-interval '1 second' WHERE id='${expired.id}'`);
  await denied(`SELECT mirox_monitor_associa('${hash(4)}','${hash(5)}')`);
  for(let i=0;i<20;i++)await equal(`SELECT mirox_monitor_limita('${hash(8)}') AS ok`,[{ok:true}]);
  await equal(`SELECT mirox_monitor_limita('${hash(8)}') AS ok`,[{ok:false}]);
  await query(`UPDATE mirox_monitor_rate SET finestra=now()-interval '16 minutes'`);
  await equal(`SELECT mirox_monitor_limita('${hash(8)}') AS ok`,[{ok:true}]);
  await denied(`UPDATE mirox_monitor_audit SET azione='crea'`);
  await denied(`DELETE FROM mirox_monitor_dispositivi`);
  await db.exec('RESET ROLE');assert.deepEqual(await query('SELECT * FROM profili ORDER BY id'),before);checks++;
  await equal("SELECT count(*)::int AS n FROM pg_proc WHERE proname LIKE 'mirox_monitor_%' AND prosecdef",[{n:0}]);
  console.log('Monitor SQL: '+checks+' verifiche riuscite; nessun collegamento production.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>db.close());
