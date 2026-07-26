const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function htmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'tmp') return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? htmlFiles(absolute) : (absolute.endsWith('.html') ? [absolute] : []);
  });
}

function loadMiroxSafe() {
  const window = {
    location: { origin: 'https://www.mirox-crm.it' }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(ROOT, 'js/mirox-safe.js'), 'utf8'),
    { window, URL }
  );
  return window.MiroxSafe;
}

test('MiroxSafe codifica HTML e rifiuta URL, colori e ID pericolosi', () => {
  const safe = loadMiroxSafe();

  assert.equal(
    safe.escapeHtml(`<img src=x onerror="bad()">'&`),
    '&lt;img src=x onerror=&quot;bad()&quot;&gt;&#039;&amp;'
  );
  assert.equal(safe.safeUrl('javascript:alert(1)'), '');
  assert.equal(safe.safeUrl('data:text/html,bad'), '');
  assert.equal(safe.safeUrl('//evil.example/path'), '');
  assert.equal(safe.safeUrl('/moduli/dashboard.html'), '/moduli/dashboard.html');
  assert.equal(safe.safeUrl('https://example.com/a').startsWith('https://example.com/a'), true);
  assert.equal(safe.isRecordId('42'), true);
  assert.equal(safe.isRecordId('42);alert(1)'), false);
  assert.equal(safe.isUuid('11111111-1111-4111-8111-111111111111'), true);
  assert.equal(safe.safeCssColor('red', '#000000'), '#000000');
});

test('tutte le pagine caricano MiroxSafe e gli script CDN sono pinning + SRI', () => {
  const missingSafe = [];
  const insecureScripts = [];

  for (const file of htmlFiles(ROOT)) {
    const html = fs.readFileSync(file, 'utf8');
    if (!html.includes('mirox-safe.js')) missingSafe.push(path.relative(ROOT, file));

    for (const match of html.matchAll(/<script\b([^>]*\bsrc=["']https:\/\/[^"']+["'][^>]*)>/gi)) {
      const attributes = match[1];
      if (!/\bintegrity=["']sha384-[^"']+["']/i.test(attributes)
          || !/\bcrossorigin=["']anonymous["']/i.test(attributes)) {
        insecureScripts.push(`${path.relative(ROOT, file)}: ${match[0]}`);
      }
    }
  }

  assert.deepEqual(missingSafe, []);
  assert.deepEqual(insecureScripts, []);
});

test('Netlify applica gli header di sicurezza principali', () => {
  const config = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /Permissions-Policy/);
  assert.match(config, /frame-ancestors 'self'/);
  assert.match(config, /object-src 'none'/);
});

test('prenotazione pubblica valida data, motivo e input prima della RPC atomica', () => {
  const publicBooking = require('../netlify/functions/public-prenota')._test;

  assert.equal(publicBooking.isIsoDate('2026-07-26'), true);
  assert.equal(publicBooking.isIsoDate('26/07/2026'), false);
  assert.equal(publicBooking.isSafePublicDateTime('2026-07-27T10:30:00+02:00'), true);
  assert.equal(publicBooking.isSafePublicDateTime('2026-07-27T10:30:00'), false);
  assert.equal(publicBooking.isAllowedMotivo('Telefonia Mobile'), true);
  assert.equal(publicBooking.isAllowedMotivo('<img onerror=bad()>'), false);
  assert.equal(publicBooking.cleanString('  Mario  ', 100), 'Mario');
});

test('migration 055 applica 24 mesi, lock atomico e privilegi minimi', () => {
  const migration = fs.readFileSync(
    path.join(ROOT, 'database/055_privacy_24_mesi_prenotazioni_atomiche.sql'),
    'utf8'
  );

  assert.match(migration, /interval '24 months'/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /unnest\(public\.get_slot_disponibili\(v_giorno\)\)/i);
  assert.match(migration, /revoke all on function public\.public_prenota_appuntamento_v1/i);
  assert.match(migration, /grant execute on function public\.public_prenota_appuntamento_v1[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function\s+public\.get_slot_disponibili/i);
});

test('informativa privacy CRM v3 genera PDF OTP e cartaceo a tre pagine', async () => {
  const {
    generateConsensoPdf,
    INFORMATIVA_VERSIONE
  } = require('../netlify/functions/_lib/pdf-consenso');
  const base = {
    anagrafica: {
      ragione_sociale: 'Cliente di prova',
      cf_piva: 'RSSMRA80A01H501U',
      cluster: 'Consumer',
      via: 'Via Roma',
      civico: '1',
      comune: 'Legnago',
      provincia: 'VR',
      email: 'cliente@example.com',
      cellulare: '+391234567890'
    },
    consensoMarketing: true,
    dataCompilazione: '2026-07-26T12:00:00+02:00'
  };

  const otp = await generateConsensoPdf({
    ...base,
    modalita: 'otp_sms',
    otpMetadata: {
      cellulareInviato: '+391234567890',
      confermatoAt: '2026-07-26T12:00:00+02:00',
      smsProviderId: 'test-sms',
      ipOperatore: '192.0.2.1',
      operatoreNome: 'Operatore Test',
      consensoId: '11111111-1111-4111-8111-111111111111'
    }
  });
  const paper = await generateConsensoPdf({ ...base, modalita: 'cartaceo' });

  for (const generated of [otp, paper]) {
    assert.equal(generated.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.match(generated.hash, /^[0-9a-f]{64}$/);
    assert.equal((generated.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 3);
  }
  assert.equal(INFORMATIVA_VERSIONE, 'v3_2026_07_26');
});

test('informativa v3 limita il perimetro al CRM e richiede la versione corrente per il riuso', () => {
  const pdfSource = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/_lib/pdf-consenso.js'),
    'utf8'
  );
  const checkSource = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/check-consenso-privacy.js'),
    'utf8'
  );
  const cartSource = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/crea-vendita-pratica-carrello.js'),
    'utf8'
  );

  assert.match(pdfSource, /sistema gestionale di proprietà e sotto la gestione/);
  assert.match(pdfSource, /Non disciplina il contratto stipulato con Wind Tre/);
  assert.match(pdfSource, /chiamata telefonica con operatore, messaggio WhatsApp o email/);
  assert.match(pdfSource, /Questi contatti di servizio non dipendono dal consenso marketing/);
  assert.doesNotMatch(pdfSource, /comunicazioni commerciali via SMS/);
  assert.match(checkSource, /\.eq\('informativa_versione', INFORMATIVA_VERSIONE\)/);
  assert.match(cartSource, /\.eq\('informativa_versione', INFORMATIVA_VERSIONE\)/);
});
