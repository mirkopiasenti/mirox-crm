'use strict';
// Solo PostgreSQL in memoria: nessuna connessione o modifica a production.
const {PGlite}=require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const db=new PGlite();
 await db.exec(`CREATE TABLE public.vendita_contratti(id integer PRIMARY KEY,categoria_snapshot text,cluster_cliente text);
 INSERT INTO public.vendita_contratti VALUES(1,'Mobile','Business'),(2,'Mobile','Consumer'),(3,'Fisso','Business'),(4,NULL,NULL),(5,'Fisso','Consumer'),(6,'Customer Base','Business');`);
 const before=(await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows;
 await db.exec(fs.readFileSync(path.join(__dirname,'../database/20261028085821_professional_cloud_mobile_business.sql'),'utf8'));
 assert.deepEqual((await db.query('SELECT id,categoria_snapshot,cluster_cliente FROM public.vendita_contratti ORDER BY id')).rows,before);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.vendita_contratti WHERE professional_cloud IS NULL AND professional_cloud_gestione IS NULL')).rows[0].n,6);
 for(const action of ['Mantieni attiva','Richiedi disattivazione'])await db.query('UPDATE public.vendita_contratti SET professional_cloud=true,professional_cloud_gestione=$1 WHERE id=1',[action]);
 for(const [presence,action] of [[true,null],[null,'Mantieni attiva'],[false,'Richiedi disattivazione'],[true,'Altro']])await assert.rejects(db.query('UPDATE public.vendita_contratti SET professional_cloud=$1,professional_cloud_gestione=$2 WHERE id=1',[presence,action]),e=>e.code==='23514');
 await db.exec('UPDATE public.vendita_contratti SET professional_cloud=false,professional_cloud_gestione=NULL WHERE id=1');
 for(const id of [2,3,4])for(const [presence,action] of [[false,null],[true,'Mantieni attiva']])await assert.rejects(db.query('UPDATE public.vendita_contratti SET professional_cloud=$1,professional_cloud_gestione=$2 WHERE id=$3',[presence,action,id]),e=>e.code==='23514');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM public.vendita_contratti')).rows[0].n,6);
 const cloudBefore=(await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows;
 await db.exec(fs.readFileSync(path.join(__dirname,'../database/20261028091505_professional_cloud_fisso_business.sql'),'utf8'));
 assert.deepEqual((await db.query('SELECT * FROM public.vendita_contratti ORDER BY id')).rows,cloudBefore);
 for(const action of ['Mantieni attiva','Richiedi disattivazione'])await db.query('UPDATE public.vendita_contratti SET professional_cloud=true,professional_cloud_gestione=$1 WHERE id=3',[action]);
 await assert.rejects(db.exec('UPDATE public.vendita_contratti SET professional_cloud_gestione=NULL WHERE id=3'),e=>e.code==='23514');
 await db.exec('UPDATE public.vendita_contratti SET professional_cloud=false,professional_cloud_gestione=NULL WHERE id=3');
 for(const id of [2,4,5,6])for(const [presence,action] of [[false,null],[true,'Mantieni attiva']])await assert.rejects(db.query('UPDATE public.vendita_contratti SET professional_cloud=$1,professional_cloud_gestione=$2 WHERE id=$3',[presence,action,id]),e=>e.code==='23514');
 console.log('OK migrazioni Mobile e Fisso Business, dati preesistenti invariati, scope e coerenza protetti');await db.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
