'use strict';
const Busboy = require('busboy');
const Identity = require('./_lib/identita-upload');
const Business = require('./_lib/pda-business-identity');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const reply = (statusCode, data) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(data) });
function multipart(event) {
  return new Promise((resolve, reject) => {
    const fields = {}, files = []; let total = 0, invalid = false;
    const parser = Busboy({ headers: { 'content-type': event.headers?.['content-type'] || event.headers?.['Content-Type'] },
      limits: { files: 4, fileSize: 20 * 1024 * 1024, fields: 6, fieldSize: 12000 } });
    parser.on('field', (key, value) => { fields[key] = value; });
    parser.on('filesLimit', () => { invalid = true; });
    parser.on('file', (key, stream) => {
      const parts = [];
      stream.on('error', reject);
      stream.on('data', bytes => { total += bytes.length; if (total <= 20 * 1024 * 1024) parts.push(bytes); else invalid = true; });
      stream.on('limit', () => { invalid = true; });
      stream.on('end', () => { files.push({ buffer: Buffer.concat(parts) }); });
    });
    parser.on('error', reject);
    parser.on('finish', () => invalid ? reject(new Error('Massimo quattro PDF identita e 20 MB complessivi.')) : resolve({ fields, files }));
    parser.end(Buffer.from(event.body || '', event.isBase64Encoded ? 'base64' : 'binary'));
  });
}
async function handler(event, deps = {}) {
  if (event.httpMethod !== 'POST') return reply(405, { success: false, error: 'Metodo non consentito' });
  const auth = await (deps.requireAuth || requireAuth)(event, { endpoint: 'verifica-identita-upload' });
  if (!auth.ok) return reply(auth.status, { success: false, error: auth.error });
  try {
    const started = Date.now();
    deps={...deps,deadline:Math.min(deps.deadline||Infinity,started+42000)};
    const user = Identity.author(auth);
    if (!user) throw new Error('Account non valido');
    const json = /application\/json/i.test(event.headers?.['content-type'] || event.headers?.['Content-Type'] || '');
    if (json) {
      const body = JSON.parse(event.body || '{}');
      const data = Identity.verify(body.token, { user, secret: deps.secret || process.env.SUPABASE_SERVICE_ROLE_KEY });
      const confirmed = body.action === 'confirm_preview' ? Identity.confirmPreview(data, body) : Identity.confirm(data, body);
      return reply(200, { success: true, token: Identity.sign(confirmed, deps.secret), result: confirmed.result });
    }
    const { files, fields } = await (deps.multipart || multipart)(event);
    const Verification = require('../../js/verifica-contratti-core');
    if (!Verification.date(fields.data_firma) || fields.data_firma > Verification.romeDay(new Date())) throw new Error('Indica una data effettiva di firma valida e non futura.');
    const cliente = JSON.parse(fields.cliente || '{}');
    if (!/^(?:[A-Z0-9]{16}|[0-9]{11})$/.test(Identity.Core.customer(cliente).fiscale) || !Identity.Core.customer(cliente).nome) throw new Error('Completa l’anagrafica prima del controllo identita.');
    const prepared=Identity.prepareManual(files,cliente,fields.data_firma);
    if(fields.action&&!['manual_preview'].includes(fields.action))throw new Error('Azione controllo identita non valida.');
    const issues=[];let saved=null;
    const db = deps.db || getAdminClient();
    try{
      const existing = await db.from('anagrafica').select('cf_piva,cluster,ragione_sociale,nome_referente').ilike('cf_piva', Identity.Core.customer(cliente).fiscale).limit(2);
      if(existing.error)throw new Error();
      if(existing.data?.length>1)issues.push('Nel CRM ci sono piu anagrafiche con questo codice fiscale. Controlla i dati del cliente prima di confermare.');
      else saved=existing.data?.[0]||null;
    }catch{issues.push('Il confronto con l’anagrafica salvata non e disponibile: verifica i dati del cliente e il documento personalmente.');}
    const crmCustomer = saved ? { ...saved, cluster: saved.cluster || cliente.cluster,
      ragione_sociale: saved.ragione_sociale?.trim() ? saved.ragione_sociale : cliente.ragione_sociale,
      nome_referente: saved.nome_referente?.trim() ? saved.nome_referente : cliente.nome_referente } : cliente;
    if(!Identity.Core.sameCustomer(crmCustomer,cliente))issues.push('I dati del modulo differiscono da quelli salvati nel CRM. Verifica entrambi e conferma il documento del cliente indicato nel modulo.');
    // La ricevuta resta legata ai dati del modulo che saranno salvati dal normale invio.
    // Il confronto CRM precedente e conservato, senza scritture o correzioni automatiche qui.
    const target=cliente;
    const paths = JSON.parse(fields.pda_paths || '[]');
    const pacchetto=fields.pacchetto?require('../../js/scanner-documenti-core').manifest(JSON.parse(fields.pacchetto)):null;
    const manualOnly=pacchetto?.tipo==='passaporto'||target.cluster==='Turista';
    let manual=fields.action==='manual_preview'||manualOnly||issues.length>0,business=null;
    if(Identity.Core.customer(target).business){
      if(!manual){try{business=await Business.load(db,paths,target,deps);}catch{manual=true;issues.push('La lettura della PDA Business non e conclusa: confronta manualmente il CF del rappresentante sulla PDA e sul documento.');}}
      if(manual)business=await Business.loadManual(db,paths,target);
    }
    const analysis=manual?prepared:await Identity.analyze(files, { ...target, cf_rappresentante: business?.cf_rappresentante }, fields.data_firma, { ...deps, nameRetryDeadline: started + 18000 });
    analysis.result.uncertain.push(...issues);
    analysis.result.richiede_cf_rappresentante=Boolean(business?.pdas?.length);
    analysis.result.cf_rappresentante=business?.cf_rappresentante||null;
    if(saved&&!Identity.Core.sameCustomer(crmCustomer,cliente))analysis.result.confronto_crm={
      codice_fiscale:Identity.Core.customer(cliente).fiscale,
      nome_modulo:Identity.Core.customer(cliente).business?cliente.nome_referente:cliente.ragione_sociale,
      nome_crm:Identity.Core.customer(crmCustomer).business?crmCustomer.nome_referente:crmCustomer.ragione_sociale,
      cluster_modulo:cliente.cluster,cluster_crm:crmCustomer.cluster};
    analysis.result.pacchetto=pacchetto;
    if(pacchetto?.tessera_sanitaria){
      for(const part of ['fronte','retro'])if(!analysis.documents.some(d=>d.reading.fields?.['tessera_'+part+'_presente']?.value===true))analysis.result.uncertain.push('Verifica nell’anteprima che sia presente anche il '+part+' della tessera sanitaria della stessa persona.');
      if(analysis.result.stato==='coerente'&&analysis.result.uncertain.length)analysis.result.stato='da_confermare';
    }
    if(manualOnly||analysis.documents.some(doc=>doc.reading.fields?.tipo_identita?.value==='passaporto')){analysis.result.stato=analysis.result.errors.length?'da_correggere':'da_confermare';analysis.result.uncertain.push('Passaporto o cliente Turista: verifica manuale tramite anteprima richiesta.');}
    let data = { pacchetto, version: 1, at: Date.now(), user, customer: { cf_piva: target.cf_piva, cluster: target.cluster,
      ragione_sociale: target.ragione_sociale, nome_referente: target.nome_referente }, crm_customer:saved, business_identity: business, ...analysis };
    if(fields.action==='manual_preview')data=Identity.confirmPreview(data,JSON.parse(fields.conferma||'{}'));
    return reply(200, { success: true, token: Identity.sign(data, deps.secret), result: data.result });
  } catch (error) { return reply(error.statusCode || 400, { success: false, error: error.message || 'Controllo identita non disponibile' }); }
}
exports.handler = handler;
exports._test = { multipart };
