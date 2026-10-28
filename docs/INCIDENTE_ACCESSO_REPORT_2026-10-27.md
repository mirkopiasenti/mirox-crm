# Accesso CRM e report Telegram — 27 ottobre 2026

Diagnosi in sola lettura, orari Europe/Rome (UTC+1). Nessun browser, login di
prova, invio Telegram, modifica dati/credenziali/modalità, riavvio o nuovo deploy.

## Riscontri

- Il login usa l'endpoint corretto del progetto Supabase `lbgwamhjkjjfwgusafbi`,
  regione `eu-west-3`. Il codice login/configurazione non cambia nell'ultimo push.
- Sei richieste a `/auth/v1/token` con HTTP522 tra19:31:09 e19:51:04; presenti
  anche risposte200. Nel controllo20:45–21:10 risultano cinque Auth504, ultimo
  alle21:07:13, insieme a due200. Non è prova di credenziali errate.
- Controlli GET su Auth health e Database API in timeout15s, anche con chiave
  pubblica e con service role. Gateway senza chiave401 e preflight CORS200.
  Metadati progetto ACTIVE_HEALTHY e status globale senza incidente pubblicato
  non bastano a dichiarare il ripristino del progetto.
- Il bot Target dovrebbe inviare tre report alle19:45 e recuperare ogni5minuti
  entro la stessa sera. Calendario verificato sul27/10: giorno ammesso e turno
  dovuto. Una lettura SQL riuscita intorno alle21:09 non trova il job con chiave
  `evening:2026-10-27`; successive letture sono di nuovo in timeout.
- Netlify sito `mirox-crm`, id `1a41a6e4-5370-4bc9-9a26-b2230e942bc0`, deploy
  `6ae0f23563f8ffded0ed96e1`, commit84bb3100ecb971be5f95a162039199abf750f7e3:
  ready, pubblicato19:50:16, senza errori di deploy. Cinque schedulazioni
  registrate, incluso `cron-target-reports` ogni5minuti.
- Funzioni Target presenti e variabili richieste con contesto production e scope
  functions/runtime. Valori secret mascherati dall'API: gli asterischi non sono
  valori reali e non dimostrano TARGET_ENABLED=false. Probe POST webhook senza
  segreto restituisce403 prima di DB/coda: il guard `configured()` è true.
- Log Netlify cron Target tra19:00 e21:15: quattro report runtime fino19:15:13,
  nessuno dopo; worker senza invocazioni nella finestra. Nessun log cron nella
  finestra20:45–21:20. Una chiamata diagnostica webhook compare alle21:18:55:
  raccolta dei log recenti funzionante. Nei log Supabase delle tabelle Target
  dopo19:15 compaiono soltanto GET200 e DELETE204 delle19:15, nessuna creazione.
- Questi riscontri distinguono due problemi: timeout accesso Supabase e assenza
  di invocazioni schedulate Target nei log disponibili. Non dimostrano una sola
  causa comune né un rifiuto di Telegram.

## Approfondimento dopo le21:50

- La pagina di stato generale resta priva di un incidente utile a spiegare il
  caso. Non va dedotto che il singolo progetto risponda correttamente.
- Auth registra `context deadline exceeded` / `request_timeout` e `Unhandled
  server error: context canceled`. Non sono prove di password errate.
- Lettura restrizioni tramite CLI autenticata: status applied, entrambe le reti
  IPv4/IPv6 ammesse (0.0.0.0/0 e ::/0), nessuna restrizione modificata.
- Ispezione diretta CLI delle statistiche database, progetto collegato, password
  esistente e certificato TLS locale: `LegacyDbConnectError`, `PgClient:
  Connection timed out`. Anche query amministrativa su pg_stat_activity fallita.
- Feed ufficiale Metrics API richiesto con Basic Auth e service role: timeout15s.
  CPU/RAM/connessioni effettive quindi NON misurate. Nessun aumento piano,
  riavvio o modifica dati effettuato. Sovraccarico/blocco del singolo database
  resta un'ipotesi da verificare; documentazione ufficiale descrive questi sintomi:
  https://supabase.com/kb/troubleshooting/failed-to-run-sql-query-connection-terminated-due-to-connection-timeout
- Chiesto al proprietario di aprire Database Health; ha chiesto come accedere.
  Collegamento corretto dal link ufficiale Database reports:
  https://supabase.com/dashboard/project/lbgwamhjkjjfwgusafbi/observability/database
  In attesa di valori CPU/Memory o errore del pannello, nessun consenso al riavvio.

## Screenshot del proprietario21:57 e21:59

Console browser: POST Auth password -> net::ERR_FAILED522 e risposta priva di
Access-Control-Allow-Origin. Considerato insieme al preflight200 già verificato,
è coerente con errore gateway/origine, non prova di una regola CORS da cambiare.
Overview progetto, Last60minutes: Database100%errors, API Gateway79,2%errors,
CPU75%, PeakConnections0/60, Memory/Disk/DiskIO0%, Storage100%warnings,
Realtime50%errors. Gli zeri non certificano risorse libere o dati assenti;
telemetria incompleta resta possibile. CPU75 da sola non dimostra saturazione.

Passo di ripristino consigliato dalla KB Supabase per database non responsivo:
Restart project da Settings > General, conservando dati e configurazione ma
interrompendo temporaneamente le connessioni anche del CC condiviso. Nessun
restart eseguito dall'assistente e nessun consenso a eseguirlo ricevuto. Guidare
il proprietario già nel pannello, poi verificare Auth/REST/SQL, configurazione
collaudo e stato report prima di qualunque recupero. La causa di fondo resta
non accertata; un eventuale riavvio non ne dimostra la risoluzione definitiva.

## Nuova evidenza: avviso Disk IO del26/10

Il proprietario allega il PDF dell'email Supabase “Your Supabase Project Mirox
CRM is running out of Disk IO Budget”, datata26/10/2026 ore19:20, stesso project
ref. Letta la pagina completa con pypdf e anteprima locale privata. L'avviso
segnala consumo superiore alla capacità dell'istanza e rischio di risposte lente,
CPU in IO wait e indisponibilità; da solo non quantifica il consumo attuale.
Precede le modifiche verifica automatica del27/10, senza escludere contributi
successivi al carico.

Interpretazione corretta del precedente screenshot: **Disk IO Balance0% indica
budget residuo esaurito**, secondo la documentazione Compute and Disk. Questo
indicatore non va trattato soltanto come uno zero forse mancante. Insieme alla
mail e ai timeout fornisce un riscontro concreto per esaurimento/throttling IO.
Gli zeri degli altri indicatori restano non sufficienti a certificare salute o
assenza dati; CPU75% non prova da sola saturazione CPU.

La KB Supabase High Disk I/O descrive ritorno alla prestazione baseline dopo
l'esaurimento del burst e possibili rallentamenti, CPU in attesa IO, blocchi
backup/autovacuum e istanza non responsiva. Restano da misurare IO wait, swap,
query/cache, backup e polling prima di attribuire la sorgente del consumo.
L'assenza di invocazioni cron Netlify resta un riscontro separato, non spiegato
con certezza dall'email del database.

Correzione al consiglio precedente: il riavvio è un possibile tentativo di
ripristino, non una soluzione duratura alla capacità IO insufficiente. Priorità:
identificare compute attuale e budget/limiti, ridurre carichi evitabili e valutare
ottimizzazione o dimensionamento con costi espliciti. Non promettere reset a
mezzanotte, non confondere IO con spazio disco, non aumentare GB o piano alla
cieca. Chiesto al proprietario Compute size nella pagina Infrastructure; nessun
upgrade, cambio backup/cron/modalità o riavvio eseguito. Diagnostica non urgente
su DB sospesa per non aggiungere richieste durante il blocco.

Fonti ufficiali aggiornate:
- https://supabase.com/kb/troubleshooting/exhaust-disk-io
- https://supabase.com/docs/guides/platform/compute-and-disk

## Compute confermato: Nano su organizzazione Pro

Il proprietario conferma Nano. Metadati organizzazione KONA TECH riletti tramite
connettore: piano Pro. La documentazione ufficiale precisa che Nano rimasti su
organizzazioni a pagamento sono fatturati quanto Micro: non serve acquistare un
altro piano Pro per il solo passaggio a Micro. Verificare comunque il riepilogo
reale prima di applicare modifiche; nessun costo o upgrade autorizzato/applicato.

Confronto verificato27/10 (prezzi indicativi USD per istanza, tasse/altre risorse
escluse; crediti compute condivisi a livello organizzazione):

| Taglia | RAM | Baseline throughput | Baseline IOPS | Compute indicativo |
|---|---|---|---|---|
| Nano attuale | fino0,5GB | 5MB/s | 250 | come Micro sul piano Pro |
| Micro | 1GB | 11MB/s | 500 | circa10USD/mese |
| Small | 2GB | 22MB/s | 1000 | circa15USD/mese |

Primo intervento consigliato: valutare Nano->Micro, maggiore capacità allo stesso
prezzo compute documentato per l'attuale piano; Small offre ulteriore margine
con circa5USD/mese compute in più rispetto Micro/NanoPro. Sono taglie ancora
soggette a budget burst: nessuna garanzia che l'aumento risolva la causa del carico.
Il cambio comporta una finestra di indisponibilità, di norma inferiore a2minuti
secondo la documentazione, ma può durare di più; progetto condiviso col CC.

Audit sorgenti offline, senza nuove sonde al DB bloccato: backup effettua dump
DB+inventario ogni ora; gli oggetti invariati vengono riusati e non è corretto
attribuire a ogni ciclo una riscarica completa di tutti gli allegati. UI verifica
interroga periodicamente status e relative tabelle; cron verifica legge config e
coda ogni minuto, Target ogni5minuti. Queste attività sono candidate da misurare,
non cause dimostrate; email26/10 precede il nuovo modulo verifica27/10. Nessuna
riduzione dei backup, cambio cron o patch applicata in questo intervento.

Fonti prezzi/capacità: https://supabase.com/docs/guides/platform/compute-and-disk
https://supabase.com/docs/guides/platform/manage-your-usage/compute
https://supabase.com/pricing

## Ripresa dopo il passaggio a Micro, circa22:15

Il proprietario riferisce di aver applicato il cambio suggerito Nano->Micro e di
essere nuovamente entrato nel CRM. Controlli indipendenti: Auth health HTTP200
in0,19s; REST pubblico200 in0,21s; modalità verifica200 in0,20s; query SQL riuscite.
Configurazione riconfermata `collaudo`, zero verifiche in corso e zero notifiche
verifica. Nessuna pratica approvata o analisi avviata dall'assistente.

Il cron Target torna nei log alle22:15:13; il lavoro serale `evening:2026-10-27`
viene creato alle22:15:12 con stato in_coda, tentativi0, inviati0/in_flight=false.
La sessione non ha lock o lease pendenti. Al successivo giro cron il worker
completa il lavoro: alle 22:20:23 stato `inviato`, tentativi 1, inviati 3 su 3,
`in_flight=false`, nessun codice errore. Confermata accettazione dei tre messaggi
da parte di Telegram, non lettura sul dispositivo. Nessun reinvio manuale o
secondo job creato. Anche il cron verifica torna a registrare esecuzioni regolari.

Il recupero coincide con il cambio compute e il riavvio associato: non separa
con certezza i due effetti e non dimostra risolto il consumo eccessivo IO.
La precedente assenza di log cron non viene quindi dichiarata un guasto
indipendente Netlify accertato. Prima del collaudo28/10 mantenere collaudo e
controllare budget IO/risorse; audit performance/backup/polling resta aperto.

## Prossime azioni

1. Verificare compute/budget IO dalla pagina Infrastructure e comunicare a Supabase
   anche l’avviso del26/10 e Disk IO Balance0%, oltre ai timeout. Valutare costi
   e carichi prima di modificare risorse; nessuna operazione a pagamento autorizzata.
2. Segnalare a Netlify schedulazioni registrate ma invocazioni assenti, con id
   sito/deploy e cron. Non è stato eseguito un redeploy alla cieca.
3. Dopo ripresa Auth/dati, rileggere modalità verifica (ultima confermata
   collaudo) e job serale; niente reinvio senza stato/checkpoint affidabili.
4. Se il cron non riparte, la UI Netlify offre Run now sulla funzione pianificata.
   Il cron usa la stessa chiave serale univoca: recupera il lavoro esistente o lo
   crea, senza richiedere copie nuove del report. Nessuna invocazione eseguita
   durante questa diagnosi. Un invio incerto resta da riconciliare.
5. Il recupero automatico è limitato alla stessa sera. Dopo mezzanotte, richiedere
   esplicitamente il report del27/10 dopo aver verificato eventuali invii parziali.

## Bozza assistenza Supabase — non inviata

Project: lbgwamhjkjjfwgusafbi, eu-west-3.
On 2026-10-27 our production CRM cannot reliably authenticate or query the Data
API. Edge logs show six POST /auth/v1/token HTTP522 between18:31:09Z and18:51:04Z,
and five Auth504 in19:45–20:10Z (latest20:07:13Z), mixed with successful requests.
Auth health and tiny REST reads time out from our diagnostic client; management
SQL queries mostly fail with connection timeouts, with one successful read.
CORS preflight succeeds and the public project URL is correct. Project metadata
still reports ACTIVE_HEALTHY. Please investigate project origin connectivity and
Auth/database availability. No password/key rotation or restart has been done.

## Bozza assistenza Netlify — non inviata

Site: mirox-crm, 1a41a6e4-5370-4bc9-9a26-b2230e942bc0.
Published deploy: 6ae0f23563f8ffded0ed96e1, ready at2026-10-27T18:50:16Z.
cron-target-reports is registered with */5 * * * * but the historical logs show
its last invocation at2026-10-27T18:15:13Z and no later invocation through20:20Z.
The worker has no invocation in this window and today's evening job was absent
in the one successful database check. Recent log ingestion is working: our
unauthenticated Target webhook probe appears at20:18:55Z with the expected403,
which also confirms its runtime configuration guard is enabled. Please check
scheduled invocation dispatch for this site. No manual resend has been attempted.

## Fonti tecniche

- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-522/
- https://docs.netlify.com/build/functions/scheduled-functions/
- Client ufficiale log Netlify: `netlify/cli`, `src/commands/logs/log-api.ts` e
  `src/commands/logs/sources/functions.ts` su GitHub.
- Log grezzi solo in `.backup-private/incidente-supabase-2026-10-27/`, ignorata da Git.

## Scelta successiva: Small

Dopo il ripristino, il proprietario preferisce Small per maggiore margine e
sviluppi futuri. Documentazione ufficiale riletta: 2 GB RAM, baseline 22 MB/s
e 1.000 IOPS, circa 15 USD/mese compute contro circa 10 di Micro; differenza
indicativa 5 USD/mese, fatturazione oraria e altre risorse/tasse escluse.
Il cambio comporta downtime, solitamente meno di 2 minuti ma non garantito.
Indicata la pagina Infrastructure per applicarlo dal pannello; nessun cambio
eseguito dall’assistente e taglia Small non ancora confermata live. Resta da
misurare il consumo IO: la maggiore capacità non certifica la causa risolta.

## Verifica dopo Small e upgrade PostgreSQL, 22:45

Il proprietario conferma entrambi i cambi dal pannello. get_project riporta
ACTIVE_HEALTHY e versione 17.11.0.003; SQL conferma PostgreSQL 17.11, avvio
database 22:34:51 Europe/Rome. La taglia compute non è esposta da questo
metadato: Small è confermato dal proprietario. Auth health, REST pubblico,
configurazione e stato report rispondono HTTP200 in circa 0,38–0,40 secondi.
Modalità collaudo, zero verifiche in corso e zero notifiche verifica.
Target serale conserva stato inviato, 3/3, un tentativo, nessun errore.
Letture aggregate contratti/profili riuscite; nessun dato cliente esportato.
Tra le estensioni pertinenti alle note upgrade risultano pg_cron1.6.4 e
pgcrypto1.3; ltree/btree_gist non installati. Nessuna reindicizzazione eseguita.
Questi controlli non collaudano login con credenziali, scritture, upload, OCR,
cron dopo il riavvio o backup/restore con la nuova versione; nessuna azione
applicativa, email, messaggio o nuovo deploy avviato. Consumo IO da misurare
nel normale utilizzo; collaudo contratti assistito 28/10 invariato.

## Screenshot Infrastructure delle 22:45:59

Il pannello mostra esplicitamente Small, quindi la taglia è confermata anche
visivamente. Nel riquadro centrale: CPU0%, RAM22%, disco3%, 7/90 connessioni.
La sezione inferiore copre il 20–27 ottobre: CPU20%, memoria44%, Disk IO
Balance0% e Compute100% non vanno confusi con la fotografia del riquadro.
La documentazione ufficiale specifica che Infrastructure mostra il minimo
campionato di Disk IO Balance degli ultimi sette giorni: lo zero è compatibile
con l’incidente precedente e non dimostra esaurimento attuale dopo Small.
Il criterio preciso di aggregazione Compute100% non è accertato; non
interpretarlo come CPU attuale al100%. Per valutare il nuovo assetto servono
le metriche Observability nell’intervallo successivo all’upgrade. Nessun
ulteriore aumento compute suggerito sulla sola base di questo screenshot.
Fonte: https://supabase.com/docs/guides/platform/compute-and-disk
