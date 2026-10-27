'use strict';
// PostgreSQL isolato: nessun account, documento o servizio di produzione.
const { PGlite } = require(process.env.MIROX_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Core = require('../js/mirox-permissions-core');
const ID = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function run() {
  const db = new PGlite();
  let checks = 0;
  const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon,authenticated,service_role;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
      GRANT USAGE ON SCHEMA auth,storage TO authenticated,service_role;
      CREATE TABLE public.profili(id uuid PRIMARY KEY,nome text,ruolo text,attivo boolean);
      GRANT SELECT ON public.profili TO authenticated,service_role;
      INSERT INTO public.profili VALUES('${ID(1)}','Admin','admin',true),('${ID(2)}','Esistente','operatore',true),('${ID(3)}','Disabilitato','operatore',false);
      CREATE TABLE public.chiamate(id int PRIMARY KEY,descrizione text);
      INSERT INTO public.chiamate VALUES(1,'Storico CC');
      ALTER TABLE public.chiamate ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.chiamate TO authenticated,service_role;
      CREATE TABLE storage.objects(id int PRIMARY KEY,bucket_id text,name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY originale ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated,service_role;
      INSERT INTO storage.objects VALUES(1,'segnalazioni-files','test.pdf'),(2,'apri-chiudi-files','test.pdf'),(3,'moduli-template','pubblico.pdf');`);
    for (const table of Object.keys(Core.tables)) {
      await db.exec(`CREATE TABLE public.${table}(id int PRIMARY KEY,descrizione text);
        INSERT INTO public.${table} VALUES(1,'Dato ${table}');
        ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY originale ON public.${table} FOR ALL TO authenticated USING(true) WITH CHECK(true);
        GRANT ALL ON public.${table} TO authenticated,service_role;`);
    }
    await db.exec(`CREATE VIEW public.storico_cliente AS SELECT * FROM public.vendita_contratti UNION ALL SELECT * FROM public.chiamate;
      CREATE VIEW public.view_vendita_dashboard_giornaliera AS SELECT * FROM public.vendita_contratti;
      CREATE VIEW public.view_vendita_dashboard_mensile AS SELECT * FROM public.vendita_contratti;
      GRANT SELECT ON public.storico_cliente,public.view_vendita_dashboard_giornaliera,public.view_vendita_dashboard_mensile TO authenticated,service_role;`);
    const sharedBefore = (await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='profili' ORDER BY ordinal_position")).rows;
    await db.exec(fs.readFileSync(path.join(__dirname, '../database/20261027221833_permessi_pagine_mirox.sql'), 'utf8'));
    check((await db.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_name='profili' ORDER BY ordinal_position")).rows, sharedBefore);
    check((await db.query('SELECT chiave,etichetta,reparto,percorso FROM public.mirox_pagine ORDER BY chiave')).rows,
      Core.pages.map(p => ({ chiave: p.key, etichetta: p.label, reparto: p.group, percorso: p.path })).sort((a, b) => a.chiave.localeCompare(b.chiave)));
    const asRole = async (role, n) => {
      await db.exec('RESET ROLE');
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)", [n ? ID(n) : '', role]);
      await db.exec(`SET ROLE ${role}`);
    };
    const count = async table => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    const map = enabled => Object.fromEntries(Core.keys.map(key => [key, enabled.includes(key)]));
    const save = async (n, pages, version, admin = 1) => {
      await asRole('service_role');
      return (await db.query('SELECT public.mirox_salva_permessi_pagine($1,$2,$3::jsonb,$4) AS data', [ID(admin), ID(n), JSON.stringify(pages), version])).rows[0].data;
    };
    // Seed conserva tutti gli accessi degli utenti gia presenti.
    await asRole('authenticated', 2);
    check(await count('public.chiamate'), 0); // Il CC diretto resta protetto dalle sue regole.
    check(await count('public.vendita_contratti'), 1);
    check(await count('public.storico_cliente'), 2);
    check(await count('public.mirox_permessi_utente'), 1);
    await assert.rejects(db.exec("UPDATE public.mirox_permessi_utente SET pagine='{}'"), e => e.code === '42501'); checks++;
    await assert.rejects(db.exec('SELECT * FROM public.mirox_permessi_audit'), e => e.code === '42501'); checks++;
    await assert.rejects(db.query('SELECT public.mirox_salva_permessi_pagine($1,$2,$3::jsonb,$4)', [ID(1), ID(2), '{}', 1]), e => e.code === '42501'); checks++;
    await asRole('anon');
    await assert.rejects(db.exec('SELECT * FROM public.mirox_permessi_utente'), e => e.code === '42501'); checks++;
    // Nuovo account senza record ACL: nessun fallback permissivo.
    await db.exec('RESET ROLE'); await db.exec(`INSERT INTO public.profili VALUES('${ID(4)}','Nuovo','operatore',true)`);
    await asRole('authenticated', 4);
    check(await count('public.vendita_contratti'), 0); check(await count('public.storico_cliente'), 0);
    // Salvataggio vuoto, revoca effettiva su tutti i canali DB/Storage.
    let row = await save(2, map([]), 1); check(row.versione, 2);
    await asRole('authenticated', 2);
    for (const table of Object.keys(Core.tables)) check(await count(`public.${table}`), 0);
    check(await count('public.storico_cliente'), 0);
    check(await count('mirox_private.storico_cliente_dati'), 0);
    check(await count('public.view_vendita_dashboard_mensile'), 0);
    check(await count('storage.objects'), 1); // Solo template, nessun allegato personale.
    for (const table of Object.keys(Core.tables)) {
      await assert.rejects(db.query(`INSERT INTO public.${table} VALUES(2,'Non consentito')`), e => e.code === '42501'); checks++;
      check((await db.query(`UPDATE public.${table} SET descrizione='Non consentito' WHERE id=1 RETURNING id`)).rows.length, 0);
      check((await db.query(`DELETE FROM public.${table} WHERE id=1 RETURNING id`)).rows.length, 0);
    }
    // Un permesso concede la pagina, senza concedere la scrittura nei moduli correlati.
    row = await save(2, map(['storico_cliente']), 2);
    await asRole('authenticated', 2);
    check(await count('public.vendita_apri_chiudi'), 1);
    check(await count('public.storico_cliente'), 2);
    check((await db.query("UPDATE public.vendita_apri_chiudi SET descrizione='No' RETURNING id")).rows.length, 0);
    check(await count('public.view_vendita_dashboard_mensile'), 0);
    row = await save(2, map(['segnalazioni']), 3);
    await asRole('authenticated', 2);
    check(await count('public.segnalazioni'), 1); check(await count('public.vendita_contratti'), 0);
    check((await db.query("UPDATE public.segnalazioni SET descrizione='Consentito' RETURNING id")).rows.length, 1);
    check((await db.query("SELECT bucket_id FROM storage.objects ORDER BY id")).rows.map(r => r.bucket_id), ['segnalazioni-files', 'moduli-template']);
    // Versione stale non sovrascrive e non genera audit; validazione atomica.
    await assert.rejects(save(2, map([]), 3), e => e.code === '40001'); checks++;
    await asRole('service_role'); check(await count('public.mirox_permessi_audit'), 3);
    await assert.rejects(db.exec('DELETE FROM public.mirox_permessi_audit'), e => e.code === '42501'); checks++;
    await assert.rejects(db.exec("UPDATE public.mirox_permessi_audit SET prima='{}'"), e => e.code === '42501'); checks++;
    await assert.rejects(save(2, { ...map([]), sconosciuta: true }, 4), e => e.code === '22023'); checks++;
    await assert.rejects(save(2, { ...map([]), ticket: 'true' }, 4), e => e.code === '22023'); checks++;
    await assert.rejects(save(2, {}, 4), e => e.code === '22023'); checks++;
    await assert.rejects(save(2, map([]), 4, 2), e => e.code === '42501'); checks++;
    await assert.rejects(save(1, map([]), 1), e => e.code === '22023'); checks++;
    await save(2, map(['segnalazioni']), 4); check(await count('public.mirox_permessi_audit'), 3); // No-op.
    // Admin attivo sempre abilitato; disattivazione e service role conservano semantica.
    await asRole('authenticated', 1); check(await count('public.vendita_contratti'), 1);
    await asRole('authenticated', 3); check(await count('public.vendita_contratti'), 0);
    await asRole('service_role'); check(await count('public.vendita_contratti'), 1); check(await count('public.storico_cliente'), 2);
    await db.exec('RESET ROLE');
    check(await count('public.chiamate'), 1);
    check((await db.query("SELECT count(*)::int n FROM pg_policies WHERE schemaname='public' AND tablename IN ('profili','chiamate')")).rows[0].n, 0);
    // Matrice completa: ogni singola pagina concede solo le letture/scritture
    // previste; una policy che nega tutto non potrebbe superare questi casi.
    let matrixVersion = 4;
    for (const key of Core.keys) {
      const next = await save(2, map([key]), matrixVersion); matrixVersion = Number(next.versione);
      await asRole('authenticated', 2);
      for (const [table, access] of Object.entries(Core.tables)) {
        check(await count(`public.${table}`), access.read.includes(key) ? 1 : 0);
        if (access.write.includes(key)) {
          await db.exec('BEGIN');
          await db.exec(`INSERT INTO public.${table} VALUES(9,'Permesso ${key}')`);
          check((await db.query(`UPDATE public.${table} SET descrizione='Aggiornato' WHERE id=9 RETURNING id`)).rows.length, 1);
          check((await db.query(`DELETE FROM public.${table} WHERE id=9 RETURNING id`)).rows.length, 1);
          await db.exec('ROLLBACK');
        }
      }
      const visibleBuckets = (await db.query('SELECT bucket_id FROM storage.objects ORDER BY id')).rows.map(r => r.bucket_id);
      check(visibleBuckets, ['segnalazioni-files', 'apri-chiudi-files', 'moduli-template'].filter(bucket => bucket === 'moduli-template' || Core.buckets[bucket].read.includes(key)));
    }
    console.log(`OK ${checks} verifiche SQL: seed, revoche, RLS, Storage, viste, admin, validazioni, versioni e audit atomico; profili/CC invariati.`);
  } finally { await db.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
