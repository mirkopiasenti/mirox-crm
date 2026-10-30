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
  const sameCustomer = (a, b) => JSON.stringify(customer(a)) === JSON.stringify(customer(b))
    && (!norm(a?.cluster)||!norm(b?.cluster)||norm(a.cluster)===norm(b.cluster));
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
    const identityReadings=readings.filter(r=>r.fields?.tipo_identita?.value!=='tessera_sanitaria');
    const unique = key => [...new Set((key==='fiscale'?readings:identityReadings).map(r => r.fields?.[key]?.value).filter(v => v !== null && v !== undefined && v !== ''))];
    const one = key => unique(key).length === 1 ? unique(key)[0] : null;
    const types = unique('tipo_identita'), names = unique('nome').map(name);
    const barcodeTaxes=[...new Set(readings.flatMap(r=>r.barcode?.complete?r.barcode.values.map(v=>norm(v.value)):[]))];
    const tax = barcodeTaxes.length?barcodeTaxes:unique('fiscale').map(norm);
    if(barcodeTaxes.length>1||readings.some(r=>r.barcode?.conflict))errors.push('I codici a barre dei documenti indicano codici fiscali diversi.');
    if(readings.some(r=>r.barcode?.attempted)&&!readings.some(r=>r.barcode?.complete&&!r.barcode?.conflict&&r.barcode.values?.length))uncertain.push('Il codice a barre del codice fiscale non è leggibile: serve il controllo tramite anteprima.');
    if(readings.some(r=>r.barcode?.attempted&&!r.barcode.complete))uncertain.push('La decodifica dei codici a barre non è completa: verifica tutte le pagine nell’anteprima.');
    if(barcodeTaxes.length===1&&!Verification.identityTaxLinked(readings,barcodeTaxes[0]))uncertain.push('Il CF è leggibile sulla tessera sanitaria, ma non è dimostrato il legame con carta o patente. Controlla la coppia nell’anteprima.');
    const targetTax = expected.business ? norm(target.cf_rappresentante) : expected.fiscale;
    const taxRequired = /^[A-Z0-9]{16}$/.test(targetTax);
    const taxMatch = taxRequired && tax.length > 0 && tax.every(t => t === targetTax);
    const numbers = [...new Set(unique('numero_documento').map(norm))];
    if (!numbers.length) uncertain.push('Il numero del documento non è leggibile: controlla che i PDF appartengano al medesimo documento.');
    else if (numbers.length > 1) errors.push('I PDF riportano numeri di documento diversi. Carica le parti del medesimo documento di riconoscimento.');
    const repeatedName = readings.some(r => r.ricontrollo_nome);
    if (!taxRequired) {
      if (!expected.nome || expected.nome.split(' ').length < 2) uncertain.push('Completa il nome della persona nell’anagrafica. Per Business serve Nome referente.');
      if (repeatedName) uncertain.push('Due letture automatiche hanno trascritto nomi diversi: confronta il nome stampato con l’anagrafica e conferma il controllo manuale.');
      if (!names.length && !repeatedName) uncertain.push('Il nome sul documento non è leggibile.');
      else if (expected.nome.split(' ').length >= 2 && names.some(n => n !== expected.nome)) errors.push('Il nome sul documento non coincide con l’anagrafica.');
    }
    if (taxRequired && !tax.length) uncertain.push('Il codice fiscale non è stato letto dal documento. Verificalo manualmente: il nome OCR non sostituisce questo controllo.');
    if (!expected.business || targetTax) {
      if (tax.length && tax.some(t => t !== targetTax)) errors.push(expected.business ? 'Il codice fiscale sul documento non coincide con il rappresentante indicato nella PDA Business.' : 'Il codice fiscale sul documento non coincide con l’anagrafica.');
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
      cittadinanza: group, scadenza: expiry, data_firma: signed,
      cf_da_confermare: taxRequired && !tax.length,
      criterio_identita: taxMatch ? barcodeTaxes.length?'barcode_fiscale':expected.business ? 'cf_rappresentante_pda' : 'codice_fiscale' : taxRequired ? 'codice_fiscale_da_confermare' : 'nome_referente',
      confronto: { campo_anagrafica: expected.business ? 'Nome referente' : 'Ragione sociale',
        nome_informativo: taxRequired,
        fiscale_atteso: targetTax || null, fiscali_documenti: [...new Set(tax)],
        nome_anagrafica: String(expected.business ? target.nome_referente || '' : target.ragione_sociale || '').trim(),
        nomi_documenti: [...new Set(readings.flatMap(r => [r.fields?.nome?.value, r.ricontrollo_nome?.prima?.value, r.ricontrollo_nome?.seconda?.value]).filter(v => typeof v === 'string' && v.trim()))] } };
  }
  return { EU: [...EU], norm, name, customer, sameCustomer, citizenship, needsPermit, evaluate };
});
