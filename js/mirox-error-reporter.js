/**
 * Mirox Error Reporter — client helper.
 * Esposto come window.MiroxErrorReporter.
 *
 * Scopo: ogni errore tecnico nel CRM (rete, OCR, submit, JS non gestiti...)
 * viene formattato con orario preciso Europe/Rome e segnalato via email
 * al proprietario del CRM, cosi' da avere visibilita' real-time sui problemi.
 *
 * API:
 *
 *   MiroxErrorReporter.now()
 *     -> { iso, date, time, formatted } (timezone Europe/Rome, sempre con secondi)
 *
 *   MiroxErrorReporter.report({
 *     source: 'upload-contratti-vendita',  // pagina/funzione che ha generato l'errore
 *     level:  'critical' | 'error' | 'warning' | 'info', // default 'error'
 *     title:  'Errore upload PDA',         // sintetico, va anche nel subject
 *     message: 'Il server ha risposto 500',// messaggio user-facing
 *     technical: stackTrace || jsonDebug,  // dettagli per chi indaga
 *     context: { praticaId, cf_piva, ... },// extra (oggetto serializzabile)
 *     silent: true                         // se true non logga su console.error
 *   })
 *     -> Promise<{ok:true}> oppure {ok:false, reason}
 *     Throttling: stesso fingerprint -> max 1 mail / 60 secondi.
 *
 *   MiroxErrorReporter.install({ source, ownerEmail })
 *     Aggancia window.error e unhandledrejection. Da chiamare 1 volta al boot
 *     della pagina (idempotente). I global handlers usano level='error' e
 *     non aprono popup: passano solo per la mail.
 *
 *   MiroxErrorReporter.classify(input)
 *     -> { what, where, action, tellClaude }
 *     Ritorna la traduzione dell'errore in italiano semplice (usata dalla mail
 *     per il blocco "Cosa e' successo"). Esposta pubblicamente per test manuali
 *     o per riutilizzo in altre UI (es. popup diagnostica).
 *
 * Destinatario: mirko.piasenti@gmail.com (override via install({ownerEmail:...})).
 *
 * Struttura della mail generata (dall'alto verso il basso):
 *   1) Titolo (rosso)
 *   2) Blocco "Cosa e' successo" — spiegazione non tecnica in 4 righe
 *      (In poche parole / Dove-quando / Cosa fare adesso / Cosa dire a Claude)
 *   3) Messaggio originale
 *   4) Metadata (data/ora, livello, sorgente, utente, pagina, browser)
 *   5) Dettagli tecnici (stack) + Contesto (JSON) per debug tecnico
 *
 * Dipendenze opzionali:
 *   - window.MiroxApi.fetch   -> per iniettare Authorization Bearer (preferito)
 *   - sessionStorage          -> per throttling (fallback memoria in-process)
 */

(function (window) {
    'use strict';

    var DEFAULT_OWNER_EMAIL = 'mirko.piasenti@gmail.com';
    var ENDPOINT = '/.netlify/functions/mirox-send-email';
    var THROTTLE_TTL_MS = 60 * 1000;
    var THROTTLE_KEY_PREFIX = 'mirox_err_throttle_';

    var state = {
        installed: false,
        source: 'mirox',
        ownerEmail: DEFAULT_OWNER_EMAIL,
        inMemoryThrottle: {} // fallback se sessionStorage non disponibile
    };

    // --- Timestamp Europe/Rome ----------------------------------------------

    function pad(n) { return String(n).padStart(2, '0'); }

    function now() {
        var d = new Date();
        var iso = d.toISOString();
        try {
            var fmt = new Intl.DateTimeFormat('it-IT', {
                timeZone: 'Europe/Rome',
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                hour12: false
            });
            var parts = fmt.formatToParts(d);
            var get = function (t) {
                var p = parts.find(function (x) { return x.type === t; });
                return p ? p.value : '';
            };
            var date = get('day') + '/' + get('month') + '/' + get('year');
            var time = get('hour') + ':' + get('minute') + ':' + get('second');
            return { iso: iso, date: date, time: time, formatted: date + ' ' + time };
        } catch (e) {
            var date2 = pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear();
            var time2 = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
            return { iso: iso, date: date2, time: time2, formatted: date2 + ' ' + time2 };
        }
    }

    // --- Throttling ---------------------------------------------------------

    function fingerprint(source, level, title, message) {
        var s = String(source || '') + '|' + String(level || '') + '|' +
                String(title || '').slice(0, 80) + '|' +
                String(message || '').slice(0, 120);
        var h = 0;
        for (var i = 0; i < s.length; i += 1) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h |= 0;
        }
        return 'fp_' + (h < 0 ? 'n' + (-h) : h);
    }

    function readThrottle(key) {
        try {
            var raw = sessionStorage.getItem(THROTTLE_KEY_PREFIX + key);
            return raw ? parseInt(raw, 10) : 0;
        } catch (e) {
            return state.inMemoryThrottle[key] || 0;
        }
    }

    function writeThrottle(key, ts) {
        try {
            sessionStorage.setItem(THROTTLE_KEY_PREFIX + key, String(ts));
        } catch (e) {
            state.inMemoryThrottle[key] = ts;
        }
    }

    function shouldSendNow(fp) {
        var last = readThrottle(fp);
        var ts = Date.now();
        if (last && (ts - last) < THROTTLE_TTL_MS) return false;
        writeThrottle(fp, ts);
        return true;
    }

    // --- HTML helpers -------------------------------------------------------

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // --- Classificazione errore in linguaggio non-tecnico -------------------
    //
    // Scopo: tradurre l'errore in una spiegazione capibile per il proprietario
    // del CRM (non tecnico). L'output ha 4 campi:
    //   - what:       cosa e' successo, in italiano semplice
    //   - where:      dove/quando probabilmente e' successo (contesto operativo)
    //   - action:     cosa fare adesso (azione immediata per proprietario o operatore)
    //   - tellClaude: frase pronta da girare a Claude per un fix futuro
    //
    // Ordine importante: pattern piu' specifici prima (error_code strutturato),
    // poi codici HTTP, poi keyword generiche, infine fallback.

    function getErrorCode(input) {
        if (!input || !input.context) return '';
        var ec = input.context.error_code || input.context.errorCode || '';
        return String(ec || '').toLowerCase();
    }

    function getHttpStatus(input) {
        if (!input) return 0;
        var ctx = input.context || {};
        var s = ctx.http_status || ctx.httpStatus || ctx.status || 0;
        if (s && !isNaN(Number(s))) return Number(s);
        // Prova a estrarre dal testo (message/technical) un pattern "HTTP 500" / "status 401"
        var hay = String((input.message || '') + ' ' + (input.technical || ''));
        var m = hay.match(/(?:HTTP|status|response)\s*[:=]?\s*(\d{3})/i);
        if (m) return Number(m[1]);
        return 0;
    }

    function buildHaystack(input) {
        var ctxStr = '';
        try { ctxStr = input.context ? JSON.stringify(input.context) : ''; }
        catch (e) { ctxStr = ''; }
        return [
            String(input.title || ''),
            String(input.message || ''),
            String(input.technical || ''),
            ctxStr,
            String(input.source || '')
        ].join(' \n ');
    }

    var SOURCE_LABELS = {
        'upload-contratti-vendita': 'wizard di caricamento contratti (Vendita)',
        'dashboard': 'dashboard principale',
        'dashboard_pezzi': 'dashboard "Pezzi venduti"',
        'verifica_contratti': 'pagina Verifica Contratti',
        'controllo_fissi': 'pagina Controllo Fissi (post-vendita)',
        'controllo_lg': 'pagina Controllo L&G (post-vendita Energia)',
        'controllo_allarmi': 'pagina Controllo Allarmi (post-vendita)',
        'controllo_assicurazioni': 'pagina Controllo Assicurazioni (post-vendita)',
        'apri_chiudi': 'modulo Apri/Chiudi',
        'switch_sim': 'modulo Switch SIM',
        'ordini_smartphone': 'modulo Ordini Smartphone',
        'simulatore_protecta': 'simulatore Protecta',
        'dispositivi_comodato': 'modulo Dispositivi in Comodato',
        'gestione_rimborsi': 'modulo Gestione Rimborsi',
        'storico_cliente': 'storico cliente',
        'ticket': 'ticket',
        'admin': 'pannello Admin',
        'admin-utenti': 'gestione utenti (Admin)',
        'admin-vendita-config': 'catalogo Vendita (Admin)',
        'admin-call-center-config': 'configurazione Call Center (Admin)',
        'registra-chiamata': 'registrazione chiamata (Call Center)',
        'registra-chiamata-outbound': 'registrazione chiamata outbound (Call Center)',
        'elenco-chiamate': 'elenco chiamate (Call Center)',
        'rilavorazione': 'rilavorazione ricontatti (Call Center)',
        'call-center-lead-outbound': 'lead outbound (Call Center)',
        'appuntamenti': 'appuntamenti (Call Center)',
        'appuntamenti-oggi': 'appuntamenti di oggi (Call Center)',
        'esiti-appuntamenti': 'esiti appuntamenti (Call Center)',
        'prenota-interno': 'prenotazione interna (Call Center)',
        'prenota-interno-outbound': 'prenotazione interna outbound (Call Center)',
        'blacklist': 'blacklist (Call Center)'
    };

    function labelForSource(source) {
        if (!source) return 'una pagina del CRM';
        var key = String(source).toLowerCase();
        if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
        // Prova senza suffissi / prefissi
        var cleaned = key.replace(/^mirox[-_]?/, '').replace(/[-_]/g, ' ');
        return 'la pagina "' + cleaned + '"';
    }

    function classify(input) {
        var code = getErrorCode(input);
        var status = getHttpStatus(input);
        var hay = buildHaystack(input);
        var lo = hay.toLowerCase();
        var sourceLabel = labelForSource(input.source);

        // 1) Error code strutturato (OCR ha codici ben definiti)
        if (code === 'ocr_credit_exhausted') {
            return {
                what: 'Il servizio di lettura automatica del PDA (AI) e\' fermo perche\' il credito Anthropic e\' esaurito.',
                where: 'Un operatore ha caricato un PDA in ' + sourceLabel + ' e ha cliccato "Analizza con AI".',
                action: 'Ricarica il credito su console.anthropic.com. Nel frattempo l\'operatore puo\' completare la pratica cliccando "Continua senza AI" e compilando i dati a mano.',
                tellClaude: 'Il credito Anthropic e\' esaurito, l\'OCR del PDA non funziona finche\' non ricarichi il saldo.'
            };
        }
        if (code === 'ocr_rate_limited') {
            return {
                what: 'Troppe richieste OCR in poco tempo: Anthropic ha temporaneamente bloccato le chiamate.',
                where: 'OCR di un PDA in ' + sourceLabel + '. Puo\' capitare se piu\' operatori premono "Analizza con AI" contemporaneamente.',
                action: 'Aspetta 1-2 minuti e riprova. Se ricapita spesso, valuta un upgrade del piano Anthropic o attiva il fallback "Continua senza AI".',
                tellClaude: 'OCR rate-limited (429 da Anthropic), succede quando ci sono chiamate contemporanee.'
            };
        }
        if (code === 'ocr_unavailable') {
            return {
                what: 'Il servizio Anthropic (che legge i PDA) e\' momentaneamente irrangiungibile.',
                where: 'OCR di un PDA in ' + sourceLabel + '.',
                action: 'Riprova tra qualche minuto. L\'operatore puo\' usare "Continua senza AI" per non bloccare la pratica.',
                tellClaude: 'OCR non disponibile (5xx da Anthropic), disservizio lato provider.'
            };
        }
        if (code === 'ocr_auth_error') {
            return {
                what: 'La chiave di accesso a Anthropic (ANTHROPIC_API_KEY) non e\' piu\' valida.',
                where: 'La function Netlify "ocr-pda" ha chiamato Anthropic e ha ricevuto 401/403.',
                action: 'Vai su Netlify (site "mirox-crm") -> Environment variables e verifica/aggiorna ANTHROPIC_API_KEY. Poi rilascia (Deploys -> Trigger deploy).',
                tellClaude: 'ANTHROPIC_API_KEY non valida su Netlify, va rigenerata e sostituita.'
            };
        }
        if (code === 'ocr_generic_error') {
            return {
                what: 'C\'e\' stato un problema generico durante l\'analisi automatica del PDA.',
                where: 'Function Netlify "ocr-pda".',
                action: 'Controlla i log su Netlify (Functions -> ocr-pda -> ultimo invocation) per capire cosa e\' fallito. L\'operatore intanto usa "Continua senza AI".',
                tellClaude: 'OCR fallito con generic error, servono i log di Netlify per la function ocr-pda.'
            };
        }

        // 2) HTTP status
        if (status === 401 || status === 403 || /\b(401|403)\b|unauthorized|forbidden/i.test(lo)) {
            return {
                what: 'La sessione dell\'operatore e\' scaduta oppure non ha i permessi per l\'azione richiesta.',
                where: 'L\'operatore ha tentato un\'azione in ' + sourceLabel + ' (submit pratica, upload documento, o accesso ad Admin).',
                action: 'L\'operatore deve fare logout e rientrare. Se succede spesso a piu\' persone, il sistema di refresh automatico del token potrebbe avere un problema.',
                tellClaude: 'Errore ' + (status || 'auth') + ' su chiamata al backend: probabile JWT scaduto o permesso mancante in ' + (input.source || 'pagina') + '.'
            };
        }
        if (status === 404 || /\b404\b|not found/i.test(lo)) {
            return {
                what: 'Il codice ha chiesto una risorsa (pagina o dato) che non esiste sul server.',
                where: 'Chiamata partita da ' + sourceLabel + '. Puo\' essere un link vecchio, un id sbagliato o una function non ancora rilasciata.',
                action: 'Segnala a Claude con la pagina e (se presente) l\'id nella sezione Contesto qui sotto.',
                tellClaude: 'Errore 404 su ' + (input.source || 'pagina') + ', risorsa richiesta non trovata (vedi dettagli tecnici nella mail).'
            };
        }
        if (status === 413 || /\b413\b|payload too large|entity too large/i.test(lo)) {
            return {
                what: 'Il file che stavi caricando e\' troppo grande.',
                where: 'Upload PDF (PDA, documento identita\', scansione consenso, ecc.) in ' + sourceLabel + '.',
                action: 'Chiedi all\'operatore di ridurre la dimensione del PDF (max 20 MB). Se il limite serve piu\' alto, segnalalo a Claude.',
                tellClaude: 'Upload rifiutato per dimensione oltre 20 MB in ' + (input.source || 'pagina') + '.'
            };
        }
        if (status === 429 || /\b429\b|too many requests/i.test(lo)) {
            return {
                what: 'Troppe richieste in poco tempo: il server ha temporaneamente rallentato o bloccato.',
                where: 'Chiamata dal ' + sourceLabel + '. Spesso e\' un rate-limit di un servizio esterno (SMS, OCR).',
                action: 'Aspetta un minuto e riprova.',
                tellClaude: 'Rate-limit 429 su ' + (input.source || 'pagina') + '.'
            };
        }
        if (status >= 500 && status < 600) {
            return {
                what: 'Il server ha risposto con un errore interno (' + status + '). Il codice sul server e\' andato in eccezione.',
                where: 'Chiamata dal ' + sourceLabel + ' verso una function Netlify.',
                action: 'Controlla i log su Netlify (Functions -> quella coinvolta -> ultimo invocation). Segnala a Claude con l\'orario esatto (vedi tabella sotto).',
                tellClaude: 'Errore ' + status + ' da Netlify function chiamata da ' + (input.source || 'pagina') + ', servono i log Netlify.'
            };
        }
        if (/http\s*5\d\d|internal server error|bad gateway|gateway timeout/i.test(lo)) {
            return {
                what: 'Il server ha risposto con un errore interno (5xx).',
                where: 'Chiamata dal ' + sourceLabel + ' verso una function Netlify.',
                action: 'Controlla i log su Netlify della function coinvolta.',
                tellClaude: 'Errore 5xx da Netlify function chiamata da ' + (input.source || 'pagina') + '.'
            };
        }

        // 3) Keyword pattern
        if (/failed to fetch|network\s*error|networkerror|net::err|typeerror.*fetch|load failed/i.test(lo)) {
            return {
                what: 'Problema di rete: il browser non e\' riuscito a raggiungere il server.',
                where: 'L\'operatore in ' + sourceLabel + ' ha perso momentaneamente la connessione oppure Netlify era irrangiungibile.',
                action: 'Chiedi all\'operatore di verificare la connessione (wifi/dati) e riprovare. Se piu\' operatori riportano lo stesso, controlla lo status di Netlify.',
                tellClaude: 'Errore di rete su ' + (input.source || 'pagina') + ', fetch non riuscito.'
            };
        }
        if (/timeout|timed out|aborterror|abortcontroller/i.test(lo)) {
            return {
                what: 'La richiesta ha impiegato troppo tempo ed e\' stata annullata (timeout).',
                where: 'In ' + sourceLabel + '. Tipico su upload grandi o quando un servizio esterno e\' lento (OCR, SMS).',
                action: 'Riprovare. Se ricapita su file grandi, valuta di ridurre la dimensione del PDF.',
                tellClaude: 'Timeout su richiesta in ' + (input.source || 'pagina') + '.'
            };
        }
        if (/\brls\b|row.?level|permission denied|policy .* violat|pgrst|postgrest|rpc .*error/i.test(lo)) {
            return {
                what: 'Il database ha rifiutato un\'operazione per motivi di permessi (regole RLS).',
                where: 'Il codice in ' + sourceLabel + ' ha provato a leggere/scrivere una tabella senza autorizzazione, o senza un JWT valido.',
                action: 'Segnalalo a Claude: probabile che manchi una policy o che una chiamata bypassi MiroxApi.fetch (JWT non iniettato).',
                tellClaude: 'Errore RLS/PostgREST su ' + (input.source || 'pagina') + ', da capire quale query e con quale ruolo.'
            };
        }
        if (/consenso privacy|consenso.*scaduto|consenso.*mancante|informativa privacy.*(?:mancante|scaduta)/i.test(lo)) {
            return {
                what: 'Il cliente non ha un documento privacy valido: la pratica e\' stata bloccata.',
                where: 'Submit pratica in ' + sourceLabel + '. Puo\' essere informativa mai raccolta, scaduta (24 mesi) o revocata.',
                action: 'L\'operatore deve rifare il pre-step "Consenso privacy" (OTP via SMS o modulo cartaceo) prima di reinviare la pratica.',
                tellClaude: 'Submit pratica bloccato per informativa privacy assente/scaduta.'
            };
        }
        if (/smshosting|sms.*failed|otp.*invalid|otp.*scad|cellulare.*non valido/i.test(lo)) {
            return {
                what: 'C\'e\' stato un problema con l\'invio o la verifica dell\'OTP via SMS.',
                where: 'Flusso Consenso Privacy in ' + sourceLabel + '.',
                action: 'Verifica il credito Smshosting e le env vars SMSHOSTING_API_KEY / SMSHOSTING_API_SECRET su Netlify. L\'operatore puo\' usare il modulo cartaceo come fallback.',
                tellClaude: 'Smshosting/OTP fallito in ' + (input.source || 'pagina') + ', dettagli nella technical.'
            };
        }
        if (/cannot read propert|is not defined|is not a function|undefined is not/i.test(lo)) {
            return {
                what: 'Bug JavaScript: una parte del codice ha provato a usare qualcosa che non c\'era.',
                where: 'Errore imprevisto in ' + sourceLabel + '. L\'operatore probabilmente vede un popup o una schermata bloccata.',
                action: 'Segnalalo a Claude con la pagina esatta e cosa stava facendo l\'operatore. I dettagli tecnici sotto (stack trace) mi bastano per capire.',
                tellClaude: 'Eccezione JS non gestita in ' + (input.source || 'pagina') + ' (vedi stack nella mail).'
            };
        }
        if (/promise .*reject|unhandledrejection/i.test(lo)) {
            return {
                what: 'Una richiesta in background e\' fallita e nessuno l\'ha gestita.',
                where: 'In ' + sourceLabel + '. Puo\' essere una fetch caduta o una promise andata in errore.',
                action: 'Segnalalo a Claude: va probabilmente aggiunto un catch/gestione errore mirato.',
                tellClaude: 'Promise non gestita in ' + (input.source || 'pagina') + '.'
            };
        }
        if (/quotaexceedederror|storage.*full|localstorage/i.test(lo)) {
            return {
                what: 'La memoria del browser (localStorage/sessionStorage) e\' piena.',
                where: 'In ' + sourceLabel + '. Puo\' capitare su PC molto vecchi o dopo mesi di uso senza pulizia.',
                action: 'Chiedi all\'operatore di svuotare la cache del browser e riprovare.',
                tellClaude: 'Quota storage browser esaurita in ' + (input.source || 'pagina') + '.'
            };
        }

        // 4) Fallback generico
        return {
            what: 'C\'e\' stato un errore inatteso nel CRM che il sistema non e\' riuscito a classificare automaticamente.',
            where: 'In ' + sourceLabel + '. Guarda i dettagli tecnici sotto (stack trace + contesto) per capire dove esattamente.',
            action: 'Se l\'errore si ripete o blocca il lavoro dell\'operatore, girami questa mail intera (con "Cosa dire a Claude" qui sotto).',
            tellClaude: 'Errore non classificato in ' + (input.source || 'pagina') + ': titolo "' + (input.title || '') + '", messaggio "' + (input.message || '') + '". Serve controllare stack e contesto.'
        };
    }

    function buildExplanationBlock(explanation) {
        // Blocco "Cosa e' successo" — la sezione in alto pensata per chi legge
        // senza background tecnico. Ogni riga ha un'etichetta chiara + testo semplice.
        function row(label, value, bg, labelColor) {
            return '<tr>'
                + '<td style="padding:10px 12px;background:' + bg + ';border:1px solid #FCA5A5;font-weight:700;color:' + labelColor + ';white-space:nowrap;vertical-align:top;width:170px">'
                + escapeHtml(label)
                + '</td>'
                + '<td style="padding:10px 12px;border:1px solid #FCA5A5;background:#FFFFFF;color:#0A2540;line-height:1.5;font-size:13px">'
                + escapeHtml(value)
                + '</td>'
                + '</tr>';
        }

        return '<div style="border:2px solid #b91c1c;border-radius:8px;overflow:hidden;margin:0 0 20px">'
            + '<div style="background:#b91c1c;color:#fff;padding:10px 14px;font-size:14px;font-weight:700;letter-spacing:0.3px">'
            + 'COSA E\' SUCCESSO (in italiano semplice)'
            + '</div>'
            + '<table style="border-collapse:collapse;width:100%;font-family:Arial,Helvetica,sans-serif">'
            + row('In poche parole', explanation.what, '#FEF2F2', '#991B1B')
            + row('Dove/quando', explanation.where, '#FFF7ED', '#9A3412')
            + row('Cosa fare adesso', explanation.action, '#ECFDF5', '#065F46')
            + row('Cosa dire a Claude', explanation.tellClaude, '#EFF6FF', '#1E40AF')
            + '</table>'
            + '</div>';
    }

    function buildHtml(input) {
        var contextStr = '';
        if (input.context) {
            try { contextStr = JSON.stringify(input.context, null, 2); }
            catch (e) { contextStr = '[contesto non serializzabile: ' + (e && e.message) + ']'; }
        }
        var pageUrl = '';
        try { pageUrl = String(window.location && window.location.href || ''); } catch (e) { /* ignore */ }
        var userAgent = '';
        try { userAgent = String(navigator && navigator.userAgent || ''); } catch (e) { /* ignore */ }

        var explanation = classify(input);

        var rows = [
            ['Data/ora (Europe/Rome)', input.timestamp.formatted],
            ['Livello', String(input.level || 'error').toUpperCase()],
            ['Sorgente', input.source || '-'],
            ['Utente', input.userEmail || '-'],
            ['Pagina', pageUrl || '-'],
            ['Browser', userAgent || '-']
        ];

        var rowsHtml = rows.map(function (r) {
            return '<tr><td style="padding:6px 10px;background:#F6F9FC;border:1px solid #E3E8EE;font-weight:600;color:#697386;white-space:nowrap">'
                + escapeHtml(r[0])
                + '</td><td style="padding:6px 10px;border:1px solid #E3E8EE;color:#0A2540;word-break:break-word">'
                + escapeHtml(r[1])
                + '</td></tr>';
        }).join('');

        var sectionTechnical = input.technical
            ? '<h3 style="margin:18px 0 6px;color:#0A2540;font-size:14px">Dettagli tecnici (per Claude / Codex)</h3>'
              + '<pre style="background:#0A2540;color:#E3E8EE;padding:12px;border-radius:6px;font-size:11px;white-space:pre-wrap;word-break:break-word">'
              + escapeHtml(input.technical) + '</pre>'
            : '';

        var sectionContext = contextStr
            ? '<h3 style="margin:18px 0 6px;color:#0A2540;font-size:14px">Contesto</h3>'
              + '<pre style="background:#EEF3F8;color:#0A2540;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap;word-break:break-word">'
              + escapeHtml(contextStr) + '</pre>'
            : '';

        return '<div style="font-family:Arial,Helvetica,sans-serif;color:#0A2540;max-width:720px">'
            + '<h2 style="margin:0 0 14px;color:#b91c1c;font-size:18px">[MIROX CRM] '
            + escapeHtml(input.title || 'Errore')
            + '</h2>'
            + buildExplanationBlock(explanation)
            + '<h3 style="margin:0 0 6px;color:#0A2540;font-size:14px">Messaggio originale</h3>'
            + '<p style="margin:0 0 14px;color:#475569;font-size:13px;background:#F8FAFC;padding:10px 12px;border-left:3px solid #94A3B8;border-radius:2px">'
            + escapeHtml(input.message || '(nessun messaggio)')
            + '</p>'
            + '<h3 style="margin:0 0 6px;color:#0A2540;font-size:14px">Metadata</h3>'
            + '<table style="border-collapse:collapse;width:100%;font-size:13px">'
            + rowsHtml
            + '</table>'
            + sectionTechnical
            + sectionContext
            + '<p style="margin-top:18px;color:#94a3b8;font-size:11px">'
            + 'Notifica automatica generata dal sistema di error reporting Mirox. '
            + 'Il blocco "Cosa e\' successo" e\' una classificazione automatica basata su codici errore, status HTTP e parole chiave: potrebbe non essere sempre precisa.'
            + '</p>'
            + '</div>';
    }

    // --- Email send ---------------------------------------------------------

    function safeFetch(url, opts) {
        var fetcher = (window.MiroxApi && typeof window.MiroxApi.fetch === 'function')
            ? window.MiroxApi.fetch
            : (typeof fetch === 'function' ? fetch : null);
        if (!fetcher) return Promise.reject(new Error('fetch non disponibile'));
        return fetcher(url, opts);
    }

    function getUserEmail() {
        // Best-effort: la sessione Supabase espone email; non blocco se non riesco
        try {
            if (window.db && window.db.auth && typeof window.db.auth.getSession === 'function') {
                return window.db.auth.getSession().then(function (r) {
                    var u = r && r.data && r.data.session && r.data.session.user;
                    return (u && u.email) ? String(u.email) : '';
                }).catch(function () { return ''; });
            }
        } catch (e) { /* ignore */ }
        return Promise.resolve('');
    }

    function report(input) {
        input = input || {};
        var level = input.level || 'error';
        var title = input.title || 'Errore non specificato';
        var message = input.message || '';
        var technical = input.technical || '';
        var context = input.context || null;
        var source = input.source || state.source;
        var ownerEmail = input.to || state.ownerEmail;
        var silent = Boolean(input.silent);

        if (!silent) {
            try { console.error('[MiroxErrorReporter]', level, source, title, message, technical); }
            catch (e) { /* ignore */ }
        }

        var fp = fingerprint(source, level, title, message);
        if (!shouldSendNow(fp)) {
            return Promise.resolve({ ok: false, reason: 'throttled' });
        }

        var ts = now();

        return getUserEmail().then(function (userEmail) {
            var html = buildHtml({
                level: level,
                title: title,
                message: message,
                technical: String(technical || ''),
                context: context,
                source: source,
                userEmail: userEmail,
                timestamp: ts
            });
            var subject = '[MIROX][' + String(level).toUpperCase() + '] '
                + title + ' — ' + ts.formatted;

            var payload = {
                to: ownerEmail,
                subject: subject,
                html: html,
                related_table: 'error_report',
                related_id: source + ':' + fp
            };

            return safeFetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) {
                    if (!res.ok || data.ok === false) {
                        var err = (data && data.error) || ('HTTP ' + res.status);
                        try { console.warn('[MiroxErrorReporter] invio mail fallito:', err); }
                        catch (e) { /* ignore */ }
                        return { ok: false, reason: err };
                    }
                    return { ok: true, messageId: data.messageId };
                });
            }).catch(function (err) {
                // Mai blocca il flusso utente
                try { console.warn('[MiroxErrorReporter] invio mail eccezione:', err && err.message); }
                catch (e) { /* ignore */ }
                return { ok: false, reason: err && err.message };
            });
        });
    }

    // --- Global handlers ----------------------------------------------------

    function onWindowError(ev) {
        try {
            var msg = (ev && (ev.message || ev.error && ev.error.message)) || 'Errore JS sconosciuto';
            var stack = (ev && ev.error && ev.error.stack)
                || (ev ? (ev.filename || '') + ':' + (ev.lineno || '') + ':' + (ev.colno || '') : '');
            report({
                source: state.source,
                level: 'error',
                title: 'Errore JavaScript non gestito',
                message: String(msg),
                technical: String(stack),
                silent: true
            });
        } catch (e) { /* ignore */ }
    }

    function onUnhandledRejection(ev) {
        try {
            var reason = ev && ev.reason;
            var msg = (reason && reason.message) || String(reason || 'Promise rejected');
            var stack = (reason && reason.stack) || '';
            report({
                source: state.source,
                level: 'error',
                title: 'Promise non gestita',
                message: msg,
                technical: stack,
                silent: true
            });
        } catch (e) { /* ignore */ }
    }

    function install(opts) {
        opts = opts || {};
        if (opts.source) state.source = String(opts.source);
        if (opts.ownerEmail) state.ownerEmail = String(opts.ownerEmail);
        if (state.installed) return;
        state.installed = true;
        try {
            window.addEventListener('error', onWindowError);
            window.addEventListener('unhandledrejection', onUnhandledRejection);
        } catch (e) {
            try { console.warn('[MiroxErrorReporter] install handlers fallito:', e && e.message); }
            catch (e2) { /* ignore */ }
        }
    }

    window.MiroxErrorReporter = {
        now: now,
        report: report,
        install: install,
        classify: classify
    };
})(window);
