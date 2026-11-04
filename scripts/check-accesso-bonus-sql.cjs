'use strict';
// NODE_PATH=/private/tmp/mirox-gare-replica-qa/node_modules node scripts/check-accesso-bonus-sql.cjs
const fs=require('node:fs'),assert=require('node:assert/strict');
const core=require('../js/dashboard-report-core');
const {PGlite}=require('@electric-sql/pglite');
const source=fs.readFileSync('database/configura_accesso_bonus_da_novembre_2026.sql','utf8');
const apply=source.replace('applica boolean := false;','applica boolean := true;');
const description='SOGLIA MINIMA DI 8 PEZZI PER ACCEDERE ALLA GARA\n\n10€ x PZ.. --> DAL 8^ AL 20^ \n\n15€ x PZ.. --> DAL 21^ IN POI\n\nEXTRA BONUS 50€ AL RAGGIUNGIMENTO DEI 35 PEZZI';
async function setup(){
  const db=new PGlite();
  await db.exec(`CREATE TABLE profili(id uuid PRIMARY KEY,nome text);
    INSERT INTO profili VALUES('c8c45da2-0cda-41eb-86cc-0272b8baa200','Vincenzo'),
      ('53f8fdfc-0595-4864-af49-5090bf3177db','Matteo'),('3785e971-03a3-4598-8f19-15ef80a5f5fa','Mirko');
    CREATE TABLE gara_metriche(id bigint PRIMARY KEY,nome text,tabella text,attiva boolean,descrizione text);
    INSERT INTO gara_metriche VALUES(4,'FISSO','gara_individuale',true,null),(99,'FISSO','avanzamento_standard',true,'Altro popup');
    CREATE TABLE gara_obiettivi_mensili(id bigserial PRIMARY KEY,anno smallint NOT NULL CHECK(anno BETWEEN 2024 AND 2100),
      mese smallint NOT NULL CHECK(mese BETWEEN 1 AND 12),metrica_id bigint REFERENCES gara_metriche(id),
      operatore_id uuid REFERENCES profili(id),obiettivo integer CHECK(obiettivo>=0),compenso_regola jsonb NOT NULL,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE UNIQUE INDEX uq_gom ON gara_obiettivi_mensili(anno,mese,metrica_id,coalesce(operatore_id,'00000000-0000-0000-0000-000000000000'::uuid));
    CREATE FUNCTION touch() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END$$;
    CREATE TRIGGER touch BEFORE UPDATE ON gara_obiettivi_mensili FOR EACH ROW EXECUTE FUNCTION touch();`);
  await db.query('UPDATE gara_metriche SET descrizione=$1 WHERE id=4',[description]);
  const rule={
    tipo:'scaglioni',decurtazione_soglia:7,scaglioni:[{da:0,a:20,importo:10,tipo_calcolo:'per_pezzo'},
      {da:21,a:null,importo:15,tipo_calcolo:'per_pezzo'}],bonus_soglie:[{soglia:35,bonus:50}]
  };
  await db.query(`INSERT INTO gara_obiettivi_mensili(anno,mese,metrica_id,operatore_id,obiettivo,compenso_regola)
    SELECT extract(year from d)::integer,extract(month from d)::integer,4,p.id,35,$1::jsonb
    FROM generate_series('2026-10-01'::date,'2100-12-01'::date,interval '1 month')d CROSS JOIN profili p`,[JSON.stringify(rule)]);
  await db.query(`UPDATE gara_obiettivi_mensili SET compenso_regola=compenso_regola||jsonb_build_object('gara',
    jsonb_build_object('descrizione',$1::text,'codice_rivenditore','9001415852')) WHERE anno=2027 AND mese=1`,[description]);
  await db.exec(`INSERT INTO gara_obiettivi_mensili(anno,mese,metrica_id,operatore_id,obiettivo,compenso_regola)
    VALUES(2026,10,99,null,90,'{"tipo":"nessuno","gara":{"descrizione":"Storico"}}'),
    (2026,11,99,null,100,'{"tipo":"per_pezzo","per_pezzo":5,"gara":{"descrizione":"Popup futuro conservato"}}');`);
  return db;
}
const rows=async db=>(await db.query('SELECT * FROM gara_obiettivi_mensili ORDER BY id')).rows;
const snapshot=async db=>(await db.query(`SELECT jsonb_build_object(
 'goals',(SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY id)) FROM gara_obiettivi_mensili o),
 'metrics',(SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM gara_metriche m),
 'profiles',(SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM profili p))value`)).rows[0].value;
(async()=>{
  const db=await setup();
  try{
    const before=await snapshot(db),old=await rows(db);
    await db.exec(source);assert.deepEqual(await snapshot(db),before);
    await db.exec(apply.replace('\nCOMMIT;','\nROLLBACK;'));assert.deepEqual(await snapshot(db),before);
    await db.exec(apply);
    const after=await rows(db);assert.equal(after.length,old.length);
    let count=0;
    for(let i=0;i<old.length;i++){
      const previous=old[i],current=after[i];
      if(previous.metrica_id===4 && previous.anno*100+previous.mese>=202611){
        count++;
        const expected=structuredClone(previous);expected.updated_at=current.updated_at;
        expected.compenso_regola.decurtazione_soglia=10;
        expected.compenso_regola.gara={...expected.compenso_regola.gara,descrizione:description.replace('MINIMA DI 8','MINIMA DI 10').replace('DAL 8^','DAL 10^')};
        assert.deepEqual(current,expected);
        assert.equal(core.calcolaCompenso(9,current.compenso_regola).label,'DECURTAZIONE');
        assert.equal(core.calcolaCompenso(10,current.compenso_regola).euro,100);
      }else assert.deepEqual(current,previous);
    }
    assert.equal(count,2670);
    const completed=await snapshot(db);assert.equal(completed.metrics,before.metrics);assert.equal(completed.profiles,before.profiles);
    await db.exec(apply);assert.deepEqual(await snapshot(db),completed);
    console.log('PASS preflight,rollback,2670Fisso/890mesi,9/10pezzi,solo2campi,storico/altri popup/catalogo/profili e retry');
  }finally{await db.close();}
  for(const failure of ['soglia','descrizione','mancante','compenso','catalogo']){
    const db=await setup();
    try{
      if(failure==='soglia')await db.exec("UPDATE gara_obiettivi_mensili SET compenso_regola=jsonb_set(compenso_regola,'{decurtazione_soglia}','11') WHERE anno=2026 AND mese=11 AND metrica_id=4");
      if(failure==='descrizione')await db.exec(`UPDATE gara_obiettivi_mensili SET compenso_regola=compenso_regola||'{"gara":{"descrizione":"Personalizzata"}}' WHERE anno=2026 AND mese=11 AND metrica_id=4`);
      if(failure==='mancante')await db.exec('DELETE FROM gara_obiettivi_mensili WHERE anno=2100 AND mese=12 AND metrica_id=4');
      if(failure==='compenso')await db.exec(`CREATE FUNCTION sporca() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.compenso_regola=jsonb_set(NEW.compenso_regola,'{scaglioni,0,importo}','999');RETURN NEW;END$$;
        CREATE TRIGGER sporca BEFORE UPDATE ON gara_obiettivi_mensili FOR EACH ROW EXECUTE FUNCTION sporca();`);
      if(failure==='catalogo')await db.exec(`CREATE FUNCTION sporca() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE gara_metriche SET descrizione='Alterata' WHERE id=4;RETURN NULL;END$$;
        CREATE TRIGGER sporca AFTER UPDATE ON gara_obiettivi_mensili FOR EACH STATEMENT EXECUTE FUNCTION sporca();`);
      const before=await snapshot(db);
      await assert.rejects(db.exec(apply),/inattese|annullamento/);await db.exec('ROLLBACK');
      assert.deepEqual(await snapshot(db),before);
      console.log('PASS rifiuto e rollback: '+failure);
    }finally{await db.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
