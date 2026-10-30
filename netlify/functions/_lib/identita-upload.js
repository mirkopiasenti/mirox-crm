'use strict';
const crypto = require('node:crypto');
const Core = require('../../../js/identita-upload-core');
const Docs = require('./verifica-documenti');
const Anthropic = require('@anthropic-ai/sdk').default;
const CONTEXT = 'mirox-identita-upload-v1\n';
const TTL = 4 * 60 * 60 * 1000;
const author = auth => auth?.user?.id || auth?.profilo?.id;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sign(data, secret = process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!secret) throw new Error('Controllo identita non configurato');
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(CONTEXT + body).digest('base64url');
}
function verify(token, { user, customer, now = Date.now(), secret = process.env.SUPABASE_SERVICE_ROLE_KEY } = {}) {
  try {
    if (typeof token !== 'string' || token.length > 150000 || !secret) throw new Error();
    const [body, signature, extra] = token.split('.');
    const expected = crypto.createHmac('sha256', secret).update(CONTEXT + body).digest();
    const actual = Buffer.from(signature || '', 'base64url');
    if (extra || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error();
    const data = JSON.parse(Buffer.from(body, 'base64url'));
    if (data.version !== 1 || data.user !== user || !Number.isSafeInteger(data.at) || data.at > now + 60000 || now - data.at > TTL
      || customer && !Core.sameCustomer(data.customer, customer)) throw new Error();
    return data;
  } catch { throw Object.assign(new Error('Ripeti il controllo identita: dati modificati, esito scaduto o non valido.'), { statusCode: 409 }); }
}
function approved(data) {
  return ['coerente', 'manuale'].includes(data.result?.stato);
}
function assertPractice(data, customer) {
  if (!data || data.version !== 1 || !approved(data) || !Core.sameCustomer(data.customer, customer)) {
    throw new Error('Il controllo identita non corrisponde all’anagrafica attuale. Ripetilo prima dell’invio.');
  }
}
async function analyze(files, customer, signingDate, deps = {}) {
  if (!files.length || files.length > 4) throw new Error('Carica da uno a quattro PDF del medesimo documento di riconoscimento.');
  let total = 0;
  const documents = [];
  for (const file of files) total += file.buffer.length;
  if (total > 20 * 1024 * 1024) throw new Error('I PDF identita superano complessivamente 20 MB.');
  const started = Date.now();
  const client = deps.client || (deps.extract ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 20000, maxRetries: 0 }));
  await Promise.all(files.map(async file => {
    const pages = await (deps.pdfInfo || Docs.pdfInfo)(file.buffer);
    const doc = { id: hash(file.buffer), tipo_documento: 'identita_upload', pages };
    let reading;
    try { reading = await (deps.extract || Docs.extractDocument)(doc, file.buffer, { ...deps, client }); }
    catch { reading = { id: doc.id, fields: {}, lettura_non_disponibile: true }; }
    const Barcode=require('./identita-barcode');
    reading=Barcode.apply(reading,await (deps.readBarcode || Barcode.readPdf)(file.buffer,{deadline:Math.min(deps.deadline||Infinity,Date.now()+12000)}));
    documents.push({ sha256: doc.id, pages, reading });
  }));
  documents.sort((a, b) => a.sha256.localeCompare(b.sha256));
  const taxTarget = Core.customer(customer).business ? customer.cf_rappresentante : customer.cf_piva;
  if (/^[A-Z0-9]{16}$/.test(Core.norm(taxTarget)) && !documents.some(d => d.reading.fields?.fiscale?.value)
    && Date.now() < (deps.nameRetryDeadline || started + 18000)) {
    await Promise.all(documents.map(async doc => {
      const file = files.find(f => hash(f.buffer) === doc.sha256);
      try {
        const repeated = await (deps.extract || Docs.extractDocument)({ id: doc.sha256, tipo_documento: 'identita_upload', pages: doc.pages, identity_tax_review: true }, file.buffer, { ...deps, client });
        doc.seconda_lettura_cf = repeated;
        const number = doc.reading.fields?.numero_documento?.value;
        const sameNumber = number && Core.norm(number) === Core.norm(repeated.fields?.numero_documento?.value);
        const conflicting = ['scadenza', 'tipo_identita', 'nascita'].some(key => {
          const a = doc.reading.fields?.[key]?.value, b = repeated.fields?.[key]?.value;
          return a && b && Core.norm(a) !== Core.norm(b);
        });
        if (sameNumber && !conflicting && repeated.fields?.fiscale?.value) {
          doc.reading = { ...doc.reading, fields: { ...doc.reading.fields, fiscale: repeated.fields.fiscale } };
        }
      } catch { /* CF non recuperato: resta necessaria la conferma manuale. */ }
    }));
  }
  const first = Core.evaluate(documents.map(d => d.reading), customer, signingDate);
  // Ricontrollo soltanto il nome: altri errori certi restano bloccanti. Nessun dato CRM viene fornito all'AI.
  if (first.errors.length === 1 && first.errors[0] === 'Il nome sul documento non coincide con l’anagrafica.' && Date.now() < (deps.nameRetryDeadline || started + 18000)) {
    await Promise.all(documents.map(async doc => {
      const initial = doc.reading.fields?.nome;
      if (!initial?.value || Core.name(initial.value) === Core.customer(customer).nome) return;
      const file = files.find(f => hash(f.buffer) === doc.sha256);
      try {
        const repeated = await (deps.extract || Docs.extractDocument)({ id: doc.sha256, tipo_documento: 'identita_upload', pages: doc.pages, identity_name_review: true }, file.buffer, { ...deps, client });
        const next = repeated.fields?.nome;
        const number = doc.reading.fields?.numero_documento?.value;
        const sameNumber = number && Core.norm(number) === Core.norm(repeated.fields?.numero_documento?.value);
        const conflicting = ['fiscale', 'nascita', 'scadenza', 'tipo_identita'].some(key => {
          const a = doc.reading.fields?.[key]?.value, b = repeated.fields?.[key]?.value;
          return a && b && Core.norm(a) !== Core.norm(b);
        });
        doc.seconda_lettura = repeated;
        if (sameNumber && !conflicting && next?.value && Core.name(next.value) === Core.customer(customer).nome
          && Core.evaluate([repeated], customer, signingDate).errors.length === 0) {
          doc.reading = { ...doc.reading, fields: { ...doc.reading.fields, nome: null }, ricontrollo_nome: { prima: initial, seconda: next } };
        }
      } catch { /* Un ricontrollo fallito conserva il blocco originario. */ }
    }));
  }
  return { documents, result: Core.evaluate(documents.map(d => d.reading), customer, signingDate) };
}
function confirm(data, input) {
  if (data.result.stato === 'da_correggere') throw new Error('Correggi i dati o sostituisci il documento prima di procedere.');
  const manual = data.result.stato === 'da_confermare';
  const group = data.result.cittadinanza || input.cittadinanza;
  if (!['ue', 'extra_ue', null, undefined].includes(group)) throw new Error('Cittadinanza non valida.');
  const reason = String(input.motivo || '').trim();
  if ((manual || !data.result.cittadinanza) && reason.length < 10) throw new Error('Descrivi il controllo manuale effettuato (almeno 10 caratteri).');
  const expiry = data.result.scadenza || require('../../../js/verifica-contratti-core').date(input.scadenza);
  if (!expiry || expiry < data.result.data_firma) throw new Error('Indica una scadenza verificata e valida alla data di firma.');
  const tax = data.result.cf_da_confermare ? Core.norm(input.codice_fiscale_verificato) : null;
  const expectedTax = Core.customer(data.customer).business ? data.business_identity?.cf_rappresentante : data.customer?.cf_piva;
  if (data.result.cf_da_confermare && (!/^[A-Z0-9]{16}$/.test(tax) || tax !== Core.norm(expectedTax))) throw new Error('Il codice fiscale verificato manualmente deve coincidere con quello atteso. Rileggi il documento e l’anagrafica.');
  return { ...data, result: { ...data.result, stato: manual ? 'manuale' : 'coerente', cf_da_confermare: false, cittadinanza: group || null, scadenza: expiry },
    conferma: { at: new Date().toISOString(), user: data.user, motivo: reason.slice(0, 1000), manuale: manual || !data.result.cittadinanza,
      ...(tax ? { codice_fiscale_verificato: tax } : {}) } };
}
function confirmPreview(data, input) {
  const needsConfirmation = ['da_correggere', 'da_confermare'].includes(data.result?.stato)
    || data.result?.stato === 'coerente' && !data.result.cittadinanza;
  if (!needsConfirmation || !data.documents?.length) throw new Error('La conferma con anteprima richiede un controllo automatico non concluso. Ripeti il controllo.');
  const expected = [...new Set(data.documents.map(d => d.sha256))].sort();
  const viewed = Array.isArray(input.preview_sha256) ? [...new Set(input.preview_sha256)].sort() : [];
  if (input.preview_visualizzata !== true || JSON.stringify(viewed) !== JSON.stringify(expected)) throw new Error('Visualizza tutti i PDF del documento prima di confermare.');
  const Verification = require('../../../js/verifica-contratti-core');
  const signed = Verification.date(data.result.data_firma), expiry = Verification.date(input.scadenza);
  if (!signed || signed > Verification.romeDay(new Date())) throw new Error('Indica una data effettiva di firma valida.');
  if (!expiry || expiry < signed) throw new Error('Indica la scadenza verificata sul documento, valida alla data di firma.');
  const group = input.cittadinanza || data.result.cittadinanza || null;
  if (![null, 'ue', 'extra_ue'].includes(group)) throw new Error('Cittadinanza non valida.');
  return { ...data, esito_automatico: data.result,
    result: { ...data.result, stato: 'manuale', errors: [], uncertain: [], scadenza: expiry, cittadinanza: group,
      criterio_identita: 'conferma_preview', cf_da_confermare: false },
    conferma: { at: new Date().toISOString(), user: data.user, manuale: true, modalita: 'preview_manuale',
      preview_visualizzata: true, preview_sha256: expected,
      motivo: 'Operatore conferma che il documento visualizzato appartiene al cliente in anagrafica e ne verifica la validita alla firma.' } };
}
module.exports = { Core, author, hash, sign, verify, approved, assertPractice, analyze, confirm, confirmPreview };
