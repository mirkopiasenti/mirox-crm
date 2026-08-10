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

test('Netlify pubblica solo la build statica e applica gli header di sicurezza principali', () => {
  const config = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');
  const buildScript = fs.readFileSync(path.join(ROOT, 'scripts/build-static.js'), 'utf8');
  const generatedHeaders = fs.readFileSync(path.join(ROOT, 'dist/_headers'), 'utf8');

  assert.match(config, /command\s*=\s*"npm run build"/);
  assert.match(config, /publish\s*=\s*"dist"/);
  assert.doesNotMatch(config, /publish\s*=\s*"\."/);
  assert.match(generatedHeaders, /Content-Security-Policy/);
  assert.match(config, /Strict-Transport-Security/);
  assert.match(config, /Permissions-Policy/);
  assert.match(generatedHeaders, /frame-ancestors 'self'/);
  assert.match(generatedHeaders, /object-src 'none'/);
  assert.match(generatedHeaders, /https:\/\/lbgwamhjkjjfwgusafbi\.supabase\.co/);
  assert.match(buildScript, /PUBLIC_DIRECTORIES = \['assets', 'css', 'js', 'moduli'\]/);

  for (const publicPath of [
    'index.html',
    'dashboard.html',
    'assets',
    'css',
    'js',
    'moduli'
  ]) {
    assert.equal(
      fs.existsSync(path.join(ROOT, 'dist', publicPath)),
      true,
      `${publicPath} deve essere incluso nella build`
    );
  }

  for (const privatePath of [
    'database',
    'docs',
    'netlify',
    'scripts',
    'tests',
    'AGENTS.md',
    'CLAUDE.md',
    'README.md',
    'netlify.toml',
    'package.json',
    'package-lock.json'
  ]) {
    assert.equal(
      fs.existsSync(path.join(ROOT, 'dist', privatePath)),
      false,
      `${privatePath} non deve essere pubblicato`
    );
  }
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

test('informative privacy CRM v6 generano cartaceo su una pagina e digitale su tre pagine', async () => {
  const {
    generateConsensoPdf,
    INFORMATIVA_VERSIONE_CARTACEO,
    INFORMATIVA_VERSIONE_DIGITALE
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
  const paperYes = await generateConsensoPdf({ ...base, modalita: 'cartaceo' });
  const paperNo = await generateConsensoPdf({
    ...base,
    modalita: 'cartaceo',
    consensoMarketing: false
  });

  assert.equal(otp.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(paperYes.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.equal(paperNo.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.match(otp.hash, /^[0-9a-f]{64}$/);
  assert.match(paperYes.hash, /^[0-9a-f]{64}$/);
  assert.match(paperNo.hash, /^[0-9a-f]{64}$/);
  assert.equal((otp.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 3);
  assert.equal((paperYes.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
  assert.equal((paperNo.buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1);
  assert.equal(otp.informativaVersione, INFORMATIVA_VERSIONE_DIGITALE);
  assert.equal(paperYes.informativaVersione, INFORMATIVA_VERSIONE_CARTACEO);
  assert.equal(paperNo.informativaVersione, INFORMATIVA_VERSIONE_CARTACEO);
  assert.equal(INFORMATIVA_VERSIONE_CARTACEO, 'v6_2026_07_26');
  assert.equal(INFORMATIVA_VERSIONE_DIGITALE, 'v6_2026_07_26_dig');
  await assert.rejects(
    generateConsensoPdf({
      ...base,
      modalita: 'cartaceo',
      consensoMarketing: undefined
    }),
    /ACCONSENTO\/NON ACCONSENTO/
  );
});

test('informative v6 usano la ragione sociale esatta e rendono visibile la scelta marketing', () => {
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
  const paperEndpointSource = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/genera-pdf-consenso-cartaceo.js'),
    'utf8'
  );
  const otpRequestSource = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/richiedi-otp-privacy.js'),
    'utf8'
  );
  const wizardSource = fs.readFileSync(
    path.join(ROOT, 'moduli/upload-contratti-vendita.html'),
    'utf8'
  );

  assert.match(pdfSource, /const PAPER_BODY_FONT_SIZE = 10;/);
  assert.match(pdfSource, /const PAPER_MARGIN = 34;/);
  assert.match(pdfSource, /ragioneSociale: 'KONA TECH SRL'/);
  assert.match(pdfSource, /CONSENSO AI RICONTATTI — KONA TECH SRL/);
  assert.doesNotMatch(pdfSource, /KONA TECH S\.r\.l\./);
  assert.doesNotMatch(pdfSource, /Kona Tech/);
  assert.match(pdfSource, /\[X\] ACCONSENTO      \[ \] NON ACCONSENTO/);
  assert.match(pdfSource, /\[ \] ACCONSENTO      \[X\] NON ACCONSENTO/);
  assert.match(pdfSource, /Firma leggibile dell\\'interessato: ____________________/);
  assert.match(pdfSource, /Versione \$\{INFORMATIVA_VERSIONE_CARTACEO\}/);
  assert.doesNotMatch(pdfSource, /Qualora venga designato/);
  assert.match(pdfSource, /Non riguarda i trattamenti svolti dal fornitore presso il quale la pratica è richiesta/);
  assert.match(pdfSource, /nominati responsabili del trattamento ai sensi dell\\'art\. 28 GDPR ove trattino dati per conto del Titolare/);
  assert.match(pdfSource, /codice OTP di 6 cifre inviato via SMS/);
  assert.match(pdfSource, /esito e tentativi dell\\'OTP, indirizzo IP, user agent e hash SHA-256 del documento/);
  assert.match(pdfSource, /Scelta marketing:\s+' \+ \(consensoMarketing \? 'ACCONSENTO' : 'NON ACCONSENTO'\)/);
  assert.match(paperEndpointSource, /consenso_marketing=true\|false/);
  assert.match(paperEndpointSource, /consensoMarketingRaw !== 'true' && consensoMarketingRaw !== 'false'/);
  assert.match(otpRequestSource, /typeof payload\.consenso_marketing !== 'boolean'/);
  assert.match(wizardSource, /name="cpOtpMarketing" value="true"/);
  assert.match(wizardSource, /name="cpOtpMarketing" value="false"/);
  assert.match(wizardSource, /id="cpOtpSend" disabled/);
  assert.match(wizardSource, /id="cpCartDownload" disabled/);
  assert.match(wizardSource, /&consenso_marketing=' \+ \(consensoMarketing \? 'true' : 'false'\)/);
  assert.match(checkSource, /\.in\('informativa_versione', INFORMATIVE_VERSIONI_CORRENTI\)/);
  assert.match(cartSource, /\.in\('informativa_versione', INFORMATIVE_VERSIONI_CORRENTI\)/);
});

test('Storico Cliente legge esito e modulo privacy tramite la function autenticata', () => {
  const storicoSource = fs.readFileSync(
    path.join(ROOT, 'moduli/storico_cliente.html'),
    'utf8'
  );
  const checkSource = fs.readFileSync(
    path.join(ROOT, 'netlify/functions/check-consenso-privacy.js'),
    'utf8'
  );

  assert.match(storicoSource, /id="privacyDownloadButton"/);
  assert.match(storicoSource, /MiroxApi\.fetch\(\s*'\/\.netlify\/functions\/check-consenso-privacy/);
  assert.match(storicoSource, /include_history=true/);
  assert.match(storicoSource, /MiroxStorage\.signedUrl\(\s*'consensi-privacy'/);
  assert.doesNotMatch(storicoSource, /\.select\('stato, valido_fino_al, revocato_at, confermato_at'\)/);
  assert.match(checkSource, /esito: deriveEsito\(consensoValido, ultimoConsenso\)/);
  assert.match(checkSource, /documento: documentoSerializzato/);
  assert.match(checkSource, /\.not\('pdf_storage_path', 'is', null\)/);
  assert.match(checkSource, /if \(!includeHistory\)/);
});

test('esito privacy distingue validità, revoca, rinnovo e tentativi OTP', () => {
  const { deriveEsito } = require(
    path.join(ROOT, 'netlify/functions/check-consenso-privacy.js')
  )._test;
  const base = {
    created_at: '2026-07-28T08:00:00.000Z',
    otp_confermato_at: '2026-07-28T08:10:00.000Z',
    valido_fino_al: '2028-07-28T08:10:00.000Z',
    informativa_versione: 'v6_2026_07_26',
    stato: 'confermato'
  };

  assert.equal(deriveEsito(base, base).codice, 'valido');
  assert.equal(deriveEsito(null, null).codice, 'non_firmato');
  assert.equal(deriveEsito(null, { ...base, revocato_at: '2026-07-29T09:00:00.000Z' }).codice, 'revocato');
  assert.equal(deriveEsito(null, { ...base, informativa_versione: 'v5_storica' }).codice, 'da_rinnovare');
  assert.equal(deriveEsito(null, base).codice, 'scaduto');
  assert.equal(deriveEsito(null, { ...base, stato: 'pending', otp_scade_at: '2099-01-01T00:00:00.000Z' }).codice, 'in_attesa');
  assert.equal(deriveEsito(null, { ...base, stato: 'pending', otp_scade_at: '2020-01-01T00:00:00.000Z' }).codice, 'scaduto');
  assert.equal(deriveEsito(null, { ...base, stato: 'fallito' }).codice, 'fallito');
});

test('il Call Center crea le anagrafiche con la RPC idempotente condivisa', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'moduli/call-center/registra-chiamata.html'),
    'utf8'
  );

  assert.match(source, /src="\.\.\/\.\.\/js\/anagrafica-helper\.js"/);
  assert.match(source, /window\.AnagraficaHelper\.cercaOcrea\(\{/);
  assert.match(source, /window\.AnagraficaHelper\.cerca\(cfpiva\)/);
  assert.doesNotMatch(
    source,
    /\.from\(['"]anagrafica['"]\)\s*\.insert\(/
  );
});

test('Segnalazioni valida i link Drive legacy e codifica la cronologia note', () => {
  const source = fs.readFileSync(
    path.join(ROOT, 'moduli/segnalazioni.html'),
    'utf8'
  );

  assert.match(source, /const legacyDriveHtml=driveLink\(r\.link_cartella_drive\)/);
  assert.match(source, /\$\{fHtml\}\$\{legacyDriveHtml\}/);
  assert.match(source, /\$\{esc\(m&&m\.timestamp\)\}/);
  assert.match(source, /\$\{esc\(m&&m\.message\)\}/);
  assert.doesNotMatch(source, /href="\$\{r\.link_cartella_drive\}"/);
});
