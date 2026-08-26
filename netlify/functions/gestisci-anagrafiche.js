const { createClient } = require('@supabase/supabase-js');
const { strToU8, zipSync } = require('fflate');
const { requireAuth } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
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
const EXPORT_BATCH_SIZE = 1000;
const EXPORT_MAX_ROWS = 50000;

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

function parseFilters(params = {}) {
  const requestedCluster = String(params.cluster || '').trim();
  return {
    cluster: CLUSTERS.has(requestedCluster) ? requestedCluster : '',
    comune: cleanFilter(params.comune),
    search: cleanFilter(params.search),
    page: parsePositiveInteger(params.page, 1, 100000),
    pageSize: parsePositiveInteger(params.page_size, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)
  };
}

function applyFilters(query, filters) {
  let next = query;
  if (filters.cluster) next = next.eq('cluster', filters.cluster);
  if (filters.comune) next = next.ilike('comune', `%${filters.comune}%`);
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    next = next.or(`ragione_sociale.ilike.${pattern},nome_referente.ilike.${pattern}`);
  }
  return next;
}

function readableError(error, fallback = 'Errore lettura anagrafiche') {
  if (!error) return fallback;
  return error.message || error.error_description || error.details || fallback;
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
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { success: false, error: 'Metodo non consentito: usa GET' });
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
  const action = params.action === 'export' ? 'export' : 'list';
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
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
        search: filters.search || null
      }
    });
  } catch (error) {
    return jsonResponse(500, { success: false, error: readableError(error) });
  }
};

exports._test = {
  applyFilters,
  cleanFilter,
  columnName,
  createWorkbook,
  parseFilters,
  xmlEscape
};
