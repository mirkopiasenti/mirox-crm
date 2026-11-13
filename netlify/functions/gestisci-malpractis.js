'use strict';
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { generateMalpractisPdf } = require('./_lib/pdf-malpractis');
const Core = require('../../js/malpractis-core');
const crypto = require('node:crypto');
const BUCKET = 'malpractis-files';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_FIELDS = 'id,intestatario,cf_piva,numero_fisso,stato_linea,nome_file,created_at';
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
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
async function signed(client, row) {
  if (row.storage_bucket !== BUCKET) fail(404, 'PDF non trovato');
  const { data, error } = await client.storage.from(BUCKET).createSignedUrl(row.storage_path, 300);
  if (error || !data?.signedUrl) throw new Error('PDF non disponibile');
  return data.signedUrl;
}
async function find(client, id) {
  if (!UUID.test(String(id || ''))) fail(400, 'Identificativo non valido');
  const { data, error } = await client.from('malpractis_generati').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}
async function generate(client, auth, body, makePdf) {
  const data = Core.validate(body.modulo);
  const id = String(body.request_id || '').toLowerCase();
  if (!UUID.test(id)) fail(400, 'Richiesta non valida: ricarica il compilatore');
  const author = auth.user.id;
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  const previous = await find(client, id);
  if (previous) {
    if (previous.created_by !== author || previous.richiesta_sha256 !== requestHash) fail(409, 'Richiesta già utilizzata per dati diversi');
    return reply(200, { success: true, modulo: Object.fromEntries(LIST_FIELDS.split(',').map(k => [k, previous[k]])), signed_url: await signed(client, previous) });
  }
  const result = await makePdf(data);
  const filename = `malpractis-${data.cf_piva}-${data.data}.pdf`;
  const storagePath = `${author}/${id}/${filename}`;
  const { error: uploadError } = await client.storage.from(BUCKET).upload(storagePath, result.buffer, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw uploadError;
  const row = { id, intestatario: data.intestatario, cf_piva: data.cf_piva, numero_fisso: data.numero_fisso, stato_linea: data.stato_linea,
    dati_compilazione: data, richiesta_sha256: requestHash, storage_bucket: BUCKET, storage_path: storagePath, nome_file: filename,
    pdf_sha256: crypto.createHash('sha256').update(result.buffer).digest('hex'), template_versione: 'ask-03-2020-v4', created_by: author,
    created_by_nome: String(auth.profilo?.nome || auth.profilo?.username || 'Operatore Mirox').slice(0, 250) };
  const { data: saved, error } = await client.from('malpractis_generati').insert(row).select(LIST_FIELDS).single();
  if (error) {
    await client.storage.from(BUCKET).remove([storagePath]);
    throw error;
  }
  return reply(200, { success: true, modulo: saved, signed_url: await signed(client, row) });
}
async function handle(event, deps = {}) {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { error: 'Metodo non consentito' });
  const auth = await (deps.requireAuth || requireAuth)(event, { endpoint: 'gestisci-malpractis' });
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  try {
    const client = (deps.getAdminClient || getAdminClient)();
    if (event.httpMethod === 'GET') {
      const params = event.queryStringParameters || {};
      if (params.action === 'search_anagrafica') return reply(200, { success: true, anagrafiche: await search(client, params.q) });
      if (params.action && params.action !== 'list') return reply(400, { error: 'Azione non valida' });
      const page = Math.max(1, Math.min(10000, parseInt(params.page, 10) || 1)), size = 50;
      const { data, error, count } = await client.from('malpractis_generati').select(LIST_FIELDS, { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * size, page * size - 1);
      if (error) throw error;
      return reply(200, { success: true, moduli: data || [], page, has_more: page * size < count });
    }
    if (String(event.body || '').length > 16000) return reply(413, { error: 'Richiesta troppo grande' });
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Richiesta JSON non valida' }); }
    if (body?.action === 'generate') return await generate(client, auth, body, deps.generate || generateMalpractisPdf);
    if (['signed_url', 'duplicate_data'].includes(body?.action)) {
      const row = await find(client, body.id);
      if (!row) fail(404, 'Segnalazione non trovata');
      if (body.action === 'duplicate_data') return reply(200, { success: true, modulo: row.dati_compilazione });
      return reply(200, { success: true, signed_url: await signed(client, row), nome_file: row.nome_file });
    }
    return reply(400, { error: 'Azione non valida' });
  } catch (error) {
    const invalid = /obbligatori|non valid|troppo lung|troppa|massimo|un solo motivo|caratteri non supportati|riduci|scelta|da 2 a 80/.test(error.message || '');
    return reply(error.status || (invalid ? 400 : 503), { error: error.status || invalid ? error.message : 'Impossibile completare l’operazione. I dati restano disponibili: riprova.' });
  }
}
exports.handler = event => handle(event);
exports._test = { handle, search };
