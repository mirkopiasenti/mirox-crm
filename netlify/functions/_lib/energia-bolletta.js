'use strict';

const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { renderPageAsImage } = require('unpdf');
const { layoutText } = require('./pda-pdf-text');
const { code, isPoint, tax } = require('./energia-csv');

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;
const MAX_CACHE = 8;
const OCR_WIDTH = 2350;
const requireInstalled = createRequire(__filename);
const language = () => join(dirname(requireInstalled.resolve('@tesseract.js-data/ita/package.json')), '4.0.0_best_int');
const POINT_LABEL = /\b(POD|PDR|punto di prelievo|punto di riconsegna)\b/i;
const POD = /^IT\d{3}E[A-Z0-9]{8,10}$/;
const PDR = /^\d{14}$/;
const POD_TOKEN = /^[I1L]T[0-9ODIL]{3}E[A-Z0-9]{8,10}$/i;
const PDR_TOKEN = /^[0-9OILDSB]{14}$/i;
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

function pointLabel(line) {
  const label = POINT_LABEL.exec(line);
  if (!label) return null;
  const pod = /^(?:pod|punto di prelievo)$/i.test(label[0]);
  const tail = line.slice(label.index + label[0].length);
  const composite = /^\s*\/\s*(?:POD|PDR)\b/i;
  return { family: composite.test(tail) ? null : pod ? 'luce' : 'gas',
    tail: tail.replace(composite, '').replace(/^\s*\([^)]{1,80}\)/, '').replace(/^[\s:=–—-]+/, '') };
}

function validFor(point, family) {
  return isPoint(point) && (family === 'luce' ? POD.test(point) : family === 'gas' ? PDR.test(point) : true);
}

function valueAtStart(line, family) {
  const value = line.trim().split(/\s{2,}|\s+[|;]/)[0];
  const leading = /^(IT\d{3}E[A-Z0-9]{8,10}|\d{14})(?=$|[\s,;|).])/i.exec(value);
  const normalized = code(leading?.[1] || value);
  return validFor(normalized, family) ? normalized : null;
}

function factsFromText(text, additionalPoints = []) {
  const lines = String(text || '').normalize('NFKC').split(/\r?\n/).map(line => line.trim());
  const points = new Set(additionalPoints);
  const providers = new Map();
  const taxes = new Set();
  for (const [index, line] of lines.entries()) {
    const next = lines[index + 1] || '';
    const marker = pointLabel(line);
    if (marker) {
      const point = valueAtStart(marker.tail, marker.family) || valueAtStart(next, marker.family);
      if (point) points.add(point);
    }
    for (const name of sellers(line, next)) providers.set(name.toLowerCase().replace(/\W/g, ''), name);

    // Il fiscale della testata del venditore è distinto da quello del cliente.
    const label = /^(?:(?:codice fiscale|c\.?\s*f\.?|partita iva|p\.?\s*iva)\s+(?:del(?:l['’])?\s*)?(?:cliente|intestatario)|(?:cliente|intestatario)\s*[-:]?\s*(?:codice fiscale|partita iva))\s*[:=–—-]?\s*(.*)$/i.exec(line);
    if (label) {
      const fiscal = (label[1] || next).trim().split(/\s+/)[0];
      if (fiscal) taxes.add(fiscal);
    }
  }
  return { points, podConfrontabili: new Set(), providers, taxes };
}

function declaredPodFromOcr(value) {
  if (!POD_TOKEN.test(value)) return null;
  // Si normalizzano solo il prefisso obbligatorio e le tre posizioni
  // certamente numeriche. Serve a riscontrare il POD già digitato,
  // mai a proporre una correzione del dato inserito.
  return 'IT' + value.slice(2, 5).replace(/[OD]/g, '0').replace(/[IL]/g, '1') + value.slice(5);
}

function selectFacts(facts, context, ocr) {
  const taxes = new Set([...facts.taxes].map(value => tax(value, context.business)).filter(Boolean));
  if (taxes.size && (taxes.size !== 1 || !taxes.has(context.fiscale))) return { motivo: 'intestatario_diverso' };
  const candidates = [...facts.points].filter(point => validFor(point, context.famiglia));
  const possible = new Set([...candidates, ...[...facts.podConfrontabili].filter(point => validFor(point, context.famiglia))]);
  const declared = code(context.punto_dichiarato);
  // Il punto digitato disambigua solo se è effettivamente letto nell'allegato.
  // Il database richiede comunque una sola proposta per il fiscale e quel punto.
  const punto = possible.has(declared) ? declared : candidates.length === 1 && possible.size === 1 ? candidates[0] : null;
  if (facts.providers.size > 1 || (!punto && possible.size > 1)) return { motivo: 'bolletta_ambigua' };
  if (!punto) return { motivo: 'punto_incerto' };
  if (facts.providers.size !== 1) return { motivo: 'fornitore_incerto' };
  return { punto, gestore: [...facts.providers.values()][0], ocr };
}

function parseText(text, context, { ocr = false } = {}) {
  return selectFacts(factsFromText(text), context, ocr);
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
}

function ocrTargets(lines) {
  const targets = new Map();
  for (const [index, line] of lines.entries()) {
    const marker = pointLabel(line.text);
    if (!marker) continue;
    const next = lines[index + 1];
    const nearby = next && next.bbox.y0 >= line.bbox.y0
      && next.bbox.y0 - line.bbox.y1 <= Math.max(60, (line.bbox.y1 - line.bbox.y0) * 2);
    // Una riga che contiene entrambe le colonne del documento può avere
    // cifre estranee. Il formato del candidato limita la rilettura al punto.
    const candidates = [...line.words, ...(nearby ? next.words : [])];
    for (const word of candidates) {
      const value = code(word.text).replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
      const family = POD_TOKEN.test(value) ? 'luce' : PDR_TOKEN.test(value) ? 'gas' : null;
      if (!family || (marker.family && marker.family !== family)) continue;
      const key = [word.bbox.x0, word.bbox.y0, word.bbox.x1, word.bbox.y1].join('/');
      targets.set(key, { bbox: word.bbox, family, value });
    }
  }
  return [...targets.values()].slice(0, 6);
}

async function readCrops(worker, image, targets, { PSM }) {
  const verified = [];
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const source = await loadImage(image);
  async function readCrop(bbox, family, pad) {
    const x = Math.max(0, bbox.x0 - pad), y = Math.max(0, bbox.y0 - pad);
    const w = Math.min(source.width - x, bbox.x1 + pad - x);
    const h = Math.min(source.height - y, bbox.y1 + pad - y);
    if (w <= 0 || h <= 0) return null;
    const canvas = createCanvas(w * 3, h * 3);
    canvas.getContext('2d').drawImage(source, x, y, w, h, 0, 0, w * 3, h * 3);
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE,
      tessedit_char_whitelist: family === 'gas' ? '0123456789' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
    const { data } = await worker.recognize(canvas.toBuffer('image/png'));
    const point = code(data.text);
    return validFor(point, family) ? { point, confidence: data.confidence } : null;
  }
  for (const { bbox, family, value } of targets) {
    const first = await readCrop(bbox, family, family === 'gas' ? 22 : 14);
    if (first?.confidence >= 65) {
      verified.push({ value, point: first.point, esatto: true });
    } else if (family === 'luce' && first?.confidence >= 40) {
      const second = await readCrop(bbox, family, 6);
      if (second?.confidence >= 40 && second.point === first.point) {
        verified.push({ value, point: first.point, esatto: false });
      }
    }
  }
  return verified;
}

async function readOcr(images, limitMs = 78000) {
  const tesseract = require('tesseract.js');
  let worker, timer, expired = false;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error('timeout_ocr_energia')); }, limitMs);
  });
  const work = async () => {
    worker = await tesseract.createWorker('ita', tesseract.OEM.LSTM_ONLY, { langPath: language(), gzip: true, cacheMethod: 'none', errorHandler() {} });
    if (expired) { await worker.terminate(); return []; }
    const observations = [];
    for await (const image of images) {
      await worker.setParameters({ tessedit_pageseg_mode: tesseract.PSM.AUTO, tessedit_char_whitelist: '' });
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
      const lines = data.blocks?.flatMap(b => b.paragraphs.flatMap(p => p.lines)) || [];
      const targets = ocrTargets(lines);
      const points = targets.length ? await readCrops(worker, image, targets, tesseract) : [];
      // Le righe buone restano utili anche se note, tabelle o loghi abbassano
      // la confidenza media della pagina. Le righe scartate mantengono il salto.
      const text = lines.length ? lines.map(line => line.confidence >= 70 ? line.text.trim() : '').join('\n') : '';
      // Sul punto riletto in dettaglio vale la lettura localizzata. Il testo
      // della stessa pagina resta a disposizione per gestore e intestazione.
      const facts = factsFromText(text);
      for (const { family, value } of targets) {
        if (family !== 'luce') continue;
        const confirmed = declaredPodFromOcr(value);
        if (confirmed) facts.podConfrontabili.add(confirmed);
      }
      for (const { value, point, esatto } of points) {
        if (esatto) {
          facts.points.delete(value);
          facts.points.add(point);
        } else {
          facts.podConfrontabili.add(point);
        }
      }
      observations.push({ facts, leggibile: Boolean(text.trim() || points.length) });
    }
    return observations;
  };
  try {
    return await Promise.race([work(), timeout]);
  } finally {
    clearTimeout(timer);
    if (worker) await worker.terminate();
  }
}

function mergeFacts(direct, additional) {
  for (const { facts } of additional) {
    for (const point of facts.points) direct.points.add(point);
    for (const point of facts.podConfrontabili) direct.podConfrontabili.add(point);
    for (const [name, value] of facts.providers) direct.providers.set(name, value);
    for (const value of facts.taxes) direct.taxes.add(value);
  }
  return direct;
}

async function * renderScans(pdf, pages, direct, deps) {
  for (let index = 0; index < pages.length; index++) {
    if (direct.points.size && direct.providers.size && pages[index].trim().length >= 40) continue;
    const page = await pdf.getPage(index + 1);
    const view = page.getViewport({ scale: 1 });
    // Mantieni il testo leggibile senza allocare immagini enormi per scansioni oblunghe.
    const width = Math.min(OCR_WIDTH, Math.sqrt(8_500_000 * view.width / view.height));
    yield Buffer.from(await (deps.render || renderPageAsImage)(pdf, index + 1, {
      canvasImport: () => import('@napi-rs/canvas'), width
    }));
    page.cleanup();
  }
}

async function observeBytes(bytes, deps) {
  const isPdf = bytes.subarray(0, 5).toString() === '%PDF-';
  const isImage = bytes[0] === 0xff && bytes[1] === 0xd8 || bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPdf && !isImage) return { motivo: 'bolletta_illeggibile' };
  const pdf = isPdf ? await (deps.openPdf || openPdf)(bytes) : null;
  try {
    const pages = pdf ? await (deps.extractPdf || extractPdf)(pdf) : [];
    if (!pages) return { motivo: 'bolletta_illeggibile' };
    const text = pages.join('\n\n');
    const direct = factsFromText(text);
    if (direct.points.size && direct.providers.size && pages.every(page => page.trim().length >= 40)) return { facts: direct, ocr: false };
    const observations = await (deps.ocr || readOcr)(pdf ? renderScans(pdf, pages, direct, deps) : [bytes]);
    if (!text.trim() && !observations.some(page => page.leggibile)) return { motivo: 'bolletta_illeggibile' };
    return { facts: mergeFacts(direct, observations), ocr: true };
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}

async function fromBytes(bytes, context, deps = {}) {
  const result = await observeBytes(bytes, deps);
  return result.motivo ? result : selectFacts(result.facts, context, result.ocr);
}

function familyForOffer(value) {
  const kinds = new Set((String(value || '').match(/\b(?:luce|gas)\b/gi) || []).map(kind => kind.toLowerCase()));
  return kinds.size === 1 ? [...kinds][0] : null;
}

async function readBill(db, context, deps = {}) {
  const documents = context.documenti || [];
  if (!documents.length) return { motivo: 'bolletta_assente' };
  if (documents.length > 2) return { motivo: 'bolletta_ambigua' };
  let scope = context;
  if (deps.contrattoId) {
    const { data, error } = await db.from('vendita_contratti').select('pod_pdr,nome_offerta_snapshot').eq('id', deps.contrattoId).maybeSingle();
    if (!data || error) throw new Error('bolletta_contesto');
    scope = { ...context, famiglia: familyForOffer(data.nome_offerta_snapshot), punto_dichiarato: data.pod_pdr };
  }
  const results = [];
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
    let observation = deps.cache?.get(hash);
    if (!observation) {
      observation = await observeBytes(bytes, deps);
      if (deps.cache) {
        if (deps.cache.size >= MAX_CACHE) deps.cache.delete(deps.cache.keys().next().value);
        deps.cache.set(hash, observation);
      }
    }
    const result = observation.motivo ? observation : selectFacts(observation.facts, scope, observation.ocr);
    if (result.motivo) return result;
    results.push(result);
  }
  if (results.length === 2 && (results[0].punto !== results[1].punto || code(results[0].gestore) !== code(results[1].gestore))) {
    return { motivo: 'bolletta_ambigua' };
  }
  return results[0];
}

module.exports = { parseText, fromBytes, readBill, readOcr, familyForOffer };
