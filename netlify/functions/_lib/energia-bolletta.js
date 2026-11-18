'use strict';

const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { getDocumentProxy, renderPageAsImage } = require('unpdf');
const { layoutText } = require('./pda-pdf-text');
const { code, tax } = require('./energia-csv');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;
const OCR_PAGES = 3;
const PDF_OPTIONS = { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, verbosity: 0 };
const KNOWN_SELLERS = /^(Enel Energia|Eni Plenitude|Plenitude|Servizio Elettrico Nazionale|A2A Energia|Hera Comm|Iren Mercato|Edison Energia|E\.ON Energia|Engie Italia|Dolomiti Energia|Estra Energie|Sorgenia|Illumia|Octopus Energy|NeN|Alperia Smart Services|Acea Energia|AGSM AIM Energia|Wind Tre|WindTre)(?:\s*[.,]?\s*S\.?\s*[Rr]?[PpLl]\.?\s*[AaLl]?\.?)?\s*$/i;

function supplier(line) {
  const name = String(line || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || !/^[\p{L}][\p{L}\p{N} .&'’()+-]+$/u.test(name)
    || /\b(?:distributore|indirizzo|contatti|numero verde|codice|partita|cliente|fornitore|bolletta|pagamento|gestore)\b/i.test(name)) return '';
  return name.replace(/\s+S\s*\.?\s*(p\s*\.?\s*A|r\s*\.?\s*l)\.?$/i, '').trim();
}

function parseText(text, context, { ocr = false } = {}) {
  const lines = String(text || '').normalize('NFKC').split(/\r?\n/).map(line => line.trim());
  const points = new Set();
  const providers = new Map();
  const taxes = new Set();
  for (const [i, line] of lines.entries()) {
    const next = lines[i + 1] || '';
    const pointLabel = /\b(POD|PDR)(?:\s*\/\s*(POD|PDR))?(?:\s*\([^)]{1,80}\))?[ \t]*[:=–—-]?[ \t]*(.*)$/i.exec(line);
    if (pointLabel) {
      const label = pointLabel[1].toUpperCase();
      const value = (pointLabel[3].trim() || next).split(/\s{2,}|\s+[|;]/)[0];
      const leading = /^(IT\d{3}E[A-Z0-9]{8,10}|\d{14})(?=$|[\s,;|)])/i.exec(value);
      const point = code(leading?.[1] || value);
      if ((label === 'POD' || pointLabel[2]) && /^IT\d{3}E[A-Z0-9]{8,10}$/.test(point)) points.add(point);
      if ((label === 'PDR' || pointLabel[2]) && /^\d{14}$/.test(point)) points.add(point);
    }
    const explicitSeller = /^(?:(?:società di vendita|venditore|fornitore|gestore)(?:\s+(?:di provenienza|uscente|di energia|energia))?\s*[:=–—-]\s*)(.*)$/i.exec(line);
    const legalHeading = KNOWN_SELLERS.exec(line);
    const seller = explicitSeller ? supplier(explicitSeller[1] || next) : legalHeading ? supplier(legalHeading[1]) : '';
    if (seller) providers.set(seller.toLowerCase().replace(/\W/g, ''), seller);

    // Un fiscale viene attribuito al cliente solo da un'etichetta che lo
    // specifica esplicitamente. Quello del venditore è spesso nella testata.
    const label = /^(?:(?:codice fiscale|c\.?\s*f\.?|partita iva|p\.?\s*iva)\s+(?:del(?:l['’])?\s*)?(?:cliente|intestatario)|(?:cliente|intestatario)\s*[-:]?\s*(?:codice fiscale|partita iva))\s*[:=–—-]?\s*(.*)$/i.exec(line);
    const fiscal = label ? tax(label[1] || next, context.business) : '';
    if (fiscal) taxes.add(fiscal);
  }
  if (taxes.size && (taxes.size > 1 || !taxes.has(context.fiscale))) return { motivo: 'intestatario_diverso' };
  if (points.size > 1 || providers.size > 1) return { motivo: 'bolletta_ambigua' };
  if (!points.size) return { motivo: 'punto_incerto' };
  if (!providers.size) return { motivo: 'fornitore_incerto' };
  // La corrispondenza esatta con l'export viene verificata comunque dal DB.
  // Per una scansione è vietata qualsiasi sostituzione O/0, I/1, ecc.
  return { punto: [...points][0], gestore: [...providers.values()][0], ocr };
}

async function extractPdf(bytes) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes), PDF_OPTIONS);
  try {
    if (!pdf.numPages || pdf.numPages > MAX_PAGES) return null;
    const pages = [];
    let items = 0;
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      items += content.items.length;
      if (items > 60000) return null;
      const viewport = page.getViewport({ scale: 1 });
      pages.push(layoutText([content.items.flatMap(item => {
        if (!item.str || !item.transform) return [];
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return [{ str: item.str, x, y: -y }];
      })]));
      page.cleanup();
    }
    return pages;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function readOcr(images, limitMs = 65000) {
  const { createWorker, OEM } = require('tesseract.js');
  // Nel pacchetto della function entra il solo modello italiano usato.
  const langPath = join(dirname(createRequire(__filename).resolve('@tesseract.js-data/ita/package.json')), '4.0.0_best_int');
  let worker, timer, expired = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('timeout_ocr_energia')); }, limitMs);
  });
  const work = async () => {
    worker = await createWorker('ita', OEM.LSTM_ONLY, { langPath, gzip: true, cacheMethod: 'none', errorHandler() {} });
    if (expired) { await worker.terminate(); return []; }
    const text = [];
    for (const image of images) {
      const { data } = await worker.recognize(image);
      if (data.confidence >= 75) text.push(data.text);
    }
    return text;
  };
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate();
  }
}

async function fromBytes(bytes, context, deps = {}) {
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const isImage = bytes[0] === 0xff && bytes[1] === 0xd8 || bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPdf && !isImage) return { motivo: 'bolletta_illeggibile' };
  let pages = [];
  if (isPdf) {
    pages = await (deps.extractPdf || extractPdf)(bytes);
    if (!pages) return { motivo: 'bolletta_illeggibile' };
    const direct = parseText(pages.join('\n\n'), context);
    if (direct.motivo === 'bolletta_ambigua' || direct.motivo === 'intestatario_diverso') return direct;
    if (!direct.motivo && pages.every(page => page.trim().length >= 40)) return direct;
    if (direct.motivo && pages.join('').trim().length >= 200 && pages.every(page => page.trim().length >= 40)) return direct;
  }
  const images = isImage ? [bytes] : [];
  for (let page = 1; isPdf && page <= Math.min(pages.length, OCR_PAGES); page++) {
    if (pages[page - 1].trim().length >= 40) continue;
    const image = await (deps.render || renderPageAsImage)(new Uint8Array(bytes), page,
      { canvasImport: () => import('@napi-rs/canvas'), width: 1800, pdfOptions: PDF_OPTIONS });
    images.push(Buffer.from(image));
  }
  if (!images.length) return parseText(pages.join('\n\n'), context);
  const observations = await (deps.ocr || readOcr)(images);
  if (!observations.length && !pages.some(p => p.trim())) return { motivo: 'bolletta_illeggibile' };
  return parseText([...pages, ...observations].join('\n\n'), context, { ocr: true });
}

async function readBill(db, context, deps = {}) {
  const documents = context.documenti || [];
  if (!documents.length) return { motivo: 'bolletta_assente' };
  if (documents.length > 2) return { motivo: 'bolletta_ambigua' };
  const results = [];
  for (const doc of documents) {
    if (doc.bucket !== 'contratti-vendita' || !doc.path || doc.path.split('/').includes('..') || doc.size > MAX_BYTES) {
      return { motivo: 'bolletta_illeggibile' };
    }
    const { data, error } = await db.storage.from(doc.bucket).download(doc.path);
    if (error || !data) throw new Error('bolletta_download');
    if (!data.size || data.size > MAX_BYTES) return { motivo: 'bolletta_illeggibile' };
    const bytes = Buffer.from(await data.arrayBuffer());
    if (doc.sha256 && createHash('sha256').update(bytes).digest('hex') !== doc.sha256) throw new Error('bolletta_impronta');
    const result = await fromBytes(bytes, context, deps);
    if (result.motivo) return result;
    results.push(result);
  }
  if (results.length === 2 && (results[0].punto !== results[1].punto || code(results[0].gestore) !== code(results[1].gestore))) {
    return { motivo: 'bolletta_ambigua' };
  }
  return results[0];
}

module.exports = { parseText, fromBytes, readBill, readOcr };
