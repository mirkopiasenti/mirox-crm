(function () {
  'use strict';
  const e = value => window.MiroxSafe.escapeHtml(String(value == null ? '' : value));
  const state = { ready: false, loading: null, reviews: new Map(), mode: null, admin: false, csv: null, notifications: [], busy: false };
  const api = async payload => {
    const r = await window.MiroxApi.fetch('/.netlify/functions/gestisci-verifica-automatica', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.success) throw new Error(data.error || 'Verifica automatica non disponibile.');
    return data;
  };
  const format = value => value ? new Date(value).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }) : 'non disponibile';
  function status(c) {
    const r = state.reviews.get(c.id);
    const text = window.MiroxVerificaCore.label(c, r);
    const pending = r?.stato_job === 'in_corso' ? '<div class="vc-auto-meta">Analisi in corso</div>' : '';
    const error = r?.errore_codice ? '<div class="vc-auto-meta vc-auto-error">Analisi sospesa per un problema tecnico. Apri il dettaglio.</div>' : '';
    const reason = r?.motivi?.[0]?.message;
    return `<span class="stato-pill">${e(text)}</span>${pending}${error}${reason ? `<div class="vc-auto-meta">${e(reason)}</div>` : ''}`;
  }
  function details(c) {
    if (!state.ready) return '';
    const r = state.reviews.get(c.id), result = r?.risultato;
    const messages = [...(result?.errors || []), ...(result?.waiting || [])];
    return `<section class="vc-auto-result"><h4>Verifica automatica</h4>
      <p>${e(window.MiroxVerificaCore.label(c, r))}${r?.stato_job === 'in_corso' ? ' — Analisi in corso' : ''}</p>
      ${result ? `<p>Ultima valutazione: <strong>${e(window.MiroxVerificaCore.LABELS[result.esito])}</strong>${state.mode === 'collaudo' ? ' (collaudo: contratto e notifiche invariati)' : ''}</p>` : ''}
      ${messages.length ? '<ul>' + messages.map(m => `<li>${e(m.message)}</li>`).join('') + '</ul>' : ''}
      ${result?.checks?.length ? '<ul>' + result.checks.map(m => `<li>${e(m)}</li>`).join('') + '</ul>' : ''}
      ${result?.patch && Object.keys(result.patch).length ? '<p>Dati ricavati dai documenti:</p><ul>' + Object.entries(result.patch).map(([key, value]) => `<li>${e(window.MiroxVerificaCore.FIELD_LABELS[key] || 'Dato contratto')}: ${e(value)}</li>`).join('') + '</ul>' : ''}
      ${r?.errore_codice ? '<p class="vc-auto-error">La lettura non è stata completata. Il contratto non è stato approvato. Riprova oppure controlla il servizio di lettura documentale.</p>' : ''}
      ${c.stato_controllo !== 'controllato' ? `<div class="vc-auto-actions">
        ${state.admin ? `<button type="button" class="mx-btn mx-btn-secondary" data-vc-auto="preview" data-contract="${e(c.id)}">Collauda questo contratto</button>` : ''}
        ${r?.primo_tentativo_at && state.mode === 'attiva' ? `<button type="button" class="mx-btn mx-btn-secondary" data-vc-auto="retry" data-contract="${e(c.id)}">Riesamina ora</button>` : ''}
        <label>Data firma effettiva, se non leggibile nei documenti <input type="date" data-vc-date="${e(c.id)}" value="${e(r?.data_firma || '')}"></label>
        <button type="button" class="mx-btn mx-btn-secondary" data-vc-auto="set_signing_date" data-contract="${e(c.id)}">Salva data firma</button>
      </div>` : ''}</section>`;
  }
  function panel() {
    const host = document.getElementById('vcAutomatico');
    if (!host) return;
    if (!state.ready) { host.innerHTML = '<h2>Verifica automatica</h2><p>Modulo non disponibile: installazione o configurazione da completare. La verifica manuale resta disponibile.</p>'; return; }
    const mode = { attiva: 'Attiva', collaudo: 'Collaudo assistito', spenta: 'Disattivata' }[state.mode];
    const unresolved = state.notifications.filter(n => ['incerta', 'fallita'].includes(n.stato));
    state.panelVersion = JSON.stringify([state.mode, state.csv?.id, unresolved.map(n => n.id + n.stato)]);
    host.innerHTML = `<h2>Verifica automatica — ${e(mode)}</h2>
      <p>${state.mode === 'attiva' ? 'Primo controllo ogni sera alle 21:00, ora italiana. Le pratiche già esaminate ripartono dopo le correzioni o un nuovo CSV.' : 'Il collaudo analizza una pratica alla volta: non conferma contratti e non invia email. Apri il dettaglio del contratto da provare.'}</p>
      <p>Ultimo CSV WindTre: ${state.csv ? `${e(state.csv.nome_file)} — ${e(format(state.csv.created_at))}` : 'non ancora caricato'}</p>
      ${unresolved.length ? `<p class="vc-auto-error">${unresolved.length} notifiche richiedono controllo dell’invio. Prima di reinviare verifica la posta ricevuta.</p><ul>${unresolved.map(n => `<li><a href="verifica_contratti.html?contratto_id=${encodeURIComponent(n.contratto_id)}">Apri contratto</a> — ${n.tipo === 'reload' ? 'Promemoria Reload' : n.tipo === 'professional_cloud' ? 'Promemoria Professional Cloud' : 'Problemi verifica'} — ${e(n.stato)}
        <button type="button" class="btn-mini" data-vc-notice="notification_received" data-notice="${e(n.id)}">Email ricevuta</button>
        ${state.mode === 'attiva' ? `<button type="button" class="btn-mini" data-vc-notice="notification_retry" data-notice="${e(n.id)}">Richiedi reinvio</button>` : ''}</li>`).join('')}</ul>` : ''}
      <div class="vc-auto-actions"><label>Esito <select id="vcAutoFiltro"><option value="">Tutti</option>${Object.entries(window.MiroxVerificaCore.LABELS).filter(([key]) => key !== 'controllato').map(([key, text]) => `<option value="${key}">${text}</option>`).join('')}</select></label>
      ${state.admin ? '<button type="button" class="btn-mini" data-vc-upload>Carica CSV WindTre</button><input type="file" id="vcAutoCsv" accept=".csv,text/csv" hidden><label>Modalità <select id="vcAutoMode"><option value="collaudo">Collaudo assistito</option><option value="attiva">Automatica alle 21:00</option><option value="spenta">Disattivata</option></select></label><button type="button" class="btn-mini" data-vc-config>Salva modalità</button>' : ''}</div>`;
    const filter = document.getElementById('vcAutoFiltro'); filter.value = state.filter || '';
    filter.addEventListener('change', () => { state.filter = filter.value; window.renderListaContratti('daVerificare'); });
    const modeSelect = document.getElementById('vcAutoMode'); if (modeSelect) modeSelect.value = state.mode;
    document.getElementById('vcAutoCsv')?.addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      if (file.size > 4 * 1024 * 1024) { await window.MiroxUI.alert('CSV troppo grande: massimo 4 MB.', { type: 'warning' }); return; }
      await action({ action: 'upload_csv', csv: await file.text(), nome_file: file.name });
    });
  }
  async function refresh() {
    if (state.loading) return state.loading;
    state.loading = (async () => {
      try {
        const data = await api({ action: 'status' });
        const before = state.reviews;
        state.reviews = new Map(data.reviews.map(r => [r.contratto_id, r]));
        state.ready = true; state.mode = data.modalita; state.admin = data.admin; state.csv = data.csv; state.notifications = data.notifications;
        if ([...state.reviews].some(([id, r]) => r.esito === 'controllato' && before.has(id) && before.get(id).esito !== 'controllato')) {
          await Promise.all([window.caricaContratti('da_controllare'), window.caricaContratti('controllato')]);
        }
        // Keep a selected file and mode while the user is interacting with controls.
        const panelVersion = JSON.stringify([state.mode, state.csv?.id, state.notifications.filter(n => ['incerta', 'fallita'].includes(n.stato)).map(n => n.id + n.stato)]);
        if (!document.getElementById('vcAutoFiltro') || state.panelVersion !== panelVersion) panel();
        window.renderListaContratti?.('daVerificare'); window.renderListaContratti?.('verificati');
        const section = window.__currentVerificaModal?.body?.querySelector('.vc-auto-result');
        const editingDate = section?.contains(document.activeElement) && document.activeElement?.matches('input[data-vc-date]');
        if (section && !editingDate && window.__currentVerificaContratto) {
          section.outerHTML = details(window.__currentVerificaContratto);
        }
      } catch { if (!state.ready) panel(); }
    })().finally(() => { state.loading = null; });
    return state.loading;
  }
  async function action(payload) {
    if (state.busy) return;
    state.busy = true;
    const loader = window.MiroxUI.loading.show('Verifica automatica', 'Registro la richiesta...');
    try {
      await api(payload); await refresh(); panel();
      loader.success(payload.action === 'upload_csv' ? 'CSV acquisito. I casi già esaminati verranno ricontrollati.' : payload.action === 'preview' ? 'Collaudo avviato. L’esito apparirà nel dettaglio appena disponibile.' : 'Richiesta registrata.');
    } catch (error) { loader.error('Richiesta non completata'); await window.MiroxUI.alert(error.message, { type: 'error' }); }
    finally { state.busy = false; }
  }
  document.addEventListener('click', async event => {
    const notice = event.target.closest('[data-vc-notice]');
    if (notice) {
      const retry = notice.dataset.vcNotice === 'notification_retry';
      if (await window.MiroxUI.confirm(retry ? 'Hai controllato la posta e vuoi richiedere un nuovo invio? Se il precedente invio era riuscito, potresti ricevere un duplicato.' : 'Confermi di aver ricevuto questa email?', { title: 'Gestione notifica' })) await action({ action: notice.dataset.vcNotice, notification_id: notice.dataset.notice });
      return;
    }
    const upload = event.target.closest('[data-vc-upload]'); if (upload) { document.getElementById('vcAutoCsv').click(); return; }
    const config = event.target.closest('[data-vc-config]');
    if (config) {
      const mode = document.getElementById('vcAutoMode').value;
      if (await window.MiroxUI.confirm(mode === 'attiva' ? 'Abilitare la verifica automatica con conferma dei contratti conformi e invio delle email previste?' : 'Salvare la modalità selezionata?', { title: 'Modalità verifica' })) await action({ action: 'configure', modalita: mode });
      return;
    }
    const button = event.target.closest('[data-vc-auto]'); if (!button) return;
    const id = button.dataset.contract, kind = button.dataset.vcAuto;
    if (kind === 'preview' && !await window.MiroxUI.confirm('Analizzare soltanto questo contratto in collaudo? Nessuno stato contratto e nessuna email verranno modificati.', { title: 'Collaudo documentale' })) return;
    const payload = { action: kind, contratto_id: id };
    if (kind === 'set_signing_date') {
      payload.data_firma = document.querySelector(`[data-vc-date="${id}"]`)?.value;
      if (!await window.MiroxUI.confirm('Confermi che questa è la data effettiva di firma del contratto, verificata nella documentazione?', { title: 'Data firma' })) return;
    }
    await action(payload);
  });
  window.MiroxVerificaAuto = { status, details, refresh,
    accepts: c => !state.filter || (state.reviews.get(c.id)?.esito || 'da_controllare') === state.filter,
    isActive: () => state.mode === 'attiva', isReady: () => state.ready };
  (async function poll() {
    if (!document.hidden && !state.busy) await refresh();
    setTimeout(poll, [...state.reviews.values()].some(r => r.stato_job === 'in_corso' || r.modalita_job === 'collaudo') ? 4000 : 20000);
  })();
})();
