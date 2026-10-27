/* Catalogo condiviso delle pagine Mirox. Le chiavi CC rimangono indipendenti. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxPermissions = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const pages = [
    ['upload_contratti', 'Upload Contratti', 'Vendita', 'upload-contratti-vendita.html'],
    ['apri_chiudi', 'Apri / Chiudi', 'Vendita', 'apri_chiudi.html'],
    ['switch_sim', 'Switch SIM', 'Vendita', 'switch_sim.html'],
    ['ordini_smartphone', 'Ordini Smartphone', 'Vendita', 'ordini_smartphone.html'],
    ['simulatore_protecta', 'Simulatore Protecta', 'Vendita', 'simulatore_protecta.html'],
    ['dashboard_pezzi', 'Dashboard Pezzi', 'Vendita', 'dashboard_pezzi.html'],
    ['anagrafiche', 'Anagrafiche', 'Post-Vendita', 'anagrafiche.html'],
    ['storico_cliente', 'Storico Cliente', 'Post-Vendita', 'storico_cliente.html'],
    ['dispositivi_comodato', 'Dispositivi Comodato', 'Post-Vendita', 'dispositivi_comodato.html'],
    ['gestione_rimborsi', 'Gestione Rimborsi', 'Post-Vendita', 'gestione_rimborsi.html'],
    ['segnalazioni', 'Segnalazioni', 'Post-Vendita', 'segnalazioni.html'],
    ['verifica_contratti', 'Verifica Contratti', 'Post-Vendita', 'verifica_contratti.html'],
    ['controllo_fissi', 'Controllo Fissi', 'Post-Vendita', 'controllo_fissi.html'],
    ['controllo_lg', 'Controllo L&G', 'Post-Vendita', 'controllo_lg.html'],
    ['controllo_assicurazioni', 'Controllo Assicurazioni', 'Post-Vendita', 'controllo_assicurazioni.html'],
    ['controllo_allarmi', 'Controllo Allarmi', 'Post-Vendita', 'controllo_allarmi.html'],
    ['ticket', 'Ticket', 'Post-Vendita', 'ticket.html'],
    ['compilatore_disdette', 'Compilatore disdette', 'Applicazioni', 'compilatore_disdette.html'],
    ['compilatore_subentri', 'Compilatore Subentri', 'Applicazioni', 'compilatore_subentri.html']
  ].map(([key, label, group, file]) => Object.freeze({ key, label, group, path: `moduli/${file}` }));
  const keys = pages.map(p => p.key);
  const contracts = ['upload_contratti', 'verifica_contratti', 'storico_cliente', 'dashboard_pezzi', 'controllo_fissi', 'controllo_lg', 'controllo_allarmi', 'controllo_assicurazioni'];
  const editors = ['verifica_contratti', 'storico_cliente', 'controllo_fissi'];
  const privacy = ['upload_contratti', 'storico_cliente'];
  const tables = {
    vendita_contratti: { read: contracts, write: [] },
    vendita_documenti: { read: ['verifica_contratti', 'storico_cliente', 'controllo_fissi'], write: [] },
    vendita_apri_chiudi: { read: ['apri_chiudi', 'storico_cliente'], write: ['apri_chiudi'] },
    vendita_switch_sim: { read: ['switch_sim', 'storico_cliente'], write: ['switch_sim'] },
    vendita_ordini_smartphone: { read: ['ordini_smartphone', 'storico_cliente'], write: ['ordini_smartphone'] },
    vendita_simulatore_protecta: { read: ['simulatore_protecta'], write: ['simulatore_protecta'] },
    post_vendita_dispositivi_comodato: { read: ['dispositivi_comodato', 'storico_cliente'], write: ['dispositivi_comodato'] },
    post_vendita_gestione_rimborsi: { read: ['gestione_rimborsi', 'storico_cliente'], write: [] },
    segnalazioni: { read: ['segnalazioni'], write: ['segnalazioni'] },
    ticket: { read: ['ticket'], write: ['ticket'] },
    dashboard_righe_giornaliera: { read: ['dashboard_pezzi'], write: [] },
    gara_metriche: { read: ['dashboard_pezzi'], write: [] },
    gara_obiettivi_mensili: { read: ['dashboard_pezzi'], write: [] },
    vendita_consensi_privacy: { read: privacy, write: [] },
    vendita_consensi_privacy_v2: { read: privacy, write: [] },
    vendita_consensi_privacy_audit: { read: privacy, write: [] }
  };
  for (const key of ['controllo_fissi', 'controllo_lg', 'controllo_allarmi', 'controllo_assicurazioni']) {
    tables[`post_vendita_${key}`] = { read: [key, 'dashboard_pezzi', 'storico_cliente'], write: [key] };
  }
  const buckets = {
    'contratti-vendita': { read: ['verifica_contratti', 'storico_cliente', 'controllo_fissi'], write: ['upload_contratti'] },
    'consensi-privacy': { read: privacy, write: ['upload_contratti'] },
    'apri-chiudi-files': { read: ['apri_chiudi', 'storico_cliente'], write: ['apri_chiudi'] },
    'switch-sim-files': { read: ['switch_sim', 'storico_cliente'], write: ['switch_sim'] },
    'protecta-files': { read: ['simulatore_protecta'], write: ['simulatore_protecta'] },
    'comodato-files': { read: ['dispositivi_comodato', 'storico_cliente'], write: ['dispositivi_comodato'] },
    'rimborsi-files': { read: ['gestione_rimborsi', 'storico_cliente'], write: ['gestione_rimborsi'] },
    'segnalazioni-files': { read: ['segnalazioni'], write: ['segnalazioni'] }
  };
  function can(profile, permissions, key) {
    return !!profile && profile.attivo !== false && keys.includes(key)
      && (profile.ruolo === 'admin' || permissions?.[key] === true);
  }
  function pageForPath(pathname) {
    const path = String(pathname || '').split(/[?#]/)[0].replace(/^\//, '');
    return pages.find(p => path === p.path);
  }
  function normalize(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Permessi non validi');
    if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Pagina sconosciuta');
    const result = {};
    for (const key of keys) {
      if (typeof value[key] !== 'boolean') throw new Error('Specificare tutte le pagine con valori booleani');
      result[key] = value[key];
    }
    return result;
  }
  function endpointPages(endpoint, event = {}) {
    let body = {};
    try { body = JSON.parse(event.body || '{}') || {}; } catch (_) { /* Handler validates malformed bodies. */ }
    const map = {
      'crea-vendita-pratica-carrello': ['upload_contratti'],
      'ocr-pda': ['upload_contratti'], 'vendita-config': ['upload_contratti'],
      'upload-vendita-documento': ['upload_contratti'],
      'richiedi-otp-privacy': ['upload_contratti'], 'verifica-otp-privacy': ['upload_contratti'],
      'upload-consenso-cartaceo': ['upload_contratti'], 'genera-pdf-consenso-cartaceo': ['upload_contratti'],
      'garantisci-anagrafica': ['upload_contratti'], 'search-anagrafica': ['upload_contratti'],
      'check-consenso-privacy': privacy,
      'gestisci-controllo-lg': ['controllo_lg'], 'gestisci-controllo-fissi': ['controllo_fissi'],
      'gestisci-verifica-automatica': ['verifica_contratti'],
      'gestisci-anagrafiche': ['anagrafiche'],
      'gestisci-disdette': ['compilatore_disdette'], 'gestisci-subentri': ['compilatore_subentri'],
      'elimina-vendita-contratto': ['verifica_contratti'],
      'upload-documento-modulo': [...new Set(Object.values(buckets).flatMap(b => b.write))],
      'gestisci-vendita-contratto': body.action === 'check_codice' ? ['upload_contratti', ...editors] : editors,
      'gestisci-operazioni-post-vendita': [body.action === 'mark_apri_chiudi_ko' ? 'apri_chiudi' : 'gestione_rimborsi'],
      'mirox-send-email': ({ ordine_smartphone_nuovo: ['ordini_smartphone'], segnalazione_assegnata: ['segnalazioni'] })[body.template] || []
    };
    return Object.hasOwn(map, endpoint) ? map[endpoint] : null;
  }
  return { pages: Object.freeze(pages), keys: Object.freeze(keys), tables, buckets, contracts, editors, can, normalize, pageForPath, endpointPages };
});
