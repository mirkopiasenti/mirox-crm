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
    search: 'Rossi or id eq bad',
    page: 1,
    pageSize: 100
  });

  assert.equal(api.parseFilters({ cluster: 'Admin' }).cluster, '');
  assert.equal(api.cleanFilter('Mario%_Rossi,(test)'), 'Mario Rossi test');
  assert.equal(api.cleanFilter("D'Amico"), 'D Amico');
});

test('il permesso Anagrafiche è esplicito o eredita Elenco chiamate solo se assente', () => {
  assert.equal(api.canAccess({ ruolo: 'admin', attivo: true }), true);
  assert.equal(api.canAccess({ ruolo: 'operatore', attivo: true, pagine_accessibili: { anagrafiche: true } }), true);
  assert.equal(api.canAccess({ ruolo: 'operatore', attivo: true, pagine_accessibili: { elenco_chiamate: true } }), true);
  assert.equal(api.canAccess({ ruolo: 'operatore', attivo: true, pagine_accessibili: { anagrafiche: false, elenco_chiamate: true } }), false);
  assert.equal(api.canAccess({ ruolo: 'operatore', attivo: false, pagine_accessibili: { anagrafiche: true } }), false);
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

test('la pagina Anagrafiche usa la function autenticata e contiene filtri, popup ed export', () => {
  const html = fs.readFileSync(path.join(ROOT, 'moduli/call-center/anagrafiche.html'), 'utf8');
  const js = fs.readFileSync(path.join(ROOT, 'moduli/call-center/js/anagrafiche.js'), 'utf8');

  assert.match(html, /id="searchName"/);
  assert.match(html, /id="filterCluster"/);
  assert.match(html, /id="filterComune"/);
  assert.match(html, /id="detailModal"/);
  assert.match(html, /id="btnExport"/);
  assert.match(js, /MiroxApi\.fetch/);
  assert.match(js, /action', 'export'/);
  assert.doesNotMatch(js, /\.from\(['"]anagrafica['"]\)/);
});
