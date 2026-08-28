# KONA Call Director — stato, setup e attivazione

## Stato verificato

Il modulo e' completo lato codice ed e' stato riesaminato localmente dopo le
correzioni di chiusura. La suite dedicata passa 73/73 test; la suite completa
del CRM passa 189/189 test. La build statica e i controlli di sintassi sono
verdi.

Il Supabase test dedicato `Mirox CRM - Test KONA Call Director`
(`yyorullxmdxhnunsfwwa`, `eu-west-3`) e' attivo e contiene il solo schema
minimo ricostruito senza dati production, la migration `072` e il seed
fail-closed. Le 23 tabelle KONA sono vuote salvo la config; non esistono
profili abilitati e `attivo_globale=false`. Il sito Netlify isolato
`mirox-kona-call-director-test.netlify.app` e' collegato alla branch
`kona-call-director`; il commit staging `b4cf578` con correzioni, test e
bootstrap e' pubblicato con le env staging, la service role protetta del solo
Supabase test e i due interruttori KONA a `false`. L'invocazione HTTP diretta
del dispatcher e' bloccata da Netlify con `403`.
Production non contiene oggetti KONA Call Director e resta invariata.
Il login staging usa una sola policy browser su `profili`: ogni utente
autenticato puo' leggere esclusivamente la propria riga (`id=auth.uid()`);
scritture, altre righe e tabelle KONA restano server-only.
Le pagine Call Center caricano il client Supabase generato dalla build per
l'ambiente corrente; la vecchia configurazione interna fissata al production
e' stata rimossa, quindi la sessione Auth test resta valida entrando dal
dashboard staging.

## Funzione operativa

KONA Call Director coordina l'operatore autorizzato del Call Center con un
solo contatto visibile alla volta. Il motore delle priorita' e' deterministico;
OpenAI e' confinato ad arricchimento Business da fonti pubbliche, valutazione
degli skip, dialogo, proposta del piano e analisi aggregata della giornata.
Non genera script telefonici.

Priorita' operative:

1. conferme degli appuntamenti Business esterni del giorno lavorativo
   successivo, nelle finestre 09:00, 11:30, 15:30 e 18:00;
2. ricontatti programmati;
3. non risposti automatici;
4. Passa a Cerea;
5. Passa in negozio;
6. campagne urgenti approvate;
7. sessione Business standard.

Dopo quattro tentativi di conferma senza risposta non avviene alcun
annullamento automatico: Mirko riceve una notifica Telegram e decide.
Le attivita' Business standard non iniziano dopo le 18:00 e non partono se il
piano approvato non contiene almeno una categoria esplicita; il contatto gia'
in corso puo' essere terminato.

## Garanzie applicate

- Tre interruttori indipendenti: env, globale DB e profilo operatore.
- L'env e' fail-closed: KONA parte soltanto con
  `KONA_CALL_DIRECTOR_ENABLED=true` esplicito.
- Blacklist ed esclusioni sono ricontrollate prima di proporre un contatto;
  in caso di errore la coda si ferma in sicurezza.
- Lease, acquisizione job e prenotazione budget sono atomici.
- La registrazione dei tentativi usa chiavi stabili e impedisce duplicati.
- Il budget OpenAI usa riserve atomiche, conversione USD/EUR configurabile e
  notifiche alle soglie 70/85/95/100%.
- Ogni lead usa al massimo due web search complessive; non esiste retry inline
  automatico che possa raddoppiare un costo incerto.
- Google Calendar viene ricontrollato immediatamente prima della prenotazione;
  create, modifica e annullamento hanno compensazione e riconciliazione.
- Lo stato OAuth e' firmato, scade ed e' consumabile una sola volta.
- Telegram accetta soltanto il bot dedicato, il secret del webhook e il
  `chat_id` del proprietario.
- Telegram e log non ricevono PII; gli appuntamenti privati di Mirko non sono
  mostrati all'operatore, che vede solo le fasce disponibili.
- I dati Consumer identificativi non vengono inviati a OpenAI.
- Le 23 tabelle `kona_call_director_*` sono server-only con RLS e privilegi
  riservati alla service role.

## Prerequisiti esterni

Prima del collaudo operativo servono:

- progetto OpenAI dedicato e chiave server-side;
- OAuth Google Calendar per il calendario personale di Mirko Piasenti;
- bot Telegram separato e relativo `chat_id` proprietario;
- dataset autorevole delle coordinate dei comuni;

La migration `070` deve essere gia' presente, perche'
`kona_call_director_comuni` referenzia `mirox_comuni_istat`.

## Variabili Netlify

| Variabile | Impostazione iniziale |
|---|---|
| `KONA_CALL_DIRECTOR_ENABLED` | `false`; passare a `true` solo durante il collaudo controllato |
| `KONA_CALL_DIRECTOR_OPENAI_API_KEY` | chiave del progetto OpenAI dedicato, solo server-side |
| `KONA_CALL_DIRECTOR_OPENAI_MODEL` | modello approvato e coerente con i prezzi configurati |
| `KONA_CALL_DIRECTOR_GOOGLE_CLIENT_ID` | OAuth client ID |
| `KONA_CALL_DIRECTOR_GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `KONA_CALL_DIRECTOR_GOOGLE_REDIRECT_URI` | callback dell'ambiente verso `kona-cc-google-callback` |
| `KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY` | 64 caratteri hex, dedicata alla cifratura AES-256-GCM |
| `KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN` | token del bot KONA Call Director |
| `KONA_CALL_DIRECTOR_TELEGRAM_WEBHOOK_SECRET` | secret casuale configurato anche nel webhook Telegram |
| `KONA_CALL_DIRECTOR_OWNER_CHAT_ID` | solo chat di Mirko |
| `KONA_CALL_DIRECTOR_STAGING_RUN` | `false` finche' lo staging non e' pronto; poi `true` per provare il cron |

Con la Scheduled Function Netlify nativa lasciare
`KONA_CALL_DIRECTOR_CRON_SECRET` **non impostata**: la schedulazione nativa non
aggiunge l'header personalizzato richiesto dal controllo opzionale. Il secret
serve soltanto se in futuro il dispatcher viene invocato da uno scheduler
esterno controllato.

## Procedura di attivazione in staging

1. Stato completato il 2026-08-28: progetto test creato in `eu-west-3` e
   bootstrap minimo `database/staging/003_kona_call_director_bootstrap.sql`
   applicato senza copiare dati production.
2. Stato completato il 2026-08-28: migration
   `database/072_kona_call_director.sql` e seed disattivato applicati.
3. Stato completato il 2026-08-28: verificate 23 tabelle KONA, cinque RPC
   `kona_cd_*`, RLS, zero grant browser, zero dati CRM e toggle globale spento.
4. Importare le coordinate da una fonte autorevole in
   `kona_call_director_comuni`. Senza import il sistema continua a funzionare,
   ma la priorita' geografica resta degradata a `unknown`.
5. Configurare le env dello staging mantenendo
   `KONA_CALL_DIRECTOR_ENABLED=false` e `KONA_CALL_DIRECTOR_STAGING_RUN=false`.
6. Stato completato il 2026-08-28: il sito
   `mirox-kona-call-director-test.netlify.app` pubblica il commit staging
   `b4cf578` con service role del solo database test e con entrambi gli
   interruttori KONA a `false`.
7. Salvare e ricontrollare: budget 50 euro, riserve 40/10, cambio USD/EUR,
   prezzo del modello, 50 lead/notte, due web search massime, sessione Business
   90 minuti, durata appuntamento 45 minuti, raggio indicativo 20 km e orari.
8. Collegare Google dal pannello Admin. Verificare lettura free/busy,
   creazione, modifica e annullamento di un appuntamento di prova; controllare
   che Isabella non veda titolo o dettagli degli eventi privati.
9. Registrare il webhook Telegram dell'ambiente sulla function dedicata usando
   lo stesso secret configurato in Netlify. Provare `/stato`, `/piano`,
   `/approva`, `/sospendi`, `/riattiva` e un messaggio libero.
10. Abilitare soltanto il profilo di Isabella e mantenere
    `modalita_osservazione=true`; lasciare ancora spento il toggle globale.
11. Portare `KONA_CALL_DIRECTOR_ENABLED=true` e
    `KONA_CALL_DIRECTOR_STAGING_RUN=true`, poi attivare il toggle globale dal
    pannello Admin. Questo ordine rende l'attivazione deliberata e reversibile.
12. Eseguire almeno un ciclo completo di prova e verificare database, pagina
    operatore, report Telegram, audit e consumo budget.

## Collaudo obbligatorio

Il collaudo staging deve coprire almeno:

- blacklist per CF e per tutti i numeri disponibili;
- un solo contatto attivo per operatore e sblocco dopo esito;
- skip motivato, contestazione una sola volta e decisione finale operatrice;
- tre tentativi ordinari e quattro tentativi per le conferme;
- conferma di venerdi proposta per lunedi, salvo ferie configurate;
- appuntamento creato, riprogrammato e annullato con Google;
- indisponibilita' Google: nessuna doppia prenotazione e notifica;
- sessione Business bloccata dopo le 18:00;
- sessione Business standard bloccata senza categorie approvate e filtrata
  esclusivamente sulle categorie del piano;
- sessione Consumer manuale tracciata senza suggerimento automatico di lead;
- arricchimento notturno di un piccolo lotto e fonti realmente registrate;
- esaurimento simulato delle riserve OpenAI e notifica soglia budget;
- report 19:10, proposta 20:05, reminder 20:00 e 08:00, piano default 08:30;
- spegnimento immediato tramite toggle globale ed env.

## Cron

Il dispatcher gira ogni cinque minuti e usa l'orologio Europe/Rome. Gli eventi
ordinari hanno una finestra di recupero di 20 minuti; arricchimento e retention
di 60 minuti. Ogni evento e' idempotente per data e nome e ha al massimo tre
tentativi nella propria finestra.

Sequenza: 02:00 arricchimento, 03:30 retention, 08:00 reminder mattina, 08:30
piano default, 19:10 report serale, 20:00 reminder sera e 20:05 proposta del
piano del giorno lavorativo successivo. A ogni tick vengono inoltre gestiti
task, conferme, piccoli batch di job, riconciliazione Google e outbox Telegram.

## Passaggio in production

Passare in production soltanto dopo il collaudo staging firmato. Ripetere gli
step 1-10 usando credenziali, callback, bot, webhook, database e calendario di
production distinti. Effettuare il primo avvio in un giorno lavorativo
sorvegliato, con Isabella presente, `modalita_osservazione=true` e Mirko
raggiungibile su Telegram. Mantenere l'osservazione per almeno la prima
settimana e confrontare chiamate, appuntamenti, scarti, anomalie e costi.

## Arresto e rollback operativo

Per fermare KONA senza perdere dati:

1. disattivare immediatamente il toggle globale nel pannello Admin;
2. impostare `KONA_CALL_DIRECTOR_ENABLED=false` e ridistribuire la config;
3. disabilitare il profilo di Isabella;
4. mettere in pausa il webhook Telegram e, se necessario, disconnettere Google;
5. conservare tabelle e audit per diagnosi: non e' necessario alcun rollback DB.

La migration e' additiva, ma rimuovere tabelle o funzioni KONA e' un'azione
distruttiva. Un eventuale rollback strutturale va preparato separatamente,
dopo export dei dati e approvazione esplicita, eliminando soltanto oggetti con
prefisso `kona_call_director_*` e RPC `kona_cd_*` nell'ordine corretto delle
dipendenze. Non eseguire DROP durante il normale arresto.

## Verifica locale conclusiva

- `node --test tests/kona-call-director.test.js`: 73/73 pass.
- `npm test`: 189/189 pass, inclusa build statica production.
- Nessuna migration applicata, nessun commit, push o deploy eseguito durante
  questa chiusura.
