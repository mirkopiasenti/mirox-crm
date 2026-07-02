'use strict';

/**
 * POST /.netlify/functions/revoca-consenso-canale
 *
 * Body JSON:
 *   {
 *     consenso_id: uuid,
 *     canale: 'email' | 'whatsapp' | 'phone_operator' | 'all',
 *     motivo: string (obbligatorio)
 *   }
 *
 * Se canale = 'all' -> resetta tutte le preferenze marketing, imposta
 *   revocato_at/motivo/da e stato='revocato'.
 * Se canale singolo -> resetta solo il flag marketing_<canale>.
 *
 * Ogni revoca crea un evento audit dedicato con timestamp+admin+motivo.
 *
 * Auth: Bearer obbligatorio + ruolo='admin'.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');
const privacyConfig = require('./_lib/privacy-config');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CANALI_SINGOLI = new Set(privacyConfig.MARKETING_CHANNELS);

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
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

    const auth = await requireAuth(event, { adminOnly: true });
    if (!auth.ok) return response(auth.status, { success: false, error: auth.error });
    const adminId = auth.user?.id || null;

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch (_) { return response(400, { success: false, error: 'JSON non valido' }); }

    const consensoId = String(payload.consenso_id || '').trim().toLowerCase();
    if (!UUID_REGEX.test(consensoId)) {
        return response(400, { success: false, error: 'consenso_id mancante o non valido' });
    }

    const canale = String(payload.canale || '').trim();
    if (canale !== 'all' && !CANALI_SINGOLI.has(canale)) {
        return response(400, {
            success: false,
            error: `canale non valido: usa 'all' o uno tra ${[...CANALI_SINGOLI].join(', ')}`,
        });
    }

    const motivo = String(payload.motivo || '').trim();
    if (!motivo) {
        return response(400, { success: false, error: 'motivo obbligatorio (max 1000 char)' });
    }
    const motivoClean = motivo.slice(0, 1000);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
        // Load record
        const { data: record, error: recErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .select('id, stato, revocato_at, marketing_email, marketing_whatsapp, marketing_phone_operator, marketing_valido_fino_al')
            .eq('id', consensoId)
            .maybeSingle();
        if (recErr) return response(500, { success: false, error: 'Errore lettura consenso: ' + recErr.message });
        if (!record) return response(404, { success: false, error: 'Consenso non trovato' });
        if (record.stato !== 'confermato') {
            return response(409, {
                success: false,
                error: `Consenso in stato ${record.stato}: revoca ammessa solo su stato 'confermato'`,
            });
        }

        const before = {
            marketing_email: !!record.marketing_email,
            marketing_whatsapp: !!record.marketing_whatsapp,
            marketing_phone_operator: !!record.marketing_phone_operator,
        };
        const updates = {};
        let eventoTipo;
        if (canale === 'all') {
            updates.marketing_email = false;
            updates.marketing_whatsapp = false;
            updates.marketing_phone_operator = false;
            updates.revocato_at = new Date().toISOString();
            updates.revocato_motivo = motivoClean;
            updates.revocato_da = adminId;
            updates.stato = 'revocato';
            eventoTipo = 'revoca_tutto';
        } else {
            updates[`marketing_${canale}`] = false;
            eventoTipo = `revoca_${canale}`;
        }

        const { error: updErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .update(updates)
            .eq('id', consensoId);
        if (updErr) return response(500, { success: false, error: 'Errore aggiornamento: ' + updErr.message });

        const after = {
            marketing_email: canale === 'all' ? false : (canale === 'email' ? false : before.marketing_email),
            marketing_whatsapp: canale === 'all' ? false : (canale === 'whatsapp' ? false : before.marketing_whatsapp),
            marketing_phone_operator: canale === 'all' ? false : (canale === 'phone_operator' ? false : before.marketing_phone_operator),
        };

        await supabase.from('vendita_consensi_privacy_audit').insert({
            consenso_id: consensoId,
            evento_tipo: eventoTipo,
            attore_tipo: 'admin',
            attore_id: adminId,
            attore_ip: getClientIp(event),
            dettaglio: {
                canale,
                motivo: motivoClean,
                before,
                after,
                stato_dopo: updates.stato || record.stato,
            },
        });

        return response(200, {
            success: true,
            consenso_id: consensoId,
            canale_revocato: canale,
            stato: updates.stato || record.stato,
            marketing: after,
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
