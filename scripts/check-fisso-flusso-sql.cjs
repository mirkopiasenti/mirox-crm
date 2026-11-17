'use strict';
// NODE_PATH=/private/tmp/mirox-fisso-qa/node_modules node scripts/check-fisso-flusso-sql.cjs
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
const sql=fs.readFileSync('database/20261117072319_flusso_fisso_verifica.sql','utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE public.vendita_contratti(id uuid PRIMARY KEY,pratica_id uuid,anagrafica_id uuid,
 categoria_snapshot text,cluster_cliente text,stato_controllo text,codice_contratto text,controllato_da uuid,
 punteggio_gara_totale numeric,punteggio_extra_gara_totale numeric);
 CREATE TABLE public.post_vendita_controllo_fissi(id uuid DEFAULT gen_random_uuid(),contratto_id uuid UNIQUE,
 pratica_id uuid,anagrafica_id uuid,stato text,codice_cliente text,tecnologia text,cod_contratto text,cod_pos text,
 compilazione_completata_at timestamptz,compilazione_completata_da uuid);
 INSERT INTO public.vendita_contratti VALUES('${id(1)}',NULL,NULL,'Fisso','Business','controllato','001',NULL,4.25,2.5);
 INSERT INTO public.post_vendita_controllo_fissi(contratto_id,stato,tecnologia)VALUES('${id(1)}','Attivo','FTTH_FWCOP');`);
 await db.exec(sql);
 await db.exec(`CREATE TRIGGER trg_verified AFTER UPDATE OF stato_controllo ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.fn_vendita_contratti_to_controllo_fissi();`);
 assert.equal((await db.query('SELECT stato FROM post_vendita_controllo_fissi')).rows[0].stato,'Attivo');
 await db.query(`UPDATE vendita_contratti SET tecnologia_fisso='FTTH Aree Bianche - Professional Box',professional_box=true,codice_cliente_fisso='P001',codice_pos_fisso='9001415852' WHERE id=$1`,[id(1)]);
 const row=(await db.query('SELECT * FROM post_vendita_controllo_fissi')).rows[0];
 assert.equal(row.stato,'Attivo');assert.equal(row.codice_cliente,'P001');assert.equal(row.cod_contratto,'001');assert.equal(row.cod_pos,'9001415852');
 assert.equal((await db.query('SELECT punteggio_gara_totale FROM vendita_contratti')).rows[0].punteggio_gara_totale,'4.25');
 await db.query(`INSERT INTO vendita_contratti(id,categoria_snapshot,cluster_cliente,stato_controllo,codice_contratto,tecnologia_fisso,professional_box,codice_cliente_fisso,codice_pos_fisso)VALUES($1,'Fisso','Consumer','da_controllare','002','FTTC 200',false,'P002','9001415852')`,[id(2)]);
 await db.query("UPDATE vendita_contratti SET stato_controllo='controllato' WHERE id=$1",[id(2)]);
 assert.equal((await db.query('SELECT stato FROM post_vendita_controllo_fissi WHERE contratto_id=$1',[id(2)])).rows[0].stato,'In Attivazione');
 await db.query("UPDATE vendita_contratti SET stato_controllo='controllato' WHERE id=$1",[id(2)]);
 assert.equal((await db.query('SELECT count(*)::int n FROM post_vendita_controllo_fissi WHERE contratto_id=$1',[id(2)])).rows[0].n,1);
 await assert.rejects(()=>db.query("UPDATE vendita_contratti SET professional_box=true WHERE id=$1",[id(2)]),/check constraint/);
 await assert.rejects(()=>db.query("UPDATE vendita_contratti SET codice_pos_fisso='123' WHERE id=$1",[id(2)]),/check constraint/);
 await assert.rejects(()=>db.query("UPDATE vendita_contratti SET tecnologia_fisso='FTTH FiberCop' WHERE id=$1",[id(2)]),/check constraint/);
 console.log('SQL Fisso: nuovi verificati diretti In Attivazione, sincronizzazione, storico/stati/punti, retry e vincoli corretti');
 }finally{await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
