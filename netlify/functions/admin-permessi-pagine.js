'use strict';
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { authorizePages } = require('./_lib/page-permissions');
const Core = require('../../js/mirox-permissions-core');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const reply = (statusCode, data) => ({ statusCode, headers: {
  'Content-Type': 'application/json', 'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}, body: JSON.stringify(data) });

async function handle(event, deps = {}) {
  if (event.httpMethod === 'OPTIONS') return reply(200, {});
  if (!['GET', 'POST'].includes(event.httpMethod)) return reply(405, { error: 'Metodo non consentito' });
  const auth = await (deps.requireAuth || requireAuth)(event, { adminOnly: true });
  if (!auth.ok) return reply(auth.status, { error: auth.error });
  const client = (deps.getAdminClient || getAdminClient)();
  const fresh = await (deps.authorizePages || authorizePages)(client, auth, []);
  if (!fresh.ok) return reply(fresh.status, { error: fresh.error });
  try {
    if (event.httpMethod === 'GET') {
      const id = event.queryStringParameters?.utente_id;
      if (id) {
        if (!UUID.test(id)) return reply(400, { error: 'Utente non valido' });
        const { data, error } = await client.from('mirox_permessi_audit')
          .select('id,utente_id,autore_id,prima,dopo,versione,created_at').eq('utente_id', id)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(30);
        if (error) throw error;
        return reply(200, { audit: data });
      }
      const users = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.from('profili')
          .select('id,nome,username,ruolo,attivo,mirox_permessi_utente(pagine,versione,updated_at)')
          .order('nome').order('id').range(offset, offset + 499);
        if (error) throw error;
        users.push(...data);
        if (data.length < 500) break;
      }
      return reply(200, { utenti: users, pagine: Core.pages });
    }
    let body;
    try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { error: 'Richiesta non valida' }); }
    if (!body || !UUID.test(String(body.utente_id || '')) || !Number.isSafeInteger(body.versione) || body.versione < 0) {
      return reply(400, { error: 'Utente o versione non validi' });
    }
    let pages;
    try { pages = Core.normalize(body.pagine); } catch (e) { return reply(400, { error: e.message }); }
    const { data, error } = await client.rpc('mirox_salva_permessi_pagine', {
      p_admin_id: fresh.user.id, p_utente_id: body.utente_id, p_pagine: pages, p_versione: body.versione
    });
    if (error?.code === '40001') return reply(409, { error: 'I permessi sono stati modificati da un altro amministratore. Ricarica prima di salvare.' });
    if (['22023', '42501'].includes(error?.code)) return reply(error.code === '42501' ? 403 : 400, { error: 'Utente non modificabile o permessi non validi' });
    if (error) throw error;
    return reply(200, { permessi: data });
  } catch (_) {
    return reply(503, { error: 'Impossibile caricare o salvare i permessi. Riprova.' });
  }
}
exports.handler = event => handle(event);
exports._test = { handle };
