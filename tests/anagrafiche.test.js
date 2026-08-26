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
    comune: 'Legnago',
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

test('la modifica anagrafica usa una allowlist, normalizza i dati e valida i campi', () => {
  assert.deepEqual(api.sanitizeAnagraficaUpdate({
    cf_piva: ' rssmra80a01h501u ',
    cluster: 'Consumer',
    ragione_sociale: '  Mario   Rossi  ',
    nome_referente: '',
    cellulare: '333 123 4567',
    email: 'mario@example.com',
    provincia: 'VR',
    comune: 'Legnago',
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
    comune: 'Legnago',
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
  assert.match(html, /id="btnEditAnagrafica"/);
  assert.match(html, /class="[^"]*hidden[^"]*" id="btnDeleteAnagrafica"/);
  assert.match(html, /id="btnExport"/);
  assert.match(js, /MiroxApi\.fetch/);
  assert.match(js, /method: 'POST'/);
  assert.match(js, /MiroxUI\.confirm/);
  assert.match(js, /state\.isAdmin = profilo\.ruolo === 'admin'/);
  assert.match(js, /expected_updated_at/);
  assert.match(js, /action=comuni/);
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
});
