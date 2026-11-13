'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const Core = require('../../../js/malpractis-core');
const TEMPLATE = 'modulo-malpractice-ask.pdf';
// Centri dei 17 separatori del campo CF/P.IVA nel modello originale ASK.
const FISCAL_SEPARATORS = [121.4403, 133.6413, 145.8416, 158.0419, 170.2429,
  182.4439, 194.6449, 206.8459, 219.0469, 231.2479, 243.4489, 255.6499,
  267.8509, 280.0519, 292.2529, 304.4539, 316.6549];
function templatePath() {
  for (const directory of [path.join(__dirname, '_templates/malpractis'), path.join(__dirname, '../_templates/malpractis'), path.join(process.cwd(), 'netlify/functions/_templates/malpractis')]) {
    const file = path.join(directory, TEMPLATE);
    if (fs.existsSync(file)) return file;
  }
  throw new Error('Modello Malpractis non disponibile');
}
function wrap(font, value, width, size) {
  const lines = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ').filter(Boolean)) {
      if (font.widthOfTextAtSize(word, size) > width) throw new Error('Descrizione: parola troppo lunga per il modulo');
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) line = next;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}
async function generateMalpractisPdf(payload) {
  const data = Core.validate(payload);
  const doc = await PDFDocument.load(fs.readFileSync(templatePath()));
  const page = doc.getPages()[0];
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const height = page.getHeight();
  // Coordinate dal bordo superiore: non coprire testo, righe o firma originali.
  function draw(value, x, baseline, width, size = 9, face = font) {
    if (!value) return;
    while (size > 7 && face.widthOfTextAtSize(value, size) > width) size = Math.max(7, size - .25);
    if (face.widthOfTextAtSize(value, size) > width) throw new Error('Testo troppo lungo per lo spazio disponibile nel PDF: riduci il campo');
    page.drawText(value, { x, y: height - baseline, size, font: face });
  }
  function check(x, top) { draw('X', x - 2.5, top + 1, 7, 8, bold); }
  draw(Core.dealer.codice, 397, 48, 150, 10, bold);
  draw(Core.dealer.ragione_sociale, 397, 64, 150, 10, bold);
  check(46.5, data.tipo_segnalazione === 'sollecito' ? 178 : 190);
  // Le 16 celle prestampate iniziano dopo l'etichetta CF/P.IVA.
  [...data.cf_piva].forEach((c, i) => {
    const center = (FISCAL_SEPARATORS[i] + FISCAL_SEPARATORS[i + 1]) / 2;
    draw(c, center - bold.widthOfTextAtSize(c, 8) / 2, 228.4, 8, 8, bold);
  });
  draw(data.codice_contratto, 381, 228.4, 54, 8);
  draw(data.codice_cliente, 484, 228.4, 66, 8);
  draw(data.intestatario, 173, 241, 377);
  check(({ ci: 128, patente: 153.8, passaporto: 186, altro: 230 })[data.documento_tipo], 251.8);
  draw(data.documento_numero, 365, 254, 185);
  draw(data.numero_fisso, 129, 267, 160);
  draw(data.cellulare, 363, 267, 187);
  draw(data.email, 78, 280, 472);
  check(data.stato_linea === 'nuova' ? 52.5 : 305.5, 294.2);
  for (const r of Core.reasons) if (data.motivi[r.key] === 'si') check(r.x, r.top);
  if (data.open_fiber === 'si') check(50.5, 486.8);
  if (data.tim_prima === 'si') check(305.5, 470.7);
  if (data.tim_seconda === 'si') check(305.5, 486.8);
  draw(({ si: 'SI', no: 'NO', non_so: 'NON NOTO' })[data.conoscenza_cliente], 485, 504.1, 63, 8, bold);
  let size = 9, lines;
  do {
    lines = wrap(font, data.descrizione, 500, size);
    if (lines.length * (size + 2) <= 44) break;
    size -= .25;
  } while (size >= 7);
  if (size < 7) throw new Error('Descrizione troppo lunga per il modulo: riduci il testo');
  lines.forEach((line, i) => draw(line, 47, 530 + i * (size + 2), 500, size));
  const format = value => {
    const [date, time] = value.split('T');
    return `${date.split('-').reverse().join('/')}${time ? ` - ${time}` : ''}`;
  };
  draw(data.primo_appuntamento ? format(data.primo_appuntamento) : '', 305, 593.2, 240);
  draw(data.nuovo_appuntamento ? format(data.nuovo_appuntamento) : '', 305, 607.4, 240);
  draw(format(data.data), 72, 735.5, 170);
  doc.setTitle('Segnalazione Malpractis WINDTRE');
  doc.setCreator('Mirox CRM');
  return { buffer: Buffer.from(await doc.save({ useObjectStreams: false })), data };
}
module.exports = { generateMalpractisPdf, templatePath, wrap };
