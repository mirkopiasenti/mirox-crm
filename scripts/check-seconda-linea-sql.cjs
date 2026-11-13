'use strict';
// NODE_PATH=/private/tmp/mirox-reinserimenti-qa/node_modules node scripts/check-seconda-linea-sql.cjs
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('database/configura_punteggio_seconda_linea.sql','utf8');
const apply=source.replace('applica boolean := false;','applica boolean := true;');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.vendita_opzioni(id uuid PRIMARY KEY,nome_opzione text,punteggio_gara numeric,
      punti_base numeric,punteggio_extra_gara numeric,punti_extra_piva numeric,attiva boolean,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.vendita_contratti(id uuid PRIMARY KEY,opzione_id uuid,categoria_id uuid,offerta_id uuid,
      categoria_snapshot text,cluster_cliente text,nome_opzione_snapshot text,stato text,
      punteggio_gara_offerta numeric,punteggio_gara_opzione numeric,punteggio_gara_totale numeric,
      punteggio_extra_gara_offerta numeric,punteggio_extra_gara_opzione numeric,punteggio_extra_gara_totale numeric,
      punteggio_offerta numeric,punteggio_opzione numeric,punteggio_extra numeric,punteggio_totale numeric,
      updated_at timestamptz DEFAULT now(),updated_by uuid,controllato_da uuid,operatore_id uuid);
    CREATE TABLE public.vendita_log_modifiche(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tabella text,
      record_id uuid,azione text,dati_precedenti jsonb,dati_nuovi jsonb,created_at timestamptz DEFAULT now(),created_by uuid);
    CREATE TABLE public.vendita_verifiche(contratto_id uuid PRIMARY KEY,revisione integer);
    CREATE TABLE public.vendita_verifica_notifiche(id uuid PRIMARY KEY,contratto_id uuid,stato text);
    CREATE FUNCTION public.test_totali() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      NEW.punteggio_gara_totale=coalesce(NEW.punteggio_gara_offerta,0)+coalesce(NEW.punteggio_gara_opzione,0);
      NEW.punteggio_extra_gara_totale=coalesce(NEW.punteggio_extra_gara_offerta,0)+coalesce(NEW.punteggio_extra_gara_opzione,0);
      NEW.punteggio_offerta=coalesce(NEW.punteggio_gara_offerta,0);NEW.punteggio_opzione=coalesce(NEW.punteggio_gara_opzione,0);
      NEW.punteggio_extra=0;NEW.punteggio_totale=NEW.punteggio_gara_totale;RETURN NEW;END; $$;
    CREATE TRIGGER calcola_totali BEFORE INSERT OR UPDATE ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.test_totali();
    CREATE FUNCTION public.test_invalida() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF current_setting('mirox.verifica_commit',true) IS DISTINCT FROM 'yes' THEN
        UPDATE public.vendita_verifiche SET revisione=revisione+1 WHERE contratto_id=NEW.id;
      END IF;RETURN NEW;END; $$;
    CREATE TRIGGER invalida AFTER UPDATE ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.test_invalida();`);
  // Audit e CHECK reali, senza sostituirli con simulazioni.
  await db.exec(fs.readFileSync('database/058_integrita_e_audit_punteggi.sql','utf8'));
  await db.query('INSERT INTO public.vendita_opzioni VALUES ($1,$2,1,1,1,1,true,now()),($3,$4,0.5,0.5,0,0,true,now())',[id(100),'2° Linea',id(101),'Netflix']);
  for(let n=1;n<=10;n++) {
    await db.query(`INSERT INTO public.vendita_contratti
      (id,opzione_id,categoria_snapshot,cluster_cliente,nome_opzione_snapshot,stato,punteggio_gara_offerta,punteggio_gara_opzione,
      punteggio_extra_gara_offerta,punteggio_extra_gara_opzione) VALUES ($1,$2,'Fisso','Business',$3,$4,1.75,$5,1,$6)`,
      [id(n),id(n===10?101:100),n===10?'Netflix':'2° Linea',n%2?'Attivo':'KO',n===10?0.5:n<=7?1:1.5,n===10?0:1]);
    await db.query('INSERT INTO public.vendita_verifiche VALUES ($1,3)',[id(n)]);
  }
  await db.query("INSERT INTO public.vendita_verifica_notifiche VALUES ($1,$2,'inviata')",[id(200),id(1)]);
  return db;
}
const snapshot=async db=>(await db.query(`SELECT jsonb_build_object(
  'options',(SELECT jsonb_agg(o ORDER BY id) FROM public.vendita_opzioni o),
  'contracts',(SELECT jsonb_agg(c ORDER BY id) FROM public.vendita_contratti c),
  'logs',(SELECT jsonb_agg(l ORDER BY id) FROM public.vendita_log_modifiche l),
  'verifiche',(SELECT jsonb_agg(v ORDER BY contratto_id) FROM public.vendita_verifiche v)) AS value`)).rows[0].value;
(async()=>{
  const db=await setup();
  try {
    const before=await snapshot(db);await db.exec(source);assert.deepEqual(await snapshot(db),before);
    await db.exec(apply);
    const after=await snapshot(db),contracts=after.contracts.filter(c=>c.opzione_id===id(100));
    assert.equal(contracts.length,9);
    assert.ok(contracts.every(c=>c.punteggio_gara_opzione===1.5&&c.punteggio_gara_totale===3.25&&c.punteggio_totale===3.25));
    assert.ok(contracts.every(c=>c.punteggio_extra_gara_opzione===1&&c.punteggio_extra_gara_totale===2));
    assert.deepEqual(after.contracts.find(c=>c.id===id(10)),before.contracts.find(c=>c.id===id(10)));
    assert.deepEqual(after.verifiche,before.verifiche);
    assert.equal(after.logs.filter(l=>l.dati_nuovi?.rettifica==='seconda_linea_2026_10_31'&&l.tabella==='vendita_contratti').length,7);
    assert.equal(after.logs.filter(l=>l.azione==='rettifica_seconda_linea_catalogo').length,1);
    assert.equal(after.options.find(o=>o.id===id(100)).punteggio_gara,1.5);
    assert.equal(after.options.find(o=>o.id===id(100)).punti_base,1.5);
    await db.exec(apply);assert.deepEqual(await snapshot(db),after);
    assert.notEqual((await db.query("SELECT current_setting('mirox.verifica_commit',true) AS value")).rows[0].value,'yes');
  } finally {await db.close();}
  for(const fail of ['numero','extra','invalidazione']) {
    const broken=await setup();
    try {
      if(fail==='numero')await broken.query('DELETE FROM public.vendita_contratti WHERE id=$1',[id(1)]);
      if(fail==='extra')await broken.query('UPDATE public.vendita_contratti SET punteggio_extra_gara_opzione=2 WHERE id=$1',[id(1)]);
      if(fail==='invalidazione')await broken.exec(`CREATE OR REPLACE FUNCTION public.test_invalida() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        UPDATE public.vendita_verifiche SET revisione=revisione+1 WHERE contratto_id=NEW.id;RETURN NEW;END; $$;`);
      const before=await snapshot(broken);
      await assert.rejects(()=>broken.exec(apply),fail==='invalidazione'?/Verifiche o notifiche alterate/:/Attesi 9|diversi dal preflight/);
      assert.deepEqual(await snapshot(broken),before);
    } finally {await broken.close();}
  }
  console.log('SQL Seconda linea OK: preflight, catalogo, 7 correzioni/9 allineati, totali/legacy, audit reale, Extra/stati invariati, zero riesami, retry e rollback.');
})().catch(e=>{console.error(e);process.exitCode=1;});
