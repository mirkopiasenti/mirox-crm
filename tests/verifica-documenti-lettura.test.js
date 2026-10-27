'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const Docs = require('../netlify/functions/_lib/verifica-documenti');
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
