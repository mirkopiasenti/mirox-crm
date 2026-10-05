const crypto = require('node:crypto');

function isTemporaryStorageError(error) {
    const status = Number(error?.statusCode || error?.status || 0);
    return [408, 429, 500, 502, 503, 504, 544].includes(status)
        || /DatabaseTimeout|connection.*timed out|fetch failed|network|timeout/i.test(String(error?.code || '') + ' ' + String(error?.message || ''));
}

function isStorageConflict(error) {
    return Number(error?.statusCode || error?.status) === 409
        || /exist|duplicate|already|409/i.test(String(error?.message || ''));
}

// Un solo retry, stesso path e upsert:false. Un timeout puo' nascondere un upload
// riuscito: accettiamo il conflitto successivo solo dopo confronto dei byte.
async function uploadPrivacyPdf(bucket, path, buffer, pause = ms => new Promise(resolve => setTimeout(resolve, ms))) {
    let uncertain = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let error;
        try {
            ({ error } = await bucket.upload(path, buffer, { contentType: 'application/pdf', upsert: false }));
        } catch (caught) { error = caught; }
        if (!error) return { error: null };
        if (uncertain && isStorageConflict(error)) {
            const downloaded = await bucket.download(path).catch(() => ({ error: true }));
            if (!downloaded.error && downloaded.data) {
                const bytes = Buffer.from(await downloaded.data.arrayBuffer());
                const digest = data => crypto.createHash('sha256').update(data).digest('hex');
                if (digest(bytes) === digest(buffer)) return { error: null };
            }
        }
        if (attempt || !isTemporaryStorageError(error)) return { error };
        uncertain = true;
        await pause(350);
    }
}

module.exports = { uploadPrivacyPdf, isStorageConflict, isTemporaryStorageError };
