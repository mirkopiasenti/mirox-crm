'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const {
  cleanText,
  incidentCode,
  requestType,
  requestTypeLabel,
  guardianAnalysisKeyboard,
  workApprovalKeyboard,
  _test: { intakeFallback }
} = require('../netlify/functions/_lib/kona-ai-guardian');
const {
  hashLeaseToken,
  hmacSignature,
  verifyWorkerRequest
} = require('../netlify/functions/_lib/guardian-codex');

test('codici incidente e testo Guardian sono normalizzati in modo deterministico', () => {
  assert.equal(incidentCode(42), 'KG-000042');
  assert.equal(cleanText('  prova\n\tproblema\u0000  ', 20), 'prova problema');
});

test('Guardian distingue problemi e migliorie senza cambiare il codice KG', () => {
  assert.equal(requestType('miglioria'), 'miglioria');
  assert.equal(requestType('PROBLEMA'), 'problema');
  assert.equal(requestType('sconosciuto'), null);
  assert.equal(requestTypeLabel('miglioria'), 'Miglioria');
  assert.equal(requestTypeLabel('sconosciuto'), 'Problema');
  assert.match(JSON.stringify(workApprovalKeyboard('incident-id')), /approve_work:incident-id/);
  assert.match(JSON.stringify(guardianAnalysisKeyboard('incident-id')), /analyze_codex:incident-id/);
});

test('il contratto worker Guardian usa firma HMAC e lease hashati', () => {
  const previous = process.env.GUARDIAN_WORKER_SECRET;
  process.env.GUARDIAN_WORKER_SECRET = 'test-worker-secret';
  const body = JSON.stringify({ action: 'heartbeat', execution_id: 'test' });
  const signature = hmacSignature(body);
  assert.equal(signature.length, 64);
  assert.equal(hashLeaseToken('lease-token').length, 64);
  assert.equal(verifyWorkerRequest({
    body,
    headers: { 'x-guardian-worker-signature': signature }
  }), true);
  assert.equal(verifyWorkerRequest({
    body,
    headers: { 'x-guardian-worker-signature': '0'.repeat(64) }
  }), false);
  if (previous === undefined) delete process.env.GUARDIAN_WORKER_SECRET;
  else process.env.GUARDIAN_WORKER_SECRET = previous;
});

test('Guardian chiude la raccolta dopo al massimo due chiarimenti', () => {
  const first = intakeFallback([
    { autore_tipo: 'operatore', testo: 'Il pulsante non funziona.' }
  ], { tipo_richiesta: 'problema' });
  const second = intakeFallback([
    { autore_tipo: 'operatore', testo: 'Il pulsante non funziona.' },
    { autore_tipo: 'guardian', testo: first.reply },
    { autore_tipo: 'operatore', testo: 'Mi aspettavo che aprisse la pratica.' }
  ], { tipo_richiesta: 'problema' });
  const completed = intakeFallback([
    { autore_tipo: 'operatore', testo: 'Il pulsante non funziona.' },
    { autore_tipo: 'guardian', testo: first.reply },
    { autore_tipo: 'operatore', testo: 'Mi aspettavo che aprisse la pratica.' },
    { autore_tipo: 'guardian', testo: second.reply },
    { autore_tipo: 'operatore', testo: 'Si ripete sempre e non compare alcun errore.' }
  ], { tipo_richiesta: 'problema' });

  assert.equal(first.complete, false);
  assert.equal(second.complete, false);
  assert.equal(completed.complete, true);
  assert.match(completed.reply, /inviata all’amministratore/);
});

test('il vecchio reporter email tecnico è rimosso senza eliminare il mailer operativo', () => {
  const publicFiles = [
    ...fs.readdirSync(path.join(ROOT, 'js')).map((name) => `js/${name}`),
    ...fs.readdirSync(path.join(ROOT, 'moduli'), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `moduli/${entry.name}`),
    'dashboard.html'
  ];
  const source = publicFiles
    .filter((relativePath) => /\.(?:html|js)$/.test(relativePath))
    .map(read)
    .join('\n');

  assert.equal(source.includes('MiroxErrorReporter'), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'js/mirox-error-reporter.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'netlify/functions/mirox-send-email.js')), true);
});

test('le API Guardian separano segnalazioni autenticate e webhook Telegram privato', () => {
  const incidents = read('netlify/functions/guardian-incidents.js');
  const webhook = read('netlify/functions/guardian-telegram-webhook.js');
  const guardian = read('netlify/functions/_lib/kona-ai-guardian.js');
  const migration = read('database/065_kona_ai_guardian.sql');
  const requestTypeMigration = read('database/066_kona_ai_tipologia_richiesta.sql');
  const executionMigration = read('database/067_kona_ai_codex_esecuzioni.sql');
  const worker = read('netlify/functions/guardian-codex-worker.js');
  const workerHelper = read('netlify/functions/_lib/guardian-codex.js');
  const analysisWorkflow = read('.github/workflows/guardian-codex-analysis.yml');
  const patchWorkflow = read('.github/workflows/guardian-codex-patch.yml');
  const testWorkflow = read('.github/workflows/guardian-codex-test.yml');
  const releaseWorkflow = read('.github/workflows/guardian-codex-release.yml');

  assert.match(incidents, /requireAuth\(event\)/);
  assert.match(incidents, /profileId\(auth\)/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/i);
  assert.match(webhook, /TELEGRAM_GUARDIAN_OWNER_CHAT_ID/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.kona_ai_incidenti FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /dettagli_tecnici_scadono_at/);
  assert.match(requestTypeMigration, /ADD COLUMN IF NOT EXISTS tipo_richiesta text NOT NULL DEFAULT 'problema'/i);
  assert.match(requestTypeMigration, /tipo_richiesta IN \('problema', 'miglioria'\)/i);
  assert.match(requestTypeMigration, /azione = 'prepara_fix'/i);
  assert.match(executionMigration, /CREATE TABLE IF NOT EXISTS public\.kona_ai_esecuzioni/i);
  assert.match(executionMigration, /REVOKE ALL ON TABLE public\.kona_ai_esecuzioni FROM PUBLIC, anon, authenticated/i);
  assert.match(executionMigration, /idx_kona_ai_esecuzioni_one_active/i);
  assert.match(workerHelper, /x-guardian-worker-signature/i);
  assert.match(worker, /lease_token_hash/i);
  assert.match(analysisWorkflow, /sandbox: read-only/i);
  assert.match(analysisWorkflow, /model: gpt-5\.6-luna/i);
  assert.match(analysisWorkflow, /github\.ref_name == 'main'/i);
  assert.match(analysisWorkflow, /inputs\.target_environment == 'production'/i);
  assert.match(analysisWorkflow, /guardian-production/i);
  assert.match(analysisWorkflow, /inputs\.requested_type == 'analisi_codex'/i);
  assert.match(patchWorkflow, /sandbox: workspace-write/i);
  assert.match(patchWorkflow, /--base "\$\{GITHUB_REF_NAME\}"/i);
  assert.match(patchWorkflow, /github\.ref == 'refs\/heads\/codex\/kona-ai-guardian-staging'/i);
  assert.match(patchWorkflow, /inputs\.requested_type == 'prepara_patch'/i);
  assert.match(patchWorkflow, /inputs\.target_environment == 'production'/i);
  assert.match(patchWorkflow, /guardian-production/i);
  assert.match(patchWorkflow, /database\/\.\*\\\.sql\$/i);
  assert.doesNotMatch(patchWorkflow, /grep -E '\(\^\|\/\)database\/'/i);
  assert.match(patchWorkflow, /:\(exclude\)guardian-context\.json/i);
  assert.match(patchWorkflow, /\/tmp\/guardian-changed-files\.txt/i);
  assert.match(patchWorkflow, /ESITO_PATCH: GIA_PRESENTE/i);
  assert.match(patchWorkflow, /ESITO_PATCH: RICHIEDE_INFORMAZIONI/i);
  assert.match(patchWorkflow, /steps\.validate\.outputs\.has_changes == 'true'/i);
  assert.match(patchWorkflow, /no_changes:\(\$no_changes == "true"\)/i);
  assert.match(patchWorkflow, /needs_information:\(\$needs_information == "true"\)/i);
  assert.match(patchWorkflow, /blocked:\(\$blocked == "true"\)/i);
  assert.ok(
    patchWorkflow.indexOf('Install dependencies before Codex') < patchWorkflow.indexOf('Run Codex Luna with workspace write'),
    'le dipendenze devono essere installate prima di avviare Codex'
  );
  assert.match(patchWorkflow, /pull_request_url:\(if \(\$pr\|length\) > 0 then \$pr else null end\)/i);
  assert.match(patchWorkflow, /if \[ "\$success" != true \]; then exit 1; fi/i);
  assert.match(testWorkflow, /startsWith\(github\.ref, 'refs\/heads\/codex\/kg-'\)/i);
  assert.match(testWorkflow, /inputs\.requested_type == 'test_staging'/i);
  assert.match(testWorkflow, /inputs\.target_environment == 'production'/i);
  assert.match(releaseWorkflow, /startsWith\(github\.ref, 'refs\/heads\/codex\/kg-'\)/i);
  assert.match(releaseWorkflow, /inputs\.requested_type == 'rilascio_produzione'/i);
  assert.match(releaseWorkflow, /inputs\.target_environment == 'production'/i);
  assert.match(releaseWorkflow, /pull_request_url:\(if \(\$pr\|length\) > 0 then \$pr else null end\)/i);
  assert.match(releaseWorkflow, /if \[ "\$success" != true \]; then exit 1; fi/i);
  assert.match(worker, /il comportamento risulta già presente nello staging/i);
  assert.match(worker, /result\?\.no_changes === true/i);
  assert.match(worker, /needsInformation/i);
  assert.match(worker, /noChanges \|\| needsInformation \|\| blocked \? 'ricevuto' : 'in_lavorazione'/i);
  assert.match(worker, /keyboardForExecution\(execution, safeResult\)/i);
  assert.match(workerHelper, /target_environment: targetEnvironment === 'staging' \? 'staging' : 'production'/i);
  assert.match(guardian, /Approva lavorazione/);
  assert.match(webhook, /\/nuovo_miglioria/);
  assert.match(webhook, /if \(action !== 'archive'\) \{\s*await setActiveIncident\(supabase, chatId, incidentId\);/);
  assert.match(webhook, /await setActiveIncident\(supabase, chatId, null\);\s*await sendTelegramMessage\(chatId, `\$\{incidentCode\(incident\.numero\)\} archiviato\.`\);/);
  assert.match(read('.github/codex/prompts/guardian-patch.md'), /ESITO_PATCH: MODIFICA_PREPARATA/i);
  assert.match(read('.github/codex/prompts/guardian-patch.md'), /ESITO_PATCH: GIA_PRESENTE/i);
  assert.match(read('.github/codex/prompts/guardian-patch.md'), /ESITO_PATCH: RICHIEDE_INFORMAZIONI/i);
  assert.match(read('.github/codex/prompts/guardian-patch.md'), /ESITO_PATCH: BLOCCATA/i);
});

test('il bootstrap Guardian staging rifiuta database non vuoti e limita profili al proprietario', () => {
  const bootstrap = read('database/staging/001_guardian_bootstrap.sql');

  assert.match(bootstrap, /FROM pg_catalog\.pg_tables[\s\S]*schemaname = 'public'/i);
  assert.match(bootstrap, /RAISE EXCEPTION[\s\S]*Bootstrap staging interrotto/i);
  assert.match(bootstrap, /REFERENCES auth\.users\(id\) ON DELETE CASCADE/i);
  assert.match(bootstrap, /REVOKE ALL ON TABLE public\.profili FROM PUBLIC, anon, authenticated/i);
  assert.match(bootstrap, /GRANT SELECT ON TABLE public\.profili TO authenticated/i);
  assert.match(bootstrap, /USING \(auth\.uid\(\) = id\)/i);
  assert.doesNotMatch(bootstrap, /INSERT INTO public\.profili/i);
});

test('la pagina invito imposta la password senza esporre token o richiedere password in chat', () => {
  const page = read('imposta-password.html');

  assert.match(page, /exchangeCodeForSession\(code\)/);
  assert.match(page, /verifyOtp\(\{\s*token_hash:\s*tokenHash,\s*type:\s*authType\s*\}\)/);
  assert.match(page, /setSession\(\{[\s\S]*access_token:[\s\S]*refresh_token:/);
  assert.match(page, /history\.replaceState\(\{\}, document\.title, 'imposta-password\.html'\)/);
  assert.match(page, /updateUser\(\{ password \}\)/);
  assert.match(page, /password\.length < 12/);
  assert.match(page, /autocomplete="new-password"/);
  assert.doesNotMatch(page, /innerHTML\s*=/);
});

test('la pagina Segnala Problema usa il wrapper autenticato e non accede a Supabase direttamente', () => {
  const page = read('moduli/segnala-problema.html');

  assert.match(page, /MiroxApi\.fetch\(API_URL/);
  assert.doesNotMatch(page, /db\.from\(|window\.db\.from\(/);
  assert.match(page, /Non inserire password, codici OTP/);
  assert.match(page, /data-request-type="problema"/);
  assert.match(page, /data-request-type="miglioria"/);
  assert.match(page, /request_type: requestType/);
  assert.match(page, /inviata all’amministratore\. Non devi fare altro\./);
  assert.doesNotMatch(page, /Mirko/i);
  assert.match(read('dashboard.html'), /moduli\/segnala-problema\.html\?from=\/dashboard\.html/);
});
