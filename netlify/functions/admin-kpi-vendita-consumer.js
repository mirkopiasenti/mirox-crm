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
const PROFILE_SELECT = 'id, nome, alias_di';
const PAGE_SIZE = 1000;
const ID_CHUNK_SIZE = 100;
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

function parseCluster(rawCluster) {
  const cluster = String(rawCluster || 'Consumer').trim();
  if (!['Consumer', 'Business'].includes(cluster)) {
    throw new Error('Cluster cliente non valido');
  }
  return cluster;
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

function emptyFixedMetrics() {
  return {
    acquisitions: emptySeries(),
    technology_fttc: emptySeries(),
    technology_ftth: emptySeries(),
    technology_fwa_outdoor: emptySeries(),
    technology_fwa_indoor: emptySeries(),
    technology_fwa_voice: emptySeries(),
    technology_unclassified: emptySeries(),
    outcome_activated: emptySeries(),
    outcome_ko: emptySeries(),
    outcome_in_activation: emptySeries(),
    activated: emptySeries(),
    apri_chiudi_ftth: emptySeries(),
    apri_chiudi_fwa: emptySeries()
  };
}

function emptyEnergyMetrics() {
  return {
    acquisitions: emptySeries(),
    activated: emptySeries()
  };
}

function emptyAlarmMetrics() {
  return {
    acquisitions: emptySeries(),
    payment_advance: emptySeries(),
    payment_financing: emptySeries(),
    payment_unclassified: emptySeries(),
    activated: emptySeries()
  };
}

function emptyInsuranceMetrics() {
  return {
    pieces: emptySeries(),
    points: emptySeries()
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

function classifyFixedTechnology(value) {
  const technology = normalizeLabel(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!technology) return null;
  if (technology.startsWith('fttc')) return 'technology_fttc';
  if (technology.startsWith('ftth')) return 'technology_ftth';
  if (!technology.startsWith('fwa')) return null;
  if (technology.includes('voce')) return 'technology_fwa_voice';
  if (technology.includes('indoor') || /\bfwa in\b/.test(technology)) return 'technology_fwa_indoor';
  if (technology.includes('outdoor') || /\bfwa out\b/.test(technology)) return 'technology_fwa_outdoor';
  return null;
}

function fixedOutcomeKey(value) {
  const status = normalizeLabel(value);
  if (status === 'attivo' || status === 'attivato') return 'outcome_activated';
  if (status === 'ko') return 'outcome_ko';
  return 'outcome_in_activation';
}

function isApriChiudiEnabled(value) {
  return normalizeLabel(value) === 'si';
}

function addFixedAcquisitionMetrics(metrics, contract, followUp) {
  const monthIndex = romeMonthIndex(contract?.data_contratto);
  if (monthIndex < 0) return;

  metrics.acquisitions[monthIndex] += 1;
  const technologyKey = classifyFixedTechnology(followUp?.tecnologia);
  metrics[technologyKey || 'technology_unclassified'][monthIndex] += 1;
  metrics[fixedOutcomeKey(followUp?.stato)][monthIndex] += 1;
}

function addFixedActivationMetrics(metrics, contract, followUp) {
  const monthIndex = romeMonthIndex(followUp?.data_attivazione);
  if (monthIndex < 0 || normalizeLabel(followUp?.stato) !== 'attivo') return;

  metrics.activated[monthIndex] += 1;
  if (!isApriChiudiEnabled(contract?.apri_chiudi)) return;

  const technologyKey = classifyFixedTechnology(followUp?.tecnologia);
  if (technologyKey === 'technology_ftth') {
    metrics.apri_chiudi_ftth[monthIndex] += 1;
  } else if (technologyKey?.startsWith('technology_fwa_')) {
    metrics.apri_chiudi_fwa[monthIndex] += 1;
  }
}

function addEnergyMetrics(metrics, contract, followUp) {
  const monthIndex = romeMonthIndex(contract?.data_contratto);
  if (monthIndex < 0) return;

  metrics.acquisitions[monthIndex] += 1;
  if (normalizeLabel(followUp?.stato) === 'attivato') {
    metrics.activated[monthIndex] += 1;
  }
}

function addAlarmMetrics(metrics, contract, followUp) {
  const monthIndex = romeMonthIndex(contract?.data_contratto);
  if (monthIndex < 0) return;

  metrics.acquisitions[monthIndex] += 1;
  const payment = normalizeLabel(contract?.modalita_pagamento);
  if (payment === 'anticipo') {
    metrics.payment_advance[monthIndex] += 1;
  } else if (payment === 'finanziamento' || payment === 'finanziato') {
    metrics.payment_financing[monthIndex] += 1;
  } else {
    metrics.payment_unclassified[monthIndex] += 1;
  }

  if (normalizeLabel(followUp?.stato) === 'ok') {
    metrics.activated[monthIndex] += 1;
  }
}

function addInsuranceMetrics(metrics, contract) {
  const monthIndex = romeMonthIndex(contract?.data_contratto);
  if (monthIndex < 0) return;

  metrics.pieces[monthIndex] += 1;
  const points = Number(contract?.punteggio_gara_totale);
  if (Number.isFinite(points)) metrics.points[monthIndex] += points;
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
    return profile?.nome || 'Operatore';
  }

  return { canonicalId, label };
}

async function fetchContractsByInsertion(supabase, year, store, cluster, category, selectFields) {
  const startIso = `${year}-01-01T00:00:00+01:00`;
  const endIso = `${year + 1}-01-01T00:00:00+01:00`;
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('vendita_contratti')
      .select(selectFields)
      .eq('categoria_snapshot', category)
      .eq('cluster_cliente', cluster)
      .gte('data_contratto', startIso)
      .lt('data_contratto', endIso)
      .order('data_contratto', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (store !== 'all') query = query.eq('codice_rivenditore', store);

    const { data, error } = await query;
    if (error) throw new Error(error.message || `Errore lettura contratti ${category} ${cluster}`);

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchFixedFollowUpsByContractIds(supabase, contractIds) {
  const rows = [];
  for (let index = 0; index < contractIds.length; index += ID_CHUNK_SIZE) {
    const ids = contractIds.slice(index, index + ID_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('post_vendita_controllo_fissi')
      .select('contratto_id, stato, tecnologia, data_attivazione')
      .in('contratto_id', ids);
    if (error) throw new Error(error.message || 'Errore lettura esiti contratti Fisso');
    rows.push(...(data || []));
  }
  return rows;
}

async function fetchFollowUpsByContractIds(supabase, table, contractIds, errorMessage) {
  const rows = [];
  for (let index = 0; index < contractIds.length; index += ID_CHUNK_SIZE) {
    const ids = contractIds.slice(index, index + ID_CHUNK_SIZE);
    const { data, error } = await supabase
      .from(table)
      .select('contratto_id, stato')
      .in('contratto_id', ids);
    if (error) throw new Error(error.message || errorMessage);
    rows.push(...(data || []));
  }
  return rows;
}

async function fetchFixedActivations(supabase, year) {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;
  const rows = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('post_vendita_controllo_fissi')
      .select('contratto_id, stato, tecnologia, data_attivazione')
      .eq('stato', 'Attivo')
      .gte('data_attivazione', startDate)
      .lt('data_attivazione', endDate)
      .order('data_attivazione', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message || 'Errore lettura attivazioni Fisso');

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchContractsByIds(supabase, contractIds) {
  const rows = [];
  for (let index = 0; index < contractIds.length; index += ID_CHUNK_SIZE) {
    const ids = contractIds.slice(index, index + ID_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('vendita_contratti')
      .select('id, data_contratto, operatore_id, apri_chiudi, codice_rivenditore, categoria_snapshot, cluster_cliente')
      .in('id', ids);
    if (error) throw new Error(error.message || 'Errore lettura contratti Fisso attivati');
    rows.push(...(data || []));
  }
  return rows;
}

function ensureOperatorMetrics(map, operatorId, factory) {
  if (!map.has(operatorId)) map.set(operatorId, factory());
  return map.get(operatorId);
}

function serializeOperators(operatorMetrics, resolver) {
  return Array.from(operatorMetrics.entries())
    .map(([id, metrics]) => ({
      id,
      nome: resolver.label(id),
      metrics: serializeMetrics(metrics)
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
}

async function buildKpiPayload(supabase, year, store, cluster = 'Consumer') {
  const [
    mobileContracts,
    fixedAcquisitions,
    fixedActivations,
    energyContracts,
    alarmContracts,
    insuranceContracts,
    profilesResult
  ] = await Promise.all([
    fetchContractsByInsertion(
      supabase,
      year,
      store,
      cluster,
      'Mobile',
      'id, data_contratto, operatore_id, nome_opzione_snapshot, dispositivo_associato, codice_rivenditore'
    ),
    fetchContractsByInsertion(
      supabase,
      year,
      store,
      cluster,
      'Fisso',
      'id, data_contratto, operatore_id, apri_chiudi, codice_rivenditore'
    ),
    fetchFixedActivations(supabase, year),
    fetchContractsByInsertion(
      supabase,
      year,
      store,
      cluster,
      'Energia',
      'id, data_contratto, operatore_id, codice_rivenditore'
    ),
    fetchContractsByInsertion(
      supabase,
      year,
      store,
      cluster,
      'Allarmi',
      'id, data_contratto, operatore_id, modalita_pagamento, codice_rivenditore'
    ),
    fetchContractsByInsertion(
      supabase,
      year,
      store,
      cluster,
      'Assicurazioni',
      'id, data_contratto, operatore_id, punteggio_gara_totale, codice_rivenditore'
    ),
    supabase.from('profili').select(PROFILE_SELECT)
  ]);

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message || 'Errore lettura operatori');
  }

  const resolver = buildProfileResolver(profilesResult.data || []);
  const mobileTotals = emptyMetrics();
  const mobileOperatorMetrics = new Map();

  mobileContracts.forEach((contract) => {
    addContractToMetrics(mobileTotals, contract);

    const operatorId = resolver.canonicalId(contract.operatore_id);
    addContractToMetrics(
      ensureOperatorMetrics(mobileOperatorMetrics, operatorId, emptyMetrics),
      contract
    );
  });

  const fixedFollowUps = await fetchFixedFollowUpsByContractIds(
    supabase,
    fixedAcquisitions.map((contract) => contract.id)
  );
  const fixedFollowUpByContract = new Map(
    fixedFollowUps.map((followUp) => [followUp.contratto_id, followUp])
  );
  const activationContracts = await fetchContractsByIds(
    supabase,
    Array.from(new Set(fixedActivations.map((followUp) => followUp.contratto_id)))
  );
  const activationContractById = new Map(
    activationContracts
      .filter((contract) => (
        contract.categoria_snapshot === 'Fisso' &&
        contract.cluster_cliente === cluster &&
        (store === 'all' || contract.codice_rivenditore === store)
      ))
      .map((contract) => [contract.id, contract])
  );

  const fixedTotals = emptyFixedMetrics();
  const fixedOperatorMetrics = new Map();

  fixedAcquisitions.forEach((contract) => {
    const followUp = fixedFollowUpByContract.get(contract.id);
    addFixedAcquisitionMetrics(fixedTotals, contract, followUp);

    const operatorId = resolver.canonicalId(contract.operatore_id);
    addFixedAcquisitionMetrics(
      ensureOperatorMetrics(fixedOperatorMetrics, operatorId, emptyFixedMetrics),
      contract,
      followUp
    );
  });

  fixedActivations.forEach((followUp) => {
    const contract = activationContractById.get(followUp.contratto_id);
    if (!contract) return;
    addFixedActivationMetrics(fixedTotals, contract, followUp);

    const operatorId = resolver.canonicalId(contract.operatore_id);
    addFixedActivationMetrics(
      ensureOperatorMetrics(fixedOperatorMetrics, operatorId, emptyFixedMetrics),
      contract,
      followUp
    );
  });

  const [energyFollowUps, alarmFollowUps] = await Promise.all([
    fetchFollowUpsByContractIds(
      supabase,
      'post_vendita_controllo_lg',
      energyContracts.map((contract) => contract.id),
      'Errore lettura esiti Luce & Gas'
    ),
    fetchFollowUpsByContractIds(
      supabase,
      'post_vendita_controllo_allarmi',
      alarmContracts.map((contract) => contract.id),
      'Errore lettura esiti Allarmi'
    )
  ]);
  const energyFollowUpByContract = new Map(
    energyFollowUps.map((followUp) => [followUp.contratto_id, followUp])
  );
  const alarmFollowUpByContract = new Map(
    alarmFollowUps.map((followUp) => [followUp.contratto_id, followUp])
  );

  const energyTotals = emptyEnergyMetrics();
  const energyOperatorMetrics = new Map();
  energyContracts.forEach((contract) => {
    const followUp = energyFollowUpByContract.get(contract.id);
    addEnergyMetrics(energyTotals, contract, followUp);
    const operatorId = resolver.canonicalId(contract.operatore_id);
    addEnergyMetrics(
      ensureOperatorMetrics(energyOperatorMetrics, operatorId, emptyEnergyMetrics),
      contract,
      followUp
    );
  });

  const alarmTotals = emptyAlarmMetrics();
  const alarmOperatorMetrics = new Map();
  alarmContracts.forEach((contract) => {
    const followUp = alarmFollowUpByContract.get(contract.id);
    addAlarmMetrics(alarmTotals, contract, followUp);
    const operatorId = resolver.canonicalId(contract.operatore_id);
    addAlarmMetrics(
      ensureOperatorMetrics(alarmOperatorMetrics, operatorId, emptyAlarmMetrics),
      contract,
      followUp
    );
  });

  const insuranceTotals = emptyInsuranceMetrics();
  const insuranceOperatorMetrics = new Map();
  insuranceContracts.forEach((contract) => {
    addInsuranceMetrics(insuranceTotals, contract);
    const operatorId = resolver.canonicalId(contract.operatore_id);
    addInsuranceMetrics(
      ensureOperatorMetrics(insuranceOperatorMetrics, operatorId, emptyInsuranceMetrics),
      contract
    );
  });

  const serializedMobileTotals = serializeMetrics(mobileTotals);
  const serializedMobileOperators = serializeOperators(mobileOperatorMetrics, resolver);

  return {
    success: true,
    filters: {
      year,
      store,
      store_label: STORE_LABELS[store],
      cluster
    },
    generated_at: new Date().toISOString(),
    totals: serializedMobileTotals,
    operators: serializedMobileOperators,
    mobile: {
      totals: serializedMobileTotals,
      operators: serializedMobileOperators
    },
    fixed: {
      totals: serializeMetrics(fixedTotals),
      operators: serializeOperators(fixedOperatorMetrics, resolver)
    },
    energy: {
      totals: serializeMetrics(energyTotals),
      operators: serializeOperators(energyOperatorMetrics, resolver)
    },
    alarms: {
      totals: serializeMetrics(alarmTotals),
      operators: serializeOperators(alarmOperatorMetrics, resolver)
    },
    insurance: {
      totals: serializeMetrics(insuranceTotals),
      operators: serializeOperators(insuranceOperatorMetrics, resolver)
    }
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
    const cluster = parseCluster(event.queryStringParameters?.cluster);

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    return response(200, await buildKpiPayload(supabase, year, store, cluster));
  } catch (error) {
    const message = error?.message || 'Errore caricamento KPI Vendita';
    const validationError = message.startsWith('Anno non valido') ||
      message === 'Punto vendita non valido' ||
      message === 'Cluster cliente non valido';
    return response(validationError ? 400 : 500, { success: false, error: message });
  }
};

exports._test = {
  PROFILE_SELECT,
  SELECTED_MNP_LABEL,
  addAlarmMetrics,
  addEnergyMetrics,
  addFixedAcquisitionMetrics,
  addFixedActivationMetrics,
  addInsuranceMetrics,
  addContractToMetrics,
  buildProfileResolver,
  classifyFixedTechnology,
  classifyMnp,
  emptyAlarmMetrics,
  emptyEnergyMetrics,
  emptyFixedMetrics,
  emptyInsuranceMetrics,
  emptyMetrics,
  fixedOutcomeKey,
  isApriChiudiEnabled,
  parseStore,
  parseCluster,
  parseYear,
  romeMonthIndex,
  serializeMetrics
};
