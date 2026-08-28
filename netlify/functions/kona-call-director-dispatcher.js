/**
 * Cron KONA Call Director — schedulato ogni 5 minuti (orologio Europe/Rome).
 * Il dispatcher e' una Scheduled Function Netlify. Con la schedulazione nativa
 * lasciare KONA_CALL_DIRECTOR_CRON_SECRET non impostato: Netlify non aggiunge
 * header personalizzati alla chiamata schedulata. Il segreto resta disponibile
 * soltanto per eventuali invocazioni controllate esterne.
 *
 * Staging: con MIROX_DEPLOY_ENV=staging il cron termina subito, SALVO
 * opt-in esplicito KONA_CALL_DIRECTOR_STAGING_RUN=true (obbligatorio per
 * testare i cron in staging senza rischiare production).
 *
 * Idempotenza: registro data+evento. GRACE WINDOW: ogni evento si esegue solo
 * nell'intervallo [ora prevista, ora prevista + finestra] per evitare
 * l'accumulo cumulativo di eventi scaduti quando il sistema viene attivato
 * tardi. Retry limitato (3) per gli eventi falliti, entro la finestra.
 *
 * Sequenza (ora Rome, DST-safe):
 *   02:00 arricchimento notturno (crea job per lead, processati a lotti piccoli)
 *   03:30 retention (180 / 365 / 730 giorni)
 *   08:00 reminder mattina (condizionale alla risposta di Mirko, vedi webhook)
 *   08:30 piano default del giorno (se Mirko non ha un piano approvato)
 *   19:10 report serale + domanda aperta sul piano del giorno successivo
 *   20:00 reminder sera (condizionale)
 *   20:05 proposta piano domani (se non gia' proposta)
 *
 * Sempre (ogni tick): finestre conferme (top of queue), job a lease,
 * riconciliazione sync Google, coda notifiche Telegram.
 */

const { createClient } = require('@supabase/supabase-js');

const { envHardEnabled, getConfig } = require('./_lib/kona-cd-config');
const { startArricchimento, acquireJob, processArricchimento } = require('./_lib/kona-cd-arricchimento');
const { runRetention } = require('./_lib/kona-cd-retention');
const { analisiGiornata, applicaPianoDefault, pianoDi, propostaPianoGiorno, reportGiornaliero, salvaPiano } = require('./_lib/kona-cd-report');
const { enqueueNotifica, processaNotifiche } = require('./_lib/kona-cd-notifiche');
const { materializeNextTask } = require('./_lib/kona-cd-engine');
const { finestraAttiva } = require('./_lib/kona-cd-conferme');
const { calendarIdFor, deleteEvent, findEventByKonaId, getAccessToken, insertEvent, updateEventTime } = require('./_lib/kona-cd-google');
const { timingSafeEqualText } = require('./_lib/kona-cd-telegram');
const { addDaysStr, isWorkingDay, nextWorkingDay, nowRomeParts, parseHHmm, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, isStaging, nowIso } = require('./_lib/kona-cd-util');

const RETENTION_ORA = '03:30';
const PIANO_PROPOSTA_ORA = '20:05';
const MAX_JOB_TICK = 5;
const GRACE_MINUTI = 20;
const MAX_RETRY_EVENTO = 3;

function getClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti');
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function nowHhmm(parts) {
  return `${String(parts.hh).padStart(2, '0')}:${String(parts.mm).padStart(2, '0')}`;
}

function minutiFromParts(parts) {
  return parts.hh * 60 + parts.mm;
}

// Protezione cron: se il segreto e' configurato, deve passare timing-safe.
function cronAutorizzato(event) {
  const secret = String(process.env.KONA_CALL_DIRECTOR_CRON_SECRET || '').trim();
  if (!secret) return true;
  const header = String(event?.headers?.['x-kona-cd-cron-secret'] || '');
  const query = String(event?.queryStringParameters?.secret || '');
  return timingSafeEqualText(header || query, secret);
}

// Giornata lavorativa? Ferie/assenze configurate come array di 'YYYY-MM-DD'.
function giornoOperativo(cfg, data) {
  const ferie = Array.isArray(cfg.ferie) ? cfg.ferie : [];
  if (ferie.includes(data)) return false;
  return isWorkingDay(data, cfg.giorni_lavorativi || [1, 2, 3, 4, 5]);
}

// Claim idempotente di un evento giornaliero (data+evento) con grace window e
// retry. Ritorna 'run' | 'skip' | 'retry'.
async function eventoDovuto(supabase, { data, evento, ora, nowParts, finestraMinuti = GRACE_MINUTI }) {
  const nowMin = minutiFromParts(nowParts);
  const target = parseHHmm(ora);
  if (target === null) return 'skip';
  if (nowMin < target) return 'skip';
  if (nowMin > target + finestraMinuti) return 'skip'; // grace window scaduta

  const { data: gia } = await supabase
    .from('kona_call_director_esecuzioni_programmate')
    .select('esito')
    .eq('chiave', `${data}|${evento}`)
    .maybeSingle();
  if (gia) {
    if (gia.esito?.ok === true) return 'skip';
    const tentativi = Number(gia.esito?.tentativi || 0);
    if (tentativi >= MAX_RETRY_EVENTO) return 'skip';
    return 'retry';
  }
  const { error } = await supabase.from('kona_call_director_esecuzioni_programmate').insert({
    chiave: `${data}|${evento}`,
    data,
    evento,
    eseguita_at: nowIso(),
    esito: { ok: false, tentativi: 0 }
  });
  if (error) return 'skip'; // tick concorrente ha gia' reclamato
  return 'run';
}

async function segnaEsitoEvento(supabase, { data, evento, ok, esito }) {
  const { data: gia } = await supabase
    .from('kona_call_director_esecuzioni_programmate')
    .select('esito')
    .eq('chiave', `${data}|${evento}`)
    .maybeSingle();
  const tentativi = Number(gia?.esito?.tentativi || 0) + 1;
  await supabase
    .from('kona_call_director_esecuzioni_programmate')
    .update({ esito: cleanLog({ ok, tentativi, ...esito }) })
    .eq('chiave', `${data}|${evento}`);
}

async function operatoriAbilitati(supabase) {
  const { data, error } = await supabase
    .from('kona_call_director_profili')
    .select('profilo_id')
    .eq('abilitato', true);
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => r.profilo_id);
}

function inOrarioOperativo(cfg, parts) {
  const min = minutiFromParts(parts);
  const mIn = parseHHmm(cfg.orario_mattina?.inizio) ?? 540;
  const mFin = parseHHmm(cfg.orario_mattina?.fine) ?? 750;
  const pIn = parseHHmm(cfg.orario_pomeriggio?.inizio) ?? 930;
  const pFin = parseHHmm(cfg.orario_pomeriggio?.fine) ?? 1140;
  return (min >= mIn && min < mFin) || (min >= pIn && min < pFin);
}

async function eseguiArricchimento(supabase, cfg, data) {
  const esito = await startArricchimento(supabase, cfg, data);
  if (!esito.ok) return { errore: String(esito.error?.message || esito.error) };
  if (esito.anomalia) {
    await enqueueNotifica(supabase, {
      dedupeKey: `arricchimento_anomalia_${data}`,
      testo: `KONA Call Director - Anomalia arricchimento ${data}: trovati ${esito.candidati} lead Business (soglia minima ${esito.soglia}). Nessun dato personale in questo avviso.`,
      extra: { codice: 'lead_sotto_soglia', candidati: esito.candidati, soglia: esito.soglia }
    });
  }
  return { creati: esito.creati, candidati: esito.candidati, anomalia: esito.anomalia };
}

async function eseguiRetention(supabase, cfg, data) {
  const esito = await runRetention(supabase, cfg, { oggi: data });
  return esito.ok ? { eliminati: esito.eliminati } : { errore: esito.errore };
}

async function eseguiReportSera(supabase, cfg, data) {
  const report = await reportGiornaliero(supabase, cfg, { data });
  const analisi = await analisiGiornata(supabase, cfg, { data });
  const domani = nextWorkingDay(data, cfg.giorni_lavorativi, cfg.ferie);
  const piano = await propostaPianoGiorno(supabase, cfg, { data: domani });
  const lines = [
    `KONA Call Director - Report ${data}`,
    `Task oggi: ${report.task.totali}`,
    `Conferme oggi: ${report.conferme.totali} (${Object.entries(report.conferme.esiti).map(([k, v]) => `${k} ${v}`).join(', ')})`,
    `Appuntamenti Business: ${report.appuntamenti_business.totali}`,
    `Budget ${report.budget.mese}: ${report.budget.speso.toFixed(2)} euro su ${report.budget.budget.toFixed(2)}`,
    piano.totale > 0 ? `Piano ${domani}: ${piano.perZona.map((z) => `${z.zona} (${z.n})`).join(', ')}` : `Piano ${domani}: nessun appuntamento programmato`
  ];
  if (analisi.ok) lines.push(`Commento: ${analisi.commento}`, `Suggerimento: ${analisi.suggerimento}`);
  lines.push('', 'Domanda aperta: confermi o modifichi il piano di domani? (rispondi su questo bot)');
  await enqueueNotifica(supabase, {
    dedupeKey: `report_sera_${data}`,
    testo: lines.join('\n'),
    extra: { codice: 'report_sera', domanda_piano: true }
  });
  return { task: report.task.totali, analisi_ok: analisi.ok };
}

async function eseguiReminder(supabase, cfg, data, slot) {
  // Reminder CONDIZIONALI: se Mirko ha gia' risposto (piano approvato o
  // conversazione in corso sul piano), non si invia il promemoria.
  const targetPiano = slot === 'mattina' ? data : nextWorkingDay(data, cfg.giorni_lavorativi, cfg.ferie);
  const operatori = await operatoriAbilitati(supabase);
  const giaApprovato = operatori.length > 0 && (await pianoDi(supabase, { data: targetPiano, operatoreId: operatori[0] }))?.stato === 'approvato';
  if (giaApprovato) return { slot, skip: 'piano_gia_approvato' };

  const testo = slot === 'mattina'
    ? `KONA Call Director - Promemoria mattina (${data}): il piano di oggi non e' ancora stato confermato. Rispondi con /piano e /approva.`
    : `KONA Call Director - Promemoria sera (${data}): non ho ricevuto conferma del piano di domani. Rispondi con /piano e /approva oppure /piano domani.`;
  await enqueueNotifica(supabase, {
    dedupeKey: `reminder_${slot}_${data}`,
    testo,
    extra: { codice: `reminder_${slot}` }
  });
  return { slot };
}

// Piano default del giorno: solo se non esiste gia' un piano approvato (Mirko).
// Il piano residuo predefinito e' "Telefoni omaggio da liste cartacee".
async function eseguiPianoDefault(supabase, cfg, data) {
  const operatori = await operatoriAbilitati(supabase);
  const applicati = [];
  for (const opId of operatori) {
    const esistente = await pianoDi(supabase, { data, operatoreId: opId });
    if (esistente && (esistente.stato === 'approvato' || esistente.sorgente === 'mirko')) continue;
    const esito = await applicaPianoDefault(supabase, cfg, { data, operatoreId: opId });
    applicati.push({ operatore: opId, totale: esito.totale, salvato: esito.salvato });
  }
  // Crea/riapre la sessione Business standard (piano residuo Telefoni omaggio).
  // Upsert su (data, operatore_id, tipo) coerente col vincolo unico pieno.
  for (const opId of operatori) {
    await supabase.from('kona_call_director_sessioni').upsert(
      { data, operatore_id: opId, tipo: 'mattina', stato: 'attiva', categoria: 'telefoni_omaggio' },
      { onConflict: 'data,operatore_id,tipo' }
    );
  }
  return { applicati };
}

// Proposta piano domani (20:05) persistita come 'proposta' sorgente 'openai'.
async function eseguiPropostaPiano(supabase, cfg, data) {
  const domani = nextWorkingDay(data, cfg.giorni_lavorativi, cfg.ferie);
  const operatori = await operatoriAbilitati(supabase);
  let proposte = 0;
  for (const opId of operatori) {
    const esistente = await pianoDi(supabase, { data: domani, operatoreId: opId });
    if (esistente) continue;
    const proposta = await propostaPianoGiorno(supabase, cfg, { data: domani });
    const ok = await salvaPiano(supabase, {
      data: domani, operatoreId: opId,
      contenuto: { totale: proposta.totale, perZona: proposta.perZona, suggerimento: proposta.suggerimento },
      sorgente: 'openai', stato: 'proposta'
    });
    if (ok.ok) proposte += 1;
  }
  return { proposte };
}

// Materializza il task attivo per ogni operatrice abilitata quando e' il
// momento (orario operativo o finestra conferme attiva), SOLO in giorni
// operativi. Business standard bloccato alle 18:00 (gestito dal motore).
async function eseguiMaterializzazioni(supabase, cfg, data) {
  if (!giornoOperativo(cfg, data)) return { materializzati: 0, motivo: 'giorno_non_operativo' };
  const parts = nowRomeParts();
  const finestra = finestraAttiva(cfg, parts);
  const operativo = inOrarioOperativo(cfg, parts);
  if (!operativo && !finestra) return { materializzati: 0, motivo: 'fuori_orario' };
  const operatori = await operatoriAbilitati(supabase);
  let materializzati = 0;
  for (const opId of operatori) {
    const esito = await materializeNextTask({ supabase, cfg, profiloId: opId, oggi: data });
    if (esito.ok) materializzati += 1;
  }
  return { materializzati, finestra: finestra?.orario || null, operativo };
}

async function eseguiJobArricchimento(supabase, cfg, data) {
  let processati = 0;
  for (let i = 0; i < MAX_JOB_TICK; i += 1) {
    const job = await acquireJob(supabase, { tipo: 'arricchimento_batch', leaseOwner: 'dispatcher' });
    if (!job) break;
    await processArricchimento(supabase, cfg, job, { oggi: data });
    processati += 1;
  }
  return { processati };
}

// Riconciliazione sync Google: retry idempotente dei 'da_recuperare'.
async function riconciliaSyncGoogle(supabase, cfg) {
  const { data: daRecuperare, error } = await supabase
    .from('kona_call_director_appuntamenti_business')
    .select('*')
    .eq('sync_stato', 'da_recuperare')
    .limit(5);
  if (error || !Array.isArray(daRecuperare)) return { gestiti: 0 };
  const accessToken = await getAccessToken(supabase);
  if (!accessToken) return { gestiti: 0, motivo: 'no_token' };
  const calendarId = calendarIdFor(cfg);
  let gestiti = 0;
  for (const app of daRecuperare) {
    try {
      const timeMin = new Date(new Date(app.data_ora).getTime() - 24 * 60 * 60 * 1000).toISOString();
      const timeMax = new Date(new Date(app.data_ora).getTime() + 24 * 60 * 60 * 1000).toISOString();
      const trovato = await findEventByKonaId(accessToken, { calendarId, konaId: app.id, timeMin, timeMax });
      let eventId = app.google_event_id || trovato?.id || null;

      if (app.stato === 'annullato') {
        if (eventId) await deleteEvent(accessToken, { calendarId, eventId });
        const { error: annullaErr } = await supabase
          .from('kona_call_director_appuntamenti_business')
          .update({ google_event_id: null, sync_stato: 'sincronizzato', sync_dettagli: { riconciliato_at: new Date().toISOString() } })
          .eq('id', app.id);
        if (annullaErr) throw annullaErr;
        gestiti += 1;
        continue;
      }

      const end = new Date(new Date(app.data_ora).getTime() + (app.durata_minuti || cfg.durata_appuntamento_minuti || 45) * 60000).toISOString();
      let evento = eventId ? { id: eventId, htmlLink: trovato?.htmlLink || null } : null;
      if (eventId) {
        try {
          await updateEventTime(accessToken, { calendarId, eventId, start: app.data_ora, end });
        } catch (eventError) {
          if (Number(eventError?.status) !== 404) throw eventError;
          eventId = null;
          evento = null;
        }
      }
      if (!eventId) {
        const { data: lead, error: leadErr } = await supabase.from('call_center_lead_outbound').select('ragione_sociale').eq('id', app.lead_id).maybeSingle();
        if (leadErr) throw leadErr;
        const nome = String(lead?.ragione_sociale || 'Azienda').slice(0, 80);
        evento = await insertEvent(accessToken, {
          calendarId,
          summary: `Appuntamento: ${nome}`,
          start: app.data_ora,
          end,
          description: `KONA Call Director - appuntamento Business (${app.id}).`,
          konaId: app.id
        });
      }
      const { error: syncErr } = await supabase
        .from('kona_call_director_appuntamenti_business')
        .update({ google_event_id: evento.id || eventId, sync_stato: 'sincronizzato', sync_dettagli: { html_link: evento.htmlLink || trovato?.htmlLink || null, riconciliato_at: new Date().toISOString() } })
        .eq('id', app.id);
      if (syncErr) throw syncErr;
      gestiti += 1;
    } catch (e) {
      const tentativi = Number(app.sync_dettagli?.tentativi || 0) + 1;
      const update = tentativi >= 5
        ? { sync_stato: 'errore', sync_dettagli: { tentativi, ultimo_errore: String(e?.message || 'errore').slice(0, 200) } }
        : { sync_dettagli: { tentativi, ultimo_errore: String(e?.message || 'errore').slice(0, 200) } };
      await supabase.from('kona_call_director_appuntamenti_business').update(update).eq('id', app.id);
      if (tentativi >= 5) {
        await enqueueNotifica(supabase, {
          dedupeKey: `sync_irrecuperabile_${app.id}`,
          testo: `KONA Call Director - Sync Google non riuscito dopo piu' tentativi per appuntamento (${app.id}).`,
          extra: { codice: 'sync_fallito' }
        });
      }
    }
  }
  return { gestiti };
}

exports.handler = async (event) => {
  if (!cronAutorizzato(event)) return { statusCode: 401, body: 'unauthorized' };
  if (isStaging() && String(process.env.KONA_CALL_DIRECTOR_STAGING_RUN || '').trim() !== 'true') {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'staging' }) };
  }
  if (!envHardEnabled()) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'enabled_env_off' }) };
  }
  let supabase;
  try {
    supabase = getClient();
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }

  const cfg = await getConfig(supabase);
  if (!cfg.attivo_globale) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'global_off' }) };
  }

  const data = todayRomeStr();
  const nowParts = nowRomeParts();
  const risultati = {};

  const eventi = [
    { evento: 'arricchimento', ora: cfg.orario_inizio_arricchimento, fn: () => eseguiArricchimento(supabase, cfg, data) },
    { evento: 'retention', ora: RETENTION_ORA, fn: () => eseguiRetention(supabase, cfg, data) },
    { evento: 'reminder_mattina', ora: cfg.orario_reminder_mattina, fn: () => eseguiReminder(supabase, cfg, data, 'mattina') },
    { evento: 'piano_default', ora: cfg.orario_piano_default, fn: () => eseguiPianoDefault(supabase, cfg, data) },
    { evento: 'proposta_piano', ora: PIANO_PROPOSTA_ORA, fn: () => eseguiPropostaPiano(supabase, cfg, data) },
    { evento: 'report_sera', ora: cfg.orario_report_sera, fn: () => eseguiReportSera(supabase, cfg, data) },
    { evento: 'reminder_sera', ora: cfg.orario_reminder_sera, fn: () => eseguiReminder(supabase, cfg, data, 'sera') }
  ];
  for (const ev of eventi) {
    if (!ev.ora) continue;
    if (!giornoOperativo(cfg, data) && !['arricchimento', 'retention'].includes(ev.evento)) continue;
    const decisione = await eventoDovuto(supabase, {
      data, evento: ev.evento, ora: ev.ora, nowParts,
      finestraMinuti: ['arricchimento', 'retention'].includes(ev.evento) ? 60 : GRACE_MINUTI
    });
    if (decisione === 'skip') continue;
    try {
      risultati[ev.evento] = await ev.fn();
      await segnaEsitoEvento(supabase, { data, evento: ev.evento, ok: true });
    } catch (e) {
      risultati[ev.evento] = { errore: String(e?.message || 'errore') };
      await segnaEsitoEvento(supabase, { data, evento: ev.evento, ok: false, esito: { errore: String(e?.message || 'errore').slice(0, 300) } });
    }
  }

  try {
    risultati.materializzazioni = await eseguiMaterializzazioni(supabase, cfg, data);
  } catch (e) {
    risultati.materializzazioni = { errore: String(e?.message || 'errore') };
  }
  try {
    risultati.job_arricchimento = await eseguiJobArricchimento(supabase, cfg, data);
  } catch (e) {
    risultati.job_arricchimento = { errore: String(e?.message || 'errore') };
  }
  try {
    risultati.reconciliazione = await riconciliaSyncGoogle(supabase, cfg);
  } catch (e) {
    risultati.reconciliazione = { errore: String(e?.message || 'errore') };
  }
  try {
    risultati.notifiche = await processaNotifiche(supabase, { limite: 5 });
  } catch (e) {
    risultati.notifiche = { errore: String(e?.message || 'errore') };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true, data, risultati }) };
};
