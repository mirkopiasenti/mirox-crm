const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { strFromU8, unzipSync } = require('fflate');

const ROOT = path.resolve(__dirname, '..');
const api = require('../netlify/functions/gestisci-anagrafiche')._test;

test('i filtri anagrafiche accettano solo valori previsti e limiti sicuri', () => {
  assert.deepEqual(api.parseFilters({
    cluster: 'Business',
    comune: '  San Pietro (VR),%  ',
    search: '  Rossi,or(id.eq.bad)  ',
    page: '-8',
    page_size: '999'
  }), {
    cluster: 'Business',
    comune: 'San Pietro VR',
    comuni: [],
    search: 'Rossi or id eq bad',
    page: 1,
    pageSize: 100
  });

  assert.equal(api.parseFilters({ cluster: 'Admin' }).cluster, '');
  assert.equal(api.cleanFilter('Mario%_Rossi,(test)'), 'Mario Rossi test');
  assert.equal(api.cleanFilter("D'Amico"), 'D Amico');
});

test('il filtro comuni accetta più scelte, rimuove duplicati e applica il limite', () => {
  const requested = Array.from({ length: 35 }, (_, index) => `Comune ${index + 1}`);
  requested[1] = 'L\'Aquila';
  requested[2] = 'l\'aquila';
  const comuni = api.parseComuni(JSON.stringify(requested));
  assert.equal(comuni.length, 29);
  assert.equal(comuni[1], "L'Aquila");
  assert.deepEqual(api.parseComuni('non-json'), []);
  assert.deepEqual(api.parseComuni(JSON.stringify({ comune: 'Cerea' })), []);

  const calls = [];
  const query = {
    eq(column, value) { calls.push(['eq', column, value]); return this; },
    in(column, value) { calls.push(['in', column, value]); return this; },
    ilike(column, value) { calls.push(['ilike', column, value]); return this; },
    or(value) { calls.push(['or', value]); return this; }
  };
  api.applyFilters(query, {
    cluster: 'Consumer',
    comune: '',
    comuni: ['Cerea', 'Legnago'],
    search: ''
  });
  assert.deepEqual(calls, [
    ['eq', 'cluster', 'Consumer'],
    ['in', 'comune', ['Cerea', 'Legnago']]
  ]);
});

test('il generatore produce un vero workbook xlsx filtrabile e neutralizza formule', () => {
  const workbook = api.createWorkbook([{
    id: '11111111-1111-4111-8111-111111111111',
    cluster: 'Consumer',
    ragione_sociale: '=HYPERLINK("https://example.com")',
    nome_referente: 'Mario & Rossi',
    cf_piva: 'RSSMRA80A01H501U',
    cellulare: '3331234567',
    email: 'mario@example.com',
    provincia: 'VR',
    comune: 'LEGNAGO',
    via: 'Via Roma <centro>',
    civico: '1',
    creato_da: '22222222-2222-4222-8222-222222222222',
    creatore: { nome: 'Operatore Test' },
    created_at: '2026-08-26T10:00:00.000Z',
    updated_at: '2026-08-26T10:30:00.000Z'
  }]);

  assert.equal(workbook.subarray(0, 2).toString('ascii'), 'PK');
  const files = unzipSync(workbook);
  assert.ok(files['[Content_Types].xml']);
  assert.ok(files['xl/workbook.xml']);
  assert.ok(files['xl/worksheets/sheet1.xml']);

  const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<autoFilter ref="A1:O2"\/>/);
  assert.match(sheet, /<pane ySplit="1"/);
  assert.match(sheet, /=HYPERLINK\(&quot;https:\/\/example\.com&quot;\)/);
  assert.doesNotMatch(sheet, /<f>/);
  assert.match(sheet, /Mario &amp; Rossi/);
  assert.match(sheet, /Via Roma &lt;centro&gt;/);
});

test('la normalizzazione località uniforma maiuscole, spazi, entità e apostrofi', () => {
  assert.equal(api.normalizeLocalityForComparison('  boschi   sant&#039;anna '), "BOSCHI SANT'ANNA");
  assert.equal(api.normalizeLocalityForComparison('Sant’Agata'), "SANT'AGATA");
  assert.equal(api.normalizeLocalityForComparison(null), '');
});

test('la selezione ISTAT prevale sui valori liberi e compila la provincia', async () => {
  const query = {
    select() { return this; },
    eq(column, value) {
      assert.equal(column, 'codice_istat');
      assert.equal(value, '023044');
      return this;
    },
    async maybeSingle() {
      return { data: { nome: 'LEGNAGO', provincia_sigla: 'VR' }, error: null };
    }
  };
  const resolved = await api.resolveIstatLocality(
    { from(table) { assert.equal(table, 'mirox_comuni_istat'); return query; } },
    { comune_istat_codice: '023044' },
    { comune: 'testo libero', provincia: 'XX', cf_piva: 'ABC' },
    { comune: 'CEREA', provincia: 'VR' }
  );
  assert.equal(resolved.comune, 'LEGNAGO');
  assert.equal(resolved.provincia, 'VR');
  assert.equal(resolved.cf_piva, 'ABC');
});

test('i valori storici non riconciliati restano modificabili se comune e provincia non cambiano', async () => {
  const unchanged = await api.resolveIstatLocality(
    { from() { throw new Error('Il catalogo non deve essere interrogato'); } },
    {},
    { comune: 'CHIESA NUOVA', provincia: 'PD' },
    { comune: 'Chiesa Nuova', provincia: 'pd' }
  );
  assert.equal(unchanged.comune, 'CHIESA NUOVA');
  assert.equal(unchanged.provincia, 'PD');
});

test('la modifica anagrafica usa una allowlist, normalizza i dati e valida i campi', () => {
  assert.deepEqual(api.sanitizeAnagraficaUpdate({
    cf_piva: ' rssmra80a01h501u ',
    cluster: 'Consumer',
    ragione_sociale: '  Mario   Rossi  ',
    nome_referente: '',
    cellulare: '333 123 4567',
    email: 'mario@example.com',
    provincia: 'VR',
    comune: 'LEGNAGO',
    via: 'Via Roma',
    civico: '1'
  }), {
    cf_piva: 'RSSMRA80A01H501U',
    cluster: 'Consumer',
    ragione_sociale: 'Mario Rossi',
    nome_referente: null,
    cellulare: '333 123 4567',
    email: 'mario@example.com',
    provincia: 'VR',
    comune: 'LEGNAGO',
    via: 'Via Roma',
    civico: '1'
  });

  assert.throws(() => api.sanitizeAnagraficaUpdate({ cluster: 'Admin', cf_piva: 'ABC' }), /campi non modificabili|Cluster non valido/);
  assert.throws(() => api.sanitizeAnagraficaUpdate({
    cf_piva: 'ABC', cluster: 'Business', ragione_sociale: '', nome_referente: '', cellulare: '',
    email: 'non-valida', provincia: '', comune: '', via: '', civico: ''
  }), /email non valido/i);
  assert.throws(() => api.sanitizeAnagraficaUpdate({
    cf_piva: 'ABC', cluster: 'Business', ragione_sociale: '', nome_referente: '', cellulare: '',
    email: '', provincia: '', comune: '', via: '', civico: '', created_at: '2020-01-01'
  }), /campi non modificabili/);
});

test('la cancellazione verifica tutte le relazioni CRM note', () => {
  const dependencies = api.DELETE_DEPENDENCIES.map(([table, column]) => `${table}.${column}`);
  assert.ok(dependencies.includes('vendita_pratiche.anagrafica_id'));
  assert.ok(dependencies.includes('vendita_consensi_privacy.anagrafica_id'));
  assert.ok(dependencies.includes('vendita_switch_sim.anagrafica_attuale_id'));
  assert.ok(dependencies.includes('appuntamenti.anagrafica_id'));
  assert.equal(new Set(dependencies).size, dependencies.length);
});

test('la pagina Anagrafiche usa la function autenticata e contiene filtri, popup ed export', () => {
  const html = fs.readFileSync(path.join(ROOT, 'moduli/anagrafiche.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'js/anagrafiche.js'), 'utf8');
  const dashboard = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');

  assert.match(html, /id="searchName"/);
  assert.match(html, /id="filterCluster"/);
  assert.match(html, /id="comuniTrigger"/);
  assert.match(html, /id="comuniOptions"/);
  assert.match(html, /aria-multiselectable="true"/);
  assert.match(html, /id="detailModal"/);
  assert.match(html, /id="editModal"/);
  assert.match(html, /id="editForm"/);
  assert.match(html, /id="editComuneSuggestions"/);
  assert.match(html, /id="editProvincia"[^>]*readonly/);
  assert.match(html, /id="btnEditAnagrafica"/);
  assert.match(html, /class="[^"]*hidden[^"]*" id="btnDeleteAnagrafica"/);
  assert.match(html, /id="btnExport"/);
  assert.match(js, /MiroxApi\.fetch/);
  assert.match(js, /method: 'POST'/);
  assert.match(js, /MiroxUI\.confirm/);
  assert.match(js, /state\.isAdmin = profilo\.ruolo === 'admin'/);
  assert.match(js, /expected_updated_at/);
  assert.match(js, /action=comuni/);
  assert.match(js, /action: 'comuni_istat'/);
  assert.match(js, /comune_istat_codice: state\.istatComuneCode/);
  assert.match(js, /JSON\.stringify\(state\.comuni\)/);
  assert.match(js, /action', 'export'/);
  assert.doesNotMatch(js, /\.from\(['"]anagrafica['"]\)/);
  assert.match(js, /Auth\.richiediAuth\(\)/);
  assert.match(dashboard, /#panel-post-vendita \.grid/);
  assert.match(dashboard, /moduli\/anagrafiche\.html/);
  assert.doesNotMatch(dashboard, /moduli\/call-center\/anagrafiche\.html/);
});

test('la function protegge update e delete lato server', () => {
  const source = fs.readFileSync(path.join(ROOT, 'netlify/functions/gestisci-anagrafiche.js'), 'utf8');
  assert.match(source, /\['GET', 'POST'\]\.includes\(event\.httpMethod\)/);
  assert.match(source, /profilo\?\.ruolo !== 'admin'/);
  assert.match(source, /findDeleteDependencies\(supabase, payload\.id\)/);
  assert.match(source, /\.eq\('updated_at', expectedUpdatedAt\)/);
  assert.match(source, /error\?\.code === '23505'/);
  assert.match(source, /error\?\.code === '23503'/);
  assert.match(source, /\.from\('mirox_comuni_istat'\)/);
  assert.match(source, /resolveIstatLocality/);
});

test('la migration ISTAT è server-only, completa e aggiunge il trigger non bloccante', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'database/070_comuni_istat_normalizzazione_anagrafica.sql'), 'utf8');
  const catalogRows = sql.match(/^    \('[0-9]{6}',/gm) || [];
  assert.equal(catalogRows.length, 7893);
  assert.match(sql, /CREATE TABLE public\.mirox_comuni_istat/);
  assert.match(sql, /ALTER TABLE public\.mirox_comuni_istat ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.mirox_comuni_istat FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /CREATE TRIGGER trg_anagrafica_normalizza_localita/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF comune, provincia ON public\.anagrafica/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.anagrafica (?:ADD|DROP|RENAME)/i);
});

test('la bonifica località è transazionale, auditata e conserva lo storico collegato', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'database/071_bonifica_localita_anagrafica.sql'), 'utf8');
  assert.match(sql, /^BEGIN;/m);
  assert.match(sql, /^COMMIT;/m);
  assert.match(sql, /SET LOCAL statement_timeout = '45s'/);
  assert.match(sql, /CREATE TABLE public\.mirox_anagrafica_localita_audit/);
  assert.match(sql, /ALTER TABLE public\.mirox_anagrafica_localita_audit ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.mirox_anagrafica_localita_audit FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /v_totale <> 1094/);
  assert.match(sql, /\('CAPITELLO', 'CONCAMARISE', 'VR', 'correzione_manual_utente'/);
  assert.match(sql, /'c502c5a2-0ebd-4e00-92b1-34ef8edb44d9'::uuid/);
  assert.match(sql, /'aafa568f-898d-4306-a0ee-e7362c01ef3f'::uuid/);
  assert.match(sql, /'8c685507-624a-48ee-9e95-19485f180db7'::uuid/);
  assert.match(sql, /record_eliminato/);
  assert.equal((sql.match(/DELETE FROM public\.anagrafica/g) || []).length, 1);
  assert.doesNotMatch(sql, /DELETE FROM public\.(?:chiamate|vendita_contratti|vendita_documenti|vendita_pratiche)/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.anagrafica (?:ADD|DROP|RENAME)/i);
});
