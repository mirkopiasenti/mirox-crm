(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxVerificaCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const VERSION = '2026-10-28.3';
  const LABELS = { da_controllare: 'Da controllare', controllato: 'Controllato', da_verificare: 'Da verificare', in_attesa_csv: 'In attesa CSV' };
  const FIELD_LABELS = { codice_contratto: 'Codice contratto', costo_offerta_mensile: 'Costo mensile base', portabilita: 'Portabilità', numero_telefono: 'Numero di telefono', numero_provvisorio: 'Numero provvisorio', numero_mnp: 'Numero da portare', operatore_provenienza: 'Gestore di provenienza', tipo_attivazione: 'Tipo attivazione Fisso', imei: 'IMEI', fascia_prezzo: 'Prezzo dispositivo', tipo_acquisto: 'Tipo acquisto', numero_contratto_energia: 'Numero contratto Energia', ex_fornitore: 'Gestore uscente' };
  const norm = v => String(v == null ? '' : v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const compact = v => norm(v).replace(/\s+/g, '');
  const name = v => norm(v).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  function date(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const d = new Date(v + 'T12:00:00Z');
    return Number.isFinite(+d) && d.toISOString().slice(0, 10) === v ? v : null;
  }
  function romeParts(now) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  }
  function firstDue(now) {
    const p = romeParts(now), day = new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
    if (Number(p.hour) >= 21) day.setUTCDate(day.getUTCDate() + 1);
    const localDay = day.toISOString().slice(0, 10);
    // At 21:00 there is no DST ambiguity. Derive the offset for that specific day.
    const probe = new Date(localDay + 'T20:00:00Z');
    const h = Number(romeParts(probe).hour);
    return new Date(+probe - (h - 21) * 3600000).toISOString();
  }
  function romeDay(now) { const p = romeParts(now); return `${p.year}-${p.month}-${p.day}`; }
  function label(contract, review) {
    if (contract.stato_controllo === 'controllato') return LABELS.controllato;
    return LABELS[review?.esito] || LABELS.da_controllare;
  }
  function csvMatch(rows, tax, point, expectedNumber = null) {
    const t = compact(tax), p = compact(point);
    if (!t || !p) return { state: 'invalid' };
    const byPoint = rows.filter(r => compact(r.punto) === p);
    const matches = byPoint.filter(r => compact(r.fiscale) === t);
    if (!matches.length) return { state: byPoint.length ? 'conflict' : 'missing' };
    if (expectedNumber) {
      const exact = matches.filter(r => compact(r.numero) === compact(expectedNumber));
      return exact.length ? { state: 'matched', numero: compact(expectedNumber), rows: exact } : { state: 'conflict' };
    }
    const codes = [...new Set(matches.map(r => compact(r.numero)).filter(Boolean))];
    if (codes.length !== 1) return { state: 'ambiguous' };
    return { state: 'matched', numero: codes[0], rows: matches };
  }
  function birthMatchesTax(birth, tax) {
    const b = date(birth), cf = compact(tax);
    if (!b || !/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
    const decode = s => Number(s.replace(/[LMNPQRSTUV]/g, c => String('LMNPQRSTUV'.indexOf(c))));
    const months = 'ABCDEHLMPRST';
    return decode(cf.slice(6, 8)) === Number(b.slice(2, 4)) && months.indexOf(cf[8]) + 1 === Number(b.slice(5, 7)) && decode(cf.slice(9, 11)) % 40 === Number(b.slice(8, 10));
  }
  // AI output is evidence only: no model-provided approval or executable patch is accepted.
  function evaluate({ contract: c, customer: a, documents, extracted, csv = null, signingDate = null, identityPrecheck = null }) {
    const errors = [], waiting = [], checks = [], patch = {};
    const fail = (code, message) => { if (!errors.some(x => x.code === code)) errors.push({ code, message }); };
    const docs = new Map(documents.map(d => [d.id, d]));
    function field(doc, key) {
      const f = doc?.fields?.[key], original = docs.get(doc?.id);
      if (!original || !f || !Number.isSafeInteger(f.page) || f.page < 1 || f.page > original.pages || typeof f.quote !== 'string' || f.quote.trim().length < 2 || f.quote.length > 1500) return null;
      if (!['string', 'number', 'boolean'].includes(typeof f.value)) return null;
      return typeof f.value === 'string' ? f.value.length <= 300 ? f.value.trim() || null : null : f.value;
    }
    const all = Array.isArray(extracted?.documents) ? extracted.documents : [];
    // Duplicate IDs make the response ambiguous, never choose the first interpretation.
    if (new Set(all.map(d => d.id)).size !== all.length || all.some(d => !docs.has(d.id))) fail('lettura_ambigua', 'La lettura dei documenti non è univoca. Richiedi una nuova analisi.');
    const ofType = kind => all.filter(d => docs.get(d.id)?.tipo_documento === kind);
    const cat = norm(c.categoria_snapshot), isPda = ['MOBILE', 'CUSTOMER BASE', 'FISSO'].includes(cat);
    const pdas = ofType('contratto'), identities = ofType('documento_identita'), bills = ofType('copia_bolletta');
    let pda = null;
    if (!isPda && pdas.length) {
      const matching = pdas.filter(d => compact(field(d, 'fiscale')) === compact(a.cf_piva));
      if (matching.length === 1) pda = matching[0];
      else fail('contratto_aggiuntivo', 'Il contratto aggiuntivo non corrisponde al cliente o non è univoco.');
    }
    if (isPda) {
      const matching = pdas.filter(d => field(d, 'codice_contratto') && (!c.codice_contratto || compact(field(d, 'codice_contratto')) === compact(c.codice_contratto)));
      if (matching.length !== 1) fail('contratto', matching.length ? 'Sono presenti più contratti compatibili. Individua il PDA corretto.' : 'Il contratto allegato manca, non è leggibile oppure ha un codice diverso dalla pratica.');
      else {
        pda = matching[0];
        if (compact(field(pda, 'fiscale')) !== compact(a.cf_piva)) fail('intestatario', 'Il codice fiscale o la partita IVA del contratto non coincide con il cliente della pratica.');
        else checks.push('Intestazione del contratto coerente');
        if (!c.codice_contratto) patch.codice_contratto = compact(field(pda, 'codice_contratto'));
      }
      if (pda) {
        const phone = value => { let v = compact(value).replace(/^(?:\+39|0039)/, ''); if (/^393\d{8,9}$/.test(v)) v = v.slice(2); return /^3\d{8,9}$/.test(v) ? v : null; };
        const money = value => value !== null && /^\d{1,5}(?:[.,]\d{1,2})?$/.test(String(value)) ? Number(String(value).replace(',', '.')) : null;
        const copy = (key, source, normalize, required) => {
          const value = normalize(field(pda, source)), current = normalize(c[key]);
          if (value === null || value === '') { if (required) fail('dato_' + key, 'Dato del contratto non leggibile: ' + (FIELD_LABELS[key] || key) + '.'); return; }
          if (c[key] === null || c[key] === undefined || c[key] === '') patch[key] = value;
          else if (current !== value) fail('diverso_' + key, 'Il dato inserito è diverso da quello della PDA: ' + (FIELD_LABELS[key] || key) + '.');
        };
        if (cat === 'MOBILE') {
          copy('portabilita', 'portabilita', v => typeof v === 'boolean' ? v : null, true);
          const port = patch.portabilita ?? c.portabilita;
          copy('costo_offerta_mensile', 'costo_offerta_mensile', money, true);
          for (const key of ['numero_telefono', ...(port === true ? ['numero_provvisorio', 'numero_mnp'] : [])]) copy(key, key, phone, true);
          if (port === true) copy('operatore_provenienza', 'operatore_provenienza', v => typeof v === 'string' ? norm(v) : null, true);
        }
        if (cat === 'FISSO') copy('tipo_attivazione', 'tipo_attivazione', v => ['Nuova Attivazione', 'Portabilita'].includes(v) ? v : null, true);
        if (c.dispositivo_associato === true) {
          copy('imei', 'imei', v => /^\d{15}$/.test(String(v)) ? String(v) : null, true);
          copy('fascia_prezzo', 'prezzo_device', v => money(v) === null ? null : String(money(v)), true);
          if (cat !== 'FISSO') copy('tipo_acquisto', 'tipo_acquisto', v => ['VAR', 'Finanziamento'].includes(v) ? v : null, true);
        }
      }
      if (c.tipo_firma === 'cartacea') {
        const scans = ofType('contratto_firmato');
        if (!scans.some(d => compact(field(d, 'fiscale')) === compact(a.cf_piva) && compact(field(d, 'codice_contratto')) === compact(field(pda, 'codice_contratto')))) fail('contratto_firmato', 'La scansione del contratto firmato su carta manca o non corrisponde al PDA e al cliente.');
      }
    }
    const business = norm(c.cluster_cliente || a.cluster) === 'BUSINESS';
    const targetTax = business ? field(pda, 'firmatario_fiscale') || identityPrecheck?.cf_rappresentante : a.cf_piva;
    const targetName = business ? a.nome_referente : a.ragione_sociale;
    const pdaName = field(pda, business ? 'firmatario_nome' : 'intestatario_nome');
    if (pdaName && targetName && (!business || !/^[A-Z0-9]{16}$/.test(compact(targetTax))) && name(pdaName) !== name(targetName)) fail('intestazione_nome', 'Il nome della persona nella PDA non coincide con l’anagrafica CRM.');
    if (business && isPda && !/^[A-Z0-9]{16}$/.test(compact(targetTax))) fail('cf_rappresentante', 'Il CF personale del rappresentante non è leggibile nella sezione dedicata della PDA Business.');
    const energyMatch = cat === 'ENERGIA' && csv ? csvMatch(csv.rows, a.cf_piva, c.pod_pdr, c.numero_contratto_energia) : null;
    const csvDates = [...new Set((energyMatch?.rows || []).map(r => date(r.data_firma)).filter(Boolean))];
    const scannedDates = c.tipo_firma === 'cartacea' ? [...new Set(ofType('contratto_firmato').filter(d => compact(field(d, 'fiscale')) === compact(a.cf_piva) && compact(field(d, 'codice_contratto')) === compact(field(pda, 'codice_contratto'))).map(d => date(field(d, 'data_firma'))).filter(Boolean))] : [];
    const allSigningDates = new Set([...scannedDates, ...csvDates, date(field(pda, 'data_firma')), date(signingDate)].filter(Boolean));
    if (allSigningDates.size > 1) fail('date_discordanti', 'Le fonti riportano più date di firma: controlla quale documento appartiene al contratto.');
    const signed = scannedDates.length === 1 ? scannedDates[0] : date(field(pda, 'data_firma')) || date(signingDate) || (!isPda && csvDates.length === 1 ? csvDates[0] : null);
    // Upload date is never silently used as signing date. Non-PDA categories require an explicit date source.
    if (!signed) fail('data_firma', 'La data di firma del contratto non è leggibile o non è disponibile. Serve per controllare la scadenza del documento.');
    if (signed && signed > romeDay(new Date())) fail('data_firma_futura', 'La data di firma letta è futura: verifica la data effettiva del contratto.');
    if (business && !targetName && !targetTax) fail('firmatario', 'Completa Nome referente nell’anagrafica Business per controllare il documento di riconoscimento.');
    const identityMatches = identities.filter(d => {
      const tax = compact(field(d, 'fiscale')), n = name(field(d, 'nome')), birth = date(field(d, 'nascita'));
      if (/^[A-Z0-9]{16}$/.test(compact(targetTax))) return Boolean(tax && tax === compact(targetTax));
      if (business) {
        return Boolean(targetName && n && n.split(' ').length >= 2 && n === name(targetName) && (!targetTax || birthMatchesTax(birth, targetTax)));
      }
      return false;
    });
    if (identityPrecheck) {
      if (business && compact(identityPrecheck.cf_rappresentante) !== compact(targetTax)) fail('cf_rappresentante', 'Il CF del rappresentante della PDA differisce dal controllo identita eseguito nell’upload.');
      if (!signed || !date(identityPrecheck.scadenza) || date(identityPrecheck.scadenza) < signed) fail('scadenza', 'Il documento già controllato nell’upload non è valido alla data di firma del contratto.');
      else checks.push(identityPrecheck.manuale
        ? 'Identità confermata manualmente nell’upload rispetto all’anagrafica CRM; validità riscontrata alla data di firma'
        : 'Identità già controllata nell’upload rispetto all’anagrafica CRM; validità riscontrata alla data di firma');
    }
    else if (!identityMatches.length) fail('identita', /^[A-Z0-9]{16}$/.test(compact(targetTax)) && identities.length && identities.every(d => !field(d, 'fiscale'))
      ? 'Il codice fiscale non è leggibile nel documento: serve un controllo manuale del CF o una copia leggibile. Il nome non sostituisce questo controllo.'
      : 'Il documento d’identità manca, non è leggibile oppure non corrisponde alla persona del contratto.');
    else {
      const valid = identityMatches.filter(d => signed && date(field(d, 'scadenza')) && date(field(d, 'scadenza')) >= signed);
      if (!valid.length) fail('scadenza', 'Il documento d’identità era scaduto alla data di firma oppure la scadenza non è leggibile.');
      else checks.push('Identità coerente e documento valido alla data di firma');
    }
    if (cat === 'MOBILE' && pda) {
      const port = field(pda, 'portabilita');
      if (typeof port !== 'boolean' || typeof c.portabilita === 'boolean' && port !== c.portabilita) fail('portabilita', 'La scelta nuovo numero/portabilità non coincide con la PDA o non è leggibile.');
      const phone = value => compact(value).replace(/^(?:\+39|0039)/, '');
      for (const key of ['numero_telefono', ...(port === true ? ['numero_provvisorio', 'numero_mnp'] : [])]) {
        const value = field(pda, key);
        if (!value || phone(value) !== phone(patch[key] ?? c[key])) fail(key, 'Le numerazioni inserite non coincidono con la sezione SIM/portabilità della PDA o non sono leggibili.');
      }
    }
    if (cat === 'MOBILE' && (c.portabilita === true || field(pda, 'portabilita') === true) || ofType('copia_sim_mnp').length) {
      const serial = compact(field(pda, 'iccid_uscente'));
      const sims = ofType('copia_sim_mnp').map(d => compact(field(d, 'iccid'))).filter(Boolean);
      if (!/^\d{18,22}$/.test(serial) || !sims.length) fail('sim_illeggibile', 'Il seriale della SIM o quello della portabilità nella PDA non è leggibile.');
      else if (!sims.includes(serial) || sims.some(s => s !== serial)) fail('sim_diversa', 'Il seriale della SIM allegata è diverso da quello indicato nella portabilità della PDA.');
      else checks.push('Seriale SIM coerente con la portabilità');
    }
    if (cat === 'ENERGIA') {
      const matchingBills = bills.filter(d => compact(field(d, 'fiscale')) === compact(a.cf_piva) && compact(field(d, 'pod_pdr')) === compact(c.pod_pdr));
      const complete = matchingBills.filter(d => field(d, 'prima_pagina') === true && field(d, 'seconda_pagina') === true && docs.get(d.id).pages >= 2);
      if (!matchingBills.length) fail('bolletta', 'La bolletta manca oppure intestatario e POD/PDR non coincidono con la pratica.');
      else if (!complete.length) fail('pagine_bolletta', 'Servono almeno le prime due pagine leggibili della stessa bolletta, con intestatario e POD/PDR.');
      else {
        checks.push('Bolletta intestata correttamente, prime due pagine e POD/PDR coerenti');
        const providers = [...new Set(complete.map(d => field(d, 'gestore')).filter(Boolean))];
        if (providers.length !== 1) fail('gestore', 'Il gestore uscente della bolletta non è leggibile o non è univoco.');
        else if (!c.ex_fornitore) patch.ex_fornitore = providers[0];
        else if (norm(c.ex_fornitore) !== norm(providers[0])) fail('gestore_diverso', 'Il gestore uscente inserito è diverso da quello della bolletta.');
      }
      const match = energyMatch || { state: 'missing_file' };
      if (['missing', 'missing_file'].includes(match.state)) waiting.push({ code: match.state, message: match.state === 'missing_file' ? 'CSV WindTre non ancora caricato.' : 'Contratto non presente nell’ultimo CSV caricato.' });
      else if (match.state !== 'matched') fail('csv_ambiguo', 'Il CSV contiene dati discordanti o più numeri contratto per la stessa fornitura. Verifica l’abbinamento.');
      else if (c.numero_contratto_energia && compact(c.numero_contratto_energia) !== match.numero) fail('numero_energia', 'Il numero contratto Energia inserito è diverso da quello del CSV ufficiale.');
      else { if (!c.numero_contratto_energia) patch.numero_contratto_energia = match.numero; checks.push('Numero contratto Energia riscontrato nel CSV'); }
    }
    if (!['MOBILE', 'CUSTOMER BASE', 'FISSO', 'ENERGIA', 'ALLARMI', 'ASSICURAZIONI'].includes(cat)) fail('categoria', 'La categoria non è riconosciuta: è necessaria la verifica manuale.');
    // A missing signing date can be supplied by the awaited CSV. Genuine documentary faults still take precedence.
    if (cat === 'ENERGIA' && waiting.length && !signed) {
      const remove = new Set(['data_firma', 'scadenza']);
      const hasExpiredEvidence = identityMatches.some(d => !date(field(d, 'scadenza')));
      for (let i = errors.length - 1; i >= 0; i--) if (remove.has(errors[i].code) && !(errors[i].code === 'scadenza' && hasExpiredEvidence)) errors.splice(i, 1);
    }
    return { version: VERSION, esito: errors.length ? 'da_verificare' : waiting.length ? 'in_attesa_csv' : 'controllato', errors, waiting, checks, patch,
      signature_date: signed, notify_reload: cat === 'CUSTOMER BASE' && c.smartphone_reload === true && c.smartphone_reload_modalita === 'Disattivazione cliente' };
  }
  return { VERSION, LABELS, FIELD_LABELS, norm, compact, date, firstDue, romeDay, label, csvMatch, birthMatchesTax, evaluate };
});
