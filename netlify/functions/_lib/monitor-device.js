'use strict';
const crypto = require('node:crypto');
const TABLE = 'mirox_monitor_dispositivi';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const checked = result => { if (result.error) fail('Servizio monitor non disponibile.', 503); return result.data; };
const PUBLIC_FIELDS = 'id,nome,negozio,stato,created_at,activated_at,revoked_at,last_seen_at,pairing_expires_at';
function pairingCode() { return crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-'); }
function normalizeCode(code) {
  const value = String(code || '').replace(/[-\s]/g, '').toUpperCase();
  if (!/^[A-F0-9]{16}$/.test(value)) fail('Codice associazione non valido.');
  return value;
}
async function authenticate(db, event) {
  const value = event.headers?.authorization || event.headers?.Authorization || '';
  const match = /^MiroxMonitor ([a-f0-9]{64})$/.exec(value);
  if (!match) fail('Postazione non associata o revocata.', 403);
  const device = checked(await db.from(TABLE).select('id,nome,negozio,stato,last_seen_at')
    .eq('token_hash', hash(match[1])).eq('stato', 'attivo').maybeSingle());
  if (!device || device.negozio !== '9001415852') fail('Postazione non associata o revocata.', 403);
  return device;
}
async function associate(db, event, body, secret) {
  if (!secret) fail('Servizio monitor non disponibile.', 503);
  const ip = event.headers?.['x-nf-client-connection-ip'];
  // Un bucket comune e' il fallback quando il proxy non fornisce l'IP affidabile.
  const key = crypto.createHmac('sha256', secret).update('monitor-pair:'+String(ip || 'unknown').slice(0,128)).digest('hex');
  if (!checked(await db.rpc('mirox_monitor_limita', { p_chiave:key }))) fail('Troppi tentativi. Riprova fra 15 minuti.',429);
  const code = normalizeCode(body.code);
  if (!/^[a-f0-9]{64}$/.test(body.token_hash || '')) fail('Associazione non valida.');
  const result = await db.rpc('mirox_monitor_associa', {p_pairing_hash:hash(code),p_token_hash:body.token_hash});
  if (result.error?.code === '22023') fail('Codice scaduto o gia utilizzato. Crea un nuovo codice dall’Admin.');
  return { id:checked(result), stato:'attivo' };
}
module.exports = {TABLE,PUBLIC_FIELDS,hash,fail,checked,pairingCode,normalizeCode,authenticate,associate};
