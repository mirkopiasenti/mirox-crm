'use strict';

const { getConfig } = require('./kona-cd-config');
const { sendMessage, getOwnerChatId, isConfigured } = require('./kona-cd-telegram');
const { cleanLog, isBlank, nowIso } = require('./kona-cd-util');

// Outbox notifiche Telegram di KONA Call Director.
// - Payload SENZA dati personali (le notifiche vanno solo al proprietario).
// - Retry backoff 1/5/15/60 min, morta dopo 8 tentativi.
// - Dedupe per chiave: enqueue idempotente.
// - Lease per-riga RECUPERABILE: un'istanza che muore a meta' invio non lascia
//   la notifica bloccata per sempre in `in_invio`.

const NOTIFICA_BACKOFF_MIN = [1, 5, 15, 60];
const NOTIFICA_MAX_TENTATIVI = 8;
// Durata del lease di invio: oltre questa soglia la riga `in_invio` viene
// rimessa in coda (il timeout HTTP di Telegram e' 15s, quindi 5 minuti sono
// ampiamente sufficienti).
const NOTIFICA_LEASE_MIN = 5;
// Limite del testo effettivamente conservato e inviato.
const TESTO_MAX = 3900;

// Mappa il codice applicativo della notifica sul toggle di
// `kona_call_director_config.notifiche_immediate`. I codici non mappati
// (report, reminder, failover) non sono disattivabili.
const TOGGLE_PER_CODICE = {
  appuntamento_annullato: 'appuntamento_annullato',
  conferma_non_risposti_esauriti: 'quattro_non_risposti',
  calendario_non_disponibile: 'calendario_non_disponibile',
  sync_fallito: 'sync_fallito',
  lead_sotto_soglia: 'lead_sotto_soglia',
  attivita_fuori_standard: 'attivita_fuori_standard',
  budget: 'budget'
};

// Il toggle e' rispettato solo se impostato ESPLICITAMENTE a false.
function notificaAbilitata(cfg, codice) {
  const chiave = TOGGLE_PER_CODICE[String(codice || '')];
  if (!chiave) return true;
  const toggles = (cfg && cfg.notifiche_immediate) || {};
  return toggles[chiave] !== false;
}

function backoffMs(tentativi) {
  const idx = Math.min(Math.max(0, tentativi - 1), NOTIFICA_BACKOFF_MIN.length - 1);
  return NOTIFICA_BACKOFF_MIN[idx] * 60 * 1000;
}

// Aggiunge (o lascia invariata) una notifica in coda. Dedupe per dedupeKey.
async function enqueueNotifica(supabase, { dedupeKey, testo, extra = {} }) {
  if (!dedupeKey || isBlank(testo)) return { ok: false, error: 'dedupe_key_o_testo_mancanti' };
  // `cleanLog` ha maxLength 500 di default: senza il parametro esplicito il
  // report serale (7+ righe) arrivava troncato e la domanda finale spariva.
  const payload = cleanLog({ ...extra, testo: String(testo).slice(0, TESTO_MAX) }, { maxLength: TESTO_MAX });
  const { error } = await supabase
    .from('kona_call_director_notifiche')
    .upsert({
      dedupe_key: dedupeKey,
      payload,
      stato: 'in_coda',
      tentativi: 0,
      prossimo_tentativo_at: nowIso()
    }, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  return error ? { ok: false, error } : { ok: true };
}

async function marcaFallita(supabase, n, errore) {
  const tentativi = (n.tentativi || 0) + 1;
  const morta = tentativi >= NOTIFICA_MAX_TENTATIVI;
  await supabase
    .from('kona_call_director_notifiche')
    .update({
      stato: morta ? 'morta' : 'fallita',
      tentativi,
      prossimo_tentativo_at: new Date(Date.now() + backoffMs(tentativi)).toISOString(),
      ultimo_errore: String(errore || 'errore').slice(0, 300)
    })
    .eq('id', n.id);
}

// Rimette in coda le notifiche rimaste `in_invio` oltre il lease (istanza morta
// a meta' invio). Senza questo recupero la notifica non veniva piu' inviata ne'
// ritentata, e nessuno veniva avvisato del dead-letter.
async function recuperaLeaseScaduti(supabase) {
  const soglia = new Date(Date.now() - NOTIFICA_LEASE_MIN * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('kona_call_director_notifiche')
    .update({ stato: 'fallita' })
    .eq('stato', 'in_invio')
    .lt('prossimo_tentativo_at', soglia);
  return error ? { ok: false, error } : { ok: true };
}

// Invia le notifiche pronte, con lease per-riga (update condizionale).
async function processaNotifiche(supabase, { limite = 5 } = {}) {
  await recuperaLeaseScaduti(supabase);

  const { data: coda, error } = await supabase
    .from('kona_call_director_notifiche')
    .select('*')
    .in('stato', ['in_coda', 'fallita'])
    .lte('prossimo_tentativo_at', nowIso())
    .order('created_at', { ascending: true })
    .limit(limite);
  if (error) return { ok: false, error, inviate: 0 };

  let cfg = null;
  try {
    cfg = await getConfig(supabase);
  } catch {
    cfg = null; // config non leggibile: si invia (fail-open sulle notifiche)
  }

  let inviate = 0;
  for (const n of coda || []) {
    const lease = await supabase
      .from('kona_call_director_notifiche')
      .update({
        stato: 'in_invio',
        // Il lease e' tracciato con prossimo_tentativo_at: la tabella non ha
        // updated_at, quindi e' questo il campo che permette il recupero.
        prossimo_tentativo_at: new Date(Date.now() + NOTIFICA_LEASE_MIN * 60 * 1000).toISOString()
      })
      .eq('id', n.id)
      .eq('stato', n.stato)
      .select('id')
      .single();
    if (lease.error) continue;

    // Toggle admin di `notifiche_immediate`: se disattivato la notifica viene
    // chiusa senza inviare (prima i toggle non avevano alcun effetto).
    if (!notificaAbilitata(cfg, n.payload?.codice)) {
      await supabase
        .from('kona_call_director_notifiche')
        .update({ stato: 'morta', ultimo_errore: 'disattivata_da_config' })
        .eq('id', n.id);
      continue;
    }

    if (!isConfigured() || !getOwnerChatId()) {
      await marcaFallita(supabase, n, 'telegram_non_configurato');
      continue;
    }
    const testo = String(n.payload?.testo || '').trim();
    if (!testo) {
      await marcaFallita(supabase, n, 'testo_vuoto');
      continue;
    }
    try {
      // Invio in testo semplice: `parse_mode: HTML` senza escaping faceva
      // fallire il messaggio (400 "can't parse entities") appena il testo
      // conteneva un `<` o un `&`, fino a marcarlo `morta`: il canale di
      // allerta si auto-eliminava proprio quando serviva.
      const ok = await sendMessage(getOwnerChatId(), testo, { disable_web_page_preview: true });
      if (ok) {
        inviate += 1;
        await supabase
          .from('kona_call_director_notifiche')
          .update({ stato: 'inviata', inviata_at: nowIso(), ultimo_errore: null })
          .eq('id', n.id);
      } else {
        await marcaFallita(supabase, n, 'telegram_send_failed');
      }
    } catch (e) {
      await marcaFallita(supabase, n, String(e?.message || 'errore').slice(0, 300));
    }
  }
  return { ok: true, inviate };
}

module.exports = {
  NOTIFICA_BACKOFF_MIN,
  NOTIFICA_MAX_TENTATIVI,
  backoffMs,
  enqueueNotifica,
  notificaAbilitata,
  processaNotifiche,
  recuperaLeaseScaduti,
  _test: { backoffMs, notificaAbilitata }
};
