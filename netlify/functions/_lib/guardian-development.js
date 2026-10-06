'use strict';
const {createHash}=require('node:crypto');
function requirementHash(incident) {
  return createHash('sha256').update(JSON.stringify([incident.id,incident.tipo_richiesta,
    incident.titolo || '',incident.riepilogo_ai || incident.descrizione_iniziale || ''])).digest('hex');
}
function developmentMandate(text) {
  const value=String(text || '').trim();
  if(value.length>350 || /["“”«»?]|\b(non|ferma|aspetta|se|quando)\b/i.test(value))return false;
  return /^(?:(?:s[iì]|ok|va bene)[, .!]+)?(?:procedi|vai avanti|inizia)(?: pure)?\s+(?:con |a |allo? |al )?(?:(?:l['’]|lo |la |il )\s*)?(?:implementazione|sviluppo|lavoro|sviluppare|implementare|correggere|correzione)\b/i.test(value)
    || /^(?:(?:s[iì]|ok)[, .!]+)?(?:implementa|sviluppa|correggi|realizza)(?:la|lo)?(?:\s|[.!]|$)/i.test(value);
}
function validDevelopment(contract,incident,owner) {
  return contract?.auto_test===true && String(contract.owner_chat_id)===String(owner)
    && contract.requirement_hash===requirementHash(incident);
}
module.exports={requirementHash,developmentMandate,validDevelopment};
