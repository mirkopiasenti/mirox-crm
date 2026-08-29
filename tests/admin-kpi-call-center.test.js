const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const kpiModule = require('../netlify/functions/admin-kpi-call-center.js');
const {
  METRIC_KEYS,
  PROFILE_SELECT,
  addAppointmentSet,
  addCall,
  addScheduledAppointment,
  buildProfileResolver,
  isEarlyConversion,
  parseYear,
  romeDateKey
} = kpiModule._test;

function createSeriesFixture() {
  return { totals: new Map(), operators: new Map() };
}

test('le date KPI sono attribuite al giorno Europe/Rome', () => {
  assert.equal(romeDateKey('2026-01-31T23:30:00.000Z'), '2026-02-01');
  assert.equal(romeDateKey('2026-07-01T21:59:59.000Z'), '2026-07-01');
  assert.equal(romeDateKey('valore-non-valido'), null);
});

test('le chiamate distinguono Consumer e lead Business outbound', () => {
  const resolver = buildProfileResolver([{ id: 'op-1', nome: 'Ada', alias_di: null }]);
  const fixture = createSeriesFixture();

  addCall(fixture.totals, fixture.operators, resolver, {
    operatore_id: 'op-1', data_ora: '2026-08-12T08:00:00Z', esito: 'non_risposto'
  });
  addCall(fixture.totals, fixture.operators, resolver, {
    operatore_id: 'op-1', data_ora: '2026-08-12T09:00:00Z', esito: 'appuntamento'
  }, 'business_outbound');

  const metrics = fixture.totals.get('2026-08-12');
  assert.equal(metrics.calls, 2);
  assert.equal(metrics.consumer_calls, 1);
  assert.equal(metrics.business_outbound_calls, 1);
  assert.equal(metrics.answered_calls, 1);
  assert.deepEqual(Object.keys(metrics), METRIC_KEYS);
});

test('appuntamenti fissati e rischedulati sono distinti nel giorno di creazione', () => {
  const resolver = buildProfileResolver([{ id: 'op-1', nome: 'Ada', alias_di: null }]);
  const fixture = createSeriesFixture();

  addAppointmentSet(fixture.totals, fixture.operators, resolver, {
    fissato_da_operatore_id: 'op-1', created_at: '2026-08-10T10:00:00Z', originato_da_id: null
  });
  addAppointmentSet(fixture.totals, fixture.operators, resolver, {
    fissato_da_operatore_id: 'op-1', created_at: '2026-08-10T11:00:00Z', originato_da_id: 'app-originale'
  });
  addScheduledAppointment(fixture.totals, fixture.operators, resolver, {
    fissato_da_operatore_id: 'op-1',
    data_ora: '2026-08-14T10:00:00Z',
    stato: 'confermato',
    presentato: 'si',
    esito_finale: 'vinta'
  });

  assert.equal(fixture.totals.get('2026-08-10').appointments_set, 1);
  assert.equal(fixture.totals.get('2026-08-10').appointments_rescheduled, 1);
  assert.equal(fixture.totals.get('2026-08-14').appointments_scheduled, 1);
  assert.equal(fixture.totals.get('2026-08-14').presented, 1);
  assert.equal(fixture.totals.get('2026-08-14').won, 1);
});

test('non presentati, persi, da esitare e annullati restano metriche distinte', () => {
  const resolver = buildProfileResolver([]);
  const fixture = createSeriesFixture();
  const base = { fissato_da_operatore_id: null, data_ora: '2026-08-15T10:00:00Z' };

  addScheduledAppointment(fixture.totals, fixture.operators, resolver, {
    ...base, stato: 'confermato', presentato: 'no', esito_finale: null
  });
  addScheduledAppointment(fixture.totals, fixture.operators, resolver, {
    ...base, stato: 'confermato', presentato: 'si', esito_finale: 'persa'
  });
  addScheduledAppointment(fixture.totals, fixture.operators, resolver, {
    ...base, stato: 'annullato', presentato: null, esito_finale: null
  });
  addScheduledAppointment(fixture.totals, fixture.operators, resolver, {
    ...base, stato: 'confermato', presentato: 'si', esito_finale: null
  });

  const metrics = fixture.totals.get('2026-08-15');
  assert.equal(metrics.no_show, 1);
  assert.equal(metrics.lost, 1);
  assert.equal(metrics.pending_outcome, 1);
  assert.equal(metrics.cancelled, 1);
});

test('le conversioni anticipate sono vinte e non annullate', () => {
  const resolver = buildProfileResolver([{ id: 'op-1', nome: 'Ada', alias_di: null }]);
  const fixture = createSeriesFixture();
  const row = {
    fissato_da_operatore_id: 'op-1',
    data_ora: '2026-08-16T10:00:00Z',
    stato: 'annullato',
    motivo_modifica: 'Chiuso automaticamente: cliente passato in anticipo, pratica vendita creata',
    presentato: null,
    esito_finale: null
  };

  assert.equal(isEarlyConversion(row), true);
  addScheduledAppointment(fixture.totals, fixture.operators, resolver, row);

  const metrics = fixture.totals.get('2026-08-16');
  assert.equal(metrics.converted_early, 1);
  assert.equal(metrics.won, 1);
  assert.equal(metrics.cancelled, 0);
});

test('gli alias operatrice confluiscono nel profilo canonico', () => {
  const resolver = buildProfileResolver([
    { id: 'ada', nome: 'Ada', alias_di: null },
    { id: 'ada-old', nome: 'Ada storico', alias_di: 'ada' }
  ]);
  assert.equal(PROFILE_SELECT, 'id, nome, alias_di');
  assert.equal(resolver.canonicalId('ada-old'), 'ada');
  assert.equal(resolver.label('ada'), 'Ada');
  assert.equal(resolver.label('__unassigned__'), 'Online / non assegnato');
});

test('l’endpoint limita l’anno e la pagina usa auth, API wrapper e shell condivisa', () => {
  assert.equal(parseYear('2026'), 2026);
  assert.throws(() => parseYear('2019'), /Anno non valido/);

  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'admin-kpi-call-center.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'js/admin-kpi-call-center.js'), 'utf8');
  const shell = fs.readFileSync(path.join(root, 'js/admin-shell.js'), 'utf8');

  assert.match(html, /css\/admin-kpi\.css/);
  assert.match(html, /profilo\.ruolo !== 'admin'/);
  assert.match(client, /MiroxApi\.fetch/);
  assert.doesNotMatch(client, /window\.fetch|globalThis\.fetch/);
  assert.match(client, /Business outbound/);
  assert.match(client, /Rischedulati/);
  assert.match(client, /Da esitare/);
  assert.match(shell, /admin-kpi-call-center\.html/);
});
