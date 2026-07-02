'use strict';

// =============================================================
// _lib/privacy-config.js
// Config validato del sistema consensi privacy v2.
// Espone costanti, dati del Titolare e caricamento cached del testo
// legale da docs/approved_privacy_copy_v2.md.
//
// Il testo markdown e' la fonte di verita' immutabile: non va mai
// parafrasato o riordinato dal renderer. Solo i placeholder
// [VALORE DINAMICO] / [NUMERO MASCHERATO] / [Consumer / Business] /
// [X] / [Y] / [NESSUNA / VALORE DINAMICO] / [VALORE DINAMICO / NON INDICATO]
// e i blocchi editoriali (riga DPO, frase extra-SEE) sono gestiti
// dal renderer PDF.
// =============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const INFORMATIVA_VERSIONE = 'PRIVACY_V2_2026_06_29';
const MARKDOWN_FILENAME = 'approved_privacy_copy_v2.md';

// Path candidati per il file markdown. Ordine di tentativo:
//   1. bundle Netlify con included_files: cwd = /var/task
//   2. run locale da repo root
//   3. run locale da _lib (sviluppo/test)
function candidateMarkdownPaths() {
    return [
        path.join(process.cwd(), 'docs', MARKDOWN_FILENAME),
        path.resolve(__dirname, '..', '..', '..', 'docs', MARKDOWN_FILENAME),
        path.resolve(__dirname, '..', '..', 'docs', MARKDOWN_FILENAME),
    ];
}

let markdownCache = null;

function loadMarkdown() {
    if (markdownCache) return markdownCache;
    const errors = [];
    for (const candidate of candidateMarkdownPaths()) {
        try {
            const content = fs.readFileSync(candidate, 'utf8');
            if (!content || content.length < 500) {
                errors.push(`${candidate}: file troppo corto (${content ? content.length : 0} char)`);
                continue;
            }
            const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
            markdownCache = {
                filePath: candidate,
                content,
                hash,
            };
            return markdownCache;
        } catch (err) {
            errors.push(`${candidate}: ${err.code || err.message}`);
        }
    }
    throw new Error(
        `Impossibile caricare ${MARKDOWN_FILENAME}. Tentativi: ${errors.join(' | ')}`
    );
}

function resetCacheForTests() {
    markdownCache = null;
}

// Aggiunge N mesi a una data trattando in modo sicuro i casi di overflow
// (es. 31 gennaio + 1 mese = 28/29 febbraio, non "3 marzo").
// Usata per calcolare marketing_valido_fino_al = now + VALIDITA_MARKETING_MESI.
function addMonthsClamped(date, months) {
    const src = new Date(date.getTime());
    const y = src.getUTCFullYear();
    const m = src.getUTCMonth();
    const d = src.getUTCDate();
    const target = new Date(Date.UTC(y, m + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(d, lastDay));
    target.setUTCHours(src.getUTCHours(), src.getUTCMinutes(), src.getUTCSeconds(), src.getUTCMilliseconds());
    return target;
}

// Config validato al primo accesso. Failing early se manca qualcosa.
function assertConfigValid() {
    const md = loadMarkdown();
    if (!md.content.includes(INFORMATIVA_VERSIONE)) {
        throw new Error(
            `${MARKDOWN_FILENAME} non contiene la stringa versione ${INFORMATIVA_VERSIONE}. ` +
            `Aggiornare INFORMATIVA_VERSIONE o il testo del markdown.`
        );
    }
    if (!md.content.includes('KONA TECH S.r.l.')) {
        throw new Error(`${MARKDOWN_FILENAME} non contiene "KONA TECH S.r.l.".`);
    }
    return true;
}

module.exports = {
    INFORMATIVA_VERSIONE,
    MARKDOWN_FILENAME,

    // Dati del Titolare (allineati al testo del markdown).
    // Se cambiano qui vanno cambiati anche nel testo legale, altrimenti
    // assertConfigValid() protesta.
    TITOLARE: Object.freeze({
        ragione_sociale: 'KONA TECH S.r.l.',
        piva: '05146970230',
        sede: 'Via Dossi, 7 - 37058 Sanguinetto (VR), Italia',
        email: 'info@konatech.it',
        pec: 'konatechsrl@pec.it',
    }),

    // Feature flag del testo legale (F6, F7).
    HAS_DPO: false,
    NO_EXTRA_SEE_TRANSFERS: true,

    // Regole di scadenza (F5).
    VALIDITA_MARKETING_MESI: 24,

    // Regole OTP.
    OTP: Object.freeze({
        DIGIT_COUNT: 6,
        DURATA_MINUTI: 10,
        MAX_TENTATIVI: 3,
        MAX_INVII_PER_ORA: 3,
        COOLDOWN_REINVIO_SEC: 60,
    }),

    // Canali marketing granulari (decisione 2026-07-02: 3 canali, no SMS).
    // Le chiavi coincidono con i suffissi delle colonne DB marketing_<canale>
    // e con i valori accettati dalla function revoca-consenso-canale.
    MARKETING_CHANNELS: Object.freeze(['email', 'whatsapp', 'phone_operator']),

    MARKETING_CHANNEL_LABELS: Object.freeze({
        email: 'Email',
        whatsapp: 'WhatsApp',
        phone_operator: 'Telefonate effettuate da un operatore umano',
    }),

    // Bucket storage per i PDF firmati (creato dalla migration 034).
    STORAGE_BUCKET: 'consensi-privacy',

    loadMarkdown,
    resetCacheForTests,
    assertConfigValid,
    addMonthsClamped,
};
