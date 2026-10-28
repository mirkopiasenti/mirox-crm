'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../js/mirox-permissions-core');
const { authorizePages, authorizeEndpoint } = require('../netlify/functions/_lib/page-permissions');
const { handle } = require('../netlify/functions/admin-permessi-pagine')._test;
const { Element, documentFixture } = require('./permissions-dom-helper');
const ROOT = path.resolve(__dirname, '..');
const ID = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const permissions = enabled => Object.fromEntries(Core.keys.map(key => [key, enabled.includes(key)]));
const operator = { id: ID(2), ruolo: 'operatore', attivo: true };
const auth = { ok: true, user: { id: ID(2) }, profilo: operator };
function clientFixture() {
  const state = { profile: { ...operator }, pages: permissions(['upload_contratti']), reads: [], fail: false, rpc: null };
  const client = {
    auth: { getUser: async () => ({ data: { user: auth.user }, error: null }) },
    from(table) {
      state.reads.push(table);
      const query = {
        select() { return this; }, eq() { return this; },
        async single() { return { data: { ...state.profile }, error: null }; },
        async maybeSingle() { return { data: state.pages === null ? null : { pagine: state.pages, versione: 1 }, error: state.fail ? { message: 'DB failure' } : null }; }
      };
      return query;
    },
    async rpc(name, args) { state.rpc = { name, args }; return state.rpcResult || { data: { pagine: args.p_pagine, versione: args.p_versione + 1 }, error: null }; }
  };
  return { client, state };
}

test('catalogo completo, nessun permesso implicito e ruolo Admin indipendente dal CC', () => {
  assert.equal(Core.pages.length, 19); assert.equal(new Set(Core.keys).size, 19);
  for (const page of Core.pages) {
    assert.ok(fs.existsSync(path.join(ROOT, page.path)));
    assert.equal(Core.pageForPath('/' + page.path + '?id=1#detail').key, page.key);
    assert.equal(Core.can(operator, {}, page.key), false);
    assert.equal(Core.can(operator, { [page.key]: true }, page.key), true);
    assert.equal(Core.can(operator, { [page.key]: 'true' }, page.key), false);
    assert.equal(Core.can({ ...operator, ruolo: 'admin' }, {}, page.key), true);
    assert.equal(Core.can({ ...operator, ruolo: 'admin', attivo: false }, {}, page.key), false);
  }
  assert.equal(Core.can(operator, { registra_chiamata: true }, 'upload_contratti'), false);
  for (const filename of fs.readdirSync(path.join(ROOT, 'moduli')).filter(name => name.endsWith('.html') && name !== 'segnala-problema.html')) {
    assert.ok(Core.pageForPath(`/moduli/${filename}`), `Modulo da censire: ${filename}`);
  }
  assert.equal(Core.pageForPath('/moduli/call-center/prenota.html'), undefined);
  assert.throws(() => Core.normalize({ ...permissions([]), ruolo: 'admin' }), /sconosciuta/);
  assert.throws(() => Core.normalize({ ...permissions([]), ticket: 'false' }), /booleani/);
  assert.throws(() => Core.normalize({}), /tutte/);
});

test('risorse condivise distinguono consultazione e scrittura operativa', () => {
  assert.ok(Core.tables.vendita_apri_chiudi.read.includes('storico_cliente'));
  assert.deepEqual(Core.tables.vendita_apri_chiudi.write, ['apri_chiudi']);
  assert.ok(Core.tables.post_vendita_controllo_fissi.read.includes('dashboard_pezzi'));
  assert.deepEqual(Core.tables.post_vendita_controllo_fissi.write, ['controllo_fissi']);
  assert.deepEqual(Core.buckets['segnalazioni-files'].write, ['segnalazioni']);
  for (const resource of [...Object.values(Core.tables), ...Object.values(Core.buckets)]) {
    for (const key of [...resource.read, ...resource.write]) assert.ok(Core.keys.includes(key));
  }
});

test('ogni function protetta dichiara un endpoint statico censito, senza fidarsi degli header client', () => {
  const directory = path.join(ROOT, 'netlify/functions');
  let count = 0;
  for (const filename of fs.readdirSync(directory).filter(name => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(directory, filename), 'utf8');
    const match = source.match(/endpoint: '([^']+)'/);
    if (!match) continue;
    count++;
    assert.equal(match[1] + '.js', filename);
    assert.notEqual(Core.endpointPages(match[1]), null);
    assert.doesNotMatch(source, /endpoint:\s*event\./);
  }
  assert.equal(count, 23);
  assert.deepEqual(Core.endpointPages('gestisci-vendita-contratto', { body: JSON.stringify({ action: 'check_codice' }) }), ['upload_contratti', ...Core.editors]);
  assert.deepEqual(Core.endpointPages('gestisci-vendita-contratto', { body: JSON.stringify({ action: 'update_pda' }) }), Core.editors);
  assert.deepEqual(Core.endpointPages('gestisci-operazioni-post-vendita', { body: JSON.stringify({ action: 'mark_apri_chiudi_ko' }) }), ['apri_chiudi']);
  assert.deepEqual(Core.endpointPages('mirox-send-email', { body: JSON.stringify({ template: 'ordine_smartphone_nuovo' }) }), ['ordini_smartphone']);
  assert.deepEqual(Core.endpointPages('mirox-send-email', { body: JSON.stringify({ template: 'inventato', related_table: 'segnalazioni' }) }), []);
});

test('API rilegge permessi, stato e ruolo: revoca con lo stesso JWT senza cache ACL', async () => {
  const { client, state } = clientFixture();
  const source = fs.readFileSync(path.join(ROOT, 'netlify/functions/_lib/require-auth.js'), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, process: { env: { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test' } }, require(name) {
    if (name === '@supabase/supabase-js') return { createClient: () => client };
    if (name === './page-permissions') return { authorizeEndpoint };
    throw new Error(name);
  } });
  const event = { headers: { authorization: 'Bearer stesso-jwt' } };
  const options = { endpoint: 'ocr-pda' };
  assert.equal((await module.exports.requireAuth(event, options)).ok, true);
  state.pages.upload_contratti = false;
  assert.equal((await module.exports.requireAuth(event, options)).status, 403);
  state.profile.ruolo = 'admin';
  assert.equal((await module.exports.requireAuth(event, options)).ok, true);
  state.profile.ruolo = 'operatore';
  assert.equal((await module.exports.requireAuth(event, options)).status, 403);
  state.profile.attivo = false;
  assert.equal((await module.exports.requireAuth(event, options)).status, 403);
  state.profile.attivo = true; state.pages = null;
  assert.equal((await authorizePages(client, auth, ['ticket'])).status, 403);
  state.fail = true;
  assert.equal((await authorizePages(client, auth, ['ticket'])).status, 503);
});

test('utente abilitato a Upload non acquisisce l editor post-vendita; endpoint sconosciuti falliscono', async () => {
  const { client } = clientFixture();
  assert.equal((await authorizeEndpoint(client, auth, { endpoint: 'gestisci-vendita-contratto' }, { body: '{"action":"check_codice"}' })).ok, true);
  assert.equal((await authorizeEndpoint(client, auth, { endpoint: 'gestisci-vendita-contratto' }, { body: '{"action":"update_pda"}' })).status, 403);
  await assert.rejects(authorizeEndpoint(client, auth, { endpoint: 'nuovo-non-censito' }, {}), /non censito/);
});

test('upload controlla il bucket effettivo dopo il multipart, prima di scrivere Storage', async () => {
  const { client } = clientFixture();
  let uploads = 0; client.storage = { from() { uploads++; throw new Error('Scrittura non autorizzata'); } };
  const source = fs.readFileSync(path.join(ROOT, 'netlify/functions/upload-documento-modulo.js'), 'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source, { Buffer, module, exports: module.exports, console, require(name) {
    if (name === './_lib/require-auth') return { requireAuth: async () => auth, getAdminClient: () => client };
    if (name === './_lib/page-permissions') return { authorizePages };
    if (name === '../../js/mirox-permissions-core') return Core;
    return require(name);
  } });
  const boundary = 'mirox-test-boundary';
  const body = `--${boundary}\r\nContent-Disposition: form-data; name="bucket"\r\n\r\nsegnalazioni-files\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.7 test\r\n--${boundary}--\r\n`;
  const result = await module.exports.handler({ httpMethod: 'POST', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, body });
  assert.equal(result.statusCode, 403); assert.equal(uploads, 0);
});

test('salvataggio admin usa autore verificato, versione ottimistica e input completo', async () => {
  const { client, state } = clientFixture(); state.profile = { id: ID(1), ruolo: 'admin', attivo: true };
  const adminAuth = { ok: true, user: { id: ID(1) }, profilo: state.profile };
  const deps = { requireAuth: async () => adminAuth, getAdminClient: () => client };
  const event = { httpMethod: 'POST', body: JSON.stringify({ utente_id: ID(2), versione: 1, pagine: permissions(['ticket']), autore_id: ID(99) }) };
  assert.equal((await handle(event, deps)).statusCode, 200);
  assert.equal(state.rpc.args.p_admin_id, ID(1)); assert.equal(state.rpc.args.p_versione, 1);
  state.rpcResult = { error: { code: '40001' } };
  assert.equal((await handle(event, deps)).statusCode, 409);
  state.rpc = null;
  assert.equal((await handle({ ...event, body: JSON.stringify({ utente_id: ID(2), versione: 1, pagine: {} }) }, deps)).statusCode, 400);
  assert.equal(state.rpc, null);
  state.profile.ruolo = 'operatore';
  assert.equal((await handle(event, deps)).statusCode, 403);
});

test('tutte le pagine protette caricano catalogo e guard UI prima di Auth', () => {
  for (const relative of ['dashboard.html', 'admin-permessi.html', ...Core.pages.map(p => p.path)]) {
    const html = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    assert.ok(html.indexOf('mirox-permissions-core.js') < html.indexOf('js/auth.js'), relative);
    assert.ok(html.indexOf('mirox-permissions-ui.js') < html.indexOf('js/auth.js'), relative);
    assert.match(html, /mirox-permissions\.css/);
    const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => path.resolve(path.dirname(path.join(ROOT, relative)), match[1]));
    const localScripts = scripts.filter(filename => fs.existsSync(filename)).map(filename => fs.readFileSync(filename, 'utf8')).join('\n');
    assert.match(html + localScripts, /Auth\.richiediAuth/);
  }
});

test('elenco Admin legge le colonne reali dei profili e pagina senza perdere utenti', async () => {
  const admin = { ok: true, user: { id: ID(1) }, profilo: { id: ID(1), ruolo: 'admin', attivo: true } };
  const columns = new Set(['id', 'username', 'nome', 'ruolo', 'attivo', 'mirox_permessi_utente']);
  const ranges = [];
  const client = { from(table) {
    assert.equal(table, 'profili');
    let selection = '';
    return {
      select(value) { selection = value; return this; }, order() { return this; }, eq() { return this; },
      single: async () => ({ data: admin.profilo, error: null }),
      range: async (start, end) => {
        ranges.push([start, end]);
        const requested = selection.replace(/mirox_permessi_utente\([^)]*\)/, 'mirox_permessi_utente').split(',');
        if (requested.some(column => !columns.has(column))) return { error: { code: '42703', message: 'Colonna non presente nello schema reale' } };
        return { data: Array.from({ length: start ? 1 : 500 }, (_, i) => ({ id: ID(start + i + 2), username: `operatore${start + i}`, nome: null, ruolo: 'operatore', attivo: true, mirox_permessi_utente: { pagine: permissions([]), versione: 1 } })), error: null };
      }
    };
  } };
  const result = await handle({ httpMethod: 'GET' }, { requireAuth: async () => admin, getAdminClient: () => client });
  assert.equal(result.statusCode, 200);
  const payload = JSON.parse(result.body);
  assert.equal(payload.utenti.length, 501);
  assert.equal(payload.utenti[500].username, 'operatore500');
  assert.deepEqual(ranges, [[0, 499], [500, 999]]);
});

test('Auth blocca URL diretto e errori ACL; ritorno scheda aggiorna le revoche e nascoste senza polling', async () => {
  const { client, state } = clientFixture();
  const callbacks = {}, calls = [], intervals = [];
  let now = 100000;
  client.auth.getSession = async () => ({ data: { session: { user: auth.user } } });
  const document = { visibilityState: 'visible', addEventListener: (name, fn) => { callbacks[name] = fn; } };
  const window = { location: { pathname: '/moduli/ticket.html' }, addEventListener: (name, fn) => { callbacks[name] = fn; }, setInterval: (fn, delay) => { intervals.push({ fn, delay }); },
    MiroxPermissionsUI: { apply(profile, pages) { calls.push(['apply', pages.ticket]); return Core.can(profile, pages, 'ticket'); }, block(message) { calls.push(['block', message]); } }, MiroxPermissions: Core };
  const context = { db: client, window, document, Date: { now: () => now } };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/auth.js'), 'utf8') + '\nglobalThis.testAuth=Auth;', context);
  assert.equal(await context.testAuth.richiediAuth(), null); assert.equal(calls[0][1], false);
  assert.equal(intervals[0].delay, 60000);
  state.pages.ticket = true; now += 60000;
  await callbacks.visibilitychange(); assert.equal(calls.at(-1)[1], true);
  const reads = state.reads.length;
  document.visibilityState = 'hidden'; now += 60000; await intervals[0].fn();
  assert.equal(state.reads.length, reads);
  document.visibilityState = 'visible'; state.pages.ticket = false; await callbacks.pageshow();
  assert.equal(calls.at(-1)[1], false);
  state.fail = true; now += 60000; await intervals[0].fn(); assert.equal(calls.at(-1)[0], 'block');
  const failedReads = state.reads.length; now += 1000; await callbacks.visibilitychange(); assert.equal(state.reads.length, failedReads);
});

test('migration limita policy alle risorse vendita/Storage, conserva viste e RPC CC', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'database/20261027221833_permessi_pagine_mirox.sql'), 'utf8');
  for (const shared of ['profili', 'anagrafica', 'chiamate', 'appuntamenti', 'blacklist', 'impostazioni', 'orari_standard', 'blocchi', 'slot_bloccati']) {
    assert.doesNotMatch(sql, new RegExp(`(?:ALTER TABLE|CREATE POLICY[^;]+ON|CREATE TRIGGER[^;]+ON) public\\.${shared}\\b`, 'i'));
  }
  assert.doesNotMatch(sql, /DROP POLICY|DROP TABLE|DROP COLUMN/);
  assert.match(sql, /FOR UPDATE/); assert.match(sql, /versione<>p_versione/);
  assert.match(sql, /mirox_private\.storico_cliente_dati/);
  for (const table of Object.keys(Core.tables)) assert.match(sql, new RegExp(`ON public\\.${table} AS RESTRICTIVE FOR SELECT`));
});

test('menu reale: nasconde card, reparti vuoti e Applicazioni; cambia tab e ripristina i permessi', () => {
  const document = documentFixture();
  const content = new Element(); content.className = 'content'; document.body.append(content);
  const tabButtons = [], panels = [];
  function link(path, className, parent) {
    const node = new Element('a'); node.href = path; node.className = className; parent.append(node); return node;
  }
  for (const name of ['vendita', 'post-vendita']) {
    const button = new Element('button'); button.className = `tab-btn${name === 'vendita' ? ' active' : ''}`; button.dataset.tab = name;
    const panel = new Element(); panel.id = `panel-${name}`; panel.className = `tab-panel${name === 'vendita' ? ' active' : ''}`;
    document.body.append(button); content.append(panel); tabButtons.push(button); panels.push(panel);
    button.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.toggle('active', b === button)); panels.forEach(p => p.classList.toggle('active', p === panel));
    });
  }
  const upload = link('moduli/upload-contratti-vendita.html', 'card', panels[0]);
  const customers = link('moduli/anagrafiche.html', 'card', panels[1]);
  const ticket = link('moduli/ticket.html', 'action-square', document.body);
  const guardian = link('moduli/segnala-problema.html', 'action-square', document.body);
  const drawer = new Element(); drawer.id = 'applicationsDrawer'; drawer.className = 'is-open'; document.body.append(drawer);
  const appButton = new Element('button'); appButton.id = 'btnApplicazioni'; document.body.append(appButton);
  const subentri = link('moduli/compilatore_subentri.html', 'application-action', drawer);
  const window = { location: new URL('https://crm.example/dashboard.html'), MiroxPermissions: Core };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/mirox-permissions-ui.js'), 'utf8'), {
    window, document, URL, queueMicrotask, MutationObserver: class { observe() {} }
  });
  window.MiroxPermissionsUI.apply(operator, permissions(['anagrafiche']));
  assert.equal(upload.classList.contains('mx-permission-hidden'), true);
  assert.equal(customers.classList.contains('mx-permission-hidden'), false);
  assert.equal(ticket.classList.contains('mx-permission-hidden'), true);
  assert.equal(guardian.classList.contains('mx-permission-hidden'), false);
  assert.equal(tabButtons[0].classList.contains('mx-permission-hidden'), true);
  assert.equal(tabButtons[1].classList.contains('active'), true);
  assert.equal(appButton.classList.contains('mx-permission-hidden'), true); assert.equal(drawer.inert, true);
  window.MiroxPermissionsUI.apply(operator, permissions([]));
  assert.equal(document.getElementById('mxPermissionsEmpty').hidden, false);
  window.MiroxPermissionsUI.apply(operator, permissions(['upload_contratti', 'compilatore_subentri']));
  assert.equal(upload.classList.contains('mx-permission-hidden'), false);
  assert.equal(customers.classList.contains('mx-permission-hidden'), true);
  assert.equal(subentri.classList.contains('mx-permission-hidden'), false);
  assert.equal(appButton.classList.contains('mx-permission-hidden'), false);
  assert.equal(tabButtons[0].classList.contains('active'), true);
  assert.equal(document.getElementById('mxPermissionsEmpty').hidden, true);
  assert.equal(document.documentElement.classList.contains('mx-permissions-pending'), false);
});

test('guard UI reale: URL diretto negato e blocco immediato alla revoca della pagina aperta', () => {
  const document = documentFixture();
  let reloads = 0;
  const location = new URL('https://crm.example/moduli/ticket.html'); location.reload = () => { reloads++; };
  const window = { location, MiroxPermissions: Core };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/mirox-permissions-ui.js'), 'utf8'), { window, document, URL });
  assert.equal(document.documentElement.classList.contains('mx-permissions-pending'), true);
  assert.equal(window.MiroxPermissionsUI.apply(operator, permissions(['ticket'])), true);
  assert.equal(document.documentElement.classList.contains('mx-permissions-pending'), false);
  assert.equal(window.MiroxPermissionsUI.apply(operator, permissions([])), false);
  assert.equal(document.documentElement.classList.contains('mx-permissions-blocked'), true);
  const panel = document.getElementById('mxPermissionsBlock');
  assert.match(panel.textContent, /Non sei abilitato/);
  assert.equal(panel.querySelector('a').href, 'https://crm.example/dashboard.html');
  window.MiroxPermissionsUI.apply(operator, permissions(['ticket'])); assert.equal(reloads, 1);
  assert.equal(window.MiroxPermissionsUI.allowedPath('/moduli/nuovo-non-censito.html'), false);
});

test('UI Admin: bozza, annulla cambio utente, copia, conferma, salvataggio e conflitto preservano le scelte', async () => {
  const document = documentFixture(['reloadPermissions', 'permissionsStatus', 'permissionUser', 'permissionCopyUser', 'copyPermissions', 'permissionEditor', 'permissionUserName', 'permissionUserState', 'permissionsCount', 'permissionGroups', 'permissionChanges', 'resetPermissions', 'savePermissions', 'permissionAudit']);
  const $ = id => document.getElementById(id);
  const users = [
    { id: ID(1), nome: 'Admin', ruolo: 'admin', attivo: true, mirox_permessi_utente: { pagine: permissions([]), versione: 1 } },
    { ...operator, nome: '<Operatore A>', mirox_permessi_utente: { pagine: permissions([]), versione: 1 } },
    { ...operator, id: ID(3), nome: 'Operatore B', mirox_permessi_utente: { pagine: permissions(['ticket']), versione: 2 } }
  ];
  let confirm = false, posted = null, conflict = false;
  const window = { MiroxPermissions: Core, location: new URL('https://crm.example/admin-permessi.html') };
  const promise = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/admin-permessi.js'), 'utf8'), {
    window, document, URLSearchParams,
    Auth: { richiediAuth: async () => users[0] },
    Option: class extends Element { constructor(text, value) { super('option'); this.textContent = text; this.value = value; } },
    MiroxUI: { confirm: async () => confirm },
    MiroxApi: { fetch: async (url, options) => {
      if (options?.method === 'POST') {
        posted = JSON.parse(options.body);
        return { ok: !conflict, status: conflict ? 409 : 200, json: async () => conflict ? { error: 'Ricarica prima di salvare' } : { permessi: { pagine: posted.pagine, versione: posted.versione + 1 } } };
      }
      return { ok: true, json: async () => url.includes('?') ? { audit: [] } : { utenti: users } };
    } }
  });
  await promise;
  $('permissionUser').value = ID(2); await $('permissionUser').emit('change');
  assert.equal($('permissionUserName').textContent, '<Operatore A>'); // Testo, mai markup.
  const toggle = key => document.querySelector(`[data-permission="${key}"]`);
  toggle('upload_contratti').checked = true; await toggle('upload_contratti').emit('change');
  assert.equal($('savePermissions').disabled, false);
  $('permissionUser').value = ID(3); await $('permissionUser').emit('change');
  assert.equal($('permissionUser').value, ID(2)); assert.equal(toggle('upload_contratti').checked, true);
  $('permissionCopyUser').value = ID(3); await $('permissionCopyUser').emit('change'); await $('copyPermissions').click();
  assert.equal(toggle('ticket').checked, true); assert.equal(toggle('upload_contratti').checked, false);
  await $('savePermissions').click(); assert.equal(posted, null); // Conferma annullata.
  confirm = true; await $('savePermissions').click();
  assert.equal(posted.utente_id, ID(2)); assert.equal(posted.versione, 1);
  assert.equal(posted.pagine.ticket, true); assert.equal(Object.keys(posted.pagine).length, 19);
  assert.equal($('savePermissions').disabled, true);
  toggle('upload_contratti').checked = true; await toggle('upload_contratti').emit('change'); conflict = true;
  await $('savePermissions').click();
  assert.equal(posted.versione, 2); assert.equal(toggle('upload_contratti').checked, true);
  assert.equal($('savePermissions').disabled, false); assert.match($('permissionsStatus').textContent, /Ricarica/);
  await $('resetPermissions').click(); assert.equal(toggle('upload_contratti').checked, false);
  $('permissionUser').value = ID(1); await $('permissionUser').emit('change');
  assert.equal(toggle('ticket').checked, true); assert.equal(toggle('ticket').disabled, true);
  assert.equal($('savePermissions').disabled, true);
});
