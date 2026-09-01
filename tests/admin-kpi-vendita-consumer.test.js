const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const kpiModule = require('../netlify/functions/admin-kpi-vendita-consumer.js');
const {
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
  classifyMobileAcquisition,
  classifyMnp,
  emptyAlarmMetrics,
  emptyEnergyMetrics,
  emptyFixedMetrics,
  emptyInsuranceMetrics,
  emptyMetrics,
  fixedOutcomeKey,
  isApriChiudiEnabled,
  isFwaIndoorOffer,
  parseCluster,
  parseStore,
  parseYear,
  romeMonthIndex,
  serializeMetrics
} = kpiModule._test;

test('il dettaglio MNP distingue standard e gestori selezionati', () => {
  assert.equal(classifyMnp('MNP Standard'), 'mnp_standard');
  assert.equal(classifyMnp(SELECTED_MNP_LABEL), 'mnp_selected');
  assert.equal(classifyMnp('MNP Iliad'), 'mnp_selected');
  assert.equal(classifyMnp('Nuovo numero'), null);
});

test('i conteggi Mobile dividono gli smartphone Consumer tra VAR e finanziati', () => {
  const metrics = emptyMetrics();

  addContractToMetrics(metrics, {
    data_contratto: '2026-01-31T23:30:00.000Z',
    nome_opzione_snapshot: 'MNP Standard',
    dispositivo_associato: true,
    tipo_acquisto: 'VAR'
  });
  addContractToMetrics(metrics, {
    data_contratto: '2026-02-14T10:00:00.000Z',
    nome_opzione_snapshot: SELECTED_MNP_LABEL,
    dispositivo_associato: false
  });
  addContractToMetrics(metrics, {
    data_contratto: '2026-02-28T12:00:00.000Z',
    nome_opzione_snapshot: 'Nuovo numero',
    dispositivo_associato: true,
    tipo_acquisto: 'Finanziamento'
  });

  const serialized = serializeMetrics(metrics);
  assert.equal(romeMonthIndex('2026-01-31T23:30:00.000Z'), 1);
  assert.equal(serialized.acquisitions.months[1], 3);
  assert.equal(serialized.acquisitions.total, 3);
  assert.equal(serialized.mnp_standard.months[1], 1);
  assert.equal(serialized.mnp_selected.months[1], 1);
  assert.equal(serialized.smartphone.months[1], 2);
  assert.equal(serialized.smartphone_var.months[1], 1);
  assert.equal(serialized.smartphone_financing.months[1], 1);
});

test('le acquisizioni Mobile Consumer distinguono Tied e Untied ed escludono le offerte non valide', () => {
  assert.equal(classifyMobileAcquisition('FWA Indoor'), 'tied');
  assert.equal(classifyMobileAcquisition('Tied'), 'tied');
  assert.equal(classifyMobileAcquisition('Tied - Call Your Country'), 'tied');
  assert.equal(classifyMobileAcquisition('Tied - Underground (4,99 - 5,99 - 6,99)'), 'tied');
  assert.equal(classifyMobileAcquisition('Tied Dati'), 'tied');
  assert.equal(classifyMobileAcquisition('Untied'), 'untied');
  assert.equal(classifyMobileAcquisition('United - Call Your Country'), 'untied');
  assert.equal(classifyMobileAcquisition('Sim Convergente *INTERNA*'), 'excluded');
  assert.equal(classifyMobileAcquisition('Smart-Security'), 'excluded');
  assert.equal(isFwaIndoorOffer('FWA - INDOOR'), true);
  assert.equal(isFwaIndoorOffer('FWA - OUTDOOR'), false);

  const metrics = emptyMetrics();
  const options = { consumerAcquisitionRules: true };
  [
    'Tied',
    'Tied Dati',
    'Untied',
    'Untied - Call Your Country',
    'Sim Convergente *INTERNA*',
    'Smart Security',
    'Offerta futura non classificata'
  ].forEach((nomeOfferta) => {
    addContractToMetrics(metrics, {
      data_contratto: '2026-03-15T10:00:00.000Z',
      nome_offerta_snapshot: nomeOfferta
    }, options);
  });

  assert.equal(metrics.acquisitions[2], 4);
  assert.equal(metrics.tied[2], 2);
  assert.equal(metrics.untied[2], 2);

  const fwaIndoorMetrics = emptyMetrics();
  addContractToMetrics(fwaIndoorMetrics, {
    data_contratto: '2026-03-15T10:00:00.000Z',
    nome_offerta_snapshot: 'FWA - INDOOR',
    dispositivo_associato: true
  }, {
    consumerAcquisitionRules: true,
    includeDetails: false
  });
  assert.equal(fwaIndoorMetrics.acquisitions[2], 1);
  assert.equal(fwaIndoorMetrics.tied[2], 1);
  assert.equal(fwaIndoorMetrics.smartphone[2], 0);

  const businessMetrics = emptyMetrics();
  addContractToMetrics(businessMetrics, {
    data_contratto: '2026-03-15T10:00:00.000Z',
    nome_offerta_snapshot: 'Smart Security'
  });
  assert.equal(businessMetrics.acquisitions[2], 1);
});

test('le tecnologie Fisso seguono i valori del controllo post-vendita', () => {
  assert.equal(classifyFixedTechnology('FTTC'), 'technology_fttc');
  assert.equal(classifyFixedTechnology('FTTH_OF'), 'technology_ftth');
  assert.equal(classifyFixedTechnology('FTTH_FWCOP'), 'technology_ftth');
  assert.equal(classifyFixedTechnology('FWA OUT'), 'technology_fwa_outdoor');
  assert.equal(classifyFixedTechnology('FWA - INDOOR'), 'technology_fwa_indoor');
  assert.equal(classifyFixedTechnology('FWA VOCE'), 'technology_fwa_voice');
  assert.equal(classifyFixedTechnology(null), null);
});

test('acquisizioni ed esiti Fisso restano nel mese di inserimento', () => {
  const metrics = emptyFixedMetrics();

  addFixedAcquisitionMetrics(metrics, {
    data_contratto: '2026-05-10T10:00:00.000Z'
  }, {
    tecnologia: 'FTTH_FWCOP',
    stato: 'Attivo'
  });
  addFixedAcquisitionMetrics(metrics, {
    data_contratto: '2026-05-20T10:00:00.000Z'
  }, {
    tecnologia: 'FWA IN',
    stato: 'KO'
  });
  addFixedAcquisitionMetrics(metrics, {
    data_contratto: '2026-05-25T10:00:00.000Z'
  }, null);

  assert.equal(metrics.acquisitions[4], 3);
  assert.equal(metrics.technology_ftth[4], 1);
  assert.equal(metrics.technology_fwa_indoor[4], 1);
  assert.equal(metrics.technology_unclassified[4], 1);
  assert.equal(metrics.outcome_activated[4], 1);
  assert.equal(metrics.outcome_ko[4], 1);
  assert.equal(metrics.outcome_in_activation[4], 1);
  assert.equal(fixedOutcomeKey('Da completare'), 'outcome_in_activation');
});

test('attivati e Apri Chiudi Fisso seguono il mese di attivazione', () => {
  const metrics = emptyFixedMetrics();

  addFixedActivationMetrics(metrics, { apri_chiudi: 'Si' }, {
    data_attivazione: '2026-08-04',
    stato: 'Attivo',
    tecnologia: 'FTTH_OF'
  });
  addFixedActivationMetrics(metrics, { apri_chiudi: 'Sì' }, {
    data_attivazione: '2026-08-11',
    stato: 'Attivo',
    tecnologia: 'FWA VOCE'
  });
  addFixedActivationMetrics(metrics, { apri_chiudi: 'No' }, {
    data_attivazione: '2026-08-18',
    stato: 'Attivo',
    tecnologia: 'FTTC'
  });

  assert.equal(metrics.activated[7], 3);
  assert.equal(metrics.apri_chiudi_ftth[7], 1);
  assert.equal(metrics.apri_chiudi_fwa[7], 1);
  assert.equal(isApriChiudiEnabled('Sì'), true);
  assert.equal(isApriChiudiEnabled('No'), false);
});

test('Luce e Gas conta acquisiti e attivati nel mese di inserimento', () => {
  const metrics = emptyEnergyMetrics();

  addEnergyMetrics(metrics, {
    data_contratto: '2026-04-05T10:00:00.000Z'
  }, {
    stato: 'Attivato'
  });
  addEnergyMetrics(metrics, {
    data_contratto: '2026-04-18T10:00:00.000Z'
  }, {
    stato: 'In attivazione'
  });

  assert.equal(metrics.acquisitions[3], 2);
  assert.equal(metrics.activated[3], 1);
});

test('Allarmi divide i pagamenti e mantiene gli attivati nel mese di inserimento', () => {
  const metrics = emptyAlarmMetrics();

  addAlarmMetrics(metrics, {
    data_contratto: '2026-06-08T10:00:00.000Z',
    modalita_pagamento: 'Anticipo'
  }, {
    stato: 'OK',
    stato_cambiato_at: '2026-08-12T10:00:00.000Z'
  });
  addAlarmMetrics(metrics, {
    data_contratto: '2026-06-20T10:00:00.000Z',
    modalita_pagamento: 'Finanziamento'
  }, {
    stato: 'In Attivazione'
  });
  addAlarmMetrics(metrics, {
    data_contratto: '2026-06-28T10:00:00.000Z',
    modalita_pagamento: null
  }, null);

  assert.equal(metrics.acquisitions[5], 3);
  assert.equal(metrics.payment_advance[5], 1);
  assert.equal(metrics.payment_financing[5], 1);
  assert.equal(metrics.payment_unclassified[5], 1);
  assert.equal(metrics.activated[5], 1);
  assert.equal(metrics.activated[7], 0);
});

test('Assicurazioni somma i pezzi e il punteggio gara salvato', () => {
  const metrics = emptyInsuranceMetrics();

  addInsuranceMetrics(metrics, {
    data_contratto: '2026-07-03T10:00:00.000Z',
    punteggio_gara_totale: '1.5'
  });
  addInsuranceMetrics(metrics, {
    data_contratto: '2026-07-14T10:00:00.000Z',
    punteggio_gara_totale: 2
  });

  assert.equal(metrics.pieces[6], 2);
  assert.equal(metrics.points[6], 3.5);
});

test('il filtro operatori consolida i profili alias sul canonico', () => {
  const resolver = buildProfileResolver([
    { id: 'matteo', nome: 'Matteo', alias_di: null },
    { id: 'matteo-vecchio', nome: 'Matteo storico', alias_di: 'matteo' },
    { id: 'francesca', nome: null, alias_di: null }
  ]);

  assert.equal(PROFILE_SELECT, 'id, nome, alias_di');
  assert.equal(resolver.canonicalId('matteo-vecchio'), 'matteo');
  assert.equal(resolver.label(resolver.canonicalId('matteo-vecchio')), 'Matteo');
  assert.equal(resolver.label('francesca'), 'Operatore');
  assert.equal(resolver.label('__unassigned__'), 'Operatore non assegnato');
});

test('anno e punto vendita accettano soltanto i filtri previsti', () => {
  assert.equal(parseYear('2026'), 2026);
  assert.equal(parseStore('all'), 'all');
  assert.equal(parseStore('9001415852'), '9001415852');
  assert.equal(parseStore('9000822241'), '9000822241');
  assert.throws(() => parseYear('2019'), /Anno non valido/);
  assert.throws(() => parseStore('altro'), /Punto vendita non valido/);
});

test('il cluster KPI accetta soltanto Consumer e Business', () => {
  assert.equal(parseCluster(undefined), 'Consumer');
  assert.equal(parseCluster('Consumer'), 'Consumer');
  assert.equal(parseCluster('Business'), 'Business');
  assert.throws(() => parseCluster('Turista'), /Cluster cliente non valido/);
});

test('le pagine KPI dichiarano il cluster corretto e condividono la stessa logica', () => {
  const root = path.resolve(__dirname, '..');
  const consumer = fs.readFileSync(path.join(root, 'admin-kpi-vendita-consumer.html'), 'utf8');
  const business = fs.readFileSync(path.join(root, 'admin-kpi-vendita-business.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'js/admin-kpi-vendita-consumer.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'netlify/functions/admin-kpi-vendita-consumer.js'), 'utf8');

  assert.match(consumer, /data-kpi-cluster="Consumer"/);
  assert.match(business, /data-kpi-cluster="Business"/);
  assert.match(business, /Vendita - Business/);
  assert.match(consumer, /<select id="kpiOperator">/);
  assert.match(business, /<select id="kpiOperator">/);
  assert.doesNotMatch(consumer, /Confronto operatori|operatorPeriod|operatorHead|operatorBody/);
  assert.doesNotMatch(business, /Confronto operatori|operatorPeriod|operatorHead|operatorBody/);
  assert.match(client, /cluster:\s*PAGE_CLUSTER/);
  assert.match(client, /populateOperatorFilter\(\)/);
  assert.match(client, /refs\.operator\.addEventListener\('change', render\)/);
  assert.match(client, /selectedCategoryMetrics\('mobile'\)/);
  assert.match(client, /selectedCategoryMetrics\('fixed'\)/);
  assert.match(client, /selectedCategoryMetrics\('energy'\)/);
  assert.match(client, /selectedCategoryMetrics\('alarms'\)/);
  assert.match(client, /selectedCategoryMetrics\('insurance'\)/);
  assert.doesNotMatch(client, /renderOperators|operatorPeriod|operatorHead|operatorBody/);
  assert.match(client, /label:\s*'Tied'/);
  assert.match(client, /label:\s*'Untied'/);
  assert.match(client, /label:\s*'% Tied sul totale'/);
  assert.match(client, /label:\s*'VAR'/);
  assert.match(client, /label:\s*'Finanziati'/);
  assert.match(client, /PAGE_CLUSTER === 'Consumer'/);
  assert.match(server, /dispositivo_associato, tipo_acquisto, codice_rivenditore/);
});
