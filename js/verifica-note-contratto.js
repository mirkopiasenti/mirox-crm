(function (root) {
  'use strict';
  const Core = root.MiroxContrattoNoteCore, drafts = new Map();
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  function mount(host, { contrattoId, loadAuthor, request, onBusy = () => {} }) {
    let disposed = false, saving = false, reading = false, ready = false, key, draft = null, cursor = null, rows = [];
    const esc = root.MiroxSafe.escapeHtml;
    host.innerHTML = `<h4>Note contratto</h4><p>Annotazioni interne con autore e data. Le note salvate restano nello storico.</p>
      <div data-note-list style="max-height:240px;overflow:auto;"></div>
      <button type="button" class="mx-btn mx-btn-secondary" data-note-more hidden>Carica altre note</button>
      <p><label for="vc_nota_${esc(contrattoId)}">Aggiungi nota</label></p>
      <textarea id="vc_nota_${esc(contrattoId)}" data-note-text class="mx-input" rows="3" maxlength="4000" disabled placeholder="Dettagli e attività relativi a questo contratto"></textarea>
      <p><button type="button" class="mx-btn mx-btn-primary" data-note-save disabled>Salva nota</button>
      <button type="button" class="mx-btn mx-btn-secondary" data-note-refresh>Ricarica note</button></p>
      <p data-note-status role="status" aria-live="polite"></p><p data-note-error role="alert"></p>`;
    const get = selector => host.querySelector(selector), input = get('[data-note-text]'), save = get('[data-note-save]');
    const list = get('[data-note-list]'), more = get('[data-note-more]'), refresh = get('[data-note-refresh]');
    const status = get('[data-note-status]'), error = get('[data-note-error]');
    function remember(value) {
      draft = value;
      if (!key) return;
      if (value) drafts.set(key, value); else drafts.delete(key);
      try { if (value) root.sessionStorage.setItem(key, JSON.stringify(value)); else root.sessionStorage.removeItem(key); } catch (_) { /* Bozza disponibile in memoria. */ }
    }
    function controls() {
      if (disposed) return;
      input.disabled = !key || saving || !!draft?.request_id;
      save.disabled = !ready || saving || reading;
      save.textContent = saving ? 'Salvataggio...' : draft?.request_id ? 'Riprova salvataggio' : 'Salva nota';
      more.disabled = refresh.disabled = saving || reading;
      more.hidden = !cursor;
    }
    function validateNote(note) {
      if (!note || !UUID.test(note.id || '') || note.contratto_id !== contrattoId || typeof note.testo !== 'string'
        || !note.testo.trim() || typeof note.autore_nome !== 'string' || !note.autore_nome.trim() || !Number.isFinite(Date.parse(note.created_at))) throw new Error('Risposta note non valida. Riprova.');
    }
    function render() {
      if (disposed) return;
      list.innerHTML = rows.length ? rows.map(n => `<article style="padding:10px 0;border-bottom:1px solid #E3E8EE;">
        <strong>${esc(n.autore_nome)}</strong> <time datetime="${esc(n.created_at)}">${esc(new Date(n.created_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' }))}</time>
        <div style="white-space:pre-wrap;overflow-wrap:anywhere;">${esc(n.testo)}</div></article>`).join('') : '<p>Nessuna nota registrata.</p>';
      controls();
    }
    async function load(reset) {
      if (disposed || reading || saving || !key) return;
      reading = true; error.textContent = ''; status.textContent = 'Caricamento note...'; controls();
      try {
        const result = await request({ action: 'get_note_contratto', contratto_id: contrattoId, ...(reset || !cursor ? {} : { cursor }) });
        if (disposed) return;
        if (!Array.isArray(result.note)) throw new Error('Risposta note non valida. Riprova.');
        result.note.forEach(validateNote);
        if (result.next_cursor != null && (!UUID.test(result.next_cursor.id || '') || !Number.isFinite(Date.parse(result.next_cursor.created_at)))) throw new Error('Risposta note non valida. Riprova.');
        rows = [...new Map([...(reset ? [] : rows), ...result.note].map(n => [n.id, n])).values()];
        cursor = result.next_cursor || null; ready = true;
        status.textContent = ''; render();
      } catch (e) { if (!disposed) { error.textContent = e.message || 'Impossibile caricare le note. Riprova.'; status.textContent = ''; } }
      finally { reading = false; controls(); }
    }
    input.addEventListener('input', () => {
      if (saving || draft?.request_id || !key) return;
      remember(input.value ? { testo: input.value } : null); if (ready) error.textContent = ''; status.textContent = input.value ? 'Bozza conservata. Premi Salva nota per registrarla.' : '';
    });
    more.addEventListener('click', () => load(false));
    refresh.addEventListener('click', () => load(true));
    save.addEventListener('click', async () => {
      if (disposed || saving || reading || !ready) return;
      let text;
      try { text = Core.normalize(input.value); } catch (e) { error.textContent = e.message; return; }
      saving = true; error.textContent = ''; status.textContent = 'Salvataggio nota...';
      try {
        if (!draft?.request_id) remember({ testo: text, request_id: root.crypto.randomUUID() });
        controls(); onBusy(true);
        const result = await request({ action: 'add_nota_contratto', contratto_id: contrattoId, ...draft });
        validateNote(result.nota);
        if (result.nota.id !== draft.request_id || result.nota.testo !== text) throw new Error('Esito del salvataggio non valido. Premi Riprova.');
        remember(null);
        if (!disposed) {
          rows = [result.nota, ...rows.filter(n => n.id !== result.nota.id)];
          input.value = ''; status.textContent = 'Nota salvata.'; render();
        }
      } catch (e) { if (!disposed) { error.textContent = e.message || 'Impossibile confermare il salvataggio. Premi Riprova.'; status.textContent = ''; } }
      finally { saving = false; onBusy(false); controls(); }
    });
    const initialized = (async () => {
      try {
        const author = await loadAuthor();
        if (disposed) return;
        if (!UUID.test(author?.id || '')) throw new Error('Autore non disponibile. Accedi nuovamente.');
        key = `mirox-note-contratto:${author.id}:${contrattoId}`;
        let saved = drafts.get(key);
        try { saved ||= JSON.parse(root.sessionStorage.getItem(key) || 'null'); } catch (_) { /* Storage non disponibile. */ }
        if (saved && typeof saved.testo === 'string' && (!saved.request_id || UUID.test(saved.request_id))) { draft = saved; input.value = saved.testo; }
        controls(); await load(true);
      } catch (e) { if (!disposed) error.textContent = e.message || 'Impossibile caricare le note.'; }
    })();
    return { ready: initialized, isSaving: () => saving, dispose() { disposed = true; } };
  }
  root.MiroxContrattoNoteUI = { mount };
})(window);
