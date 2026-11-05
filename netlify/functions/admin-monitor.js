'use strict';
const {requireAuth,getAdminClient} = require('./_lib/require-auth');
const {authorizePages} = require('./_lib/page-permissions');
const D = require('./_lib/monitor-device');
const reply = (statusCode,data) => ({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(data)});
async function handle(event,deps={}) {
  if (!['GET','POST'].includes(event.httpMethod)) return reply(405,{error:'Metodo non consentito'});
  const auth = await (deps.requireAuth || requireAuth)(event,{adminOnly:true});
  if (!auth.ok) return reply(auth.status,{error:auth.error});
  const db = (deps.getAdminClient || getAdminClient)();
  const fresh = await (deps.authorizePages || authorizePages)(db,auth,[]);
  if (!fresh.ok) return reply(fresh.status,{error:fresh.error});
  if (fresh.profilo.ruolo !== 'admin') return reply(403,{error:'Accesso riservato agli amministratori'});
  try {
    if (event.httpMethod === 'GET') {
      const devices = D.checked(await db.from(D.TABLE).select(D.PUBLIC_FIELDS).order('created_at',{ascending:false}).limit(200));
      return reply(200,{dispositivi:devices});
    }
    if ((event.body || '').length > 4096) D.fail('Richiesta troppo estesa.');
    let body; try {body=JSON.parse(event.body || '{}');} catch {D.fail('Richiesta non valida.');}
    if (!body || typeof body !== 'object') D.fail('Richiesta non valida.');
    if (body.action === 'crea') {
      if (typeof body.nome !== 'string' || !body.nome.trim() || body.nome.length>80 || /[\x00-\x1f]/.test(body.nome)) D.fail('Inserisci un nome di massimo 80 caratteri.');
      const code = D.pairingCode();
      const device = D.checked(await db.rpc('mirox_monitor_amministra', {p_admin:fresh.user.id,p_azione:'crea',p_nome:body.nome.trim(),p_pairing_hash:D.hash(D.normalizeCode(code))}));
      return reply(200,{dispositivo:device,codice:code});
    }
    if (body.action !== 'revoca' || !/^[a-f0-9-]{36}$/i.test(body.id || '')) D.fail('Azione non valida.');
    const result = await db.rpc('mirox_monitor_amministra',{p_admin:fresh.user.id,p_azione:'revoca',p_id:body.id});
    if (result.error?.code === '22023') D.fail('Monitor non trovato.',404);
    return reply(200,{dispositivo:D.checked(result)});
  } catch (error) {return reply(error.status || 503,{error:error.status?error.message:'Servizio monitor non disponibile.'});}
}
exports.handler=event=>handle(event);
exports._test={handle};
