'use strict';

/**
 * GET /.netlify/functions/check-consenso-privacy-v2?anagrafica_id=<uuid>
 *
 * Verifica se esiste un consenso privacy v2 valido per il cliente:
 *   - stato='confermato'
 *   - revocato_at IS NULL
 *   - informativa_version_id = versione attiva CORRENTE (F5: dedupe presa
 *     visione legata alla versione, non a scadenza naturale)
 *
 * Se trovato -> ritorna {valido: true, ...} con preferenze marketing correnti
 * e info scadenza marketing.
 *
 * Se non trovato -> {valido: false, active_version: {id, version_slug}} per
 * consentire al wizard di raccogliere il consenso.
 *
 * Auth: Bearer obbligatorio.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
};

function response(statusCode, payload) {
    return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(payload) };
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

    const anagraficaId = String(event.queryStringParameters?.anagrafica_id || '').trim().toLowerCase();
    if (!UUID_REGEX.test(anagraficaId)) {
        return response(400, { success: false, error: 'anagrafica_id mancante o non valido' });
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
        // Versione attiva
        const { data: activeVersion, error: verErr } = await supabase
            .from('privacy_policy_versions')
            .select('id, version_slug')
            .is('active_to', null)
            .order('active_from', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (verErr) return response(500, { success: false, error: 'Errore lettura versione attiva: ' + verErr.message });
        if (!activeVersion) {
            return response(200, {
                success: true,
                valido: false,
                motivo: 'Nessuna versione privacy attiva configurata',
            });
        }

        // Consenso confermato per la versione attiva
        const { data: consenso, error: consErr } = await supabase
            .from('vendita_consensi_privacy_v2')
            .select('id, consent_uuid, presa_visione_at, marketing_email, marketing_whatsapp, marketing_phone_operator, marketing_valido_fino_al, pdf_storage_path, informativa_version_id')
            .eq('anagrafica_id', anagraficaId)
            .eq('informativa_version_id', activeVersion.id)
            .eq('stato', 'confermato')
            .is('revocato_at', null)
            .order('presa_visione_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (consErr) return response(500, { success: false, error: 'Errore lettura consensi: ' + consErr.message });

        if (!consenso) {
            return response(200, {
                success: true,
                valido: false,
                active_version: activeVersion,
            });
        }

        const now = Date.now();
        const marketingScaduto = consenso.marketing_valido_fino_al
            ? new Date(consenso.marketing_valido_fino_al).getTime() < now
            : false;

        return response(200, {
            success: true,
            valido: true,
            consenso_id: consenso.id,
            consent_uuid: consenso.consent_uuid,
            presa_visione_at: consenso.presa_visione_at,
            active_version: activeVersion,
            marketing: {
                email: !!consenso.marketing_email && !marketingScaduto,
                whatsapp: !!consenso.marketing_whatsapp && !marketingScaduto,
                phone_operator: !!consenso.marketing_phone_operator && !marketingScaduto,
                valido_fino_al: consenso.marketing_valido_fino_al,
                scaduto: marketingScaduto,
            },
            pdf_storage_path: consenso.pdf_storage_path,
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
