(function () {
  'use strict';

  const ENDPOINT = '/.netlify/functions/gestisci-anagrafiche';
  const MAX_SELECTED_COMUNI = 30;
  const state = {
    rows: [],
    page: 1,
    pageSize: 50,
    total: 0,
    totalPages: 1,
    comuni: [],
    comuniOptions: [],
    loading: false,
    exporting: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function debounce(fn, delay = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function safe(value) {
    return window.MiroxSafe.escapeHtml(value == null || value === '' ? '—' : String(value));
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function creatorName(row) {
    if (Array.isArray(row.creatore)) return row.creatore[0]?.nome || '—';
    return row.creatore?.nome || '—';
  }

  function activeParams() {
    const params = new URLSearchParams({
      page: String(state.page),
      page_size: String(state.pageSize)
    });
    const cluster = el('filterCluster').value;
    const search = el('searchName').value.trim();
    if (cluster) params.set('cluster', cluster);
    if (state.comuni.length) params.set('comuni', JSON.stringify(state.comuni));
    if (search) params.set('search', search);
    return params;
  }

  function renderComuniSummary() {
    const count = state.comuni.length;
    const summary = count === 0
      ? 'Tutti i comuni'
      : (count === 1 ? state.comuni[0] : `${count} comuni selezionati`);
    el('comuniSummary').textContent = summary;
    el('comuniTrigger').title = count ? state.comuni.join(', ') : '';
    el('btnClearComuni').disabled = count === 0;
  }

  function renderComuniOptions() {
    const container = el('comuniOptions');
    const term = el('comuniSearch').value.trim().toLocaleLowerCase('it-IT');
    const selected = new Set(state.comuni);
    const visible = state.comuniOptions.filter((comune) => comune.toLocaleLowerCase('it-IT').includes(term));
    container.replaceChildren();

    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'comuni-empty';
      empty.textContent = state.comuniOptions.length ? 'Nessun comune corrispondente' : 'Nessun comune disponibile';
      container.appendChild(empty);
      return;
    }

    for (const comune of visible) {
      const label = document.createElement('label');
      label.className = 'comune-option';
      label.setAttribute('role', 'option');
      label.setAttribute('aria-selected', selected.has(comune) ? 'true' : 'false');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selected.has(comune);
      input.value = comune;
      const text = document.createElement('span');
      text.textContent = comune;
      input.addEventListener('change', () => {
        if (input.checked) {
          if (state.comuni.length >= MAX_SELECTED_COMUNI) {
            input.checked = false;
            window.MiroxUI.toast(`Puoi selezionare al massimo ${MAX_SELECTED_COMUNI} comuni`, 'warning');
            return;
          }
          if (!state.comuni.includes(comune)) state.comuni.push(comune);
        } else {
          state.comuni = state.comuni.filter((value) => value !== comune);
        }
        state.comuni.sort((a, b) => a.localeCompare(b, 'it'));
        renderComuniSummary();
        renderComuniOptions();
        resetAndLoad();
      });
      label.append(input, text);
      container.appendChild(label);
    }
  }

  function setComuniMenu(open) {
    el('comuniMenu').classList.toggle('hidden', !open);
    el('comuniTrigger').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      renderComuniOptions();
      el('comuniSearch').focus();
    }
  }

  async function loadComuniOptions() {
    try {
      const response = await window.MiroxApi.fetch(`${ENDPOINT}?action=comuni`);
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      state.comuniOptions = Array.isArray(payload.data) ? payload.data : [];
      renderComuniOptions();
    } catch (error) {
      state.comuniOptions = [];
      renderComuniOptions();
      window.MiroxUI.toast(error.message || 'Errore durante il caricamento dei comuni', 'error');
    }
  }

  async function readError(response) {
    try {
      const payload = await response.json();
      return payload.error || `Errore HTTP ${response.status}`;
    } catch (_) {
      return `Errore HTTP ${response.status}`;
    }
  }

  function setLoading(active) {
    state.loading = active;
    el('loading').classList.toggle('hidden', !active);
    el('tablePanel').classList.toggle('hidden', active);
    el('emptyState').classList.add('hidden');
    el('btnPrev').disabled = active || state.page <= 1;
    el('btnNext').disabled = active || state.page >= state.totalPages;
  }

  function renderRows() {
    const tbody = el('anagraficheBody');
    tbody.replaceChildren();

    if (!state.rows.length) {
      el('tablePanel').classList.add('hidden');
      el('emptyState').classList.remove('hidden');
    } else {
      el('tablePanel').classList.remove('hidden');
      el('emptyState').classList.add('hidden');
    }

    for (const row of state.rows) {
      const tr = document.createElement('tr');
      const clusterClass = row.cluster === 'Consumer' ? 'consumer' : (row.cluster === 'Business' ? 'business' : 'other');
      tr.innerHTML = `
        <td><span class="cluster-pill cluster-${clusterClass}">${safe(row.cluster)}</span></td>
        <td><strong>${safe(row.ragione_sociale)}</strong>${row.nome_referente ? `<span class="row-subtitle">${safe(row.nome_referente)}</span>` : ''}</td>
        <td>${safe(row.cellulare)}</td>
        <td>${safe(row.comune)}</td>
        <td class="details-cell"><button class="btn btn-sm btn-secondary" type="button" data-detail-id="${safe(row.id)}">Dettagli</button></td>`;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('[data-detail-id]').forEach((button) => {
      button.addEventListener('click', () => openDetail(button.dataset.detailId));
    });

    el('resultCount').textContent = `${new Intl.NumberFormat('it-IT').format(state.total)} ${state.total === 1 ? 'anagrafica' : 'anagrafiche'}`;
    el('pageInfo').textContent = `Pagina ${state.page} di ${state.totalPages}`;
    el('btnPrev').disabled = state.page <= 1;
    el('btnNext').disabled = state.page >= state.totalPages;
  }

  async function loadRows() {
    if (state.loading) return;
    setLoading(true);
    try {
      const response = await window.MiroxApi.fetch(`${ENDPOINT}?${activeParams().toString()}`);
      if (!response.ok) throw new Error(await readError(response));
      const payload = await response.json();
      state.rows = payload.data || [];
      state.total = payload.pagination?.total || 0;
      state.totalPages = payload.pagination?.total_pages || 1;
      if (state.page > state.totalPages) {
        state.page = state.totalPages;
        setLoading(false);
        return loadRows();
      }
      renderRows();
    } catch (error) {
      state.rows = [];
      state.total = 0;
      state.totalPages = 1;
      renderRows();
      window.MiroxUI.toast(error.message || 'Errore durante il caricamento', 'error');
    } finally {
      setLoading(false);
    }
  }

  function resetAndLoad() {
    state.page = 1;
    loadRows();
  }

  function detailField(label, value, wide) {
    return `<div class="detail-field${wide ? ' detail-field-wide' : ''}"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`;
  }

  function openDetail(id) {
    const row = state.rows.find((item) => item.id === id);
    if (!row) return;
    el('detailTitle').textContent = row.ragione_sociale || 'Dettaglio anagrafica';
    el('detailGrid').innerHTML = [
      detailField('Cluster', row.cluster),
      detailField('Codice fiscale / P.IVA', row.cf_piva),
      detailField('Ragione sociale', row.ragione_sociale, true),
      detailField('Nome referente', row.nome_referente, true),
      detailField('Numero di contatto', row.cellulare),
      detailField('Email', row.email),
      detailField('Provincia', row.provincia),
      detailField('Comune', row.comune),
      detailField('Via', row.via, true),
      detailField('Civico', row.civico),
      detailField('Creato da', creatorName(row)),
      detailField('Creato il', formatDateTime(row.created_at)),
      detailField('Aggiornato il', formatDateTime(row.updated_at)),
      detailField('ID anagrafica', row.id, true)
    ].join('');
    el('detailModal').classList.add('active');
    el('detailClose').focus();
  }

  function closeDetail() {
    el('detailModal').classList.remove('active');
  }

  async function exportRows() {
    if (state.exporting) return;
    state.exporting = true;
    const button = el('btnExport');
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Preparazione Excel...';
    try {
      const params = activeParams();
      params.delete('page');
      params.delete('page_size');
      params.set('action', 'export');
      const response = await window.MiroxApi.fetch(`${ENDPOINT}?${params.toString()}`);
      if (!response.ok) throw new Error(await readError(response));
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const fileMatch = /filename="([^"]+)"/i.exec(disposition);
      const filename = fileMatch?.[1] || 'anagrafiche.xlsx';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      window.MiroxUI.toast('File Excel generato con i filtri attivi', 'success');
    } catch (error) {
      window.MiroxUI.toast(error.message || 'Errore durante la generazione Excel', 'error');
    } finally {
      state.exporting = false;
      button.disabled = false;
      button.textContent = originalText;
    }
  }

  async function init() {
    const profilo = await Auth.richiediAuth();
    if (!profilo) return;

    const debouncedLoad = debounce(resetAndLoad, 350);
    el('searchName').addEventListener('input', debouncedLoad);
    el('filterCluster').addEventListener('change', resetAndLoad);
    el('comuniTrigger').addEventListener('click', () => {
      setComuniMenu(el('comuniTrigger').getAttribute('aria-expanded') !== 'true');
    });
    el('comuniSearch').addEventListener('input', renderComuniOptions);
    el('btnClearComuni').addEventListener('click', () => {
      state.comuni = [];
      renderComuniSummary();
      renderComuniOptions();
      resetAndLoad();
    });
    el('btnReset').addEventListener('click', () => {
      el('searchName').value = '';
      el('filterCluster').value = '';
      el('comuniSearch').value = '';
      state.comuni = [];
      renderComuniSummary();
      renderComuniOptions();
      setComuniMenu(false);
      resetAndLoad();
    });
    el('btnExport').addEventListener('click', exportRows);
    el('btnPrev').addEventListener('click', () => {
      if (state.page <= 1 || state.loading) return;
      state.page -= 1;
      loadRows();
    });
    el('btnNext').addEventListener('click', () => {
      if (state.page >= state.totalPages || state.loading) return;
      state.page += 1;
      loadRows();
    });
    el('detailClose').addEventListener('click', closeDetail);
    el('detailDone').addEventListener('click', closeDetail);
    el('detailModal').addEventListener('click', (event) => {
      if (event.target === el('detailModal')) closeDetail();
    });
    document.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      if (!path.includes(el('comuniPicker'))) setComuniMenu(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (el('comuniTrigger').getAttribute('aria-expanded') === 'true') {
        setComuniMenu(false);
        el('comuniTrigger').focus();
      } else {
        closeDetail();
      }
    });

    renderComuniSummary();
    await Promise.all([loadComuniOptions(), loadRows()]);
  }

  init();
})();
