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
const SEGNALAZIONE_FILE_TYPES = {
  '.pdf': { contentType: 'application/pdf', mimeTypes: ['application/pdf'], isValid: hasPdfSignature },
  '.jpg': { contentType: 'image/jpeg', mimeTypes: ['image/jpeg'], isValid: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  '.jpeg': { contentType: 'image/jpeg', mimeTypes: ['image/jpeg'], isValid: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  '.png': { contentType: 'image/png', mimeTypes: ['image/png'], isValid: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.gif': { contentType: 'image/gif', mimeTypes: ['image/gif'], isValid: (buffer) => buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a' },
  '.webp': { contentType: 'image/webp', mimeTypes: ['image/webp'], isValid: (buffer) => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' },
  '.bmp': { contentType: 'image/bmp', mimeTypes: ['image/bmp', 'image/x-ms-bmp'], isValid: (buffer) => buffer.length >= 2 && buffer.toString('ascii', 0, 2) === 'BM' },
  '.tif': { contentType: 'image/tiff', mimeTypes: ['image/tiff'], isValid: (buffer) => buffer.length >= 4 && (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) },
  '.tiff': { contentType: 'image/tiff', mimeTypes: ['image/tiff'], isValid: (buffer) => buffer.length >= 4 && (buffer.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || buffer.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))) },
  '.heic': { contentType: 'image/heic', mimeTypes: ['image/heic', 'image/heic-sequence', 'image/heif', 'image/heif-sequence'], isValid: (buffer) => hasIsoBmffBrand(buffer, ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) },
  '.heif': { contentType: 'image/heif', mimeTypes: ['image/heic', 'image/heic-sequence', 'image/heif', 'image/heif-sequence'], isValid: (buffer) => hasIsoBmffBrand(buffer, ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) },
  '.avif': { contentType: 'image/avif', mimeTypes: ['image/avif', 'image/avif-sequence'], isValid: (buffer) => hasIsoBmffBrand(buffer, ['avif', 'avis']) }
};

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

function hasIsoBmffBrand(buffer, brands) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.toString('ascii', 4, 8) !== 'ftyp') return false;
  const brandData = buffer.toString('ascii', 8, Math.min(buffer.length, 64));
  return brands.some((brand) => brandData.includes(brand));
}

function validateUploadType(bucket, file) {
  if (bucket !== 'segnalazioni-files') {
    if (!hasPdfSignature(file.buffer)) throw new Error('File non valido: per questo modulo è consentito solo un PDF reale');
    return 'application/pdf';
  }

  const extension = String(file.originalName || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
  const type = SEGNALAZIONE_FILE_TYPES[extension];
  if (!type) throw new Error('Formato non supportato: allega un PDF o un’immagine nei formati previsti');
  const declaredMime = String(file.mimeType || '').toLowerCase();
  if (declaredMime && declaredMime !== 'application/octet-stream' && !type.mimeTypes.includes(declaredMime)) {
    throw new Error('Il tipo dichiarato del file non corrisponde alla sua estensione');
  }
  if (!type.isValid(file.buffer)) throw new Error('File non valido: il contenuto non corrisponde al formato dichiarato');
  return type.contentType;
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
  if (bucket === 'segnalazioni-files') {
    const extension = normalized[fileIndex].toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || '';
    if (!SEGNALAZIONE_FILE_TYPES[extension]) throw new Error('Formato allegato segnalazione non consentito');
    const fileBase = normalized[fileIndex].slice(0, -extension.length) || 'allegato';
    normalized[fileIndex] = `${fileBase}${extension}`;
  } else {
    const fileBase = normalized[fileIndex].replace(/\.pdf$/i, '') || 'documento';
    normalized[fileIndex] = `${fileBase}.pdf`;
  }
  return normalized.join('/');
}

function collisionPath(storagePath) {
  const segments = storagePath.split('/');
  const fileName = segments.pop() || 'documento.pdf';
  const extension = fileName.match(/\.[a-z0-9]+$/i)?.[0] || '';
  const base = (extension ? fileName.slice(0, -extension.length) : fileName) || 'allegato';
  const suffix = `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  return [...segments, `${base}_${suffix}${extension || '.pdf'}`].join('/');
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
        reject(new Error('File mancante'));
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
    const contentType = validateUploadType(bucket, file);

    let storagePath = normalizeRequestedPath(bucket, fields.path);
    const uploadOptions = {
      contentType,
      upsert: false,
      metadata: {
        uploaded_by: auth.profilo.id,
        source: 'upload-documento-modulo'
      }
    };
    let uploadResult = await supabase.storage.from(bucket).upload(storagePath, file.buffer, {
      ...uploadOptions
    });

    if (uploadResult.error && isDuplicateError(uploadResult.error)) {
      storagePath = collisionPath(storagePath);
      uploadResult = await supabase.storage.from(bucket).upload(storagePath, file.buffer, {
        ...uploadOptions
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
  hasIsoBmffBrand,
  validateUploadType,
  normalizeRequestedPath,
  collisionPath
};
