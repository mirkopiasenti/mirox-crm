const Pda = require('../../../js/vendita-pda-core');

function duplicateError(duplicate = null) {
  return Object.assign(new Error('Attenzione, questo contratto e gia stato caricato.'), {
    statusCode: 409, error_code: 'contratto_duplicato', duplicate
  });
}

async function findDuplicate(supabase, value, excludeId = null) {
  const normalized = Pda.code(value);
  if (!normalized) throw Object.assign(new Error('Codice contratto obbligatorio o non valido'), { statusCode: 400 });
  let query = supabase.from('vendita_contratti')
    .select('id, codice_contratto, data_contratto, categoria_snapshot, operatore_id')
    .eq('codice_contratto', normalized);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.limit(1);
  if (error) throw error;
  const row = data?.[0] || null;
  if (!row?.operatore_id) return row;
  // operatore_id non ha una relazione PostgREST verso profili: lookup esplicito.
  const { data: operator, error: operatorError } = await supabase.from('profili')
    .select('nome').eq('id', row.operatore_id).maybeSingle();
  return { ...row, operatore: operatorError ? { nome: 'Operatore non disponibile' } : operator };

}

function isDuplicateViolation(error) {
  return error?.code === '23505' && /vendita_contratti_codice_pda_unique/.test(
    String(error.message || '') + String(error.details || ''));
}

async function assertAvailable(supabase, code, excludeId) {
  const duplicate = await findDuplicate(supabase, code, excludeId);
  if (duplicate) throw duplicateError(duplicate);
}

module.exports = { ...Pda, duplicateError, findDuplicate, assertAvailable, isDuplicateViolation };
