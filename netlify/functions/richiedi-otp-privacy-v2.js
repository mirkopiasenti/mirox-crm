'use strict';

/**
 * POST /.netlify/functions/richiedi-otp-privacy-v2
 *
 * Body JSON:
 *   {
 *     anagrafica_id: uuid,
 *     informativa_version_id?: uuid  // opzionale, default versione attiva
 *     main_phone: string,            // numero principale (readonly)
 *     otp_phone: string,             // destinatario OTP (puo' differire)
 *     otp_phone_motivazione?: string,// obbligatoria se main != otp
 *     marketing_email: boolean,
 *     marketing_whatsapp: boolean,
 *     marketing_phone_operator: boolean,
 *     pratica_id?: uuid
 *   }
 *
 * Auth: Bearer obbligatorio (requireAuth).
 * Rate limit: max 3 OTP/ora per anagrafica + cooldown 60s tra invii.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { requireAuth } = require('./_lib/require-auth');
const { sendOtpSms, normalizeMobileNumber, generateOtp } = require('./_lib/smshosting');
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

function isUuid(s) { return typeof s === 'string' && UUID_REGEX.test(s); }
function toBool(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

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
    const operatoreNome = (auth.profilo?.nome || auth.profilo?.email || '').trim() || null;

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return response(400, { success: false, error: 'JSON non valido' }); }

    const anagraficaId = String(payload.anagrafica_id || '').trim().toLowerCase();
    if (!isUuid(anagraficaId)) {
        return response(400, { success: false, error: 'anagrafica_id mancante o non valido' });
    }

    const mainPhone = normalizeMobileNumber(payload.main_phone);
    if (!mainPhone) {
        return response(400, { success: false, error: 'main_phone non valido' });
    }
    const otpPhone = normalizeMobileNumber(payload.otp_phone);
    if (!otpPhone) {
        return response(400, { success: false, error: 'otp_phone non valido' });
    }
    let otpMotivazione = payload.otp_phone_motivazione;
    if (mainPhone !== otpPhone) {
        if (typeof otpMotivazione !== 'string' || !otpMotivazione.trim()) {
            return response(400, {
                success: false,
                error: 'Motivazione obbligatoria quando otp_phone differisce da main_phone',
            });
        }
        otpMotivazione = otpMotivazione.trim().slice(0, 500);
    } else {
        otpMotivazione = null;
    }

    const marketing = {
        email: toBool(payload.marketing_email),
        whatsapp: toBool(payload.marketing_whatsapp),
        phone_operator: toBool(payload.marketing_phone_operator),
    };
    const anyMarketing = marketing.email || marketing.whatsapp || marketing.phone_operator;

    const praticaId = isUuid(payload.pratica_id) ? String(payload.pratica_id).toLowerCase() : null;
    let informativaVersionId = isUuid(payload.informativa_version_id)
        ? String(payload.informativa_version_id).toLowerCase()
        : null;

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
        // Versione informativa attiva
        if (!informativaVersionId) {
            const { data: ver, error: verErr } = await supabase
                .from('privacy_policy_versions')
                .select('id')
                .is('active_to', null)
                .order('active_from', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (verErr) return response(500, { success: false, error: 'Errore lettura versione attiva: ' + verErr.message });
            if (!ver) return response(500, { success: false, error: 'Nessuna versione privacy attiva configurata' });
            informativaVersionId = ver.id;
        }

        // Anagrafica + snapshot
        const { data: anagrafica, error: anagraficaErr } = await supabase
            .from('anagrafica')
            .select('id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico')
            .eq('id', anagraficaId)
            .maybeSingle();
        if (anagraficaErr) return response(500, { success: false, error: 'Errore lettura anagrafica: ' + anagraficaErr.message });
        if (!anagrafica) return response(404, { success: false, error: 'Anagrafica non trovata' });

        // Rate limit
        const oraFa = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const { data: recenti, error: recentiErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .select('id, otp_inviato_at, stato')
            .eq('anagrafica_id', anagraficaId)
            .not('otp_inviato_at', 'is', null)
            .gte('otp_inviato_at', oraFa)
            .order('otp_inviato_at', { ascending: false });
        if (recentiErr) return response(500, { success: false, error: 'Errore lettura storico OTP: ' + recentiErr.message });

        if ((recenti || []).length >= privacyConfig.OTP.MAX_INVII_PER_ORA) {
            return response(429, {
                success: false,
                error: `Troppi tentativi: gia' inviati ${privacyConfig.OTP.MAX_INVII_PER_ORA} OTP nell'ultima ora per questo cliente. Riprova piu' tardi o usa il modulo cartaceo.`,
            });
        }
        const ultimo = recenti?.[0];
        if (ultimo?.otp_inviato_at) {
            const elapsed = (Date.now() - new Date(ultimo.otp_inviato_at).getTime()) / 1000;
            if (elapsed < privacyConfig.OTP.COOLDOWN_REINVIO_SEC) {
                const wait = Math.ceil(privacyConfig.OTP.COOLDOWN_REINVIO_SEC - elapsed);
                return response(429, {
                    success: false,
                    error: `Attendi ${wait} secondi prima di richiedere un nuovo OTP per questo cliente.`,
                    retry_after_seconds: wait,
                });
            }
        }

        // Invalida pending precedenti
        await supabase
            .from('vendita_consensi_privacy_v2')
            .update({ stato: 'scaduto' })
            .eq('anagrafica_id', anagraficaId)
            .eq('stato', 'pending');

        // Genera OTP + hash + salt
        const otp = generateOtp(privacyConfig.OTP.DIGIT_COUNT);
        const salt = crypto.randomBytes(16).toString('hex');
        const otpHash = hashOtp(otp, salt);
        const ora = new Date();
        const scade = new Date(ora.getTime() + privacyConfig.OTP.DURATA_MINUTI * 60 * 1000);

        const snapshotAnagrafica = {
            cf_piva: anagrafica.cf_piva,
            cluster: anagrafica.cluster,
            ragione_sociale: anagrafica.ragione_sociale,
            nome_referente: anagrafica.nome_referente,
            cellulare: anagrafica.cellulare,
            email: anagrafica.email,
            provincia: anagrafica.provincia,
            comune: anagrafica.comune,
            via: anagrafica.via,
            civico: anagrafica.civico,
        };

        // INSERT record pending
        const { data: inserted, error: insertErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .insert({
                anagrafica_id: anagraficaId,
                pratica_id: praticaId,
                informativa_version_id: informativaVersionId,
                document_hash: 'PENDING',
                main_phone: mainPhone,
                otp_phone: otpPhone,
                otp_phone_motivazione: otpMotivazione,
                marketing_email: marketing.email,
                marketing_whatsapp: marketing.whatsapp,
                marketing_phone_operator: marketing.phone_operator,
                otp_hash: otpHash,
                otp_salt: salt,
                otp_inviato_at: ora.toISOString(),
                otp_scade_at: scade.toISOString(),
                otp_tentativi: 0,
                otp_reinvii: 0,
                stato: 'pending',
                snapshot_anagrafica: snapshotAnagrafica,
                operatore_id: operatoreId,
                ip_operatore: getClientIp(event),
                user_agent_operatore: (event.headers?.['user-agent'] || '').slice(0, 500) || null,
            })
            .select('id, consent_uuid, otp_scade_at')
            .single();
        if (insertErr) return response(500, { success: false, error: 'Errore creazione consenso: ' + insertErr.message });
        const consensoId = inserted.id;

        // Audit richiesta
        await supabase.from('vendita_consensi_privacy_audit').insert({
            consenso_id: consensoId,
            evento_tipo: 'richiesta_otp',
            attore_tipo: 'operatore',
            attore_id: operatoreId,
            attore_ip: getClientIp(event),
            dettaglio: {
                otp_phone: otpPhone,
                main_phone: mainPhone,
                marketing,
                any_marketing: anyMarketing,
                pratica_id: praticaId,
            },
        });

        // Invia SMS
        const smsResult = await sendOtpSms({ to: otpPhone, otp });
        if (!smsResult.ok) {
            await supabase
                .from('vendita_consensi_privacy_v2')
                .update({ stato: 'fallito' })
                .eq('id', consensoId);
            await supabase.from('vendita_consensi_privacy_audit').insert({
                consenso_id: consensoId,
                evento_tipo: 'invio_sms_ko',
                attore_tipo: 'sistema',
                dettaglio: {
                    error: smsResult.error,
                    provider_status: smsResult.providerStatus,
                    provider_message: smsResult.providerMessage,
                },
            });
            return response(smsResult.status || 502, {
                success: false,
                error: 'Invio SMS fallito: ' + (smsResult.error || 'errore sconosciuto'),
                provider_status: smsResult.providerStatus,
                provider_message: smsResult.providerMessage,
            });
        }

        // Aggiorna record con sms_id + audit invio_sms_ok
        await supabase
            .from('vendita_consensi_privacy_v2')
            .update({ sms_provider_id: smsResult.id })
            .eq('id', consensoId);
        await supabase.from('vendita_consensi_privacy_audit').insert({
            consenso_id: consensoId,
            evento_tipo: 'invio_sms_ok',
            attore_tipo: 'sistema',
            dettaglio: { sms_id: smsResult.id, simulated: !!smsResult.simulated },
        });

        return response(200, {
            success: true,
            consenso_id: consensoId,
            consent_uuid: inserted.consent_uuid,
            scade_at: inserted.otp_scade_at,
            otp_phone: otpPhone,
            main_phone: mainPhone,
            sms_id: smsResult.id,
            simulated: !!smsResult.simulated,
            operatore_nome: operatoreNome,
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
