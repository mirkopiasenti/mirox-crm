const Busboy = require('busboy');
const crypto = require('node:crypto');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_BUCKETS = new Set([
  'apri-chiudi-files',
  'switch-sim-files',
  'comodato-files',
  'rimborsi-files',
  'protecta-files',
  'segnalazioni-files'
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

function hasPdfSignature(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= 5
    && buffer.subarray(0, 1024).includes(Buffer.from('%PDF-', 'ascii'));
}

function sanitizeSegment(value, fallback = 'file') {
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_.()-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_ .]+|[_ .]+$/g, '');
  return clean || fallback;
}

function normalizeRequestedPath(bucket, requestedPath) {
  const raw = String(requestedPath || '').trim();
  if (!raw || raw.length > 500 || raw.startsWith('/') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) {
    throw new Error('Percorso Storage non valido');
  }

  const rawSegments = raw.split('/');
  if (rawSegments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Percorso Storage non valido');
  }

  if (bucket === 'segnalazioni-files') {
    if (rawSegments.length !== 2 || !/^segnalazione_\d+$/.test(rawSegments[0])) {
      throw new Error('Percorso segnalazione non consentito');
    }
  } else if (bucket === 'protecta-files') {
    if (rawSegments.length !== 2 || rawSegments[0] !== 'preventivi') {
      throw new Error('Percorso Protecta non consentito');
    }
  } else if (rawSegments.length !== 2) {
    throw new Error('Il percorso del modulo deve contenere una cartella e un file');
  }

  const normalized = rawSegments.map((segment, index) => {
    const fallback = index === rawSegments.length - 1 ? 'documento.pdf' : 'pratica';
    return sanitizeSegment(segment, fallback);
  });

  const fileIndex = normalized.length - 1;
  const fileBase = normalized[fileIndex].replace(/\.pdf$/i, '') || 'documento';
  normalized[fileIndex] = `${fileBase}.pdf`;
  return normalized.join('/');
}

function collisionPath(storagePath) {
  const segments = storagePath.split('/');
  const fileName = segments.pop() || 'documento.pdf';
  const base = fileName.replace(/\.pdf$/i, '');
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  return [...segments, `${base}_${suffix}.pdf`].join('/');
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

    busboy.on('file', (fieldName, stream, infoOrFilename, _encoding, mimetypeMaybe) => {
      if (fieldName !== 'file' || parsedFile) {
        stream.resume();
        return;
      }

      const info = infoOrFilename && typeof infoOrFilename === 'object'
        ? infoOrFilename
        : { filename: infoOrFilename || '', mimeType: mimetypeMaybe || '' };
      const chunks = [];
      let size = 0;

      stream.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_FILE_SIZE_BYTES) {
          fileTooLarge = true;
          return;
        }
        chunks.push(chunk);
      });

      stream.on('end', () => {
        parsedFile = {
          originalName: info.filename || '',
          mimeType: String(info.mimeType || '').toLowerCase(),
          size,
          buffer: Buffer.concat(chunks)
        };
      });
    });

    busboy.on('error', reject);
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

function isDuplicateError(error) {
  const message = String(error?.message || error?.error || '');
  return /duplicate|already exists|resource already exists/i.test(message);
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

  try {
    const { fields, file } = await readMultipart(event);
    const bucket = String(fields.bucket || '').trim();
    if (!ALLOWED_BUCKETS.has(bucket)) {
      return response(400, { success: false, error: 'Bucket non consentito per questo endpoint' });
    }
    if (!hasPdfSignature(file.buffer)) {
      return response(400, { success: false, error: 'File non valido: è consentito solo un PDF reale' });
    }

    let storagePath = normalizeRequestedPath(bucket, fields.path);
    let uploadResult = await supabase.storage.from(bucket).upload(storagePath, file.buffer, {
      contentType: 'application/pdf',
      upsert: false
    });

    if (uploadResult.error && isDuplicateError(uploadResult.error)) {
      storagePath = collisionPath(storagePath);
      uploadResult = await supabase.storage.from(bucket).upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: false
      });
    }

    if (uploadResult.error) {
      return response(500, {
        success: false,
        error: uploadResult.error.message || 'Upload su Supabase Storage non riuscito'
      });
    }

    return response(200, {
      success: true,
      storage_bucket: bucket,
      storage_path: storagePath,
      file_name: storagePath.split('/').pop(),
      file_size: file.size
    });
  } catch (error) {
    return response(400, {
      success: false,
      error: error?.message || 'Upload documento non riuscito'
    });
  }
};

exports._test = {
  hasPdfSignature,
  normalizeRequestedPath,
  collisionPath
};
