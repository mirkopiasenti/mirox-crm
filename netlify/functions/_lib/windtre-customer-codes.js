'use strict';
const Pda = require('../../../js/vendita-pda-core');
const TABLE = 'anagrafica_codici_cliente_windtre';
// Append idempotente: nessuna sostituzione o UPDATE, anche con richieste concorrenti.
async function saveCodes(db, anagraficaId, values) {
  const codes = Pda.customerCodes(values || []);
  if (!codes.length) return;
  const { error } = await db.from(TABLE).upsert(codes.map(codice_cliente => ({
    anagrafica_id: anagraficaId, codice_cliente
  })), { onConflict: 'anagrafica_id,codice_cliente', ignoreDuplicates: true });
  if (error) throw new Error('Registrazione codici cliente WindTre non riuscita');
}
module.exports = { saveCodes, TABLE };
