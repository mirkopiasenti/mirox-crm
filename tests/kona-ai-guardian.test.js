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
  workApprovalKeyboard,
  _test: { intakeFallback }
} = require('../netlify/functions/_lib/kona-ai-guardian');

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
  assert.match(guardian, /Approva lavorazione/);
  assert.match(webhook, /\/nuovo_miglioria/);
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
