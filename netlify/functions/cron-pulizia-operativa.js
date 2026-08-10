/**
 * Pulizia operativa giornaliera.
 *
 * - scade le richieste OTP rimaste pending oltre otp_scade_at;
 * - elimina i contatori di rate limit non più utili;
 * - rimuove pratiche vendita in bozza da oltre 24 ore e i relativi PDF.
 *
 * La pratica viene eliminata dal DB solo dopo la rimozione riuscita di tutti
 * gli oggetti Storage noti, così un errore temporaneo è ritentabile il giorno
 * successivo senza lasciare PDF orfani.
 */

const { createClient } = require('@supabase/supabase-js');

const schedule = '30 2 * * *';
const BOZZA_MAX_AGE_HOURS = 24;

function isStagingEnvironment() {
    return String(process.env.MIROX_DEPLOY_ENV || '').trim().toLowerCase() === 'staging';
}

function getClient() {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceRoleKey) {
        throw new Error('SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY mancanti');
    }
    return createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

function groupStoragePaths(documenti) {
    const grouped = new Map();
    for (const documento of documenti || []) {
        const bucket = String(documento.storage_bucket || '').trim();
        const path = String(documento.storage_path || '').trim();
        if (!bucket || !path) continue;
        if (!grouped.has(bucket)) grouped.set(bucket, []);
        grouped.get(bucket).push(path);
    }
    return grouped;
}

async function cleanupDraft(supabase, praticaId) {
    const { data: documenti, error: documentiError } = await supabase
        .from('vendita_documenti')
        .select('storage_bucket, storage_path')
        .eq('pratica_id', praticaId);
    if (documentiError) throw documentiError;

    for (const [bucket, paths] of groupStoragePaths(documenti).entries()) {
        for (let start = 0; start < paths.length; start += 100) {
            const { error } = await supabase.storage
                .from(bucket)
                .remove(paths.slice(start, start + 100));
            if (error) throw new Error(`Storage ${bucket}: ${error.message}`);
        }
    }

    const { data: deleted, error: deleteError } = await supabase
        .from('vendita_pratiche')
        .delete()
        .eq('id', praticaId)
        .eq('stato_pratica', 'bozza')
        .select('id')
        .maybeSingle();
    if (deleteError) throw deleteError;
    return Boolean(deleted);
}

const handler = async () => {
    if (isStagingEnvironment()) {
        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, skipped: true, environment: 'staging' })
        };
    }

    let supabase;
    try {
        supabase = getClient();
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ ok: false, error: error.message }) };
    }

    const nowIso = new Date().toISOString();
    const draftCutoff = new Date(
        Date.now() - BOZZA_MAX_AGE_HOURS * 60 * 60 * 1000
    ).toISOString();
    const errors = [];

    const { data: expiredOtps, error: otpError } = await supabase
        .from('vendita_consensi_privacy')
        .update({ stato: 'scaduto' })
        .eq('stato', 'pending')
        .lt('otp_scade_at', nowIso)
        .select('id');
    if (otpError) errors.push(`consensi: ${otpError.message}`);

    const { data: expiredLimits, error: rateError } = await supabase
        .from('mirox_public_rate_limits')
        .delete()
        .lt('expires_at', nowIso)
        .select('scope');
    if (rateError) errors.push(`rate-limit: ${rateError.message}`);

    const { data: drafts, error: draftsError } = await supabase
        .from('vendita_pratiche')
        .select('id')
        .eq('stato_pratica', 'bozza')
        .lt('created_at', draftCutoff)
        .limit(100);
    if (draftsError) {
        errors.push(`elenco bozze: ${draftsError.message}`);
    }

    let deletedDrafts = 0;
    for (const draft of drafts || []) {
        try {
            if (await cleanupDraft(supabase, draft.id)) deletedDrafts += 1;
        } catch (error) {
            errors.push(`bozza ${draft.id}: ${error?.message || error}`);
        }
    }

    if (errors.length) console.error('cron-pulizia-operativa:', errors.join(' | '));

    return {
        statusCode: errors.length ? 207 : 200,
        body: JSON.stringify({
            ok: errors.length === 0,
            otp_scaduti: expiredOtps?.length || 0,
            rate_limit_eliminati: expiredLimits?.length || 0,
            bozze_eliminate: deletedDrafts,
            errori: errors
        })
    };
};

module.exports = { handler, schedule, _test: { isStagingEnvironment } };
