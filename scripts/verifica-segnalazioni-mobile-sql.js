'use strict';
// QA isolato: MIROX_PGLITE_MODULE=/percorso/@electric-sql/pglite node scripts/verifica-segnalazioni-mobile-sql.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function main() {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA storage; GRANT USAGE ON SCHEMA storage TO service_role;
      CREATE SEQUENCE public.segnalazioni_id_seq;
      CREATE TABLE public.segnalazioni(id integer PRIMARY KEY DEFAULT nextval('public.segnalazioni_id_seq'),stato text NOT NULL,
        operatore text,ragione_sociale text,codice_fiscale_piva text,numero_contatto text,gestione_pratica text,tipo_ask text,dettagli_segnalazione text);
      ALTER TABLE public.segnalazioni ENABLE ROW LEVEL SECURITY;
      CREATE TABLE storage.objects(bucket_id text,name text,PRIMARY KEY(bucket_id,name));
      GRANT SELECT,INSERT ON public.segnalazioni TO service_role;
      GRANT USAGE ON SEQUENCE public.segnalazioni_id_seq TO service_role;
      GRANT SELECT ON storage.objects TO service_role;
      INSERT INTO public.segnalazioni(id,stato,ragione_sociale) VALUES(999,'Chiuso','Storico sintetico');
      INSERT INTO storage.objects VALUES('contratti-vendita','originale.pdf');`);
    const before = (await db.query('SELECT * FROM public.segnalazioni WHERE id=999')).rows;
    await db.exec(fs.readFileSync(path.join(__dirname, '../database/20261114090437_segnalazioni_mobile.sql'), 'utf8'));
    const table = (await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.segnalazioni_mobile_richieste'::regclass")).rows[0];
    assert.equal(table.relrowsecurity, true);
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role}`);
      for (const sql of [
        'SELECT * FROM public.segnalazioni_mobile_richieste',
        'SELECT public.completa_segnalazione_mobile(NULL,NULL)',
        'SELECT public.prepara_segnalazione_mobile(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)'
      ]) await assert.rejects(db.query(sql), /permission denied/);
      await db.exec('RESET ROLE');
    }
    const files = [{ nome_destinazione: 'documento.pdf' }, { nome_destinazione: 'PDA.pdf' }, { nome_destinazione: 'terzo.pdf' }];
    const data = { operatore: 'Autore login', ragione_sociale: 'Cliente sintetico', codice_fiscale_piva: '12345678901', numero_contatto: '3331234567', gestione_pratica: 'ASK', tipo_ask: 'Normalizzazione', dettagli_segnalazione: 'Reload Forever\nNote prova' };
    const args = [id(1),id(2),id(3),'a'.repeat(64),'b'.repeat(64),JSON.stringify(data),JSON.stringify(files),id(4)];
    const prepare = a => db.query('SELECT public.prepara_segnalazione_mobile($1,$2,$3,$4,$5,$6,$7,$8) AS r', a).then(r => r.rows[0].r);
    const complete = (lease = id(4)) => db.query('SELECT public.completa_segnalazione_mobile($1,$2) AS id', [id(1),lease]).then(r => r.rows[0].id);
    await db.exec('SET ROLE service_role');
    const job = await prepare(args);
    assert.equal(job.completata, false); assert.equal(job.allegati.length, 3);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.segnalazioni')).rows[0].n, 1);
    await assert.rejects(prepare(args), /MOBILE_BUSY/);
    await assert.rejects(prepare(args.map((v,i) => i === 1 ? id(9) : v)), /MOBILE_CONFLICT/);
    await assert.rejects(complete(id(9)), /MOBILE_CONFLICT/);
    await assert.rejects(complete(), /MOBILE_FILES_MISSING/);
    await db.exec('RESET ROLE');
    await db.query("INSERT INTO storage.objects VALUES('segnalazioni-files',$1)", [`segnalazione_${job.segnalazione_id}/documento.pdf`]);
    await db.exec('SET ROLE service_role');
    await assert.rejects(complete(), /MOBILE_FILES_MISSING/);
    await db.query("UPDATE public.segnalazioni_mobile_richieste SET lease_fino='2000-01-01' WHERE id=$1", [id(1)]);
    await assert.rejects(complete(), /MOBILE_BUSY/);
    await assert.rejects(prepare(args.map((v,i) => i === 4 ? 'c'.repeat(64) : v)), /MOBILE_SOURCE_CHANGED/);
    const next = args.map((v,i) => i === 7 ? id(5) : v);
    assert.equal((await prepare(next)).segnalazione_id, job.segnalazione_id);
    await assert.rejects(complete(), /MOBILE_CONFLICT/);
    await db.exec('RESET ROLE');
    for (const file of files.slice(1)) await db.query("INSERT INTO storage.objects VALUES('segnalazioni-files',$1)", [`segnalazione_${job.segnalazione_id}/${file.nome_destinazione}`]);
    await db.exec('SET ROLE service_role');
    assert.equal(await complete(id(5)), job.segnalazione_id);
    assert.equal(await complete(id(5)), job.segnalazione_id);
    assert.equal((await prepare(next)).completata, true);
    const saved = (await db.query('SELECT * FROM public.segnalazioni WHERE id=$1',[job.segnalazione_id])).rows[0];
    for (const [k,v] of Object.entries(data)) assert.equal(saved[k],v);
    assert.equal(saved.stato,'Da gestire');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.segnalazioni')).rows[0].n, 2);
    await assert.rejects(db.query('DELETE FROM public.segnalazioni_mobile_richieste'), /permission denied/);
    await db.exec('RESET ROLE');
    assert.deepEqual((await db.query('SELECT * FROM public.segnalazioni WHERE id=999')).rows,before);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM storage.objects WHERE bucket_id='contratti-vendita' AND name='originale.pdf'")).rows[0].n,1);
    console.log('SQL Mobile: ACL/RLS, autore/hash, lease/concorrenza, copie complete, retry e conservazione storico/originali verificati.');
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
