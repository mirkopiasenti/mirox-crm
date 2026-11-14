(function (root) {
  'use strict';
  const Core = root.MiroxSegnalazioneMobileCore;
  const pending = new Map();
  const active = new Map();
  function open(contract, { autore, onCreated } = {}) {
    if (!Core.isMobile(contract.categoria_snapshot)) return null;
    const key = `mirox-segnalazione-mobile:${autore}:${contract.id}`;
    if (active.has(key)) return active.get(key);
    const esc = root.MiroxSafe.escapeHtml;
    let cached = pending.get(key);
    if (!cached) {
      try {
        const saved = JSON.parse(root.sessionStorage.getItem(key) || 'null');
        if (saved?.contratto_id === contract.id && saved.request_id && saved.expected_updated_at) { Core.validate(saved); cached = saved; }
      } catch (_) { /* Memoria di pagina disponibile anche senza sessionStorage. */ }
    }
    let busy = false, closed = false;
    function remember(value) {
      cached = value;
      if (value) pending.set(key, value); else pending.delete(key);
      try { if (value) root.sessionStorage.setItem(key, JSON.stringify(value)); else root.sessionStorage.removeItem(key); } catch (_) { /* Retry conservato in memoria. */ }
    }
    const m = root.MiroxUI._build({ title: 'Apri segnalazione',
      bodyHtml: `<p>Cliente: <strong>${esc(contract.anagrafica?.ragione_sociale || '')}</strong></p>
        <p>Verranno copiati i dati del cliente e tutti gli allegati del contratto.</p>
        <label for="mobileSegMotivo">Motivo</label>
        <select id="mobileSegMotivo" class="mx-input"><option value="">Seleziona</option>${Core.MOTIVI.map(v => `<option>${esc(v)}</option>`).join('')}</select>
        <p data-mobile-gestione></p>
        <label for="mobileSegNote" data-mobile-note-label>Note (facoltative)</label>
        <textarea id="mobileSegNote" class="mx-input" rows="4" maxlength="4000"></textarea>
        <div data-mobile-progress hidden role="status" aria-live="polite"><div class="mx-spinner" aria-hidden="true"></div><p>Creazione segnalazione e copia degli allegati in corso...</p></div>
        <p data-mobile-error role="alert"></p>`,
      footerHtml: '<button type="button" class="mx-btn mx-btn-secondary" data-mobile-cancel>Annulla</button><button type="button" class="mx-btn mx-btn-primary" data-mobile-submit>Conferma</button>',
      canClose: () => !busy, onClose: () => { closed = true; active.delete(key); }
    });
    Object.assign(m.modal.style, { maxHeight: 'calc(100dvh - 48px)', display: 'flex', flexDirection: 'column' });
    m.body.style.overflowY = 'auto';
    m.head.style.flexShrink = m.foot.style.flexShrink = '0';
    const select = m.body.querySelector('#mobileSegMotivo'), notes = m.body.querySelector('#mobileSegNote');
    const submit = m.foot.querySelector('[data-mobile-submit]'), cancel = m.foot.querySelector('[data-mobile-cancel]');
    const progress = m.body.querySelector('[data-mobile-progress]'), error = m.body.querySelector('[data-mobile-error]');
    function render() {
      notes.required = select.value === 'Altro';
      m.body.querySelector('[data-mobile-note-label]').textContent = notes.required ? 'Note (obbligatorie)' : 'Note (facoltative)';
      m.body.querySelector('[data-mobile-gestione]').textContent = select.value ? (select.value === 'Altro' ? 'Gestione interna negozio' : 'ASK - Normalizzazione') : '';
      select.disabled = notes.disabled = busy || !!cached;
      submit.disabled = cancel.disabled = busy;
      const close = m.head.querySelector('.mx-modal-x'); if (close) close.disabled = busy;
      submit.textContent = cached ? 'Riprova' : 'Conferma';
    }
    if (cached) { select.value = cached.motivo; notes.value = cached.note; error.textContent = 'Richiesta precedente da completare: premi Riprova per verificarne l’esito.'; }
    select.addEventListener('change', render);
    cancel.addEventListener('click', () => m.close());
    submit.addEventListener('click', async () => {
      if (busy || closed) return;
      let choice;
      try { choice = Core.validate({ motivo: select.value, note: notes.value }); }
      catch (e) { error.textContent = e.message; return; }
      busy = true; error.textContent = ''; render();
      try {
        const yes = await root.MiroxUI.confirm('Sei sicuro di voler aprire questa segnalazione con i dati del cliente e tutti gli allegati del contratto?', { title: 'Conferma apertura segnalazione', okText: 'Sì', cancelText: 'No' });
        if (!yes || closed) return;
        if (!cached) remember({ ...choice, contratto_id: contract.id, expected_updated_at: contract.updated_at, request_id: root.crypto.randomUUID() });
        progress.hidden = false; render();
        const response = await root.MiroxApi.fetch('/.netlify/functions/apri-segnalazione-mobile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cached) });
        const result = await response.json();
        if (!response.ok || result.success !== true || !Number.isSafeInteger(result.segnalazione_id) || result.segnalazione_id <= 0) {
          if (result.reset_request === true) remember(null);
          throw new Error(result.error || 'Esito non disponibile. Premi Riprova per verificare la stessa richiesta.');
        }
        remember(null); busy = false; m.close();
        if (onCreated) onCreated(result);
        await root.MiroxUI.alert(`Segnalazione #${result.segnalazione_id} aperta in Da gestire con ${result.allegati} allegati.`, { title: 'Segnalazione aperta', type: 'success' });
        root.location.assign(`/moduli/segnalazioni.html?segnalazione_id=${result.segnalazione_id}`);
      } catch (e) { error.textContent = e.message || 'Creazione non completata. Premi Riprova.'; }
      finally { busy = false; progress.hidden = true; if (!closed) render(); }
    });
    active.set(key, m);
    render(); select.focus();
    return m;
  }
  root.MiroxSegnalazioneMobile = { open };
})(window);
