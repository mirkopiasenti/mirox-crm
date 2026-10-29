'use strict';
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const Core = require('../../js/planning-core');
const headers = {'Content-Type':'application/json', 'Cache-Control':'no-store', 'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'Content-Type, Authorization', 'Access-Control-Allow-Methods':'GET, POST, OPTIONS'};
const reply = (statusCode,data) => ({statusCode,headers,body:JSON.stringify(data)});
async function checked(query) { const {data,error} = await query; if (error) throw error; return data; }
async function handle(event,deps={}) {
  if (event.httpMethod === 'OPTIONS') return reply(200,{});
  if (!['GET','POST'].includes(event.httpMethod)) return reply(405,{error:'Metodo non consentito'});
  const auth = await (deps.requireAuth || requireAuth)(event);
  if (!auth.ok) return reply(auth.status,{error:auth.error});
  const client = (deps.getAdminClient || getAdminClient)();
  try {
    // Rilettura a ogni chiamata: revoca del ruolo/account e associazioni subito efficaci.
    const profile = await checked(client.from('profili').select('id,ruolo,attivo').eq('id',auth.user.id).single());
    if (!profile || profile.attivo !== true) return reply(403,{error:'Account non attivo'});
    const admin = profile.ruolo === 'admin';
    let params = event.queryStringParameters || {};
    if (event.httpMethod === 'POST') {
      if ((event.body || '').length > 600000) return reply(413,{error:'Planning troppo grande'});
      try { params = JSON.parse(event.body || '{}'); } catch (_) { return reply(400,{error:'Richiesta non valida'}); }
      if (!params || typeof params !== 'object' || Array.isArray(params)) return reply(400,{error:'Richiesta non valida'});
    }
    const action = params.action || 'month';
    if (['save','publish','config_save'].includes(action) && (event.httpMethod !== 'POST' || !admin)) return reply(403,{error:'Operazione riservata agli amministratori'});
    if (!['month','pdf','config','config_save','save','publish','access'].includes(action)) return reply(400,{error:'Azione non valida'});
    if (['month','pdf','config','access'].includes(action) && event.httpMethod !== 'GET') return reply(405,{error:'Usa GET per la consultazione'});
    const configRow = await checked(client.from('personale_planning_config').select('documento,versione').eq('id',true).maybeSingle());
    const config = configRow ? Core.validateConfig(configRow.documento) : Core.defaultConfig();
    const ownEmployee = config.employees.find(e => e.profileId === auth.user.id);
    if (action === 'access') return reply(200,{allowed:admin || !!ownEmployee});
    if (!admin && !ownEmployee) return reply(403,{error:'Il tuo account non è ancora collegato a un dipendente. Contatta l’amministratore.'});
    if (action === 'config') {
      if (!admin) return reply(403,{error:'Accesso riservato agli amministratori'});
      const profiles = await checked(client.from('profili').select('id,nome,username,attivo').eq('attivo',true).order('nome').limit(500));
      return reply(200,{config,version:configRow?.versione || 0,profiles});
    }
    if (action === 'config_save') {
      let normalized;
      try { normalized = Core.validateConfig(params.config); } catch (e) { return reply(400,{error:e.message}); }
      const linked = normalized.employees.filter(e => e.profileId).map(e => e.profileId);
      if (linked.length) {
        const found = await checked(client.from('profili').select('id,attivo').in('id',linked));
        if (found.length !== linked.length || found.some(p => p.attivo !== true)) return reply(400,{error:'Collega soltanto account esistenti e attivi'});
      }
      if (!Number.isSafeInteger(params.version) || params.version < 0) return reply(400,{error:'Versione non valida'});
      const saved = await checked(client.rpc('personale_salva_config',{p_autore:auth.user.id,p_versione:params.version,p_documento:normalized}));
      return reply(200,{version:saved.versione,config:normalized});
    }
    let value;
    try { value = Core.month(params.month); } catch (e) { return reply(400,{error:e.message}); }
    if (['save','publish'].includes(action)) {
      if (!Number.isSafeInteger(params.version) || params.version < 0) return reply(400,{error:'Versione non valida'});
      let document;
      try { document = Core.validateDocument(params.document); } catch (e) { return reply(400,{error:e.message}); }
      if (document.month !== value) return reply(400,{error:'Il mese non coincide'});
      if (document.employees.some(e => !config.employees.some(c => c.id === e.id))) return reply(400,{error:'Dipendente non presente in configurazione'});
      if (action === 'publish' && !document.firstMondayOff) return reply(400,{error:'Scegli l’alternanza iniziale prima di approvare il planning'});
      const row = await checked(client.rpc('personale_salva_mese',{p_autore:auth.user.id,p_mese:`${value}-01`,p_versione:params.version,p_documento:document,p_pubblica:action==='publish'}));
      return reply(200,{row});
    }
    const row = await checked(client.from('personale_planning_mesi').select('mese,versione,bozza,pubblicato,pubblicato_versione,pubblicato_at,updated_at').eq('mese',`${value}-01`).maybeSingle());
    if (action === 'month') {
      if (admin) {
        const audit = await checked(client.from('personale_planning_audit').select('id,azione,versione,created_at').eq('mese',`${value}-01`).order('id',{ascending:false}).limit(20));
        return reply(200,{row,audit});
      }
      const document = row?.pubblicato ? Core.publicDocument(row.pubblicato,ownEmployee.id) : null;
      return reply(200,{document:document?.employees.length ? document : null,publishedAt:document?.employees.length ? row.pubblicato_at : null});
    }
    const type = params.type || 'personal';
    if (!['personal','collective','hours'].includes(type)) return reply(400,{error:'Tipo PDF non valido'});
    if (!admin && (type !== 'personal' || (params.employeeId && params.employeeId !== ownEmployee.id) || (params.source && params.source !== 'published'))) return reply(403,{error:'Puoi esportare soltanto il tuo planning pubblicato'});
    const source = admin ? (params.source || 'draft') : 'published';
    if (!['draft','published'].includes(source)) return reply(400,{error:'Versione PDF non valida'});
    const document = source === 'published' ? row?.pubblicato : row?.bozza;
    if (!document) return reply(404,{error:'Salva o pubblica il planning prima di esportarlo'});
    const employeeId = admin ? params.employeeId : ownEmployee.id;
    if (type !== 'collective' && !document.employees.some(e => e.id === employeeId)) return reply(404,{error:'Dipendente non presente nel mese'});
    const buffer = await (deps.generatePdf || require('./_lib/planning-pdf').generatePdf)(document,{type,employeeId,draft:source==='draft'});
    return {statusCode:200,headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="planning-${value}-${type}.pdf"`},isBase64Encoded:true,body:buffer.toString('base64')};
  } catch (error) {
    if (error?.code === '40001') return reply(409,{error:'Un altro amministratore ha modificato i dati. Ricarica prima di salvare; le tue modifiche restano aperte.'});
    if (error?.code === '42501') return reply(403,{error:'Operazione non autorizzata'});
    if (error?.code === '22023') return reply(400,{error:'Planning non valido'});
    return reply(503,{error:'Impossibile caricare o salvare il planning. Riprova.'});
  }
}
exports.handler = event => handle(event);
exports._test = {handle};
