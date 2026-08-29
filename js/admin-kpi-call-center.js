(function () {
  'use strict';

  const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
  const METRIC_KEYS = ['calls', 'answered_calls', 'appointments_set', 'appointments_scheduled', 'presented', 'won', 'lost', 'no_show', 'cancelled'];
  const state = { payload: null };

  const els = {};

  function emptyMetrics() {
    return Object.fromEntries(METRIC_KEYS.map((key) => [key, 0]));
  }

  function addMetrics(target, source) {
    METRIC_KEYS.forEach((key) => { target[key] += Number(source?.[key] || 0); });
    return target;
  }

  function percent(numerator, denominator) {
    return denominator > 0 ? (numerator / denominator) * 100 : 0;
  }

  function formatPercent(value) {
    return `${Number(value || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('it-IT');
  }

  function dateKey(year, monthIndex, day) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function rangeMetrics(series, startKey, endKey) {
    const total = emptyMetrics();
    Object.entries(series || {}).forEach(([key, metrics]) => {
      if (key >= startKey && key <= endKey) addMetrics(total, metrics);
    });
    return total;
  }

  function selectedRange() {
    const year = Number(els.year.value);
    if (els.view.value === 'monthly') {
      return { start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) };
    }
    const month = Number(els.month.value);
    return {
      start: dateKey(year, month, 1),
      end: dateKey(year, month, daysInMonth(year, month)),
      label: `${MONTHS[month]} ${year}`
    };
  }

  function selectedSeries() {
    if (els.operator.value === 'all') return state.payload?.totals?.by_day || {};
    return state.payload?.operators?.find((operator) => operator.id === els.operator.value)?.by_day || {};
  }

  function buildDailyPeriods(year, month) {
    return Array.from({ length: daysInMonth(year, month) }, (_, index) => {
      const day = index + 1;
      const key = dateKey(year, month, day);
      const label = new Date(year, month, day).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' });
      return { label, start: key, end: key };
    });
  }

  function buildWeeklyPeriods(year, month) {
    const periods = [];
    const lastDay = daysInMonth(year, month);
    let startDay = 1;

    while (startDay <= lastDay) {
      const weekday = (new Date(year, month, startDay).getDay() + 6) % 7;
      const endDay = Math.min(lastDay, startDay + (6 - weekday));
      periods.push({
        label: `${String(startDay).padStart(2, '0')}–${String(endDay).padStart(2, '0')} ${MONTHS[month].slice(0, 3).toLowerCase()}`,
        start: dateKey(year, month, startDay),
        end: dateKey(year, month, endDay)
      });
      startDay = endDay + 1;
    }
    return periods;
  }

  function buildMonthlyPeriods(year) {
    return MONTHS.map((label, month) => ({
      label,
      start: dateKey(year, month, 1),
      end: dateKey(year, month, daysInMonth(year, month))
    }));
  }

  function currentPeriods() {
    const year = Number(els.year.value);
    const month = Number(els.month.value);
    if (els.view.value === 'weekly') return buildWeeklyPeriods(year, month);
    if (els.view.value === 'monthly') return buildMonthlyPeriods(year);
    return buildDailyPeriods(year, month);
  }

  function renderSummary(metrics) {
    const bookingRate = percent(metrics.appointments_set, metrics.calls);
    const cards = [
      ['Chiamate fatte', metrics.calls, `${formatNumber(metrics.answered_calls)} con risposta`],
      ['Appuntamenti fissati', metrics.appointments_set, `${formatPercent(bookingRate)} sulle chiamate`],
      ['Chiusi / vinti', metrics.won, 'Esito finale positivo'],
      ['Persi', metrics.lost, 'Esito finale negativo'],
      ['Non presentati', metrics.no_show, `${formatNumber(metrics.presented)} presentati`],
      ['Annullati', metrics.cancelled, 'Appuntamenti annullati']
    ];
    els.summary.innerHTML = cards.map(([label, value, note]) => `
      <article class="cc-kpi-card">
        <div class="cc-kpi-card-label">${MiroxSafe.escapeHtml(label)}</div>
        <div class="cc-kpi-card-value">${formatNumber(value)}</div>
        <div class="cc-kpi-card-note">${MiroxSafe.escapeHtml(note)}</div>
      </article>`).join('');
  }

  function tableHeader() {
    return '<thead><tr><th>Periodo</th><th>Chiamate</th><th>Con risposta</th><th>Fissati</th><th>Presentati</th><th>Chiusi / vinti</th><th>Persi</th><th>Non presentati</th><th>Annullati</th><th>Fissati / chiamate</th><th>Chiusura</th></tr></thead>';
  }

  function metricRow(label, metrics, className = '') {
    const bookingRate = percent(metrics.appointments_set, metrics.calls);
    const closeRate = percent(metrics.won, metrics.won + metrics.lost);
    return `<tr${className ? ` class="${className}"` : ''}>
      <td>${MiroxSafe.escapeHtml(label)}</td>
      <td>${formatNumber(metrics.calls)}</td>
      <td>${formatNumber(metrics.answered_calls)}</td>
      <td>${formatNumber(metrics.appointments_set)}</td>
      <td>${formatNumber(metrics.presented)}</td>
      <td>${formatNumber(metrics.won)}</td>
      <td>${formatNumber(metrics.lost)}</td>
      <td>${formatNumber(metrics.no_show)}</td>
      <td>${formatNumber(metrics.cancelled)}</td>
      <td>${formatPercent(bookingRate)}</td>
      <td>${formatPercent(closeRate)}</td>
    </tr>`;
  }

  function renderTrend(series) {
    const periods = currentPeriods();
    const rows = periods.map((period) => metricRow(period.label, rangeMetrics(series, period.start, period.end))).join('');
    const range = selectedRange();
    const total = rangeMetrics(series, range.start, range.end);
    els.trendTable.innerHTML = `<table class="kpi-table cc-kpi-table">${tableHeader()}<tbody>${rows}${metricRow('Totale', total, 'kpi-total-row')}</tbody></table>`;

    const labels = {
      daily: 'Dettaglio giornaliero del mese selezionato.',
      weekly: 'Settimane da lunedì a domenica, ritagliate sui confini del mese.',
      monthly: 'Confronto mensile dell’anno selezionato.'
    };
    els.trendDescription.textContent = labels[els.view.value];
  }

  function renderOperators(range) {
    const rows = (state.payload?.operators || []).map((operator) => ({
      operator,
      metrics: rangeMetrics(operator.by_day, range.start, range.end)
    })).filter(({ metrics }) => METRIC_KEYS.some((key) => metrics[key] > 0))
      .sort((left, right) => right.metrics.calls - left.metrics.calls || left.operator.nome.localeCompare(right.operator.nome, 'it'))
      .map(({ operator, metrics }) => metricRow(operator.nome, metrics, operator.id === els.operator.value ? 'cc-kpi-selected-row' : ''))
      .join('');

    els.operatorTable.innerHTML = `<table class="kpi-table cc-kpi-table">${tableHeader()}<tbody>${rows || '<tr class="kpi-empty-row"><td colspan="11">Nessun dato nel periodo selezionato.</td></tr>'}</tbody></table>`;
    els.operatorDescription.textContent = `Risultati di ${range.label}, divisi per operatrice.`;
  }

  function renderRates(metrics) {
    const rates = [
      ['Tasso di risposta', percent(metrics.answered_calls, metrics.calls), 'Chiamate con esito diverso da non risposto'],
      ['Tasso appuntamento', percent(metrics.appointments_set, metrics.calls), 'Appuntamenti fissati sulle chiamate'],
      ['Tasso presenza', percent(metrics.presented, metrics.presented + metrics.no_show), 'Presentati sugli appuntamenti con presenza definita'],
      ['Tasso chiusura', percent(metrics.won, metrics.won + metrics.lost), 'Vinti sugli appuntamenti con esito finale']
    ];

    els.rates.innerHTML = rates.map(([label, value, note]) => `
      <article class="cc-kpi-rate">
        <div class="cc-kpi-rate-head"><span>${MiroxSafe.escapeHtml(label)}</span><strong>${formatPercent(value)}</strong></div>
        <div class="cc-kpi-rate-track"><span style="width:${Math.min(100, Math.max(0, value))}%"></span></div>
        <p>${MiroxSafe.escapeHtml(note)}</p>
      </article>`).join('');
  }

  function render() {
    const range = selectedRange();
    const series = selectedSeries();
    const metrics = rangeMetrics(series, range.start, range.end);
    els.month.disabled = els.view.value === 'monthly';
    renderSummary(metrics);
    renderTrend(series);
    renderOperators(range);
    renderRates(metrics);
  }

  function populateFilters() {
    const now = new Date();
    const currentYear = now.getFullYear();
    for (let year = currentYear + 1; year >= 2020; year -= 1) {
      els.year.insertAdjacentHTML('beforeend', `<option value="${year}"${year === currentYear ? ' selected' : ''}>${year}</option>`);
    }
    MONTHS.forEach((month, index) => {
      els.month.insertAdjacentHTML('beforeend', `<option value="${index}"${index === now.getMonth() ? ' selected' : ''}>${month}</option>`);
    });
  }

  function populateOperators() {
    const selected = els.operator.value;
    els.operator.innerHTML = '<option value="all">Tutte</option>' + (state.payload?.operators || []).map((operator) => (
      `<option value="${MiroxSafe.escapeHtml(operator.id)}">${MiroxSafe.escapeHtml(operator.nome)}</option>`
    )).join('');
    els.operator.value = Array.from(els.operator.options).some((option) => option.value === selected) ? selected : 'all';
  }

  async function load() {
    els.refresh.disabled = true;
    els.loading.classList.add('is-visible');
    els.error.classList.remove('is-visible');
    els.content.classList.add('is-loading');

    try {
      const query = new URLSearchParams({ year: els.year.value });
      const response = await MiroxApi.fetch(`/.netlify/functions/admin-kpi-call-center?${query.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Impossibile caricare i KPI Call Center');
      state.payload = payload;
      populateOperators();
      els.updatedAt.textContent = `Aggiornato ${new Date(payload.generated_at).toLocaleString('it-IT')}`;
      render();
      els.content.classList.remove('is-loading');
    } catch (error) {
      els.error.textContent = error?.message || 'Errore caricamento KPI Call Center';
      els.error.classList.add('is-visible');
    } finally {
      els.loading.classList.remove('is-visible');
      els.refresh.disabled = false;
    }
  }

  async function init() {
    Object.assign(els, {
      year: document.getElementById('ccKpiYear'),
      month: document.getElementById('ccKpiMonth'),
      view: document.getElementById('ccKpiView'),
      operator: document.getElementById('ccKpiOperator'),
      refresh: document.getElementById('ccKpiRefresh'),
      updatedAt: document.getElementById('ccKpiUpdatedAt'),
      loading: document.getElementById('ccKpiLoading'),
      error: document.getElementById('ccKpiError'),
      content: document.getElementById('ccKpiContent'),
      summary: document.getElementById('ccKpiSummary'),
      trendTable: document.getElementById('ccKpiTrendTable'),
      trendDescription: document.getElementById('ccKpiTrendDescription'),
      operatorTable: document.getElementById('ccKpiOperatorTable'),
      operatorDescription: document.getElementById('ccKpiOperatorDescription'),
      rates: document.getElementById('ccKpiRates')
    });

    populateFilters();
    els.refresh.addEventListener('click', load);
    els.year.addEventListener('change', load);
    [els.month, els.view, els.operator].forEach((element) => element.addEventListener('change', render));
    await load();
  }

  window.MiroxAdminKpiCallCenter = { init };
})();
