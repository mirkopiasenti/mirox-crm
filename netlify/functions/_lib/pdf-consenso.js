/**
 * Generatore PDF informativa privacy GDPR per Mirox.
 *
 * Produce un documento A4 con:
 *  - Intestazione + titolare del trattamento (Kona Tech S.r.l.)
 *  - Sezioni informativa GDPR art. 13 (finalita', base giuridica, conservazione,
 *    diritti dell'interessato, reclamo Garante, ecc.)
 *  - Dati dell'interessato (ragione sociale, CF/PIVA, indirizzo, contatti)
 *  - Presa visione dell'informativa + consenso marketing opzionale
 *  - Box firma:
 *      * modalita='otp_sms': metadata trascritti (numero, timestamp, hash,
 *        sms_id, IP operatore)
 *      * modalita='cartaceo': riquadro vuoto da firmare a mano
 *  - Footer con versione informativa + hash documento
 *
 * Uso:
 *   const { generateConsensoPdf, INFORMATIVA_VERSIONE } = require('./_lib/pdf-consenso');
 *   const buffer = await generateConsensoPdf({
 *     modalita: 'otp_sms',
 *     anagrafica: { ragione_sociale, cf_piva, cluster, indirizzo, email, cellulare },
 *     consensoMarketing: true,
 *     consensoContratto: true,
 *     otpMetadata: {           // solo per modalita='otp_sms'
 *       cellulareInviato: '+39...',
 *       confermatoAt: '2026-06-25T18:32:11+02:00',
 *       smsProviderId: 'sms_abc123',
 *       ipOperatore: '93.xx.xx.xx',
 *       operatoreNome: 'Mario Rossi',
 *       consensoId: 'uuid'
 *     },
 *     dataCompilazione: '2026-06-25T18:32:11+02:00'  // ISO; default now
 *   });
 *
 * Ritorna: { buffer, hash } con il Buffer PDF e il relativo SHA256.
 */

const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const { INFORMATIVA_VERSIONE } = require('./privacy-config');

// Dati Titolare hardcoded (Kona Tech S.r.l.)
const TITOLARE = {
    ragioneSociale: 'KONA TECH S.r.l.',
    piva: '05146970230',
    sedeLegale: 'Via Dossi, 7 - 37058 Sanguinetto (VR) - Italia',
    emailContatto: 'info@konatech.it',
    pec: 'konatechsrl@pec.it'
};

// Palette
const COL_PRIMARY = '#FF6600';
const COL_TEXT = '#0f172a';
const COL_MUTED = '#64748b';
const COL_BORDER = '#cbd5e1';
const COL_GREEN = '#16a34a';
const COL_RED = '#b91c1c';

function safeText(value, fallback = '') {
    if (value === null || value === undefined) return fallback;
    return String(value).trim() || fallback;
}

function formatItalianDateTime(isoOrDate) {
    let d;
    if (!isoOrDate) d = new Date();
    else if (isoOrDate instanceof Date) d = isoOrDate;
    else d = new Date(isoOrDate);
    if (Number.isNaN(d.getTime())) d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    // Europe/Rome rendering via Intl
    const fmt = new Intl.DateTimeFormat('it-IT', {
        timeZone: 'Europe/Rome',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
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
        year: 'numeric', month: '2-digit', day: '2-digit'
    });
    const parts = fmt.formatToParts(d).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    return `${parts.day}/${parts.month}/${parts.year}`;
}

function buildIndirizzo(a) {
    const parts = [];
    if (a.via) parts.push(a.via);
    if (a.civico) parts.push(a.civico);
    let line1 = parts.join(' ').trim();
    const line2parts = [];
    if (a.comune) line2parts.push(a.comune);
    if (a.provincia) line2parts.push(`(${a.provincia})`);
    let line2 = line2parts.join(' ').trim();
    const composed = [line1, line2].filter(Boolean).join(', ');
    return composed || '-';
}

/**
 * Disegna un checkbox riempito (verde) o vuoto (rosso) accanto al testo.
 */
function drawCheckRow(doc, x, y, checked, labelText, options = {}) {
    const size = 11;
    doc.save();
    doc.lineWidth(1).strokeColor(checked ? COL_GREEN : COL_RED);
    doc.rect(x, y, size, size).stroke();
    if (checked) {
        doc.fillColor(COL_GREEN);
        doc.moveTo(x + 2, y + 6).lineTo(x + 4.5, y + 8.5).lineTo(x + 9, y + 3).stroke(COL_GREEN);
    }
    doc.restore();
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
    const labelX = x + size + 6;
    const labelWidth = options.width || (doc.page.width - doc.page.margins.right - labelX);
    doc.text(labelText, labelX, y - 1, { width: labelWidth, lineGap: 1 });
}

function drawSectionTitle(doc, text) {
    doc.moveDown(0.3);
    doc.fillColor(COL_PRIMARY).font('Helvetica-Bold').fontSize(11);
    doc.text(text, { align: 'left' });
    doc.moveDown(0.15);
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
}

function drawParagraph(doc, text) {
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
    doc.text(text, { align: 'justify', lineGap: 1.5 });
    doc.moveDown(0.3);
}

function drawBulletList(doc, items) {
    doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
    items.forEach((it) => {
        doc.text(`• ${it}`, { indent: 8, align: 'left', lineGap: 1.5 });
    });
    doc.moveDown(0.2);
}

function drawHeader(doc) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    doc.rect(left, 30, right - left, 50).fillAndStroke('#FFF7ED', COL_BORDER);
    doc.fillColor(COL_PRIMARY).font('Helvetica-Bold').fontSize(16);
    doc.text('Informativa privacy CRM e consenso ai ricontatti', left + 12, 42, { width: right - left - 24 });
    doc.fillColor(COL_MUTED).font('Helvetica').fontSize(8.5);
    doc.text('Titolare: ' + TITOLARE.ragioneSociale + ' — P.IVA ' + TITOLARE.piva, left + 12, 62);
    doc.fillColor(COL_TEXT);
    // Reset cursor below header
    doc.y = 95;
    doc.x = left;
}

function drawFooter(doc, opts) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const yBase = doc.page.height - 40;
    const previousBottomMargin = doc.page.margins.bottom;
    // Il footer vive intenzionalmente dentro il margine inferiore. Durante la
    // scrittura azzeriamo il margine per evitare che PDFKit aggiunga pagine
    // vuote quando il cursore supera l'area del corpo.
    doc.page.margins.bottom = 0;
    doc.lineWidth(0.5).strokeColor(COL_BORDER).moveTo(left, yBase - 6).lineTo(right, yBase - 6).stroke();
    doc.fillColor(COL_MUTED).font('Helvetica').fontSize(7.5);
    const v = `Versione informativa: ${opts.informativaVersione}`;
    const h = opts.documentoHash ? `Hash documento (SHA256): ${opts.documentoHash.slice(0, 32)}…` : '';
    doc.text(v, left, yBase, { width: right - left, align: 'left', lineBreak: false });
    if (h) doc.text(h, left, yBase + 9, { width: right - left, align: 'left', lineBreak: false });
    doc.text('Pagina ' + (opts.pageNumber || 1), left, yBase, { width: right - left, align: 'right', lineBreak: false });
    doc.page.margins.bottom = previousBottomMargin;
}

/**
 * Genera il PDF e ritorna { buffer, hash } dove hash e' SHA256 del PDF.
 */
async function generateConsensoPdf(opts) {
    const modalita = opts.modalita === 'cartaceo' ? 'cartaceo' : 'otp_sms';
    const a = opts.anagrafica || {};
    const consensoContratto = opts.consensoContratto !== false;
    const consensoMarketing = !!opts.consensoMarketing;
    const dataCompilazione = opts.dataCompilazione || new Date().toISOString();
    const otpMd = opts.otpMetadata || {};
    const informativaVersione = INFORMATIVA_VERSIONE;

    return new Promise((resolve, reject) => {
        try {
            const chunks = [];
            const doc = new PDFDocument({
                size: 'A4',
                bufferPages: true,
                margins: { top: 95, right: 50, bottom: 60, left: 50 },
                info: {
                    Title: `Informativa privacy ${safeText(a.ragione_sociale, 'cliente')}`,
                    Author: TITOLARE.ragioneSociale,
                    Subject: 'Informativa GDPR sul CRM Mirox e consenso facoltativo ai ricontatti promozionali',
                    Keywords: 'GDPR, privacy, CRM, ricontatto, marketing, ' + safeText(a.cf_piva)
                }
            });

            doc.on('data', (c) => chunks.push(c));
            doc.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const hash = crypto.createHash('sha256').update(buffer).digest('hex');
                resolve({ buffer, hash });
            });
            doc.on('error', reject);

            // Header su ogni pagina
            drawHeader(doc);
            doc.on('pageAdded', () => drawHeader(doc));

            // -------- Intestazione titolare --------
            drawSectionTitle(doc, '1. Titolare del trattamento');
            drawParagraph(doc,
                `Il titolare del trattamento dei dati personali raccolti tramite il presente modulo è ${TITOLARE.ragioneSociale}, ` +
                `con sede legale in ${TITOLARE.sedeLegale}, P.IVA ${TITOLARE.piva}.`);
            drawParagraph(doc,
                `Recapiti per esercitare i propri diritti o ricevere chiarimenti sul trattamento dei dati: ` +
                `email ${TITOLARE.emailContatto} - PEC ${TITOLARE.pec}.`);
            drawParagraph(doc,
                `Le richieste in materia di protezione dei dati possono essere inviate agli stessi recapiti. Qualora venga designato ` +
                `un Responsabile della Protezione dei Dati, i relativi recapiti saranno pubblicati e comunicati ` +
                `agli interessati secondo la normativa applicabile.`);
            drawParagraph(doc,
                `La presente informativa riguarda esclusivamente l'acquisizione, l'archiviazione e l'utilizzo dei dati ` +
                `nel CRM Mirox, sistema gestionale di proprietà e sotto la gestione di ${TITOLARE.ragioneSociale}. ` +
                `Non disciplina il contratto stipulato con Wind Tre S.p.A. o con un altro fornitore, né sostituisce ` +
                `l'informativa privacy resa da tale soggetto per i trattamenti di propria competenza.`);

            // -------- Dati raccolti --------
            drawSectionTitle(doc, '2. Categorie di dati personali trattati');
            drawParagraph(doc, 'Il Titolare tratta le seguenti categorie di dati personali dell\'interessato:');
            drawBulletList(doc, [
                'dati anagrafici e identificativi (nome, cognome / ragione sociale, codice fiscale o partita IVA, data di nascita ove applicabile);',
                'dati di contatto (indirizzo, numero di telefono cellulare utilizzabile anche per WhatsApp, indirizzo email);',
                'copia del documento d\'identità e dati in esso contenuti, quando acquisiti per la pratica richiesta;',
                'documenti e informazioni necessari alla specifica pratica o contratto richiesto, quali proposta/PDA, copia SIM, dati di portabilità, bolletta, POD/PDR, IMEI, codici e stato della pratica;',
                'storico CRM di appuntamenti, interazioni, note operative, richieste di assistenza e attività post-vendita riferite alla pratica o al cliente;',
                'dati tecnici e probatori del flusso privacy (data e ora, indirizzo IP dell\'operatore, user agent, identificativo SMS, esito OTP e hash del documento).'
            ]);
            drawParagraph(doc,
                'I dati e i documenti sono raccolti principalmente presso l\'interessato durante l\'attività in negozio. ' +
                'Gli aggiornamenti sullo stato della specifica pratica possono provenire dal fornitore presso il quale ' +
                'il contratto è stato richiesto e vengono registrati nel CRM per l\'assistenza al cliente.');

            // -------- Finalita' --------
            drawSectionTitle(doc, '3. Finalità del trattamento e base giuridica');
            drawParagraph(doc, 'I dati personali sono trattati per le finalità di seguito indicate:');
            drawBulletList(doc, [
                'a) acquisire, registrare, organizzare e archiviare nel CRM Mirox i dati e i documenti consegnati per la specifica pratica richiesta, associandoli al cliente e mantenendo uno storico operativo - basi giuridiche: esecuzione di misure e attività richieste dall\'interessato e legittimo interesse del Titolare a organizzare e documentare correttamente l\'assistenza, art. 6, par. 1, lett. b) e f) GDPR;',
                'b) ricontattare il cliente tramite chiamata telefonica, messaggio WhatsApp o email esclusivamente per aggiornamenti e assistenza sulla specifica pratica o sul relativo contratto, ad esempio documenti mancanti, stato di attivazione, anomalie e richieste post-vendita - basi giuridiche: attività richieste dall\'interessato e legittimo interesse alla corretta assistenza, art. 6, par. 1, lett. b) e f) GDPR. Questi contatti di servizio non dipendono dal consenso marketing;',
                'c) adempiere obblighi di legge, proteggere il CRM, prevenire abusi, garantire integrità e tracciabilità delle operazioni ed esercitare o difendere diritti - basi giuridiche: art. 6, par. 1, lett. c) e f) GDPR;',
                'd) con il consenso facoltativo dell\'interessato, ricontattarlo tramite chiamata telefonica con operatore, messaggio WhatsApp o email per proporre nuove offerte, promozioni, servizi o nuovi contratti, anche diversi e ulteriori rispetto alla pratica originaria - base giuridica: consenso, art. 6, par. 1, lett. a) GDPR e art. 130 del Codice Privacy.'
            ]);
            drawParagraph(doc,
                'Quando una comunicazione relativa alla pratica contiene anche una proposta commerciale nuova o ulteriore, ' +
                'la relativa componente promozionale viene effettuata soltanto se è stato prestato il consenso di cui al punto 3.d.');

            // -------- Modalita' --------
            doc.addPage();
            drawSectionTitle(doc, '4. Modalità del trattamento');
            drawParagraph(doc,
                'I dati sono trattati prevalentemente con strumenti elettronici tramite il CRM Mirox e servizi cloud, ' +
                'con misure tecniche e organizzative adeguate al rischio ai sensi dell\'art. 32 GDPR. L\'accesso è ' +
                'limitato al personale autorizzato e ai fornitori che ne abbiano necessità per le attività affidate.');
            drawParagraph(doc,
                'Per agevolare l\'inserimento nel CRM dei dati presenti nei documenti consegnati può essere utilizzato ' +
                'un servizio di intelligenza artificiale fornito da Anthropic. Il documento è analizzato per estrarre ' +
                'i campi da riportare nel CRM; il risultato è verificato dall\'operatore. L\'OCR non assume decisioni ' +
                'sull\'interessato e non produce effetti giuridici o analogamente significativi senza intervento umano.');

            // -------- Comunicazione a terzi --------
            drawSectionTitle(doc, '5. Comunicazione e destinatari dei dati');
            drawParagraph(doc,
                'Nell\'ambito del CRM i dati sono accessibili al personale autorizzato di Kona Tech e, nei limiti ' +
                'necessari, ai fornitori di hosting, database, posta elettronica, SMS/OTP, assistenza informatica e ' +
                'intelligenza artificiale, normalmente nominati responsabili del trattamento ai sensi dell\'art. 28 GDPR; ' +
                'possono inoltre essere comunicati a consulenti, autorità e soggetti legittimati dalla legge.');
            drawParagraph(doc,
                'Quando necessario per inoltrare o completare la richiesta del cliente, dati e documenti possono essere ' +
                'trasmessi a Wind Tre S.p.A. o al diverso fornitore scelto. I trattamenti successivamente svolti da tale ' +
                'soggetto secondo il proprio ruolo non rientrano nella presente informativa e sono regolati dalla relativa informativa privacy.');
            drawParagraph(doc,
                'I dati non sono diffusi. Alcuni fornitori tecnologici possono trattare dati anche fuori dallo Spazio ' +
                'Economico Europeo. In tali casi il trasferimento avviene nel rispetto del Capo V GDPR, sulla base di ' +
                'una decisione di adeguatezza, clausole contrattuali standard o altra garanzia applicabile, con eventuali ' +
                'misure supplementari. Informazioni sulle garanzie possono essere richieste ai recapiti del punto 1.');

            // -------- Conservazione --------
            drawSectionTitle(doc, '6. Periodo di conservazione');
            drawBulletList(doc, [
                'dati, documenti e storico della pratica nel CRM: per il tempo necessario a gestire la richiesta, fornire assistenza e tutelare i diritti del Titolare e dell\'interessato; di regola non oltre 10 anni dalla chiusura dell\'ultima pratica, salvo un diverso obbligo di legge o contenzioso;',
                'dati usati per marketing diretto: 24 mesi dalla raccolta del consenso, salvo revoca anticipata o nuovo consenso;',
                'prova dell\'informativa, del consenso marketing, della revoca e relativi log: per il tempo necessario a dimostrare la conformità e tutelare i diritti, di regola non oltre 10 anni dall\'ultima operazione rilevante;',
                'log tecnici di sicurezza: per il periodo proporzionato alla finalità e, di regola, non oltre 12 mesi, salvo necessità di accertare incidenti o illeciti.'
            ]);

            // -------- Diritti --------
            drawSectionTitle(doc, '7. Diritti dell\'interessato');
            drawParagraph(doc,
                'L\'interessato può esercitare in ogni momento, scrivendo ai recapiti indicati al punto 1, i diritti riconosciuti dagli artt. 15-22 del GDPR:');
            drawBulletList(doc, [
                'diritto di accesso ai propri dati personali (art. 15);',
                'diritto di rettifica dei dati inesatti (art. 16);',
                'diritto alla cancellazione dei dati ("diritto all\'oblio", art. 17), nei limiti consentiti dagli obblighi di conservazione;',
                'diritto alla limitazione del trattamento (art. 18);',
                'diritto alla portabilità dei dati (art. 20);',
                'diritto di opposizione ai trattamenti fondati sul legittimo interesse e, in ogni momento, al marketing diretto (art. 21);',
                'diritto di revocare in qualsiasi momento il consenso marketing, anche limitatamente a uno o più canali, con la stessa facilità con cui è stato prestato, senza pregiudicare la liceità del trattamento precedente.'
            ]);
            drawParagraph(doc,
                'L\'interessato ha inoltre diritto di proporre reclamo al Garante per la Protezione dei Dati Personali (www.garanteprivacy.it) qualora ritenga che il trattamento dei propri dati personali avvenga in violazione della normativa applicabile.');

            // -------- Natura conferimento --------
            drawSectionTitle(doc, '8. Natura del conferimento dei dati');
            drawParagraph(doc,
                'Il conferimento dei dati e dei documenti necessari a registrare e gestire la specifica pratica nel CRM ' +
                'è richiesto per le attività domandate a Kona Tech; in mancanza, il Titolare potrebbe non poter gestire ' +
                'la pratica tramite il proprio CRM o fornire la relativa assistenza. Il contratto con Wind Tre S.p.A. o ' +
                'con altro fornitore resta soggetto alle condizioni e alle decisioni di tale soggetto. ' +
                'La presa visione dell\'informativa documenta che l\'interessato ha ricevuto queste informazioni, ma ' +
                'non trasforma il consenso nella base giuridica dei trattamenti CRM necessari. Il consenso marketing è ' +
                'facoltativo: negarlo o revocarlo non impedisce l\'assistenza sulla pratica specifica.');

            // -------- Dati interessato --------
            doc.addPage();
            drawSectionTitle(doc, '9. Dati dell\'interessato');
            const isBusiness = String(a.cluster || '').toLowerCase() === 'business';
            const labelCfPiva = isBusiness ? 'Partita IVA' : 'Codice fiscale';
            const labelRagSoc = isBusiness ? 'Ragione sociale' : 'Nome e cognome';

            const dataRows = [
                [labelRagSoc, safeText(a.ragione_sociale)],
                [labelCfPiva, safeText(a.cf_piva)],
                ['Tipologia cliente', safeText(a.cluster)],
                ['Persona di riferimento', safeText(a.nome_referente)],
                ['Indirizzo', buildIndirizzo(a)],
                ['Cellulare', safeText(a.cellulare)],
                ['Email', safeText(a.email)],
                ['Data informativa/dichiarazione', formatItalianDate(dataCompilazione)]
            ];
            const left = doc.page.margins.left;
            const right = doc.page.width - doc.page.margins.right;
            const colLabelW = 160;
            let rowY = doc.y;
            doc.fontSize(9.5);
            dataRows.forEach(([k, v]) => {
                doc.lineWidth(0.5).strokeColor(COL_BORDER);
                doc.rect(left, rowY, colLabelW, 22).stroke();
                doc.rect(left + colLabelW, rowY, right - left - colLabelW, 22).stroke();
                doc.fillColor(COL_MUTED).font('Helvetica-Bold').text(k, left + 6, rowY + 6, { width: colLabelW - 12 });
                doc.fillColor(COL_TEXT).font('Helvetica').text(v, left + colLabelW + 6, rowY + 6, { width: right - left - colLabelW - 12 });
                rowY += 22;
            });
            doc.y = rowY + 10;
            doc.x = left;

            // -------- Dichiarazioni e consenso --------
            drawSectionTitle(doc, '10. Presa visione e consenso facoltativo');
            doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);

            let cy = doc.y + 2;
            drawCheckRow(doc, left, cy, consensoContratto,
                'Dichiaro di aver ricevuto e preso visione dell\'informativa resa ai sensi degli artt. 13 e 14 GDPR. ' +
                'Prendo atto che Kona Tech acquisisce e archivia nel proprio CRM Mirox i miei dati e i documenti ' +
                'necessari alla specifica pratica e potrà contattarmi tramite chiamata, WhatsApp o email per aggiornamenti ' +
                'e assistenza riferiti a tale pratica o al relativo contratto. Questi trattamenti si fondano sulle basi ' +
                'giuridiche indicate al punto 3 e non sul consenso marketing. ' +
                'PRESA VISIONE DELL\'INFORMATIVA.',
                { width: right - left - 22 });
            cy = doc.y + 12;
            doc.y = cy;

            drawCheckRow(doc, left, cy, consensoMarketing,
                'Acconsento a essere ricontattato da Kona Tech, utilizzando i dati presenti nel CRM, tramite chiamata ' +
                'telefonica con operatore, messaggio WhatsApp o email per ricevere proposte su nuove offerte, promozioni, ' +
                'servizi o nuovi contratti, anche diversi e ulteriori rispetto alla pratica originaria (punto 3.d), ' +
                'per un massimo di 24 mesi. Posso revocare il consenso in ogni momento, anche per singolo canale. ' +
                'CONSENSO FACOLTATIVO.',
                { width: right - left - 22 });

            doc.y = doc.y + 18;

            // -------- Firma --------
            drawSectionTitle(doc, '11. Modalità di registrazione della dichiarazione');

            if (modalita === 'otp_sms') {
                const firmaBoxY = doc.y;
                const firmaBoxH = 142;
                doc.lineWidth(1).strokeColor(COL_GREEN);
                doc.rect(left, firmaBoxY, right - left, firmaBoxH).stroke();
                doc.fillColor(COL_GREEN).font('Helvetica-Bold').fontSize(10);
                doc.text('Dichiarazione registrata elettronicamente tramite OTP via SMS', left + 12, firmaBoxY + 10, { width: right - left - 24 });
                doc.fillColor(COL_TEXT).font('Helvetica').fontSize(8.5);

                const metaY = firmaBoxY + 28;
                const linesL = [
                    'Cellulare destinatario OTP:  ' + safeText(otpMd.cellulareInviato, '-'),
                    'Data e ora conferma OTP:    ' + formatItalianDateTime(otpMd.confermatoAt),
                    'ID messaggio SMS:           ' + safeText(otpMd.smsProviderId, '-')
                ];
                const linesR = [
                    'Operatore Mirox:    ' + safeText(otpMd.operatoreNome, '-'),
                    'IP operatore:       ' + safeText(otpMd.ipOperatore, '-'),
                    'ID consenso:        ' + safeText(otpMd.consensoId, '-')
                ];
                let ly = metaY;
                linesL.forEach((t) => { doc.text(t, left + 12, ly, { width: (right - left) / 2 - 12 }); ly += 14; });
                ly = metaY;
                linesR.forEach((t) => { doc.text(t, left + (right - left) / 2 + 4, ly, { width: (right - left) / 2 - 12 }); ly += 14; });

                doc.fillColor(COL_MUTED).fontSize(8);
                doc.text(
                    'Il codice OTP, inviato al recapito indicato e verificato nel CRM, registra la dichiarazione e i ' +
                    'relativi dati probatori. Ai sensi dell\'art. 25, par. 1, del Regolamento (UE) n. 910/2014 (eIDAS), ' +
                    'una firma elettronica non può essere privata di effetti giuridici o ammissibilità come prova per ' +
                    'il solo fatto della forma elettronica. Questa procedura non è una firma elettronica qualificata ' +
                    'e non equivale automaticamente a una firma autografa.',
                    left + 12, firmaBoxY + firmaBoxH - 50,
                    { width: right - left - 24, align: 'justify' });
                doc.y = firmaBoxY + firmaBoxH + 14;
            } else {
                // Cartaceo: riquadro vuoto + istruzioni
                doc.fillColor(COL_TEXT).font('Helvetica').fontSize(9.5);
                doc.text(
                    'Il presente modulo viene sottoscritto in forma cartacea. L\'interessato appone la propria firma ' +
                    'autografa nello spazio sottostante. Il documento firmato viene successivamente acquisito in formato ' +
                    'elettronico (scansione PDF) e archiviato nel sistema gestionale del Titolare.',
                    { align: 'justify', lineGap: 1.5 });
                doc.moveDown(0.5);

                const firmaBoxY = doc.y;
                const firmaBoxH = 110;
                doc.lineWidth(0.8).strokeColor(COL_BORDER);
                doc.rect(left, firmaBoxY, right - left, firmaBoxH).stroke();
                doc.fillColor(COL_MUTED).font('Helvetica').fontSize(8);
                doc.text('Firma leggibile dell\'interessato', left + 12, firmaBoxY + 8);
                doc.text('Luogo e data: ____________________________________', left + 12, firmaBoxY + firmaBoxH - 24);
                doc.y = firmaBoxY + firmaBoxH + 14;
            }

            // -------- Footer su tutte le pagine --------
            // Calcoliamo l'hash del documento "preliminare" basato sui dati invariati;
            // l'hash finale del PDF e' restituito a chi chiama (per salvarlo su DB).
            // Qui mettiamo solo la versione informativa.
            const range = doc.bufferedPageRange();
            for (let i = 0; i < range.count; i += 1) {
                doc.switchToPage(range.start + i);
                drawFooter(doc, { informativaVersione, pageNumber: i + 1 });
            }

            doc.end();
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    generateConsensoPdf,
    INFORMATIVA_VERSIONE,
    TITOLARE
};
