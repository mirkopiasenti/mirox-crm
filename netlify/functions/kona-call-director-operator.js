/**
 * KONA Call Director — operazioni unificate dell'operatrice.
 *
 * Tutti i dati definitivi restano nelle tabelle canoniche del Call Center.
 * Le tabelle KONA contengono soltanto sessioni, audit e failover tecnico.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');
const { authAndEnabled } = require('./_lib/kona-cd-config');
const { normTel, registraChiamataConsumerCanonica, upsertAnagraficaConsumer } = require('./_lib/kona-cd-engine');
const { enqueueNotifica } = require('./_lib/kona-cd-notifiche');
const { romeDayRange, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, isUuid, jsonError, jsonOk, readJsonBody } = require('./_lib/kona-cd-util');

const ESITI_CANONICI = new Set([
  'non_risposto', 'non_interessato', 'passa_in_negozio',
  'ricontattare', 'appuntamento', 'passa_a_cerea'
]);
const AI_FAILOVER_CODES = new Set([
  'no_api_key', 'auth_error', 'unavailable', 'timeout',
  'network_error', 'rate_limited', 'generic_error'
]);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonError(405, 'Metodo non consentito');

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const guard = await authAndEnabled(event, { supabase: client, response: jsonError });
  if (guard.response) return guard.response;

  const body = await readJsonBody(event);
  const action = String(body.action || '');
  const { cfg, profiloId, auth } = guard;
  const profiloNome = auth?.profilo?.nome || 'Operatore';
  const isAdmin = auth?.profilo?.ruolo === 'admin';

  try {
    switch (action) {
      case 'cerca_consumer':
        return await cercaConsumer(client, body);
      case 'salva_consumer':
        return await salvaConsumer(client, cfg, body, profiloId, profiloNome);
      case 'cerca_inbound':
        return await cercaInbound(client, body, profiloId, isAdmin);
      case 'storico':
        return await storico(client, body, profiloId, isAdmin);
      case 'correggi_esito':
        return await correggiEsito(client, body, profiloId, isAdmin);
      case 'attiva_failover':
        return await attivaFailover(client, body, profiloId);
      case 'chiudi_failover':
        return await chiudiFailover(client, profiloId);
      case 'audit_pausa':
        return await auditPausa(client, body, profiloId);
      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (error) {
    console.error('KONA operator:', cleanLog(error?.message || 'errore_operazione', 200));
    return jsonError(500, 'Operazione KONA non disponibile', { error_code: 'operator_unavailable' });
  }
};

function normalizzaCf(value) {
  return String(value || '').trim().toUpperCase().slice(0, 16);
}

function validaCfPiva(value) {
  const v = normalizzaCf(value);
  return /^([A-Z0-9]{16}|[0-9]{11})$/.test(v) ? v : null;
}

function dtoChiamata(row, profiloId, isAdmin) {
  if (!row) return null;
  const oggi = todayRomeStr();
  const dataRoma = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(row.data_ora));
  return {
    id: row.id,
    anagrafica_id: row.anagrafica_id || null,
    nome_cliente: row.nome_cliente || null,
    cf_piva: row.cf_piva || null,
    cellulare: row.cellulare || null,
    motivo_chiamata: row.motivo_chiamata || null,
    esito: row.esito,
    note: row.note || null,
    data_ora: row.data_ora,
    operatore_nome: row.operatore_nome || null,
    modificabile: dataRoma === oggi && (isAdmin || row.operatore_id === profiloId)
  };
}

async function cercaConsumer(client, body) {
  const cf = validaCfPiva(body.cf_piva);
  if (!cf) return jsonError(400, 'Inserisci un CF o una P.IVA valida');

  const [{ data: blacklist, error: blacklistError }, { data: cliente, error: clienteError }, { data: chiamate, error: chiamateError }] = await Promise.all([
    client.from('blacklist').select('id').ilike('cf_piva', cf).limit(1).maybeSingle(),
    client.from('anagrafica').select('id,cf_piva,cluster,ragione_sociale,nome_referente,cellulare,email,provincia,comune,via,civico').ilike('cf_piva', cf).limit(1).maybeSingle(),
    client.from('chiamate').select('id,anagrafica_id,cf_piva,nome_cliente,cellulare,motivo_chiamata,esito,note,data_ora,operatore_id,operatore_nome').ilike('cf_piva', cf).order('data_ora', { ascending: false }).limit(5)
  ]);
  if (blacklistError || clienteError || chiamateError) return jsonError(500, 'Ricerca Consumer non disponibile');
  if (blacklist) return jsonOk({ blacklist: true, cliente: null, storico: [] });
  return jsonOk({ blacklist: false, cliente: cliente || null, storico: (chiamate || []).map((r) => dtoChiamata(r, null, false)) });
}

async function sessioneConsumerAttiva(client, profiloId, categoria) {
  const { data, error } = await client.from('kona_call_director_sessioni')
    .select('id,categoria').eq('data', todayRomeStr()).eq('operatore_id', profiloId)
    .eq('stato', 'attiva').eq('categoria', categoria).limit(1).maybeSingle();
  if (error || !data) throw new Error('Nessuna sessione Consumer attiva');
  return data;
}

async function salvaConsumer(client, cfg, body, profiloId, profiloNome) {
  const categoria = String(body.categoria || '').trim();
  const esito = String(body.esito || '').trim();
  if (!categoria) return jsonError(400, 'Categoria Consumer mancante');
  if (!ESITI_CANONICI.has(esito) || esito === 'appuntamento') {
    return jsonError(400, 'Esito Consumer non valido per questo salvataggio');
  }
  const motivo = String(body.motivo || '').trim();
  const copertura = String(body.copertura || '').trim();
  if (!motivo || !copertura) return jsonError(400, 'Copertura e motivo sono obbligatori');
  const sessione = await sessioneConsumerAttiva(client, profiloId, categoria);
  const upsert = await upsertAnagraficaConsumer(client, body.cliente || {}, profiloId);
  const cliente = upsert.anagrafica;

  const chiamataId = await registraChiamataConsumerCanonica(client, cfg, {
    operatoreId: profiloId,
    operatoreNome: profiloNome,
    anagraficaId: cliente.id,
    cfPiva: cliente.cf_piva,
    nomeCliente: cliente.nome_referente || cliente.ragione_sociale,
    cellulare: cliente.cellulare,
    copertura,
    esito,
    motivo,
    note: body.note,
    dataRicontatto: body.data_ricontatto,
    fasciaRicontatto: body.fascia_ricontatto
  });

  const { data: attivita, error } = await client.from('kona_call_director_sessione_attivita').insert({
    sessione_id: sessione.id,
    operatore_id: profiloId,
    categoria,
    esito,
    note: `chiamata:${chiamataId};anagrafica:${cliente.id};sorgente:kona_consumer`
  }).select('id').single();
  if (error || !attivita) {
    await client.from('chiamate').delete().eq('id', chiamataId);
    return jsonError(500, error?.message || 'Registrazione attività Consumer fallita');
  }

  const { count } = await client.from('kona_call_director_sessione_attivita')
    .select('id', { count: 'exact', head: true }).eq('sessione_id', sessione.id);
  return jsonOk({ chiamata_id: chiamataId, anagrafica_id: cliente.id, anagrafica_creata: upsert.created, totale_sessione: Number(count) || 0 });
}

async function cercaInbound(client, body, profiloId, isAdmin) {
  const telefono = normTel(body.telefono);
  if (telefono.length < 9) return jsonError(400, 'Inserisci un numero di telefono valido');
  const suffix = telefono.slice(-9);
  const [{ data: anagrafiche, error: anagError }, { data: chiamate, error: chiamateError }, { data: lead, error: leadError }] = await Promise.all([
    client.from('anagrafica').select('id,cf_piva,ragione_sociale,nome_referente,cellulare,comune').ilike('cellulare', `%${suffix}%`).limit(20),
    client.from('chiamate').select('id,anagrafica_id,cf_piva,nome_cliente,cellulare,motivo_chiamata,esito,note,data_ora,operatore_id,operatore_nome').ilike('cellulare', `%${suffix}%`).order('data_ora', { ascending: false }).limit(30),
    client.from('call_center_lead_outbound').select('id,ragione_sociale,telefono_raw,telefono_norm,categoria,localita,stato_lead,note_ultima,ultimo_contatto_at').or(`telefono_norm.eq.${telefono},telefono_raw.ilike.%${suffix}%`).limit(20)
  ]);
  if (anagError || chiamateError || leadError) return jsonError(500, 'Ricerca numero non disponibile');

  const anagraficheFiltrate = (anagrafiche || []).filter((r) => normTel(r.cellulare) === telefono);
  const chiamateFiltrate = (chiamate || []).filter((r) => normTel(r.cellulare) === telefono);
  const leadFiltrati = (lead || []).filter((r) => normTel(r.telefono_norm || r.telefono_raw) === telefono);
  return jsonOk({
    telefono,
    anagrafiche: anagraficheFiltrate,
    chiamate: chiamateFiltrate.map((r) => dtoChiamata(r, profiloId, isAdmin)),
    lead_business: leadFiltrati
  });
}

async function storico(client, body, profiloId, isAdmin) {
  const range = romeDayRange(todayRomeStr());
  let query = client.from('chiamate')
    .select('id,anagrafica_id,cf_piva,nome_cliente,cellulare,motivo_chiamata,esito,note,data_ora,operatore_id,operatore_nome')
    .gte('data_ora', range.start.toISOString()).lt('data_ora', range.end.toISOString())
    .order('data_ora', { ascending: false }).limit(100);
  const testo = String(body.query || '').trim();
  if (testo) {
    const safe = testo.replace(/[%_,.()]/g, ' ').trim().slice(0, 80);
    if (safe) query = query.or(`nome_cliente.ilike.%${safe}%,cf_piva.ilike.%${safe}%,cellulare.ilike.%${safe}%`);
  }
  const { data, error } = await query;
  if (error) return jsonError(500, 'Storico non disponibile');
  return jsonOk({ chiamate: (data || []).map((r) => dtoChiamata(r, profiloId, isAdmin)) });
}

async function correggiEsito(client, body, profiloId, isAdmin) {
  const chiamataId = String(body.chiamata_id || '');
  const esito = String(body.esito || '');
  const motivo = String(body.motivo || '').trim().slice(0, 500);
  if (!isUuid(chiamataId)) return jsonError(400, 'Chiamata non valida');
  if (!ESITI_CANONICI.has(esito)) return jsonError(400, 'Esito non valido');
  if (motivo.length < 3) return jsonError(400, 'Motivazione obbligatoria');
  const { data, error } = await client.rpc('kona_cd_correggi_esito_v1', {
    p_chiamata_id: chiamataId,
    p_attore_id: profiloId,
    p_attore_admin: isAdmin,
    p_esito_nuovo: esito,
    p_motivo: motivo,
    p_data_ricontatto: body.data_ricontatto || null,
    p_fascia_ricontatto: body.fascia_ricontatto || null,
    p_canale: body.canale === 'kona_storico' ? 'kona_storico' : 'kona_inbound'
  });
  if (error) return jsonError(409, error.message || 'Correzione non consentita');
  return jsonOk({ correzione: data });
}

async function attivaFailover(client, body, profiloId) {
  const codice = String(body.codice || '').trim();
  if (!AI_FAILOVER_CODES.has(codice)) return jsonError(400, 'Codice failover non valido');
  const dettaglio = String(body.dettaglio || '').replace(/[\r\n]+/g, ' ').slice(0, 300);
  const scadeAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const { error } = await client.from('kona_call_director_failover').upsert({
    profilo_id: profiloId,
    codice,
    dettaglio_tecnico: cleanLog(dettaglio, 300),
    attivato_at: new Date().toISOString(),
    scade_at: scadeAt,
    risolto_at: null
  }, { onConflict: 'profilo_id' });
  if (error) return jsonError(500, 'Failover manuale non disponibile');
  await client.from('kona_call_director_audit').insert({
    azione: 'failover_ai_attivato', autore: profiloId,
    dettagli: cleanLog({ codice, scade_at: scadeAt })
  });
  await enqueueNotifica(client, {
    dedupeKey: `kona_ai_failover_${profiloId}_${todayRomeStr()}`,
    testo: `KONA Call Director: failover manuale attivato per un'operatrice. Codice tecnico: ${codice}. Verificare lo staging.`
  });
  return jsonOk({ manuale: true, scade_at: scadeAt, redirect: 'registra-chiamata.html' });
}

async function chiudiFailover(client, profiloId) {
  const { error } = await client.from('kona_call_director_failover')
    .update({ risolto_at: new Date().toISOString() }).eq('profilo_id', profiloId).is('risolto_at', null);
  if (error) return jsonError(500, 'Chiusura failover non riuscita');
  return jsonOk({ manuale: false });
}

async function auditPausa(client, body, profiloId) {
  const stato = body.stato === 'ripresa' ? 'ripresa' : 'pausa';
  const { error } = await client.from('kona_call_director_audit').insert({
    azione: `sessione_${stato}`,
    autore: profiloId,
    dettagli: { data: todayRomeStr() }
  });
  if (error) return jsonError(500, 'Audit pausa non disponibile');
  return jsonOk({ stato });
}

module.exports._test = {
  AI_FAILOVER_CODES,
  ESITI_CANONICI,
  dtoChiamata,
  normalizzaCf,
  validaCfPiva
};
