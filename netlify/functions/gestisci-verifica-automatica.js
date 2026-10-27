'use strict';
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const Core = require('../../js/verifica-contratti-core');
const Csv = require('./_lib/verifica-csv');
const Docs = require('./_lib/verifica-documenti');
const Worker = require('./_lib/verifica-worker');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: JSON.stringify(body) });
const checked = Docs.checked;
async function handler(event, deps = {}) {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Usa POST.' });
  const auth = await (deps.requireAuth || requireAuth)(event);
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Richiesta non valida.' }); }
  if (!body || Array.isArray(body) || typeof body !== 'object') return reply(400, { error: 'Richiesta non valida.' });
  const db = deps.db || getAdminClient();
  if (!db) return reply(503, { error: 'Servizio non disponibile.' });
  const admin = auth.profilo?.ruolo === 'admin';
  try {
    const cfg = await Worker.config(db);
    if (body.action === 'status') {
      const fields = 'contratto_id,esito,revisione,prossimo_at,primo_tentativo_at,ultimo_tentativo_at,stato_job,modalita_job,data_firma,motivi,risultato,errore_codice,updated_at';
      const [pending, completed] = await Promise.all([
        db.from('vendita_verifiche').select(fields).neq('esito', 'controllato').order('updated_at', { ascending: false }).limit(1000),
        db.from('vendita_verifiche').select(fields).eq('esito', 'controllato').order('updated_at', { ascending: false }).limit(1000)
      ]);
      const reviews = [...checked(pending), ...checked(completed)];
      const csv = checked(await db.from('vendita_verifica_csv').select('id,nome_file,created_at').order('created_at', { ascending: false }).order('id').limit(1).maybeSingle());
      // Never return raw PDFs, CSV rows, evidence or AI payloads in list responses.
      const summaries = reviews.map(r => ({ ...r, risultato: r.risultato ? { esito: r.risultato.esito, checks: r.risultato.checks, errors: r.risultato.errors, waiting: r.risultato.waiting, patch: r.risultato.patch, signature_date: r.risultato.signature_date } : null }));
      const notifications = admin ? checked(await db.from('vendita_verifica_notifiche').select('id,contratto_id,tipo,stato,updated_at').order('updated_at', { ascending: false }).limit(100)) : [];
      return reply(200, { success: true, modalita: cfg.modalita, admin, reviews: summaries, csv, notifications });
    }
    if (body.action === 'configure') {
      if (!admin) return reply(403, { error: 'Operazione riservata agli amministratori.' });
      if (!['spenta', 'collaudo', 'attiva'].includes(body.modalita)) return reply(400, { error: 'Modalità non valida.' });
      checked(await db.from('vendita_verifica_config').update({ modalita: body.modalita, updated_by: auth.profilo.alias_di || auth.profilo.id, updated_at: new Date().toISOString() }).eq('id', true));
      if (body.modalita === 'attiva') { checked(await db.rpc('vendita_verifica_sync')); await (deps.wake || Worker.wake)(db); }
      return reply(200, { success: true });
    }
    if (body.action === 'upload_csv') {
      if (!admin) return reply(403, { error: 'Caricamento CSV riservato agli amministratori.' });
      const rows = Csv.parseCsv(body.csv), fileName = String(body.nome_file || 'WindTre.csv').replace(/[\r\n]/g, '').slice(0, 200);
      const id = checked(await db.rpc('vendita_verifica_import_csv', { p_name: fileName, p_hash: Docs.hash(Buffer.from(body.csv)), p_text: body.csv, p_rows: rows, p_user: auth.profilo.alias_di || auth.profilo.id }));
      await (deps.wake || Worker.wake)(db);
      return reply(200, { success: true, id, righe: rows.length });
    }
    if (['notification_received', 'notification_retry'].includes(body.action)) {
      if (!admin) return reply(403, { error: 'Operazione riservata agli amministratori.' });
      if (!UUID.test(String(body.notification_id || ''))) return reply(400, { error: 'Notifica non valida.' });
      const retry = body.action === 'notification_retry';
      if (retry && cfg.modalita !== 'attiva') return reply(409, { error: 'Il reinvio richiede la modalità attiva.' });
      const updated = checked(await db.from('vendita_verifica_notifiche').update({ stato: retry ? 'in_coda' : 'inviata', tentativi: 0,
        prossimo_at: new Date().toISOString(), lock_token: null, gestita_da: auth.profilo.alias_di || auth.profilo.id,
        gestita_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', body.notification_id).in('stato', ['incerta', 'fallita']).select('id').maybeSingle());
      if (!updated) return reply(409, { error: 'La notifica è già stata gestita. Aggiorna la pagina.' });
      if (retry) await (deps.wake || Worker.wake)(db);
      return reply(200, { success: true });
    }
    if (!UUID.test(String(body.contratto_id || ''))) return reply(400, { error: 'Contratto non valido.' });
    if (!['preview', 'retry', 'set_signing_date'].includes(body.action)) return reply(400, { error: 'Azione non valida.' });
    const c = checked(await db.from('vendita_contratti').select('id,stato_controllo,pratica_id').eq('id', body.contratto_id).single());
    const p = checked(await db.from('vendita_pratiche').select('stato_pratica').eq('id', c.pratica_id).single());
    if (c.stato_controllo !== 'da_controllare' || p.stato_pratica !== 'inviata') return reply(409, { error: 'Il contratto deve essere inviato e ancora da controllare.' });
    checked(await db.rpc('vendita_verifica_sync'));
    const review = checked(await db.from('vendita_verifiche').select('*').eq('contratto_id', c.id).single());
    if (review.lock_until && Date.parse(review.lock_until) > Date.now()) return reply(409, { error: 'Analisi già in corso. Attendi l’esito.' });
    if (body.action === 'preview' && !admin) return reply(403, { error: 'Collaudo riservato agli amministratori.' });
    if (body.action === 'retry' && !review.primo_tentativo_at) return reply(409, { error: 'La prima verifica è prevista alle 21:00. Puoi usare il collaudo senza confermare il contratto.' });
    if (body.action === 'preview' && review.ultimo_tentativo_at && Date.now() - Date.parse(review.ultimo_tentativo_at) < 60000) return reply(429, { error: 'Attendi un minuto prima di ripetere il collaudo.' });
    if (cfg.modalita === 'spenta') return reply(409, { error: 'Verifica automatica disattivata.' });
    const patch = { revisione: review.revisione + 1, tentativi: 0, lock_token: null, lock_until: null, errore_codice: null, updated_at: new Date().toISOString() };
    if (body.action === 'set_signing_date') {
      if (!Core.date(body.data_firma) || body.data_firma > Core.romeDay(new Date())) return reply(400, { error: 'Data firma non valida.' });
      patch.data_firma = body.data_firma; patch.data_firma_da = auth.profilo.alias_di || auth.profilo.id; patch.data_firma_at = new Date().toISOString();
    }
    const test = body.action === 'preview';
    patch.modalita_job = test ? 'collaudo' : 'automatica';
    patch.stato_job = 'in_coda';
    patch.prossimo_at = test || review.primo_tentativo_at ? new Date().toISOString() : review.primo_turno_at;
    const updated = checked(await db.from('vendita_verifiche').update(patch).eq('contratto_id', c.id).eq('revisione', review.revisione)
      .or('lock_until.is.null,lock_until.lt.' + new Date().toISOString()).select('contratto_id').maybeSingle());
    if (!updated) return reply(409, { error: 'La pratica è cambiata. Aggiorna e riprova.' });
    if (test) await (deps.nudge || Worker.nudge)({ id: c.id, test: true });
    else if (cfg.modalita === 'attiva' && review.primo_tentativo_at) await (deps.nudge || Worker.nudge)({ id: c.id });
    return reply(202, { success: true, collaudo: test });
  } catch (error) {
    if (error.message?.startsWith('CSV') || /colonne|righe|riga|POD\/PDR|Virgolette|virgolette|Servono/.test(error.message || '')) return reply(400, { error: error.message });
    console.error('Verifica automatica: richiesta non completata.');
    return reply(503, { error: 'Verifica automatica non disponibile. Controlla configurazione e migrazione del modulo.' });
  }
}
module.exports = { handler };
