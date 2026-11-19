const { code, isPoint } = require('../../../js/energia-core');

const DUPLICATE_CODE = 'punto_energia_duplicato';

function duplicateError(message = 'Per questo POD/PDR è già stata caricata una pratica oggi.') {
  return Object.assign(new Error(message), {
    statusCode: 409, error_code: DUPLICATE_CODE
  });
}

function isDuplicateViolation(error) {
  return error?.code === '23505' && /vendita_energia_punto_giornaliero_unique|Per questo POD\/PDR è già stata caricata/.test(error.message || '');
}

async function assertAvailable(supabase, values) {
  const points = values.map(code);
  if (points.some(point => !isPoint(point))) {
    throw Object.assign(new Error('POD/PDR non valido.'), { statusCode: 400 });
  }
  if (new Set(points).size !== points.length) throw duplicateError();
  if (!points.length) return;
  const { data, error } = await supabase.rpc('vendita_energia_punto_caricato_oggi', { p_punti: points });
  if (error || typeof data !== 'boolean') throw new Error('Impossibile controllare se il POD/PDR è già stato caricato. Riprova.');
  if (data) throw duplicateError();
}

module.exports = { duplicateError, isDuplicateViolation, assertAvailable };
