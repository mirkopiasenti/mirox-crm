(function () {
  'use strict';

  const API_URL = '/.netlify/functions/admin-kpi-vendita-consumer';
  const PAGE_CLUSTER = document.body.dataset.kpiCluster === 'Business' ? 'Business' : 'Consumer';
  const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const STORE_NAMES = {
    all: 'Tutti i punti vendita',
    '9001415852': 'Legnago',
    '9000822241': 'Cerea'
  };
  const CATEGORIES = PAGE_CLUSTER === 'Consumer'
    ? ['mobile', 'fixed', 'customerBase', 'energy', 'alarms', 'insurance']
    : ['mobile', 'fixed', 'energy', 'alarms', 'insurance'];

  const refs = {};
  let state = null;
  let activeCategory = 'mobile';

  function escapeHtml(value) {
    return window.MiroxSafe.escapeHtml(value);
  }

  function currentRomeYearMonth() {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone: 'Europe/Rome',
      year: 'numeric',
      month: '2-digit'
    }).formatToParts(new Date());

    return {
      year: Number(parts.find((part) => part.type === 'year')?.value),
      month: Number(parts.find((part) => part.type === 'month')?.value)
    };
  }

  function isFutureMonth(year, monthIndex) {
    const now = currentRomeYearMonth();
    if (year > now.year) return true;
    return year === now.year && monthIndex + 1 > now.month;
  }

  function visibleTotal(series, year) {
    return (series || []).reduce((sum, value, monthIndex) => (
      isFutureMonth(year, monthIndex) ? sum : sum + Number(value || 0)
    ), 0);
  }

  function formatValue(value, format) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return '<span class="kpi-future-value">—</span>';
    }
    if (format === 'percent') {
      return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(Number(value))}%`;
    }
    if (format === 'points') {
      return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(Number(value));
    }
    return String(Number(value || 0));
  }

  function formatMonthValue(value, year, monthIndex, format) {
    if (isFutureMonth(year, monthIndex)) return '<span class="kpi-future-value">—</span>';
    return formatValue(value, format);
  }

  function mnpTotalSeries(metrics) {
    return MONTHS.map((_, index) => (
      Number(metrics?.mnp_standard?.months?.[index] || 0) +
      Number(metrics?.mnp_selected?.months?.[index] || 0)
    ));
  }

  function combineSeries(...seriesList) {
    return MONTHS.map((_, index) => seriesList.reduce(
      (sum, series) => sum + Number(series?.[index] || 0),
      0
    ));
  }

  function percentageSeries(numerator, denominator) {
    return MONTHS.map((_, index) => {
      const total = Number(denominator?.[index] || 0);
      return total > 0 ? (Number(numerator?.[index] || 0) / total) * 100 : null;
    });
  }

  function visiblePercentage(numerator, denominator, year) {
    const numeratorTotal = visibleTotal(numerator, year);
    const denominatorTotal = visibleTotal(denominator, year);
    return denominatorTotal > 0 ? (numeratorTotal / denominatorTotal) * 100 : null;
  }

  function renderMonthlyRows(rows) {
    const year = Number(state.filters.year);
    return rows.map((row) => {
      const classes = [
        row.total ? 'kpi-total-row' : '',
        row.format === 'percent' ? 'kpi-percentage-row' : '',
        row.format === 'points' ? 'kpi-points-row' : ''
      ].filter(Boolean).join(' ');
      const rowClass = classes ? ` class="${classes}"` : '';
      const total = Object.prototype.hasOwnProperty.call(row, 'totalValue')
        ? row.totalValue
        : visibleTotal(row.series, year);
      const cells = row.series.map((value, index) => (
        `<td>${formatMonthValue(value, year, index, row.format)}</td>`
      )).join('');

      return `<tr${rowClass}><td>${escapeHtml(row.label)}</td><td class="kpi-total-column">${formatValue(total, row.format)}</td>${cells}</tr>`;
    }).join('');
  }

  function renderMonthlyTable(target, rows) {
    const header = MONTHS.map((month) => `<th>${month}</th>`).join('');
    target.innerHTML = [
      '<table class="kpi-table">',
      '<thead><tr><th>Voce</th><th class="kpi-total-column">Totale</th>',
      header,
      '</tr></thead><tbody>',
      renderMonthlyRows(rows),
      '</tbody></table>'
    ].join('');
  }

  function getCategoryState(category) {
    if (category === 'mobile') {
      return state.mobile || {
        totals: state.totals,
        operators: state.operators
      };
    }
    return state[category];
  }

  function emptyMetricsLike(totals) {
    return Object.fromEntries(Object.keys(totals || {}).map((key) => [key, {
      months: Array.from({ length: 12 }, () => 0),
      total: 0
    }]));
  }

  function selectedCategoryMetrics(category) {
    const categoryState = getCategoryState(category);
    const totals = categoryState?.totals || {};
    const selectedOperatorId = refs.operator.value;
    if (!selectedOperatorId || selectedOperatorId === 'all') return totals;

    const selectedOperator = (categoryState?.operators || []).find(
      (operator) => operator.id === selectedOperatorId
    );
    return selectedOperator?.metrics || emptyMetricsLike(totals);
  }

  function populateOperatorFilter() {
    const previousValue = refs.operator.value || 'all';
    const operatorsById = new Map();

    CATEGORIES.forEach((category) => {
      (getCategoryState(category)?.operators || []).forEach((operator) => {
        if (!operatorsById.has(operator.id)) operatorsById.set(operator.id, operator);
      });
    });

    const operators = Array.from(operatorsById.values())
      .sort((a, b) => a.nome.localeCompare(b.nome, 'it', { sensitivity: 'base' }));
    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'Tutti';
    refs.operator.replaceChildren(allOption);

    operators.forEach((operator) => {
      const option = document.createElement('option');
      option.value = operator.id;
      option.textContent = operator.nome;
      refs.operator.appendChild(option);
    });

    refs.operator.value = operatorsById.has(previousValue) ? previousValue : 'all';
    refs.operator.disabled = operators.length === 0;
  }

  function formatUpdatedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('it-IT', {
      timeZone: 'Europe/Rome',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  function renderMobile() {
    const metrics = selectedCategoryMetrics('mobile');
    const mnpTotal = mnpTotalSeries(metrics);
    const year = Number(state.filters.year);

    const acquisitionRows = [
      { label: 'Totale acquisizioni', series: metrics.acquisitions.months, total: true }
    ];

    if (PAGE_CLUSTER === 'Consumer') {
      acquisitionRows.push(
        { label: 'Tied', series: metrics.tied.months },
        { label: 'Untied', series: metrics.untied.months },
        {
          label: '% Tied sul totale',
          series: percentageSeries(metrics.tied.months, metrics.acquisitions.months),
          totalValue: visiblePercentage(metrics.tied.months, metrics.acquisitions.months, year),
          format: 'percent'
        }
      );
    }

    renderMonthlyTable(refs.acquisitionsTable, acquisitionRows);

    renderMonthlyTable(refs.mnpTable, [
      { label: 'Totale MNP', series: mnpTotal, total: true },
      { label: 'MNP Standard', series: metrics.mnp_standard.months },
      {
        label: 'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali',
        series: metrics.mnp_selected.months
      }
    ]);

    const smartphoneRows = [
      { label: 'Smartphone associati', series: metrics.smartphone.months, total: true }
    ];
    if (PAGE_CLUSTER === 'Consumer') {
      smartphoneRows.push(
        { label: 'VAR', series: metrics.smartphone_var.months },
        { label: 'Finanziati', series: metrics.smartphone_financing.months }
      );
    }
    renderMonthlyTable(refs.smartphoneTable, smartphoneRows);
  }

  function renderFixed() {
    const metrics = selectedCategoryMetrics('fixed');
    const year = Number(state.filters.year);
    const fwaAcquisitions = combineSeries(
      metrics.technology_fwa_outdoor.months,
      metrics.technology_fwa_indoor.months,
      metrics.technology_fwa_voice.months
    );
    const classifiedAcquisitions = combineSeries(
      metrics.technology_ftth.months,
      metrics.technology_fttc.months,
      fwaAcquisitions
    );
    const apriChiudiTotal = combineSeries(
      metrics.apri_chiudi_ftth.months,
      metrics.apri_chiudi_fwa.months
    );

    renderMonthlyTable(refs.fixedAcquisitionsTable, [
      { label: 'Totale acquisizioni', series: metrics.acquisitions.months, total: true },
      { label: 'FTTC', series: metrics.technology_fttc.months },
      { label: 'FTTH', series: metrics.technology_ftth.months },
      { label: 'FWA - OUTDOOR', series: metrics.technology_fwa_outdoor.months },
      { label: 'FWA - INDOOR', series: metrics.technology_fwa_indoor.months },
      { label: 'FWA - VOCE', series: metrics.technology_fwa_voice.months }
    ]);

    renderMonthlyTable(refs.fixedOutcomesTable, [
      { label: 'ATTIVATO', series: metrics.outcome_activated.months },
      { label: 'KO', series: metrics.outcome_ko.months },
      { label: 'IN ATTIVAZIONE', series: metrics.outcome_in_activation.months }
    ]);

    renderMonthlyTable(refs.fixedActivatedTable, [
      { label: 'Fissi attivati', series: metrics.activated.months, total: true }
    ]);

    renderMonthlyTable(refs.fixedApriChiudiTable, [
      { label: 'FTTH', series: metrics.apri_chiudi_ftth.months },
      { label: 'FWA', series: metrics.apri_chiudi_fwa.months },
      {
        label: '% Apri/Chiudi su attivati',
        series: percentageSeries(apriChiudiTotal, metrics.activated.months),
        totalValue: visiblePercentage(apriChiudiTotal, metrics.activated.months, year),
        format: 'percent'
      }
    ]);

    renderMonthlyTable(refs.fixedTechnologyMixTable, [
      {
        label: 'FTTH',
        series: percentageSeries(metrics.technology_ftth.months, classifiedAcquisitions),
        totalValue: visiblePercentage(metrics.technology_ftth.months, classifiedAcquisitions, year),
        format: 'percent'
      },
      {
        label: 'FTTC',
        series: percentageSeries(metrics.technology_fttc.months, classifiedAcquisitions),
        totalValue: visiblePercentage(metrics.technology_fttc.months, classifiedAcquisitions, year),
        format: 'percent'
      },
      {
        label: 'FWA',
        series: percentageSeries(fwaAcquisitions, classifiedAcquisitions),
        totalValue: visiblePercentage(fwaAcquisitions, classifiedAcquisitions, year),
        format: 'percent'
      }
    ]);

    const unclassified = visibleTotal(metrics.technology_unclassified.months, year);
    const unclassifiedLabel = unclassified === 1
      ? '1 acquisizione'
      : `${unclassified} acquisizioni`;
    const note = unclassified > 0
      ? `${unclassifiedLabel} ${unclassified === 1 ? 'ha' : 'hanno'} la tecnologia ancora da completare e non ${unclassified === 1 ? 'è distribuita' : 'sono distribuite'} nelle righe tecnologia.`
      : '';
    refs.fixedTechnologyNote.textContent = note;
    refs.fixedTechnologyMixNote.textContent = unclassified > 0
      ? `Le percentuali sommano al 100% sulle acquisizioni con tecnologia valorizzata; ${unclassified === 1 ? '1 pratica è' : `${unclassified} pratiche sono`} ancora da classificare.`
      : '';
  }

  function renderEnergy() {
    const metrics = selectedCategoryMetrics('energy');
    renderMonthlyTable(refs.energyAcquisitionsTable, [
      { label: 'Totale acquisizioni', series: metrics.acquisitions.months, total: true }
    ]);
    renderMonthlyTable(refs.energyActivatedTable, [
      { label: 'Contratti attivati', series: metrics.activated.months, total: true }
    ]);
  }

  function renderCustomerBase() {
    const metrics = selectedCategoryMetrics('customerBase');
    const phoneTotal = combineSeries(
      metrics.phone_financing.months,
      metrics.phone_var.months
    );
    const planChangeTotal = combineSeries(
      metrics.plan_change_tied.months,
      metrics.plan_change_untied.months
    );

    renderMonthlyTable(refs.customerBasePhoneTable, [
      { label: 'Telefoni inclusi finanziati', series: metrics.phone_financing.months },
      { label: 'Telefoni inclusi VAR', series: metrics.phone_var.months },
      { label: 'Totale telefoni inclusi', series: phoneTotal, total: true }
    ]);
    renderMonthlyTable(refs.customerBasePlanTable, [
      { label: 'Cambi piano TIED', series: metrics.plan_change_tied.months },
      { label: 'Cambi piano UNTIED', series: metrics.plan_change_untied.months },
      { label: 'Totale cambi piano', series: planChangeTotal, total: true }
    ]);
    renderMonthlyTable(refs.customerBaseCaringTable, [
      { label: 'Caring Fisso', series: metrics.caring_fixed.months },
      { label: 'Caring Mobile', series: metrics.caring_mobile.months }
    ]);
  }

  function renderAlarms() {
    const metrics = selectedCategoryMetrics('alarms');
    renderMonthlyTable(refs.alarmAcquisitionsTable, [
      { label: 'Totale pezzi inseriti', series: metrics.acquisitions.months, total: true },
      { label: 'Pagamento con anticipo', series: metrics.payment_advance.months },
      { label: 'Pagamento finanziato', series: metrics.payment_financing.months }
    ]);
    renderMonthlyTable(refs.alarmActivatedTable, [
      { label: 'Allarmi attivati', series: metrics.activated.months, total: true }
    ]);

    const unclassified = visibleTotal(
      metrics.payment_unclassified.months,
      Number(state.filters.year)
    );
    refs.alarmPaymentNote.textContent = unclassified > 0
      ? `${unclassified === 1 ? '1 allarme ha' : `${unclassified} allarmi hanno`} il metodo di pagamento ancora da completare.`
      : '';
  }

  function renderInsurance() {
    const metrics = selectedCategoryMetrics('insurance');
    renderMonthlyTable(refs.insuranceTable, [
      { label: 'Totale pezzi inseriti', series: metrics.pieces.months, total: true },
      { label: 'Punti totali', series: metrics.points.months, format: 'points' }
    ]);
  }

  function switchCategory(category) {
    activeCategory = CATEGORIES.includes(category) ? category : 'mobile';
    refs.categoryTabs.forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.kpiCategory === activeCategory));
    });
    refs.categoryContents.forEach((content) => {
      content.classList.toggle('is-hidden', content.dataset.kpiContent !== activeCategory);
    });
  }

  function render() {
    renderMobile();
    renderFixed();
    if (PAGE_CLUSTER === 'Consumer') renderCustomerBase();
    renderEnergy();
    renderAlarms();
    renderInsurance();

    switchCategory(activeCategory);
    refs.updatedAt.textContent = `Aggiornato il ${formatUpdatedAt(state.generated_at)}`;
    refs.refresh.disabled = false;
    refs.loading.classList.remove('is-visible');
    refs.error.classList.remove('is-visible');
    refs.content.classList.remove('is-loading');
  }

  function setLoading(loading) {
    refs.refresh.disabled = loading;
    refs.loading.classList.toggle('is-visible', loading);
    refs.content.classList.toggle('is-loading', loading);
    if (loading) refs.error.classList.remove('is-visible');
  }

  async function loadData() {
    setLoading(true);

    try {
      const query = new URLSearchParams({
        year: refs.year.value,
        store: refs.store.value,
        cluster: PAGE_CLUSTER
      });
      const response = await MiroxApi.fetch(`${API_URL}?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Impossibile caricare i KPI Vendita Consumer');
      }

      state = payload;
      populateOperatorFilter();
      render();
    } catch (error) {
      refs.loading.classList.remove('is-visible');
      refs.content.classList.add('is-loading');
      refs.error.textContent = error?.message || 'Errore caricamento KPI';
      refs.error.classList.add('is-visible');
      refs.refresh.disabled = false;

    }
  }

  function populateYears() {
    const currentYear = currentRomeYearMonth().year;
    for (let year = currentYear; year >= 2020; year -= 1) {
      const option = document.createElement('option');
      option.value = String(year);
      option.textContent = String(year);
      refs.year.appendChild(option);
    }
  }

  function cacheRefs() {
    refs.year = document.getElementById('kpiYear');
    refs.store = document.getElementById('kpiStore');
    refs.operator = document.getElementById('kpiOperator');
    refs.refresh = document.getElementById('kpiRefresh');
    refs.updatedAt = document.getElementById('kpiUpdatedAt');
    refs.loading = document.getElementById('kpiLoading');
    refs.error = document.getElementById('kpiError');
    refs.content = document.getElementById('kpiContent');
    refs.categoryTabs = Array.from(document.querySelectorAll('[data-kpi-category]'));
    refs.categoryContents = Array.from(document.querySelectorAll('[data-kpi-content]'));
    refs.acquisitionsTable = document.getElementById('acquisitionsTable');
    refs.mnpTable = document.getElementById('mnpTable');
    refs.smartphoneTable = document.getElementById('smartphoneTable');
    refs.fixedAcquisitionsTable = document.getElementById('fixedAcquisitionsTable');
    refs.fixedTechnologyNote = document.getElementById('fixedTechnologyNote');
    refs.fixedOutcomesTable = document.getElementById('fixedOutcomesTable');
    refs.fixedActivatedTable = document.getElementById('fixedActivatedTable');
    refs.fixedApriChiudiTable = document.getElementById('fixedApriChiudiTable');
    refs.fixedTechnologyMixTable = document.getElementById('fixedTechnologyMixTable');
    refs.fixedTechnologyMixNote = document.getElementById('fixedTechnologyMixNote');
    refs.customerBasePhoneTable = document.getElementById('customerBasePhoneTable');
    refs.customerBasePlanTable = document.getElementById('customerBasePlanTable');
    refs.customerBaseCaringTable = document.getElementById('customerBaseCaringTable');
    refs.energyAcquisitionsTable = document.getElementById('energyAcquisitionsTable');
    refs.energyActivatedTable = document.getElementById('energyActivatedTable');
    refs.alarmAcquisitionsTable = document.getElementById('alarmAcquisitionsTable');
    refs.alarmPaymentNote = document.getElementById('alarmPaymentNote');
    refs.alarmActivatedTable = document.getElementById('alarmActivatedTable');
    refs.insuranceTable = document.getElementById('insuranceTable');
  }

  async function init() {
    cacheRefs();
    populateYears();

    refs.refresh.addEventListener('click', loadData);
    refs.year.addEventListener('change', loadData);
    refs.store.addEventListener('change', loadData);
    refs.operator.addEventListener('change', render);
    refs.categoryTabs.forEach((button) => {
      button.addEventListener('click', () => switchCategory(button.dataset.kpiCategory));
    });

    refs.store.value = 'all';
    refs.updatedAt.textContent = STORE_NAMES.all;
    await loadData();
  }

  window.MiroxAdminKpiVenditaConsumer = { init };
})();
