'use strict';

const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { renderPageAsImage } = require('unpdf');
const { layoutText } = require('./pda-pdf-text');
const { code, tax } = require('./energia-csv');
const Vision = require('./energia-bolletta-ia');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_OCR_PAGES = 5;
const MAX_CACHE = 8;
const OCR_WIDTH = 2350;
const MAX_REVIEW_MS = 50000;
const requireInstalled = createRequire(__filename);
const language = () => join(dirname(requireInstalled.resolve('@tesseract.js-data/ita/package.json')), '4.0.0_best_int');
const KNOWN_SELLERS = /\b(Enel Energia|Eni Plenitude|Plenitude|Servizio Elettrico Nazionale|A2A Energia|Hera Comm|Iren Mercato|Edison Energia|E\.ON Energia|Engie Italia|Dolomiti Energia|Estra Energie|Sorgenia|Illumia|Octopus Energy|NeN|Alperia Smart Services|Acea Energia|AGSM AIM Energia|Wind Tre|WindTre|Argos|Accendi(?:\s+Luce\s*[&e]\s*Gas)?|Alleanza Luce\s*[&e]\s*Gas)\b/gi;
const COMPANY_FORM = /^\s+S\s*\.?\s*(?:P\s*\.?\s*A|R\s*\.?\s*L)\b\.?/i;
const SELLER_CONTEXT = /\b(?:scriv\w*|reclami|contatti|corrispondenza|posta)\b/i;
const ANCILLARY_CONTEXT = /\b(?:privacy|trattamento|informativa|trasforma|cessione|passaggio|titolare)\b/i;

function supplier(line) {
  const name = String(line || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 100 || !/^[\p{L}][\p{L}\p{N} .&'’()+-]+$/u.test(name)
    || /\b(?:distributore|indirizzo|contatti|numero verde|codice|partita|cliente|fornitore|bolletta|pagamento|gestore)\b/i.test(name)) return '';
  return name.replace(/\s+S\s*\.?\s*(?:p\s*\.?\s*A|r\s*\.?\s*l)\.?$/i, '').trim();
}

function canonicalSeller(name) {
  if (/^(?:accendi|alleanza luce)/i.test(name)) return 'Accendi Luce & Gas';
  if (/^(?:eni )?plenitude$/i.test(name)) return 'Plenitude';
  if (/^argos$/i.test(name)) return 'Argos';
  return name;
}

function sellers(line, next) {
  if (/\bdistributore\b/i.test(line)) return [];
  const explicit = /^(?:società di vendita|venditore|fornitore|gestore)(?:\s+(?:di provenienza|uscente|attuale|di energia(?: elettrica)?|energia))?\s*[:=–—-]\s*(.*)$/i.exec(line);
  const found = [];
  if (explicit) {
    const name = supplier(explicit[1] || next);
    if (name) found.push(name);
  }
  for (const match of line.matchAll(KNOWN_SELLERS)) {
    const suffix = line.slice(match.index + match[0].length);
    const alone = /^\s*(?:[-–—]\s*)?(?:mercato libero)?\s*$/i.test(suffix) && match.index === 0;
    const before = line.slice(0, match.index);
    const namedIssuer = COMPANY_FORM.test(suffix) && !ANCILLARY_CONTEXT.test(line) && (match.index === 0 || SELLER_CONTEXT.test(before));
    const accendiLogo = match.index === 0 && /^accendi\b/i.test(match[0])
      && (/luce\s*(?:&|e)\s*gas/i.test(line) || /^\s*(?:luce|gas|coop|[&e]+|\s)*$/i.test(suffix));
    if (alone || namedIssuer || accendiLogo) found.push(match[0]);
  }
  return found.map(canonicalSeller);
}

function factsFromText(text) {
  const facts = { providers: new Map(), taxes: new Set(), readable: Boolean(text.trim()) };
  const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.trim());
  for (const [index, line] of lines.entries()) {
    const next = lines[index + 1] || '';
    for (const name of sellers(line, next)) facts.providers.set(name.toLowerCase().replace(/\W/g, ''), name);
    // Il fiscale della testata del venditore è distinto da quello del cliente.
    const label = /^(?:(?:codice fiscale|c\.?\s*f\.?|partita iva|p\.?\s*iva)\s+(?:del(?:l['’])?\s*)?(?:cliente|intestatario)|(?:cliente|intestatario)\s*[-:]?\s*(?:codice fiscale|partita iva))\s*[:=–—-]?\s*(.*)$/i.exec(line);
    if (label) {
      const fiscal = (label[1] || next).trim().split(/\s+/)[0];
      if (fiscal) facts.taxes.add(fiscal);
    }
  }
  return facts;
}

function mergeFacts(target, source) {
  for (const [name, value] of source.providers) target.providers.set(name, value);
  for (const value of source.taxes) target.taxes.add(value);
  target.readable ||= source.readable;
  target.ambiguous ||= source.ambiguous;
  return target;
}

function selectSupplier(facts, context) {
  const taxes = new Set([...facts.taxes].map(value => tax(value, context.business)).filter(Boolean));
  if (context.fiscale && taxes.size && (taxes.size !== 1 || !taxes.has(context.fiscale))) return { motivo: 'intestatario_diverso' };
  if (facts.ambiguous || facts.providers.size > 1) return { motivo: 'bolletta_ambigua' };
  if (facts.providers.size === 1) return { gestore: [...facts.providers.values()][0] };
  return { motivo: facts.readable ? 'fornitore_incerto' : 'bolletta_illeggibile' };
}

function parseText(text, context) {
  return selectSupplier(factsFromText(text), context);
}

async function openPdf(bytes) {
  // La build serverless di unpdf fornisce il renderer ma non i decoder
  // JBIG2/CCITT. Apriamo il PDF con PDF.js completo e gli asset locali.
  const entry = requireInstalled.resolve('pdfjs-dist/legacy/build/pdf.mjs');
  const root = dirname(requireInstalled.resolve('pdfjs-dist/package.json'));
  const { getDocument } = await import(pathToFileURL(entry).href);
  const asset = name => join(root, name).replace(/\\/g, '/') + '/';
  return getDocument({ data: new Uint8Array(bytes), wasmUrl: asset('wasm'), cMapUrl: asset('cmaps'), cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    isEvalSupported: false, disableFontFace: true, useSystemFonts: false, useWorkerFetch: false, verbosity: 0 }).promise;
}

async function extractPdf(pdf) {
  if (!pdf.numPages) return [];
  const pages = [];
  let items = 0;
  for (let pageNo = 1; pageNo <= Math.min(pdf.numPages, MAX_PAGES); pageNo++) {
    let page;
    try {
      page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      items += content.items.length;
      if (items > 60000) break;
      const viewport = page.getViewport({ scale: 1 });
      pages.push(layoutText([content.items.flatMap(item => {
        if (!item.str || !item.transform) return [];
        const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        return [{ str: item.str, x, y: -y }];
      })]));
    } catch {
      pages.push('');
    } finally { page?.cleanup(); }
  }
  return pages;
}

async function renderScan(pdf, pageNo, deps) {
  const page = await pdf.getPage(pageNo);
  try {
    const view = page.getViewport({ scale: 1 });
    const width = Math.min(OCR_WIDTH, Math.sqrt(8_500_000 * view.width / view.height));
    return Buffer.from(await (deps.render || renderPageAsImage)(pdf, pageNo, {
      canvasImport: () => import('@napi-rs/canvas'), width
    }));
  } finally { page.cleanup(); }
}

async function * scanPages(count, render) {
  for (let pageNo = 1; pageNo <= count; pageNo++) {
    const image = await render(pageNo).catch(() => null);
    if (image) yield image;
  }
}

async function readOcr(images, facts, limitMs) {
  const tesseract = require('tesseract.js');
  let worker, timer, expired = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('timeout_ocr_energia')); }, limitMs);
  });
  const work = async () => {
    worker = await tesseract.createWorker('ita', tesseract.OEM.LSTM_ONLY, { langPath: language(), gzip: true, cacheMethod: 'none', errorHandler() {} });
    if (expired) { await worker.terminate(); return; }
    for await (const image of images) {
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines = data.blocks?.flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines)) || [];
      const text = lines.map(line => line.confidence >= 70 ? line.text.trim() : '').join('\n');
      mergeFacts(facts, factsFromText(text));
      if (facts.providers.size) break;
    }
  };
  try {
    await Promise.race([work(), timeout]);
    return facts;
  } finally {
    clearTimeout(timer);
    if (worker && !expired) await worker.terminate();
    else if (worker) void worker.terminate().catch(() => {});
  }
}

async function observeBytes(bytes, deps) {
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const isImage = bytes[0] === 0xff && bytes[1] === 0xd8 || bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPdf && !isImage) return factsFromText('');
  const pdf = isPdf ? await (deps.openPdf || openPdf)(bytes) : null;
  try {
    const pages = pdf ? await (deps.extractPdf || extractPdf)(pdf) : [];
    const facts = factsFromText(pages.join('\n\n'));
    if (facts.providers.size === 1) return facts;
    const deadline = deps.deadline ?? Date.now() + MAX_REVIEW_MS;
    const pageCount = pdf?.numPages ?? 1;
    const rendered = new Map();
    const render = async pageNo => {
      if (!pdf) return bytes;
      if (rendered.has(pageNo)) return rendered.get(pageNo);
      const image = await renderScan(pdf, pageNo, deps);
      if (pageNo <= 2) rendered.set(pageNo, image);
      return image;
    };
    if (deps.iaClient) {
      const evidence = await Vision.readSupplier({
        client: deps.iaClient, budget: deps.iaBudget ?? { remaining: 2 }, deadline,
        render, pageCount, multi: deps.multi
      }).catch(() => null);
      if (evidence?.ambiguous) return { ...facts, ambiguous: true, readable: true };
      const gestore = supplier(evidence?.gestore);
      if (gestore) {
        const name = canonicalSeller(gestore);
        facts.providers.clear();
        facts.providers.set(name.toLowerCase().replace(/\W/g, ''), name);
        facts.readable = true;
        return facts;
      }
    }
    if (facts.providers.size > 1) return facts;
    const limitMs = deadline - Date.now();
    if (limitMs <= 0) throw new Error('timeout_ocr_energia');
    return await (deps.ocr || readOcr)(scanPages(Math.min(pageCount, MAX_OCR_PAGES), render), facts, limitMs);
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}

async function fromBytes(bytes, context, deps = {}) {
  return selectSupplier(await observeBytes(bytes, deps), context);
}

async function readBill(db, context, deps = {}) {
  const deadline = Date.now() + MAX_REVIEW_MS;
  const documents = context.documenti || [];
  if (!documents.length) return { motivo: 'bolletta_assente' };
  if (documents.length > 2) return { motivo: 'bolletta_ambigua' };
  const iaClient = deps.iaClient === undefined ? Vision.createClient() : deps.iaClient;
  const iaBudget = { remaining: 2 };
  const combined = factsFromText('');
  for (const doc of documents) {
    if (doc.bucket !== 'contratti-vendita' || !doc.path || doc.path.split('/').includes('..') || doc.size > MAX_BYTES) {
      return { motivo: 'bolletta_illeggibile' };
    }
    const { data, error } = await db.storage.from(doc.bucket).download(doc.path);
    if (error || !data) throw new Error('bolletta_download');
    if (!data.size || data.size > MAX_BYTES) return { motivo: 'bolletta_illeggibile' };
    const bytes = Buffer.from(await data.arrayBuffer());
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (doc.sha256 && hash !== doc.sha256) throw new Error('bolletta_impronta');
    let facts = deps.cache?.get(hash);
    if (!facts) {
      facts = await observeBytes(bytes, { ...deps, deadline, iaClient, iaBudget, multi: documents.length > 1 });
      if (deps.cache) {
        if (deps.cache.size >= MAX_CACHE) deps.cache.delete(deps.cache.keys().next().value);
        deps.cache.set(hash, facts);
      }
    }
    if (!facts.readable) return { motivo: 'bolletta_illeggibile' };
    mergeFacts(combined, facts);
  }
  return selectSupplier(combined, context);
}

module.exports = { parseText, fromBytes, readBill };
