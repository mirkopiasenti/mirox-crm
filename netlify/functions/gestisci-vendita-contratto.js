const Pda = require('./_lib/pda-contract');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const {
  assertPersistedContractScores,
  loadAnnualInsuranceBonus,
  parseRequiredScore
} = require('./_lib/score-integrity');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTRACT_FIELDS = new Set([
  ...Pda.FIELDS,
  'data_contratto',
  'operatore_id',
  'categoria_id',
  'offerta_id',
  'opzione_id',
  'reload_id',
  'tipo_attivazione',
  'apri_chiudi',
  'intestatario',
  'switch_sim',
  'modalita_pagamento',
  'dispositivo_associato',
  'imei',
  'fascia_prezzo',
  'tipo_acquisto',
  'finanziaria',
  'kolme',
  'smartphone_reload',
  'smartphone_reload_modalita',
  'pod_pdr',
  'numero_contratto_energia',
  'ex_fornitore',
  'prezzo_fisso',
  'convergenza',
  'reload_exchange',
  'reload_forever',
  'codice_rivenditore'
]);
const ANAGRAFICA_FIELDS = new Set([
  'ragione_sociale',
  'nome_referente',
  'cellulare',
  'provincia',
  'comune',
  'via',
  'civico'
]);
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function isUuid(value) {
  return UUID_REGEX.test(String(value || ''));
}

function pickAllowed(source, allowed) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key))
  );
}

function canonicalProfileId(auth) {
  const value = auth?.profilo?.alias_di || auth?.profilo?.id || auth?.user?.id;
  return isUuid(value) ? String(value).toLowerCase() : null;
}

async function loadCatalogRow(supabase, table, id, columns) {
  if (!id) return null;
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Voce catalogo non trovata in ${table}`);
  return data;
}

async function deriveCatalogSnapshots(supabase, current, patch) {
  const result = {};
  const categoriaChanged =
    Object.prototype.hasOwnProperty.call(patch, 'categoria_id')
    && patch.categoria_id !== current.categoria_id;
  const opzioneChanged =
    Object.prototype.hasOwnProperty.call(patch, 'opzione_id')
    && patch.opzione_id !== current.opzione_id;
  let finalCategoriaNome = current.categoria_snapshot;

  if (categoriaChanged) {
    const categoria = await loadCatalogRow(supabase, 'vendita_categorie', patch.categoria_id, 'id, nome');
    result.categoria_snapshot = categoria?.nome || null;
    finalCategoriaNome = result.categoria_snapshot;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'offerta_id')
      && patch.offerta_id !== current.offerta_id) {
    const offerta = await loadCatalogRow(
      supabase,
      'vendita_offerte',
      patch.offerta_id,
      'id, nome_offerta, punteggio_gara, punteggio_extra_gara'
    );
    result.nome_offerta_snapshot = offerta?.nome_offerta || null;
    result.punteggio_gara_offerta = parseRequiredScore(
      offerta?.punteggio_gara,
      'punteggio_gara offerta'
    );
    result.punteggio_extra_gara_offerta = parseRequiredScore(
      offerta?.punteggio_extra_gara,
      'punteggio_extra_gara offerta'
    );
  }

  // Il bonus Annuale vive nello snapshot opzione, non nel catalogo. Perciò
  // si ricalcola il componente anche quando cambia soltanto la categoria:
  // entrando/uscendo da Assicurazioni il bonus va aggiunto/rimosso.
  if (opzioneChanged || categoriaChanged) {
    const finalOpzioneId = opzioneChanged ? patch.opzione_id : current.opzione_id;
    if (!finalOpzioneId) {
      result.nome_opzione_snapshot = null;
      result.punteggio_gara_opzione = 0;
      result.punteggio_extra_gara_opzione = 0;
    } else {
      const opzione = await loadCatalogRow(
        supabase,
        'vendita_opzioni',
        finalOpzioneId,
        'id, nome_opzione, punteggio_gara, punteggio_extra_gara'
      );
      result.nome_opzione_snapshot = opzione?.nome_opzione || null;
      result.punteggio_gara_opzione = parseRequiredScore(
        opzione?.punteggio_gara,
        'punteggio_gara opzione'
      );
      result.punteggio_extra_gara_opzione = parseRequiredScore(
        opzione?.punteggio_extra_gara,
        'punteggio_extra_gara opzione'
      );
    }

    if (
      String(finalCategoriaNome || '').trim().toLowerCase() === 'assicurazioni'
      && current.ricorrenza_assicurazione === 'Annuale'
    ) {
      const bonus = await loadAnnualInsuranceBonus(supabase);
      result.punteggio_gara_opzione = Number(
        (result.punteggio_gara_opzione + bonus).toFixed(2)
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'reload_id')
      && patch.reload_id !== current.reload_id) {
    const reload = await loadCatalogRow(supabase, 'vendita_reload', patch.reload_id, 'id, nome');
    result.nome_reload_snapshot = reload?.nome || null;
  }

  return result;
}

async function updateContract({ supabase, auth, body }) {
  const contrattoId = body.contratto_id;
  const mode = body.mode;
  if (!isUuid(contrattoId)) {
    return response(400, { success: false, error: 'contratto_id non valido' });
  }
  if (!['save', 'verify', 'reopen'].includes(mode)) {
    return response(400, { success: false, error: 'Modalità aggiornamento non valida' });
  }

  if (mode === 'verify') {
    const cfg = await supabase.from('vendita_verifica_config').select('modalita').eq('id', true).maybeSingle();
    if (cfg.error && !['42P01', 'PGRST205'].includes(cfg.error.code)) throw cfg.error;
    if (cfg.data?.modalita === 'attiva') return response(409, { success: false, error: 'La conferma è gestita dalla verifica automatica. Salva le correzioni per avviare il riesame.' });
  }

  const { data: current, error: loadError } = await supabase
    .from('vendita_contratti')
    .select(`
      id, anagrafica_id, pratica_id, stato_controllo, updated_at,
      categoria_id, categoria_snapshot, offerta_id, opzione_id, reload_id,
      ricorrenza_assicurazione, codice_contratto, costo_offerta_mensile, portabilita,
      numero_telefono, numero_provvisorio, numero_mnp, operatore_provenienza,
      punteggio_gara_offerta, punteggio_gara_opzione,
      punteggio_extra_gara_offerta, punteggio_extra_gara_opzione
    `)
    .eq('id', contrattoId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!current) return response(404, { success: false, error: 'Contratto non trovato' });
  if (body.expected_updated_at && body.expected_updated_at !== current.updated_at) {
    return response(409, { success: false, error: 'Il contratto è cambiato durante la consultazione. Riapri il dettaglio prima di salvare.' });
  }

  let patch = {};
  let snapshotPatch = {};
  if (mode === 'reopen') {
    patch = {
      stato_controllo: 'da_controllare',
      controllato_da: null,
      controllato_at: null
    };
  } else {
    patch = pickAllowed(body.contratto, CONTRACT_FIELDS);
    try {
      const finalCategory = patch.categoria_id && patch.categoria_id !== current.categoria_id
        ? (await loadCatalogRow(supabase, 'vendita_categorie', patch.categoria_id, 'id, nome')).nome
        : current.categoria_snapshot;
      const pdaPatch = Pda.validate({ ...current, ...patch }, finalCategory,
        { requireCode: Boolean(current.codice_contratto), allowLegacy: !Pda.hasMobileData(current) });
      Object.assign(patch, pdaPatch);
      if (pdaPatch.codice_contratto) await Pda.assertAvailable(supabase, pdaPatch.codice_contratto, current.id);
    } catch (error) {
      if (error.statusCode === 409) throw error;
      if (/obbligatorio|non valido|coerente|Seleziona|ammesso/.test(error.message)) error.statusCode = 400;
      throw error;
    }
    snapshotPatch = await deriveCatalogSnapshots(supabase, current, patch);
    patch = { ...patch, ...snapshotPatch };

    if (mode === 'verify') {
      const controllatoDa = canonicalProfileId(auth);
      if (!controllatoDa) {
        return response(500, { success: false, error: 'Profilo autenticato privo di un identificativo valido' });
      }
      patch.stato_controllo = 'controllato';
      patch.controllato_da = controllatoDa;
      patch.controllato_at = new Date().toISOString();
    }
  }

  const updatedBy = canonicalProfileId(auth);
  if (!updatedBy) {
    return response(500, { success: false, error: 'Profilo autenticato privo di un identificativo valido' });
  }
  patch.updated_by = updatedBy;

  if (patch.codice_rivenditore
      && !['9001415852', '9000822241'].includes(patch.codice_rivenditore)) {
    return response(400, { success: false, error: 'Codice rivenditore non valido' });
  }
  if (patch.data_contratto && Number.isNaN(Date.parse(patch.data_contratto))) {
    return response(400, { success: false, error: 'Data contratto non valida' });
  }

  const anagraficaPatch = mode === 'reopen'
    ? {}
    : pickAllowed(body.anagrafica, ANAGRAFICA_FIELDS);
  if (Object.keys(anagraficaPatch).length) {
    const { error: anagraficaError } = await supabase
      .from('anagrafica')
      .update(anagraficaPatch)
      .eq('id', current.anagrafica_id);
    if (anagraficaError) throw anagraficaError;
  }

  let updateQuery = supabase
    .from('vendita_contratti')
    .update(patch)
    .eq('id', contrattoId);
  if (current.updated_at) updateQuery = updateQuery.eq('updated_at', current.updated_at);
  const { data: contratto, error: updateError } = await updateQuery
    .select('*')
    .maybeSingle();
  if (updateError) throw updateError;
  if (!contratto) return response(409, { success: false, error: 'Il contratto è stato modificato da un altro processo. Riapri il dettaglio.' });

  assertPersistedContractScores(contratto, {
    context: `vendita_contratti.${contrattoId}`,
    expectedComponents: {
      punteggio_gara_offerta:
        snapshotPatch.punteggio_gara_offerta ?? current.punteggio_gara_offerta,
      punteggio_gara_opzione:
        snapshotPatch.punteggio_gara_opzione ?? current.punteggio_gara_opzione,
      punteggio_extra_gara_offerta:
        snapshotPatch.punteggio_extra_gara_offerta ?? current.punteggio_extra_gara_offerta,
      punteggio_extra_gara_opzione:
        snapshotPatch.punteggio_extra_gara_opzione ?? current.punteggio_extra_gara_opzione
    }
  });

  return response(200, { success: true, contratto });
}

async function updatePda({ supabase, auth, body }) {
  if (!isUuid(body.contratto_id)) return response(400, { success: false, error: 'contratto_id non valido' });
  const { data: current, error } = await supabase.from('vendita_contratti')
    .select('*').eq('id', body.contratto_id).maybeSingle();
  if (error) throw error;
  if (!current) return response(404, { success: false, error: 'Contratto non trovato' });
  if (!Pda.isPda(current.categoria_snapshot)) return response(400, { success: false, error: 'Categoria senza PDA' });
  if (current.updated_at && body.expected_updated_at !== current.updated_at) {
    return response(409, { success: false, error: 'Dati modificati da un altro operatore. Riapri il contratto e riprova.' });
  }
  let patch;
  try {
    patch = Pda.validate({ ...current, ...pickAllowed(body.contratto, new Set(Pda.FIELDS)) },
      current.categoria_snapshot, { requireCode: Boolean(current.codice_contratto), allowLegacy: !Pda.hasMobileData(current) });
  } catch (e) { return response(400, { success: false, error: e.message }); }
  if (patch.codice_contratto) await Pda.assertAvailable(supabase, patch.codice_contratto, current.id);
  patch.updated_by = canonicalProfileId(auth);
  let update = supabase.from('vendita_contratti').update(patch).eq('id', current.id);
  if (current.updated_at) update = update.eq('updated_at', current.updated_at);
  const { data: contratto, error: updateError } = await update.select('*').maybeSingle();
  if (updateError) throw updateError;
  if (!contratto) return response(409, { success: false, error: 'Dati modificati da un altro operatore. Riapri il contratto e riprova.' });
  return response(200, { success: true, contratto });
}

async function deleteDocument({ supabase, body }) {
  const documentoId = body.documento_id;
  if (!isUuid(documentoId)) {
    return response(400, { success: false, error: 'documento_id non valido' });
  }

  const { data: documento, error: loadError } = await supabase
    .from('vendita_documenti')
    .select('id, pratica_id, storage_bucket, storage_path')
    .eq('id', documentoId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!documento) return response(404, { success: false, error: 'Documento non trovato' });
  if (documento.storage_bucket !== 'contratti-vendita' || !documento.storage_path) {
    return response(409, { success: false, error: 'Documento non eliminabile da questo endpoint' });
  }

  const { data: pratica, error: praticaError } = await supabase
    .from('vendita_pratiche')
    .select('id, stato_pratica')
    .eq('id', documento.pratica_id)
    .maybeSingle();
  if (praticaError) throw praticaError;
  if (!pratica || pratica.stato_pratica !== 'inviata') {
    return response(409, { success: false, error: 'È possibile rimuovere allegati solo da pratiche inviate' });
  }

  const { error: storageError } = await supabase
    .storage
    .from(documento.storage_bucket)
    .remove([documento.storage_path]);
  if (storageError) throw storageError;

  const { error: deleteError } = await supabase
    .from('vendita_documenti')
    .delete()
    .eq('id', documento.id);
  if (deleteError) throw deleteError;

  return response(200, { success: true });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const supabase = getAdminClient();
  if (!supabase) {
    return response(500, { success: false, error: 'Configurazione Supabase server incompleta' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return response(400, { success: false, error: 'Body JSON non valido' });
  }

  try {
    if (body.action === 'check_codice') {
      const duplicate = await Pda.findDuplicate(supabase, body.codice_contratto);
      return response(200, { success: true, duplicate });
    }
    if (body.action === 'update_pda') return await updatePda({ supabase, auth, body });
    if (body.action === 'update') {
      return await updateContract({ supabase, auth, body });
    }
    if (body.action === 'delete_document') {
      return await deleteDocument({ supabase, body });
    }
    return response(400, { success: false, error: 'Action non valida' });
  } catch (error) {
    if (Pda.isDuplicateViolation(error)) error = Pda.duplicateError();
    return response(error.statusCode || 500, {
      error_code: error.error_code || null,
      duplicate: error.duplicate || null,
      success: false,
      error: error?.message || 'Operazione sul contratto non riuscita'
    });
  }
};

exports._test = {
  updatePda,
  assertPersistedContractScores,
  canonicalProfileId,
  deriveCatalogSnapshots,
  isUuid,
  loadAnnualInsuranceBonus,
  parseRequiredScore,
  pickAllowed
};

const contractHandler = exports.handler;
exports.handler = async event => {
  const result = await contractHandler(event);
  if (event.httpMethod === 'POST' && result.statusCode >= 200 && result.statusCode < 300) {
    let action, contractId;
    try { const payload = JSON.parse(event.body || '{}'); action = payload.action; contractId = payload.contratto_id; } catch { /* Already validated by the handler. */ }
    if (['update', 'update_pda', 'delete_document'].includes(action)) {
      try {
        const worker = require('./_lib/verifica-worker'), db = getAdminClient();
        if (contractId) await worker.changed(db, contractId);
        await worker.wake(db);
      } catch { /* Durable contract/document changes are recovered by the scheduled worker. */ }
    }
  }
  return result;
};
