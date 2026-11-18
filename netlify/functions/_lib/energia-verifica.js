'use strict';

const { code, isPoint } = require('./energia-csv');

async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) throw error;
  return data;
}

function saveResult(db, { contratto_id, updated_at, contesto, lease, csv_id }, result, author = null) {
  return rpc(db, 'vendita_energia_riscontra', {
    p_id: contratto_id, p_updated: updated_at, p_contesto: contesto,
    p_lease: lease || null, p_csv_id: csv_id || null, p_punto: result.punto || null,
    p_gestore: result.gestore || null, p_motivo: result.motivo || null, p_autore: author
  });
}

async function manual(db, body, author) {
  const { contratto_id, expected_updated_at, ex_fornitore } = body;
  const punto = code(body.pod_pdr);
  const gestore = typeof ex_fornitore === 'string' ? ex_fornitore.trim() : '';
  if (!isPoint(punto) || gestore.length < 2 || gestore.length > 160 || !/^[\p{L}\p{N} .&'’()+-]+$/u.test(gestore)
    || typeof expected_updated_at !== 'string' || !Number.isFinite(Date.parse(expected_updated_at)) || body.attestazione !== true || !author) {
    throw Object.assign(new Error('Inserisci il POD/PDR, il gestore uscente e conferma la lettura della bolletta.'), { statusCode: 400 });
  }
  const contesto = await rpc(db, 'vendita_energia_contesto_manuale', { p_id: contratto_id });
  if (!contesto) throw Object.assign(new Error('Pratica Energia in attesa non trovata.'), { statusCode: 404 });
  const result = await saveResult(db, { contratto_id, updated_at: expected_updated_at, contesto }, { punto, gestore }, author);
  if (!result) throw Object.assign(new Error('La pratica è cambiata. Ricaricala e riprova.'), { statusCode: 409 });
  return result;
}

async function drain(db, readBill, { budgetMs = 5 * 60_000, now = Date.now } = {}) {
  const start = now();
  do {
    const claim = await rpc(db, 'vendita_energia_prossimo', { p_prendi: true });
    if (!claim) return;
    let result;
    try {
      result = claim.contesto.fiscale ? await readBill(db, claim.contesto) : { motivo: 'cliente_incompleto' };
    } catch {
      result = { motivo: 'errore_lettura' };
    }
    await saveResult(db, claim, result);
  } while (now() - start < budgetMs);
}

module.exports = { manual, drain };
