# Mirox CRM — Vendita

Modulo CRM per la gestione di vendite, post-vendita e supporto operativo della rete Konatech. Static frontend HTML/JS + Netlify Functions (Node) + Supabase Postgres.

## Stack

- **Frontend**: HTML statico + JavaScript vanilla (no bundler), Inter via Google Fonts, client Supabase `@supabase/supabase-js@2.110.8` da CDN con Subresource Integrity
- **Backend serverless**: Netlify Functions (Node >=22 + esbuild), librerie versionate esattamente (`@supabase/supabase-js@2.110.8`, `nodemailer@9.0.3`, `busboy`, `pdfkit`)
- **Database**: Supabase Postgres (Auth + Storage + RLS + RPC + Trigger), 9 bucket Storage (`moduli-template` pubblico + 8 privati con signed URL on-demand)
- **Email**: Gmail SMTP via nodemailer + template DB (`email_template` + `email_log`)
- **SMS transactional**: Smshosting REST API (consensi privacy via OTP — vedi `docs/SMSHOSTING_SETUP.md`)
- **Hosting**: Netlify (static + functions + cron schedules)

## Struttura cartelle

| Cartella / File | Cosa contiene |
|---|---|
| `index.html` | Login Supabase Auth |
| `dashboard.html` | Home con tabs Vendita / Post-Vendita + topbar con bottoni Ticket / Call Center / **Admin** (visibile solo se `ruolo='admin'`) + badge ticket aperti |
| `admin.html` | **Hub Admin Mirox** — 4 card (Gestione Utenti, Configurazione Call Center, Catalogo Vendita, Gare & Avanzamento). Accesso ristretto a `ruolo='admin'` |
| `admin-utenti.html` | Gestione utenti: ruoli admin/operatore, abilita/disabilita, permessi granulari Call Center, flag `in_gara`, colonna **Alias di** (unifica due account della stessa persona con backfill guidato del pregresso). Solo admin |
| `admin-call-center-config.html` | Orari, blocchi e parametri di sistema del Call Center (spostata da `moduli/call-center/configurazione.html`). Solo admin |
| `admin-vendita-config.html` | CRUD cataloghi (categorie, offerte, opzioni, reload, regole documenti). Solo admin |
| `admin-gare.html` | Configurazione **Gare & Avanzamento** — metriche, obiettivi mensili per operatore, editor compenso a scaglioni + bonus, duplica dal mese precedente, flag operatori "in gara". Solo admin |
| `moduli/` | 16 pagine funzionali Vendita / Post-Vendita (`apri_chiudi`, `switch_sim`, `ordini_smartphone`, `dispositivi_comodato`, `gestione_rimborsi`, `segnalazioni`, `simulatore_protecta`, `storico_cliente`, `ticket`, `verifica_contratti`, `controllo_fissi`, `controllo_lg`, `controllo_assicurazioni`, `controllo_allarmi`, `dashboard_pezzi` (3 tab: Day by Day + Gare Individuali + Avanzamento Mensile), `upload-contratti-vendita`) |
| `moduli/call-center/` | **Modulo Call Center integrato (Fase 1)** — 11 pagine (`registra-chiamata`, `elenco-chiamate`, `rilavorazione`, `appuntamenti`, `appuntamenti-oggi`, `prenota-interno`, `esiti-appuntamenti`, `blacklist`, `call-center-lead-outbound`, `prenota-interno-outbound`, `registra-chiamata-outbound`) + `prenota.html` (form pubblico). La pagina `configurazione` è stata spostata sotto Admin Mirox (`admin-call-center-config.html`). Vedi sezione "Modulo Call Center" sotto e [CLAUDE.md](CLAUDE.md) per i dettagli di coordinamento col CC prod |
| `js/` | Librerie condivise: `config`, `auth`, `mirox-ui`, `mirox-safe` (escape HTML, URL/ID/colori sicuri), `mirox-storage`, `mirox-storage-upload`, `mirox-api`, `mirox-upload`, `mirox-folder`, `mirox-mailer`, `mirox-error-reporter`, `anagrafica-helper`, `vendita-storage-helper` |
| `css/` | `style.css`, `mirox-modules.css` |
| `assets/` | Logo, favicon |
| `netlify/functions/` | Endpoint server-side (vedi sotto) |
| `netlify/functions/_lib/` | Helper condivisi (`mailer`, `require-auth`, `smshosting`, `privacy-config`, `pdf-consenso`) |
| `tests/` | Test automatici Node (`node:test`): regressioni vendita, sicurezza/XSS, PDF privacy, sintassi e link locali |
| `database/` | Migrazioni SQL storiche **parziali** — vedi `database/README.md` |
| `netlify.toml` | Config Netlify, header di sicurezza (CSP/HSTS/Permissions-Policy) e cron |
| `package.json` | Dipendenze Node delle functions |
| `CLAUDE.md` | Mappa completa per AI assistants (architettura, schema, regole di business, convenzioni) |

### Netlify Functions

Tutte le functions, eccetto i due cron Netlify e l'endpoint anon intenzionale `public-prenota`, richiedono `Authorization: Bearer <jwt>` valido — il client usa `MiroxApi.fetch()` che lo inietta automaticamente dalla sessione Supabase.

| Function | Metodo | Auth | Scopo |
|---|---|---|---|
| `vendita-config` | GET | authenticated | Carica catalogo per il wizard contratti |
| `admin-vendita-config` | GET / POST | **admin** | CRUD admin del catalogo |
| `crea-vendita-pratica-carrello` | POST | authenticated | Crea pratica + N contratti in stato provvisorio `bozza`, promuove i PDA e supporta le action idempotenti `finalize` / `rollback_upload_failure`. L'operatore viene sempre ricavato dal JWT. Per cluster `Turista` salva `cluster_cliente='Turista'` sui contratti, usa `Consumer` su `anagrafica` e non richiede email |
| `upload-vendita-documento` | POST multipart | authenticated | Upload di PDF reali su `contratti-vendita` (anche staging `temp/<sess>/`). Verifica proprietà operatore/admin sulle bozze; sulle pratiche inviate consente la gestione da Verifica Contratti. Valida coerenza pratica/anagrafica/contratto, deriva il path dalla pratica e attribuisce l'upload all'utente autenticato |
| `upload-documento-modulo` | POST multipart | authenticated | Upload server-side per i bucket operativi Apri/Chiudi, Switch SIM, Comodato, Rimborsi, Protecta e Segnalazioni. Accetta solo PDF reali max 20 MB, valida bucket/path tramite allowlist e registra l'operatore JWT nei metadati Storage |
| `gestisci-vendita-contratto` | POST | authenticated | Aggiornamento/verifica/riapertura dei contratti e rimozione allegati. Accetta soltanto campi consentiti, deriva snapshot e punteggi dal catalogo e usa l'identità JWT per `controllato_da` |
| `elimina-vendita-contratto` | POST | **admin** | Eliminazione definitiva da Verifica Contratti: cancella il contratto, i record collegati, gli allegati Storage e la pratica se resta vuota |
| `ocr-pda` | POST multipart | authenticated | OCR del PDA (Pratica di Adesione PDF) via Claude API — pre-compila l'anagrafica. In caso di errore Anthropic ritorna `error_code` strutturato (`ocr_credit_exhausted`, `ocr_rate_limited`, `ocr_unavailable`, `ocr_auth_error`, `ocr_generic_error`) per popup mirato lato client |
| `search-anagrafica` | GET | authenticated | Ricerca cliente per CF/PIVA |
| `mirox-send-email` | POST | authenticated | Invio email con template DB |
| `cron-rientro-sim` | scheduled | nessuna (cron Netlify) | Notifica giornaliera rientro SIM |
| `cron-pulizia-operativa` | scheduled | nessuna (cron Netlify) | Scade OTP pending, elimina contatori rate-limit scaduti e rimuove bozze vendita oltre 24 ore con relativi PDF |
| `public-prenota` | GET / POST | nessuna (form pubblico) | Endpoint per `prenota.html`: rate limit persistente su Postgres e POST atomica tramite RPC con lock e nuovo controllo dello slot nella stessa transazione |
| `garantisci-anagrafica` | POST | authenticated | Upsert anagrafica (lookup CF/PIVA, update campi vuoti / cambiati o insert). Usato dal wizard prima della raccolta consenso; per `Turista` salva `Consumer` su `anagrafica` e non richiede email |
| `check-consenso-privacy` | GET | authenticated | Dedupe 24 mesi: cerca per `anagrafica_id` una dichiarazione confermata, non scaduta, non revocata e riferita a una delle due versioni correnti (cartacea/digitale) |
| `richiedi-otp-privacy` | POST | authenticated | Richiede la scelta esplicita ACCONSENTO/NON ACCONSENTO, genera OTP 6 cifre, salva hash+salt e invia SMS via Smshosting. Rate-limit 3 invii/ora per anagrafica + cooldown 60s |
| `verifica-otp-privacy` | POST | authenticated | Verifica OTP (max 3 tentativi), genera il PDF informativa/dichiarazione con scelta marketing ed evidenze probatorie, lo archivia e imposta `valido_fino_al = now()+24 mesi` |
| `genera-pdf-consenso-cartaceo` | GET | authenticated | Stream del modulo cartaceo v6 precompilato: una pagina A4, monocromatico, corpo 10 pt, scelta marketing già marcata e riga firma |
| `upload-consenso-cartaceo` | POST multipart | authenticated | Upload scansione firmata (max 20 MB, PDF); richiede l'esito ACCONSENTO/NON ACCONSENTO e crea il record `'cartaceo'` confermato |

### Regole di integrità vendita

- **Punto vendita**: `9001415852` = Legnago, `9000822241` = Cerea. Il valore selezionato/OCR viene propagato dal carrello al backend. Day by Day e Avanzamento Mensile contano solo Legnago; Gare Individuali conta entrambi i negozi.
- **Reinserimenti**: un contratto può essere marcato come reinserimento solo rispetto a un contratto dello stesso cliente, stessa categoria, **stesso mese solare Europe/Rome** e stato post-vendita idoneo. La regola è verificata sia nel wizard sia server-side.
- **Invio documenti**: la pratica nasce `bozza`; diventa `inviata` soltanto dopo tutti gli upload. Se un documento fallisce, il rollback compensativo elimina pratica incompleta, contratti e file già caricati; il cron giornaliero recupera eventuali bozze orfane oltre 24 ore.
- **Identità**: `operatore_id` e `uploaded_by` derivano sempre dal JWT autenticato. Le conferme sensibili (rimborso manuale e stato KO Apri/Chiudi) richiedono la password dell'account corrente verificata da Supabase; non esistono password operative nel sorgente.
- **Scritture protette**: il browser non ha policy INSERT/UPDATE/DELETE sui bucket dati, né INSERT/DELETE su `vendita_documenti` o UPDATE su `vendita_contratti`. Upload, rimozioni e verifica passano dalle Netlify Functions autenticate.
- **Informativa CRM**: le versioni correnti sono `v6_2026_07_26` (cartacea, una pagina A4 in bianco e nero con corpo 10 pt e scelta marketing già marcata) e `v6_2026_07_26_dig` (digitale OTP, tre pagine con ACCONSENTO/NON ACCONSENTO esplicito). La ragione sociale del Titolare è riportata nella forma esatta `KONA TECH SRL`. La scelta binaria è obbligatoria prima del download cartaceo o dell'invio OTP, mentre il consenso marketing resta facoltativo. Finalità, basi giuridiche, conservazione e perimetro del consenso sono equivalenti; i ricontatti di servizio restano separati dal marketing. Le versioni precedenti rimangono evidenza storica ma non vengono riutilizzate.
- **Sicurezza frontend**: tutti gli script CDN sono versionati e protetti da SRI; `MiroxSafe` codifica i dati dinamici; Netlify invia CSP, HSTS e Permissions-Policy. La CSP mantiene temporaneamente `'unsafe-inline'` perché le pagine statiche legacy contengono ancora script e handler inline.

## Setup locale

```bash
npm install
npm test          # suite di regressione + sintassi JS/HTML + link locali
npx netlify dev   # serve frontend + functions su http://localhost:8888
```

Per le functions in locale servono le env vars (vedi sotto). Mettile in un file `.env` nella root o passale a `netlify dev`.

## Deploy Netlify

- **Netlify site**: `mirox-crm` (rinominato il 2026-07-02 in coerenza col repo GitHub `mirkopiasenti/mirox-crm`)
- **Production URL**: [`mirox-crm.it`](https://mirox-crm.it) (custom domain, dal 2026-06-29). Qui sono configurate tutte le env vars (Supabase, Smshosting, Anthropic, SMTP)
- Vecchio URL di test `test-upload-contratti-konahub.netlify.app` non è più aggiornato — deprecato
- **NON confondere** con `mirox-crm.netlify.app`: è un altro Netlify site, di un altro repo GitHub, che ospita il Call Center prod. Condivide solo il DB Supabase

Setup:
1. Repo già collegato su Netlify (site `mirox-crm`)
2. Le build settings vengono lette da `netlify.toml` (base directory vuota, il contenuto sta in root del repo)
3. Imposta le env vars nel pannello Netlify (sezione Site settings → Environment variables)
4. Deploy automatico al `git push origin main`

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

Dettagli e regole complete in [`AGENTS.md`](AGENTS.md); [`CLAUDE.md`](CLAUDE.md) resta sincronizzato per compatibilità con eventuali sessioni Claude Code.

## Env vars Netlify

| Variabile | Obbligatoria | Note |
|---|---|---|
| `SUPABASE_URL` | sì | `https://lbgwamhjkjjfwgusafbi.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | sì | Service role key (NON la anon/publishable — solo lato server) |
| `ANTHROPIC_API_KEY` | sì | Chiave Claude API per la function `ocr-pda` (estrazione AI dati dal PDA) |
| `SMTP_USER` | sì | Account Gmail mittente |
| `SMTP_PASS` | sì | App Password Gmail |
| `SMSHOSTING_API_KEY` | sì (per consensi OTP) | Username API Smshosting (vedi `docs/SMSHOSTING_SETUP.md`) |
| `SMSHOSTING_API_SECRET` | sì (per consensi OTP) | Password API Smshosting |
| `SMSHOSTING_SENDER` | no | Mittente alfanumerico SMS, max 11 caratteri. Default `MIROX`. Va dichiarato in fase di setup account Smshosting |
| `SMSHOSTING_SIMULATE` | no | `true` per attivare modalità simulazione (logga SMS senza inviarlo). Utile per test dev senza spendere credito |
| `NOTIFICA_RIENTRO_TO` | no | Default `info@konatech.it` |
| `MAIL_FROM_NAME` | no | Default `Mirox CRM` |

## Modulo Call Center (integrato, Fase 1)

A partire dal 2026-06-20 il progetto Call Center — fino a quel momento deployato a parte su `mirox-crm.netlify.app` — è integrato dentro Mirox Completo in `moduli/call-center/`. L'integrazione è **additiva**: il deploy CC esistente continua a funzionare invariato (entrambi puntano allo stesso project Supabase `lbgwamhjkjjfwgusafbi`).

### Cosa c'è in `moduli/call-center/`

11 pagine portate dal CC + i loro asset (`js/`, `css/`, `assets/`):

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
- Chiavi permessi riutilizzate identiche al CC prod: `registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`. La vecchia chiave `configurazione` resta in DB per compatibilità col CC prod ma non è più usata da Mirox (la configurazione CC è sotto Admin, gated dal ruolo)
- Dentro ogni pagina CC: bottone arancione "← Torna alla dashboard Mirox" in cima

## Pannello Admin Mirox

Dal 2026-06-24 il bottone **Admin** della topbar dashboard è attivo per gli utenti con `ruolo='admin'` e porta a [`admin.html`](admin.html), hub che raccoglie:

- **Gestione Utenti** ([`admin-utenti.html`](admin-utenti.html)) — tabella `profili`: cambio ruolo admin↔operatore, abilita/disabilita, modale permessi granulari Call Center, flag `in_gara`. Un admin non può togliere il proprio ruolo né disabilitarsi
- **Configurazione Call Center** ([`admin-call-center-config.html`](admin-call-center-config.html)) — orari settimanali, blocchi/chiusure, parametri di sistema (durata slot, anticipo, scadenze). Spostata da `moduli/call-center/configurazione.html` (eliminata)
- **Catalogo Vendita** ([`admin-vendita-config.html`](admin-vendita-config.html)) — CRUD categorie/offerte/opzioni/reload. Ora gated dal ruolo `admin` (prima era protetto da una password client-side `1234`, rimossa)
- **Gare & Avanzamento** ([`admin-gare.html`](admin-gare.html)) — configura metriche + obiettivi mensili per operatore + regole compenso a scaglioni + bonus una tantum. Bottone "Duplica dal mese precedente" per ripartire velocemente ad ogni cambio gara. Alimenta le tab "Gare Individuali" e "Avanzamento Mensile" del modulo `dashboard_pezzi`

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
- **Fase 4.1** (eseguita): rilassamento RPC + auto-chiusura eventi CC. Migration `027`
  - RPC livello 1 ora copre anche appuntamenti FUTURI confermati fino a 30 giorni (cliente che arriva in anticipo)
  - RPC livello 2 rilassato: include chiamate `passa_in_negozio`/`passa_a_cerea` anche con `passaggio_stato='in_attesa'` (non solo `'passato'`)
  - **Trigger `trg_vendita_pratica_auto_chiudi_cc`** su `vendita_pratiche AFTER INSERT`: quando si crea una nuova pratica per anagrafica, gli appuntamenti futuri non gestiti della stessa anagrafica vengono `annullati` automaticamente e le chiamate in rilavorazione vengono `completate/chiuse`. Così il cliente sparisce dalle code CC senza rischio di essere ricontattato dopo aver già firmato
  - Wizard al submit valorizza `vendita_pratiche.appuntamento_id` / `chiamata_id` con l'evento auto-rilevato (FK esistenti da schema legacy ora riempite)

### Fasi successive previste

- **Fase 5** (debito tecnico): refactor profondo pagine CC a `MiroxUI.*` / `AnagraficaHelper.cercaOcrea` (rimuovere `Utils.toast`, `alert/confirm` nativi, `db.from('anagrafica').insert(...)` diretto)
- **Estensioni Fase 4**: bottoni "Inizia vendita" anche in `registra-chiamata.html` (dopo passa-in-negozio), `esiti-appuntamenti.html` (prima di esitare), `rilavorazione.html` (tab Passa Negozio/Cerea) — da fare on-demand quando si ha bisogno

## Error reporting via email (dal 2026-06-25)

Sistema centralizzato di notifica errori tecnici. Ogni errore "hard" del CRM (rete, OCR, submit pratica, eccezioni JS non gestite) genera:

1. **Popup utente** con messaggio chiaro + pillola arancione "Orario errore: GG/MM/AAAA HH:MM:SS" (Europe/Rome con secondi)
2. **Email automatica** al proprietario (`mirko.piasenti@gmail.com`) con metadata (livello, sorgente, utente, pagina, browser), dettagli tecnici e contesto JSON

Componente: `js/mirox-error-reporter.js` → `window.MiroxErrorReporter`. Trasporto: `mirox-send-email` con HTML inline. Throttling 60s per fingerprint (stessa sorgente+livello+messaggio) per evitare flood. Livelli: `critical` / `error` / `warning` / `info`.

**OCR — gestione credito esaurito**: `ocr-pda.js` ritorna `error_code='ocr_credit_exhausted'` quando Anthropic risponde con "credit balance is too low". Il wizard upload contratti mostra un popup esplicito "OCR non disponibile — Credito API esaurito. Procedi con l'inserimento manuale" + invia mail livello `critical`. Stessa logica per rate limit (429), 5xx, auth error.

**Pagine integrate al 2026-06-25** (31 pagine: tutte tranne `index.html`, `moduli/segnalazioni.html` e `moduli/call-center/prenota.html`):

- Root: `dashboard`, `admin`, `admin-utenti`, `admin-vendita-config`, `admin-call-center-config`
- Vendita / Post-Vendita: `upload-contratti-vendita` (integrazione completa con popup OCR mirato per credito esaurito), `apri_chiudi`, `switch_sim`, `ordini_smartphone`, `simulatore_protecta`, `dashboard_pezzi`, `storico_cliente`, `dispositivi_comodato`, `gestione_rimborsi`, `verifica_contratti`, `controllo_fissi`, `controllo_lg`, `controllo_assicurazioni`, `controllo_allarmi`, `ticket`
- Call Center: tutte tranne `prenota.html` (anon pubblica)

Sulle 30 pagine batch è installato solo l'handler globale (`window.error` + `unhandledrejection`), che cattura tutti gli errori JS non gestiti. Per mail mirate su catch specifici si segue il pattern del wizard upload-contratti (vedi `CLAUDE.md` per dettagli).

Dettagli operativi: vedi [CLAUDE.md](CLAUDE.md) sezione "Sistema di error reporting via email".

## Aggiornamenti UI e comunicazioni (dal 2026-07-02)

- `moduli/dashboard_pezzi.html`: la griglia giornaliera usa larghezze fisse compatte per offerte e operatori, con colore pieno sulla cella come nel foglio originale. La tabella e' fissata a 622px totali (270px offerte + 4 colonne da 88px) per evitare espansioni a tutta pagina.
- `moduli/upload-contratti-vendita.html`: dopo l'invio riuscito di una pratica, il wizard mostra il successo e torna automaticamente alla Home Vendita (`dashboard.html`).
- `moduli/upload-contratti-vendita.html` + functions vendita: per cluster `Turista` il wizard nasconde email/provincia/comune/via/civico, forza categoria/offerta dedicate e non blocca piu' l'avanzamento chiedendo provincia, opzione o email; la pratica resta `Turista`, mentre l'anagrafica condivisa viene salvata come `Consumer`.
- `moduli/verifica_contratti.html`: nel popup dettaglio contratto e' presente il tasto "Elimina definitivamente". Gli operatori lo vedono disabilitato; gli admin possono usarlo con doppia conferma. La cancellazione passa dalla function admin-only `elimina-vendita-contratto`.
- `moduli/verifica_contratti.html`: aggiunto filtro `Giorno` nelle tab Da Verificare e Verificati per isolare i contratti caricati in una data specifica.
- `moduli/verifica_contratti.html`: per i contratti Fisso il popup dettaglio mostra anche la convergenza scelta, accanto al prezzo di vendita Fisso.
- `js/mirox-upload.js`: prima di accettare un PDF selezionato o trascinato apre un popup di anteprima con `X` per rimuovere il file e `Conferma` per mantenerlo. La regola vale per Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato.
- Favicon Mirox standard (`assets/favicon.png`) allineata sulle pagine HTML che ne erano prive.
- I bottoni delle email di comunicazione basate su template (segnalazioni, rientro Switch SIM, ordini smartphone) puntano a [`https://www.mirox-crm.it`](https://www.mirox-crm.it). Le mail tecniche di errore restano escluse.

## Schedulazioni

- `cron-rientro-sim`: ogni giorno alle **07:00 UTC** (09:00 ora italiana estate / 08:00 inverno). Cerca pratiche `vendita_switch_sim` con `giorno_rientro = oggi` e `mail_rientro_inviata_at IS NULL`, invia notifica via template `rientro_sim`, imposta `mail_rientro_inviata_at = now()`.
- `cron-pulizia-operativa`: ogni giorno alle **02:30 UTC**. Scade gli OTP pending oltre termine, elimina i contatori del rate limit pubblico scaduti e recupera fino a 100 pratiche `bozza` più vecchie di 24 ore cancellando prima i PDF Storage e poi la pratica.

## Link utili

- Dashboard Supabase: <https://supabase.com/dashboard/project/lbgwamhjkjjfwgusafbi>
- Mappa completa progetto (per AI e per chi vuole dettagli): [`CLAUDE.md`](CLAUDE.md)
- Stato file SQL nella cartella `database/`: [`database/README.md`](database/README.md)
- Revisione privacy tecnica e punti da validare: [`docs/PRIVACY_LEGAL_REVIEW_2026-07-26.md`](docs/PRIVACY_LEGAL_REVIEW_2026-07-26.md)
- Audit XSS/infrastruttura e limite CSP residuo: [`docs/SECURITY_XSS_AUDIT_2026-07-26.md`](docs/SECURITY_XSS_AUDIT_2026-07-26.md)

## Note

- Le credenziali pubbliche (URL Supabase + publishable key) vivono in `js/config.js` come unica sorgente di verità
- L'autenticazione passa per `profili.attivo`: utenti disattivati non entrano
- Esiste un secondo progetto **Call Center** non incluso in questo repo che condivide lo stesso database Supabase. Vedi `CLAUDE.md` per i boundaries delle tabelle condivise.

## Manutenzione

Ogni modifica al progetto deve essere riflessa in `README.md`, `CLAUDE.md` e `database/README.md` **nella stessa sessione/PR** in cui avviene la modifica. Niente "lo aggiorno dopo" — è così che `README_UNIFICATO.txt` (il file che questo README ha sostituito) era diventato obsoleto.

Vedi la sezione "Manutenzione di questa guida" in [`CLAUDE.md`](CLAUDE.md) per la **tabella completa dei trigger** (cosa aggiornare quando cambia cosa) e il self-check di fine task.
