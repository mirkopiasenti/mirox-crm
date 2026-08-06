'use strict';

const crypto = require('node:crypto');
const { requireAuth, getAdminClient } = require('./_lib/require-auth');
const { generateDisdettaPdf, VARIANTS } = require('./_lib/pdf-disdetta');

const BUCKET = 'disdette-files';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ANAGRAFICA_SEARCH_COLUMNS = ['cf_piva', 'ragione_sociale', 'nome_referente'];
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

function splitPersonName(value) {
  const parts = String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length === 0) return { nome: '', cognome: '' };
  if (parts.length === 1) return { nome: parts[0], cognome: '' };
  return { nome: parts[0], cognome: parts.slice(1).join(' ') };
}

function normalizeCluster(row) {
  const cluster = String(row?.cluster || '').trim().toLowerCase();
  if (cluster === 'business') return 'business';
  if (cluster === 'consumer' || cluster === 'turista') return 'consumer';
  return /^\d{11}$/.test(String(row?.cf_piva || '').trim()) ? 'business' : 'consumer';
}

function buildAnagraficaResult(row) {
  const cluster = normalizeCluster(row);
  const person = splitPersonName(row.nome_referente || (cluster === 'consumer' ? row.ragione_sociale : ''));
  const base = {
    id: row.id,
    cluster,
    display_name: cluster === 'business'
      ? String(row.ragione_sociale || row.nome_referente || row.cf_piva || '').trim()
      : String(row.ragione_sociale || row.nome_referente || row.cf_piva || '').trim(),
    cf_piva: String(row.cf_piva || '').trim(),
    prefill: {
      nome: person.nome,
      cognome: person.cognome,
      numero_titolare: String(row.cellulare || '').trim(),
      via: String(row.via || '').trim(),
      civico: String(row.civico || '').trim(),
      citta: String(row.comune || '').trim(),
      provincia: String(row.provincia || '').trim(),
      recapito_alternativo: String(row.cellulare || '').trim()
    }
  };

  if (cluster === 'business') {
    base.prefill.ragione_sociale = String(row.ragione_sociale || '').trim();
    base.prefill.partita_iva = base.cf_piva;
    base.prefill.referente_nome = person.nome;
    base.prefill.referente_cognome = person.cognome;
    base.prefill.codice_fiscale = '';
  } else {
    base.prefill.codice_fiscale = base.cf_piva;
  }
  return base;
}

function allowedDuplicateTypes(type) {
  if (type === 'sim_business' || type === 'fisso_business') {
    return ['sim_business', 'fisso_business'];
  }
  if (type === 'sim_consumer' || type === 'fisso_consumer') {
    return ['sim_consumer', 'fisso_consumer'];
  }
  return [];
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
    utenza: generated.data.utenza,
    dati_compilazione: generated.data,
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
    .select('id, tipo, nome, cognome, codice_fiscale, ragione_sociale, partita_iva, utenza, nome_file, created_at')
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
    .select('id, tipo, nome, cognome, codice_fiscale, ragione_sociale, partita_iva, utenza, dati_compilazione, nome_file, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);
  if (error) throw error;

  return response(200, {
    success: true,
    disdette: (data || []).map(({ dati_compilazione: snapshot, ...item }) => ({
      ...item,
      duplicabile: !!snapshot
    })),
    page,
    page_size: pageSize,
    total: count || 0,
    has_more: to + 1 < (count || 0)
  });
}

async function searchAnagrafica({ supabase, event }) {
  const params = event.queryStringParameters || {};
  const query = String(params.q || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (query.length < 2) {
    return response(400, { success: false, error: 'Inserisci almeno 2 caratteri per la ricerca' });
  }

  const fields = 'id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico';
  const searches = ANAGRAFICA_SEARCH_COLUMNS.map((column) => supabase
    .from('anagrafica')
    .select(fields)
    .ilike(column, `%${query}%`)
    .limit(12));
  const results = await Promise.all(searches);
  const failure = results.find((result) => result.error);
  if (failure) throw failure.error;

  const unique = new Map();
  results.flatMap((result) => result.data || []).forEach((row) => {
    if (!unique.has(row.id)) unique.set(row.id, buildAnagraficaResult(row));
  });
  const anagrafiche = [...unique.values()]
    .sort((left, right) => left.display_name.localeCompare(right.display_name, 'it'))
    .slice(0, 20);

  return response(200, { success: true, anagrafiche });
}

async function duplicateData({ supabase, body }) {
  const id = String(body.id || '').trim();
  const targetType = String(body.target_type || '').trim();
  if (!UUID_RE.test(id)) return response(400, { success: false, error: 'Identificativo non valido' });

  const { data, error } = await supabase
    .from('disdette_generate')
    .select('tipo, dati_compilazione')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return response(404, { success: false, error: 'Disdetta non trovata' });
  if (!data.dati_compilazione) {
    return response(409, {
      success: false,
      error: 'I dati completi non sono disponibili per questa disdetta precedente all’aggiornamento'
    });
  }
  if (!allowedDuplicateTypes(data.tipo).includes(targetType)) {
    return response(400, { success: false, error: 'Il modulo scelto non appartiene allo stesso tipo cliente' });
  }

  return response(200, {
    success: true,
    disdetta: { ...data.dati_compilazione, tipo: targetType }
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
    if (event.httpMethod === 'GET') {
      if (event.queryStringParameters?.action === 'search_anagrafica') {
        return await searchAnagrafica({ supabase, event });
      }
      return await list({ supabase, event });
    }

    const body = parseBody(event);
    if (!body) return response(400, { success: false, error: 'Payload JSON non valido' });
    if (body.action === 'generate') return await generate({ supabase, auth, body });
    if (body.action === 'signed_url') return await signedUrl({ supabase, body });
    if (body.action === 'duplicate_data') return await duplicateData({ supabase, body });
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
  splitPersonName,
  buildAnagraficaResult,
  allowedDuplicateTypes,
  variants: VARIANTS
};
