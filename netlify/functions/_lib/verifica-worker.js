'use strict';
const crypto = require('node:crypto');
const Core = require('../../../js/verifica-contratti-core');
const Docs = require('./verifica-documenti');
const Pda = require('./pda-contract');
const CustomerBase = require('../../../js/customer-base-device');
const { assertPersistedContractScores } = require('./score-integrity');
const { sendEmail } = require('./mailer');
const ORIGIN = 'https://mirox-crm.it';
const checked = Docs.checked;
function sign(body, secret = process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!secret) throw new Error('worker_non_configurato');
  return crypto.createHmac('sha256', secret).update('mirox-verifica-v1\n' + body).digest('hex');
}
function verify(body, signature, now = Date.now()) {
  try {
    const expected = Buffer.from(sign(body)), actual = Buffer.from(String(signature || ''));
    const data = JSON.parse(body);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected) && Number.isSafeInteger(data.ts) && Math.abs(now - data.ts) < 60000;
  } catch { return false; }
}
function production(env = process.env) {
  return env.MIROX_DEPLOY_ENV !== 'staging' && (!env.BRANCH || env.BRANCH === 'main') && (!env.CONTEXT || env.CONTEXT === 'production');
}
async function config(db) { return checked(await db.from('vendita_verifica_config').select('modalita').eq('id', true).single()); }
async function nudge(payload = {}, fetcher = fetch) {
  const body = JSON.stringify({ ts: Date.now(), ...payload });
  const response = await fetcher(ORIGIN + '/.netlify/functions/verifica-contratti-background', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Mirox-Verifica': sign(body) }, body, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('dispatch_verifica_fallito');
}
async function wake(db) {
  try { if (production() && (await config(db)).modalita === 'attiva') await nudge(); }
  catch { console.warn('Verifica automatica: dispatch rinviato al recupero periodico.'); }
}
async function changed(db, id) {
  const row = checked(await db.from('vendita_verifiche').select('revisione,primo_tentativo_at,esito').eq('contratto_id', id).maybeSingle());
  if (!row?.primo_tentativo_at || row.esito === 'controllato') return;
  checked(await db.from('vendita_verifiche').update({ revisione: row.revisione + 1, stato_job: 'in_coda', prossimo_at: new Date().toISOString(),
    lock_token: null, lock_until: null, tentativi: 0, errore_codice: null }).eq('contratto_id', id).eq('revisione', row.revisione));
}
function requiredDocuments(snapshot, read) {
  const present = new Set(read.documents.map(d => d.tipo_documento));
  const errors = [];
  for (const rule of snapshot.documentRules) {
    if (rule.obbligatorio === false) continue;
    if (rule.categoria_id && rule.categoria_id !== snapshot.contract.categoria_id || rule.offerta_id && rule.offerta_id !== snapshot.contract.offerta_id || rule.opzione_id && rule.opzione_id !== snapshot.contract.opzione_id) continue;
    if (rule.campo_condizione && rule.campo_condizione !== 'admin_config' && String(snapshot.contract[rule.campo_condizione]) !== String(rule.valore_condizione)) continue;
    if (!present.has(rule.tipo_documento)) errors.push({ code: 'allegato_' + rule.tipo_documento, message: 'Manca un allegato richiesto per questa offerta: ' + String(rule.tipo_documento).replace(/_/g, ' ') + '.' });
  }
  return errors;
}
function categoryErrors(c) {
  const errors = [], fail = message => errors.push({ code: 'dati_categoria', message });
  const cat = Core.norm(c.categoria_snapshot);
  try { CustomerBase.validateCombination(c, c.nome_offerta_snapshot, c.categoria_snapshot); } catch { fail('La combinazione Customer Base non è coerente con il dispositivo e il tipo acquisto.'); }
  if (c.dispositivo_associato === true) {
    if (!/^\d{15}$/.test(c.imei || '') || c.fascia_prezzo === null || c.fascia_prezzo === undefined || !/^\d+(?:[.,]\d{1,2})?$/.test(String(c.fascia_prezzo))) fail('Completa IMEI e prezzo del dispositivo.');
    if (!['VAR', 'Finanziamento'].includes(c.tipo_acquisto)) fail('Completa il tipo acquisto del dispositivo.');
    if (c.tipo_acquisto === 'Finanziamento' && !['Findomestic', 'Compass'].includes(c.finanziaria)) fail('Completa la finanziaria del dispositivo.');
  }
  if (c.smartphone_reload === true && !['Mantenere attivo', 'Disattivazione cliente'].includes(c.smartphone_reload_modalita)) fail('Indica se Smartphone Reload deve rimanere attivo o essere disattivata dal cliente.');
  if (cat === 'FISSO' && (!['Nuova Attivazione', 'Portabilita'].includes(c.tipo_attivazione) || !c.convergenza || c.prezzo_fisso === null || c.prezzo_fisso === undefined)) fail('Completa tipo attivazione, prezzo e convergenza del Fisso.');
  if (cat === 'ALLARMI' && !['Finanziamento', 'Anticipo'].includes(c.modalita_pagamento)) fail('Completa la modalità di pagamento Allarmi.');
  if (cat === 'ASSICURAZIONI' && (!['RID', 'Carta di Credito', 'Carta di Debito'].includes(c.modalita_pagamento_assicurazione) || !['Mensile', 'Annuale'].includes(c.ricorrenza_assicurazione))) fail('Completa pagamento e ricorrenza dell’assicurazione.');
  try { assertPersistedContractScores(c); } catch { fail('I punteggi registrati non sono coerenti. È necessario controllare il contratto senza ricalcolare lo storico automaticamente.'); }
  return errors;
}
async function analyze(db, id, deps = {}) {
  const snapshot = await Docs.loadSnapshot(db, id);
  const csv = checked(await db.from('vendita_verifica_csv').select('id,righe,created_at').order('created_at', { ascending: false }).order('id').limit(1).maybeSingle());
  const review = checked(await db.from('vendita_verifiche').select('data_firma,primo_turno_at').eq('contratto_id', id).maybeSingle());
  const read = await (deps.readDocuments || Docs.readDocuments)(db, snapshot, deps);
  const freshCsv = csv && (!review?.primo_turno_at || Core.romeDay(csv.created_at) >= Core.romeDay(review.primo_turno_at));
  const result = Core.evaluate({ ...snapshot, ...read, csv: freshCsv ? { rows: csv.righe } : null, signingDate: review?.data_firma });
  if (csv && !freshCsv) result.waiting = result.waiting.map(w => w.code === 'missing_file' ? { code: 'missing_daily_file', message: 'Serve un CSV WindTre caricato per il turno di verifica del ' + Core.romeDay(review.primo_turno_at) + ' o successivo.' } : w);
  result.source_customer_updated_at = snapshot.customer.updated_at;
  result.errors.push(...requiredDocuments({ ...snapshot, contract: { ...snapshot.contract, ...result.patch } }, read));
  result.errors.push(...categoryErrors({ ...snapshot.contract, ...result.patch }));
  try {
    const merged = { ...snapshot.contract, ...result.patch };
    Pda.validate(merged, merged.categoria_snapshot, { requireCode: Pda.isPda(merged.categoria_snapshot), allowLegacy: !Pda.hasMobileData(merged) });
    if (result.patch.codice_contratto) await Pda.assertAvailable(db, result.patch.codice_contratto, id);
  } catch { result.errors.push({ code: 'dati_pda', message: 'I dati obbligatori della PDA sono incompleti, incoerenti o il codice contratto è già utilizzato.' }); }
  if (result.errors.length) result.esito = 'da_verificare';
  return { snapshot, result, proofs: read.proofs, fingerprint: Docs.fingerprint(snapshot), csvId: csv?.id || null };
}
async function processOne(db, { id = null, test = false } = {}, deps = {}) {
  const claim = checked(await db.rpc('vendita_verifica_claim', { p_id: id, p_test: test }))?.[0];
  if (!claim) return { skipped: true };
  try {
    const analysis = await (deps.analyze || analyze)(db, claim.contratto_id, { ...deps, forceRead: test });
    const latest = await Docs.loadSnapshot(db, claim.contratto_id);
    const csv = checked(await db.from('vendita_verifica_csv').select('id').order('created_at', { ascending: false }).order('id').limit(1).maybeSingle());
    if (Docs.fingerprint(latest) !== analysis.fingerprint || (latest.contract.categoria_snapshot === 'Energia' && (csv?.id || null) !== analysis.csvId)) {
      checked(await db.from('vendita_verifiche').update({ stato_job: 'in_coda', lock_token: null, lock_until: null, prossimo_at: new Date().toISOString(), tentativi: 0 }).eq('contratto_id', claim.contratto_id).eq('lock_token', claim.lock_token));
      return { stale: true };
    }
    const saved = checked(await db.rpc('vendita_verifica_concludi', { p_id: claim.contratto_id, p_token: claim.lock_token, p_revision: claim.revisione,
      p_updated: latest.contract.updated_at, p_customer: latest.customer, p_result: analysis.result, p_fingerprint: analysis.fingerprint,
      p_docs: analysis.proofs, p_model: Docs.MODEL, p_test: test }));
    return { saved, esito: analysis.result.esito };
  } catch (error) {
    // Technical failures are retryable and are never converted into positive documentary outcomes.
    const terminal = claim.tentativi >= 5;
    if (terminal && !test) {
      const snapshot = await Docs.loadSnapshot(db, claim.contratto_id);
      const result = { version: Core.VERSION, esito: 'da_verificare', patch: {}, errors: [{ code: 'servizio_lettura', message: 'Non è stato possibile completare la lettura automatica dopo più tentativi. Controlla i documenti o il servizio di analisi e richiedi il riesame.' }], waiting: [], checks: [], technical: true, source_customer_updated_at: snapshot.customer.updated_at };
      const saved = checked(await db.rpc('vendita_verifica_concludi', { p_id: claim.contratto_id, p_token: claim.lock_token, p_revision: claim.revisione,
        p_updated: snapshot.contract.updated_at, p_customer: snapshot.customer, p_result: result, p_fingerprint: Docs.fingerprint(snapshot), p_docs: [], p_model: Docs.MODEL, p_test: false }));
      return { failed: true, terminal: true, saved };
    }
    checked(await db.from('vendita_verifiche').update({ stato_job: 'errore', lock_token: null, lock_until: null,
      errore_codice: terminal ? 'tentativi_esauriti' : 'lettura_temporaneamente_non_disponibile',
      prossimo_at: new Date(Date.now() + Math.min(3600, 60 * 2 ** claim.tentativi) * 1000).toISOString() }).eq('contratto_id', claim.contratto_id).eq('lock_token', claim.lock_token));
    console.warn('Verifica automatica: elaborazione sospesa, errore tecnico registrato.');
    return { failed: true, terminal };
  }
}
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function email(job) {
  const reload = job.tipo === 'reload';
  return { to: job.destinatario, subject: reload ? 'Mirox CRM: promemoria WhatsApp Reload' : 'Mirox CRM: contratto da verificare',
    html: `<p>${escape(job.payload.cliente)}</p><p>${reload ? 'Contratto verificato. È stata scelta Disattivazione cliente per Smartphone Reload: ricorda di scrivere il promemoria al cliente su WhatsApp.' : 'La verifica ha riscontrato questi problemi:'}</p>`
      + (reload ? '' : '<ul>' + (job.payload.motivi || []).map(m => `<li>${escape(m.message)}</li>`).join('') + '</ul>')
      + `<p>Riferimento contratto: ${escape(job.contratto_id)}</p><p><a href="${ORIGIN}/moduli/verifica_contratti.html?contratto_id=${encodeURIComponent(job.contratto_id)}">Apri la pratica nel CRM</a></p>`,
    related_table: 'vendita_contratti', related_id: job.contratto_id };
}
async function notifications(db, deps = {}) {
  if ((await config(db)).modalita !== 'attiva') return;
  // A previous process may have died after SMTP acceptance: never resend blindly.
  checked(await db.from('vendita_verifica_notifiche').update({ stato: 'incerta' }).eq('stato', 'in_corso').lt('updated_at', new Date(Date.now() - 15 * 60000).toISOString()));
  const jobs = checked(await db.from('vendita_verifica_notifiche').select('*').eq('stato', 'in_coda').lte('prossimo_at', new Date().toISOString()).order('prossimo_at').limit(20));
  for (const job of jobs) {
    const token = crypto.randomUUID();
    const claimed = checked(await db.from('vendita_verifica_notifiche').update({ stato: 'in_corso', lock_token: token, tentativi: job.tentativi + 1, updated_at: new Date().toISOString() }).eq('id', job.id).eq('stato', 'in_coda').select('id').maybeSingle());
    if (!claimed) continue;
    const c = checked(await db.from('vendita_contratti').select('stato_controllo,smartphone_reload,smartphone_reload_modalita').eq('id', job.contratto_id).single());
    const r = checked(await db.from('vendita_verifiche').select('esito,risultato,stato_job').eq('contratto_id', job.contratto_id).single());
    const current = job.tipo === 'reload' ? c.stato_controllo === 'controllato' && c.smartphone_reload === true && c.smartphone_reload_modalita === 'Disattivazione cliente'
      : c.stato_controllo !== 'controllato' && r.esito === 'da_verificare' && r.stato_job === 'fermo' && JSON.stringify(r.risultato?.errors) === JSON.stringify(job.payload.motivi);
    if (!current) { checked(await db.from('vendita_verifica_notifiche').update({ stato: 'superata' }).eq('id', job.id).eq('lock_token', token)); continue; }
    let outcome;
    try { outcome = await (deps.sendEmail || sendEmail)(email(job)); }
    catch { outcome = { ok: false }; }
    // Generic SMTP failures can be acceptance-ambiguous; preserve for reconciliation.
    const retry = !outcome.ok && outcome.rejected && !outcome.permanent && job.tentativi < 4;
    checked(await db.from('vendita_verifica_notifiche').update({ stato: outcome.ok ? 'inviata' : retry ? 'in_coda' : outcome.rejected ? 'fallita' : 'incerta',
      prossimo_at: new Date(Date.now() + 60000 * 2 ** (job.tentativi + 1)).toISOString(), updated_at: new Date().toISOString() }).eq('id', job.id).eq('lock_token', token));
  }
}
module.exports = { sign, verify, production, config, nudge, wake, changed, analyze, processOne, notifications, email, requiredDocuments, categoryErrors };
