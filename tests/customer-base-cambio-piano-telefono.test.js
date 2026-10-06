const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(
  path.join(root, 'database/configura_customer_base_cambio_piano_telefono.sql'),
  'utf8'
);

test('la configurazione proposta aggiunge le due offerte Consumer con dispositivo e un punto', () => {
  assert.match(sql, /'Cambio Piano \+ Telefono Finanziato'/);
  assert.match(sql, /'Cambio Piano \+ Telefono VAR'/);
  assert.match(sql, /punteggio_gara, punteggio_extra_gara, abilita_dispositivo/);
  assert.match(sql, /1, 0, true, true/);
  assert.match(sql, /ON CONFLICT DO NOTHING/);
});

test('le due righe Day by Day distinguono Finanziamento e VAR senza sovrapporsi', () => {
  assert.match(sql, /'CAMBIO PIANO \+ TELEFONO FINANZIATO'/);
  assert.match(sql, /'CAMBIO PIANO \+ TELEFONO VAR'/);
  assert.match(sql, /"tipo_acquisto":"Finanziamento"/);
  assert.match(sql, /"tipo_acquisto":"VAR"/);
  assert.match(sql, /, 215,/);
  assert.match(sql, /, 216,/);
  assert.match(sql, /"dispositivo_associato":true/);
  assert.match(sql, /WHERE NOT EXISTS \([\s\S]*CAMBIO PIANO \+ TELEFONO FINANZIATO/);
  assert.match(sql, /WHERE NOT EXISTS \([\s\S]*CAMBIO PIANO \+ TELEFONO VAR/);
});

test('la proposta è transazionale e non contiene DDL o riferimenti a tabelle CC', () => {
  assert.match(sql.trim(), /^--[\s\S]*\n\nBEGIN;/);
  assert.match(sql.trim(), /COMMIT;$/);
  assert.doesNotMatch(sql, /ALTER\s+TABLE|CREATE\s+TABLE|CREATE\s+POLICY|CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  assert.doesNotMatch(sql, /\b(profili|anagrafica|appuntamenti|chiamate|blacklist)\b/i);
});
