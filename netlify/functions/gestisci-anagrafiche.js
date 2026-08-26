const { createClient } = require('@supabase/supabase-js');
const { strToU8, zipSync } = require('fflate');
const { requireAuth } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Disposition',
  'Cache-Control': 'no-store'
};

const SELECT_FIELDS = [
  'id',
  'cf_piva',
  'cluster',
  'ragione_sociale',
  'nome_referente',
  'cellulare',
  'email',
  'provincia',
  'comune',
  'via',
  'civico',
  'created_at',
  'updated_at',
  'creato_da',
  'creatore:profili!anagrafica_creato_da_fkey(nome)'
].join(',');

const CLUSTERS = new Set(['Consumer', 'Business']);
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_COMUNI_FILTER = 30;
const ISTAT_AUTOCOMPLETE_LIMIT = 20;
const ISTAT_CODE_PATTERN = /^[0-9]{6}$/;
const EXPORT_BATCH_SIZE = 1000;
const EXPORT_MAX_ROWS = 50000;
const COMUNI_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDITABLE_FIELDS = new Set([
  'cf_piva',
  'cluster',
  'ragione_sociale',
  'nome_referente',
  'cellulare',
  'email',
  'provincia',
  'comune',
  'via',
  'civico'
]);
const DELETE_DEPENDENCIES = [
  ['appuntamenti', 'anagrafica_id', 'appuntamenti'],
  ['call_center_lead_outbound_chiamate', 'anagrafica_id', 'chiamate outbound'],
  ['chiamate', 'anagrafica_id', 'chiamate'],
  ['post_vendita_controllo_allarmi', 'anagrafica_id', 'controlli allarmi'],
  ['post_vendita_controllo_assicurazioni', 'anagrafica_id', 'controlli assicurazioni'],
  ['post_vendita_controllo_fissi', 'anagrafica_id', 'controlli fissi'],
  ['post_vendita_controllo_lg', 'anagrafica_id', 'controlli luce e gas'],
  ['post_vendita_dispositivi_comodato', 'anagrafica_id', 'comodati'],
  ['post_vendita_gestione_rimborsi', 'anagrafica_id', 'rimborsi'],
  ['vendita_apri_chiudi', 'anagrafica_nuovo_id', 'apri e chiudi (nuova anagrafica)'],
  ['vendita_apri_chiudi', 'anagrafica_vecchio_id', 'apri e chiudi (vecchia anagrafica)'],
  ['vendita_consensi_privacy', 'anagrafica_id', 'consensi privacy storici'],
  ['vendita_consensi_privacy_v2', 'anagrafica_id', 'consensi privacy'],
  ['vendita_contratti', 'anagrafica_id', 'contratti'],
  ['vendita_documenti', 'anagrafica_id', 'documenti'],
  ['vendita_ordini_smartphone', 'anagrafica_id', 'ordini smartphone'],
  ['vendita_pratiche', 'anagrafica_id', 'pratiche vendita'],
  ['vendita_switch_sim', 'anagrafica_attuale_id', 'switch SIM (anagrafica attuale)'],
  ['vendita_switch_sim', 'anagrafica_rientro_id', 'switch SIM (anagrafica di rientro)']
];
let comuniCache = { expiresAt: 0, values: [] };

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  };
}

function cleanFilter(value, maxLength = 80) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function parsePositiveInteger(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function cleanComuneChoice(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s.'’\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function normalizeLocalityForComparison(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/&(?:#0*39|apos);/gi, "'")
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('it-IT');
}

function cleanIstatQuery(value) {
  return cleanComuneChoice(value).toLocaleUpperCase('it-IT');
}

function parseComuni(value) {
  if (!value) return [];
  let requested;
  try {
    requested = Array.isArray(value) ? value : JSON.parse(String(value));
  } catch (_) {
    return [];
  }
  if (!Array.isArray(requested)) return [];
  const unique = new Map();
  for (const item of requested.slice(0, MAX_COMUNI_FILTER)) {
    const comune = cleanComuneChoice(item);
    const key = comune.toLocaleLowerCase('it-IT');
    if (comune && !unique.has(key)) unique.set(key, comune);
  }
  return Array.from(unique.values());
}

function parseFilters(params = {}) {
  const requestedCluster = String(params.cluster || '').trim();
  return {
    cluster: CLUSTERS.has(requestedCluster) ? requestedCluster : '',
    comune: cleanFilter(params.comune),
    comuni: parseComuni(params.comuni),
    search: cleanFilter(params.search),
    page: parsePositiveInteger(params.page, 1, 100000),
    pageSize: parsePositiveInteger(params.page_size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  };
}

function applyFilters(query, filters) {
  let next = query;
  if (filters.cluster) next = next.eq('cluster', filters.cluster);
  if (filters.comuni.length) next = next.in('comune', filters.comuni);
  else if (filters.comune) next = next.ilike('comune', `%${filters.comune}%`);
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    next = next.or(`ragione_sociale.ilike.${pattern},nome_referente.ilike.${pattern}`);
  }
  return next;
}

async function fetchComuniOptions(supabase) {
  if (comuniCache.expiresAt > Date.now() && comuniCache.values.length) {
    return comuniCache.values;
  }
  const values = new Set();
  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('anagrafica')
      .select('comune')
      .not('comune', 'is', null)
      .order('comune', { ascending: true })
      .range(offset, offset + EXPORT_BATCH_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    for (const row of batch) {
      const comune = String(row.comune || '').trim();
      if (comune) values.add(comune);
    }
    if (batch.length < EXPORT_BATCH_SIZE) break;
  }
  const sorted = Array.from(values).sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  comuniCache = { expiresAt: Date.now() + COMUNI_CACHE_TTL_MS, values: sorted };
  return sorted;
}

async function fetchIstatComuni(supabase, rawQuery) {
  const query = cleanIstatQuery(rawQuery);
  if (query.length < 2) return [];
  const { data, error } = await supabase
    .from('mirox_comuni_istat')
    .select('codice_istat,nome,provincia_sigla,provincia_nome,regione')
    .like('nome', `${query}%`)
    .order('nome', { ascending: true })
    .order('provincia_sigla', { ascending: true })
    .limit(ISTAT_AUTOCOMPLETE_LIMIT);
  if (error) throw error;
  return data || [];
}

function readableError(error, fallback = 'Errore lettura anagrafiche') {
  if (!error) return fallback;
  return error.message || error.error_description || error.details || fallback;
}

function parseJsonBody(event) {
  const raw = event.body || '';
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    const error = new Error('Richiesta troppo grande');
    error.statusCode = 413;
    throw error;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch (_) {
    const error = new Error('Corpo JSON non valido');
    error.statusCode = 400;
    throw error;
  }
}

function cleanEditableText(value, maxLength, { required = false, uppercase = false } = {}) {
  const cleaned = String(value ?? '').normalize('NFKC').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !cleaned) throw new Error('Il codice fiscale / P.IVA è obbligatorio');
  if (cleaned.length > maxLength) throw new Error(`Un campo supera il limite di ${maxLength} caratteri`);
  if (!cleaned) return null;
  return uppercase ? cleaned.toLocaleUpperCase('it-IT') : cleaned;
}

function sanitizeAnagraficaUpdate(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Dati anagrafici non validi');
  const keys = Object.keys(data);
  if (keys.length !== EDITABLE_FIELDS.size || keys.some((key) => !EDITABLE_FIELDS.has(key))) {
    throw new Error('Sono presenti campi non modificabili');
  }
  const cluster = String(data.cluster || '').trim();
  if (!CLUSTERS.has(cluster)) throw new Error('Cluster non valido');
  const email = cleanEditableText(data.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Indirizzo email non valido');
  return {
    cf_piva: cleanEditableText(data.cf_piva, 40, { required: true, uppercase: true }),
    cluster,
    ragione_sociale: cleanEditableText(data.ragione_sociale, 250),
    nome_referente: cleanEditableText(data.nome_referente, 200),
    cellulare: cleanEditableText(data.cellulare, 40),
    email,
    provincia: cleanEditableText(data.provincia, 100, { uppercase: true }),
    comune: cleanEditableText(data.comune, 100, { uppercase: true }),
    via: cleanEditableText(data.via, 250),
    civico: cleanEditableText(data.civico, 30)
  };
}

async function resolveIstatLocality(supabase, payload, updates, current) {
  const requestedCode = String(payload.comune_istat_codice || '').trim();
  if (requestedCode) {
    if (!ISTAT_CODE_PATTERN.test(requestedCode)) {
      const error = new Error('Codice comune ISTAT non valido');
      error.statusCode = 400;
      throw error;
    }
    const { data, error } = await supabase
      .from('mirox_comuni_istat')
      .select('nome,provincia_sigla')
      .eq('codice_istat', requestedCode)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      const notFound = new Error('Comune ISTAT non trovato');
      notFound.statusCode = 400;
      throw notFound;
    }
    return { ...updates, comune: data.nome, provincia: data.provincia_sigla };
  }

  const proposedComune = normalizeLocalityForComparison(updates.comune);
  const proposedProvincia = normalizeLocalityForComparison(updates.provincia);
  const currentComune = normalizeLocalityForComparison(current.comune);
  const currentProvincia = normalizeLocalityForComparison(current.provincia);
  if (proposedComune === currentComune && proposedProvincia === currentProvincia) return updates;
  if (!proposedComune && !proposedProvincia) return { ...updates, comune: null, provincia: null };
  if (!proposedComune || !proposedProvincia) {
    const incomplete = new Error('Seleziona il comune dall’elenco ISTAT per compilare anche la provincia');
    incomplete.statusCode = 400;
    throw incomplete;
  }

  const { data, error } = await supabase
    .from('mirox_comuni_istat')
    .select('nome,provincia_sigla')
    .eq('nome', proposedComune)
    .eq('provincia_sigla', proposedProvincia)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    const invalid = new Error('Comune e provincia non corrispondono al catalogo ISTAT: seleziona una voce dall’elenco');
    invalid.statusCode = 400;
    throw invalid;
  }
  return { ...updates, comune: data.nome, provincia: data.provincia_sigla };
}

async function updateAnagrafica(supabase, payload) {
  if (!UUID_PATTERN.test(String(payload.id || ''))) {
    return jsonResponse(400, { success: false, error: 'ID anagrafica non valido' });
  }
  const expectedUpdatedAt = String(payload.expected_updated_at || '');
  if (Number.isNaN(Date.parse(expectedUpdatedAt))) {
    return jsonResponse(400, { success: false, error: 'Versione anagrafica non valida: ricarica la pagina' });
  }
  let updates;
  try {
    updates = sanitizeAnagraficaUpdate(payload.data);
  } catch (error) {
    return jsonResponse(400, { success: false, error: error.message });
  }
  const { data: current, error: currentError } = await supabase
    .from('anagrafica')
    .select('id,comune,provincia')
    .eq('id', payload.id)
    .eq('updated_at', expectedUpdatedAt)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) {
    const { data: existing, error: lookupError } = await supabase.from('anagrafica').select('id').eq('id', payload.id).maybeSingle();
    if (lookupError) throw lookupError;
    return jsonResponse(existing ? 409 : 404, {
      success: false,
      error: existing ? 'L’anagrafica è stata modificata da un altro utente. Ricarica i dati e riprova.' : 'Anagrafica non trovata'
    });
  }
  updates = await resolveIstatLocality(supabase, payload, updates, current);

  const { data, error } = await supabase
    .from('anagrafica')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', payload.id)
    .eq('updated_at', expectedUpdatedAt)
    .select(SELECT_FIELDS)
    .maybeSingle();
  if (error?.code === '23505') {
    return jsonResponse(409, { success: false, error: 'Esiste già un’altra anagrafica con questo codice fiscale / P.IVA' });
  }
  if (error) throw error;
  if (!data) {
    const { data: latest, error: lookupError } = await supabase.from('anagrafica').select('id').eq('id', payload.id).maybeSingle();
    if (lookupError) throw lookupError;
    return jsonResponse(latest ? 409 : 404, {
      success: false,
      error: latest ? 'L’anagrafica è stata modificata da un altro utente. Ricarica i dati e riprova.' : 'Anagrafica non trovata'
    });
  }
  comuniCache = { expiresAt: 0, values: [] };
  return jsonResponse(200, { success: true, data });
}

async function findDeleteDependencies(supabase, id) {
  const checks = await Promise.all(DELETE_DEPENDENCIES.map(async ([table, column, label]) => {
    const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true }).eq(column, id);
    if (error) throw error;
    return { label, count: count || 0 };
  }));
  return checks.filter((item) => item.count > 0);
}

async function deleteAnagrafica(supabase, payload, profilo) {
  if (profilo?.ruolo !== 'admin') {
    return jsonResponse(403, { success: false, error: 'Solo gli amministratori possono eliminare un’anagrafica' });
  }
  if (!UUID_PATTERN.test(String(payload.id || ''))) {
    return jsonResponse(400, { success: false, error: 'ID anagrafica non valido' });
  }
  const dependencies = await findDeleteDependencies(supabase, payload.id);
  if (dependencies.length) {
    return jsonResponse(409, {
      success: false,
      error: 'Impossibile eliminare: l’anagrafica è collegata allo storico CRM',
      dependencies
    });
  }
  const { data, error } = await supabase.from('anagrafica').delete().eq('id', payload.id).select('id').maybeSingle();
  if (error?.code === '23503') {
    return jsonResponse(409, { success: false, error: 'Impossibile eliminare: nel frattempo sono stati collegati altri dati' });
  }
  if (error) throw error;
  if (!data) return jsonResponse(404, { success: false, error: 'Anagrafica non trovata' });
  comuniCache = { expiresAt: 0, values: [] };
  return jsonResponse(200, { success: true, deleted_id: data.id });
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index) {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function creatorName(row) {
  if (Array.isArray(row.creatore)) return row.creatore[0]?.nome || '';
  return row.creatore?.nome || '';
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

const EXPORT_COLUMNS = [
  ['ID', (row) => row.id],
  ['Cluster', (row) => row.cluster],
  ['Ragione sociale', (row) => row.ragione_sociale],
  ['Nome referente', (row) => row.nome_referente],
  ['Codice fiscale / P.IVA', (row) => row.cf_piva],
  ['Numero di contatto', (row) => row.cellulare],
  ['Email', (row) => row.email],
  ['Provincia', (row) => row.provincia],
  ['Comune', (row) => row.comune],
  ['Via', (row) => row.via],
  ['Civico', (row) => row.civico],
  ['Creato da', creatorName],
  ['ID creatore', (row) => row.creato_da],
  ['Creato il', (row) => formatDateTime(row.created_at)],
  ['Aggiornato il', (row) => formatDateTime(row.updated_at)]
];

function inlineStringCell(reference, value, styleId = 0) {
  const style = styleId ? ` s="${styleId}"` : '';
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
}

function buildSheetXml(rows) {
  const lastColumn = columnName(EXPORT_COLUMNS.length - 1);
  const lastRow = rows.length + 1;
  const header = EXPORT_COLUMNS.map(([label], index) => inlineStringCell(`${columnName(index)}1`, label, 1)).join('');
  const dataRows = rows.map((row, rowIndex) => {
    const excelRow = rowIndex + 2;
    const cells = EXPORT_COLUMNS.map(([, getter], columnIndex) => (
      inlineStringCell(`${columnName(columnIndex)}${excelRow}`, getter(row) ?? '')
    )).join('');
    return `<row r="${excelRow}">${cells}</row>`;
  }).join('');
  const widths = [38, 13, 32, 26, 24, 20, 30, 12, 22, 28, 10, 22, 38, 19, 19]
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>${widths}</cols>
  <sheetData><row r="1" ht="24" customHeight="1">${header}</row>${dataRows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
}

function createWorkbook(rows) {
  const files = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Anagrafiche" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFF6600"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`),
    'xl/worksheets/sheet1.xml': strToU8(buildSheetXml(rows))
  };
  return Buffer.from(zipSync(files, { level: 6 }));
}

async function fetchAllRows(supabase, filters) {
  const rows = [];
  for (let offset = 0; offset <= EXPORT_MAX_ROWS; offset += EXPORT_BATCH_SIZE) {
    let query = supabase
      .from('anagrafica')
      .select(SELECT_FIELDS)
      .order('ragione_sociale', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + EXPORT_BATCH_SIZE - 1);
    query = applyFilters(query, filters);
    const { data, error } = await query;
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < EXPORT_BATCH_SIZE) return rows;
    if (rows.length >= EXPORT_MAX_ROWS) {
      throw new Error(`L'export supera il limite operativo di ${EXPORT_MAX_ROWS} righe: restringi i filtri`);
    }
  }
  return rows;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return jsonResponse(405, { success: false, error: 'Metodo non consentito' });
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return jsonResponse(auth.status, { success: false, error: auth.error });
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(500, { success: false, error: 'Configurazione server incompleta' });
  }

  const params = event.queryStringParameters || {};
  const filters = parseFilters(params);
  const action = ['export', 'comuni', 'comuni_istat'].includes(params.action) ? params.action : 'list';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    if (event.httpMethod === 'POST') {
      const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';
      if (!String(contentType).toLowerCase().startsWith('application/json')) {
        return jsonResponse(415, { success: false, error: 'Content-Type non consentito: usa application/json' });
      }
      const payload = parseJsonBody(event);
      if (payload.action === 'update') return await updateAnagrafica(supabase, payload);
      if (payload.action === 'delete') return await deleteAnagrafica(supabase, payload, auth.profilo);
      return jsonResponse(400, { success: false, error: 'Azione non valida' });
    }

    if (action === 'comuni') {
      return jsonResponse(200, { success: true, data: await fetchComuniOptions(supabase) });
    }

    if (action === 'comuni_istat') {
      return jsonResponse(200, { success: true, data: await fetchIstatComuni(supabase, params.q) });
    }

    if (action === 'export') {
      const rows = await fetchAllRows(supabase, filters);
      const workbook = createWorkbook(rows);
      const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date());
      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="anagrafiche_${date}.xlsx"`
        },
        isBase64Encoded: true,
        body: workbook.toString('base64')
      };
    }

    const offset = (filters.page - 1) * filters.pageSize;
    let query = supabase
      .from('anagrafica')
      .select(SELECT_FIELDS, { count: 'exact' })
      .order('ragione_sociale', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + filters.pageSize - 1);
    query = applyFilters(query, filters);
    const { data, error, count } = await query;
    if (error) throw error;

    return jsonResponse(200, {
      success: true,
      data: data || [],
      pagination: {
        page: filters.page,
        page_size: filters.pageSize,
        total: count || 0,
        total_pages: Math.max(1, Math.ceil((count || 0) / filters.pageSize))
      },
      filters: {
        cluster: filters.cluster || null,
        comune: filters.comune || null,
        comuni: filters.comuni,
        search: filters.search || null
      }
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, { success: false, error: readableError(error) });
  }
};

exports._test = {
  applyFilters,
  cleanComuneChoice,
  cleanFilter,
  columnName,
  createWorkbook,
  DELETE_DEPENDENCIES,
  findDeleteDependencies,
  fetchIstatComuni,
  normalizeLocalityForComparison,
  parseComuni,
  parseFilters,
  parseJsonBody,
  resolveIstatLocality,
  sanitizeAnagraficaUpdate,
  xmlEscape
};
