const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const controlloFiles = [
  'controllo_fissi.html',
  'controllo_lg.html',
  'controllo_assicurazioni.html',
  'controllo_allarmi.html'
];

test('tutti i moduli di controllo espongono il collegamento al contratto specifico', () => {
  for (const file of controlloFiles) {
    const source = fs.readFileSync(path.join(ROOT, 'moduli', file), 'utf8');
    assert.match(source, /Vai alla pratica/, `${file} deve mostrare il tasto`);
    assert.match(
      source,
      /verifica_contratti\.html\?contratto_id=\$\{encodeURIComponent\(r\.contratto_id\)\}/,
      `${file} deve propagare contratto_id in modo codificato`
    );
  }
});

test('Verifica Contratti valida il deep-link e apre il contratto nella tab corrente', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'moduli', 'verifica_contratti.html'),
    'utf8'
  );

  assert.match(source, /new URLSearchParams\(window\.location\.search\)\.get\('contratto_id'\)/);
  assert.match(source, /MiroxSafe\.isUuid\(id\)/);
  assert.match(source, /VCState\.daVerificare\.some\(c => c\.id === id\)/);
  assert.match(source, /VCState\.verificati\.some\(c => c\.id === id\)/);
  assert.match(source, /switchTabVC\(tabName, tabButton\)/);
  assert.match(source, /await apriDettaglioContratto\(id, stateKey\)/);
  assert.match(
    source,
    /await Promise\.all\(\[caricaContratti\('da_controllare'\), caricaContratti\('controllato'\)\]\);\s*await apriPraticaRichiesta\(\);/
  );
});

test('Verificati filtra l IMEI dispositivo con corrispondenza esatta', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'moduli', 'verifica_contratti.html'),
    'utf8'
  );

  assert.match(source, /id="searchImeiVerificati"/);
  assert.match(source, /function normalizeImei\(value\)/);
  assert.match(source, /normalizeImei\(VCState\.searchImeiVerificati\)/);
  assert.match(source, /normalizeImei\(c\.imei\) !== imeiQuery/);
  assert.doesNotMatch(source, /normalizeImei\(c\.imei\)[^\n]*\.includes\(imeiQuery\)/);
  assert.doesNotMatch(source, /searchEmailVerificati|E-mail dispositivo/);
});

test('Verificati filtra per cluster del contratto preservando Turista', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'moduli', 'verifica_contratti.html'),
    'utf8'
  );

  assert.match(source, /id="filterClusterVerificati"/);
  assert.match(source, /<option value="Consumer">Consumer<\/option>/);
  assert.match(source, /<option value="Business">Business<\/option>/);
  assert.match(source, /<option value="Turista">Turista<\/option>/);
  assert.match(source, /contratto\.cluster_cliente \|\| \(contratto\.anagrafica && contratto\.anagrafica\.cluster\)/);
  assert.match(source, /getContrattoCluster\(c\) !== cluster/);
});
