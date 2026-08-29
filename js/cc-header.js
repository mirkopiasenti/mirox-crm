/**
 * MIROX Vendita - Call Center integrato: header armonizzato con dashboard.
 *
 * Sostituisce la sidebar laterale CC con:
 *   - Topbar (logo + nome utente + bottone "Torna alla dashboard" + logout)
 *   - Barra tab orizzontale con tutte le pagine CC accessibili all'utente
 *
 * Uso nelle pagine /moduli/call-center/*.html:
 *   <div id="ccHeader"></div>
 *   <main class="cc-main"> ... </main>
 *
 *   <script src="../../js/cc-header.js"></script>
 *   <script>
 *     // dopo aver caricato profilo (Auth._profilo)
 *     CcHeader.render('registra_chiamata'); // chiave pagina corrente
 *   </script>
 */
(function (root) {
  'use strict';

  const ROUTE_URL = '/.netlify/functions/kona-call-director-route';

  // Ordine pagine CC + metadata. Le chiavi sono identiche a profili.pagine_accessibili
  // per coerenza col CC prod (regola NON negoziabile, vedi CLAUDE.md).
  const CC_PAGES = [
    { perm: 'registra_chiamata',         label: 'Registra Chiamata',  href: 'registra-chiamata.html' },
    { perm: 'elenco_chiamate',           label: 'Elenco Chiamate',    href: 'elenco-chiamate.html' },
    { perm: 'rilavorazione',             label: 'Rilavorazione',      href: 'rilavorazione.html' },
    { perm: 'call_center_lead_outbound', label: 'Lead Outbound',      href: 'call-center-lead-outbound.html' },
    { perm: 'appuntamenti',              label: 'Appuntamenti',       href: 'appuntamenti.html' },
    { perm: 'prenota_interno',           label: 'Nuovo Appuntamento', href: 'prenota-interno.html' },
    { perm: 'appuntamenti_oggi',         label: 'Appuntamenti Oggi',  href: 'appuntamenti-oggi.html' },
    { perm: 'esiti_appuntamenti',        label: 'Esiti Appuntamenti', href: 'esiti-appuntamenti.html' },
    { perm: 'blacklist',                 label: 'Black List',         href: 'blacklist.html' },
    // KONA Call Director: visibile SOLO agli admin. Un'operatrice KONA
    // abilitata usa KONA come unica interfaccia (nessuna tab), i profili
    // manuali non devono vedere KONA.
    { perm: 'kona_call_director',        label: 'KONA CD',            href: 'kona-call-director.html', adminOnly: true }
  ];

  function escapeHtml(str) {
    return window.MiroxSafe ? window.MiroxSafe.escapeHtml(str) : '';
  }

  function getProfilo(profiloExplicit) {
    // 1) Profilo passato esplicitamente (modo piu' robusto)
    if (profiloExplicit && typeof profiloExplicit === 'object') return profiloExplicit;
    // 2) Auth globale (var Auth o const Auth in script normali) - non e' su window.
    //    typeof check evita ReferenceError se Auth non esiste in scope.
    try {
      if (typeof Auth !== 'undefined' && Auth) {
        if (typeof Auth.getProfilo === 'function') {
          const p = Auth.getProfilo();
          if (p) return p;
        }
        if (Auth._profilo) return Auth._profilo;
      }
    } catch (_) { /* Auth non in scope */ }
    // 3) Fallback su window.Auth (Mirox shared)
    if (root.Auth && typeof root.Auth.getProfilo === 'function') {
      const p = root.Auth.getProfilo();
      if (p) return p;
    }
    if (root.Auth && root.Auth._profilo) return root.Auth._profilo;
    return null;
  }

  function logoutSafe() {
    // Auth globale di scope (CC e Mirox lo dichiarano con const)
    try {
      if (typeof Auth !== 'undefined' && Auth && typeof Auth.logout === 'function') {
        Auth.logout();
        return;
      }
    } catch (_) { /* Auth non in scope */ }
    if (root.Auth && typeof root.Auth.logout === 'function') {
      root.Auth.logout();
      return;
    }
    // Fallback diretto via db globale (analogo: const db)
    try {
      if (typeof db !== 'undefined' && db && db.auth && typeof db.auth.signOut === 'function') {
        db.auth.signOut().finally(() => {
          root.location.href = '../../index.html';
        });
        return;
      }
    } catch (_) { /* db non in scope */ }
    if (root.db && root.db.auth && typeof root.db.auth.signOut === 'function') {
      root.db.auth.signOut().finally(() => {
        root.location.href = '../../index.html';
      });
      return;
    }
    root.location.href = '../../index.html';
  }

  function currentPage() {
    const path = (root.location.pathname || '').split('/').pop() || '';
    return path || 'registra-chiamata.html';
  }

  // Decide l'interfaccia server-side: kona_only (abilitata non-admin) oppure
  // admin/manuale. Il token arriva dalla sessione (client CC locale); l'endpoint
  // verifica ruolo e abilitazione sul server (mai solo cosmetico).
  async function fetchRoute() {
    const fallback = { resolved: false, kona_only: false, admin: false, abilitato: false, manual_fallback: false };
    if (!root.MiroxApi || typeof root.MiroxApi.fetch !== 'function') return fallback;
    try {
      const res = await root.MiroxApi.fetch(ROUTE_URL, { method: 'GET' });
      if (!res.ok) return fallback;
      const data = await res.json().catch(() => ({}));
      return {
        resolved: true,
        kona_only: Boolean(data.kona_only),
        admin: Boolean(data.admin),
        abilitato: Boolean(data.abilitato),
        manual_fallback: Boolean(data.manual_fallback)
      };
    } catch (_) {
      return fallback;
    }
  }

  function renderMinimal(container, profilo) {
    const nome = profilo.nome || profilo.username || profilo.email || 'Operatore';
    const inizialeNome = String(nome).trim().charAt(0).toUpperCase();
    container.innerHTML = `
      <div class="cc-topbar">
        <div class="cc-topbar-left">
          <a href="../../dashboard.html" class="cc-back-button" id="ccBackToDashboard" title="Torna alla dashboard Mirox">Dashboard</a>
        </div>
        <div class="cc-topbar-center">
          <div class="cc-topbar-logo"><img src="../../assets/logo.png" alt="Mirox"></div>
        </div>
        <div class="cc-topbar-right">
          <div class="cc-user-chip">
            <div class="cc-user-avatar">${escapeHtml(inizialeNome)}</div>
            <div class="cc-user-name">${escapeHtml(nome)}</div>
          </div>
          <button class="cc-btn-logout" id="ccLogoutBtn" type="button">Esci</button>
        </div>
      </div>
    `;
    const btnLogout = document.getElementById('ccLogoutBtn');
    if (btnLogout) btnLogout.addEventListener('click', logoutSafe);
  }

  function renderFull(container, profilo, isAdmin, paginaCorrente) {
    const perms = profilo.pagine_accessibili || {};
    const nome = profilo.nome || profilo.username || profilo.email || 'Operatore';
    const inizialeNome = String(nome).trim().charAt(0).toUpperCase();

    const tabsAccessibili = CC_PAGES.filter((p) => {
      if (isAdmin) return true;
      if (p.adminOnly) return false;
      if (perms[p.perm] === true) return true;
      return perms[p.perm] === undefined && p.fallbackPerm && perms[p.fallbackPerm] === true;
    });

    const tabsHtml = tabsAccessibili.map((p) => {
      const isActive = p.perm === paginaCorrente;
      return `<a class="cc-tab${isActive ? ' active' : ''}" data-perm="${p.perm}" href="${p.href}">`
        + `<span class="cc-tab-label">${escapeHtml(p.label)}</span>`
        + `<span class="cc-tab-badge hidden" data-badge-for="${p.perm}"></span>`
        + `</a>`;
    }).join('');

    container.innerHTML = `
      <div class="cc-topbar">
        <div class="cc-topbar-left">
          <a href="../../dashboard.html" class="cc-back-button" id="ccBackToDashboard" title="Torna alla dashboard Mirox">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="19" y1="12" x2="5" y2="12"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Dashboard
          </a>
        </div>
        <div class="cc-topbar-center">
          <div class="cc-topbar-logo"><img src="../../assets/logo.png" alt="Mirox"></div>
        </div>
        <div class="cc-topbar-right">
          ${isAdmin ? '<a class="cc-back-button" href="../../admin-kona-call-director.html" title="Gestisci attivazione e profili KONA">Gestisci KONA</a>' : ''}
          <div class="cc-user-chip">
            <div class="cc-user-avatar">${escapeHtml(inizialeNome)}</div>
            <div class="cc-user-name">${escapeHtml(nome)}</div>
          </div>
          <button class="cc-btn-logout" id="ccLogoutBtn" type="button">Esci</button>
        </div>
      </div>
      <nav class="cc-tabs" aria-label="Sezioni Call Center">
        ${tabsHtml}
      </nav>
    `;

    const btnLogout = document.getElementById('ccLogoutBtn');
    if (btnLogout) btnLogout.addEventListener('click', logoutSafe);
  }

  function bloccaInterfacciaNonVerificata(container, profilo) {
    renderMinimal(container, profilo);
    document.querySelectorAll('.cc-main').forEach((main) => {
      main.hidden = true;
    });
    const avviso = document.createElement('div');
    avviso.className = 'cc-routing-unavailable';
    avviso.setAttribute('role', 'alert');
    avviso.style.cssText = 'max-width:760px;margin:32px auto;padding:22px;border:1px solid #d7dee8;border-radius:16px;background:#fff;color:#243247;text-align:center;box-shadow:0 12px 30px rgba(18,38,63,.08)';
    avviso.textContent = 'Impossibile verificare l’interfaccia assegnata. Ricarica la pagina tra qualche istante.';
    container.appendChild(avviso);
  }

  async function render(paginaCorrente, profiloExplicit) {
    const container = document.getElementById('ccHeader');
    if (!container) {
      console.warn('CcHeader.render: #ccHeader non trovato nel DOM');
      return;
    }

    const profilo = getProfilo(profiloExplicit);
    if (!profilo) {
      console.warn('CcHeader.render: profilo non disponibile - chiamare CcHeader.render(perm, profilo) o settare Auth._profilo prima');
      return;
    }

    const isAdmin = profilo.ruolo === 'admin';
    const route = await fetchRoute();

    // Per i non-admin il routing server-side e' obbligatorio. Se non e'
    // verificabile, non mostrare in modo implicito le pagine manuali: un
    // errore di rete non deve diventare un bypass dell'interfaccia KONA-only.
    if (!isAdmin && !route.resolved) {
      bloccaInterfacciaNonVerificata(container, profilo);
      return;
    }

    // Operatrice KONA abilitata (non admin): unica interfaccia KONA, nessuna
    // navigazione manuale. Se apre una pagina manuale, reindirizza a KONA.
    if (route.kona_only) {
      if (currentPage() !== 'kona-call-director.html') {
        root.location.href = 'kona-call-director.html';
        return;
      }
      renderMinimal(container, profilo);
      return;
    }

    renderFull(container, profilo, isAdmin, paginaCorrente);
  }

  root.CcHeader = {
    render: render,
    PAGES: CC_PAGES
  };
})(window);
