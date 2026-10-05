/**
 * POST /.netlify/functions/verifica-otp-privacy
 *
 * Body JSON:
 *   {
 *     consenso_id: uuid,    // record creato da richiedi-otp-privacy
 *     otp: '123456'         // codice 6 cifre inserito dall'operatore
 *   }
 *
 * Logica:
 *  1) Carica record (stato='pending', non scaduto, tentativi <3)
 *  2) Verifica hash(otp+salt) === otp_hash
 *  3) Se KO: incrementa otp_tentativi, se raggiunge 3 marca 'fallito'
 *  4) Se OK: genera PDF con metadata firma, upload bucket consensi-privacy,
 *     update record (stato='confermato', valido_fino_al = now()+24mo,
 *     pdf_storage_path, pdf_filename, informativa_hash, otp_confermato_at)
 *
 * Response 200 (success):
 *   {
 *     success: true,
 *     consenso_id, valido_fino_al, pdf_filename, pdf_storage_path
 *   }
 * Response 400/410:
 *   { success: false, error, codice_invalido?, scaduto?, tentativi_residui? }
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { uploadPrivacyPdf, isStorageConflict, isTemporaryStorageError } = require('./_lib/privacy-pdf-storage');
const { captureServerError } = require('./_lib/with-telemetry');
const { requireAuth } = require('./_lib/require-auth');
const { generateConsensoPdf, INFORMATIVA_VERSIONE_DIGITALE } = require('./_lib/pdf-consenso');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TENTATIVI = 3;
const VALIDITA_MESI = 24;
const BUCKET_CONSENSI = 'consensi-privacy';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function hashOtp(otp, salt) {
    return crypto.createHash('sha256').update(otp + ':' + salt).digest('hex');
}

function sanitizeSegment(value, fallback = 'cliente') {
    const normalized = String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return normalized || fallback;
}

function formatDateDdMmYyyy(d = new Date()) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = String(d.getFullYear());
    return `${dd}_${mm}_${yyyy}`;
}

function addMonthsClamped(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Se il mese target ha meno giorni, JS riporta al mese successivo. Forziamo
    // l'ultimo giorno del mese target.
    if (d.getDate() < day) d.setDate(0);
    return d;
}

function getClientIp(event) {
    const h = event.headers || {};
    return (
        h['x-nf-client-connection-ip']
        || (h['x-forwarded-for'] || '').split(',')[0].trim()
        || h['client-ip']
        || null
    );
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
    const operatoreNome = (auth.profilo?.nome || auth.profilo?.email || '').trim() || 'operatore';

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return response(400, { success: false, error: 'JSON non valido' }); }

    const consensoId = String(payload.consenso_id || '').trim().toLowerCase();
    if (!consensoId || !UUID_REGEX.test(consensoId)) {
        return response(400, { success: false, error: 'consenso_id mancante o non valido' });
    }
    const otpInserito = String(payload.otp || '').trim();
    if (!/^\d{4,8}$/.test(otpInserito)) {
        return response(400, { success: false, error: 'OTP non valido: usare codice numerico' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false }
    });

    let stage = 'read_consenso';
    async function technicalFailure(code, status = 503) {
        const requestId = event.headers?.['x-mirox-request-id'] || event.headers?.['X-Mirox-Request-Id'] || null;
        await captureServerError({ supabase, auth, functionName: 'verifica-otp-privacy',
            operation: stage, requestId, error: { code, message: 'Conferma OTP temporaneamente non disponibile', status } });
        return response(status, { success: false, error: 'Conferma temporaneamente non disponibile. Riprova con lo stesso codice OTP.', error_code: code });
    }
    function confirmedResult(row) {
        return response(200, { success: true, consenso_id: row.id, valido_fino_al: row.valido_fino_al,
            pdf_filename: row.pdf_filename, pdf_storage_path: row.pdf_storage_path, gia_confermato: true });
    }
    try {
        // 1) Carica record
        const { data: rec, error: recErr } = await supabase
            .from('vendita_consensi_privacy')
            .select('*')
            .eq('id', consensoId)
            .maybeSingle();
        if (recErr) {
            return technicalFailure('privacy_read_failed');
        }
        if (!rec) {
            return response(404, { success: false, error: 'Consenso non trovato' });
        }
        if (rec.modalita !== 'otp_sms') {
            return response(400, { success: false, error: 'Questo consenso non e\' in modalita\' OTP' });
        }
        if (rec.stato === 'confermato') return confirmedResult(rec);
        if (['scaduto', 'fallito', 'revocato'].includes(rec.stato)) {
            return response(410, {
                success: false,
                error: 'Questo OTP non e\' piu\' utilizzabile (stato: ' + rec.stato + '). Richiedi un nuovo invio.',
                stato: rec.stato, scaduto: true
            });
        }
        if (rec.otp_scade_at && new Date(rec.otp_scade_at).getTime() < Date.now()) {
            const expired = await supabase
                .from('vendita_consensi_privacy')
                .update({ stato: 'scaduto' })
                .eq('id', consensoId).eq('stato', 'pending').eq('otp_hash', rec.otp_hash)
                .select('id').maybeSingle();
            if (expired.error) return technicalFailure('privacy_expiry_save_failed');
            if (!expired.data) {
                const current = await supabase.from('vendita_consensi_privacy').select('*').eq('id', consensoId).maybeSingle();
                if (!current.error && current.data?.stato === 'confermato') return confirmedResult(current.data);
                return response(409, { success: false, error: 'Il consenso è cambiato. Riprova la verifica.' });
            }
            return response(410, { success: false, error: 'OTP scaduto. Richiedi un nuovo invio.', scaduto: true });
        }

        // 2) Verifica hash
        const calcolato = hashOtp(otpInserito, rec.otp_salt);
        if (calcolato !== rec.otp_hash) {
            const nuoviTentativi = (rec.otp_tentativi || 0) + 1;
            const updatePayload = { otp_tentativi: nuoviTentativi };
            if (nuoviTentativi >= MAX_TENTATIVI) {
                updatePayload.stato = 'fallito';
            }
            const { data: attemptSaved, error: attemptError } = await supabase
                .from('vendita_consensi_privacy')
                .update(updatePayload)
                .eq('id', consensoId).eq('stato', 'pending')
                .eq('otp_hash', rec.otp_hash).eq('otp_tentativi', rec.otp_tentativi || 0)
                .select('id').maybeSingle();
            if (attemptError) return technicalFailure('privacy_attempt_save_failed');
            if (!attemptSaved) return response(409, { success: false, error: 'Un’altra verifica ha aggiornato il consenso. Riprova.' });
            const residui = Math.max(0, MAX_TENTATIVI - nuoviTentativi);
            return response(400, {
                success: false,
                error: residui > 0
                    ? `Codice OTP errato. Tentativi residui: ${residui}.`
                    : 'Codice OTP errato. Massimo tentativi superato: richiedi un nuovo invio.',
                codice_invalido: true,
                tentativi_residui: residui
            });
        }

        // 3) OTP corretto: genera PDF
        const ora = new Date();
        const validoFinoAl = addMonthsClamped(ora, VALIDITA_MESI);
        const anagrafica = rec.snapshot_anagrafica || {};

        stage = 'generate_pdf';
        const { buffer: pdfBuffer, hash: pdfHash } = await generateConsensoPdf({
            modalita: 'otp_sms',
            anagrafica,
            consensoContratto: true,
            consensoMarketing: !!rec.consenso_marketing,
            dataCompilazione: ora.toISOString(),
            otpMetadata: {
                cellulareInviato: rec.cellulare_usato,
                confermatoAt: ora.toISOString(),
                smsProviderId: rec.sms_provider_id,
                ipOperatore: getClientIp(event) || rec.ip_operatore,
                operatoreNome,
                consensoId: rec.id
            }
        });

        // 4) Naming + upload bucket
        const ragSocSafe = sanitizeSegment(anagrafica.ragione_sociale, 'cliente').toUpperCase().slice(0, 60);
        const cfPiva = sanitizeSegment(anagrafica.cf_piva, 'cf').toUpperCase();
        const dataPart = formatDateDdMmYyyy(ora);
        const baseFileName = `Privacy_${ragSocSafe}_${cfPiva}_${dataPart}_${rec.id}.pdf`;
        const year = String(ora.getFullYear());
        const month = String(ora.getMonth() + 1).padStart(2, '0');
        let attemptFileName = baseFileName;
        let attemptPath = `${year}/${month}/${attemptFileName}`;
        let uploaded = false;
        let lastUploadError = null;

        for (let attempt = 0; attempt < 3 && !uploaded; attempt += 1) {
            stage = 'upload_pdf';
            const { error: uploadErr } = await uploadPrivacyPdf(supabase.storage.from(BUCKET_CONSENSI), attemptPath, pdfBuffer);
            if (!uploadErr) {
                uploaded = true;
                break;
            }
            lastUploadError = uploadErr;
            // Collisione nome (file gia' esistente): aggiungi suffisso random
            const isConflict = isStorageConflict(uploadErr);
            if (!isConflict) break;
            const suffix = crypto.randomBytes(3).toString('hex');
            attemptFileName = baseFileName.replace(/\.pdf$/i, '') + '_' + suffix + '.pdf';
            attemptPath = `${year}/${month}/${attemptFileName}`;
        }

        if (!uploaded) return technicalFailure(isTemporaryStorageError(lastUploadError) ? 'privacy_storage_timeout' : 'privacy_storage_failed');

        // 5) Update record finale
        stage = 'confirm_consenso';
        const { data: saved, error: updateErr } = await supabase
            .from('vendita_consensi_privacy')
            .update({
                stato: 'confermato',
                otp_confermato_at: ora.toISOString(),
                otp_tentativi: (rec.otp_tentativi || 0) + 1,
                valido_fino_al: validoFinoAl.toISOString(),
                pdf_storage_path: attemptPath,
                pdf_filename: attemptFileName,
                informativa_hash: pdfHash,
                informativa_versione: INFORMATIVA_VERSIONE_DIGITALE
            })
            .eq('id', consensoId).eq('stato', 'pending')
            .eq('otp_hash', rec.otp_hash).eq('otp_tentativi', rec.otp_tentativi || 0)
            .select('id').maybeSingle();
        if (updateErr || !saved) {
            // Una risposta persa puo' nascondere un commit riuscito: prima rileggi.
            const current = await supabase.from('vendita_consensi_privacy').select('*').eq('id', consensoId).maybeSingle();
            if (!current.error && current.data && current.data.pdf_storage_path !== attemptPath) {
                await supabase.storage.from(BUCKET_CONSENSI).remove([attemptPath]).catch(() => {});
            }
            if (!current.error && current.data?.stato === 'confermato') return confirmedResult(current.data);
            if (!current.error && ['scaduto', 'fallito', 'revocato'].includes(current.data?.stato)) {
                return response(410, { success: false, error: 'Consenso non piu’ utilizzabile. Richiedi un nuovo invio.', scaduto: true });
            }
            if (updateErr || current.error) return technicalFailure('privacy_confirm_save_failed');
            return response(409, { success: false, error: 'Il consenso è cambiato durante la verifica. Riprova.' });
        }

        return response(200, {
            success: true,
            consenso_id: rec.id,
            valido_fino_al: validoFinoAl.toISOString(),
            pdf_filename: attemptFileName,
            pdf_storage_path: attemptPath,
            informativa_hash: pdfHash,
            informativa_versione: INFORMATIVA_VERSIONE_DIGITALE
        });
    } catch (e) {
        return technicalFailure('privacy_' + stage + '_failed');
    }
};
