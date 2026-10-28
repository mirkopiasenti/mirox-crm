'use strict';
const crypto = require('node:crypto');
const Pda = require('../../../js/vendita-pda-core');
const norm = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const personalTax = value => /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(norm(value));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function evidence(text) {
  const source = String(text || '');
  const numbered = [...source.matchAll(/^PAGINA PDF (\d+)\n([\s\S]*?)(?=^PAGINA PDF \d+\n|$(?![\s\S]))/gm)];
  const pages = numbered.length ? numbered.map(match => ({ page: Number(match[1]), text: match[2] })) : [{ page: 1, text: source }];
  const values = { fiscale: [], codice_contratto: [], firmatario_fiscale: [] };
  pages.forEach(({ text: page, page: pageNumber }) => {
    for (const match of page.matchAll(/Partita\s+IVA\s*\/\s*Cod\.?\s*Fiscale\s+Azienda\s*:\s*([A-Z0-9]+)/gi)) {
      if (/^(?:\d{11}|[A-Z0-9]{16})$/.test(norm(match[1]))) values.fiscale.push({ value: norm(match[1]), page: pageNumber, quote: match[0] });
    }
    for (const match of page.matchAll(/(?:Codice|Numero)\s+Contratto\s*:?\s*([A-Z0-9][A-Z0-9/-]*)/gi)) {
      if (Pda.code(match[1])) values.codice_contratto.push({ value: Pda.code(match[1]), page: pageNumber, quote: match[0] });
    }
    for (const header of page.matchAll(/^[ \t]*DATI\s+(?:DEL\s+RAPPRESENTANTE\s+LEGALE|DEL\s+LEGALE\s+RAPPRESENTANTE\s+O\s+DEL\s+DELEGATO)[ \t]*$/gim)) {
      const block = page.slice(header.index + header[0].length, header.index + header[0].length + 2400)
        .split(/\n[ \t]*(?:DATI\s+FIRMA|MODALIT[AÀ]\s+DI\s+PAGAMENTO|INTESTATARIO\s+DEL\s+CONTO|TITOLARE\s+O\s+DELEGATO)/i)[0];
      for (const match of block.matchAll(/Codice\s+Fiscale\s*:\s*([A-Z0-9]+)/gi)) {
        if (personalTax(match[1])) values.firmatario_fiscale.push({ value: norm(match[1]), page: pageNumber, quote: header[0].trim() + '\n' + match[0] });
      }
    }
  });
  return { fields: Object.fromEntries(Object.entries(values).map(([key, list]) => [key, list.length && new Set(list.map(v => v.value)).size === 1 ? list[0] : null])),
    ambiguous: Object.entries(values).filter(([, list]) => new Set(list.map(v => v.value)).size > 1).map(([key]) => key) };
}
const fields = text => evidence(text).fields;
async function load(db, paths, customer, deps = {}) {
  const Docs = require('./verifica-documenti');
  const Anthropic = require('@anthropic-ai/sdk').default;
  if (!Array.isArray(paths) || paths.length > 20 || paths.some(p => typeof p !== 'string' || !/^temp\/[0-9a-f-]{36}\/[a-z0-9_.-]+\.pdf$/i.test(p))) throw new Error('Riferimenti PDA Business non validi. Ricarica la PDA.');
  const pdas = []; let total = 0; const started = Date.now();
  for (const path of [...new Set(paths)].sort()) {
    if (Date.now() - started > 15000) throw new Error('Lettura PDA Business non completata: ripeti il controllo.');
    const blob = Docs.checked(await db.storage.from('contratti-vendita').download(path));
    const bytes = Buffer.from(await blob.arrayBuffer()); total += bytes.length;
    if (total > 30 * 1024 * 1024) throw new Error('Le PDA Business superano 30 MB complessivi.');
    const pages = await (deps.pdfInfo || Docs.pdfInfo)(bytes);
    const parsed = evidence(await (deps.pdfText || Docs.pdfText)(bytes));
    if (parsed.ambiguous.length) throw new Error('La PDA Business riporta dati aziendali, codici o rappresentanti discordanti. Separa i contratti corretti.');
    let reading = { fields: parsed.fields };
    if (Object.values(reading.fields).some(v => !v)) {
      reading = await (deps.extractBusiness || Docs.extractDocument)({ id: hash(bytes), tipo_documento: 'rappresentante_business', pages }, bytes,
        { ...deps, client: deps.businessClient || (deps.extractBusiness ? null : new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 8000, maxRetries: 0 })) });
      for (const [key, value] of Object.entries(parsed.fields)) {
        if (!value) continue;
        if (reading.fields?.[key] && norm(reading.fields[key].value) !== norm(value.value)) throw new Error('La lettura della PDA Business contiene dati discordanti. Verifica la copia caricata.');
        reading.fields[key] = value;
      }
    }
    const data = reading.fields;
    if (norm(data?.fiscale?.value) !== norm(customer.cf_piva)) throw new Error('La partita IVA o il CF aziendale della PDA Business non coincide con l’anagrafica.');
    if (!personalTax(data?.firmatario_fiscale?.value) || !Pda.code(data?.codice_contratto?.value)) throw new Error('CF del rappresentante o codice contratto non leggibili nella PDA Business. Carica una copia completa.');
    pdas.push({ path, sha256: hash(bytes), codice_contratto: Pda.code(data.codice_contratto.value), fiscale_azienda: norm(data.fiscale.value), cf_rappresentante: norm(data.firmatario_fiscale.value), reading });
  }
  const people = new Set(pdas.map(p => p.cf_rappresentante));
  if (people.size > 1) throw new Error('Le PDA indicano rappresentanti diversi: usa pratiche separate con il documento della persona corretta.');
  return pdas.length ? { cf_rappresentante: pdas[0].cf_rappresentante, pdas } : null;
}
async function assertSources(db, check, customer, contracts, documents = null) {
  if (norm(customer.cluster) !== 'BUSINESS') return;
  for (const c of contracts.filter(c => Pda.isPda(c.categoria_snapshot || c.categoria_nome))) {
    const source = check.business_identity?.pdas?.find(p => p.codice_contratto === Pda.code(c.codice_contratto)
      && (!documents ? p.path === c.pda_temp_path : true));
    if (!source || source.fiscale_azienda !== norm(customer.cf_piva) || source.cf_rappresentante !== check.business_identity.cf_rappresentante) throw new Error('Ripeti il controllo identita con tutte le PDA Business del carrello.');
    const doc = documents?.find(d => d.contratto_id === c.id && d.tipo_documento === 'contratto' && d.sha256 === source.sha256);
    if (documents && !doc) throw new Error('La PDA Business inviata non coincide con quella controllata.');
    const path = documents ? doc.storage_path : source.path;
    if (documents && doc.storage_bucket !== 'contratti-vendita' || !path || path.split('/').includes('..')) throw new Error('Percorso PDA Business non valido.');
    const download = await db.storage.from('contratti-vendita').download(path);
    if (download.error || !download.data) throw new Error('Impossibile rileggere la PDA Business prima dell’invio.');
    const bytes = Buffer.from(await download.data.arrayBuffer());
    if (hash(bytes) !== source.sha256) throw new Error('La PDA Business è cambiata: ripeti il controllo identita.');
  }
}
module.exports = { fields, evidence, personalTax, load, assertSources };
