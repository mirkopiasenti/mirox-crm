'use strict';

const { addDaysStr, parseHHmm, romeDayRange, todayRomeStr, nowRomeParts } = require('./kona-cd-time');
const { cleanLog, isUuid, nowIso } = require('./kona-cd-util');

// Conferme appuntamenti Business (priorita' 1 del motore).
// - Tentativi alle finestre 9:00 / 11:30 / 15:30 / 18:00, "top of queue".
// - Dopo 4 non-risposti: NESSUN annullamento automatico, lo stato operativo
//   dell'appuntamento resta invariato, Telegram a Mirko, si attende.
// - Un tentativo per finestra: UNIQUE (appuntamento_business_id, data, orario).

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

// Conta i tentativi (conferme registrate) oggi per un appuntamento Business.
async function tentativiOggi(supabase, { appuntamentoBusinessId, data }) {
  if (!isUuid(appuntamentoBusinessId)) return 0;
  const { data: rows, error } = await supabase
    .from('kona_call_director_conferme')
    .select('id')
    .eq('appuntamento_business_id', appuntamentoBusinessId)
    .eq('data', data || todayRomeStr());
  return !error && Array.isArray(rows) ? rows.length : 0;
}

// Esaurito per le conferme = numero di finestre (4), indipendente da
// tentativi_massimi. Conferma il comportamento "4 non risposti -> attesa".
function tentativoEsaurito(cfg, tentativo) {
  const soglia = finestreConferme(cfg).length || 4;
  return Number(tentativo) >= soglia;
}

// Registra una conferma per una finestra. Upsert idempotente.
async function registraConferma(supabase, { appuntamentoBusinessId, data, orarioPrevisto, tentativo, esito, dettagli }) {
  if (!isUuid(appuntamentoBusinessId)) return { ok: false, error: 'appuntamento_business_id_non_valido' };
  const esitoNorm = ['confermato', 'non_risposto', 'annullato', 'da_riprogrammare', 'errore'].includes(esito) ? esito : 'errore';
  const { error } = await supabase
    .from('kona_call_director_conferme')
    .upsert({
      appuntamento_business_id: appuntamentoBusinessId,
      data: data || todayRomeStr(),
      orario_previsto: orarioPrevisto || '00:00',
      tentativo: Number(tentativo) || 1,
      esito: esitoNorm,
      esito_at: nowIso(),
      dettagli: cleanLog(dettagli || {})
    }, { onConflict: 'appuntamento_business_id,data,orario_previsto' });
  if (error) return { ok: false, error };
  return { ok: true, esito: esitoNorm };
}

// Appuntamenti Business 'proposto' per domani che non hanno ancora un tentativo
// nella finestra attiva. Ritorna [{ appuntamento, finestra }].
async function candidatiFinestra(supabase, cfg, { oggi, now }) {
  const attiva = finestraAttiva(cfg, now);
  if (!attiva) return [];
  const domani = addDaysStr(oggi || todayRomeStr(), 1);
  const range = romeDayRange(domani);
  const { data: rows, error } = await supabase
    .from('kona_call_director_appuntamenti_business')
    .select('id, lead_id, anagrafica_id, operatore_id, data_ora, zona, stato')
    .eq('stato', 'proposto')
    .gte('data_ora', range.start.toISOString())
    .lt('data_ora', range.end.toISOString())
    .limit(30);
  if (error || !Array.isArray(rows)) return [];

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const { data: conferme } = await supabase
    .from('kona_call_director_conferme')
    .select('appuntamento_business_id')
    .eq('data', oggi || todayRomeStr())
    .eq('orario_previsto', attiva.orario)
    .in('appuntamento_business_id', ids);
  const giaTentata = new Set((conferme || []).map((c) => c.appuntamento_business_id));

  return rows
    .filter((a) => !giaTentata.has(a.id))
    .map((a) => ({ appuntamento: a, finestra: attiva.orario }));
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
  candidatiFinestra,
  finestraAttiva,
  finestreConferme,
  notificaEsauriti,
  registraConferma,
  tentativoEsaurito,
  tentativiOggi,
  _test: { finestreConferme, finestraAttiva, tentativoEsaurito }
};
