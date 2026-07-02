'use strict';

/**
 * Generatore PDF v2 dell'informativa privacy.
 *
 * Carica il testo verbatim da docs/approved_privacy_copy_v2.md (via
 * privacy-config.loadMarkdown) e lo rende in un PDF A4 rispettando
 * queste regole:
 *
 *   - Sostituzione placeholder [VALORE DINAMICO], [NUMERO MASCHERATO] (con
 *     numero PIENO, F8), [Consumer / Business], [NESSUNA / VALORE DINAMICO],
 *     [VALORE DINAMICO / NON INDICATO], [PRIVACY_V2_2026_06_29].
 *   - Riga DPO omessa se HAS_DPO=false (F6).
 *   - Blocco editoriale extra-SEE sostituito con la frase fissa se
 *     NO_EXTRA_SEE_TRANSFERS=true (F7).
 *   - Checkbox marketing rese con simbolo grafico X (selezionata) o
 *     riquadro vuoto (non selezionata), letta dal ctx.marketing.
 *   - Footer per pagina: "Versione | ID | Hash" a sinistra, "Pagina X di Y"
 *     a destra (bufferedPageRange one-pass, no two-pass).
 *
 * Uso:
 *   const { generateConsensoV2Pdf } = require('./_lib/pdf-consenso-v2');
 *   const { buffer, pdfHash, documentHash } = await generateConsensoV2Pdf({
 *     cliente: { ragione_sociale, cf_piva, cluster, nome_referente,
 *                indirizzo, cellulare, email, whatsapp, data_presa_visione },
 *     otp: { mainPhone, otpPhone, otpMotivazione, confermatoAt },
 *     marketing: { email, whatsapp, phone_operator },
 *     consentUuid,
 *   });
 *
 * Ritorna:
 *   {
 *     buffer: Buffer (PDF),
 *     pdfHash: string (SHA256 hex del PDF finale),
 *     documentHash: string (SHA256 hex del testo markdown reso, post
 *                           preprocessing e sostituzioni),
 *   }
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const privacyConfig = require('./privacy-config');

const COL_PRIMARY = '#FF6600';
const COL_TEXT = '#0f172a';
const COL_MUTED = '#64748b';
const COL_BORDER = '#cbd5e1';

const PAGE_MARGIN = 50;
const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';
const FONT_ITALIC = 'Helvetica-Oblique';

const MARKETING_LABELS = privacyConfig.MARKETING_CHANNEL_LABELS;

// -------------------------------------------------------------
// Utility
// -------------------------------------------------------------

function safe(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    const s = String(value).trim();
    return s || fallback;
}

function formatItalianDateTime(isoOrDate) {
    let d;
    if (!isoOrDate) d = new Date();
    else if (isoOrDate instanceof Date) d = isoOrDate;
    else d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) d = new Date();
    const fmt = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function formatItalianDate(isoOrDate) {
    let d;
    if (!isoOrDate) d = new Date();
    else if (isoOrDate instanceof Date) d = isoOrDate;
    else d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) d = new Date();
    const fmt = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => (acc[p.type] = p.value, acc), {});
    return `${parts.day}/${parts.month}/${parts.year}`;
}

function sha256(input) {
    return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// -------------------------------------------------------------
// Preprocessing markdown
// Applica le decisioni F6/F7 e sostituisce i placeholder statici
// (versione, dati cliente, dati OTP). Il risultato e' il testo che
// verra' effettivamente reso nel PDF e su cui viene calcolato il
// documentHash.
// -------------------------------------------------------------

function stripDpoLines(md) {
    // Rimuove le 2 righe DPO consecutive:
    //   **Responsabile della Protezione dei Dati / DPO:** [...]
    //   Recapito DPO: [email / PEC del DPO].
    const lines = md.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (l.startsWith('**Responsabile della Protezione dei Dati')) {
            // salta questa e la successiva (recapito) e l'eventuale riga vuota di raccordo
            i++;
            if (i < lines.length && lines[i].startsWith('Recapito DPO')) {
                // ok saltata
            } else {
                // sfugge il pattern: rimetto le righe come sono per non perdere contenuto
                out.push(l);
                if (i < lines.length) out.push(lines[i]);
            }
            continue;
        }
        out.push(l);
    }
    return out.join('\n');
}

function applyExtraSeeTransfers(md, insertFixedSentence) {
    // Il blocco editoriale nel testo:
    //   [Inserire questa frase solo se verificata: "Il Titolare non effettua trasferimenti di dati personali verso Paesi situati al di fuori dello Spazio Economico Europeo."]
    // Se insertFixedSentence=true -> sostituisco l'intera riga con la frase
    // (senza virgolette e senza parentesi editoriale).
    // Se false -> rimuovo la riga.
    const regex = /^\[Inserire questa frase solo se verificata:\s*"([^"]+)"\]\s*$/gm;
    if (insertFixedSentence) {
        return md.replace(regex, (_m, inner) => inner);
    }
    return md.replace(regex, '');
}

function substituteSection9(md, cliente) {
    const mapping = [
        { prefix: 'Nome e cognome / Ragione sociale:', value: safe(cliente.ragione_sociale) },
        { prefix: 'Codice fiscale / Partita IVA:', value: safe(cliente.cf_piva) },
        { prefix: 'Persona di riferimento:', value: safe(cliente.nome_referente) },
        { prefix: 'Indirizzo:', value: safe(cliente.indirizzo) },
        { prefix: 'Telefono:', value: safe(cliente.cellulare) },
        { prefix: 'Email:', value: safe(cliente.email) },
        {
            prefix: 'Data di presa visione dell’informativa:',
            value: cliente.data_presa_visione
                ? formatItalianDate(cliente.data_presa_visione)
                : formatItalianDate(new Date()),
        },
        // NB: la stringa nel markdown consegnato usa un apostrofo curly
        // (’). La copia esatta e' preservata; se in futuro cambia in
        // apostrofo normale, aggiornare il prefix corrispondente.
    ];
    let out = md;
    for (const m of mapping) {
        const re = new RegExp(
            `^(${escapeRegex(m.prefix)})\\s*\\[VALORE DINAMICO\\]\\s*$`,
            'm'
        );
        out = out.replace(re, `$1 ${m.value}`);
    }
    // Tipologia cliente: [Consumer / Business] -> valore effettivo
    out = out.replace(
        /^(Tipologia cliente:)\s*\[Consumer \/ Business\]\s*$/m,
        (_m, prefix) => `${prefix} ${safe(cliente.cluster, 'Consumer')}`
    );
    // WhatsApp con fallback NON INDICATO
    const waValue = safe(cliente.whatsapp, 'NON INDICATO');
    out = out.replace(
        /^(Recapito WhatsApp indicato:)\s*\[VALORE DINAMICO \/ NON INDICATO\]\s*$/m,
        (_m, prefix) => `${prefix} ${waValue}`
    );
    return out;
}

function substituteSection11(md, ctx) {
    const otp = ctx.otp || {};
    const otpPhone = safe(otp.otpPhone);
    const mainPhone = safe(otp.mainPhone);
    const motivazione = otp.otpMotivazione && String(otp.otpMotivazione).trim()
        ? String(otp.otpMotivazione).trim()
        : 'Nessuna';
    const confermatoAt = otp.confermatoAt
        ? formatItalianDateTime(otp.confermatoAt)
        : formatItalianDateTime(new Date());
    const consentUuid = safe(ctx.consentUuid, '(non assegnato)');
    // Identificativo univoco / hash: uuid + hash md (primi 16 char).
    // Popolato temporaneamente con placeholder che viene riscritto dopo
    // il calcolo del document_hash (una volta rimossi TUTTI i placeholder
    // "logici", il testo e' stabile). Uso una stringa sentinel da post-
    // sostituire.
    const identifierPlaceholder = '__IDENTIFICATIVO_DOCUMENTO__';

    const mapping = [
        {
            prefix: 'Numero utilizzato per l\'invio dell\'OTP:',
            marker: '[NUMERO MASCHERATO]',
            value: otpPhone,
        },
        {
            prefix: 'Numero di contatto principale indicato dall\'interessato:',
            marker: '[NUMERO MASCHERATO]',
            value: mainPhone,
        },
        {
            prefix: 'Eventuale motivazione della differenza tra recapito principale e recapito OTP:',
            marker: '[NESSUNA / VALORE DINAMICO]',
            value: motivazione,
        },
        {
            prefix: 'Data e ora della conferma OTP:',
            marker: '[VALORE DINAMICO]',
            value: confermatoAt,
        },
        {
            prefix: 'ID consenso:',
            marker: '[VALORE DINAMICO]',
            value: consentUuid,
        },
        {
            prefix: 'Versione del documento:',
            marker: '[VALORE DINAMICO]',
            value: privacyConfig.INFORMATIVA_VERSIONE,
        },
        {
            prefix: 'Identificativo univoco o hash del documento:',
            marker: '[VALORE DINAMICO]',
            value: identifierPlaceholder,
        },
    ];

    let out = md;
    for (const m of mapping) {
        const re = new RegExp(
            `^(${escapeRegex(m.prefix)})\\s*${escapeRegex(m.marker)}\\s*$`,
            'm'
        );
        out = out.replace(re, `$1 ${m.value}`);
    }
    return { md: out, identifierPlaceholder, consentUuid };
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// -------------------------------------------------------------
// Renderer PDF (parser markdown minimale -> pdfkit)
// -------------------------------------------------------------

function drawHeader(doc) {
    doc.rect(0, 0, doc.page.width, 8).fill(COL_PRIMARY);
    doc.fillColor(COL_TEXT);
}

function drawFooter(doc, meta) {
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const bottom = doc.page.height - 32;
        doc.font(FONT_REGULAR).fontSize(7).fillColor(COL_MUTED);
        const leftText = `Versione ${meta.version}  |  ID ${meta.consentUuid}  |  Hash ${meta.hashShort}`;
        doc.text(leftText, PAGE_MARGIN, bottom, {
            width: doc.page.width - 2 * PAGE_MARGIN - 100,
            lineBreak: false,
            align: 'left',
        });
        doc.text(`Pagina ${i - range.start + 1} di ${total}`, doc.page.width - PAGE_MARGIN - 100, bottom, {
            width: 100,
            lineBreak: false,
            align: 'right',
        });
        doc.fillColor(COL_TEXT);
    }
}

function renderMarkdown(doc, md, marketingPrefs) {
    // Rimuovi le 3 righe finali "---", "Versione informativa...", "Pagina [X] di [Y]"
    // (verranno rese nel footer dinamico).
    let content = md
        .replace(/\n---\n+Versione informativa:[^\n]*\nPagina \[X\] di \[Y\]\s*$/, '')
        .replace(/\n---\n*$/, '')
        .trimEnd();

    const lines = content.split('\n');
    let inParagraph = false;
    const usableWidth = doc.page.width - 2 * PAGE_MARGIN;

    function ensureParagraphBreak() {
        if (inParagraph) {
            doc.moveDown(0.6);
            inParagraph = false;
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const line = raw.trimEnd();

        if (line === '') {
            ensureParagraphBreak();
            continue;
        }

        // H1 -> titolo del documento
        if (line.startsWith('# ') && !line.startsWith('## ')) {
            ensureParagraphBreak();
            doc.moveDown(0.3);
            doc.font(FONT_BOLD).fontSize(15).fillColor(COL_PRIMARY);
            doc.text(line.replace(/^#\s+/, ''), { align: 'center', width: usableWidth });
            doc.fillColor(COL_TEXT);
            doc.moveDown(0.6);
            continue;
        }

        // H2 -> sezione principale (## 1. Titolare...)
        if (line.startsWith('## ')) {
            ensureParagraphBreak();
            doc.moveDown(0.5);
            doc.font(FONT_BOLD).fontSize(12).fillColor(COL_PRIMARY);
            doc.text(line.replace(/^##\s+/, ''), { width: usableWidth });
            doc.fillColor(COL_TEXT);
            doc.moveDown(0.25);
            continue;
        }

        // H3 -> sottosezione (### a) Gestione...)
        if (line.startsWith('### ')) {
            ensureParagraphBreak();
            doc.moveDown(0.3);
            doc.font(FONT_BOLD).fontSize(10.5).fillColor(COL_TEXT);
            doc.text(line.replace(/^###\s+/, ''), { width: usableWidth });
            doc.moveDown(0.15);
            continue;
        }

        // Bullet list "* ..."
        if (/^\*\s+/.test(line)) {
            ensureParagraphBreak();
            const bulletText = stripInlineMarkdown(line.replace(/^\*\s+/, ''));
            doc.font(FONT_REGULAR).fontSize(9.5).fillColor(COL_TEXT);
            doc.list([bulletText], { bulletRadius: 1.5, textIndent: 12, bulletIndent: 4, width: usableWidth });
            continue;
        }

        // Checkbox marketing "[ ] Email" ecc.
        const checkboxMatch = line.match(/^\[\s?\]\s+(.+)$/);
        if (checkboxMatch) {
            ensureParagraphBreak();
            const label = checkboxMatch[1].trim();
            const key = labelToMarketingKey(label);
            const checked = key ? Boolean(marketingPrefs && marketingPrefs[key]) : false;
            drawCheckbox(doc, checked, label, usableWidth);
            doc.moveDown(0.2);
            continue;
        }

        // Riga con **bold**: potrebbe essere:
        //  - "**Base giuridica:** esecuzione del contratto..."
        //  - "**Trasferimenti verso Paesi extra-SEE:**" (standalone)
        //  - "**Responsabile...**" (gia' rimossa se HAS_DPO=false)
        // Uso un rendering "bold prefix + regolare resto" quando il bold e' a inizio riga.
        if (/^\*\*[^*]+\*\*/.test(line)) {
            ensureParagraphBreak();
            renderMixedBoldLine(doc, line, usableWidth);
            inParagraph = true;
            continue;
        }

        // Paragrafo normale
        doc.font(FONT_REGULAR).fontSize(9.5).fillColor(COL_TEXT);
        doc.text(stripInlineMarkdown(line), { width: usableWidth, align: 'justify' });
        inParagraph = true;
    }
    ensureParagraphBreak();
}

function labelToMarketingKey(label) {
    const clean = label.replace(/\s+/g, ' ').trim();
    if (clean === MARKETING_LABELS.email) return 'email';
    if (clean === MARKETING_LABELS.whatsapp) return 'whatsapp';
    if (clean === MARKETING_LABELS.phone_operator) return 'phone_operator';
    return null;
}

function drawCheckbox(doc, checked, label, usableWidth) {
    const size = 10;
    const startX = PAGE_MARGIN;
    const startY = doc.y;
    doc.lineWidth(0.8).strokeColor(COL_TEXT);
    doc.rect(startX, startY + 2, size, size).stroke();
    if (checked) {
        doc.moveTo(startX + 2, startY + 6).lineTo(startX + 4, startY + 10).stroke();
        doc.moveTo(startX + 4, startY + 10).lineTo(startX + 9, startY + 4).stroke();
    }
    doc.font(FONT_REGULAR).fontSize(10).fillColor(COL_TEXT);
    doc.text(label, startX + size + 8, startY, { width: usableWidth - size - 8 });
}

function stripInlineMarkdown(text) {
    // Rimuove **bold** (mantiene testo interno) e link markdown [t](u) -> t.
    let out = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
    return out;
}

function renderMixedBoldLine(doc, line, usableWidth) {
    // Cerca il primo **...** e lo rende bold; il resto della riga come normale.
    // Sufficiente per righe "**Base giuridica:** esecuzione..." e
    // "**Trasferimenti verso Paesi extra-SEE:**".
    const match = line.match(/^\*\*([^*]+)\*\*(.*)$/);
    if (!match) {
        doc.font(FONT_REGULAR).fontSize(9.5).fillColor(COL_TEXT);
        doc.text(stripInlineMarkdown(line), { width: usableWidth, align: 'justify' });
        return;
    }
    const bold = match[1];
    const rest = stripInlineMarkdown(match[2]).trim();
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(COL_TEXT);
    if (rest) {
        doc.text(bold + ' ', { continued: true, width: usableWidth });
        doc.font(FONT_REGULAR);
        doc.text(rest, { width: usableWidth, align: 'justify' });
    } else {
        doc.text(bold, { width: usableWidth });
    }
}

// -------------------------------------------------------------
// API pubblica
// -------------------------------------------------------------

async function generateConsensoV2Pdf(ctx) {
    privacyConfig.assertConfigValid();

    const { content: mdRaw } = privacyConfig.loadMarkdown();
    let md = mdRaw;

    // Preprocessing testo secondo decisioni F6/F7
    if (!privacyConfig.HAS_DPO) md = stripDpoLines(md);
    md = applyExtraSeeTransfers(md, privacyConfig.NO_EXTRA_SEE_TRANSFERS);

    // Sostituzioni contestuali
    md = substituteSection9(md, ctx.cliente || {});
    const sec11 = substituteSection11(md, ctx);
    md = sec11.md;

    // A questo punto tutti i placeholder sono risolti tranne
    // __IDENTIFICATIVO_DOCUMENTO__ (che sostituisco dopo il calcolo hash).
    // Calcolo hash del testo pre-identificativo per stabilita':
    const mdForHash = md.replace('__IDENTIFICATIVO_DOCUMENTO__', '[HASH_PLACEHOLDER]');
    const documentHash = sha256(mdForHash);
    const hashShort = documentHash.slice(0, 16);
    const identificativo = `${sec11.consentUuid} / SHA256:${hashShort}`;
    md = md.replace('__IDENTIFICATIVO_DOCUMENTO__', identificativo);

    // Render PDF
    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN + 20, left: PAGE_MARGIN, right: PAGE_MARGIN },
        bufferPages: true,
        info: {
            Title: 'Informativa privacy e preferenze marketing',
            Author: privacyConfig.TITOLARE.ragione_sociale,
            Subject: `Consenso ${sec11.consentUuid}`,
            Keywords: `privacy, GDPR, consenso, ${privacyConfig.INFORMATIVA_VERSIONE}`,
        },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => doc.on('end', resolve));

    drawHeader(doc);
    renderMarkdown(doc, md, ctx.marketing || {});
    drawFooter(doc, {
        version: privacyConfig.INFORMATIVA_VERSIONE,
        consentUuid: sec11.consentUuid,
        hashShort,
    });
    doc.end();
    await done;

    const buffer = Buffer.concat(chunks);
    const pdfHash = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
        buffer,
        pdfHash,
        documentHash,
        markdownRendered: md,
    };
}

module.exports = {
    generateConsensoV2Pdf,
    // Esposte per la test suite:
    _internal: {
        stripDpoLines,
        applyExtraSeeTransfers,
        substituteSection9,
        substituteSection11,
        labelToMarketingKey,
        formatItalianDateTime,
        formatItalianDate,
        sha256,
    },
};
