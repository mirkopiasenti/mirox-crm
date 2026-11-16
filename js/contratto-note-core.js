(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiroxContrattoNoteCore = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_LENGTH = 4000;
  function normalize(value) {
    if (typeof value !== 'string') throw new Error('Inserisci il testo della nota.');
    const text = value.trim();
    if (!text) throw new Error('Inserisci il testo della nota.');
    if (text.length > MAX_LENGTH) throw new Error('La nota può contenere al massimo 4000 caratteri.');
    if (text.includes('\u0000')) throw new Error('La nota contiene un carattere non valido.');
    return text;
  }
  return { MAX_LENGTH, normalize };
});
