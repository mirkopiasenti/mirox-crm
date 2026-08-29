'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const PAGE_SIZE = 1000;
const PROFILE_SELECT = 'id, nome, alias_di';
const UNASSIGNED_OPERATOR = '__unassigned__';
const METRIC_KEYS = [
  'calls',
  'answered_calls',
  'appointments_set',
  'appointments_scheduled',
  'presented',
  'won',
  'lost',
  'no_show',
  'cancelled'
];

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function parseYear(rawYear) {
  const year = Number.parseInt(rawYear, 10);
  const maxYear = new Date().getUTCFullYear() + 1;
  if (!Number.isInteger(year) || year < 2020 || year > maxYear) {
    throw new Error(`Anno non valido: usa un valore tra 2020 e ${maxYear}`);
  }
  return year;
}

function yearRange(year) {
  return {
    start: `${year}-01-01T00:00:00+01:00`,
    end: `${year + 1}-01-01T00:00:00+01:00`
  };
}

function romeDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year && values.month && values.day
    ? `${values.year}-${values.month}-${values.day}`
    : null;
}

function emptyMetrics() {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, 0]));
}

function ensureDay(series, dateKey) {
  if (!dateKey) return null;
  if (!series.has(dateKey)) series.set(dateKey, emptyMetrics());
  return series.get(dateKey);
}

function increment(series, dateKey, metric, amount = 1) {
  const day = ensureDay(series, dateKey);
  if (!day || !Object.prototype.hasOwnProperty.call(day, metric)) return;
  day[metric] += amount;
}

function buildProfileResolver(profiles) {
  const byId = new Map((profiles || []).map((profile) => [profile.id, profile]));

  function canonicalId(startId) {
    if (!startId || !byId.has(startId)) return startId || UNASSIGNED_OPERATOR;
    let currentId = startId;
    const visited = new Set();

    for (let hop = 0; hop < 3; hop += 1) {
      if (visited.has(currentId)) break;
      visited.add(currentId);
      const profile = byId.get(currentId);
      if (!profile?.alias_di || !byId.has(profile.alias_di)) break;
      currentId = profile.alias_di;
    }
    return currentId;
  }

  function label(id) {
    if (id === UNASSIGNED_OPERATOR) return 'Online / non assegnato';
    return byId.get(id)?.nome || 'Operatrice';
  }

  return { canonicalId, label };
}

function ensureOperatorSeries(operatorSeries, operatorId) {
  if (!operatorSeries.has(operatorId)) operatorSeries.set(operatorId, new Map());
  return operatorSeries.get(operatorId);
}

function addCall(totalSeries, operatorSeries, resolver, row) {
  const dateKey = romeDateKey(row?.data_ora);
  const operatorId = resolver.canonicalId(row?.operatore_id);
  const target = ensureOperatorSeries(operatorSeries, operatorId);

  increment(totalSeries, dateKey, 'calls');
  increment(target, dateKey, 'calls');
  if (String(row?.esito || '').toLowerCase() !== 'non_risposto') {
    increment(totalSeries, dateKey, 'answered_calls');
    increment(target, dateKey, 'answered_calls');
  }
}

function addAppointmentSet(totalSeries, operatorSeries, resolver, row) {
  const dateKey = romeDateKey(row?.created_at);
  const operatorId = resolver.canonicalId(row?.fissato_da_operatore_id);
  increment(totalSeries, dateKey, 'appointments_set');
  increment(ensureOperatorSeries(operatorSeries, operatorId), dateKey, 'appointments_set');
}

function addScheduledAppointment(totalSeries, operatorSeries, resolver, row) {
  const dateKey = romeDateKey(row?.data_ora);
  const operatorId = resolver.canonicalId(row?.fissato_da_operatore_id);
  const target = ensureOperatorSeries(operatorSeries, operatorId);

  const add = (metric) => {
    increment(totalSeries, dateKey, metric);
    increment(target, dateKey, metric);
  };

  if (row?.stato === 'confermato') add('appointments_scheduled');
  if (row?.presentato === 'si') add('presented');
  if (row?.presentato === 'no') add('no_show');
  if (row?.esito_finale === 'vinta') add('won');
  if (row?.esito_finale === 'persa') add('lost');
  if (row?.stato === 'annullato') add('cancelled');
}

async function fetchPaged(supabase, table, selectFields, dateColumn, year) {
  const { start, end } = yearRange(year);
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(selectFields)
      .gte(dateColumn, start)
      .lt(dateColumn, end)
      .order(dateColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || `Errore lettura ${table}`);

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function serializeSeries(series) {
  return Object.fromEntries(
    Array.from(series.entries()).sort(([left], [right]) => left.localeCompare(right))
  );
}

async function buildKpiPayload(supabase, year) {
  const [standardCalls, outboundCalls, appointmentsSet, appointmentsScheduled, profilesResult] = await Promise.all([
    fetchPaged(supabase, 'chiamate', 'id, operatore_id, data_ora, esito', 'data_ora', year),
    fetchPaged(supabase, 'call_center_lead_outbound_chiamate', 'id, operatore_id, data_ora, esito', 'data_ora', year),
    fetchPaged(supabase, 'appuntamenti', 'id, fissato_da_operatore_id, created_at', 'created_at', year),
    fetchPaged(
      supabase,
      'appuntamenti',
      'id, fissato_da_operatore_id, data_ora, stato, presentato, esito_finale',
      'data_ora',
      year
    ),
    supabase.from('profili').select(PROFILE_SELECT)
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message || 'Errore lettura operatrici');
  }

  const resolver = buildProfileResolver(profilesResult.data || []);
  const totals = new Map();
  const operatorSeries = new Map();

  [...standardCalls, ...outboundCalls].forEach((row) => addCall(totals, operatorSeries, resolver, row));
  appointmentsSet.forEach((row) => addAppointmentSet(totals, operatorSeries, resolver, row));
  appointmentsScheduled.forEach((row) => addScheduledAppointment(totals, operatorSeries, resolver, row));

  const operators = Array.from(operatorSeries.entries())
    .map(([id, series]) => ({ id, nome: resolver.label(id), by_day: serializeSeries(series) }))
    .sort((left, right) => left.nome.localeCompare(right.nome, 'it', { sensitivity: 'base' }));

  return {
    success: true,
    filters: { year },
    generated_at: new Date().toISOString(),
    definitions: {
      calls: 'Chiamate standard e outbound registrate nel giorno.',
      appointments_set: 'Appuntamenti creati nel giorno.',
      outcomes: 'Presenze ed esiti attribuiti alla data prevista dell’appuntamento.'
    },
    totals: { by_day: serializeSeries(totals) },
    operators
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, { success: true });
  if (event.httpMethod !== 'GET') return response(405, { success: false, error: 'Metodo non consentito' });

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  try {
    const year = parseYear(event.queryStringParameters?.year);
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    return response(200, await buildKpiPayload(supabase, year));
  } catch (error) {
    const message = error?.message || 'Errore caricamento KPI Call Center';
    return response(message.startsWith('Anno non valido') ? 400 : 500, { success: false, error: message });
  }
};

exports._test = {
  METRIC_KEYS,
  PROFILE_SELECT,
  addAppointmentSet,
  addCall,
  addScheduledAppointment,
  buildProfileResolver,
  emptyMetrics,
  parseYear,
  romeDateKey,
  serializeSeries,
  yearRange
};
