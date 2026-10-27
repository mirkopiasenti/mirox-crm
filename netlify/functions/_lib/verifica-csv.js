'use strict';
const { compact, norm } = require('../../../js/verifica-contratti-core');
const MAX_BYTES = 4 * 1024 * 1024;
function parseCsv(input) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > MAX_BYTES) throw new Error('CSV troppo grande (massimo 4 MB).');
  const rows = []; let row = [], cell = '', quoted = false, closed = false;
  const src = input.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (closed && ![';', '\n', '\r'].includes(c)) throw new Error('CSV non valido dopo le virgolette di chiusura.');
    if (c === '"') { if (quoted && src[i + 1] === '"') { cell += '"'; i++; } else if (!quoted && cell) throw new Error('Virgolette CSV non valide.'); else { closed = quoted; quoted = !quoted; } }
    else if (!quoted && (c === ';' || c === '\n' || c === '\r')) {
      row.push(cell); cell = ''; closed = false;
      if (c !== ';') { if (row.some(v => v.trim())) rows.push(row); row = []; if (c === '\r' && src[i + 1] === '\n') i++; }
    } else cell += c;
    if (cell.length > 20000 || rows.length > 30000 || row.length > 250) throw new Error('CSV oltre i limiti consentiti.');
  }
  if (quoted) throw new Error('CSV incompleto: virgolette non chiuse.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  if (rows.length < 2) throw new Error('Il CSV non contiene righe.');
  const header = rows.shift().map(v => norm(v).replace(/[^A-Z0-9]/g, ''));
  if (new Set(header).size !== header.length) throw new Error('Colonne duplicate nel CSV.');
  const idx = aliases => header.findIndex(h => aliases.includes(h));
  const pc = idx(['PROPOSTADICONTRATTO']), cf = idx(['CODICEFISCALE']), iva = idx(['PARTITAIVA']);
  const point = idx(['PODPDR', 'PODOPDR', 'CODICEPODPDR', 'CODICEPODOPDR', 'PUNTODIFORNITURA', 'CODICEPUNTODIFORNITURA']);
  const pod = idx(['POD', 'CODICEPOD', 'NUMEROPOD']), pdr = idx(['PDR', 'CODICEPDR', 'NUMEROPDR']);
  const signing = idx(['DATAFIRMA', 'DATASOTTOSCRIZIONE', 'DATAFIRMACONTRATTO']);
  if (pc < 0 || cf < 0 || iva < 0 || point < 0 && pod < 0 && pdr < 0) throw new Error('Servono le colonne Proposta di Contratto, Codice Fiscale, Partita Iva e POD/PDR.');
  const normalized = [];
  for (let n = 0; n < rows.length; n++) {
    const r = rows[n];
    if (r.length !== header.length) throw new Error(`Numero colonne non valido alla riga ${n + 2}.`);
    const numero = compact(r[pc]);
    const rawIva = compact(r[iva]);
    if (rawIva && !/^\d{1,11}$/.test(rawIva)) throw new Error(`Partita IVA non valida alla riga ${n + 2}.`);
    const fiscale = rawIva && /^\d{1,11}$/.test(rawIva) ? rawIva.padStart(11, '0') : compact(r[cf]);
    const points = [...new Set([point, pod, pdr].filter(i => i >= 0).map(i => compact(r[i])).filter(Boolean))];
    if (!numero || !fiscale || !points.length) continue;
    if (!/^(?:[A-Z0-9]{16}|\d{11})$/.test(fiscale) || !/^[A-Z0-9/-]{1,80}$/.test(numero)) throw new Error(`Dati identificativi non validi alla riga ${n + 2}.`);
    for (const punto of points) {
      if (!/^(?:IT[A-Z0-9]{12,15}|\d{14})$/.test(punto)) throw new Error(`POD/PDR non valido alla riga ${n + 2}.`);
      let data_firma = null;
      if (signing >= 0 && r[signing].trim()) {
        const raw = r[signing].trim(), match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
        data_firma = require('../../../js/verifica-contratti-core').date(match ? `${match[3]}-${match[2]}-${match[1]}` : raw);
        if (!data_firma) throw new Error(`Data firma non valida alla riga ${n + 2}.`);
      }
      normalized.push({ numero, fiscale, punto, riga: n + 2, data_firma });
    }
  }
  if (!normalized.length) throw new Error('Nessuna riga utilizzabile: controlla CF/P.IVA, numero contratto e POD/PDR.');
  return normalized;
}
module.exports = { parseCsv, MAX_BYTES };
