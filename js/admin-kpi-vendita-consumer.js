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

  function formatMonthValue(value, year, monthIndex) {
    if (isFutureMonth(year, monthIndex)) return '<span class="kpi-future-value">—</span>';
    return String(Number(value || 0));
  }

  function mnpTotalSeries(metrics) {
    return MONTHS.map((_, index) => (
      Number(metrics?.mnp_standard?.months?.[index] || 0) +
      Number(metrics?.mnp_selected?.months?.[index] || 0)
    ));
  }

  function renderMonthlyRows(rows) {
    const year = Number(state.filters.year);
    return rows.map((row) => {
      const rowClass = row.total ? ' class="kpi-total-row"' : '';
      const total = visibleTotal(row.series, year);
      const cells = row.series.map((value, index) => (
        `<td>${formatMonthValue(value, year, index)}</td>`
      )).join('');

      return `<tr${rowClass}><td>${escapeHtml(row.label)}</td><td class="kpi-total-column">${total}</td>${cells}</tr>`;
    }).join('');
  }

  function renderMonthlyTable(target, rows) {
    const header = MONTHS.map((month) => `<th>${month}</th>`).join('');
    target.innerHTML = [
      '<table class="kpi-table">',
      '<thead><tr><th>Voce</th><th class="kpi-total-column">Totale YTD</th>',
      header,
      '</tr></thead><tbody>',
      renderMonthlyRows(rows),
      '</tbody></table>'
    ].join('');
  }

  function operatorMetricValue(operator, key, period) {
    const metrics = operator.metrics || {};
    const periodIndex = Number(period);

    if (key === 'mnp_total') {
      const series = mnpTotalSeries(metrics);
      return period === 'total'
        ? visibleTotal(series, Number(state.filters.year))
        : Number(series[periodIndex] || 0);
    }

    const metric = metrics[key] || { months: [] };
    return period === 'total'
      ? visibleTotal(metric.months, Number(state.filters.year))
      : Number(metric.months?.[periodIndex] || 0);
  }

  function renderOperators() {
    const operators = state.operators || [];
    const period = refs.operatorPeriod.value;

    if (operators.length === 0) {
      refs.operatorBody.innerHTML = '<tr class="kpi-empty-row"><td colspan="6">Nessun dato operatore per i filtri selezionati.</td></tr>';
      return;
    }

    refs.operatorBody.innerHTML = operators.map((operator) => `
      <tr>
        <td>${escapeHtml(operator.nome)}</td>
        <td>${operatorMetricValue(operator, 'acquisitions', period)}</td>
        <td>${operatorMetricValue(operator, 'mnp_total', period)}</td>
        <td>${operatorMetricValue(operator, 'mnp_standard', period)}</td>
        <td>${operatorMetricValue(operator, 'mnp_selected', period)}</td>
        <td>${operatorMetricValue(operator, 'smartphone', period)}</td>
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

  function render() {
    const metrics = state.totals;
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

    renderOperators();
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
        throw new Error(payload.error || 'Impossibile caricare i KPI Mobile Consumer');
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
          message: error?.message || 'Impossibile caricare i KPI Mobile Consumer',
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
    refs.acquisitionsTable = document.getElementById('acquisitionsTable');
    refs.mnpTable = document.getElementById('mnpTable');
    refs.smartphoneTable = document.getElementById('smartphoneTable');
    refs.operatorPeriod = document.getElementById('operatorPeriod');
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

    refs.store.value = 'all';
    refs.updatedAt.textContent = STORE_NAMES.all;
    await loadData();
  }

  window.MiroxAdminKpiVenditaConsumer = { init };
})();
