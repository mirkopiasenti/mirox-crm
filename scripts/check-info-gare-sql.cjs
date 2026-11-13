'use strict';
// NODE_PATH=/private/tmp/mirox-gare-replica-qa/node_modules node scripts/check-info-gare-sql.cjs
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const core=require('../js/dashboard-report-core');
const source=fs.readFileSync('database/aggiorna_info_gare_da_novembre_2026.sql','utf8');
const apply=source.replace('applica boolean := false;','applica boolean := true;');
const replica=fs.readFileSync('database/replica_gare_da_novembre_2026.sql','utf8').replace('applica boolean := false;','applica boolean := true;');
// Riusa solo il costruttore della fixture SQL versionata, senza avviarne il runner.
const fixture=fs.readFileSync('scripts/check-replica-gare-sql.cjs','utf8');
const setupBase=new Function('require',fixture.slice(0,fixture.indexOf('const snapshot='))+';return setup;')(require);
const V='c8c45da2-0cda-41eb-86cc-0272b8baa200';
const piva='1° SOGLIA: 35 PUNTI --> 150€\n2° SOGLIA: 45 PUNTI --> 250€\n3° SOGLIA: 55 PUNTI --> 350€';
const protecta='50€ --> PER OGNI PROTECTA FINANZIATO\n\n30€ --> PER OGNI PROTECTA CON IBAN';
async function setup(){
 const db=await setupBase();
 await db.exec('ALTER TABLE gara_metriche ADD COLUMN descrizione text');
 await db.exec("UPDATE gara_metriche SET nome='ASSICURAZIONI' WHERE id=99");
 await db.query('UPDATE gara_metriche SET descrizione=$1 WHERE id=6',[piva]);
 await db.query('UPDATE gara_metriche SET descrizione=$1 WHERE id=8',[protecta]);
 await db.exec(replica);
 await db.exec(`CREATE FUNCTION touch()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.updated_at=clock_timestamp();RETURN NEW;END$$;
  CREATE TRIGGER touch BEFORE UPDATE ON gara_obiettivi_mensili FOR EACH ROW EXECUTE FUNCTION touch();`);
 return db;
}
const snapshot=async db=>(await db.query(`SELECT jsonb_build_object(
 'goals',(SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY id)) FROM gara_obiettivi_mensili o),
 'metrics',(SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM gara_metriche m),
 'profiles',(SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM profili p))value`)).rows[0].value;
const financial=row=>{
 const copy=structuredClone(row);delete copy.updated_at;
 if(copy.compenso_regola.gara){delete copy.compenso_regola.gara.descrizione;if(!Object.keys(copy.compenso_regola.gara).length)delete copy.compenso_regola.gara;}
 return copy;
};
function popupCheck(goals,metrics){
 const page=fs.readFileSync('moduli/dashboard_pezzi.html','utf8');
 const script=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('const sb'));
 const expected=new Map([
  [1,'100 EUR al raggiungimento di 35 attivazioni TIED individuali.<br><br>Comprende SIM TIED Mobile, SIM TIED Dati e FWA Indoor.'],
  [3,'Bonus 100 EUR<br><br>35 Telefoni CB (VAR e Finanziati)<br>15 cambi piano Mobile (esclusi SOS Caring)'],
  [6,'BONUS DI SQUADRA<br><br>1° SOGLIA: 35 PUNTI --&gt; 150€<br>2° SOGLIA: 45 PUNTI --&gt; 250€<br>3° SOGLIA: 55 PUNTI --&gt; 350€'],
  [7,'BONUS DI SQUADRA<br><br>50 EUR --&gt; 10 PUNTI'],
  [8,'50€ --&gt; PER OGNI PROTECTA FINANZIATO<br><br>30€ --&gt; PER OGNI PROTECTA CON IBAN<br><br>50€ --&gt; PER OGNI PROTECTA BUSINESS']
 ]);
 const popups=[],nodes=new Map();
 const unescape=s=>s.replace(/&gt;/g,'>').replace(/&lt;/g,'<').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
 const document={getElementById(id){if(!nodes.has(id)){const node={innerHTML:'',textContent:'',querySelectorAll(selector){
   if(selector!=="tr.clickable[data-metrica-id]")return[];
   return [...node.innerHTML.matchAll(/<tr class="clickable" data-metrica-id="(\d+)" data-descrizione="([^"]*)">/g)].map(m=>({
    dataset:{metricaId:m[1],descrizione:unescape(m[2])},addEventListener(type,handler){handler();}}));
  }};nodes.set(id,node);}return nodes.get(id);}};
 const safe={};vm.runInNewContext(fs.readFileSync('js/mirox-safe.js','utf8'),{window:safe});
 const context=vm.createContext({db:{},document,MiroxDashboardReport:core,MiroxSafe:safe.MiroxSafe,MiroxUI:{alert:(html,options)=>popups.push({html,title:options.title})}});
 vm.runInContext(script.split('(function init()')[0],context);
 Object.assign(vm.runInContext('DPState',context),{anno:2026,mese:11,operatoriInGara:[{id:V,nome:'Vincenzo'}],metricheGara:metrics,obiettivi:goals});
 vm.runInContext('renderGare()',context);
 for(const [id,text]of expected){const m=metrics.find(m=>m.id===id);assert.equal(popups.find(p=>p.title===m.nome)?.html,text);}
 console.log('PASS renderer e click reali:5popup con testi e righe vuote esatti');
}
(async()=>{
 const db=await setup();
 try{
  const before=await snapshot(db),old=(await db.query('SELECT * FROM gara_obiettivi_mensili ORDER BY id')).rows;
  await db.exec(source);assert.deepEqual(await snapshot(db),before);
  await db.exec(apply.replace('\nCOMMIT;','\nROLLBACK;'));assert.deepEqual(await snapshot(db),before);
  await db.exec(apply);
  const rows=(await db.query('SELECT * FROM gara_obiettivi_mensili ORDER BY id')).rows;
  assert.equal(rows.length,old.length);
  for(let i=0;i<rows.length;i++)assert.deepEqual(financial(rows[i]),financial(old[i]));
  const changed=rows.filter((r,i)=>JSON.stringify(r)!==JSON.stringify(old[i]));assert.equal(changed.length,11570);
  assert.ok(changed.every(r=>r.anno>2026||r.anno===2026&&r.mese>=11));
  const metrics=(await db.query("SELECT *,CASE WHEN id=6 THEN 'squadra' ELSE 'individuale' END tipo_compenso FROM gara_metriche WHERE tabella='gara_individuale'")).rows;
  const november=rows.filter(r=>r.anno===2026&&r.mese===11);popupCheck(november,metrics);
  const after=await snapshot(db);await db.exec(apply);assert.deepEqual(await snapshot(db),after);
  console.log('PASS preflight,rollback,11570descrizioni,finanze/storico invariati e retry');
 }finally{await db.close();}
 for(const failure of['personalizzata','compenso','catalogo']){
  const db=await setup();
  try{
   if(failure==='personalizzata')await db.exec(`UPDATE gara_obiettivi_mensili SET compenso_regola=jsonb_set(compenso_regola,'{gara,descrizione}','"Testo personalizzato"')WHERE anno=2026 AND mese=11 AND metrica_id=1`);
   if(failure==='compenso')await db.exec(`CREATE FUNCTION sporca()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN NEW.obiettivo=NEW.obiettivo+1;RETURN NEW;END$$;
    CREATE TRIGGER sporca BEFORE UPDATE ON gara_obiettivi_mensili FOR EACH ROW EXECUTE FUNCTION sporca();`);
   if(failure==='catalogo')await db.exec(`CREATE FUNCTION sporca()RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE gara_metriche SET descrizione='alterata';RETURN NULL;END$$;
    CREATE TRIGGER sporca AFTER UPDATE ON gara_obiettivi_mensili FOR EACH STATEMENT EXECUTE FUNCTION sporca();`);
   const before=await snapshot(db);await assert.rejects(db.exec(apply),/preflight|estranea/);await db.exec('ROLLBACK');
   assert.deepEqual(await snapshot(db),before);console.log('PASS rifiuto e rollback: '+failure);
  }finally{await db.close();}
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
