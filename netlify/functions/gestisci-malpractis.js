'use strict';
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { generateMalpractisPdf } = require('./_lib/pdf-malpractis');
const Core = require('../../js/malpractis-core');
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
async function search(client, query) {
  const q = String(query || '').trim().replace(/\s+/g, ' ');
  if (q.length < 2 || q.length > 80 || !/[\p{L}\p{N}]{2}/u.test(q)) throw new Error('Ricerca non valida: inserisci da 2 a 80 caratteri');
  const literal = q.replace(/[\\%_]/g, '\\$&');
  const results = await Promise.all(['cf_piva', 'ragione_sociale', 'nome_referente'].map(column => client.from('anagrafica')
    .select('id,cf_piva,ragione_sociale,nome_referente,cellulare,email').ilike(column, `%${literal}%`).limit(12)));
  if (results.some(r => r.error)) throw new Error('Impossibile cercare l’anagrafica. Riprova.');
  const unique = new Map();
  for (const row of results.flatMap(r => r.data || [])) unique.set(row.id, { id: row.id, display_name: row.ragione_sociale || row.nome_referente || row.cf_piva, cf_piva: row.cf_piva, prefill: Core.prefill(row) });
  return [...unique.values()].sort((a, b) => String(a.display_name).localeCompare(String(b.display_name), 'it')).slice(0, 20);
}
async function handle(event, deps = {}) {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { error: 'Metodo non consentito' });
  const auth = await (deps.requireAuth || requireAuth)(event, { endpoint: 'gestisci-malpractis' });
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    if (event.httpMethod === 'GET') {
      if (event.queryStringParameters?.action !== 'search_anagrafica') return reply(400, { error: 'Azione non valida' });
      return reply(200, { success: true, anagrafiche: await search((deps.getAdminClient || getAdminClient)(), event.queryStringParameters.q) });
    }
    if (String(event.body || '').length > 16000) return reply(413, { error: 'Richiesta troppo grande' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Richiesta JSON non valida' }); }
    if (body?.action !== 'generate') return reply(400, { error: 'Azione non valida' });
    const result = await (deps.generate || generateMalpractisPdf)(body.modulo);
    return reply(200, { success: true, pdf_base64: result.buffer.toString('base64'), nome_file: `malpractis-${result.data.cf_piva}-${result.data.data}.pdf` });
  } catch (error) {
    const invalid = /obbligatori|non valid|troppo lung|troppa|massimo|almeno|caratteri non supportati|riduci|scelta|da 2 a 80/.test(error.message || '');
    return reply(invalid ? 400 : 503, { error: invalid ? error.message : 'Impossibile preparare il modulo o cercare l’anagrafica. Riprova.' });
  }
}
exports.handler = event => handle(event);
exports._test = { handle, search };
