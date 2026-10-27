(function (root) {
  'use strict';
  const Core = root.MiroxPermissions;
  const currentPath = root.location.pathname;
  const rootUrl = new URL(currentPath.includes('/moduli/') ? '../' : './', root.location.href);
  const modulePath = pathname => /^\/moduli\/[^/]+\.html$/.test(pathname) && pathname !== '/moduli/segnala-problema.html';
  const managed = modulePath(currentPath) || /\/(?:dashboard|admin[^/]*)\.html$/.test(currentPath);
  if (managed) document.documentElement.classList.add('mx-permissions-pending');
  let profile = null, permissions = {}, queued = false, observer = null;

  function allowedPath(pathname) {
    if (/\/admin[^/]*\.html$/.test(pathname)) return profile?.ruolo === 'admin' && profile.attivo !== false;
    const page = Core.pageForPath(pathname);
    if (page) return Core.can(profile, permissions, page.key);
    // Un nuovo modulo deve entrare nel catalogo prima di diventare accessibile.
    return !modulePath(pathname);
  }
  function block(message, retry = false) {
    document.documentElement.classList.remove('mx-permissions-pending');
    document.documentElement.classList.add('mx-permissions-blocked');
    let panel = document.getElementById('mxPermissionsBlock');
    if (!panel) {
      panel = document.createElement('main'); panel.id = 'mxPermissionsBlock'; panel.setAttribute('role', 'alert');
      const title = document.createElement('h1'); title.textContent = 'Accesso al CRM'; panel.append(title);
      const text = document.createElement('p'); panel.append(text);
      const link = document.createElement('a'); link.href = new URL('dashboard.html', rootUrl).href;
      link.textContent = 'Torna alla dashboard'; panel.append(link);
      const refresh = document.createElement('a'); refresh.href = root.location.href; refresh.textContent = 'Riprova'; refresh.dataset.retry = 'true'; panel.append(refresh);
      document.body.append(panel);
    }
    panel.querySelector('p').textContent = message;
    panel.querySelector('[data-retry]').hidden = !retry;
  }
  function filterNavigation() {
    if (!profile) return;
    for (const link of document.querySelectorAll('a[href]')) {
      let url;
      try { url = new URL(link.getAttribute('href'), root.location.href); } catch (_) { continue; }
      if (url.origin !== root.location.origin) continue;
      link.classList.toggle('mx-permission-hidden', !allowedPath(url.pathname));
    }
    for (const name of ['vendita', 'post-vendita']) {
      const panel = document.getElementById(`panel-${name}`);
      const button = document.querySelector(`.tab-btn[data-tab="${name}"]`);
      if (!panel || !button) continue;
      const visible = [...panel.querySelectorAll('a.card')].some(link => !link.classList.contains('mx-permission-hidden'));
      button.classList.toggle('mx-permission-hidden', !visible);
      panel.classList.toggle('mx-permission-hidden', !visible);
      if (!visible) { button.classList.remove('active'); panel.classList.remove('active'); }
    }
    const firstTab = document.querySelector('.tab-btn:not(.mx-permission-hidden)');
    if (!document.querySelector('.tab-btn.active:not(.mx-permission-hidden)') && firstTab) firstTab.click();
    const drawer = document.getElementById('applicationsDrawer');
    const appButton = document.getElementById('btnApplicazioni');
    if (drawer && appButton) {
      const visible = [...drawer.querySelectorAll('a.application-action')].some(link => !link.classList.contains('mx-permission-hidden'));
      appButton.classList.toggle('mx-permission-hidden', !visible);
      if (!visible) {
        drawer.classList.remove('is-open'); drawer.inert = true; drawer.setAttribute('aria-hidden', 'true');
        appButton.setAttribute('aria-expanded', 'false');
      }
    }
    const content = document.querySelector('.content');
    if (content && /\/dashboard\.html$/.test(currentPath)) {
      const empty = !Core.pages.some(p => Core.can(profile, permissions, p.key));
      let notice = document.getElementById('mxPermissionsEmpty');
      if (empty && !notice) {
        notice = document.createElement('p'); notice.id = 'mxPermissionsEmpty'; notice.className = 'mx-permissions-empty';
        notice.textContent = 'Nessuna pagina Vendita, Post-Vendita o Applicazioni abilitata. Contatta un amministratore.';
        content.append(notice);
      }
      if (notice) notice.hidden = !empty;
    }
  }
  function apply(nextProfile, nextPermissions) {
    profile = nextProfile; permissions = nextPermissions || {};
    if (managed && !allowedPath(currentPath)) {
      block('Non sei abilitato a visualizzare questa pagina. Contatta un amministratore.');
      return false;
    }
    const wasBlocked = document.documentElement.classList.contains('mx-permissions-blocked');
    if (wasBlocked) { root.location.reload(); return false; }
    filterNavigation();
    document.documentElement.classList.remove('mx-permissions-pending');
    if (!observer && /\/dashboard\.html$/.test(currentPath)) {
      observer = new MutationObserver(() => {
        if (queued) return;
        queued = true; queueMicrotask(() => { queued = false; filterNavigation(); });
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return true;
  }
  root.MiroxPermissionsUI = { apply, block, allowedPath, filterNavigation };
})(window);
