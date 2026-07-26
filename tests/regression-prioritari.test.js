const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');

function loadCommonJs(relativePath, stubs = {}) {
  const filename = path.join(ROOT, relativePath);
  const code = fs.readFileSync(filename, 'utf8');
  const module = { exports: {} };
  const sandbox = {
    Buffer,
    Date,
    Intl,
    console,
    exports: module.exports,
    module,
    process: { env: {} },
    require(id) {
      if (Object.prototype.hasOwnProperty.call(stubs, id)) return stubs[id];
      throw new Error(`Dipendenza non prevista nel test: ${id}`);
    }
  };

  vm.runInNewContext(code, sandbox, { filename });
  return module.exports;
}

const carrelloModule = loadCommonJs('netlify/functions/crea-vendita-pratica-carrello.js', {
  '@supabase/supabase-js': { createClient() { return {}; } },
  './_lib/require-auth': { requireAuth: async () => ({ ok: false }) },
  './_lib/privacy-config': {
    INFORMATIVE_VERSIONI_CORRENTI: ['v6_2026_07_26', 'v6_2026_07_26_dig']
  }
});

const uploadModule = loadCommonJs('netlify/functions/upload-vendita-documento.js', {
  busboy() { return {}; },
  '@supabase/supabase-js': { createClient() { return {}; } },
  './_lib/require-auth': { requireAuth: async () => ({ ok: false }) }
});

const moduleUpload = loadCommonJs('netlify/functions/upload-documento-modulo.js', {
  busboy() { return {}; },
  'node:crypto': crypto,
  './_lib/require-auth': {
    requireAuth: async () => ({ ok: false }),
    getAdminClient() { return null; }
  }
});

const contractManager = loadCommonJs('netlify/functions/gestisci-vendita-contratto.js', {
  './_lib/require-auth': {
    requireAuth: async () => ({ ok: false }),
    getAdminClient() { return null; }
  }
});

test('normalizzazione contratto conserva Cerea e reinserimento', () => {
  const normalized = carrelloModule._test.normalizeContractInput({
    categoria_id: 'categoria-1',
    offerta_id: 'offerta-1',
    codice_rivenditore: '9000822241',
    stato_inserimento: 'reinserimento',
    reinserimento_di_contratto_id: '11111111-1111-4111-8111-111111111111'
  }, 0);

  assert.equal(normalized.codice_rivenditore, '9000822241');
  assert.equal(normalized.stato_inserimento, 'reinserimento');
  assert.equal(
    normalized.reinserimento_di_contratto_id,
    '11111111-1111-4111-8111-111111111111'
  );
});

test('normalizzazione contratto rifiuta un path PDA fuori staging', () => {
  assert.throws(() => carrelloModule._test.normalizeContractInput({
    categoria_id: 'categoria-1',
    offerta_id: 'offerta-1',
    pda_temp_path: '../../documento.pdf'
  }, 0), /pda_temp_path non valido/);
});

test('mese solare Europe/Rome non oltrepassa il confine mensile', () => {
  const sameMonth = carrelloModule._test.isSameRomeCalendarMonth(
    '2026-07-31T21:59:59.000Z',
    '2026-07-15T10:00:00.000Z'
  );
  const nextMonth = carrelloModule._test.isSameRomeCalendarMonth(
    '2026-07-31T22:00:00.000Z',
    '2026-07-15T10:00:00.000Z'
  );

  assert.equal(sameMonth, true);
  assert.equal(nextMonth, false);
});

test('identità operatore usa il profilo autenticato e risolve gli alias', () => {
  const auth = {
    user: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    profilo: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      alias_di: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    }
  };

  assert.equal(
    carrelloModule._test.authenticatedOperatorId(auth),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  assert.equal(
    uploadModule._test.authenticatedUploaderId(auth),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
  assert.equal(
    uploadModule._test.canManagePractice(auth, {
      operatore_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    }),
    true
  );
  assert.equal(
    uploadModule._test.canManagePractice(auth, {
      operatore_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    }),
    false
  );
  assert.equal(
    uploadModule._test.canManagePractice({
      profilo: { ruolo: 'admin' }
    }, {
      operatore_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    }),
    true
  );
  assert.equal(
    uploadModule._test.canUploadIntoPractice(auth, {
      stato_pratica: 'inviata',
      operatore_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    }),
    true
  );
});

test('upload accetta soltanto buffer con firma PDF', () => {
  assert.equal(uploadModule._test.hasPdfSignature(Buffer.from('%PDF-1.7\n')), true);
  assert.equal(uploadModule._test.hasPdfSignature(Buffer.from('not-a-pdf')), false);
  assert.equal(moduleUpload._test.hasPdfSignature(Buffer.from('%PDF-1.7\n')), true);
  assert.equal(moduleUpload._test.hasPdfSignature(Buffer.from('<html></html>')), false);
});

test('upload moduli limita bucket e percorsi operativi', () => {
  assert.equal(
    moduleUpload._test.normalizeRequestedPath(
      'segnalazioni-files',
      'segnalazione_42/Documento Cliente.pdf'
    ),
    'segnalazione_42/Documento_Cliente.pdf'
  );
  assert.equal(
    moduleUpload._test.normalizeRequestedPath(
      'protecta-files',
      'preventivi/Preventivo #42.pdf'
    ),
    'preventivi/Preventivo_42.pdf'
  );
  assert.throws(
    () => moduleUpload._test.normalizeRequestedPath(
      'segnalazioni-files',
      'modelli/disdetta/modulo.pdf'
    ),
    /Percorso segnalazione non consentito/
  );
  assert.throws(
    () => moduleUpload._test.normalizeRequestedPath(
      'rimborsi-files',
      '../documento.pdf'
    ),
    /Percorso Storage non valido/
  );
});

test('gestione contratto scarta campi client riservati', () => {
  const picked = contractManager._test.pickAllowed({
    imei: '123456789012345',
    stato_controllo: 'controllato',
    controllato_da: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    punteggio_gara_offerta: 999
  }, new Set(['imei']));

  assert.equal(JSON.stringify(picked), JSON.stringify({ imei: '123456789012345' }));
  assert.equal(
    contractManager._test.canonicalProfileId({
      profilo: {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        alias_di: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
      }
    }),
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  );
});

test('wizard propaga codice rivenditore e usa finalize/rollback compensativo', () => {
  const html = fs.readFileSync(
    path.join(ROOT, 'moduli/upload-contratti-vendita.html'),
    'utf8'
  );
  const payloadBlock = html.slice(
    html.indexOf('function buildInvioPayload()'),
    html.indexOf('async function inviaPratica()')
  );
  const submitBlock = html.slice(
    html.indexOf('async function inviaPratica()'),
    html.indexOf("refs.cluster.addEventListener('change'")
  );

  assert.match(payloadBlock, /codice_rivenditore:\s*CODICI_RIVENDITORE\.includes/);
  assert.match(payloadBlock, /stato_inserimento:\s*item\.stato_inserimento/);
  assert.match(payloadBlock, /reinserimento_di_contratto_id:\s*item\.reinserimento_di_contratto_id/);
  assert.match(submitBlock, /action:\s*'finalize'/);
  assert.match(submitBlock, /action:\s*'rollback_upload_failure'/);
  assert.doesNotMatch(html, /\bwindow\.(?:alert|confirm)\s*\(/);
});

test('nessuna password operativa fissa resta nei moduli corretti', () => {
  const files = [
    'moduli/gestione_rimborsi.html',
    'moduli/apri_chiudi.html'
  ];
  const source = files
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /RIMBORSO_MANUALE_PASSWORD|PASSWORD_CORRETTA/);
  assert.doesNotMatch(source, /['"](?:1234|2013)['"]/);
  assert.doesNotMatch(source, /password-ko|btn-verifica-password-ko|error-password-ko/);
  assert.match(source, /Auth\.riautentica/);
});

test('nessun modulo scrive direttamente nei bucket dati o nelle tabelle vendita protette', () => {
  const moduleFiles = [
    'moduli/gestione_rimborsi.html',
    'moduli/apri_chiudi.html',
    'moduli/switch_sim.html',
    'moduli/verifica_contratti.html',
    'moduli/segnalazioni.html',
    'moduli/simulatore_protecta.html',
    'moduli/dispositivi_comodato.html'
  ];
  const source = moduleFiles
    .map((file) => fs.readFileSync(path.join(ROOT, file), 'utf8'))
    .join('\n');

  assert.doesNotMatch(source, /\.storage\.from\([^)]*\)\.upload\(/);
  assert.doesNotMatch(source, /\.storage\.from\([^)]*\)\.remove\(/);
  assert.doesNotMatch(source, /from\(['"]vendita_documenti['"]\)\.(?:insert|delete)\(/);
  assert.doesNotMatch(source, /from\(['"]vendita_contratti['"]\)\.update\(/);
  assert.match(source, /mirox-storage-upload\.js/);
  assert.match(source, /gestisci-vendita-contratto/);
});
