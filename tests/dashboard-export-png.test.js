'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'moduli', 'dashboard_pezzi.html'), 'utf8');

test('Gare Individuali esporta separatamente la scheda di ogni operatore', () => {
  assert.match(source, /class="btn-download-png gara-download-png" data-html2canvas-ignore="true"/);
  assert.match(source, /const card = button\.closest\('\.gara-card'\)/);
  assert.match(source, /nomeFilePng\('gara-individuale', operatore\)/);
  assert.doesNotMatch(source, /scaricaNodoPng\(document\.querySelector\('\.gare-grid'\)/);
});

test('Avanzamento Mensile ha un solo download che comprende entrambe le tabelle', () => {
  assert.equal((source.match(/id="downloadAvanzamento"/g) || []).length, 1);
  assert.match(source, /let html = '<div class="avanzamento-export" id="avanzamentoExport">'/);
  assert.match(source, /document\.getElementById\('avanzamentoExport'\)/);
  assert.match(source, /nomeFilePng\('avanzamento-mensile'\)/);
  assert.match(source, /\{ key: 'standard', titolo: 'Avanzamento'/);
  assert.match(source, /\{ key: 'piva',\s+titolo: 'Avanzamento P\.IVA'/);
});

test('il generatore PNG è versionato e produce file con periodo selezionato', () => {
  assert.match(source, /html2canvas@1\.4\.1/);
  assert.match(source, /integrity="sha384-[^"]+"/);
  assert.match(source, /String\(DPState\.mese\)\.padStart\(2, '0'\)/);
  assert.match(source, /canvas\.toBlob\([\s\S]*'image\/png'/);
});
