# KONA AI Guardian — produzione e confini operativi

## Ambiente operativo

Dal 05/10/2026 il proprietario ha eliminato il vecchio ambiente Guardian e
autorizza sviluppo, collaudo e rilascio direttamente sul CRM ufficiale:
`mirox-crm.it`, branch `main`, Supabase `lbgwamhjkjjfwgusafbi`, bot
`@MiroxAiGuardianBot`, GitHub Environment `guardian-production`.
Non creare un secondo ambiente e non utilizzare quello del Call Director.
Le protezioni generiche della build per branch diverse da main restano valide.

Le migration server-only `065`–`068` sono applicate. La migration additiva
`20261005110504_guardian_owner_conversation.sql` e' applicata e verificata il
05/10/2026: JSONB NOT NULL default array vuoto, RLS attiva, nessun grant modificato
e nessuna tabella CRM/Call Center alterata. Il bootstrap storico in
`database/staging/` e' un artefatto dismesso: non applicarlo al database operativo.

## Dialogo e analisi

La chat privata del proprietario accetta testo e vocali anche senza ticket e su
richieste archiviate. Conversa in italiano naturale, conserva paragrafi e gli
ultimi 30 messaggi nella sessione server-only. Citare un codice KG o rispondere a
una notifica seleziona il caso; comandi e pulsanti sono scorciatoie. Il contesto
include gli esiti recenti del worker. Parlare non crea ticket ne' esegue azioni.
La raccolta CRM degli operatori resta guidata, autenticata e limitata alle proprie
richieste; il proprietario e' l'unico interlocutore Telegram autorizzato.

Responses API gestisce dialogo/raccolta; Audio Transcriptions i vocali conclusi.
Non e' una chiamata audio live. Il worker Codex separato legge il repository e
produce una diagnosi; la chat ragiona soltanto sul contesto effettivamente fornito.

## Affidabilita' del worker

Una analisi automatica per segnale/release evita retry perpetui. Un guasto di
chiave/modello/quota sospende i dispatch automatici fino a una successiva analisi
manuale riuscita; i segnali sono conservati. Claim condizionali di segnale/outbox
evitano duplicati concorrenti. Anche le scansioni senza segnale notificano l'esito.
Un risultato tardivo non riapre un caso archiviato.

Il preflight verifica autenticazione/accesso modello, non credito o inferenza.
Gli errori sono codici chiusi senza chiavi/log grezzi. Il workflow fallisce dopo
il callback negativo. Il modello viene dal contratto di esecuzione; prompt/schema
del control plane sono preservati prima del checkout di un commit storico.
L'URL worker e' esclusivamente quello production: URL di altri ambienti rifiutate
prima del claim. Diagnosi: [report 05/10](GUARDIAN_DIAGNOSI_2026-10-05.md).

## Patch e verifiche

Analisi e patch partono da `main`. Una patch approvata viene preparata su branch
`codex/kg-*`, verificata con npm e proposta in una PR draft verso `main`.
Il pulsante `Verifica modifica` esegue test del repository sulla branch della
patch e verifica in sola lettura la disponibilita' del sito ufficiale.
Il tipo DB/callback storico `test_staging` e' conservato per compatibilita':
ora identifica questa verifica, non un ambiente separato. Il sito raggiungibile
non dimostra che la patch sia gia' distribuita. La proposta di rilascio riusa
la PR esistente; i workflow non fanno merge automatico.

Per distribuire: autorizzazione del proprietario, test/build/diff, eventuale
migration additiva, push su main, verifica del commit pubblicato da Netlify e
collaudo del comportamento reale. Le tabelle CC condivise mantengono i vincoli
di AGENTS. Questa revisione ha autorizzazione esplicita del 05/10/2026.

## Configurazione

Netlify production custodisce `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OPENAI_API_KEY`, `OPENAI_GUARDIAN_MODEL` (default `gpt-5.6-luna`),
`OPENAI_TRANSCRIBE_MODEL`, `TELEGRAM_GUARDIAN_BOT_TOKEN`,
`TELEGRAM_GUARDIAN_OWNER_CHAT_ID`, `TELEGRAM_GUARDIAN_WEBHOOK_SECRET`,
`KONA_AI_OWNER_PROFILE_ID`, `GUARDIAN_WORKER_SECRET`, `GUARDIAN_GITHUB_TOKEN`,
`GUARDIAN_GITHUB_REPOSITORY`, `GUARDIAN_OBSERVER_ENABLED`,
`GUARDIAN_OBSERVER_DAILY_BUDGET`, `GUARDIAN_OBSERVER_MODEL`,
`GUARDIAN_OBSERVER_REF` (`main`), `GUARDIAN_OBSERVER_WEEKLY_SCAN` e
`GUARDIAN_TELEMETRY_HASH_SECRET`. `MIROX_DEPLOY_ENV` e' `production`.
La precedente `GUARDIAN_STAGING_BRANCH` non viene piu' letta dal codice:
la base operativa e' `main`. Nessun segreto va nel browser, repository o log.

GitHub Environment `guardian-production`: URL del worker production e relativo
HMAC. Secret repository `OPENAI_API_KEY_CODEX_WORKER`: chiave OpenAI del worker,
distinta da `OPENAI_API_KEY` della chat Netlify; aggiornata il 05/10/2026 con
autorizzazione esplicita e verificata con Responses. Tutti i dispatch hanno
`target_environment=production`. I workflow devono essere presenti su `main`.

## Configurazione Telegram

1. usare il bot ufficiale `@MiroxAiGuardianBot`;
2. avviare una chat privata con il bot e ricavare il proprio `chat_id` tramite l'API `getUpdates` durante il setup;
3. generare un segreto casuale lungo e salvarlo come `TELEGRAM_GUARDIAN_WEBHOOK_SECRET`;
4. registrare il webhook production con una richiesta equivalente a:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://mirox-crm.it/.netlify/functions/guardian-telegram-webhook","secret_token":"<SEGRETO>"}'
```


Il webhook rifiuta richieste prive del secret token e ignora qualunque chat diversa da `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`.

Comandi disponibili:

- `/richieste` elenca problemi e migliorie aperti (`/incidenti` resta un alias compatibile);
- `/salute` mostra a Mirko il checkpoint e i contatori tecnici dell'Observer (coda, esecuzioni, notifiche e segnali), senza esporre dati CRM;
- `/apri KG-000001` imposta la richiesta attiva;
- `/nuovo descrizione` crea un problema direttamente da Telegram;
- `/nuovo_miglioria descrizione` crea una proposta di miglioria;
- messaggi e vocali normali proseguono il dialogo generale o la richiesta indicata; nessuna richiesta attiva e' necessaria.

## Approvazioni e limiti

Solo Mirko puo' approvare azioni. Gli operatori possono esclusivamente creare un problema o una miglioria e rispondere alle domande di raccolta.

| Azione | Stato prima versione | Approvazione |
|---|---|---|
| Raccolta guidata CRM | attiva | non richiesta, e' solo conversazione |
| Analisi Guardian sui dati della richiesta | attiva | pulsante Telegram di Mirko |
| Approva lavorazione (`prepara_fix` → `fix_approvato`) | attiva, avvia il workflow patch su branch di lavoro | pulsante Telegram di Mirko |
| Archiviazione richiesta | attiva | pulsante Telegram di Mirko |
| Analisi Codex del repository | collegata come workflow read-only | obbligatoria |
| Preparazione patch e test della branch | collegati come workflow separati | obbligatoria e separata |
| Proposta di rilascio production | pull request draft, senza merge | conferma manuale di Mirko |
| Deploy produzione | non eseguito dal Guardian | merge esplicito fuori dal bot e controlli CI |

I dettagli tecnici hanno una data obiettivo di scadenza a 90 giorni. Il riepilogo della richiesta e l'audit delle approvazioni restano permanenti. `cron-pulizia-operativa` azzera dopo la scadenza percorso pagina, titolo pagina, user agent e contesto client; non elimina conversazioni, riepiloghi, commit o pull request.

Verifica runtime Guardian: workflow manuale `guardian-healthcheck.yml` su main,
Environment production, action `health` del worker protetta da HMAC. Controlla
Responses con testo sintetico senza dati CRM, identita' bot/webhook via GET e
accessibilita' memoria DB. Non invia messaggi Telegram, non modifica dati o
configurazioni e restituisce soltanto esiti/codici chiusi; nessuna chiave o log.
