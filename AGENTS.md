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
- **Fasi successive previste** (non ancora fatte): estensione `storico_cliente`, backfill `chiamate.anagrafica_id`, convergenza Upload Contratti con `origine_pratica` automatica

### URL deploy
- **Repo GitHub**: `git@github.com:mirkopiasenti/mirox-crm.git` (dal 2026-07-02, prima era `konahub-vendita-test` — redirect ancora attivo ma va usato il nome nuovo)
- **Netlify site di questa codebase**: **`mirox-crm`** (nome sito Netlify dal 2026-07-02, prima era il vecchio nome legato al test). Custom domain **`mirox-crm.it`** in production dal 2026-06-29 — tutte le functions (auth + OTP + backend) rispondono qui. Env vars (Supabase, Smshosting, Anthropic, SMTP) configurate su questo site
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

Pagine HTML statiche, no bundler. `/moduli/call-center/` contiene il modulo CC integrato (Fase 1, vedi sezione dedicata). Le pagine `admin*.html` alla root costituiscono il **Pannello Admin Mirox** (`admin.html` hub + `admin-utenti.html` + `admin-call-center-config.html` + `admin-vendita-config.html`), tutte gated da `profili.ruolo='admin'`. JS condiviso Mirox esposto su `window`:

| File JS | Espone | Uso |
|---|---|---|
| `js/config.js` | `window.db` (client Supabase) | URL + publishable/anon key |
| `js/auth.js` | `window.Auth` | `richiediAuth()` guard, `logout()`, `getProfilo()`, `riautentica()` (utility disponibile per un'eventuale conferma dell'identità via Supabase; le operazioni operative correnti usano autorizzazioni di ruolo server-side e nessuna password nel codice) |
| `js/mirox-safe.js` | `window.MiroxSafe` | `escapeHtml`, `safeUrl`, `isUuid`, `isRecordId`, `safeCssColor`. Caricato da tutte le pagine per impedire che dati DB/input diventino markup, URL o handler eseguibili |
| `js/anagrafica-helper.js` | `window.AnagraficaHelper` | `detectKind`, `cerca`, `cercaOcrea`, `setupAnagraficaSection` |
| `js/mirox-ui.js` | `window.MiroxUI` | `alert/confirm/prompt/loading/toast/allegati`. `allegati()` accetta sia `{url}` legacy sia `{bucket, path}` (genera signed URL on-click via MiroxStorage) |
| `js/mirox-storage.js` | `window.MiroxStorage` | `signedUrl(bucket,path,exp)`, `openAttachment(bucket,path)` — signed URL on-demand per i bucket privati (vedi sezione "Storage buckets") |
| `js/mirox-storage-upload.js` | `window.MiroxStorageUpload` | `upload({file,bucket,path})` — invia PDF dei moduli operativi a `upload-documento-modulo`; nessuna scrittura Storage diretta dal browser |
| `js/mirox-api.js` | `window.MiroxApi` | `fetch(url, opts)` wrapper che inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. Usare per TUTTE le chiamate alle Netlify functions (vedi "Auth functions"). **Auto-refresh trasparente del JWT** (dal 2026-07-01): se il token e' entro 60s dalla scadenza chiama `refreshSession()` prima del fetch; se una function risponde 401 tenta refresh + retry una volta; se anche il retry fallisce mostra toast "Sessione scaduta" e redireziona a `index.html`. Refresh proattivo anche su `visibilitychange`/`pageshow` e via heartbeat 5 min (copre PC in sleep e tab in background dove il timer interno di supabase-js viene throttled dal browser). Espone anche `MiroxApi.refreshSession()` per forzare un refresh esplicito |
| `js/mirox-upload.js` | `window.MiroxUpload` | drag-drop binding su `.mx-drop-zone` e `.file-drop`; anteprima PDF prima di accettare file selezionati/trascinati (`previewPdfFile`, `previewPdfFiles`, `confirmFilesForInput`) |
| `js/mirox-folder.js` | `window.MiroxFolder` | `build(oldName, newName, date)` per nomi cartella Storage |
| `js/mirox-mailer.js` | `window.MiroxMailer` | `send({to, template, vars})` |
| `js/mirox-error-reporter.js` | `window.MiroxErrorReporter` | `now()` timestamp Europe/Rome; `report({source, level, title, message, technical, context, silent})` invia mail di notifica al proprietario via `mirox-send-email` con throttling 60s per fingerprint; `install({source, ownerEmail})` aggancia handler globali `window.error` + `unhandledrejection`. Destinatario default `mirko.piasenti@gmail.com`. Vedi sezione "Sistema di error reporting via email" |
| `js/vendita-storage-helper.js` | `uploadVenditaDocumento(...)` | wrapper upload PDF via Netlify function |

### 2. Server (`/netlify/functions/`, Node >=22)

Tutte le functions usano `SUPABASE_SERVICE_ROLE_KEY` e bypassano le RLS. Per questo motivo **TUTTE le functions tranne i due cron Netlify e `public-prenota`** richiedono `Authorization: Bearer <jwt>` valido (validato via `_lib/require-auth.js`). `admin-vendita-config`, `elimina-vendita-contratto` e le action sensibili di `gestisci-operazioni-post-vendita` richiedono ulteriore check `ruolo='admin'`. Il client deve usare `MiroxApi.fetch()` o aggiungere l'header manualmente. 20 functions + 5 lib condivise (`_lib/mailer.js`, `_lib/require-auth.js`, `_lib/smshosting.js`, `_lib/privacy-config.js`, `_lib/pdf-consenso.js`):

- `vendita-config.js` (GET) — catalogo per wizard
- `admin-vendita-config.js` (GET/POST action-based) — CRUD admin offerte/opzioni/reload + replace regole documentali
- `crea-vendita-pratica-carrello.js` (POST action-based) — `create`: anagrafica upsert → pratica `bozza` → N contratti, PDA e validazioni; l'operatore è derivato dal JWT e non dal payload. `finalize`: dopo tutti gli upload passa la pratica a `inviata` e chiude gli eventi CC. `rollback_upload_failure`: elimina in modo compensativo pratica `bozza`, contratti, record documento e file già caricati. Le action sono idempotenti e consentite solo all'operatore proprietario o a un admin. Il reinserimento è validato anche server-side su stessa anagrafica, categoria, mese solare Europe/Rome e stato post-vendita. Cellulare obbligatorio; email obbligatoria per Consumer/Business e facoltativa per Turista.
- `upload-vendita-documento.js` (POST multipart busboy, max 20MB) — accetta solo file con MIME e firma `%PDF-`, verifica proprietà operatore/admin per le bozze e consente agli operatori attivi la gestione delle pratiche `inviata` da Verifica Contratti. Valida relazioni pratica/anagrafica/contratto, deriva il path dalla pratica a DB e usa come `uploaded_by` il profilo autenticato. Rollback del file se l'INSERT DB fallisce. In staging con `temp_session_id` salva in `temp/<sess>/` senza record DB.
- `upload-documento-modulo.js` (POST multipart busboy, max 20MB) — upload server-side autenticato per `apri-chiudi-files`, `switch-sim-files`, `comodato-files`, `rimborsi-files`, `protecta-files`, `segnalazioni-files`. Verifica firma `%PDF-`, bucket e struttura path tramite allowlist; usa `upsert:false`, genera un suffisso anti-collisione e registra `uploaded_by` dal JWT nei metadati Storage.
- `gestisci-vendita-contratto.js` (POST action-based) — `update` (`save`/`verify`/`reopen`) e `delete_document` per Verifica Contratti. Accetta solo campi in allowlist, deriva snapshot/punteggi dal catalogo, imposta `controllato_da` dal JWT e gestisce rimozione Storage + record DB. Sostituisce UPDATE/INSERT/DELETE diretti dal browser su `vendita_contratti`/`vendita_documenti`.
- `gestisci-operazioni-post-vendita.js` (POST action-based) — sostituisce tutte le scritture browser su `post_vendita_gestione_rimborsi`: creazione, associazione path PDF e completamento restano disponibili agli account autenticati; `create_rimborso_manuale` e `mark_apri_chiudi_ko` passano da `requireAuth(..., {adminOnly:true})`. Operatore e stato del rimborso manuale sono derivati lato server. Migration post-deploy `056`: rimborsi write server-only e trigger DB che impedisce di introdurre `vendita_apri_chiudi.stato='KO'` da sessioni non-admin.
- `elimina-vendita-contratto.js` (POST) — admin-only; elimina definitivamente contratto, record collegati e allegati Storage, e la pratica se rimane vuota.
- `ocr-pda.js` (POST multipart, max 20MB) — OCR del PDA via Claude API (`claude-haiku-4-5-20251001`). **Dati cliente**: cf_piva, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico. **Codice Rivenditore** (dal 2026-07-18, migration `050`): `codice_rivenditore` estratto dal "Codice POS" WindTre, valori ammessi solo `'9001415852'` (Legnago) o `'9000822241'` (Cerea), altrimenti `null`. **Dati dispositivo** (dal 2026-06-26, PDA WindTre Mobile/Customer Base): `dispositivo_presente` (bool), `tipo_acquisto` ('VAR' o 'Finanziamento'), `imei` (15 cifre), `prezzo_device` (stringa numerica es. "399.9"), `smartphone_reload` (bool nullable: true=SI[X], false=NO[X], null=sezione assente). Riconoscimento VAR vs Finanziamento via 3 segnali concordi nel PDA: titolo pagina ("Offerta con Finanziamento" vs "Offerta Vendita a Rate"), header sezione ("OFFERTA CON FINANZIAMENTO" vs "VENDITA A RATE"), riga Opzioni/servizi della SIM ("Vendita con Finanziamento" vs "Vendita a rate"). Validazione server-side: tipo_acquisto solo enum, imei regex 15 cifre, prezzo_device regex numerico (altrimenti `null` per evitare di sporcare il form). `finanziaria` e `kolme` NON sono estratti (non presenti nel PDA, compilazione manuale operatore). 200 con `data: {...}` se l'OCR estrae (campi `null` se parziale). In caso di errore "hard" l'errore Anthropic viene classificato in `error_code` strutturato: `ocr_credit_exhausted` (credit balance low → 503), `ocr_rate_limited` (429 → 503), `ocr_unavailable` (5xx/529 → 503), `ocr_auth_error` (401/403 → 503), `ocr_generic_error` (default → 500). Payload errore: `{success:false, error, error_code, http_status, provider_status, provider_message}`. Il client decide il popup in base a `error_code`. Richiede `ANTHROPIC_API_KEY`.
- `search-anagrafica.js` (GET) — lookup CF/PIVA
- `mirox-send-email.js` (POST) — mailer autenticato
- `cron-rientro-sim.js` (scheduled `0 7 * * *`) — notifica giornaliera switch SIM. **Non auth-gated** (chiamata dal cron Netlify, non da utente)
- `cron-pulizia-operativa.js` (scheduled `30 2 * * *`) — scade OTP pending, elimina contatori rate-limit scaduti e recupera fino a 100 pratiche `bozza` oltre 24 ore eliminando prima i PDF noti e poi il record DB. **Non auth-gated** (cron Netlify).
- `public-prenota.js` (GET/POST) — **endpoint pubblico** chiamato dal form `prenota.html` (anon). GET ritorna gli slot via `get_slot_disponibili`; POST usa la nuova RPC `public_prenota_appuntamento_v1` (migration `055`), che prende un advisory lock e ricontrolla lo slot nella stessa transazione dell'INSERT. Rate limit persistente su Postgres tramite fingerprint SHA256 dell'IP: 60 GET e 6 POST ogni 10 minuti; fail-closed se il limiter non risponde. **Non auth-gated** (intenzionalmente pubblico).
- `garantisci-anagrafica.js` (POST) — upsert anagrafica (lookup CF/PIVA → update campi vuoti / cambiati o insert). Chiamato dal wizard upload-contratti PRIMA della raccolta consenso privacy: il consenso ha bisogno di `anagrafica_id` ma il backend del carrello finora la creava solo al submit. Idempotente con `crea-vendita-pratica-carrello` (entrambi fanno lo stesso lookup/update). Vedi sezione "Sistema consensi privacy GDPR".
- `check-consenso-privacy.js` (GET) — `?anagrafica_id=<uuid>`. Cerca una dichiarazione `stato='confermato'`, non scaduta, non revocata e con `informativa_versione` appartenente alle versioni correnti cartacea/digitale. Il filtro impedisce di riusare retroattivamente informative precedenti.
- `richiedi-otp-privacy.js` (POST) — richiede `consenso_marketing` booleano esplicito, genera OTP 6 cifre, salva hash SHA256+salt random e invia SMS via Smshosting. Rate-limit 3 invii/ora per `anagrafica_id` + cooldown 60s tra invii. Invalida automaticamente i record `pending` precedenti dello stesso cliente. Richiede `SMSHOSTING_API_KEY`, `SMSHOSTING_API_SECRET`. Se `SMSHOSTING_SIMULATE=true` non invia davvero, logga e ritorna id fittizio (utile per dev/test).
- `verifica-otp-privacy.js` (POST) — `{consenso_id, otp}`. Re-hash dell'OTP inserito e confronto. Max 3 tentativi (poi `stato='fallito'`). Se OK genera il PDF digitale v6 con entrambe le opzioni marketing, una sola marcata, scelta nel riquadro probatorio ed evidenze reali (cellulare, invio/conferma, esito/tentativi, IP, user agent, hash SHA256, ID SMS), upload su bucket `consensi-privacy`, segna `stato='confermato'` + `valido_fino_al = now()+24 mesi` + `informativa_hash`.
- `genera-pdf-consenso-cartaceo.js` (GET) — `?anagrafica_id=<uuid>&consenso_marketing=true|false`. Stream binario del modulo v6 **precompilato in modalità cartacea**: una sola pagina A4, bianco e nero, corpo 10 pt, due colonne per l'informativa, dati/dichiarazioni/firma a larghezza piena e scelta marketing già marcata. Rifiuta la richiesta se la scelta manca.
- `upload-consenso-cartaceo.js` (POST multipart busboy, max 20 MB) — riceve la scansione PDF del modulo firmato e richiede l'esito marketing `true|false` riportato sul foglio. Calcola SHA256, carica nel bucket `consensi-privacy` e crea il record `modalita='cartaceo'`, `stato='confermato'` (no OTP).
- `_lib/mailer.js` — helper SMTP Gmail + template DB + log
- `_lib/require-auth.js` — helper auth: valida JWT Supabase nell'header `Authorization: Bearer <token>`, ritorna `{ok, user, profilo}` o `{ok:false, status, error}`. Supporta opt `adminOnly: true` per richiedere `ruolo='admin'`. Usare in TUTTE le nuove functions
- `_lib/smshosting.js` — wrapper REST API Smshosting per invio SMS transactional. Espone `sendOtpSms({to, otp})`, `normalizeMobileNumber(raw)`, `generateOtp(6)`. Auth HTTP Basic. Endpoint `https://api.smshosting.it/rest/api/sms/send`. Timeout 12s. Modalità simulazione tramite env `SMSHOSTING_SIMULATE=true`. Vedi `docs/SMSHOSTING_SETUP.md` per il setup account.
- `_lib/privacy-config.js` — fonte unica delle due versioni informative correnti: `v6_2026_07_26` cartacea e `v6_2026_07_26_dig` digitale OTP. Espone anche l'elenco accettato dal dedupe/backend.
- `_lib/pdf-consenso.js` — generatore `pdfkit` con due template: cartaceo v6 su una pagina A4 monocromatica e digitale v6 `_dig` su tre pagine con layout storico. La ragione sociale del Titolare è `KONA TECH SRL`. Finalità, basi giuridiche, conservazione e perimetro marketing sono equivalenti. Entrambe le varianti mostrano ACCONSENTO e NON ACCONSENTO con una sola scelta marcata; il digitale la ripete nel riquadro probatorio e descrive il flusso OTP reale. Esporta `{buffer, hash, informativaVersione}`.

### 3. Database (Supabase Postgres)

~80 tabelle. Project ref: `lbgwamhjkjjfwgusafbi`. Credenziali pubbliche in `js/config.js` (single source of truth, non duplicarle qui).

---

## Mappa Supabase per dominio

### Anagrafica & Auth (condiviso)
- `profili` — utenti CRM, `ruolo` IN ('admin','operatore'), `pagine_accessibili` jsonb per ACL Call Center, `alias_di` self-FK opzionale verso il profilo canonico. Il backfill alias usa `applica_alias_backfill_v2(uuid)` (migration `053`), SECURITY DEFINER con controllo `ruolo='admin'`; la v1 viene chiusa al client dalla migration post-deploy `054`.
- `anagrafica` — cliente unificato, `cf_piva` UNIQUE, `cluster` IN ('Consumer','Business','Turista'). Colonna `email` (text, NULL ammesso a livello DB ma obbligatoria lato wizard vendita). RPC `cerca_o_crea_anagrafica(p_..., p_email)` UPSERT

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
- `vendita_contratti` — riga venduta con snapshot + punteggi server-side + `stato_controllo`. **Codice Rivenditore** (`codice_rivenditore`, migration `050`): text NOT NULL DEFAULT `'9001415852'` CHECK IN (`'9001415852'`,`'9000822241'`). Identifica il punto vendita di inserimento: `9001415852` = Legnago (negozio principale), `9000822241` = Cerea. Il wizard deve propagare sempre il valore dal draft al payload `buildInvioPayload`; se lo omette il backend applica il default Legnago e falsifica il punto vendita. Filtra Dashboard Pezzi Day by Day + Avanzamento Mensile (solo Legnago); Gare Individuali conteggia entrambi. Indice `idx_vendita_contratti_codice_rivenditore`.
- `vendita_documenti`, `vendita_documenti_regole`, `vendita_compensi_regole`, `vendita_log_modifiche`. Migration `053`: UNIQUE `(storage_bucket, storage_path)`; migration post-deploy `054`: INSERT/DELETE documenti soltanto via backend.
- `vendita_consensi_privacy` — registra presa visione dell'informativa CRM e consenso promozionale opzionale (migration 034; durata originaria 48 mesi ridotta e clamped a 24 mesi dalla migration 055). Modalità `otp_sms` o `cartaceo`, stato workflow (`pending`/`confermato`/`scaduto`/`fallito`/`revocato`), OTP hash+salt+scadenza+tentativi, audit IP/UA, snapshot anagrafica jsonb, `valido_fino_al`, `pdf_storage_path` privato. I ricontatti di servizio sulla pratica specifica non dipendono dal consenso marketing.
- Moduli operativi: `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `vendita_simulatore_protecta`

### Post-Vendita
- `post_vendita_dispositivi_comodato` — codice generato da RPC `genera_codice_comodato()`
- `post_vendita_gestione_rimborsi` — codice da RPC `genera_codice_rimborso()`. Dalla migration `056` le scritture e la RPC sono server-only: gli operatori usano `gestisci-operazioni-post-vendita`, mentre la creazione manuale è esclusivamente admin.
- `post_vendita_controllo_fissi` — follow-up dei contratti Fisso dopo conferma in Verifica Contratti. Stati: `Da completare` → `In Attivazione` → (`Attivo` | `KO`). Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_fissi` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Fisso passa a `controllato`. Campi manuali: `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`, `numero_fisso`, `attivazione_prevista`, `data_attivazione`, `motivo_ko`. Chat in `storico_chat` jsonb (`[{timestamp, message, autore}]`). CHECK constraint su `stato`, `tecnologia` (FTTC/FWA OUT/FWA IN/FWA VOCE/FTTH_OF/FTTH_FWCOP), `cod_pos` (9001415852/9000822241).
- `post_vendita_controllo_lg` — follow-up dei contratti Energia (L&G = Luce & Gas, nome user-facing del modulo) dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_lg` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Energia passa a `controllato`. Nessun campo manuale: tutti i dati sono letti dal join con `vendita_contratti` (`numero_contratto_energia`, `pod_pdr`, `ex_fornitore`, `operatore_id`) e `anagrafica` (`ragione_sociale`, `cf_piva`, `cellulare`). Colonne aggiornate dall'**upload CSV WindTre** (modulo Controllo L&G): `stato` (text, no CHECK), `causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento` (questi 3 valorizzati solo per stato='Rifiutato'), `ultimo_csv_upload_at`, `ultimo_csv_upload_da`.
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
- `storico_cliente` — **dal 2026-06-20 estesa con 4 UNION CC** (totale 12): tipi `ordine_smartphone`, `dispositivo_comodato`, `rimborso`, `apri_chiudi_vecchio`/`_nuovo`, `switch_sim_attuale`/`_rientro`, `contratto_vendita`, + nuovi `chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`. Schema invariato (`anagrafica_id`, `tipo`, `record_id`, `riferimento`, `data_op`, `stato`, `descrizione`, `operatore_nome`). Definizione in `database/024_storico_cliente_extend_call_center.sql`

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

Dal 2026-06-24 (migration `029`) i bucket dati clienti sono **PRIVATI**. Lettura solo via **signed URL** generato lato client con `MiroxStorage.signedUrl(bucket, path)` o `MiroxStorage.openAttachment(bucket, path)` (scadenza default 5 min).

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
| `moduli-template` | **pubblico** | Template modulistici (disdetta_fisso_consumer.pdf, ecc.) — generici, leggibili anche da non autenticati |

**Convenzione campi DB**: dopo migration 029 le colonne `cartella_url` / `preventivo_pdf_url` su `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_simulatore_protecta` contengono il **path** nel bucket (es. `dispositivo_X/file.pdf`), NON più un URL pubblico. I record legacy hanno ancora gli URL completi: il codice di lettura li gestisce entrambi (regex `replace` su prefisso `https://...storage/v1/object/public/<bucket>/`).

**RLS storage** (migration post-deploy `054`): i bucket privati restano leggibili da `authenticated` per signed URL/list. Le policy INSERT/UPDATE/DELETE browser sui sette bucket dati vengono rimosse; le scritture passano esclusivamente da `upload-vendita-documento`, `upload-documento-modulo` o dalle altre functions specializzate con service role. Il bucket `consensi-privacy` era già server-only. `moduli-template` resta l'unica eccezione pubblica/gestibile separatamente.

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
   - **Promozione PDA**: per ogni contratto con `pda_temp_path`, sposta il file da `temp/<sess>/` a `<cartella>/contratto_<categoria>.pdf` e crea il record `vendita_documenti` (tipo `contratto`)
   - Rollback pratica + documenti Storage se anche un solo contratto o la promozione PDA falliscono
6. Upload PDF restanti (identita/bolletta/SIM) → `POST /netlify/functions/upload-vendita-documento` (multipart):
   - Verifica firma PDF e coerenza `pratica_id`/`anagrafica_id`/`contratto_id`; path e `uploaded_by` sono derivati server-side
   - Upload su bucket `contratti-vendita` in `<YYYY>/<MM>/<cartella_safe>/`
   - INSERT `vendita_documenti`
   - Rollback file su Storage se INSERT DB fallisce
   - Al termine il wizard chiama action `finalize`: pratica `bozza` → `inviata` + auto-chiusura eventi CC
   - Se un upload fallisce chiama `rollback_upload_failure`: elimina la pratica incompleta e i file già caricati, così un nuovo tentativo non duplica i contratti
7. Verifica contratto in `moduli/verifica_contratti.html` → `gestisci-vendita-contratto` action `update`, mode `verify`, che imposta server-side `stato_controllo='controllato'`, `controllato_da` dal JWT e gli snapshot/punteggi catalogo. Il popup di conferma per i contratti Fisso/Energia evidenzia il passaggio rispettivamente al modulo Controllo Fissi / Controllo L&G. Per categoria Energia, sono obbligatori in fase di verifica `numero_contratto_energia` E `ex_fornitore` (entrambi compilati nella sezione "Campi specifici categoria" del popup verifica). Il popup (solo tab "Da Verificare", editabile) contiene una sezione "Inserimento pratica" con **Data di upload** (`vendita_contratti.data_contratto`, input `datetime-local` in ora Europe/Rome) e **Operatore inserimento** (`vendita_contratti.operatore_id`, dropdown dei `profili` attivi) modificabili — salvati sia da "Salva modifica" sia da "Conferma verifica". Nella tab "Verificati" sono read-only.
8. Post-vendita Fisso: il trigger `trg_vendita_contratti_to_controllo_fissi` crea automaticamente una riga in `post_vendita_controllo_fissi` con stato `Da completare`. L'operatore compila i 4 campi obbligatori (Cod. Cliente, Tecnologia, Cod. Contratto, Cod. POS) in `moduli/controllo_fissi.html` → click "Compilazione Completata" → stato `In Attivazione`. Poi via dropdown stato → `Attivo` (con data attivazione effettiva obbligatoria) oppure `KO` (azzera `attivazione_prevista`).
9. Post-vendita Energia (L&G): il trigger `trg_vendita_contratti_to_controllo_lg` crea automaticamente una riga in `post_vendita_controllo_lg`. La pagina `moduli/controllo_lg.html` mostra tutti i dati incolonnati in tabella (nessun popup dettagli, nessuno step di completamento): Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contratto, POD/PDR, Ex Fornitore, Contatto (cellulare), Operatore, Stato.
10. Post-vendita Assicurazioni: il trigger `trg_vendita_contratti_to_controllo_assicurazioni` crea automaticamente una riga in `post_vendita_controllo_assicurazioni`. La pagina `moduli/controllo_assicurazioni.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Metodo di pagamento (RID/Carta di Credito/Carta di Debito), Ricorrenza (Mensile/Annuale).
11. Post-vendita Allarmi: il trigger `trg_vendita_contratti_to_controllo_allarmi` crea automaticamente una riga in `post_vendita_controllo_allarmi`. La pagina `moduli/controllo_allarmi.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Modalità di pagamento (Finanziamento/Anticipo).

---

## Regole di business chiave

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
- Per queste 3 categorie il PDA (contratto PDF) e' obbligatorio e viene caricato allo step 1 del wizard in staging (`temp/<temp_session_id>/pda_<rand>.pdf`); poi promosso a `<cartella_pratica>/contratto_<categoria>.pdf` al submit.
- Per `Energia`, `Allarmi`, `Assicurazioni`: NESSUN PDA, NESSUN documento "contratto" (resta solo `documento_identita` + eventuali bolletta/SIM).
- L'OCR del PDA e' opzionale: il bottone "Continua senza AI" salta la chiamata a Claude API ma carica comunque il file in staging.

### Step Firma (solo categorie PDA)
- Solo per Mobile / Customer Base / Fisso il wizard chiede tra step Contratto e step Documenti la modalita' di firma: `elettronica` o `cartacea`. Il valore finisce in `vendita_contratti.tipo_firma` (vincolato dal CHECK constraint).
- `elettronica`: nessun upload aggiuntivo. Il PDA originale gia' in staging diventa l'unico `contratto.pdf` in cartella pratica.
- `cartacea`: nello step Documenti compare un upload "Contratto firmato" obbligatorio. Il file viene caricato a parte tramite `/upload-vendita-documento` con `tipo_documento='contratto_firmato'` e salvato come `<cartella_pratica>/contratto_firmato_<categoria>.pdf` (affianca il PDA originale).
- Per Energia/Allarmi/Assicurazioni lo step Firma e' saltato e `tipo_firma` resta NULL nel DB.

### Punteggi (anti-tampering)
- Il **frontend NON deve mai mandare i punteggi**
- Il server li legge da `vendita_offerte.punteggio_gara` + `vendita_opzioni.punteggio_gara` (e `_extra_gara`)
- Trigger `vendita_calcola_punteggio_totale` ricalcola il totale su ogni INSERT/UPDATE

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

**Dashboard**: i reinserimenti sono esclusi sia dal Day by Day sia dai dati mensili/Gare Individuali/Avanzamento Mensile. Metrica derivata "tasso di rilavorazione = reinserimenti / inserimenti totali" ancora da implementare.

### Controllo Fissi (post-vendita)
- Tabella: `post_vendita_controllo_fissi` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_fissi`: alla conferma verifica di un contratto Fisso (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_fissi` con stato `Da completare`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Stati ammessi** (CHECK `pvcf_stato_chk`): `Da completare`, `In Attivazione`, `Attivo`, `KO`. Transizioni: `Da completare` → `In Attivazione` (via bottone "Compilazione Completata") → `Attivo` (richiede `data_attivazione` effettiva) | `KO` (azzera `attivazione_prevista`, opzionale `motivo_ko`). `KO` ammesso solo da `In Attivazione`. Stati `Attivo`/`KO` sono terminali (non modificabili da UI).
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
  - **Match primario**: colonna `Proposta di Contratto` (CSV) ↔ `vendita_contratti.numero_contratto_energia` (exact match, trim).
  - **Double check**: per cluster `Consumer` confronta `Codice Fiscale` (col E) con `anagrafica.cf_piva`. Per `Business` confronta `Partita Iva` (col F) **normalizzata con padding zeri a sinistra fino a 11 cifre** (il portale rimuove gli zeri iniziali).
  - **Sovrascrittura sempre**: se il match passa, lo `stato` viene aggiornato anche se gia' valorizzato (es. da `Nuovo` a `Rifiutato` dopo qualche giorno).
  - **Aggregazione duplicati LUCE/GAS**: stesso `Proposta di Contratto` con 2 righe (1 LUCE + 1 GAS) → vince lo stato a priorita' maggiore (Rifiutato > Annullato > In lavorazione > In attivazione > Nuovo > Attivato), cosi' l'operatore vede sempre l'eventuale problema.
  - **Colonne dettaglio rifiuto** (`causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento`) valorizzate **solo** se stato='Rifiutato' (azzerate altrimenti).
  - **Report finale**: popup con 5 stat-card (Righe CSV, Pratiche uniche, Aggiornati, Double check KO, Non trovati DB) + tabelle dettagliate delle incongruenze.
- **Icona occhio 👁️** in fondo alle righe con stato='Rifiutato': apre popup con i 3 campi dettaglio (causale/messaggio/causa). Per gli altri stati nessuna icona.

### Storage folder naming
- Contratti vendita: `Contratto_<RAGSOC_SAFE>_<DD_MM_YYYY>_<praticaIdShort6>` sotto `<YYYY>/<MM>/` (lowercase)
- Altri moduli: `MiroxFolder.build(old, new, date)` → `OLD_NEW_GG_MM_AA` (uppercase)

### Documenti
- Bucket: `contratti-vendita`
- Tipi gestiti: `documento_identita`, `contratto`, `contratto_firmato`, `copia_bolletta`, `copia_sim_mnp`
- Regole con `campo_condizione='admin_config'` sono gestibili da UI admin
- Nome standard: `documento_identita.pdf`, `contratto_<categoria_slug>.pdf`, `contratto_firmato_<categoria_slug>.pdf` (solo per firma cartacea), `copia_sim_mnp.pdf`, `copia_bolletta.pdf`
- Solo `application/pdf`, max 20 MB

---

## Modulo Call Center integrato (Fase 1, dal 2026-06-20)

Le 11 pagine CC + asset stanno in `moduli/call-center/` (la 12esima — `configurazione.html` — è stata spostata sotto Admin Mirox il 2026-06-24, vedi sezione "Pannello Admin Mirox"). Sono **port pragmatico** dalle pagine prod del CC: logica interna invariata (è testata in produzione da mesi), modifiche minimali per integrarle in Mirox.

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
- **Tab nav orizzontale**: 9 voci CC, filtrate per `profili.pagine_accessibili[perm]` (admin vede tutte). Tab corrente in evidenza arancione. La voce `configurazione` è stata rimossa il 2026-06-24 quando la pagina è migrata sotto Admin Mirox

### Cosa NON è ancora unificato (debito tecnico)

Le pagine CC ancora usano:
- `Utils.toast/openModal/closeModal/showLoading/...` (in `moduli/call-center/js/app.js`) invece di `MiroxUI.*`
- `alert()` / `confirm()` nativi in alcuni punti (es. `blacklist.html` rimuovi conferma)
- `db.from('anagrafica').insert(...)` diretto in `registra-chiamata.html` (riga ~651) invece di `AnagraficaHelper.cercaOcrea` — rischio basso di duplicati grazie al check precedente `cercaCliente()`, ma non rispetta lo standard Mirox

→ refactor profondo da fare iterativamente in sessioni successive, una pagina per volta

### Accesso dalla dashboard Mirox

- **Solo via bottone topbar** "Call Center" — niente tab/card nella dashboard (scelta UX dell'utente: la dashboard è focus Vendita/Post-Vendita, il CC ha la sua sidebar interna come navigazione)
- **Redirect dinamico runtime**: al caricamento dashboard, il JS calcola la **prima pagina CC accessibile** per l'utente (ordine: registra_chiamata → elenco_chiamate → rilavorazione → call_center_lead_outbound → appuntamenti → prenota_interno → appuntamenti_oggi → esiti_appuntamenti → blacklist) e imposta `href` del bottone topbar a quell'URL diretto
- **Disabilitato se nessun permesso**: se l'utente non ha **nessuna** delle chiavi CC in `pagine_accessibili` (e non è admin), il bottone resta in classe `.disabled` (come nasce nell'HTML statico) e il click è bloccato
- **Bottone "Torna alla dashboard Mirox"** in cima a ogni pagina CC integrata: arancione, ben visibile (era un breadcrumb piccolo, ora è un bottone stilizzato — eccetto `prenota.html` pubblica)

### Chiavi permessi (riusate identiche al CC prod)

`registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`. La chiave `configurazione` resta valida in DB (CC prod la usa) ma da Mirox la pagina è sotto Admin (gated da `ruolo='admin'`, NON da `pagine_accessibili`).

→ Zero migrazione utenti: chi ha permesso `'registra_chiamata'` su `mirox-crm.netlify.app` vede la stessa card anche qua.

### Pagina pubblica `prenota.html`

Form esterno per prenotazioni dal sito/social. **NON in dashboard** (non ha auth guard). Raggiungibile solo via URL diretto e non parla direttamente con Supabase. La function `public-prenota.js` applica validazione, allowlist motivi e rate limit persistente; la RPC additiva della migration `055` impedisce il doppio booking concorrente. Gli errori sono mostrati in un riquadro accessibile, senza `alert()` nativo.

### Rischi e limiti noti

- **Permessi granulari Mirox solo per CC**: la modale "Permessi CC" in `admin-utenti.html` lista solo le 9 chiavi CC (le pagine Vendita/Post-Vendita sono accessibili a tutti gli utenti attivi, non c'è ancora granularità). Da estendere quando serve gating per modulo Vendita/Post-Vendita
- **`vw_elenco_chiamate_unificate` / `vw_rilavorazione_ricontatti_unificata`**: usate dalle pagine CC, dipendono dalla colonna `chiamate.rilavorazione_stato` (esiste) e dalle viste già createSE — verificate online in Fase 1
- **`get_slot_disponibili` RPC**: usata da `prenota.html`, `prenota-interno.html`, `appuntamenti.html` (per spostamento). Confermata esistente nel DB

---

## Pannello Admin Mirox (dal 2026-06-24)

Hub centralizzato di amministrazione, gated da `profili.ruolo='admin'`. Visibile dalla dashboard come bottone topbar "Admin" (disabilitato per operatori).

### Pagine

| Pagina | Scopo |
|---|---|
| `admin.html` | Hub con 3 card di navigazione (Gestione Utenti / Configurazione CC / Catalogo Vendita) |
| `admin-utenti.html` | CRUD su `profili`: cambio ruolo admin↔operatore con conferma, abilita/disabilita, modale permessi granulari CC (9 chiavi). Un admin non può togliersi il ruolo né disabilitarsi |
| `admin-call-center-config.html` | Configurazione CC (orari settimanali, blocchi/chiusure, parametri sistema). Spostata da `moduli/call-center/configurazione.html` (eliminata). NON dipende da `CcHeader` o dai JS del CC: usa solo `js/config.js` + `js/auth.js` + `js/mirox-ui.js` Mirox |
| `admin-vendita-config.html` | Esistente: CRUD cataloghi vendita. Aggiunto check `ruolo='admin'` (prima era solo `richiediAuth`). Bottone "← Admin" rimpiazza "← Dashboard" |

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

## Sistema di error reporting via email (dal 2026-06-25)

Ogni errore tecnico nel CRM (rete, OCR, submit, JS non gestiti...) viene notificato via email al proprietario con timestamp preciso Europe/Rome. L'utente in popup vede sempre la pillola "Orario errore: GG/MM/AAAA HH:MM:SS" sotto al messaggio.

### Componenti

- **Client**: `js/mirox-error-reporter.js` → `window.MiroxErrorReporter` (vedi tabella JS condivisi). Throttling 60s per fingerprint per evitare flood in loop. Destinatario default `mirko.piasenti@gmail.com` (override con `install({ownerEmail})`).
- **Trasporto**: la mail viene inviata via `MiroxApi.fetch('/.netlify/functions/mirox-send-email')` con HTML inline (no template DB). Subject `[MIROX][LEVEL] <titolo> — <timestamp>`. Body con tabella metadata (livello, sorgente, utente, pagina, browser) + dettagli tecnici + contesto JSON. Loggata su `email_log` con `related_table='error_report'`.
- **Backend OCR** (`netlify/functions/ocr-pda.js`): l'errore Anthropic viene classificato in `error_code` strutturato e ritornato in payload `{success:false, error, error_code, http_status, provider_status, provider_message}` con HTTP 503/500 a seconda. Codici: `ocr_credit_exhausted` (credit balance low), `ocr_rate_limited` (429), `ocr_unavailable` (5xx/529), `ocr_auth_error` (401/403), `ocr_generic_error`. Il client `fetchJsonOrTechnicalError` propaga `error_code` su `err.serverErrorCode` e `err.httpStatus`.

### Livelli mail

- `critical` → eventi che richiedono azione immediata (es. credito OCR esaurito, boot wizard fallito)
- `error` → submit pratica fallita, lookup anagrafica giù, OCR temporaneamente down
- `warning` → OCR fallito su singolo PDA, errore parsing
- `info` → eventi informativi (non usato oggi)

### Come usarlo in altre pagine

1. Includere `<script src="../js/mirox-error-reporter.js"></script>` dopo `mirox-api.js`
2. Al boot: `if (window.MiroxErrorReporter) window.MiroxErrorReporter.install({ source: 'nome-pagina' });` (aggancia `window.error` + `unhandledrejection` per catturare il resto)
3. Negli `catch` di errori tecnici (rete, 5xx, eccezioni inattese): chiamare `MiroxErrorReporter.report({source, level, title, message, technical, context, silent:true})` oppure passare un quarto parametro `reportInfo` alle funzioni `showErrorOverlay`-style se la pagina ne ha una (il wizard upload-contratti-vendita ha integrato il pattern: vedi `showErrorOverlay(title, text, technicalText, reportInfo)` con `reportInfo = {level, errorCode, context}`)
4. NON usare per errori di validazione utente ("compila il campo Email") — solo per problemi tecnici e di sistema. Il throttling 60s previene comunque flood

### Implementato dove (al 2026-06-25)

**Integrazione globale (31 pagine, ogni pagina ha `install({source:'<nome>'})` al boot per catturare errori JS non gestiti):**

- **Root** (5): `dashboard`, `admin`, `admin-utenti`, `admin-vendita-config`, `admin-call-center-config`
- **Vendita/Post-Vendita** (15): `upload-contratti-vendita` (integrazione completa con `reportInfo` sui 5 catch tecnici principali + branching OCR credito esaurito), `apri_chiudi`, `switch_sim`, `ordini_smartphone`, `simulatore_protecta`, `dashboard_pezzi`, `storico_cliente`, `dispositivi_comodato`, `gestione_rimborsi`, `verifica_contratti`, `controllo_fissi`, `controllo_lg`, `controllo_assicurazioni`, `controllo_allarmi`, `ticket`
- **Call Center** (11): `appuntamenti`, `appuntamenti-oggi`, `blacklist`, `call-center-lead-outbound`, `elenco-chiamate`, `esiti-appuntamenti`, `prenota-interno`, `prenota-interno-outbound`, `registra-chiamata`, `registra-chiamata-outbound`, `rilavorazione`

**Pagine escluse (volutamente)**:

- `index.html` — schermata di login, prima dell'autenticazione (nessun JWT da iniettare)
- `moduli/segnalazioni.html` — esclusa per scelta operativa (da integrare in seconda battuta)
- `moduli/call-center/prenota.html` — form pubblico anon (nessuna auth, `mirox-send-email` ritornerebbe 401)

**Tipo di integrazione applicato sulle 30 pagine batch** (dal 2026-06-25):

1. Aggiunto include `mirox-api.js` dove mancava (necessario per `Authorization: Bearer <jwt>` su `mirox-send-email`)
2. Aggiunto include `mirox-error-reporter.js`
3. Aggiunto snippet inline `if (window.MiroxErrorReporter) MiroxErrorReporter.install({source:'<nome-pagina>'})` subito dopo l'include — installa i global handler il prima possibile

NON sono stati ancora aggiunti `reportInfo` ai singoli `catch` esistenti: i global handler intanto catturano tutti gli errori JS non gestiti (`window.error` + `unhandledrejection`). Quando un singolo modulo ha bisogno di mail mirate per un catch specifico (es. "submit fallita", "fetch X fallito"), si segue il pattern del wizard upload-contratti (`showErrorOverlay(..., reportInfo)` oppure `MiroxErrorReporter.report({...})` direttamente). Da fare iterativamente quando emerge necessità per singolo modulo.

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
- **Azioni sensibili per ruolo**: **MAI** password operative hardcoded nel frontend. Rimborso manuale e passaggio Apri/Chiudi a `KO` non richiedono una seconda password: sono visibili solo agli admin e devono passare da una Netlify Function con `requireAuth(..., {adminOnly:true})`; migration `056` impedisce l'aggiramento con scritture dirette dal browser.
- **Anagrafica**: SEMPRE via `AnagraficaHelper.cerca` / `cercaOcrea` (RPC `cerca_o_crea_anagrafica`) per evitare doppioni
- **Upload PDF**: SEMPRE via Netlify function. Per i moduli operativi usare `MiroxStorageUpload.upload(...)`; per i documenti vendita usare `uploadVenditaDocumento(...)`. MAI `db.storage.from(...).upload()` dal client — la service_role non deve mai uscire dal server
- **Anteprima PDF upload**: nei moduli Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato ogni PDF selezionato o trascinato deve passare da `MiroxUpload` prima di essere mantenuto nell'input. Bottone rosso `X` = rimuovi, bottone verde `Conferma` = il file resta selezionato. Per drop-zone custom usare `MiroxUpload.previewPdfFiles()` o `MiroxUpload.confirmFilesForInput()` invece di assegnare il file direttamente.
- **Lettura allegati da bucket privati**: SEMPRE via `MiroxStorage.openAttachment(bucket, path)` o `MiroxStorage.signedUrl(...)`. **MAI** `getPublicUrl()` per i bucket privati (vedi sezione "Storage buckets"). Eccezione: `moduli-template` resta pubblico e accetta `getPublicUrl()`
- **Chiamate a Netlify functions dal client**: SEMPRE via `MiroxApi.fetch(url, opts)` — inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. MAI `fetch()` diretto, altrimenti la function ritorna 401. Per FormData, NON settare `Content-Type` manualmente (il browser inserisce il boundary)
- **Auth in nuove Netlify functions**: usare `const { requireAuth } = require('./_lib/require-auth')` e all'inizio dell'handler `const auth = await requireAuth(event); if (!auth.ok) return response(auth.status, { success: false, error: auth.error });`. Per endpoint solo admin: `requireAuth(event, { adminOnly: true })`. CORS `Access-Control-Allow-Headers` deve includere `Authorization`
- **Identità server-side**: campi audit/ownership come `operatore_id`, `uploaded_by`, `created_by` non devono essere accettati come fonte di verità dal payload client; derivarli da `auth.profilo`/`auth.user` e validare le relazioni tra gli UUID ricevuti.
- **Email**: via `MiroxMailer.send({to, template, vars})` → endpoint `mirox-send-email`. Mai SMTP diretto dal client.
- **Error reporting (errori tecnici)**: per problemi di rete, 5xx, eccezioni inattese, OCR down ecc. SEMPRE usare `MiroxErrorReporter.report(...)` o passare `reportInfo` a `showErrorOverlay`. NON usare per validation utente. Il sistema fa throttling automatico 60s per fingerprint. Vedi sezione "Sistema di error reporting via email"
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
| **Aggiungere una nuova pagina al pannello Admin** | Nuova card in `admin.html` + nuova pagina `admin-<nome>.html` alla root, riusare guard pattern `Auth.richiediAuth()` + check `ruolo === 'admin'` (vedi sezione "Pannello Admin Mirox") |
