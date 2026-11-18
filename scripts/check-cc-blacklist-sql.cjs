'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const baseline = fs.readFileSync('database/069_baseline_allineamento.sql', 'utf8');
const migration = fs.readFileSync('database/20261118214531_cc_chiudi_rilavorazioni_blacklist.sql', 'utf8');
const fromBaseline = (prefix, end) => {
    const start = baseline.indexOf(prefix);
    assert.notEqual(start, -1, prefix);
    const stop = baseline.indexOf(end, start);
    assert.notEqual(stop, -1, prefix);
    return baseline.slice(start, stop + end.length);
};

const db = new PGlite();
const actor = '00000000-0000-4000-8000-000000000001';
const id = (number) => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');

async function run() {
    await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE ROLE service_role BYPASSRLS;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS
            $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated;
        CREATE SCHEMA mirox_cc_privato;
        REVOKE ALL ON SCHEMA mirox_cc_privato FROM PUBLIC, anon, authenticated;
        CREATE TABLE public.profili (id uuid PRIMARY KEY);
        INSERT INTO public.profili VALUES ('${actor}');
    `);

    const tables = [
        'anagrafica', 'appuntamenti', 'blacklist', 'chiamate',
        'call_center_lead_outbound', 'call_center_lead_outbound_chiamate',
        'call_center_lead_outbound_attivita'
    ];
    for (const table of tables) {
        await db.exec(fromBaseline(`CREATE TABLE public.${table} (\n`, '\n);'));
    }

    for (const name of [
        'calcola_ricontatto_non_risposto', 'calcola_ricontatto_non_risposto_outbound',
        'crm_cclobc_default_rilavorazione_stato', 'update_updated_at',
        'crm_call_center_lead_outbound_chiamate_touch_updated_at', 'crm_touch_updated_at'
    ]) {
        await db.exec(fromBaseline(`CREATE FUNCTION public.${name}(`, '\n$$;'));
    }

    for (const name of [
        'trg_appuntamenti_updated_at', 'trg_chiamate_auto_ricontatto', 'trg_chiamate_updated_at',
        'trg_outbound_chiamate_auto_ricontatto', 'trg_cclobc_default_rilavorazione_stato',
        'trg_cclobc_touch_updated_at', 'trg_call_center_lead_outbound_touch_updated_at'
    ]) {
        await db.exec(fromBaseline(`CREATE TRIGGER ${name} `, ';'));
    }
    await db.exec(fromBaseline('CREATE VIEW public.vw_rilavorazione_ricontatti_unificata', ';'));
    await db.exec(fromBaseline('ALTER TABLE public.call_center_lead_outbound\n    ADD CONSTRAINT call_center_lead_outbound_stato_lead_check', ';'));
    await db.exec(`
        GRANT INSERT ON public.blacklist TO anon, authenticated, service_role;
        ALTER TABLE public.call_center_lead_outbound_attivita
            ADD FOREIGN KEY (operatore_id) REFERENCES public.profili(id);
        ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;
        ${fromBaseline('CREATE POLICY blacklist_insert ', ';')}
        INSERT INTO blacklist (cf_piva) VALUES ('  vecchio  '), ('VECCHIO');
    `);

    const call = (number, code, esito, anagrafica = null) => db.query(`
        INSERT INTO chiamate (id, operatore_id, operatore_nome, cf_piva, nome_cliente,
                              note, esito, anagrafica_id)
        VALUES ($1, $2, 'Altro operatore', $3, 'Stesso nome', 'nota originale', $4, $5)
    `, [id(number), id(99), code, esito, anagrafica]);
    const appointment = (number, { code = null, anagrafica = null, callId = null,
                                    outboundId = null, leadId = null, presentato = 'no',
                                    coda = 'da_lavorare', stato = 'confermato', esito = null } = {}) => db.query(`
        INSERT INTO appuntamenti (id, nome, telefono, motivo, data_ora, codice_fiscale,
            anagrafica_id, chiamata_id, chiamata_outbound_id, lead_outbound_id, presentato,
            non_presentato_stato, stato, esito_finale, note)
        VALUES ($1, 'Stesso nome', '3331234567', 'test', '2026-11-17', $2, $3, $4,
            $5, $6, $7, $8, $9, $10, 'nota originale')
    `, [id(number), code, anagrafica, callId, outboundId, leadId, presentato, coda, stato, esito]);
    const row = async (table, number) => (await db.query(`SELECT * FROM ${table} WHERE id = $1`, [id(number)])).rows[0];
    const statoChiamata = async (number) => (await row('chiamate', number)).rilavorazione_stato;
    const insertBlacklist = (code) => db.query('INSERT INTO blacklist (cf_piva, cellulare) VALUES ($1, $2)', [code, '3331234567']);
    const idsInQueue = async () => (await db.query('SELECT origine_id FROM vw_rilavorazione_ricontatti_unificata ORDER BY origine_id')).rows.map(x => x.origine_id);

    await call(1, 'VECCHIO', 'ricontattare');
    await appointment(2, { callId: id(1) });
    await db.exec(migration);
    assert.equal(await statoChiamata(1), 'completato');
    assert.equal((await row('appuntamenti', 2)).non_presentato_stato, 'lavorato');

    await db.query('INSERT INTO anagrafica (id, cf_piva) VALUES ($1, $2)', [id(3), 'CFTEST']);
    await call(4, ' cftest ', 'non_risposto');
    await call(5, 'VECCHIOCODICE', 'ricontattare', id(3));
    await call(6, 'CFTEST', 'passa_in_negozio');
    await call(7, 'CFTEST', 'passa_a_cerea');
    await call(8, 'CFTEST', 'passa_in_negozio');
    await call(9, 'CFTEST', 'passa_in_negozio');
    await call(10, 'ALTRO', 'ricontattare');
    await call(11, 'CFTEST', 'non_interessato');
    await db.query("UPDATE chiamate SET cellulare = '3331234567' WHERE id = $1", [id(10)]);
    await db.query("UPDATE chiamate SET passaggio_stato = 'in_attesa' WHERE id = $1", [id(7)]);
    await db.query("UPDATE chiamate SET passaggio_stato = 'ricontattare', rilavorazione_stato = 'completato' WHERE id = $1", [id(8)]);
    await db.query("UPDATE chiamate SET passaggio_stato = 'passato', rilavorazione_stato = 'completato' WHERE id = $1", [id(9)]);
    await db.query(`
        INSERT INTO call_center_lead_outbound
            (id, ragione_sociale, ragione_sociale_norm, stato_lead, partita_iva,
             codice_fiscale, prossimo_followup_at, dedupe_key, dedupe_strategy)
        VALUES ($1, 'Stesso nome', 'stesso nome', 'ricontattare', '01234567890', 'cftest', now(), 'l1', 'test'),
               ($2, 'Altro', 'altro', 'non_interessato', '01234567890', 'cftest', null, 'l2', 'test'),
               ($3, 'Senza CF', 'senza cf', 'nuovo', null, null, null, 'l3', 'test')
    `, [id(12), id(13), id(14)]);
    await db.query(`
        INSERT INTO call_center_lead_outbound_chiamate
            (id, lead_id, anagrafica_id, operatore_id, operatore_nome, ragione_sociale_snapshot, esito, note)
        VALUES ($1, $5, null, $8, 'Altro operatore', 'Stesso nome', 'ricontattare', 'nota originale'),
               ($2, $6, null, $8, 'Altro operatore', 'Altro', 'non_interessato', 'storica'),
               ($3, $7, $9, $8, 'Altro operatore', 'Senza CF', 'non_risposto', 'via anagrafica'),
               ($4, $7, null, $8, 'Altro operatore', 'Senza CF', 'non_risposto', 'altra identità')
    `, [id(15), id(16), id(17), id(18), id(12), id(13), id(14), id(99), id(3)]);
    await appointment(19, { code: 'cftest' });
    await appointment(20, { anagrafica: id(3) });
    await appointment(21, { callId: id(5) });
    await appointment(22, { outboundId: id(15) });
    await appointment(23, { leadId: id(12) });
    await appointment(24, { code: 'ALTRO' });
    await appointment(25, { code: 'CFTEST', presentato: null, coda: null });
    await appointment(26, { code: 'CFTEST', presentato: 'si', coda: null, esito: 'vinta' });
    await appointment(27, { code: 'CFTEST', stato: 'annullato' });

    const preserved = await Promise.all([
        row('chiamate', 9), row('chiamate', 11), row('call_center_lead_outbound', 13),
        row('call_center_lead_outbound_chiamate', 16), row('appuntamenti', 24),
        row('appuntamenti', 25), row('appuntamenti', 26), row('appuntamenti', 27)
    ]);
    const beforeCall = await row('chiamate', 4);
    const beforeAppointment = await row('appuntamenti', 19);

    await db.exec('SET ROLE authenticated');
    await assert.rejects(() => insertBlacklist('CFTEST'), /Accesso negato|row-level security/);
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [actor]);
    await assert.rejects(() => db.exec("SELECT mirox_cc_privato.chiudi_rilavorazioni_blacklist_v1(ARRAY['CFTEST'])"), /permission denied/);
    await insertBlacklist('  CfTest  ');
    await insertBlacklist('CFTEST');
    await db.exec('RESET ROLE');

    assert.deepEqual(await idsInQueue(), [id(10), id(18)]);
    for (const number of [6, 7, 8]) {
        assert.equal((await row('chiamate', number)).passaggio_stato, 'chiuso');
        assert.equal(await statoChiamata(number), 'completato');
    }
    for (const number of [19, 20, 21, 22, 23]) {
        const app = await row('appuntamenti', number);
        assert.deepEqual([app.non_presentato_stato, app.stato, app.presentato], ['lavorato', 'confermato', 'no']);
    }

    const { updated_at: callUpdated, ...afterCall } = await row('chiamate', 4);
    const { updated_at: appUpdated, ...afterAppointment } = await row('appuntamenti', 19);
    assert.deepEqual({ ...afterCall, updated_at: beforeCall.updated_at }, { ...beforeCall, rilavorazione_stato: 'completato' });
    assert.deepEqual({ ...afterAppointment, updated_at: beforeAppointment.updated_at }, { ...beforeAppointment, non_presentato_stato: 'lavorato' });
    assert.ok(callUpdated >= beforeCall.updated_at && appUpdated >= beforeAppointment.updated_at);
    const lead = await row('call_center_lead_outbound', 12);
    assert.equal(lead.stato_lead, 'chiuso');
    assert.equal(lead.prossimo_followup_at, null);
    assert.equal((await row('call_center_lead_outbound', 14)).stato_lead, 'nuovo');
    assert.deepEqual((await db.query('SELECT lead_id, operatore_id, tipo, stato_precedente, stato_nuovo FROM call_center_lead_outbound_attivita')).rows,
        [{ lead_id: id(12), operatore_id: actor, tipo: 'sistema', stato_precedente: 'ricontattare', stato_nuovo: 'chiuso' }]);
    assert.deepEqual(await Promise.all([
        row('chiamate', 9), row('chiamate', 11), row('call_center_lead_outbound', 13),
        row('call_center_lead_outbound_chiamate', 16), row('appuntamenti', 24),
        row('appuntamenti', 25), row('appuntamenti', 26), row('appuntamenti', 27)
    ]), preserved);

    // Un errore nella chiusura annulla anche l'inserimento e gli UPDATE precedenti.
    await call(28, 'ROLLBACK', 'ricontattare');
    await appointment(29, { code: 'ROLLBACK' });
    await db.exec(`
        CREATE FUNCTION errore_test() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'errore prova rollback'; END;
        $$;
        CREATE TRIGGER errore_test BEFORE UPDATE ON appuntamenti FOR EACH ROW EXECUTE FUNCTION errore_test();
    `);
    await assert.rejects(() => insertBlacklist('ROLLBACK'), /errore prova rollback/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM blacklist WHERE cf_piva = 'ROLLBACK'")).rows[0].n, 0);
    assert.equal(await statoChiamata(28), 'da_lavorare');
    assert.equal((await row('appuntamenti', 29)).non_presentato_stato, 'da_lavorare');
    await db.exec('DROP TRIGGER errore_test ON appuntamenti');

    await db.query('INSERT INTO anagrafica (id, cf_piva) VALUES ($1, $2)', [id(31), ' ']);
    await call(30, ' ', 'ricontattare', id(31));
    await insertBlacklist(' ');
    assert.equal(await statoChiamata(30), 'da_lavorare');

    await db.exec("RESET request.jwt.claim.sub; SET ROLE service_role");
    await insertBlacklist('01234567890');
    await db.exec('RESET ROLE');
    assert.equal((await row('call_center_lead_outbound', 12)).stato_lead, 'chiuso');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM call_center_lead_outbound_attivita')).rows[0].n, 1);

    await db.exec("UPDATE call_center_lead_outbound SET partita_iva = '98765432109' WHERE id = '" + id(14) + "'");
    await db.exec('SET ROLE authenticated');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id(98)]);
    await insertBlacklist('98765432109');
    await db.exec('RESET ROLE');
    assert.equal((await row('call_center_lead_outbound', 14)).stato_lead, 'chiuso');
    assert.deepEqual((await db.query('SELECT operatore_id FROM call_center_lead_outbound_attivita WHERE lead_id = $1', [id(14)])).rows,
        [{ operatore_id: null }]);

    console.log('Call center blacklist SQL: code operative, pregresso, storico, RLS, retry e rollback verificati');
}

run().finally(() => db.close()).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
