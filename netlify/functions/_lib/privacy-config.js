'use strict';

// Le due modalita' hanno testi e layout distinti, ma finalita', basi giuridiche,
// conservazione e perimetro del consenso equivalenti. Ogni modifica sostanziale
// richiede una nuova versione: i documenti precedenti restano evidenza storica
// e non vengono riutilizzati come informativa corrente.
const INFORMATIVA_VERSIONE_CARTACEO = 'v4_2026_07_26';
const INFORMATIVA_VERSIONE_DIGITALE = 'v4_2026_07_26_dig';
const INFORMATIVE_VERSIONI_CORRENTI = Object.freeze([
    INFORMATIVA_VERSIONE_CARTACEO,
    INFORMATIVA_VERSIONE_DIGITALE
]);

function informativaVersionePerModalita(modalita) {
    return modalita === 'cartaceo'
        ? INFORMATIVA_VERSIONE_CARTACEO
        : INFORMATIVA_VERSIONE_DIGITALE;
}

module.exports = {
    INFORMATIVA_VERSIONE_CARTACEO,
    INFORMATIVA_VERSIONE_DIGITALE,
    INFORMATIVE_VERSIONI_CORRENTI,
    informativaVersionePerModalita
};
