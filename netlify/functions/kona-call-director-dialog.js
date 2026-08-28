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
  computeSlots, calendarIdFor, deleteEvent, findEventByKonaId, freeBusy, getAccessToken, insertEvent, listEvents, updateEventTime, verifySlotAvailability
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
      freeBusy(accessToken, { calendarId: calendarIdFor(cfg), timeMin: start, timeMax: end }),
      listEvents(accessToken, { calendarId: calendarIdFor(cfg), timeMin: start, timeMax: end })
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
  const start = new Date(String(body.start || ''));
  const durata = parseNumber(body.durata_minuti, cfg.durata_appuntamento_minuti) || cfg.durata_appuntamento_minuti || 45;
  if (!isUuid(leadId)) return jsonError(400, 'lead_id non valido');
  if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return jsonError(400, 'slot non valido o passato');
  const end = new Date(start.getTime() + durata * 60000);
  const { data: lead, error: leadError } = await client.from('call_center_lead_outbound')
    .select('id, ragione_sociale, zona, localita, provincia, telefono_norm, telefono_raw, codice_fiscale, partita_iva')
    .eq('id', leadId).maybeSingle();
  if (leadError || !lead) return jsonError(404, 'Lead non trovato');
  const telefono = lead.telefono_norm || lead.telefono_raw || null;
  if (!telefono) return jsonError(409, 'Il lead non ha un numero di telefono valido');

  const accessToken = await getAccessToken(client);
  if (!accessToken) return jsonError(409, 'Calendario Google non collegato');
  const conflitti = await conflittiAppuntamenti(client, {
    start: new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    end: new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString()
  });
  const disponibile = await verifySlotAvailability({
    supabase: client, cfg, start: start.toISOString(), end: end.toISOString(), accessToken,
    calendarId: calendarIdFor(cfg), appuntamentiConflitto: conflitti
  });
  if (!disponibile.ok) return jsonError(409, 'Slot non disponibile', { motivo: disponibile.reason });

  const zona = String(body.zona || lead.zona || lead.localita || 'Zona non definita');
  const { data: rpc, error: rpcErr } = await client.rpc('kona_cd_prenota_slot_v1', {
    p_lead_id: leadId,
    p_operatore_id: profiloId,
    p_data_ora: start.toISOString(),
    p_durata_minuti: durata,
    p_zona: zona,
    p_buffer_minuti: Number(cfg.buffer_appuntamento_minuti) || 15
  });
  if (rpcErr) return jsonError(500, rpcErr.message);
  if (!rpc?.ok) return jsonError(409, 'Slot non piu disponibile', { motivo: rpc?.motivo });
  const bizId = rpc.id;
  const { data: bizRow } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', bizId).maybeSingle();
  if (!bizRow) return jsonError(500, 'Prenotazione KONA non riletta');

  const { data: profilo } = await client.from('profili').select('nome').eq('id', profiloId).maybeSingle();
  const anagraficaId = isUuid(body.anagrafica_id) ? body.anagrafica_id : null;
  const { data: appuntamentoCondiviso, error: appErr } = await client.from('appuntamenti').insert({
    nome: String(lead.ragione_sociale || 'Azienda').slice(0, 120),
    codice_fiscale: lead.codice_fiscale || lead.partita_iva || null,
    telefono,
    motivo: 'Appuntamento Business esterno',
    anagrafica_id: anagraficaId,
    fissato_da_operatore_id: profiloId,
    fissato_da_nome: profilo?.nome || null,
    data_ora: start.toISOString(),
    durata_minuti: durata,
    fonte: 'interno',
    stato: 'confermato',
    lead_outbound_id: leadId
  }).select('id').single();
  if (appErr || !appuntamentoCondiviso) {
    await client.from('kona_call_director_appuntamenti_business').delete().eq('id', bizId);
    return jsonError(500, appErr?.message || 'Salvataggio appuntamento Mirox fallito');
  }
  const { error: linkError } = await client.from('kona_call_director_appuntamenti_business')
    .update({ appuntamento_id: appuntamentoCondiviso.id, anagrafica_id: anagraficaId }).eq('id', bizId);
  if (linkError) {
    await client.from('appuntamenti').delete().eq('id', appuntamentoCondiviso.id);
    await client.from('kona_call_director_appuntamenti_business').delete().eq('id', bizId);
    return jsonError(500, 'Collegamento appuntamento fallito');
  }

  const sync = await sincronizzaGoogle(client, cfg, { ...bizRow, appuntamento_id: appuntamentoCondiviso.id }, lead);
  if (!sync.ok) {
    await client.from('appuntamenti').delete().eq('id', appuntamentoCondiviso.id);
    await client.from('kona_call_director_appuntamenti_business').delete().eq('id', bizId);
    return jsonError(409, 'Appuntamento non creato: sincronizzazione Google fallita');
  }
  const { data: finale, error: finaleError } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', bizId).single();
  if (finaleError || !finale) return jsonError(500, 'Rilettura appuntamento fallita');
  return jsonOk({ appuntamento: pubblicaAppuntamento(finale), slot: true });
}

async function azioneConferma(client, cfg, body, profiloId, isAdmin) {
  const id = String(body.appuntamento_business_id || '');
  const row = await caricaAppuntamento(client, id, profiloId, isAdmin);
  if (!row.ok) return row.res;
  const { data: leadConferma } = await client.from('call_center_lead_outbound').select('ragione_sociale').eq('id', row.data.lead_id).maybeSingle();
  const syncConferma = await sincronizzaGoogle(client, cfg, { ...row.data, stato: 'confermato' }, leadConferma);
  if (!syncConferma.ok) return jsonError(409, 'Conferma non completata: sincronizzazione Google non disponibile');
  const { error: bizError } = await client.from('kona_call_director_appuntamenti_business').update({ stato: 'confermato' }).eq('id', row.data.id);
  if (bizError) return jsonError(500, bizError.message);
  if (row.data.appuntamento_id) {
    const { error: appError } = await client.from('appuntamenti').update({ stato: 'confermato' }).eq('id', row.data.appuntamento_id);
    if (appError) return jsonError(500, appError.message);
  }
  const { data: finale, error } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', id).single();
  if (error || !finale) return jsonError(500, 'Rilettura appuntamento fallita');
  return jsonOk({ appuntamento: pubblicaAppuntamento(finale) });
}

async function azioneAnnulla(client, cfg, body, profiloId, isAdmin) {
  const id = String(body.appuntamento_business_id || '');
  const row = await caricaAppuntamento(client, id, profiloId, isAdmin);
  if (!row.ok) return row.res;
  let syncDaRecuperare = false;
  if (row.data.google_event_id) {
    const accessToken = await getAccessToken(client);
    if (!accessToken) {
      syncDaRecuperare = true;
    } else {
      try {
        await deleteEvent(accessToken, { calendarId: calendarIdFor(cfg), eventId: row.data.google_event_id });
      } catch {
        syncDaRecuperare = true;
      }
    }
  }
  const { error: bizError } = await client.from('kona_call_director_appuntamenti_business').update({
    stato: 'annullato', sync_stato: syncDaRecuperare ? 'da_recuperare' : 'sincronizzato',
    ...(syncDaRecuperare ? {} : { google_event_id: null })
  }).eq('id', row.data.id);
  if (bizError) return jsonError(500, bizError.message);
  if (row.data.appuntamento_id) {
    const { error: sharedError } = await client.from('appuntamenti').update({
      stato: 'annullato', motivo_modifica: 'Annullato da KONA Call Director'
    }).eq('id', row.data.appuntamento_id);
    if (sharedError) return jsonError(500, sharedError.message);
  }
  if (syncDaRecuperare) {
    await enqueueNotifica(client, {
      dedupeKey: `sync_annulla_${row.data.id}`,
      testo: `KONA Call Director - Eliminazione Google da recuperare (${row.data.id}).`,
      extra: { codice: 'sync_fallito' }
    });
  }
  await enqueueNotifica(client, {
    dedupeKey: `appuntamento_annullato_${row.data.id}_${todayRomeStr()}`,
    testo: `KONA Call Director - Appuntamento Business annullato (${row.data.id}). Nessun dato personale in questo avviso.`,
    extra: { codice: 'appuntamento_annullato' }
  });
  return jsonOk({ annullato: true, sync_da_recuperare: syncDaRecuperare });
}

async function azioneRiprogramma(client, cfg, body, profiloId, isAdmin) {
  const id = String(body.appuntamento_business_id || '');
  const row = await caricaAppuntamento(client, id, profiloId, isAdmin);
  if (!row.ok) return row.res;
  const start = new Date(String(body.start || ''));
  if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return jsonError(400, 'nuovo orario non valido');
  const durata = row.data.durata_minuti || cfg.durata_appuntamento_minuti || 45;
  const end = new Date(start.getTime() + durata * 60000);
  const accessToken = await getAccessToken(client);
  if (!accessToken) return jsonError(409, 'Calendario Google non collegato');
  const conflitti = await conflittiAppuntamenti(client, {
    start: new Date(start.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    end: new Date(end.getTime() + 24 * 60 * 60 * 1000).toISOString()
  });
  const disponibile = await verifySlotAvailability({
    supabase: client, cfg, start: start.toISOString(), end: end.toISOString(), accessToken,
    calendarId: calendarIdFor(cfg), appuntamentiConflitto: conflitti
  });
  if (!disponibile.ok) return jsonError(409, 'Nuovo slot non disponibile', { motivo: disponibile.reason });

  const { data: leadRiprogramma } = await client.from('call_center_lead_outbound').select('ragione_sociale').eq('id', row.data.lead_id).maybeSingle();
  const sync = await sincronizzaGoogle(client, cfg, { ...row.data, data_ora: start.toISOString() }, leadRiprogramma);
  if (!sync.ok) return jsonError(409, 'Riprogrammazione non completata: sync Google fallito');

  const { error: bizError } = await client.from('kona_call_director_appuntamenti_business').update({
    stato: 'proposto', data_ora: start.toISOString(), riprogrammato_at: new Date().toISOString(),
    google_event_id: sync.eventId || row.data.google_event_id, sync_stato: 'sincronizzato'
  }).eq('id', row.data.id);
  let sharedError = null;
  if (!bizError && row.data.appuntamento_id) {
    const result = await client.from('appuntamenti').update({
      data_ora: start.toISOString(), stato: 'rischedulato', motivo_modifica: 'Riprogrammato da KONA Call Director'
    }).eq('id', row.data.appuntamento_id);
    sharedError = result.error;
  }
  if (bizError || sharedError) {
    try {
      if (sync.created && sync.eventId) {
        await deleteEvent(accessToken, { calendarId: calendarIdFor(cfg), eventId: sync.eventId });
      } else if (sync.eventId) {
        await updateEventTime(accessToken, {
          calendarId: calendarIdFor(cfg), eventId: sync.eventId,
          start: row.data.data_ora,
          end: new Date(new Date(row.data.data_ora).getTime() + durata * 60000).toISOString()
        });
      }
    } catch { /* la riconciliazione verra notificata */ }
    await client.from('kona_call_director_appuntamenti_business').update({ sync_stato: 'da_recuperare' }).eq('id', row.data.id);
    await enqueueNotifica(client, {
      dedupeKey: `sync_riprogramma_${row.data.id}`,
      testo: `KONA Call Director - Riprogrammazione da riconciliare (${row.data.id}).`,
      extra: { codice: 'sync_fallito' }
    });
    return jsonError(500, bizError?.message || sharedError?.message || 'Persistenza riprogrammazione fallita');
  }
  const { data: finale, error } = await client.from('kona_call_director_appuntamenti_business').select('*').eq('id', id).single();
  if (error || !finale) return jsonError(500, 'Rilettura appuntamento fallita');
  return jsonOk({ riprogrammato: true, appuntamento: pubblicaAppuntamento(finale) });
}

// -- Sync Google (idempotente) -------------------------------------------------

async function sincronizzaGoogle(client, cfg, row, lead) {
  const accessToken = await getAccessToken(client);
  if (!accessToken) {
    await client.from('kona_call_director_appuntamenti_business').update({ sync_stato: 'da_recuperare' }).eq('id', row.id);
    return { ok: false, reason: 'no_token' };
  }
  let evento = null;
  let eventoCreatoOra = false;
  try {
    const durata = row.durata_minuti || cfg.durata_appuntamento_minuti || 45;
    const end = new Date(new Date(row.data_ora).getTime() + durata * 60000).toISOString();
    const timeMin = new Date(new Date(row.data_ora).getTime() - 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(new Date(row.data_ora).getTime() + 24 * 60 * 60 * 1000).toISOString();

    if (row.google_event_id) {
      try {
        await updateEventTime(accessToken, {
          calendarId: calendarIdFor(cfg), eventId: row.google_event_id, start: row.data_ora, end
        });
        evento = { id: row.google_event_id, htmlLink: null };
      } catch (eventError) {
        if (Number(eventError?.status) !== 404) throw eventError;
      }
    }
    if (!evento) {
      const esistente = await findEventByKonaId(accessToken, {
        calendarId: calendarIdFor(cfg), konaId: row.id, timeMin, timeMax
      });
      evento = esistente ? { id: esistente.id, htmlLink: esistente.htmlLink || null } : null;
    }
    if (!evento) {
      const nome = String(lead?.ragione_sociale || 'Azienda').slice(0, 80);
      evento = await insertEvent(accessToken, {
        calendarId: calendarIdFor(cfg),
        summary: `Appuntamento: ${nome}`,
        start: row.data_ora,
        end,
        description: `KONA Call Director - appuntamento Business (${row.id}).`,
        konaId: row.id
      });
      eventoCreatoOra = true;
    }
    const { error: syncError } = await client.from('kona_call_director_appuntamenti_business').update({
      google_event_id: evento.id,
      sync_stato: 'sincronizzato',
      sync_dettagli: { html_link: evento.htmlLink || null }
    }).eq('id', row.id);
    if (syncError) throw new Error(syncError.message || 'persistenza_sync_fallita');
    return { ok: true, eventId: evento.id, created: eventoCreatoOra };
  } catch (e) {
    if (eventoCreatoOra && evento?.id) {
      try { await deleteEvent(accessToken, { calendarId: calendarIdFor(cfg), eventId: evento.id }); } catch { /* riconciliazione manuale */ }
    }
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
    sync_stato: row.sync_stato
  };
}
