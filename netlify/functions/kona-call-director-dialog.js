/**
 * KONA Call Director — valutazione skip e appuntamenti Business.
 *
 * Azioni:
 *   valuta_altro           -> valuta uno skip "altro" (l'IA puo' contestare una sola volta)
 *   cerca_slot             -> slot Google disponibili per un lead Business
 *   proponi_appuntamento   -> crea appuntamento Business + evento Google
 *   conferma_appuntamento  -> marca confermato (sync Google se manca evento)
 *   annulla_appuntamento   -> marca annullato (+ elimina evento Google)
 *   riprogramma_appuntamento -> marca da_riprogrammare
 *
 * Nessuna generazione di script telefonici: l'IA non suggerisce frasi da dire.
 *
 * Privacy:
 * - A OpenAI NON finiscono mai dati Consumer identificativi. Per i lead
 *   Business passano solo dati pubblici aziendali (ragione sociale, categoria,
 *   zona, localita) gia' presenti in Mirox.
 * - Gli eventi Google hanno solo "Appuntamento: NOME AZIENDA" (calendario di
 *   Mirko, che e' il proprietario). Il browser riceve SOLO slot pre-calcolati.
 * - Refresh token e access token vivono solo lato server (kona-cd-google).
 */

const { createClient } = require('@supabase/supabase-js');

const { authAndEnabled } = require('./_lib/kona-cd-config');
const { openaiStructured } = require('./_lib/kona-cd-openai');
const {
  computeSlots, deleteEvent, findEventByKonaId, freeBusy, getAccessToken, insertEvent, listEvents, updateEventTime
} = require('./_lib/kona-cd-google');
const { addDaysStr, todayRomeStr } = require('./_lib/kona-cd-time');
const { enqueueNotifica } = require('./_lib/kona-cd-notifiche');
const { cleanLog, isUuid, jsonError, jsonOk, parseNumber, readJsonBody } = require('./_lib/kona-cd-util');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonError(405, 'Metodo non consentito');

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const guard = await authAndEnabled(event, { supabase: client, response: jsonError });
  if (guard.response) return guard.response;
  const { cfg, profiloId, auth } = guard;
  const isAdmin = auth?.profilo?.ruolo === 'admin';

  const body = await readJsonBody(event);
  const action = String(body.action || '');

  try {
    switch (action) {
      case 'valuta_altro':
        return await azioneValutaAltro(client, cfg, body);
      case 'cerca_slot':
        return await azioneCercaSlot(client, cfg, body);
      case 'proponi_appuntamento':
        return await azioneProponi(client, cfg, body, profiloId, isAdmin);
      case 'conferma_appuntamento':
        return await azioneConferma(client, cfg, body, profiloId, isAdmin);
      case 'annulla_appuntamento':
        return await azioneAnnulla(client, cfg, body, profiloId, isAdmin);
      case 'riprogramma_appuntamento':
        return await azioneRiprogramma(client, cfg, body, profiloId, isAdmin);
      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};

// -- Valutazione skip "Altro" -------------------------------------------------
// (Nessuna generazione di script telefonici: l'IA puo' solo contestare o
// chiedere chiarimenti UNA volta sullo skip "Altro", la decisione e' dell'operatrice.)

async function azioneValutaAltro(client, cfg, body) {
  const spiegazione = String(body.spiegazione || '').slice(0, 500);
  if (!spiegazione.trim()) return jsonError(400, 'Spiegazione richiesta');
  const contesto = cleanLog({
    tipo_contatto: body.tipo_contatto || 'business',
    categoria: body.categoria || null,
    zona: body.zona || null,
    spiegazione
  });

  const schema = {
    type: 'object',
    properties: {
      esito: { type: 'string', enum: ['procedi', 'verifica', 'richiedi_dettaglio'] },
      motivo: { type: 'string' }
    },
    required: ['esito', 'motivo'],
    additionalProperties: false
  };
  const instructions = [
    'Valuta la spiegazione di un operatore per un esito "altro" su un contatto',
    'Business. Ritorna: "procedi" se e\' una ragione chiara e non ambigua per',
    'escludere il contatto, "richiedi_dettaglio" se mancano informazioni,',
    '"verifica" se serve un controllo manuale. Massimo 2 frasi di motivo.'
  ].join(' ');

  const result = await openaiStructured({
    supabase: client,
    cfg,
    activity: 'altro',
    name: 'kona_skip_altro',
    instructions,
    input: JSON.stringify(contesto),
    schema,
    maxOutputTokens: 200,
    webSearch: false,
    details: { skip_reason: 'altro' }
  });
  if (!result.ok) return jsonOk({ valutazione: null, motivo: result.error });
  return jsonOk({ valutazione: result.value });
}

// -- Slot Google --------------------------------------------------------------

// Carica le fasce libere. FAIL-CLOSED: errore FreeBusy o token mancante =>
// nessuno slot prenotabile (Calendar e' obbligatorio per verificare la
// disponibilita').
async function azioneCercaSlot(client, cfg, body) {
  const leadId = String(body.lead_id || '');
  if (!isUuid(leadId)) return jsonError(400, 'lead_id non valido');
  const { data: lead } = await client.from('call_center_lead_outbound').select('id, zona, localita, provincia, ragione_sociale').eq('id', leadId).maybeSingle();
  if (!lead) return jsonError(404, 'Lead non trovato');

  const accessToken = await getAccessToken(client);
  if (!accessToken) return jsonError(409, 'Calendario Google non collegato');

  const oggi = todayRomeStr();
  const orizzonte = Number(cfg.giorni_orizzonte_calendario) || 14;
  const start = new Date(`${oggi}T00:00:00Z`).toISOString();
  const end = new Date(Date.parse(`${addDaysStr(oggi, orizzonte)}T23:59:59Z`)).toISOString();

  let busy = [];
  let eventi = [];
  try {
    [busy, eventi] = await Promise.all([
      freeBusy(accessToken, { timeMin: start, timeMax: end }),
      listEvents(accessToken, { timeMin: start, timeMax: end })
    ]);
  } catch {
    return jsonError(409, 'Calendario non disponibile');
  }
  const conflittiMirox = await conflittiAppuntamenti(client, { start, end });

  const slots = computeSlots({
    cfg,
    dataInizio: oggi,
    giorni: orizzonte,
    busyIntervals: [...busy, ...eventi.map((e) => ({ start: e.start?.dateTime, end: e.end?.dateTime })).filter((x) => x.start && x.end)],
    appuntamentiConflitto: conflittiMirox
  });

  const zona = lead.localita || lead.zona || 'Zona non definita';
  return jsonOk({
    slots: slots.slice(0, 30).map((s) => ({
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      giorno: s.giorno,
      zona
    })),
    totale: slots.length,
    calendario_collegato: true
  });
}

// -- Appuntamenti Business ----------------------------------------------------

async function azioneProponi(client, cfg, body, profiloId, isAdmin) {
  const leadId = String(body.lead_id || '');
  const startRaw = String(body.start || '');
  const durata = parseNumber(body.durata_minuti, cfg.durata_appuntamento_minuti) || cfg.durata_appuntamento_minuti || 45;
  if (!isUuid(leadId)) return jsonError(400, 'lead_id non valido');
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return jsonError(400, 'start non valido');
  if (start.getTime() <= Date.now()) return jsonError(400, 'slot passato');
  const end = new Date(start.getTime() + durata * 60000);

  const { data: lead } = await client.from('call_center_lead_outbound').select('id, ragione_sociale, zona, localita, provincia').eq('id', leadId).maybeSingle();
  if (!lead) return jsonError(404, 'Lead non trovato');

  // Calendar OBBLIGATORIO: senza token o in caso di errore FreeBusy non si
  // prenota nulla (mai appuntamenti "solo Mirox" fingendo successo).
  const accessToken = await getAccessToken(client);
  if (!accessToken) return jsonError(409, 'Calendario Google non collegato');
  const buffer = Number(cfg.buffer_appuntamento_minuti) || 15;
  const spanStart = new Date(start.getTime() - buffer * 60000).toISOString();
  const spanEnd = new Date(end.getTime() + buffer * 60000).toISOString();
  let busy = [];
  try {
    busy = await freeBusy(accessToken, { timeMin: spanStart, timeMax: spanEnd });
  } catch {
    return jsonError(409, 'Calendario non disponibile');
  }
  for (const b of busy) {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (start.getTime() < be && bs < end.getTime()) return jsonError(409, 'Slot occupato');
  }

  const zona = String(body.zona || lead.zona || lead.localita || 'Zona non definita');

  // Prenotazione ATOMICA lato DB: advisory lock + ricontrollo conflitti +
  // INSERT nella STESSA transazione (RPC kona_cd_prenota_slot_v1).
  const { data: rpc, error: rpcErr } = await client.rpc('kona_cd_prenota_slot_v1', {
    p_lead_id: leadId,
    p_operatore_id: profiloId,
    p_data_ora: start.toISOString(),
    p_durata_minuti: durata,
    p_zona: zona,
    p_buffer_minuti: buffer
  });
  if (rpcErr) return jsonError(500, rpcErr.message);
  if (!rpc?.ok) return jsonError(409, 'Slot non piu' + ' disponibile', { motivo: rpc?.motivo });
  const bizId = rpc.id;

  const { data: bizRow } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', bizId).maybeSingle();

  // Record condiviso `appuntamenti` (fonte per il CC) collegato al record KONA.
  const nome = String(lead.ragione_sociale || 'Azienda').slice(0, 120);
  const { data: appuntamentoCondiviso, error: appErr } = await client.from('appuntamenti').insert({
    nome,
    telefono: lead.telefono_norm || lead.telefono_raw || null,
    motivo: 'Appuntamento Business esterno',
    anagrafica_id: null,
    fissato_da_operatore_id: profiloId,
    fissato_da_nome: null,
    data_ora: start.toISOString(),
    durata_minuti: durata,
    fonte: 'interno',
    stato: 'confermato',
    lead_outbound_id: leadId
  }).select('id').single();
  if (!appErr && appuntamentoCondiviso) {
    await client.from('kona_call_director_appuntamenti_business').update({ appuntamento_id: appuntamentoCondiviso.id }).eq('id', bizId);
  }

  // Sync Google idempotente (kona_id nelle extendedProperties private).
  await sincronizzaGoogle(client, cfg, { ...bizRow, appuntamento_id: appuntamentoCondiviso?.id || null }, lead);

  const { data: finale } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', bizId).single();
  return jsonOk({ appuntamento: pubblicaAppuntamento(finale), slot: true });
}

async function azioneConferma(client, cfg, body, profiloId, isAdmin) {
  const id = String(body.appuntamento_business_id || '');
  const row = await caricaAppuntamento(client, id, profiloId, isAdmin);
  if (!row.ok) return row.res;
  await client.from('kona_call_director_appuntamenti_business').update({ stato: 'confermato' }).eq('id', row.data.id);
  if (row.data.appuntamento_id) {
    await client.from('appuntamenti').update({ stato: 'confermato' }).eq('id', row.data.appuntamento_id);
  }
  if (!row.data.google_event_id) {
    const accessToken = await getAccessToken(client);
    if (accessToken) {
      const { data: lead } = await client.from('call_center_lead_outbound').select('ragione_sociale').eq('id', row.data.lead_id).maybeSingle();
      await sincronizzaGoogle(client, cfg, { ...row.data, stato: 'confermato' }, lead);
    }
  }
  const { data: finale } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', id).single();
  return jsonOk({ appuntamento: pubblicaAppuntamento(finale) });
}

async function azioneAnnulla(client, cfg, body, profiloId, isAdmin) {
  const id = String(body.appuntamento_business_id || '');
  const row = await caricaAppuntamento(client, id, profiloId, isAdmin);
  if (!row.ok) return row.res;
  if (row.data.google_event_id) {
    const accessToken = await getAccessToken(client);
    if (accessToken) {
      try {
        await deleteEvent(accessToken, { eventId: row.data.google_event_id });
      } catch {
        await enqueueNotifica(client, {
          dedupeKey: `sync_annulla_${row.data.id}`,
          testo: `KONA Call Director - Sync Google da recuperare: eliminazione evento per appuntamento annullato (${row.data.id}).`,
          extra: { codice: 'sync_fallito' }
        });
      }
    }
  }
  await client.from('kona_call_director_appuntamenti_business').update({ stato: 'annullato' }).eq('id', row.data.id);
  if (row.data.appuntamento_id) {
    await client.from('appuntamenti').update({ stato: 'annullato', motivo_modifica: 'Annullato da KONA Call Director' }).eq('id', row.data.appuntamento_id);
  }
  // Notifica Telegram IMMEDIATA (senza PII cliente).
  await enqueueNotifica(client, {
    dedupeKey: `appuntamento_annullato_${row.data.id}_${todayRomeStr()}`,
    testo: `KONA Call Director - Appuntamento Business annullato (${row.data.id}). Nessun dato personale in questo avviso.`,
    extra: { codice: 'appuntamento_annullato' }
  });
  return jsonOk({ annullato: true });
}

async function azioneRiprogramma(client, cfg, body, profiloId, isAdmin) {
  const id = String(body.appuntamento_business_id || '');
  const row = await caricaAppuntamento(client, id, profiloId, isAdmin);
  if (!row.ok) return row.res;
  const startRaw = String(body.start || '');
  const start = startRaw ? new Date(startRaw) : null;
  if (start && (Number.isNaN(start.getTime()) || start.getTime() <= Date.now())) return jsonError(400, 'nuovo orario non valido');
  const patch = { stato: 'da_riprogrammare' };
  if (start) {
    patch.data_ora = start.toISOString();
    patch.riprogrammato_at = new Date().toISOString();
  }
  await client.from('kona_call_director_appuntamenti_business').update(patch).eq('id', row.data.id);
  if (row.data.appuntamento_id) {
    await client.from('appuntamenti').update({ data_ora: start ? start.toISOString() : row.data.data_ora, stato: 'rischedulato', motivo_modifica: 'Riprogrammato da KONA Call Director' }).eq('id', row.data.appuntamento_id);
  }
  if (start && row.data.google_event_id) {
    const accessToken = await getAccessToken(client);
    if (accessToken) {
      try {
        await updateEventTime(accessToken, { eventId: row.data.google_event_id, start: start.toISOString(), end: new Date(start.getTime() + (row.data.durata_minuti || 45) * 60000).toISOString() });
      } catch {
        await client.from('kona_call_director_appuntamenti_business').update({ sync_stato: 'da_recuperare' }).eq('id', row.data.id);
      }
    }
  }
  const { data: finale } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', id).single();
  return jsonOk({ da_riprogrammare: true, appuntamento: pubblicaAppuntamento(finale) });
}

// -- Sync Google (idempotente) -------------------------------------------------

async function sincronizzaGoogle(client, cfg, row, lead) {
  const accessToken = await getAccessToken(client);
  if (!accessToken) {
    await client.from('kona_call_director_appuntamenti_business').update({ sync_stato: 'da_recuperare' }).eq('id', row.id);
    return { ok: false, reason: 'no_token' };
  }
  try {
    // Idempotenza: se l'evento esiste gia' (kona_id) non ne crea un secondo.
    const timeMin = new Date(new Date(row.data_ora).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(new Date(row.data_ora).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const esistente = await findEventByKonaId(accessToken, { konaId: row.id, timeMin, timeMax });
    let evento = esistente ? { id: esistente.id, htmlLink: esistente.htmlLink } : null;
    if (!evento) {
      const nome = String(lead?.ragione_sociale || 'Azienda').slice(0, 80);
      evento = await insertEvent(accessToken, {
        summary: `Appuntamento: ${nome}`,
        start: row.data_ora,
        end: new Date(new Date(row.data_ora).getTime() + (row.durata_minuti || cfg.durata_appuntamento_minuti || 45) * 60000).toISOString(),
        description: `KONA Call Director - appuntamento Business (${row.id}).`,
        konaId: row.id
      });
    }
    await client.from('kona_call_director_appuntamenti_business').update({
      google_event_id: evento.id,
      sync_stato: 'sincronizzato',
      sync_dettagli: { html_link: evento.htmlLink }
    }).eq('id', row.id);
    return { ok: true };
  } catch (e) {
    await client.from('kona_call_director_appuntamenti_business').update({ sync_stato: 'da_recuperare' }).eq('id', row.id);
    await enqueueNotifica(client, {
      dedupeKey: `sync_appuntamento_${row.id}`,
      testo: `KONA Call Director - Sync Google da recuperare per appuntamento (${row.id}).`,
      extra: { codice: 'sync_fallito' }
    });
    return { ok: false, reason: String(e?.message || 'errore') };
  }
}

// -- Helpers ------------------------------------------------------------------

// Carica un appuntamento con CONTROLLO DI OWNERSHIP (operatore o admin).
async function caricaAppuntamento(client, id, profiloId, isAdmin) {
  if (!isUuid(id)) return { ok: false, res: jsonError(400, 'appuntamento_business_id non valido') };
  const { data } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', id).maybeSingle();
  if (!data) return { ok: false, res: jsonError(404, 'Appuntamento non trovato') };
  if (!isAdmin && String(data.operatore_id).toLowerCase() !== String(profiloId).toLowerCase()) {
    return { ok: false, res: jsonError(403, 'Appuntamento non di propria pertinenza') };
  }
  return { ok: true, data };
}

// Conflitti: appuntamenti condivisi CC + appuntamenti Business Mirox nell'intervallo.
async function conflittiAppuntamenti(client, { start, end }) {
  const s = start || new Date(Date.now()).toISOString();
  const e = end || new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
  const { data: cc } = await client.from('appuntamenti')
    .select('id, data_ora, durata_minuti')
    .not('stato', 'in', '("annullato")')
    .gte('data_ora', s)
    .lte('data_ora', e)
    .limit(200);
  const { data: biz } = await client.from('kona_call_director_appuntamenti_business')
    .select('id, data_ora, durata_minuti')
    .not('stato', 'in', '("annullato","concluso")')
    .gte('data_ora', s)
    .lte('data_ora', e)
    .limit(200);
  const conv = (rows) => (rows || []).map((r) => ({
    data_ora: r.data_ora,
    data_ora_fine: new Date(new Date(r.data_ora).getTime() + (r.durata_minuti || 45) * 60000).toISOString()
  }));
  return [...conv(cc), ...conv(biz)];
}

// Appuntamento esposto all'operatore (nome azienda incluso: e' UI operatore).
function pubblicaAppuntamento(row) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    appuntamento_id: row.appuntamento_id,
    data_ora: row.data_ora,
    durata_minuti: row.durata_minuti,
    zona: row.zona,
    stato: row.stato,
    google_event_id: row.google_event_id,
    sync_stato: row.sync_stato
  };
}
