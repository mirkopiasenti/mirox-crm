# Mirox CRM — Vendita

Modulo CRM per la gestione di vendite, post-vendita e supporto operativo della rete Konatech. Static frontend HTML/JS + Netlify Functions (Node) + Supabase Postgres.

## Stack

- **Frontend**: HTML statico + JavaScript vanilla (no bundler), Inter via Google Fonts, client Supabase `@supabase/supabase-js@2.110.8` da CDN con Subresource Integrity
- **Backend serverless**: Netlify Functions (Node >=22 + esbuild), librerie versionate esattamente (`@supabase/supabase-js@2.110.8`, `nodemailer@10.3.1`, `busboy`, `pdfkit`, `pdf-lib@1.17.1`, `unpdf@1.9.1` per il recupero testuale PDA, `fflate@0.8.3` per gli export `.xlsx`, `@resvg/resvg-js@2.6.2` per i report PNG Target, `qrcode@1.5.4` per QR, `zxing-wasm@3.1.6` e `@napi-rs/canvas@1.0.13` per decodificare barcode dai PDF)
- **Database**: Supabase Postgres (Auth + Storage + RLS + RPC + Trigger), 10 bucket Storage (`moduli-template` pubblico + 9 privati con signed URL on-demand)
- **Backup Aruba attivo**: VPS IT1 e Object Storage R1-IT, copie automatiche ogni ora anche a Mac spento, AES-256-GCM/versioni/Compliance. Prima copia: 10 bucket/6.579 oggetti; tutti i 6.584 file verificati da Aruba e restore DB isolato riuscito (100 tabelle/51.252 righe). Monitor esterno con avvisi di errore/mancata esecuzione collaudato; chiave custodita separatamente. 68 test Linux e 128 npm superati. Netlify: 20/28 valori Production esportati con autorizzazione, salvati privatamente e cifrati su Aruba; readback/confronto verificati. 8 Secret write-only mancanti, senza copie originali: serve futura riemissione coordinata. Inventario configurazioni statico da aggiornare dopo modifiche; copertura esterna ancora parziale. API/ACL del recupero su progetto Supabase gestito e scadenza lifecycle da collaudare. Guida: [`docs/BACKUP_RIPRISTINO.md`](docs/BACKUP_RIPRISTINO.md)
- **Verifica storico 23/10**: ultima copia integra (7.298 file/11 bucket), ma 23/441 copie automatiche fallite e un intervallo massimo di circa 8 ore; full/checkpoint giornalieri del 20-23/10 mancanti. Nessuna correzione applicata; dettagli e interventi necessari nel [rapporto](docs/BACKUP_VERIFICA_STORICO_2026-10-23.md).
- **Email**: Gmail SMTP via nodemailer + template DB (`email_template` + `email_log`)
- **SMS transactional**: Smshosting REST API (consensi privacy via OTP — vedi `docs/SMSHOSTING_SETUP.md`)
- **KONA AI Guardian**: OpenAI Responses API per raccolta/analisi strutturata + Audio Transcriptions per i vocali Telegram conclusi
- **MIROX AI - Target**: bot dedicato con report serali alle 19:45 Europe/Rome: vendite in testo spaziato, Call Center e mensile in immagini PNG senza API immagini; dialogo su riepiloghi CRM e invio dei report originali anche con richieste in linguaggio libero; attivo in produzione, consegna e dialogo verificati ([setup](docs/MIROX_AI_TARGET.md))
- **Canale proprietario**: bot Telegram privato limitato al solo `chat_id` di Mirko
- **Hosting**: Netlify (build statica a lista consentita in `dist/` + functions + cron schedules)

## Verifica automatica contratti — collaudo assistito

Motore documentale, upload CSV WindTre, quattro esiti, primo turno ogni sera
alle **21:00 Europe/Rome** e riesame immediato dei sospesi dopo correzioni/CSV.
Controlla intestazione, identità valida **alla data firma**, firmatario Business,
ICCID copia SIM/PDA MNP e prime due pagine bolletta Energia con intestatario/POD/PDR.
Integra soltanto campi vuoti sostenuti dalle fonti; punteggi e anagrafica non riscritti.
CSV assente o contratto non ancora presente: In attesa CSV; altri problemi spiegati
in italiano. Per il turno serve un CSV caricato nel giorno del turno o successivo.
Reload CB Disattivazione cliente: `mirko.piasenti@gmail.com` appena verificato; problemi:
`mirko.piasenti@mail.com`. Outbox persistente con dedupe e riconciliazione invii incerti.

Nuova modalità iniziale **Collaudo assistito**: analizza una pratica selezionata,
registra l'esito nelle tabelle private; la conferma assistita e separata e le email
sono disponibili con l'impostazione Email anche in collaudo (richiesta28/10).
Migration applicata e riletta a production il27/10, versione `20261027172616`: sei
tabelle private/RLS e RPC server-only; configurazione confermata in collaudo.
Rilascio autorizzato dal proprietario; prove AI sui fascicoli ancora da fare insieme.
[Guida operativa](docs/VERIFICA_AUTOMATICA_CONTRATTI.md),
[analisi e requisiti](docs/VERIFICA_AUTOMATICA_CONTRATTI_ANALISI_2026-10-27.md).

Correzione27/10: gli elenchi leggono contratti e anagrafica senza join browser
a vendita_pratiche, protetta da RLS server-only. Il controllo pratica inviata
resta nel backend del verificatore. Il polling conserva caricamenti/errori.

Preparazione del collaudo diurno **28/10** (pubblicata): i contratti già presenti
saranno verificati manualmente dal proprietario; prove una alla volta sui nuovi
inserimenti, con scansioni migliori. Lettore aggiornato con trascrizione tramite
tool a schema, pagina/citazione anche per booleani, un solo secondo tentativo
su formato errato e testo digitale dello stesso PDF numerato per pagina.
I PDF scansionati restano letti visivamente e vengono inviati integri al servizio.
Esito nel dettaglio aggiornato anche se il pulsante conserva il focus, senza
perdere la data firma in modifica. Nessuna nuova dipendenza, env o migration.
Correzioni pubblicate su richiesta nel commit `84bb310`, CI425/425 e deploy
Netlify verificati HTTP. Qualità della lettura reale da misurare insieme. Dopo i timeout e il passaggio
Nano->Micro effettuato dal proprietario, alle22:15 del27/10 Auth/REST/SQL
rispondono e modalità collaudo è riconfermata, senza analisi o notifiche avviate.

Controllo successivo 27/10 alle 22:45: proprietario conferma Small e upgrade;
PostgreSQL 17.11 (build Supabase 17.11.0.003) confermato SQL/metadati, progetto
ACTIVE_HEALTHY e Auth/REST HTTP200 in circa 0,4s. Modalità collaudo confermata,
zero verifiche in corso e zero notifiche verifica. Test completi sui nuovi
contratti previsti il 28/10; consumo IO da misurare. Dettagli nel rapporto
`docs/INCIDENTE_ACCESSO_REPORT_2026-10-27.md`.

## Struttura cartelle

| Cartella / File | Cosa contiene |
|---|---|
| `index.html` | Login Supabase Auth |
| `imposta-password.html` | Accetta inviti Auth, crea la sessione dal link e consente di scegliere la password senza comunicarla agli amministratori |
| `dashboard.html` | Home con tabs Vendita / Post-Vendita + topbar con bottoni Applicazioni / Appuntamenti Oggi / Ticket / Call Center / **Admin** (visibile solo se `ruolo='admin'`) + badge ticket aperti. Nell'angolo inferiore destro una mascotte KONA AI Guardian di dimensioni ridotte con nuvoletta di chat compatta apre la raccolta di problemi o migliorie; il bottone Applicazioni apre un pannello espandibile sopra il saluto e collega a `Il mio planning`, `Compilatore disdette` e `Compilatore Subentri` |
| `admin.html` | **Hub Admin Mirox** — shell a due aree con sidebar dei reparti e area di lavoro. `Configurazioni` contiene 5 moduli, inclusi i Permessi pagine; `KPI` raccoglie i moduli di analisi. Accesso ristretto a `ruolo='admin'` |
| `admin-planning.html` | Reparto Personale: planning mensile, assenze, consuntivi, straordinari manuali, bozza/approvazione e PDF. Online29/10; migration20261029210434 applicata |
| `planning-personale.html` | Consultazione autenticata del solo planning pubblicato del dipendente collegato al login, con PDF personale; collegamento da Applicazioni |
| `js/planning-core.js`, `js/planning.js`, `css/planning.css` | Motore puro condiviso per calendario/conteggi/validazioni e UI delle due pagine Personale |
| `admin-permessi.html` | Scelta per utente delle 19 pagine Vendita/Post-Vendita/Applicazioni, gruppi, copia permessi e storico modifiche. Solo admin; rilascio 27/10/2026, migration applicata |
| `admin-utenti.html` | Gestione utenti: ruoli admin/operatore, abilita/disabilita, permessi granulari Call Center, flag `in_gara`, colonna **Alias di** (unifica due account della stessa persona con backfill guidato del pregresso). Solo admin |
| `admin-call-center-config.html` | Orari, blocchi e parametri di sistema del Call Center (spostata da `moduli/call-center/configurazione.html`). Solo admin |
| `admin-vendita-config.html` | CRUD cataloghi (categorie, offerte, opzioni, reload, regole documenti). Solo admin |
| `admin-gare.html` | Configurazione **Gare & Avanzamento** — metriche, obiettivi mensili per operatore, editor compenso a scaglioni + bonus, duplica dal mese precedente, flag operatori "in gara". Solo admin |
| `admin-kpi-vendita-consumer.html` | KPI **Vendita - Consumer**. Tab Mobile, Fisso, Customer Base, Luce & Gas, Allarmi e Assicurazioni con tabelle mensili; filtri anno, punto vendita e operatore. Solo admin |
| `admin-kpi-vendita-business.html` | KPI **Vendita - Business**. Tab Mobile, Fisso, Luce & Gas, Allarmi e Assicurazioni, leggendo esclusivamente i contratti Business. Solo admin |
| `admin-kpi-call-center.html` | KPI **Call Center**. Chiamate Consumer e lead Business outbound, nuovi appuntamenti e rischedulati, vinti, persi, da esitare, non presentati e annullati reali; viste giornaliera, settimane del mese e mensile con confronto operatrici. Solo admin |
| `moduli/` | 20 pagine funzionali Vendita / Post-Vendita / Applicazioni / KONA AI (`anagrafiche`, `apri_chiudi`, `switch_sim`, `ordini_smartphone`, `dispositivi_comodato`, `gestione_rimborsi`, `segnalazioni`, `simulatore_protecta`, `storico_cliente`, `ticket`, `verifica_contratti`, `controllo_fissi`, `controllo_lg`, `controllo_assicurazioni`, `controllo_allarmi`, `dashboard_pezzi` (3 tab: Day by Day + Gare Individuali + Avanzamento Mensile, con export PNG), `upload-contratti-vendita`, `compilatore_disdette`, `compilatore_subentri`, `segnala-problema`). `anagrafiche.html` è una card del tab Post-Vendita e offre elenco clienti, filtro cluster, selezione multipla dei comuni, ricerca nominativo, dettaglio, modifica confermata ed export Excel completo; nel popup di modifica il Comune usa autocomplete ISTAT e compila automaticamente la provincia. L'eliminazione è riservata agli admin e alle sole anagrafiche prive di collegamenti CRM |
| `moduli/call-center/` | **Modulo Call Center integrato** — 11 pagine autenticate (`registra-chiamata`, `elenco-chiamate`, `rilavorazione`, `appuntamenti`, `appuntamenti-oggi`, `prenota-interno`, `esiti-appuntamenti`, `blacklist`, `call-center-lead-outbound`, `prenota-interno-outbound`, `registra-chiamata-outbound`) + `prenota.html` (form pubblico). `configurazione` è sotto Admin Mirox (`admin-call-center-config.html`) |
| `js/` | Librerie condivise: `config`, `auth`, `mirox-ui`, `mirox-safe` (escape HTML, URL/ID/colori sicuri), `mirox-storage`, `mirox-storage-upload`, `mirox-api`, `mirox-upload`, `mirox-folder`, `mirox-mailer`, `anagrafica-helper`, `vendita-storage-helper`, `vendita-pda-core` (codici/dati Mobile browser-server), `vendita-pda-ui` (popup/editor PDA), `admin-shell`, `mirox-permissions-core` (catalogo e autorizzazioni browser/server), `mirox-permissions-ui` (menu e guard), `subentri-core` (regole pure condivise browser/server del Compilatore Subentri), `dashboard-report-core` (motore puro Day/Mensile condiviso con Target, netto/dettaglio Luce & Gas e calcolo gare/compensi condiviso con Admin); logica pagina Subentri in `compilatore-subentri.js`, Anagrafiche in `anagrafiche.js` e KPI in `admin-kpi-vendita-consumer.js` / `admin-kpi-call-center.js`. Il vecchio `mirox-error-reporter` email e' stato rimosso |
| `css/` | `style.css`, `mirox-modules.css`, `admin-shell.css`, `admin-kpi.css`, `admin-permessi.css`, `mirox-permissions.css`, `compilatore-subentri.css` |
| `assets/` | Logo, favicon e mascotte trasparente `kona-guardian-robot.png` |
| `scripts/build-static.js` | Build Netlify: copia in `dist/` soltanto i file pubblici, genera `dist/js/config.js` con ambiente/release e inietta la telemetria nelle pagine autenticate |
| `scripts/backfill-identita-contratti.js` | Bonifica documenti identita dal 01/07/2026 Europe/Rome: dry-run predefinito, `--apply` per copie indipendenti con SHA256/readback; `--same-client` solo con autorizzazione del proprietario per il documento piu recente dello stesso cliente. Piano/report privati in `.backup-private/identity-backfill/` |
| `scripts/backup/` | Runner DB/Storage read-only, adattatore Aruba cifrato, provisioning Ubuntu, restore PG isolato trimestrale, audit quotidiano, export/verifica TAR indipendente, timer/service systemd, lifecycle, packaging Git, test offline; template AWS precedente non scelto. Escluso dalla build pubblica |
| `.backup-private/` | Credenziali e pacchetti privati, ignorati da Git; mai pubblici |
| `docs/BACKUP_RIPRISTINO.md` | Copertura backup, attivazione Aruba, costi stimati, limiti e procedura di collaudo/ripristino |
| `dist/` | Output locale della build, ignorato da Git. Non contiene backend, migration, test o documentazione |
| `netlify/functions/` | Endpoint server-side (vedi sotto) |
| `netlify/functions/_assets/target/` | Font Lato (OFL) privati del renderer immagini Target, inclusi nel solo worker e fuori da `dist/` |
| `netlify/functions/_lib/` | Helper condivisi (`mailer`, `require-auth`, `page-permissions`, `smshosting`, `privacy-config`, `pdf-consenso`, `privacy-pdf-storage`, `pdf-disdetta`, `pdf-subentro` (coordinate del modello in `pdf-subentro-coordinates.json`), `score-integrity`, `kona-ai-guardian`, `telegram`, `guardian-codex`, `guardian-telemetry`, `guardian-triage`, `with-telemetry`, `target-reports`, `target-dialogue`, `target-queue`, `target-telegram`, `target-report-images`) |
| `netlify/functions/_templates/disdette/` | I quattro moduli PDF WindTre originali usati come sfondo immutabile dal Compilatore disdette |
| `netlify/functions/_templates/subentri/` | Modulo originale WINDTRE di cessione Mobile giugno 2024; incluso nelle Functions, mai nella build pubblica |
| `tests/` | Test automatici Node (`node:test`): regressioni vendita, sicurezza/XSS, PDF privacy, sintassi e link locali |
| `.github/workflows/ci.yml` | CI GitHub: build e test con Node 22 su pull request e branch `main`/`staging` |
| `.github/workflows/guardian-codex-*.yml` | Workflow separati per analisi read-only, patch da main, test sulla branch della modifica e preparazione di una pull request production senza merge automatico |
| `.github/workflows/guardian-observer-analysis.yml` | Analisi automatica e scansioni preventive in sandbox read-only sul commit che ha generato il segnale; nessun push o modifica repository |
| `.github/codex/` | Prompt e schemi strutturati usati dai workflow Codex; i dati della segnalazione arrivano soltanto tramite il worker HMAC |
| `docs/KONA_AI_GUARDIAN_SETUP.md` | Setup production, Telegram/OpenAI, approvazioni e confini del primo agente |
| `docs/MIROX_AI_TARGET.md` | Requisiti, report, dialogo, setup bot dedicato, coda e collaudo Target |
| `docs/STATO_LAVORO.md` | Promemoria breve per riprendere fra chat: branch, verifiche, punti aperti e prossimo passo; aggiornato a fine intervento |
| `database/` | Migrazioni SQL storiche **parziali** — vedi `database/README.md` |
| `database/staging/` | Bootstrap one-shot esclusivi del Supabase staging; non applicabili a production |
| `netlify.toml` | Config Netlify, header di sicurezza (CSP/HSTS/Permissions-Policy) e cron |
| `js/identita-upload-core.js`, `js/identita-upload-ui.js` | Regole identita/cittadinanza/permesso e controllo anticipato nell’upload (28/10) |
| `js/verifica-contratti-core.js`, `js/verifica-contratti-automatica.js`, `css/verifica-contratti-automatica.css` | Regole documentali pure e pannello Verifica Contratti con CSV, esiti e collaudo assistito |
| `scripts/verifica-automatica-sql.js` | Collaudo PostgreSQL isolato della nuova coda, commit atomico e grant |
| `netlify/functions/_lib/windtre-customer-codes.js` | Registro anagrafico dei codici cliente WindTre, append idempotente |
| `scripts/verifica-codici-cliente-sql.js` | Collaudo isolato di schema, RLS e permessi dei codici cliente |
| `scripts/verifica-permessi-pagine-sql.js` | Collaudo PostgreSQL isolato delle ACL: matrice 19 pagine, policy, Storage, viste, versioni e audit. PGlite esterno tramite `MIROX_PGLITE_MODULE`, nessuna dipendenza runtime aggiunta |
| `scripts/verifica-professional-cloud-sql.js` | Collaudo isolato dei nuovi campi e vincoli Professional Cloud |
| `package.json` | Dipendenze Node delle functions |
| `CLAUDE.md` | Mappa completa per AI assistants (architettura, schema, regole di business, convenzioni) |

### Netlify Functions

Tutte le functions richiedono JWT valido, eccetto i cron Netlify, `public-prenota`, i webhook Telegram Guardian/Target protetti da secret token e allowlist proprietario e i worker Guardian/Target/Verifica Contratti protetti da HMAC. Il client CRM usa `MiroxApi.fetch()`; Target ha un canale backend dedicato.

| Function | Metodo | Auth | Scopo |
|---|---|---|---|
| `target-telegram-webhook` | POST | secret Telegram + chat privata proprietario | Accoda testo/vocali nel bot dedicato Target; dedupe update e dialogo libero |
| `target-worker-background` | POST background | HMAC + timestamp | Genera report/dialogo, memoria privata e consegna con checkpoint |
| `cron-target-reports` | scheduled `*/5 * * * *` | cron Netlify | Report alle 19:45 italiane, calendario lavorativo, dedupe e risveglio coda Target |
| `gestisci-verifica-automatica` | POST | authenticated; admin per collaudo/CSV/configurazione/notifiche | Stato del servizio, analisi assistita, riesame, data firma attestata, import CSV e modalità |
| `verifica-identita-upload` (28/10) | POST multipart/JSON | JWT + permesso Upload Contratti | Legge identita, confronta anagrafica e firma ricevuta; conferma manuale tracciata |
| `verifica-contratti-background` | POST background | HMAC con contesto dedicato + timestamp | Legge PDF e applica regole; commit atomico se attiva, sola valutazione se collaudo, outbox email |
| `cron-verifica-contratti` | scheduled ogni minuto | cron Netlify | Recupera collaudi richiesti e lavori automatici dovuti alle21:00Europe/Rome o dopo integrazione; modalità iniziale collaudo |
| `vendita-config` | GET | authenticated | Carica catalogo per il wizard contratti |
| `gestisci-planning` | GET/POST | admin / dipendente proprietario | Configurazione, bozza, pubblicazione atomica e PDF; dipendenti limitati al proprio snapshot pubblicato, senza causali/codici/note |
| `admin-permessi-pagine` | GET/POST | admin | Utenti e ACL, audit e salvataggio atomico versionato |
| `admin-vendita-config` | GET / POST | **admin** | CRUD admin del catalogo |
| `admin-kpi-vendita-consumer` | GET | **admin** | Aggrega i KPI Consumer o Business, selezionati tramite parametro `cluster`, per Mobile, Fisso, Customer Base, Luce & Gas, Allarmi e Assicurazioni; la scheda Customer Base è mostrata soltanto nel Consumer |
| `admin-kpi-call-center` | GET | **admin** | Aggrega per giorno e operatrice chiamate Consumer e lead Business outbound, distingue nuovi appuntamenti e rischedulati, riclassifica le conversioni anticipate come vinte ed espone esiti, arretrato e presenze |
| `crea-vendita-pratica-carrello` | POST | authenticated | Crea pratica + N contratti in stato provvisorio `bozza`, promuove i PDA e supporta le action idempotenti `finalize` / `rollback_upload_failure`. L'operatore viene sempre ricavato dal JWT. Per cluster `Turista` salva `cluster_cliente='Turista'` sui contratti, usa `Consumer` su `anagrafica` e non richiede email. Valida codice/dati Mobile e duplicati prima delle scritture; collisioni UNIQUE restituiscono 409 dopo rollback della bozza. |
| `upload-vendita-documento` | POST multipart | authenticated | Upload di PDF reali su `contratti-vendita` (anche staging `temp/<sess>/`). Verifica proprietà operatore/admin sulle bozze; sulle pratiche inviate consente la gestione da Verifica Contratti. Valida coerenza pratica/anagrafica/contratto, deriva il path dalla pratica e attribuisce l'upload all'utente autenticato |
| `upload-documento-modulo` | POST multipart | authenticated | Upload server-side per i bucket operativi Apri/Chiudi, Switch SIM, Comodato, Rimborsi, Protecta e Segnalazioni. Accetta PDF reali; nel bucket Segnalazioni anche immagini JPG/JPEG, PNG, GIF, WEBP, BMP, TIFF, HEIC/HEIF e AVIF. Verifica firma e MIME, limita i file a 20 MB e registra l'operatore JWT nei metadati Storage |
| `gestisci-vendita-contratto` | POST | authenticated | Aggiornamento/verifica/riapertura dei contratti e rimozione allegati. Accetta soltanto campi consentiti, deriva snapshot e punteggi dal catalogo e usa l'identità JWT per `controllato_da`. Nuove action `check_codice` e `update_pda` per controllo globale/editor dei dati PDA, con gestione collisioni e concorrenza. |
| `gestisci-controllo-fissi` | POST | **admin** | Corregge un esito Fisso inserito per errore riportando una pratica da `Attivo` o `KO` a `In Attivazione`, azzerando i campi di esito e registrando l'admin nell'audit. Il pulsante appare accanto allo stato e la pagina chiede conferma prima del ripristino |
| `gestisci-controllo-lg` | POST | authenticated / **admin** per esiti manuali | Applica in batch gli esiti CSV rispettando i blocchi manuali; consente agli admin di impostare un esito motivato e protetto oppure di riattivare esplicitamente gli aggiornamenti CSV |
| `gestisci-operazioni-post-vendita` | POST | authenticated / **admin** per rimborso manuale | Gestisce tutte le scritture dei rimborsi e l'esito Apri/Chiudi: `create_rimborso_manuale` richiede `ruolo='admin'`, mentre creazione/completamento ordinari e `mark_apri_chiudi_ko` sono disponibili agli account autenticati attivi |
| `gestisci-subentri` | GET / POST JSON o multipart | authenticated | Due ricerche CRM, bozze idempotenti per operatore, upload PDF/JPEG/PNG (4 MiB/file), verifica allegati, generazione PDF multipagina, storico globale, duplicazione dati e signed URL di 5 minuti per PDF e allegati |
| `gestisci-disdette` | GET / POST | authenticated | Genera i quattro PDF di recesso sui moduli WindTre originali, salva il PDF nel bucket privato `disdette-files`, registra lo storico, duplica i dati tra SIM/Fisso dello stesso cluster e cerca anagrafiche CRM per nome, cognome o CF/P.IVA |
| `elimina-vendita-contratto` | POST | **admin** | Eliminazione definitiva da Verifica Contratti: cancella il contratto, i record collegati, gli allegati Storage e la pratica se resta vuota |
| `ocr-pda` | POST multipart | authenticated | OCR del PDA (Pratica di Adesione PDF) via Claude API e recupero numerazioni per coordinate con unpdf — pre-compila anagrafica, codice contratto e dati Mobile; contatto dalla firma elettronica. In caso di errore Anthropic ritorna `error_code` strutturato (`ocr_credit_exhausted`, `ocr_rate_limited`, `ocr_unavailable`, `ocr_auth_error`, `ocr_generic_error`) per popup mirato lato client |
| `search-anagrafica` | GET | authenticated | Ricerca cliente per CF/PIVA |
| `gestisci-anagrafiche` | GET / POST | authenticated / **admin** per eliminazione | Elenco paginato e filtrato delle anagrafiche per il reparto Post-Vendita; `action=comuni` restituisce le scelte presenti a DB, `action=comuni_istat` cerca nel catalogo ufficiale server-only e `action=export` genera un file `.xlsx` completo con gli stessi filtri multipli. `update` usa allowlist, controllo di concorrenza e validazione Comune/Provincia ISTAT; `delete` elimina solo anagrafiche senza collegamenti CRM |
| `mirox-send-email` | POST | authenticated | Invio email con template DB |
| `guardian-incidents` | GET / POST | authenticated | Crea e prosegue richieste KONA AI di tipo `problema` o `miglioria`, con raccolta AI dedicata. Gli operatori vedono solo le proprie; gli admin possono elencarle tutte. Nessun accesso browser diretto alle tabelle Guardian |
| `guardian-telemetry-ingest` | POST | authenticated | Riceve batch tecnici ripuliti dal frontend, calcola fingerprint e aggiorna i segnali aggregati; non accetta body applicativi, allegati o segreti |
| `guardian-telegram-webhook` | POST | webhook Telegram privato | Accetta solo il secret token configurato e il `chat_id` di Mirko; gestisce testo, vocali trascritti, problemi/migliorie, analisi Guardian, analisi Codex read-only, patch/test della branch, proposta di rilascio e archiviazione. Ogni pulsante operativo rende automaticamente attiva la relativa richiesta per i messaggi successivi; l'archiviazione libera invece la sessione. Le azioni sensibili restano auditabili e separate |
| `guardian-voice-background` | POST background | HMAC + timestamp | Elabora la coda privata dei vocali; salva trascrizione/risposta prima dell’invio e recupera timeout con retry limitati |
| `guardian-codex-worker` | POST | HMAC worker-only | Endpoint interno per claim, heartbeat e risultato dei workflow Codex. Distingue una patch creata da una richiesta già soddisfatta nel codice corrente: nel secondo caso chiude positivamente l'esecuzione senza branch, pull request o tasto di test. Non accetta JWT utente, non espone dati al browser e non contiene segreti nel payload |
| `cron-guardian-observer` | scheduled (`*/5 * * * *`) | nessuna (cron Netlify) | Aggrega i segnali Guardian, apre incidenti automatici, avvia Codex read-only entro il budget e processa l'outbox Telegram con retry |
| `cron-rientro-sim` | scheduled | nessuna (cron Netlify) | Notifica giornaliera rientro SIM; termina senza operazioni quando `MIROX_DEPLOY_ENV=staging` |
| `cron-pulizia-operativa` | scheduled | nessuna (cron Netlify) | Scade OTP pending, elimina contatori rate-limit scaduti, rimuove bozze vendita oltre 24 ore con relativi PDF e pulisce il contesto tecnico Guardian oltre 90 giorni; termina senza operazioni quando `MIROX_DEPLOY_ENV=staging` |
| `public-prenota` | GET / POST | nessuna (form pubblico) | Endpoint per `prenota.html`: rate limit persistente su Postgres e POST atomica tramite RPC con lock e nuovo controllo dello slot nella stessa transazione |
| `garantisci-anagrafica` | POST | authenticated | Upsert anagrafica (lookup CF/PIVA, update campi vuoti / cambiati o insert). Usato dal wizard prima della raccolta consenso; per `Turista` salva `Consumer` su `anagrafica` e non richiede email |
| `check-consenso-privacy` | GET | authenticated | Dedupe 24 mesi: cerca per `anagrafica_id` una dichiarazione corrente valida; con `include_history=true` restituisce inoltre l'esito privacy più recente e l'ultimo PDF archiviato per badge e download da Storico Cliente |
| `richiedi-otp-privacy` | POST | authenticated | Richiede la scelta esplicita ACCONSENTO/NON ACCONSENTO, accetta cellulari italiani correnti o legacy di 9–10 cifre, genera OTP 6 cifre, salva hash+salt e invia SMS via Smshosting. Rate-limit 3 invii/ora per anagrafica + cooldown 60s |
| `verifica-otp-privacy` | POST | authenticated | Verifica OTP (max 3 tentativi), impedisce aggiornamenti concorrenti e recupera un timeout Storage con verifica SHA256, genera il PDF informativa/dichiarazione con scelta marketing ed evidenze probatorie, lo archivia e imposta `valido_fino_al = now()+24 mesi` |
| `genera-pdf-consenso-cartaceo` | GET | authenticated | Stream del modulo cartaceo v6 precompilato: una pagina A4, monocromatico, corpo 10 pt, scelta marketing già marcata e riga firma |
| `upload-consenso-cartaceo` | POST multipart | authenticated | Upload scansione firmata (max 20 MB, PDF); richiede l'esito ACCONSENTO/NON ACCONSENTO e crea il record `'cartaceo'` confermato |



### Email anche nel collaudo assistito (28/10/2026, attivo)

Reload ora invia a `mirko.piasenti@gmail.com`, come Professional Cloud; i problemi
restano a `mirko.piasenti@mail.com`. Nuove colonne private configurazione
`email_collaudo` (default false) e `email_collaudo_at` delimitano l’abilitazione.
Con modalita collaudo e flag attivo: mail problemi per nuovi collaudi richiesti
con esito Da verificare e revisione/anagrafica correnti; Reload/Cloud dopo conferma
assistita tracciata nell’audit e collegata all’esecuzione conforme. Solo eventi
successivi all’abilitazione: nessun recupero massivo dei vecchi test. Attesa CSV
senza mail problemi; dedupe condivisa con la modalita attiva. Reload in coda non
inviato aggiornato al nuovo destinatario; gli invii incerti restano da riconciliare.
RPC `vendita_verifica_accoda_email_collaudo` INVOKER/search_path vuoto e service-only,
senza schema/RLS/trigger CC modificati. Worker/cron possono elaborare soltanto
notifiche (`notifications:true`, HMAC) mantenendo fermi turni e backlog contratti.
Gli errori tecnici dopo cinque tentativi producono esito/mail anche in collaudo.
UI mostra lo stato delle email, checkbox admin e reinvio esplicito quando abilitato.
Migrazione sorgente `20261028153619_verifica_email_collaudo_reload.sql`, applicata
production `20261028154059`; flag abilitato il28/10 alle16:45:15 Europe/Rome
dopo il deploy `838c0a6` / Netlify `6ae21810a3cc31721d8192c3` (16:43:59),
CI `40718797608` riuscita. SHA/UI verificati HTTP e dispatch notifiche-only202.
Coda vuota alla rilettura, nessuna email fittizia inviata e nessun nuovo collaudo
avviato. Modalita serale collaudo invariata; advisor sicurezza invariati.
Build e504/504test riusciti, harness SQL esteso riuscito. Nessuna nuova env/dipendenza.

### Conferma assistita dopo collaudo (28/10/2026)

Il proprietario autorizza Codex a confermare il singolo contratto con collaudo
completamente positivo, dopo aver riscontrato nuovamente dati e allegati invariati.
Il contratto passa nei Verificati con audit della conferma; problemi e attese
rimangono aperti. La simulazione e la conferma assistita sono due passaggi distinti;
la modalita serale resta collaudo, senza abilitare elaborazioni/invii globali.
Prima conferma assistita riuscita il28/10; nessun cambio applicativo o schema.



### Anteprima manuale dopo errore e Haiku 5.5 (28/10/2026, pubblicato)

Richiesta esplicita del proprietario: dopo esito identita negativo/incerto aprire
la preview e chiedere «Confermi che il documento visualizzato nella preview e
quello del cliente in anagrafica?». Tutti i PDF selezionati sono mostrati come
originali locali in iframe blob, con apertura a dimensione intera. Si abilita
Si solo dopo il caricamento di tutte le anteprime. No/chiusura annullano; URL
revocati, testo escaped e risposte tardive scartate se cliente/file/PDA cambiano.
Si usa ricevuta HMAC e hash degli stessi PDF: nuova action JSON confirm_preview
senza AI, autore/ora/modalita preview_manuale e dichiarazione conservati con
esito_automatico originale. Su richiesta si puo superare anche un esito OCR
negativo: e attestazione umana, non successo automatico. Non serve ritrascrivere
CF o scrivere un motivo libero. Serve scadenza verificata valida alla firma;
restano anagrafica attuale, data firma, PDF validi, integrita e permesso Consumer
VAR extra UE. Cittadinanza richiesta se necessaria. Nessuna deroga ad auth,
limiti file, legame Business/PDA, controlli commerciali o verifica successiva.
Aggiungi/Invia riusano la ricevuta; nessuna nuova OCR identita dopo Si. Anche la
verifica successiva riusa il manuale solo con anagrafica e hash invariati e indica
esplicitamente che il controllo identita era manuale.

Migrazione claude-haiku-5-5 su ocr-pda e lettore condiviso verifica-documenti
(identita upload, Business, SIM, bollette, PDA e verifica serale). Rimossi sampling
non supportati; tool forzato con schema/pagina/citazione invariato. OCR iniziale
JSON, effort low e max2400token per margine adaptive thinking; lettore max5000,
cache invalidata da modello/READER_VERSION2026-10-28.4. SDK esistente verificato
sul payload HTTP simulato, nessuna nuova dipendenza/env/migration. Regole dati
PDA/MNP/Energia/CSV/Reload/Cloud invariate. Motore2026-10-28.3: CF esatto resta
prioritario, assenza CF non ripiega su nome/nascita; preview sostituisce il
precedente popup che imponeva trascrizione CF/motivo. API legacy confirm resta
compatibile. Pubblicato su richiesta: `2ebd2f5`, CI `40738017338` riuscita,
Netlify `6ae233ae628dbdd6472b432b` online18:41:45 Europe/Rome. Commit pubblico
e byte della UI verificati HTTP; API identita401 senza JWT.
Guide ufficiali consultate: https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
Build e531/531test, inclusi68Python Backup, preview DOM/annullamento/file cambiati,
riuso serale senza OCR e richieste modello via SDK simulato. Nessuna nuova
chiamata AI live, modifica dati CRM, email o cambio modalita serale.

### Identita Business: CF del rappresentante dalla PDA (28/10/2026)

Pubblicato `920f530`, CI `40728727037` riuscita, Netlify
`6ae22620679a1843b7adb624` online alle17:43:57 Europe/Rome. Build e519/519
test riusciti; commit e asset UI verificati HTTP, API401 senza JWT.

Il controllo anticipato legge dalla PDA Business il CF personale nella sezione
rappresentante legale/delegato, distinto da PIVA aziendale e pagatore SEPA.
Prima riscontra CF/PIVA aziendale con l’anagrafica CRM; poi confronta esattamente
CF del rappresentante con documento e scadenza alla firma. Con CF coincidente
il nome OCR e informativo anche Business. Nel rilascio precedente, senza CF sul documento si usavano nome/nascita;
la correzione sopra richiede ora conferma esplicita del CF.
Per categorie senza PDA resta Nome referente, senza confrontare persona e PIVA.
CF persona non leggibile nella PDA Mobile/Fisso/CB richiede copia completa.

Helper `_lib/pda-business-identity.js`: testo digitale con pagina/citazione,
fallback AI indipendente solo per dati mancanti; ambiguita o discordanza bloccano.
Mai inviare valori CRM attesi al modello. Ricevuta HMAC esistente conserva
`business_identity` con CF persona e prove PDA (codice, azienda, SHA256, lettura).
Il browser trasmette i percorsi staging, non decide il CF verificato. Tutte le
PDA del carrello devono riferirsi alla medesima persona, altrimenti pratiche separate.
Cambio PDA invalida cache/risposte tardive; create e finalize rileggono i byte
prima dell’invio. Digest PDA promosso nel campo sha256 esistente. Riuso serale
solo con identita e PDA del singolo contratto identiche; altrimenti nuova lettura.
Ricevute Business precedenti senza prove PDA richiedono nuovo controllo upload.
Nessuna migration, colonna anagrafica, dipendenza o env nuova. Modalita collaudo,
notifiche Reload/Cloud e controlli successivi restano invariati.
Verificati i due PDF Mobile/Fisso forniti con parser reale senza chiamate AI;
regressioni sintetiche su CF errato, fonti diverse e sostituzione dei file.

### Identita Consumer: CF e scadenza prioritari (28/10/2026)

Su richiesta successiva del proprietario, se il documento riporta un CF italiano
identico a quello dell’anagrafica Consumer/Turista, i riscontri principali sono
CF esatto e scadenza valida alla data firma. Nome OCR informativo: assenza o
trascrizione diversa non bloccano, non impongono conferma manuale e non avviano
il secondo giro AI. Nessuna correzione approssimata delle cifre/lettere del CF.
Un CF esplicito diverso blocca anche con nome uguale; scadenza non leggibile
richiede conferma manuale, scaduto alla firma blocca. Restano tipo riconosciuto,
numero documento, parti necessarie e coerenza fra PDF: non approvare tessere
sanitarie o allegati incompleti soltanto perche riportano un CF. Si verifica la
coerenza documentale, non l’autenticita/identificazione biometrica da scansione.
Il precedente fallback senza CF su nome/nascita e superato dalla correzione
sopra: assenza CF richiede conferma esplicita, mai blocco sul nome. Business usa il CF personale dalla PDA come descritto sotto;
la PIVA aziendale non identifica la persona. Nessuna nuova colonna anagrafica.
Motore successivo versione `2026-10-28.2` usa la medesima priorita; PDA/intestazione,
MNP/ICCID, Energia/CSV e notifiche invariati. Ricevuta salva `criterio_identita`
e `confronto.nome_informativo`; firme/hash/anagrafica e regole anti-risposte tardive
restano vincolati come prima. Diagnostica nomi conservata; ricontrollo nome resta
solo nei percorsi senza riscontro CF, con conferma manuale tracciata
se due letture discordano e gli altri identificativi coincidono.
Nessuna migration/env/dipendenza o modifica dei dati CRM. Pubblicato su
richiesta del proprietario insieme all’estensione Business. Fonte CIE: https://www.cartaidentita.interno.gov.it/cose-la-carta/caratteristiche-del-documento/

### Diagnostica nome e ricontrollo identita (28/10/2026)

Dopo un blocco reale, l’operatore conferma nome/CF identici a carta e PDA. Il
vecchio esito non conserva sul server la trascrizione dell’upload rifiutato:
non attribuire lettere specifiche all’AI senza la relativa risposta. Nessuna
correzione dell’anagrafica omonima con altro CF senza riscontro/autorizzazione.
Il risultato espone `confronto` con campo anagrafico usato, nome atteso e nomi
trascritti. UI escaped nel popup di blocco (Controlla/Aggiungi/Invia) e conferma
manuale; i nomi restano fuori da error.message/telemetria, nessun CF aggiunto al log.
Nei percorsi senza CF coincidente, se l’unico errore certo e il nome
e il primo giro dura meno di18secondi, il backend
richiede una seconda lettura indipendente dello stesso PDF, senza nome atteso o
prima risposta. Istruzione su campi stampati/MRZ, non firma/annotazioni; timeout
SDK20secondi e un solo tentativo formato nel ricontrollo, nessun retry illimitato.
Se seconda lettura coincide con anagrafica, stesso numero documento, nessuna
contraddizione CF/nascita/scadenza/tipo e nessun altro errore, il nome passa a
INCERTO: restano entrambe le trascrizioni e la seconda lettura nella ricevuta,
conferma manuale esplicita/motivo obbligatori. Mai approvazione automatica del
nome discordante. Fallimento, errore stabile o altri dati discordanti conservano
il blocco; CF/documento diverso/scadenza non aggirabili. Nessuna migration/env
nuova, nessun dato anagrafico atteso inviato al modello.
Correzione pubblicata insieme al Business; regressioni sintetiche
e nessuna nuova chiamata Anthropic sui PDF reali, ispezionati localmente.

### Identita nell’upload e permesso di soggiorno (28/10/2026, pubblicato)

Correzione pubblicata del28/10: una nuova SIM Mobile prende il numero
definitivo da `DATI DELLA SIM WINDTRE`. Il lettore serale integra il dato quando
la PDA digitale e completa, tutte le pagine sono numerate coerentemente e manca
la sezione MNP; documenti parziali/ibridi o evidenze discordanti restano incerti.
Versione lettore `2026-10-28.1`, nessuna migration/env nuova. Pubblicata con `a609019`, CI e collaudo online riusciti.

Controllo anticipato del solo documento di riconoscimento, confronto con anagrafica:
Consumer CF esatto (CF assente: conferma esplicita nella correzione sopra); Business CF rappresentante
dalla PDA, oppure Nome referente per categorie senza PDA. Data firma esplicita, tipo e fronte/retro; esiti
coerente/da correggere/da confermare, conferma preview manuale tracciata dopo esito negativo/incerto, come sopra.
Cittadinanza esplicita o confermata, mai dedotta da residenza/nascita/nome:
permesso PDF obbligatorio solo Mobile Consumer + dispositivo VAR + extra UE.
Nuova API `verifica-identita-upload` con JWT e permesso Upload, ricevuta HMAC
legata ad autore/dati/hash PDF, verifica server su create/upload/finalize e audit.
Nuovi helper `js/identita-upload-core.js`, `js/identita-upload-ui.js`,
`netlify/functions/_lib/identita-upload.js` e `_lib/pda-business-identity.js`;
nessuna nuova dipendenza/env.
Migration sorgente `20261028122800_identita_upload_permesso_soggiorno.sql`,
applicata a production come `20261028131258`: JSONB audit in vendita_pratiche e SHA256 in vendita_documenti, nullable
per legacy, grant/RLS/CC invariati. Nuovo tipo allegato `permesso_soggiorno`.
Verifica serale conserva PDA/SIM/bollette/CSV e data firma effettiva; riusa identita
solo con anagrafica e byte coincidenti. Nessun cambio modalita/email o storico.
Guida e limiti: `docs/IDENTITA_UPLOAD_2026-10-28.md`. Pubblicato; collaudo
scansioni reali e UI al proprietario, senza browser da parte dell’assistente.

### Professional Cloud Mobile e Fisso Business (28/10/2026)

Professional Cloud e' separata dall'opzione MNP, solo Mobile e Fisso Business. Il wizard
mostra Si/No anche con lettura AI; presenza ricavata da Opzioni/servizi della SIM
contrattuale con Piano Telefonico per Mobile, dal riquadro Opzioni aggiuntive per
Fisso, ignorando prevalidazione e condizioni generali.
Testo PDF per coordinate + OCR: presenza testuale esplicita prevale; No richiede
lista completa/leggibile e accordo della lettura AI, altrimenti scelta manuale.
Nessuna assenza dedotta da PDF ibrido/troncato. In presenza di riquadro contrattuale,
anche numero SIM viene letto da quello, evitando conflitti con la prevalidazione.

Con Si il popup Gestione Professional Cloud richiede Mantieni attiva oppure
Richiedi disattivazione, senza default. Chiudere lascia la decisione da completare;
non si prosegue senza scelta. Presenza e gestione modificabili con conferma: fino
al consenso niente modifiche a valori/decisione/bozza; No a Si richiede anche la
nuova decisione, annullamento conserva la situazione precedente. Input select non
salva valori prematuri; doppi cambi e risposte tardive su PDA/offerta/cliente/cluster
o editor chiuso non si applicano. Nuova PDA azzera, draft/carrello conservano la
coppia. Al cambio cluster fuori Business la UI rimuove i dati Cloud; correzione
categoria fuori Mobile/Fisso nell'editor generale li azzera. Dati consultabili e
correggibili negli editor PDA Verifica/Storico; Storico mostra anche No esplicito.

`vendita_contratti.professional_cloud` boolean nullable e
`professional_cloud_gestione` text nullable (Mantieni attiva/Richiedi disattivazione).
CHECK: solo Mobile e Fisso Business; Si richiede decisione valida, No/NULL nessuna decisione.
Migration `20261028085821_professional_cloud_mobile_business.sql` applicata/riletta:
nessun default o backfill,0righe storiche valorizzate, vincolo validato. Nessun
cambio a tabelle/permessi/RPC CC o RLS esistenti. Validazione browser/server;
nuovo wizard obbliga Si/No Business, compatibilita client legacy senza campo e
storico sconosciuto mantenuta. Nessuna disattivazione sul portale, email/notifica,
modifica MNP/catalogo/punteggi o verifica automatica avviata da questo rilascio.
Collaudo PostgreSQL isolato con `scripts/verifica-professional-cloud-sql.js`.

Estensione Fisso28/10: migration `20261028091505_professional_cloud_fisso_business.sql`
applicata/riletta, nuovo CHECK vendita_professional_cloud_business_coerenza
validato per Mobile/Fisso Business prima di rimuovere il precedente vincolo.
Nessuna nuova colonna, riscrittura dati o modifica a CC/RLS/RPC/permessi.
Il parser riconosce Opzioni aggiuntive Fisso e si ferma ai riquadri successivi;
assenza incerta resta manuale, No richiede lo stesso accordo testo/AI. UI,
DTO create ed editor conservano Cloud sul Fisso e azzerano solo i dati specifici
Mobile. Consumer, Turista e Customer Base restano esclusi. Stessi popup, conferme
e salvataggio di presenza/gestione; nessuna disattivazione o notifica automatica.

Verifica automatica e promemoria email (28/10, pubblicati e migration applicata):
il worker passa `cluster_cliente` alla validazione PDA condivisa, evitando falsi
errori `dati_pda` su Mobile/Fisso Business. No e storico sconosciuto restano validi;
Si richiede una gestione valida. Le scelte non sono dedotte o modificate dall’AI.
Dopo esito automatico Controllato, Professional Cloud Si con Richiedi disattivazione
accoda una email a `mirko.piasenti@gmail.com`, oggetto «Mirox CRM: promemoria WhatsApp
Professional Cloud», con nome cliente, riferimento e link alla pratica. Il messaggio
ricorda il WhatsApp manuale; nessun invio WhatsApp o disattivazione sul portale.
Una notifica per contratto, con tipo `professional_cloud` e chiave dedicata;
No/Mantieni attiva/Consumer/altre categorie/collaudo non accodano il promemoria.
Prima di inviare vengono riletti stato controllato, esito definitivo e scelta:
se non più valida, notifica superata. Riutilizzati retry SMTP certi e riconciliazione
degli incerti; il pannello distingue «Promemoria Professional Cloud».
Migration `database/20261028093837_verifica_professional_cloud_notifiche.sql`
applicata in produzione come `20261028095719`: amplia il CHECK tipo dell’outbox e aggiorna soltanto la RPC
vendita `vendita_verifica_concludi`, INVOKER con grant/RLS invariati; nessun nuovo
trigger o modifica a tabelle/RPC/permessi CC, nessun backfill. Worker pubblicato
prima della migration; vincoli validati, grant service-only e INVOKER riletti.
Non attivare il sistema: in collaudo restano esclusi approvazioni e invii.

### Upload PDA: codice contratto e dati Mobile (rilascio 27/10/2026)

Codice obbligatorio per Mobile, Fisso e Customer Base: il percorso manuale lo
chiede prima dell'upload, quello AI lo legge da ogni PDA. I duplicati sono bloccati
fra tutti gli operatori, negozi, mesi e stati, anche nelle bozze e nel carrello.
Un reinserimento richiede un nuovo codice. Il controllo lato database protegge
anche dai caricamenti contemporanei; un errore di verifica ferma il flusso.

Solo Mobile aggiunge costo mensile base dell'offerta (con popup sempre da
confermare), numero del contratto, portabilita, provvisorio/MNP e gestore di
provenienza. Nessuna somma di accessori o rate del dispositivo; costo assente da
compilare. Turista mantiene categoria/offerta automatiche e dati anagrafici ridotti,
con step contratto limitato ai nuovi dati PDA. Customer Base aggiunge solo il codice.
Il contatto per OTP arriva da DATI FIRMA ELETTRONICA della prima pratica,
con input manuale se assente e aggiornamento automatico dell'anagrafica esistente;
le PDA successive conservano il contatto iniziale. Riuso privacy e modifica OTP
restano disponibili.

Consultazione e correzione per tutti gli utenti attivi: Verifica Contratti (anche
verificati), Storico Cliente e, per il codice Fisso, Controllo Fissi. L'editor
protegge le modifiche concorrenti e mantiene allineati i due codici Fisso.
`js/vendita-pda-core.js` condivide validazione browser/server;
`js/vendita-pda-ui.js` condivide popup e editor. Nessuna nuova dipendenza npm CRM.

**Online dal 27/10/2026.** Migration additiva
`database/20261027110402_vendita_codice_pda_mobile.sql` applicata e riletta in
produzione; test transazionali con rollback su unicita/coerenza MNP/sincronizzazione
Fisso riusciti, nessuna riga di collaudo conservata o bonifica dello storico.
Suite locale340/340 (339test versionati) e SQL isolato OK. Risposte tardive di reinserimento scartate; OCR SIM dati Business esplicito e prefisso 39 senza + normalizzato soltanto su lunghezze internazionali. Convalida OCR reale9/9 e verifica SHA/CI/asset online riuscite. Prima del primo utilizzo ricaricare il wizard.



Aggiornamento UI27/10: durante l'upload il costo Mobile compare soltanto nel
popup (precompilato con AI se letto, altrimenti vuoto) e viene salvato come prima.
Con Analizza con AI scelta nuovo numero/portabilita, numeri e gestore restano
nascosti e compilati automaticamente, anche nel riepilogo del carrello. Con
Continua senza AI i campi telefonici sono visibili: Numero di cellulare per
nuova attivazione; con portabilita Numero provvisorio, Numero da portare (MNP)
e Operatore di provenienza. La modalita di lettura e' metadato solo del draft/
carrello, conservato al ripristino e azzerato sul nuovo contratto; vecchie bozze
senza modalita restano manuali. OCR fallito o numerazioni/gestore incompleti:
blocco prima dello staging e invito a riprovare AI o scegliere esplicitamente
il percorso manuale, senza inventare valori o mostrare automaticamente i campi.
Editor post-vendita completi; nessuna modifica schema o payload dei dati DB.


Recupero numerazioni PDF27/10: `ocr-pda` usa anche `_lib/pda-pdf-text.js`
con `unpdf@1.9.1` (PDF.js serverless, Node22+, modulo esterno esbuild).
Ricostruisce tutte le pagine per coordinate: l'ordine interno del content stream
puo' collocare il numero prima del titolo della sezione pur mostrandolo sotto.
Da DATI DELLA SIM WINDTRE recupera solo numero SIM; da PASSA A WINDTRE numero
MNP e Operatore attuale. Valori testuali univoci prevalgono sul risultato AI;
valori discordanti/invalidi non vengono scelti arbitrariamente. Nessun fallback
sul contatto firma e nessuna deduzione di prezzo/codice dal testo di altre sezioni.
Pagine ibride/scansioni senza sezione testuale non provano assenza MNP: resta
la lettura AI. Limiti del parser60pagine/100mila elementi/5s dopo apertura;
PDF non estraibile o oltre limiti usa la lettura AI esistente. Dati solo in memoria,
nessun log del testo o invio aggiuntivo. Campi AI nascosti e popup costo invariati;
nessuna modifica DB/storico. Dipendenza fissata nel lockfile e mantenuta esterna
per preservare l'import ESM dinamico di PDF.js.

Codice PDA nel percorso AI: nascosto anche in Dati Contratto e nel riepilogo
carrello, per Mobile/Fisso/Customer Base; resta conservato in bozza/payload/DB e
nel controllo duplicati. Manuale ed editor post-vendita mantengono il codice
visibile. Se AI non legge il codice, blocco con invito a riprovare o scegliere
il manuale esplicitamente, senza aprire il popup codice nel percorso AI.

Opzioni Mobile e rivenditore27/10: `MiroxPda.mobileOptionId` preseleziona
Nessuna opzione senza portabilita; con MNP sceglie la voce per Iliad/Coop/Poste/
Tiscali (alias Iliad Italia, CoopVoce, PosteMobile/PostePay) oppure MNP standard
per gli altri gestori. Usa catalogo attivo e soli collegamenti dell'offerta;
nessuna voce inventata o scelta arbitraria se ambigua/non disponibile. Senza
gestore o portabilita determinabili resta da scegliere. Campo Opzione visibile
come prima e modificabile: la correzione dell'operatore prevale fino a nuova
lettura/PDA, si conserva nel carrello/draft e al cambio offerta se ancora ammessa.
Metadato client `pda_opzione_manuale`, escluso dal payload DB; vecchie scelte
senza metadato si conservano. Punteggi e documenti dipendono dalla voce scelta,
sempre tramite il catalogo esistente; nessuna modifica dei punteggi di catalogo.
Codice rivenditore nascosto per tutte le categorie upload e fissato9001415852
(Legnago), anche nel backend create e nei restore/cart/payload: OCR, input
precedenti o client vecchi non possono cambiare il negozio del nuovo inserimento.
Storico e correzioni post-vendita invariati; nessuna migration o backfill.
Su istruzione del proprietario27/10: non usare il browser per i collaudi;
assistente esegue soltanto test interni/debug e controlli HTTP/CI. Test UI a cura
del proprietario fino a nuova indicazione.

Conferma cambio opzione27/10: quando si modifica una preselezione automatica
Mobile, popup MiroxUI con valore originale/proposto, Conferma modifica e
Mantieni scelta automatica. Fino alla conferma resta selezionato il valore
originale: nessuna variazione anticipata a punteggi, documenti o bozza. Annulla/
chiusura conserva la scelta automatica; conferma applica l'override manuale.
Scelte gia' manuali o senza preselezione non richiedono il popup. Nuova PDA
riparte dall'automatismo. Doppio cambio e conferme tardive su altra PDA/offerta/
contratto non applicano modifiche alla nuova compilazione. Nessun cambio DB.

Dispositivo automatico27/10: dove il catalogo consente la scelta, la PDA
preseleziona Si per dispositivo presente e No per assenza esplicita; dato mancante,
parziale o contraddittorio resta senza selezione. OCR non trasforma piu' campi
non letti in false. Prima di modificare la scelta automatica compare MiroxUI:
Conferma modifica oppure Mantieni scelta automatica. Fino al consenso il valore
precedente e IMEI/prezzo/acquisto restano invariati; annulla/chiusura li conserva.
Dopo conferma prevale la correzione manuale. Stato automatico/override conservato
in draft/carrello tramite pda_dispositivo_auto e pda_dispositivo_manuale (solo
client, esclusi dal payload DB), azzerato con nuova PDA; bozze legacy preservate.
Conferme tardive e doppio cambio protetti. Vincoli FWA Indoor e Customer Base con
telefono obbligatorio restano attivi: dispositivo Si e acquisto vincolato non
vengono sovrascritti dall'OCR. Campi positivi ancora precompilati; niente dati OCR
della pratica precedente riapplicati al contratto ripristinato. Nessuna migration,
dipendenza, riscrittura storica o cambio punteggi. Collaudi solo interni/HTTP, mai
browser su istruzione proprietario.

Tipo attivazione Fisso automatico27/10: dalla casella selezionata nella sezione
"Linea telefonica su cui attivare il servizio", nuova linea -> Nuova Attivazione,
numero attivo -> Portabilita. OCR visuale e testo PDF per coordinate leggono il
segno effettivo (compresa codifica WindTre); entrambe/nessuna casella selezionata,
sezione assente o illeggibile non producono una scelta. Nessuna deduzione da
telefono, codice migrazione o offerta. Campo visibile/modificabile: prima di
cambiare la preselezione compare MiroxUI; annulla conserva l'originale, conferma
applica l'override manuale. Doppi cambi e risposte tardive protetti. Auto/override
conservati in draft/carrello con pda_tipo_attivazione_auto e
pda_tipo_attivazione_manuale, esclusi dal payload DB; nuova PDA azzera lo stato,
bozze legacy conservano la scelta. Si usa la colonna tipo_attivazione esistente,
nessuna migration o riscrittura storica. Solo test interni/HTTP, senza browser.

Codici cliente WindTre anagrafici (27/10): una anagrafica puo' avere piu' codici,
conservati tutti senza sostituzione. Da PDA Mobile/Fisso/Customer Base si legge
"Codice Cliente", distinto dal codice contratto; testo con prefissi e zeri
iniziali, nessuna conversione numerica. Nuovo campo anagrafico nel wizard;
manuale obbligatorio dopo il controllo duplicati e prima dello staging. AI lo
compila dalla PDA; se assente/illeggibile/discordante chiede input, senza
riutilizzare il codice di un'altra PDA. Ogni contratto del carrello conserva il
proprio valore, anche in bozza; OTP e anti-duplicati contratto restano invariati.
Altri reparti non acquisiscono nuovi codici. Nuovi valori si aggiungono anche su
cliente esistente; assenza non cancella quelli registrati. Consultabili nella
scheda Anagrafiche e nell'export XLSX (celle testuali). Nessun backfill storico o
sincronizzazione automatica del vecchio codice cliente del Controllo Fissi.

Registro `anagrafica_codici_cliente_windtre` (PK anagrafica_id/codice_cliente,
FK indicizzata dal prefisso PK, created_at): RLS ON, niente grant anon/authenticated,
service_role solo SELECT/INSERT; upsert ignoreDuplicates senza UPDATE/DELETE.
Migration `20261027220802_anagrafica_codici_cliente_windtre.sql` applicata e riletta:
registro vuoto al rilascio, nessuna modifica a schema/RPC/RLS anagrafica/CC o
colonne contratto. `_lib/windtre-customer-codes.js` riusato da garantisci-anagrafica
e crea-vendita-pratica-carrello; search-anagrafica e gestisci-anagrafiche espongono
la relazione in left join dal backend. Core PDA separa normalizzazione codici
cliente/contratto. Chiamanti legacy senza nuovo campo restano compatibili; nuovo
wizard richiede sempre il codice cliente della PDA. Test esclusivamente interni/
HTTP, nessun browser. Verifica PostgreSQL isolata: `scripts/verifica-codici-cliente-sql.js`.

### Documento identita per contratto

Il documento d'identita e obbligatorio per ogni nuovo contratto. Nel carrello viene selezionato una sola volta; sulle bozze `upload-vendita-documento` crea un allegato e un PDF indipendente per ciascuna riga, con INSERT batch e pulizia delle nuove copie su errore. `finalize` impedisce l'invio se manca l'identita anche su una sola riga. Gli upload successivi da Verifica Contratti restano specifici della riga selezionata. Lo storico dal 1 luglio 2026 viene sistemato dallo script dedicato senza sovrascrivere documenti esistenti; i casi senza sorgente richiedono un'integrazione manuale.

### Compilatore disdette

La pagina `moduli/compilatore_disdette.html`, raggiungibile dal pannello Applicazioni della dashboard, gestisce `SIM Consumer`, `SIM Business`, `Fisso Consumer` e `Fisso Business`. Il backend sovrappone i dati con coordinate fisse ai quattro PDF originali tramite `pdf-lib`: non usa OCR né API AI. La data è precompilata con il giorno corrente ma resta l'unico dato facoltativo; tutti gli altri campi e le scelte pertinenti sono obbligatori. Ogni PDF contiene una sola utenza, normalizza in stampato maiuscolo tutti i dati inseriti, evidenzia il numero da disdire con dimensione maggiore, mantiene un distacco leggibile dalle righe prestampate e lascia vuoto lo spazio della firma manuale.

All’apertura compaiono le quattro tipologie di disdetta. Dopo la scelta si apre la ricerca cliente obbligatoria, con il modulo scelto indicato: selezionando un’anagrafica si apre direttamente il form con i soli dati CRM disponibili. Documento, CAP, utenza e ogni dato assente restano a carico dell’operatore. Se la ricerca riesce senza risultati appare «Nessuna anagrafica trovata» e il modulo scelto si apre vuoto per compilare tutti i dati manualmente. Errori di ricerca non consentono di proseguire. Modificare la ricerca azzera cliente e form mantenendo il tipo scelto; `Cambia modulo`, disponibile anche durante la ricerca, torna alle quattro scelte e azzera i dati precedenti.

Lo storico mostra tutte le disdette generate: nome, cognome e codice fiscale per i Consumer; ragione sociale e partita IVA per i Business; per entrambi visualizza anche il numero disdetto. `Duplica dati` richiede prima di scegliere SIM o Fisso nello stesso cluster cliente, poi avvia la ricerca CRM usando il CF/P.IVA dello storico. Dopo la selezione della stessa anagrafica apre il form con lo snapshot precedente, ancora modificabile. Se il cliente non viene trovato, il modulo parte vuoto; selezionando un altro cliente si usano soltanto i suoi dati CRM. Le disdette create prima dell’estensione dello storico restano consultabili ma non hanno uno snapshot ricostruibile.

Il PDF archiviato è accessibile solo tramite signed URL di 5 minuti restituito da `gestisci-disdette`. La migration additiva `database/063_compilatore_disdette.sql` crea la tabella server-only `disdette_generate` e il bucket privato `disdette-files`; `database/064_disdette_duplica_ricerca.sql` aggiunge numero disdetto e snapshot JSON server-only. Entrambe risultano applicate in produzione.

### Compilatore Subentri

`moduli/compilatore_subentri.html` è collegata alle Applicazioni della dashboard. All’apertura si sceglie Mobile o Fisso: Fisso è temporaneamente disabilitato. Mobile mostra cinque categorie; è implementato soltanto **Microbusiness a Privato**, mentre le altre quattro attendono le rispettive procedure dell’utente.

La scelta Microbusiness a Privato apre prima il popup documenti (carta d’identità fronte/retro del subentrante, tessera sanitaria fronte/retro del subentrante, visura camerale), poi due ricerche indipendenti: cedente Business soltanto per partita IVA completa di 11 cifre, subentrante privato soltanto per codice fiscale personale completo di 16 caratteri. La validazione è condivisa tra browser e server; nominativi e codici parziali non sono accettati. Dopo la selezione la barra e il messaggio di ricerca scompaiono: l’intestatario e il suo identificativo sono mostrati in evidenza con un piccolo tasto `Annulla`. Questo riapre la sola ricerca interessata, svuota il codice e invalida il modulo mantenendo l’altro intestatario selezionato. Il modulo si apre quando entrambe sono concluse con selezione o ricerca riuscita senza risultati. In quest’ultimo caso i dati del soggetto non trovato restano vuoti. Errori e risposte tardive non sbloccano il form. I dati CRM disponibili vengono precompilati e restano modificabili; la ricerca non scrive su `anagrafica`.

Il form distingue impresa con delegato e libero professionista/artigiano, raccoglie i dati del subentrante e da 1 a 100 numeri italiani, con quattro numerazioni per pagina e ripetizione automatica del modulo sui numeri successivi. Tutti i campi pertinenti sono obbligatori tranne località e data di sottoscrizione, precompilata con oggi Europe/Rome e cancellabile. Il codice di domiciliazione non viene richiesto. I pagamenti sono esclusivamente IBAN (anche estero con checksum valido) o bollettino; i dati del sottoscrittore e dell’intestatario del conto sono distinti e copiabili esplicitamente. I sei consensi richiedono una scelta Sì/No senza preselezioni. Le firme restano vuote e il testo è stampato in maiuscolo nero sul modello originale. Le sezioni prestampate non pertinenti, compresa la carta di credito, restano vuote.

Sotto luogo e data si sceglie esplicitamente fra **Invia pratica** e **Compilazione standard**, senza preselezioni. Invia pratica archivia nel CRM il PDF con i documenti obbligatori; la compilazione standard genera e archivia soltanto il PDF e non richiede né carica allegati. La sezione upload compare solo per Invia pratica, dopo la scelta; passando a standard si svuotano gli eventuali file selezionati. Il popup iniziale mostra i tre documenti in elenco puntato e chiarisce quando sono richiesti. Per Invia pratica i tre gruppi di allegati sono obbligatori: un PDF fronte/retro o immagini separate per identità/tessera, più visura. Sono ammessi PDF, JPEG e PNG, fino a quattro file per gruppo, 4 MiB ciascuno. Gli upload passano solo da `gestisci-subentri`; il server verifica contenuto, MIME, dimensione e SHA256 contro il manifest immutabile della bozza prima di generare il PDF. Un retry della stessa compilazione riusa UUID e file verificati. La generazione e lo storico usano `subentri_generati` e il bucket privato server-only `subentri-files`; PDF/allegati si aprono tramite signed URL di cinque minuti; il popup condiviso conserva l’estensione corretta anche per JPEG/PNG. Lo storico globale autenticato espone modalità, cedente, subentrante, numeri, data, operatore, PDF e duplicazione; il tasto Allegati compare solo per Invia pratica. La duplicazione richiede nuovamente entrambe le ricerche e recupera lo snapshot solo con gli stessi due identificativi: consensi e modalità vanno scelti di nuovo, gli allegati sono nuovamente richiesti solo per Invia pratica. Nessun invio a destinatari esterni.

Migration `database/20261018180938_compilatore_subentri.sql` applicata e verificata il 18/10/2026: nuovo archivio isolato con RLS e privilegi solo service role, nessuna modifica a tabelle/RPC/policy CRM o Call Center condivise. La migration `database/20261018184140_subentri_modalita_compilazione.sql` aggiunge la modalità persistita e consente manifest vuoto solo per standard; già applicata, con RLS/privilegi invariati. Pubblicazione iniziale autorizzata dal proprietario il 18/10/2026; pubblicazione della nuova scelta richiesta il 19/10/2026, esito nel promemoria.

### Regole di integrità vendita

- **Punto vendita**: `9001415852` = Legnago, `9000822241` = Cerea. Il valore selezionato/OCR viene propagato dal carrello al backend. Day by Day e Avanzamento Mensile contano Legnago; dal 08/10/2026 la riga FISSI Standard include anche Cerea; Gare Individuali conta entrambi i negozi, salvo il perimetro specificato dalla gara mensile (Assicurazioni ottobre: solo Legnago).
- **Telefoni Customer Base nelle gare**: `TELEFONI CB` in Gare Individuali e Avanzamento Mensile segue la stessa definizione del KPI Consumer: categoria Customer Base, cluster Consumer, offerta `Telefono Incluso`, dispositivo associato e acquisto VAR o Finanziamento. Cambi Piano e Caring non contribuiscono al conteggio telefoni. Per il bonus CB di ottobre 2026 sono richiesti separatamente 35 telefoni e 15 cambi piano: solo TIED Consumer e `Cambio Piano - MOBILE` Business, equiparato dal proprietario; 100 EUR soltanto se entrambe le soglie sono raggiunte.
- **Gare ottobre 2026**: TIED individuali 35 pezzi/100 EUR; Assicurazioni di squadra 10 punti reali di Francesca, Matteo e Mirko a Legnago, 50 EUR a ciascuno. Le regole sono salvate negli obiettivi di ottobre, con descrizioni mensili e storico precedente preservato. Admin mostra entrambi gli obiettivi CB e permette di modificarne soglie e bonus. Configurazione applicata il 06/10/2026 dopo il deploy del motore compatibile; i 9 obiettivi sono stati riletti e lo storico verificato invariato. `database/configura_gare_2026_10.sql` conserva il default di sola verifica.
- **Produzione e compensi di squadra** (28/10/2026): nelle gare e nei PNG, Attuale distingue contributo personale e totale squadra; per Assicurazioni ottobre entrambi sono punti, con bonus comune a 10 punti. PARTITA IVA conserva il conteggio personale ma calcola il compenso sul totale squadra: a 37 complessivi la soglia 35 riconosce 150 EUR per ciascuno, anche a chi ha produzione zero. Nessuna modifica a obiettivi, dati o scaglioni configurati.
- **Fissi nell’Avanzamento Standard** (08/10/2026): Consumer e Business di Legnago e Cerea, KO esclusi. La correzione del 31/10 include anche i reinserimenti Fisso finalizzati (vedi sotto). Non-FTTC nel mese di firma con stato `Da completare`, `In Attivazione` o `Attivo`; FTTC solo Attivo nel mese di attivazione. Inclusi anche i Fissi ancora da verificare, senza riga post-vendita. Pezzi per operatore e punteggio totale reale, stessa regola per pagina, PNG e Target.
- **Conteggio Netto Luce & Gas** (26/10/2026): nella riga Standard, dopo Eccedenza, testo nero normale con numero di contratti aventi stato valorizzato, esclusi Annullato/Rifiutato e trattini. Stesso mese e perimetro della riga (Legnago, Consumer/Business, no reinserimenti), un pezzo per contratto. Accanto, data/ora italiana dell’ultimo aggiornamento CSV registrato globalmente in Controllo L&G; senza registrazioni indica non disponibile. Incluso nel PNG della pagina; conteggi e avanzamenti ordinari conservati. Zona extra bianca senza righe prolungate; il pulsante info apre un popup compatto con i soli esiti e il numero di contratti per ciascuno, senza dettagli dei contratti o clienti. Per quelli senza stato: inserimento dopo l’ultimo CSV = Da verificare; prima/uguale = Contratto non trovato. Usa la Data Inserimento del Controllo L&G; nessuna modifica degli stati a DB.
- **Luce & Gas P.IVA ed Extra Gara P.IVA** (22/10/2026): escludono `Rifiutato` e `Annullato` sia dai pezzi sia dai punti extra; gli altri stati e l’assenza del controllo post-vendita restano ammessi. Stesso filtro per Dashboard, PNG e Target; nessuna modifica alla riga Standard.
- **Cambi piano nell’Avanzamento Mensile**: la riga `CAMBI PIANO`, tra `TELEFONI CB` e `FISSI`, conta TIED Consumer e `Cambio Piano - MOBILE` Business a Legnago, senza reinserimenti. Mostra i pezzi per operatore e la somma come punteggio (1 per cambio); obiettivo del mese configurabile da Admin. Disponibile anche nei mesi precedenti, nell’export PNG e nel report mensile Target tramite il catalogo condiviso.
- **Export Dashboard Pezzi**: in Gare Individuali ogni operatore ha il proprio download PNG, limitato alla sua scheda; in Avanzamento Mensile un solo download genera un PNG che contiene entrambe le tabelle del mese selezionato. L'esportazione usa `html2canvas@1.4.1`, già adottato dal Simulatore Protecta.
- **Simulatore Protecta**: il preventivo viene registrato solo se l'upload server-side restituisce un `storage_path` valido. In caso di errore o risposta incompleta il salvataggio viene interrotto, così la lista non mostra pratiche recenti senza PDF.
- **Sconti Protecta**: il simulatore consente di attivare separatamente uno sconto sull'anticipo e uno sulla rata mensile. Il preventivo mostra listino barrato e valore applicato; con finanziamento confronta le rate prima e dopo l'applicazione della tabella finanziaria e segnala quando la rata resta invariata per la stessa fascia.
- **Elementi aggiuntivi preventivo Protecta**: il `Totale sconto` è un'evidenza commerciale separata, attivabile e compilabile manualmente, mostrata in grande nella parte finale del riepilogo/PDF senza alterare i calcoli di anticipo o rata. La `Scadenza preventivo` è un testo manuale indipendente, riportato tra canone totale mensile e rimborso detrazione fiscale, con testo maggiorato.
- **Reinserimenti**: un contratto può essere marcato come reinserimento solo rispetto a un contratto dello stesso cliente, stessa categoria, **stesso mese solare Europe/Rome** e stato post-vendita idoneo. La regola è verificata sia nel wizard sia server-side.
- **Correzione reinserimenti Fisso (31/10/2026)**: il nuovo Fisso inviato contribuisce a pezzi e punteggio nell’Avanzamento Mensile Standard/P.IVA/Extra secondo il proprio stato e la tecnologia; in KO esce dal conteggio. Il completamento dell’upload mette automaticamente in KO il solo contratto origine nella stessa transazione, con audit; un upload fallito non lo modifica. Il Day by Day conserva soltanto l’originale nel giorno iniziale. Bozze escluse dal mensile; Gare Individuali e altre categorie conservano i filtri precedenti. Pagina, PNG e Target condividono il calcolo. Migration `database/20261031122329_reinserimenti_fisso.sql` applicata production come `20261031123549` prima del deploy: recuperati i tre reinserimenti Fisso gia inviati, senza accodare verifiche documentali o notifiche. Due sono di ottobre e contribuiscono con 2 pezzi/2,50 punti. Esito pubblicazione nel promemoria.
- **Invio documenti**: la pratica nasce `bozza`; diventa `inviata` soltanto dopo tutti gli upload. Se un documento fallisce, il rollback compensativo elimina pratica incompleta, contratti e file già caricati; il cron giornaliero recupera eventuali bozze orfane oltre 24 ore.
- **Carrello multi-contratto**: dopo il salvataggio di ogni contratto, il wizard conserva l'anagrafica della pratica ma azzera categoria, PDA, firma e campi specifici. Il contratto successivo deve quindi partire da una nuova selezione esplicita e da un nuovo PDF quando richiesto. Se la pratica contiene più contratti della stessa categoria, PDA e scansioni firmate ricevono nomi progressivi (`contratto_mobile.pdf`, `contratto_mobile_2.pdf`, ecc.) per evitare collisioni nello Storage.
- **Navigazione post-vendita**: Controllo Fissi, Controllo L&G, Controllo Assicurazioni e Controllo Allarmi mostrano `Vai alla pratica` su ogni riga. Il link apre direttamente il contratto specifico in Verifica Contratti, selezionando automaticamente la tab coerente con lo stato corrente. Controllo L&G ordina sempre l'elenco per Data Inserimento decrescente, dalla pratica piu' recente alla piu' datata, e permette di filtrarlo anche per operatore.
- **Identità e autorizzazioni operative**: `operatore_id` e `uploaded_by` derivano sempre dal JWT autenticato. Rimborso manuale ed esito manuale Controllo L&G restano disponibili soltanto agli account `admin`. Nel riepilogo Apri/Chiudi, ogni account autenticato attivo può esitare una pratica `IN CORSO` come `KO`, tramite Netlify Function; il backend ricontrolla atomicamente lo stato prima dell'aggiornamento.
- **Scritture protette**: il browser non ha policy INSERT/UPDATE/DELETE sui bucket dati e sui rimborsi, né INSERT/DELETE su `vendita_documenti` o UPDATE su `vendita_contratti`. Upload, rimborsi, rimozioni e verifica passano dalle Netlify Functions autenticate.
- **Informativa CRM**: le versioni correnti sono `v6_2026_07_26` (cartacea, una pagina A4 in bianco e nero con corpo 10 pt e scelta marketing già marcata) e `v6_2026_07_26_dig` (digitale OTP, tre pagine con ACCONSENTO/NON ACCONSENTO esplicito). La ragione sociale del Titolare è riportata nella forma esatta `KONA TECH SRL`. La scelta binaria è obbligatoria prima del download cartaceo o dell'invio OTP, mentre il consenso marketing resta facoltativo. Finalità, basi giuridiche, conservazione e perimetro del consenso sono equivalenti; i ricontatti di servizio restano separati dal marketing. Le versioni precedenti rimangono evidenza storica ma non vengono riutilizzate.
- **Numerazioni mobili legacy**: i campi che validano rigidamente un cellulare accettano 9 o 10 cifre nazionali. Il flusso OTP richiede l'inizio con `3` e normalizza entrambe le lunghezze nel formato E.164 `+39...`; restano accettati anche i numeri internazionali già espressi in E.164.
- **Sicurezza frontend**: tutti gli script CDN sono versionati e protetti da SRI; `MiroxSafe` codifica i dati dinamici; Netlify invia CSP, HSTS e Permissions-Policy. Il deploy pubblica esclusivamente la build `dist/`: sorgenti server, migration, test e documentazione non sono raggiungibili dal sito. La build genera `config.js` e CSP con l'host Supabase dell'ambiente; ogni branch Netlify diversa da `main` viene trattata come staging, richiede credenziali pubbliche dedicate e rifiuta il project ref di produzione. La CSP mantiene temporaneamente `'unsafe-inline'` perché le pagine statiche legacy contengono ancora script e handler inline.

## Setup locale

```bash
npm install
npm run build     # genera dist/ con i soli file frontend pubblici
npm test          # rigenera dist/ + suite regressione, sintassi e link locali
npx netlify dev   # serve frontend + functions su http://localhost:8888
```

Per le functions in locale servono le env vars (vedi sotto). Mettile in un file `.env` nella root o passale a `netlify dev`.

La build locale senza variabili continua a usare la configurazione frontend di produzione per compatibilita'. Per simulare lo staging in locale sono obbligatorie tutte e tre:

```bash
MIROX_DEPLOY_ENV=staging \
MIROX_PUBLIC_SUPABASE_URL=https://<PROJECT_REF_STAGING>.supabase.co \
MIROX_PUBLIC_SUPABASE_ANON_KEY=<PUBLISHABLE_KEY_STAGING> \
npm run build
```

La build staging fallisce se riceve il project ref di produzione o una service role/secret key.

## Deploy Netlify

- **Netlify site**: `mirox-crm` (rinominato il 2026-07-02 in coerenza col repo GitHub `mirkopiasenti/mirox-crm`)
- **Production URL**: [`mirox-crm.it`](https://mirox-crm.it) (custom domain, dal 2026-06-29). Qui sono configurate tutte le env vars, comprese OpenAI e Telegram per KONA AI Guardian
- Vecchio URL di test `test-upload-contratti-konahub.netlify.app` non è più aggiornato — deprecato
- **NON confondere** con `mirox-crm.netlify.app`: è un altro Netlify site, di un altro repo GitHub, che ospita il Call Center prod. Condivide solo il DB Supabase

Setup:
1. Repo già collegato su Netlify (site `mirox-crm`)
2. Le build settings vengono lette da `netlify.toml`: `npm run build` genera `dist/`, unica publish directory. La root del repository non viene esposta
3. Imposta le env vars nel pannello Netlify (sezione Site settings → Environment variables)
4. Deploy automatico al `git push origin main`

Guardian opera solo sul sito ufficiale; il proprietario ha autorizzato sviluppo e collaudo direttamente in produzione il 05/10/2026. Nessun ambiente Guardian separato da ricreare.

I workflow Guardian e `.github/codex/` sono su `main`. Analisi read-only e patch partono da `main`; le patch usano branch `codex/kg-*`, test locali e PR draft verso `main`. Tutte le esecuzioni richiamano l'Environment `guardian-production`; merge e deploy richiedono autorizzazione del proprietario.

## Workflow di aggiornamento

Il repo è sincronizzato con GitHub via `git` (chiave SSH già configurata). Remote: `git@github.com:mirkopiasenti/mirox-crm.git` (dal 2026-07-02, prima `konahub-vendita-test`). Per ogni modifica:

```bash
git add -A
git commit -m "Descrizione modifica"
git push origin main
```

**Non caricare più file tramite l'interfaccia web GitHub** (`Add files via upload`): si creerebbe drift fra locale e remoto, esattamente il problema che abbiamo risolto in fase di setup. Se proprio serve modificare qualcosa al volo dalla web UI, sincronizza poi qui con `git pull` prima di riprendere a lavorare in locale.

### Collaborazione AI

Dal 2026-07-25 **Codex è l'assistente principale per tutto lo sviluppo**: analisi, fix, nuovi moduli, functions, migration, refactor e documentazione. Claude Code resta parte della cronologia del repository e può essere usato dall'utente in modo occasionale; l'OCR dei PDA continua invece a usare la **Claude API** fino alla futura migrazione a OpenAI.

- Aggiornare README + `AGENTS.md` + `CLAUDE.md` + `database/README.md` nella stessa sessione della modifica (no doc drift)
- No emoji in HTML/JS visibili, no `alert/confirm` nativi (usare `MiroxUI.*`), no `fetch` diretto (usare `MiroxApi.fetch`) — vedi convenzioni in `AGENTS.md`
- Prima di chiudere una modifica eseguire almeno `npm test`
- Commit locali in autonomia, `git push` **solo su richiesta esplicita** dell'utente (ogni push è deploy production su `mirox-crm.it`)
- Nessuna azione irreversibile (DROP, `push --force`, revoca policy RLS, cambio env var) senza conferma
- Prima di iniziare un task, leggere `git log --oneline -20` per allinearsi con l'ultima sessione dell'altro assistant
- Ogni nuova chat in questa cartella deve leggere esplicitamente [`docs/STATO_LAVORO.md`](docs/STATO_LAVORO.md) prima di esplorare il repository, come prescritto all'inizio di `AGENTS.md` e `CLAUDE.md`: controllare lo stato Git, poi concentrarsi sui file pertinenti. Aggiornare il promemoria a fine intervento; un altro checkout/worktree deve contenere gli stessi file. Le guide e le verifiche necessarie restano vincolanti

Dettagli e regole complete in [`AGENTS.md`](AGENTS.md); [`CLAUDE.md`](CLAUDE.md) resta sincronizzato per compatibilità con eventuali sessioni Claude Code.

## Env vars Netlify

| Variabile | Obbligatoria | Note |
|---|---|---|
| `SUPABASE_URL` | sì | `https://lbgwamhjkjjfwgusafbi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Service role key (NON la anon/publishable — solo lato server) |
| `MIROX_DEPLOY_ENV` | sì nello staging | `staging`; su `main` il default e' `production` |
| `MIROX_PUBLIC_SUPABASE_URL` | sì nello staging | URL pubblico del progetto Supabase staging, generato in `dist/js/config.js` |
| `MIROX_PUBLIC_SUPABASE_ANON_KEY` | sì nello staging | Publishable/anon key staging; service role e secret key vengono rifiutate |
| `ANTHROPIC_API_KEY` | sì | Chiave Claude API per la function `ocr-pda` (estrazione AI dati dal PDA) |
| `SMTP_USER` | sì | Account Gmail mittente |
| `SMTP_PASS` | sì | App Password Gmail |
| `SMSHOSTING_API_KEY` | sì (per consensi OTP) | Username API Smshosting (vedi `docs/SMSHOSTING_SETUP.md`) |
| `SMSHOSTING_API_SECRET` | sì (per consensi OTP) | Password API Smshosting |
| `SMSHOSTING_SENDER` | no | Mittente alfanumerico SMS, max 11 caratteri. Default `MIROX`. Va dichiarato in fase di setup account Smshosting |
| `SMSHOSTING_SIMULATE` | no | `true` per attivare modalità simulazione (logga SMS senza inviarlo). Utile per test dev senza spendere credito |
| `NOTIFICA_RIENTRO_TO` | no | Default `mirko.piasenti@gmail.com` |
| `MAIL_FROM_NAME` | no | Default `Mirox CRM` |
| `OPENAI_API_KEY` | sì (per Guardian AI) | Responses API e Audio Transcriptions; solo lato server |
| `OPENAI_GUARDIAN_MODEL` | no | Default `gpt-5.6-luna` |
| `OPENAI_TRANSCRIBE_MODEL` | no | Default `gpt-transcribe` |
| `TARGET_ENABLED` | per Target | `true` abilita il bot esclusivamente production; default spento |
| `TELEGRAM_TARGET_BOT_TOKEN` | per Target | Token del bot MIROX AI - Target, backend-only |
| `TELEGRAM_TARGET_OWNER_CHAT_ID` | per Target | chat_id privato di Mirko |
| `TELEGRAM_TARGET_WEBHOOK_SECRET` | per Target | Segreto webhook dedicato, almeno 32 caratteri |
| `TARGET_WORKER_SECRET` | per Target | Segreto HMAC distinto, almeno 32 caratteri |
| `OPENAI_TARGET_API_KEY` | per Target | Chiave OpenAI dedicata a dialogo e trascrizioni Target; nessun fallback sulla chiave Guardian |
| `OPENAI_TARGET_MODEL` | no | Modello dialogo Target; default `gpt-5.6-luna` |
| `OPENAI_TARGET_TRANSCRIBE_MODEL` | no | Modello vocali Target; default `gpt-transcribe` |
| `TELEGRAM_GUARDIAN_BOT_TOKEN` | sì (per Telegram Guardian) | Token del bot dedicato; mai nel frontend |
| `TELEGRAM_GUARDIAN_OWNER_CHAT_ID` | sì (per Telegram Guardian) | Unico `chat_id` autorizzato, appartenente a Mirko |
| `TELEGRAM_GUARDIAN_WEBHOOK_SECRET` | sì (per Telegram Guardian) | Segreto casuale verificato nell'header webhook |
| `KONA_AI_OWNER_PROFILE_ID` | sì (per audit completo) | UUID del profilo Mirko nell'ambiente Supabase corrente |
| `GUARDIAN_WORKER_SECRET` | sì per worker Codex | Segreto HMAC condiviso esclusivamente tra Netlify e GitHub Actions; mai nel frontend o nel repository |
| `GUARDIAN_GITHUB_TOKEN` | sì per dispatcher Codex | Fine-grained token GitHub limitato al repository e all'avvio dei workflow; solo Netlify server-side |
| `GUARDIAN_GITHUB_REPOSITORY` | no | Default `mirkopiasenti/mirox-crm`; repository esplicito del dispatcher |
| `GUARDIAN_OBSERVER_ENABLED` | no | Default `true`; consente di mettere in pausa il cron Observer senza rimuovere la raccolta eventi |
| `GUARDIAN_OBSERVER_DAILY_BUDGET` | no | Default `10`; massimo di analisi automatiche Codex al giorno per ambiente |
| `GUARDIAN_OBSERVER_MODEL` | no | Default `gpt-5.6-luna`; modello usato dal workflow Observer |
| `GUARDIAN_OBSERVER_REF` | no | Ref GitHub osservato dal cron; default `main` |
| `GUARDIAN_OBSERVER_WEEKLY_SCAN` | no | Default `true`; abilita la scansione preventiva settimanale delle migliorie |
| `GUARDIAN_TELEMETRY_HASH_SECRET` | consigliata | Segreto HMAC server-side per anonimizzare gli attori negli eventi tecnici; fallback temporaneo a `GUARDIAN_WORKER_SECRET` |

## Modulo Call Center (integrato, Fase 1)

A partire dal 2026-06-20 il progetto Call Center — fino a quel momento deployato a parte su `mirox-crm.netlify.app` — è integrato dentro Mirox Completo in `moduli/call-center/`. L'integrazione è **additiva**: il deploy CC esistente continua a funzionare invariato (entrambi puntano allo stesso project Supabase `lbgwamhjkjjfwgusafbi`).

### Cosa c'è in `moduli/call-center/`

11 pagine portate dal CC e i loro asset (`js/`, `assets/`):

- `registra-chiamata.html` (cuore CC: cerca CF/PIVA → registra esito)
- `elenco-chiamate.html`, `rilavorazione.html` (rilettura via viste unificate `vw_elenco_chiamate_unificate` / `vw_rilavorazione_ricontatti_unificata`)
- `appuntamenti.html`, `appuntamenti-oggi.html`, `prenota-interno.html`, `esiti-appuntamenti.html` (gestione appuntamenti)
- `blacklist.html` (clienti da non contattare)
- `call-center-lead-outbound.html`, `prenota-interno-outbound.html`, `registra-chiamata-outbound.html` (flusso outbound business)
- `prenota.html` (form pubblico per prenotazioni da sito/social — **non in dashboard**, raggiungibile solo via URL diretto)

La pagina di configurazione del CC (utenti, orari, blocchi, parametri) è stata spostata fuori dal modulo in [`admin-call-center-config.html`](admin-call-center-config.html) sotto il pannello Admin Mirox.

### Adattamenti applicati nel port

Le pagine sono state copiate **mantenendo la loro logica interna** (testata in produzione da mesi). Modifiche fatte solo:

- Redirect login: `window.location.href='index.html'` → `'../../index.html'` (nelle pagine HTML e in `js/auth.js`, `js/call-center-lead-outbound.js`, `js/prenota-interno-outbound.js`, `js/registra-chiamata-outbound.js`)
- Aggiunto breadcrumb "← Torna alla dashboard Mirox" in cima a ogni pagina (eccetto `prenota.html` pubblica)
- Rimosso `index.html` del CC (Mirox ha già il proprio login)
- Sidebar CC laterale **mantenuta** dentro il modulo: è la navigazione nativa fra pagine CC. Il bottone "Esci" della sidebar usa il logout Mirox via `Auth.logout()` → `../../index.html`

### Accesso dalla dashboard Mirox

- **Solo bottone topbar** "Call Center" (la dashboard ha solo tab Vendita / Post-Vendita; il CC non ha tab/card dedicate, la sua sidebar interna è già la navigazione)
- Al login, il JS calcola la prima pagina CC accessibile in `profilo.pagine_accessibili` e imposta l'`href` del bottone topbar a quell'URL. Se l'utente non ha nessun permesso CC (e non è admin), il bottone resta `disabled`
- Chiavi permessi del CC: `registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`. La vecchia chiave `configurazione` resta in DB per compatibilità col CC prod ma non è più usata da Mirox. Anagrafiche appartiene invece al tab Post-Vendita ed è disponibile a tutti gli account CRM attivi: tutti possono modificare dopo conferma, mentre solo gli admin possono richiedere l'eliminazione di una riga senza collegamenti storici
- Dentro ogni pagina CC: bottone arancione "← Torna alla dashboard Mirox" in cima

## Pannello Admin Mirox

Il nuovo reparto **Personale → Planning dipendenti** (`admin-planning.html`, rilascio29/10) gestisce turni da novembre2026 per Legnago: Matteo, Vincenzo e Isabella. Orari ricorrenti modificabili, alternanza lunedi mattina/sabato pomeriggio con assegnazione iniziale manuale, ferie/permessi/malattia a ore o giornata e codice malattia facoltativo, consuntivi e straordinari manuali. Ore contrattuali distinte dalle programmate (Isabella35programmate confermate), nessun saldo residuo o banca ore. La bozza resta separata dal planning approvato; login dipendente collegato esplicitamente, solo lettura del proprio pubblicato. PDF collettivo e personale senza causali, scheda ore dettagliata solo Admin; nessun invio automatico. Migration privata applicata20261029210434, rilascio verificato online29/10; nessun account o tabella CC modificati. [Guida operativa e verifiche](docs/PLANNING_PERSONALE.md). Debug29/10 completato: cambio mese/annullamento ed errori preservano la versione corretta, letture personali fallite svuotano la vista, configurazione ritentabile e alternanza da applicare prima di pubblicare. PDF collettivi con nomi lunghi corretti; suite completa580/580, SQL/DOM/PDF verificati senza browser. Nessun deploy o DB modificato.


- **Permessi pagine** (`admin-permessi.html`) — utenti identificati tramite nome/username del profilo; scegli un utente e abilita le pagine di Vendita, Post-Vendita e Applicazioni. Le pagine escluse scompaiono dalla navigazione, i reparti vuoti si nascondono e i link diretti sono bloccati. API, RLS e allegati applicano le stesse autorizzazioni; i dati condivisi necessari a Storico Cliente/Dashboard restano consultabili da chi ha quei moduli. Copia da altro operatore, riepilogo prima del salvataggio, controllo versione e audit atomico. Admin attivi con accesso completo; utenti gia presenti conservati al primo rilascio, nuovi utenti/pagine richiedono abilitazione esplicita. Non altera i permessi CC. Rilascio 27/10/2026; migration applicata e accessi iniziali conservati. Procedura e limiti in [`docs/PERMESSI_PAGINE.md`](docs/PERMESSI_PAGINE.md).

Dal 2026-06-24 il bottone **Admin** della topbar dashboard è attivo per gli utenti con `ruolo='admin'` e porta a [`admin.html`](admin.html). Dal 2026-07-27 l'area usa una shell condivisa responsive: sidebar persistente a sinistra e modulo operativo a destra. Il reparto espandibile **Configurazioni**, aperto all'ingresso, raccoglie:

- **Gestione Utenti** ([`admin-utenti.html`](admin-utenti.html)) — tabella `profili`: cambio ruolo admin↔operatore, abilita/disabilita, modale permessi granulari Call Center, flag `in_gara`. Un admin non può togliere il proprio ruolo né disabilitarsi
- **Configurazione Call Center** ([`admin-call-center-config.html`](admin-call-center-config.html)) — orari settimanali, blocchi/chiusure, parametri di sistema (durata slot, anticipo, scadenze). Spostata da `moduli/call-center/configurazione.html` (eliminata)
- **Catalogo Vendita** ([`admin-vendita-config.html`](admin-vendita-config.html)) — CRUD categorie/offerte/opzioni/reload. Ora gated dal ruolo `admin` (prima era protetto da una password client-side `1234`, rimossa)
- **Gare & Avanzamento** ([`admin-gare.html`](admin-gare.html)) — configura metriche + obiettivi mensili per operatore + regole compenso a scaglioni + bonus una tantum. Bottone "Duplica dal mese precedente" per ripartire velocemente ad ogni cambio gara. Alimenta le tab "Gare Individuali" e "Avanzamento Mensile" del modulo `dashboard_pezzi`

Il secondo reparto **KPI** contiene **Vendita - Consumer** ([`admin-kpi-vendita-consumer.html`](admin-kpi-vendita-consumer.html)), **Vendita - Business** ([`admin-kpi-vendita-business.html`](admin-kpi-vendita-business.html)) e **Call Center** ([`admin-kpi-call-center.html`](admin-kpi-call-center.html)). Le due pagine Vendita condividono le categorie `Mobile`, `Fisso`, `Luce & Gas`, `Allarmi`, `Assicurazioni` e i filtri anno/punto vendita/operatore; il Consumer aggiunge `Customer Base` tra Fisso e Luce & Gas. Il filtro operatore offre `Tutti` o un singolo profilo canonico e aggiorna immediatamente tutte le tabelle, senza un dettaglio operatori separato in fondo alla pagina. Il KPI Call Center offre filtri anno, mese, vista e operatrice, con viste giornaliera, settimanale e mensile. Su viewport mobili la sidebar diventa un menu richiudibile. Navigazione, stato attivo, profilo e logout sono generati da `js/admin-shell.js`; aspetto e adattamento responsive sono centralizzati in `css/admin-shell.css` e `css/admin-kpi.css`.

Nel KPI Call Center le righe di `chiamate` sono classificate come Consumer e quelle di `call_center_lead_outbound_chiamate` come Business outbound; entrambe usano `data_ora` in `Europe/Rome` e una chiamata è “con risposta” quando l'esito è diverso da `non_risposto`. I nuovi appuntamenti seguono `appuntamenti.created_at` e richiedono `originato_da_id IS NULL`; le righe nate da uno spostamento sono mostrate separatamente come rischedulate. Presentati, non presentati, vinti/persi e annullati seguono invece la data prevista `appuntamenti.data_ora`. Una chiusura automatica con motivo `Chiuso automaticamente: cliente passato in anticipo` è una conversione anticipata: incrementa i vinti e non gli annullati. `Da esitare` conta i presentati senza `esito_finale`. L'attribuzione all'operatrice usa `fissato_da_operatore_id` e consolida gli account storici tramite `profili.alias_di`; le prenotazioni pubbliche prive di operatrice restano visibili come `Online / non assegnato`. La pagina calcola tassi di risposta, appuntamento su tutte le chiamate e sulle risposte, presenza, chiusura e completamento esiti.

Per i KPI Mobile Consumer si leggono le righe di `vendita_contratti` con `categoria_snapshot='Mobile'` e `cluster_cliente='Consumer'`, più le offerte FWA Indoor Consumer archiviate nella categoria Fisso; il mese deriva da `data_contratto` in `Europe/Rome`. Le acquisizioni sono la somma di Tied e Untied: Tied comprende FWA Indoor, Tied Call Your Country, Tied Underground e Tied Dati; Untied comprende le varianti Untied/United e Call Your Country. `Sim Convergente` e `Smart Security` sono escluse. La tabella mostra inoltre la percentuale mensile e YTD di Tied sul totale Tied + Untied. Le MNP sono separate fra opzione standard e opzione gestori selezionati. Il dettaglio Smartphone usa il flag reale `dispositivo_associato` delle sole righe Mobile e divide il totale tramite `tipo_acquisto` tra `VAR` e `Finanziati`; il modem FWA Indoor non viene contato come Smartphone. Il filtro operatore consolida gli account storici tramite `profili.alias_di`, mentre il filtro negozio usa i codici Legnago/Cerea già presenti sui contratti.

Per il Fisso, acquisizioni, tecnologie ed esiti correnti restano attribuiti al mese di `data_contratto`; `Da completare`, assenza della riga post-vendita e `In Attivazione` confluiscono nella riga `IN ATTIVAZIONE`. Fissi attivati e Apri/Chiudi seguono invece `post_vendita_controllo_fissi.data_attivazione`. Le percentuali Apri/Chiudi usano come denominatore tutti i Fissi attivati nel mese; il mix FTTH/FTTC/FWA somma al 100% sulle acquisizioni con tecnologia valorizzata.

Il tab Customer Base Consumer usa `categoria_snapshot='Customer Base'` e il mese di `data_contratto`. `Telefono incluso` conta soltanto i contratti con dispositivo associato e divide `tipo_acquisto` tra `Finanziati` e `VAR`, mostrando anche la loro somma. `Cambi piano` separa esclusivamente le offerte `Cambio Piano - TIED` e `Cambio Piano - UNTIED`, con totale. `Caring` mostra `CB Caring - FISSO` e `CB Caring - MOBILE` senza riga totale.

Per Luce & Gas lo stato `Attivato` viene letto da `post_vendita_controllo_lg`, ma il conteggio resta attribuito al mese di inserimento del contratto. Anche gli Allarmi con stato `OK` sono attribuiti al mese di inserimento e vengono divisi tra `Anticipo` e `Finanziamento`. Per le Assicurazioni i punti sono la somma di `vendita_contratti.punteggio_gara_totale`.

La pagina Business riusa le metriche comuni applicando `cluster_cliente='Business'`; la scheda Customer Base e le relative regole restano esclusivamente Consumer. L’endpoint rifiuta cluster diversi dai due valori ammessi.

Il vecchio bottone "Admin" nel wizard `upload-contratti-vendita.html` è stato rimosso: il pannello Admin si raggiunge esclusivamente dal bottone topbar della dashboard.

### Regole di coordinamento col CC prod (NON NEGOZIABILI)

Il CC prod su `mirox-crm.netlify.app` legge le stesse tabelle. Per non romperlo:

1. **Solo modifiche DB additive** — mai DROP/RENAME colonne, mai CHECK più stretti, mai modificare RPC esistenti (solo aggiungerne di nuove)
2. **RLS nuove devono includere anche i path vecchi** (es. `crm_can_access_page('registra_chiamata') OR crm_can_access_page('cc_registra_chiamata')`) — usare le chiavi esistenti senza prefisso (deciso così nella sessione di Fase 1)
3. Tutte le modifiche allo schema vanno discusse con l'utente prima di applicarle

### Fasi 2 e 3 — applicate nella stessa sessione

- **Fase 2** (eseguita): vista `storico_cliente` estesa con 4 UNION nuove (`chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`). Migration: `database/024_storico_cliente_extend_call_center.sql`. Il modulo `storico_cliente.html` ora mostra anche chiamate, appuntamenti e blacklist (totali aggiunti: 2.351 chiamate, 249 appuntamenti, 91 blacklist)
- **Fase 3** (eseguita): backfill `chiamate.anagrafica_id` su 872 record orfani (ora 100% popolato) + backfill `appuntamenti.anagrafica_id` (99.2%) + trigger `BEFORE INSERT` su entrambe le tabelle per auto-popolare il FK quando manca. Migration: `database/025_chiamate_appuntamenti_anagrafica_autolink.sql`. Il CC prod continua a funzionare invariato (passa NULL sull'INSERT, il trigger lo riempie)

### Fase 4 — applicata (+ 4.1 rilassamento e auto-chiusura)

- **Fase 4** (eseguita): convergenza Upload Contratti con il Call Center
  - Nuova RPC `vendita_deriva_origine(p_anagrafica_id uuid)` ritorna jsonb `{origine_pratica, evento_tipo, evento_id, descrizione}`. Migration `026` (versione iniziale)
  - Wizard `upload-contratti-vendita.html`: dopo lookup anagrafica, chiama la RPC, pre-compila il dropdown `origine_pratica` e mostra un banner azzurro con la descrizione del match. L'operatore può overridare il valore: popup di conferma per evitare scollegamenti accidentali. Dropdown ora ha label umane
  - Bottone "💼 Inizia vendita" in `appuntamenti-oggi.html` accanto al badge "Presentato": click → sessionStorage `mirox_vendita_da_cc` + redirect al wizard
- **Fase 4.1** (eseguita): rilassamento RPC + auto-chiusura eventi CC. Migration `027`, poi messa in sicurezza con migration `028`
  - RPC livello 1 ora copre anche appuntamenti FUTURI confermati fino a 30 giorni (cliente che arriva in anticipo)
  - RPC livello 2 rilassato: include chiamate `passa_in_negozio`/`passa_a_cerea` anche con `passaggio_stato='in_attesa'` (non solo `'passato'`)
  - Il trigger iniziale `trg_vendita_pratica_auto_chiudi_cc` è stato rimosso dalla migration `028`: scattava troppo presto, quando la pratica non aveva ancora completato contratti e upload. Oggi l'action backend `finalize` chiama la RPC `vendita_chiudi_eventi_cc_per_pratica` solo dopo il completamento dell'intera pratica; un rollback degli upload non altera più le code CC
  - Wizard al submit valorizza `vendita_pratiche.appuntamento_id` / `chiamata_id` con l'evento auto-rilevato (FK esistenti da schema legacy ora riempite)

### Fasi successive previste

- **Fase 5 facoltativa** (uniformità UI): le pagine CC conservano parte delle utility `Utils.*` del port storico. La creazione anagrafica è già migrata a `AnagraficaHelper.cercaOcrea` e non restano conferme native nei flussi controllati; l'eventuale sostituzione completa di `Utils.*` è un refactor architetturale, non un'attività correttiva aperta
- **Estensioni Fase 4**: bottoni "Inizia vendita" anche in `registra-chiamata.html` (dopo passa-in-negozio), `esiti-appuntamenti.html` (prima di esitare), `rilavorazione.html` (tab Passa Negozio/Cerea) — da fare on-demand quando si ha bisogno

## Guardian: correzioni del 05/10/2026 (attive in produzione)

La chat proprietario Telegram puo' discutere liberamente del CRM senza scegliere
una richiesta e anche su casi archiviati; conserva gli ultimi 30 messaggi nella
sessione server-only. Comandi e pulsanti sono scorciatoie per contesto/operazioni,
non condizioni per dialogare. Il webhook riceve anche gli esiti tecnici worker.
La raccolta guidata degli operatori resta distinta.
Il cron non ripete automaticamente analisi fallite sullo stesso segnale/release,
notifica anche gli esiti delle scansioni preventive e sospende dispatch dopo
errori di configurazione OpenAI. Workflow con preflight, modello da DB, URL worker
vincolato all'ambiente e fallimento CI dopo esito negativo.

Migration `database/20261005110504_guardian_owner_conversation.sql` applicata
e verificata sul production il 05/10. Il proprietario ha eliminato il precedente
ambiente Guardian e autorizza il rilascio direttamente sul CRM ufficiale.
Diagnosi, verifiche e attivazione: [report Guardian](docs/GUARDIAN_DIAGNOSI_2026-10-05.md).

Correzioni distribuite dei segnali Guardian settembre: Ticket usa listener su dati
per aprire Lavorata anche con nomi contenenti apostrofi; Comodato elimina il
controllo Apps Script dismesso; Apri/Chiudi azzera l'anteprima SIM tramite il
renderer corrente quando la scelta torna a No.

Verifica runtime Guardian: workflow manuale `guardian-healthcheck.yml` su main,
Environment production, action `health` del worker protetta da HMAC. Controlla
Responses con testo sintetico senza dati CRM, identita' bot/webhook via GET e
accessibilita' memoria DB. Non invia messaggi Telegram, non modifica dati o
configurazioni e restituisce soltanto esiti/codici chiusi; nessuna chiave o log.

## KONA AI Guardian Observer (production)

Il vecchio reporter globale che inviava automaticamente email per gli errori tecnici e' stato rimosso perche' produceva notifiche poco utili. Restano invariati `mirox-send-email`, `MiroxMailer` e tutte le email operative basate sui template CRM. Restano inoltre i popup locali, compresi i messaggi mirati dell'OCR e l'orario mostrato dal wizard Upload Contratti.

La dashboard espone una piccola mascotte KONA AI Guardian nell'angolo inferiore destro, affiancata da una nuvoletta di chat compatta che apre `moduli/segnala-problema.html`. La chat chiede prima di scegliere fra `Segnala un problema` e `Proponi una miglioria`, poi pone una sola domanda breve per volta e al massimo due chiarimenti dopo la descrizione iniziale. Registra comunque la richiesta, conferma con un codice unico `KG-000001` e rimanda gli eventuali dubbi all'approfondimento Telegram. Il messaggio rivolto all'operatore usa il ruolo generico `amministratore`, senza mostrare il nome di Mirko. Gli operatori possono soltanto creare la richiesta e rispondere: non possono assegnare priorita', approvare analisi o avviare azioni.

Le richieste vivono nelle tabelle server-only delle migration `065` e `066`; `067` registra le esecuzioni Codex e `068` aggiunge eventi tecnici ripuliti, segnali aggregati, outbox Telegram e checkpoint Observer. La raccolta non invia email e non inoltra log grezzi all'AI. Il cron `cron-guardian-observer` apre incidenti soltanto dopo deduplicazione e soglie, poi avvia un workflow Codex read-only sul commit interessato. Un singolo errore di rete generico, incluso `Failed to fetch` durante un upload, resta in osservazione: viene aperto soltanto dopo almeno tre occorrenze o il coinvolgimento di piu' operatori e non diventa critico per il solo nome dell'operazione. I messaggi Telegram traducono il segnale in italiano semplice, spiegano diffusione e prossimo passo e non mostrano codici interni come spiegazione principale. Mirko e' l'unico interlocutore Telegram ammesso e puo' usare testo o vocali gia' registrati; `/salute` mostra il solo stato tecnico dell'Observer, senza dati CRM; non e' prevista conversazione audio live. Il collector telemetria esporta esplicitamente il proprio handler, così il worker può caricarlo nel bundle Netlify senza errore runtime. Nessuna patch, push o pubblicazione production puo' partire senza approvazione Telegram.

Se l'analisi automatica non dispone dei dati minimi per proporre una correzione, non espone il pulsante di preparazione patch: propone `Aggiungi informazioni`, apre la conversazione della richiesta e formula una sola domanda concreta. Il workflow patch installa le dipendenze prima di avviare Codex e distingue gli esiti `MODIFICA_PREPARATA`, `GIA_PRESENTE`, `RICHIEDE_INFORMAZIONI` e `BLOCCATA`. Gli ultimi tre sono esiti operativi gestiti e non generano una falsa mail GitHub di errore; il job termina in rosso soltanto per guasti tecnici, test falliti o mancata consegna dell'esito al worker.

Guardian e' attivo su `mirox-crm.it`, branch `main`, Supabase `lbgwamhjkjjfwgusafbi` e bot `@MiroxAiGuardianBot`. Il proprietario autorizza sviluppo e collaudo direttamente in produzione. Setup: [`docs/KONA_AI_GUARDIAN_SETUP.md`](docs/KONA_AI_GUARDIAN_SETUP.md).

La pubblicazione finale si approva da Telegram: dopo i test, `Approva pubblicazione`
mostra PR, riepilogo e commit verificato; `Pubblica in produzione` oppure `OK pubblica`
in risposta a quel messaggio autorizzano il merge. La conferma dura un'ora e vale
per una sola versione. Il workflow attendibile su `main` verifica nuovamente test,
proprietario, commit della patch e base production; esegue il merge e attende che
`mirox-crm.it` esponga il relativo commit, quindi verifica la salute Guardian.
Solo allora chiude la richiesta. Esiti Telegram in outbox persistente; se GitHub
è aggiornato ma il deploy non è confermato, la richiesta resta aperta e viene
segnalato esplicitamente. Workflow/configurazioni, dipendenze e SQL richiedono
revisione manuale; nessuna modifica a segreti, schema o protezioni GitHub.

Netlify: anteprime automatiche delle PR disabilitate il 05/10/2026 (`skip_prs=true`).
Le PR Guardian conservano test GitHub e conferma Telegram; il deploy del CRM parte
su `main` dopo il merge. I deploy production restano attivi.

## Aggiornamenti UI e comunicazioni (dal 2026-07-02)

- Sicurezza deploy 26/07/2026: Netlify non pubblica più la root del repository. La build a lista consentita include soltanto pagine e asset frontend; migration SQL, Functions, test, script, configurazioni e documentazione sono esclusi e coperti da test automatico.
- Integrità dati 26/07/2026: consolidate 8 anagrafiche duplicate certe preservando pratiche/documenti e lasciando separate le omonimie con identificativi fiscali validi distinti. L'audit completo dei 247 contratti di luglio ha confermato che gli 8 totali a zero appartengono a offerte catalogo realmente a zero, corretto 3 Assicurazioni Annuali rimaste senza bonus 0,5 e ripristinato l'opzione Iliad su 7 contratti il cui punto era già corretto. Creazione e verifica contratto ora applicano controlli post-scrittura condivisi; Supabase impone anche CHECK di coerenza e audit permanente delle variazioni.
- Integrità località 26/08/2026: Supabase normalizza centralmente maiuscole, spazi, apostrofi ed entità HTML di `anagrafica.comune`/`provincia` per ogni sorgente, incluso il Call Center condiviso. Il catalogo `mirox_comuni_istat` contiene 7.893 denominazioni ufficiali aggiornate al 21/02/2026 ed è accessibile soltanto dal backend. La bonifica `071` ha riallineato 1.094 record deterministici, eliminato una sola anagrafica isolata e portato a zero i comuni compilati non riconosciuti; ogni variazione è conservata nell'audit server-only recuperabile. Le 119 province con sigla corrente ma in conflitto sono rimaste invariate per evitare correzioni non certe.
- `moduli/dashboard_pezzi.html`: la griglia giornaliera usa larghezze fisse compatte per offerte e operatori, con colore pieno sulla cella come nel foglio originale. La tabella e' fissata a 622px totali (270px offerte + 4 colonne da 88px) per evitare espansioni a tutta pagina.
- `moduli/upload-contratti-vendita.html`: dopo l'invio riuscito di una pratica, il wizard mostra il successo e torna automaticamente alla Home Vendita (`dashboard.html`).
- `moduli/upload-contratti-vendita.html` + functions vendita: per cluster `Turista` il wizard nasconde email/provincia/comune/via/civico, forza categoria/offerta dedicate e non blocca piu' l'avanzamento chiedendo provincia, opzione o email; la pratica resta `Turista`, mentre l'anagrafica condivisa viene salvata come `Consumer`.
- `moduli/verifica_contratti.html`: nel popup dettaglio contratto e' presente il tasto "Elimina definitivamente". Gli operatori lo vedono disabilitato; gli admin possono usarlo con doppia conferma. La cancellazione passa dalla function admin-only `elimina-vendita-contratto`.
- `moduli/verifica_contratti.html`: aggiunto filtro `Giorno` nelle tab Da Verificare e Verificati per isolare i contratti caricati in una data specifica.
- `moduli/verifica_contratti.html`: nella tab `Verificati` la barra dedicata `IMEI dispositivo` filtra per corrispondenza esatta dell'IMEI salvato sul contratto, ignorando eventuali spazi, così si può aprire la pratica corretta e consultare il PDF associato.
- `moduli/verifica_contratti.html`: nella tab `Verificati` il filtro `Cluster` permette di isolare Consumer, Business o Turista e usa come fonte primaria `vendita_contratti.cluster_cliente`, preservando quindi il cluster Turista anche quando l'anagrafica condivisa è Consumer.
- `moduli/verifica_contratti.html`: per i contratti Fisso il popup dettaglio mostra anche la convergenza scelta, accanto al prezzo di vendita Fisso.
- `js/mirox-upload.js`: prima di accettare un PDF selezionato o trascinato apre un popup di anteprima con `X` per rimuovere il file e `Conferma` per mantenerlo. La regola vale per Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato.
- Favicon Mirox standard (`assets/favicon.png`) allineata sulle pagine HTML che ne erano prive.
- I bottoni delle email operative basate su template (segnalazioni, rientro Switch SIM, ordini smartphone) puntano a [`https://www.mirox-crm.it`](https://www.mirox-crm.it). Le vecchie email automatiche per errori tecnici sono state rimosse.

## Schedulazioni

- `cron-verifica-contratti`: ogni **minuto**, primo turno **21:00 Europe/Rome** quotidiano, riesame dei sospesi e recupero notifiche. In modalità `collaudo` elabora soltanto prove richieste esplicitamente su singoli contratti.

- **Backup Aruba attivo**: timer systemd sul VPS ogni ora al minuto 17 UTC; controllo completo sorgenti/byte archiviati alle 03:17 UTC. Monitor Healthchecks: periodo 1 ora, tolleranza 1 ora, avvisi email per errori e assenza; entrambe le condizioni collaudate. Nessuna env var o schedule Netlify aggiunta. Vedi [`docs/BACKUP_RIPRISTINO.md`](docs/BACKUP_RIPRISTINO.md).
- **Verifiche backup**: timer VPS giornaliero 06:47 UTC; controllo checkpoint/lifecycle e restore DB isolato una volta per trimestre. Monitor separato 24h/tolleranza 12h. Prima prova: 100 tabelle/51.313 righe identiche. Progetto Supabase per collaudo CRM completo rinviato dall'utente; nessun nuovo costo. Copia TAR cifrata sul Mac verificata senza rete: 6.585 file/1,16 GB. Custodia su supporto scollegato da completare.

- `cron-rientro-sim`: ogni giorno alle **07:00 UTC** (09:00 ora italiana estate / 08:00 inverno). Cerca pratiche `vendita_switch_sim` con `giorno_rientro = oggi` e `mail_rientro_inviata_at IS NULL`, invia notifica via template `rientro_sim`, imposta `mail_rientro_inviata_at = now()`. Se `MIROX_DEPLOY_ENV=staging`, restituisce `skipped` senza inizializzare Supabase o inviare email.
- `cron-pulizia-operativa`: ogni giorno alle **02:30 UTC**. Scade gli OTP pending oltre termine, elimina i contatori del rate limit pubblico scaduti, recupera fino a 100 pratiche `bozza` più vecchie di 24 ore cancellando prima i PDF Storage e poi la pratica, rimuove dopo 90 giorni il contesto tecnico degli incidenti Guardian ed elimina gli eventi Observer oltre `expires_at`. Se `MIROX_DEPLOY_ENV=staging`, restituisce `skipped` senza inizializzare Supabase o modificare dati.
- `cron-target-reports`: ogni **5 minuti**, crea i tre report alle **19:45 Europe/Rome**, lun-sab escluse festivita nazionali/Pasquetta; riprende la coda anche fuori orario. Richiede configurazione esplicita Target production.
- `cron-guardian-observer`: ogni **5 minuti**. Legge eventi Guardian già ripuliti, aggiorna i gruppi, apre incidenti sopra soglia, avvia al massimo il budget giornaliero di analisi Codex read-only e consegna le notifiche Telegram dalla coda persistente e risveglia il worker dei vocali. Non modifica codice o produzione; se il workflow non è configurato conserva la segnalazione e richiede un controllo manuale; non ripete il medesimo segnale senza limite.

## Link utili

- Dashboard Supabase: <https://supabase.com/dashboard/project/lbgwamhjkjjfwgusafbi>
- Mappa completa progetto (per AI e per chi vuole dettagli): [`CLAUDE.md`](CLAUDE.md)
- Stato file SQL nella cartella `database/`: [`database/README.md`](database/README.md)
- Revisione privacy tecnica e punti da validare: [`docs/PRIVACY_LEGAL_REVIEW_2026-07-26.md`](docs/PRIVACY_LEGAL_REVIEW_2026-07-26.md)
- Audit XSS/infrastruttura e limite CSP residuo: [`docs/SECURITY_XSS_AUDIT_2026-07-26.md`](docs/SECURITY_XSS_AUDIT_2026-07-26.md)
- Checklist definitiva dei 12 interventi correttivi: [`docs/REMEDIATION_CHECKLIST_2026-07-26.md`](docs/REMEDIATION_CHECKLIST_2026-07-26.md)

## Note

- La configurazione pubblica di produzione vive in `scripts/build-static.js`; per lo staging URL e publishable key arrivano dalle env `MIROX_PUBLIC_SUPABASE_*`. La build genera `dist/js/config.js`, mentre il file sorgente `js/config.js` e' soltanto un guard contro l'apertura degli HTML non compilati
- L'autenticazione passa per `profili.attivo`: utenti disattivati non entrano
- Esiste un secondo progetto **Call Center** non incluso in questo repo che condivide lo stesso database Supabase. Vedi `CLAUDE.md` per i boundaries delle tabelle condivise.

## Manutenzione

Ogni modifica al progetto deve essere riflessa in `README.md`, `CLAUDE.md` e `database/README.md` **nella stessa sessione/PR** in cui avviene la modifica. Niente "lo aggiorno dopo" — è così che `README_UNIFICATO.txt` (il file che questo README ha sostituito) era diventato obsoleto.

Vedi la sezione "Manutenzione di questa guida" in [`CLAUDE.md`](CLAUDE.md) per la **tabella completa dei trigger** (cosa aggiornare quando cambia cosa) e il self-check di fine task.

## Correzioni segnalazioni settembre 2026

Ticket conferma il salvataggio effettivo; Comodato e Apri/Chiudi correggono gli
errori di avvio/SIM. Catalogo vendita: un retry esplicito solo delle letture GET
su rete/502/503/504. OTP: verifica unica, recupero Storage, protezione dei PDF gia'
salvati e diagnostica Guardian per fase. Schema CRM invariato.
Dettaglio e limiti: [registro intervento](docs/GUARDIAN_BUG_SETTEMBRE_2026.md).

### Guardian: vocali recuperabili (06/10/2026)

Il webhook accoda il vocale prima di rispondere a Telegram: conserva update/file
ID e richiesta selezionata, senza trascrizione sincrona. Il worker background
usa la stessa chiave Guardian, fino a 180 secondi per la trascrizione, checkpoint
prima della risposta e al massimo cinque tentativi con backoff. Il cron recupera
la coda ogni cinque minuti. Una consegna Telegram incerta non viene ripetuta
senza il pulsante `Riprova questo vocale`; non serve registrare nuovamente l’audio.
Se il proprietario chiarisce che serve una funzionalità nuova, Guardian può
riclassificare la richiesta aperta come miglioria, conservando lo storico e
aggiornando il riepilogo. Questo non autorizza modifiche codice o pubblicazione.
Dettagli: `docs/GUARDIAN_VOCALI_2026-10-06.md`. Nessuna nuova env o tabella CC.

Guardian06/10: i chiarimenti aggiornano il riepilogo anche per una richiesta già
classificata come miglioria; storico conservato e vecchie approvazioni pendenti
scadute. Nessuna implementazione o pubblicazione autorizzata dal dialogo.

Guardian06/10: collegamento `kona_ai_messaggi.voice_job_id` UUID con unicita
per autore; `id` messaggio resta bigint GENERATED ALWAYS e non va fornito
dal client. Migration additiva `20261006194000_guardian_voice_message_link.sql`,
privata Guardian, senza cambi CRM/Call Center. Errori coda distinguono fase e
codice tecnico ripulito, senza stampare testo dei vocali o segreti.

### Guardian: sviluppo da Telegram (06/10/2026)

Un comando diretto del proprietario, per esempio “Procedi con l’implementazione”,
avvia il worker `prepara_patch` sul repository senza un'altra analisi discorsiva.
Le altre formulazioni libere possono proporre `Sviluppa e verifica`; le domande,
negazioni, citazioni e condizioni non avviano lavoro tramite classificazione AI.
Anche i vecchi pulsanti `Analisi Guardian` avviano ora l'analisi Codex del codice.
La patch approvata include i test della branch, avviati dal risultato e recuperati
dal cron se il passaggio si interrompe. Consenso, origine del messaggio e hash
dei requisiti restano nei JSON delle approvazioni/esecuzioni; retry vocali e
richieste duplicate non avviano una seconda patch. Esiti senza modifica, domanda
concreta o blocco fermano la catena; i test falliti non ripartono in un ciclo.
Dopo i test viene proposta la pubblicazione: resta obbligatorio l'OK finale
Telegram sulla versione verificata. Secret, workflow, SQL e aree protette
continuano a richiedere revisione tecnica separata. Nessuna nuova env o tabella.

Guardian06/10: le richieste di catalogo/Day by Day/gare ricevono uno snapshot
read-only (offerte, metriche e righe giornaliere, massimo250 per tabella,
troncamento esplicito), senza dati clienti o segreti. Punteggi/regole nuovi non
vanno inventati: conservare gli esistenti o chiedere una sola scelta concreta.
Le proposte SQL di configurazione dati possono essere conservate in PR draft
con `manual_review/blocked`, test locali e notifica persistente. Il workflow
non esegue SQL e la conferma finale continua a rifiutare database/*.sql.
La revisione resta separata da Codex. Un piano catalogo validato e vincolato
alla versione puo essere applicato dal rilascio dopo la conferma finale Telegram. Secret,
workflow, dipendenze e deploy rimangono bloccati prima del push della patch.

## Proposta Customer Base — cambio piano con telefono (06/10/2026)

La richiesta KG-000023 comprende una configurazione dati e vincoli condivisi
tra wizard e server, senza modifiche schema. `netlify/functions/_lib/guardian-catalog-kg23.json`
aggiunge in modo idempotente due offerte Consumer Customer Base — `Cambio Piano +
Telefono Finanziato` e `Cambio Piano + Telefono VAR` — entrambe con 1 punto e
`abilita_dispositivo=true`, così il wizard conserva il telefono associato. Il
piano propone due righe Day by Day dedicate, con regole separate per
Finanziamento e VAR e ordine 215/216. Il piano revisionato verrà applicato atomicamente dal rilascio dopo il consenso
finale Telegram; non è ancora attivo.

### Guardian: piano catalogo revisionato e conferma Telegram

La migration `20261006182105_guardian_reviewed_catalog.sql` aggiunge due RPC,
senza alterare schema/RLS CRM o tabelle CC. `guardian_catalog_apply_v1` e' il
core privato, senza EXECUTE per service_role/anon/authenticated;
`guardian_apply_reviewed_catalog` e' service-only e richiede lease, SHA, test,
revisione Codex locale e consenso finale Telegram non scaduto. Accetta solo
inserimenti `vendita_offerte`/`dashboard_righe_giornaliera` e aggiornamenti
`regola` delle righe giornaliere con precondizioni su nome/regola; massimo10
operazioni per gruppo, nessun DELETE, SQL libero, DDL, RLS, RPC o dati clienti.
Il piano serializzato/hash e la revisione vivono nel JSON dell'approvazione patch
server-only, vincolati alla head SHA. Il workflow non puo' attribuirsi la revisione.
La conferma finale mostra anche il piano dati; cambi a head/piano/requisiti
invalideranno l'approvazione. Il rilascio controlla merge e SHA online prima
di applicare il piano in una transazione; verifica salute prima di chiudere.
Checkpoint nell'approvazione finale impedisce duplicati. Un fallimento dati
lascia la richiesta aperta e non viene dichiarato un rilascio riuscito.
Migration applicata/riletta06/10: privilegi verificati, core e rollback dopo
precondizione fallita collaudati in transazioni annullate,0record sintetici residui.

KG23: il piano JSON backend aggiunge2offerte Consumer/2righe Day by Day a1punto
complessivo. Aggiorna soltanto le regole delle righe telefono14/15 per escludere
le nuove combinazioni, preservando tutti i telefoni storici. Il helper condiviso
`js/customer-base-device.js` vincola dispositivo obbligatorio e tipo acquisto
Finanziamento/VAR nel wizard e server; altre offerte restano immutate. Script
SQL iniziale non eseguito e sostituito da piano revisionato, non da SQL spostato.
Applicazione subordinata alla conferma finale Telegram e alla head SHA verificata.

Libreria condivisa aggiunta: `js/customer-base-device.js`, esposta su window nel
wizard e richiesta dal server tramite CommonJS; nessuna nuova dipendenza npm.

Convenzione piani catalogo Guardian: solo `netlify/functions/_lib/guardian-catalog-<codice>.json`; il validator li classifica catalog_required/manual_review/blocked, come le proposte SQL. Senza revisione server legata alla head non si puo proporre il rilascio del piano.


Guardian vocali06/10 sera: il download Telegram mantiene i byte Ogg originali
ma usa filename `vocale.ogg` e MIME `audio/ogg`, anche quando getFile restituisce
`.oga`; la API richiede metadati formato riconoscibili. Parametro `languages[]`
solo per `gpt-transcribe`, `language` per i modelli precedenti configurati.
Errori OpenAI persistiti come codici ripuliti (HTTP/formato/chiave/quota), senza
messaggi grezzi; un errore4xx permanente sospende il singolo vocale e permette
al successivo di procedere. Timeout/429 restano ritentabili e in ordine.
“Aprimi una nuova richiesta” crea subito il caso e collega la sessione prima del
vocale successivo; il primo dettaglio sostituisce il testo provvisorio. Nessuna
modifica di schema, segreti, modello predefinito o conferme di pubblicazione.

Convenzione materiale locale (28/10): `/tmp/`, `/output/` e `ed.hup` sono
ignorati da Git; contengono elaborati, documenti e scratchpad locali, mai
parte del codice da pubblicare. Dati di recupero e credenziali restano
esclusivamente in `.backup-private/`.

## Scanner documenti guidato — sviluppo locale 29/10/2026

Nello step Documenti dell’Upload Contratti compare prima il QR per il telefono.
La pagina web acquisisce fronte e retro con la fotocamera, senza salvare nella
galleria o nello storage locale del browser, e invia un PDF alla stessa pratica.
CIE sola o con tessera sanitaria facoltativa; carta cartacea e patente con tessera
sanitaria obbligatoria, sempre fronte/retro. Passaporto e Turista restano PDF e
anteprima manuale. Il pulsante «Non è possibile acquisire la scansione da smartphone:
carica PDF» mantiene il percorso con scanner tradizionale e conferma tramite preview.

Il CF viene decodificato realmente dal barcode sui byte del PDF con ZXing e checksum;
non viene indovinato dall’AI. Codice assente/illeggibile, lettura incompleta o dati
incerti richiedono la preview manuale. La scadenza del documento d’identita continua
ad essere letta e confrontata con la data firma; la tessera sanitaria non sostituisce
il documento. Business mantiene CF del rappresentante dalla PDA e riscontro azienda.
Gli altri controlli successivi e le notifiche esistenti conservano le loro regole.

Sessione revocabile di 10 minuti, PDF smartphone massimo 4 MiB, massimo 5 sessioni
aperte per operatore. Telefono con collegamento temporaneo, PC autenticato per
ricevere il file. Camera abilitata soltanto sulla pagina scanner; WASM e PDF-lib
serviti localmente, nessun CDN nuovo. Nessuna env var o nuova schedulazione:
la pulizia temporanei usa il cron operativo esistente.

Struttura aggiunta: `moduli/scanner-documenti.html`, `css/scanner-documenti.css`,
`js/scanner-documenti-{core,mobile,ui}.js`, helper server
`_lib/scanner-sessioni.js` e `_lib/identita-barcode.js`; la build genera
`dist/js/vendor/pdf-lib.min.js` con relativa licenza dalla dipendenza fissata.

| Pagina / function | Accesso | Scopo |
|---|---|---|
| `moduli/scanner-documenti.html` | QR temporaneo | Acquisizione web guidata iPhone/Android, scatti in memoria |
| `scanner-documenti` (POST) | JWT e permesso Upload sul PC; capability limitata sul telefono | Crea, stato, invia PDF, ricevi e annulla sessione; nessuna API anonima di lettura CRM |

Migration privata gia applicata il29/10, codice ancora locale e **non pubblicato**.
Restano da collaudare fotocamera, nitidezza e limiti peso con iPhone/Android reali.
[Guida tecnica, verifiche e limiti](docs/SCANNER_DOCUMENTI_2026-10-29.md).

### Debug scanner29/10 — correzioni locali, non pubblicate

Corretti scatti asincroni che potevano sostituire la facciata sbagliata, invii
avviati dopo abbandono pagina durante la preparazione del PDF e riapertura QR
bloccata da una creazione precedente ancora pendente. Ricezione PC ritentata fino
a3volte dopo errori di rete/5xx, QR conservato visibile e pulsante Riprova ricezione
sulla stessa sessione. Il backend rilegge lo stato dopo una risposta DB ambigua
prima di eliminare file: un PDF gia registrato pronto viene preservato. Errori
servizio503, conferme/scadenze/permessi invariati. Barcode cercati a entrambe le
scale anche se il primo CF e gia leggibile, per rilevare discordanze.
Test riproducono6bug prima del fix e verificano anche JPEG ruotato come PDF telefono;
nessun browser, lettura cliente, email o nuovo schema production.
Dettagli e risultati aggiornati nella [guida scanner](docs/SCANNER_DOCUMENTI_2026-10-29.md).

### Secondo debug scanner29/10 — locale

Nuova pratica ripristina CIE/QR e tessera facoltativa anche dopo invio o passaporto;
annullare la conferma Nuova pratica conserva il lavoro corrente. Cambio file/dati
chiude la vecchia preview e separa le richieste identita pendenti, mantenendo il
blocco dei doppi click sulla stessa richiesta. Upload interrotto rifiutato senza
errori stream non gestiti su scanner e PDF tradizionale. QR generato prima della
registrazione DB, cancellazione proprietario ritentabile dopo scadenza/revoca,
controllo scadenza prima di Storage, UUID validi e stesso cluster per trasferimento.
Nessuna nuova migration o operazione cliente in produzione; dettagli nella guida scanner.

Anche un passaporto riconosciuto dalla lettura, con CIE selezionata per errore,
richiede la conferma manuale. Passaporto dichiarato e Turista mantengono il percorso
PDF/manuale senza OCR identita.

### Rilascio scanner30/10/2026

Revisione completa e integrazione con origin/main01a8470 (planning gia pubblicato)
nel ramo codex/scanner-rilascio. Push autorizzato ed eseguito: codice0fbf10d online,
planning conservato. Build/suite Node22 locale e CI Linux:601test
verdi; flusso sintetico completo QR→PDF→barcode→ricevuta→3contratti→finalize con
risposta persa→recupero→verifica successiva. Quattro pacchetti Netlify costruiti e
API identita eseguita dal bundle isolato con Canvas/WASM, senza AI o CRM reali.

Nel controllo del primo deploy sono state corrette due attese dei test dipendenti
dal numero di cicli evento durante gli hash WebCrypto (CI Linux601/601verde dopo
la correzione). La Permissions-Policy completa e generata per ogni pagina in
dist/_headers, senza omonima dichiarazione globale TOML che la sovrascriverebbe:
camera solo scanner, microfono/geolocalizzazione e altre funzioni restano negate.

Correzioni finali: preservazione copie identita dopo insert con risposta persa,
stream interrotto anche nell’upload definitivo, vincolo cluster nelle ricevute,
scale barcode realmente distinte per fotografie, tessera fronte/retro controllata
e collegamento CF all’identita. Se il CF e solo sulla tessera, si confrontano nome
e data di nascita fra i due documenti, come richiesto dal proprietario; dati
mancanti, discordanti o CF diverso stampato sull’identita richiedono preview manuale.
Il nome OCR non torna un blocco generale contro l’anagrafica.
Limite trasferimento browser4MiB (complessivo per il controllo identita), verifica
prima dell’invio, originali non ricompressi automaticamente. Budget condiviso
lettura42s con fallback manuale; native PDF/render con controlli cooperativi.
Versione lettore/cache e motore2026-10-30.1. Nessuna nuova migration/env/schedule.
[Rapporto finale e procedura di pubblicazione/collaudo](docs/SCANNER_COLLAUDO_RILASCIO_2026-10-30.md).

Nel rilascio preparato sono aggiornati Nodemailer10.3.1 e fflate0.8.3 per correggere
gli avvisi preesistenti: npm audit0, API SMTP/ZIP e suite completa verificate.
Nessuna email esterna inviata durante i test.

Deploy6ae4bb2618ffddc7ea3b1a45 verificato via HTTP: asset corrispondenti,
camera=self sullo scanner anche senza estensione, camera negata su Upload,
API401 senza login. Modalita collaudo/email collaudo attive confermate in sola
lettura. Collaudo fisico iPhone/Android con proprietario ancora necessario.

### Recupero manuale identita dopo errori30/10 (pubblicato31/10)

Gli errori di lettura, barcode, parser PDF, HTTP/rete o risposta non valida aprono
l’anteprima degli originali; anche il timeout del client (45s) passa al controllo
manuale. La differenza fra i dati del modulo e quelli gia salvati nel CRM e mostrata
come avviso, con entrambi i nominativi, senza bloccare prima dell’OCR. La ricevuta
resta vincolata ai dati del modulo, autore, file esatti e data di firma.

La conferma puo essere registrata con una richiesta autenticata senza OCR, anche
se la prima lettura non aveva prodotto una ricevuta. Se il viewer non funziona,
si apre ciascun PDF a dimensione intera e si attesta di averlo verificato. Un errore
di registrazione conserva la finestra e i file per riprovare. Business: CF personale
verificato su documento/PDA, fonti legate ai byte e al contratto. Nessuna migration,
env o modifica alla modalita serale. [Dettagli e prove](docs/IDENTITA_RECUPERO_MANUALE_2026-10-30.md).

Codiceff1737a pubblicato31/10: CI Linux611/611verde, deploy Netlify e asset/API
verificati; modalita collaudo ed email collaudo attive preservate. Nessuna pratica
cliente o email di prova avviata durante il rilascio.
