'use strict';

const Pda = require('../../../js/vendita-pda-core');
const MAX_PAGES = 60;
const MAX_ITEMS = 100000;

// L'ordine degli operatori PDF puo' precedere il titolo visivo della sezione.
// Ricostruiamo le righe per coordinate, anziche' concatenare il content stream.
function layoutText(pages) {
  return pages.map(items => {
    const rows = [];
    for (const item of items.filter(i => typeof i.str === 'string' && i.str.trim()
      && Number.isFinite(i.x) && Number.isFinite(i.y)).sort((a, b) => b.y - a.y || a.x - b.x)) {
      const last = rows[rows.length - 1];
      if (!last || Math.abs(last.y - item.y) > 2) rows.push({ y: item.y, items: [item] });
      else last.items.push(item);
    }
    return rows.map(row => row.items.sort((a, b) => a.x - b.x).map(i => i.str).join(' ')).join('\n');
  }).join('\n');
}

function sectionFields(text, completeText = true) {
  const normalized = String(text || '').normalize('NFKC').replace(/[\u00ad\u200b]/g, '').replace(/\r/g, '');
  const simHeader = /^[ \t]*DATI\s+DELLA\s+SIM\s+WINDTRE[ \t]*$/gim;
  const mnpHeader = /^[ \t]*DATI\s+PER\s+LA\s+RICHIESTA\s+DEL\s+SERVIZIO\s+PASSA\s+A\s+WINDTRE[ \t]*$/gim;
  const sectionEnd = /\n\s*(?:DATI\b|CONDIZIONI\b|TRASFERIMENTO\s+DEL\s+CREDITO|OPZIONE\s+AGGIUNTIVA|PROPOSTA\b|Data\s*:)/i;
  const sections = header => Array.from(normalized.matchAll(header), match => {
    const rest = normalized.slice(match.index + match[0].length, match.index + match[0].length + 3000);
    const end = rest.search(sectionEnd);
    return end < 0 ? rest : rest.slice(0, end);
  });
  const sims = sections(simHeader), mnps = sections(mnpHeader);
  if (!sims.length && !mnps.length) return {};
  const unique = (blocks, pattern, normalize) => {
    const values = blocks.flatMap(block => Array.from(block.matchAll(pattern), m => normalize(m[1])));
    const found = new Set(values.filter(v => v !== null && v !== ''));
    // Un valore testuale discordante/illeggibile non va sostituito con una scelta AI arbitraria.
    if (found.size > 1 || values.some(v => v === null)) return { found: true, value: null };
    return { found: found.size === 1, value: Array.from(found)[0] };
  };
  const out = mnps.length ? { portabilita: true } : completeText ? { portabilita: false } : {};
  const sim = unique(sims, /Numero\s+di\s+telefono\s*:\s*([+\d][\d \t().-]*)/gi, Pda.phone);
  if (sim.found) out.numero_sim = sim.value;
  const mnp = unique(mnps, /Numero\s+di\s+telefono\s+da\s+portare\s*:\s*([+\d][\d \t().-]*)/gi, Pda.phone);
  if (mnp.found) out.numero_mnp = mnp.value;
  const operator = unique(mnps, /Operatore\s+attuale\s*:[ \t]*([^\n]+)/gi,
    value => value.split(/\b(?:Data\s+preferita|Seriale\s+SIM|Firma\s*:)/i)[0].trim().slice(0, 100) || null);
  if (operator.found) out.operatore_provenienza = operator.value;
  return out;
}

async function readPdfFields(buffer) {
  const { getDocumentProxy } = require('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buffer), {
      isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
      useWorkerFetch: false, maxImageSize: 1048576, verbosity: 0
    });
    if (pdf.numPages > MAX_PAGES) return {};
    const pages = [];
    let total = 0;
    const deadline = Date.now() + 5000;
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      total += content.items.length;
      if (total > MAX_ITEMS || Date.now() > deadline) return {};
      // Il viewport gestisce anche i PDF ruotati: y crescente dall'alto.
      const viewport = page.getViewport({ scale: 1 });
      pages.push(content.items.filter(i => typeof i.str === 'string' && i.transform).map(i => {
        const [x, y] = viewport.convertToViewportPoint(i.transform[4], i.transform[5]);
        return { str: i.str, x, y: -y };
      }));
      page.cleanup();
    }
    // Su un PDF ibrido/scansione l'assenza del titolo MNP nel testo non ne prova l'assenza visiva.
    const completeText = pages.every(items => items.reduce((n, item) => n + item.str.trim().length, 0) >= 100);
    return sectionFields(layoutText(pages), completeText);
  } finally {
    if (pdf) await pdf.loadingTask.destroy();
  }
}

module.exports = { layoutText, sectionFields, readPdfFields };
