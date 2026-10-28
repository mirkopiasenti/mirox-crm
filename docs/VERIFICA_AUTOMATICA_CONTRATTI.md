# Verifica automatica contratti

Versione sviluppata il 27/10/2026, rilascio autorizzato in modalità collaudo.
Migration applicata e riletta a production, versione `20261027172616`.
Configurazione confermata collaudo: nessuna conferma contratto o email automatica. Checklist e decisioni storiche:
[analisi](VERIFICA_AUTOMATICA_CONTRATTI_ANALISI_2026-10-27.md).

Ripresa27/10 circa22:15 dopo passaggio Nano->Micro effettuato dal proprietario:
Auth/REST/SQL rispondono, modalità **collaudo riconfermata**, zero verifiche in
corso e zero notifiche verifica. Il primo collaudo sui nuovi contratti resta
previsto insieme per28/10 durante il giorno; nessuna attivazione automatica.

Controllo successivo 27/10 alle 22:45: proprietario conferma Small e upgrade;
PostgreSQL 17.11 (build Supabase 17.11.0.003) confermato SQL/metadati, progetto
ACTIVE_HEALTHY e Auth/REST HTTP200 in circa 0,4s. Modalità collaudo confermata,
zero verifiche in corso e zero notifiche verifica. Test completi sui nuovi
contratti previsti il 28/10; consumo IO da misurare. Dettagli nel rapporto
`docs/INCIDENTE_ACCESSO_REPORT_2026-10-27.md`.

## Professional Cloud Mobile e Fisso Business

Verifica automatica e promemoria email (28/10, pubblicati e migration applicata):
il worker passa `cluster_cliente` alla validazione PDA condivisa, evitando falsi
errori `dati_pda` su Mobile/Fisso Business. No e storico sconosciuto restano validi;
Si richiede una gestione valida. Le scelte non sono dedotte o modificate dall’AI.
Dopo esito automatico Controllato, Professional Cloud Si con Richiedi disattivazione
accoda una email a `mirko.piasenti@gmail.com`, oggetto «Mirox CRM: promemoria WhatsApp
Professional Cloud», con nome cliente, riferimento e link alla pratica. Il messaggio
ricorda il WhatsApp manuale; nessun invio WhatsApp o disattivazione sul portale.
Una notifica per contratto, con tipo `professional_cloud` e chiave dedicata;
No/Mantieni attiva/Consumer/altre categorie/collaudo non accodano il promemoria.
Prima di inviare vengono riletti stato controllato, esito definitivo e scelta:
se non più valida, notifica superata. Riutilizzati retry SMTP certi e riconciliazione
degli incerti; il pannello distingue «Promemoria Professional Cloud».
Migration `database/20261028093837_verifica_professional_cloud_notifiche.sql`
applicata in produzione come `20261028095719`: amplia il CHECK tipo dell’outbox e aggiorna soltanto la RPC
vendita `vendita_verifica_concludi`, INVOKER con grant/RLS invariati; nessun nuovo
trigger o modifica a tabelle/RPC/permessi CC, nessun backfill. Worker pubblicato
prima della migration; vincoli validati, grant service-only e INVOKER riletti.
Non attivare il sistema: in collaudo restano esclusi approvazioni e invii.

## Funzionamento

- Primo turno alle **21:00 Europe/Rome**, tutti i giorni. Nuovi invii dopo il
  turno attendono quello successivo. Le pratiche già presenti al primo avvio
  ricevono il prossimo turno, senza approvazione retroattiva immediata.
- Il passaggio pratica bozza → inviata registra il turno. Il cron ogni minuto
  recupera i lavori dovuti; non anticipa il primo esame. Ora legale/solare
  gestita nel DB con Europe/Rome.
- Dopo il primo tentativo, correzioni al contratto/PDA, allegati nuovi/rimossi,
  data firma attestata e nuovo CSV accodano subito il riesame. Il backend sollecita
  il worker; il cron recupera un eventuale dispatch fallito entro il minuto successivo.
  Le modifiche anagrafiche sono rilevate senza scrivere o aggiungere trigger
  sulla tabella condivisa `anagrafica`.
- Esiti visibili: Da controllare, Controllato, Da verificare, In attesa CSV.
  I sospesi restano `stato_controllo='da_controllare'` nel modello esistente;
  il dettaglio dell'esito è separato. Conteggi e trigger post-vendita conservati.
- In attesa CSV anche quando il CSV è valido ma la pratica non vi compare.
  Problemi documentali effettivi hanno precedenza e restano spiegati, insieme
  all'eventuale mancanza CSV. Un errore tecnico non è una prova documentale positiva.

## Caricamento degli elenchi

Il browser legge vendita_contratti e il join anagrafica già previsto. Non deve
usare inner join su vendita_pratiche: le sue RLS non espongono righe al ruolo
authenticated e quindi il join nasconderebbe tutti i contratti. Il verificatore
controlla stato pratica inviata nel backend. Il polling degli esiti aggiorna
soltanto elenchi già caricati, preservando loading ed errori di lettura.
Correzione27/10 dopo rilascio75f69aa; nessun cambio permessi o stato contratto.

## Controlli implementati

- PDA intestata allo stesso CF/P.IVA, codice contratto corrispondente, identità
  del cliente; per Business identità del **firmatario della PDA**, non della società.
- Documento d'identità con nome e CF coerenti; se il CF non è leggibile, servono
  nome completo e data nascita riscontrata nella PDA o nel CF del soggetto.
  Il solo nome non basta. Nessuna biometria o attestazione di autenticità.
- Documento non scaduto alla **data firma**, incluso il giorno di scadenza.
  Mai sostituita automaticamente con data upload/creazione. Data firma da PDF,
  da colonna CSV esplicitamente di firma/sottoscrizione oppure attestata dal
  verificatore tramite il campo dedicato, con attribuzione al profilo.
- Portabilità: ICCID della copia SIM uguale a quello della SIM uscente nella
  sezione MNP della PDA. Numero telefonico e seriale nuova SIM non sostituiscono
  questo confronto. Le numerazioni Mobile sono riscontrate separatamente.
- Firma cartacea: scansione contratto presente e coerente per soggetto/codice;
  nessuna nuova validazione tecnica della firma introdotta.
- Energia: identità, bolletta dello stesso soggetto e POD/PDR, almeno le prime
  due pagine effettive della stessa bolletta, gestore uscente leggibile.
- Dati categoria e integrità dei punteggi già registrati validati prima
  dell'approvazione. Allarmi e Assicurazioni mantengono percorso senza PDA:
  servono identità e data firma affidabile; per Business il firmatario deve
  comunque essere identificabile da documentazione aggiuntiva.

L'AI trascrive dati con documento, pagina e breve evidenza; non decide l'esito e
non emette patch eseguibili. Documenti/risposte sono dati non fidati. Dati incerti,
duplicati o discordanti non diventano approvazioni.
La verifica completa solo campi contratto vuoti documentati: codice, dati Mobile,
device/acquisto, tipo attivazione Fisso, numero Energia ed ex fornitore. Valori
esistenti discordanti richiedono correzione esplicita. Nessuna riscrittura autonoma
di anagrafica condivisa, offerta/opzione, attribuzione operatore, date commerciali
o punteggi storici. Una scelta di disattivazione Reload non è dedotta dall'AI.

## CSV Energia

Upload da Verifica Contratti, riservato admin, CSV originale con separatore `;`,
max 4 MiB, parsing server con virgolette/multilinea/BOM e colonne in allowlist.
Colonne minime: Codice Fiscale, Partita Iva, Proposta di Contratto, POD/PDR
(sono gestiti gli alias e le colonne POD/PDR separate già note al portale).
Una colonna Data firma/Data sottoscrizione esplicita può fornire la data firma;
date esportazione o commerciali non vengono usate a tale scopo.

Numero nuovo contratto ricavato da **fiscale + punto di fornitura**, soltanto se
esiste una sola Proposta di Contratto distinta. Più proposte o fiscale discordante
sono Da verificare. Se il verificatore integra esplicitamente il numero corretto,
il riesame lo riscontra anche nel CSV con lo stesso fiscale+punto: una scelta
esplicita documentata può così risolvere l'ambiguità. Zeri iniziali e codici restano stringhe.
File originale, impronta SHA256, righe normalizzate e caricatore sono privati
nel DB, senza esposizione browser delle righe. CSV non valido non sostituisce
quello precedente. Il nuovo file riaccoda gli Energia già esaminati. Per un
turno iniziale serve un caricamento nel giorno italiano del turno o successivo;
una correzione il giorno dopo può riusare la fonte già valida per quel turno.
È tracciata la data upload; non si presume una data export non presente nel file.

Il pulsante esistente in Controllo L&G continua ad aggiornare gli stati post-vendita
con le protezioni manuali correnti. L'upload per verifica archivia la fonte e
recupera il numero: **non modifica gli esiti L&G o `ultimo_csv_upload_at`**.
Per aggiornare quegli esiti resta il flusso L&G esistente. In questo rilascio
non viene unificato il caricamento fisico fra i due moduli.

## Modalità e collaudo

### Preparazione del 28/10: nuovi contratti, prove durante il giorno

Il proprietario verificherà manualmente i contratti già presenti. Nessuna nuova
analisi massiva dello storico. Il28/10 proveremo insieme i contratti inseriti
da quel giorno, uno alla volta, mantenendo **Collaudo assistito**. Il pulsante
Collauda questo contratto accoda subito la prova anche prima delle21; non modifica
il contratto, non applica i dati proposti, non invia email e non abilita il turno
automatico. Il controllo manuale finale resta disponibile in questa modalità.
Scansioni alla migliore qualità disponibile nel CRM; copia WindTre separata,
la cui generazione automatica non fa parte di questa preparazione.

Correzioni del27/10 pubblicate su richiesta con84bb310:

- Lettura tramite tool forzato `trascrivi_documento`, schema per tipo allegato e
  validazione server di tutti i campi. Anche i booleani, incluso false, richiedono
  valore/pagina/citazione; campi incerti null. Un solo secondo tentativo su
  formato errato; se ancora errato resta errore tecnico, senza inventare evidenze.
- Testo digitale del medesimo PDF ricostruito per coordinate e fornito con numeri
  pagina; PDF originale inviato comunque integro per la lettura visiva delle
  scansioni e delle pagine ibride. Nessun dato atteso CRM fornito come suggerimento.
  Testo limitato a60pagine/100mila elementi/120mila caratteri/20mila per pagina/5s;
  se assente, eccessivo o non estraibile il lettore usa comunque il PDF visuale.
- Cache con versione lettore esplicita oltre a modello/prompt e SHA256 dei byte.
  Modello Haiku4.5 e chiavi esistenti conservati, senza dipendenze o env nuove.
- Il dettaglio aggiorna l'esito dopo il clic senza dover chiudere e riaprire il
  popup. Il polling preserva il campo data firma mentre è in modifica.

Verifiche locali:426test (425versionati + test Backup preesistente),46mirati
sul modulo, harness PostgreSQL isolato OK. Prove: booleano false, risposte
malformate/duplicate/incomplete, pagina/evidenza, PDF testuale/ibrido/senza testo,
collaudo prima del turno, cron senza backlog/email e polling con focus.
Non attestano l'accuratezza OCR dei futuri documenti: nel primo fascicolo del28/10
controllare intestazione, data firma, identità/scadenza e SIM o bolletta/CSV.
Qualsiasi lettura ambigua o discordante deve restare da verificare.

Pubblicazione verificata: main84bb3100ecb971be5f95a162039199abf750f7e3, CI40563525900
425/425 riusciti; Netlify6ae0f23563f8ffded0ed96e1 con SHA corretto, JS/CSS/script
inline identici al commit e API gestisci-verifica-automatica/gestisci-vendita-contratto
senza JWT401. Il push non modifica la modalità né accoda prove. Progetto
Supabase dichiarato ACTIVE_HEALTHY e gateway pubblico raggiungibile, ma letture
SQL/REST autorizzate in timeout, connessione diretta con errore risoluzione host.
Nessuna configurazione modificata; ultima modalità confermata collaudo, da
riconfermare prima del test. Non dedurre da questi limiti diagnostici un guasto
applicativo o una nuova conferma dello stato dati. Nessuna analisi cliente,
email o approvazione eseguita in questo intervento. Nessun browser usato.

### Primo collaudo reale: storico e scansioni (27/10/2026)

Diagnostica successiva al rilascio, non miglioramenti già implementati. Il primo
collaudo reale resta `da_verificare`; configurazione confermata `collaudo`.
La pratica esaminata risale al 26/10 e ha i nuovi campi PDA vuoti, ma PDA,
identità e contratto firmato sono tutti correttamente collegati al contratto.
Non attribuire quindi questo caso a documenti scollegati o automaticamente
estendere il recupero ad altri contratti della stessa pratica.

La PDA originale contiene testo digitale estraibile; identità e contratto firmato
sono scansioni senza testo, immagini CCITT 1656x2339 su foglio A4. Il documento
d'identità occupa solo parte del foglio. Ispezione PDF locale con skill PDF,
nessun browser; copie e anteprime esclusivamente in `.backup-private/`.
Il numero di byte del file da solo non misura la leggibilità.

Difetto distinto dalla qualità: il lettore ha restituito `portabilita:false`
come booleano diretto, invece dell'oggetto con valore/pagina/evidenza richiesto;
il motore lo scarta e segnala dato non leggibile. Le altre letture riportano
discordanze fiscali/anagrafiche fra fonti: non sono automaticamente documenti
sbagliati, né prove che tutti i dati siano materialmente irrecuperabili.

Prossimo intervento: compatibilità dei dati storici senza presumere campi nuovi
già compilati; estrazione del testo PDA con pagina/sezione/evidenza; lettura delle
scansioni per regioni utili (fronte/retro, anagrafica, codici, data, seriale),
validazione dello schema e secondo tentativo mirato su letture incerte o
discordanti. Confrontare gli esiti con il proprietario prima di attivare il turno
automatico. Nessuna normalizzazione deve inventare pagina/evidenza a un booleano.
Separare nei messaggi dato storico assente, lettura incerta e discordanza provata.
Ingrandimenti/contrasto/rotazioni non ricostruiscono cifre realmente perse;
evitare ricostruzione generativa di documenti e approvazioni basate sui dati CRM
come suggerimento al lettore. Un eventuale modello più capace va misurato sui
medesimi campioni, non considerato risolutivo a priori.

Confermato dal proprietario: è possibile conservare nel CRM l'originale migliore
e inviare a WindTre una copia compressa. L'helper browser inoltra il File senza
conversione e la function upload salva `file.buffer` senza ricompressione; il
percorso attuale consente quindi di conservare il PDF ricevuto con la sua qualità.
Per le nuove acquisizioni la fonte della verifica sarà l'originale; la copia
WindTre dovrà essere derivata separatamente senza sovrascriverlo. La generazione
automatica e la gestione di due versioni non sono ancora sviluppate. Restano da
conoscere peso massimo e impostazioni accettate da WindTre prima di definire la
trasformazione; nessuna compressione arbitraria introdotta. Lo storico continua
ad avere soltanto le fonti già disponibili, salvo integrazione dell'originale.
Nessun cambio codice, schema, modalità o deploy eseguito durante questa diagnosi.

Approfondimento successivo su possibile perdita qualità nell'upload: ispezionati
selezione/anteprima (`URL.createObjectURL(file)` in iframe), helper FormData,
parser multipart, upload ordinario/staging, fanout identità, promozione PDA
(`storage.move`) e apertura/download tramite signed URL senza trasformazioni.
Anche la versione upload precedente al 27/10 (7c5afef) inoltra il buffer originale.
Prova locale con helper reale, Request/FormData e handler reale, auth/DB/Storage
simulati senza rete: i tre PDF del fascicolo, sia ordinario sia staging, arrivano
all'interfaccia Storage identici byte per byte (sei confronti SHA256 riusciti).
Non è un upload/download production né il confronto con il file sul PC prima
del caricamento storico: per escludere una differenza in quel caso serve tale
originale esatto, da confrontare con il download del medesimo allegato.
Il codice esaminato non applica ricompressione/rasterizzazione del file salvato.
L'anteprima locale usata nella diagnosi era renderizzata a lato massimo 1800px;
non rappresenta tutti i pixel della scansione 1656x2339. Il fornitore AI rasterizza
inoltre i PDF per l'analisi, con risoluzione gestita dal fornitore: eventuali
limiti di questa lettura non dimostrano una modifica dell'originale nel CRM.
Evitare di attribuire automaticamente ogni errore OCR alla qualità della fonte.

Configurazione singleton `vendita_verifica_config.modalita`:

- `collaudo` (default): analisi di una pratica selezionata dall'admin, nessuna
  modifica al contratto e nessuna notifica. Vengono registrati soltanto lavoro,
  valutazione e audit nelle nuove tabelle private. Il collaudo non anticipa il
  primo turno automatico e non conta come primo tentativo reale.
- `attiva`: primo turno serale, riesame dei sospesi e notifiche abilitati.
  La conferma manuale è nascosta e rifiutata dal backend; si salvano le correzioni.
- `spenta`: nessuna nuova analisi. Un lavoro automatico già avviato non può
  confermare se la modalità è stata disattivata prima del commit.

Il pannello admin permette di scegliere la modalità con conferma MiroxUI.
Per collaudare insieme: aprire un contratto non controllato, scegliere
«Collauda questo contratto», leggere controlli/errori/dati ricavati nel dettaglio,
confrontare i PDF con il proprietario, correggere e riprovare. Minimo un minuto
fra prove sulla stessa pratica. L'esito si aggiorna senza ricaricare la pagina.

Un documento senza data firma o un Business senza prova del firmatario resta
bloccato con motivo esplicito; non si presume che upload coincida con firma.
Le letture reali e la qualità OCR vanno collaudate sui fascicoli del proprietario:
i test sintetici non certificano quelle letture.

## Affidabilità e notifiche

Claim atomico con lease 12 minuti, revisioni e controllo ottimistico. Una modifica
di contratto/allegati/CSV/anagrafica durante l'analisi impedisce di applicare
l'esito obsoleto. Conferma, audit e creazione notifiche avvengono nella stessa
RPC transazionale. Nessuna persona simulata: `controllato_da=NULL` per il sistema,
nota automatica e audit separato. I punteggi non vengono ricalcolati dal catalogo.

Massimo2lavori concorrenti. Massimo 5 tentativi tecnici con attesa crescente; esaurimento segnala Da verificare
con un motivo tecnico comprensibile e notifica. Limiti lettura: 20 PDF, 20 MiB e
60 pagine per file, 50 MiB per fascicolo e controllo tempo fra documenti.
Fornitore e modello riusati dall'OCR corrente: Claude Haiku 4.5
`claude-haiku-4-5-20251001`, `ANTHROPIC_API_KEY` esistente. Nessuna nuova dipendenza
npm o modifica alle chiavi esterne. I file sono inviati direttamente dal backend.
La cache privata usa hash byte PDF + modello + hash prompt; un nuovo CSV riusa le
letture invariate, mentre il collaudo richiesto dall'admin forza una nuova lettura.

- CB Reload Disattivazione cliente dopo verifica positiva: `info@konatech.it`.
- Professional Cloud Mobile/Fisso Business Si + Richiedi disattivazione: `mirko.piasenti@gmail.com`, stessi tempi di Reload, con promemoria dedicato (estensione pubblicata 28/10).
- Esito Da verificare: motivi/azioni semplici in italiano a `mirko.piasenti@mail.com`.
- La sola attesa CSV non invia l'email problemi. Nessun invio WhatsApp automatico.

Outbox privata con dedupe. Rifiuti SMTP certi temporanei vengono ritentati;
fallimenti permanenti restano visibili. Invio incerto o processo morto dopo SMTP
restano da riconciliare, senza reinvio cieco. SMTP accettato non significa letto
o consegnato. Le email contengono riferimento e link autenticato, mai PDF identità.
Gli admin vedono le notifiche incerte/fallite e possono confermare la ricezione
oppure richiedere esplicitamente il reinvio dopo controllo, con autore e data registrati.

## Componenti e installazione

Migration `database/20261027172616_verifica_automatica_contratti.sql`, generata
con CLI e collaudata in PostgreSQL isolato. Aggiunge sei tabelle server-only
con RLS e grant esclusivamente service_role: configurazione, verifiche, CSV,
esecuzioni, cache letture, notifiche. Nuovi trigger INVOKER solo su tabelle vendita/pratiche/
documenti, nuove RPC server-only; nessuna modifica schema/RLS/RPC CC o anagrafica.

- `gestisci-verifica-automatica`: status, collaudo, riesame, data firma, CSV,
  modalità; JWT/account attivo, admin per collaudo/CSV/configurazione.
- `verifica-contratti-background`: worker autenticato HMAC con chiave derivata
  e contesto dedicato dalla service role, firma con timestamp valido60s;
  nessun riuso dei segreti Guardian/Target e nessuna nuova env richiesta.
- `cron-verifica-contratti`: recupero ogni minuto, solo production; in collaudo
  recupera soltanto prove esplicitamente richieste, in attiva anche turni e notifiche.
- `js/verifica-contratti-core.js`: regole pure condivise; relativo JS/CSS pagina.

Migration applicata il27/10/2026 e nome file allineato al registro Supabase;
rilascio del codice autorizzato dal proprietario mantenendo `collaudo`. Avviare prima le prove assistite e soltanto dopo scegliere
`attiva`. Push/deploy richiedono richiesta esplicita secondo AGENTS.md.
Sei tabelle private e sei RPC verificate: anon/authenticated senza grant, solo
service_role. Configurazione collaudo,31lavori registrati e zero analisi/notifiche;
2720contratti con impronta stati identica prima/dopo. Nessun messaggio di prova inviato.

Verifiche: `npm test` e
`MIROX_PGLITE_MODULE=/percorso/node_modules/@electric-sql/pglite node scripts/verifica-automatica-sql.js`.
SQL test con grant, claim, collaudo, invalidazione concorrente, rollback patch,
commit idempotente, riapertura, riesame CSV, dedupe notifiche e anagrafica concorrente.

Suite locale finale: 410/410 test (409 versionati + test backup preesistente),
30 nuove regressioni del modulo. Nessun collaudo browser eseguito per preferenza
del proprietario. Letture AI dei fascicoli reali e qualità dell'interfaccia ancora
da verificare insieme dopo pubblicazione in modalità collaudo.

Verifica estensione Cloud 28/10 (locale): build e 481/481 test (480 versionabili
+ Backup preesistente), inclusi analisi con cluster, email escaped, rilettura scelte,
invio singolo, collaudo/spenta, SMTP temporaneo/permanente/incerto. Harness SQL
con migration reali: accodamento atomico Mobile/Fisso, destinatario, dedupe su
riesame, No/Mantieni attiva/storico/collaudo esclusi, rollback e grant/RLS invariati.
Nessuna email reale inviata, nessun contratto reale analizzato o modificato.

Rilascio completo autorizzato 28/10: feature `830d8ad`, pubblicata con `63b8e3d`,
CI `40668008246` verde 481/481 test versionati; deploy Netlify
`6ae1c683d971bd720e2c580e` verificato per SHA e asset UI. Migration produzione
`20261028095719` applicata dopo il worker compatibile, definizione/grant riletti:
Cloud destinatario Gmail, vincolo valido, INVOKER e service_role invariati.
Advisor sicurezza/performance invariati, modalità collaudo, zero notifiche e zero
verifiche in corso; nessuna email di prova né analisi di contratti reali.
