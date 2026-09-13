'use strict';

const { parseHHmm, nowRomeParts } = require('./kona-cd-time');
const { cleanLog } = require('./kona-cd-util');

// Conferme appuntamenti Business (priorita' 1 del motore).
// - Tentativi alle finestre 9:00 / 11:30 / 15:30 / 18:00, "top of queue".
// - Dopo 4 non-risposti: NESSUN annullamento automatico, lo stato operativo
//   dell'appuntamento resta invariato, Telegram a Mirko, si attende.
// - Un tentativo per finestra: UNIQUE (appuntamento_business_id, data, orario).
//
// NOTA: la materializzazione dei candidati e la registrazione dei tentativi
// vivono nel motore (`kona-cd-engine.js`), che e' l'unica fonte della regola
// (giorno lavorativo successivo, conteggio tentativi, chiusura del task).
// Qui restano soltanto le funzioni pure sulle finestre e il testo della
// notifica: le vecchie `candidatiFinestra`/`registraConferma`/`tentativiOggi`
// erano codice morto e duplicavano la regola con un giorno di conferma
// divergente ("domani solare" invece del prossimo giorno lavorativo).

function finestreConferme(cfg) {
  const ore = Array.isArray(cfg.conferme_ore) && cfg.conferme_ore.length ? cfg.conferme_ore : ['09:00', '11:30', '15:30', '18:00'];
  return ore
    .map((o) => ({ orario: String(o), minuti: parseHHmm(o) }))
    .filter((w) => w.minuti !== null)
    .sort((a, b) => a.minuti - b.minuti);
}

// Finestra di conferma attiva in questo momento Rome. Ritorna { orario, inizioMin, fineMin }.
function finestraAttiva(cfg, now) {
  const finestre = finestreConferme(cfg);
  if (finestre.length === 0) return null;
  const parts = now || nowRomeParts();
  const nowMin = parts.hh * 60 + parts.mm;
  const prima = finestre[0].minuti;
  if (nowMin < prima) return null; // prima della prima finestra: nessuna conferma
  let attiva = null;
  for (let i = 0; i < finestre.length; i += 1) {
    const w = finestre[i];
    const next = finestre[i + 1];
    const fine = next ? next.minuti : 24 * 60;
    if (nowMin >= w.minuti && nowMin < fine) {
      attiva = { ...w, fineMin: fine };
      break;
    }
  }
  return attiva || { ...finestre[finestre.length - 1], fineMin: 24 * 60 };
}

// Esaurito per le conferme = numero di finestre (4), indipendente da
// tentativi_massimi. Conferma il comportamento "4 non risposti -> attesa".
function tentativoEsaurito(cfg, tentativo) {
  const soglia = finestreConferme(cfg).length || 4;
  return Number(tentativo) >= soglia;
}

// Notifica Telegram senza PII: non include nome/telefono/indirizzo del cliente.
function notificaEsauriti(dettagli = {}) {
  return cleanLog({
    codice: 'conferma_non_risposti_esauriti',
    appuntamento_business_id: dettagli.appuntamento_business_id,
    zona: dettagli.zona,
    finestra: dettagli.finestra,
    data_appuntamento: dettagli.data_appuntamento,
    messaggio: 'Appuntamento Business di domani: 4 tentativi di conferma non andati a buon fine. Nessun annullamento automatico: lo stato operativo resta invariato.'
  });
}

module.exports = {
  finestraAttiva,
  finestreConferme,
  notificaEsauriti,
  tentativoEsaurito,
  _test: { finestreConferme, finestraAttiva, tentativoEsaurito }
};
