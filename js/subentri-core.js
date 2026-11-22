/* Regole condivise del Compilatore Subentri, senza accesso a servizi o dati CRM. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxSubentri = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const TYPE = 'mobile_microbusiness_privato';
  const PRIVATE_TYPE = 'mobile_privato_privato';
  const TO_BUSINESS_TYPE = 'mobile_privato_microbusiness';
  const BUSINESS_TYPE = 'mobile_microbusiness_microbusiness';
  const TYPE_1928 = 'mobile_1928_privato';
  const TYPE_LABELS = Object.freeze({
    [TYPE]: 'Microbusiness a Privato',
    [PRIVATE_TYPE]: 'Privato a Privato',
    [TO_BUSINESS_TYPE]: 'Privato a Microbusiness',
    [BUSINESS_TYPE]: 'Microbusiness a Microbusiness',
    [TYPE_1928]: '1928 a Privato'
  });
  const MAX_NUMERI = 100;
  const MAX_NUMERI_MORTIS = 4;
  const MAX_DOCUMENTI = 12;
  const CONSENSI = Object.freeze({
    windtre: 'Comunicazioni commerciali WINDTRE',
    terze_parti: 'Comunicazioni commerciali di terze parti tramite WINDTRE',
    profilazione: 'Profilazione', geolocalizzazione: 'Geolocalizzazione',
    arricchimento: 'Arricchimento dei dati', trasferimento: 'Trasferimento a partner'
  });
  const DOCUMENTI = Object.freeze({
    identita: 'Carta d’identità fronte/retro del subentrante',
    tessera_sanitaria: 'Tessera sanitaria fronte/retro del subentrante',
    visura: 'Visura camerale'
  });
  const DOCUMENTI_PRIVATI = Object.freeze({
    identita_cedente: 'Documento d’identità del cedente',
    identita_cessionario: 'Documento d’identità del cessionario'
  });
  const DOCUMENTI_MORTIS = Object.freeze({
    ...DOCUMENTI_PRIVATI,
    certificato_morte: 'Certificato di morte'
  });
  const DOCUMENTI_CESSIONARIO_BUSINESS = Object.freeze({...DOCUMENTI_PRIVATI, visura: DOCUMENTI.visura});
  const DOCUMENTI_CESSIONARIO_BUSINESS_MORTIS = Object.freeze({...DOCUMENTI_CESSIONARIO_BUSINESS, certificato_morte: DOCUMENTI_MORTIS.certificato_morte});
  const DOCUMENTI_DUE_BUSINESS = Object.freeze({
    ...DOCUMENTI_PRIVATI,
    visura_cedente: 'Visura camerale del cedente',
    visura_cessionario: 'Visura camerale del cessionario'
  });
  const DOCUMENTI_DUE_BUSINESS_MORTIS = Object.freeze({...DOCUMENTI_DUE_BUSINESS, certificato_morte: DOCUMENTI_MORTIS.certificato_morte});
  const DOCUMENTI_1928 = Object.freeze({
    documenti_rappresentante: 'Carta d’identità e tessera sanitaria del rappresentante legale',
    visura_azienda: 'Visura camerale dell’attuale azienda',
    documenti_intestatario: 'Carta d’identità e tessera sanitaria del nuovo intestatario'
  });
  // [nome, etichetta, lunghezza, validazione, facoltativo]
  const FIELDS = Object.freeze({
    generale: [['codice_cliente', 'Codice cliente WINDTRE', 10, 'cliente']],
    cedente: [
      ['cedente_nome', 'Nome della persona/delegato', 60],
      ['cedente_cognome', 'Cognome della persona/delegato', 60],
      ['cedente_codice_fiscale', 'Codice fiscale della persona/delegato', 16, 'cf'],
      ['cedente_partita_iva', 'Partita IVA', 11, 'piva'],
      ['cedente_telefono', 'Recapito della persona/delegato', 30, 'telefono']
    ],
    impresa: [
      ['cedente_ragione_sociale', 'Denominazione/ragione sociale', 100],
      ['cedente_telefono_impresa', 'Recapito dell’impresa', 30, 'telefono']
    ],
    subentrante: [
      ['subentrante_nome', 'Nome', 60], ['subentrante_cognome', 'Cognome', 60],
      ['subentrante_codice_fiscale', 'Codice fiscale', 16, 'cf'],
      ['subentrante_comune_nascita', 'Comune di nascita', 60],
      ['subentrante_provincia_nascita', 'Provincia di nascita (EE se estero)', 2, 'provincia'],
      ['subentrante_data_nascita', 'Data di nascita', 10, 'data'],
      ['subentrante_telefono', 'Recapito telefonico', 30, 'telefono'],
      ['subentrante_documento_tipo', 'Tipo documento d’identità', 40],
      ['subentrante_documento_rilascio', 'Data di rilascio', 10, 'data'],
      ['subentrante_documento_numero', 'Numero documento', 11, 'documento'],
      ['subentrante_nazionalita', 'Nazionalità', 40],
      ['subentrante_via', 'Indirizzo di residenza', 80],
      ['subentrante_civico', 'Numero civico', 15],
      ['subentrante_localita', 'Località (se diversa dal Comune)', 60, '', true],
      ['subentrante_cap', 'CAP', 5, 'cap'],
      ['subentrante_comune', 'Comune di residenza', 60],
      ['subentrante_provincia', 'Provincia di residenza', 2, 'provincia']
    ],
    subentrante_business: [['subentrante_partita_iva', 'Partita IVA del cessionario', 11, 'piva']],
    subentrante_impresa: [
      ['subentrante_ragione_sociale', 'Denominazione/ragione sociale', 100],
      ['subentrante_telefono_impresa', 'Recapito dell’impresa', 30, 'telefono'],
      ['subentrante_sede_via', 'Indirizzo della sede legale', 80],
      ['subentrante_sede_civico', 'Civico della sede legale', 15],
      ['subentrante_sede_localita', 'Località della sede legale (se diversa dal Comune)', 60, '', true],
      ['subentrante_sede_cap', 'CAP della sede legale', 5, 'cap'],
      ['subentrante_sede_comune', 'Comune della sede legale', 60],
      ['subentrante_sede_provincia', 'Provincia della sede legale', 2, 'provincia']
    ],
    banca: [['banca', 'Nome banca/Poste', 100], ['iban', 'IBAN', 34, 'iban']],
    sottoscrittore: [
      ['sottoscrittore_nome', 'Nome', 60], ['sottoscrittore_cognome', 'Cognome', 60],
      ['sottoscrittore_via', 'Indirizzo', 80], ['sottoscrittore_civico', 'Numero civico', 15],
      ['sottoscrittore_cap', 'CAP', 5, 'cap'], ['sottoscrittore_comune', 'Comune', 60],
      ['sottoscrittore_provincia', 'Provincia', 2, 'provincia'],
      ['sottoscrittore_codice_fiscale', 'Codice fiscale', 16, 'cf'],
      ['sottoscrittore_telefono', 'Recapito telefonico', 30, 'telefono']
    ],
    conto: [
      ['conto_intestatario', 'Intestazione del conto (tutti i cointestatari)', 120],
      ['conto_via', 'Indirizzo', 80], ['conto_civico', 'Numero civico', 15],
      ['conto_cap', 'CAP', 5, 'cap'], ['conto_comune', 'Comune', 60],
      ['conto_provincia', 'Provincia', 2, 'provincia'],
      ['conto_cf_piva', 'Codice fiscale/Partita IVA', 16, 'cf_piva']
    ],
    firma: [['luogo', 'Luogo di sottoscrizione', 60], ['data', 'Data di sottoscrizione', 10, 'data', true]],
    mortis: [
      ['dichiarazione_mortis', 'Testo della dichiarazione', 550, 'testo'],
      ['dichiarante_domicilio_comune', 'Comune di domicilio', 60, '', true],
      ['dichiarante_domicilio_provincia', 'Provincia di domicilio (EE se estero)', 2, 'provincia', true],
      ['dichiarante_domicilio_via', 'Indirizzo di domicilio', 80, '', true],
      ['dichiarante_domicilio_civico', 'Civico di domicilio', 15, '', true]
    ]
  });
  class ValidationError extends Error { constructor(message) { super(message); this.status = 400; } }
  function fail(message) { throw new ValidationError(message); }
  function validateType(type) {
    if (typeof type !== 'string' || !Object.hasOwn(TYPE_LABELS, type)) fail('Questa categoria di subentro non è ancora disponibile');
    return type;
  }
  function documentGroups(type, mortisCausa) {
    if (type === TYPE_1928) return DOCUMENTI_1928;
    if (type === TYPE) return DOCUMENTI;
    if (type === TO_BUSINESS_TYPE) return mortisCausa ? DOCUMENTI_CESSIONARIO_BUSINESS_MORTIS : DOCUMENTI_CESSIONARIO_BUSINESS;
    if (type === BUSINESS_TYPE) return mortisCausa ? DOCUMENTI_DUE_BUSINESS_MORTIS : DOCUMENTI_DUE_BUSINESS;
    return mortisCausa ? DOCUMENTI_MORTIS : DOCUMENTI_PRIVATI;
  }
  function usesBusinessIdentifier(role, type) {
    return (role === 'cedente' && (type === TYPE || type === BUSINESS_TYPE))
      || (role === 'subentrante' && (type === TO_BUSINESS_TYPE || type === BUSINESS_TYPE));
  }
  function validateSearchIdentifier(role, value, type = TYPE) {
    validateType(type);
    if (type === TYPE_1928) fail('Il percorso 1928 richiede solo gli allegati');
    const identifier = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (usesBusinessIdentifier(role, type)) {
      if (!/^\d{11}$/.test(identifier)) fail(`Cliente ${role}: inserisci una partita IVA completa di 11 cifre`);
    } else if (role === 'cedente' || role === 'subentrante') {
      // Sono ammesse anche le sostituzioni numeriche previste dall'omocodia.
      if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(identifier)) {
        fail(`Cliente ${role}: inserisci un codice fiscale personale completo di 16 caratteri`);
      }
    } else fail('Ruolo anagrafica non valido');
    return identifier;
  }
  function clean(value, max, label, optional = false) {
    if (value !== undefined && value !== null && typeof value !== 'string') fail(`${label}: valore non valido`);
    const text = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLocaleUpperCase('it-IT');
    if (!text && !optional) fail(`${label}: campo obbligatorio`);
    if (text.length > max) fail(`${label}: massimo ${max} caratteri`);
    // Il template usa WinAnsi: messaggio esplicito per caratteri non stampabili.
    if ([...text].some(ch => ch.codePointAt(0) > 255 && !'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.includes(ch))) fail(`${label}: contiene caratteri non supportati dal modulo`);
    return text;
  }
  function date(value, label, optional, allowFuture = false) {
    const text = clean(value, 10, label, optional);
    if (!text && optional) return '';
    const parsed = new Date(`${text}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) fail(`${label}: data non valida`);
    const todayParts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
    const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
    if (!allowFuture && text > today) fail(`${label}: la data non può essere futura`);
    return text;
  }
  function phone(value, label, mobile = false) {
    let text = clean(value, 30, label).replace(/[\s()./-]/g, '');
    if (text.startsWith('+39')) text = text.slice(3);
    else if (text.startsWith('0039')) text = text.slice(4);
    if (!(mobile ? /^3\d{8,9}$/ : /^\d{5,12}$/).test(text)) fail(`${label}: numero ${mobile ? 'mobile ' : ''}non valido (prefisso italiano)`);
    return text;
  }
  function validIban(value) {
    const compact = clean(value, 42, 'IBAN').replace(/\s/g, '');
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) fail('IBAN non valido');
    if (compact.startsWith('IT') && compact.length !== 27) fail('IBAN italiano non valido');
    const shifted = compact.slice(4) + compact.slice(0, 4);
    let remainder = 0;
    for (const ch of shifted) {
      for (const digit of (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))) remainder = (remainder * 10 + Number(digit)) % 97;
    }
    if (remainder !== 1) fail('IBAN non valido: verifica le coordinate');
    return compact;
  }
  function fieldValue(raw, field, optional = field[4]) {
    const [key, label, max, rule] = field;
    if (rule === 'data') return date(raw[key], label, optional, key === 'data');
    if (rule === 'telefono') return optional && !clean(raw[key], max, label, true) ? '' : phone(raw[key], label);
    if (rule === 'iban') return validIban(raw[key]);
    const value = clean(raw[key], max, label, optional);
    if (!value && optional) return value;
    const patterns = { cf: /^[A-Z0-9]{16}$/, piva: /^\d{11}$/, cf_piva: /^(?:[A-Z0-9]{16}|\d{11})$/, provincia: /^[A-Z]{2}$/, cap: /^\d{5}$/, cliente: /^\d{1,10}$/, documento: /^[A-Z0-9-]{1,11}$/ };
    if (rule && patterns[rule] && !patterns[rule].test(value)) fail(`${label}: formato non valido`);
    return value;
  }
  function validateMode(value) {
    if (!['invia_pratica', 'standard'].includes(value)) fail('Scegli Invia pratica oppure Compilazione standard');
    return value;
  }
  function validatePayload(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Dati subentro non validi');
    const tipo = validateType(raw.tipo);
    if (tipo === TYPE_1928) fail('Il percorso 1928 richiede solo gli allegati');
    const privateCedente = !usesBusinessIdentifier('cedente', tipo);
    const businessSubentrante = usesBusinessIdentifier('subentrante', tipo);
    if (tipo !== TYPE && typeof raw.mortis_causa !== 'boolean') fail('Indica Sì oppure No per il subentro mortis causa');
    if (!privateCedente && !['impresa', 'professionista'].includes(raw.cedente_tipo)) fail('Seleziona impresa oppure libero professionista/artigiano');
    if (businessSubentrante && !['impresa', 'professionista'].includes(raw.subentrante_tipo)) fail('Per il cessionario, seleziona impresa oppure libero professionista/artigiano');
    if (!['iban', 'bollettino'].includes(raw.pagamento)) fail('Pagamento non valido: scegli IBAN o bollettino postale');
    if (!['M', 'F'].includes(raw.subentrante_sesso)) fail('Seleziona il sesso del subentrante');
    const result = { tipo, ...(!privateCedente ? { cedente_tipo: raw.cedente_tipo } : {}),
      ...(tipo !== TYPE ? { mortis_causa: raw.mortis_causa } : {}),
      pagamento: raw.pagamento, subentrante_sesso: raw.subentrante_sesso };
    const groups = ['generale', 'cedente', 'subentrante', 'firma'];
    if (!privateCedente && raw.cedente_tipo === 'impresa') groups.push('impresa');
    if (businessSubentrante) {
      result.subentrante_tipo = raw.subentrante_tipo;
      groups.push('subentrante_business');
      if (raw.subentrante_tipo === 'impresa') groups.push('subentrante_impresa');
    }
    if (raw.pagamento === 'iban') groups.push('banca', 'sottoscrittore', 'conto');
    if (result.mortis_causa) groups.push('mortis');
    for (const group of groups) {
      for (const field of FIELDS[group]) {
        const [key] = field;
        if (privateCedente && key === 'cedente_partita_iva') continue;
        result[key] = fieldValue(raw, field, result.mortis_causa && key === 'cedente_telefono' ? true : field[4]);
      }
    }
    if (tipo !== TYPE) {
      validateSearchIdentifier('cedente', result.cedente_codice_fiscale, PRIVATE_TYPE);
      validateSearchIdentifier('subentrante', result.subentrante_codice_fiscale, PRIVATE_TYPE);
      if ((!businessSubentrante || result.mortis_causa) && result.cedente_codice_fiscale === result.subentrante_codice_fiscale) {
        fail('Cedente e cessionario devono avere codici fiscali diversi');
      }
    }
    if (tipo === BUSINESS_TYPE && result.cedente_partita_iva === result.subentrante_partita_iva) {
      fail('Cedente e cessionario devono avere partite IVA diverse');
    }
    if (result.subentrante_documento_rilascio < result.subentrante_data_nascita) fail('Il rilascio del documento precede la nascita');
    const maxNumeri = result.mortis_causa ? MAX_NUMERI_MORTIS : MAX_NUMERI;
    if (!Array.isArray(raw.numeri) || !raw.numeri.length || raw.numeri.length > maxNumeri) fail(`Inserisci da 1 a ${maxNumeri} numeri mobile`);
    result.numeri = raw.numeri.map(value => phone(value, 'Numero da trasferire', true));
    if (new Set(result.numeri).size !== result.numeri.length) fail('Lo stesso numero mobile è presente più volte');
    result.consensi = {};
    for (const key of Object.keys(CONSENSI)) {
      if (typeof raw.consensi?.[key] !== 'boolean') fail(`Indica Sì oppure No per: ${CONSENSI[key]}`);
      result.consensi[key] = raw.consensi[key];
    }
    return result;
  }
  return Object.freeze({ TYPE, PRIVATE_TYPE, TO_BUSINESS_TYPE, BUSINESS_TYPE, TYPE_1928, TYPE_LABELS, MAX_NUMERI, MAX_NUMERI_MORTIS, MAX_DOCUMENTI, FIELDS, CONSENSI, DOCUMENTI,
    documentGroups, usesBusinessIdentifier, validatePayload, validateMode, validateType, validateSearchIdentifier, ValidationError });
});
