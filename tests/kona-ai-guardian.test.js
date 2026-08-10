'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const { cleanText, incidentCode } = require('../netlify/functions/_lib/kona-ai-guardian');

test('codici incidente e testo Guardian sono normalizzati in modo deterministico', () => {
  assert.equal(incidentCode(42), 'KG-000042');
  assert.equal(cleanText('  prova\n\tproblema\u0000  ', 20), 'prova problema');
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
  const migration = read('database/065_kona_ai_guardian.sql');

  assert.match(incidents, /requireAuth\(event\)/);
  assert.match(incidents, /profileId\(auth\)/);
  assert.match(webhook, /x-telegram-bot-api-secret-token/i);
  assert.match(webhook, /TELEGRAM_GUARDIAN_OWNER_CHAT_ID/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.kona_ai_incidenti FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /dettagli_tecnici_scadono_at/);
});

test('la pagina Segnala Problema usa il wrapper autenticato e non accede a Supabase direttamente', () => {
  const page = read('moduli/segnala-problema.html');

  assert.match(page, /MiroxApi\.fetch\(API_URL/);
  assert.doesNotMatch(page, /db\.from\(|window\.db\.from\(/);
  assert.match(page, /Non inserire password, codici OTP/);
  assert.match(read('dashboard.html'), /moduli\/segnala-problema\.html\?from=\/dashboard\.html/);
});
