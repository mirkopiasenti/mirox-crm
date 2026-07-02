'use strict';

/**
 * POST /.netlify/functions/verifica-otp-privacy-v2
 *
 * Body JSON:
 *   { consenso_id: uuid, otp: string }
 *
 * Se l'OTP e' corretto:
 *   1. Compute marketing_valido_fino_al (now + 24 mesi) se almeno un canale
 *      marketing e' true, altrimenti null.
 *   2. Genera PDF via pdf-consenso-v2.
 *   3. Upload PDF su bucket 'consensi-privacy' con naming
 *      Privacy_<RagSocSafe>_<CF>_<DD_MM_YYYY>.pdf sotto path <YYYY>/<MM>/.
 *   4. Update record: stato='confermato', presa_visione_at=now,
 *      marketing_valido_fino_al, pdf_storage_path, pdf_filename, pdf_hash,
 *      document_hash. otp_hash e otp_salt azzerati (secure erase).
 *   5. Audit events 'verifica_otp_ok', 'pdf_generato', 'confermato'.
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth } = require('./_lib/require-auth');
const { generateConsensoV2Pdf } = require('./_lib/pdf-consenso-v2');
const privacyConfig = require('./_lib/privacy-config');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
}

function hashOtp(otp, salt) {
    return crypto.createHash('sha256').update(otp + ':' + salt).digest('hex');
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

function sanitizeSegment(s) {
    return String(s || '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase()
        .slice(0, 60) || 'X';
}

function addMonthsClamped(date, months) {
    const y = date.getUTCFullYear();
    const m = date.getUTCMonth();
    const d = date.getUTCDate();
    const target = new Date(Date.UTC(y, m + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    target.setUTCHours(date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds());
    return target;
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
    const operatoreId = auth.user?.id || null;

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return response(400, { success: false, error: 'JSON non valido' }); }

    const consensoId = String(payload.consenso_id || '').trim().toLowerCase();
    if (!UUID_REGEX.test(consensoId)) {
        return response(400, { success: false, error: 'consenso_id mancante o non valido' });
    }
    const otp = String(payload.otp || '').trim();
    if (!/^\d{4,8}$/.test(otp)) {
        return response(400, { success: false, error: 'OTP non valido: deve essere numerico' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
        // Load consenso
        const { data: record, error: recErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .select('*')
            .eq('id', consensoId)
            .maybeSingle();
        if (recErr) return response(500, { success: false, error: 'Errore lettura consenso: ' + recErr.message });
        if (!record) return response(404, { success: false, error: 'Consenso non trovato' });

        if (record.stato !== 'pending') {
            return response(409, {
                success: false,
                error: `Consenso in stato ${record.stato}: verifica OTP non ammessa`,
            });
        }
        if (record.otp_scade_at && new Date(record.otp_scade_at).getTime() < Date.now()) {
            await supabase
                .from('vendita_consensi_privacy_v2')
                .update({ stato: 'scaduto' })
                .eq('id', consensoId);
            await supabase.from('vendita_consensi_privacy_audit').insert({
                consenso_id: consensoId,
                evento_tipo: 'otp_scaduto',
                attore_tipo: 'sistema',
            });
            return response(410, { success: false, error: 'OTP scaduto: richiedine uno nuovo' });
        }
        if ((record.otp_tentativi || 0) >= privacyConfig.OTP.MAX_TENTATIVI) {
            return response(429, { success: false, error: 'Troppi tentativi errati: consenso bloccato' });
        }

        // Verify hash
        const expected = hashOtp(otp, record.otp_salt);
        if (expected !== record.otp_hash) {
            const newTentativi = (record.otp_tentativi || 0) + 1;
            const isMaxed = newTentativi >= privacyConfig.OTP.MAX_TENTATIVI;
            await supabase
                .from('vendita_consensi_privacy_v2')
                .update({
                    otp_tentativi: newTentativi,
                    stato: isMaxed ? 'fallito' : 'pending',
                })
                .eq('id', consensoId);
            await supabase.from('vendita_consensi_privacy_audit').insert({
                consenso_id: consensoId,
                evento_tipo: 'verifica_otp_ko',
                attore_tipo: 'operatore',
                attore_id: operatoreId,
                attore_ip: getClientIp(event),
                dettaglio: { tentativi: newTentativi, maxed: isMaxed },
            });
            return response(400, {
                success: false,
                error: isMaxed
                    ? 'OTP errato. Max tentativi raggiunto: consenso non piu verificabile.'
                    : 'OTP errato. Tentativi rimasti: ' + (privacyConfig.OTP.MAX_TENTATIVI - newTentativi),
                tentativi: newTentativi,
                maxed: isMaxed,
            });
        }

        // OTP corretto -> genera PDF + salva
        // Carica versione informativa (per version_slug)
        const { data: ver } = await supabase
            .from('privacy_policy_versions')
            .select('id, version_slug')
            .eq('id', record.informativa_version_id)
            .maybeSingle();

        const now = new Date();
        const anyMarketing = record.marketing_email || record.marketing_whatsapp || record.marketing_phone_operator;
        const marketingValidoFinoAl = anyMarketing ? addMonthsClamped(now, privacyConfig.VALIDITA_MARKETING_MESI) : null;

        // Snapshot anagrafica per il PDF: preferisco quello salvato al momento
        // dell'invio (record.snapshot_anagrafica), fallback su tabella anagrafica.
        const snapshot = record.snapshot_anagrafica || {};
        let clienteData = snapshot;
        if (!snapshot.cf_piva) {
            const { data: anagrafica } = await supabase
                .from('anagrafica')
                .select('cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
                .eq('id', record.anagrafica_id)
                .maybeSingle();
            clienteData = anagrafica || {};
        }

        const indirizzo = [
            clienteData.via, clienteData.civico,
            clienteData.comune ? `${clienteData.comune}${clienteData.provincia ? ' (' + clienteData.provincia + ')' : ''}` : null,
        ].filter(Boolean).join(', ');

        const pdfResult = await generateConsensoV2Pdf({
            cliente: {
                ragione_sociale: clienteData.ragione_sociale,
                cf_piva: clienteData.cf_piva,
                cluster: clienteData.cluster || 'Consumer',
                nome_referente: clienteData.nome_referente,
                indirizzo,
                cellulare: record.main_phone || clienteData.cellulare,
                email: clienteData.email,
                whatsapp: null,
                data_presa_visione: now.toISOString(),
            },
            otp: {
                mainPhone: record.main_phone,
                otpPhone: record.otp_phone,
                otpMotivazione: record.otp_phone_motivazione,
                confermatoAt: now.toISOString(),
            },
            marketing: {
                email: !!record.marketing_email,
                whatsapp: !!record.marketing_whatsapp,
                phone_operator: !!record.marketing_phone_operator,
            },
            consentUuid: record.consent_uuid,
        });

        // Upload PDF sul bucket
        const yyyy = String(now.getFullYear());
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const ragSafe = sanitizeSegment(clienteData.ragione_sociale || 'CLIENTE');
        const cfSafe = sanitizeSegment(clienteData.cf_piva || 'X');
        const filename = `Privacy_${ragSafe}_${cfSafe}_${dd}_${mm}_${yyyy}.pdf`;
        const storagePath = `${yyyy}/${mm}/${filename}`;

        const { error: uploadErr } = await supabase.storage
            .from(privacyConfig.STORAGE_BUCKET)
            .upload(storagePath, pdfResult.buffer, {
                contentType: 'application/pdf',
                upsert: false,
            });
        if (uploadErr) {
            const suffix = crypto.randomBytes(3).toString('hex');
            const retryName = `Privacy_${ragSafe}_${cfSafe}_${dd}_${mm}_${yyyy}_${suffix}.pdf`;
            const retryPath = `${yyyy}/${mm}/${retryName}`;
            const { error: retryErr } = await supabase.storage
                .from(privacyConfig.STORAGE_BUCKET)
                .upload(retryPath, pdfResult.buffer, {
                    contentType: 'application/pdf',
                    upsert: false,
                });
            if (retryErr) {
                return response(500, { success: false, error: 'Upload PDF fallito: ' + retryErr.message });
            }
            var finalStoragePath = retryPath;
            var finalFilename = retryName;
        } else {
            var finalStoragePath = storagePath;
            var finalFilename = filename;
        }

        // Aggiorna record: confermato + secure erase OTP
        const updates = {
            stato: 'confermato',
            otp_confermato_at: now.toISOString(),
            presa_visione_at: now.toISOString(),
            marketing_valido_fino_al: marketingValidoFinoAl ? marketingValidoFinoAl.toISOString() : null,
            pdf_storage_path: finalStoragePath,
            pdf_filename: finalFilename,
            pdf_hash: pdfResult.pdfHash,
            document_hash: pdfResult.documentHash,
            otp_hash: null,
            otp_salt: null,
        };
        const { error: updErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .update(updates)
            .eq('id', consensoId);
        if (updErr) {
            return response(500, { success: false, error: 'Errore aggiornamento consenso: ' + updErr.message });
        }

        // Audit events
        await supabase.from('vendita_consensi_privacy_audit').insert([
            {
                consenso_id: consensoId,
                evento_tipo: 'verifica_otp_ok',
                attore_tipo: 'operatore',
                attore_id: operatoreId,
                attore_ip: getClientIp(event),
                dettaglio: { informativa_version: ver?.version_slug },
            },
            {
                consenso_id: consensoId,
                evento_tipo: 'pdf_generato',
                attore_tipo: 'sistema',
                dettaglio: {
                    pdf_storage_path: finalStoragePath,
                    pdf_hash: pdfResult.pdfHash,
                    document_hash: pdfResult.documentHash,
                },
            },
            {
                consenso_id: consensoId,
                evento_tipo: 'confermato',
                attore_tipo: 'operatore',
                attore_id: operatoreId,
                dettaglio: {
                    marketing: {
                        email: !!record.marketing_email,
                        whatsapp: !!record.marketing_whatsapp,
                        phone_operator: !!record.marketing_phone_operator,
                    },
                    marketing_valido_fino_al: marketingValidoFinoAl ? marketingValidoFinoAl.toISOString() : null,
                },
            },
        ]);

        return response(200, {
            success: true,
            consenso_id: consensoId,
            consent_uuid: record.consent_uuid,
            stato: 'confermato',
            marketing_valido_fino_al: marketingValidoFinoAl ? marketingValidoFinoAl.toISOString() : null,
            pdf_storage_path: finalStoragePath,
            pdf_filename: finalFilename,
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
