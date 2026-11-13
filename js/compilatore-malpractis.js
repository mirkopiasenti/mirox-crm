(async function () {
  'use strict';
  if (!await Auth.richiediAuth()) return;
  const Core = window.MalpractisCore;
  const $ = id => document.getElementById(id);
  const form = $('compilerForm');
  const endpoint = '/.netlify/functions/gestisci-malpractis';
  let version = 0, resolved = false, busy = false, pdfUrl = '';
  function invalidatePdf() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = '';
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
  for (const r of Core.reasons) conditional.push({ ...field('reasonFields', r.key, r.label, yesNo), group: r.group });
  conditional.push({ ...field('reasonFields', 'open_fiber', 'L’operatore coinvolto è Open Fiber?', yesNo), group: 'nuova' });
  conditional.push({ ...field('reasonFields', 'tim_prima', 'L’operatore è TIM/Telecom Italia (prima casella del PDF)?', yesNo), group: 'attiva' });
  conditional.push({ ...field('reasonFields', 'tim_seconda', 'L’operatore è TIM/Telecom Italia (seconda casella del PDF)?', yesNo), group: 'attiva' });
  field('reportFields', 'conoscenza_cliente', 'L’operatore sapeva che la persona contattata era cliente WINDTRE?', [...yesNo, ['non_so', 'Non noto']]);
  function updateQuestions() {
    for (const f of conditional) {
      const visible = f.group === $('stato_linea').value;
      f.wrapper.hidden = !visible; f.input.disabled = !visible; f.input.required = visible;
      if (!visible) f.input.value = '';
    }
  }
  $('stato_linea').addEventListener('change', updateQuestions);
  function openForm(customer) {
    resolved = true; form.reset(); invalidatePdf();
    const data = customer?.prefill || {};
    for (const f of Core.fields) $(f.key).value = data[f.key] || '';
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
    $('data').value = `${parts.year}-${parts.month}-${parts.day}`;
    $('customerSummary').textContent = customer ? `${customer.display_name} · ${customer.cf_piva}. Verifica i dati precompilati.` : 'Nessuna anagrafica trovata. Compila tutti i dati manualmente.';
    $('searchCard').hidden = true; $('formCard').hidden = false; updateQuestions();
  }
  function resetSearch() {
    version++; resolved = false; form.reset(); invalidatePdf(); updateQuestions();
    $('formCard').hidden = true; $('searchCard').hidden = false;
    $('searchResults').replaceChildren(); $('searchState').textContent = ''; $('searchButton').disabled = false;
  }
  $('changeCustomer').addEventListener('click', () => { if (!busy) { resetSearch(); $('searchInput').focus(); } });
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
  form.addEventListener('input', invalidatePdf);
  form.addEventListener('change', invalidatePdf);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!resolved || busy || !form.reportValidity()) return;
    let data;
    try {
      const values = Object.fromEntries(new FormData(form));
      values.motivi = Object.fromEntries(Core.reasons.map(r => [r.key, values[r.key]]));
      data = Core.validate(values);
    } catch (error) { await MiroxUI.alert(error.message, { type: 'error' }); return; }
    busy = true; invalidatePdf();
    const request = version;
    const controls = [...form.querySelectorAll('input,select,textarea,button')];
    const disabled = controls.map(c => c.disabled);
    controls.forEach(c => { c.disabled = true; }); $('changeCustomer').disabled = true;
    $('generateState').textContent = 'Generazione del PDF in corso...';
    try {
      const response = await MiroxApi.fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', modulo: data }), signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      if (request !== version) return;
      if (!response.ok || !result.success || !result.pdf_base64) throw new Error(result.error || 'Generazione PDF non riuscita');
      const bytes = Uint8Array.from(atob(result.pdf_base64), c => c.charCodeAt(0));
      pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      $('downloadPdf').href = pdfUrl; $('downloadPdf').download = result.nome_file; $('downloadPdf').hidden = false;
      $('generateState').textContent = 'PDF pronto. Scaricalo e fallo firmare al cliente.';
    } catch (error) {
      if (request === version) { $('generateState').textContent = ''; await MiroxUI.alert(error.message || 'Generazione non riuscita. I dati restano disponibili per riprovare.', { type: 'error' }); }
    } finally {
      busy = false; controls.forEach((c, i) => { c.disabled = disabled[i]; }); $('changeCustomer').disabled = false;
    }
  });
  window.addEventListener('pagehide', invalidatePdf);
  updateQuestions();
})();
