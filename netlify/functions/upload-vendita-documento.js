const Busboy = require('busboy');
const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const STORAGE_BUCKET = 'contratti-vendita';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_TYPES = new Set([
  'documento_identita',
  'contratto',
  'contratto_firmato',
  'copia_sim_mnp',
  'copia_bolletta',
  'altro'
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

function getHeader(headers, key) {
  if (!headers) return '';
  return headers[key] || headers[key.toLowerCase()] || headers[key.toUpperCase()] || '';
}

function sanitizeSegment(value, fallback = 'file') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return normalized || fallback;
}

function ensurePdfExtension(fileName) {
  const withoutExt = String(fileName || '').replace(/\.pdf$/i, '');
  return `${withoutExt}.pdf`;
}

function sanitizeFileName(fileName, fallbackBaseName = 'documento') {
  const base = String(fileName || '').replace(/\.pdf$/i, '');
  const cleanBase = sanitizeSegment(base, fallbackBaseName);
  return ensurePdfExtension(cleanBase);
}

function sanitizePath(basePath) {
  return String(basePath || '')
    .split(/[\\/]+/)
    .map((segment) => sanitizeSegment(segment))
    .filter(Boolean)
    .join('/');
}

/**
 * Evita che finisca per errore una cartella finale chiamata "file".
 * Esempio:
 * 2026/04/contratto_test/file
 * diventa:
 * 2026/04/contratto_test
 */
function removeAccidentalFileSegment(path) {
  return String(path || '').replace(/\/file$/i, '');
}

function normalizeBasePath({ praticaId, storageBasePath, nomeCartellaStorage }) {
  if (storageBasePath && String(storageBasePath).trim()) {
    const clean = removeAccidentalFileSegment(sanitizePath(storageBasePath));
    return clean ? `${clean}/` : '';
  }

  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');

  if (nomeCartellaStorage && String(nomeCartellaStorage).trim()) {
    const cleanFolderName = sanitizeSegment(nomeCartellaStorage, `pratica_${praticaId}`);
    return `${year}/${month}/${cleanFolderName}/`;
  }

  return `${year}/${month}/pratica_${sanitizeSegment(praticaId)}/`;
}

function resolveContractCategorySlug(fields = {}) {
  const categoriaRaw =
    fields.categoria ||
    fields.categoria_snapshot ||
    fields.nome_categoria ||
    '';

  const normalized = sanitizeSegment(categoriaRaw, '');

  if (!normalized) {
    return 'generico';
  }

  const categoryMap = {
    mobile: 'mobile',
    customer_base: 'customer_base',
    customerbase: 'customer_base',
    fisso: 'fisso',
    energia: 'energia',
    assicurazioni: 'assicurazioni',
    allarmi: 'allarmi'
  };

  return categoryMap[normalized] || normalized;
}

function suggestedFileName(tipoDocumento, fields) {
  const tipo = sanitizeSegment(tipoDocumento, 'documento');

  switch (tipo) {
    case 'documento_identita':
      return 'documento_identita.pdf';
    case 'contratto': {
      const categorySlug = resolveContractCategorySlug(fields);
      return `contratto_${categorySlug}.pdf`;
    }
    case 'contratto_firmato': {
      // PDA firmato dal cliente (firma cartacea). Affianca al contratto_<categoria>.pdf
      // gia' salvato in modalita' staging dallo step 1 del wizard.
      const categorySlug = resolveContractCategorySlug(fields);
      return `contratto_firmato_${categorySlug}.pdf`;
    }
    case 'copia_sim_mnp':
      return 'copia_sim_mnp.pdf';
    case 'copia_bolletta':
      return 'copia_bolletta.pdf';
    default:
      return `${tipo}.pdf`;
  }
}

function readMultipart(event) {
  return new Promise((resolve, reject) => {
    const contentType = getHeader(event.headers, 'content-type');

    if (!contentType || !contentType.toLowerCase().includes('multipart/form-data')) {
      reject(new Error('Content-Type non valido: usa multipart/form-data'));
      return;
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });
    const fields = {};
    let parsedFile = null;
    let fileTooLarge = false;

    busboy.on('field', (fieldName, value) => {
      fields[fieldName] = typeof value === 'string' ? value.trim() : value;
    });

    busboy.on('file', (fieldName, file, infoOrFilename, encodingMaybe, mimetypeMaybe) => {
      if (fieldName !== 'file') {
        file.resume();
        return;
      }

      // Ignora eventuali file extra: in questa API è previsto un solo PDF per richiesta.
      if (parsedFile) {
        file.resume();
        return;
      }

      let filename = '';
      let mimeType = '';

      if (infoOrFilename && typeof infoOrFilename === 'object') {
        filename = infoOrFilename.filename || '';
        mimeType = infoOrFilename.mimeType || '';
      } else {
        filename = infoOrFilename || '';
        mimeType = mimetypeMaybe || '';
      }

      const chunks = [];
      let size = 0;

      file.on('data', (chunk) => {
        size += chunk.length;

        if (size > MAX_FILE_SIZE_BYTES) {
          fileTooLarge = true;
          return;
        }

        chunks.push(chunk);
      });

      file.on('end', () => {
        parsedFile = {
          originalName: filename,
          mimeType: String(mimeType || '').toLowerCase(),
          size,
          buffer: Buffer.concat(chunks)
        };
      });
    });

    busboy.on('error', (error) => {
      reject(error);
    });

    busboy.on('finish', () => {
      if (!parsedFile) {
        reject(new Error('File PDF mancante'));
        return;
      }

      if (fileTooLarge || parsedFile.size > MAX_FILE_SIZE_BYTES) {
        reject(new Error('Il file supera il limite massimo di 20 MB'));
        return;
      }

      resolve({ fields, file: parsedFile });
    });

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'binary');

    busboy.end(bodyBuffer);
  });
}

function normalizeOptional(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function normalizeUuidOrNull(value) {
  const normalized = normalizeOptional(value);
  return normalized && UUID_REGEX.test(normalized) ? normalized.toLowerCase() : null;
}

function authenticatedUploaderId(auth) {
  return normalizeUuidOrNull(auth?.profilo?.alias_di)
    || normalizeUuidOrNull(auth?.profilo?.id)
    || normalizeUuidOrNull(auth?.user?.id);
}

function canManagePractice(auth, praticaRow) {
  if (auth?.profilo?.ruolo === 'admin') return true;
  const uploaderId = authenticatedUploaderId(auth);
  return Boolean(uploaderId && praticaRow?.operatore_id === uploaderId);
}

function canUploadIntoPractice(auth, praticaRow) {
  // Le pratiche inviate sono gestite dal modulo Verifica Contratti, accessibile
  // agli operatori attivi. Le bozze restano invece vincolate al proprietario.
  return praticaRow?.stato_pratica === 'inviata' || canManagePractice(auth, praticaRow);
}

function hasPdfSignature(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.subarray(0, 1024).includes(Buffer.from('%PDF-', 'ascii'));
}

function readableErrorMessage(error, fallback = 'Errore durante il caricamento documento') {
  if (!error) return fallback;

  const rawMessage = typeof error === 'string'
    ? error
    : error.message || error.error_description || error.details || fallback;

  if (/duplicate|already exists/i.test(rawMessage)) {
    return 'Esiste già un file con lo stesso nome nel percorso scelto';
  }

  return rawMessage;
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

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, {
      success: false,
      error: 'Variabili ambiente mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY'
    });
  }

  try {
    const { fields, file } = await readMultipart(event);

    const tempSessionId = normalizeOptional(fields.temp_session_id);
    const praticaId = normalizeOptional(fields.pratica_id);
    const contrattoId = normalizeOptional(fields.contratto_id);
    const anagraficaId = normalizeOptional(fields.anagrafica_id);
    const tipoDocumento = normalizeOptional(fields.tipo_documento);
    const uploadedBy = authenticatedUploaderId(auth);

    if (file.mimeType !== 'application/pdf' || !hasPdfSignature(file.buffer)) {
      return response(400, { success: false, error: 'File non valido: è consentito solo un PDF reale' });
    }

    if (!uploadedBy) {
      return response(500, { success: false, error: 'Profilo autenticato privo di un identificativo valido' });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Modalita' staging: PDA caricata PRIMA della creazione della pratica.
    // Salva il file in temp/<temp_session_id>/ senza creare record in vendita_documenti.
    // Il file verra' promosso a path definitivo da crea-vendita-pratica-carrello al submit.
    if (tempSessionId) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tempSessionId)) {
        return response(400, { success: false, error: 'temp_session_id non valido (formato UUID v4 atteso)' });
      }

      const requestedFileName = normalizeOptional(fields.file_name)
        || suggestedFileName(tipoDocumento || 'contratto', fields);
      const finalFileName = sanitizeFileName(requestedFileName, sanitizeSegment(tipoDocumento || 'documento', 'documento'));
      const storagePath = `temp/${tempSessionId}/${finalFileName}`;

      const { error: uploadError } = await supabase
        .storage
        .from(STORAGE_BUCKET)
        .upload(storagePath, file.buffer, { contentType: 'application/pdf', upsert: true });

      if (uploadError) {
        return response(500, {
          success: false,
          error: readableErrorMessage(uploadError, 'Upload staging non riuscito')
        });
      }

      return response(200, {
        success: true,
        staging: true,
        storage_bucket: STORAGE_BUCKET,
        storage_path: storagePath,
        file_name: finalFileName,
        file_size: file.size
      });
    }

    if (!praticaId) {
      return response(400, { success: false, error: 'Campo obbligatorio mancante: pratica_id' });
    }

    if (!anagraficaId) {
      return response(400, { success: false, error: 'Campo obbligatorio mancante: anagrafica_id' });
    }

    if (!tipoDocumento) {
      return response(400, { success: false, error: 'Campo obbligatorio mancante: tipo_documento' });
    }

    if (!DOCUMENT_TYPES.has(tipoDocumento)) {
      return response(400, { success: false, error: 'tipo_documento non valido' });
    }

    if (!normalizeUuidOrNull(praticaId) || !normalizeUuidOrNull(anagraficaId)) {
      return response(400, { success: false, error: 'pratica_id o anagrafica_id non valido' });
    }

    if (contrattoId && !normalizeUuidOrNull(contrattoId)) {
      return response(400, { success: false, error: 'contratto_id non valido' });
    }

    if (tipoDocumento !== 'documento_identita' && !contrattoId) {
      return response(400, { success: false, error: 'contratto_id obbligatorio per questo tipo di documento' });
    }

    const { data: praticaRow, error: praticaError } = await supabase
      .from('vendita_pratiche')
      .select('id, anagrafica_id, operatore_id, storage_base_path, nome_cartella_storage, stato_pratica')
      .eq('id', praticaId)
      .maybeSingle();

    if (praticaError) {
      return response(500, { success: false, error: readableErrorMessage(praticaError, 'Errore verifica pratica') });
    }
    if (!praticaRow) {
      return response(404, { success: false, error: 'Pratica non trovata' });
    }
    if (praticaRow.anagrafica_id !== anagraficaId) {
      return response(400, { success: false, error: 'anagrafica_id non coerente con la pratica' });
    }
    if (!canUploadIntoPractice(auth, praticaRow)) {
      return response(403, { success: false, error: 'Non puoi caricare documenti su una pratica creata da un altro operatore' });
    }
    if (!['bozza', 'inviata'].includes(praticaRow.stato_pratica)) {
      return response(409, { success: false, error: 'La pratica non accetta nuovi documenti nello stato corrente' });
    }

    let contrattoRow = null;
    if (contrattoId) {
      const { data, error } = await supabase
        .from('vendita_contratti')
        .select('id, pratica_id, anagrafica_id, categoria_snapshot')
        .eq('id', contrattoId)
        .maybeSingle();

      if (error) {
        return response(500, { success: false, error: readableErrorMessage(error, 'Errore verifica contratto') });
      }
      if (!data || data.pratica_id !== praticaId || data.anagrafica_id !== anagraficaId) {
        return response(400, { success: false, error: 'contratto_id non coerente con pratica e anagrafica' });
      }
      contrattoRow = data;
    }

    const requestedFileName = normalizeOptional(fields.file_name)
      || suggestedFileName(tipoDocumento, {
        ...fields,
        categoria_snapshot: contrattoRow?.categoria_snapshot || fields.categoria_snapshot
      });

    const finalFileName = sanitizeFileName(requestedFileName, sanitizeSegment(tipoDocumento, 'documento'));

    const basePath = normalizeBasePath({
      praticaId,
      storageBasePath: praticaRow.storage_base_path,
      nomeCartellaStorage: praticaRow.nome_cartella_storage
    });

    if (!basePath) {
      return response(500, { success: false, error: 'Percorso Storage della pratica non configurato' });
    }

    const storagePath = `${basePath}${finalFileName}`;

    const { error: uploadError } = await supabase
      .storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      return response(500, {
        success: false,
        error: readableErrorMessage(uploadError, 'Upload su Supabase Storage non riuscito')
      });
    }

    const insertPayload = {
      pratica_id: praticaId,
      contratto_id: contrattoId,
      anagrafica_id: anagraficaId,
      tipo_documento: tipoDocumento,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      file_name: finalFileName,
      mime_type: file.mimeType,
      file_size: file.size,
      uploaded_by: uploadedBy
    };

    const { data: documento, error: insertError } = await supabase
      .from('vendita_documenti')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) {
      // Rollback best-effort del file caricato se il record DB fallisce.
      await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);

      return response(500, {
        success: false,
        error: readableErrorMessage(insertError, 'Inserimento record vendita_documenti non riuscito')
      });
    }

    return response(200, {
      success: true,
      documento
    });
  } catch (error) {
    return response(500, {
      success: false,
      error: readableErrorMessage(error)
    });
  }
};

exports._test = {
  authenticatedUploaderId,
  canManagePractice,
  canUploadIntoPractice,
  hasPdfSignature,
  normalizeUuidOrNull
};
