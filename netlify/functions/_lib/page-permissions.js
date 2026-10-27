'use strict';
const Core = require('../../../js/mirox-permissions-core');

// Nessuna cache delle ACL: una revoca protegge la successiva operazione server.
async function authorizePages(client, auth, pages) {
  try {
    const { data: profile, error: profileError } = await client.from('profili')
      .select('*').eq('id', auth.user.id).single();
    if (profileError || !profile) throw new Error('Profilo non disponibile');
    if (profile.attivo === false) return { ok: false, status: 403, error: 'Account disabilitato' };
    if (profile.ruolo === 'admin') return { ...auth, profilo: profile };
    const { data, error } = await client.from('mirox_permessi_utente')
      .select('pagine,versione').eq('utente_id', auth.user.id).maybeSingle();
    if (error) throw error;
    if (!pages.some(key => Core.can(profile, data?.pagine, key))) {
      return { ok: false, status: 403, error: 'Accesso non autorizzato a questa funzione' };
    }
    return { ...auth, profilo: profile };
  } catch (_) {
    return { ok: false, status: 503, error: 'Impossibile verificare i permessi. Riprova.' };
  }
}

async function authorizeEndpoint(client, auth, options, event) {
  if (!options.endpoint) return auth;
  const pages = Core.endpointPages(options.endpoint, event);
  if (pages === null) throw new Error(`Endpoint permessi non censito: ${options.endpoint}`);
  const result = await authorizePages(client, auth, pages);
  if (result.ok && options.adminOnly && result.profilo.ruolo !== 'admin') {
    return { ok: false, status: 403, error: 'Operazione riservata agli amministratori' };
  }
  return result;
}
module.exports = { authorizePages, authorizeEndpoint };
