const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PDFDocument } = require('pdf-lib');
const {
  generateDisdettaPdf,
  validatePayload,
  VARIANTS,
  TEMPLATE_VERSION
} = require('../netlify/functions/_lib/pdf-disdetta');

const ROOT = path.resolve(__dirname, '..');

const consumerBase = {
  nome: 'Mario',
  cognome: 'Rossi',
  codice_fiscale: 'RSSMRA80A01H501U',
  documento_tipo: 'Carta d identità',
  documento_numero: 'CA1234567',
  numero_titolare: '+39 347 1234567',
  via: 'Via Roma',
  civico: '25/A',
  citta: 'Legnago',
  provincia: 'VR',
  cap: '37045',
  recapito_alternativo: '+39 348 7654321',
  utenza: '+39 347 1234567',
  motivo_recesso: 'ordinario',
  pagamento_rate: 'rateizzato',
  data: ''
};

const businessBase = {
  ...consumerBase,
  nome: 'Lucia',
  cognome: 'Bianchi',
  codice_fiscale: 'BNCLCU85C41L781P',
  ragione_sociale: 'Impresa Demo Srl',
  partita_iva: '12345678901',
  referente_nome: 'Paolo',
  referente_cognome: 'Verdi',
  motivo_recesso: 'modifiche_contrattuali'
};

function payloadFor(type) {
  const variant = VARIANTS[type];
  return {
    ...(variant.business ? businessBase : consumerBase),
    tipo: type,
    modalita_cessazione: variant.fixed ? 'cessazione_definitiva' : ''
  };
}

test('i quattro moduli generano un PDF A4 statico a pagina singola', async () => {
  for (const type of Object.keys(VARIANTS)) {
    const generated = await generateDisdettaPdf(payloadFor(type));
    const document = await PDFDocument.load(generated.buffer);
    const [page] = document.getPages();
    assert.equal(generated.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.equal(document.getPageCount(), 1);
    assert.ok(Math.abs(page.getWidth() - 595.276) < 0.1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 0.1);
    assert.equal(generated.templateVersion, TEMPLATE_VERSION);
    assert.equal(generated.data.tipo, type);
  }
});

test('solo la data è facoltativa e le scelte dipendono dal modulo', () => {
  assert.equal(validatePayload(payloadFor('sim_consumer')).data, '');
  assert.equal(
    validatePayload({ ...payloadFor('sim_consumer'), data: '2026-08-06' }).data,
    '2026-08-06'
  );
  assert.throws(
    () => validatePayload({ ...payloadFor('sim_consumer'), cognome: '' }),
    /Cognome obbligatorio/
  );
  assert.throws(
    () => validatePayload({ ...payloadFor('sim_business'), motivo_recesso: 'entro_14_giorni' }),
    /non è previsto/
  );
  assert.throws(
    () => validatePayload({ ...payloadFor('fisso_consumer'), modalita_cessazione: '' }),
    /Modalità di cessazione non valido/
  );
  assert.throws(
    () => validatePayload({ ...payloadFor('sim_consumer'), utenza: '3471234567 3481234567' }),
    /Utenza non valido/
  );
});

test('pagina, backend, template e migration espongono compilazione e storico server-only', () => {
  const page = fs.readFileSync(path.join(ROOT, 'moduli/compilatore_disdette.html'), 'utf8');
  const dashboard = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  const endpoint = fs.readFileSync(path.join(ROOT, 'netlify/functions/gestisci-disdette.js'), 'utf8');
  const migration = fs.readFileSync(path.join(ROOT, 'database/063_compilatore_disdette.sql'), 'utf8');
  const netlifyConfig = fs.readFileSync(path.join(ROOT, 'netlify.toml'), 'utf8');

  assert.match(dashboard, /href="moduli\/compilatore_disdette\.html"/);
  assert.match(page, /data-type="sim_consumer"/);
  assert.match(page, /data-type="sim_business"/);
  assert.match(page, /data-type="fisso_consumer"/);
  assert.match(page, /data-type="fisso_business"/);
  assert.match(page, /Storico disdette/);
  assert.match(page, /MiroxApi\.fetch\(ENDPOINT/);
  assert.doesNotMatch(page, /(?<!MiroxApi\.)\bfetch\(/);
  assert.match(endpoint, /requireAuth\(event\)/);
  assert.match(endpoint, /\.from\('disdette_generate'\)/);
  assert.match(endpoint, /createSignedUrl\(storagePath, 300\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.disdette_generate/i);
  assert.match(migration, /REVOKE ALL ON TABLE public\.disdette_generate FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /'disdette-files'[\s\S]*false[\s\S]*ARRAY\['application\/pdf'\]/i);
  assert.match(netlifyConfig, /included_files = \["netlify\/functions\/_templates\/disdette\/\*\.pdf"\]/);

  for (const variant of Object.values(VARIANTS)) {
    assert.equal(
      fs.existsSync(path.join(ROOT, 'netlify/functions/_templates/disdette', variant.template)),
      true
    );
  }
});
