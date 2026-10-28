(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxPda = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const FIELDS = ['codice_contratto', 'costo_offerta_mensile', 'portabilita',
    'numero_telefono', 'numero_provvisorio', 'numero_mnp', 'operatore_provenienza', 'professional_cloud', 'professional_cloud_gestione'];
  const MOBILE_FIELDS = FIELDS.slice(1, 7);
  const CLOUD_ACTIONS = ['Mantieni attiva', 'Richiedi disattivazione'];
  function code(value) {
    if (typeof value !== 'string') return null;
    const s = value.replace(/\s/g, '').toUpperCase();
    return /^[A-Z0-9][A-Z0-9/-]{0,79}$/.test(s) ? s : null;
  }
  // Codice cliente e codice contratto sono identificativi distinti, entrambi testuali.
  function customerCode(value, required = false) {
    const normalized = code(value);
    const parsed = normalized && /\d/.test(normalized) ? normalized : null;
    if (required && !parsed) throw new Error('Codice cliente WindTre obbligatorio o non valido: compilalo nei dati anagrafici');
    return parsed;
  }
  function customerCodes(values = []) {
    if (!Array.isArray(values) || values.length > 100) throw new Error('Elenco codici cliente non valido');
    return [...new Set(values.map(value => {
      const parsed = customerCode(value);
      if (!parsed) throw new Error('Codice cliente WindTre non valido');
      return parsed;
    }))];
  }
  function phone(value) {
    if (typeof value !== 'string') return null;
    let s = value.replace(/[\s().-]/g, '').replace(/^(?:\+39|0039)/, '');
    // Prefisso internazionale senza + solo se la lunghezza esclude un numero nazionale.
    if (/^393\d{8,9}$/.test(s)) s = s.slice(2);
    return /^3\d{8,9}$/.test(s) ? s : null;
  }
  function money(value) {
    if (value === null || value === undefined || value === '') return null;
    const s = String(value).trim().replace(',', '.');
    return /^\d{1,5}(?:\.\d{1,2})?$/.test(s) ? Number(s) : null;
  }
  function isPda(category) {
    return ['mobile', 'fisso', 'customer base'].includes(String(category || '').trim().toLowerCase());
  }
  function cloudScope(category, cluster) {
    return String(category || '').trim().toLowerCase() === 'mobile' && String(cluster || '').trim().toLowerCase() === 'business';
  }
  function validateCloud(input, category, cluster, required = false) {
    const out = normalize(input);
    const provided = value => value !== null && value !== undefined && value !== '';
    if (!cloudScope(category, cluster)) {
      if (provided(input.professional_cloud) || provided(input.professional_cloud_gestione)) throw new Error('Professional Cloud ammesso solo per Mobile Business');
      return out;
    }
    if (out.professional_cloud === null && (required || provided(input.professional_cloud))) throw new Error('Seleziona Professional Cloud: Si oppure No');
    if (out.professional_cloud === true && !CLOUD_ACTIONS.includes(out.professional_cloud_gestione)) throw new Error('Seleziona la gestione Professional Cloud');
    if (out.professional_cloud !== true && provided(input.professional_cloud_gestione)) throw new Error('Gestione Professional Cloud non valida senza opzione attiva');
    return out;
  }
  function normalize(input = {}) {
    return {
      codice_contratto: code(input.codice_contratto),
      professional_cloud: input.professional_cloud === true || input.professional_cloud === 'true' ? true : input.professional_cloud === false || input.professional_cloud === 'false' ? false : null,
      professional_cloud_gestione: typeof input.professional_cloud_gestione === 'string' ? input.professional_cloud_gestione.trim() || null : null,
      costo_offerta_mensile: money(input.costo_offerta_mensile),
      portabilita: input.portabilita === true || input.portabilita === 'true' ? true
        : input.portabilita === false || input.portabilita === 'false' ? false : null,
      numero_telefono: phone(input.numero_telefono),
      numero_provvisorio: phone(input.numero_provvisorio),
      numero_mnp: phone(input.numero_mnp),
      operatore_provenienza: typeof input.operatore_provenienza === 'string'
        ? input.operatore_provenienza.trim().slice(0, 100) || null : null
    };
  }
  function hasMobileData(input = {}) {
    return MOBILE_FIELDS.some(k => input[k] !== null && input[k] !== undefined && input[k] !== '');
  }
  function mobileOptionId(input = {}, options = [], catalogue = options) {
    const normalizeName = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const providerKey = value => {
      const name = normalizeName(value);
      if (/^iliad(?: |$)/.test(name)) return 'iliad';
      if (/^coop(?:voce| voce)?(?: |$)/.test(name)) return 'coop';
      if (/^poste(?:mobile| mobile|pay)?(?: |$)/.test(name)) return 'poste';
      if (/^tiscali(?: |$)/.test(name)) return 'tiscali';
      return name;
    };
    const port = normalize(input).portabilita;
    let matches = [];
    if (port === false) matches = options.filter(o => normalizeName(o.nome_opzione) === 'nessuna opzione');
    if (port === true) {
      const provider = providerKey(input.operatore_provenienza);
      if (!provider) return null;
      matches = catalogue.filter(o => {
        const name = String(o.nome_opzione || '');
        if (!/^mnp da seguenti operatori\b/.test(normalizeName(name))) return false;
        return (name.split(':')[1] || '').split(/[-,;/]/).some(label => {
          const listed = providerKey(label);
          return listed && (provider === listed || provider.startsWith(listed + ' '));
        });
      });
      if (!matches.length) matches = options.filter(o => normalizeName(o.nome_opzione) === 'mnp');
      else matches = matches.filter(o => options.some(allowed => allowed.id === o.id));
    }
    return matches.length === 1 ? matches[0].id : null;
  }
  function validateMobileNumbers(input) {
    const out = normalize(input);
    if (out.portabilita === null) throw new Error('Seleziona nuovo numero o portabilita');
    if (!out.numero_telefono) throw new Error(out.portabilita ? 'Numero da portare (MNP) obbligatorio o non valido' : 'Numero di cellulare obbligatorio o non valido');
    if (out.portabilita) {
      if (!out.numero_provvisorio) throw new Error('Numero provvisorio obbligatorio o non valido');
      if (!out.numero_mnp || out.numero_mnp !== out.numero_telefono) throw new Error('Numero MNP non coerente con il numero da portare');
      if (!out.operatore_provenienza) throw new Error('Operatore di provenienza obbligatorio');
    }
    return out;
  }
  function validate(input, category, options = {}) {
    const out = validateCloud(input, category, options.cluster, options.requireCloud === true);
    const name = String(category || '').trim().toLowerCase();
    const requireCode = options.requireCode !== false && isPda(name);
    if ((requireCode || input.codice_contratto) && !out.codice_contratto) {
      throw new Error('Codice contratto obbligatorio o non valido');
    }
    if (!isPda(name)) {
      if (out.codice_contratto) throw new Error('Codice PDA non ammesso per questa categoria');
    }
    if (name !== 'mobile') {
      FIELDS.slice(1).forEach(k => { out[k] = null; });
      return out;
    }
    if (options.allowLegacy && !hasMobileData(input)) return out;
    if (out.costo_offerta_mensile === null) throw new Error('Costo mensile offerta obbligatorio o non valido');
    validateMobileNumbers(out);
    if (!out.portabilita) {
      out.numero_provvisorio = null;
      out.numero_mnp = null;
      out.operatore_provenienza = null;
    }
    return out;
  }
  return { FIELDS, CLOUD_ACTIONS, cloudScope, validateCloud, code, customerCode, customerCodes, phone, money, isPda, normalize, hasMobileData, mobileOptionId, validateMobileNumbers, validate };
});
