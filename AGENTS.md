# AGENTS.md — Guida per AI assistants

Questo file viene letto automaticamente all'avvio di ogni sessione Codex. Contiene il contesto necessario per essere subito produttivi senza ri-esplorare il repo.

## Cos'è questo progetto

**Mirox CRM Vendita** — modulo di gestione vendite e post-vendita di Konatech. Static HTML + Netlify Functions (Node) + Supabase Postgres.

---

## Manutenzione di questa guida (regola persistente)

**Regola fondamentale**: ogni task che modifica codice, struttura o regole del progetto deve aggiornare i file di documentazione (`README.md`, `AGENTS.md`, `database/README.md`) **nella stessa sessione**, prima di considerarsi concluso. Niente "lo aggiorno dopo" — il drift documentale si crea così e questa guida diventa inutile (è già successo con il vecchio `README_UNIFICATO.txt`).

### Tabella trigger → cosa aggiornare

| Cosa cambia nel progetto | Aggiorna |
|---|---|
| Stack, dipendenza npm, libreria JS condivisa | `README.md` (Stack + Struttura) + `AGENTS.md` (Architettura) |
| Struttura cartelle (nuova / spostata / rimossa) | `README.md` (Struttura) + `AGENTS.md` (Architettura) |
| Env var Netlify (nuova / rimossa / rinominata) | `README.md` (Env vars) |
| Pagina HTML aggiunta / rimossa / spostata | `README.md` (tabella moduli) + `AGENTS.md` (Flusso vendita se impattato) |
| Netlify function aggiunta / rimossa / rinominata | `README.md` (tabella Functions) + `AGENTS.md` (Architettura layer 2) |
| Tabella / colonna / vista / RPC / trigger / RLS / bucket Supabase | `AGENTS.md` (Mappa Supabase) + valutare migration in `/database/` + `database/README.md` |
| Nuova regola di business o validazione | `AGENTS.md` (Regole di business) |
| Nuova convenzione (path, naming, libreria d'uso obbligata) | `AGENTS.md` (Convenzioni) |
| Cron / schedule (nuovo / modificato / rimosso) | `README.md` (Schedulazioni) + `AGENTS.md` (Architettura layer 2) |
| Nuova "nota operativa consapevole" (limitazione nota, soluzione temporanea) | `AGENTS.md` (Note operative consapevoli) |
| Limitazione documentata risolta / password admin rimossa, ecc. | `AGENTS.md` (rimuovere o aggiornare la nota corrispondente) |
| Cambio modello permessi / ruoli / pagine pannello Admin | `AGENTS.md` (sezione "Pannello Admin Mirox") + `README.md` (sezione "Pannello Admin Mirox") |

### Self-check di fine task

Prima di dichiarare un task concluso:
1. Cosa ho toccato? (codice, schema, path, regola, dipendenza)
2. Riconosco la categoria nella tabella sopra?
3. Apro i file pertinenti e aggiorno
4. Cito brevemente nel report all'utente quali doc ho aggiornato

---

## Collaborazione AI (aggiornata 2026-07-25)

**Codex è l'assistente principale per tutto lo sviluppo**: analisi, fix, nuovi moduli, Netlify functions, migration DB, refactor e documentazione. Claude Code ha realizzato gran parte dello storico e può essere usato occasionalmente dall'utente; la Claude API resta attiva per l'OCR PDA fino alla futura migrazione a OpenAI.

Le regole seguenti valgono per qualunque assistant lavori sul repository:

1. **Fonti di verità condivise**: `README.md` (utente-facing) + `AGENTS.md` (questo file) + `CLAUDE.md` (compatibilità storica) + `database/README.md` (schema). Ogni modifica va riflessa nei file pertinenti **nella stessa sessione** in cui si tocca il codice. La tabella "trigger → cosa aggiornare" sopra è l'oracolo condiviso.
2. **Nessuna azione irreversibile senza conferma esplicita dell'utente**: no `git push --force`, no DROP tabelle/colonne, no `rm -rf` fuori dallo scratchpad, no revoca policy RLS, no cambio env var Netlify. Se una modifica DB rompe potenzialmente il CC prod (vedi lista tabelle condivise in "Roadmap & boundaries") → **bloccarsi e chiedere prima**.
3. **Push su GitHub solo quando l'utente lo dice**: si può preparare un commit locale, ma `git push origin main` va lanciato solo su richiesta esplicita ("push", "carica su github", "manda in produzione"). Netlify fa deploy automatico al push, quindi ogni push è un deploy production su `mirox-crm.it`.
4. **Un commit = un cambio coerente**: messaggio in italiano, primo verbo all'imperativo (`fix(...)`, `feat(...)`, `docs(...)`, `refactor(...)`, `chore(...)`). Corpo opzionale con contesto se non ovvio e firma `Co-Authored-By` dell'assistant che ha scritto il cambio.
5. **Prima di iniziare, leggere gli ultimi commit**: `git log --oneline -20` mostra cosa ha fatto l'altro. Se un commit recente tocca la stessa area del task che stai per fare, allineati con lo stato attuale invece di sovrascriverlo.
6. **Convenzioni tecniche identiche**: no emoji in HTML/JS visibili (vedi sezione dedicata), niente `alert()`/`confirm()` nativi (usare `MiroxUI.*`), niente `fetch()` diretto verso Netlify functions (usare `MiroxApi.fetch()`), niente `db.storage.from().upload()` dal client (solo via Netlify function). Vedi sezione "Convenzioni" per l'elenco completo.
7. **Note operative consapevoli**: prima di "correggere" qualcosa che sembra sbagliato, controllare la sezione "Note operative consapevoli" — molte scelte apparentemente inconsistenti sono volute (es. cluster `Turista`, catalogo Reload dismesso, file SQL parziali).
8. **In caso di conflitto**: se una convenzione, un pattern o un vincolo non è documentato qui e la tua modifica lo richiederebbe, **prima documentalo** in `AGENTS.md` (sezione appropriata) e poi implementalo. Non lasciare tribal knowledge nel codice.

L'utente può chiedere in qualsiasi momento cosa è stato fatto in una sessione: la risposta si costruisce da `git log --author=...`, diff dei commit e documentazione aggiornata.

---

## Convenzione UI — Niente emoji (regola permanente)

**Regola assoluta**: nessuna emoji è ammessa in nessun file HTML o JS del progetto — né nelle pagine esistenti né in quelle nuove. Questo vale per:
- Testo visibile all'utente (label bottoni, titoli sezioni, intestazioni popup/modal, messaggi alert/confirm, stati empty-state)
- Testo nei `console.log` / `console.warn` / `console.error`
- Attributi HTML (`title`, `placeholder`, `aria-label`, ecc.)
- Commenti inline nel codice visibile (non quelli nello `<script>`)

Sostituire sempre con testo descrittivo (es. `🔄 Aggiorna` → `Aggiorna`, `⚠ Attenzione:` → `Attenzione:`, `✓ Conferma` → `Conferma`).

---

## Roadmap & boundaries (LEGGERE PRIMA DI MODIFICARE)

- **Vendita / Post-Vendita** = focus storico, completato in larga parte
- **Call Center integrato** = a partire dal 2026-06-20 le pagine CC sono integrate in `moduli/call-center/` (Fase 1: mount UI). Il CC prod su `mirox-crm.netlify.app` continua a girare in parallelo invariato — entrambi puntano allo stesso project Supabase
- **Integrazione CC completata nelle fasi 2–4**: `storico_cliente` esteso, backfill/auto-link di `chiamate.anagrafica_id` e convergenza Upload Contratti con `origine_pratica` automatica sono già applicati. Le eventuali estensioni successive sono nuove funzionalità, non attività arretrate.

### URL deploy
- **Repo GitHub**: `git@github.com:mirkopiasenti/mirox-crm.git` (dal 2026-07-02, prima era `konahub-vendita-test` — redirect ancora attivo ma va usato il nome nuovo)
- **Netlify site di questa codebase**: **`mirox-crm`** (nome sito Netlify dal 2026-07-02, prima era il vecchio nome legato al test). Custom domain **`mirox-crm.it`** in production dal 2026-06-29 — tutte le functions, compreso Guardian, rispondono qui. Env vars Supabase, OpenAI, Telegram e degli altri servizi sono configurate su questo site
- **Guardian staging separato**: `mirox-crm-staging.netlify.app`, site Netlify `mirox-crm-staging`, branch primaria `codex/kona-ai-guardian-staging` e Supabase `blwgxrszvsoqcmcmhhqr`. Resta isolato dai dati production ed e' l'ambiente obbligatorio per gli sviluppi successivi; usa il bot Telegram dedicato `@KonaAiGuardianBot`, mentre il bot ufficiale `@MiroxAiGuardianBot` resta production.
- `test-upload-contratti-konahub.netlify.app` — vecchio URL di test del repo. **Non è più aggiornato** (le functions OTP rispondono 404). Deprecato — l'URL "buono" è `mirox-crm.it`
- `mirox-crm.netlify.app` — **DIVERSO PROGETTO**: sito Call Center prod (altro repo GitHub, NON in questa codebase). Condivide lo stesso DB Supabase. Da non confondere col Netlify site `mirox-crm` di cui sopra (che è custom-domain su `mirox-crm.it`)

### Tabelle condivise — toccare con cautela (regole NON negoziabili)

Modifiche a schema / RLS / RPC / trigger su queste tabelle hanno rischio di **rompere il Call Center in produzione**:

`profili`, `anagrafica`, `appuntamenti`, `chiamate`, `call_center_lead_outbound*`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`, `blacklist`

3 regole di coordinamento col CC prod:
1. **Solo modifiche DB additive** — mai DROP/RENAME colonne, mai CHECK più stretti
2. **Mai modificare RPC esistenti** (solo aggiungerne di nuove con nuovi nomi, es. `cerca_o_crea_anagrafica_v2`)
3. **Le RLS nuove devono includere anche le pagine vecchie** — chiavi `pagine_accessibili` riutilizzate identiche (no prefisso `cc_`)

→ **chiedere conferma all'utente** prima di alterare qualsiasi tabella di questa lista.

---

## Architettura 3 layer

### 1. Frontend (`/`, `/moduli/`, `/moduli/call-center/`, `/js/`, `/css/`)

**Configurazione Call Center per ambiente**: tutte le pagine in
`/moduli/call-center/` caricano prima `../../js/config.js`, generato dalla
build, e poi il proprio `js/config.js`, che contiene soltanto `APP_CONFIG`.
Il file interno non deve creare un secondo client Supabase né contenere
URL/chiavi: staging perderebbe la sessione e potrebbe puntare al DB sbagliato.

Pagine HTML statiche, no bundler. Netlify esegue `scripts/build-static.js` e pubblica esclusivamente `dist/`, generata copiando gli HTML root e le directory `assets/`, `css/`, `js/`, `moduli/`; `dist/` è ignorata da Git. La build sostituisce il guard sorgente `js/config.js` con la configurazione Supabase dell'ambiente, espone soltanto commit/deploy non sensibili per correlare la telemetria e inietta `js/mirox-telemetry.js` nelle pagine che caricano `mirox-api.js`. Genera inoltre `dist/_headers` con una CSP limitata allo stesso host. Ogni branch Netlify diversa da `main` e' staging: senza `MIROX_PUBLIC_SUPABASE_URL` e `MIROX_PUBLIC_SUPABASE_ANON_KEY` dedicate la build fallisce, e il project ref produzione `lbgwamhjkjjfwgusafbi` e' sempre rifiutato. `imposta-password.html` e' il callback Auth degli inviti: scambia code/token con una sessione, rimuove i token dalla URL, richiede almeno 12 caratteri e salva la password con `auth.updateUser()` senza mostrarla agli amministratori. Backend, migration, test, script, file Markdown e configurazioni non devono mai essere aggiunti alla lista pubblica. `/moduli/call-center/` contiene il modulo CC integrato (Fase 1, vedi sezione dedicata). `dashboard.html` contiene anche il sottomenu Applicazioni: il bottone topbar `#btnApplicazioni`, collocato prima di Appuntamenti Oggi, espande `#applicationsDrawer` tra topbar e saluto e sposta il contenuto sottostante senza sovrapporlo; i riquadri applicazione mantengono le dimensioni dei bottoni topbar. La prima voce è `Compilatore disdette` e collega a `moduli/compilatore_disdette.html`, che offre scelta fra quattro moduli, compilazione guidata, ricerca anagrafica CRM, duplicazione SIM/Fisso nello stesso cluster e storico PDF con numero cessato. L'azione flottante `#btnSegnalaProblema` mostra la mascotte intera di dimensioni ridotte `assets/kona-guardian-robot.png` con una nuvoletta di chat compatta alla sua sinistra e apre `moduli/segnala-problema.html`, chat guidata autenticata del primo agente KONA AI Guardian. Le pagine `admin*.html` alla root costituiscono il **Pannello Admin Mirox** (`admin.html` hub + configurazioni + gare + KPI Vendita/Call Center), tutte gated da `profili.ruolo='admin'`. La shell condivisa dell'area Admin è generata da `js/admin-shell.js` e stilizzata da `css/admin-shell.css`: sidebar sinistra persistente su desktop, drawer su mobile e area operativa a destra. Le tre pagine KPI aggiungono `css/admin-kpi.css`; Consumer e Business condividono `js/admin-kpi-vendita-consumer.js`, mentre il Call Center usa `js/admin-kpi-call-center.js`. JS condiviso Mirox esposto su `window`:

`moduli/anagrafiche.html` è la pagina del reparto Post-Vendita per la consultazione dell'intera tabella `anagrafica`: la dashboard la espone come card nel tab Post-Vendita; mostra cluster, ragione sociale, cellulare e comune, apre gli altri campi in un popup, applica filtri server-side e pagina a 50 righe. Il filtro comuni è un multi-selettore ricercabile alimentato dai valori realmente presenti a DB e consente fino a 30 scelte contemporanee. Tutti gli account attivi possono modificare i campi anagrafici dal popup, ma il salvataggio parte solo dopo una conferma `MiroxUI`; Comune usa autocomplete ISTAT server-side, provincia viene compilata automaticamente e i valori legacy restano modificabili se la località non cambia. La function applica allowlist, validazione e controllo ottimistico su `updated_at`. Il tasto di eliminazione è mostrato solo agli admin e la function rifiuta comunque utenti non-admin o righe collegate a qualunque storico CRM. Il browser non legge né scrive direttamente le tabelle: usa `gestisci-anagrafiche`, che valida il JWT e genera anche l'export `.xlsx` completo tramite `fflate@0.8.2`.

| File JS | Espone | Uso |
|---|---|---|
| `js/config.js` | `window.db`, `window.MiroxEnvironment` | Guard nel sorgente; la build genera il client con URL + publishable/anon key dell'ambiente |
| `js/auth.js` | `window.Auth` | `richiediAuth()` guard, `logout()`, `getProfilo()`. Le operazioni sensibili sono autorizzate per ruolo lato server; il frontend non richiede password operative o una seconda immissione della password account |
| `js/mirox-safe.js` | `window.MiroxSafe` | `escapeHtml`, `safeUrl`, `isUuid`, `isRecordId`, `safeCssColor`. Caricato da tutte le pagine per impedire che dati DB/input diventino markup, URL o handler eseguibili |
| `js/anagrafica-helper.js` | `window.AnagraficaHelper` | `detectKind`, `cerca`, `cercaOcrea`, `setupAnagraficaSection` |
| `js/mirox-ui.js` | `window.MiroxUI` | `alert/confirm/prompt/loading/toast/allegati`. `allegati()` accetta sia `{url}` legacy sia `{bucket, path}` (genera signed URL on-click via MiroxStorage) |
| `js/mirox-storage.js` | `window.MiroxStorage` | `signedUrl(bucket,path,exp)`, `openAttachment(bucket,path)` — signed URL on-demand per i bucket privati (vedi sezione "Storage buckets") |
| `js/mirox-storage-upload.js` | `window.MiroxStorageUpload` | `upload({file,bucket,path})` — invia PDF dei moduli operativi a `upload-documento-modulo`; nessuna scrittura Storage diretta dal browser |
| `js/mirox-api.js` | `window.MiroxApi` | `fetch(url, opts)` wrapper che inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. Usare per TUTTE le chiamate alle Netlify functions (vedi "Auth functions"). **Auto-refresh trasparente del JWT** (dal 2026-07-01): se il token e' entro 60s dalla scadenza chiama `refreshSession()` prima del fetch; se una function risponde 401 tenta refresh + retry una volta; se anche il retry fallisce mostra toast "Sessione scaduta" e redireziona a `index.html`. Refresh proattivo anche su `visibilitychange`/`pageshow` e via heartbeat 5 min (copre PC in sleep e tab in background dove il timer interno di supabase-js viene throttled dal browser). Espone anche `MiroxApi.refreshSession()` per forzare un refresh esplicito |
| `js/mirox-telemetry.js` | `window.MiroxTelemetry` | Cattura eccezioni frontend, promise rifiutate e telemetria HTTP in forma ripulita; usa una coda breve in memoria e invia batch solo con sessione autenticata. Non legge form, body, storage, allegati o segreti |
| `js/mirox-upload.js` | `window.MiroxUpload` | drag-drop binding su `.mx-drop-zone` e `.file-drop`; anteprima PDF prima di accettare file selezionati/trascinati (`previewPdfFile`, `previewPdfFiles`, `confirmFilesForInput`) |
| `js/mirox-folder.js` | `window.MiroxFolder` | `build(oldName, newName, date)` per nomi cartella Storage |
| `js/mirox-mailer.js` | `window.MiroxMailer` | `send({to, template, vars})` |
| `js/admin-shell.js` | `window.MiroxAdminShell` | Shell comune delle pagine `admin*.html`: genera sidebar a reparti, evidenzia il modulo corrente, gestisce accordion, drawer mobile, profilo e logout. `KPI` contiene `Vendita - Consumer`, `Vendita - Business` e `Call Center` |
| `js/vendita-storage-helper.js` | `uploadVenditaDocumento(...)` | wrapper upload PDF via Netlify function |

### 2. Server (`/netlify/functions/`, Node >=22)

Tutte le functions usano `SUPABASE_SERVICE_ROLE_KEY` e bypassano le RLS. Per questo motivo **TUTTE le functions tranne i cron Netlify, `public-prenota`, `guardian-telegram-webhook` e `guardian-codex-worker`** richiedono `Authorization: Bearer <jwt>` valido (validato via `_lib/require-auth.js`). `guardian-telemetry-ingest` è autenticata e accetta soltanto eventi tecnici a schema chiuso; `guardian-codex-worker` è protetta da HMAC e da un lease server-only. Il webhook Guardian e' una seconda eccezione pubblica ma richiede sia il secret token Telegram sia il `chat_id` di Mirko. Nessuno degli endpoint è un endpoint anonimo generico. `admin-vendita-config`, `admin-kpi-vendita-consumer`, `admin-kpi-call-center`, `gestisci-controllo-fissi`, `elimina-vendita-contratto`, le action manuali di `gestisci-controllo-lg` e le action sensibili di `gestisci-operazioni-post-vendita` richiedono ulteriore check `ruolo='admin'`. Il client deve usare `MiroxApi.fetch()` o aggiungere l'header manualmente. Le funzioni Guardian condividono inoltre `guardian-telemetry`, `guardian-triage`, `with-telemetry` e l'outbox dell'Observer:

- `vendita-config.js` (GET) — catalogo per wizard
- `admin-vendita-config.js` (GET/POST action-based) — CRUD admin offerte/opzioni/reload + replace regole documentali
- `admin-kpi-vendita-consumer.js` (GET) — endpoint admin-only condiviso dai KPI Vendita Consumer e Business. Accetta soltanto `cluster=Consumer|Business`, poi aggrega Mobile, Fisso, Energia/Luce & Gas, Allarmi e Assicurazioni per anno/punto vendita. Combina `vendita_contratti` con le tabelle post-vendita per stati, tecnologie e attivazioni; legge inoltre modalità di pagamento Allarmi e `punteggio_gara_totale` Assicurazioni. Produce il confronto sugli operatori canonici leggendo esclusivamente `profili.id`, `profili.nome` e `profili.alias_di`.
- `admin-kpi-call-center.js` (GET) — endpoint admin-only che unisce le chiamate standard e outbound, aggrega gli appuntamenti per giorno e operatrice e restituisce serie annuali per le viste giornaliera, settimane del mese e mensile. `created_at` determina il giorno in cui un appuntamento è stato fissato; presenza, vinta/persa e annullamento seguono `data_ora`. Consolida gli alias tramite `profili.alias_di` e non modifica le tabelle Call Center condivise.
- `crea-vendita-pratica-carrello.js` (POST action-based) — `create`: anagrafica upsert → pratica `bozza` → N contratti, PDA e validazioni; l'operatore è derivato dal JWT e non dal payload. I PDA di più contratti della stessa categoria vengono promossi con suffisso progressivo per evitare collisioni Storage. I quattro componenti punteggio sono letti dal catalogo con parser stretto, poi confrontati con la riga realmente restituita dal DB: una divergenza attiva il rollback della pratica in bozza. `finalize`: dopo tutti gli upload passa la pratica a `inviata` e chiude gli eventi CC. `rollback_upload_failure`: elimina in modo compensativo pratica `bozza`, contratti, record documento e file già caricati. Le action sono idempotenti e consentite solo all'operatore proprietario o a un admin. Il reinserimento è validato anche server-side su stessa anagrafica, categoria, mese solare Europe/Rome e stato post-vendita. Cellulare obbligatorio; email obbligatoria per Consumer/Business e facoltativa per Turista.
- `upload-vendita-documento.js` (POST multipart busboy, max 20MB) — accetta solo file con MIME e firma `%PDF-`, verifica proprietà operatore/admin per le bozze e consente agli operatori attivi la gestione delle pratiche `inviata` da Verifica Contratti. Valida relazioni pratica/anagrafica/contratto, deriva il path dalla pratica a DB e usa come `uploaded_by` il profilo autenticato. Rollback del file se l'INSERT DB fallisce. In staging con `temp_session_id` salva in `temp/<sess>/` senza record DB.
- `upload-documento-modulo.js` (POST multipart busboy, max 20MB) — upload server-side autenticato per `apri-chiudi-files`, `switch-sim-files`, `comodato-files`, `rimborsi-files`, `protecta-files`, `segnalazioni-files`. Verifica firma `%PDF-`, bucket e struttura path tramite allowlist; usa `upsert:false`, genera un suffisso anti-collisione e registra `uploaded_by` dal JWT nei metadati Storage.
- `gestisci-vendita-contratto.js` (POST action-based) — `update` (`save`/`verify`/`reopen`) e `delete_document` per Verifica Contratti. Accetta solo campi in allowlist; aggiorna snapshot/punteggi dal catalogo soltanto quando cambia l'ID corrispondente, rifiuta punteggi nulli/non numerici e confronta la riga post-UPDATE con i componenti attesi. Imposta `controllato_da`/`updated_by` dal JWT e gestisce rimozione Storage + record DB. Sostituisce UPDATE/INSERT/DELETE diretti dal browser su `vendita_contratti`/`vendita_documenti`.
- `gestisci-controllo-fissi.js` (POST action-based, admin-only) — `reopen_activation` riporta una riga da `Attivo` a `In Attivazione` soltanto se lo stato corrente è ancora `Attivo`, azzera `data_attivazione` e registra data/autore del ripristino dai dati JWT.
- `gestisci-controllo-lg.js` (POST action-based) — `csv_update_batch` applica fino a 50 esiti WindTre per richiesta agli account autenticati e ricontrolla atomicamente `esito_manuale_bloccato=false`; `set_manual_outcome` e `unlock_manual_outcome` sono admin-only. Lo stato manuale richiede motivazione, registra autore/data, azzera i dettagli rifiuto provenienti dal CSV e rimane protetto finche' un admin non riattiva l'automatismo.
- `gestisci-operazioni-post-vendita.js` (POST action-based) — sostituisce tutte le scritture browser su `post_vendita_gestione_rimborsi`: creazione, associazione path PDF e completamento restano disponibili agli account autenticati; `create_rimborso_manuale` è admin-only. `mark_apri_chiudi_ko` è disponibile agli account autenticati attivi, accetta soltanto pratiche ancora `IN CORSO` e aggiorna tramite service role. Operatore e stato del rimborso manuale sono derivati lato server. Migration post-deploy `056`: rimborsi write server-only e trigger DB che continua a impedire di introdurre `vendita_apri_chiudi.stato='KO'` con una scrittura diretta da sessioni non-admin.
- `gestisci-disdette.js` (GET/POST action-based) — genera con `pdf-lib` uno dei quattro moduli WindTre precompilati, carica il risultato nel bucket privato `disdette-files`, registra numero cessato e snapshot validato in `disdette_generate`, elenca lo storico e crea signed URL di 5 minuti. L’action `duplicate_data` restituisce lo snapshot soltanto per SIM/Fisso dello stesso cluster; la ricerca GET `action=search_anagrafica` interroga `cf_piva`, `ragione_sociale` e `nome_referente` senza scrivere su `anagrafica`. Tutte le operazioni sono autenticate e la service role è l'unico soggetto con accesso diretto a tabella e bucket.
- `elimina-vendita-contratto.js` (POST) — admin-only; elimina definitivamente contratto, record collegati e allegati Storage, e la pratica se rimane vuota.
- `ocr-pda.js` (POST multipart, max 20MB) — OCR del PDA via Claude API (`claude-haiku-4-5-20251001`). **Dati cliente**: cf_piva, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico. **Codice Rivenditore** (dal 2026-07-18, migration `050`): `codice_rivenditore` estratto dal "Codice POS" WindTre, valori ammessi solo `'9001415852'` (Legnago) o `'9000822241'` (Cerea), altrimenti `null`. **Dati dispositivo** (dal 2026-06-26, PDA WindTre Mobile/Customer Base): `dispositivo_presente` (bool), `tipo_acquisto` ('VAR' o 'Finanziamento'), `imei` (15 cifre), `prezzo_device` (stringa numerica es. "399.9"), `smartphone_reload` (bool nullable: true=SI[X], false=NO[X], null=sezione assente). Riconoscimento VAR vs Finanziamento via 3 segnali concordi nel PDA: titolo pagina ("Offerta con Finanziamento" vs "Offerta Vendita a Rate"), header sezione ("OFFERTA CON FINANZIAMENTO" vs "VENDITA A RATE"), riga Opzioni/servizi della SIM ("Vendita con Finanziamento" vs "Vendita a rate"). Validazione server-side: tipo_acquisto solo enum, imei regex 15 cifre, prezzo_device regex numerico (altrimenti `null` per evitare di sporcare il form). `finanziaria` e `kolme` NON sono estratti (non presenti nel PDA, compilazione manuale operatore). 200 con `data: {...}` se l'OCR estrae (campi `null` se parziale). In caso di errore "hard" l'errore Anthropic viene classificato in `error_code` strutturato: `ocr_credit_exhausted` (credit balance low → 503), `ocr_rate_limited` (429 → 503), `ocr_unavailable` (5xx/529 → 503), `ocr_auth_error` (401/403 → 503), `ocr_generic_error` (default → 500). Payload errore: `{success:false, error, error_code, http_status, provider_status, provider_message}`. Il client decide il popup in base a `error_code`. Richiede `ANTHROPIC_API_KEY`.
- **Compatibilità cellulare OCR**: il prompt di `ocr-pda` deve accettare ed estrarre numerazioni mobili italiane di 9 o 10 cifre; non reintrodurre l'assunzione rigida delle sole 10 cifre.
- `search-anagrafica.js` (GET) — lookup CF/PIVA
- `gestisci-anagrafiche.js` (GET/POST action-based) — lettura server-side paginata di `anagrafica`, filtro `cluster`, fino a 30 comuni esatti e nominativo; `action=comuni` ricava e mette in cache per 15 minuti i soli valori distinti non vuoti, `action=comuni_istat` cerca per prefisso nel catalogo ufficiale server-only e `action=export` genera il file `.xlsx` completo con gli stessi filtri. `update` è disponibile agli account CRM autenticati e attivi, accetta soltanto i campi anagrafici previsti, valida la selezione ISTAT quando Comune/Provincia cambiano e usa `updated_at` per impedire sovrascritture concorrenti; i valori legacy invariati restano modificabili. `delete` ripete il controllo `ruolo='admin'` lato server e procede solo se nessuna tabella CRM referenzia la riga.
- `mirox-send-email.js` (POST) — mailer autenticato
- `guardian-incidents.js` (GET/POST action-based) — endpoint autenticato della pagina `Segnala Problema`. Ogni richiesta nasce come `problema` o `miglioria`; la raccolta Structured Outputs usa domande e criteri diversi per i due tipi. Gli operatori creano/proseguono solo le proprie richieste; gli admin possono elencarle tutte. Identita', contesto sicuro e ownership sono derivati lato server; tabelle Guardian mai accessibili direttamente dal browser. Il fallback deterministico non blocca l'operatore.
- `guardian-telemetry-ingest.js` (POST) — endpoint autenticato per batch di massimo 20 eventi e 64 KB. Ripulisce nuovamente il payload, forza l'ambiente server, calcola fingerprint, deduplica gli `event_id` e aggiorna `kona_ai_eventi_tecnici`/`kona_ai_segnali`.
- `guardian-telegram-webhook.js` (POST) — webhook pubblico solo per necessita' Telegram, protetto da `X-Telegram-Bot-Api-Secret-Token`, confronto constant-time e allowlist rigida `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`. Accetta testo o vocali conclusi, trascritti via Audio Transcriptions; gestisce `/richieste` (con alias `/incidenti`), `/salute`, `/apri`, `/nuovo`, `/nuovo_miglioria`, analisi Guardian, archiviazione e `Approva lavorazione`. Qualunque pulsante operativo collega automaticamente la sessione Telegram alla richiesta scelta, così i messaggi liberi successivi restano nella conversazione corretta; `Archivia` azzera invece la richiesta attiva. `/salute` espone soltanto contatori e checkpoint tecnici dell'Observer, senza dati CRM. L'approvazione crea un audit `prepara_fix` e porta la richiesta a `fix_approvato`, ma non esegue codice finche' Codex non e' collegato.
- `guardian-codex-worker.js` (POST) — endpoint interno protetto da firma HMAC. Gestisce claim con lease, heartbeat e risultato delle esecuzioni `analisi_codex`, `analisi_automatica`, `scansione_migliorie`, `prepara_patch`, `test_staging` e `rilascio_produzione`; recupera al workflow soltanto contesto Guardian ridotto e invia l'esito a Telegram. Gli esiti automatici sono tradotti in sezioni comprensibili (`Che cosa significa`, conclusione, singola informazione necessaria e prossimo passo). Se `safe_to_prepare_patch` e' falso o mancano dati, il bottone patch viene sostituito da `Aggiungi informazioni`. Per `prepara_patch`, `RICHIEDE_INFORMAZIONI` e `BLOCCATA` chiudono regolarmente il lease senza fingere una modifica e senza abilitare i test staging. Non accetta JWT, non espone segreti e non concede accesso browser alle tabelle.
- `guardian-telemetry-ingest.js` deve esportare esplicitamente `handler`: viene importato da `_lib/with-telemetry.js` anche durante il caricamento del worker; un export incoerente rompe il bundle Netlify prima della verifica HMAC.
- `cron-rientro-sim.js` (scheduled `0 7 * * *`) — notifica giornaliera switch SIM. **Non auth-gated** (chiamata dal cron Netlify, non da utente). Con `MIROX_DEPLOY_ENV=staging` termina subito con `skipped`, senza DB o email.
- `cron-pulizia-operativa.js` (scheduled `30 2 * * *`) — scade OTP pending, elimina contatori rate-limit scaduti, recupera fino a 100 pratiche `bozza` oltre 24 ore eliminando prima i PDF noti e poi il record DB, rimuove il contesto tecnico Guardian oltre 90 giorni ed elimina gli eventi Observer oltre `expires_at`. **Non auth-gated** (cron Netlify). Con `MIROX_DEPLOY_ENV=staging` termina subito con `skipped`, senza DB o Storage.
- `cron-guardian-observer.js` (scheduled `*/5 * * * *`) — legge segnali tecnici già ripuliti, apre incidenti `monitoraggio` sopra soglia, crea esecuzioni automatiche entro budget, accoda Telegram e ritenta le notifiche fallite. **Non auth-gated** (cron Netlify); non modifica repository, dati CRM o produzione.
- `public-prenota.js` (GET/POST) — **endpoint pubblico** chiamato dal form `prenota.html` (anon). GET ritorna gli slot via `get_slot_disponibili`; POST usa la nuova RPC `public_prenota_appuntamento_v1` (migration `055`), che prende un advisory lock e ricontrolla lo slot nella stessa transazione dell'INSERT. Rate limit persistente su Postgres tramite fingerprint SHA256 dell'IP: 60 GET e 6 POST ogni 10 minuti; fail-closed se il limiter non risponde. **Non auth-gated** (intenzionalmente pubblico).
- `garantisci-anagrafica.js` (POST) — upsert anagrafica (lookup CF/PIVA → update campi vuoti / cambiati o insert). Chiamato dal wizard upload-contratti PRIMA della raccolta consenso privacy: il consenso ha bisogno di `anagrafica_id` ma il backend del carrello finora la creava solo al submit. Idempotente con `crea-vendita-pratica-carrello` (entrambi fanno lo stesso lookup/update). Vedi sezione "Sistema consensi privacy GDPR".
- `check-consenso-privacy.js` (GET) — `?anagrafica_id=<uuid>`. Cerca una dichiarazione `stato='confermato'`, non scaduta, non revocata e con `informativa_versione` appartenente alle versioni correnti cartacea/digitale. Il filtro impedisce di riusare retroattivamente informative precedenti. Con `include_history=true` la response additiva espone anche `esito` (valido, assente, in attesa, fallito, scaduto, revocato o da rinnovare) e `documento`, cioè l'ultimo PDF privacy archiviato anche se non più riutilizzabile; `storico_cliente.html` li usa per badge e download dedicato senza leggere direttamente la tabella protetta. Senza il parametro il wizard mantiene response e singola query originarie.
- `richiedi-otp-privacy.js` (POST) — richiede `consenso_marketing` booleano esplicito, accetta cellulari italiani di 9 o 10 cifre (incluse numerazioni legacy) e li normalizza in E.164, genera OTP 6 cifre, salva hash SHA256+salt random e invia SMS via Smshosting. Rate-limit 3 invii/ora per `anagrafica_id` + cooldown 60s tra invii. Invalida automaticamente i record `pending` precedenti dello stesso cliente. Richiede `SMSHOSTING_API_KEY`, `SMSHOSTING_API_SECRET`. Se `SMSHOSTING_SIMULATE=true` non invia davvero, logga e ritorna id fittizio (utile per dev/test).
- `verifica-otp-privacy.js` (POST) — `{consenso_id, otp}`. Re-hash dell'OTP inserito e confronto. Max 3 tentativi (poi `stato='fallito'`). Se OK genera il PDF digitale v6 con entrambe le opzioni marketing, una sola marcata, scelta nel riquadro probatorio ed evidenze reali (cellulare, invio/conferma, esito/tentativi, IP, user agent, hash SHA256, ID SMS), upload su bucket `consensi-privacy`, segna `stato='confermato'` + `valido_fino_al = now()+24 mesi` + `informativa_hash`.
- `genera-pdf-consenso-cartaceo.js` (GET) — `?anagrafica_id=<uuid>&consenso_marketing=true|false`. Stream binario del modulo v6 **precompilato in modalità cartacea**: una sola pagina A4, bianco e nero, corpo 10 pt, due colonne per l'informativa, dati/dichiarazioni/firma a larghezza piena e scelta marketing già marcata. Rifiuta la richiesta se la scelta manca.
- `upload-consenso-cartaceo.js` (POST multipart busboy, max 20 MB) — riceve la scansione PDF del modulo firmato e richiede l'esito marketing `true|false` riportato sul foglio. Calcola SHA256, carica nel bucket `consensi-privacy` e crea il record `modalita='cartaceo'`, `stato='confermato'` (no OTP).
- `_lib/mailer.js` — helper SMTP Gmail + template DB + log
- `_lib/require-auth.js` — helper auth: valida JWT Supabase nell'header `Authorization: Bearer <token>`, ritorna `{ok, user, profilo}` o `{ok:false, status, error}`. Supporta opt `adminOnly: true` per richiedere `ruolo='admin'`. Usare in TUTTE le nuove functions
- `_lib/smshosting.js` — wrapper REST API Smshosting per invio SMS transactional. Espone `sendOtpSms({to, otp})`, `normalizeMobileNumber(raw)`, `generateOtp(6)`. `normalizeMobileNumber` accetta cellulari italiani nazionali di 9–10 cifre con iniziale `3`, oltre ai numeri già in formato E.164, e restituisce sempre `+39...` per quelli italiani. Auth HTTP Basic. Endpoint `https://api.smshosting.it/rest/api/sms/send`. Timeout 12s. Modalità simulazione tramite env `SMSHOSTING_SIMULATE=true`. Vedi `docs/SMSHOSTING_SETUP.md` per il setup account.
- `_lib/privacy-config.js` — fonte unica delle due versioni informative correnti: `v6_2026_07_26` cartacea e `v6_2026_07_26_dig` digitale OTP. Espone anche l'elenco accettato dal dedupe/backend.
- `_lib/pdf-consenso.js` — generatore `pdfkit` con due template: cartaceo v6 su una pagina A4 monocromatica e digitale v6 `_dig` su tre pagine con layout storico. La ragione sociale del Titolare è `KONA TECH SRL`. Finalità, basi giuridiche, conservazione e perimetro marketing sono equivalenti. Entrambe le varianti mostrano ACCONSENTO e NON ACCONSENTO con una sola scelta marcata; il digitale la ripete nel riquadro probatorio e descrive il flusso OTP reale. Esporta `{buffer, hash, informativaVersione}`.
- `_lib/pdf-disdetta.js` — generatore deterministico `pdf-lib` del Compilatore disdette. Carica i quattro template inclusi in `_templates/disdette/`, valida i dati, disegna testo e spunte a coordinate fisse, mantiene la firma vuota e restituisce un singolo PDF A4. Non usa OCR né API AI.
  I template sono dichiarati anche in `netlify.toml` tramite `included_files`; il resolver deve supportare sia il layout sorgente (`_lib/../_templates`) sia quello appiattito da Netlify/esbuild (`functions/_templates`). Non basarsi su un unico `__dirname/../_templates`, perché in produzione risolverebbe erroneamente `/var/task/netlify/_templates`.
- `_lib/score-integrity.js` — parser stretto dei punteggi catalogo e verifica condivisa dei quattro componenti, dei totali gara/extra e delle colonne legacy. Usato sia alla creazione sia in Verifica Contratti.
- `_lib/kona-ai-guardian.js` — prompt, Structured Outputs, fallback di raccolta, analisi proprietario, codici `KG-*` e notifica Telegram. Le istruzioni vietano di fingere accesso a repository/log/database e richiedono approvazione per le azioni successive.
- `_lib/telegram.js` — client REST Telegram, download vocali max 25 MB e trascrizione OpenAI `gpt-transcribe`. Token e chiavi restano esclusivamente nelle env vars Netlify.

### 3. Database (Supabase Postgres)

~80 tabelle. Project ref produzione: `lbgwamhjkjjfwgusafbi`. La configurazione pubblica di produzione e' in `scripts/build-static.js`; quella staging arriva soltanto dalle env Netlify e viene materializzata in `dist/js/config.js`.

Il progetto separato **Mirox CRM - Staging** usa il project ref `blwgxrszvsoqcmcmhhqr`, regione `eu-west-3`, e non contiene dati CRM di produzione. Gli script one-shot dedicati vivono in `database/staging/`: `001_guardian_bootstrap.sql` crea soltanto il profilo minimo necessario ad Auth/Guardian e si blocca se lo schema `public` non e' vuoto, impedendone l'esecuzione accidentale sul database production. Il bootstrap e le migration Guardian `065`/`066`/`067`/`068` sono applicati allo staging; le migration additive `065`/`066` sono applicate anche al production dal 2026-08-10 e `067`/`068` dal 2026-08-11, dopo validazione staging e verifica SQL esplicita sul project `lbgwamhjkjjfwgusafbi`.

---

## Mappa Supabase per dominio

### Anagrafica & Auth (condiviso)
- `profili` — utenti CRM, `ruolo` IN ('admin','operatore'), `pagine_accessibili` jsonb per ACL Call Center, `alias_di` self-FK opzionale verso il profilo canonico. Il backfill alias usa `applica_alias_backfill_v2(uuid)` (migration `053`), SECURITY DEFINER con controllo `ruolo='admin'`; la v1 viene chiusa al client dalla migration post-deploy `054`.
- `anagrafica` — cliente unificato, `cf_piva` UNIQUE, `cluster` operativo condiviso (`Consumer`/`Business`; i passaporti cluster vendita `Turista` vengono salvati qui come `Consumer`). Colonna `email` (text, NULL ammesso a livello DB; obbligatoria lato wizard solo per `Consumer`/`Business`). RPC `cerca_o_crea_anagrafica(p_..., p_email)` UPSERT. Migrations `057` + `059`: consolidate 8 duplicazioni certe da identificativi fiscali/import errati e dal doppione tecnico `TEST`/`test`, spostando tutte le FK e conservando ogni record eliminato in `vendita_log_modifiche`; le omonimie con CF/P.IVA validi distinti restano separate. Migration `070`: trigger `trg_anagrafica_normalizza_localita` su INSERT/UPDATE di Comune/Provincia, limitato a normalizzazione sintattica non bloccante (maiuscole, spazi, apostrofi, entità HTML), così resta compatibile con ogni sorgente legacy. Migration `071`: bonifica una tantum di 1.094 località deterministiche, elimina soltanto la riga isolata `ALTEDO` e conserva lo storico delle due anagrafiche con località non determinabile azzerando Comune/Provincia; le 119 sigle provinciali correnti in conflitto non vengono sovrascritte.
- `mirox_comuni_istat` — catalogo server-only di 7.893 comuni italiani aggiornato al 21/02/2026 (codice ISTAT, denominazione maiuscola, sigla/nome provincia e regione). RLS attiva, nessun grant `anon`/`authenticated`, indice prefix su `nome`; la Function lo usa per autocomplete e validazione senza esporlo al browser.
- `mirox_anagrafica_localita_audit` — audit server-only creato dalla migration `071`: conserva prima/dopo delle 1.094 correzioni e lo snapshot completo recuperabile dell'unica anagrafica eliminata. RLS attiva senza policy browser; `service_role` dispone della sola lettura esplicita. Non ha FK verso `anagrafica`, così lo snapshot di una cancellazione resta disponibile.

### Call Center (condiviso, gestito dall'altro progetto)
- `chiamate`, `appuntamenti`, `blacklist`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`
- `call_center_lead_outbound` + `_chiamate` + `_attivita` + `_import` — outbound business con dedupe (`dedupe_key` UNIQUE), normalizzazione testo/telefono/email
- RPC chiave: `crm_can_access_page(text)`, `crm_normalize_*`, `crm_import_call_center_lead_outbound_batch`

### Vendita (focus di questo progetto)
- `vendita_categorie` — Mobile, Fisso, Energia, Allarmi, Customer Base, Assicurazioni
- `vendita_offerte` — `cluster_cliente`, `punteggio_gara`, `punteggio_extra_gara`, `abilita_dispositivo`, `abilita_switch_sim`
- `vendita_opzioni` — `punti_base`, `punti_extra_piva`
- `vendita_reload` — top-up. **Catalogo dismesso dal 2026-06-26** (vedi "Note operative consapevoli"). Tabella + colonna FK `vendita_contratti.reload_id` conservati per dati storici.
- `vendita_offerte_opzioni`, `vendita_offerte_reload` — link N:M. `vendita_offerte_reload` dismesso col catalogo Reload (vedi sopra)
- `vendita_pratiche` — `origine_pratica`, `stato_pratica`, `nome_cartella_storage`, `storage_base_path`
- `vendita_contratti` — riga venduta con snapshot + punteggi server-side + `stato_controllo`. Migration `058`: tre CHECK validati impongono coerenza tra componenti, totali gara/extra e colonne legacy; `trg_vendita_contratti_audit_punteggi` registra ogni INSERT e ogni variazione futura dei quattro componenti in `vendita_log_modifiche`. Migration `060`: ripristina il bonus 0,5 su 3 Assicurazioni Annuali residue del vecchio bug di verifica. Migration `061`: ripristina ID/nome opzione Iliad su 7 Mobile il cui punto era già corretto, con evidenza PDA. **Codice Rivenditore** (`codice_rivenditore`, migration `050`): text NOT NULL DEFAULT `'9001415852'` CHECK IN (`'9001415852'`,`'9000822241'`). Identifica il punto vendita di inserimento: `9001415852` = Legnago (negozio principale), `9000822241` = Cerea. Il wizard deve propagare sempre il valore dal draft al payload `buildInvioPayload`; se lo omette il backend applica il default Legnago e falsifica il punto vendita. Filtra Dashboard Pezzi Day by Day + Avanzamento Mensile (solo Legnago); Gare Individuali conteggia entrambi. Indice `idx_vendita_contratti_codice_rivenditore`.
- `vendita_documenti`, `vendita_documenti_regole`, `vendita_compensi_regole`, `vendita_log_modifiche`. Migration `053`: UNIQUE `(storage_bucket, storage_path)`; migration post-deploy `054`: INSERT/DELETE documenti soltanto via backend.
- `vendita_consensi_privacy` — registra presa visione dell'informativa CRM e consenso promozionale opzionale (migration 034; durata originaria 48 mesi ridotta e clamped a 24 mesi dalla migration 055). Modalità `otp_sms` o `cartaceo`, stato workflow (`pending`/`confermato`/`scaduto`/`fallito`/`revocato`), OTP hash+salt+scadenza+tentativi, audit IP/UA, snapshot anagrafica jsonb, `valido_fino_al`, `pdf_storage_path` privato. I ricontatti di servizio sulla pratica specifica non dipendono dal consenso marketing.
- Moduli operativi: `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `vendita_simulatore_protecta`

### Applicazioni
- `disdette_generate` — indice server-only dei PDF creati dal Compilatore disdette (migrations `063` + `064`). Conserva tipo modulo, identificativi dello storico, numero cessato, snapshot JSON dei dati validati, path/hash/versione del PDF e operatore. Lo snapshot serve esclusivamente alla duplicazione nello stesso cluster e non viene mai incluso nell’elenco storico. Nessun grant a `anon` o `authenticated`; tutte le operazioni passano da `gestisci-disdette` con service role.

### KONA AI Guardian
- `kona_ai_incidenti` — registro server-only migration `065`, esteso dalla `066` con `tipo_richiesta IN ('problema','miglioria')`: codice progressivo `KG-*`, stato/priorita', reporter, contesto minimo, riepilogo AI/risoluzione e scadenza dettagli tecnici a 90 giorni.
- `kona_ai_messaggi` — cronologia per incidente dei canali `crm`, `telegram`, `guardian`, `codex`, `sistema`; nessun accesso browser diretto.
- `kona_ai_approvazioni` — audit delle azioni proposte a Mirko. Azioni gia' eseguibili: `analizza_guardian`, `archivia` e approvazione `prepara_fix`; quest'ultima registra la decisione e imposta `fix_approvato`, ma resta senza esecutore. Le voci Codex/staging/produzione sono predisposte per fasi successive.
- `kona_ai_esecuzioni` — migration `067` con estensione additiva `068`, registro server-only delle esecuzioni Guardian/Codex: tipo di fase (`analisi_codex`, `analisi_automatica`, `scansione_migliorie`, `prepara_patch`, `test_staging`, `rilascio_produzione`), stato, workflow, commit, branch, pull request, heartbeat, timeout ed esito. Un indice parziale impedisce due esecuzioni attive dello stesso tipo sulla stessa richiesta; nessun grant diretto a `anon`/`authenticated`.
- `kona_ai_eventi_tecnici` — migration `068`, eventi tecnici già sanitizzati con retention 30 giorni. Il collector non accetta form, body, allegati, token o dati anagrafici; nessun grant diretto a `anon`/`authenticated`.
- `kona_ai_segnali` — migration `068`, aggregati deduplicati per fingerprint/ambiente/release. Contiene soglie, priorità, conteggi, stato, incidente collegato e cooldown delle notifiche.
- `kona_ai_notifiche` — migration `068`, outbox server-only Telegram con chiave anti-duplicazione, tentativi, backoff e dead-letter dopo otto fallimenti.
- `kona_ai_observer_checkpoint` — migration `068`, checkpoint e budget giornaliero dell'Observer per ambiente e tipo di scansione.
- `kona_ai_telegram_sessioni` — associa il solo `chat_id` proprietario all'incidente attivo e conserva l'ultimo `update_id` Telegram per dedupe.

### Post-Vendita
- `post_vendita_dispositivi_comodato` — codice generato da RPC `genera_codice_comodato()`
- `post_vendita_gestione_rimborsi` — codice da RPC `genera_codice_rimborso()`. Dalla migration `056` le scritture e la RPC sono server-only: gli operatori usano `gestisci-operazioni-post-vendita`, mentre la creazione manuale è esclusivamente admin.
- `post_vendita_controllo_fissi` — follow-up dei contratti Fisso dopo conferma in Verifica Contratti. Stati: `Da completare` → `In Attivazione` → (`Attivo` | `KO`); un admin può correggere un `Attivo` errato riportandolo a `In Attivazione` tramite backend, con azzeramento di `data_attivazione`. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_fissi` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Fisso passa a `controllato`. Campi manuali: `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`, `numero_fisso`, `attivazione_prevista`, `data_attivazione`, `motivo_ko`. Chat in `storico_chat` jsonb (`[{timestamp, message, autore}]`). CHECK constraint su `stato`, `tecnologia` (FTTC/FWA OUT/FWA IN/FWA VOCE/FTTH_OF/FTTH_FWCOP), `cod_pos` (9001415852/9000822241).
- `post_vendita_controllo_lg` — follow-up dei contratti Energia (L&G = Luce & Gas, nome user-facing del modulo) dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_lg` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Energia passa a `controllato`. I dati contratto/cliente sono letti dai join con `vendita_contratti` (`numero_contratto_energia`, `pod_pdr`, `ex_fornitore`, `operatore_id`) e `anagrafica`. L'upload CSV aggiorna `stato`, dettagli rifiuto e audit CSV. Migration `062`: `stato_origine`, flag `esito_manuale_bloccato`, motivazione/data/admin dell'esito manuale e audit dello sblocco; CHECK di coerenza + trigger DB impediscono agli operatori di creare/rimuovere il blocco o sovrascrivere una riga protetta.
- `post_vendita_controllo_assicurazioni` — follow-up dei contratti Assicurazioni dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_assicurazioni`. Dati di display dal join con `vendita_contratti` (`nome_offerta_snapshot`, `modalita_pagamento_assicurazione`, `ricorrenza_assicurazione`, `operatore_id`) e `anagrafica`. **Stato** (migration 033): colonna `stato` text NULL CHECK IN (`OK`,`KO`), default NULL. Dropdown in `controllo_assicurazioni.html` per scegliere l'esito (l'operatore lo seleziona quando ha l'esito; NULL = ancora da valutare, mostrato come "—"). `KO` rende il contratto candidato a essere padre di un reinserimento (vedi "Reinserimento contratti" in Regole di business). Audit: `stato_cambiato_at`, `stato_cambiato_da`.
- `post_vendita_controllo_allarmi` — follow-up dei contratti Allarmi dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_allarmi`. Dati di display dal join con `vendita_contratti` (`nome_offerta_snapshot`, `modalita_pagamento`, `operatore_id`) e `anagrafica`. **Stato** (migration 033): colonna `stato` text NOT NULL CHECK IN (`In Attivazione`,`OK`,`KO`), default `In Attivazione`. Dropdown in `controllo_allarmi.html` per cambiare stato. `In Attivazione` (default alla creazione automatica) e `KO` rendono il contratto candidato a essere padre di un reinserimento. Audit: `stato_cambiato_at`, `stato_cambiato_da`.

### Trasversali
- `segnalazioni` (+ `segnalazioni_backup`)
- `ticket` — badge in dashboard quando `stato='Da gestire'`
- `email_template` (con `{{placeholder}}`), `email_log` (`status` IN sent/error)
- `dashboard_righe_giornaliera` — config righe dashboard custom
- `mirox_public_rate_limits` — contatori temporanei del rate limit pubblico; fingerprint IP solo come SHA256, RLS attiva, nessun grant `anon`/`authenticated`. Scrittura/lettura tramite RPC service-role `mirox_public_rate_limit_v1` (migration `055`)

### RPC prenotazione pubblica (migration 055)
- `public_prenota_appuntamento_v1(...) RETURNS text` — RPC additiva service-role-only. Serializza lo stesso timestamp con advisory lock, richiama `get_slot_disponibili` e inserisce l'appuntamento nella stessa transazione. Non modifica la RPC legacy né la tabella condivisa.

### Viste
- `vw_elenco_chiamate_unificate`, `vw_rilavorazione_ricontatti_unificata` — UNION standard + outbound
- `view_vendita_dashboard_giornaliera` / `_mensile` — aggregati `vendita_contratti`
- `storico_cliente` — **dal 2026-06-20 estesa con 4 UNION CC** (totale 12): tipi `ordine_smartphone`, `dispositivo_comodato`, `rimborso`, `apri_chiudi_vecchio`/`_nuovo`, `switch_sim_attuale`/`_rientro`, `contratto_vendita`, + nuovi `chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`. Schema invariato (`anagrafica_id`, `tipo`, `record_id`, `riferimento`, `data_op`, `stato`, `descrizione`, `operatore_nome`). Definizione in `database/024_storico_cliente_extend_call_center.sql`. La scheda cliente mostra inoltre l'esito privacy calcolato da `check-consenso-privacy` e consente di scaricare l'ultimo modulo privacy archiviato dal bucket privato `consensi-privacy`.

### RPC derivazione origine pratica (dal 2026-06-20, rilassata 2026-06-24)
- `vendita_deriva_origine(p_anagrafica_id uuid) RETURNS jsonb` — usata dal wizard Upload Contratti per pre-compilare `origine_pratica`. Output: `{origine_pratica, evento_tipo, evento_id, descrizione}`. Priorità:
  1. **Appuntamento confermato non gestito** (presentato IS NULL OR 'si') per anagrafica, con `data_ora` tra oggi e oggi+30gg → `appuntamento_callcenter`. Include sia "oggi" sia "cliente arrivato in anticipo per appuntamento futuro" (la descrizione lo segnala)
  2. **Chiamata** `passa_in_negozio`/`passa_a_cerea` per anagrafica negli ultimi 10gg, con `passaggio_stato <> 'chiuso'` (quindi `in_attesa` o `passato`) → `contatto_callcenter_entro_10_giorni`. Rilassato per coprire il caso in cui l'operatore CC non ha ancora cliccato "Presentato" in Rilavorazione ma il cliente è già passato
  3. Default → `spontaneo`
  - Migration 026 (versione iniziale) + 027 (rilassamento + trigger auto-chiusura)

### Auto-chiusura eventi CC su nuova pratica (dal 2026-06-24, fix B1)
**ATTENZIONE**: il vecchio trigger DB `trg_vendita_pratica_auto_chiudi_cc` è stato **DROPPATO** in migration 028. Motivo: scattava su INSERT pratica PRIMA della creazione contratti, lasciando appuntamenti annullati orfani in caso di rollback. La logica è stata spostata nel backend Netlify per essere eseguita solo dopo successo completo.

- **RPC** `vendita_chiudi_eventi_cc_per_pratica(p_anagrafica_id uuid, p_pratica_id uuid) RETURNS jsonb` — chiamata dall'action `finalize` di `crea-vendita-pratica-carrello.js` solo DOPO che pratica, contratti, PDA e tutti i documenti restanti sono stati caricati. Fino ad allora la pratica resta `stato_pratica='bozza'`; se un upload fallisce l'action `rollback_upload_failure` la elimina senza toccare gli eventi CC. Ritorna `{appuntamenti_annullati, chiamate_chiuse, skipped}`. Best-effort: un errore RPC diventa warning ma non annulla la pratica già finalizzata.
- Logica identica al vecchio trigger:
  - **Annulla** `appuntamenti` con `stato='confermato'` AND `presentato IS NULL` AND `data_ora >= ieri` → `stato='annullato'` + `motivo_modifica='Chiuso automaticamente: cliente passato in anticipo, pratica vendita <uuid>'`. Lascia stare `presentato='si'` (vanno esitati in "Esiti Appuntamenti") e `presentato='no'` (restano per "Rilavorazione → Non Presentati")
  - **Chiude** `chiamate` con `rilavorazione_stato='da_lavorare'` OR `passaggio_stato='in_attesa'` → `rilavorazione_stato='completato'` + `passaggio_stato='chiuso'` (solo se era `'in_attesa'`)
  - Anti-rollback safety: verifica che la pratica esista davvero prima di operare
- Migration: `database/027` (introduce funzione + trigger originale) + `database/028` (rimuove trigger, mantiene funzione + nuova variante con pratica_id)

### Indici performance RPC (dal 2026-06-24)
- `idx_appuntamenti_anagrafica_stato_data` — `(anagrafica_id, stato, data_ora) WHERE anagrafica_id IS NOT NULL` — usato da `vendita_deriva_origine` livello 1
- `idx_chiamate_anagrafica_esito_data` — `(anagrafica_id, esito, data_ora DESC) WHERE anagrafica_id IS NOT NULL` — usato da `vendita_deriva_origine` livello 2
- `idx_chiamate_anagrafica_rilavorazione` — `(anagrafica_id) WHERE anagrafica_id IS NOT NULL AND (rilavorazione_stato='da_lavorare' OR passaggio_stato='in_attesa')` — usato da `vendita_chiudi_eventi_cc_per_pratica`

### Wizard: pass-through evento origine al backend
Il wizard Upload Contratti, al submit, passa `pratica.appuntamento_id` e `pratica.chiamata_id` valorizzati con `runtimeState.origineAutoRilevata.evento_id` (solo se l'operatore non ha overridato l'origine auto-rilevata). Le colonne FK su `vendita_pratiche` esistono già da schema legacy e vengono ora effettivamente riempite per il flusso CC.

### Trigger auto-link anagrafica (dal 2026-06-20)
- `trg_chiamate_auto_link_anagrafica` — `BEFORE INSERT OR UPDATE OF cf_piva ON chiamate`: se `anagrafica_id` NULL e `cf_piva` non vuoto, fa lookup su `anagrafica` (UPPER+TRIM match) e popola `anagrafica_id`. Non sovrascrive mai un valore esplicito
- `trg_appuntamenti_auto_link_anagrafica` — stessa logica su `appuntamenti.codice_fiscale`
- Backfill già eseguito su 872 chiamate e 9 appuntamenti orfani: ora il 100% delle chiamate e il 99.2% degli appuntamenti hanno `anagrafica_id`. Definizione in `database/025_chiamate_appuntamenti_anagrafica_autolink.sql`

### Storage buckets

Dal 2026-06-24 (migration `029`) i bucket dati clienti sono **PRIVATI**. La lettura ordinaria usa **signed URL** generati lato client con `MiroxStorage.signedUrl(bucket, path)` o `MiroxStorage.openAttachment(bucket, path)` (scadenza default 5 min); i bucket server-only `consensi-privacy` e `disdette-files` espongono invece signed URL tramite le rispettive Netlify Functions.

| Bucket | Public | Contenuto |
|---|---|---|
| `contratti-vendita` | privato | PDF dei contratti vendita + documenti identità clienti |
| `segnalazioni-files` | privato | Allegati segnalazioni + modelli disdetta in `modelli/<tipo>/` |
| `apri-chiudi-files` | privato | PDF apri/chiudi (cartella per pratica) |
| `switch-sim-files` | privato | PDF switch SIM (cartella per pratica) |
| `comodato-files` | privato | PDF moduli consegna/riconsegna comodato |
| `rimborsi-files` | privato | PDF moduli gestione rimborsi |
| `protecta-files` | privato | PDF preventivi simulatore Protecta |
| `consensi-privacy` | privato | PDF informativa GDPR firmati (OTP o scansione cartaceo). MIME only `application/pdf`, max 20 MB. Naming `Privacy_<RagSocSafe>_<CF>_<DD_MM_YYYY>.pdf` con eventuale suffisso `_<id6>` per collisioni. Path `<YYYY>/<MM>/`. Migration 034 |
| `disdette-files` | privato | PDF di recesso generati sui quattro moduli WindTre originali. PDF only, max 5 MB, path `<YYYY>/<MM>/<uuid>/<nome-file>.pdf`. Accesso esclusivo service role; `gestisci-disdette` restituisce signed URL di 5 minuti. Migration 063 |
| `moduli-template` | **pubblico** | Template modulistici (disdetta_fisso_consumer.pdf, ecc.) — generici, leggibili anche da non autenticati |

**Convenzione campi DB**: dopo migration 029 le colonne `cartella_url` / `preventivo_pdf_url` su `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_simulatore_protecta` contengono il **path** nel bucket (es. `dispositivo_X/file.pdf`), NON più un URL pubblico. I record legacy hanno ancora gli URL completi: il codice di lettura li gestisce entrambi (regex `replace` su prefisso `https://...storage/v1/object/public/<bucket>/`).

**RLS storage** (migration post-deploy `054`): i bucket privati operativi restano leggibili da `authenticated` per signed URL/list. Le policy INSERT/UPDATE/DELETE browser sui sette bucket dati vengono rimosse; le scritture passano esclusivamente da `upload-vendita-documento`, `upload-documento-modulo` o dalle altre functions specializzate con service role. I bucket `consensi-privacy` e `disdette-files` sono server-only. `moduli-template` resta l'unica eccezione pubblica/gestibile separatamente.

L'eccezione anon temporanea di `segnalazioni-files` introdotta dalla migration `032` è stata revocata dalla `036`; la `054` rimuove anche le residue policy di scrittura `authenticated` sul bucket.

---

## Flusso vendita end-to-end

1. `index.html` → login Supabase + check `profili.attivo`
2. `dashboard.html` → tab Vendita → card "Upload Contratti"
3. `moduli/upload-contratti-vendita.html` → wizard **5 step** con carrello multi-contratto:
   1. **Categoria + PDA**: dropdown categoria; se categoria ∈ `Mobile`/`Customer Base`/`Fisso` (costante `CATEGORIE_PDA`) → upload del PDA in staging via `POST /upload-vendita-documento` con `temp_session_id` UUID. Due bottoni: "Analizza con AI" (chiama `/ocr-pda` per pre-compilare anagrafica) e "Continua senza AI" (skip OCR). Per Energia/Allarmi/Assicurazioni nessun PDA viene caricato.
   2. **Anagrafica**: cf_piva (auto-detect cluster CF→Consumer, P.IVA→Business), email, cellulare, ragione sociale, ecc. Pre-compilata se l'OCR ha estratto dati. **Skippato automaticamente dal 2° contratto in poi** (anagrafica gia' nota nella pratica).
   3. **Dati contratto**: offerta/opzione/reload + campi specifici per categoria (Fisso/Energia/Allarmi/dispositivo).
   4. **Firma** (solo per categorie PDA): scelta tra `elettronica` o `cartacea`. Skippato per Energia/Allarmi/Assicurazioni. Il valore finisce in `vendita_contratti.tipo_firma`.
   5. **Documenti cliente**: documento_identita + eventuali copia_bolletta/copia_sim_mnp. Se `tipo_firma='cartacea'` appare anche il campo upload **"Contratto firmato"** (PDF della scansione del PDA firmato a mano dal cliente). **Niente upload contratto PDF originale qui** — quello e' gia' in staging dallo step 1.
   - **Regola multi-contratto**: dopo "Aggiungi un altro contratto" il wizard conserva solo anagrafica e documenti condivisi della pratica; categoria, PDA/input file/cache, stato visivo della drop-zone, firma e campi specifici vengono azzerati. Anche "Aggiungi altro contratto" dal carrello applica lo stesso reset. Non preselezionare mai categoria o PDF dal contratto precedente.
4. Submit "Invia pratica" → **prima del fetch al backend**, il wizard esegue il pre-step **consenso privacy GDPR** (vedi sezione "Sistema consensi privacy GDPR"):
   1. `POST garantisci-anagrafica` con i dati cliente → `anagrafica_id`
   2. `GET check-consenso-privacy?anagrafica_id=...` → se valido, entro 24 mesi e appartenente alle versioni informative v6 correnti, riusa `consenso_id` e procede senza modale
   3. Altrimenti popup di scelta modalità: **OTP via SMS** (Smshosting + 6 cifre + verifica server-side + PDF generato) oppure **modulo cartaceo** (download PDF precompilato + upload scansione firmata)
   4. Risultato: `consenso_id` valido, passato al backend nel campo `pratica.consenso_id`
5. → `POST /netlify/functions/crea-vendita-pratica-carrello`:
   - Upsert `anagrafica` (cerca per `cf_piva`, aggiorna solo campi vuoti). Email + cellulare obbligatori (400 se mancanti).
   - **Guard informativa privacy** (migration 034): query `vendita_consensi_privacy` per anagrafica_id con `stato='confermato'`, `informativa_versione` appartenente alle due v6 correnti, `revocato_at IS NULL` e `valido_fino_al > now()`. Se non esiste → errore 400. Se il client ha passato `pratica.consenso_id` verifica anche che corrisponda al record attivo (anti-tampering).
   - INSERT `vendita_pratiche` con `stato_pratica='bozza'`; `operatore_id` deriva dal profilo autenticato, il valore client viene ignorato
   - Back-link: se il consenso non aveva `pratica_id` (caso "appena raccolto"), aggiorna il record con la nuova pratica creata. Se aveva già `pratica_id` (caso riuso in dedupe 24 mesi) lascia il riferimento originale come audit.
   - Calcolo `nome_cartella_storage` = `Contratto_<RAGSOC>_<DD_MM_YYYY>_<id6>`
   - INSERT N × `vendita_contratti` con snapshot categoria/offerta/opzione/reload + punteggi calcolati server-side
   - **Promozione PDA**: per ogni contratto con `pda_temp_path`, sposta il file da `temp/<sess>/` a `<cartella>/contratto_<categoria>.pdf` e crea il record `vendita_documenti` (tipo `contratto`). Dalla seconda occorrenza della stessa categoria usa il suffisso progressivo `_2`, `_3`, ecc.
   - Rollback pratica + documenti Storage se anche un solo contratto o la promozione PDA falliscono
6. Upload PDF restanti (identita/bolletta/SIM) → `POST /netlify/functions/upload-vendita-documento` (multipart):
   - Verifica firma PDF e coerenza `pratica_id`/`anagrafica_id`/`contratto_id`; path e `uploaded_by` sono derivati server-side
   - Upload su bucket `contratti-vendita` in `<YYYY>/<MM>/<cartella_safe>/`
   - INSERT `vendita_documenti`
   - Rollback file su Storage se INSERT DB fallisce
   - Al termine il wizard chiama action `finalize`: pratica `bozza` → `inviata` + auto-chiusura eventi CC
   - Se un upload fallisce chiama `rollback_upload_failure`: elimina la pratica incompleta e i file già caricati, così un nuovo tentativo non duplica i contratti
7. Verifica contratto in `moduli/verifica_contratti.html` → `gestisci-vendita-contratto` action `update`, mode `verify`, che imposta server-side `stato_controllo='controllato'`, `controllato_da` dal JWT e gli snapshot/punteggi catalogo. Il popup di conferma per i contratti Fisso/Energia evidenzia il passaggio rispettivamente al modulo Controllo Fissi / Controllo L&G. Per categoria Energia, sono obbligatori in fase di verifica `numero_contratto_energia` E `ex_fornitore` (entrambi compilati nella sezione "Campi specifici categoria" del popup verifica). Il popup (solo tab "Da Verificare", editabile) contiene una sezione "Inserimento pratica" con **Data di upload** (`vendita_contratti.data_contratto`, input `datetime-local` in ora Europe/Rome) e **Operatore inserimento** (`vendita_contratti.operatore_id`, dropdown dei `profili` attivi) modificabili — salvati sia da "Salva modifica" sia da "Conferma verifica". Nella tab "Verificati" sono read-only: la barra dedicata `IMEI dispositivo` confronta esattamente `vendita_contratti.imei` dopo la rimozione degli spazi e il filtro `Cluster` confronta `vendita_contratti.cluster_cliente` (`Consumer`, `Business`, `Turista`), con fallback all'anagrafica soltanto per righe legacy; non trasformare l'IMEI in una ricerca parziale né invertire la priorità del cluster, altrimenti le pratiche Turista apparirebbero Consumer. La pagina accetta il deep-link `?contratto_id=<uuid>`: dopo aver caricato entrambe le liste valida l'UUID, rileva lo stato corrente, seleziona `Da Verificare` o `Verificati` e apre direttamente il popup del contratto.
8. Post-vendita Fisso: il trigger `trg_vendita_contratti_to_controllo_fissi` crea automaticamente una riga in `post_vendita_controllo_fissi` con stato `Da completare`. L'operatore compila i 4 campi obbligatori (Cod. Cliente, Tecnologia, Cod. Contratto, Cod. POS) in `moduli/controllo_fissi.html` → click "Compilazione Completata" → stato `In Attivazione`. Poi via dropdown stato → `Attivo` (con data attivazione effettiva obbligatoria) oppure `KO` (azzera `attivazione_prevista`). Nel dettaglio di una riga `Attivo`, solo gli admin vedono "Rimetti in attivazione": la function `gestisci-controllo-fissi` ricontrolla ruolo e stato, riporta la riga a `In Attivazione` e azzera `data_attivazione`.
9. Post-vendita Energia (L&G): il trigger `trg_vendita_contratti_to_controllo_lg` crea automaticamente una riga in `post_vendita_controllo_lg`. La pagina `moduli/controllo_lg.html` mostra tutti i dati incolonnati in tabella (nessun popup dettagli, nessuno step di completamento): Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contratto, POD/PDR, Ex Fornitore, Contatto (cellulare), Operatore, Stato.
10. Post-vendita Assicurazioni: il trigger `trg_vendita_contratti_to_controllo_assicurazioni` crea automaticamente una riga in `post_vendita_controllo_assicurazioni`. La pagina `moduli/controllo_assicurazioni.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Metodo di pagamento (RID/Carta di Credito/Carta di Debito), Ricorrenza (Mensile/Annuale).
11. Post-vendita Allarmi: il trigger `trg_vendita_contratti_to_controllo_allarmi` crea automaticamente una riga in `post_vendita_controllo_allarmi`. La pagina `moduli/controllo_allarmi.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Modalità di pagamento (Finanziamento/Anticipo).

Le pagine post-vendita dei punti 8–11 espongono `Vai alla pratica` per ogni riga e propagano `vendita_contratti.id` al deep-link di Verifica Contratti. Usare sempre l'ID contratto, non `pratica_id`, perché una pratica può contenere più contratti.

---

## Regole di business chiave

### Compilatore disdette (dal 2026-08-06, migrations 063–064)
- Varianti consentite: `sim_consumer`, `sim_business`, `fisso_consumer`, `fisso_business`; ogni PDF riguarda una sola utenza.
- Tutti i dati anagrafici, di contatto, indirizzo, utenza e le scelte pertinenti sono obbligatori. La data è precompilata con oggi ma è l'unico dato facoltativo e può essere cancellata senza bloccare la generazione.
- Nei Business il referente legale/delegato è composto da nome e cognome. Il ripensamento entro 14 giorni è disponibile solo per Consumer. Nei Fisso è obbligatorio scegliere cessazione completa oppure migrazione verso altro operatore.
- Lo spazio firma non viene mai compilato: il PDF prodotto deve essere stampato o firmato successivamente dal cliente.
- Tutti i dati testuali disegnati sul PDF sono normalizzati server-side in stampato maiuscolo con locale italiano, indipendentemente dal formato digitato nel frontend. Le baseline sono sollevate rispetto alle righe prestampate: offset standard 2,2 pt e CF 1,6 pt. Il numero dell'utenza da disdire è evidenziato in Helvetica Bold 14 pt, spostato 5 pt a destra e sollevato di 9,3 pt per aumentare il distacco inferiore dalla riga prestampata.
- I campi sono disegnati a coordinate fisse sui quattro template originali inclusi nel bundle della Function. La generazione è deterministica con `pdf-lib`; non richiede API OpenAI, OCR o interpretazione AI a runtime.
- Lo storico globale mostra Consumer come nome, cognome e CF; Business come ragione sociale e P.IVA; per entrambi espone anche il numero cessato. Il PDF resta privato e può essere visualizzato, riscaricato o stampato tramite signed URL temporaneo restituito dal backend.
- `Duplica dati` consente esclusivamente la scelta SIM/Fisso all’interno dello stesso cluster dell’originale. Il backend restituisce lo snapshot validato della singola pratica; i record precedenti alla migration `064`, privi di snapshot, restano visualizzabili ma non duplicabili automaticamente.
- La ricerca anagrafica è autenticata e legge `cf_piva`, `ragione_sociale`, `nome_referente`, cellulare e indirizzo dalla tabella condivisa `anagrafica`, senza modificarla. La separazione nome/cognome è best-effort; documento, CAP, utenza e dati mancanti devono essere verificati o completati manualmente dall’operatore.

### CF/PIVA → Cluster
- CF italiano (16 char, regex con caratteri omocodia) → `Consumer`
- P.IVA (11 cifre + Luhn IT) → `Business`
- Nessuno dei due → errore "verifica il dato" (no fallback)
- `Turista` → forza `categoria=Mobile`, `offerta="Untied - Call Your Country"`. Accettato solo da `crea-vendita-pratica-carrello.js`.

### Campi anagrafici obbligatori
Sia UI (`validateClienteData` in `upload-contratti-vendita.html`) sia backend (`crea-vendita-pratica-carrello.js`) **bloccano** la pratica se uno qualsiasi di questi campi e' vuoto o malformato:
- `cf_piva`, `cluster`, `ragione_sociale` (sempre obbligatori)
- `nome_referente`
- `cellulare`
- `email` (formato verificato con regex)
- `provincia`, `comune`, `via`, `civico` (indirizzo completo obbligatorio)

L'email viene normalizzata in lowercase. Nota: nel backend il flag `allowStrictContacts` controlla la severita' (oggi `false` per backwards compat con vecchi consumer della API).

### OCR sovrascrive sempre i dati anagrafici esistenti
Quando l'utente carica un PDA + sceglie "Analizza con AI", i dati estratti dall'OCR **sovrascrivono sempre** i valori dei campi del form, anche se l'anagrafica esiste gia' a DB con valori precedenti. Razionale: il PDA appena firmato e' la fonte di verita' piu' recente, l'anagrafica e' "always fresh".
- Implementazione: `applyOcrToAnagrafica` overwrite incondizionato + salva `runtimeState.lastOcrData`.
- Se l'utente clicca "Cerca cliente" dopo l'OCR, il risultato DB viene comunque sovrascritto da `lastOcrData` (re-applied in `cercaCliente`).
- `lastOcrData` viene azzerato quando si reset il form contratto (nuovo contratto nello stesso carrello).

### Categorie ammesse al flusso PDA
- Costante `CATEGORIE_PDA = ['Mobile', 'Customer Base', 'Fisso']`.
- Per queste 3 categorie il PDA (contratto PDF) e' obbligatorio e viene caricato allo step 1 del wizard in staging (`temp/<temp_session_id>/pda_<rand>.pdf`); poi promosso a `<cartella_pratica>/contratto_<categoria>.pdf` al submit. Più contratti della stessa categoria usano nomi progressivi (`contratto_<categoria>_2.pdf`, `_3.pdf`, ecc.).
- Per `Energia`, `Allarmi`, `Assicurazioni`: NESSUN PDA, NESSUN documento "contratto" (resta solo `documento_identita` + eventuali bolletta/SIM).
- L'OCR del PDA e' opzionale: il bottone "Continua senza AI" salta la chiamata a Claude API ma carica comunque il file in staging.

### Step Firma (solo categorie PDA)
- Solo per Mobile / Customer Base / Fisso il wizard chiede tra step Contratto e step Documenti la modalita' di firma: `elettronica` o `cartacea`. Il valore finisce in `vendita_contratti.tipo_firma` (vincolato dal CHECK constraint).
- `elettronica`: nessun upload aggiuntivo. Il PDA originale gia' in staging diventa l'unico `contratto.pdf` in cartella pratica.
- `cartacea`: nello step Documenti compare un upload "Contratto firmato" obbligatorio. Il file viene caricato a parte tramite `/upload-vendita-documento` con `tipo_documento='contratto_firmato'` e salvato come `<cartella_pratica>/contratto_firmato_<categoria>.pdf` (affianca il PDA originale); anche questo nome diventa progressivo quando la categoria ricorre più volte.
- Per Energia/Allarmi/Assicurazioni lo step Firma e' saltato e `tipo_firma` resta NULL nel DB.

### Punteggi (anti-tampering)
- Il **frontend NON deve mai mandare i punteggi**. I campi sono esclusi dall'allowlist di `gestisci-vendita-contratto`.
- Il server legge dal catalogo i quattro componenti gara/extra. `parseRequiredScore()` accetta lo zero reale ma blocca `null`, stringa vuota e valori non numerici.
- Alla creazione, dopo l'INSERT, `assertPersistedContractScores()` confronta i componenti attesi con la riga restituita da Postgres e verifica anche totali/colonne legacy. Una divergenza fa fallire la richiesta e attiva il rollback compensativo della pratica ancora in bozza.
- In Verifica Contratti, se offerta/opzione non cambiano i relativi componenti restano quelli già presenti a DB; se l'ID cambia, il backend rilegge il catalogo. Anche la riga post-UPDATE viene verificata.
- Trigger `vendita_calcola_punteggio_totale` ricalcola i totali su ogni INSERT/UPDATE. Migration `058` aggiunge tre CHECK non aggirabili e audit permanente delle variazioni.
- **Bonus Assicurazione Annuale**: vale 0,5 ed è parte dello snapshot `punteggio_gara_opzione`, non del catalogo opzioni. La configurazione è letta in modalità fail-closed: se manca o non è numerica la creazione/modifica interessata viene bloccata, mai degradata silenziosamente a zero.
- **Audit production 26/07/2026**: 247 contratti di luglio, tutti controllati; zero incoerenze strutturali e zero cataloghi mancanti. Gli 8 contratti con totale 0 sono legittimi: 7 `Sim Convergente *INTERNA*` e 1 `CB Caring - MOBILE`, tutte offerte con punteggio catalogo 0. L'analisi della regola bonus ha trovato 3 Assicurazioni Annuali create dopo l'attivazione del bonus ma poi riallineate al solo catalogo base dal vecchio fix: migration `060` le ha corrette da 1,5 a 2,0 punti totali. Altri 7 Mobile avevano correttamente 1 punto opzione ma `opzione_id`/nome persi: tutti i PDA indicano Iliad Italia e migration `061` ha ripristinato i metadati senza cambiare il punteggio.

### Validazioni categoria-specifiche (in `crea-vendita-pratica-carrello.js → validateCategorySpecificRules`)
- **Fisso**: `tipo_attivazione` IN ('Nuova Attivazione','Portabilita'); `apri_chiudi` Si/No; se Sì → `intestatario` IN ('Stesso intestatario','Intestatario diverso'). Al passaggio step 2 → step Firma il wizard apre un popup che richiede 2 campi obbligatori: `prezzo_fisso` (numerico >= 0) e `convergenza` IN ('Mobile','L&G','Allarme','Assicurazione','Sim Interna','NO Convergenza','Coupon'). La `convergenza` è enforced anche a livello DB con CHECK constraint (vedi migration 017).
- **Allarmi**: `modalita_pagamento` IN ('Finanziamento','Anticipo')
- **Fisso FWA Indoor** (offerta nome contiene "fwa" + "indoor", case-insensitive): logica speciale dal 2026-06-27. `dispositivo_associato` è **forzato a Si e non modificabile** (il modem c'è sempre). `tipo_acquisto` è **forzato a 'VAR' e non modificabile** (modem sempre a rate, mai finanziamento). Mostra solo IMEI, Prezzo Device, Tipo Acquisto (locked VAR). **Nasconde** Kolme + Smartphone Reload + modalita + Finanziaria (non rilevanti per il modem FWA). OCR estrae `imei` da "Seriale/IMEI:" o "SERIALE MODEM" + `prezzo_device` da "prezzo pari a X,XX euro" o "cede l'importo di X,XX euro" (virgola → punto). `tipo_acquisto` e `smartphone_reload` restano null nell'OCR, il client/server forzano `tipo_acquisto='VAR'`. Backend `crea-vendita-pratica-carrello.js` forza server-side `tipo_acquisto='VAR'`, `finanziaria=null`, `kolme=null`, `smartphone_reload=null`, `smartphone_reload_modalita=null` per offerte FWA Indoor (safety net contro client legacy).
- **Dispositivo** (solo se `vendita_offerte.abilita_dispositivo=true` E `dispositivo_associato=true`):
  - `imei` regex `^\d{15}$`
  - `fascia_prezzo` obbligatoria. Dal 2026-06-26 **non è più una dropdown a range** (`0-249`/`250-599`/...) ma un **input testo numerico libero** che contiene il **prezzo puntuale del device in euro** (es. `399.90`, `1509.90`). Auto-compilato dall'OCR del PDA (campo `Prezzo device: X.XX euro`). Validazione wizard: regex `^\d+(\.\d{1,2})?$` (virgola viene normalizzata a punto). Colonna DB `vendita_contratti.fascia_prezzo` è già `text`, nessuna migration. Il nome del campo a DB è mantenuto per compatibilità storica/dashboard pezzi; semanticamente ora è "prezzo device"
  - `tipo_acquisto` IN ('VAR','Finanziamento'); se Finanziamento → `finanziaria` IN ('Findomestic','Compass'). Auto-compilato dall'OCR (riconoscimento via 3 segnali concordi titolo+sezione+riga SIM del PDA WindTre). `finanziaria` resta manuale (non presente nel PDA)
  - `kolme` boolean obbligatorio. Resta manuale (non presente nel PDA)
- **Energia**: campo `pod_pdr` raccolto nel wizard. `numero_contratto_energia` e `ex_fornitore` (text libero) sono predisposti vuoti dal wizard e diventano **obbligatori in fase di verifica** (`moduli/verifica_contratti.html` → `confermaVerifica` valida entrambi prima del passaggio a `stato_controllo='controllato'`).
- **Assicurazioni**: `modalita_pagamento_assicurazione` IN ('RID','Carta di Credito','Carta di Debito') e `ricorrenza_assicurazione` IN ('Mensile','Annuale'), entrambi obbligatori (CHECK DB su migration 021). Sono colonne separate dal `modalita_pagamento` di Allarmi.
- **Mobile / Customer Base**: 2 checkbox `reload_exchange` + `reload_forever` (migration `035`). Entrambi boolean NOT NULL DEFAULT false. Allineati esteticamente sotto la dropdown Offerta nel wizard, visibili solo per Mobile/Customer Base. Catalogo `vendita_reload` non più gestito (vedi "Note operative consapevoli").
- **Smartphone Reload** (solo se `dispositivo_associato=true`, migration `035`): risposta alla riga "È stata richiesta l'attivazione contestuale dell'opzione SMARTPHONE RELOAD SI [X] NO [X]" del PDA WindTre. `smartphone_reload` boolean NULL (true=Si, false=No, NULL=non specificato). Auto-compilato dall'OCR. Se `smartphone_reload=true` allora `smartphone_reload_modalita` text NOT NULL CHECK IN ('Mantenere attivo','Disattivazione cliente') — **manuale operatore** (non estraibile dal PDA). CHECK DB di coerenza: modalita IS NULL ⇔ smartphone_reload IS NOT TRUE.

### Origine pratica (CHECK constraint su `vendita_pratiche`)
`appuntamento_callcenter`, `contatto_callcenter_entro_10_giorni`, `spontaneo`

### Consenso privacy GDPR (dal 2026-06-26, migration 034)
- Ogni pratica creata da Upload Contratti richiede una dichiarazione privacy valida in `vendita_consensi_privacy` per l'`anagrafica_id`. Il backend `crea-vendita-pratica-carrello.js` richiede `stato='confermato'`, una delle due versioni informative v6 correnti, scadenza futura e nessuna revoca.
- Il wizard `upload-contratti-vendita.html` intercetta il submit `btnInviaPratica` e, prima di POST al carrello, fa il pre-step:
  1. `garantisci-anagrafica` → ottiene `anagrafica_id` (upsert)
  2. `check-consenso-privacy?anagrafica_id=...` → **dedupe 24 mesi + versioni v6 correnti**: se valido, salta tutto e propaga `consenso_id` al carrello
  3. Altrimenti modale 2 scelte (`OTP via SMS` consigliato, `cartaceo` fallback)
- Validità massima: 24 mesi dalla conferma, calcolata nelle due functions con `addMonthsClamped`. La migration `055` accorcia anche i record storici che superano tale termine.
- Backend valida `consenso_id` opzionalmente passato dal client come **anti-tampering**: deve corrispondere al consenso attivo per quell'anagrafica.
- `consenso_contratto` rappresenta la presa visione dell'informativa, non la base giuridica del contratto. `consenso_marketing` è facoltativo, separato e revocabile per canale; è però obbligatorio esprimere esplicitamente una delle due scelte ACCONSENTO/NON ACCONSENTO prima del download cartaceo o dell'invio OTP.

### Reinserimento contratti (dal 2026-06-25, migration 033)
Quando una pratica va in KO post-vendita (o `Rifiutata`/`Annullata`/`In lavorazione` per Energia) e viene ricaricata come pratica nuova dopo qualche giorno, la dashboard mensile dei pezzi rischierebbe il **doppio conteggio** (KO + reinserita = 2 pezzi quando è 1 sola vendita). Per evitarlo:

**Schema** (migration 033 su `vendita_contratti`):
- `stato_inserimento` text NOT NULL DEFAULT `'inserimento'` CHECK IN (`'inserimento'`,`'reinserimento'`)
- `reinserimento_di_contratto_id` uuid NULL REFERENCES `vendita_contratti(id)` ON DELETE SET NULL
- CHECK di coerenza: `'reinserimento'` ⇒ FK NOT NULL; `'inserimento'` ⇒ FK IS NULL
- Indice composto `(anagrafica_id, categoria_id, data_contratto DESC)` per il lookup; indice parziale su `reinserimento_di_contratto_id` per il drill-down inverso

**Flusso wizard** (`upload-contratti-vendita.html`):
1. All'apertura dello **step 3 (Dati contratto)** il wizard chiama `checkReinserimento(anagrafica_id, categoria_id, categoria_nome)` se la coppia (anagrafica, categoria) non è già stata verificata in sessione (`runtimeState.lastReinsCheckKey`)
2. La funzione fa due query: prima recupera i contratti `vendita_contratti` del cliente per quella categoria nello **stesso mese solare corrente** (timezone `Europe/Rome`, estremi del mese calcolati con offset distinti per gestire correttamente i cambi ora legale di marzo/ottobre; `stato_inserimento='inserimento'`, esclude catene), poi recupera dalla tabella post-vendita appropriata gli stati che fanno scattare il popup. Un contratto del mese precedente viene sempre trattato come inserimento nuovo
3. Mapping categoria → tabella → stati trigger:
   - **Fisso** → `post_vendita_controllo_fissi.stato` IN (`KO`,`In Attivazione`)
   - **Energia** → `post_vendita_controllo_lg.stato` IN (`Rifiutato`,`Annullato`,`Nuovo`,`In lavorazione`,`In attivazione`) (tutto tranne `Attivato`/NULL)
   - **Allarmi** → `post_vendita_controllo_allarmi.stato` IN (`KO`,`In Attivazione`)
   - **Assicurazioni** → `post_vendita_controllo_assicurazioni.stato` = `KO`
   - Mobile / Customer Base → no check (nessuna tabella post-vendita)
4. Se ≥1 candidato → popup modale (riusa `loadingOverlay`) con elenco (radio: data, offerta, eventuali numero contratto/POD, stato post-vendita) + 2 bottoni `Sì, è un reinserimento` / `No, è un inserimento nuovo`
5. La scelta finisce in `runtimeState.pendingReinserimento` (`{contratto_id, descrizione}` o `null`), poi nel draft del carrello (`stato_inserimento`, `reinserimento_di_contratto_id`)
6. In carrello: chip arancione **Reinserimento** se `stato_inserimento='reinserimento'`. Il popup non si rimostra per la stessa coppia (anagrafica, categoria); reset alla prossima `resetContractFields()` (multi-contratto: l'utente può aggiungere un secondo contratto Fisso dello stesso cliente che viene ri-chiesto)

**Backend** (`crea-vendita-pratica-carrello.js`):
- Default `stato_inserimento='inserimento'` se non passato; CHECK enum
- Se `'reinserimento'`: valida `reinserimento_di_contratto_id` come UUID, verifica che esista e appartenga alla **stessa anagrafica**, **stessa categoria** e **stesso mese solare Europe/Rome**, quindi ricontrolla nella tabella post-vendita lo stato ammesso per quella categoria (errori 400 altrimenti)
- Se `'inserimento'`: forza `reinserimento_di_contratto_id=null` (idempotente)

**Dashboard**: i reinserimenti sono esclusi sia dal Day by Day sia dai dati mensili/Gare Individuali/Avanzamento Mensile. In `moduli/dashboard_pezzi.html` l'export PNG usa `html2canvas@1.4.1`: Gare Individuali espone un download per ciascuna scheda operatore e cattura soltanto quella scheda; Avanzamento Mensile espone un unico download che cattura insieme le due tabelle del mese selezionato. I pulsanti di download non devono comparire nel PNG. Metrica derivata "tasso di rilavorazione = reinserimenti / inserimenti totali" ancora da implementare.

### Controllo Fissi (post-vendita)
- Tabella: `post_vendita_controllo_fissi` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_fissi`: alla conferma verifica di un contratto Fisso (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_fissi` con stato `Da completare`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Stati ammessi** (CHECK `pvcf_stato_chk`): `Da completare`, `In Attivazione`, `Attivo`, `KO`. Transizioni: `Da completare` → `In Attivazione` (via bottone "Compilazione Completata") → `Attivo` (richiede `data_attivazione` effettiva) | `KO` (azzera `attivazione_prevista`, opzionale `motivo_ko`). `KO` ammesso solo da `In Attivazione`. `KO` resta terminale; `Attivo` è modificabile soltanto tramite il ripristino admin `Attivo` → `In Attivazione`, che azzera la data effettiva e aggiorna l'audit.
- **Campi obbligatori** per "Compilazione Completata" (validati lato UI in `moduli/controllo_fissi.html`): `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`. `numero_fisso` e `attivazione_prevista` opzionali.
- **Tecnologia** (CHECK `pvcf_tecnologia_chk`): `FTTC`, `FWA OUT`, `FWA IN`, `FWA VOCE`, `FTTH_OF`, `FTTH_FWCOP`.
- **Cod. POS** (CHECK `pvcf_cod_pos_chk`): `9001415852` (Legnago), `9000822241` (Cerea). Il codice Cerea era stato inserito troncato a 9 cifre (`900822241`) fino alla migration `050`, che ha ricreato il CHECK con il valore corretto. Lo stesso valore è quello del **Codice Rivenditore** su `vendita_contratti` (vedi sezione "Codice rivenditore").
- **Chat note**: array JSONB `storico_chat = [{timestamp, message, autore}]` — stesso pattern di `segnalazioni.storico_chat`.
- **UI a 2 tab**: `Da Completare` (pratiche aperte) + `Elenco Contratti` (vista unificata In Attivazione / Attivo / KO). La tab Elenco ha 3 filtri dropdown (Cluster, Tecnologia, Stato) e una search; la search è mutuamente esclusiva coi filtri (digitando si svuotano i dropdown, cambiando un filtro si svuota la search). Default all'apertura della tab Elenco: filtro Stato = `In Attivazione`. Tre stat-card live sopra la tabella: `In Attivazione` (totale aperti), `Attivati nel mese` (`stato=Attivo` AND `data_attivazione` nel mese corrente), `KO nel mese` (`stato=KO` AND `stato_cambiato_at` nel mese corrente).

### Controllo L&G (post-vendita Energia)
- Tabella: `post_vendita_controllo_lg` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_lg`: alla conferma verifica di un contratto Energia (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_lg`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Campi colonna** (UI `moduli/controllo_lg.html`, tabella diretta senza popup dettagli): Data Inserimento (`vendita_contratti.data_contratto`), Ragione Sociale, CF/PIVA, Numero Contratto (`vendita_contratti.numero_contratto_energia`, compilato in verifica), POD/PDR (`vendita_contratti.pod_pdr`), Ex Fornitore (`vendita_contratti.ex_fornitore`, compilato in verifica), Contatto (`anagrafica.cellulare`), Operatore (`profili.nome` via `vendita_contratti.operatore_id`), Stato (`post_vendita_controllo_lg.stato`).
- **`stato`**: text NULLABLE senza CHECK constraint (l'utente vuole flessibilita' nel caso il portale WindTre aggiunga stati nuovi). UI mostra "—" se NULL. Pillola colorata in base al valore (Attivato verde, Rifiutato rosso, ecc.).
- **Upload CSV WindTre** (bottone "📥 Carica CSV WindTre" nella tab Elenco):
  - Parser via PapaParse (CDN), separatore `;`, header riga 1.
  - **Match primario composito**: `Proposta di Contratto` + POD/PDR (CSV) ↔ `vendita_contratti.numero_contratto_energia` + `vendita_contratti.pod_pdr`. Gli header punto riconosciuti coprono sia una colonna combinata (`POD/PDR`, `POD o PDR`, `Codice POD/PDR`, `Punto di fornitura`) sia colonne separate `POD`/`PDR` e relative varianti `Codice`/`Numero`. PC uguali con punti differenti restano record indipendenti e aggiornano ciascun contatore.
  - **Fallback storico sicuro**: se il CSV non espone il POD/PDR, il match per sola PC e' ammesso esclusivamente quando quella PC identifica una sola riga Mirox. Una PC multipla senza punto, un punto CSV non presente tra i contratti della PC o un POD/PDR duplicato a DB non vengono aggiornati e finiscono rispettivamente nel report `Abbinamenti ambigui` / `POD/PDR non trovati`.
  - **Double check**: per cluster `Consumer` confronta `Codice Fiscale` (col E) con `anagrafica.cf_piva`. Per `Business` confronta `Partita Iva` (col F) **normalizzata con padding zeri a sinistra fino a 11 cifre** (il portale rimuove gli zeri iniziali).
  - **Sovrascrittura automatica**: se il match passa, lo `stato` viene aggiornato anche se gia' valorizzato (es. da `Nuovo` a `Rifiutato` dopo qualche giorno), salvo `esito_manuale_bloccato=true`.
  - **Aggregazione dei soli duplicati reali**: la priorita' `Rifiutato > Annullato > In lavorazione > In attivazione > Nuovo > Attivato` si applica soltanto a righe con la stessa coppia PC + POD/PDR. Non viene mai usata per comprimere punti di fornitura differenti sotto la stessa PC.
  - **Colonne dettaglio rifiuto** (`causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento`) valorizzate **solo** se stato='Rifiutato' (azzerate altrimenti).
  - **Report finale**: popup con stat-card e tabelle dettagliate per PC assenti, POD/PDR non trovati, abbinamenti ambigui, CF/P.IVA discordanti, esiti manuali protetti, stati invariati ed errori di salvataggio.
- **Esito manuale admin-only** (migration `062`): il bottone `Esita manualmente` e' visibile solo agli admin. Richiede uno stato canonico e una motivazione di almeno 5 caratteri; salva `stato_origine='manuale'`, autore/data e `esito_manuale_bloccato=true`. L'elenco manuale include anche `NON TROVATO`, opzione esclusivamente admin con pillola fucsia e non appartenente alla gerarchia degli stati CSV. Tutti i futuri CSV saltano la riga e la elencano come protetta. `Riattiva aggiornamenti CSV` rimuove esclusivamente il blocco: lo stato resta manuale fino al successivo CSV valido, che lo sostituisce e riporta `stato_origine='csv'`. Il controllo ruolo e' duplicato in Netlify Function e trigger DB.
- **Icona occhio 👁️** in fondo alle righe con stato='Rifiutato': apre popup con i 3 campi dettaglio (causale/messaggio/causa). Per gli altri stati nessuna icona.

### Storage folder naming
- Contratti vendita: `Contratto_<RAGSOC_SAFE>_<DD_MM_YYYY>_<praticaIdShort6>` sotto `<YYYY>/<MM>/` (lowercase)
- Altri moduli: `MiroxFolder.build(old, new, date)` → `OLD_NEW_GG_MM_AA` (uppercase)

### Documenti
- Bucket: `contratti-vendita`
- Tipi gestiti: `documento_identita`, `contratto`, `contratto_firmato`, `copia_bolletta`, `copia_sim_mnp`
- Regole con `campo_condizione='admin_config'` sono gestibili da UI admin
- Nome standard: `documento_identita.pdf`, `contratto_<categoria_slug>[_N].pdf`, `contratto_firmato_<categoria_slug>[_N].pdf` (solo per firma cartacea), `copia_sim_mnp.pdf`, `copia_bolletta.pdf`. `[_N]` parte da `_2` quando più contratti della stessa categoria condividono la pratica.
- Solo `application/pdf`, max 20 MB

---

## Modulo Call Center integrato (Fase 1, dal 2026-06-20)

Le 11 pagine CC storiche stanno in `moduli/call-center/` (`configurazione.html` è stata spostata sotto Admin Mirox il 2026-06-24). Le pagine storiche restano un **port pragmatico** dal CC prod. Anagrafiche è invece un modulo Post-Vendita in `moduli/anagrafiche.html`; dalla migration `070` condivide con il CC il solo trigger sintattico non bloccante su Comune/Provincia, approvato esplicitamente e senza modifiche a colonne, RLS o RPC esistenti.

### Cosa è stato modificato nel port (Fase 1 + harmonization 2026-06-24 + Admin split 2026-06-24)

1. **Redirect login**: `window.location.href='index.html'` → `'../../index.html'` (nei 11 HTML loggati + 4 JS: `js/auth.js`, `js/call-center-lead-outbound.js`, `js/prenota-interno-outbound.js`, `js/registra-chiamata-outbound.js`)
2. **Rimosso `index.html`** del CC (Mirox ha il proprio login alla root)
3. **Sidebar laterale CC RIMOSSA** (harmonization 2026-06-24): sostituita da `cc-header` (topbar + tabs orizzontali), generato dinamicamente da `js/cc-header.js`. Le tab sono filtrate per `pagine_accessibili` come la vecchia sidebar
4. **CSS DEDUPLICATO**: cancellata cartella `moduli/call-center/css/` (era duplicato byte-per-byte di `css/style.css`). Tutte le pagine CC ora referenziano `../../css/style.css` (single source of truth)
5. **Layout classes**: `.app-layout` → `.cc-layout`, `.main-content` → `.cc-main` (nuove classi in `css/style.css` senza margin-left della sidebar)
6. **Vecchio breadcrumb arancione rimosso**: era redundante con il bottone "Dashboard" nella nuova topbar
7. **`configurazione.html` ELIMINATA**: spostata fuori dal CC in `admin-call-center-config.html` (root). La tab Utenti è stata estratta in pagina separata `admin-utenti.html`. La vecchia chiave `configurazione` resta in `profili.pagine_accessibili` per coerenza col CC prod, ma non è più consumata da Mirox

### Componente JS `js/cc-header.js`

Esposto globalmente come `window.CcHeader`. API: `CcHeader.render(paginaChiavePerm)`. Genera in `#ccHeader`:
- **Topbar**: bottone "Dashboard" arancione (a sinistra) + logo Mirox (centro) + user chip + bottone logout (a destra)
- **Tab nav orizzontale**: 9 voci CC, filtrate per `profili.pagine_accessibili[perm]` (admin vede tutte). Tab corrente in evidenza arancione

### Compatibilità UI ancora presente (debito tecnico non bloccante)

Le pagine CC ancora usano:
- `Utils.toast/openModal/closeModal/showLoading/...` (in `moduli/call-center/js/app.js`) invece di `MiroxUI.*`

La creazione anagrafica in `registra-chiamata.html` passa da `AnagraficaHelper.cercaOcrea`, quindi è idempotente anche in caso di richieste concorrenti. Non restano `alert()`/`confirm()` nativi nei flussi CC controllati. La sostituzione integrale di `Utils.*` è un refactor estetico/architetturale facoltativo, non un difetto di sicurezza aperto.

### Accesso dalla dashboard Mirox

- **Solo via bottone topbar** "Call Center" — niente tab/card nella dashboard (scelta UX dell'utente: la dashboard è focus Vendita/Post-Vendita, il CC ha la sua sidebar interna come navigazione)
- **Redirect dinamico runtime**: al caricamento dashboard, il JS calcola la **prima pagina CC accessibile** per l'utente (ordine: registra_chiamata → elenco_chiamate → rilavorazione → call_center_lead_outbound → appuntamenti → prenota_interno → appuntamenti_oggi → esiti_appuntamenti → blacklist) e imposta `href` del bottone topbar a quell'URL diretto
- **Disabilitato se nessun permesso**: se l'utente non ha **nessuna** delle chiavi CC in `pagine_accessibili` (e non è admin), il bottone resta in classe `.disabled` (come nasce nell'HTML statico) e il click è bloccato
- **Bottone "Torna alla dashboard Mirox"** in cima a ogni pagina CC integrata: arancione, ben visibile (era un breadcrumb piccolo, ora è un bottone stilizzato — eccetto `prenota.html` pubblica)

### Chiavi permessi (riusate identiche al CC prod)

`registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`. La chiave `configurazione` resta valida in DB (CC prod la usa) ma da Mirox la pagina è sotto Admin. Anagrafiche non è una chiave CC: è una card del tab Post-Vendita per ogni account CRM attivo.

→ Zero migrazione utenti: chi ha permesso `'registra_chiamata'` su `mirox-crm.netlify.app` vede la stessa card anche qua.

### Pagina pubblica `prenota.html`

Form esterno per prenotazioni dal sito/social. **NON in dashboard** (non ha auth guard). Raggiungibile solo via URL diretto e non parla direttamente con Supabase. La function `public-prenota.js` applica validazione, allowlist motivi e rate limit persistente; la RPC additiva della migration `055` impedisce il doppio booking concorrente. Gli errori sono mostrati in un riquadro accessibile, senza `alert()` nativo.

### Rischi e limiti noti

- **Permessi granulari Mirox solo per CC**: la modale "Permessi CC" in `admin-utenti.html` lista le 10 chiavi CC (le pagine Vendita/Post-Vendita sono accessibili a tutti gli utenti attivi, non c'è ancora granularità)
- **`vw_elenco_chiamate_unificate` / `vw_rilavorazione_ricontatti_unificata`**: usate dalle pagine CC, dipendono dalla colonna `chiamate.rilavorazione_stato` (esiste) e dalle viste già createSE — verificate online in Fase 1
- **`get_slot_disponibili` RPC**: usata da `prenota.html`, `prenota-interno.html`, `appuntamenti.html` (per spostamento). Confermata esistente nel DB

---

## Pannello Admin Mirox (dal 2026-06-24, shell condivisa dal 2026-07-27)

Hub centralizzato di amministrazione, gated da `profili.ruolo='admin'`. Visibile dalla dashboard come bottone topbar "Admin" (disabilitato per operatori). Tutte le pagine riusano `css/admin-shell.css` + `js/admin-shell.js`: a sinistra compare la navigazione per reparti, a destra il contenuto della pagina. `Configurazioni` è aperto di default; `KPI` contiene `Vendita - Consumer`, `Vendita - Business` e `Call Center` e si apre automaticamente nelle relative pagine. Sotto gli 860 px la sidebar diventa un drawer. La shell deve mantenere continuità con il design system esistente: logo ufficiale `assets/logo.png`, palette chiara, arancione Mirox, variabili colore condivise, radius e ombre di `css/style.css`; non introdurre marchi o simboli sostitutivi.

### Pagine

| Pagina | Scopo |
|---|---|
| `admin.html` | Landing della shell Admin con riepilogo dei reparti Configurazioni e KPI |
| `admin-utenti.html` | CRUD su `profili`: cambio ruolo admin↔operatore con conferma, abilita/disabilita, modale permessi granulari CC (10 chiavi). Un admin non può togliersi il ruolo né disabilitarsi |
| `admin-call-center-config.html` | Configurazione CC (orari settimanali, blocchi/chiusure, parametri sistema). Spostata da `moduli/call-center/configurazione.html` (eliminata). NON dipende da `CcHeader` o dai JS del CC: usa solo `js/config.js` + `js/auth.js` + `js/mirox-ui.js` Mirox |
| `admin-vendita-config.html` | CRUD cataloghi vendita. Check `ruolo='admin'`; la navigazione verso gli altri moduli passa dalla shell condivisa |
| `admin-gare.html` | Configurazione metriche, obiettivi mensili, compensi e operatori in gara |
| `admin-kpi-vendita-consumer.html` | Reparto KPI, modulo Vendita - Consumer. Tab attive nell'ordine Mobile, Fisso, Luce & Gas, Allarmi, Assicurazioni. Filtri anno/negozio, tabelle KPI mensili e confronto operatori dinamico |
| `admin-kpi-vendita-business.html` | Reparto KPI, modulo Vendita - Business. Stessa UI e stesse regole del Consumer, limitate a `cluster_cliente='Business'` |
| `admin-kpi-call-center.html` | Reparto KPI, modulo Call Center. Filtri anno/mese/vista/operatrice, riepilogo, dettaglio giornaliero o settimanale o mensile, confronto operatrici e tassi di efficacia |

### Regole KPI Call Center

- `Chiamate fatte` somma le righe di `chiamate` e `call_center_lead_outbound_chiamate` nel giorno di `data_ora` in `Europe/Rome`; `Con risposta` esclude soltanto `esito='non_risposto'`.
- `Appuntamenti fissati` usa `appuntamenti.created_at`, così misura il lavoro svolto nel giorno. Presentati, non presentati, vinti, persi e annullati usano invece il giorno previsto in `appuntamenti.data_ora`.
- `Chiusi / vinti` corrisponde a `esito_finale='vinta'`; `Persi` a `esito_finale='persa'`; `Non presentati` a `presentato='no'` e `Annullati` a `stato='annullato'`.
- I dati sono attribuiti a `operatore_id` per le chiamate e `fissato_da_operatore_id` per gli appuntamenti. `profili.alias_di` consolida gli account storici; gli appuntamenti pubblici senza operatrice sono mostrati come `Online / non assegnato`.
- I tassi aggiuntivi sono: risposta = con risposta / chiamate; appuntamento = fissati / chiamate; presenza = presentati / (presentati + non presentati); chiusura = vinti / (vinti + persi).

### Regole KPI Vendita - Consumer

- Il tab Mobile conta esclusivamente `vendita_contratti` con `categoria_snapshot='Mobile'` e `cluster_cliente='Consumer'`; ogni riga vale una acquisizione.
- Il mese deriva da `data_contratto` nel fuso `Europe/Rome`. Nell'anno corrente il totale mostrato è YTD e i mesi futuri restano vuoti.
- `Dettaglio MNP` mostra prima il totale, poi `MNP Standard` e `MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali`; lo snapshot dell'opzione è la fonte del conteggio.
- `Dettaglio Smartphone` usa il flag del singolo contratto `dispositivo_associato=true`, non la capacità dell'offerta di supportare dispositivi.
- Il tab Fisso conta `categoria_snapshot='Fisso'` e `cluster_cliente='Consumer'`. Acquisizioni, dettaglio tecnologia ed esiti usano il mese di `data_contratto`; gli stati `Da completare`, `In Attivazione` e l'assenza della riga post-vendita confluiscono in `IN ATTIVAZIONE`, mentre `Attivo` e `KO` restano separati.
- La tecnologia Fisso proviene da `post_vendita_controllo_fissi.tecnologia`: `FTTH_OF`/`FTTH_FWCOP` diventano FTTH; `FWA OUT`, `FWA IN` e `FWA VOCE` restano separate nella tabella acquisizioni e confluiscono in FWA nel mix percentuale.
- `Fissi Mensili Attivati` usa esclusivamente le righe `stato='Attivo'` nel mese di `data_attivazione`, anche quando `data_contratto` appartiene a un mese o anno diverso.
- `Apri/Chiudi` richiede `vendita_contratti.apri_chiudi='Si'`, segue `data_attivazione`, separa FTTH e tutte le FWA e calcola la percentuale sul totale dei Fissi attivati nel mese.
- `% Tecnologia` calcola FTTH/FTTC/FWA sulle acquisizioni con tecnologia valorizzata, così le tre righe sommano al 100%. Le pratiche senza tecnologia sono dichiarate in una nota e restano nel totale acquisizioni.
- Luce & Gas conta i contratti `categoria_snapshot='Energia'`: acquisiti e righe con `post_vendita_controllo_lg.stato='Attivato'` restano entrambi nel mese di `data_contratto`.
- Allarmi mostra totale pezzi, `modalita_pagamento='Anticipo'` e `modalita_pagamento='Finanziamento'`; lo stato post-vendita `OK` vale come attivato e resta attribuito al mese originale di `data_contratto`, indipendentemente da quando lo stato è stato aggiornato.
- Assicurazioni mostra pezzi e somma mensile di `vendita_contratti.punteggio_gara_totale`, lo stesso campo canonico usato dalla dashboard gare.
- Le pagine Consumer e Business condividono endpoint e JavaScript: il body dichiara `data-kpi-cluster`, il client invia `cluster` e il backend accetta esclusivamente `Consumer` o `Business`. Nessuna aggregazione può mescolare i due cluster.
- Il filtro punto vendita accetta `all`, `9001415852` (Legnago) e `9000822241` (Cerea), con default `all`.
- Il confronto operatori aggrega sul profilo canonico seguendo `profili.alias_di`; una riga senza operatore resta esplicitamente non assegnata per mantenere la riconciliazione con il totale negozio.
- La pagina evita card riepilogative duplicate: i totali restano nella prima colonna delle tabelle e le sezioni sono separate da spazio bianco, mantenendo il layout più compatto e leggibile.

### Guard pattern (riusato in tutte le pagine admin*)

```js
const profilo = await Auth.richiediAuth();
if (!profilo) return;
if (profilo.ruolo !== 'admin') {
  await MiroxUI.alert('Accesso riservato agli amministratori.');
  window.location.href = 'dashboard.html';
  return;
}
```

### Attivazione bottone Admin in dashboard

In `dashboard.html` lo script di init aggiunge `href='admin.html'` e rimuove `.disabled` dal `#btnAdmin` solo se `profilo.ruolo === 'admin'`. Per gli operatori il bottone resta visibile ma in stato disabled (no click).

### Rimozione bottone Admin in upload

Il bottone "Admin" dentro `moduli/upload-contratti-vendita.html` è stato **rimosso** (sia HTML sia handler JS). L'accesso al pannello Admin avviene esclusivamente dalla topbar della dashboard (bottone `#btnAdmin`, attivo solo se `ruolo='admin'`). La vecchia password client-side `'1234'` non esiste più.

### Note operative

- La creazione di un nuovo utente richiede ancora due step manuali (Supabase Authentication → add user con email/password, poi qui si gli assegna ruolo/permessi). Una function `admin-create-user` con service_role potrebbe automatizzare in futuro
- I permessi granulari Vendita/Post-Vendita NON esistono ancora: tutte queste pagine sono accessibili a chiunque sia loggato e attivo. Quando serviranno, estendere la mappa `PAGINE_LABELS` in `admin-utenti.html`

---
## KONA Call Director (staging isolato attivo in osservazione — 2026-08-29)

KONA Call Director vive nelle tabelle server-only `kona_call_director_*`, nelle
function `kona-call-director-*` e nelle due pagine operatore/admin. Prima di
modificarlo o attivarlo leggere `docs/KONA_CALL_DIRECTOR.md` e le migration
`database/072_kona_call_director.sql`-`074_kona_call_director_agente_unificato.sql`.

Regole permanenti:

- dal 2026-08-29 il collaudo e' attivo soltanto su
  `mirox-kona-call-director-test.netlify.app`: entrambi gli env switch e il
  toggle globale sono `true`, un solo profilo test e' abilitato e la modalità
  osservazione resta `true`; Google Calendar e' collegato con sync `ok`;

- l'attivazione richiede insieme `KONA_CALL_DIRECTOR_ENABLED=true`, toggle
  globale DB e profilo operatore abilitato; l'env assente deve restare spento;
- le migration `072`, `073` e `074` sono applicate soltanto al Supabase test
  dedicato `yyorullxmdxhnunsfwwa`; production non contiene tabelle KONA Call
  Director;
- il sito Netlify test `mirox-kona-call-director-test.netlify.app` e' collegato
  alla branch `kona-call-director`, usa la service role protetta del solo
  Supabase test e pubblica automaticamente ogni push della branch;
- il bootstrap test e' `database/staging/003_kona_call_director_bootstrap.sql`:
  schema minimo senza dati production; le tabelle KONA e tutte le scritture
  sono service-role-only, mentre `authenticated` legge soltanto la propria
  riga `profili` per completare il login CRM;
- le chiamate Business standard richiedono almeno una categoria esplicitamente
  approvata nel piano; nessuna categoria significa nessuna chiamata standard;
- **doppia interfaccia, una sola fonte di verita'**: quando KONA e' attivo per
  un'operatrice non-admin, `js/cc-header.js` (via `kona-call-director-route`)
  nasconde le tab manuali e reindirizza a KONA l'accesso diretto alle pagine
  manuali; l'admin mantiene il manuale + tab `KONA CD` (`adminOnly`) + pannello
  admin. Gli esiti KONA scrivono nelle tabelle canoniche (`chiamate`,
  `appuntamenti`, `blacklist`) oltre che negli audit `kona_call_director_*`: mai
  una seconda copia dei dati definitivi. Per i non-admin un errore del routing
  blocca il contenuto della pagina invece di mostrare implicitamente il manuale;
- `kona-call-director-operator` ingloba lookup/creazione anagrafica Consumer,
  ricerca istantanea per numero, storico della giornata e correzione esito nella
  stessa giornata. La correzione usa la RPC atomica
  `kona_cd_correggi_esito_v1`; l'audit
  `kona_call_director_correzioni_esito` e' append-only e il browser non ha
  grant diretti;
- un guasto AI reale e allowlisted attiva un failover di 30 minuti limitato al
  profilo: `kona_call_director_failover` consente il sistema manuale soltanto
  per quella sessione operativa e accoda una notifica Telegram senza PII. Il
  routing espone `manual_fallback`; il bypass non disattiva KONA per gli altri;
- la pagina operatore e' una macchina a stati esplicita (una sola schermata
  visibile): `welcome` → `briefing` → `contact` → `outcome` → `followup`/`calendar`
  → `transition` → `consumer`/`negozio` → `completed`/`error`. Il briefing
  dell'intera giornata (MATTINA/POMERIGGIO, solo categorie non vuote) e' calcolato
  server-side da `briefingGiornata` (riusa i candidati); le transizioni avvengono
  per famiglia, mai fra task della stessa famiglia. Il calendario compare solo
  dopo `Appuntamento`: Business usa Google personale, Consumer usa lo schermo
  `negozio` che riusa `get_slot_disponibili` + prenotazione del flusso CC
  (migration additiva `073` per l'esito `appuntamento`); la scheda Consumer
  esegue lookup CF/P.IVA e upsert completo dell'anagrafica senza aprire
  `registra-chiamata.html`; KONA avvia da solo la
  sessione Consumer dal piano (`avvia_consumer`), leggendo il campo canonico
  `consumer` e il legacy Telegram `categoria_sessione`; la prenotazione negozio
  viene rimossa in compensazione se la registrazione dell'esito fallisce;
- `Prossimo contatto`, `Avvia` e `Avvia chiamate` sono idempotenti: se esiste gia'
  un task attivo restituiscono quel task, senza svuotare la UI o crearne un
  secondo; il refresh riprende il task attivo;
- credenziali, integrazioni e deploy vanno validati prima sul test dedicato;
- non inviare PII a Telegram, dati Consumer a OpenAI o dettagli privati del
  calendario Google all'operatore;
- con il cron Netlify nativo non impostare `KONA_CALL_DIRECTOR_CRON_SECRET`;
- non inventare coordinate dei comuni e non modificare tabelle Call Center
  condivise per aggirare il dominio KONA;
- arresto ordinario = toggle globale off + env false; non eseguire DROP.

---


## KONA AI Guardian (prima versione, dal 2026-08-10)

Il reporter globale `js/mirox-error-reporter.js` e tutte le email automatiche per errori tecnici sono stati rimossi. Non reintrodurli. Restano operativi `mirox-send-email`, `MiroxMailer`, i template email di processo e i popup locali; il wizard Upload Contratti continua a mostrare l'orario dell'errore e i messaggi OCR strutturati, ma non spedisce email tecniche.

### Flusso e autorizzazioni

1. Qualunque utente autenticato apre `moduli/segnala-problema.html`, sceglie `Segnala un problema` oppure `Proponi una miglioria` e conversa con Guardian tramite `guardian-incidents`.
2. Guardian fa una domanda breve alla volta usando un percorso dedicato: per i problemi raccoglie atteso/reale/errore/riproducibilita'; per le migliorie raccoglie funzionamento attuale, obiettivo, utenti, beneficio ed esempi. Dopo la descrizione iniziale puo' porre al massimo due chiarimenti; raggiunto il limite registra comunque la richiesta e rimanda i dubbi alla conversazione Telegram con l'amministratore. Quando completa imposta la richiesta a `ricevuto`, assegna un codice unico `KG-000001`, conferma all'operatore l'invio all'`amministratore` senza mostrare il nome di Mirko e notifica Telegram indicando il tipo.
3. Gli operatori possono soltanto creare e completare le proprie richieste. Non possono vedere richieste altrui, approvare analisi, cambiare priorita' o avviare azioni.
4. `guardian-telegram-webhook` accetta esclusivamente il secret token configurato e `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`. Mirko puo' usare testo o vocali gia' conclusi; niente conversazione audio live.
5. Il cron Observer raccoglie eccezioni frontend, errori HTTP 5xx, errori Functions/provider, fallimenti cron/CI e segnali di performance soltanto dopo sanitizzazione server-side. Deduplica per fingerprint e apre un incidente automatico `monitoraggio` solo al superamento delle soglie; un singolo evento non genera rumore Telegram. In particolare un `network_error` senza stato HTTP, anche durante login/upload/finalizzazione, resta `bassa` con una sola occorrenza: viene aperto dopo almeno tre occorrenze oppure due operatori coinvolti. I nomi interni (`network_error`, `Failed to fetch`, stack) non sono usati come spiegazione principale nel messaggio al proprietario.
6. Per gli incidenti automatici il workflow `guardian-observer-analysis.yml` analizza in sola lettura il commit correlato, produce JSON validato e restituisce fatti, causa probabile, proposta, verifiche e criteri di accettazione. L'output è trattato come diagnosi, non come autorizzazione a modificare il codice.
7. Analisi Guardian, analisi Codex read-only, preparazione patch, test staging, proposta di rilascio e archiviazione richiedono pulsanti Telegram separati. Ogni decisione viene registrata in `kona_ai_approvazioni`; l'esecuzione tecnica e' registrata in `kona_ai_esecuzioni`.
8. Il worker Codex usa workflow GitHub separati: analisi read-only su `main` per il Guardian production o sul commit staging correlato, patch su branch dedicata, test staging e pull request draft verso production. Ogni dispatch porta anche `target_environment`: GitHub usa l'Environment `guardian-production` o `guardian-staging` per richiamare esclusivamente il worker che possiede l'esecuzione, anche se patch e test girano sul codice staging. Il merge su `main` e il deploy production restano manuali e fuori dall'esecuzione Codex. Il validatore patch esclude dal diff i file tecnici del runner (`guardian-context.json`, `guardian-changed-files.txt`, `codex-output.md`), blocca soltanto i file SQL sotto `database/` e consente `database/README.md`. Il prompt restituisce un esito macchina esplicito: `MODIFICA_PREPARATA` prosegue verso test e pull request; `GIA_PRESENTE`, `RICHIEDE_INFORMAZIONI` e `BLOCCATA` terminano regolarmente senza fingere una modifica. Ogni esito senza pull request invia a Guardian un JSON valido con `pull_request_url: null`.
9. GitHub riceve `workflow_dispatch` soltanto per workflow presenti sulla branch predefinita: per questo `.github/workflows/guardian-codex-*.yml`, `guardian-observer-analysis.yml` e `.github/codex/` sono registrati su `main`. I job patch restano fail-closed sul ref, eseguono `npm ci` prima di Codex e distinguono quattro esiti: `MODIFICA_PREPARATA`, `GIA_PRESENTE`, `RICHIEDE_INFORMAZIONI`, `BLOCCATA`. Gli ultimi tre sono conclusioni operative valide e il workflow resta verde dopo averle consegnate al worker; soltanto un guasto tecnico, una validazione non riconosciuta, test falliti o il mancato callback producono failure GitHub. L'Observer è sempre `contents: read`, sandbox `read-only`, `drop-sudo`, `--ephemeral` e non può fare push. I secrets URL/HMAC del worker vivono negli GitHub Environments `guardian-staging` e `guardian-production`, non come valori condivisi: impedisce che una scansione `main` scriva nello staging. Worker Netlify e migration `067`/`068` sono attivi sul production dopo validazione staging e applicazione SQL esplicita.

### Database e retention

La migration additiva `065_kona_ai_guardian.sql` crea quattro tabelle server-only, senza modificare le tabelle condivise col Call Center. La successiva `066_kona_ai_tipologia_richiesta.sql` aggiunge soltanto il tipo problema/miglioria, l'indice di consultazione e l'unicita' dell'approvazione attiva `prepara_fix`. La migration `067_kona_ai_codex_esecuzioni.sql` aggiunge il registro server-only delle esecuzioni usato dal worker isolato, senza concedere accesso al repository al browser:

- `kona_ai_incidenti`: tipo richiesta, stato, priorita', origine, reporter, contesto minimo e riepiloghi;
- `kona_ai_messaggi`: conversazione CRM/Telegram/Guardian/Codex;
- `kona_ai_approvazioni`: proposta, decisione ed esito delle azioni sensibili;
- `kona_ai_telegram_sessioni`: incidente attivo e dedupe degli update Telegram.
- `kona_ai_esecuzioni`: contratto operativo e audit del worker Codex, con idempotenza delle esecuzioni attive.
- `kona_ai_eventi_tecnici`, `kona_ai_segnali`, `kona_ai_notifiche`, `kona_ai_observer_checkpoint`: telemetria ripulita, aggregati, coda Telegram e checkpoint dell'Observer (migration `068`).

`anon` e `authenticated` non hanno grant diretti. Gli eventi tecnici della `068` scadono dopo 30 giorni; i gruppi e le notifiche restano server-only per l'audit operativo. I dettagli tecnici degli incidenti hanno `dettagli_tecnici_scadono_at = now()+90 giorni`; riepilogo e audit restano permanenti. `cron-pulizia-operativa` elimina gli eventi tecnici oltre `expires_at` nella stessa fase di retention. Le migration `067` e `068` sono applicate e verificate sia sullo staging sia sul production dal 2026-08-11.

### Ambiente e segreti

Guardian e' attivo sul production `mirox-crm.it`, collegato al Supabase `lbgwamhjkjjfwgusafbi`; qui le env OpenAI/Telegram e il `KONA_AI_OWNER_PROFILE_ID` del profilo Mirko production sono configurati. Il bot `@MiroxAiGuardianBot` usa esclusivamente il webhook ufficiale. Il sito `mirox-crm-staging.netlify.app` e il Supabase `blwgxrszvsoqcmcmhhqr` restano l'ambiente isolato per sviluppi e validazioni senza dati reali e usano il bot già dedicato `@KonaAiGuardianBot`.

Env vars: `OPENAI_API_KEY`, `OPENAI_GUARDIAN_MODEL`, `OPENAI_TRANSCRIBE_MODEL`, `TELEGRAM_GUARDIAN_BOT_TOKEN`, `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`, `TELEGRAM_GUARDIAN_WEBHOOK_SECRET`, `KONA_AI_OWNER_PROFILE_ID`, `GUARDIAN_OBSERVER_ENABLED`, `GUARDIAN_OBSERVER_DAILY_BUDGET`, `GUARDIAN_OBSERVER_MODEL`, `GUARDIAN_OBSERVER_REF`, `GUARDIAN_OBSERVER_WEEKLY_SCAN`, `GUARDIAN_TELEMETRY_HASH_SECRET`. Mai esporle nel frontend o committarle. Setup completo: `docs/KONA_AI_GUARDIAN_SETUP.md`.

---
## Sistema consensi privacy GDPR (dal 2026-06-26)

Mirox archivia nel CRM di proprietà/gestione Kona Tech dati e documenti consegnati per la specifica pratica. Prima dell'invio il wizard registra la presa visione dell'informativa ex artt. 13-14 GDPR e, separatamente, l'eventuale consenso facoltativo ai ricontatti promozionali. I contatti di servizio sulla pratica specifica possono avvenire tramite chiamata, WhatsApp o email e non dipendono dal flag marketing. Il modulo non disciplina il contratto WindTre/altro fornitore né sostituisce la relativa informativa.

### Componenti

| Layer | Componente | Cosa fa |
|---|---|---|
| DB | `vendita_consensi_privacy` | Tabella consensi (migration 034) |
| Storage | `consensi-privacy` (privato) | PDF informativa/dichiarazione OTP o scansione cartacea |
| Functions | `garantisci-anagrafica` | Upsert anagrafica prima del consenso |
| Functions | `check-consenso-privacy` | Dedupe 24 mesi limitato alle due versioni correnti cartacea/digitale |
| Functions | `richiedi-otp-privacy` | Genera OTP, invia SMS via Smshosting |
| Functions | `verifica-otp-privacy` | Verifica OTP, genera PDF con evidenze della dichiarazione e salva |
| Functions | `genera-pdf-consenso-cartaceo` | Modulo A4 monocromatico di una pagina per il fallback cartaceo |
| Functions | `upload-consenso-cartaceo` | Upload scansione modulo firmato a mano |
| Helper | `_lib/pdf-consenso.js` | Generazione PDF con `pdfkit` |
| Helper | `_lib/privacy-config.js` | Versioni correnti separate per cartaceo e digitale |
| Helper | `_lib/smshosting.js` | Wrapper REST Smshosting + normalizzazione numeri |
| Frontend | `upload-contratti-vendita.html` | Modale OTP/cartaceo dentro `ensureConsensoPrivacy()` |

### Flusso OTP via SMS

1. Operatore inserisce dati cliente nel wizard. Al click "Invia pratica" il wizard chiama `garantisci-anagrafica` → `anagrafica_id`.
2. `check-consenso-privacy` ritorna `valido=false` se il cliente è nuovo, la dichiarazione è scaduta/revocata oppure appartiene a una versione precedente dell'informativa.
3. Modale scelta → operatore seleziona la dichiarazione elettronica via OTP SMS.
4. Modale OTP mostra dati cliente, cellulare pre-compilato (con bottone "Modifica numero") e due radio ACCONSENTO/NON ACCONSENTO. "Invia SMS" resta disabilitato finché non viene espressa una scelta.
5. Operatore seleziona una delle due opzioni e clicca "Invia SMS" → `richiedi-otp-privacy` valida il booleano, genera OTP 6 cifre, hash SHA256+salt random, salva record `pending` con `otp_scade_at = now() + 10 min`, invia SMS via Smshosting al cellulare. Se operatore ha modificato il numero, popup "Aggiorno anche anagrafica?" → conferma sì → secondo POST `garantisci-anagrafica` con nuovo cellulare.
6. Cliente legge l'OTP dall'SMS, lo dice all'operatore. Operatore digita codice → "Verifica OTP".
7. `verifica-otp-privacy`: re-hash OTP, confronto. Se OK → genera PDF informativa con metadata firma trascritti, upload bucket `consensi-privacy`, segna `stato='confermato'` + `valido_fino_al = now()+24 mesi` + `informativa_hash` (SHA256 del PDF).
8. Modale si chiude, wizard procede al submit pratica con `payload.pratica.consenso_id` valorizzato.

### Flusso cartaceo (fallback)

1-3. Identici (fino alla modale scelta).
4. Operatore clicca "Modulo cartaceo".
5. Modale cartaceo mostra dati cliente, procedura, bottone "Scarica modulo PDF" disabilitato e due radio ACCONSENTO/NON ACCONSENTO.
6. L'operatore seleziona una scelta; il download si abilita e `genera-pdf-consenso-cartaceo` ritorna il modulo v6 di una pagina A4, corpo 10 pt, con quella scelta già marcata e riga firma separata dal testo. Dopo il download le radio vengono bloccate per mantenere coerenti PDF e dato archiviato.
7. Operatore stampa, raccoglie la firma e scansiona il foglio.
8. Operatore carica il PDF e conferma. Senza download, scansione e scelta esplicita il submit resta disabilitato.
9. `upload-consenso-cartaceo` valida `consenso_marketing=true|false`, salva il PDF in `consensi-privacy`, calcola SHA256 e inserisce il record `modalita='cartaceo'`, `stato='confermato'`, `valido_fino_al = now()+24 mesi`.

### Inquadramento legale implementato

- **OTP via SMS**: il PDF digitale v6 `_dig` mostra entrambe le opzioni marketing con una sola scelta marcata, la ripete nel riquadro probatorio e descrive il flusso effettivo: codice OTP di 6 cifre via SMS e memorizzazione di invio/conferma, ID SMS, esito/tentativi, IP, user agent e hash SHA256 del documento. Non contiene riferimenti a firma cartacea o scansione.
- **Cartaceo**: conserva la scansione del documento sottoscritto e il relativo hash SHA256. Il valore probatorio concreto dipende dal processo e dalle circostanze.
- **Testi v6 CRM**: cartaceo `v6_2026_07_26` e digitale `v6_2026_07_26_dig` riportano il Titolare come `KONA TECH SRL`, limitano il perimetro ai trattamenti della società nel CRM Mirox e mantengono equivalenti finalità, basi giuridiche, conservazione e consenso marketing.
- **Nessuna estensione retroattiva**: le informative v1/v2/v3/v4/v5 restano archiviate come evidenza; `check-consenso-privacy` e il backend accettano soltanto le due versioni v6 correnti.
- **Validazione necessaria**: prima di considerare il testo un parere legale definitivo, un consulente privacy deve confermare titolare/ruoli, DPO se designato, tempi di conservazione, contratti con responsabili/sub-responsabili, trasferimenti e canali effettivi di revoca.

### Smshosting (provider SMS)

Account aziendale Kona Tech. Endpoint `https://api.smshosting.it/rest/api/sms/send`, auth HTTP Basic (`SMSHOSTING_API_KEY` + `SMSHOSTING_API_SECRET`), mittente alfanumerico (`SMSHOSTING_SENDER`, default `MIROX`, max 11 caratteri). **Modalità simulazione** via `SMSHOSTING_SIMULATE=true`: non invia davvero, logga il testo, ritorna id fittizio (per test dev senza spendere credito). Vedi `docs/SMSHOSTING_SETUP.md` per il setup account.

Il costo SMS va stimato sui volumi reali di clienti unici e sul listino Smshosting corrente; il passaggio da 48 a 24 mesi può aumentare i rinnovi e rende obsoleta la precedente stima fissa.

### Cosa NON è incluso

- **Revoca del consenso**: la tabella ha le colonne `revocato_at`, `revocato_motivo`, `revocato_da` ma non c'è ancora UI admin per gestirla. Per ora va fatta a mano via SQL.
- **Cleanup pending**: gestito ogni giorno da `cron-pulizia-operativa`, che marca `scaduto` gli OTP pending oltre `otp_scade_at`.
- **Cron pre-scadenza consensi**: dopo 24 mesi il consenso non è più valido e il cliente deve rifirmare. Non c'è notifica automatica al cliente di pre-scadenza (eventuale futuro modulo).
- **Revisione legale**: le versioni correnti sono `v6_2026_07_26` e `v6_2026_07_26_dig`; resta necessaria la validazione professionale descritta in `docs/PRIVACY_LEGAL_REVIEW_2026-07-26.md`.

---

## Convenzioni (rispettare per coerenza)

- **Path**: pagine in `/moduli/` → JS/CSS/link con `../` (es. `../js/config.js`, `../dashboard.html`). Pagine in `/moduli/call-center/` → JS/CSS/link Mirox con `../../` (es. `../../index.html`). I JS interni del CC (`/moduli/call-center/js/`) sono path-relativi alla pagina e funzionano out-of-the-box
- **Auth guard**: ogni pagina chiama `Auth.richiediAuth()` (gestisce redirect a `../index.html` o `index.html` in base al pathname). Le pagine CC continuano a usare il proprio `Auth` (in `moduli/call-center/js/auth.js`) — è un'entità separata da `js/auth.js` di Mirox, ma fa la stessa cosa
- **Modali**: usare `window.MiroxUI.{alert,confirm,prompt,toast,loading,allegati}`. **MAI** `alert()` / `confirm()` nativo del browser
- **Azioni sensibili per ruolo**: **MAI** password operative hardcoded nel frontend. Rimborso manuale ed esiti manuali protetti restano admin-only tramite Netlify Function con `requireAuth(..., {adminOnly:true})`. Nel riepilogo Apri/Chiudi, invece, ogni account autenticato attivo può portare una pratica da `IN CORSO` a `KO`: il bottone è disponibile sia nella riga sia nel dettaglio e chiama `mark_apri_chiudi_ko`; le scritture dirette browser restano bloccate dalla migration `056`.
- **Anagrafica**: SEMPRE via `AnagraficaHelper.cerca` / `cercaOcrea` (RPC `cerca_o_crea_anagrafica`) per evitare doppioni
- **Upload PDF**: SEMPRE via Netlify function. Per i moduli operativi usare `MiroxStorageUpload.upload(...)`; per i documenti vendita usare `uploadVenditaDocumento(...)`. MAI `db.storage.from(...).upload()` dal client — la service_role non deve mai uscire dal server
- **Preventivi Protecta**: il record `vendita_simulatore_protecta` va inserito solo dopo un upload PDF riuscito con `storage_path` non vuoto; un errore o una risposta incompleta deve interrompere il salvataggio, mai produrre un record con `preventivo_pdf_url` nullo. Il simulatore gestisce separatamente lo sconto sull'anticipo e sulla rata mensile, mostra originale barrato e valore applicato anche nel PDF e, con finanziamento, confronta le rate attraverso la tabella finanziaria; se la fascia non cambia, la UI deve dichiarare esplicitamente che la rata resta invariata. Il `Totale sconto` è un campo manuale opzionale e indipendente dai calcoli, salvato nel JSONB del preventivo e mostrato in grande nella parte finale del riepilogo/PDF. La `Scadenza preventivo` è un testo manuale opzionale, salvato nello stesso JSONB e mostrato tra canone totale mensile e rimborso detrazione fiscale con dimensione maggiore.
- **Anteprima PDF upload**: nei moduli Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato ogni PDF selezionato o trascinato deve passare da `MiroxUpload` prima di essere mantenuto nell'input. Bottone rosso `X` = rimuovi, bottone verde `Conferma` = il file resta selezionato. Per drop-zone custom usare `MiroxUpload.previewPdfFiles()` o `MiroxUpload.confirmFilesForInput()` invece di assegnare il file direttamente.
- **Lettura allegati da bucket privati**: SEMPRE via `MiroxStorage.openAttachment(bucket, path)`, `MiroxStorage.signedUrl(...)` o, per i bucket server-only, tramite la Function proprietaria (`gestisci-disdette` per `disdette-files`). **MAI** `getPublicUrl()` per i bucket privati (vedi sezione "Storage buckets"). Eccezione: `moduli-template` resta pubblico e accetta `getPublicUrl()`
- **Chiamate a Netlify functions dal client**: SEMPRE via `MiroxApi.fetch(url, opts)` — inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. MAI `fetch()` diretto, altrimenti la function ritorna 401. Per FormData, NON settare `Content-Type` manualmente (il browser inserisce il boundary)
- **Auth in nuove Netlify functions**: usare `const { requireAuth } = require('./_lib/require-auth')` e all'inizio dell'handler `const auth = await requireAuth(event); if (!auth.ok) return response(auth.status, { success: false, error: auth.error });`. Per endpoint solo admin: `requireAuth(event, { adminOnly: true })`. CORS `Access-Control-Allow-Headers` deve includere `Authorization`
- **Identità server-side**: campi audit/ownership come `operatore_id`, `uploaded_by`, `created_by` non devono essere accettati come fonte di verità dal payload client; derivarli da `auth.profilo`/`auth.user` e validare le relazioni tra gli UUID ricevuti.
- **Email**: via `MiroxMailer.send({to, template, vars})` → endpoint `mirox-send-email`. Mai SMTP diretto dal client.
- **Segnalazioni tecniche**: non inviare email automatiche e non agganciare handler globali. Gli operatori usano `moduli/segnala-problema.html`; nuove fonti automatiche future devono creare/deduplicare incidenti Guardian lato server e notificare Mirko solo quando esiste un evento utile. I popup locali restano responsabili del feedback immediato all'utente.
- **Nomi cartelle Storage**: via `MiroxFolder.build()` lato client o pattern equivalente nelle Netlify functions (`sanitizeSegment`)
- **Timestamp**: `timestamptz` salvati in UTC, mostrati in `Europe/Rome` lato UI (vedi pattern `formatCrmDateTime` nei moduli)
- **Nessun bundler**: import solo come `<script src=...>`, niente `import` / `require` lato browser
- **HTML dinamico / XSS**: ogni dato proveniente da DB, Storage o input inserito in template HTML deve passare da `MiroxSafe.escapeHtml`; URL da `safeUrl`, colori da `safeCssColor`, ID inline da `isUuid`/`isRecordId`. Preferire `textContent`, `replaceChildren` e listener a `innerHTML`/handler inline. Markup statico fidato può restare in template.
- **CDN e header**: librerie CDN sempre con versione esatta, `integrity` SHA384 e `crossorigin="anonymous"`. La CSP/HSTS/Permissions-Policy vive in `netlify.toml`; `'unsafe-inline'` è una compatibilità temporanea col frontend legacy e non va ampliata.
- **Test**: prima di considerare concluso un task eseguire `npm test`. La suite `node:test` in `/tests` copre regressioni prioritarie, sintassi di tutti i JS/script HTML inline e link locali statici.
- **Sync con GitHub**: SOLO via `git push` dalla cartella locale (SSH già configurato per `mirkopiasenti`). **Mai upload via interfaccia web** GitHub — causerebbe drift fra locale e remoto. Repo: `git@github.com:mirkopiasenti/mirox-crm.git` (rinominato da `konahub-vendita-test` il 2026-07-02; remote locale aggiornato, redirect GitHub ancora attivo per sicurezza). Netlify site collegato: `mirox-crm` con custom domain `mirox-crm.it`
- **Accesso Supabase autonomo (AI)**: il progetto `lbgwamhjkjjfwgusafbi` è già linkato. Usare la CLI portable `./.bin/supabase-go` (gitignored); se la sessione locale manca, completare il login ufficiale con `./.bin/supabase-go login` senza assumere un percorso fisso per il token. Per introspezione/SQL remoto: `./.bin/supabase-go db query --linked "SELECT ..."` (Management API, non richiede la password DB). Prima di migration, DDL o altre scritture seguire le regole di conferma del progetto.

---

## Note operative consapevoli (non "correggere" senza chiedere)

- **Edge Functions Supabase**: non in uso, non aggiungerne senza discutere prima
- **Guardian production vs staging**: production riceve richieste, telemetria e analisi Codex read-only su `main`; staging resta obbligatorio per patch e test. I worker sono separati per ambiente tramite GitHub Environments e HMAC. Ogni patch richiede approvazione, pull request draft, test staging e un merge manuale; nessun workflow effettua merge o deploy production automatico.
- **Cluster `Turista`**: accettato solo da `crea-vendita-pratica-carrello.js`. È voluto.
- **File SQL in `/database/`**: parziali, NON riflettono lo stato attuale del DB (vedi `database/README.md`)
- **Modulo `simulatore_protecta.html`**: ~960 KB, molto pesante perché contiene asset embedded. Modificare con cautela.
- **Permessi granulari Vendita/Post-Vendita**: non esistono ancora. Solo CC ha permessi fine-grained via `pagine_accessibili`. Le pagine Vendita/Post-Vendita sono accessibili a tutti gli utenti attivi, indipendentemente dal ruolo (admin/operatore). Solo il pannello Admin è gated dal `ruolo`.
- **`vendita_contratti.fascia_prezzo`**: dal 2026-06-26 contiene il **prezzo puntuale del device** (es. `"399.90"`), non più una fascia-range (`"250-599"`). La dashboard pezzi (migration `014`, regole seed in `dashboard_righe_giornaliera`) **non binara mai** per `fascia_prezzo` né `fascia_prezzo_in`, quindi il cambio è transparent per il conteggio mensile attuale. Se in futuro servisse raggruppare per fasce: aggiungere una colonna derivata o una regola DSL che faccia il binning lato dashboard. **Non re-introdurre la dropdown** in `upload-contratti-vendita.html` o `verifica_contratti.html` senza prima discutere.
- **Catalogo `vendita_reload` dismesso** (migration `035`, 2026-06-26): la dropdown Reload nel wizard upload-contratti, la sezione "Reload (catalogo)" in `admin-vendita-config.html` e il multiselect "Reload disponibili" nelle offerte sono **disabilitati** (UI nascosta o no-op via shim JS). La tabella DB `vendita_reload`, il link `vendita_offerte_reload` e la colonna `vendita_contratti.reload_id` sono **conservati** per dati storici — niente DROP. Le Netlify functions `vendita-config.js` e `admin-vendita-config.js` continuano a leggere/scrivere ma il wizard non invia più `reload_id` né nuovi link. Se serve riabilitare in futuro: ripristinare HTML/JS nei 3 punti citati e gli shim no-op in `upload-contratti-vendita.html`. **Non eliminare** la tabella DB senza prima migrare i contratti storici.
- **`vendita_contratti.smartphone_reload` + `smartphone_reload_modalita`** (migration `035`, 2026-06-26): non confondere con il vecchio catalogo Reload. Sono campi del singolo contratto, ricavati dalla riga "SMARTPHONE RELOAD SI/NO" del PDA. Il CHECK DB `vc_smartphone_reload_coerenza_chk` impone `modalita NOT NULL ⇔ smartphone_reload IS TRUE`: se vuoi cambiare smartphone_reload da true a false, **prima** azzera la modalita.
- **Import storico konahub completato** (2026-06-29): importati 1665 contratti + 1366 pratiche + 81 anagrafiche + dati post-vendita (217 fissi, 271 L&G, 10 allarmi, 8 assicurazioni) + switch (57) + apri/chiudi (36) + comodato (7) + ordini (27) + protecta (26) + ticket (136). Tutti i contratti con `stato_controllo='controllato'`, `stato_inserimento='inserimento'`, `origine_pratica='spontaneo'`. La migration `053` ha completato gli operatori mancanti delle pratiche, valorizzato `vendita_documenti.uploaded_by`, corretto a Cerea i 35 contratti storici del profilo Cerea ed eliminato 16 record documento duplicati senza cancellare i PDF. **81 anagrafiche nuove sono passaporti** (cluster='Consumer' a DB ma cf_piva contiene un codice passaporto, NON un CF italiano). Script di import in `database/imports/konahub/` (`.gitignored` per CSV/zip/docs). Backup pre-import in `database/backups/pre_cleanup_2026-06-29/`.
- **Cleanup konahub segnalazioni completato** (migration `036`, 2026-07-02): le 5 policy anon temporanee della `032` sono state revocate. La migration post-deploy `054` rimuove le residue policy di scrittura browser sul bucket; gli upload usano `upload-documento-modulo`.

---

## Quick reference

| Devo... | Faccio... |
|---|---|
| Aggiungere una nuova **regola di business** | Modificare in 3 punti: CHECK constraint DB + UI wizard + Netlify function di validazione |
| **Verificare un consenso** o gestire una revoca | Query/UPDATE manuale su `vendita_consensi_privacy`. Non c'è ancora UI admin. Per revoca: `UPDATE ... SET revocato_at=now(), revocato_motivo='...', revocato_da=<uuid_admin>` |
| Cambiare **testo informativa** | Modificare `_lib/pdf-consenso.js` e le costanti cartacea/digitale in `_lib/privacy-config.js`. Aggiornare insieme l'elenco versioni correnti; i record vecchi conservano la versione storica. Far revisionare da legale e renderizzare entrambe le varianti. |
| Cambiare **scadenza 24 mesi** | Modificare costante `VALIDITA_MESI` in `verifica-otp-privacy.js` E `upload-consenso-cartaceo.js`. Stessa logica `addMonthsClamped(now, N)` |
| Aggiungere un **tipo documento** | Aggiornare `vendita_documenti_regole`, UI admin in `admin-vendita-config.html`, e nome standardizzato in `upload-vendita-documento.js` (`suggestedFileName`) |
| Aggiungere una **categoria vendita** | INSERT su `vendita_categorie` + eventuale ramo in `validateCategorySpecificRules` (carrello function) + UI wizard se ha campi speciali |
| Sapere lo **stato reale dello schema** | Query a `information_schema` / `pg_*` dal SQL Editor Supabase (non fidarsi dei file in `/database/`) |
| Modificare le **regole di accesso pagine Call Center** | NON farlo da qui — è gestito dall'altro progetto. Coordinare con utente. |
| **Promuovere un utente ad Admin** o gestire i permessi CC | Dashboard → Admin → Gestione Utenti (`admin-utenti.html`). Bottoni "Rendi Admin"/"Rendi Operatore" + modale "Permessi CC". Solo accessibile se sei admin |
| **Aggiungere una nuova pagina al pannello Admin** | Nuova pagina `admin-<nome>.html` alla root con `css/admin-shell.css` + `js/admin-shell.js`, aggiungere mapping e voce nel reparto corretto di `admin-shell.js`, riusare guard pattern `Auth.richiediAuth()` + check `ruolo === 'admin'` (vedi sezione "Pannello Admin Mirox") |
