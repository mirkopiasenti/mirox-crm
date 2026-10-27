(async function () {
  'use strict';
  const profile = await Auth.richiediAuth();
  if (!profile || profile.ruolo !== 'admin') return;
  const Core = window.MiroxPermissions;
  const $ = id => document.getElementById(id);
  const endpoint = '/.netlify/functions/admin-permessi-pagine';
  let users = [], selected = null, saved = {}, draft = {}, version = 0, busy = false, auditRequest = 0;
  const label = user => user.nome || user.username || user.id;
  const different = () => Core.keys.filter(key => draft[key] !== saved[key]);
  const readonly = () => !selected || selected.ruolo === 'admin';
  function status(text, error = false) { $('permissionsStatus').textContent = text; $('permissionsStatus').classList.toggle('is-error', error); }
  function stateOf(user) {
    const state = user.mirox_permessi_utente;
    return (Array.isArray(state) ? state[0] : state) || { pagine: {}, versione: 0 };
  }
  async function request(url = endpoint, options = {}) {
    const response = await MiroxApi.fetch(url, { cache: 'no-store', ...options });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Operazione non riuscita'); error.status = response.status; throw error;
    }
    return data;
  }
  function updateControls() {
    const changed = different();
    const locked = busy || readonly();
    $('savePermissions').disabled = locked || !changed.length;
    $('resetPermissions').disabled = locked || !changed.length;
    $('permissionUser').disabled = busy;
    $('reloadPermissions').disabled = busy;
    $('permissionCopyUser').disabled = locked;
    $('copyPermissions').disabled = locked || !$('permissionCopyUser').value;
    $('permissionChanges').textContent = changed.length ? `${changed.length} modifiche da salvare` : 'Nessuna modifica da salvare';
    $('permissionsCount').textContent = `${Core.keys.filter(k => selected?.ruolo === 'admin' || draft[k]).length} / ${Core.keys.length} pagine abilitate`;
    document.querySelectorAll('[data-permission]').forEach(input => {
      input.checked = selected?.ruolo === 'admin' || draft[input.dataset.permission] === true;
      input.disabled = locked;
    });
    document.querySelectorAll('[data-group-toggle]').forEach(button => { button.disabled = locked; });
  }
  function buildGroups() {
    for (const group of [...new Set(Core.pages.map(page => page.group))]) {
      const section = document.createElement('section'); section.className = 'permission-group';
      const header = document.createElement('header'); const title = document.createElement('h3'); title.textContent = group;
      const actions = document.createElement('div'); actions.className = 'permission-group-actions';
      for (const enabled of [true, false]) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.groupToggle = group;
        button.textContent = enabled ? 'Abilita tutte' : 'Disabilita tutte';
        button.addEventListener('click', () => {
          if (busy || readonly()) return;
          Core.pages.filter(page => page.group === group).forEach(page => { draft[page.key] = enabled; }); updateControls();
        }); actions.append(button);
      }
      header.append(title, actions); section.append(header);
      for (const page of Core.pages.filter(p => p.group === group)) {
        const row = document.createElement('label'); row.className = 'permission-row';
        const text = document.createElement('span'); text.textContent = page.label;
        const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'permission-switch';
        input.setAttribute('role', 'switch'); input.dataset.permission = page.key;
        input.addEventListener('change', () => { if (!busy && !readonly()) draft[page.key] = input.checked; updateControls(); });
        row.append(text, input); section.append(row);
      }
      $('permissionGroups').append(section);
    }
  }
  async function audit(userId) {
    const token = ++auditRequest;
    $('permissionAudit').textContent = 'Caricamento storico...';
    try {
      const data = await request(`${endpoint}?utente_id=${encodeURIComponent(userId)}`);
      if (token !== auditRequest || selected?.id !== userId) return;
      $('permissionAudit').replaceChildren();
      if (!data.audit.length) { $('permissionAudit').textContent = 'Nessuna modifica registrata.'; return; }
      for (const entry of data.audit) {
        const container = document.createElement('article'); container.className = 'permission-audit-entry';
        const heading = document.createElement('strong');
        const author = users.find(user => user.id === entry.autore_id);
        heading.textContent = `${new Date(entry.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })} — ${author ? label(author) : 'Amministratore'} — versione ${entry.versione}`;
        container.append(heading);
        for (const enabled of [true, false]) {
          const changed = Core.pages.filter(p => (entry.prima[p.key] === true) !== (entry.dopo[p.key] === true) && entry.dopo[p.key] === enabled);
          if (!changed.length) continue;
          const text = document.createElement('p'); text.textContent = `${enabled ? 'Abilitate' : 'Disabilitate'}: ${changed.map(p => p.label).join(', ')}`;
          container.append(text);
        }
        $('permissionAudit').append(container);
      }
    } catch (error) { if (token === auditRequest) $('permissionAudit').textContent = error.message; }
  }
  function selectUser(id) {
    selected = users.find(user => user.id === id) || null;
    $('permissionEditor').hidden = !selected;
    if (!selected) { saved = {}; draft = {}; auditRequest++; updateControls(); return; }
    const state = stateOf(selected);
    saved = Object.fromEntries(Core.keys.map(key => [key, state.pagine[key] === true])); draft = { ...saved }; version = Number(state.versione);
    $('permissionUser').value = selected.id;
    $('permissionUserName').textContent = label(selected);
    $('permissionUserState').textContent = selected.ruolo === 'admin'
      ? 'Amministratore: accesso completo a tutte le pagine.'
      : `${selected.attivo === false ? 'Account disabilitato' : 'Operatore attivo'} · versione ${version}`;
    $('permissionCopyUser').replaceChildren(new Option('Seleziona un operatore', ''));
    users.filter(user => user.id !== id && user.ruolo !== 'admin').forEach(user => $('permissionCopyUser').append(new Option(label(user), user.id)));
    updateControls(); audit(id);
  }
  async function loadUsers() {
    if (busy) return;
    if (different().length && !await MiroxUI.confirm('Ricaricare e scartare le modifiche non salvate?')) return;
    busy = true; updateControls(); status('Caricamento utenti...');
    try {
      const data = await request(); users = data.utenti;
      const prior = selected?.id || new URLSearchParams(window.location.search).get('utente_id');
      $('permissionUser').replaceChildren(new Option('Seleziona un utente', ''));
      users.forEach(user => $('permissionUser').append(new Option(`${label(user)}${user.ruolo === 'admin' ? ' (Admin)' : user.attivo === false ? ' (disabilitato)' : ''}`, user.id)));
      selectUser(users.some(user => user.id === prior) ? prior : ''); status(`${users.length} utenti disponibili`);
    } catch (error) { status(error.message, true); }
    finally { busy = false; updateControls(); }
  }
  $('permissionUser').addEventListener('change', async () => {
    if (busy) return;
    const id = $('permissionUser').value;
    busy = true; updateControls();
    try {
      if (different().length && !await MiroxUI.confirm('Scartare le modifiche non salvate e cambiare utente?')) {
        $('permissionUser').value = selected?.id || ''; return;
      }
      selectUser(id);
    } finally {
      busy = false; updateControls();
    }
  });
  $('permissionCopyUser').addEventListener('change', updateControls);
  $('copyPermissions').addEventListener('click', () => {
    const source = users.find(user => user.id === $('permissionCopyUser').value);
    if (!source || readonly() || busy) return;
    const state = stateOf(source); draft = Object.fromEntries(Core.keys.map(key => [key, state.pagine[key] === true])); updateControls();
    status(`Permessi copiati da ${label(source)}. Salva per applicarli.`);
  });
  $('resetPermissions').addEventListener('click', () => { draft = { ...saved }; updateControls(); });
  $('reloadPermissions').addEventListener('click', loadUsers);
  $('savePermissions').addEventListener('click', async () => {
    if (busy || readonly() || !different().length) return;
    const changes = different();
    const message = [`Salvare i permessi di ${label(selected)}?`, ...[true, false].map(enabled => {
      const names = Core.pages.filter(p => changes.includes(p.key) && draft[p.key] === enabled).map(p => p.label);
      return names.length ? `${enabled ? 'Abilita' : 'Disabilita'}: ${names.join(', ')}` : '';
    }).filter(Boolean)].join('\n\n');
    // Blocca selezione e interruttori anche durante la conferma asincrona.
    busy = true; updateControls();
    try {
      if (!await MiroxUI.confirm(message, { title: 'Salva permessi pagine' })) return;
      const data = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ utente_id: selected.id, versione: version, pagine: draft }) });
      selected.mirox_permessi_utente = data.permessi;
      selectUser(selected.id); status('Permessi salvati. Le nuove operazioni applicano subito le autorizzazioni aggiornate.');
    } catch (error) { status(error.message, true); }
    finally { busy = false; updateControls(); }
  });
  buildGroups(); await loadUsers();
})();
