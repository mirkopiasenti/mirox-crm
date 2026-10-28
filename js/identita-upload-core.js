(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./verifica-contratti-core') : root.MiroxVerificaCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxIdentitaCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function (Verification) {
  'use strict';
  // Regola operativa UE, distinta da residenza e area Schengen. Fonte: portale UE, 28/10/2026.
  const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
  const norm = v => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const name = v => String(v || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean).sort().join(' ');
  function customer(c = {}) {
    const business = norm(c.cluster) === 'BUSINESS';
    return { fiscale: norm(c.cf_piva), nome: name(business ? c.nome_referente : c.ragione_sociale), business };
  }
  const sameCustomer = (a, b) => JSON.stringify(customer(a)) === JSON.stringify(customer(b));
  function citizenship(value) {
    const codes = String(value || '').toUpperCase().split(/[,;/\s]+/).filter(Boolean);
    if (!codes.length || codes.some(c => !/^[A-Z]{2}$/.test(c))) return null;
    const names = new Intl.DisplayNames(['it'], { type: 'region', fallback: 'none' });
    if (codes.some(c => !names.of(c) || ['ZZ', 'EU', 'UN'].includes(c))) return null;
    return codes.some(c => EU.has(c)) ? 'ue' : 'extra_ue';
  }
  function needsPermit(c = {}, group) {
    return group === 'extra_ue' && norm(c.cluster_cliente || c.cluster) === 'CONSUMER'
      && norm(c.categoria_snapshot || c.categoria_nome) === 'MOBILE'
      && c.dispositivo_associato === true && c.tipo_acquisto === 'VAR';
  }
  function evaluate(readings, target, signingDate) {
    const errors = [], uncertain = [], expected = customer(target);
    const unique = key => [...new Set(readings.map(r => r.fields?.[key]?.value).filter(v => v !== null && v !== undefined && v !== ''))];
    const one = key => unique(key).length === 1 ? unique(key)[0] : null;
    const types = unique('tipo_identita'), names = unique('nome').map(name);
    const numbers = [...new Set(unique('numero_documento').map(norm))];
    if (!numbers.length) uncertain.push('Il numero del documento non è leggibile: controlla che i PDF appartengano al medesimo documento.');
    else if (numbers.length > 1) errors.push('I PDF riportano numeri di documento diversi. Carica le parti del medesimo documento di riconoscimento.');
    if (!expected.nome || expected.nome.split(' ').length < 2) uncertain.push('Completa il nome della persona nell’anagrafica. Per Business serve Nome referente.');
    if (!names.length) uncertain.push('Il nome sul documento non è leggibile.');
    else if (names.some(n => n !== expected.nome)) errors.push('Il nome sul documento non coincide con l’anagrafica.');
    if (!expected.business) {
      const tax = unique('fiscale').map(norm);
      if (tax.length && tax.some(t => t !== expected.fiscale)) errors.push('Il codice fiscale sul documento non coincide con l’anagrafica.');
      if (!tax.length && !Verification.birthMatchesTax(one('nascita'), expected.fiscale)) uncertain.push('Data di nascita o codice fiscale non consentono un confronto completo con l’anagrafica.');
    }
    if (types.length !== 1 || !['carta_identita', 'passaporto', 'patente'].includes(types[0])) uncertain.push('Il tipo di documento di riconoscimento deve essere verificato manualmente.');
    if (!unique('fronte_presente').includes(true)) uncertain.push('La pagina con i dati del documento non è riconoscibile.');
    if (types[0] !== 'passaporto' && !unique('retro_presente').includes(true)) uncertain.push('Controlla che siano presenti fronte e retro del documento.');
    const signed = Verification.date(signingDate), expiry = Verification.date(one('scadenza'));
    if (!signed || signed > Verification.romeDay(new Date())) errors.push('Indica la data effettiva di firma, non futura, per controllare la validità del documento.');
    if (!expiry) uncertain.push('La scadenza del documento non è leggibile o è discordante.');
    else if (signed && expiry < signed) errors.push('Il documento risulta scaduto alla data di firma indicata.');
    const countries = unique('cittadinanza');
    const group = countries.length === 1 ? citizenship(countries[0]) : null;
    return { stato: errors.length ? 'da_correggere' : uncertain.length ? 'da_confermare' : 'coerente', errors, uncertain,
      cittadinanza: group, scadenza: expiry, data_firma: signed };
  }
  return { EU: [...EU], norm, name, customer, sameCustomer, citizenship, needsPermit, evaluate };
});
