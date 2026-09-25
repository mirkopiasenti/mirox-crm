const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const endpointPath = path.join(ROOT, 'netlify/functions/gestisci-controllo-fissi.js');
const htmlPath = path.join(ROOT, 'moduli/controllo_fissi.html');
const endpointSource = fs.readFileSync(endpointPath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const { _test } = require(endpointPath);

const UUID_1 = '11111111-1111-4111-8111-111111111111';

test('ripristino Controllo Fissi espone una sola azione e valida gli identificativi', () => {
  assert.deepEqual(Array.from(_test.ADMIN_ACTIONS), ['reopen_activation']);
  assert.equal(_test.validUuid(UUID_1), UUID_1);
  assert.throws(() => _test.validUuid('non-uuid'), /id non valido/);
  assert.equal(
    _test.authenticatedProfileId({ profilo: { id: UUID_1 } }),
    UUID_1
  );
});

test('ripristino Controllo Fissi è admin-only, atomico da Attivo o KO e azzera i campi di esito', () => {
  assert.match(endpointSource, /requireAuth\(event,\s*\{\s*adminOnly:\s*true\s*\}\)/);
  assert.match(endpointSource, /\.in\('stato',\s*\['Attivo',\s*'KO'\]\)/);
  assert.match(endpointSource, /stato:\s*'In Attivazione'/);
  assert.match(endpointSource, /data_attivazione:\s*null/);
  assert.match(endpointSource, /motivo_ko:\s*null/);
  assert.match(endpointSource, /stato_cambiato_da:\s*adminId/);
});

test('frontend mostra il ripristino solo agli admin sulle pratiche Attivo o KO e richiede conferma', () => {
  assert.match(htmlSource, /window\.__profilo\.ruolo === 'admin'/);
  assert.match(htmlSource, /stato === 'Attivo' \|\| stato === 'KO'\) && isControlloFissiAdmin\(\)/);
  assert.match(htmlSource, /Rimetti in attivazione/);
  assert.match(htmlSource, /Vuoi davvero correggere l’esito <strong>KO<\/strong>/);
  assert.match(htmlSource, /MiroxUI\.confirm\(/);
  assert.match(
    htmlSource,
    /MiroxApi\.fetch\('\/\.netlify\/functions\/gestisci-controllo-fissi'/
  );
  assert.match(htmlSource, /action:\s*'reopen_activation'/);
  assert.match(htmlSource, /La data di attivazione effettiva verrà azzerata/);
});
