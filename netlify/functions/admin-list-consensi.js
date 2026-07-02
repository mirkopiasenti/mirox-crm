'use strict';

/**
 * GET /.netlify/functions/admin-list-consensi
 *   ?anagrafica_id=<uuid>         (opz filtro cliente)
 *   ?stato=<pending|confermato|scaduto|fallito|revocato>  (opz)
 *   ?versione_id=<uuid>           (opz filtro versione informativa)
 *   ?marketing_scaduto=1          (opz solo consensi con marketing scaduto)
 *   ?query=<testo>                (opz ricerca full-text su ragione_sociale/cf_piva)
 *   ?limit=50                     (default 50, max 200)
 *   ?offset=0
 *
 * Ritorna l'elenco consensi v2 con dati anagrafici + preferenze correnti +
 * timeline audit ridotta (ultimi 5 eventi).
 *
 * Auth: Bearer obbligatorio + ruolo='admin'.
 */

const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_lib/require-auth');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATI_VALIDI = new Set(['pending', 'confermato', 'scaduto', 'fallito', 'revocato']);

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

    const auth = await requireAuth(event, { adminOnly: true });
    if (!auth.ok) return response(auth.status, { success: false, error: auth.error });

    const qp = event.queryStringParameters || {};

    const filters = {};
    if (qp.anagrafica_id) {
        const v = String(qp.anagrafica_id).trim().toLowerCase();
        if (!UUID_REGEX.test(v)) return response(400, { success: false, error: 'anagrafica_id non valido' });
        filters.anagrafica_id = v;
    }
    if (qp.versione_id) {
        const v = String(qp.versione_id).trim().toLowerCase();
        if (!UUID_REGEX.test(v)) return response(400, { success: false, error: 'versione_id non valido' });
        filters.informativa_version_id = v;
    }
    if (qp.stato) {
        const s = String(qp.stato).trim();
        if (!STATI_VALIDI.has(s)) return response(400, { success: false, error: 'stato non valido' });
        filters.stato = s;
    }
    const marketingScaduto = qp.marketing_scaduto === '1' || qp.marketing_scaduto === 'true';
    const query = qp.query ? String(qp.query).trim().slice(0, 100) : null;

    const limit = Math.min(Math.max(parseInt(qp.limit, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(qp.offset, 10) || 0, 0);

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE) {
        return response(500, { success: false, error: 'Configurazione server incompleta' });
    }
    const supabase = createClient(SUPABASE_URL, SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
        let req = supabase
            .from('vendita_consensi_privacy_v2')
            .select(`
                id, consent_uuid, anagrafica_id, informativa_version_id,
                stato, presa_visione_at, marketing_email, marketing_whatsapp,
                marketing_phone_operator, marketing_valido_fino_al,
                revocato_at, revocato_motivo,
                pdf_storage_path, pdf_filename,
                main_phone, otp_phone, otp_phone_motivazione,
                created_at, updated_at,
                anagrafica:anagrafica_id ( id, ragione_sociale, cf_piva, cluster, cellulare, email ),
                versione:informativa_version_id ( id, version_slug )
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);

        for (const [k, v] of Object.entries(filters)) {
            req = req.eq(k, v);
        }
        if (marketingScaduto) {
            req = req
                .not('marketing_valido_fino_al', 'is', null)
                .lt('marketing_valido_fino_al', new Date().toISOString())
                .is('revocato_at', null);
        }
        if (query) {
            req = req.or(
                `ragione_sociale.ilike.%${query}%,cf_piva.ilike.%${query}%`,
                { foreignTable: 'anagrafica' }
            );
        }

        const { data: consensi, error: listErr, count } = await req;
        if (listErr) return response(500, { success: false, error: 'Errore lettura consensi: ' + listErr.message });

        const consensoIds = (consensi || []).map((c) => c.id);
        let auditByConsenso = {};
        if (consensoIds.length > 0) {
            const { data: audits, error: audErr } = await supabase
                .from('vendita_consensi_privacy_audit')
                .select('id, consenso_id, evento_tipo, evento_at, attore_tipo, dettaglio')
                .in('consenso_id', consensoIds)
                .order('evento_at', { ascending: false })
                .limit(consensoIds.length * 5);
            if (audErr) return response(500, { success: false, error: 'Errore lettura audit: ' + audErr.message });
            for (const a of audits || []) {
                (auditByConsenso[a.consenso_id] = auditByConsenso[a.consenso_id] || []).push(a);
            }
            for (const cid of Object.keys(auditByConsenso)) {
                auditByConsenso[cid] = auditByConsenso[cid].slice(0, 5);
            }
        }

        const items = (consensi || []).map((c) => ({
            ...c,
            audit_recent: auditByConsenso[c.id] || [],
        }));

        return response(200, {
            success: true,
            total: count || items.length,
            limit,
            offset,
            items,
        });
    } catch (e) {
        return response(500, { success: false, error: 'Errore inatteso: ' + (e?.message || String(e)) });
    }
};
