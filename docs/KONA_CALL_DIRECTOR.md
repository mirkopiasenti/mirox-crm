# KONA Call Director — setup e confini operativi

## Stato dell'implementazione

Modulo completo lato codice (lib condivise, Netlify Functions, cron, pagine
operatore/admin, test, migration 072) ma **non ancora attivato**: nessuna
migration applicata, nessun webhook/configurato, nessuna env var production
modificata, nessun deploy. Il codice e' pronto per la review DeepSeek Pro.

KONA Call Director coordina la giornata dell'operatore autorizzato del Call
Center: un contatto alla volta, priorita' note, conferme degli appuntamenti
Business del giorno successivo, ricontatti programmati, gestione "Passa a
Cerea" / "Passa in negozio", campagne urgenti approvate, attivita' standard,
preparazione notturna dei lead Business (arricchimento da fonti pubbliche),
pianificazione quotidiana con Mirko tramite un bot Telegram separato e
integrazione Google Calendar del solo calendario personale di Mirko.

**Vincoli non negoziabili rispettati:**

- nessuna funzionalita' AI blocca il Call Center manuale (tutte le funzioni
  sono additive, il motore di priorita' e' deterministico);
- nessun dato identificativo dei clienti su Telegram;
- nessun dato Consumer identificativo inviato a OpenAI (l'arricchimento web
  usa solo dati pubblici Business gia' presenti in Mirox);
- nessuna chiave, token OAuth, refresh token, credenziale OpenAI o service
  role nel frontend;
- nessun UUID hardcodato (Isabella/Mirko sono derivati da profili abilitati e
  dall'env `KONA_CALL_DIRECTOR_OWNER_CHAT_ID`);
- mai 50 ricerche sequenziali in una funzione (job a lease, batch piccoli);
- nessuna coordinata inventata (`kona_call_director_comuni` va popolata da un
  dataset autorevole, vedi sotto);
- nessun prezzo hardcodato (stime in `kona_call_director_config.prezzi_openai`);
- nessun segreto reale documentato.

## Architettura

- **(A) Motore deterministico** (`_lib/kona-cd-engine.js`): abilitazione
  globale/per-profilo, priorita' 1..7, blacklist e esclusioni ri-verificate
  prima della materializzazione e della vista, lease "un contatto alla volta"
  (indice unico parziale), tentativi max 3 con alternanza mattina/pomeriggio,
  sblocco del successivo solo dopo esito valido.
- **(B) Sandbox OpenAI** (`_lib/kona-cd-openai.js`) usata SOLO per: web search
  Business, estrazione strutturata, valutazione skip "Altro" (l'IA puo'
  contestare una sola volta, decide l'operatrice), proposta piano, analisi di
  giornata, report. Nessuno script telefonico generato. Ogni risposta: Responses API
  server-side, output strutturato JSON strict, validato, trattato come input
  non fidato, istruzioni delle pagine web ignorate, timeout + retry limitato +
  fallback deterministico, modello configurabile, costo loggato.

### Priorita' contatti (1..7)

1. conferma appuntamenti Business del giorno successivo (finestre 09:00 /
   11:30 / 15:30 / 18:00, "top of queue");
2. ricontatti programmati (`chiamate.data_ricontatto <= oggi`);
3. auto non risposti (rilavorazione);
4. "Passa a Cerea";
5. "Passa in negozio";
6. campagne urgenti approvate (lead `pinned`);
7. attivita' standard (sessione Business).

Dopo 4 non risposti sulle conferme: **nessun annullamento automatico**, lo
stato operativo resta invariato e parte una notifica Telegram senza PII.

## Preparazione obbligatoria (da eseguire SOLO dopo la review e l'ok esplicito)

1. **Review DeepSeek Pro** del diff e della migration `072`.
2. **Staging** (obbligatorio): sito Netlify separato + Supabase staging
   (`blwgxrszvsoqcmcmhhqr` gia' esistente per Guardian) + `MIROX_DEPLOY_ENV=staging`.
3. Applicare `database/072_kona_call_director.sql` una sola volta (staging poi
   production, mai in questa sessione).
4. **Dataset coordinate**: `kona_call_director_comuni` e' vuota. Popolare da
   un dataset autorevole (es. catalogo ISTAT + coordinate centroide ufficiali)
   con un import one-shot in `database/imports/`. Le distanze restano
   `null` (banda "unknown") finche' la tabella non e' popolata: nessuna
   coordinata inventata.
5. **Env vars** (vedi tabella sotto) sul sito Netlify `mirox-crm`.
6. **Google OAuth**: creare le credenziali OAuth con redirect su
   `KONA_CALL_DIRECTOR_GOOGLE_REDIRECT_URI`, scope minimi (free/busy + events).
   La connessione si fa dal pannello Admin (nessun token nel frontend).
7. **Bot Telegram** separato: creare il bot, impostare il webhook con
   `KONA_CALL_DIRECTOR_TELEGRAM_WEBHOOK_SECRET`, permettere solo
   `KONA_CALL_DIRECTOR_OWNER_CHAT_ID`.
8. **Progetto OpenAI dedicato**: chiave con budget 50 euro/mese, modello
   configurato, verifica dei prezzi seed in `prezzi_openai`.
9. **Pilot**: attivo_globale nasce `false`; abilitare un profilo alla volta dal
   pannello Admin; prime due settimane in `modalita_osservazione=true`.

## Env vars (nessun valore reale documentato)

| Env var | Uso | Dove |
|---|---|---|
| `KONA_CALL_DIRECTOR_ENABLED` | Kill-switch di sicurezza (`false` = KONA mai attivo) | Netlify |
| `KONA_CALL_DIRECTOR_OPENAI_API_KEY` | Chiave del progetto OpenAI dedicato (fallback `OPENAI_API_KEY`) | Netlify (mai frontend) |
| `KONA_CALL_DIRECTOR_OPENAI_MODEL` | Override modello (default in config DB) | Netlify |
| `KONA_CALL_DIRECTOR_GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | OAuth Google Calendar | Netlify |
| `KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY` | Chiave AES-256-GCM (64 hex) per cifrare il refresh token | Netlify, separata dalle altre |
| `KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN` | Bot Telegram dedicato (separato dal Guardian) | Netlify |
| `KONA_CALL_DIRECTOR_TELEGRAM_WEBHOOK_SECRET` | Secret del webhook (confronto timing-safe) | Netlify |
| `KONA_CALL_DIRECTOR_OWNER_CHAT_ID` | Allowlist chat proprietario (Mirko) | Netlify |
| `KONA_CALL_DIRECTOR_CRON_SECRET` | Segreto opzionale di protezione dell'endpoint cron (timing-safe) | Netlify |
| `KONA_CALL_DIRECTOR_STAGING_RUN` | Opt-in esplicito per eseguire i cron in staging (`true`) | Netlify staging |

## Cron

`netlify.toml`: `[functions."kona-call-director-dispatcher"] schedule = "*/5 * * * *"`.
Idempotente per registro `data+evento`; orologio Europe/Rome (DST-safe).
Sequenza giornaliera: 02:00 arricchimento, 03:30 retention, 08:00 reminder
mattina, 08:30 piano default, 19:10 report + domanda piano, 20:00 reminder
sera, 20:05 proposta piano domani. Grace window 4h e retry limitato. Ogni
tick: materializza i task nelle finestre conferme / orario operativo, processa
job a lease e la coda notifiche Telegram.

## Funzioni

| Function | Auth | Azioni |
|---|---|---|
| `kona-call-director-dispatcher` | cron | orchestratore idempotente |
| `kona-call-director-task` | operatore abilitato | prossimo / attivo / esito / sospendi / riprendi |
| `kona-call-director-status` | operatore | stato, budget, riepilogo giorno |
| `kona-call-director-admin` | admin | interruttori, operatori, config, budget, sospensione |
| `kona-call-director-dialog` | operatore abilitato | valuta skip "Altro", slot Google, appuntamenti Business (nessuno script) |
| `kona-call-director-plan` | operatore | proposta/approva/applica/leggi piano |
| `kona-call-director-google` | admin | connetti (OAuth), stato, disconnetti |
| `kona-cc-google-callback` | pubblico (redirect OAuth) | scambio code, token cifrato |
| `kona-call-director-telegram-webhook` | secret timing-safe + owner | comandi, testo libero, pulsanti e callback_query (piano/approva/categorie), /sospendi /riattiva |

## Privacy e budget

- Telegram: solo aggregati (conteggi, zone, esiti). `sanitizeForTelegram` e
  `cleanLog` rimuovono telefono/email/CF/P.IVA anche nei log.
- OpenAI: mai dati Consumer identificativi. Per i lead Business solo dati
  pubblici aziendali gia' in Mirox.
- Ogni chiamata OpenAI loggata in `kona_call_director_budget_log`; il budget
  mensile (default 50 euro) con riserve arricchimento (40) e dialogo (10):
  un'attivita' non parte se la propria riserva non copre il costo stimato.
- Retention: arricchimenti 180 gg, attivita' 365 gg, aggregati 730 gg.

## Test

`tests/kona-call-director.test.js`: 61 test (suite totale 174+ con le
esistenti). Coprono: tempo DST, validazioni campi, scoring, finestre conferme,
budget/riserve, crypto roundtrip, arricchimento (mai sovrascrivere), retention,
job lease, motore (blacklist/esclusioni/lease/esiti/skip), OpenAI con fetch
mockato (successo/web/503/JSON non valido/no chiave), webhook Telegram
(secret/owner), outbox notifiche, Google slots, piano. I test hanno fatto
emergere 3 bug reali corretti (mancanza `await` nella ri-verifica blacklist,
import errato delle funzioni tempo in openai, ordine dei check nel webhook).

## Checklist DeepSeek Pro

- [ ] migration `072` additiva e reversibile, nessun DROP su oggetti esistenti
- [ ] nessun SECURITY DEFINER ingiustificato, RLS server-only su tutte le tabelle
- [ ] env vars documentate senza valori reali
- [ ] nessun segreto nel frontend (OAuth/OpenAI/service role)
- [ ] `git diff --check` pulito, `npm test` verde
- [ ] nessuna migration applicata / nessun push / nessun deploy (vincolo sessione)
