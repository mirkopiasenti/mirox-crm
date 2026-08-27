'use strict';

const { distanzaKm } = require('./kona-cd-distances');

// Scoring DETERMINISTICO per lead Business e appuntamenti Business.
// Nessuna AI: pesi espliciti, motivazioni nei breakdown. Serve solo a
// ordinare i candidati (priorita' guida sempre l'engine, non il punteggio).

function kmBand(km, soglia) {
  if (km === null || km === undefined) return 'unknown';
  if (km <= soglia) return 'vicino';
  if (km <= soglia * 2) return 'medio';
  return 'lontano';
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Scoring di un lead Business arricchito.
// Attesi: lead (riga call_center_lead_outbound), distanzaKmLegnago (km|null),
// confidenteArricchimento (0-1|null), cfg.
async function scoreLead({ lead, distanzaKmLegnago, confidenteArricchimento, cfg }) {
  const breakdown = {};
  let score = 0;

  // 1. Completezza dati (categoria, indirizzo, telefono, email).
  const campi = [
    ['categoria', hasText(lead.categoria)],
    ['indirizzo', hasText(lead.indirizzo)],
    ['telefono', hasText(lead.telefono_norm) || hasText(lead.telefono_raw)],
    ['email', hasText(lead.email)]
  ];
  for (const [nome, presente] of campi) {
    if (presente) {
      score += 7.5;
      breakdown[nome] = 7.5;
    } else {
      breakdown[nome] = 0;
    }
  }

  // 2. Telefono fisso presente (segnale attivita' locale raggiungibile).
  const haFisso = hasText(lead.telefono_fisso) || /(^|\D)(0\d{2,3})(\D|$)/.test(String(lead.telefono_raw || ''));
  if (haFisso) {
    score += 10;
    breakdown.fisso = 10;
  } else {
    breakdown.fisso = 0;
  }

  // 3. Piccola attivita' locale (categoria nota e non generica).
  const categoria = String(lead.categoria || '').toLowerCase().trim();
  if (hasText(lead.categoria) && categoria !== 'altro' && categoria !== 'generico' && categoria !== '') {
    score += 10;
    breakdown.piccola_attivita = 10;
  } else {
    breakdown.piccola_attivita = 0;
  }

  // 4. Vicinanza a Legnago.
  const band = kmBand(distanzaKmLegnago, Number(cfg.distanza_km_indicativa) || 20);
  const vicinanzaLegnago = band === 'vicino' ? 15 : band === 'medio' ? 8 : band === 'unknown' ? 2 : 3;
  score += vicinanzaLegnago;
  breakdown.vicinanza_legnago = { band, punti: vicinanzaLegnago };

  // 5. Affidabilita' arricchimento (confidenza 0-1).
  const conf = Number(confidenteArricchimento);
  const confPunti = Number.isFinite(conf) ? Math.min(20, Math.max(0, Math.round(conf * 20))) : 5;
  score += confPunti;
  breakdown.affidabilita = confPunti;

  score = Math.min(100, Math.round(score * 10) / 10);
  return { score, breakdown };
}

// Scoring di un appuntamento Business per l'ottimizzazione giornata.
// distanzaRiferimento: km dal comune di riferimento (Localita' di partenza).
// distanzaLegnago: km dal negozio Legnago. giorniApertura: 0=oggi, 1=domani...
async function scoreAppuntamento({ comune, giorniApertura, distanzaRiferimento, distanzaLegnago, cfg }) {
  const breakdown = {};
  let score = 0;

  // 1. Stesso comune/cluster: massima priorita' di accorpamento.
  //    (il confronto stringa avviene nel chiamante; qui assegniamo il bonus)

  // 2. Prossimita' temporale.
  const giorni = Number(giorniApertura);
  const tempPunti = giorni === 0 ? 15 : giorni === 1 ? 10 : 5;
  score += tempPunti;
  breakdown.temporale = tempPunti;

  // 3. Vicinanza al riferimento (zona giornaliera).
  const bandRif = kmBand(distanzaRiferimento, Number(cfg.distanza_km_indicativa) || 20);
  const rifPunti = bandRif === 'vicino' ? 20 : bandRif === 'medio' ? 10 : bandRif === 'unknown' ? 4 : 5;
  score += rifPunti;
  breakdown.riferimento = { band: bandRif, punti: rifPunti };

  // 4. Vicinanza a Legnago.
  const bandLeg = kmBand(distanzaLegnago, Number(cfg.distanza_km_indicativa) || 20);
  const legPunti = bandLeg === 'vicino' ? 15 : bandLeg === 'medio' ? 8 : bandLeg === 'unknown' ? 3 : 4;
  score += legPunti;
  breakdown.legnago = { band: bandLeg, punti: legPunti };

  score = Math.min(100, Math.round(score * 10) / 10);
  return { score, breakdown };
}

module.exports = {
  hasText,
  kmBand,
  scoreAppuntamento,
  scoreLead,
  _test: { hasText, kmBand }
};
