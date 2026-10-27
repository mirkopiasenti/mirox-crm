(function () {
  'use strict';
  const Pda = window.MiroxPda;
  const esc = value => window.MiroxSafe.escapeHtml(String(value ?? ''));
  async function api(body) {
    const response = await window.MiroxApi.fetch('/.netlify/functions/gestisci-vendita-contratto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) {
      throw Object.assign(new Error(data.error || 'Verifica contratto non riuscita'), data);
    }
    return data;
  }
  async function duplicateNotice(row) {
    let html = 'Attenzione, questo contratto è già stato caricato.';
    if (row) {
      const date = row.data_contratto && !Number.isNaN(Date.parse(row.data_contratto))
        ? new Date(row.data_contratto).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : '';
      html += '<p>' + esc([date, row.operatore?.nome].filter(Boolean).join(' - ')) + '</p>';
      if (window.MiroxSafe.isUuid(row.id)) {
        html += '<a href="verifica_contratti.html?contratto_id=' + encodeURIComponent(row.id) + '">Apri contratto gia presente</a>';
      }
    }
    await window.MiroxUI.alert(html, { html: true, title: 'Contratto già caricato', type: 'warning' });
  }
  async function checkCode(value, cart = [], editingTempId = null) {
    const code = Pda.code(value);
    if (!code) throw new Error('Codice contratto obbligatorio o non valido');
    if (cart.some(c => c.temp_id !== editingTempId && Pda.code(c.codice_contratto) === code)) {
      await window.MiroxUI.alert('Questo contratto è già presente nel carrello.', { type: 'warning', title: 'Contratto duplicato' });
      return false;
    }
    const { duplicate } = await api({ action: 'check_codice', codice_contratto: code });
    if (duplicate) { await duplicateNotice(duplicate); return false; }
    return true;
  }
  async function askValue(title, label, value, normalize) {
    for (;;) {
      const raw = await window.MiroxUI.prompt({ title, label, value: String(value ?? ''), okText: 'Conferma' });
      if (raw === null) return null;
      const parsed = normalize(raw);
      if (parsed !== null) return parsed;
      value = raw;
      await window.MiroxUI.alert('Inserisci un valore valido prima di proseguire.', { type: 'warning', title });
    }
  }
  const askCode = value => askValue('Codice contratto PDA', 'Codice Contratto / Numero Contratto *', value, Pda.code);
  const askCost = value => askValue('Costo mensile offerta Mobile', 'Solo costo base dell’offerta (euro/mese) *', value, Pda.money);
  const askContact = () => askValue('Contatto per OTP', 'Cellulare della sezione DATI FIRMA ELETTRONICA *', '', Pda.phone);

  function formHtml(data = {}, category, options = {}) {
    if (!Pda.isPda(category)) return '';
    const input = (key, label, extra = '') => '<label style="display:block;margin:10px 0;"><span data-pda-label="' + key + '">' + esc(label) + '</span>'
      + '<input class="mx-input" data-pda-field="' + key + '" autocomplete="off" value="' + esc(data[key]) + '" ' + extra + '></label>';
    let html = options.wizard && options.reading === 'ai'
      ? '<input type="hidden" data-pda-field="codice_contratto" value="' + esc(data.codice_contratto) + '">'
      : input('codice_contratto', 'Codice contratto *', 'maxlength="80"');
    if (String(category).toLowerCase() !== 'mobile') return html;
    html += options.wizard
      ? '<input type="hidden" data-pda-field="costo_offerta_mensile" value="' + esc(data.costo_offerta_mensile) + '">'
      : input('costo_offerta_mensile', 'Costo mensile base offerta (euro)', 'inputmode="decimal"');
    html += '<div data-pda-mobile' + (options.wizard && options.reading === 'ai' ? ' hidden' : '') + '>';
    html += '<label style="display:block;margin:10px 0;">Attivazione *<select class="mx-input" data-pda-field="portabilita">'
      + '<option value="">Seleziona...</option>'
      + '<option value="false"' + (data.portabilita === false ? ' selected' : '') + '>Nuovo numero</option>'
      + '<option value="true"' + (data.portabilita === true ? ' selected' : '') + '>Portabilita (MNP)</option></select></label>';
    html += '<div data-pda-mnp>' + input('numero_provvisorio', 'Numero provvisorio *', 'inputmode="tel"') + '</div>';
    html += input('numero_telefono', data.portabilita === true ? 'Numero da portare (MNP) *' : 'Numero di cellulare *', 'inputmode="tel"');
    html += '<div data-pda-mnp>' + input('operatore_provenienza', 'Operatore di provenienza *', 'maxlength="100"') + '</div></div>';
    return html;
  }
  function bindForm(root) {
    const port = root.querySelector('[data-pda-field="portabilita"]');
    if (!port) return;
    const render = () => {
      root.querySelectorAll('[data-pda-mnp]').forEach(detail => { detail.hidden = port.value !== 'true'; });
      const label = root.querySelector('[data-pda-label="numero_telefono"]');
      if (label) label.textContent = port.value === 'true' ? 'Numero da portare (MNP) *' : 'Numero di cellulare *';
    };
    port.addEventListener('change', render); render();
  }
  function readForm(root) {
    const out = {};
    root.querySelectorAll('[data-pda-field]').forEach(el => { out[el.dataset.pdaField] = el.value; });
    if (out.portabilita === 'true') out.numero_mnp = out.numero_telefono;
    return out;
  }
  function summary(data = {}, options = {}) {
    const rows = options.wizard && data.pda_lettura === 'ai' ? [] : [['Codice contratto', data.codice_contratto]];
    if (!options.wizard && data.costo_offerta_mensile !== null && data.costo_offerta_mensile !== undefined) rows.push(['Costo mensile offerta', String(data.costo_offerta_mensile) + ' EUR']);
    if (!options.wizard || data.pda_lettura !== 'ai') {
      rows.push(['Numero provvisorio', data.numero_provvisorio],
        [data.portabilita ? 'Numero da portare (MNP)' : 'Numero di cellulare', data.numero_telefono],
        ['Operatore provenienza', data.operatore_provenienza]);
    }
    return rows.filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([label, value]) => '<div><b>' + esc(label) + ':</b> ' + esc(value) + '</div>').join('');
  }
  async function edit(row) {
    if (!window.MiroxSafe.isUuid(row.id) || !Pda.isPda(row.categoria_snapshot)) return null;
    return new Promise(resolve => {
      let done = false;
      const modal = window.MiroxUI._build({ title: 'Modifica dati PDA', closable: false, bodyHtml: formHtml(row, row.categoria_snapshot)
        + '<p data-pda-error role="alert" style="color:#b91c1c;"></p>',
      footerHtml: '<button class="mx-btn mx-btn-secondary" type="button" data-pda-cancel>Annulla</button>'
        + '<button class="mx-btn mx-btn-primary" type="button" data-pda-save>Salva dati PDA</button>',
      onClose: () => { if (!done) resolve(null); } });
      bindForm(modal.body);
      const cancel = modal.foot.querySelector('[data-pda-cancel]');
      cancel.addEventListener('click', modal.close);
      const save = modal.foot.querySelector('[data-pda-save]');
      save.addEventListener('click', async () => {
        save.disabled = true;
        cancel.disabled = true;
        try {
          const patch = Pda.validate(readForm(modal.body), row.categoria_snapshot,
            { requireCode: Boolean(row.codice_contratto), allowLegacy: !Pda.hasMobileData(row) });
          const data = await api({ action: 'update_pda', contratto_id: row.id, expected_updated_at: row.updated_at || null, contratto: patch });
          done = true; modal.close(); resolve(data.contratto);
        } catch (error) {
          modal.body.querySelector('[data-pda-error]').textContent = error.message;
        } finally { save.disabled = false; cancel.disabled = false; }
      });
    });
  }
  window.MiroxPdaUI = { api, checkCode, duplicateNotice, askCode, askCost, askContact, formHtml, bindForm, readForm, summary, edit };
})();
