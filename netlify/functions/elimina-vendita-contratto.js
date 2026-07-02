const { requireAuth, getAdminClient } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_BUCKET = 'contratti-vendita';
const POST_VENDITA_TABLES = [
  'post_vendita_controllo_fissi',
  'post_vendita_controllo_lg',
  'post_vendita_controllo_assicurazioni',
  'post_vendita_controllo_allarmi'
];

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function readableError(error, fallback = 'Operazione non riuscita') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

function parseBody(event) {
  try {
    return JSON.parse(event.body || '{}');
  } catch (_) {
    return null;
  }
}

function addStorageTarget(targets, doc) {
  const path = String(doc?.storage_path || '').trim();
  if (!path) return;
  const bucket = String(doc?.storage_bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const key = `${bucket}::${path}`;
  targets.set(key, { bucket, path });
}

async function countPostVenditaRows(supabase, contrattoId) {
  const result = {};
  for (const table of POST_VENDITA_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('contratto_id', contrattoId);
    if (error) throw new Error(`Errore conteggio ${table}: ${readableError(error)}`);
    result[table] = count || 0;
  }
  return result;
}

async function removeStorageFiles(supabase, targets) {
  const grouped = new Map();
  for (const target of targets.values()) {
    if (!grouped.has(target.bucket)) grouped.set(target.bucket, []);
    grouped.get(target.bucket).push(target.path);
  }

  const warnings = [];
  let removed = 0;
  for (const [bucket, paths] of grouped.entries()) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) {
      warnings.push(`Storage ${bucket}: ${readableError(error)}`);
    } else {
      removed += paths.length;
    }
  }

  return { attempted: targets.size, removed, warnings };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const auth = await requireAuth(event, { adminOnly: true });
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const body = parseBody(event);
  if (!body) return response(400, { success: false, error: 'Body JSON non valido' });

  const contrattoId = String(body.contratto_id || '').trim();
  if (!UUID_RE.test(contrattoId)) {
    return response(400, { success: false, error: 'contratto_id non valido' });
  }

  const supabase = getAdminClient();
  if (!supabase) {
    return response(500, { success: false, error: 'Configurazione server incompleta' });
  }

  try {
    const { data: contratto, error: contrattoError } = await supabase
      .from('vendita_contratti')
      .select('id, pratica_id, anagrafica_id, categoria_snapshot, nome_offerta_snapshot, stato_controllo, data_contratto')
      .eq('id', contrattoId)
      .single();

    if (contrattoError || !contratto) {
      return response(404, { success: false, error: 'Contratto non trovato' });
    }

    const { data: reinserimenti, error: reinserimentiError } = await supabase
      .from('vendita_contratti')
      .select('id, nome_offerta_snapshot, data_contratto')
      .eq('reinserimento_di_contratto_id', contrattoId)
      .limit(5);

    if (reinserimentiError) throw new Error(readableError(reinserimentiError, 'Errore verifica reinserimenti collegati'));
    if ((reinserimenti || []).length > 0) {
      return response(409, {
        success: false,
        error: 'Questo contratto non può essere eliminato perché è usato come origine di un reinserimento. Elimina prima i reinserimenti collegati.'
      });
    }

    const { data: documentiContratto, error: documentiError } = await supabase
      .from('vendita_documenti')
      .select('id, storage_bucket, storage_path, file_name, tipo_documento')
      .eq('contratto_id', contrattoId);

    if (documentiError) throw new Error(readableError(documentiError, 'Errore lettura documenti collegati'));

    const { data: altriContratti, error: altriContrattiError } = await supabase
      .from('vendita_contratti')
      .select('id')
      .eq('pratica_id', contratto.pratica_id)
      .neq('id', contrattoId)
      .limit(1);

    if (altriContrattiError) throw new Error(readableError(altriContrattiError, 'Errore verifica pratica collegata'));
    const praticaVuotaDopoEliminazione = (altriContratti || []).length === 0;

    let documentiSoloPratica = [];
    if (praticaVuotaDopoEliminazione) {
      const { data, error } = await supabase
        .from('vendita_documenti')
        .select('id, storage_bucket, storage_path, file_name, tipo_documento')
        .eq('pratica_id', contratto.pratica_id)
        .is('contratto_id', null);
      if (error) throw new Error(readableError(error, 'Errore lettura documenti della pratica'));
      documentiSoloPratica = data || [];
    }

    const postVendita = await countPostVenditaRows(supabase, contrattoId);

    const storageTargets = new Map();
    (documentiContratto || []).forEach((doc) => addStorageTarget(storageTargets, doc));
    documentiSoloPratica.forEach((doc) => addStorageTarget(storageTargets, doc));

    const { count: contrattiEliminati, error: deleteContrattoError } = await supabase
      .from('vendita_contratti')
      .delete({ count: 'exact' })
      .eq('id', contrattoId);

    if (deleteContrattoError) {
      throw new Error(readableError(deleteContrattoError, 'Eliminazione contratto non riuscita'));
    }

    const dbWarnings = [];
    let praticaEliminata = false;
    if (praticaVuotaDopoEliminazione) {
      const { count, error } = await supabase
        .from('vendita_pratiche')
        .delete({ count: 'exact' })
        .eq('id', contratto.pratica_id);

      if (error) {
        dbWarnings.push(`Pratica ${contratto.pratica_id}: ${readableError(error)}`);
      } else {
        praticaEliminata = (count || 0) > 0;
      }
    }

    let logEliminati = 0;
    const { count: logContrattoCount, error: logContrattoError } = await supabase
      .from('vendita_log_modifiche')
      .delete({ count: 'exact' })
      .eq('tabella', 'vendita_contratti')
      .eq('record_id', contrattoId);

    if (logContrattoError) {
      dbWarnings.push(`Log contratto: ${readableError(logContrattoError)}`);
    } else {
      logEliminati += logContrattoCount || 0;
    }

    if (praticaEliminata) {
      const { count: logPraticaCount, error: logPraticaError } = await supabase
        .from('vendita_log_modifiche')
        .delete({ count: 'exact' })
        .eq('tabella', 'vendita_pratiche')
        .eq('record_id', contratto.pratica_id);

      if (logPraticaError) {
        dbWarnings.push(`Log pratica: ${readableError(logPraticaError)}`);
      } else {
        logEliminati += logPraticaCount || 0;
      }
    }

    const storage = await removeStorageFiles(supabase, storageTargets);

    return response(200, {
      success: true,
      deleted: {
        contratto: (contrattiEliminati || 0) > 0,
        pratica: praticaEliminata,
        documenti: (documentiContratto || []).length + documentiSoloPratica.length,
        post_vendita: postVendita,
        log_modifiche: logEliminati
      },
      storage,
      warnings: [...dbWarnings, ...storage.warnings]
    });
  } catch (error) {
    return response(500, {
      success: false,
      error: readableError(error, 'Errore eliminazione contratto')
    });
  }
};
