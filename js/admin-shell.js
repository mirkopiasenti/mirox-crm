(function () {
  'use strict';

  const icons = {
    settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.2 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.4v-4h.09A1.7 1.7 0 0 0 4.2 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.6 4.2a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.4h4v.09A1.7 1.7 0 0 0 15 4.2a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.6a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.09v4h-.09a1.7 1.7 0 0 0-1.7 1Z"/></svg>',
    users: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>',
    package: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 8-9 5-9-5"/><path d="m3.3 7 8.7-5 8.7 5v10L12 22l-8.7-5Z"/><path d="M12 13v9"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0Z"/><path d="M7 6H4.5a2.5 2.5 0 0 0 0 5H8M17 6h2.5a2.5 2.5 0 0 1 0 5H16"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V9M10 19V5M16 19v-7M22 19V2"/><path d="M2 19h20"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/></svg>',
    menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8"/><path d="M5 10v11h14V10M9 21v-7h6v7"/></svg>'
  };

  const pages = {
    'admin.html': { title: 'Pannello Admin', key: 'home' },
    'admin-utenti.html': { title: 'Gestione Utenti', key: 'utenti' },
    'admin-call-center-config.html': { title: 'Configurazione Call Center', key: 'call-center' },
    'admin-vendita-config.html': { title: 'Catalogo Vendita', key: 'vendita' },
    'admin-gare.html': { title: 'Gare & Avanzamento', key: 'gare' }
  };

  const currentFile = window.location.pathname.split('/').pop() || 'admin.html';
  const currentPage = pages[currentFile] || pages['admin.html'];

  function navLink(href, key, label, icon) {
    const active = currentPage.key === key;
    return [
      '<a class="mx-admin-nav-link" href="', href, '"',
      active ? ' aria-current="page"' : '',
      '><span class="mx-admin-nav-icon">', icon, '</span>',
      '<span>', label, '</span></a>'
    ].join('');
  }

  function sidebarMarkup() {
    return [
      '<aside class="mx-admin-sidebar" id="mxAdminSidebar" aria-label="Navigazione amministrazione">',
        '<a class="mx-admin-brand" href="admin.html">',
          '<span class="mx-admin-brand-mark" aria-hidden="true"></span>',
          '<span class="mx-admin-brand-copy">',
            '<span class="mx-admin-brand-name">Mirox</span>',
            '<span class="mx-admin-brand-subtitle">Amministrazione</span>',
          '</span>',
        '</a>',
        '<nav class="mx-admin-nav">',
          '<div class="mx-admin-nav-label">Reparti</div>',
          '<section class="mx-admin-nav-group">',
            '<button class="mx-admin-group-toggle" type="button" data-admin-group="configurazioni" aria-expanded="true" aria-controls="mxAdminConfigNav">',
              '<span class="mx-admin-group-icon">', icons.settings, '</span>',
              '<span class="mx-admin-group-text">Configurazioni</span>',
              '<svg class="mx-admin-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg>',
            '</button>',
            '<div class="mx-admin-subnav is-open" id="mxAdminConfigNav" aria-hidden="false">',
              '<div class="mx-admin-subnav-inner"><div class="mx-admin-subnav-list">',
                navLink('admin-utenti.html', 'utenti', 'Gestione Utenti', icons.users),
                navLink('admin-call-center-config.html', 'call-center', 'Configurazione Call Center', icons.phone),
                navLink('admin-vendita-config.html', 'vendita', 'Catalogo Vendita', icons.package),
                navLink('admin-gare.html', 'gare', 'Gare & Avanzamento', icons.trophy),
              '</div></div>',
            '</div>',
          '</section>',
          '<section class="mx-admin-nav-group">',
            '<button class="mx-admin-group-toggle" type="button" data-admin-group="kpi" aria-expanded="false" aria-controls="mxAdminKpiNav">',
              '<span class="mx-admin-group-icon">', icons.chart, '</span>',
              '<span class="mx-admin-group-text">KPI</span>',
              '<span class="mx-admin-group-badge">Presto</span>',
              '<svg class="mx-admin-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="m7 4 6 6-6 6"/></svg>',
            '</button>',
            '<div class="mx-admin-subnav" id="mxAdminKpiNav" aria-hidden="true">',
              '<div class="mx-admin-subnav-inner">',
                '<div class="mx-admin-empty-group">Nessun modulo disponibile al momento.</div>',
              '</div>',
            '</div>',
          '</section>',
        '</nav>',
        '<footer class="mx-admin-sidebar-footer">',
          '<a class="mx-admin-sidebar-action" href="dashboard.html">', icons.dashboard, '<span>Torna alla dashboard</span></a>',
          '<div class="mx-admin-profile">',
            '<div class="mx-admin-avatar" id="mxAdminAvatar">A</div>',
            '<div class="mx-admin-profile-copy">',
              '<div class="mx-admin-profile-name" id="mxAdminProfileName">Amministratore</div>',
              '<div class="mx-admin-profile-role">Account Admin</div>',
            '</div>',
            '<button class="mx-admin-logout" id="mxAdminLogout" type="button" title="Esci" aria-label="Esci">', icons.logout, '</button>',
          '</div>',
        '</footer>',
      '</aside>',
      '<button class="mx-admin-backdrop" id="mxAdminBackdrop" type="button" aria-label="Chiudi menu"></button>',
      '<header class="mx-admin-mobilebar">',
        '<button id="mxAdminMenuButton" type="button" aria-label="Apri menu" aria-controls="mxAdminSidebar" aria-expanded="false">', icons.menu, '</button>',
        '<div class="mx-admin-mobile-title">', currentPage.title, '</div>',
        '<a href="admin.html" aria-label="Pannello Admin">', icons.home, '</a>',
      '</header>'
    ].join('');
  }

  function setProfile(profilo) {
    if (!profilo) return;
    const nome = profilo.nome || profilo.email || 'Amministratore';
    const nameNode = document.getElementById('mxAdminProfileName');
    const avatarNode = document.getElementById('mxAdminAvatar');
    if (nameNode) nameNode.textContent = nome;
    if (avatarNode) avatarNode.textContent = nome.trim().charAt(0).toUpperCase() || 'A';
  }

  function closeMenu() {
    document.body.classList.remove('mx-admin-menu-open');
    const button = document.getElementById('mxAdminMenuButton');
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function init() {
    document.body.classList.add('mx-admin-shell');
    document.body.insertAdjacentHTML('afterbegin', sidebarMarkup());

    if (currentPage.key === 'vendita') {
      const heading = document.querySelector('main.container > .header h1');
      if (heading) heading.textContent = 'Catalogo Vendita';
      document.title = 'Catalogo Vendita - Admin Mirox';
    }

    document.querySelectorAll('.mx-admin-group-toggle').forEach((button) => {
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') === 'true';
        const panel = document.getElementById(button.getAttribute('aria-controls'));
        button.setAttribute('aria-expanded', String(!expanded));
        if (panel) {
          panel.classList.toggle('is-open', !expanded);
          panel.setAttribute('aria-hidden', String(expanded));
        }
      });
    });

    document.getElementById('mxAdminMenuButton')?.addEventListener('click', () => {
      const opening = !document.body.classList.contains('mx-admin-menu-open');
      document.body.classList.toggle('mx-admin-menu-open', opening);
      document.getElementById('mxAdminMenuButton').setAttribute('aria-expanded', String(opening));
    });

    document.getElementById('mxAdminBackdrop')?.addEventListener('click', closeMenu);
    document.querySelectorAll('.mx-admin-nav-link').forEach((link) => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    document.getElementById('mxAdminLogout')?.addEventListener('click', () => {
      if (typeof Auth !== 'undefined' && typeof Auth.logout === 'function') Auth.logout();
    });

    let attempts = 0;
    const profileTimer = window.setInterval(() => {
      attempts += 1;
      const profilo = typeof Auth !== 'undefined' && typeof Auth.getProfilo === 'function'
        ? Auth.getProfilo()
        : null;
      if (profilo) {
        setProfile(profilo);
        window.clearInterval(profileTimer);
      } else if (attempts >= 40) {
        window.clearInterval(profileTimer);
      }
    }, 250);
  }

  window.MiroxAdminShell = { setProfile };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
