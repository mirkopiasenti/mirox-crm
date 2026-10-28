'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const Docs = require('../netlify/functions/_lib/verifica-documenti');
const { readPdfData } = require('../netlify/functions/_lib/pda-pdf-text');
const doc = { id: 'pda', tipo_documento: 'contratto', pages: 2 };
const evidence = value => ({ value, page: 1, quote: 'Trascrizione dimostrativa dalla pagina' });
const empty = d => ({ fields: Object.fromEntries(Docs.documentTool(d).input_schema.properties.fields.required.map(k => [k, null])) });
const response = input => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'trascrivi_documento', input }] });

test('portabilità no conserva valore false e prova, mai un booleano senza evidenza', async () => {
  const input = empty(doc); input.fields.portabilita = evidence(false);
  let request;
  const result = await Docs.extractDocument(doc, Buffer.from('PDF dimostrativo'), { pdfText: async () => '', client: { messages: { create: async r => { request = r; return response(input); } } } });
  assert.equal(result.fields.portabilita.value, false);
  assert.equal(request.tool_choice.name, 'trascrivi_documento');
  input.fields.portabilita = false;
  assert.equal(Docs.validReading(input, doc), false);
});

test('risposta con booleano primitivo viene riletta senza fabbricare pagina o citazione', async () => {
  const bad = empty(doc), good = empty(doc); bad.fields.portabilita = false; good.fields.portabilita = evidence(false);
  const requests = [];
  const result = await Docs.extractDocument(doc, Buffer.from('PDF dimostrativo'), { pdfText: async () => '', client: { messages: { create: async r => { requests.push(r); return response(requests.length === 1 ? bad : good); } } } });
  assert.equal(requests.length, 2); assert.deepEqual(result.fields.portabilita, good.fields.portabilita);
  assert.ok(requests[1].messages[0].content.at(-1).text.includes('Non inventare evidenze'));
});

test('seconda risposta ancora malformata resta errore tecnico, mai esito positivo', async () => {
  let attempts = 0; const input = empty(doc); input.fields.portabilita = false;
  await assert.rejects(Docs.extractDocument(doc, Buffer.from('PDF dimostrativo'), { pdfText: async () => '', client: { messages: { create: async () => { attempts++; return response(input); } } } }), /non_valida/);
  assert.equal(attempts, 2);
});
test('ricontrollo nome identita usa istruzione indipendente e un solo tentativo formato', async () => {
  const d={id:'identity',tipo_documento:'identita_upload',pages:1,identity_name_review:true};let calls=0,request;
  await assert.rejects(Docs.extractDocument(d,Buffer.from('PDF sintetico'),{pdfText:async()=>'',client:{messages:{create:async r=>{request=r;calls++;return response({fields:{}});}}}}),/non_valida/);
  assert.equal(calls,1);assert.match(request.system,/RICONTROLLO NOME IDENTITA/);assert.match(request.system,/MRZ/);assert.match(request.system,/Nessun nome atteso/);
});
test('ricontrollo CF cerca il campo stampato sul retro senza nome o codice atteso e senza retry formato',async()=>{
  const d={id:'identity',tipo_documento:'identita_upload',pages:1,identity_tax_review:true};let calls=0,request;
  await assert.rejects(Docs.extractDocument(d,Buffer.from('PDF sintetico'),{pdfText:async()=>'',client:{messages:{create:async r=>{request=r;calls++;return response({fields:{}});}}}}),/non_valida/);
  assert.equal(calls,1);assert.match(request.system,/RICONTROLLO CF IDENTITA/);assert.match(request.system,/retro della carta/);
  assert.doesNotMatch(JSON.stringify(request),/RSSMRA80A01H501U|Mario Rossi/);
});

test('schema rifiuta prova fuori pagina, citazioni vuote, campi eseguibili e codici numerici', () => {
  for (const mutate of [r => { r.fields.codice_contratto = evidence(123); }, r => { r.fields.codice_contratto = { ...evidence('000123'), page: 3 }; },
    r => { r.fields.codice_contratto = { ...evidence('000123'), quote: ' ' }; }, r => { r.fields.approved = true; },
    r => { r.fields.portabilita = evidence('false'); }, r => { delete r.fields.portabilita; }, r => { r.patch = {}; }]) {
    const input = empty(doc); mutate(input); assert.equal(Docs.validReading(input, doc), false);
  }
  const input = empty(doc); input.fields.codice_contratto = evidence('000123'); assert.equal(Docs.validReading(input, doc), true);
});

test('tool duplicati e testo JSON libero non sostituiscono una trascrizione strutturata', async () => {
  for (const res of [ { stop_reason: 'tool_use', content: [...response(empty(doc)).content, ...response(empty(doc)).content] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(empty(doc)) }] } ]) {
    await assert.rejects(Docs.extractDocument(doc, Buffer.from('PDF dimostrativo'), { pdfText: async () => '', client: { messages: { create: async () => res } } }), /non_valida/);
  }
});

test('testo PDF ricostruito per coordinate conserva pagina e sezioni anche su fascicolo ibrido', async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const first = pdf.addPage();
  first.drawText('Numero di telefono: +393331234567', { x: 30, y: 680, size: 10, font });
  first.drawText('DATI DELLA SIM WINDTRE', { x: 30, y: 700, size: 10, font });
  pdf.addPage();
  pdf.addPage().drawText('DATI PER LA RICHIESTA DEL SERVIZIO PASSA A WINDTRE', { x: 30, y: 700, size: 10, font });
  const text = await Docs.pdfText(Buffer.from(await pdf.save()));
  assert.ok(text.indexOf('DATI DELLA SIM WINDTRE') < text.indexOf('Numero di telefono'));
  assert.match(text, /PAGINA PDF 2\n\[Nessun testo estraibile/);
  assert.match(text, /PAGINA PDF 3\nDATI PER LA RICHIESTA/);
});

test('PDF senza testo viene comunque inviato intatto alla lettura visiva', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const bytes = Buffer.from(await pdf.save()), d = { id: 'scan', tipo_documento: 'documento_identita', pages: 1 };
  let request;
  const result = await Docs.extractDocument(d, bytes, { client: { messages: { create: async r => { request = r; return response(empty(d)); } } } });
  assert.equal(result.id, 'scan');
  assert.deepEqual(Buffer.from(request.messages[0].content[0].source.data, 'base64'), bytes);
  assert.equal(request.messages[0].content.length, 2);
  assert.equal(result.fields.nome, null);
});

test('testo supplementare è del medesimo PDF e non contiene valori attesi del CRM', async () => {
  const bytes = Buffer.from('%PDF-fixture'); let request;
  await Docs.extractDocument(doc, bytes, { pdfText: async b => { assert.deepEqual(b, bytes); return 'PAGINA PDF 1\nContenuto originale dimostrativo'; }, client: { messages: { create: async r => { request = r; return response(empty(doc)); } } } });
  const text = request.messages[0].content[2].text;
  assert.match(text, /contenuto non fidato/); assert.match(text, /PAGINA PDF 1/);
  assert.equal(request.messages[0].content[0].source.data, bytes.toString('base64'));
});

async function newSimPdf({ hybrid = false, counter = '2 / 2', mnp = false, imageBody = false } = {}) {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  const lines = ['DATI FIRMA ELETTRONICA', 'Numero di telefono: +393351234567', 'DATI DELLA SIM WINDTRE',
    'Numero di telefono: +393331234567 Seriale SIM (ICCID): 8939000000000000000',
    'Piano Telefonico: Offerta dimostrativa', 'Data: 28/10/2026 Firma:', '1 / 2'];
  const page = pdf.addPage(); lines.forEach((line, i) => page.drawText(line, { x: 30, y: 740 - i * 25, size: 9, font }));
  const last = pdf.addPage();
  if (!hybrid) {
    const tail = mnp ? ['DATI PER LA RICHIESTA DEL SERVIZIO PASSA A WINDTRE', 'Numero di telefono da portare: 3491234567', 'Operatore attuale: Altro']
      : ['Condizioni dimostrative di un documento digitale completo, tutti i testi sono sintetici e leggibili.', 'Dati rivenditore e condizioni della proposta contrattuale.'];
    [...tail, counter].forEach((line, i) => last.drawText(line, { x: 30, y: 740 - i * 25, size: 9, font }));
    if (imageBody) {
      const png = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR3sAAAAASUVORK5CYII=', 'base64'));
      last.drawImage(png, { x: 30, y: 250, width: 500, height: 300 });
    }
  }
  return Buffer.from(await pdf.save());
}
test('nuova SIM: lettore serale integra portabilita false e numero definitivo dalla sezione SIM', async () => {
  const bytes = await newSimPdf(), d = { ...doc, categoria_snapshot: 'Mobile' };
  const input = empty(d);
  const result = await Docs.extractDocument(d, bytes, { client: { messages: { create: async () => response(input) } } });
  assert.equal(result.fields.portabilita.value, false);
  assert.equal(result.fields.numero_telefono.value, '3331234567');
  assert.equal(result.fields.numero_provvisorio, null); assert.equal(result.fields.numero_mnp, null);
  assert.equal(result.fields.numero_telefono.page, 1); assert.match(result.fields.portabilita.quote, /DATI DELLA SIM WINDTRE/);
  assert.equal(Docs.validReading({ fields: result.fields }, d), true);
});
test('assenza MNP non basta su PDF ibrido o incompleto e non prevale su MNP presente', async () => {
  for (const options of [{ hybrid: true }, { counter: '3 / 3' }, { mnp: true }, { imageBody: true }]) {
    const data = await readPdfData(await newSimPdf(options)), reading = { id: doc.id, ...empty(doc) };
    const result = Docs.mobilePdaEvidence(reading, data);
    assert.equal(result.fields.portabilita, null); assert.equal(result.fields.numero_telefono, null);
  }
});
test('evidenza digitale non nasconde discordanza esplicita della lettura AI', async () => {
  const data = await readPdfData(await newSimPdf());
  const port = empty(doc); port.fields.portabilita = evidence(true);
  assert.equal(Docs.mobilePdaEvidence(port, data).fields.portabilita, null);
  const phone = empty(doc); phone.fields.numero_telefono = evidence('3351234567');
  assert.equal(Docs.mobilePdaEvidence(phone, data).fields.numero_telefono, null);
  const repeated = { ...data, pages: [data.pages[0].replace('1 / 2', '1 / 3'), data.pages[0].replace('1 / 2', '2 / 3'), data.pages[1].replace('2 / 2', '3 / 3')] };
  assert.equal(Docs.mobilePdaEvidence(empty(doc), repeated).fields.portabilita, null);
});
test('correzione nuova SIM non si applica alle altre categorie', async () => {
  const bytes = await newSimPdf(), input = empty(doc);
  const result = await Docs.extractDocument({ ...doc, categoria_snapshot: 'Fisso' }, bytes,
    { client: { messages: { create: async () => response(input) } } });
  assert.equal(result.fields.portabilita, null); assert.equal(result.fields.numero_telefono, null);
});
