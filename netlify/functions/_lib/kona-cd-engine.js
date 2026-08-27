'use strict';

const { addDaysStr, nowRomeParts, parseHHmm, romeDayRange, todayRomeStr } = require('./kona-cd-time');
const { cleanLog, isUuid } = require('./kona-cd-util');
const { finestraAttiva, tentativoEsaurito } = require('./kona-cd-conferme');

// Motore deterministico KONA Call Director (nessuna AI).
// Responsabilita':
// - priorita' 1..7 dei contatti
// - ri-verifica blacklist / esclusioni PRIMA della materializzazione e della
//   vista; blacklist FAIL-CLOSED (errore di lettura = nessun contatto proposto)
// - tentativi PERSISTENTI per contatto/campagna (mai azzerati tra task)
// - lease "un contatto alla volta" per operatrice (indice unico parziale su
//   stato IN ('attivo','sospeso') + lease_until/owner)
// - esiti validi, skip motivati, max 3 tentativi normali con alternanza
//   mattina/pomeriggio; max 4 conferme senza auto-cancel
// - integrazione con la lavorazione esistente: ricontatti dalla vista
//   unificata (standard + outbound business) e registrazione chiamate/attivita'
//   outbound sugli esiti Business

const CHIAMATE_ESITI = ['non_risposto', 'non_interessato', 'passa_in_negozio', 'ricontattare', 'appuntamento', 'passa_a_cerea'];
const LEAD_ESITI = ['non_risposto', 'non_interessato', 'appuntamento', 'passa_in_negozio', 'ricontattare', 'chiuso', 'altro'];
const CONFERMA_ESITI = ['confermato', 'non_risposto', 'annullato', 'da_riprogrammare'];

const SKIP_REASONS = [
  'dato_errato',
  'numero_non_utilizzabile',
  'cliente_momentaneamente_indisponibile',
  'duplicato',
  'possibile_cliente_gia_acquisito',
  'trattative_gia_in_corso',
  'problema_tecnico',
  'altro'
];

const ESITI_PER_TIPO = {
  conferma_appuntamento_business: CONFERMA_ESITI,
  ricontatto_programmato: CHIAMATE_ESITI,
  auto_non_risposto: CHIAMATE_ESITI,
  passa_a_cerea: CHIAMATE_ESITI,
  passa_in_negozio: CHIAMATE_ESITI,
  campagna_urgente: LEAD_ESITI,
  sessione_business: LEAD_ESITI,
  enrichment_review: ['verificato', 'non_trovato', 'altro']
};

// Durata lease di un task lavorabile (in ms): oltre, il task puo' essere
// reclamato (scadenza owner).
const LEASE_DURATION_MS = 12 * 60 * 60 * 1000;

// -- Telefoni (normalizzazione) ------------------------------------------------

// Normalizza un numero italiano: solo cifre, prefisso internazionale coerente.
function normTel(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0039')) digits = '39' + digits.slice(4);
  if (digits.startsWith('39') && digits.length === 12) digits = digits.slice(2); // 39123456789 -> 123456789
  if (digits.startsWith('+39')) digits = digits.slice(3);
  return digits;
}

function telefoniUnici(values) {
  const out = [];
  const seen = new Set();
  for (const v of values || []) {
    const n = normTel(v);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

// -- Blacklist (FAIL-CLOSED) ---------------------------------------------------

// Ritorna { ok, rows }. Errori di lettura -> ok:false (fail-closed).
async function loadBlacklistSet(supabase) {
  const { data, error } = await supabase.from('blacklist').select('cf_piva, cellulare, nome_cognome');
  if (error || !Array.isArray(data)) return { ok: false };
  return { ok: true, rows: data };
}

// Confronto con CF/PIVA e TUTTI i numeri disponibili, normalizzati.
function pureBlacklisted(blacklistRows, { cf_piva, telefoni }) {
  const cf = String(cf_piva || '').trim().toUpperCase();
  const teles = telefoniUnici(telefoni);
  if (!cf && teles.length === 0) return false;
  return blacklistRows.some((row) => {
    if (cf && String(row.cf_piva || '').toUpperCase() === cf) return true;
    const rowTel = normTel(row.cellulare);
    if (rowTel && teles.includes(rowTel)) return true;
    return false;
  });
}

// Inserisce nella blacklist REALE. Una riga per numero (cf_piva NOT NULL).
// Ritorna { ok, error }.
// La tabella `blacklist` e' CONDIVISA col Call Center prod e NON ha un vincolo
// UNIQUE su (cf_piva, cellulare): niente upsert/onConflict. Dedup manuale
// (select-then-insert) per non duplicare e per non alterare la tabella condivisa.
async function addBlacklist(supabase, { cfPiva, nome, telefoni }) {
  const cf = String(cfPiva || '').trim().toUpperCase();
  if (!cf) return { ok: false, error: 'blacklist_richiede_cf' };
  const nomeCognome = String(nome || '').slice(0, 200) || null;
  const teles = telefoniUnici(telefoni);
  const righe = teles.length
    ? teles.map((t) => ({ cf_piva: cf, nome_cognome: nomeCognome, cellulare: t }))
    : [{ cf_piva: cf, nome_cognome: nomeCognome, cellulare: null }];
  for (const riga of righe) {
    let esistenteQuery = supabase.from('blacklist').select('id').eq('cf_piva', cf);
    esistenteQuery = riga.cellulare === null
      ? esistenteQuery.is('cellulare', null)
      : esistenteQuery.eq('cellulare', riga.cellulare);
    const { data: esistente } = await esistenteQuery.limit(1).maybeSingle();
    if (esistente) continue;
    const { error } = await supabase.from('blacklist').insert(riga);
    if (error) return { ok: false, error };
  }
  return { ok: true };
}

// -- Esclusioni ---------------------------------------------------------------

async function loadEsclusioniAttive(supabase) {
  const { data, error } = await supabase
    .from('kona_call_director_esclusioni')
    .select('id, lead_id, anagrafica_id, chiamata_id')
    .eq('stato', 'attiva');
  if (error || !Array.isArray(data)) return [];
  return data;
}

function pureEscluso(exclusionRows, { leadId, anagraficaId, chiamataId }) {
  return exclusionRows.some((row) => {
    if (isUuid(leadId) && row.lead_id === leadId) return true;
    if (isUuid(anagraficaId) && row.anagrafica_id === anagraficaId) return true;
    if (isUuid(chiamataId) && row.chiamata_id === chiamataId) return true;
    return false;
  });
}

async function addEsclusione(supabase, { leadId, anagraficaId, chiamataId, tipo, motivo, esclusoDa, dettagli = {} }) {
  const record = {
    ...(isUuid(leadId) ? { lead_id: leadId } : {}),
    ...(isUuid(anagraficaId) ? { anagrafica_id: anagraficaId } : {}),
    ...(isUuid(chiamataId) ? { chiamata_id: chiamataId } : {}),
    tipo,
    motivo: String(motivo || '').slice(0, 500) || null,
    dettagli: cleanLog(dettagli),
    escluso_da: isUuid(esclusoDa) ? esclusoDa : null,
    stato: 'attiva'
  };
  const { error } = await supabase.from('kona_call_director_esclusioni').insert(record);
  return !error;
}

// -- Fasci orari --------------------------------------------------------------

function fasciaCorrente(cfg) {
  const minute = nowRomeParts().hh * 60 + nowRomeParts().mm;
  const fineMattina = parseHHmm(cfg.orario_mattina?.fine) ?? (12 * 60 + 30);
  return minute < fineMattina ? 'Mattina' : 'Pomeriggio';
}

// Prossima fascia per un non-risposto: mattina -> oggi pomeriggio, pomeriggio -> domani mattina.
function prossimaFascia(fascia, oggi) {
  if (fascia === 'Mattina') return { fascia: 'Pomeriggio', data: oggi };
  return { fascia: 'Mattina', data: addDaysStr(oggi, 1) };
}

// Fascia attesa per un appuntamento di conferma (9/11:30 mattina, 15:30/18 pomeriggio).
function fasciaDaOra(hhmm) {
  const min = parseHHmm(hhmm) ?? 0;
  return min < 15 * 60 ? 'Mattina' : 'Pomeriggio';
}

// -- Tentativi persistenti ----------------------------------------------------

// Conta i task completati con esito non_risposto per lo STESSO sorgente negli
// ultimi N giorni: i tentativi NON ripartono da zero tra un task e l'altro.
async function tentativiGiorni(supabase, { operatoreId, sorgenteId, giorni }) {
  if (!isUuid(sorgenteId)) return 0;
  const since = addDaysStr(todayRomeStr(), -Number(giorni || 30));
  const { data, error } = await supabase
    .from('kona_call_director_task')
    .select('id')
    .eq('operatore_id', operatoreId)
    .eq('sorgente_id', sorgenteId)
    .eq('stato', 'completato')
    .gte('data', since)
    .filter('esito->>esito', 'eq', 'non_risposto');
  return !error && Array.isArray(data) ? data.length : 0;
}

// Numero di tentativo persistente del contatto: 1 + tentativi gia' esauriti.
async function tentativoPersistente(supabase, { operatoreId, sorgenteId, tipo }) {
  const giorni = tipo === 'conferma_appuntamento_business' ? 10 : 30;
  const n = await tentativiGiorni(supabase, { operatoreId, sorgenteId, giorni });
  return n + 1;
}

// -- Candidati (sorgente unificata) -------------------------------------------

async function isBlacklistedOrEscluso(candidate, blacklistRows, exclusionRows) {
  const bl = pureBlacklisted(blacklistRows, { cf_piva: candidate.cf_piva, telefoni: candidate.telefoni });
  if (bl) return { blocked: true, motivo: 'blacklist' };
  const ex = pureEscluso(exclusionRows, {
    leadId: candidate.leadId || (candidate.sorgenteTipo === 'lead' || candidate.sorgenteTipo === 'lead_outbound_chiamata' ? candidate.sorgenteId : undefined),
    anagraficaId: candidate.anagraficaId,
    chiamataId: candidate.sorgenteTipo === 'chiamata' ? candidate.sorgenteId : undefined
  });
  if (ex) return { blocked: true, motivo: 'esclusione' };
  return { blocked: false };
}

// Ricontatti dalla VISTA UNIFICATA (standard + outbound business): stessa
// fonte usata dal Call Center prod, niente seconda fonte di verita'.
async function queryRilavorazioneUnificata(supabase, { profiloId, oggi, fascia }) {
  const { data, error } = await supabase
    .from('vw_rilavorazione_ricontatti_unificata')
    .select('*')
    .eq('operatore_id', profiloId)
    .limit(300);
  if (error || !Array.isArray(data)) return [];
  return data.filter((row) => {
    const rc = row.data_ricontatto;
    if (rc !== null && String(rc) > oggi) return false;
    if (fascia) {
      const fr = row.fascia_ricontatto;
      if (fr !== null && fr !== fascia) return false;
    }
    return true;
  });
}

// Passa in negozio / passa a Cerea: query sulle chiamate con passaggio attivo.
async function queryChiamatePassaggio(supabase, { profiloId, oggi, passaggioStati }) {
  const { data, error } = await supabase
    .from('chiamate')
    .select('id, cf_piva, nome_cliente, cellulare, anagrafica_id, esito, data_ricontatto, fascia_ricontatto, passaggio_stato, data_ora, motivo_chiamata, note')
    .eq('operatore_id', profiloId)
    .in('passaggio_stato', passaggioStati)
    .limit(200);
  if (error || !Array.isArray(data)) return [];
  return data;
}

async function candidatiConfermaBusiness(supabase, cfg, { profiloId, oggi }) {
  // Solo dentro una finestra di conferma attiva si materializza (top of queue).
  const attiva = finestraAttiva(cfg);
  if (!attiva) return [];
  const domani = addDaysStr(oggi, 1);
  const range = romeDayRange(domani);
  const { data, error } = await supabase
    .from('kona_call_director_appuntamenti_business')
    .select('id, lead_id, anagrafica_id, data_ora, durata_minuti, zona, stato, esito, creato_at, riprogrammato_at')
    .eq('operatore_id', profiloId)
    .eq('stato', 'proposto')
    .gte('data_ora', range.start.toISOString())
    .lt('data_ora', range.end.toISOString())
    .limit(30);
  if (error || !Array.isArray(data)) return [];

  // Esclusione: niente conferma se creato/riprogrammato IL GIORNO PRIMA per
  // il giorno successivo (gia' concordato il giorno stesso).
  const ieriInizio = romeDayRange(addDaysStr(oggi, -1)).start.toISOString();
  const senzaConferma = data.filter((a) => {
    const creato = a.creato_at ? new Date(a.creato_at) : null;
    const riprogrammato = a.riprogrammato_at ? new Date(a.riprogrammato_at) : null;
    const ultimo = riprogrammato || creato;
    if (!ultimo) return true;
    return ultimo.toISOString() < ieriInizio; // solo se creato prima di ieri
  });

  const ids = senzaConferma.map((a) => a.id);
  if (ids.length === 0) return [];
  const { data: conferme } = await supabase
    .from('kona_call_director_conferme')
    .select('appuntamento_business_id')
    .eq('data', oggi)
    .eq('orario_previsto', attiva.orario)
    .in('appuntamento_business_id', ids);
  const giaTentata = new Set((conferme || []).map((c) => c.appuntamento_business_id));
  return senzaConferma
    .filter((a) => !giaTentata.has(a.id))
    .map((a) => ({
      tipo: 'conferma_appuntamento_business',
      sorgenteId: a.id,
      sorgenteTipo: 'appuntamento_business',
      payload: { appuntamento_business_id: a.id, lead_id: a.lead_id, anagrafica_id: a.anagrafica_id, zona: a.zona, data_ora: a.data_ora },
      descrizione: 'Conferma appuntamento Business di domani',
      priority: 1,
      ...(a.anagrafica_id ? { anagraficaId: a.anagrafica_id } : {})
    }));
}

async function candidatiRilavorazione(supabase, { profiloId, oggi, fascia }) {
  const out = [];
  const mkStandard = (row, tipo, priority, descrizione) => ({
    tipo,
    sorgenteId: row.id,
    sorgenteTipo: 'chiamata',
    payload: { chiamata_id: row.id, anagrafica_id: row.anagrafica_id },
    cf_piva: row.cf_piva,
    nome: row.nome_cliente,
    cellulare: row.cellulare,
    telefoni: [row.cellulare],
    anagraficaId: row.anagrafica_id,
    storico: { motivo: row.motivo_chiamata, note: row.note, esito: row.esito, data_ora: row.data_ora },
    descrizione,
    priority
  });
  const mkOutbound = (row, tipo, priority, descrizione) => ({
    tipo,
    sorgenteId: row.origine_id,
    sorgenteTipo: 'lead_outbound_chiamata',
    payload: { lead_id: row.lead_id, chiamata_outbound_id: row.origine_id, anagrafica_id: row.anagrafica_id },
    leadId: row.lead_id,
    cf_piva: row.cf_piva,
    nome: row.nome_cliente,
    cellulare: row.telefono,
    telefoni: [row.telefono],
    anagraficaId: row.anagrafica_id,
    storico: { motivo: row.motivo_chiamata, note: row.note, esito: row.esito, data_ora: row.data_ora },
    descrizione,
    priority
  });

  const unificata = await queryRilavorazioneUnificata(supabase, { profiloId, oggi, fascia });
  for (const row of unificata) {
    const esito = String(row.esito || '');
    if (esito === 'ricontattare' || esito === 'non_risposto') {
      const outbound = row.origine_tipo === 'outbound_business';
      out.push(outbound
        ? mkOutbound(row, esito === 'ricontattare' ? 'ricontatto_programmato' : 'auto_non_risposto', esito === 'ricontattare' ? 2 : 3, esito === 'ricontattare' ? 'Ricontatto programmato' : 'Non risposto automatico')
        : mkStandard(row, esito === 'ricontattare' ? 'ricontatto_programmato' : 'auto_non_risposto', esito === 'ricontattare' ? 2 : 3, esito === 'ricontattare' ? 'Ricontatto programmato' : 'Non risposto automatico'));
    }
  }

  // Passa a Cerea / Passa in negozio (chiamate standard con passaggio attivo).
  const cerea = await queryChiamatePassaggio(supabase, { profiloId, oggi, passaggioStati: ['in_attesa', 'ricontattare'] });
  for (const row of cerea) {
    const esito = String(row.esito || '');
    if (esito === 'passa_a_cerea') out.push(mkStandard(row, 'passa_a_cerea', 4, 'Passa a Cerea'));
    if (esito === 'passa_in_negozio') out.push(mkStandard(row, 'passa_in_negozio', 5, 'Passa in negozio'));
  }

  return out;
}

async function candidatiLead(supabase, cfg, { profiloId, oggi, pinnedOnly }) {
  // Business standard bloccato alle 18:00 (orario_stop_business configurabile).
  if (!pinnedOnly && cfg?.orario_stop_business) {
    const stop = parseHHmm(cfg.orario_stop_business);
    const nowMin = nowRomeParts().hh * 60 + nowRomeParts().mm;
    if (stop !== null && nowMin >= stop) return [];
  }
  const stati = ['nuovo', 'da_contattare', 'ricontattare', 'in_lavorazione'];
  const statiCampionabili = pinnedOnly ? stati : stati.filter((s) => s !== 'in_lavorazione');
  let query = supabase
    .from('call_center_lead_outbound')
    .select('id, ragione_sociale, localita, provincia, categoria, telefono_norm, telefono_raw, telefono_tipo, email, partita_iva, codice_fiscale, zona, stato_lead, pinned, do_not_call, ultimo_contatto_at, times_seen, first_import_at, prossimo_followup_at')
    .eq('do_not_call', false)
    .in('stato_lead', statiCampionabili)
    .limit(50);
  query = pinnedOnly
    ? query.eq('pinned', true)
    : query.or(`assegnato_a.is.null,assegnato_a.eq.${encodeURIComponent(profiloId)}`);
  const { data, error } = await query;
  if (error || !Array.isArray(data)) return [];
  return data
    .filter((row) => {
      // Rispetta prossimo_followup_at: non riproporre prima della data prevista.
      if (row.prossimo_followup_at) {
        const due = new Date(row.prossimo_followup_at);
        if (!Number.isNaN(due.getTime()) && due.getTime() > Date.now()) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aSeen = a.times_seen || 0;
      const bSeen = b.times_seen || 0;
      if (aSeen !== bSeen) return aSeen - bSeen;
      return String(a.first_import_at).localeCompare(String(b.first_import_at));
    })
    .map((row) => ({
      tipo: pinnedOnly ? 'campagna_urgente' : 'sessione_business',
      sorgenteId: row.id,
      sorgenteTipo: 'lead',
      payload: { lead_id: row.id, zona: row.zona, localita: row.localita },
      leadId: row.id,
      nome: row.ragione_sociale,
      cellulare: row.telefono_norm || row.telefono_raw,
      telefoni: [row.telefono_norm, row.telefono_raw],
      cf_piva: row.codice_fiscale || row.partita_iva,
      storico: { esito: row.stato_lead, ultimo_contatto_at: row.ultimo_contatto_at, times_seen: row.times_seen },
      descrizione: pinnedOnly ? 'Campagna urgente approvata' : 'Sessione Business',
      priority: pinnedOnly ? 6 : 7
    }));
}

async function buildCandidates(supabase, cfg, { profiloId, oggi }) {
  const fascia = fasciaCorrente(cfg);
  const candidates = [];
  candidates.push(...(await candidatiConfermaBusiness(supabase, cfg, { profiloId, oggi })));
  candidates.push(...(await candidatiRilavorazione(supabase, { profiloId, oggi, fascia })));
  candidates.push(...(await candidatiLead(supabase, cfg, { profiloId, oggi, pinnedOnly: true })));
  candidates.push(...(await candidatiLead(supabase, cfg, { profiloId, oggi, pinnedOnly: false })));
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates;
}

// -- Materializzazione --------------------------------------------------------

async function logEvent(supabase, { taskId, tipo, dettagli = {} }) {
  if (!taskId) return;
  await supabase.from('kona_call_director_task_eventi').insert({
    task_id: taskId,
    tipo,
    dettagli: cleanLog(dettagli)
  });
}

// Stato lavorabile = attivo O sospeso (al massimo UN task per operatrice).
async function getTaskLavorabile(supabase, profiloId) {
  const { data, error } = await supabase
    .from('kona_call_director_task')
    .select('*')
    .eq('operatore_id', profiloId)
    .in('stato', ['attivo', 'sospeso'])
    .order('assegnato_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

function getActiveTask(supabase, profiloId) {
  return supabase
    .from('kona_call_director_task')
    .select('*')
    .eq('operatore_id', profiloId)
    .eq('stato', 'attivo')
    .maybeSingle();
}

// Reclama/scade i task lavorabili con lease scaduto: li annulla e libera
// l'operatrice (mai piu' di un task lavorabile).
async function scadenzaTask(supabase, profiloId) {
  const task = await getTaskLavorabile(supabase, profiloId);
  if (!task) return;
  const lease = task.lease_until ? new Date(task.lease_until).getTime() : 0;
  if (lease && lease < Date.now()) {
    await supabase.from('kona_call_director_task').update({ stato: 'annullato', esito: cleanLog({ esito: 'lease_scaduta' }) }).eq('id', task.id);
    await logEvent(supabase, { taskId: task.id, tipo: 'errore', dettagli: { esito: 'lease_scaduta' } });
  }
}

// Materializza il prossimo task per l'operatrice. Ritorna { ok, task, noop, reason }.
async function materializeNextTask({ supabase, cfg, profiloId, oggi }) {
  if (!isUuid(profiloId)) return { ok: false, noop: true, reason: 'profilo_invalido' };
  await scadenzaTask(supabase, profiloId);
  const lavorabile = await getTaskLavorabile(supabase, profiloId);
  if (lavorabile) return { ok: false, noop: true, reason: 'task_attivo' };

  // BLACKLIST FAIL-CLOSED: errore di lettura -> nessun contatto proposto.
  const [blacklistRes, exclusionRows] = await Promise.all([loadBlacklistSet(supabase), loadEsclusioniAttive(supabase)]);
  if (!blacklistRes.ok) return { ok: false, noop: true, reason: 'blacklist_check_failed' };
  const blacklistRows = blacklistRes.rows;

  const candidates = await buildCandidates(supabase, cfg, { profiloId, oggi: oggi || todayRomeStr() });
  for (const candidate of candidates) {
    const block = await isBlacklistedOrEscluso(candidate, blacklistRows, exclusionRows);
    if (block.blocked) continue; // salta in silenzio i candidati bloccati

    const insert = await supabase.from('kona_call_director_task').insert({
      data: oggi || todayRomeStr(),
      operatore_id: profiloId,
      posizione: 0,
      tipo: candidate.tipo,
      sorgente_id: candidate.sorgenteId,
      sorgente_tipo: candidate.sorgenteTipo,
      descrizione: candidate.descrizione,
      payload: candidate.payload,
      stato: 'attivo',
      tentativi: 0,
      lease_until: new Date(Date.now() + LEASE_DURATION_MS).toISOString(),
      lease_owner: 'engine',
      assegnato_at: new Date().toISOString()
    }).select('*').single();
    if (insert.error) {
      if (String(insert.error.code) === '23505') return { ok: false, noop: true, reason: 'lease' };
      return { ok: false, error: insert.error };
    }
    await logEvent(supabase, { taskId: insert.data.id, tipo: 'materializzazione', dettagli: { tipo: candidate.tipo, sorgente: candidate.sorgenteTipo } });
    return { ok: true, task: insert.data };
  }
  return { ok: false, noop: true, reason: 'nessun_candidato' };
}

// Ri-verifica blacklist/esclusioni del task attivo PRIMA di mostrarlo.
// Se bloccato lo annulla e ritorna { blocked:true } (il chiamante materializza il prossimo).
async function verificaTaskAttivo({ supabase, profiloId }) {
  const task = await getActiveTask(supabase, profiloId);
  if (!task?.data) return { task: null, blocked: false };
  const [blacklistRes, exclusionRows] = await Promise.all([loadBlacklistSet(supabase), loadEsclusioniAttive(supabase)]);
  if (!blacklistRes.ok) return { task: null, blocked: true, reason: 'blacklist_check_failed' };
  const dettaglio = await getTaskDettaglio(supabase, task.data);
  const c = dettaglio?.contatto || {};
  const candidate = {
    cf_piva: c.cf_piva,
    telefoni: c.telefoni,
    leadId: task.data.sorgente_tipo === 'lead' || task.data.sorgente_tipo === 'lead_outbound_chiamata' ? task.data.sorgente_id : undefined,
    anagraficaId: c.anagrafica_id,
    sorgenteTipo: task.data.sorgente_tipo,
    sorgenteId: task.data.sorgente_id
  };
  const block = await isBlacklistedOrEscluso(candidate, blacklistRes.rows, exclusionRows);
  if (block.blocked) {
    await supabase.from('kona_call_director_task').update({ stato: 'annullato', esito: cleanLog({ esito: 'blacklist' }) }).eq('id', task.data.id);
    await logEvent(supabase, { taskId: task.data.id, tipo: 'blacklist', dettagli: { motivo: block.motivo } });
    return { task: null, blocked: true, motivo: block.motivo };
  }
  return { task: task.data, blocked: false, dettaglio };
}

// Dettaglio contatto del task (dati per l'operatrice UI, mai Telegram).
async function getTaskDettaglio(supabase, task) {
  if (!task) return null;
  let lead = null;
  let chiamata = null;
  let biz = null;
  let outboundChiamata = null;
  if (task.sorgente_tipo === 'lead' && isUuid(task.sorgente_id)) {
    const { data } = await supabase.from('call_center_lead_outbound').select('*').eq('id', task.sorgente_id).maybeSingle();
    lead = data;
  }
  if (task.sorgente_tipo === 'chiamata' && isUuid(task.sorgente_id)) {
    const { data } = await supabase.from('chiamate').select('*').eq('id', task.sorgente_id).maybeSingle();
    chiamata = data;
  }
  if (task.sorgente_tipo === 'lead_outbound_chiamata' && isUuid(task.sorgente_id)) {
    const { data } = await supabase.from('call_center_lead_outbound_chiamate').select('*').eq('id', task.sorgente_id).maybeSingle();
    outboundChiamata = data;
    if (data?.lead_id) {
      const { data: l } = await supabase.from('call_center_lead_outbound').select('*').eq('id', data.lead_id).maybeSingle();
      lead = l;
    }
  }
  if (task.tipo === 'conferma_appuntamento_business' && isUuid(task.payload?.appuntamento_business_id)) {
    const { data } = await supabase.from('kona_call_director_appuntamenti_business').select('*').eq('id', task.payload.appuntamento_business_id).maybeSingle();
    biz = data;
    if (biz?.lead_id && !lead) {
      const { data: l } = await supabase.from('call_center_lead_outbound').select('*').eq('id', biz.lead_id).maybeSingle();
      lead = l;
    }
  }

  const contatto = buildContatto({ task, lead, chiamata, biz, outboundChiamata });
  return {
    task: {
      id: task.id,
      tipo: task.tipo,
      descrizione: task.descrizione,
      payload: task.payload,
      tentativi: task.tentativi,
      assegnato_at: task.assegnato_at,
      lease_until: task.lease_until,
      stato: task.stato
    },
    contatto
  };
}

function buildContatto({ task, lead, chiamata, biz, outboundChiamata }) {
  if (task.tipo === 'conferma_appuntamento_business' && biz) {
    return {
      sorgente: 'appuntamento_business',
      nome: lead?.ragione_sociale || 'Azienda',
      cellulare: lead?.telefono_norm || lead?.telefono_raw || outboundChiamata?.telefono_snapshot,
      telefoni: [lead?.telefono_norm, lead?.telefono_raw],
      email: lead?.email || null,
      localita: lead?.localita || null,
      provincia: lead?.provincia || null,
      categoria: lead?.categoria || null,
      zona: biz.zona || null,
      cf_piva: lead?.codice_fiscale || lead?.partita_iva || null,
      anagrafica_id: biz.anagrafica_id || null,
      appuntamento: {
        data_ora: biz.data_ora,
        durata_minuti: biz.durata_minuti,
        stato: biz.stato,
        sync_stato: biz.sync_stato
      }
    };
  }
  if (lead && (task.sorgente_tipo === 'lead' || task.sorgente_tipo === 'lead_outbound_chiamata')) {
    return {
      sorgente: task.sorgente_tipo === 'lead' ? 'lead' : 'lead_outbound_chiamata',
      nome: lead.ragione_sociale,
      cellulare: lead.telefono_norm || lead.telefono_raw,
      telefoni: [lead.telefono_norm, lead.telefono_raw],
      email: lead.email,
      localita: lead.localita,
      provincia: lead.provincia,
      categoria: lead.categoria,
      zona: lead.zona,
      partita_iva: lead.partita_iva,
      cf_piva: lead.codice_fiscale || lead.partita_iva,
      anagrafica_id: outboundChiamata?.anagrafica_id || null,
      storico: { esito: lead.stato_lead, ultimo_contatto_at: lead.ultimo_contatto_at, times_seen: lead.times_seen }
    };
  }
  if (chiamata) {
    return {
      sorgente: 'chiamata',
      nome: chiamata.nome_cliente,
      cellulare: chiamata.cellulare,
      telefoni: [chiamata.cellulare],
      cf_piva: chiamata.cf_piva,
      anagrafica_id: chiamata.anagrafica_id,
      motivo: chiamata.motivo_chiamata,
      note: chiamata.note,
      esito_precedente: chiamata.esito,
      storico: { data_ora: chiamata.data_ora, esito: chiamata.esito, motivo: chiamata.motivo_chiamata, note: chiamata.note }
    };
  }
  return null;
}

// -- Esiti --------------------------------------------------------------------

// Registra la chiamata outbound e l'attivita' sugli esiti Business (stessa
// logica applicativa del flusso outbound esistente).
async function registraChiamataOutbound(supabase, { task, esito, cfg, oggi, dettagli, tentativo }) {
  const payload = task.payload || {};
  const leadId = payload.lead_id;
  if (!isUuid(leadId)) return;
  const prossimo = esito === 'non_risposto' || (esito === 'skip' && ['cliente_momentaneamente_indisponibile', 'problema_tecnico'].includes(dettagli.skip_reason))
    ? prossimaFascia(fasciaCorrente(cfg), oggi)
    : null;

  let operatoreNome = payload.operatore_nome || null;
  if (!operatoreNome) {
    const { data: profilo } = await supabase.from('profili').select('nome').eq('id', task.operatore_id).maybeSingle();
    operatoreNome = profilo?.nome || null;
  }

  const row = {
    lead_id: leadId,
    anagrafica_id: payload.anagrafica_id || null,
    operatore_id: task.operatore_id,
    operatore_nome: String(operatoreNome || 'Operatore').slice(0, 120),
    esito: mappaEsitoOutbound(esito, dettagli),
    note: String(dettagli.motivo || dettagli.spiegazione || '').slice(0, 1000) || null,
    data_ricontatto: prossimo ? prossimo.data : null,
    fascia_ricontatto: prossimo ? prossimo.fascia : null,
    appuntamento_tipo: esito === 'appuntamento' ? (dettagli.appuntamento_tipo === 'negozio' ? 'negozio' : 'esterno') : null
  };
  // Stato rilavorazione coerente con il flusso outbound.
  if (esito === 'non_risposto') {
    row.rilavorazione_stato = tentativo >= (cfg.tentativi_massimi || 3) ? 'completato' : 'da_lavorare';
  } else if (esito === 'skip' && !['cliente_momentaneamente_indisponibile', 'problema_tecnico'].includes(dettagli.skip_reason)) {
    row.rilavorazione_stato = 'completato';
  } else if (esito !== 'non_risposto') {
    row.rilavorazione_stato = 'completato';
  }

  const { data: inserita, error } = await supabase.from('call_center_lead_outbound_chiamate').insert(row).select('id').single();
  if (error || !inserita) return;
  await supabase.from('call_center_lead_outbound_attivita').insert({
    lead_id: leadId,
    tipo: esito === 'non_risposto' ? 'chiamata' : 'esito',
    testo: row.note || String(esito || ''),
    stato_precedente: null,
    stato_nuovo: row.esito,
    operatore_id: task.operatore_id,
    meta: cleanLog({ task_id: task.id, esito, skip_reason: dettagli.skip_reason || null })
  });
}

function mappaEsitoOutbound(esito, dettagli) {
  if (esito === 'skip') {
    const skip = dettagli.skip_reason;
    if (skip === 'cliente_momentaneamente_indisponibile' || skip === 'problema_tecnico') return 'ricontattare';
    if (skip === 'trattative_gia_in_corso' || skip === 'possibile_cliente_gia_acquisito' || skip === 'altro') return 'non_interessato';
    return 'chiuso';
  }
  if (esito === 'appuntamento') return 'appuntamento_fissato';
  return esito;
}

// Aggiorna la sorgente in base all'esito. Injective per tipo di sorgente.
async function applicaEsitoSorgente(supabase, { task, esito, cfg, oggi, dettagli, tentativo }) {
  const payload = task.payload || {};

  // Business lead / chiamata outbound: registra la lavorazione reale.
  if (task.sorgente_tipo === 'lead' || task.sorgente_tipo === 'lead_outbound_chiamata') {
    await registraChiamataOutbound(supabase, { task, esito, cfg, oggi, dettagli, tentativo });
  }

  if (task.sorgente_tipo === 'lead' && isUuid(task.sorgente_id)) {
    const patch = { ultimo_contatto_at: new Date().toISOString() };
    if (esito === 'non_risposto') {
      const prossimo = prossimaFascia(fasciaCorrente(cfg), oggi);
      patch.stato_lead = 'ricontattare';
      patch.prossimo_followup_at = new Date(`${prossimo.data}T12:00:00`).toISOString();
      if (tentativo >= (cfg.tentativi_massimi || 3)) {
        patch.stato_lead = 'chiuso'; // "Tentativi esauriti" (NON blacklist)
        patch.prossimo_followup_at = null;
      }
    } else if (esito === 'non_interessato') {
      patch.stato_lead = 'non_interessato';
    } else if (esito === 'appuntamento') {
      patch.stato_lead = 'appuntamento_fissato';
      patch.prossimo_followup_at = null;
    } else if (esito === 'passa_in_negozio') {
      patch.stato_lead = 'appuntamento_fissato_negozio';
      patch.prossimo_followup_at = null;
    } else if (esito === 'ricontattare') {
      patch.stato_lead = 'ricontattare';
      patch.prossimo_followup_at = new Date().toISOString();
    } else if (esito === 'chiuso') {
      patch.stato_lead = 'chiuso';
      patch.prossimo_followup_at = null;
    } else if (esito === 'skip') {
      const skip = dettagli.skip_reason;
      if (skip === 'cliente_momentaneamente_indisponibile' || skip === 'problema_tecnico') {
        patch.stato_lead = 'ricontattare';
        const prossimo = prossimaFascia(fasciaCorrente(cfg), oggi);
        patch.prossimo_followup_at = new Date(`${prossimo.data}T12:00:00`).toISOString();
      } else {
        patch.stato_lead = 'chiuso';
        patch.prossimo_followup_at = null;
        // "trattative gia' in corso" NON diventa do_not_call permanente:
        // resta solo l'esclusione dedicata (audit + dati conservati).
        if (!['trattative_gia_in_corso', 'possibile_cliente_gia_acquisito'].includes(skip)) {
          patch.do_not_call = true;
        }
      }
    }
    await supabase.from('call_center_lead_outbound').update(patch).eq('id', task.sorgente_id);
    return;
  }

  if (task.sorgente_tipo === 'lead_outbound_chiamata' && isUuid(task.sorgente_id)) {
    const patch = {};
    if (esito === 'non_risposto') {
      const prossimo = prossimaFascia(fasciaCorrente(cfg), oggi);
      patch.data_ricontatto = prossimo.data;
      patch.fascia_ricontatto = prossimo.fascia;
      if (tentativo >= (cfg.tentativi_massimi || 3)) patch.rilavorazione_stato = 'completato';
    } else if (esito === 'skip' && !['cliente_momentaneamente_indisponibile', 'problema_tecnico'].includes(dettagli.skip_reason)) {
      patch.rilavorazione_stato = 'completato';
    } else if (esito !== 'non_risposto') {
      patch.rilavorazione_stato = 'completato';
    }
    if (esito === 'appuntamento') patch.appuntamento_tipo = dettagli.appuntamento_tipo === 'negozio' ? 'negozio' : 'esterno';
    if (Object.keys(patch).length > 0) {
      await supabase.from('call_center_lead_outbound_chiamate').update(patch).eq('id', task.sorgente_id);
    }
    return;
  }

  if (task.sorgente_tipo === 'chiamata' && isUuid(task.sorgente_id)) {
    const patch = {};
    if (esito === 'non_risposto') {
      const prossimo = prossimaFascia(fasciaCorrente(cfg), oggi);
      patch.data_ricontatto = prossimo.data;
      patch.fascia_ricontatto = prossimo.fascia;
      if (tentativo >= (cfg.tentativi_massimi || 3)) {
        patch.rilavorazione_stato = 'completato'; // "Tentativi esauriti"
        patch.note = `${patch.note ? patch.note + ' ' : ''}[KONA] Tentativi esauriti (${tentativo})`;
      }
    } else if (esito === 'non_interessato') {
      patch.rilavorazione_stato = 'completato';
      patch.esito_finale = 'persa';
      patch.dettagli_esito = String(dettagli.motivo || 'Non interessato').slice(0, 500);
      patch.esitato_at = new Date().toISOString();
    } else if (esito === 'appuntamento') {
      patch.rilavorazione_stato = 'completato';
    } else if (esito === 'passa_in_negozio' || esito === 'passa_a_cerea') {
      patch.passaggio_stato = 'in_attesa';
      patch.data_ricontatto = null;
    } else if (esito === 'ricontattare') {
      patch.data_ricontatto = oggi;
      patch.fascia_ricontatto = fasciaCorrente(cfg);
    } else if (esito === 'skip') {
      const skip = dettagli.skip_reason;
      if (skip === 'cliente_momentaneamente_indisponibile' || skip === 'problema_tecnico') {
        const prossimo = prossimaFascia(fasciaCorrente(cfg), oggi);
        patch.data_ricontatto = prossimo.data;
        patch.fascia_ricontatto = prossimo.fascia;
      } else {
        patch.rilavorazione_stato = 'completato';
      }
    }
    if (Object.keys(patch).length > 0) {
      await supabase.from('chiamate').update(patch).eq('id', task.sorgente_id);
    }
    return;
  }

  if (task.tipo === 'conferma_appuntamento_business' && isUuid(payload.appuntamento_business_id)) {
    const bizId = payload.appuntamento_business_id;
    const patchBiz = {};
    if (esito === 'confermato') patchBiz.stato = 'confermato';
    if (esito === 'annullato') patchBiz.stato = 'annullato';
    if (esito === 'da_riprogrammare') patchBiz.stato = 'da_riprogrammare';
    if (Object.keys(patchBiz).length > 0) {
      await supabase.from('kona_call_director_appuntamenti_business').update(patchBiz).eq('id', bizId);
    }
    // Registra la conferma (UNIQUE appuntamento_business_id, data, orario_previsto).
    const { count } = await supabase
      .from('kona_call_director_conferme')
      .select('id', { count: 'exact', head: true })
      .eq('appuntamento_business_id', bizId)
      .eq('data', oggi);
    const nTentativo = Number(count) + 1;
    const finestra = finestraAttiva(cfg)?.orario || dettagli.orario_previsto || '00:00';
    await supabase.from('kona_call_director_conferme').insert({
      appuntamento_business_id: bizId,
      data: oggi,
      orario_previsto: finestra,
      tentativo: nTentativo,
      esito: esito === 'non_risposto' ? 'non_risposto' : esito === 'confermato' ? 'confermato' : esito === 'annullato' ? 'annullato' : esito === 'da_riprogrammare' ? 'da_riprogrammare' : 'errore',
      esito_at: new Date().toISOString(),
      dettagli: cleanLog(dettagli.dettagli || {})
    }).onConflict('appuntamento_business_id,data,orario_previsto').ignore();
  }
}

// Registra un esito valido e completa il task. Ritorna { ok, esaurito, notifica, tentativo }.
async function registerEsito({ supabase, cfg, task, profiloId, esito, dettagli = {} }) {
  const oggi = todayRomeStr();
  if (!task || task.stato !== 'attivo') return { ok: false, error: 'task_non_attivo' };
  if (String(task.operatore_id).toLowerCase() !== String(profiloId).toLowerCase()) {
    return { ok: false, error: 'task_non_proprio' };
  }

  const ammessi = ESITI_PER_TIPO[task.tipo] || [];
  if (esito === 'skip') {
    const skip = String(dettagli.skip_reason || '');
    if (!SKIP_REASONS.includes(skip)) return { ok: false, error: 'skip_reason_non_valido' };
    if (skip === 'altro' && !String(dettagli.spiegazione || '').trim()) return { ok: false, error: 'skip_altro_richiede_spiegazione' };
  } else if (esito !== 'blacklist' && !ammessi.includes(esito)) {
    return { ok: false, error: 'esito_non_valido' };
  }

  const isNonRisposto = esito === 'non_risposto';
  // Tentativo PERSISTENTE: per le conferme conta i record della tabella
  // conferme (uno per finestra); per gli altri contatti i task precedenti.
  let tentativo = 1;
  if (task.tipo === 'conferma_appuntamento_business' && isUuid(task.payload?.appuntamento_business_id)) {
    const { count } = await supabase
      .from('kona_call_director_conferme')
      .select('id', { count: 'exact', head: true })
      .eq('appuntamento_business_id', task.payload.appuntamento_business_id)
      .eq('data', oggi);
    tentativo = Number(count) + 1;
  } else {
    tentativo = await tentativoPersistente(supabase, {
      operatoreId: profiloId,
      sorgenteId: task.sorgente_id,
      tipo: task.tipo
    });
  }
  // Le conferme appuntamento hanno una soglia propria (una finestra per tentativo).
  const esaurito = isNonRisposto && (
    task.tipo === 'conferma_appuntamento_business'
      ? tentativoEsaurito(cfg, tentativo)
      : tentativo >= (cfg.tentativi_massimi || 3)
  );

  // Azione blacklist REALE (persistenza) + esclusione permanente dalla coda.
  if (esito === 'blacklist') {
    const dettaglio = await getTaskDettaglio(supabase, task);
    const c = dettaglio?.contatto || {};
    const ins = await addBlacklist(supabase, {
      cfPiva: c.cf_piva,
      nome: c.nome,
      telefoni: c.telefoni || [c.cellulare]
    });
    if (!ins.ok) return { ok: false, error: ins.error };
    await addEsclusione(supabase, {
      leadId: task.payload?.lead_id,
      anagraficaId: c.anagrafica_id,
      chiamataId: task.payload?.chiamata_id,
      tipo: 'manuale',
      motivo: 'Segnalato in blacklist',
      esclusoDa: profiloId,
      dettagli: { esito: 'blacklist' }
    });
  }

  // Esclusioni permanenti su skip specifici (prima di chiudere il task).
  if (esito === 'skip') {
    const skip = dettagli.skip_reason;
    const payload = task.payload || {};
    let tipoEsclusione = null;
    let motivoEsclusione = null;
    if (skip === 'dato_errato' || skip === 'numero_non_utilizzabile' || skip === 'duplicato') {
      tipoEsclusione = 'manuale';
      motivoEsclusione = skip.replace(/_/g, ' ');
    } else if (skip === 'possibile_cliente_gia_acquisito') {
      tipoEsclusione = 'gia_cliente_windtre';
      motivoEsclusione = 'Possibile cliente gia' + ' acquisito';
    } else if (skip === 'trattative_gia_in_corso') {
      tipoEsclusione = 'trattative_in_corso';
      motivoEsclusione = 'Trattative gia' + ' in corso';
    } else if (skip === 'altro') {
      tipoEsclusione = 'altro';
      motivoEsclusione = String(dettagli.spiegazione || '').slice(0, 500);
    }
    if (tipoEsclusione) {
      await addEsclusione(supabase, {
        leadId: payload.lead_id,
        anagraficaId: payload.anagrafica_id,
        chiamataId: payload.chiamata_id,
        tipo: tipoEsclusione,
        motivo: motivoEsclusione,
        esclusoDa: profiloId,
        dettagli: cleanLog({ skip_reason: skip, spiegazione: dettagli.spiegazione })
      });
    }
  }

  const esitoRecord = {
    esito,
    ...(isNonRisposto ? { tentativo } : {}),
    ...(esaurito ? { tentativi_esauriti: true } : {}),
    ...(dettagli.skip_reason ? { skip_reason: dettagli.skip_reason } : {}),
    ...(dettagli.spiegazione ? { spiegazione: String(dettagli.spiegazione).slice(0, 500) } : {}),
    ...(dettagli.motivo ? { motivo: String(dettagli.motivo).slice(0, 500) } : {})
  };

  await applicaEsitoSorgente(supabase, { task, esito, cfg, oggi, dettagli, tentativo });

  const update = {
    stato: 'completato',
    esito: cleanLog(esitoRecord),
    tentativi: tentativo,
    completato_at: new Date().toISOString(),
    lease_until: null
  };
  const { error } = await supabase.from('kona_call_director_task').update(update).eq('id', task.id).eq('stato', 'attivo');
  if (error) return { ok: false, error };

  await logEvent(supabase, {
    taskId: task.id,
    tipo: esito === 'skip' ? 'skip' : esito === 'blacklist' ? 'blacklist' : 'esito',
    dettagli: { esito: esitoRecord, esaurito }
  });

  const notifica = esaurito && task.tipo === 'conferma_appuntamento_business' ? 'conferma_non_risposti_esauriti' : null;
  return { ok: true, esaurito, notifica, tentativo };
}

module.exports = {
  CHIAMATE_ESITI,
  CONFERMA_ESITI,
  ESITI_PER_TIPO,
  LEAD_ESITI,
  SKIP_REASONS,
  addBlacklist,
  addEsclusione,
  applicaEsitoSorgente,
  buildCandidates,
  fasciaCorrente,
  getActiveTask,
  getTaskDettaglio,
  getTaskLavorabile,
  loadBlacklistSet,
  loadEsclusioniAttive,
  logEvent,
  materializeNextTask,
  normTel,
  prossimaFascia,
  pureBlacklisted,
  pureEscluso,
  registerEsito,
  tentativiGiorni,
  tentativoPersistente,
  telefoniUnici,
  verificaTaskAttivo,
  _test: { fasciaCorrente, fasciaDaOra, normTel, prossimaFascia, pureBlacklisted, pureEscluso, telefoniUnici, tentativoEsaurito, SKIP_REASONS }
};
