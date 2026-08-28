'use strict';

const { budgetSnapshot } = require('./kona-cd-budget');
const { distanzaKm } = require('./kona-cd-distances');
const { openaiStructured } = require('./kona-cd-openai');
const { monthRomeKey, parseHHmm, romeDayRange, todayRomeStr } = require('./kona-cd-time');
const { cleanLog, isUuid, nowIso } = require('./kona-cd-util');

// Report giornaliero (19:10) e proposta piano Business (giorno/zona).
// - Il report su Telegram NON contiene PII: solo conteggi, esiti e metriche.
// - L'analisi di giornata via OpenAI riceve SOLO aggregati, mai dati clienti.

// Conteggi aggregati della giornata (nessun dato identificativo).
async function reportGiornaliero(supabase, cfg, { data } = {}) {
  const giorno = data || todayRomeStr();
  const mese = monthRomeKey(giorno);
  const [taskRows, confermeRows, bizRows, budget, sessioniRows, attivitaRows] = await Promise.all([
    supabase.from('kona_call_director_task').select('tipo, stato, esito').eq('data', giorno),
    supabase.from('kona_call_director_conferme').select('esito').eq('data', giorno),
    supabase.from('kona_call_director_appuntamenti_business').select('stato').gte('data_ora', romeDayRange(giorno).start.toISOString()).lt('data_ora', romeDayRange(giorno).end.toISOString()),
    budgetSnapshot(supabase, cfg, mese),
    supabase.from('kona_call_director_sessioni').select('tipo, stato').eq('data', giorno),
    supabase.from('kona_call_director_sessione_attivita').select('categoria, esito').gte('created_at', romeDayRange(giorno).start.toISOString()).lt('created_at', romeDayRange(giorno).end.toISOString())
  ]);

  const tasks = taskRows.data || [];
  const perTipo = {};
  for (const t of tasks) {
    if (!perTipo[t.tipo]) perTipo[t.tipo] = { totali: 0, completati: 0, esiti: {} };
    perTipo[t.tipo].totali += 1;
    if (t.stato === 'completato') perTipo[t.tipo].completati += 1;
    const esito = t.esito?.esito || 'in_corso';
    perTipo[t.tipo].esiti[esito] = (perTipo[t.tipo].esiti[esito] || 0) + 1;
  }

  const conferme = confermeRows.data || [];
  const esitiConferme = {};
  for (const c of conferme) esitiConferme[c.esito] = (esitiConferme[c.esito] || 0) + 1;

  const biz = bizRows.data || [];
  const statoAppuntamenti = {};
  for (const a of biz) statoAppuntamenti[a.stato] = (statoAppuntamenti[a.stato] || 0) + 1;

  const sessioni = sessioniRows.data || [];
  const attive = sessioni.filter((s) => s.stato === 'attiva').length;
  const attivita = attivitaRows.data || [];
  const perCategoria = {};
  for (const a of attivita) {
    if (!perCategoria[a.categoria]) perCategoria[a.categoria] = { totali: 0, esiti: {} };
    perCategoria[a.categoria].totali += 1;
    perCategoria[a.categoria].esiti[a.esito] = (perCategoria[a.categoria].esiti[a.esito] || 0) + 1;
  }

  return {
    data: giorno,
    task: { totali: tasks.length, perTipo },
    conferme: { totali: conferme.length, esiti: esitiConferme },
    appuntamenti_business: { totali: biz.length, stati: statoAppuntamenti },
    sessioni: { attive, attivita_totali: attivita.length, per_categoria: perCategoria },
    budget: {
      mese,
      budget: budget.budget,
      speso: budget.speso,
      riservato: budget.riservato,
      rimasto: budget.rimasto,
      percentuale: budget.percentuale,
      per_attivita: budget.per_attivita,
      n_chiamate: budget.n_chiamate,
      web_ricerche: budget.web_ricerche
    }
  };
}

// Analisi qualitativa della giornata (OpenAI, SOLI aggregati). Fallback
// deterministico se manca la chiave / budget / errore: mai bloccare il report.
async function analisiGiornata(supabase, cfg, { data } = {}) {
  const report = await reportGiornaliero(supabase, cfg, { data });
  const input = cleanLog(report);
  const instructions = [
    'Sei un analista commerciale. Leggi questi aggregati giornalieri (nessun dato',
    'personale) e produci un commento breve e concreto in italiano, massimo 4 frasi.',
    'Evidenzia: andamento conferme appuntamenti, stato della giornata, budget',
    'consumato e un suggerimento operativo per domani.'
  ].join(' ');
  const schema = {
    type: 'object',
    properties: {
      commento: { type: 'string' },
      suggerimento: { type: 'string' }
    },
    required: ['commento', 'suggerimento'],
    additionalProperties: false
  };
  const result = await openaiStructured({
    supabase,
    cfg,
    activity: 'analisi',
    name: 'kona_giornata_analisi',
    instructions,
    input,
    schema,
    maxOutputTokens: 400,
    webSearch: false,
    details: { data: report.data }
  });
  if (!result.ok) return { ok: false, error: result.error, fallback: true };
  return { ok: true, commento: result.value.commento, suggerimento: result.value.suggerimento };
}

// Persistenza piano giornaliero (tabella kona_call_director_piani, UNIQUE data+operatore).
async function salvaPiano(supabase, { data, operatoreId, contenuto, sorgente = 'default', stato = 'proposta' }) {
  if (!isUuid(operatoreId)) return { ok: false, error: 'operatore_id_non_valido' };
  const record = {
    data: data || todayRomeStr(),
    operatore_id: operatoreId,
    contenuto: cleanLog(contenuto || {}),
    sorgente,
    stato,
    proposta_at: nowIso(),
    ...(stato === 'approvato' ? { approvata_at: nowIso() } : {}),
    ...(stato === 'applicato' ? { applicata_at: nowIso() } : {})
  };
  const { error } = await supabase.from('kona_call_director_piani').upsert(record, { onConflict: 'data,operatore_id' });
  return error ? { ok: false, error } : { ok: true };
}

// Legge il piano di un operatore per un giorno.
async function pianoDi(supabase, { data, operatoreId }) {
  if (!isUuid(operatoreId)) return null;
  const { data: row } = await supabase
    .from('kona_call_director_piani')
    .select('*')
    .eq('data', data || todayRomeStr())
    .eq('operatore_id', operatoreId)
    .maybeSingle();
  return row || null;
}

// Piano default del giorno: proposta deterministica per zona, persistita come
// sorgente 'default', stato 'applicato' (si applica da solo se Mirko non ha
// impostato un piano approvato).
async function applicaPianoDefault(supabase, cfg, { data, operatoreId }) {
  const proposta = await propostaPianoGiorno(supabase, cfg, { data });
  const esito = await salvaPiano(supabase, {
    data,
    operatoreId,
    contenuto: { totale: proposta.totale, perZona: proposta.perZona, suggerimento: proposta.suggerimento },
    sorgente: 'default',
    stato: 'applicato'
  });
  return { ...proposta, salvato: esito.ok };
}

// Recupera gli appuntamenti Business del giorno con la localita' del lead.
async function appuntamentiDelGiorno(supabase, { data, stati = ['proposto', 'confermato', 'da_riprogrammare'] }) {
  const range = romeDayRange(data || todayRomeStr());
  const { data: rows, error } = await supabase
    .from('kona_call_director_appuntamenti_business')
    .select('id, lead_id, anagrafica_id, operatore_id, data_ora, durata_minuti, zona, stato')
    .in('stato', stati)
    .gte('data_ora', range.start.toISOString())
    .lt('data_ora', range.end.toISOString())
    .limit(60);
  if (error || !Array.isArray(rows)) return [];
  const leadIds = rows.filter((r) => isUuid(r.lead_id)).map((r) => r.lead_id).filter((v, i, a) => a.indexOf(v) === i);
  const localitaByLead = new Map();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from('call_center_lead_outbound')
      .select('id, localita, provincia')
      .in('id', leadIds.slice(0, 50));
    for (const l of leads || []) localitaByLead.set(l.id, `${l.localita || ''}${l.provincia ? ' (' + l.provincia + ')' : ''}`.trim());
  }
  return rows.map((a) => ({
    ...a,
    localita: isUuid(a.lead_id) ? localitaByLead.get(a.lead_id) || null : null
  }));
}

// Proposta piano giornaliero Business: raggruppa per zona, ordina le zone per
// distanza dal riferimento, suggerisce finestre. Non espone mai nomi/telefoni.
async function propostaPianoGiorno(supabase, cfg, { data } = {}) {
  const giorno = data || todayRomeStr();
  const appuntamenti = await appuntamentiDelGiorno(supabase, { data: giorno });
  if (appuntamenti.length === 0) return { ok: true, data: giorno, totale: 0, perZona: [], suggerimento: null };

  const durata = Number(cfg.durata_appuntamento_minuti) || 45;
  const trasferta = Number(cfg.tempi_trasferta_minuti) || 15;
  const buffer = Number(cfg.buffer_appuntamento_minuti) || 15;
  const inizio = parseHHmm(cfg.orario_calendario_inizio) ?? (8 * 60 + 30);

  const byZona = new Map();
  for (const a of appuntamenti) {
    const zona = String(a.zona || a.localita || 'Zona non definita');
    if (!byZona.has(zona)) byZona.set(zona, []);
    byZona.get(zona).push(a);
  }

  const gruppi = [];
  for (const [zona, lista] of byZona.entries()) {
    const distanza = await distanzaKm(supabase, zona, cfg.localita_riferimento);
    gruppi.push({
      zona,
      n: lista.length,
      distanza_km: distanza,
      appuntamenti: lista.sort((a, b) => new Date(a.data_ora) - new Date(b.data_ora))
    });
  }
  // 1) zone con piu' appuntamenti (raggruppamento), 2) poi le piu' vicine.
  gruppi.sort((a, b) => (b.n - a.n) || ((a.distanza_km ?? 1e9) - (b.distanza_km ?? 1e9)));

  let ora = inizio;
  const perZona = gruppi.map((g) => {
    const da = ora;
    const totaleMin = g.n * (durata + trasferta + buffer);
    const a = da + totaleMin;
    const finestra = {
      da: `${String(Math.floor(da / 60)).padStart(2, '0')}:${String(da % 60).padStart(2, '0')}`,
      a: `${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
    };
    ora = a;
    return {
      zona: g.zona,
      n: g.n,
      distanza_km: g.distanza_km,
      finestra,
      appuntamenti: g.appuntamenti.map((x) => ({ id: x.id, data_ora: x.data_ora, stato: x.stato }))
    };
  });

  const suggerimento = `Piano ${giorno}: ${appuntamenti.length} appuntamenti Business in ${gruppi.length} zone. ` +
    `Ordine suggerito: ${gruppi.map((g) => `${g.zona} (${g.n})`).join(' -> ')}.`;
  return { ok: true, data: giorno, totale: appuntamenti.length, perZona, suggerimento };
}

module.exports = {
  analisiGiornata,
  applicaPianoDefault,
  appuntamentiDelGiorno,
  pianoDi,
  propostaPianoGiorno,
  reportGiornaliero,
  salvaPiano,
  _test: { appuntamentiDelGiorno }
};
