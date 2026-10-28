(function () {
  'use strict';
  let cached = null, revision = 0, pending = null;
  const e = value => window.MiroxSafe.escapeHtml(String(value || ''));
  function comparisonHtml(comparison) {
    if (!comparison) return '';
    return '<p><strong>' + e(comparison.campo_anagrafica) + ':</strong> ' + e(comparison.nome_anagrafica || 'Non compilato') + '</p>'
      + '<p><strong>Nome letto dal documento:</strong> ' + e((comparison.nomi_documenti || []).join(' / ') || 'Non leggibile') + '</p>'
      + (comparison.nome_informativo ? '<p>Il codice fiscale coincide con l’anagrafica. Il nome letto è mostrato a titolo informativo.</p>'
        : '<p>Confronta questi valori con il testo stampato sul documento per distinguere un errore di trascrizione da un dato anagrafico da correggere.</p>');
  }
  function showError(error) {
    if (!error?.identityComparison) return false;
    window.MiroxUI._build({ title: 'Controllo identita', bodyHtml: '<p>' + e(error.message) + '</p>' + comparisonHtml(error.identityComparison) });
    return true;
  }
  const keyFor = async (files, customer, date, pdaPaths) => JSON.stringify([window.MiroxIdentitaCore.customer(customer), date, pdaPaths,
    await Promise.all(files.map(async file => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(b => b.toString(16).padStart(2, '0')).join('')))]);
  async function call(body) {
    const response = await window.MiroxApi.fetch('/.netlify/functions/verifica-identita-upload', body instanceof FormData
      ? { method: 'POST', body } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.success) throw new Error(result.error || 'Controllo identita non disponibile.');
    return result;
  }
  function manual(result, requireCitizenship) {
    return new Promise(resolve => {
      let done = false;
      const m = window.MiroxUI._build({ title: 'Conferma controllo identita',
        bodyHtml: '<p>Controlla personalmente il documento e i dati dell’anagrafica prima di confermare.</p>' + comparisonHtml(result.confronto) + '<ul>'
          + result.uncertain.map(text => '<li>' + e(text) + '</li>').join('') + '</ul>'
          + (requireCitizenship && !result.cittadinanza ? '<label>Cittadinanza <select data-identity-country><option value="">Seleziona</option><option value="ue">Italiana o di un Paese UE</option><option value="extra_ue">Extra UE</option></select></label><p>Conta la cittadinanza, non la residenza o il Paese di rilascio. Con più cittadinanze, una cittadinanza UE è sufficiente.</p>' : '')
          + (!result.scadenza ? '<label>Scadenza verificata sul documento <input type="date" data-identity-expiry></label>' : '')
          + '<label>Descrivi il controllo effettuato <textarea data-identity-reason maxlength="1000"></textarea></label>'
          + '<label><input type="checkbox" data-identity-confirm> Ho confrontato il documento con l’anagrafica e verificato la validità alla data di firma indicata.</label>',
        footerHtml: '<button type="button" class="mx-btn mx-btn-primary" data-identity-save>Conferma controllo manuale</button>',
        onClose: () => { if (!done) resolve(null); } });
      m.foot.querySelector('[data-identity-save]').addEventListener('click', async () => {
        const motivo = m.body.querySelector('[data-identity-reason]').value.trim();
        if (!m.body.querySelector('[data-identity-confirm]').checked || motivo.length < 10) {
          await window.MiroxUI.alert('Conferma il controllo e descrivilo in almeno 10 caratteri.'); return;
        }
        const scadenza = result.scadenza || m.body.querySelector('[data-identity-expiry]')?.value;
        if (!scadenza || scadenza < result.data_firma) { await window.MiroxUI.alert('Indica una scadenza valida alla data di firma.'); return; }
        const decision = { motivo, scadenza, cittadinanza: result.cittadinanza || m.body.querySelector('[data-identity-country]')?.value || null };
        if (requireCitizenship && !decision.cittadinanza) { await window.MiroxUI.alert('Seleziona cittadinanza UE oppure extra UE per il dispositivo VAR.'); return; }
        done = true; m.close(); resolve(decision);
      });
    });
  }
  async function ensure({ files, customer, date, pdaPaths = [], requireCitizenship = false, current = () => true }) {
    if (!files.length) throw new Error('Carica il documento di riconoscimento.');
    if (!date) throw new Error('Indica la data effettiva di firma per il controllo identita.');
    const stamp = revision;
    const key = await keyFor(files, customer, date, pdaPaths);
    if (stamp !== revision || !current()) throw new Error('Dati o documenti cambiati durante il controllo. Ripeti la verifica.');
    if (cached?.key === key && Date.now() - cached.at < 3.5 * 3600000 && (!requireCitizenship || cached.result.cittadinanza)) return cached;
    cached = null;
    const form = new FormData();
    form.append('cliente', JSON.stringify(customer)); form.append('data_firma', date);
    if (window.MiroxIdentitaCore.customer(customer).business) form.append('pda_paths', JSON.stringify(pdaPaths));
    files.forEach(file => form.append('file', file));
    const active = () => stamp === revision && current();
    const status = document.getElementById('identitaControlloEsito');
    if (status) status.textContent = 'Controllo identita in corso...';
    let data;
    try { data = await call(form); }
    catch (error) { if (status && active()) status.textContent = error.message; throw error; }
    if (!active()) throw new Error('Dati o documenti cambiati durante il controllo. Ripeti la verifica.');
    if (data.result.stato === 'da_correggere') {
      if (status) status.textContent = data.result.errors.join(' ');
      const error = new Error(data.result.errors.join(' '));
      error.identityComparison = data.result.confronto;
      throw error;
    }
    if (data.result.stato === 'da_confermare' || requireCitizenship && !data.result.cittadinanza) {
      const decision = await manual(data.result, requireCitizenship);
      if (!decision) throw new Error('Conferma manuale del documento non completata.');
      if (!active()) throw new Error('Dati cambiati: ripeti il controllo identita.');
      data = await call({ token: data.token, ...decision });
    }
    if (!active()) throw new Error('Dati cambiati: ripeti il controllo identita.');
    cached = { key, at: Date.now(), token: data.token, result: data.result };
    if (status) status.textContent = data.result.stato === 'manuale' ? 'Controllo identita confermato manualmente e registrato.'
      : data.result.criterio_identita === 'cf_rappresentante_pda' ? 'Codice fiscale del documento coincidente con il rappresentante della PDA Business e documento valido alla firma.'
        : data.result.criterio_identita === 'codice_fiscale' ? 'Codice fiscale coincidente con l’anagrafica e documento valido alla data di firma indicata.'
        : 'Identita coerente con l’anagrafica e valida alla data di firma indicata.';
    return cached;
  }
  window.MiroxIdentitaUpload = { ensure(options) {
    if (pending) return pending;
    pending = ensure(options).finally(() => { pending = null; }); return pending;
  }, get: () => cached, showError, invalidate() { cached = null; revision++; } };
})();
