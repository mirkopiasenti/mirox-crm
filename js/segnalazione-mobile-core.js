(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiroxSegnalazioneMobileCore = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MOTIVI = ['Reload Forever', 'Professional Cloud', 'Altro'];
  function validate(input) {
    if (!input || !MOTIVI.includes(input.motivo)) throw new Error('Seleziona il motivo della segnalazione.');
    if (input.note != null && typeof input.note !== 'string') throw new Error('Note non valide.');
    const note = (input.note || '').trim();
    if (note.length > 4000) throw new Error('Le note possono contenere al massimo 4000 caratteri.');
    if (input.motivo === 'Altro' && !note) throw new Error('Inserisci le note per il motivo Altro.');
    return { motivo: input.motivo, note };
  }
  function gestione(motivo) {
    return motivo === 'Altro' ? { gestione_pratica: 'Interna negozio', tipo_ask: null }
      : { gestione_pratica: 'ASK', tipo_ask: 'Normalizzazione' };
  }
  function isMobile(category) { return String(category || '').trim().toLowerCase() === 'mobile'; }
  return { MOTIVI, validate, gestione, isMobile };
});
