'use strict';
const crypto = require('node:crypto');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { authorizePages } = require('./_lib/page-permissions');
const Core = require('../../js/segnalazione-mobile-core');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JOBS = 'segnalazioni_mobile_richieste';
const BUCKET = 'segnalazioni-files';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const reply = (statusCode, data) => ({ statusCode, headers, body: JSON.stringify(data) });
const hash = data => crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
function fail(status, message, reset = false) { throw Object.assign(new Error(message), { status, reset }); }
async function read(query) { const { data, error } = await query; if (error) throw error; return data; }

// Le fonti sono sempre rilette dal contratto, mai ricevute dal browser.
async function source(client, id, expected) {
  const c = await read(client.from('vendita_contratti').select('id,pratica_id,anagrafica_id,categoria_id,categoria_snapshot,codice_contratto,numero_telefono,numero_mnp,numero_provvisorio,updated_at').eq('id', id).maybeSingle());
  if (!c) fail(404, 'Contratto non trovato.', true);
  const category = await read(client.from('vendita_categorie').select('nome').eq('id', c.categoria_id).single());
  if (!Core.isMobile(category?.nome) || !Core.isMobile(c.categoria_snapshot)) fail(400, 'La segnalazione è disponibile solo per i contratti Mobile.', true);
  if (!expected || c.updated_at !== expected) fail(409, 'Il contratto è cambiato. Riapri il dettaglio prima di procedere.', true);
  const [a, docs, codes] = await Promise.all([
    read(client.from('anagrafica').select('id,ragione_sociale,cf_piva,nome_referente,cellulare,email,provincia,comune,via,civico').eq('id', c.anagrafica_id).single()),
    read(client.from('vendita_documenti').select('id,pratica_id,contratto_id,anagrafica_id,storage_bucket,storage_path,file_name,file_size,sha256,uploaded_at').eq('contratto_id', id).order('id')),
    read(client.from('anagrafica_codici_cliente_windtre').select('codice_cliente').eq('anagrafica_id', c.anagrafica_id).order('codice_cliente'))
  ]);
  if (!a?.ragione_sociale?.trim() || !a.cf_piva?.trim()) fail(400, 'Completa ragione sociale e CF/P.IVA del cliente prima di aprire la segnalazione.', true);
  if (!Array.isArray(docs) || !docs.length) fail(400, 'Il contratto non ha allegati. Completa gli allegati prima di procedere.', true);
  for (const d of docs) {
    if (d.pratica_id !== c.pratica_id || d.anagrafica_id !== c.anagrafica_id || d.contratto_id !== c.id || d.storage_bucket !== 'contratti-vendita' || !UUID.test(d.id) || !d.storage_path || d.storage_path.split('/').some(p => !p || p === '..' || p === '.')) {
      fail(409, 'Gli allegati del contratto richiedono una verifica prima della segnalazione.', true);
    }
  }
  return { c, a, docs, codes: (codes || []).map(r => r.codice_cliente) };
}
function record(s, auth, choice) {
  const { c, a, codes } = s;
  const lines = [choice.motivo, choice.note && `Note: ${choice.note}`, '', `Contratto Mobile: ${c.codice_contratto || c.id}`,
    `Cliente: ${a.ragione_sociale}`, `CF/P.IVA: ${a.cf_piva}`, a.nome_referente && `Referente: ${a.nome_referente}`,
    a.cellulare && `Contatto: ${a.cellulare}`, a.email && `Email: ${a.email}`,
    [a.via, a.civico, a.comune, a.provincia].some(Boolean) && `Indirizzo: ${[a.via, a.civico, a.comune, a.provincia].filter(Boolean).join(' ')}`,
    codes.length && `Codici cliente WindTre: ${codes.join(', ')}`,
    c.numero_telefono && `Numero linea: ${c.numero_telefono}`, c.numero_mnp && `Numero MNP: ${c.numero_mnp}`,
    c.numero_provvisorio && `Numero provvisorio: ${c.numero_provvisorio}`].filter(v => v !== false && v !== 0 && v != null);
  return { stato: 'Da gestire', operatore: auth.profilo.nome.trim(), ragione_sociale: a.ragione_sociale,
    codice_fiscale_piva: a.cf_piva, numero_contatto: a.cellulare || '', ...Core.gestione(choice.motivo), dettagli_segnalazione: lines.join('\n') };
}
function filename(doc) {
  const name = String(doc.file_name || 'allegato.pdf').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-160);
  return `${doc.id}_${name}`;
}
async function completed(client, job) {
  const row = await read(client.from('segnalazioni').select('id').eq('id', job.segnalazione_id).maybeSingle());
  if (!row) fail(409, 'La segnalazione precedentemente creata non è più disponibile.');
  return reply(200, { success: true, segnalazione_id: row.id, allegati: job.allegati.length });
}
async function handle(event, deps = {}) {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Metodo non consentito.' });
  const auth = await (deps.requireAuth || requireAuth)(event, { endpoint: 'apri-segnalazione-mobile' });
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  let client, job, lease;
  try {
    client = (deps.getAdminClient || getAdminClient)();
    const access = await (deps.authorizePages || authorizePages)(client, auth, ['segnalazioni']);
    if (!access.ok) return reply(access.status, { error: access.error });
    auth.profilo = access.profilo;
    if (!auth.profilo?.nome?.trim()) fail(400, 'Nome operatore non disponibile. Accedi nuovamente.', true);
    if (String(event.body || '').length > 20000) fail(413, 'Richiesta troppo grande.', true);
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { fail(400, 'Richiesta JSON non valida.', true); }
    if (!body || !UUID.test(body.request_id) || !UUID.test(body.contratto_id)) fail(400, 'Identificativo della richiesta non valido.', true);
    let choice;
    try { choice = Core.validate(body); } catch (e) { fail(400, e.message, true); }
    const id = body.request_id.toLowerCase(), contractId = body.contratto_id.toLowerCase();
    const requestHash = hash({ contractId, expected: body.expected_updated_at, ...choice });
    const existing = await read(client.from(JOBS).select('*').eq('id', id).maybeSingle());
    if (existing && (existing.created_by !== auth.user.id || existing.richiesta_sha256 !== requestHash)) fail(409, 'Richiesta già utilizzata per dati diversi.');
    if (existing?.completata) return await completed(client, existing);
    if (existing?.lease_fino && new Date(existing.lease_fino).getTime() > Date.now()) fail(409, 'Creazione già in corso. Attendi qualche istante e premi Riprova.');
    const s = await source(client, contractId, body.expected_updated_at);
    const sourceHash = hash(s);
    lease = crypto.randomUUID();
    const result = await client.rpc('prepara_segnalazione_mobile', {
      p_id: id, p_autore: auth.user.id, p_contratto: contractId, p_richiesta: requestHash, p_sorgente: sourceHash,
      p_dati: record(s, auth, choice), p_allegati: s.docs.map(d => ({ ...d, nome_destinazione: filename(d) })), p_lease: lease
    });
    if (result.error) {
      if (result.error.message?.includes('MOBILE_BUSY')) fail(409, 'Creazione già in corso. Attendi qualche istante e premi Riprova.');
      if (result.error.message?.includes('MOBILE_SOURCE_CHANGED')) fail(409, 'I dati del cliente o gli allegati sono cambiati. Riapri il dettaglio.', true);
      if (result.error.message?.includes('MOBILE_CONFLICT')) fail(409, 'Richiesta già utilizzata per dati diversi.');
      throw result.error;
    }
    job = result.data;
    if (job.completata) return await completed(client, job);
    const destination = client.storage.from(BUCKET);
    // Copia Storage server-side: nessun download in memoria e nessuna modifica agli originali.
    for (const d of job.allegati) {
      const path = `segnalazione_${job.segnalazione_id}/${d.nome_destinazione}`;
      const { error } = await client.storage.from(d.storage_bucket).copy(d.storage_path, path, { destinationBucket: BUCKET });
      if (error && ![error.statusCode, error.code, error.error].some(v => ['409', 'Duplicate', 'ResourceAlreadyExists'].includes(String(v)))) throw error;
      // Anche un retry su un file già copiato deve verificarne la presenza.
      const info = await destination.info(path);
      if (info.error || !info.data || (d.file_size != null && Number(info.data.size) !== Number(d.file_size))) throw new Error('Allegato non copiato integralmente');
    }
    if (hash(await source(client, contractId, body.expected_updated_at)) !== sourceHash) fail(409, 'Il cliente o gli allegati sono cambiati durante la copia. Riapri il dettaglio.', true);
    const finalized = await client.rpc('completa_segnalazione_mobile', { p_id: id, p_lease: lease });
    if (finalized.error) throw finalized.error;
    return reply(200, { success: true, segnalazione_id: finalized.data, allegati: job.allegati.length });
  } catch (error) {
    // Non eliminare copie su un esito DB incerto: un retry verifica il completamento.
    if (job && !job.completata) {
      try { await client.from(JOBS).update({ lease_id: null, lease_fino: null }).eq('id', job.id).eq('lease_id', lease).eq('completata', false); } catch (_) { /* La scadenza della lease consente il retry dopo un timeout. */ }
    }
    return reply(error.status || 503, { error: error.status ? error.message : 'Impossibile completare la segnalazione. Premi Riprova per riprendere la stessa richiesta.', reset_request: error.reset === true });
  }
}
exports.handler = event => handle(event);
exports._test = { handle, source, record, filename };
