/**
 * GET /.netlify/functions/check-consenso-privacy?anagrafica_id=<uuid>
 *
 * Verifica se per l'anagrafica esiste una dichiarazione privacy gia' attiva
 * (una delle versioni correnti, stato='confermato', non scaduta, non revocata).
 * Usato dal wizard upload-contratti-vendita per il dedupe di 24 mesi e da
 * Storico Cliente, con `include_history=true`, per mostrare l'esito effettivo
 * e scaricare l'ultimo PDF archiviato, anche quando non e' piu' riutilizzabile
 * per una nuova pratica. Senza il parametro mantiene la response e il costo
 * della verifica dedupe originaria.
 *
 * Response 200:
 *   {
 *     valido: true,
 *     consenso: {
 *       id, modalita, valido_fino_al, confermato_at,
 *       consenso_marketing, modalita_label
 *     }
 *   }
 * oppure:
 * oppure:
 *   {
 *     valido: false,
 *     consenso: null,
 *     esito: { codice, ... },
 *     documento: { pdf_storage_path, pdf_filename, ... } | null
 *   }
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');
const { INFORMATIVE_VERSIONI_CORRENTI } = require('./_lib/privacy-config');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

const CONSENSO_FIELDS = [
    'id',
    'modalita',
    'stato',
    'valido_fino_al',
    'otp_confermato_at',
    'otp_scade_at',
    'created_at',
    'informativa_versione',
    'consenso_marketing',
    'pdf_storage_path',
    'pdf_filename',
    'revocato_at'
].join(', ');

function serializeConsenso(data) {
    if (!data) return null;
    return {
        id: data.id,
        modalita: data.modalita,
        modalita_label: data.modalita === 'cartaceo'
            ? 'Modulo cartaceo firmato'
            : 'Dichiarazione elettronica via OTP SMS',
        stato: data.stato,
        valido_fino_al: data.valido_fino_al,
        confermato_at: data.otp_confermato_at || data.created_at,
        otp_scade_at: data.otp_scade_at,
        informativa_versione: data.informativa_versione,
        consenso_marketing: !!data.consenso_marketing,
        pdf_storage_path: data.pdf_storage_path,
        pdf_filename: data.pdf_filename,
        revocato_at: data.revocato_at
    };
}

function deriveEsito(consensoValido, ultimoConsenso) {
    if (consensoValido) {
        return {
            codice: 'valido',
            valido_fino_al: consensoValido.valido_fino_al,
            confermato_at: consensoValido.otp_confermato_at || consensoValido.created_at
        };
    }
    if (!ultimoConsenso) return { codice: 'non_firmato' };
    if (ultimoConsenso.revocato_at || ultimoConsenso.stato === 'revocato') {
        return {
            codice: 'revocato',
            revocato_at: ultimoConsenso.revocato_at,
            confermato_at: ultimoConsenso.otp_confermato_at || ultimoConsenso.created_at
        };
    }
    if (ultimoConsenso.stato === 'confermato') {
        if (!INFORMATIVE_VERSIONI_CORRENTI.includes(ultimoConsenso.informativa_versione)) {
            return {
                codice: 'da_rinnovare',
                valido_fino_al: ultimoConsenso.valido_fino_al,
                confermato_at: ultimoConsenso.otp_confermato_at || ultimoConsenso.created_at
            };
        }
        return {
            codice: 'scaduto',
            valido_fino_al: ultimoConsenso.valido_fino_al,
            confermato_at: ultimoConsenso.otp_confermato_at || ultimoConsenso.created_at
        };
    }
    if (ultimoConsenso.stato === 'pending') {
        const otpScadeAt = ultimoConsenso.otp_scade_at
            ? new Date(ultimoConsenso.otp_scade_at).getTime()
            : 0;
        return {
            codice: otpScadeAt > Date.now() ? 'in_attesa' : 'scaduto',
            otp_scade_at: ultimoConsenso.otp_scade_at
        };
    }
    if (ultimoConsenso.stato === 'fallito') return { codice: 'fallito' };
    if (ultimoConsenso.stato === 'scaduto') return { codice: 'scaduto', otp_scade_at: ultimoConsenso.otp_scade_at };
    return { codice: 'non_firmato' };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers: CORS_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'GET') {
        return response(405, { success: false, error: 'Metodo non consentito: usa GET' });
    }

    const auth = await requireAuth(event);
    if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

    const qs = event.queryStringParameters || {};
    const anagraficaId = String(qs.anagrafica_id || '').trim().toLowerCase();
    const includeHistory = String(qs.include_history || '').trim().toLowerCase() === 'true';
    if (!anagraficaId || !UUID_REGEX.test(anagraficaId)) {
        return response(400, { success: false, error: 'anagrafica_id mancante o non valido' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    try {
        const { data: consensoValido, error: validError } = await supabase
            .from('vendita_consensi_privacy')
            .select(CONSENSO_FIELDS)
            .eq('anagrafica_id', anagraficaId)
            .eq('stato', 'confermato')
            .in('informativa_versione', INFORMATIVE_VERSIONI_CORRENTI)
            .is('revocato_at', null)
            .gt('valido_fino_al', new Date().toISOString())
            .order('valido_fino_al', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (validError) {
            return response(500, { success: false, error: 'Errore query consenso valido: ' + validError.message });
        }

        const consenso = serializeConsenso(consensoValido);
        if (!includeHistory) {
            if (!consensoValido) return response(200, { success: true, valido: false });
            return response(200, { success: true, valido: true, consenso });
        }

        const { data: ultimoConsenso, error: latestError } = await supabase
            .from('vendita_consensi_privacy')
            .select(CONSENSO_FIELDS)
            .eq('anagrafica_id', anagraficaId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (latestError) {
            return response(500, { success: false, error: 'Errore query ultimo consenso: ' + latestError.message });
        }

        let documento = consensoValido;
        if (!documento?.pdf_storage_path) {
            const { data: ultimoDocumento, error: documentError } = await supabase
                .from('vendita_consensi_privacy')
                .select(CONSENSO_FIELDS)
                .eq('anagrafica_id', anagraficaId)
                .not('pdf_storage_path', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (documentError) {
                return response(500, { success: false, error: 'Errore query documento privacy: ' + documentError.message });
            }
            documento = ultimoDocumento;
        }

        const documentoSerializzato = serializeConsenso(documento);

        return response(200, {
            success: true,
            valido: !!consensoValido,
            consenso,
            esito: deriveEsito(consensoValido, ultimoConsenso),
            documento: documentoSerializzato
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};

exports._test = {
    deriveEsito,
    serializeConsenso
};
