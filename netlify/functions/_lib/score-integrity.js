const SCORE_EPSILON = 0.000001;

const COMPONENT_FIELDS = [
  'punteggio_gara_offerta',
  'punteggio_gara_opzione',
  'punteggio_extra_gara_offerta',
  'punteggio_extra_gara_opzione'
];

function parseRequiredScore(value, label) {
  // Number(null) e Number('') restituiscono 0: senza questa guardia una
  // configurazione incompleta diventerebbe silenziosamente uno snapshot zero.
  if (value === null || value === undefined || value === '') {
    throw new Error(
      `Configurazione non valida: ${label} mancante nel catalogo (null/vuoto). Ricarica la pagina e riprova.`
    );
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Configurazione non valida: ${label} non numerico (${JSON.stringify(value)})`);
  }
  return parsed;
}

function sameScore(left, right) {
  return Math.abs(Number(left) - Number(right)) <= SCORE_EPSILON;
}

async function loadAnnualInsuranceBonus(supabase) {
  const { data, error } = await supabase
    .from('impostazioni')
    .select('valore')
    .eq('chiave', 'bonus_assicurazione_annuale')
    .maybeSingle();

  if (error) {
    throw new Error(`Configurazione bonus Assicurazione Annuale non leggibile: ${error.message}`);
  }

  const bonus = parseRequiredScore(
    data?.valore,
    'bonus_assicurazione_annuale'
  );
  if (bonus < 0) {
    throw new Error('Configurazione non valida: bonus_assicurazione_annuale non può essere negativo');
  }
  return bonus;
}

function assertPersistedContractScores(contract, options = {}) {
  const context = options.context || 'contratto';
  const expectedComponents = options.expectedComponents || null;
  const values = {};

  [
    ...COMPONENT_FIELDS,
    'punteggio_gara_totale',
    'punteggio_extra_gara_totale',
    'punteggio_offerta',
    'punteggio_opzione',
    'punteggio_extra',
    'punteggio_totale'
  ].forEach((field) => {
    values[field] = parseRequiredScore(contract?.[field], `${context}.${field}`);
  });

  if (expectedComponents) {
    COMPONENT_FIELDS.forEach((field) => {
      const expected = parseRequiredScore(
        expectedComponents[field],
        `${context}.atteso.${field}`
      );
      if (!sameScore(values[field], expected)) {
        throw new Error(
          `Integrità punteggio non rispettata per ${context}: ${field} salvato=${values[field]}, atteso=${expected}`
        );
      }
    });
  }

  const expectedGaraTotal =
    values.punteggio_gara_offerta + values.punteggio_gara_opzione;
  const expectedExtraTotal =
    values.punteggio_extra_gara_offerta + values.punteggio_extra_gara_opzione;

  const invariants = [
    ['punteggio_gara_totale', values.punteggio_gara_totale, expectedGaraTotal],
    ['punteggio_extra_gara_totale', values.punteggio_extra_gara_totale, expectedExtraTotal],
    ['punteggio_offerta', values.punteggio_offerta, values.punteggio_gara_offerta],
    ['punteggio_opzione', values.punteggio_opzione, values.punteggio_gara_opzione],
    ['punteggio_extra', values.punteggio_extra, 0],
    ['punteggio_totale', values.punteggio_totale, expectedGaraTotal]
  ];

  invariants.forEach(([field, actual, expected]) => {
    if (!sameScore(actual, expected)) {
      throw new Error(
        `Integrità punteggio non rispettata per ${context}: ${field}=${actual}, atteso=${expected}`
      );
    }
  });

  return values;
}

module.exports = {
  COMPONENT_FIELDS,
  assertPersistedContractScores,
  loadAnnualInsuranceBonus,
  parseRequiredScore,
  sameScore
};
