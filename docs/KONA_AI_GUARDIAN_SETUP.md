# KONA AI Guardian — setup e confini operativi

## Stato della prima versione

La prima versione realizza un unico agente, senza gerarchie:

- gli utenti autenticati aprono `Segnala Problema` dalla dashboard e descrivono il problema in chat;
- Guardian fa domande brevi finche' la segnalazione e' utilizzabile;
- l'incidente viene registrato in tabelle Supabase server-only e notificato nella chat Telegram privata di Mirko;
- Mirko puo' usare testo o messaggi vocali, aprire un incidente, chiedere un'analisi Guardian e archiviarlo;
- analisi e archiviazione partono solo dopo un pulsante di approvazione Telegram e lasciano audit nel database;
- le email tecniche automatiche sono rimosse; `mirox-send-email` e tutte le email operative restano attivi.

Questa versione non legge ancora il repository e non modifica codice. L'analisi Guardian distingue espressamente fatti, ipotesi e verifiche mancanti. Codex verra' collegato come esecutore separato soltanto dopo la validazione del flusso in staging: prima analisi read-only, poi proposta di patch, test e pull request; mai rilascio diretto in produzione.

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
2. creare un nuovo sito Netlify collegato al repository, senza custom domain di produzione;
3. configurare sul sito staging `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MIROX_DEPLOY_ENV=staging`, `MIROX_PUBLIC_SUPABASE_URL` e `MIROX_PUBLIC_SUPABASE_ANON_KEY` del nuovo progetto;
4. applicare una sola volta `database/staging/001_guardian_bootstrap.sql`, poi `database/065_kona_ai_guardian.sql` (completato il 2026-08-10);
5. usare la branch `codex/kona-ai-guardian-staging` e verificare che il workflow `.github/workflows/ci.yml` sia verde;
6. creare soltanto l'utente Mirko; nessun altro account KONA AI in questa prima fase e nessun dato cliente reale;
7. configurare OpenAI e Telegram solo sul sito staging;
8. provare creazione, domande, notifica, vocale, analisi e archiviazione prima di valutare la produzione.

La migration `065` e' additiva e non modifica le tabelle Call Center condivise. E' stata applicata il 2026-08-10 soltanto al progetto staging `blwgxrszvsoqcmcmhhqr`; non e' stata applicata a production.

Il bootstrap staging si interrompe se trova anche una sola tabella nello schema `public`: questa guardia lo rende inadatto e non eseguibile sul production gia' popolato. Crea soltanto `profili`, senza utenti Auth e senza dati CRM; l'utente Mirko viene aggiunto separatamente dopo lo schema.

La build tratta automaticamente ogni branch Netlify diversa da `main` come staging e impedisce di forzarla a `production` tramite env var; simmetricamente, `main` non puo' essere forzata a staging. Se le variabili frontend dedicate mancano, se l'URL punta al project ref produzione o se viene passata una service role/secret key, il deploy si interrompe prima di pubblicare file. Anche la CSP viene generata con il solo host Supabase staging.

## Variabili Netlify

| Variabile | Uso |
|---|---|
| `MIROX_DEPLOY_ENV` | Deve valere `staging` nel sito Guardian |
| `MIROX_PUBLIC_SUPABASE_URL` | URL pubblico Supabase staging usato dal browser |
| `MIROX_PUBLIC_SUPABASE_ANON_KEY` | Publishable/anon key Supabase staging; mai service role |
| `OPENAI_API_KEY` | Responses API e trascrizione vocali; solo lato server |
| `OPENAI_GUARDIAN_MODEL` | Modello conversazionale. Default `gpt-5.6-luna` |
| `OPENAI_TRANSCRIBE_MODEL` | Modello di trascrizione. Default `gpt-transcribe` |
| `TELEGRAM_GUARDIAN_BOT_TOKEN` | Token del bot Telegram dedicato a Guardian |
| `TELEGRAM_GUARDIAN_OWNER_CHAT_ID` | Unico `chat_id` autorizzato: quello di Mirko |
| `TELEGRAM_GUARDIAN_WEBHOOK_SECRET` | Segreto casuale inviato da Telegram nell'header del webhook |
| `KONA_AI_OWNER_PROFILE_ID` | UUID del profilo Mirko nel Supabase dell'ambiente |

Non salvare token, chiavi o ID sensibili nel repository. Il bot Guardian deve essere distinto dall'eventuale futuro bot Call Center Coach.

## Configurazione Telegram

1. creare con BotFather un bot dedicato, ad esempio KONA AI Guardian;
2. avviare una chat privata con il bot e ricavare il proprio `chat_id` tramite l'API `getUpdates` durante il setup;
3. generare un segreto casuale lungo e salvarlo come `TELEGRAM_GUARDIAN_WEBHOOK_SECRET`;
4. registrare il webhook staging con una richiesta equivalente a:

```bash
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://<SITO-STAGING>/.netlify/functions/guardian-telegram-webhook","secret_token":"<SEGRETO>"}'
```

Il webhook rifiuta richieste prive del secret token e ignora qualunque chat diversa da `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`.

Comandi disponibili:

- `/incidenti` elenca gli incidenti aperti;
- `/apri KG-000001` imposta l'incidente attivo;
- `/nuovo descrizione` crea un incidente direttamente da Telegram;
- messaggi e vocali normali vengono collegati all'incidente attivo.

## Approvazioni e limiti

Solo Mirko puo' approvare azioni. Gli operatori possono esclusivamente creare una segnalazione e rispondere alle domande di raccolta.

| Azione | Stato prima versione | Approvazione |
|---|---|---|
| Raccolta guidata CRM | attiva | non richiesta, e' solo conversazione |
| Analisi Guardian sui dati dell'incidente | attiva | pulsante Telegram di Mirko |
| Archiviazione incidente | attiva | pulsante Telegram di Mirko |
| Analisi Codex del repository | prevista, non ancora collegata | obbligatoria |
| Preparazione patch e test staging | prevista, non ancora collegata | obbligatoria e separata |
| Deploy produzione | non consentito al Guardian | richiesta esplicita fuori dal bot e controlli CI |

I dettagli tecnici hanno una data obiettivo di scadenza a 90 giorni. Il riepilogo dell'incidente e l'audit delle approvazioni restano permanenti. La cancellazione automatica dei dettagli verra' aggiunta solo dopo aver validato quali campi sono indispensabili per analisi e audit.

## Passo successivo dopo la prova reale

Dopo che raccolta CRM e Telegram sono affidabili:

1. collegare Sentry allo staging con mascheramento dei dati personali e senza session replay iniziale;
2. collegare Codex in modalita' read-only a un workflow isolato;
3. far restituire l'analisi al medesimo incidente;
4. aggiungere una seconda approvazione per creare una branch e una pull request;
5. mantenere test staging e rilascio produzione come autorizzazioni distinte.
