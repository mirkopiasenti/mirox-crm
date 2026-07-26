const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');
const { INFORMATIVE_VERSIONI_CORRENTI } = require('./_lib/privacy-config');

const ORIGINI_PRATICA_AMMESSE = new Set([
  'appuntamento_callcenter',
  'contatto_callcenter_entro_10_giorni',
  'spontaneo'
]);

const CLUSTER_AMMESSI = new Set(['Consumer', 'Business', 'Turista']);
const TURISTA_CATEGORIA_FISSA = 'Mobile';
const TURISTA_OFFERTA_FISSA = 'Untied - Call Your Country';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PDA_TEMP_PATH_REGEX = /^temp\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9_-]+\.pdf$/i;
const REINSERIMENTO_POST_VENDITA = {
  fisso: {
    table: 'post_vendita_controllo_fissi',
    stati: new Set(['KO', 'In Attivazione'])
  },
  energia: {
    table: 'post_vendita_controllo_lg',
    stati: new Set(['Rifiutato', 'Annullato', 'Nuovo', 'In lavorazione', 'In attivazione'])
  },
  allarmi: {
    table: 'post_vendita_controllo_allarmi',
    stati: new Set(['KO', 'In Attivazione'])
  },
  assicurazioni: {
    table: 'post_vendita_controllo_assicurazioni',
    stati: new Set(['KO'])
  }
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

function cleanString(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeCfPiva(value) {
  return String(value || '').trim().toUpperCase();
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;

  const normalized = String(value).trim().toLowerCase();

  if (['true', '1', 'yes', 'si'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;

  return fallback;
}

function normalizeCluster(value) {
  const raw = cleanString(value);

  if (!raw) {
    throw new Error('Campo obbligatorio mancante: cliente.cluster');
  }

  const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();

  if (!CLUSTER_AMMESSI.has(normalized)) {
    throw new Error('Cluster non valido: usa Consumer, Business o Turista');
  }

  return normalized;
}

function clusterForAnagrafica(cluster) {
  // Turista resta cluster vendita, ma anagrafica e' condivisa e accetta i passaporti come Consumer.
  return cluster === 'Turista' ? 'Consumer' : cluster;
}

function normalizeUuidOrNull(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  return UUID_REGEX.test(raw) ? raw.toLowerCase() : null;
}

function getRomeYearMonth(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  return year && month ? `${year}-${month}` : null;
}

function isSameRomeCalendarMonth(first, second = new Date()) {
  const firstYearMonth = getRomeYearMonth(first);
  return Boolean(firstYearMonth && firstYearMonth === getRomeYearMonth(second));
}

function authenticatedOperatorId(auth) {
  return normalizeUuidOrNull(auth?.profilo?.alias_di)
    || normalizeUuidOrNull(auth?.profilo?.id)
    || normalizeUuidOrNull(auth?.user?.id);
}

function sanitizeSegment(value, fallback = 'valore') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function formatDateDdMmYyyy(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}_${mm}_${yyyy}`;
}

function buildStorageNames({ ragioneSociale, praticaId, now = new Date() }) {
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const praticaShort = String(praticaId || '').replace(/-/g, '').slice(0, 6).toLowerCase() || 'xxxxxx';
  const ragioneSafe = sanitizeSegment(ragioneSociale, 'cliente');
  const datePart = formatDateDdMmYyyy(now);

  const nomeCartellaStorage = `Contratto_${ragioneSafe}_${datePart}_${praticaShort}`;
  const folderPathSegment = sanitizeSegment(nomeCartellaStorage, `contratto_${praticaShort}`).toLowerCase();
  const storageBasePath = `${year}/${month}/${folderPathSegment}/`;

  return { nomeCartellaStorage, storageBasePath };
}

function parseRequiredScore(value, label) {
  // Guardia difensiva: null/undefined/'' non sono punteggi validi. Number(null)
  // e Number('') restituiscono 0 (finite) e finirebbero silenziosamente a DB —
  // fenomeno visto in 14 contratti del 22-23/07/2026 salvati con snapshot 0
  // nonostante il catalogo avesse valori > 0. Blocchiamo esplicitamente qui.
  if (value === null || value === undefined || value === '') {
    throw new Error(`Configurazione non valida: ${label} mancante nel catalogo (null/vuoto). Ricarica la pagina e riprova.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Configurazione non valida: ${label} non numerico (${JSON.stringify(value)})`);
  }
  return parsed;
}

function parseOptionalScore(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readableError(error, fallback = 'Errore durante la creazione pratica carrello') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || error.error_description || error.details || fallback;
}

function normalizeTextArrayValue(value, allowedValues, fieldName) {
  const raw = cleanString(value);
  if (!raw) return null;

  const match = allowedValues.find((allowed) => allowed.toLowerCase() === raw.toLowerCase());

  if (!match) {
    throw new Error(`${fieldName} non valido`);
  }

  return match;
}

function normalizeContractInput(contract, index) {
  const tempId = cleanString(contract?.temp_id) || `temp_${index + 1}`;
  const categoriaId = cleanString(contract?.categoria_id);
  const offertaId = cleanString(contract?.offerta_id);
  const opzioneId = cleanString(contract?.opzione_id);
  const reloadId = cleanString(contract?.reload_id);

  const dispositivoAssociato = parseBoolean(contract?.dispositivo_associato, false);
  const imei = cleanString(contract?.imei);

  if (!categoriaId) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].categoria_id`);
  }

  if (!offertaId) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].offerta_id`);
  }

  const tipoAcquisto = cleanString(contract?.tipo_acquisto);
  const finanziaria = cleanString(contract?.finanziaria);

  return {
    temp_id: tempId,
    categoria_id: categoriaId,
    offerta_id: offertaId,
    opzione_id: opzioneId,
    reload_id: reloadId,
    tipo_attivazione: cleanString(contract?.tipo_attivazione),
    apri_chiudi: cleanString(contract?.apri_chiudi),
    intestatario: cleanString(contract?.intestatario),
    switch_sim: cleanString(contract?.switch_sim),
    modalita_pagamento: cleanString(contract?.modalita_pagamento),
    dispositivo_associato: dispositivoAssociato,
    imei: dispositivoAssociato ? imei : null,
    fascia_prezzo: dispositivoAssociato ? cleanString(contract?.fascia_prezzo) : null,
    tipo_acquisto: dispositivoAssociato ? tipoAcquisto : null,
    finanziaria: dispositivoAssociato && tipoAcquisto && tipoAcquisto.toLowerCase() === 'finanziamento' ? finanziaria : null,
    kolme: dispositivoAssociato ? parseBoolean(contract?.kolme, null) : null,
    // Migration 035 - Smartphone Reload + modalita.
    // smartphone_reload: bool nullable (true=Si, false=No, null=non specificato).
    // smartphone_reload_modalita: text nullable, enum {Mantenere attivo, Disattivazione cliente}.
    // CHECK DB: se smartphone_reload=true, modalita NOT NULL; altrimenti modalita IS NULL.
    smartphone_reload: dispositivoAssociato ? parseBoolean(contract?.smartphone_reload, null) : null,
    smartphone_reload_modalita: (() => {
      if (!dispositivoAssociato) return null;
      const isSi = parseBoolean(contract?.smartphone_reload, null) === true;
      if (!isSi) return null;
      const raw = cleanString(contract?.smartphone_reload_modalita);
      if (!raw) return null;
      const allowed = ['Mantenere attivo', 'Disattivazione cliente'];
      if (!allowed.includes(raw)) {
        throw new Error(`contratti[${index}].smartphone_reload_modalita non valido (ammessi: ${allowed.join(', ')})`);
      }
      return raw;
    })(),
    // Campi nuovi (Mirox §): predisposizione dei dati extra
    //  - pod_pdr: identificatore contatore (solo Energia)
    //  - numero_contratto_energia: predisposto, popolato a posteriori
    //  - prezzo_fisso: prezzo di vendita per contratti Fisso (chiesto da popup UI)
    //  - reload_exchange + reload_forever: solo Mobile / Customer Base (migration 035)
    pod_pdr: cleanString(contract?.pod_pdr) || null,
    numero_contratto_energia: cleanString(contract?.numero_contratto_energia) || null,
    prezzo_fisso: (() => {
      const v = contract?.prezzo_fisso;
      if (v === null || v === undefined || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    })(),
    reload_exchange: parseBoolean(contract?.reload_exchange, false) === true,
    reload_forever: parseBoolean(contract?.reload_forever, false) === true,
    // Reinserimento (migration 033): questi campi devono sopravvivere alla
    // normalizzazione, altrimenti il backend ricade sempre su "inserimento".
    stato_inserimento: cleanString(contract?.stato_inserimento) || 'inserimento',
    reinserimento_di_contratto_id: cleanString(contract?.reinserimento_di_contratto_id) || null,
    // Codice Rivenditore (migration 050): punto vendita di inserimento.
    // Default '9001415852' (Legnago) se assente. CHECK enum a DB.
    codice_rivenditore: (() => {
      const raw = cleanString(contract?.codice_rivenditore);
      if (!raw) return '9001415852';
      const allowed = ['9001415852', '9000822241'];
      if (!allowed.includes(raw)) {
        throw new Error(`Codice rivenditore non valido per contratti[${index}]: ammessi ${allowed.join(', ')}`);
      }
      return raw;
    })(),
    // Convergenza (solo Fisso): uno degli 8 valori ammessi. null per altre categorie o se non fornita.
    // Vedi migration 017 (introduzione) + 048 (aggiunta "Seconda Casa") + CHECK constraint a DB.
    convergenza: (() => {
      const v = cleanString(contract?.convergenza);
      if (!v) return null;
      const allowed = ['Mobile', 'L&G', 'Allarme', 'Assicurazione', 'Sim Interna', 'NO Convergenza', 'Coupon', 'Seconda Casa'];
      if (!allowed.includes(v)) {
        throw new Error(`Convergenza non valida per contratti[${index}]: deve essere uno fra ${allowed.join(', ')}`);
      }
      return v;
    })(),
    // PDA caricata in modalita' staging (temp/<session_id>/<file>). null se non applicabile
    // o se contratto e' in categoria senza PDA (Energia/Allarmi/Assicurazioni).
    pda_temp_path: (() => {
      const raw = cleanString(contract?.pda_temp_path);
      if (!raw) return null;
      if (!PDA_TEMP_PATH_REGEX.test(raw)) {
        throw new Error(`contratti[${index}].pda_temp_path non valido`);
      }
      return raw;
    })(),
    // Tipo firma: 'elettronica' o 'cartacea' (solo per categorie PDA). null altrimenti.
    tipo_firma: cleanString(contract?.tipo_firma) || null,
    // Campi specifici Assicurazioni (vedi migration 017)
    modalita_pagamento_assicurazione: cleanString(contract?.modalita_pagamento_assicurazione) || null,
    ricorrenza_assicurazione: cleanString(contract?.ricorrenza_assicurazione) || null
  };
}

const CATEGORIE_PDA = new Set(['mobile', 'customer base', 'fisso']);

function isCategoriaPda(categoryName) {
  return CATEGORIE_PDA.has(normalizeCategoryName(categoryName));
}

/**
 * Promuove un PDA caricato in temp/<session>/<file> alla cartella definitiva
 * della pratica creata, e crea il record vendita_documenti corrispondente.
 * Se l'INSERT del record documento fallisce, rimuove il file appena spostato
 * per non lasciare oggetti orfani nello Storage.
 */
async function promoteTempPda({ supabase, tempPath, basePath, categoriaName, praticaId, contrattoId, anagraficaId, uploadedBy }) {
  try {
    const categoriaSlug = sanitizeSegment(categoriaName || 'generico', 'generico').toLowerCase();
    const finalFileName = `contratto_${categoriaSlug}.pdf`;
    const cleanBase = String(basePath || '').replace(/\/+$/, '');
    const newPath = `${cleanBase}/${finalFileName}`;

    const { error: moveError } = await supabase
      .storage
      .from('contratti-vendita')
      .move(tempPath, newPath);

    if (moveError) {
      return { ok: false, error: `Move PDA fallito (${tempPath} -> ${newPath}): ${moveError.message}` };
    }

    const { error: insertError } = await supabase
      .from('vendita_documenti')
      .insert({
        pratica_id: praticaId,
        contratto_id: contrattoId,
        anagrafica_id: anagraficaId,
        tipo_documento: 'contratto',
        storage_bucket: 'contratti-vendita',
        storage_path: newPath,
        file_name: finalFileName,
        mime_type: 'application/pdf',
        file_size: null,
        uploaded_by: uploadedBy || null
      });

    if (insertError) {
      await supabase.storage.from('contratti-vendita').remove([newPath]);
      return { ok: false, error: `Insert record vendita_documenti fallito per PDA ${newPath}: ${insertError.message}` };
    }

    return { ok: true, storage_path: newPath };
  } catch (err) {
    return { ok: false, error: err?.message || 'Errore promozione PDA' };
  }
}

async function rollbackPractice({ supabase, praticaId }) {
  const { data: documentiData, error: documentiError } = await supabase
    .from('vendita_documenti')
    .select('storage_bucket, storage_path')
    .eq('pratica_id', praticaId);
  const documenti = documentiError ? [] : (documentiData || []);
  const storageWarnings = documentiError
    ? [readableError(documentiError, 'Impossibile elencare i documenti da rimuovere')]
    : [];

  const { data: deletedPractice, error: deleteError } = await supabase
    .from('vendita_pratiche')
    .delete()
    .eq('id', praticaId)
    .eq('stato_pratica', 'bozza')
    .select('id')
    .maybeSingle();

  if (deleteError) {
    throw new Error(readableError(deleteError, 'Errore eliminazione pratica durante il rollback'));
  }
  if (!deletedPractice) {
    throw new Error('Rollback non eseguito: la pratica non è più in stato bozza');
  }

  const pathsByBucket = new Map();
  documenti.forEach((documento) => {
    const bucket = cleanString(documento.storage_bucket);
    const path = cleanString(documento.storage_path);
    if (!bucket || !path) return;
    if (!pathsByBucket.has(bucket)) pathsByBucket.set(bucket, []);
    pathsByBucket.get(bucket).push(path);
  });

  for (const [bucket, paths] of pathsByBucket.entries()) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) storageWarnings.push(`${bucket}: ${error.message}`);
  }

  return {
    rolled_back: true,
    documenti_rimossi: documenti.length,
    storage_warnings: storageWarnings
  };
}

function canManagePractice(auth, praticaRow) {
  if (auth?.profilo?.ruolo === 'admin') return true;
  const authOperatorId = authenticatedOperatorId(auth);
  return Boolean(authOperatorId && praticaRow?.operatore_id === authOperatorId);
}

async function loadManageablePractice({ supabase, auth, praticaId }) {
  if (!praticaId) {
    return { ok: false, status: 400, error: 'pratica_id non valido' };
  }

  const { data: praticaRow, error } = await supabase
    .from('vendita_pratiche')
    .select('id, anagrafica_id, operatore_id, stato_pratica, created_at')
    .eq('id', praticaId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: readableError(error, 'Errore lettura pratica') };
  }

  if (!praticaRow) {
    return { ok: false, status: 404, error: 'Pratica non trovata' };
  }

  if (!canManagePractice(auth, praticaRow)) {
    return { ok: false, status: 403, error: 'Non puoi modificare una pratica creata da un altro operatore' };
  }

  return { ok: true, praticaRow };
}

function normalizeCategoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeComparableText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
    .trim();
}

function validateCategorySpecificRules({ contract, category, offer, index }) {
  const categoryName = normalizeCategoryName(category?.nome);

  if (categoryName === 'fisso') {
    const tipoAttivazione = normalizeTextArrayValue(
      contract.tipo_attivazione,
      ['Nuova Attivazione', 'Portabilita', 'Portabilità'],
      `contratti[${index}].tipo_attivazione`
    );
    const apriChiudi = normalizeTextArrayValue(
      contract.apri_chiudi,
      ['Si', 'Sì', 'No'],
      `contratti[${index}].apri_chiudi`
    );

    contract.tipo_attivazione = tipoAttivazione === 'Portabilita' ? 'Portabilita' : tipoAttivazione;
    contract.apri_chiudi = apriChiudi === 'Si' ? 'Sì' : apriChiudi;

    if (contract.apri_chiudi === 'Sì') {
      contract.intestatario = normalizeTextArrayValue(
        contract.intestatario,
        ['Stesso intestatario', 'Intestatario diverso'],
        `contratti[${index}].intestatario`
      );
    } else {
      contract.intestatario = null;
    }
  }

  if (categoryName === 'allarmi') {
    contract.modalita_pagamento = normalizeTextArrayValue(
      contract.modalita_pagamento,
      ['Finanziamento', 'Anticipo'],
      `contratti[${index}].modalita_pagamento`
    );
  }

  if (categoryName === 'assicurazioni') {
    contract.modalita_pagamento_assicurazione = normalizeTextArrayValue(
      contract.modalita_pagamento_assicurazione,
      ['RID', 'Carta di Credito', 'Carta di Debito'],
      `contratti[${index}].modalita_pagamento_assicurazione`
    );
    if (!contract.modalita_pagamento_assicurazione) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].modalita_pagamento_assicurazione`);
    }
    contract.ricorrenza_assicurazione = normalizeTextArrayValue(
      contract.ricorrenza_assicurazione,
      ['Mensile', 'Annuale'],
      `contratti[${index}].ricorrenza_assicurazione`
    );
    if (!contract.ricorrenza_assicurazione) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].ricorrenza_assicurazione`);
    }
  } else {
    // Per altre categorie, ignora valori eventualmente arrivati dal client
    contract.modalita_pagamento_assicurazione = null;
    contract.ricorrenza_assicurazione = null;
  }

  const deviceEnabledForOffer = parseBoolean(offer?.abilita_dispositivo, false) === true;

  if (!deviceEnabledForOffer) {
    if (contract.dispositivo_associato) {
      throw new Error(`Dispositivo non ammesso per contratti[${index}]: offerta non abilitata alla gestione dispositivo`);
    }
    contract.imei = null;
    contract.fascia_prezzo = null;
    contract.tipo_acquisto = null;
    contract.finanziaria = null;
    contract.kolme = null;
    return;
  }

  if (!contract.dispositivo_associato) {
    contract.imei = null;
    contract.fascia_prezzo = null;
    contract.tipo_acquisto = null;
    contract.finanziaria = null;
    contract.kolme = null;
    return;
  }

  // Riconosce l'offerta Fisso "FWA Indoor" (case-insensitive, match parziale)
  // sul nome offerta. Per FWA Indoor: il device (modem) e' sempre associato,
  // ma tipo_acquisto + kolme + smartphone_reload non sono rilevanti.
  const offerName = String(offer?.nome_offerta || '').toLowerCase();
  const isFwaIndoor = categoryName === 'fisso' && offerName.includes('fwa') && offerName.includes('indoor');

  if (!contract.imei || !/^\d{15}$/.test(contract.imei)) {
    throw new Error(`IMEI non valido per contratti[${index}]: richieste 15 cifre`);
  }

  if (!contract.fascia_prezzo) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].fascia_prezzo`);
  }

  // tipo_acquisto: obbligatorio per Mobile/Customer Base.
  // Per Fisso FWA Indoor e' SEMPRE 'VAR' (modem a rate, mai finanziamento) -
  // il wizard lo blocca lato UI, qui lo forziamo come safety net server-side.
  if (isFwaIndoor) {
    contract.tipo_acquisto = 'VAR';
    contract.finanziaria = null;
  } else if (!contract.tipo_acquisto) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].tipo_acquisto`);
  }

  if (contract.tipo_acquisto && contract.tipo_acquisto.toLowerCase() === 'finanziamento') {
    if (!contract.finanziaria) {
      throw new Error(`Campo obbligatorio mancante: contratti[${index}].finanziaria`);
    }

    if (!['Findomestic', 'Compass'].includes(contract.finanziaria)) {
      throw new Error(`Finanziaria non valida per contratti[${index}]`);
    }
  } else {
    contract.finanziaria = null;
  }

  // kolme: obbligatorio per Mobile/Customer Base (device con telefono).
  // Per Fisso FWA Indoor (modem) e' opzionale: il wizard nasconde il campo
  // e il backend lo forza a NULL.
  if (isFwaIndoor) {
    contract.kolme = null;
    contract.smartphone_reload = null;
    contract.smartphone_reload_modalita = null;
  } else if (contract.kolme === null) {
    throw new Error(`Campo obbligatorio mancante: contratti[${index}].kolme`);
  }

  // Migration 035 — Smartphone Reload: la modalita e' obbligatoria solo se Si.
  // Coerenza con CHECK DB vc_smartphone_reload_coerenza_chk.
  if (contract.smartphone_reload === true && !contract.smartphone_reload_modalita) {
    throw new Error(`contratti[${index}].smartphone_reload=Si: smartphone_reload_modalita obbligatoria`);
  }
  if (contract.smartphone_reload !== true && contract.smartphone_reload_modalita) {
    // Sanity: il CHECK DB la rifiuterebbe; meglio normalizzarla qui.
    contract.smartphone_reload_modalita = null;
  }
}

function indexById(rows) {
  const map = new Map();
  (rows || []).forEach((row) => {
    map.set(row.id, row);
  });
  return map;
}

function numeric(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Marker versione fix: aumenta ogni volta che cambi la diagnostica per capire
// dai Netlify logs se la versione attiva contiene il fix atteso.
const CARRELLO_FIX_VERSION = '2026-07-25-integrity-v1';

exports.handler = async (event) => {
  // Debug trace id: correlare log della stessa richiesta nei Netlify Functions logs.
  const debugTraceId = `${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  console.log('[CARRELLO][BOOT]', { debugTraceId, fixVersion: CARRELLO_FIX_VERSION, method: event.httpMethod });
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return response(405, { success: false, error: 'Metodo non consentito: usa POST' });
  }

  const auth = await requireAuth(event);
  if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

  const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'] || '';

  if (!contentType.toLowerCase().includes('application/json')) {
    return response(415, {
      success: false,
      error: 'Content-Type non valido: usare application/json'
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return response(500, {
      success: false,
      error: 'Variabili ambiente mancanti: SUPABASE_URL e/o SUPABASE_SERVICE_ROLE_KEY'
    });
  }

  let payload;

  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return response(400, {
      success: false,
      error: 'JSON non valido nel body della richiesta'
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const action = cleanString(payload.action) || 'create';

  if (action === 'finalize') {
    const praticaId = normalizeUuidOrNull(payload.pratica_id);
    const manageable = await loadManageablePractice({ supabase, auth, praticaId });
    if (!manageable.ok) {
      return response(manageable.status, { success: false, error: manageable.error });
    }

    const { praticaRow } = manageable;
    if (praticaRow.stato_pratica === 'inviata') {
      return response(200, {
        success: true,
        finalized: true,
        already_finalized: true,
        pratica_id: praticaRow.id
      });
    }

    if (praticaRow.stato_pratica !== 'bozza') {
      return response(409, {
        success: false,
        error: `La pratica non puo' essere finalizzata dallo stato ${praticaRow.stato_pratica}`
      });
    }

    const { data: finalizedPractice, error: finalizeError } = await supabase
      .from('vendita_pratiche')
      .update({ stato_pratica: 'inviata' })
      .eq('id', praticaRow.id)
      .eq('stato_pratica', 'bozza')
      .select('id')
      .maybeSingle();

    if (finalizeError) {
      return response(500, {
        success: false,
        error: readableError(finalizeError, 'Errore finalizzazione pratica')
      });
    }
    if (!finalizedPractice) {
      return response(409, {
        success: false,
        error: 'La pratica ha cambiato stato durante la finalizzazione'
      });
    }

    let cleanupCcEventi = null;
    let cleanupCcWarning = null;
    try {
      const { data: cleanupResult, error: cleanupError } = await supabase.rpc(
        'vendita_chiudi_eventi_cc_per_pratica',
        { p_anagrafica_id: praticaRow.anagrafica_id, p_pratica_id: praticaRow.id }
      );
      if (cleanupError) {
        cleanupCcWarning = cleanupError.message;
      } else {
        cleanupCcEventi = cleanupResult;
      }
    } catch (cleanupEx) {
      cleanupCcWarning = cleanupEx?.message || String(cleanupEx);
    }

    return response(200, {
      success: true,
      finalized: true,
      already_finalized: false,
      pratica_id: praticaRow.id,
      cleanup_cc_eventi: cleanupCcEventi,
      cleanup_cc_warning: cleanupCcWarning
    });
  }

  if (action === 'rollback_upload_failure') {
    const praticaId = normalizeUuidOrNull(payload.pratica_id);
    const manageable = await loadManageablePractice({ supabase, auth, praticaId });

    if (!manageable.ok) {
      if (manageable.status === 404) {
        return response(200, {
          success: true,
          rolled_back: false,
          already_missing: true,
          pratica_id: praticaId
        });
      }
      return response(manageable.status, { success: false, error: manageable.error });
    }

    const { praticaRow } = manageable;
    if (praticaRow.stato_pratica === 'inviata') {
      return response(200, {
        success: true,
        rolled_back: false,
        already_finalized: true,
        pratica_id: praticaRow.id
      });
    }

    if (praticaRow.stato_pratica !== 'bozza') {
      return response(409, {
        success: false,
        error: `La pratica non puo' essere annullata dallo stato ${praticaRow.stato_pratica}`
      });
    }

    try {
      const rollbackResult = await rollbackPractice({ supabase, praticaId: praticaRow.id });
      return response(200, {
        success: true,
        pratica_id: praticaRow.id,
        ...rollbackResult
      });
    } catch (rollbackError) {
      return response(500, {
        success: false,
        error: readableError(rollbackError, 'Rollback pratica incompleta fallito')
      });
    }
  }

  if (action !== 'create') {
    return response(400, { success: false, error: 'Azione non valida' });
  }

  const cliente = payload.cliente || {};
  const pratica = payload.pratica || {};
  const contrattiRaw = Array.isArray(payload.contratti) ? payload.contratti : [];

  const cfPiva = normalizeCfPiva(cliente.cf_piva);
  const ragioneSociale = cleanString(cliente.ragione_sociale);
  const nomeReferente = cleanString(cliente.nome_referente);
  const cellulare = cleanString(cliente.cellulare);
  const email = cleanString(cliente.email);
  const provincia = cleanString(cliente.provincia);
  const comune = cleanString(cliente.comune);
  const via = cleanString(cliente.via);
  const civico = cleanString(cliente.civico);

  let cluster;

  try {
    cluster = normalizeCluster(cliente.cluster);
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }
  const anagraficaCluster = clusterForAnagrafica(cluster);
  const isTurista = cluster === 'Turista';

  if (!cfPiva) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.cf_piva' });
  }

  if (!ragioneSociale) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.ragione_sociale' });
  }

  // Strict contacts validation: cellulare sempre obbligatorio; email obbligatoria
  // per Consumer/Business e facoltativa per Turista. Il backend resta la source of truth.
  if (!cellulare) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.cellulare' });
  }
  if (!isTurista && !email) {
    return response(400, { success: false, error: 'Campo obbligatorio mancante: cliente.email' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response(400, { success: false, error: 'cliente.email non e\' un indirizzo valido' });
  }

  if (contrattiRaw.length === 0) {
    return response(400, { success: false, error: 'Inserire almeno un contratto nel carrello' });
  }

  let normalizedContracts = [];

  try {
    normalizedContracts = contrattiRaw.map((contract, index) => normalizeContractInput(contract, index));
  } catch (error) {
    return response(400, { success: false, error: error.message });
  }

  const originePratica = cleanString(pratica.origine_pratica) || 'spontaneo';
  const appuntamentoId = normalizeUuidOrNull(pratica.appuntamento_id);
  const chiamataId = normalizeUuidOrNull(pratica.chiamata_id);
  const operatoreId = authenticatedOperatorId(auth);
  const requestedOperatoreId = normalizeUuidOrNull(pratica.operatore_id);

  if (!operatoreId) {
    return response(500, { success: false, error: 'Profilo autenticato privo di un identificativo operatore valido' });
  }

  if (requestedOperatoreId && requestedOperatoreId !== operatoreId) {
    console.warn('[CARRELLO][SECURITY] operatore_id client ignorato', {
      debugTraceId,
      requestedOperatoreId,
      authenticatedOperatoreId: operatoreId
    });
  }

  if (!ORIGINI_PRATICA_AMMESSE.has(originePratica)) {
    return response(400, {
      success: false,
      error: 'origine_pratica non valida. Valori ammessi: appuntamento_callcenter, contatto_callcenter_entro_10_giorni, spontaneo'
    });
  }

  let createdPraticaId = null;

  try {
    let anagraficaId;

    const { data: anagraficaRows, error: anagraficaLookupError } = await supabase
      .from('anagrafica')
      .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
      .ilike('cf_piva', cfPiva)
      .limit(1);

    if (anagraficaLookupError) {
      throw new Error(readableError(anagraficaLookupError, 'Errore ricerca anagrafica'));
    }

    const anagraficaEsistente = Array.isArray(anagraficaRows) ? anagraficaRows[0] || null : null;

    if (anagraficaEsistente) {
      anagraficaId = anagraficaEsistente.id;

      const updates = {};
      const candidateFields = {
        cluster: anagraficaCluster,
        ragione_sociale: ragioneSociale,
        nome_referente: nomeReferente,
        cellulare,
        email,
        provincia,
        comune,
        via,
        civico
      };

      if (cleanString(anagraficaEsistente.cf_piva) !== cfPiva) {
        updates.cf_piva = cfPiva;
      }

      Object.entries(candidateFields).forEach(([column, newValue]) => {
        if (isBlank(newValue)) return;
        const currentValue = anagraficaEsistente[column];

        if (isBlank(currentValue) || String(currentValue).trim() !== String(newValue).trim()) {
          updates[column] = newValue;
        }
      });

      if (Object.keys(updates).length > 0) {
        const { error: anagraficaUpdateError } = await supabase
          .from('anagrafica')
          .update(updates)
          .eq('id', anagraficaId);

        if (anagraficaUpdateError) {
          throw new Error(readableError(anagraficaUpdateError, 'Errore aggiornamento anagrafica esistente'));
        }
      }
    } else {
      const { data: anagraficaNuova, error: anagraficaInsertError } = await supabase
        .from('anagrafica')
        .insert({
          cf_piva: cfPiva,
          cluster: anagraficaCluster,
          ragione_sociale: ragioneSociale,
          nome_referente: nomeReferente,
          cellulare,
          email,
          provincia,
          comune,
          via,
          civico
        })
        .select('id')
        .single();

      if (anagraficaInsertError) {
        throw new Error(readableError(anagraficaInsertError, 'Errore creazione anagrafica'));
      }

      anagraficaId = anagraficaNuova.id;
    }

    // ----------------------------------------------------------------
    // GUARD CONSENSO PRIVACY (migration 034).
    // La pratica non puo' essere creata se per l'anagrafica non esiste
    // una dichiarazione 'confermata', non scaduta, non revocata e riferita
    // a una delle due versioni informative correnti. Il wizard
    // dovrebbe averlo raccolto (modale OTP o cartaceo) prima del submit
    // oppure trovato nel riuso massimo di 24 mesi. Il client puo' passare
    // pratica.consenso_id per evitare race su consensi multipli; se
    // passato, verifichiamo che corrisponda davvero a quello attivo.
    // ----------------------------------------------------------------
    const consensoIdInput = normalizeUuidOrNull(pratica.consenso_id);
    const { data: consensoAttivo, error: consensoLookupError } = await supabase
      .from('vendita_consensi_privacy')
      .select('id, anagrafica_id, stato, modalita, informativa_versione, valido_fino_al, revocato_at')
      .eq('anagrafica_id', anagraficaId)
      .eq('stato', 'confermato')
      .in('informativa_versione', INFORMATIVE_VERSIONI_CORRENTI)
      .is('revocato_at', null)
      .gt('valido_fino_al', new Date().toISOString())
      .order('valido_fino_al', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (consensoLookupError) {
      throw new Error(readableError(consensoLookupError, 'Errore verifica informativa privacy'));
    }
    if (!consensoAttivo) {
      throw new Error('Informativa privacy mancante o scaduta per questo cliente. Registrare una nuova presa visione (OTP via SMS o modulo cartaceo firmato) prima di inviare la pratica.');
    }
    if (consensoIdInput && consensoIdInput !== consensoAttivo.id) {
      throw new Error('consenso_id passato dal client non corrisponde al consenso attivo per questa anagrafica');
    }
    const consensoIdValidato = consensoAttivo.id;

    const { data: praticaRow, error: praticaInsertError } = await supabase
      .from('vendita_pratiche')
      .insert({
        anagrafica_id: anagraficaId,
        appuntamento_id: appuntamentoId,
        chiamata_id: chiamataId,
        operatore_id: operatoreId,
        origine_pratica: originePratica,
        // La pratica resta bozza finche' il client non ha completato tutti
        // gli upload. L'action "finalize" la rende visibile come inviata.
        stato_pratica: 'bozza',
        note: cleanString(pratica.note) || 'Pratica creata da carrello upload contratti vendita'
      })
      .select('*')
      .single();

    if (praticaInsertError) {
      throw new Error(readableError(praticaInsertError, 'Errore creazione vendita_pratiche'));
    }

    createdPraticaId = praticaRow.id;

    // Back-link al consenso privacy: se il consenso non aveva pratica_id (es.
    // appena raccolto senza pratica_id forward dal client), lo agganciamo qui.
    // Best-effort: se l'update fallisce non rompiamo la pratica.
    try {
      await supabase
        .from('vendita_consensi_privacy')
        .update({ pratica_id: praticaRow.id })
        .eq('id', consensoIdValidato)
        .is('pratica_id', null);
    } catch (_) { /* ignore */ }

    const { nomeCartellaStorage, storageBasePath } = buildStorageNames({
      ragioneSociale,
      praticaId: praticaRow.id,
      now: new Date()
    });

    const { error: praticaUpdateStorageError } = await supabase
      .from('vendita_pratiche')
      .update({
        nome_cartella_storage: nomeCartellaStorage,
        storage_base_path: storageBasePath
      })
      .eq('id', praticaRow.id);

    if (praticaUpdateStorageError) {
      throw new Error(readableError(praticaUpdateStorageError, 'Errore aggiornamento storage path pratica'));
    }

    const categoriaIds = [...new Set(normalizedContracts.map((item) => item.categoria_id))];
    const offertaIds = [...new Set(normalizedContracts.map((item) => item.offerta_id))];
    const opzioneIds = [...new Set(normalizedContracts.map((item) => item.opzione_id).filter(Boolean))];
    const reloadIds = [...new Set(normalizedContracts.map((item) => item.reload_id).filter(Boolean))];

    const queryPromises = [
      supabase.from('vendita_categorie').select('*').in('id', categoriaIds).eq('attiva', true),
      supabase.from('vendita_offerte').select('*').in('id', offertaIds).eq('attiva', true),
      opzioneIds.length > 0
        ? supabase.from('vendita_opzioni').select('*').in('id', opzioneIds).eq('attiva', true)
        : Promise.resolve({ data: [], error: null }),
      reloadIds.length > 0
        ? supabase.from('vendita_reload').select('*').in('id', reloadIds).eq('attivo', true)
        : Promise.resolve({ data: [], error: null })
    ];

    const [categorieRes, offerteRes, opzioniRes, reloadRes] = await Promise.all(queryPromises);

    const firstError =
      categorieRes.error ||
      offerteRes.error ||
      opzioniRes.error ||
      reloadRes.error;

    if (firstError) {
      throw new Error(readableError(firstError, 'Errore caricamento configurazione contratti'));
    }

    const categorieById = indexById(categorieRes.data);
    const offerteById = indexById(offerteRes.data);
    const opzioniById = indexById(opzioniRes.data);
    const reloadById = indexById(reloadRes.data);

    // DIAG: dump del catalogo offerte caricato con la PRIMA query. Solo campi tecnici.
    console.log('[CARRELLO][DIAG][CATALOGO_1]', {
      debugTraceId,
      offerte: (offerteRes.data || []).map(o => ({
        id: o.id, nome: o.nome_offerta, cluster: o.cluster_cliente,
        punteggio_gara: o.punteggio_gara,
        punteggio_extra_gara: o.punteggio_extra_gara,
        tipi: { pg: typeof o.punteggio_gara, pex: typeof o.punteggio_extra_gara }
      })),
      opzioni: (opzioniRes.data || []).map(o => ({
        id: o.id, nome: o.nome_opzione,
        punteggio_gara: o.punteggio_gara,
        punteggio_extra_gara: o.punteggio_extra_gara
      }))
    });

    // Sanity check punteggi (guardia difensiva post-incidente 22-23/07/2026):
    // il 22-23/07/2026 sono stati creati 14 contratti con snapshot punteggi = 0
    // pur essendo agganciati a offerte del catalogo con valori > 0. La root cause
    // esatta e' ignota (ipotesi: SDK cache stale, race, replica lag). Qui rifetch
    // gli STESSI record via seconda query indipendente e confronto: se divergono
    // blocco la creazione con messaggio comprensibile invece di salvare in DB
    // uno snapshot silenziosamente sbagliato che poi falsifica gare e classifiche.
    if (offertaIds.length > 0) {
      const { data: freshOfferte, error: freshOfferteErr } = await supabase
        .from('vendita_offerte')
        .select('id, punteggio_gara, punteggio_extra_gara')
        .in('id', offertaIds);
      if (freshOfferteErr) {
        throw new Error(readableError(freshOfferteErr, 'Sanity check punteggi offerte fallito'));
      }
      // DIAG: dump del catalogo offerte caricato con la SECONDA query (fresh).
      console.log('[CARRELLO][DIAG][CATALOGO_2_FRESH]', {
        debugTraceId,
        offerte: (freshOfferte || []).map(o => ({
          id: o.id, punteggio_gara: o.punteggio_gara,
          punteggio_extra_gara: o.punteggio_extra_gara,
          tipi: { pg: typeof o.punteggio_gara, pex: typeof o.punteggio_extra_gara }
        }))
      });
      const freshById = indexById(freshOfferte || []);
      for (const off of offerteRes.data) {
        const fresh = freshById.get(off.id);
        if (!fresh) {
          console.error('Sanity punteggi: offerta scomparsa fra prima e seconda query', { id: off.id });
          throw new Error(`Sanity check fallito: offerta ${off.nome_offerta || off.id} non piu' presente al re-check. Ricarica la pagina e riprova.`);
        }
        const pgFirst = String(off.punteggio_gara ?? '');
        const pgFresh = String(fresh.punteggio_gara ?? '');
        const pexFirst = String(off.punteggio_extra_gara ?? '');
        const pexFresh = String(fresh.punteggio_extra_gara ?? '');
        if (pgFirst !== pgFresh || pexFirst !== pexFresh) {
          console.error('Sanity punteggi: divergenza catalogo', {
            offerta_id: off.id, nome: off.nome_offerta,
            prima: { punteggio_gara: pgFirst, punteggio_extra_gara: pexFirst },
            fresh: { punteggio_gara: pgFresh, punteggio_extra_gara: pexFresh }
          });
          throw new Error(`Sanity check fallito: catalogo punteggi incoerente per offerta "${off.nome_offerta}". Ricarica la pagina e riprova.`);
        }
        if (off.punteggio_gara === null || off.punteggio_gara === undefined || off.punteggio_gara === '') {
          console.error('Sanity punteggi: punteggio_gara null nel catalogo caricato', { offerta_id: off.id, nome: off.nome_offerta });
          throw new Error(`Configurazione anomala: l'offerta "${off.nome_offerta}" non ha punteggio_gara nel catalogo. Contatta l'assistenza.`);
        }
      }
    }

    // Migration 049 — bonus configurabile per Assicurazioni Annuale.
    // Letto UNA volta prima del loop dei contratti per evitare N query.
    // Se la chiave non esiste o il valore non parsa, bonus = 0 (no-op).
    let bonusAssicurazioneAnnuale = 0;
    try {
      const { data: setting } = await supabase
        .from('impostazioni')
        .select('valore')
        .eq('chiave', 'bonus_assicurazione_annuale')
        .maybeSingle();
      const parsed = parseFloat(String(setting?.valore ?? '').replace(',', '.'));
      if (Number.isFinite(parsed) && parsed >= 0) bonusAssicurazioneAnnuale = parsed;
    } catch (_) { /* bonus resta 0 se qualcosa va storto */ }

    const createdContracts = [];

    for (let index = 0; index < normalizedContracts.length; index += 1) {
      const item = normalizedContracts[index];
      const categoria = categorieById.get(item.categoria_id);
      const offerta = offerteById.get(item.offerta_id);

      if (!categoria) {
        throw new Error(`Categoria non trovata o non attiva per contratti[${index}]`);
      }

      if (!offerta) {
        throw new Error(`Offerta non trovata o non attiva per contratti[${index}]`);
      }

      if (offerta.categoria_id !== item.categoria_id) {
        throw new Error(`Offerta non coerente con categoria per contratti[${index}]`);
      }

      const isTuristaCluster = cluster === 'Turista';

      if (isTuristaCluster) {
        const categoriaNormalized = normalizeCategoryName(categoria.nome);
        const offertaNormalized = normalizeComparableText(offerta.nome_offerta);

        if (categoriaNormalized !== normalizeCategoryName(TURISTA_CATEGORIA_FISSA)) {
          throw new Error(`Per cluster Turista la categoria deve essere ${TURISTA_CATEGORIA_FISSA} (contratti[${index}])`);
        }

        if (offertaNormalized !== normalizeComparableText(TURISTA_OFFERTA_FISSA)) {
          throw new Error(`Per cluster Turista l'offerta deve essere "${TURISTA_OFFERTA_FISSA}" (contratti[${index}])`);
        }
      } else if (cluster && offerta.cluster_cliente && offerta.cluster_cliente !== cluster) {
        throw new Error(`Offerta non coerente con cluster per contratti[${index}]`);
      }

      let opzione = null;

      if (item.opzione_id) {
        opzione = opzioniById.get(item.opzione_id);

        if (!opzione) {
          throw new Error(`Opzione non trovata o non attiva per contratti[${index}]`);
        }

        const opzioneCategoriaOk = !opzione.categoria_id || opzione.categoria_id === item.categoria_id;
        const opzioneOffertaOk = !opzione.offerta_id || opzione.offerta_id === item.offerta_id;

        if (!opzioneCategoriaOk || !opzioneOffertaOk) {
          throw new Error(`Opzione non coerente con categoria/offerta per contratti[${index}]`);
        }

        if (!isTuristaCluster && cluster && opzione.cluster_cliente && opzione.cluster_cliente !== cluster) {
          throw new Error(`Opzione non coerente con cluster per contratti[${index}]`);
        }
      }

      let reload = null;

      if (item.reload_id) {
        reload = reloadById.get(item.reload_id);

        if (!reload) {
          throw new Error(`Reload non trovato o non attivo per contratti[${index}]`);
        }
      }

      validateCategorySpecificRules({
        contract: item,
        category: categoria,
        offer: offerta,
        index
      });

      // Validazione reinserimento (migration 033).
      //   - stato_inserimento default 'inserimento'; ammessi 'inserimento'/'reinserimento'
      //   - se 'reinserimento' => reinserimento_di_contratto_id DEVE essere UUID valido
      //     e riferire un contratto esistente con stessa anagrafica e stessa categoria.
      //   - se 'inserimento' => reinserimento_di_contratto_id viene forzato a null.
      const statoInsRaw = cleanString(item.stato_inserimento);
      const statoInserimento = statoInsRaw || 'inserimento';
      if (!['inserimento', 'reinserimento'].includes(statoInserimento)) {
        throw new Error(`contratti[${index}].stato_inserimento non valido: usa "inserimento" o "reinserimento"`);
      }
      item.stato_inserimento = statoInserimento;

      if (statoInserimento === 'reinserimento') {
        const reinsId = normalizeUuidOrNull(item.reinserimento_di_contratto_id);
        if (!reinsId) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id obbligatorio (UUID) se stato_inserimento='reinserimento'`);
        }
        const { data: parentContract, error: parentErr } = await supabase
          .from('vendita_contratti')
          .select('id, anagrafica_id, categoria_id, data_contratto')
          .eq('id', reinsId)
          .maybeSingle();
        if (parentErr) {
          throw new Error(`Errore verifica reinserimento_di_contratto_id (contratti[${index}]): ${parentErr.message}`);
        }
        if (!parentContract) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id non trovato`);
        }
        if (parentContract.anagrafica_id !== anagraficaId) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id appartiene a un altro cliente`);
        }
        if (parentContract.categoria_id !== item.categoria_id) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id e' di una categoria diversa`);
        }
        if (!isSameRomeCalendarMonth(parentContract.data_contratto)) {
          throw new Error(`contratti[${index}].reinserimento_di_contratto_id non appartiene al mese solare corrente`);
        }

        const reinserimentoConfig = REINSERIMENTO_POST_VENDITA[normalizeCategoryName(categoria.nome)];
        if (!reinserimentoConfig) {
          throw new Error(`La categoria ${categoria.nome} non ammette reinserimenti`);
        }

        const { data: postVenditaRow, error: postVenditaError } = await supabase
          .from(reinserimentoConfig.table)
          .select('stato')
          .eq('contratto_id', reinsId)
          .maybeSingle();

        if (postVenditaError) {
          throw new Error(`Errore verifica stato post-vendita del reinserimento: ${postVenditaError.message}`);
        }
        if (!postVenditaRow || !reinserimentoConfig.stati.has(postVenditaRow.stato)) {
          throw new Error(`Il contratto indicato non ha uno stato post-vendita valido per il reinserimento`);
        }
        item.reinserimento_di_contratto_id = reinsId;
      } else {
        item.reinserimento_di_contratto_id = null;
      }

      // Validazione tipo_firma:
      //  - categorie PDA (Mobile/Customer Base/Fisso): valore obbligatorio in
      //    ('elettronica','cartacea')
      //  - categorie senza PDA: deve essere null (verra' resettato a null se inviato)
      if (isCategoriaPda(categoria.nome)) {
        if (!item.tipo_firma) {
          throw new Error(`Campo obbligatorio mancante: contratti[${index}].tipo_firma`);
        }
        if (!['elettronica', 'cartacea'].includes(item.tipo_firma)) {
          throw new Error(`contratti[${index}].tipo_firma non valido: usa "elettronica" o "cartacea"`);
        }
      } else {
        item.tipo_firma = null;
      }

      const punteggioGaraOfferta = parseRequiredScore(
        offerta.punteggio_gara,
        `punteggio_gara offerta (contratti[${index}])`
      );
      let punteggioGaraOpzione = opzione
        ? parseRequiredScore(opzione.punteggio_gara, `punteggio_gara opzione (contratti[${index}])`)
        : 0;
      // Migration 049 — Bonus Assicurazione Annuale.
      // Se categoria=Assicurazioni AND ricorrenza=Annuale, sommo il bonus
      // configurato in impostazioni['bonus_assicurazione_annuale'] al
      // punteggio_gara_opzione. Il valore e' snapshot alla creazione
      // (contratti storici non vengono retroattivamente aggiornati se
      // l'admin modifica il bonus in futuro).
      if (
        bonusAssicurazioneAnnuale > 0
        && normalizeCategoryName(categoria.nome) === normalizeCategoryName('Assicurazioni')
        && item.ricorrenza_assicurazione === 'Annuale'
      ) {
        punteggioGaraOpzione = Number((punteggioGaraOpzione + bonusAssicurazioneAnnuale).toFixed(2));
      }
      const punteggioExtraGaraOfferta = parseOptionalScore(offerta.punteggio_extra_gara, 0);
      const punteggioExtraGaraOpzione = opzione ? parseOptionalScore(opzione.punteggio_extra_gara, 0) : 0;

      const punteggioOfferta = punteggioGaraOfferta;
      const punteggioOpzione = punteggioGaraOpzione;
      const punteggioExtra = 0;
      const punteggioTotale = Number((punteggioOfferta + punteggioOpzione + punteggioExtra).toFixed(2));

      const contrattoPayload = {
        pratica_id: praticaRow.id,
        anagrafica_id: anagraficaId,
        appuntamento_id: appuntamentoId,
        chiamata_id: chiamataId,
        operatore_id: operatoreId,

        cluster_cliente: cluster,
        categoria_id: item.categoria_id,
        offerta_id: item.offerta_id,
        opzione_id: item.opzione_id,
        reload_id: item.reload_id,

        categoria_snapshot: categoria.nome,
        nome_offerta_snapshot: offerta.nome_offerta,
        nome_opzione_snapshot: opzione ? opzione.nome_opzione : null,
        nome_reload_snapshot: reload ? reload.nome : null,

        punteggio_gara_offerta: punteggioGaraOfferta,
        punteggio_gara_opzione: punteggioGaraOpzione,
        punteggio_extra_gara_offerta: punteggioExtraGaraOfferta,
        punteggio_extra_gara_opzione: punteggioExtraGaraOpzione,

        punteggio_offerta: punteggioOfferta,
        punteggio_opzione: punteggioOpzione,
        punteggio_extra: punteggioExtra,
        punteggio_totale: punteggioTotale,

        tipo_attivazione: item.tipo_attivazione,
        apri_chiudi: item.apri_chiudi,
        intestatario: item.intestatario,
        switch_sim: item.switch_sim,
        modalita_pagamento: item.modalita_pagamento,

        dispositivo_associato: item.dispositivo_associato,
        imei: item.imei,
        fascia_prezzo: item.fascia_prezzo,
        tipo_acquisto: item.tipo_acquisto,
        finanziaria: item.finanziaria,
        kolme: item.kolme,

        // Migration 035 - Smartphone Reload + modalita
        smartphone_reload: item.smartphone_reload,
        smartphone_reload_modalita: item.smartphone_reload_modalita,

        // Campi extra Mirox (vedi migration 012_contratti_extra_fields.sql)
        pod_pdr: item.pod_pdr,
        numero_contratto_energia: item.numero_contratto_energia,
        prezzo_fisso: item.prezzo_fisso,
        reload_exchange: item.reload_exchange,
        reload_forever: item.reload_forever,

        // Codice Rivenditore (vedi migration 050): sempre valorizzato, default Legnago.
        codice_rivenditore: item.codice_rivenditore,

        // Tipo firma (vedi migration 016): solo per categorie PDA. null altrimenti.
        tipo_firma: item.tipo_firma,

        // Convergenza (vedi migration 017): solo Fisso. null altrimenti.
        convergenza: item.convergenza,

        // Campi specifici Assicurazioni (vedi migration 021): null per altre categorie.
        modalita_pagamento_assicurazione: item.modalita_pagamento_assicurazione,
        ricorrenza_assicurazione: item.ricorrenza_assicurazione,

        // Reinserimento (vedi migration 033): default 'inserimento'.
        // Se 'reinserimento', reinserimento_di_contratto_id e' gia' stato
        // validato sopra (UUID, stessa anagrafica, stessa categoria).
        stato_inserimento: item.stato_inserimento,
        reinserimento_di_contratto_id: item.reinserimento_di_contratto_id,

        stato_controllo: 'da_controllare'
      };

      // DIAG pre-INSERT: dump valori punteggi calcolati + valori raw catalogo.
      console.log('[CARRELLO][DIAG][PRE_INSERT]', {
        debugTraceId, index,
        offerta_id: item.offerta_id, offerta_nome: offerta.nome_offerta,
        opzione_id: item.opzione_id, opzione_nome: opzione ? opzione.nome_opzione : null,
        raw_catalogo: {
          offerta_pg: offerta.punteggio_gara, offerta_pex: offerta.punteggio_extra_gara,
          opzione_pg: opzione ? opzione.punteggio_gara : null,
          opzione_pex: opzione ? opzione.punteggio_extra_gara : null
        },
        parsed: {
          pg_offerta: punteggioGaraOfferta, pex_offerta: punteggioExtraGaraOfferta,
          pg_opzione: punteggioGaraOpzione, pex_opzione: punteggioExtraGaraOpzione
        }
      });

      const { data: insertedContract, error: contractInsertError } = await supabase
        .from('vendita_contratti')
        .insert(contrattoPayload)
        .select('*')
        .single();

      // DIAG post-INSERT: cosa ha effettivamente scritto il DB (per catturare
      // eventuali trigger che riscrivono i valori — es. trg_calcola_punteggio_totale).
      if (insertedContract) {
        console.log('[CARRELLO][DIAG][POST_INSERT]', {
          debugTraceId, index, contratto_id: insertedContract.id,
          scritti: {
            pg_offerta: insertedContract.punteggio_gara_offerta,
            pex_offerta: insertedContract.punteggio_extra_gara_offerta,
            pg_opzione: insertedContract.punteggio_gara_opzione,
            pex_opzione: insertedContract.punteggio_extra_gara_opzione,
            pg_totale: insertedContract.punteggio_gara_totale,
            pex_totale: insertedContract.punteggio_extra_gara_totale
          }
        });
      }

      if (contractInsertError) {
        throw new Error(readableError(contractInsertError, `Errore creazione contratto indice ${index}`));
      }

      createdContracts.push({
        temp_id: item.temp_id,
        contratto_id: insertedContract.id,
        categoria_snapshot: insertedContract.categoria_snapshot,
        nome_offerta_snapshot: insertedContract.nome_offerta_snapshot,
        nome_opzione_snapshot: insertedContract.nome_opzione_snapshot,
        nome_reload_snapshot: insertedContract.nome_reload_snapshot,
        punteggio_gara_totale: numeric(
          insertedContract.punteggio_gara_totale,
          numeric(insertedContract.punteggio_gara_offerta, 0) + numeric(insertedContract.punteggio_gara_opzione, 0)
        ),
        punteggio_extra_gara_totale: numeric(
          insertedContract.punteggio_extra_gara_totale,
          numeric(insertedContract.punteggio_extra_gara_offerta, 0) + numeric(insertedContract.punteggio_extra_gara_opzione, 0)
        )
      });

      // Promozione PDA temp -> cartella pratica (se applicabile).
      // Un errore fa fallire l'intera creazione: il catch esegue il rollback
      // di pratica, contratti, record documenti e file gia' promossi.
      if (item.pda_temp_path) {
        const result = await promoteTempPda({
          supabase,
          tempPath: item.pda_temp_path,
          basePath: storageBasePath,
          categoriaName: categoria.nome,
          praticaId: praticaRow.id,
          contrattoId: insertedContract.id,
          anagraficaId,
          uploadedBy: operatoreId
        });
        if (!result.ok) {
          throw new Error(`Promozione PDA fallita per contratti[${index}]: ${result.error}`);
        }
      }
    }

    return response(200, {
      success: true,
      anagrafica_id: anagraficaId,
      pratica_id: praticaRow.id,
      consenso_id: consensoIdValidato,
      storage_base_path: storageBasePath,
      nome_cartella_storage: nomeCartellaStorage,
      contratti: createdContracts,
      requires_finalization: true
    });
  } catch (error) {
    if (createdPraticaId) {
      try {
        await rollbackPractice({ supabase, praticaId: createdPraticaId });
      } catch (rollbackError) {
        console.error('[CARRELLO][ROLLBACK] rollback interno fallito', {
          debugTraceId,
          praticaId: createdPraticaId,
          error: readableError(rollbackError)
        });
      }
    }

    const message = readableError(error);
    const statusCode = /obbligatorio|non valido|coerente|ammesso|trovata|trovato|inserire|mese solare|stato post-vendita|non ammette/i.test(message) ? 400 : 500;

    return response(statusCode, {
      success: false,
      error: message
    });
  }
};

exports._test = {
  authenticatedOperatorId,
  getRomeYearMonth,
  isSameRomeCalendarMonth,
  normalizeContractInput
};
