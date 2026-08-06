'use strict';

const crypto = require('node:crypto');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { generateDisdettaPdf, VARIANTS } = require('./_lib/pdf-disdetta');

const BUCKET = 'disdette-files';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

function response(statusCode, payload) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function parseBody(event) {
  try {
    const parsed = JSON.parse(event.body || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function canonicalProfileId(auth) {
  const value = auth?.profilo?.alias_di || auth?.profilo?.id || auth?.user?.id;
  return UUID_RE.test(String(value || '')) ? String(value).toLowerCase() : null;
}

function profileName(auth) {
  return String(auth?.profilo?.nome || auth?.profilo?.email || auth?.user?.email || 'Operatore Mirox')
    .trim()
    .slice(0, 250);
}

function safeFilePart(value, fallback) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return normalized || fallback;
}

function currentRomeParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function buildFilename(data) {
  const parts = currentRomeParts();
  const subject = data.ragione_sociale || `${data.cognome}-${data.nome}`;
  const identifier = data.partita_iva || data.codice_fiscale;
  return `disdetta-${data.tipo.replaceAll('_', '-')}-${safeFilePart(subject, 'cliente')}-${safeFilePart(identifier, 'id')}-${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}.pdf`;
}

async function createSignedUrl(supabase, storagePath) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  if (error) throw error;
  return data?.signedUrl || null;
}

async function generate({ supabase, auth, body }) {
  const generated = await generateDisdettaPdf(body.disdetta);
  const id = crypto.randomUUID();
  const filename = buildFilename(generated.data);
  const parts = currentRomeParts();
  const storagePath = `${parts.year}/${parts.month}/${id}/${filename}`;
  const sha256 = crypto.createHash('sha256').update(generated.buffer).digest('hex');
  const createdBy = canonicalProfileId(auth);
  if (!createdBy) return response(400, { success: false, error: 'Profilo autenticato non valido' });

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, generated.buffer, {
    contentType: 'application/pdf',
    upsert: false,
    metadata: {
      created_by: createdBy,
      created_by_name: profileName(auth),
      tipo: generated.data.tipo,
      template_version: generated.templateVersion
    }
  });
  if (uploadError) throw uploadError;

  const record = {
    id,
    tipo: generated.data.tipo,
    nome: generated.variant.business ? null : generated.data.nome,
    cognome: generated.variant.business ? null : generated.data.cognome,
    codice_fiscale: generated.variant.business ? null : generated.data.codice_fiscale,
    ragione_sociale: generated.variant.business ? generated.data.ragione_sociale : null,
    partita_iva: generated.variant.business ? generated.data.partita_iva : null,
    storage_bucket: BUCKET,
    storage_path: storagePath,
    nome_file: filename,
    pdf_sha256: sha256,
    template_versione: generated.templateVersion,
    created_by: createdBy,
    created_by_nome: profileName(auth)
  };

  const { data: saved, error: insertError } = await supabase
    .from('disdette_generate')
    .insert(record)
    .select('id, tipo, nome, cognome, codice_fiscale, ragione_sociale, partita_iva, nome_file, created_at')
    .single();

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw insertError;
  }

  const signedUrl = await createSignedUrl(supabase, storagePath);
  return response(200, { success: true, disdetta: saved, signed_url: signedUrl });
}

async function list({ supabase, event }) {
  const params = event.queryStringParameters || {};
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page || '1', 10) || 1));
  const pageSize = Math.max(10, Math.min(100, Number.parseInt(params.page_size || '50', 10) || 50));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from('disdette_generate')
    .select('id, tipo, nome, cognome, codice_fiscale, ragione_sociale, partita_iva, nome_file, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  return response(200, {
    success: true,
    disdette: data || [],
    page,
    page_size: pageSize,
    total: count || 0,
    has_more: to + 1 < (count || 0)
  });
}

async function signedUrl({ supabase, body }) {
  const id = String(body.id || '').trim();
  if (!UUID_RE.test(id)) return response(400, { success: false, error: 'Identificativo non valido' });

  const { data, error } = await supabase
    .from('disdette_generate')
    .select('storage_bucket, storage_path, nome_file')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.storage_bucket !== BUCKET) {
    return response(404, { success: false, error: 'Disdetta non trovata' });
  }

  return response(200, {
    success: true,
    signed_url: await createSignedUrl(supabase, data.storage_path),
    nome_file: data.nome_file
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return response(200, { success: true });
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return response(405, { success: false, error: 'Metodo non consentito' });
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });
  const supabase = getAdminClient();

  try {
    if (event.httpMethod === 'GET') return await list({ supabase, event });

    const body = parseBody(event);
    if (!body) return response(400, { success: false, error: 'Payload JSON non valido' });
    if (body.action === 'generate') return await generate({ supabase, auth, body });
    if (body.action === 'signed_url') return await signedUrl({ supabase, body });
    return response(400, { success: false, error: 'Azione non valida' });
  } catch (error) {
    console.error('Errore gestisci-disdette:', error);
    const message = error?.message || 'Errore durante la gestione della disdetta';
    const status = /obbligatorio|non valid|troppo lungo|deve contenere|non è previsto/i.test(message) ? 400 : 500;
    return response(status, { success: false, error: message });
  }
};

exports._test = {
  buildFilename,
  safeFilePart,
  currentRomeParts,
  variants: VARIANTS
};
