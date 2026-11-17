(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxFisso = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  const POS = '9001415852';
  const BASES = ['FTTC 100','FTTC 200','FWA Outdoor','FWA Indoor','FTTH Aree Bianche','FTTH OF-FWCOP'];
  const FIELDS = ['tecnologia_fisso','professional_box','codice_cliente_fisso','codice_pos_fisso'];
  const bool = v => v === true || v === 'true' ? true : v === false || v === 'false' ? false : null;
  const isFixed = c => String(c || '').trim().toLowerCase() === 'fisso';
  const business = c => String(c || '').trim().toLowerCase() === 'business';
  const base = v => String(v || '').replace(/ - Professional Box$/, '');
  const options = cluster => [...BASES, ...(!business(cluster) ? ['FWA Voce'] : [])];
  const label = (technology, box) => technology ? base(technology) + (box === true ? ' - Professional Box' : '') : null;
  const customerCode = v => typeof v === 'string' && /^[A-Z0-9.][A-Z0-9./-]{0,79}$/i.test(v.replace(/\s/g,'')) && /\d/.test(v) ? v.replace(/\s/g,'').toUpperCase() : null;
  function normalize(data = {}) {
    const box = bool(data.professional_box);
    return { tecnologia_fisso: typeof data.tecnologia_fisso === 'string' && data.tecnologia_fisso.trim() ? label(data.tecnologia_fisso.trim(),box) : null,
      professional_box: box, codice_cliente_fisso: customerCode(data.codice_cliente_fisso),
      codice_pos_fisso: data.codice_pos_fisso === POS ? POS : null };
  }
  function validate(data = {}, category, cluster, { required = false, allowRetired = false } = {}) {
    const out = normalize(data);
    if (!isFixed(category)) {
      if (FIELDS.some(k => data[k] != null && data[k] !== '')) throw new Error('Dati Fisso non ammessi per questa categoria');
      return Object.fromEntries(FIELDS.map(k=>[k,null]));
    }
    if (required || out.tecnologia_fisso) {
      if (!options(cluster).includes(base(out.tecnologia_fisso)) && !(allowRetired && base(out.tecnologia_fisso)==='FWA Voce')) throw new Error('Seleziona una tecnologia Fisso valida');
      if (business(cluster) && out.professional_box === null) throw new Error('Seleziona Professional Box: Si oppure No');
      if (!business(cluster) && out.professional_box === true) throw new Error('Professional Box ammesso solo per Fisso Business');
      if (!out.codice_cliente_fisso) throw new Error('Codice cliente Fisso obbligatorio o non valido');
      out.professional_box = business(cluster) ? out.professional_box : false;
      out.tecnologia_fisso = label(out.tecnologia_fisso,out.professional_box);
      out.codice_pos_fisso = POS;
    }
    return out;
  }
  // La rete commerciale FTTH e la velocita 2,5 non distinguono piu le reti fisiche.
  function recognize(offer, modemCredit) {
    const name = String(offer || '').normalize('NFKC').replace(/\s+/g,' ').trim();
    if (/^Internet 100(?: Professional)?$/i.test(name)) return 'FTTC 100';
    if (/^Internet 200(?: Professional)?$/i.test(name)) return 'FTTC 200';
    if (/^Voce Casa$/i.test(name)) return 'FWA Voce';
    if (/^Super Fibra(?: Professional)? su Aree Bianche$/i.test(name)) return 'FTTH Aree Bianche';
    if (/^Super Fibra(?: Professional)?(?: 2[,.]5 Giga)?$/i.test(name)) return 'FTTH OF-FWCOP';
    if (/^Super Internet (?:Casa|Professional) 5G$/i.test(name)) return modemCredit === true ? 'FWA Indoor' : modemCredit === false ? 'FWA Outdoor' : null;
    return null;
  }
  function legacyTechnology(v) {
    const name = base(v);
    if (/^FTTC/.test(name)) return 'FTTC';
    if (name === 'FWA Indoor') return 'FWA IN';
    if (name === 'FWA Outdoor') return 'FWA OUT';
    if (name === 'FWA Voce') return 'FWA VOCE';
    if (/^FTTH/.test(name)) return 'FTTH_OF';
    return null;
  }
  // I cataloghi e le relative regole/punteggi restano quelli esistenti.
  function offerName(technology, box, cluster) {
    const name = base(technology);
    if (business(cluster) && box === true) return /^FWA/.test(name) ? 'FWA - Fritz Box' : 'FTTH - Fritz Box';
    if (/^FTTC/.test(name)) return 'FTTC';
    if (/^FTTH/.test(name)) return 'FTTH';
    if (name === 'FWA Voce') return 'FWA - VOCE';
    if (name === 'FWA Indoor' && !business(cluster)) return 'FWA - INDOOR';
    return 'FWA - OUTDOOR';
  }
  function findOffer(offers, technology, box, cluster) {
    const matches = offers.filter(o => o.cluster_cliente === cluster && o.nome_offerta === offerName(technology,box,cluster));
    return matches.length === 1 ? matches[0] : null;
  }
  return { POS, BASES, FIELDS, bool, isFixed, business, base, options, label, normalize, validate, recognize, legacyTechnology, offerName, findOffer };
});
