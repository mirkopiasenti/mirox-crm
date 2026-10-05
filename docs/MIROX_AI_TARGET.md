# MIROX AI - Target

Stato 05/10/2026: attivo in produzione su `mirox-crm.it`, bot `@MiroxAiTargetBot`.
Migration, configurazione dedicata, webhook, cron, tre report reali e dialogo
verificati. Trascrizione di un audio sintetico riuscita; vocale entrante Telegram
ancora da collaudare con il proprietario. Obiettivi mensili di ottobre assenti.

## Comportamento concordato

Chat privata del solo Mirko, bot dedicato con nome **MIROX AI - Target**.
Alle **19:45 Europe/Rome**, dal lunedi al sabato, invia nell'ordine:

1. **Testo** Pezzi Day by Day: totale giornata in alto, una categoria per blocco,
   operatori su righe separate e righe a zero omesse.
2. **Immagine PNG** Chiamate Consumer e Business outbound per operatore: fatte, risposte,
   non risposte, nuovi appuntamenti fissati; spostamenti separati, totali
   per canale e totale generale anche per operatore.
3. **Immagine PNG** Avanzamento Mensile Standard e sola **Extra Gara P.IVA**, con Andamento,
   Eccedenza, punteggio e obiettivo. Le categorie mensili a zero restano visibili.

Sono esclusi domeniche, festivita nazionali italiane e Pasquetta. Il cron UTC
ogni cinque minuti controlla data/ora italiana, mantenendo le 19:45 al cambio
ora legale. Se il cron manca l'istante previsto, recupera entro la stessa sera;
il report resta datato e indica l'ora effettiva di lettura. Non e' una garanzia
al secondo: generazione, coda e provider possono ritardare la consegna.

Vendite e mensile mantengono Legnago (`9001415852`) ed escludono reinserimenti.
La data contratto e' selezionata con i confini UTC gia' usati dalla pagina;
chiamate (`data_ora`) e appuntamenti (`created_at`) seguono Europe/Rome.
Il totale Day by Day somma le righe, non i contratti distinti: uno stesso
contratto puo' contribuire a una riga aggiuntiva, come un'opzione Fisso.
La griglia mantiene i quattro nomi operatori configurati nella pagina.
Le chiamate ripetute contano come tentativi distinti. Risposta corrisponde
all'esito diverso da `non_risposto`, come nel KPI attuale. Gli alias dei profili
CC sono consolidati. Appuntamenti con `chiamata_outbound_id` appartengono al
Business outbound; gli altri al Consumer (inclusi gli eventuali non assegnati).

`js/dashboard-report-core.js` e' il motore puro condiviso con la pagina:
matching, pesi, calendario e mensile. Conserva i filtri post-vendita esistenti:
FTTC contati solo se attivati nel mese, Energia rifiutata esclusa,
W3 Protetti Standard solo In Attivazione/OK; Extra Gara P.IVA usa gli stati
Business gia' applicati nella pagina e i punteggi extra.
Andamento confronta punteggio e quota obiettivo maturata sui giorni lavorativi;
Eccedenza arrotonda verso l'esterno e viene nascosta per RAGGIUNTO.
Obiettivo assente: **OBIETTIVO NON CONFIGURATO**, nessun andamento inventato.
Al controllo del 05/10 risultano 30 obiettivi a settembre e nessuno a ottobre;
configurarli in Admin → Gare & Avanzamento prima di attendersi stati di ottobre.

## Dialogo e aggiornamenti

Testo libero e vocali conclusi, memoria degli ultimi 30 messaggi. Il modello
riceve strumenti di sola lettura per chiedere riepiloghi di date specifiche,
confrontare giorni o mesi e discutere liberamente risultati e ipotesi.
Non eredita gli incidenti, la memoria o i workflow di rilascio di Guardian.
I report automatici non dipendono dall'AI. Solo il dialogo e i vocali usano OpenAI.

- `/report` oppure “mandami il report aggiornato”: tre messaggi nuovi.
- `/report YYYY-MM-DD`, “report di ieri”: aggiornamento del giorno scelto.
- `/vendite`, `/chiamate`, `/mese`, con data facoltativa: singolo report.
- `/salute`: ultima consegna serale completata e problemi recenti di consegna.
- `/nuova`: ricomincia la memoria del dialogo.
- `/start` e `/aiuto`: presentazione e comandi.

Le richieste manuali funzionano anche domenica e festivi. Le riletture storiche
usano i record e gli stati oggi presenti nel CRM: non ricostruiscono una
fotografia originaria. Il mensile e' quello della pagina oggi: mese corrente
con target maturato a oggi, mesi precedenti con target di fine mese. Chiedere
un giorno passato dello stesso mese non ricostruisce il mensile di quel giorno.

## Componenti e sicurezza

- `target-telegram-webhook`: valida secret Telegram, chat privata e identita
  del proprietario; accoda e deduplica gli update, poi risponde subito.
- `target-worker-background`: firma HMAC con timestamp (5 minuti), serializza
  la chat con lease di 20 minuti; elabora i job in ordine e conserva checkpoint.
  Background per evitare il limite del cron durante un dialogo AI.
- `cron-target-reports`: coda serale con chiave unica per data, risveglio dei
  job pendenti e pulizia dei soli job Target terminali piu' vecchi di 90 giorni.
  Il deploy Netlify impedisce invocazioni URL delle funzioni scheduled.
- Helper `target-reports`, `target-dialogue`, `target-queue`, `target-telegram`,
  `target-report-images` (SVG locali rasterizzati con `@resvg/resvg-js@2.6.2`).
- Migration `database/20261005185700_mirox_ai_target.sql`: nuove tabelle
  `mirox_target_sessioni` e `mirox_target_jobs`, RLS abilitata, accesso solo
  service role. Nessuna tabella CC condivisa o RPC esistente modificata.

Il worker manda i tre report con una breve pausa tra i messaggi. Gli invii
completati sono registrati individualmente. Un rifiuto esplicito 429 viene
ritentato dal punto mancante, rispettando retry_after; preparazioni fallite
usano backoff con massimo otto tentativi. Rifiuti Telegram permanenti terminano
il job. Timeout/rete, HTTP 5xx o checkpoint perso possono significare che il
messaggio e' arrivato: il job passa a **incerto** e non e' reinviato da solo.
`/salute` segnala il problema; `/report` chiede una nuova copia esplicita.
Telegram non offre una chiave di idempotenza per sendMessage: non si promette
una consegna esattamente una volta in presenza di esiti ambigui.

Immagini composte direttamente dagli aggregati CRM, senza API immagini OpenAI:
nessun costo AI aggiuntivo per la grafica. Font Lato Regular/Bold sotto licenza
OFL, inclusi nel solo worker; moduli nativi resvg esterni al bundle esbuild.
SVG e testo alternativo salvati nella coda per conservare lo snapshot al retry;
PNG generato prima del checkpoint di invio, non conservato nel DB/Storage.
Il dialogo riceve il solo testo alternativo. Job vecchi con stringhe compatibili.
Stati mensili verdi per IN LINEA/RAGGIUNTO, rossi per IN RITARDO; obiettivi
mancanti neutri con avviso. Eccedenza conserva il segno; raggiunto/assente: —.
La foto Telegram include caption e data. Report oltre i limiti foto (10 MB,
somma dimensioni 10.000, rapporto 20) in un solo documento PNG completo;
allocazione raster limitata a 18.000 pixel di altezza. Non vengono persi dati.
Testo lungo oltre 4.000 caratteri: un unico allegato `.txt` completo.

Token dedicato, segreti e service role restano backend-only. Nessun campo cliente,
PDF, allegato, CF, telefono, email o nota chiamata viene letto per il dialogo.
All'AI vanno aggregati e nomi degli operatori; i messaggi liberi/vocali del
proprietario sono elaborati da OpenAI. Responses usa `store:false` e lo stato
conversazione locale; non viene promessa Zero Data Retention del provider.
La memoria inattiva da oltre 90 giorni non viene riutilizzata per il dialogo.
La memoria residua su DB resta limitata agli ultimi 30 messaggi, fino al reset.
Log con soli codici tecnici, senza payload provider, token o testi del proprietario.

## Attivazione

1. In [BotFather](https://t.me/BotFather) creare il bot con `/newbot`, nome
   `MIROX AI - Target` e username Telegram libero che termini in `bot`.
   Salvare il token in un file privato locale con permessi 0600 sotto
   `.backup-private/`, mai in Git o nei messaggi della chat di sviluppo.
2. Aprire il nuovo bot e premere Avvia: Telegram richiede che il proprietario
   inizi la chat. Recuperare/riconfermare il suo chat_id con getUpdates prima
   di collegare il webhook; deve corrispondere al proprietario, non a un gruppo.
3. Applicare la migration locale al production concordato e verificare RLS,
   grant service_role e accesso negato ad anon/authenticated. La migration e'
   additiva e non cambia il CRM; applicata il 05/10/2026, con RLS e grant verificati.
4. Con autorizzazione esplicita del proprietario, configurare queste variabili
   sul site Netlify `mirox-crm`, solo context Production. Il piano corrente non
   permette lo scope Functions isolato: i Secret sono limitati a Builds, Functions
   e Runtime, escluso Post processing; codice di build non pubblica queste chiavi:

   | Variabile | Valore / scopo |
   |---|---|
   | `TARGET_ENABLED` | `true` solo al momento dell'attivazione |
   | `TELEGRAM_TARGET_BOT_TOKEN` | Token del nuovo bot |
   | `TELEGRAM_TARGET_OWNER_CHAT_ID` | chat_id privato di Mirko, numerico positivo |
   | `TELEGRAM_TARGET_WEBHOOK_SECRET` | Segreto casuale almeno 32 caratteri; formato ammesso Telegram |
   | `TARGET_WORKER_SECRET` | Segreto HMAC distinto, casuale almeno 32 caratteri |
   | `OPENAI_TARGET_API_KEY` | Chiave OpenAI dedicata a questo bot, testo e vocali |
   | `OPENAI_TARGET_MODEL` | Facoltativa; default `gpt-5.6-luna` |
   | `OPENAI_TARGET_TRANSCRIBE_MODEL` | Facoltativa; default `gpt-transcribe` |

   Riutilizza solo `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` backend esistenti,
   senza nuove credenziali per le immagini. Chiave, modello e trascrizioni OpenAI sono dedicati
   a Target; la chiave Guardian non viene usata neanche come fallback.
   Il codice rifiuta staging, branch diverse da main e contesti preview.
   I nomi dei modelli non sono segreti: lasciarli vuoti per usare i default o
   crearli come normali variabili. Nel setup attivo le due variabili facoltative
   sono vuote (0 valori), evitando falsi positivi dello scanner Netlify.
   Non disattivare lo scanner e non escludere le vere credenziali dalla scansione.
5. Pubblicare solo dopo richiesta esplicita di push/deploy: le regole del
   repository vietano un push autonomo, dato il deploy automatico production.
6. Collegare `setWebhook` a
   `https://mirox-crm.it/.netlify/functions/target-telegram-webhook`, con
   `secret_token` dedicato, `allowed_updates:["message"]` e
   `max_connections:1`. Non configurare il webhook di Guardian.
7. Collaudare nella chat Target `/start`, i tre `/report`, un confronto libero,
   un vocale, `/salute` e un reale invio scheduled; verificare i job e la memoria.
   Configurare gli obiettivi di ottobre con valori decisi dal proprietario.

Inventario privato `netlify-inventory.json` aggiornato con le 8 chiavi Target;
6 valorizzate in Production e 2 modelli facoltativi vuoti. Le copie off-site delle
configurazioni statiche precedenti restano da riallineare, come il recupero delle
altre chiavi write-only: nessuna rotazione o modifica al runner backup eseguita.

## Verifiche della sessione

Suite repository dopo impaginazione: **203/203 test e build superati**
(202 test versionati, piu' il test backup locale preesistente). Test Target coprono calendario/DST,
filtri, punteggi/stati, pagina/motore condiviso, paginazione, errori lettura,
webhook/HMAC/allowlist, dedupe, serializzazione, 429, invio incerto e tool AI.

Lettura production 05/10 senza mutazioni: 35 contratti Legnago di ottobre,
8 categorie del report mensile. Il rendering HTML mensile prima/dopo e'
identico sul campione reale; 60 mesi di calendario 2024–2028 coincidenti.
Anteprime private in `.backup-private/target-validation/`: testo vendite e PNG
Call Center/mensile su snapshot reale del 05/10; controllate visivamente.
Verificati raster PNG reali, escape nomi, segni/stati, comandi singoli,
limiti foto/documento e retry dopo errore renderer prima del checkpoint.
Il campione usa l'ora di lettura effettiva, non una chiusura ricostruita alle 19:45.
Attivazione autorizzata esplicitamente dal proprietario il 05/10:
- Feature `84a8232`, CI GitHub `37360431887` riuscita; Netlify production
  `6ac3f57cdd0964d161242d1d` confermato dai metadati pubblici HTTP 200.
- Primo deploy fermato dallo scanner per i due nomi modello marcati erroneamente
  Secret; variabili facoltative svuotate, default nel codice, retry riuscito.
  Nessuna credenziale trovata nel commit o negli asset pubblici verificati.
- Migration `20261005185700`: RLS abilitata; CRUD negato ad anon/authenticated,
  consentito alla sola service_role. Tabelle CC e Guardian invariate.
- Webhook dedicato collegato, richieste senza secret HTTP 403, pending 0 e nessun
  errore Telegram. Avvio e messaggio libero reali elaborati dal worker HMAC;
  due job inviati al primo tentativo, memoria 7 messaggi, lease rilasciato.
- Cron reale: `evening:2026-10-05` creato alle 19:10 UTC; tre messaggi consegnati
  alle 19:15 UTC, un tentativo, nessun errore/incerto. Recupero serale previsto
  per l'attivazione avvenuta dopo le 19:45 italiane; nessun invio retrodatato.
- OpenAI testo reale e trascrizione sintetica WAV verificati. Il primo file di
  prova locale era vuoto per il sandbox; rigenerato valido senza cambiare il bot.
  Vocale entrante Telegram ancora da provare con un messaggio del proprietario.
- Obiettivi di ottobre non configurati: il mensile dichiara il dato mancante,
  senza copiare quelli di settembre o inventare Andamento/Eccedenza.

Impaginazione pubblicata il 05/10, commit `47a7beb`, Netlify production
`6ac406309a8a3d0008d7fa39`; commit confermato dai metadati pubblici.
Collaudo worker reale `layout-check:47a7beb`: tre report (testo, PNG, PNG)
consegnati alle 20:20:36 UTC al primo tentativo, nessun errore o stato incerto.
Renderer nativo e font inclusi nel runtime verificati dall'invio reale;
memoria aggiornata a 10 messaggi solo testuali, lease rilasciato.
CI GitHub `37368961629` in attesa del runner al controllo iniziale.

Riferimenti verificati: [OpenAI Docs: function calling](https://developers.openai.com/api/docs/guides/function-calling),
[Supabase: sicurezza Data API](https://supabase.com/docs/guides/api/securing-your-api),
[Netlify: Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/),
[Netlify: Background Functions](https://docs.netlify.com/build/functions/background-functions/),
[Telegram Bot API](https://core.telegram.org/bots/api).
