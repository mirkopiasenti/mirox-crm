'use strict';

const { sendMessage, getOwnerChatId, isConfigured } = require('./kona-cd-telegram');
const { cleanLog, isBlank, nowIso } = require('./kona-cd-util');

// Outbox notifiche Telegram di KONA Call Director.
// - Payload SENZA dati personali (le notifiche vanno solo al proprietario).
// - Retry backoff 1/5/15/60 min, morta dopo 8 tentativi.
// - Dedupe per chiave: enqueue idempotente.

const NOTIFICA_BACKOFF_MIN = [1, 5, 15, 60];
const NOTIFICA_MAX_TENTATIVI = 8;

function backoffMs(tentativi) {
  const idx = Math.min(Math.max(0, tentativi - 1), NOTIFICA_BACKOFF_MIN.length - 1);
  return NOTIFICA_BACKOFF_MIN[idx] * 60 * 1000;
}

// Aggiunge (o lascia invariata) una notifica in coda. Dedupe per dedupeKey.
async function enqueueNotifica(supabase, { dedupeKey, testo, extra = {} }) {
  if (!dedupeKey || isBlank(testo)) return { ok: false, error: 'dedupe_key_o_testo_mancanti' };
  const payload = cleanLog({ ...extra, testo: String(testo).slice(0, 3900) });
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

// Invia le notifiche pronte, con lease per-riga (update condizionale).
async function processaNotifiche(supabase, { limite = 5 } = {}) {
  const { data: coda, error } = await supabase
    .from('kona_call_director_notifiche')
    .select('*')
    .in('stato', ['in_coda', 'fallita'])
    .lte('prossimo_tentativo_at', nowIso())
    .order('created_at', { ascending: true })
    .limit(limite);
  if (error) return { ok: false, error, inviate: 0 };

  let inviate = 0;
  for (const n of coda || []) {
    const lease = await supabase
      .from('kona_call_director_notifiche')
      .update({ stato: 'in_invio' })
      .eq('id', n.id)
      .eq('stato', n.stato)
      .select('id')
      .single();
    if (lease.error) continue;

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
      const ok = await sendMessage(getOwnerChatId(), testo, { parse_mode: 'HTML', disable_web_page_preview: true });
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
  processaNotifiche,
  _test: { backoffMs }
};
