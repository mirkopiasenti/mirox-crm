'use strict';
// PostgreSQL in memoria. Nessuna rete, nessun dato o schema production modificato.
const { PGlite } = require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const CONTRACT = '00000000-0000-4000-8000-000000000001';
const PRACTICE = '10000000-0000-4000-8000-000000000001';
const CUSTOMER = '20000000-0000-4000-8000-000000000001';
async function main() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.anagrafica(id uuid PRIMARY KEY,cf_piva text,cluster text,ragione_sociale text,nome_referente text,updated_at timestamptz DEFAULT now());
    CREATE TABLE public.vendita_pratiche(id uuid PRIMARY KEY,stato_pratica text,created_at timestamptz DEFAULT now());
    CREATE TABLE public.vendita_contratti(id uuid PRIMARY KEY,pratica_id uuid REFERENCES public.vendita_pratiche,anagrafica_id uuid REFERENCES public.anagrafica,
      created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),categoria_snapshot text,stato_controllo text,codice_contratto text,
      numero_contratto_energia text,ex_fornitore text,controllato_da uuid,controllato_at timestamptz,updated_by uuid,note_controllo text,
      costo_offerta_mensile numeric,portabilita boolean,numero_telefono text,numero_provvisorio text,numero_mnp text,operatore_provenienza text,
      tipo_attivazione text,imei text,fascia_prezzo text,tipo_acquisto text,cluster_cliente text,
      smartphone_reload boolean,smartphone_reload_modalita text);
    CREATE TABLE public.vendita_documenti(id uuid PRIMARY KEY,contratto_id uuid REFERENCES public.vendita_contratti);
    GRANT ALL ON public.vendita_contratti,public.vendita_pratiche,public.anagrafica,public.vendita_documenti TO service_role;
    INSERT INTO public.anagrafica(id,cf_piva,cluster,ragione_sociale,nome_referente) VALUES('${CUSTOMER}','RSSMRA80A01H501U','Consumer','Mario Rossi','Mario');
    INSERT INTO public.vendita_pratiche(id,stato_pratica,created_at) VALUES('${PRACTICE}','inviata','2026-10-27T12:00:00Z');
    INSERT INTO public.vendita_contratti(id,pratica_id,anagrafica_id,categoria_snapshot,stato_controllo,created_at) VALUES('${CONTRACT}','${PRACTICE}','${CUSTOMER}','Energia','da_controllare','2026-10-27T12:00:00Z');`);
  await db.exec(fs.readFileSync(path.join(__dirname, '../database/20261027172616_verifica_automatica_contratti.sql'), 'utf8'));
  for (const file of ['20261028085821_professional_cloud_mobile_business.sql', '20261028091505_professional_cloud_fisso_business.sql',
    '20261028093837_verifica_professional_cloud_notifiche.sql']) {
    await db.exec(fs.readFileSync(path.join(__dirname, '../database', file), 'utf8'));
  }
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  assert.equal((await rows('select modalita from public.vendita_verifica_config'))[0].modalita, 'collaudo');
  assert.equal((await rows('select primo_turno_at from public.vendita_verifiche'))[0].primo_turno_at.toISOString(), require('../js/verifica-contratti-core').firstDue(new Date()));
  assert.equal((await rows('select * from public.vendita_verifica_claim()')).length, 0);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.exec('select * from public.vendita_verifiche'), e => e.code === '42501');
  await assert.rejects(db.exec('select public.vendita_verifica_sync()'), e => e.code === '42501');
  await db.exec('RESET ROLE; SET ROLE service_role');
  await db.exec(`UPDATE public.vendita_verifiche SET prossimo_at=now(),modalita_job='collaudo'`);
  const claim = (await rows('select * from public.vendita_verifica_claim($1,true)', [CONTRACT]))[0];
  assert.ok(claim.lock_token);
  assert.equal(claim.primo_tentativo_at, null);
  assert.equal((await rows('select * from public.vendita_verifica_claim($1,true)', [CONTRACT])).length, 0);
  const customer = (await rows(`select to_jsonb(a) as value from public.anagrafica a`))[0].value;
  const updated = (await rows('select updated_at from public.vendita_contratti'))[0].updated_at;
  const result = { version: 'test', esito: 'controllato', patch: { numero_contratto_energia: 'PC123', ex_fornitore: 'Gestore esempio' }, errors: [], waiting: [], checks: ['test'], notify_reload: false };
  const complete = (v, test, data = result, stamp = updated, owner = customer) => rows(`select public.vendita_verifica_concludi($1,$2,$3,$4,$5,$6,'hash','[]','test',$7) as ok`, [CONTRACT, v.lock_token, v.revisione, stamp, JSON.stringify(owner), JSON.stringify(data), test]);
  assert.equal((await complete(claim, true))[0].ok, true);
  assert.equal((await rows('select stato_controllo from public.vendita_contratti'))[0].stato_controllo, 'da_controllare');
  assert.equal((await rows('select count(*) as n from public.vendita_verifica_notifiche'))[0].n, 0);
  console.log('OK modalità collaudo, primo turno Europe/Rome, grant e claim esclusivo');
  await db.exec(`UPDATE public.vendita_verifica_config SET modalita='attiva'; UPDATE public.vendita_verifiche SET prossimo_at=now()`);
  let live = (await rows('select * from public.vendita_verifica_claim()'))[0];
  await db.exec(`INSERT INTO public.vendita_documenti VALUES('30000000-0000-4000-8000-000000000001','${CONTRACT}')`);
  assert.equal((await complete(live, false))[0].ok, false);
  live = (await rows('select * from public.vendita_verifica_claim()'))[0];
  assert.ok(live);
  await rows(`select public.vendita_verifica_import_csv('test.csv',$1,'test','[]',$2)`, ['b'.repeat(64), CUSTOMER]);
  assert.equal((await complete(live, false))[0].ok, false);
  live = (await rows('select * from public.vendita_verifica_claim()'))[0];
  const beforeBadPatch = (await rows('select count(*) as n from public.vendita_verifica_esecuzioni'))[0].n;
  await assert.rejects(complete(live, false, { ...result, patch: { stato_controllo: 'controllato' } }), /Correzione non ammessa/);
  assert.equal((await rows('select count(*) as n from public.vendita_verifica_esecuzioni'))[0].n, beforeBadPatch);
  assert.equal((await complete(live, false))[0].ok, true);
  assert.equal((await rows('select stato_controllo,numero_contratto_energia from public.vendita_contratti'))[0].numero_contratto_energia, 'PC123');
  assert.equal((await complete(live, false))[0].ok, false);
  console.log('OK allegato/CSV concorrente invalida esito; patch non ammesso rollback, completamento atomico/idempotente');
  await db.exec(`UPDATE public.vendita_contratti SET stato_controllo='da_controllare'`);
  assert.equal((await rows('select esito from public.vendita_verifiche'))[0].esito, 'da_controllare');
  live = (await rows('select * from public.vendita_verifica_claim()'))[0];
  assert.ok(live);
  const bad = { ...result, esito: 'da_verificare', errors: [{ code: 'documento', message: 'Documento scaduto' }] };
  assert.equal((await complete(live, false, bad))[0].ok, true);
  assert.equal((await rows('select destinatario from public.vendita_verifica_notifiche'))[0].destinatario, 'mirko.piasenti@mail.com');
  await rows(`select public.vendita_verifica_import_csv('test.csv',$1,'test','[]',$2)`, ['a'.repeat(64), CUSTOMER]);
  assert.equal((await rows('select stato_job from public.vendita_verifiche'))[0].stato_job, 'in_coda');
  live = (await rows('select * from public.vendita_verifica_claim()'))[0];
  await complete(live, false, bad);
  assert.equal((await rows('select count(*) as n from public.vendita_verifica_notifiche'))[0].n, 1);
  console.log('OK riapertura, riesame immediato su CSV e dedupe email problemi');
  await db.exec(`UPDATE public.vendita_verifiche SET stato_job='in_coda',prossimo_at=now()`);
  live = (await rows('select * from public.vendita_verifica_claim()'))[0];
  await db.exec(`UPDATE public.anagrafica SET ragione_sociale='Nome aggiornato',updated_at=now()`);
  assert.equal((await complete(live, false))[0].ok, false);
  assert.equal((await rows('select stato_job from public.vendita_verifiche'))[0].stato_job, 'in_coda');
  console.log('OK modifica anagrafica concorrente impedisce approvazione di un fascicolo obsoleto');
  await db.exec('RESET ROLE');
  assert.equal((await rows(`select prosecdef from pg_proc where oid='public.vendita_verifica_concludi(uuid,uuid,bigint,timestamptz,jsonb,jsonb,text,jsonb,text,boolean)'::regprocedure`))[0].prosecdef, false);
  assert.equal((await rows(`select has_function_privilege('authenticated','public.vendita_verifica_concludi(uuid,uuid,bigint,timestamptz,jsonb,jsonb,text,jsonb,text,boolean)','EXECUTE') as allowed`))[0].allowed, false);
  assert.equal((await rows(`select relrowsecurity from pg_class where oid='public.vendita_verifica_notifiche'::regclass`))[0].relrowsecurity, true);
  await db.exec('SET ROLE service_role');
  let scenarioId = 10;
  for (const scenario of [
    { category: 'Mobile', flag: true, action: 'Richiedi disattivazione', expected: 'professional_cloud', repeat: true },
    { category: 'Fisso', flag: true, action: 'Richiedi disattivazione', expected: 'professional_cloud', rollback: true },
    { category: 'Mobile', flag: true, action: 'Mantieni attiva' },
    { category: 'Fisso', flag: false },
    { category: 'Mobile', flag: null },
    { category: 'Fisso', flag: true, action: 'Richiedi disattivazione', test: true },
    { category: 'Mobile', flag: true, action: 'Richiedi disattivazione', outcome: 'da_verificare', expected: 'problemi' },
    { category: 'Fisso', flag: true, action: 'Richiedi disattivazione', outcome: 'in_attesa_csv' },
    { category: 'Mobile', flag: null, cluster: 'Consumer' },
    { category: 'Customer Base', flag: null, reload: true, expected: 'reload' }
  ]) {
    const id = '00000000-0000-4000-8000-' + String(++scenarioId).padStart(12, '0');
    await db.query(`INSERT INTO public.vendita_contratti(id,pratica_id,anagrafica_id,categoria_snapshot,cluster_cliente,stato_controllo,professional_cloud,professional_cloud_gestione)
      VALUES($1,$2,$3,$4,$5,'da_controllare',$6,$7)`, [id, PRACTICE, CUSTOMER, scenario.category, scenario.cluster || 'Business', scenario.flag, scenario.action || null]);
    await db.query(`UPDATE public.vendita_verifica_config SET modalita=$1`, [scenario.test ? 'collaudo' : 'attiva']);
    await db.exec('SELECT public.vendita_verifica_sync()');
    await db.query(`UPDATE public.vendita_verifiche SET prossimo_at=now(),modalita_job=$2 WHERE contratto_id=$1`, [id, scenario.test ? 'collaudo' : 'automatica']);
    const claimFor = async () => (await rows('select * from public.vendita_verifica_claim($1,$2)', [id, !!scenario.test]))[0];
    const run = async (claim, patch = {}) => {
      const owner = (await rows('select to_jsonb(a) as value from public.anagrafica a'))[0].value;
      const stamp = (await rows('select updated_at from public.vendita_contratti where id=$1', [id]))[0].updated_at;
      return rows(`select public.vendita_verifica_concludi($1,$2,$3,$4,$5,$6,'hash','[]','test',$7) as ok`,
        [id, claim.lock_token, claim.revisione, stamp, JSON.stringify(owner), JSON.stringify({ ...result, patch,
          esito: scenario.outcome || 'controllato', notify_reload: !!scenario.reload }), !!scenario.test]);
    };
    const noticeRows = () => rows('select tipo,destinatario from public.vendita_verifica_notifiche where contratto_id=$1', [id]);
    const v = await claimFor(); assert.ok(v);
    if (scenario.rollback) {
      await assert.rejects(run(v, { professional_cloud: false }), /Correzione non ammessa/);
      assert.equal((await noticeRows()).length, 0);
      assert.equal((await rows('select count(*) as n from public.vendita_verifica_esecuzioni where contratto_id=$1', [id]))[0].n, 0);
    }
    assert.equal((await run(v))[0].ok, true);
    const notices = await noticeRows();
    assert.equal(notices.length, scenario.expected ? 1 : 0, JSON.stringify(scenario));
    if (scenario.expected) {
      assert.equal(notices[0].tipo, scenario.expected);
      assert.equal(notices[0].destinatario, scenario.expected === 'problemi' ? 'mirko.piasenti@mail.com' : scenario.expected === 'professional_cloud' ? 'mirko.piasenti@gmail.com' : 'info@konatech.it');
    }
    if (scenario.repeat) {
      await db.query(`UPDATE public.vendita_contratti SET stato_controllo='da_controllare' WHERE id=$1`, [id]);
      await db.query(`UPDATE public.vendita_verifiche SET prossimo_at=now() WHERE contratto_id=$1`, [id]);
      assert.equal((await run(await claimFor()))[0].ok, true);
      assert.equal((await noticeRows()).length, 1);
    }
  }
  console.log('OK Cloud Mobile/Fisso: coda atomica, destinatario, dedupe, collaudo/No/Mantieni attiva/storico esclusi; Reload/problemi e grant invariati');
  await db.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
