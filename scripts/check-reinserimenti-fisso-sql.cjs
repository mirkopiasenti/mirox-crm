'use strict';
// NODE_PATH=/private/tmp/mirox-reinserimenti-qa/node_modules node scripts/check-reinserimenti-fisso-sql.cjs
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const sql=fs.readFileSync('database/20261031122329_reinserimenti_fisso.sql','utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup() {
  const db=new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.vendita_pratiche(id uuid PRIMARY KEY, stato_pratica text, operatore_id uuid);
    CREATE TABLE public.vendita_contratti(id uuid PRIMARY KEY, pratica_id uuid REFERENCES public.vendita_pratiche,
      anagrafica_id uuid, categoria_id uuid, categoria_snapshot text, stato_inserimento text,
      reinserimento_di_contratto_id uuid REFERENCES public.vendita_contratti, data_contratto timestamptz);
    CREATE TABLE public.post_vendita_controllo_fissi(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      contratto_id uuid UNIQUE REFERENCES public.vendita_contratti, stato text, motivo_ko text,
      stato_cambiato_at timestamptz, stato_cambiato_da uuid);
    CREATE TABLE public.vendita_log_modifiche(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tabella text, record_id uuid, azione text, dati_precedenti jsonb, dati_nuovi jsonb, created_by uuid);
    CREATE TABLE public.test_revisioni_documentali(id uuid);
    CREATE FUNCTION public.test_invalida_documenti() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF current_setting('mirox.verifica_commit',true) IS DISTINCT FROM 'yes' THEN
          INSERT INTO public.test_revisioni_documentali VALUES (NEW.id);
        END IF;
        RETURN NEW;
      END; $$;
    CREATE TRIGGER test_invalida_documenti AFTER UPDATE ON public.vendita_contratti
      FOR EACH ROW EXECUTE FUNCTION public.test_invalida_documenti();
    ALTER TABLE public.vendita_pratiche ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendita_contratti ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.post_vendita_controllo_fissi ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.vendita_log_modifiche ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    GRANT SELECT ON public.vendita_contratti TO authenticated;`);
  return db;
}
async function seed(db,n,{parent=null,stato='In Attivazione',inviata=parent===null,customer=900,month='10'}={}) {
  await db.query('INSERT INTO public.vendita_pratiche VALUES ($1,$2,$3)',[id(100+n),inviata?'inviata':'bozza',id(999)]);
  await db.query(`INSERT INTO public.vendita_contratti
    (id,pratica_id,anagrafica_id,categoria_id,categoria_snapshot,stato_inserimento,reinserimento_di_contratto_id,data_contratto)
    VALUES ($1,$2,$3,$4,'Fisso',$5,$6,$7)`,[id(n),id(100+n),id(customer),id(901),parent?'reinserimento':'inserimento',parent?id(parent):null,`2026-${month}-10T12:00:00Z`]);
  await db.query(`INSERT INTO public.post_vendita_controllo_fissi
    (contratto_id,stato,motivo_ko,stato_cambiato_at) VALUES ($1,$2,'Motivo precedente','2026-10-01T12:00:00Z')`,[id(n),stato]);
}
const finalize=(db,n)=>db.query("UPDATE public.vendita_pratiche SET stato_pratica='inviata' WHERE id=$1",[id(100+n)]);
const row=async(db,n)=>(await db.query(`SELECT c.reinserimento_fisso_finalizzato AS flag,f.stato,f.motivo_ko,
  f.stato_cambiato_at,p.stato_pratica FROM public.vendita_contratti c
  JOIN public.vendita_pratiche p ON p.id=c.pratica_id
  JOIN public.post_vendita_controllo_fissi f ON f.contratto_id=c.id WHERE c.id=$1`,[id(n)])).rows[0];
(async()=>{
  const db=await setup();
  try {
    // Backfill di un originale in attivazione e di uno gia KO: nessuna riscrittura del KO.
    await seed(db,1);await seed(db,2,{parent:1,inviata:true});
    await seed(db,3,{stato:'KO'});await seed(db,4,{parent:3,inviata:true});
    await db.exec(sql);
    assert.equal((await row(db,1)).stato,'KO');assert.equal((await row(db,2)).flag,true);
    assert.equal((await row(db,4)).flag,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.test_revisioni_documentali')).rows[0].n,0);
    assert.equal((await row(db,3)).motivo_ko,'Motivo precedente');
    assert.equal((await row(db,3)).stato_cambiato_at.toISOString(),'2026-10-01T12:00:00.000Z');
    assert.equal((await db.query('SELECT count(*)::int n FROM public.vendita_log_modifiche')).rows[0].n,1);

    await db.exec('SET ROLE service_role');
    await seed(db,5);await seed(db,6,{parent:5});
    assert.equal((await row(db,5)).stato,'In Attivazione');assert.equal((await row(db,6)).flag,false);
    await finalize(db,6);
    assert.equal((await row(db,5)).stato,'KO');assert.equal((await row(db,6)).flag,true);
    const audit=(await db.query("SELECT * FROM public.vendita_log_modifiche WHERE azione='ko_per_reinserimento_fisso'")).rows;
    assert.equal(audit.length,1);assert.equal(audit[0].created_by,id(999));
    assert.equal(audit[0].dati_precedenti.stato,'In Attivazione');assert.equal(audit[0].dati_nuovi.stato,'KO');
    await finalize(db,6); // Retry idempotente: nessun secondo audit.
    assert.equal((await db.query('SELECT count(*)::int n FROM public.vendita_log_modifiche')).rows[0].n,2);
    await seed(db,7,{parent:5});await assert.rejects(()=>finalize(db,7),/gia un reinserimento/);
    assert.equal((await row(db,7)).flag,false);assert.equal((await row(db,7)).stato_pratica,'bozza');
    await assert.rejects(()=>db.query('UPDATE public.vendita_contratti SET reinserimento_fisso_finalizzato=true WHERE id=$1',[id(7)]),/duplicate key/);
    // Una nuova rilavorazione puo sostituire il tentativo precedente.
    await seed(db,8,{parent:6});await finalize(db,8);
    assert.equal((await row(db,6)).stato,'KO');assert.equal((await row(db,8)).flag,true);
    assert.equal((await db.query('SELECT count(*)::int n FROM public.test_revisioni_documentali')).rows[0].n,0);
    assert.notEqual((await db.query("SELECT current_setting('mirox.verifica_commit',true) AS setting")).rows[0].setting,'yes');

    // Origine diventata attiva durante l'upload: finalize rifiutato senza modifiche.
    await seed(db,9,{stato:'Attivo'});await seed(db,10,{parent:9});
    await assert.rejects(()=>finalize(db,10),/Stato origine non idoneo/);
    assert.equal((await row(db,9)).stato,'Attivo');assert.equal((await row(db,10)).flag,false);
    for(const [n,options] of [[11,{customer:903}],[12,{month:'09'}]]) {
      await seed(db,n,{parent:9,...options});await assert.rejects(()=>finalize(db,n),/Origine non valida/);
    }
    // Carrello con due reinserimenti: il fallimento del secondo annulla anche il KO del primo.
    await seed(db,13);await seed(db,14,{parent:13});await seed(db,15,{parent:9});
    await db.query('UPDATE public.vendita_contratti SET pratica_id=$1 WHERE id=$2',[id(114),id(15)]);
    await assert.rejects(()=>finalize(db,14),/Stato origine non idoneo/);
    assert.equal((await row(db,13)).stato,'In Attivazione');assert.equal((await row(db,14)).flag,false);
    // Upload abortito: eliminare la bozza non cambia l'originale.
    await db.query('DELETE FROM public.post_vendita_controllo_fissi WHERE contratto_id=$1',[id(14)]);
    await db.query('DELETE FROM public.vendita_contratti WHERE id=$1',[id(14)]);
    assert.equal((await row(db,13)).stato,'In Attivazione');
    await seed(db,16,{stato:'KO'});await seed(db,17,{parent:16});await finalize(db,17);
    assert.equal((await row(db,16)).motivo_ko,'Motivo precedente');
    assert.equal((await row(db,16)).stato_cambiato_at.toISOString(),'2026-10-01T12:00:00.000Z');
    await db.exec('RESET ROLE; SET ROLE authenticated');
    assert.equal((await db.query('SELECT * FROM public.vendita_contratti')).rows.length,0);
    await assert.rejects(()=>db.query('UPDATE public.vendita_contratti SET reinserimento_fisso_finalizzato=true'),/permission denied/);
    await assert.rejects(()=>db.query('SELECT public.vendita_finalizza_reinserimenti_fisso()'),/permission denied/);
    await db.exec('RESET ROLE');
    assert.equal((await db.query("SELECT prosecdef FROM pg_proc WHERE proname='vendita_finalizza_reinserimenti_fisso'")).rows[0].prosecdef,false);
    console.log('SQL isolato OK: backfill, KO/audit atomici, retry, catene, duplicati, upload abortito, rollback carrello, validazioni e ACL/RLS.');
  } finally { await db.close(); }
  const invalid=await setup();
  try {
    await seed(invalid,1,{stato:'Attivo'});await seed(invalid,2,{parent:1,inviata:true});
    await assert.rejects(()=>invalid.exec(sql),/Storico reinserimenti Fisso incoerente/);
    await invalid.exec('ROLLBACK');
    assert.equal((await invalid.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='vendita_contratti' AND column_name='reinserimento_fisso_finalizzato'")).rows[0].n,0);
    console.log('Migration con storico incoerente rifiutata e annullata integralmente.');
  } finally { await invalid.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
