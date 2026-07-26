const { requireAuth, getAdminClient } = require('./_lib/require-auth');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ADMIN_ACTIONS = new Set([
  'create_rimborso_manuale',
  'mark_apri_chiudi_ko'
]);
const AUTHENTICATED_ACTIONS = new Set([
  'create_rimborso',
  'set_rimborso_cartella',
  'complete_rimborso',
  ...ADMIN_ACTIONS
]);

function response(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload)
  };
}

function parseBody(event) {
  try {
    const parsed = JSON.parse(event.body || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function cleanText(value, maxLength, { required = false } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error('Campo obbligatorio mancante');
  if (text.length > maxLength) throw new Error(`Testo troppo lungo (massimo ${maxLength} caratteri)`);
  return text || null;
}

function positiveAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999.99) {
    throw new Error('Importo non valido');
  }
  return Math.round(amount * 100) / 100;
}

function positiveId(value, fieldName = 'id') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`${fieldName} non valido`);
  }
  return id;
}

function validDate(value) {
  const date = String(value || '').trim();
  if (!DATE_RE.test(date)) throw new Error('Data non valida');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Data non valida');
  }
  return date;
}

function validPdfPath(value) {
  const path = String(value || '').trim();
  if (
    !path
    || path.length > 1000
    || path.startsWith('/')
    || path.includes('\\')
    || path.split('/').includes('..')
    || !/\.pdf$/i.test(path)
  ) {
    throw new Error('Percorso PDF non valido');
  }
  return path;
}

function profileName(auth) {
  return cleanText(
    auth?.profilo?.nome || auth?.profilo?.email || auth?.user?.email || 'Operatore Mirox',
    250,
    { required: true }
  );
}

function canonicalProfileId(auth) {
  const value = auth?.profilo?.alias_di || auth?.profilo?.id || auth?.user?.id;
  return UUID_RE.test(String(value || '')) ? String(value).toLowerCase() : null;
}

function todayInRome() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function splitBeneficiary(value) {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error('Beneficiario obbligatorio');
  return {
    nome: cleanText(parts[0], 250, { required: true }),
    cognome: cleanText(parts.slice(1).join(' ') || '-', 250, { required: true })
  };
}

async function generateRefundCode(supabase) {
  const { data, error } = await supabase.rpc('genera_codice_rimborso');
  if (error) throw error;
  return data || null;
}

async function createRefund({ supabase, auth, body }) {
  const anagraficaId = String(body.anagrafica_id || '').trim();
  if (!UUID_RE.test(anagraficaId)) {
    return response(400, { success: false, error: 'anagrafica_id non valido' });
  }

  let record;
  try {
    const sesso = body.sesso == null || body.sesso === '' ? null : String(body.sesso).trim();
    if (sesso && !['M', 'F'].includes(sesso)) throw new Error('Sesso non valido');
    const operatoreId = canonicalProfileId(auth);
    if (!operatoreId) throw new Error('Profilo autenticato privo di identificativo valido');

    record = {
      codice: await generateRefundCode(supabase),
      anagrafica_id: anagraficaId,
      nome: cleanText(body.nome, 250, { required: true }),
      cognome: cleanText(body.cognome, 250, { required: true }),
      sesso,
      codice_fiscale: cleanText(body.codice_fiscale, 50),
      importo: positiveAmount(body.importo),
      id_contratto: cleanText(body.id_contratto, 250),
      motivazione: cleanText(body.motivazione, 2000, { required: true }),
      note_interne: cleanText(body.note_interne, 4000),
      stato: 'Aperto',
      operatore_id: operatoreId,
      operatore_nome: profileName(auth)
    };
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const { data: rimborso, error } = await supabase
    .from('post_vendita_gestione_rimborsi')
    .insert(record)
    .select('*')
    .single();
  if (error) throw error;

  return response(200, { success: true, rimborso });
}

async function setRefundFolder({ supabase, body }) {
  let rimborsoId;
  let path;
  try {
    rimborsoId = positiveId(body.rimborso_id, 'rimborso_id');
    path = validPdfPath(body.cartella_url);
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const { data: rimborso, error } = await supabase
    .from('post_vendita_gestione_rimborsi')
    .update({ cartella_url: path })
    .eq('id', rimborsoId)
    .select('id, cartella_url')
    .maybeSingle();
  if (error) throw error;
  if (!rimborso) return response(404, { success: false, error: 'Rimborso non trovato' });

  return response(200, { success: true, rimborso });
}

async function completeRefund({ supabase, body }) {
  let rimborsoId;
  let update;
  try {
    rimborsoId = positiveId(body.rimborso_id, 'rimborso_id');
    update = {
      stato: 'Consegnato',
      data_consegna: validDate(body.data_consegna),
      note_aggiuntive: cleanText(body.note_aggiuntive, 4000),
      pdf_firmato_url: validPdfPath(body.pdf_firmato_url)
    };
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const { data: rimborso, error } = await supabase
    .from('post_vendita_gestione_rimborsi')
    .update(update)
    .eq('id', rimborsoId)
    .in('stato', ['Aperto', 'In Lavorazione'])
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!rimborso) {
    return response(409, {
      success: false,
      error: 'Rimborso non trovato o già chiuso'
    });
  }

  return response(200, { success: true, rimborso });
}

async function createManualRefund({ supabase, auth, body }) {
  let record;
  try {
    const { nome, cognome } = splitBeneficiary(body.beneficiario);
    const operatoreId = canonicalProfileId(auth);
    if (!operatoreId) throw new Error('Profilo autenticato privo di identificativo valido');
    const nomeOperatore = profileName(auth);

    record = {
      codice: await generateRefundCode(supabase),
      nome,
      cognome,
      importo: positiveAmount(body.importo),
      motivazione: 'Rimborso manuale (senza contratto associato)',
      note_interne: `Rimborso manuale registrato da un amministratore (${nomeOperatore})`,
      note_aggiuntive: cleanText(body.note, 4000),
      stato: 'Consegnato',
      data_consegna: todayInRome(),
      operatore_id: operatoreId,
      operatore_nome: nomeOperatore
    };
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const { data: rimborso, error } = await supabase
    .from('post_vendita_gestione_rimborsi')
    .insert(record)
    .select('*')
    .single();
  if (error) throw error;

  return response(200, { success: true, rimborso });
}

async function markApriChiudiKo({ supabase, body }) {
  let praticaId;
  try {
    praticaId = positiveId(body.pratica_id, 'pratica_id');
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const { data: current, error: loadError } = await supabase
    .from('vendita_apri_chiudi')
    .select('id, stato')
    .eq('id', praticaId)
    .maybeSingle();
  if (loadError) throw loadError;
  if (!current) return response(404, { success: false, error: 'Pratica Apri/Chiudi non trovata' });
  if (current.stato !== 'IN CORSO') {
    return response(409, {
      success: false,
      error: `La pratica non è più IN CORSO (stato attuale: ${current.stato})`
    });
  }

  const { data: pratica, error } = await supabase
    .from('vendita_apri_chiudi')
    .update({ stato: 'KO' })
    .eq('id', praticaId)
    .eq('stato', 'IN CORSO')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!pratica) {
    return response(409, {
      success: false,
      error: 'La pratica è stata modificata da un altro utente; aggiorna la pagina'
    });
  }

  return response(200, { success: true, pratica });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const body = parseBody(event);
  if (!body) return response(400, { success: false, error: 'Body JSON non valido' });

  const action = String(body.action || '').trim();
  if (!AUTHENTICATED_ACTIONS.has(action)) {
    return response(400, { success: false, error: 'Azione non valida' });
  }

  const auth = await requireAuth(event, { adminOnly: ADMIN_ACTIONS.has(action) });
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const supabase = getAdminClient();
  if (!supabase) {
    return response(500, { success: false, error: 'Configurazione server incompleta' });
  }

  try {
    if (action === 'create_rimborso') {
      return await createRefund({ supabase, auth, body });
    }
    if (action === 'set_rimborso_cartella') {
      return await setRefundFolder({ supabase, body });
    }
    if (action === 'complete_rimborso') {
      return await completeRefund({ supabase, body });
    }
    if (action === 'create_rimborso_manuale') {
      return await createManualRefund({ supabase, auth, body });
    }
    return await markApriChiudiKo({ supabase, body });
  } catch (error) {
    console.error('gestisci-operazioni-post-vendita:', error);
    return response(500, {
      success: false,
      error: error?.message || 'Errore interno durante l’operazione'
    });
  }
};

exports._test = {
  positiveAmount,
  positiveId,
  validDate,
  validPdfPath,
  splitBeneficiary,
  todayInRome,
  ADMIN_ACTIONS,
  AUTHENTICATED_ACTIONS
};
