(function () {
  'use strict';

  const API_URL = '/.netlify/functions/admin-kpi-vendita-consumer';
  const MONTHS = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const STORE_NAMES = {
    all: 'Tutti i punti vendita',
    '9001415852': 'Legnago',
    '9000822241': 'Cerea'
  };

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
        row.format === 'percent' ? 'kpi-percentage-row' : ''
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

  function operatorMetricSeries(metrics, key) {
    if (key === 'mnp_total') {
      return mnpTotalSeries(metrics);
    }
    if (key === 'apri_chiudi_total') {
      return combineSeries(
        metrics?.apri_chiudi_ftth?.months,
        metrics?.apri_chiudi_fwa?.months
      );
    }
    return metrics?.[key]?.months || [];
  }

  function operatorMetricValue(operator, key, period) {
    const metrics = operator.metrics || {};
    const periodIndex = Number(period);
    const series = operatorMetricSeries(metrics, key);
    return period === 'total'
      ? visibleTotal(series, Number(state.filters.year))
      : Number(series?.[periodIndex] || 0);
  }

  function operatorConfig() {
    if (activeCategory === 'fixed') {
      return {
        description: 'Confronto Fisso per operatore: inserimenti, esiti, attivazioni e Apri/Chiudi.',
        columns: [
          { key: 'acquisitions', label: 'Acquisizioni' },
          { key: 'outcome_activated', label: 'Attivati' },
          { key: 'outcome_ko', label: 'KO' },
          { key: 'outcome_in_activation', label: 'In Attivazione' },
          { key: 'apri_chiudi_total', label: 'Apri/Chiudi' }
        ]
      };
    }

    return {
      description: 'Confronto Mobile per operatore sugli stessi KPI della categoria.',
      columns: [
        { key: 'acquisitions', label: 'Acquisizioni' },
        { key: 'mnp_total', label: 'MNP totali' },
        { key: 'mnp_standard', label: 'MNP Standard' },
        { key: 'mnp_selected', label: 'MNP selezionati' },
        { key: 'smartphone', label: 'Smartphone' }
      ]
    };
  }

  function renderOperators() {
    const categoryState = activeCategory === 'fixed'
      ? state.fixed
      : (state.mobile || { operators: state.operators });
    const operators = categoryState?.operators || [];
    const period = refs.operatorPeriod.value;
    const config = operatorConfig();

    refs.operatorDescription.textContent = config.description;
    refs.operatorHead.innerHTML = [
      '<th>Operatore</th>',
      ...config.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`)
    ].join('');

    if (operators.length === 0) {
      refs.operatorBody.innerHTML = `<tr class="kpi-empty-row"><td colspan="${config.columns.length + 1}">Nessun dato operatore per i filtri selezionati.</td></tr>`;
      return;
    }

    refs.operatorBody.innerHTML = operators.map((operator) => `
      <tr>
        <td>${escapeHtml(operator.nome)}</td>
        ${config.columns.map((column) => (
          `<td>${operatorMetricValue(operator, column.key, period)}</td>`
        )).join('')}
      </tr>
    `).join('');
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
    const metrics = state.mobile?.totals || state.totals;
    const mnpTotal = mnpTotalSeries(metrics);

    renderMonthlyTable(refs.acquisitionsTable, [
      { label: 'Totale acquisizioni', series: metrics.acquisitions.months, total: true }
    ]);

    renderMonthlyTable(refs.mnpTable, [
      { label: 'Totale MNP', series: mnpTotal, total: true },
      { label: 'MNP Standard', series: metrics.mnp_standard.months },
      {
        label: 'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali',
        series: metrics.mnp_selected.months
      }
    ]);

    renderMonthlyTable(refs.smartphoneTable, [
      { label: 'Smartphone associato', series: metrics.smartphone.months, total: true }
    ]);
  }

  function renderFixed() {
    const metrics = state.fixed.totals;
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

  function switchCategory(category) {
    activeCategory = category === 'fixed' ? 'fixed' : 'mobile';
    refs.categoryTabs.forEach((button) => {
      button.setAttribute('aria-selected', String(button.dataset.kpiCategory === activeCategory));
    });
    refs.mobileContent.classList.toggle('is-hidden', activeCategory !== 'mobile');
    refs.fixedContent.classList.toggle('is-hidden', activeCategory !== 'fixed');
    if (state) renderOperators();
  }

  function render() {
    renderMobile();
    renderFixed();

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
        store: refs.store.value
      });
      const response = await MiroxApi.fetch(`${API_URL}?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload.success) {
        throw new Error(payload.error || 'Impossibile caricare i KPI Vendita Consumer');
      }

      state = payload;
      render();
    } catch (error) {
      refs.loading.classList.remove('is-visible');
      refs.content.classList.add('is-loading');
      refs.error.textContent = error?.message || 'Errore caricamento KPI';
      refs.error.classList.add('is-visible');
      refs.refresh.disabled = false;

      if (window.MiroxErrorReporter) {
        window.MiroxErrorReporter.report({
          source: 'admin-kpi-vendita-consumer',
          level: 'error',
          title: 'Errore caricamento KPI Vendita Consumer',
          message: error?.message || 'Impossibile caricare i KPI Vendita Consumer',
          technical: error?.stack || String(error),
          context: {
            year: refs.year.value,
            store: refs.store.value
          },
          silent: true
        });
      }
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

  function populateOperatorPeriods() {
    const totalOption = document.createElement('option');
    totalOption.value = 'total';
    totalOption.textContent = 'Totale anno';
    refs.operatorPeriod.appendChild(totalOption);

    MONTHS.forEach((month, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = month;
      refs.operatorPeriod.appendChild(option);
    });
  }

  function cacheRefs() {
    refs.year = document.getElementById('kpiYear');
    refs.store = document.getElementById('kpiStore');
    refs.refresh = document.getElementById('kpiRefresh');
    refs.updatedAt = document.getElementById('kpiUpdatedAt');
    refs.loading = document.getElementById('kpiLoading');
    refs.error = document.getElementById('kpiError');
    refs.content = document.getElementById('kpiContent');
    refs.categoryTabs = Array.from(document.querySelectorAll('[data-kpi-category]'));
    refs.mobileContent = document.getElementById('mobileKpiContent');
    refs.fixedContent = document.getElementById('fixedKpiContent');
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
    refs.operatorPeriod = document.getElementById('operatorPeriod');
    refs.operatorDescription = document.getElementById('operatorDescription');
    refs.operatorHead = document.getElementById('operatorHead');
    refs.operatorBody = document.getElementById('operatorBody');
  }

  async function init() {
    cacheRefs();
    populateYears();
    populateOperatorPeriods();

    refs.refresh.addEventListener('click', loadData);
    refs.year.addEventListener('change', loadData);
    refs.store.addEventListener('change', loadData);
    refs.operatorPeriod.addEventListener('change', renderOperators);
    refs.categoryTabs.forEach((button) => {
      button.addEventListener('click', () => switchCategory(button.dataset.kpiCategory));
    });

    refs.store.value = 'all';
    refs.updatedAt.textContent = STORE_NAMES.all;
    await loadData();
  }

  window.MiroxAdminKpiVenditaConsumer = { init };
})();
