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
      limits: { files: 4, fileSize: 20 * 1024 * 1024, fields: 4, fieldSize: 12000 } });
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
    const db = deps.db || getAdminClient();
    const existing = await db.from('anagrafica').select('cf_piva,cluster,ragione_sociale,nome_referente').ilike('cf_piva', Identity.Core.customer(cliente).fiscale).limit(2);
    if (existing.error) throw new Error('Anagrafica non disponibile. Riprova il controllo.');
    if (existing.data?.length > 1) throw new Error('Anagrafica non univoca: correggi il codice fiscale prima del controllo.');
    const saved = existing.data?.[0];
    // Il riscontro usa i dati CRM e include soltanto i campi anagrafici ancora mancanti.
    const target = saved ? { ...saved, cluster: saved.cluster || cliente.cluster,
      ragione_sociale: saved.ragione_sociale?.trim() ? saved.ragione_sociale : cliente.ragione_sociale,
      nome_referente: saved.nome_referente?.trim() ? saved.nome_referente : cliente.nome_referente } : cliente;
    if (!Identity.Core.sameCustomer(target, cliente)) throw new Error('I dati inseriti differiscono dall’anagrafica CRM: correggi prima l’anagrafica o ricarica i dati.');
    const paths = JSON.parse(fields.pda_paths || '[]');
    const business = Identity.Core.customer(target).business ? await Business.load(db, paths, target, deps) : null;
    const pacchetto=fields.pacchetto?require('../../js/scanner-documenti-core').manifest(JSON.parse(fields.pacchetto)):null;
    const manualOnly=pacchetto?.tipo==='passaporto'||target.cluster==='Turista';
    const identityDeps=manualOnly?{...deps,extract:async doc=>({id:doc.id,fields:{},manuale_passaporto:true}),readBarcode:async()=>({attempted:false,complete:true,conflict:false,values:[]})}:deps;
    const analysis = await Identity.analyze(files, { ...target, cf_rappresentante: business?.cf_rappresentante }, fields.data_firma, { ...identityDeps, nameRetryDeadline: started + 18000 });
    analysis.result.pacchetto=pacchetto;
    if(manualOnly||analysis.documents.some(doc=>doc.reading.fields?.tipo_identita?.value==='passaporto')){analysis.result.stato=analysis.result.errors.length?'da_correggere':'da_confermare';analysis.result.uncertain.push('Passaporto o cliente Turista: verifica manuale tramite anteprima richiesta.');}
    const data = { pacchetto, version: 1, at: Date.now(), user, customer: { cf_piva: target.cf_piva, cluster: target.cluster,
      ragione_sociale: target.ragione_sociale, nome_referente: target.nome_referente }, business_identity: business, ...analysis };
    return reply(200, { success: true, token: Identity.sign(data, deps.secret), result: data.result });
  } catch (error) { return reply(error.statusCode || 400, { success: false, error: error.message || 'Controllo identita non disponibile' }); }
}
exports.handler = handler;
exports._test = { multipart };
