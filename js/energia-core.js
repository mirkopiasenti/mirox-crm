(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.MiroxEnergia = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const code = value => String(value ?? '').replace(/\s+/g, '').toUpperCase();
  const isPoint = value => /^(?:IT\d{3}E[A-Z0-9]{8,10}|\d{14})$/.test(value);
  const isEnergy = category => String(category ?? '').trim().toLowerCase() === 'energia';

  function confirmedPoint(first, second) {
    const point = code(first);
    return typeof first === 'string' && typeof second === 'string' && isPoint(point) && point === code(second) ? point : null;
  }

  return { code, isPoint, isEnergy, confirmedPoint };
});
