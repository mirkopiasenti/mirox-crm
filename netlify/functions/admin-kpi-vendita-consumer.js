'use strict';

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const STORE_LABELS = {
  all: 'Tutti i punti vendita',
  '9001415852': 'Legnago',
  '9000822241': 'Cerea'
};

const SELECTED_MNP_LABEL = 'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali';
const PAGE_SIZE = 1000;
const UNASSIGNED_OPERATOR = '__unassigned__';

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

function parseStore(rawStore) {
  const store = String(rawStore || 'all').trim();
  if (!Object.prototype.hasOwnProperty.call(STORE_LABELS, store)) {
    throw new Error('Punto vendita non valido');
  }
  return store;
}

function normalizeLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function classifyMnp(optionLabel) {
  const label = normalizeLabel(optionLabel);
  if (!label.includes('mnp')) return null;

  const selectedLabel = normalizeLabel(SELECTED_MNP_LABEL);
  if (
    label === selectedLabel ||
    label.includes('iliad') ||
    label.includes('coop') ||
    label.includes('poste') ||
    label.includes('tiscali')
  ) {
    return 'mnp_selected';
  }

  return 'mnp_standard';
}

function romeMonthIndex(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return -1;

  const monthPart = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Rome',
    month: '2-digit'
  }).formatToParts(date).find((part) => part.type === 'month');

  const month = Number.parseInt(monthPart?.value, 10);
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month - 1 : -1;
}

function emptySeries() {
  return Array.from({ length: 12 }, () => 0);
}

function emptyMetrics() {
  return {
    acquisitions: emptySeries(),
    mnp_standard: emptySeries(),
    mnp_selected: emptySeries(),
    smartphone: emptySeries()
  };
}

function addContractToMetrics(metrics, contract) {
  const monthIndex = romeMonthIndex(contract?.data_contratto);
  if (monthIndex < 0) return;

  metrics.acquisitions[monthIndex] += 1;

  const mnpType = classifyMnp(contract?.nome_opzione_snapshot);
  if (mnpType) metrics[mnpType][monthIndex] += 1;

  if (contract?.dispositivo_associato === true) {
    metrics.smartphone[monthIndex] += 1;
  }
}

function sumSeries(series) {
  return series.reduce((sum, value) => sum + Number(value || 0), 0);
}

function serializeMetrics(metrics) {
  const result = {};
  for (const [key, months] of Object.entries(metrics)) {
    result[key] = {
      months,
      total: sumSeries(months)
    };
  }
  return result;
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
    if (id === UNASSIGNED_OPERATOR) return 'Operatore non assegnato';
    const profile = byId.get(id);
    return profile?.nome || profile?.email || 'Operatore';
  }

  return { canonicalId, label };
}

async function fetchAllContracts(supabase, year, store) {
  const startIso = `${year}-01-01T00:00:00+01:00`;
  const endIso = `${year + 1}-01-01T00:00:00+01:00`;
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('vendita_contratti')
      .select(
        'id, data_contratto, operatore_id, nome_opzione_snapshot, dispositivo_associato, codice_rivenditore'
      )
      .eq('categoria_snapshot', 'Mobile')
      .eq('cluster_cliente', 'Consumer')
      .gte('data_contratto', startIso)
      .lt('data_contratto', endIso)
      .order('data_contratto', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (store !== 'all') query = query.eq('codice_rivenditore', store);

    const { data, error } = await query;
    if (error) throw new Error(error.message || 'Errore lettura contratti Mobile Consumer');

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

async function buildKpiPayload(supabase, year, store) {
  const [contracts, profilesResult] = await Promise.all([
    fetchAllContracts(supabase, year, store),
    supabase.from('profili').select('id, nome, email, alias_di')
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message || 'Errore lettura operatori');
  }

  const resolver = buildProfileResolver(profilesResult.data || []);
  const totals = emptyMetrics();
  const operatorMetrics = new Map();

  contracts.forEach((contract) => {
    addContractToMetrics(totals, contract);

    const operatorId = resolver.canonicalId(contract.operatore_id);
    if (!operatorMetrics.has(operatorId)) operatorMetrics.set(operatorId, emptyMetrics());
    addContractToMetrics(operatorMetrics.get(operatorId), contract);
  });

  const operators = Array.from(operatorMetrics.entries())
    .map(([id, metrics]) => ({
      id,
      nome: resolver.label(id),
      metrics: serializeMetrics(metrics)
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));

  return {
    success: true,
    filters: {
      year,
      store,
      store_label: STORE_LABELS[store]
    },
    generated_at: new Date().toISOString(),
    totals: serializeMetrics(totals),
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
    const store = parseStore(event.queryStringParameters?.store);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    return response(200, await buildKpiPayload(supabase, year, store));
  } catch (error) {
    const message = error?.message || 'Errore caricamento KPI Mobile Consumer';
    const validationError = message.startsWith('Anno non valido') || message === 'Punto vendita non valido';
    return response(validationError ? 400 : 500, { success: false, error: message });
  }
};

exports._test = {
  SELECTED_MNP_LABEL,
  addContractToMetrics,
  buildProfileResolver,
  classifyMnp,
  emptyMetrics,
  parseStore,
  parseYear,
  romeMonthIndex,
  serializeMetrics
};
