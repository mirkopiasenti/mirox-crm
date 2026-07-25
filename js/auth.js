/**
 * MIROX Vendita - Autenticazione (Supabase + tabella `profili`)
 */
const Auth = {
  _profilo: null,

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
    const { data: { session } } = await db.auth.getSession();
    if (!session) return null;
    const profilo = await this.caricaProfilo(session.user.id);
    if (!profilo || !profilo.attivo) return null;
    this._profilo = profilo;
    return profilo;
  },

  async richiediAuth() {
    const profilo = await this.getSessione();
    if (!profilo) {
      window.location.href = this._indexPath();
      return null;
    }
    return profilo;
  },

  async riautentica(options = {}) {
    const { data: { session } } = await db.auth.getSession();
    const email = session?.user?.email;

    if (!session || !email) {
      if (window.MiroxUI) {
        await window.MiroxUI.alert('Sessione non disponibile. Accedi nuovamente.', {
          type: 'error',
          title: 'Autenticazione richiesta'
        });
      }
      return false;
    }

    if (!window.MiroxUI) {
      throw new Error('MiroxUI non disponibile per la riautenticazione');
    }

    const password = await window.MiroxUI.prompt({
      title: options.title || 'Conferma identità',
      label: options.label || `Inserisci la password del tuo account Mirox (${email})`,
      type: 'password',
      placeholder: 'Password account',
      okText: options.okText || 'Verifica'
    });

    if (password === null) return false;

    const { data, error } = await db.auth.signInWithPassword({ email, password });
    const sameUser = data?.user?.id === session.user.id;

    if (error || !sameUser) {
      await window.MiroxUI.alert('Password account non valida. Operazione annullata.', {
        type: 'error',
        title: 'Accesso negato'
      });
      return false;
    }

    return true;
  },

  async logout() {
    this._profilo = null;
    await db.auth.signOut();
    window.location.href = this._indexPath();
  },

  getProfilo() { return this._profilo; },
  getId() { return this._profilo?.id; },
  getNome() { return this._profilo?.nome; }
};
