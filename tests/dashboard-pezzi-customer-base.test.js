const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('TELEFONI CB è limitata ai telefoni Consumer in entrambe le dashboard mensili', () => {
  const migration = fs.readFileSync(
    path.join(root, 'database/072_limita_telefoni_cb_dashboard.sql'),
    'utf8'
  );
  const dashboard = fs.readFileSync(path.join(root, 'moduli/dashboard_pezzi.html'), 'utf8');

  assert.match(migration, /tabella IN \('gara_individuale', 'avanzamento_standard'\)/);
  assert.match(migration, /'categoria', 'Customer Base'/);
  assert.match(migration, /'cluster', 'Consumer'/);
  assert.match(migration, /'offerta_match', 'telefono incluso'/);
  assert.match(migration, /'dispositivo_associato', true/);
  assert.match(migration, /'tipo_acquisto', 'VAR'/);
  assert.match(migration, /'tipo_acquisto', 'Finanziamento'/);
  assert.match(dashboard, /Array\.isArray\(regola\.or\)/);
  assert.match(dashboard, /regola\.dispositivo_associato !== undefined/);
  assert.match(dashboard, /regola\.tipo_acquisto/);
});
