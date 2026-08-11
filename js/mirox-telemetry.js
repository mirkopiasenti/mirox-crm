/**
 * Telemetria tecnica Guardian.
 *
 * Il modulo raccoglie soltanto eventi strutturati e ripuliti. Non legge form,
 * localStorage, body HTTP, allegati o dati anagrafici. L'invio e' in background
 * e viene saltato quando non esiste una sessione autenticata.
 */
(function (root) {
    'use strict';
    if (root.MiroxTelemetry) return;

    const ENDPOINT = '/.netlify/functions/guardian-telemetry-ingest';
    const MAX_QUEUE = 20;
    const MAX_BREADCRUMBS = 10;
    const queue = [];
    const fingerprints = new Set();
    let flushTimer = null;
    let flushing = false;
    const breadcrumbs = [];

    function text(value, max) {
        return String(value == null ? '' : value)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 500);
    }

    function eventId() {
        try {
            if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
        } catch (_) { /* fallback */ }
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 3 | 8);
            return v.toString(16);
        });
    }

    function requestId() {
        return eventId();
    }

    function release() {
        const info = root.MiroxEnvironmentInfo || {};
        return {
            commit_sha: text(info.commit_sha, 128) || null,
            deploy_id: text(info.deploy_id, 160) || null
        };
    }

    function pagePath() {
        try { return root.location.pathname.split('?')[0].slice(0, 300); } catch (_) { return null; }
    }

    function addBreadcrumb(actionKey) {
        if (!actionKey) return;
        breadcrumbs.push({ action_key: text(actionKey, 120), age_ms: 0 });
        while (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.shift();
    }

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flush().catch(() => { /* telemetria best effort */ });
        }, 1500);
    }

    async function accessToken() {
        try {
            if (root.db?.auth?.getSession) {
                const { data } = await root.db.auth.getSession();
                return data?.session?.access_token || null;
            }
        } catch (_) { /* sessione non disponibile */ }
        return null;
    }

    async function flush() {
        if (flushing || !queue.length) return;
        const token = await accessToken();
        if (!token) return;
        flushing = true;
        const batch = queue.splice(0, Math.min(5, queue.length));
        try {
            const response = await root.fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ events: batch }),
                keepalive: true
            });
            if (!response.ok) queue.unshift(...batch.slice(0, MAX_QUEUE - queue.length));
        } catch (_) {
            queue.unshift(...batch.slice(0, MAX_QUEUE - queue.length));
        } finally {
            flushing = false;
            if (queue.length) scheduleFlush();
        }
    }

    function capture(kind, error, location, details) {
        const err = error instanceof Error ? error : new Error(text(error || 'Errore non specificato', 500));
        const event = {
            event_id: eventId(),
            kind: text(kind, 40) || 'frontend_exception',
            severity_hint: details?.severity_hint || 'error',
            occurred_at: new Date().toISOString(),
            release: release(),
            location: {
                page_path: pagePath(),
                module: text(location?.module, 120) || null,
                operation: text(location?.operation, 160) || null,
                file: text(location?.file, 300) || null,
                line: Number.isFinite(location?.line) ? location.line : null,
                column: Number.isFinite(location?.column) ? location.column : null
            },
            error: {
                code: text(details?.code, 160) || null,
                message: text(err.message || err, 500),
                stack: text(err.stack, 4000),
                http_status: Number.isFinite(details?.http_status) ? details.http_status : null,
                retriable: Boolean(details?.retriable)
            },
            correlation: { request_id: text(details?.request_id, 120) || null },
            context: {
                action_key: text(details?.action_key, 120) || null,
                browser_family: text(root.navigator?.userAgent, 80) || null,
                viewport_bucket: root.innerWidth >= 1024 ? 'desktop' : root.innerWidth >= 640 ? 'tablet' : 'mobile',
                online: root.navigator?.onLine !== false,
                duration_ms: Number.isFinite(details?.duration_ms) ? Math.max(0, Math.min(details.duration_ms, 3600000)) : null,
                retriable: Boolean(details?.retriable)
            },
            breadcrumbs: breadcrumbs.slice(-MAX_BREADCRUMBS)
        };
        const fingerprint = `${event.kind}|${event.error.code || ''}|${event.location.module || ''}|${event.error.message}`.replace(/\d+/g, '#');
        if (fingerprints.has(fingerprint)) return event.event_id;
        fingerprints.add(fingerprint);
        if (fingerprints.size > 100) fingerprints.delete(fingerprints.values().next().value);
        queue.push(event);
        while (queue.length > MAX_QUEUE) queue.shift();
        scheduleFlush();
        return event.event_id;
    }

    function bindGlobalHandlers() {
        root.addEventListener?.('error', (event) => {
            capture('frontend_exception', event.error || new Error(text(event.message, 500)), {
                file: event.filename, line: event.lineno, column: event.colno
            });
        });
        root.addEventListener?.('unhandledrejection', (event) => {
            capture('unhandled_rejection', event.reason instanceof Error ? event.reason : new Error(text(event.reason, 500)));
        });
        root.addEventListener?.('pagehide', () => { flush().catch(() => {}); });
        root.addEventListener?.('visibilitychange', () => {
            if (root.document?.visibilityState === 'hidden') flush().catch(() => {});
        });
    }

    bindGlobalHandlers();
    root.MiroxTelemetry = { capture, addBreadcrumb, flush, requestId };
})(window);
