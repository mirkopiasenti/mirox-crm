(async function () {
  'use strict';
  if (!await Auth.richiediAuth()) return;
  const Core = window.MalpractisCore;
  const $ = id => document.getElementById(id);
  const form = $('compilerForm');
  const endpoint = '/.netlify/functions/gestisci-malpractis';
  let version = 0, resolved = false, busy = false, requestId = '', duplicateSource = null;
  let historyPage = 0, historyBusy = false, historyVersion = 0;
  function invalidatePdf() {
    requestId = '';
    $('downloadPdf').hidden = true;
    $('downloadPdf').removeAttribute('href');
    $('generateState').textContent = '';
  }
  function field(parent, key, label, options) {
    const wrapper = document.createElement('div'); wrapper.className = 'field';
    const title = document.createElement('label'); title.htmlFor = key; title.textContent = label;
    const input = document.createElement(options ? 'select' : 'input');
    input.id = key; input.name = key; input.required = true;
    if (options) {
      for (const [value, text] of [['', 'Seleziona una risposta'], ...options]) {
        const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option);
      }
    }
    wrapper.append(title, input); $(parent).append(wrapper);
    return { wrapper, input };
  }
  for (const f of Core.fields) {
    const { input } = field('customerFields', f.key, f.label);
    input.maxLength = f.max;
    input.type = f.key === 'email' ? 'email' : ['cellulare', 'numero_fisso'].includes(f.key) ? 'tel' : 'text';
  }
  field('customerFields', 'documento_tipo', 'Qual è il tipo di documento di identità?', [['ci', 'Carta di identità'], ['patente', 'Patente'], ['passaporto', 'Passaporto'], ['altro', 'Altro']]);
  field('reportFields', 'tipo_segnalazione', 'Qual è il tipo di segnalazione?', [['sollecito', 'Segnalazione di problematiche e sollecito attivazione'], ['problematica', 'Segnalazione di problematiche']]);
  field('reportFields', 'stato_linea', 'Si tratta di una nuova attivazione o di una linea già attiva?', [['nuova', 'Nuova attivazione'], ['attiva', 'Linea già attiva']]);
  const conditional = [];
  const yesNo = [['si', 'Sì'], ['no', 'No']];
  const reasonChoices = Core.reasons.map(r => {
    const wrapper = document.createElement('label'); wrapper.className = 'reason-choice';
    const input = document.createElement('input'); input.type = 'radio'; input.name = 'motivo'; input.id = `motivo_${r.key}`; input.value = r.key;
    const caption = document.createElement('span'); caption.textContent = r.label.replace(/\?$/, '.');
    wrapper.append(input, caption); $('reasonFields').append(wrapper);
    return { wrapper, input, group: r.group };
  });
  conditional.push({ ...field('operatorFields', 'open_fiber', 'L’operatore coinvolto è Open Fiber?', yesNo), group: 'nuova' });
  conditional.push({ ...field('operatorFields', 'tim_prima', 'L’operatore è TIM/Telecom Italia (prima casella del PDF)?', yesNo), group: 'attiva' });
  conditional.push({ ...field('operatorFields', 'tim_seconda', 'L’operatore è TIM/Telecom Italia (seconda casella del PDF)?', yesNo), group: 'attiva' });
  field('reportFields', 'conoscenza_cliente', 'L’operatore sapeva che la persona contattata era cliente WINDTRE?', [...yesNo, ['non_so', 'Non noto']]);
  function updateQuestions() {
    const group = $('stato_linea').value;
    $('reasonSection').hidden = $('operatorSection').hidden = !group;
    $('reasonLegend').textContent = group === 'nuova' ? 'Nuova attivazione: scegli la problematica' : 'Linea già attiva: scegli la problematica';
    for (const r of reasonChoices) {
      const visible = r.group === group;
      r.wrapper.hidden = !visible; r.input.disabled = !visible; r.input.required = visible; r.input.checked = false;
    }
    for (const f of conditional) {
      const visible = f.group === $('stato_linea').value;
      f.wrapper.hidden = !visible; f.input.disabled = !visible; f.input.required = visible;
      if (!visible) f.input.value = '';
    }
  }
  $('stato_linea').addEventListener('change', updateQuestions);
  function openForm(customer) {
    resolved = true; form.reset(); invalidatePdf();
    const copy = duplicateSource && customer && String(customer.cf_piva).toUpperCase() === duplicateSource.cf_piva ? duplicateSource : null;
    const data = copy || customer?.prefill || {};
    for (const f of Core.fields) $(f.key).value = data[f.key] || '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
    $('data').value = `${parts.year}-${parts.month}-${parts.day}`;
    $('customerSummary').textContent = customer ? `${customer.display_name} · ${customer.cf_piva}. Verifica i dati precompilati.` : 'Nessuna anagrafica trovata. Compila tutti i dati manualmente.';
    $('searchCard').hidden = true; $('formCard').hidden = false; updateQuestions();
    if (copy) {
      for (const key of ['documento_tipo', 'tipo_segnalazione', 'stato_linea', 'conoscenza_cliente', 'descrizione', 'primo_appuntamento', 'nuovo_appuntamento', 'data']) $(key).value = copy[key] || '';
      updateQuestions();
      for (const f of conditional) if (!f.input.disabled) f.input.value = copy[f.input.name] || '';
      for (const r of reasonChoices) r.input.checked = !r.input.disabled && copy.motivi?.[r.input.value] === 'si';
      $('customerSummary').textContent += ' Dati duplicati: verifica e modifica prima di generare.';
    }
    duplicateSource = null;
  }
  function resetSearch() {
    version++; resolved = false; form.reset(); invalidatePdf(); updateQuestions();
    $('formCard').hidden = true; $('searchCard').hidden = false;
    $('searchResults').replaceChildren(); $('searchState').textContent = ''; $('searchButton').disabled = false;
  }
  $('changeCustomer').addEventListener('click', () => { if (!busy) { duplicateSource = null; resetSearch(); $('searchInput').focus(); } });
  $('searchInput').addEventListener('input', resetSearch);
  $('searchForm').addEventListener('submit', async event => {
    event.preventDefault();
    const query = $('searchInput').value.trim();
    if (!query || !$('searchForm').reportValidity()) return;
    resetSearch(); const request = ++version;
    $('searchButton').disabled = true; $('searchState').textContent = 'Ricerca in corso...';
    try {
      const response = await MiroxApi.fetch(`${endpoint}?action=search_anagrafica&q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(45000) });
      const result = await response.json();
      if (request !== version) return;
      if (!response.ok || !result.success || !Array.isArray(result.anagrafiche)) throw new Error(result.error || 'Ricerca non riuscita');
      if (!result.anagrafiche.length) { openForm(null); return; }
      $('searchState').textContent = 'Seleziona l’anagrafica da utilizzare.';
      for (const customer of result.anagrafiche) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'customer-result';
        const name = document.createElement('strong'); name.textContent = customer.display_name;
        const code = document.createElement('small'); code.textContent = customer.cf_piva;
        button.append(name, code); button.addEventListener('click', () => { if (request === version) { version++; openForm(customer); } });
        $('searchResults').append(button);
      }
    } catch (error) {
      if (request === version) $('searchState').textContent = error.message || 'Ricerca non riuscita. Riprova.';
    } finally { if (request === version) $('searchButton').disabled = false; }
  });
  const edited = () => { version++; invalidatePdf(); };
  form.addEventListener('input', edited);
  form.addEventListener('change', edited);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!resolved || busy || !form.reportValidity()) return;
    let data;
    try {
      const values = Object.fromEntries(new FormData(form));
      values.motivi = Object.fromEntries(Core.reasons.map(r => [r.key, values.motivo === r.key ? 'si' : 'no']));
      data = Core.validate(values);
    } catch (error) { await MiroxUI.alert(error.message, { type: 'error' }); return; }
    busy = true;
    if (!requestId) requestId = crypto.randomUUID();
    $('downloadPdf').hidden = true;
    const request = version;
    const controls = [...form.querySelectorAll('input,select,textarea,button')];
    const disabled = controls.map(c => c.disabled);
    controls.forEach(c => { c.disabled = true; }); $('changeCustomer').disabled = true;
    $('generateState').textContent = 'Generazione del PDF in corso...';
    try {
      const response = await MiroxApi.fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', modulo: data, request_id: requestId }), signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      if (request !== version) return;
      const url = MiroxSafe.safeUrl(result.signed_url, { allowRelative: false });
      if (!response.ok || !result.success || !url) throw new Error(result.error || 'Generazione PDF non riuscita');
      $('downloadPdf').href = url; $('downloadPdf').target = '_blank'; $('downloadPdf').rel = 'noopener'; $('downloadPdf').hidden = false;
      $('generateState').textContent = 'PDF archiviato nello storico. Scaricalo e fallo firmare al cliente.';
    } catch (error) {
      if (request === version) { $('generateState').textContent = ''; await MiroxUI.alert(error.message || 'Generazione non riuscita. I dati restano disponibili per riprovare.', { type: 'error' }); }
    } finally {
      busy = false; controls.forEach((c, i) => { c.disabled = disabled[i]; }); $('changeCustomer').disabled = false;
    }
  });
  function showPanel(history) {
    if (busy) return;
    $('compilerPanel').hidden = history; $('historyPanel').hidden = !history;
    $('tabCompiler').classList.toggle('active', !history); $('tabHistory').classList.toggle('active', history);
    if (history) loadHistory(true);
  }
  async function post(action, id) {
    const response = await MiroxApi.fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id }), signal: AbortSignal.timeout(45000) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Operazione non riuscita');
    return result;
  }
  function historyButton(label, action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'change-customer'; button.textContent = label;
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try { await action(); } catch (e) { await MiroxUI.alert(e.message || 'Operazione non riuscita. Riprova.', { type: 'error' }); }
      finally { button.disabled = false; }
    });
    return button;
  }
  async function loadHistory(reset) {
    if (historyBusy) return;
    historyBusy = true; const revision = ++historyVersion, page = reset ? 1 : historyPage + 1;
    $('historyState').textContent = 'Caricamento storico...'; $('loadMoreHistory').disabled = true;
    if (reset) { $('historyRows').replaceChildren(); $('loadMoreHistory').hidden = true; }
    try {
      const response = await MiroxApi.fetch(`${endpoint}?action=list&page=${page}`, { signal: AbortSignal.timeout(45000) });
      const result = await response.json();
      if (!response.ok || !result.success || !Array.isArray(result.moduli)) throw new Error(result.error || 'Storico non disponibile');
      if (revision !== historyVersion) return;
      for (const item of result.moduli) {
        const row = document.createElement('tr');
        const date = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.created_at));
        for (const value of [date, item.intestatario, item.cf_piva, item.numero_fisso, item.stato_linea === 'nuova' ? 'Nuova attivazione' : 'Linea già attiva']) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
        const actions = document.createElement('td'); actions.className = 'history-actions';
        actions.append(historyButton('Visualizza PDF', async () => {
          const popup = window.open('', '_blank'); if (popup) popup.opener = null;
          try {
            const result = await post('signed_url', item.id), url = MiroxSafe.safeUrl(result.signed_url, { allowRelative: false });
            if (!url) throw new Error('PDF non disponibile');
            if (popup) popup.location.href = url; else window.open(url, '_blank', 'noopener');
          } catch (e) { if (popup) popup.close(); throw e; }
        }), historyButton('Duplica dati', async () => {
          const revision = version;
          const result = await post('duplicate_data', item.id);
          if (revision !== version) return;
          resetSearch(); duplicateSource = result.modulo;
          $('searchInput').value = duplicateSource.cf_piva;
          $('searchState').textContent = 'Cerca e seleziona la stessa anagrafica per duplicare i dati. Un altro cliente o nessun risultato apre una compilazione nuova.';
          showPanel(false); $('searchInput').focus();
        }));
        row.append(actions); $('historyRows').append(row);
      }
      historyPage = page; $('loadMoreHistory').hidden = !result.has_more;
      $('historyState').textContent = !result.moduli.length && reset ? 'Nessuna segnalazione generata.' : '';
    } catch (e) { $('historyState').textContent = e.message || 'Storico non disponibile. Riprova.'; }
    finally { historyBusy = false; $('loadMoreHistory').disabled = false; }
  }
  $('tabCompiler').addEventListener('click', () => showPanel(false));
  $('tabHistory').addEventListener('click', () => showPanel(true));
  $('refreshHistory').addEventListener('click', () => loadHistory(true));
  $('loadMoreHistory').addEventListener('click', () => loadHistory(false));
  window.addEventListener('pagehide', invalidatePdf);
  updateQuestions();
})();
