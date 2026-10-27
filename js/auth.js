/**
 * MIROX Vendita - Autenticazione (Supabase + tabella `profili`)
 */
const Auth = {
  _profilo: null,
  _permessi: {},
  _inFlight: null,
  _watching: false,
  _lastCheck: 0,

  _indexPath() {
    // Risolve correttamente il path verso index.html sia dalla root
    // che dalla cartella /moduli/ (e qualsiasi sotto-cartella di primo livello).
    return window.location.pathname.includes('/moduli/') ? '../index.html' : 'index.html';
  },

  async caricaProfilo(userId) {
    const { data, error } = await db.from('profili').select('*').eq('id', userId).single();
    if (error || !data) return null;
    return data;
  },

  async getSessione() {
    if (this._profilo) return this._profilo;
    if (this._inFlight) return this._inFlight;
    this._inFlight = this._loadSession().finally(() => { this._inFlight = null; });
    return this._inFlight;
  },

  async _loadSession() {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return null;
    const profilo = await this.caricaProfilo(session.user.id);
    if (!profilo || !profilo.attivo) return null;
    const { data, error } = await db.from('mirox_permessi_utente')
      .select('pagine,versione').eq('utente_id', session.user.id).maybeSingle();
    if (error) throw new Error('Impossibile verificare i permessi. Riprova.');
    this._permessi = data?.pagine || {};
    this._profilo = profilo;
    this._lastCheck = Date.now();
    return profilo;
  },

  async richiediAuth() {
    let profilo;
    try { profilo = await this.getSessione(); }
    catch (_) {
      window.MiroxPermissionsUI?.block('Impossibile verificare i permessi. Riprova prima di utilizzare il CRM.', true);
      return null;
    }
    if (!profilo) {
      window.location.href = this._indexPath();
      return null;
    }
    this._watchPermissions();
    if (!window.MiroxPermissionsUI || !window.MiroxPermissionsUI.apply(profilo, this._permessi)) return null;
    return profilo;
  },

  _watchPermissions() {
    if (this._watching) return;
    this._watching = true;
    const refresh = async () => {
      if (document.visibilityState === 'hidden' || this._inFlight || Date.now() - this._lastCheck < 10000) return;
      this._lastCheck = Date.now();
      this._inFlight = this._loadSession().finally(() => { this._inFlight = null; });
      try {
        const profile = await this._inFlight;
        if (!profile) { window.location.href = this._indexPath(); return; }
        window.MiroxPermissionsUI.apply(profile, this._permessi);
      } catch (_) { window.MiroxPermissionsUI.block('Impossibile verificare i permessi. Riprova.', true); }
    };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('pageshow', refresh);
    window.setInterval(refresh, 60000);
  },

  async logout() {
    this._profilo = null;
    this._permessi = {};
    await db.auth.signOut();
    window.location.href = this._indexPath();
  },

  getProfilo() { return this._profilo; },
  getId() { return this._profilo?.id; },
  getNome() { return this._profilo?.nome; },
  puoAccedere(key) { return window.MiroxPermissions?.can(this._profilo, this._permessi, key) === true; }
};
