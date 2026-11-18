'use strict';

const { createHash } = require('node:crypto');
const { readCsv } = require('./verifica-csv');
const { code, isPoint } = require('../../../js/energia-core');

const POINT_HEADERS = new Set(['POD', 'CODICEPOD', 'NUMEROPOD', 'PDR', 'CODICEPDR', 'NUMEROPDR',
  'PODPDR', 'PODOPDR', 'CODICEPODPDR', 'CODICEPODOPDR', 'PUNTODIFORNITURA', 'CODICEPUNTODIFORNITURA']);
const PRIORITY = new Map(['Attivato', 'Nuovo', 'In attivazione', 'In lavorazione', 'Annullato', 'Rifiutato'].map((state, i) => [state, i + 1]));
const tax = (value, business) => {
  const normalized = code(value);
  if (business) return /^\d{1,11}$/.test(normalized) ? normalized.padStart(11, '0') : '';
  return /^[A-Z0-9]{16}$/.test(normalized) ? normalized : '';
};

function parse(input, { onlyTypes = false, requirePracticeType = false } = {}) {
  const { header, rows } = readCsv(input);
  const hasType = header.includes('TIPORICHIESTA');
  const points = header.flatMap((name, index) => POINT_HEADERS.has(name) ? [index] : []);
  const required = ['PROPOSTADICONTRATTO', 'CODICEFISCALE', 'PARTITAIVA', 'STATO'];
  if (onlyTypes && (!hasType || !header.includes(required[0]) ||
      !required.slice(1, 3).some(name => header.includes(name)))) return [];
  if (!onlyTypes && required.some(name => !header.includes(name))) {
    throw new Error('Servono le colonne Proposta di Contratto, Codice Fiscale, Partita Iva e Stato.');
  }
  if (!onlyTypes && !points.length) throw new Error('Il CSV non contiene la colonna POD/PDR.');
  if (requirePracticeType && !hasType) throw new Error('Il CSV non contiene la colonna Tipo Richiesta.');
  const columns = new Map(header.map((name, index) => [name, index]));
  const value = (row, name) => row[columns.get(name)]?.trim() || '';
  const sources = new Map();
  for (const [index, row] of rows.entries()) {
    const numero = code(value(row, 'PROPOSTADICONTRATTO'));
    const cf = tax(value(row, 'CODICEFISCALE'), false);
    const piva = tax(value(row, 'PARTITAIVA'), true);
    const state = value(row, 'STATO');
    const type = hasType ? value(row, 'TIPORICHIESTA').replace(/\s+/g, ' ') : '';
    const supply = [...new Set(points.map(i => code(row[i])).filter(v => v && v !== '-' && v !== '—'))];
    if (!(requirePracticeType && supply.length) && (!numero || (!cf && !piva))) continue;
    if (onlyTypes && (numero.length > 80 || supply.length && !supply.some(isPoint))) continue;
    if (!onlyTypes && (numero.length > 80 || state.length > 100 || supply.some(p => !isPoint(p)))) {
      throw new Error(`Numero contratto, POD/PDR o stato non valido alla riga ${index + 2}.`);
    }
    const rejection = name => state === 'Rifiutato' ? value(row, name).slice(0, 4000) || null : null;
    const usablePoints = supply.length ? supply.filter(isPoint) : [''];
    for (const punto of usablePoints) {
      const key = JSON.stringify([numero, punto, cf, piva]);
      const previous = sources.get(key);
      const types = previous?.types || new Set();
      if (type && type !== '-' && type !== '—') types.add(type);
      const priority = PRIORITY.get(state) || (state ? 0 : -1);
      if (previous && previous.priority >= priority) continue;
      sources.set(key, { priority, types, row: { numero, punto, cf, piva, stato: state || null,
        causale: rejection('CAUSALESTATOPRATICA'), messaggio: rejection('MESSAGGIOESITODASAP'), annullamento: rejection('CAUSAANNULLAMENTO') } });
    }
  }
  const result = Array.from(sources.values(), ({ row, types }) => {
    if (hasType) {
      const [type] = types;
      row.tipo_pratica = types.size === 1 && type.length <= 100 ? type : null;
    }
    return row;
  });
  if (!onlyTypes && !result.some(row => row.punto)) throw new Error('Il CSV non contiene punti di fornitura utilizzabili.');
  return result;
}

async function save(db, input, actor, { onlyTypes = false } = {}) {
  let rows;
  try {
    rows = parse(input, { onlyTypes, requirePracticeType: !onlyTypes });
  } catch (error) {
    error.statusCode = 400;
    throw error;
  }
  if (onlyTypes && !rows.some(row => Object.hasOwn(row, 'tipo_pratica'))) return {};
  const { data, error } = onlyTypes
    ? await db.rpc('vendita_energia_importa_tipi', { p_righe: rows })
    : await db.rpc('vendita_energia_importa_csv', {
      p_hash: createHash('sha256').update(input).digest('hex'), p_autore: actor, p_righe: rows
    });
  if (error) throw new Error('Il caricamento del CSV non è riuscito. Riprova.');
  return { ...data, righe: rows.length };
}

module.exports = { parse, save, code, isPoint, tax };
