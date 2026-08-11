# KONA AI Guardian — setup e confini operativi

## Stato della prima versione

La prima versione realizza un unico agente, senza gerarchie:

- gli utenti autenticati aprono l'azione flottante KONA AI Guardian e scelgono `Segnala un problema` oppure `Proponi una miglioria`;
- Guardian fa una domanda breve per volta e al massimo due chiarimenti dopo la descrizione iniziale; poi registra comunque la richiesta;
- la richiesta viene registrata in tabelle Supabase server-only e notificata nella chat Telegram privata di Mirko;
- Mirko puo' usare testo o messaggi vocali, aprire una richiesta, chiedere un'analisi Guardian, approvarne la lavorazione o archiviarla;
- analisi, approvazione lavorazione e archiviazione partono solo da pulsanti Telegram e lasciano audit nel database;
- le email tecniche automatiche sono rimosse; `mirox-send-email` e tutte le email operative restano attivi.

Questa versione non legge ancora il repository e non modifica codice. L'analisi Guardian distingue espressamente fatti, ipotesi e verifiche mancanti. Il collegamento Codex viene aggiunto come esecutore separato: prima analisi read-only, poi proposta di patch, test e pull request; mai rilascio diretto in produzione.

La migration `067_kona_ai_codex_esecuzioni.sql` prepara il registro server-only delle esecuzioni future. In questa fase non avvia workflow, non concede accesso al repository e non cambia il comportamento del bot; deve essere applicata prima sul Supabase staging e verificata con una query di introspezione.

## Architettura scelta

Il progetto usa un modello ibrido:

- **interno al CRM**: identita', incidenti, conversazioni, permessi, audit, Telegram e approvazioni;
- **OpenAI Responses API**: raccolta guidata e ragionamento conversazionale con output strutturato;
- **OpenAI Audio Transcriptions**: trascrizione dei messaggi vocali Telegram gia' conclusi; nessuna conversazione live;
- **Codex**: futura analisi del repository e preparazione delle modifiche in un ambiente isolato, attivata da un'approvazione specifica di Mirko.

La separazione evita che il modello conversazionale possieda credenziali di deploy o possa modificare autonomamente produzione.

## Preparazione obbligatoria dello staging

Non collegare il Guardian direttamente al database condiviso di produzione. Prima del primo test:

1. creare il progetto Supabase `Mirox CRM - Staging` (`blwgxrszvsoqcmcmhhqr`, `eu-west-3`);
2. creare il sito Netlify separato `mirox-crm-staging.netlify.app`, senza custom domain di produzione (completato il 2026-08-10);
3. configurare sul sito staging `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MIROX_DEPLOY_ENV=staging`, `MIROX_PUBLIC_SUPABASE_URL` e `MIROX_PUBLIC_SUPABASE_ANON_KEY` del nuovo progetto (completato il 2026-08-10);
4. applicare una sola volta `database/staging/001_guardian_bootstrap.sql`, poi `database/065_kona_ai_guardian.sql` e infine `database/066_kona_ai_tipologia_richiesta.sql` (tutte completate sullo staging il 2026-08-10);
5. usare la branch `codex/kona-ai-guardian-staging` e verificare che il workflow `.github/workflows/ci.yml` sia verde (completato il 2026-08-10);
6. creare soltanto l'utente Mirko, associarlo a un profilo `admin` e impostare `KONA_AI_OWNER_PROFILE_ID`; l'invito deve atterrare su `imposta-password.html`, dove Mirko sceglie autonomamente la password (account, profilo ed env var completati il 2026-08-10);
7. configurare inizialmente OpenAI e Telegram solo sul sito staging; raccolta, analisi e bot sono stati verificati qui il 2026-08-10;
8. provare entrambi i tipi di richiesta, domande, notifica, vocale, analisi, approvazione lavorazione e archiviazione prima di valutare la produzione.

La prima versione e' stata quindi attivata sul production `mirox-crm.it`: env OpenAI/Telegram e profilo proprietario sono configurati sul Netlify ufficiale, mentre `065` e `066` sono applicate anche al Supabase production `lbgwamhjkjjfwgusafbi`. Le migration sono additive e non modificano le tabelle Call Center condivise. Il bot `@MiroxAiGuardianBot` e' riservato al webhook production; per test Telegram futuri sullo staging serve un secondo bot dedicato.

Il bootstrap staging si interrompe se trova anche una sola tabella nello schema `public`: questa guardia lo rende inadatto e non eseguibile sul production gia' popolato. Crea soltanto `profili`, senza utenti Auth e senza dati CRM; l'utente Mirko viene aggiunto separatamente dopo lo schema.

La build tratta automaticamente ogni branch Netlify diversa da `main` come staging e impedisce di forzarla a `production` tramite env var; simmetricamente, `main` non puo' essere forzata a staging. Se le variabili frontend dedicate mancano, se l'URL punta al project ref produzione o se viene passata una service role/secret key, il deploy si interrompe prima di pubblicare file. Anche la CSP viene generata con il solo host Supabase staging.

Netlify registra comunque le scheduled functions presenti in `netlify.toml`; entrambe le function CRM controllano quindi `MIROX_DEPLOY_ENV` come prima istruzione e, nello staging Guardian, terminano con `skipped` senza collegarsi a Supabase, Storage o SMTP.

## Variabili Netlify

| Variabile | Uso | Ambiente |
|---|---|---|
| `SUPABASE_URL` | URL del progetto Supabase usato dalle Netlify Functions | Valore specifico per production e staging |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key backend; mai frontend o repository | Valore specifico per production e staging |
| `MIROX_DEPLOY_ENV` | Identifica l'ambiente e protegge build e cron | `production` sul sito ufficiale, `staging` sul sito di test |
| `MIROX_PUBLIC_SUPABASE_URL` | URL pubblico Supabase usato dal browser | Necessario sullo staging; production usa la configurazione ufficiale della build |
| `MIROX_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key Supabase; mai service role | Necessaria sullo staging; production usa la configurazione ufficiale della build |
| `OPENAI_API_KEY` | Responses API e trascrizione vocali; solo lato server | Production e staging |
| `OPENAI_GUARDIAN_MODEL` | Modello conversazionale opzionale. Default `gpt-5.6-luna` | Production e staging |
| `OPENAI_TRANSCRIBE_MODEL` | Modello di trascrizione opzionale. Default `gpt-transcribe` | Production e staging |
| `TELEGRAM_GUARDIAN_BOT_TOKEN` | Token del bot Telegram dedicato a Guardian | Un bot distinto per ciascun ambiente |
| `TELEGRAM_GUARDIAN_OWNER_CHAT_ID` | Unico `chat_id` autorizzato: quello di Mirko | Production e staging |
| `TELEGRAM_GUARDIAN_WEBHOOK_SECRET` | Segreto casuale inviato da Telegram nell'header del webhook | Un valore distinto per ciascun ambiente |
| `KONA_AI_OWNER_PROFILE_ID` | UUID del profilo Mirko nel Supabase dell'ambiente | Valore specifico per production e staging |
| `GUARDIAN_WORKER_SECRET` | Firma HMAC tra Netlify e i workflow Codex | Valore distinto per ciascun ambiente; non nel repository |
| `GUARDIAN_GITHUB_TOKEN` | Fine-grained token usato dal dispatcher per `workflow_dispatch` | Solo Netlify server-side; limitato al repository e alle Actions |
| `GUARDIAN_GITHUB_REPOSITORY` | Repository del worker Codex | Default `mirkopiasenti/mirox-crm` |
| `GUARDIAN_STAGING_BRANCH` | Branch base per patch e test | Default `codex/kona-ai-guardian-staging` |

Sul repository GitHub configurare inoltre i secrets `OPENAI_API_KEY_CODEX_WORKER`, `GUARDIAN_WORKER_URL` e `GUARDIAN_WORKER_SECRET`. La chiave OpenAI del worker resta in GitHub Actions e non viene mai inviata a Netlify o al modello conversazionale.

Non salvare token, chiavi o ID sensibili nel repository. Il bot Guardian deve essere distinto dall'eventuale futuro bot Call Center Coach.

## Configurazione Telegram

1. creare con BotFather un bot dedicato, ad esempio KONA AI Guardian; il bot ufficiale e' `@MiroxAiGuardianBot`, mentre per futuri test staging ne serve uno distinto;
2. avviare una chat privata con il bot e ricavare il proprio `chat_id` tramite l'API `getUpdates` durante il setup;
3. generare un segreto casuale lungo e salvarlo come `TELEGRAM_GUARDIAN_WEBHOOK_SECRET`;
4. registrare il webhook production con una richiesta equivalente a:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://mirox-crm.it/.netlify/functions/guardian-telegram-webhook","secret_token":"<SEGRETO>"}'
```

Per lo staging ripetere la configurazione con un secondo bot, credenziali diverse e URL `https://mirox-crm-staging.netlify.app/.netlify/functions/guardian-telegram-webhook`.

Il webhook rifiuta richieste prive del secret token e ignora qualunque chat diversa da `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`.

Comandi disponibili:

- `/richieste` elenca problemi e migliorie aperti (`/incidenti` resta un alias compatibile);
- `/apri KG-000001` imposta la richiesta attiva;
- `/nuovo descrizione` crea un problema direttamente da Telegram;
- `/nuovo_miglioria descrizione` crea una proposta di miglioria;
- messaggi e vocali normali vengono collegati alla richiesta attiva.

## Approvazioni e limiti

Solo Mirko puo' approvare azioni. Gli operatori possono esclusivamente creare un problema o una miglioria e rispondere alle domande di raccolta.

| Azione | Stato prima versione | Approvazione |
|---|---|---|
| Raccolta guidata CRM | attiva | non richiesta, e' solo conversazione |
| Analisi Guardian sui dati della richiesta | attiva | pulsante Telegram di Mirko |
| Approva lavorazione (`prepara_fix` → `fix_approvato`) | attiva, solo registrazione; nessun esecutore | pulsante Telegram di Mirko |
| Archiviazione richiesta | attiva | pulsante Telegram di Mirko |
| Analisi Codex del repository | collegata come workflow read-only | obbligatoria |
| Preparazione patch e test staging | collegati come workflow separati | obbligatoria e separata |
| Proposta di rilascio production | pull request draft, senza merge | conferma manuale di Mirko |
| Deploy produzione | non eseguito dal Guardian | merge esplicito fuori dal bot e controlli CI |

I dettagli tecnici hanno una data obiettivo di scadenza a 90 giorni. Il riepilogo della richiesta e l'audit delle approvazioni restano permanenti. `cron-pulizia-operativa` azzera dopo la scadenza percorso pagina, titolo pagina, user agent e contesto client; non elimina conversazioni, riepiloghi, commit o pull request.

## Passo successivo dopo la prova reale

Dopo che raccolta CRM e Telegram sono affidabili:

1. applicare e verificare sul Supabase staging la migration `067_kona_ai_codex_esecuzioni.sql`;
2. configurare i secrets GitHub e il fine-grained token del dispatcher;
3. testare l'analisi read-only su una richiesta sintetica;
4. testare patch, test staging e pull request draft su una richiesta sintetica;
5. collegare Sentry allo staging con mascheramento dei dati personali e senza session replay iniziale;
6. mantenere test staging e rilascio production come autorizzazioni distinte.
