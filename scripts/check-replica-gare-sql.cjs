'use strict';
// NODE_PATH=/private/tmp/mirox-gare-replica-qa/node_modules node scripts/check-replica-gare-sql.cjs
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('database/replica_gare_da_novembre_2026.sql','utf8');
const apply=source.replace('applica boolean := false;','applica boolean := true;');
const october=fs.readFileSync('database/configura_gare_2026_10.sql','utf8');
const config=tag=>JSON.parse(october.split('$'+tag+'$')[1]);
const F='0284cf55-d97a-4709-9ece-d3f4894b80a7',V='c8c45da2-0cda-41eb-86cc-0272b8baa200';
const M='53f8fdfc-0595-4864-af49-5090bf3177db',R='3785e971-03a3-4598-8f19-15ef80a5f5fa';
async function setup(partial=false) {
 const db=new PGlite();
 await db.exec(`CREATE TABLE profili(id uuid PRIMARY KEY,nome text,attivo boolean,in_gara boolean,alias_di uuid);
  CREATE TABLE gara_metriche(id bigint PRIMARY KEY,nome text,tabella text,attiva boolean);
  CREATE TABLE gara_obiettivi_mensili(id bigserial PRIMARY KEY,anno smallint NOT NULL,mese smallint NOT NULL,
    metrica_id bigint NOT NULL REFERENCES gara_metriche(id),operatore_id uuid REFERENCES profili(id),
    obiettivo integer NOT NULL,compenso_regola jsonb NOT NULL,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),
    CONSTRAINT gom_anno_chk CHECK(anno BETWEEN 2024 AND 2100),CONSTRAINT gom_mese_chk CHECK(mese BETWEEN 1 AND 12),
    CONSTRAINT gom_obiettivo_chk CHECK(obiettivo>=0));
  CREATE UNIQUE INDEX uq_gom_anno_mese_metrica_op ON gara_obiettivi_mensili
    (anno,mese,metrica_id,coalesce(operatore_id,'00000000-0000-0000-0000-000000000000'::uuid));
  CREATE INDEX idx_gom_anno_mese ON gara_obiettivi_mensili(anno,mese);`);
 for(const [id,nome,active]of[[F,'Francesca',false],[V,'Vincenzo',true],[M,'Matteo',true],[R,'Mirko',true]])
  await db.query('INSERT INTO profili VALUES($1,$2,$3,$3,null)',[id,nome,active]);
 const names=['ATTIVAZIONI TIED','TELEFONI FINANZIATI GA','COSTUMER BASE','FISSO','LUCE & GAS','PARTITA IVA','ASSICURAZIONI','W3 PROTETTI'];
 for(const [i,name]of names.entries())await db.query("INSERT INTO gara_metriche VALUES($1,$2,'gara_individuale',true)",[i+1,name]);
 await db.exec("INSERT INTO gara_metriche VALUES(99,'MOBILI','avanzamento_standard',true)");
 const add=(month,metric,operator,target,rule,year=2026)=>db.query(`INSERT INTO gara_obiettivi_mensili
   (anno,mese,metrica_id,operatore_id,obiettivo,compenso_regola)VALUES($1,$2,$3,$4,$5,$6)`,[year,month,metric,operator,target,JSON.stringify(rule)]);
 for(const operator of[F,M,R])for(let metric=1;metric<=8;metric++)if(metric!==6){
  let rule={tipo:'per_pezzo',per_pezzo:metric+(operator===F?0.5:0)},target=20;
  if(metric===1){rule=config('tied');target=35;}
  if(metric===3){rule=config('cb');target=35;}
  if(metric===7){rule=config('assicurazioni');rule.gara.operatori=[F,M,R];target=10;}
  await add(10,metric,operator,target,rule);
 }
 await add(10,6,null,45,{tipo:'scaglioni',scaglioni:[{da:35,importo:150,tipo_calcolo:'flat'},{da:45,importo:250,tipo_calcolo:'flat'}]});
 await add(9,1,F,45,{tipo:'per_pezzo',per_pezzo:1});
 await add(10,99,null,100,{tipo:'nessuno'});
 await add(11,99,null,123,{tipo:'nessuno'});
 if(partial)await add(11,1,V,35,config('tied'));
 return db;
}
const snapshot=async db=>(await db.query(`SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY id)) value FROM gara_obiettivi_mensili o`)).rows[0].value;
async function checkSuccess(partial){
 const db=await setup(partial);
 try{
  const before=await snapshot(db);
  await db.exec(source);assert.equal(await snapshot(db),before,'preflight non scrive');
  await db.exec(apply.replace('\nCOMMIT;','\nROLLBACK;'));assert.equal(await snapshot(db),before,'rollback conserva tutto');
  const old=(await db.query('SELECT * FROM gara_obiettivi_mensili ORDER BY id')).rows;
  await db.exec(apply);
  const result=(await db.query(`SELECT count(*)::int n,count(DISTINCT(anno,mese))::int mesi,min(anno*100+mese)::int primo,max(anno*100+mese)::int ultimo
    FROM gara_obiettivi_mensili o JOIN gara_metriche m ON m.id=o.metrica_id
    WHERE (anno,mese)>=(2026,11)AND m.tabella='gara_individuale'`)).rows[0];
  assert.deepEqual(result,{n:19580,mesi:890,primo:202611,ultimo:210012});
  const template=(await db.query(`SELECT metrica_id,operatore_id,obiettivo,compenso_regola FROM gara_obiettivi_mensili o
    JOIN gara_metriche m ON m.id=o.metrica_id WHERE anno=2026 AND mese=10 AND m.tabella='gara_individuale'`)).rows;
  const expected=new Map(template.map(o=>{const row=structuredClone(o);if(row.operatore_id===F)row.operatore_id=V;
   if(row.compenso_regola.gara?.operatori)row.compenso_regola.gara.operatori=row.compenso_regola.gara.operatori.map(id=>id===F?V:id);
   if(row.compenso_regola.gara?.descrizione)row.compenso_regola.gara.descrizione=row.compenso_regola.gara.descrizione.replaceAll('Francesca','Vincenzo');
   return [row.metrica_id+':'+row.operatore_id,row];}));
  const future=(await db.query(`SELECT o.* FROM gara_obiettivi_mensili o JOIN gara_metriche m ON m.id=o.metrica_id
    WHERE(anno,mese)>=(2026,11)AND m.tabella='gara_individuale'`)).rows;
  for(const row of future){const {metrica_id,operatore_id,obiettivo,compenso_regola}=row;
   assert.deepEqual({metrica_id,operatore_id,obiettivo,compenso_regola},expected.get(metrica_id+':'+operatore_id));}
  for(const row of old)assert.deepEqual((await db.query('SELECT * FROM gara_obiettivi_mensili WHERE id=$1',[row.id])).rows[0],row);
  assert.equal((await db.query("SELECT count(*)::int n FROM gara_obiettivi_mensili WHERE(anno,mese)>=(2026,11)AND(compenso_regola::text LIKE '%Francesca%' OR operatore_id=$1)",[F])).rows[0].n,0);
  const after=await snapshot(db);await db.exec(apply);assert.equal(await snapshot(db),after,'retry non riscrive ne duplica');
  console.log('PASS preflight, rollback,19580righe/890mesi,modello esatto,storico e retry; parziale='+partial);
 }finally{await db.close();}
}
(async()=>{
 await checkSuccess(false);await checkSuccess(true);
 for(const failure of['conflitto','sorgente','uscente','effetto_collaterale']){
  const db=await setup();
  try{
   if(failure==='conflitto')await db.query("INSERT INTO gara_obiettivi_mensili(anno,mese,metrica_id,operatore_id,obiettivo,compenso_regola)VALUES(2026,11,1,$1,999,'{}')",[V]);
   if(failure==='sorgente')await db.exec("UPDATE gara_obiettivi_mensili SET obiettivo=34 WHERE anno=2026 AND mese=10 AND metrica_id=3");
   if(failure==='uscente')await db.query("INSERT INTO gara_obiettivi_mensili(anno,mese,metrica_id,operatore_id,obiettivo,compenso_regola)VALUES(2026,11,1,$1,35,'{}')",[F]);
   if(failure==='effetto_collaterale')await db.exec(`CREATE FUNCTION sporca()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE profili SET nome='alterato';RETURN NULL;END$$;
    CREATE TRIGGER sporca AFTER INSERT ON gara_obiettivi_mensili FOR EACH STATEMENT EXECUTE FUNCTION sporca();`);
   const before=await snapshot(db),profiles=(await db.query('SELECT * FROM profili ORDER BY id')).rows;
   await assert.rejects(db.exec(apply),/discordanti|Customer Base|Francesca|inattesa/);await db.exec('ROLLBACK');
   assert.equal(await snapshot(db),before);assert.deepEqual((await db.query('SELECT * FROM profili ORDER BY id')).rows,profiles);
   console.log('PASS rifiuto e rollback: '+failure);
  }finally{await db.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
