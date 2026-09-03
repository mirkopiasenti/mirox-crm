const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const endpointPath = path.join(ROOT, 'netlify/functions/gestisci-controllo-lg.js');
const htmlPath = path.join(ROOT, 'moduli/controllo_lg.html');
const migrationPath = path.join(ROOT, 'database/062_controllo_lg_esiti_manuali.sql');
const endpointSource = fs.readFileSync(endpointPath, 'utf8');
const htmlSource = fs.readFileSync(htmlPath, 'utf8');
const migrationSource = fs.readFileSync(migrationPath, 'utf8');
const { _test } = require(endpointPath);

const UUID_1 = '11111111-1111-4111-8111-111111111111';

test('esito manuale L&G accetta solo stati canonici e motivazione significativa', () => {
  assert.deepEqual(_test.parseManualOutcome({
    id: UUID_1,
    stato: 'Rifiutato',
    note: 'PDR assente nel file WindTre'
  }), {
    id: UUID_1,
    stato: 'Rifiutato',
    note: 'PDR assente nel file WindTre'
  });

  assert.deepEqual(_test.parseManualOutcome({
    id: UUID_1,
    stato: 'NON TROVATO',
    note: 'Pratica non presente nel file WindTre'
  }), {
    id: UUID_1,
    stato: 'NON TROVATO',
    note: 'Pratica non presente nel file WindTre'
  });

  assert.throws(
    () => _test.parseManualOutcome({ id: UUID_1, stato: 'rifiutato', note: 'Motivo valido' }),
    /Stato manuale non valido/
  );
  assert.throws(
    () => _test.parseManualOutcome({ id: UUID_1, stato: 'Attivato', note: 'No' }),
    /almeno 5 caratteri/
  );
  assert.throws(
    () => _test.parseManualOutcome({ id: 'non-uuid', stato: 'Attivato', note: 'Motivo valido' }),
    /id non valido/
  );
});

test('batch CSV L&G resta limitato, senza duplicati e con campi in allowlist', () => {
  const parsed = _test.parseCsvBatch({
    updates: [{
      id: UUID_1,
      stato: 'Attivato',
      causale_stato_pratica: '  valore  ',
      campo_non_ammesso: 'ignora'
    }]
  });

  assert.deepEqual(parsed, [{
    id: UUID_1,
    stato: 'Attivato',
    causale_stato_pratica: 'valore',
    messaggio_esito_sap: null,
    causa_annullamento: null
  }]);
  assert.throws(
    () => _test.parseCsvBatch({
      updates: [
        { id: UUID_1, stato: 'Attivato' },
        { id: UUID_1, stato: 'Rifiutato' }
      ]
    }),
    /ID duplicati/
  );
  assert.throws(
    () => _test.parseCsvBatch({
      updates: Array.from({ length: _test.CSV_BATCH_SIZE + 1 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        stato: 'Attivato'
      }))
    }),
    /Massimo 50/
  );
});

test('azioni manuali sono admin-only e gli upload ricontrollano il blocco lato server', () => {
  assert.deepEqual(
    Array.from(_test.ADMIN_ACTIONS).sort(),
    ['set_manual_outcome', 'unlock_manual_outcome']
  );
  assert.match(endpointSource, /adminOnly:\s*ADMIN_ACTIONS\.has\(action\)/);
  assert.match(endpointSource, /\.eq\('esito_manuale_bloccato', false\)/);
  assert.match(endpointSource, /status:\s*'manual_protected'/);
  assert.match(endpointSource, /stato_origine:\s*'manuale'/);
  assert.match(endpointSource, /stato_origine:\s*'csv'/);
});

test('frontend L&G usa il backend e rende visibile la protezione manuale', () => {
  assert.match(htmlSource, /MiroxApi\.fetch\('\/\.netlify\/functions\/gestisci-controllo-lg'/);
  assert.doesNotMatch(
    htmlSource,
    /\.from\(['"]post_vendita_controllo_lg['"]\)\s*\.update\(/
  );
  assert.match(htmlSource, /Esita manualmente/);
  assert.match(htmlSource, /Manuale protetto/);
  assert.match(htmlSource, /Esiti manuali protetti/);
  assert.match(htmlSource, /Riattiva aggiornamenti CSV/);
  assert.match(htmlSource, /MANUAL_STATUS_OPTIONS = \[\.\.\.Object\.keys\(STATO_PRIORITY\), 'NON TROVATO'\]/);
  assert.match(htmlSource, /\.stato-pill\.non-trovato\s*\{\s*background:\s*#FAE8FF;\s*color:\s*#C026D3;/);
});

test('frontend L&G ordina le righe dalla data inserimento piu recente', () => {
  assert.match(
    htmlSource,
    /const righe = \[\.\.\.\(data \|\| \[\]\)\]\.sort\(confrontaDataInserimentoDesc\)/
  );
  assert.match(
    htmlSource,
    /timestampOrZero\(dataInserimento\(b\)\) - timestampOrZero\(dataInserimento\(a\)\)/
  );
});

test('frontend L&G filtra per gli operatori presenti nei contratti', () => {
  assert.match(htmlSource, /id="filtroOperatoreLg"/);
  assert.match(htmlSource, /filtroOperatore:\s*''/);
  assert.match(htmlSource, /function popolaFiltroOperatore\(\)/);
  assert.match(htmlSource, /r\.contratto\.operatore_id\) === LGState\.filtroOperatore/);
  assert.match(htmlSource, /bindLgFiltro\('filtroOperatoreLg', 'filtroOperatore'\)/);
  assert.match(htmlSource, /LGState\.filtroOperatore = '';[\s\S]*filtroOperatoreLg'\)\.value = ''/);
});

test('migration L&G aggiunge audit, coerenza e guardia database', () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS stato_origine text NOT NULL DEFAULT 'csv'/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS esito_manuale_bloccato boolean NOT NULL DEFAULT false/);
  assert.match(migrationSource, /pvlg_esito_manuale_coerenza_chk/);
  assert.match(migrationSource, /COALESCE\(length\(btrim\(esito_manuale_note\)\), 0\) >= 5/);
  assert.match(migrationSource, /auth\.role\(\) = 'service_role'/);
  assert.match(migrationSource, /p\.ruolo = 'admin'/);
  assert.match(migrationSource, /OLD\.esito_manuale_bloccato AND NOT v_is_admin/);
  assert.match(migrationSource, /CREATE TRIGGER trg_pvlg_esito_manuale_guard/);
});
