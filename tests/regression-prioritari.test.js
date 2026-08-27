const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const scoreIntegrity = require(path.join(
  ROOT,
  'netlify/functions/_lib/score-integrity.js'
));
const smsHosting = require(path.join(
  ROOT,
  'netlify/functions/_lib/smshosting.js'
));

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
  },
  './_lib/score-integrity': scoreIntegrity
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
  },
  './_lib/score-integrity': scoreIntegrity
});

test('OTP accetta numerazioni mobili italiane correnti e legacy', () => {
  assert.equal(
    smsHosting.normalizeMobileNumber('3335496825'),
    '+393335496825'
  );
  assert.equal(
    smsHosting.normalizeMobileNumber('333549682'),
    '+39333549682'
  );
  assert.equal(
    smsHosting.normalizeMobileNumber('+39 333 549 682'),
    '+39333549682'
  );
  assert.equal(
    smsHosting.normalizeMobileNumber('393335496825'),
    '+393335496825'
  );
  assert.equal(smsHosting.normalizeMobileNumber('33354968'), null);
  assert.equal(smsHosting.normalizeMobileNumber('33354968251'), null);
});

test('i moduli CRM con controllo rigido accettano telefoni di 9 o 10 cifre', () => {
  const wizard = fs.readFileSync(
    path.join(ROOT, 'moduli/upload-contratti-vendita.html'),
    'utf8'
  );
  const apriChiudi = fs.readFileSync(
    path.join(ROOT, 'moduli/apri_chiudi.html'),
    'utf8'
  );
  const switchSim = fs.readFileSync(
    path.join(ROOT, 'moduli/switch_sim.html'),
    'utf8'
  );
  const segnalazioni = fs.readFileSync(
    path.join(ROOT, 'moduli/segnalazioni.html'),
    'utf8'
  );
  const ocrPda = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/ocr-pda.js'),
    'utf8'
  );

  assert.match(wizard, /if \(\/\^3\\d\{8,9\}\$\/\.test\(s\)\) s = '\+39' \+ s;/);
  assert.match(apriChiudi, /const regex = \/\^3\\d\{8,9\}\$\//);
  assert.match(switchSim, /if \(!\/\^\\d\{9,10\}\$\/\.test\(numero\)\)/);
  assert.match(segnalazioni, /pattern="\[0-9\]\{9,10\}"/);
  assert.match(ocrPda, /cellulare: 9 o 10 cifre, prefisso 3xx/);
});

test('Protecta non salva preventivi senza PDF archiviato', () => {
  const protecta = fs.readFileSync(
    path.join(ROOT, 'moduli/simulatore_protecta.html'),
    'utf8'
  );

  assert.match(protecta, /if \(!uploadResult \|\| !uploadResult\.storage_path\)/);
  assert.match(
    protecta,
    /throw new Error\(`Il PDF del preventivo non è stato archiviato: \$\{uploadError\.message\}`\)/
  );
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

test('carrello multi-contratto usa nomi progressivi per PDA e contratti firmati della stessa categoria', () => {
  assert.equal(
    carrelloModule._test.buildPdaFinalFileName('Mobile', 1),
    'contratto_mobile.pdf'
  );
  assert.equal(
    carrelloModule._test.buildPdaFinalFileName('Mobile', 2),
    'contratto_mobile_2.pdf'
  );

  const backend = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/crea-vendita-pratica-carrello.js'),
    'utf8'
  );
  assert.match(backend, /const pdaProgressiveByCategory = new Map\(\);/);
  assert.match(backend, /progressive: pdaProgressive/);

  const wizard = fs.readFileSync(
    path.join(ROOT, 'moduli/upload-contratti-vendita.html'),
    'utf8'
  );
  assert.match(
    wizard,
    /const firmatoFileName = getProgressiveContractFileName\(cartItem, state\.cart\.contratti\)\.replace\('contratto_', 'contratto_firmato_'\);/
  );
});

test('nuovo contratto azzera categoria, PDA e stato visivo precedente', () => {
  const wizard = fs.readFileSync(
    path.join(ROOT, 'moduli/upload-contratti-vendita.html'),
    'utf8'
  );
  const resetStart = wizard.indexOf('function resetPendingContractSelection()');
  const resetEnd = wizard.indexOf('function resetContractFields()', resetStart);
  const resetBlock = wizard.slice(resetStart, resetEnd);
  const addStart = wizard.indexOf('async function addContrattoToCart');
  const addEnd = wizard.indexOf('function loadCartContractInForm', addStart);
  const addBlock = wizard.slice(addStart, addEnd);

  assert.ok(resetStart > 0);
  assert.match(resetBlock, /refs\.categoria\.value = '';/);
  assert.match(resetBlock, /resetPendingPdaSelection\(\);/);
  assert.match(resetBlock, /renderCategorieCards\(\);/);
  assert.match(wizard, /function resetPendingPdaSelection\(\)[\s\S]*clearInputFile\(refs\.filePda\);/);
  assert.match(wizard, /function resetPendingPdaSelection\(\)[\s\S]*updatePdaDropZoneVisual\(\);/);
  assert.match(addBlock, /resetPendingContractSelection\(\);/);
  assert.match(
    wizard,
    /refs\.btnBackToStep2\.addEventListener\('click', \(\) => \{\s*resetPendingContractSelection\(\);\s*resetContractFields\(\);/
  );
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

test('punteggi catalogo accettano zero reale ma rifiutano valori mancanti', () => {
  assert.equal(scoreIntegrity.parseRequiredScore(0, 'test'), 0);
  assert.equal(scoreIntegrity.parseRequiredScore('1.5', 'test'), 1.5);
  assert.throws(
    () => scoreIntegrity.parseRequiredScore(null, 'test'),
    /mancante nel catalogo/
  );
  assert.throws(
    () => scoreIntegrity.parseRequiredScore('', 'test'),
    /mancante nel catalogo/
  );
  assert.throws(
    () => scoreIntegrity.parseRequiredScore('non-numero', 'test'),
    /non numerico/
  );
});

test('integrità punteggi verifica componenti, totali e colonne legacy', () => {
  const coherent = {
    punteggio_gara_offerta: 1,
    punteggio_gara_opzione: 0.5,
    punteggio_gara_totale: 1.5,
    punteggio_extra_gara_offerta: 0.25,
    punteggio_extra_gara_opzione: 0.25,
    punteggio_extra_gara_totale: 0.5,
    punteggio_offerta: 1,
    punteggio_opzione: 0.5,
    punteggio_extra: 0,
    punteggio_totale: 1.5
  };

  assert.doesNotThrow(() => scoreIntegrity.assertPersistedContractScores(coherent, {
    context: 'test',
    expectedComponents: {
      punteggio_gara_offerta: 1,
      punteggio_gara_opzione: 0.5,
      punteggio_extra_gara_offerta: 0.25,
      punteggio_extra_gara_opzione: 0.25
    }
  }));

  assert.throws(
    () => scoreIntegrity.assertPersistedContractScores({
      ...coherent,
      punteggio_gara_offerta: 0,
      punteggio_gara_totale: 0.5,
      punteggio_offerta: 0,
      punteggio_totale: 0.5
    }, {
      context: 'test',
      expectedComponents: {
        punteggio_gara_offerta: 1,
        punteggio_gara_opzione: 0.5,
        punteggio_extra_gara_offerta: 0.25,
        punteggio_extra_gara_opzione: 0.25
      }
    }),
    /salvato=0, atteso=1/
  );

  assert.throws(
    () => scoreIntegrity.assertPersistedContractScores({
      ...coherent,
      punteggio_gara_totale: 0
    }),
    /punteggio_gara_totale=0, atteso=1.5/
  );
});

test('verifica contratto non ricalcola i punteggi se gli ID catalogo non cambiano', async () => {
  const supabaseNotExpected = {
    from() {
      throw new Error('Il catalogo non deve essere interrogato');
    }
  };
  const current = {
    categoria_id: 'cat-1',
    offerta_id: 'off-1',
    opzione_id: 'opz-1',
    reload_id: null
  };

  const snapshots = await contractManager._test.deriveCatalogSnapshots(
    supabaseNotExpected,
    current,
    {
      categoria_id: 'cat-1',
      offerta_id: 'off-1',
      opzione_id: 'opz-1',
      reload_id: null
    }
  );

  assert.deepEqual(JSON.parse(JSON.stringify(snapshots)), {});
});

test('verifica contratto blocca un punteggio catalogo nullo invece di trasformarlo in zero', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'vendita_offerte');
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      id: 'off-2',
                      nome_offerta: 'Offerta incompleta',
                      punteggio_gara: null,
                      punteggio_extra_gara: 0
                    },
                    error: null
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  await assert.rejects(
    contractManager._test.deriveCatalogSnapshots(
      supabase,
      {
        categoria_id: 'cat-1',
        offerta_id: 'off-1',
        opzione_id: null,
        reload_id: null
      },
      { offerta_id: 'off-2' }
    ),
    /punteggio_gara offerta mancante nel catalogo/
  );
});

test('verifica contratto riapplica il bonus Annuale quando cambia opzione', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'impostazioni');
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: { valore: '0.5' }, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  const snapshots = await contractManager._test.deriveCatalogSnapshots(
    supabase,
    {
      categoria_id: 'cat-ass',
      categoria_snapshot: 'Assicurazioni',
      offerta_id: 'off-1',
      opzione_id: 'opz-1',
      reload_id: null,
      ricorrenza_assicurazione: 'Annuale'
    },
    { opzione_id: null }
  );

  assert.equal(snapshots.punteggio_gara_opzione, 0.5);
  assert.equal(snapshots.punteggio_extra_gara_opzione, 0);
});

test('lettura bonus Annuale fallisce chiusa se la configurazione manca', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  await assert.rejects(
    scoreIntegrity.loadAnnualInsuranceBonus(supabase),
    /bonus_assicurazione_annuale mancante nel catalogo/
  );
});

test('migration deduplica solo i sette mapping certi e copre tutte le FK anagrafica', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'database/057_deduplica_anagrafiche.sql'),
    'utf8'
  );
  const loserIds = [
    '067eb0a0-d032-4745-b652-4845fbf5e8a9',
    '1d8bfe49-831a-4c79-80b9-7a64229ed94e',
    'e4570cdd-2503-41d9-b229-f7333fc8dcf5',
    '6eaa2c5a-3faf-446a-bf0f-ffd471e66939',
    '13cfb945-be49-44e2-8151-ca9d56aea2b1',
    '241ca62e-1e5b-4d3a-96b6-c76c0e875cb9',
    'dfd71db9-1cb2-4b0b-bf81-19de1b3e8832'
  ];
  const fkTargets = [
    'appuntamenti',
    'chiamate',
    'call_center_lead_outbound_chiamate',
    'vendita_pratiche',
    'vendita_contratti',
    'vendita_documenti',
    'vendita_consensi_privacy',
    'vendita_consensi_privacy_v2',
    'vendita_ordini_smartphone',
    'vendita_apri_chiudi',
    'vendita_switch_sim',
    'post_vendita_controllo_fissi',
    'post_vendita_controllo_lg',
    'post_vendita_controllo_allarmi',
    'post_vendita_controllo_assicurazioni',
    'post_vendita_dispositivi_comodato',
    'post_vendita_gestione_rimborsi'
  ];

  loserIds.forEach((id) => assert.match(sql, new RegExp(id)));
  assert.equal((sql.match(/^\s*\('[0-9a-f-]{36}',\s*'[0-9a-f-]{36}'/gm) || []).length, 7);
  fkTargets.forEach((table) => assert.match(sql, new RegExp(`UPDATE public\\.${table}\\b`)));
  assert.match(sql, /azione,\s*\n\s*dati_precedenti/);
  assert.match(sql, /'merge_duplicate'/);
  assert.match(sql, /nessuna FK reale può ancora puntare ai loser/);
});

test('migration punteggi aggiunge vincoli validati e audit permanente', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'database/058_integrita_e_audit_punteggi.sql'),
    'utf8'
  );

  assert.equal((sql.match(/ADD CONSTRAINT vendita_contratti_punteggio_/g) || []).length, 3);
  assert.equal((sql.match(/VALIDATE CONSTRAINT vendita_contratti_punteggio_/g) || []).length, 3);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.vendita_audit_punteggi\(\)/);
  assert.match(sql, /AFTER INSERT OR UPDATE OF/);
  assert.match(sql, /'punteggio_insert'/);
  assert.match(sql, /'punteggio_update'/);
});

test('migration finale elimina il doppione tecnico TEST senza lasciare FK', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'database/059_deduplica_anagrafica_test_case.sql'),
    'utf8'
  );

  assert.match(sql, /03cf3323-3da0-45d5-9de3-87d64a651af2/);
  assert.match(sql, /5a4c4708-dcbc-4609-8a03-f308ffaa651c/);
  assert.match(sql, /v_survivor_row\.cf_piva IS DISTINCT FROM 'TEST'/);
  assert.match(sql, /v_loser_row\.cf_piva IS DISTINCT FROM 'test'/);
  assert.match(sql, /information_schema\.referential_constraints/);
  assert.match(sql, /'merge_duplicate'/);
});

test('migration bonus annuale corregge soltanto i tre contratti verificati nel periodo del bug', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'database/060_ripristina_bonus_assicurazioni_annuali.sql'),
    'utf8'
  );
  const ids = [
    '817fae6c-5e5a-4983-b611-81a3a0035e4b',
    '7273d933-cfae-4c6a-89ab-2333b129a7c8',
    'eb6b456b-985f-47b2-a80c-4df68b594e46'
  ];

  ids.forEach((id) => assert.match(sql, new RegExp(id)));
  assert.match(sql, /punteggio_gara_opzione = 0\.5/);
  assert.match(sql, /punteggio_gara_totale IS DISTINCT FROM 2::numeric/);
  assert.match(sql, /060_ripristina_bonus_assicurazioni_annuali/);
});

test('migration opzione Iliad ripristina i 7 ID senza alterare il punto già corretto', () => {
  const sql = fs.readFileSync(
    path.join(ROOT, 'database/061_ripristina_opzione_iliad_snapshot.sql'),
    'utf8'
  );

  assert.equal((sql.match(/^\s*'[0-9a-f-]{36}',?$/gm) || []).length >= 7, true);
  assert.match(sql, /23057455-cfbe-457b-8f1c-0344f54e6ddf/);
  assert.match(sql, /Operatore attuale Iliad Italia/);
  assert.match(sql, /tipo_documento = 'copia_sim_mnp'/);
  assert.match(sql, /punteggio_gara_opzione IS DISTINCT FROM 1::numeric/);
  assert.doesNotMatch(sql, /SET\s+punteggio_gara_opzione\s*=/);
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
  const rimborsi = fs.readFileSync(path.join(ROOT, 'moduli/gestione_rimborsi.html'), 'utf8');
  const apriChiudi = fs.readFileSync(path.join(ROOT, 'moduli/apri_chiudi.html'), 'utf8');
  const auth = fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8');
  const source = `${rimborsi}\n${apriChiudi}`;

  assert.doesNotMatch(source, /RIMBORSO_MANUALE_PASSWORD|PASSWORD_CORRETTA/);
  assert.doesNotMatch(source, /['"](?:1234|2013)['"]/);
  assert.doesNotMatch(source, /password-ko|btn-verifica-password-ko|error-password-ko/);
  assert.doesNotMatch(source, /Auth\.riautentica/);
  assert.doesNotMatch(auth, /riautentica|signInWithPassword|type:\s*['"]password['"]/);
  assert.match(rimborsi, /profilo\?\.ruolo !== 'admin'/);
  assert.match(rimborsi, /action,\s*\.\.\.payload/);
  assert.match(rimborsi, /create_rimborso_manuale/);
  assert.doesNotMatch(apriChiudi, /apriChiudiAdmin|riservata agli amministratori/);
  assert.match(apriChiudi, /d\.stato === 'IN CORSO'[\s\S]*apriModalKO/);
  assert.match(apriChiudi, /mark_apri_chiudi_ko/);
  assert.doesNotMatch(rimborsi, /\.from\(['"]post_vendita_gestione_rimborsi['"]\)\s*\.insert\(/);
  assert.doesNotMatch(rimborsi, /\.from\(['"]post_vendita_gestione_rimborsi['"]\)\s*\.update\(/);
  assert.doesNotMatch(apriChiudi, /\.from\(['"]vendita_apri_chiudi['"]\)\s*\.update\(\{\s*stato:\s*['"]KO['"]/);
});

test('le operazioni post-vendita applicano i ruoli lato server e proteggono le scritture dirette', () => {
  const functionPath = path.join(ROOT, 'netlify/functions/gestisci-operazioni-post-vendita.js');
  const functionSource = fs.readFileSync(functionPath, 'utf8');
  const { _test } = require(functionPath);
  const migration = fs.readFileSync(
    path.join(ROOT, 'database/056_operazioni_sensibili_admin.sql'),
    'utf8'
  );

  assert.deepEqual(Array.from(_test.ADMIN_ACTIONS), ['create_rimborso_manuale']);
  assert.equal(_test.AUTHENTICATED_ACTIONS.has('mark_apri_chiudi_ko'), true);
  assert.match(functionSource, /requireAuth\(event,\s*\{\s*adminOnly:\s*ADMIN_ACTIONS\.has\(action\)\s*\}\)/);
  assert.match(functionSource, /stato:\s*'Aperto'/);
  assert.match(functionSource, /stato:\s*'Consegnato'/);
  assert.match(functionSource, /Rimborso manuale registrato da un amministratore/);

  assert.match(migration, /REVOKE ALL PRIVILEGES[\s\S]*post_vendita_gestione_rimborsi[\s\S]*FROM anon, authenticated/);
  assert.match(migration, /REVOKE ALL PRIVILEGES[\s\S]*post_vendita_rimborsi_seq[\s\S]*FROM anon, authenticated/);
  assert.match(migration, /CREATE POLICY post_vendita_gestione_rimborsi_authenticated_select/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mirox_guard_apri_chiudi_ko_admin\(\)/);
  assert.match(migration, /p\.ruolo = 'admin'/);
  assert.match(migration, /BEFORE UPDATE OF stato/);
});

test('validazioni endpoint post-vendita rifiutano importi, date, ID e path non sicuri', () => {
  const { _test } = require(path.join(
    ROOT,
    'netlify/functions/gestisci-operazioni-post-vendita.js'
  ));

  assert.equal(_test.positiveAmount('12.349'), 12.35);
  assert.equal(_test.positiveId('42'), 42);
  assert.equal(_test.validDate('2026-07-26'), '2026-07-26');
  assert.equal(_test.validPdfPath('Mario_Rossi_1234/1720000000000_modulo.pdf'), 'Mario_Rossi_1234/1720000000000_modulo.pdf');
  assert.deepEqual(_test.splitBeneficiary('Mario Rossi Bianchi'), {
    nome: 'Mario',
    cognome: 'Rossi Bianchi'
  });

  assert.throws(() => _test.positiveAmount(0), /Importo non valido/);
  assert.throws(() => _test.positiveId('1.5'), /non valido/);
  assert.throws(() => _test.validDate('2026-02-30'), /Data non valida/);
  assert.throws(() => _test.validPdfPath('../segreto.pdf'), /Percorso PDF non valido/);
  assert.throws(() => _test.validPdfPath('cartella/file.exe'), /Percorso PDF non valido/);
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
