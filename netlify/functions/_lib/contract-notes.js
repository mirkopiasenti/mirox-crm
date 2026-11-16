'use strict';
const Core = require('../../../js/contratto-note-core');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const TABLE = 'vendita_note_contratto', SIZE = 50;
const FIELDS = 'id,contratto_id,testo,autore_nome,created_at';
function fail(statusCode, message) { throw Object.assign(new Error(message), { statusCode }); }
async function contract(db, id) {
  if (!UUID.test(String(id || ''))) fail(400, 'Contratto non valido.');
  const { data, error } = await db.from('vendita_contratti').select('id').eq('id', id).maybeSingle();
  if (error) fail(503, 'Impossibile leggere il contratto. Riprova.');
  if (!data) fail(404, 'Contratto non trovato.');
}
function publicNote(row) { return Object.fromEntries(FIELDS.split(',').map(k => [k, row[k]])); }
async function list({ supabase: db, body }) {
  const cursor = body.cursor;
  if (cursor != null && (typeof cursor !== 'object' || !UUID.test(cursor.id || '') || !DATE.test(cursor.created_at || '') || !Number.isFinite(Date.parse(cursor.created_at)))) fail(400, 'Cursore note non valido.');
  await contract(db, body.contratto_id);
  let query = db.from(TABLE).select(FIELDS).eq('contratto_id', body.contratto_id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(SIZE + 1);
  if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) fail(503, 'Impossibile caricare le note. Riprova.');
  const rows = data.slice(0, SIZE), last = rows.at(-1);
  return { note: rows.map(publicNote), next_cursor: data.length > SIZE ? { created_at: last.created_at, id: last.id } : null };
}
function same(row, body, actor, text) {
  if (row.contratto_id !== body.contratto_id.toLowerCase() || row.autore_id !== actor || row.testo !== text) fail(409, 'Questa richiesta è già stata utilizzata per una nota diversa.');
  return { nota: publicNote(row) };
}
async function add({ supabase: db, auth, body }) {
  if (!UUID.test(String(body.request_id || ''))) fail(400, 'Richiesta nota non valida. Riapri il dettaglio.');
  let text;
  try { text = Core.normalize(body.testo); } catch (error) { fail(400, error.message); }
  const actor = auth?.user?.id, name = String(auth?.profilo?.nome || '').trim();
  if (!UUID.test(actor || '') || !name || name.length > 250) fail(400, 'Autore non disponibile. Accedi nuovamente.');
  await contract(db, body.contratto_id);
  async function previous() {
    const r = await db.from(TABLE).select(FIELDS + ',autore_id').eq('id', body.request_id).maybeSingle();
    if (r.error) fail(503, 'Impossibile verificare il salvataggio della nota. Riprova.');
    return r.data;
  }
  const old = await previous();
  if (old) return same(old, body, actor, text);
  const row = { id: body.request_id, contratto_id: body.contratto_id, testo: text, autore_id: actor, autore_nome: name };
  const { data, error } = await db.from(TABLE).insert(row).select(FIELDS).single();
  if (error?.code === '23505') {
    const saved = await previous();
    if (saved) return same(saved, body, actor, text);
  }
  if (error?.code === '23503') fail(404, 'Il contratto non è più disponibile.');
  if (error || !data) fail(503, 'Impossibile confermare il salvataggio. Premi Riprova per verificare la stessa nota.');
  return { nota: publicNote(data) };
}
module.exports = { list, add };
