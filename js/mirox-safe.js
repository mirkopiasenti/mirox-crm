/**
 * Utility condivise per inserire dati non fidati nel DOM.
 *
 * Regola d'uso:
 * - escapeHtml(value) per testo inserito in template HTML o attributi quotati;
 * - safeUrl(value) prima di assegnare URL provenienti da DB o input;
 * - isUuid(value) / isRecordId(value) prima di usare identificatori in
 *   handler inline legacy.
 *
 * Non esiste un metodo "sanitizeHtml" intenzionalmente: il codice applicativo
 * deve distinguere tra markup statico fidato e valori dinamici da codificare.
 */
(function initMiroxSafe(root) {
    'use strict';

    if (root.MiroxSafe) return;

    const HTML_ESCAPES = Object.freeze({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    });

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
    }

    function safeUrl(value, options = {}) {
        const raw = String(value == null ? '' : value).trim();
        if (!raw) return '';
        if (/^\/\//.test(raw)) return '';

        const allowRelative = options.allowRelative !== false;
        if (allowRelative && /^(?:\/(?!\/)|\.{1,2}\/)/.test(raw)) {
            return raw;
        }

        try {
            const parsed = new URL(raw, root.location?.origin || 'https://www.mirox-crm.it');
            if (parsed.protocol !== 'https:' && !(options.allowHttp === true && parsed.protocol === 'http:')) {
                return '';
            }
            return parsed.href;
        } catch (_) {
            return '';
        }
    }

    function isUuid(value) {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            .test(String(value || '').trim());
    }

    function isRecordId(value) {
        const raw = String(value == null ? '' : value).trim();
        return isUuid(raw) || /^(?:0|[1-9]\d{0,18})$/.test(raw);
    }

    function safeCssColor(value, fallback = '#999999') {
        const raw = String(value || '').trim();
        return /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(raw) ? raw : fallback;
    }

    root.MiroxSafe = Object.freeze({
        escapeHtml,
        safeUrl,
        isUuid,
        isRecordId,
        safeCssColor
    });
})(window);
