'use strict';

const { createHash } = require('node:crypto');
const { readCsv } = require('./verifica-csv');

const POINT_HEADERS = new Set(['POD', 'CODICEPOD', 'NUMEROPOD', 'PDR', 'CODICEPDR', 'NUMEROPDR',
  'PODPDR', 'PODOPDR', 'CODICEPODPDR', 'CODICEPODOPDR', 'PUNTODIFORNITURA', 'CODICEPUNTODIFORNITURA']);
const PRIORITY = new Map(['Attivato', 'Nuovo', 'In attivazione', 'In lavorazione', 'Annullato', 'Rifiutato'].map((state, i) => [state, i + 1]));
const code = value => String(value ?? '').replace(/\s+/g, '').toUpperCase();
const isPoint = value => /^(?:IT\d{3}E[A-Z0-9]{8,10}|\d{14})$/.test(value);
const tax = (value, business) => {
  const normalized = code(value);
  if (business) return /^\d{1,11}$/.test(normalized) ? normalized.padStart(11, '0') : '';
  return /^[A-Z0-9]{16}$/.test(normalized) ? normalized : '';
};

function parse(input) {
  const { header, rows } = readCsv(input);
  const required = ['PROPOSTADICONTRATTO', 'CODICEFISCALE', 'PARTITAIVA', 'STATO'];
  if (required.some(name => !header.includes(name))) {
    throw new Error('Servono le colonne Proposta di Contratto, Codice Fiscale, Partita Iva e Stato.');
  }
  const points = header.flatMap((name, index) => POINT_HEADERS.has(name) ? [index] : []);
  if (!points.length) throw new Error('Il CSV non contiene la colonna POD/PDR.');
  const columns = new Map(header.map((name, index) => [name, index]));
  const value = (row, name) => row[columns.get(name)]?.trim() || '';
  const sources = new Map();
  for (const [index, row] of rows.entries()) {
    const numero = code(value(row, 'PROPOSTADICONTRATTO'));
    const cf = tax(value(row, 'CODICEFISCALE'), false);
    const piva = tax(value(row, 'PARTITAIVA'), true);
    const state = value(row, 'STATO');
    const supply = [...new Set(points.map(i => code(row[i])).filter(v => v && v !== '-' && v !== '—'))];
    if (!numero || (!cf && !piva)) continue;
    if (numero.length > 80 || state.length > 100 || supply.some(p => !isPoint(p))) {
      throw new Error(`Numero contratto, POD/PDR o stato non valido alla riga ${index + 2}.`);
    }
    const rejection = name => state === 'Rifiutato' ? value(row, name).slice(0, 4000) || null : null;
    for (const punto of supply.length ? supply : ['']) {
      const key = JSON.stringify([numero, punto, cf, piva]);
      const previous = sources.get(key);
      const priority = PRIORITY.get(state) || (state ? 0 : -1);
      if (previous && previous.priority >= priority) continue;
      sources.set(key, { priority, row: { numero, punto, cf, piva, stato: state || null,
        causale: rejection('CAUSALESTATOPRATICA'), messaggio: rejection('MESSAGGIOESITODASAP'), annullamento: rejection('CAUSAANNULLAMENTO') } });
    }
  }
  const result = Array.from(sources.values(), v => v.row);
  if (!result.some(row => row.punto)) throw new Error('Il CSV non contiene punti di fornitura utilizzabili.');
  return result;
}

async function save(db, input, actor) {
  let rows;
  try {
    rows = parse(input);
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
  const { data, error } = await db.rpc('vendita_energia_importa_csv', {
    p_hash: createHash('sha256').update(input).digest('hex'), p_autore: actor, p_righe: rows
  });
  if (error) throw new Error('Il caricamento del CSV non è riuscito. Riprova.');
  return { ...data, righe: rows.length };
}

module.exports = { parse, save, code, isPoint, tax };
