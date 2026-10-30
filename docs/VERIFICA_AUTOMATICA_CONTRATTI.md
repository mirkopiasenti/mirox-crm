Aggiornamento pubblicato28/10: identita anticipata nell’upload con confronto anagrafica (Business CF rappresentante da PDA, Nome referente senza PDA), riuso per hash e nuova richiesta permesso Consumer VAR extra UE. Le regole seguenti restano applicate agli altri controlli; dettagli in [guida identita upload](IDENTITA_UPLOAD_2026-10-28.md).

# Verifica automatica contratti


### Anteprima manuale dopo errore e Haiku 5.5 (28/10/2026, pubblicato)

Richiesta esplicita del proprietario: dopo esito identita negativo/incerto aprire
la preview e chiedere «Confermi che il documento visualizzato nella preview e
quello del cliente in anagrafica?». Tutti i PDF selezionati sono mostrati come
originali locali in iframe blob, con apertura a dimensione intera. Si abilita
Si solo dopo il caricamento di tutte le anteprime. No/chiusura annullano; URL
revocati, testo escaped e risposte tardive scartate se cliente/file/PDA cambiano.
Si usa ricevuta HMAC e hash degli stessi PDF: nuova action JSON confirm_preview
senza AI, autore/ora/modalita preview_manuale e dichiarazione conservati con
esito_automatico originale. Su richiesta si puo superare anche un esito OCR
negativo: e attestazione umana, non successo automatico. Non serve ritrascrivere
CF o scrivere un motivo libero. Serve scadenza verificata valida alla firma;
restano anagrafica attuale, data firma, PDF validi, integrita e permesso Consumer
VAR extra UE. Cittadinanza richiesta se necessaria. Nessuna deroga ad auth,
limiti file, legame Business/PDA, controlli commerciali o verifica successiva.
Aggiungi/Invia riusano la ricevuta; nessuna nuova OCR identita dopo Si. Anche la
verifica successiva riusa il manuale solo con anagrafica e hash invariati e indica
esplicitamente che il controllo identita era manuale.

Migrazione claude-haiku-5-5 su ocr-pda e lettore condiviso verifica-documenti
(identita upload, Business, SIM, bollette, PDA e verifica serale). Rimossi sampling
non supportati; tool forzato con schema/pagina/citazione invariato. OCR iniziale
JSON, effort low e max2400token per margine adaptive thinking; lettore max5000,
cache invalidata da modello/READER_VERSION2026-10-28.4. SDK esistente verificato
sul payload HTTP simulato, nessuna nuova dipendenza/env/migration. Regole dati
PDA/MNP/Energia/CSV/Reload/Cloud invariate. Motore2026-10-28.3: CF esatto resta
prioritario, assenza CF non ripiega su nome/nascita; preview sostituisce il
precedente popup che imponeva trascrizione CF/motivo. API legacy confirm resta
compatibile. Pubblicato su richiesta: `2ebd2f5`, CI `40738017338` riuscita,
Netlify `6ae233ae628dbdd6472b432b` online18:41:45 Europe/Rome. Commit pubblico
e byte della UI verificati HTTP; API identita401 senza JWT.
Guide ufficiali consultate: https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
Build e531/531test, inclusi68Python Backup, preview DOM/annullamento/file cambiati,
riuso serale senza OCR e richieste modello via SDK simulato. Nessuna nuova
chiamata AI live, modifica dati CRM, email o cambio modalita serale.

### Identita Business: CF del rappresentante dalla PDA (28/10/2026)

Pubblicato `920f530`, CI `40728727037` riuscita, Netlify
`6ae22620679a1843b7adb624` online alle17:43:57 Europe/Rome. Build e519/519
test riusciti; commit e asset UI verificati HTTP, API401 senza JWT.

Il controllo anticipato legge dalla PDA Business il CF personale nella sezione
rappresentante legale/delegato, distinto da PIVA aziendale e pagatore SEPA.
Prima riscontra CF/PIVA aziendale con l’anagrafica CRM; poi confronta esattamente
CF del rappresentante con documento e scadenza alla firma. Con CF coincidente
il nome OCR e informativo anche Business. Nel rilascio precedente, senza CF sul documento si usavano nome/nascita;
la correzione sopra richiede ora conferma esplicita del CF.
Per categorie senza PDA resta Nome referente, senza confrontare persona e PIVA.
CF persona non leggibile nella PDA Mobile/Fisso/CB richiede copia completa.

Helper `_lib/pda-business-identity.js`: testo digitale con pagina/citazione,
fallback AI indipendente solo per dati mancanti; ambiguita o discordanza bloccano.
Mai inviare valori CRM attesi al modello. Ricevuta HMAC esistente conserva
`business_identity` con CF persona e prove PDA (codice, azienda, SHA256, lettura).
Il browser trasmette i percorsi staging, non decide il CF verificato. Tutte le
PDA del carrello devono riferirsi alla medesima persona, altrimenti pratiche separate.
Cambio PDA invalida cache/risposte tardive; create e finalize rileggono i byte
prima dell’invio. Digest PDA promosso nel campo sha256 esistente. Riuso serale
solo con identita e PDA del singolo contratto identiche; altrimenti nuova lettura.
Ricevute Business precedenti senza prove PDA richiedono nuovo controllo upload.
Nessuna migration, colonna anagrafica, dipendenza o env nuova. Modalita collaudo,
notifiche Reload/Cloud e controlli successivi restano invariati.
Verificati i due PDF Mobile/Fisso forniti con parser reale senza chiamate AI;
regressioni sintetiche su CF errato, fonti diverse e sostituzione dei file.

### Identita Consumer: CF e scadenza prioritari (28/10/2026)

Su richiesta successiva del proprietario, se il documento riporta un CF italiano
identico a quello dell’anagrafica Consumer/Turista, i riscontri principali sono
CF esatto e scadenza valida alla data firma. Nome OCR informativo: assenza o
trascrizione diversa non bloccano, non impongono conferma manuale e non avviano
il secondo giro AI. Nessuna correzione approssimata delle cifre/lettere del CF.
Un CF esplicito diverso blocca anche con nome uguale; scadenza non leggibile
richiede conferma manuale, scaduto alla firma blocca. Restano tipo riconosciuto,
numero documento, parti necessarie e coerenza fra PDF: non approvare tessere
sanitarie o allegati incompleti soltanto perche riportano un CF. Si verifica la
coerenza documentale, non l’autenticita/identificazione biometrica da scansione.
Il precedente fallback senza CF su nome/nascita e superato dalla correzione
sopra: assenza CF richiede conferma esplicita, mai blocco sul nome. Business usa il CF personale dalla PDA come descritto sotto;
la PIVA aziendale non identifica la persona. Nessuna nuova colonna anagrafica.
Motore successivo versione `2026-10-28.2` usa la medesima priorita; PDA/intestazione,
MNP/ICCID, Energia/CSV e notifiche invariati. Ricevuta salva `criterio_identita`
e `confronto.nome_informativo`; firme/hash/anagrafica e regole anti-risposte tardive
restano vincolati come prima. Diagnostica nomi conservata; ricontrollo nome resta
solo nei percorsi senza riscontro CF, con conferma manuale tracciata
se due letture discordano e gli altri identificativi coincidono.
Nessuna migration/env/dipendenza o modifica dei dati CRM. Pubblicato su
richiesta del proprietario insieme all’estensione Business. Fonte CIE: https://www.cartaidentita.interno.gov.it/cose-la-carta/caratteristiche-del-documento/



### Email anche nel collaudo assistito (28/10/2026, attivo)

Reload ora invia a `mirko.piasenti@gmail.com`, come Professional Cloud; i problemi
restano a `mirko.piasenti@mail.com`. Nuove colonne private configurazione
`email_collaudo` (default false) e `email_collaudo_at` delimitano l’abilitazione.
Con modalita collaudo e flag attivo: mail problemi per nuovi collaudi richiesti
con esito Da verificare e revisione/anagrafica correnti; Reload/Cloud dopo conferma
assistita tracciata nell’audit e collegata all’esecuzione conforme. Solo eventi
successivi all’abilitazione: nessun recupero massivo dei vecchi test. Attesa CSV
senza mail problemi; dedupe condivisa con la modalita attiva. Reload in coda non
inviato aggiornato al nuovo destinatario; gli invii incerti restano da riconciliare.
RPC `vendita_verifica_accoda_email_collaudo` INVOKER/search_path vuoto e service-only,
senza schema/RLS/trigger CC modificati. Worker/cron possono elaborare soltanto
notifiche (`notifications:true`, HMAC) mantenendo fermi turni e backlog contratti.
Gli errori tecnici dopo cinque tentativi producono esito/mail anche in collaudo.
UI mostra lo stato delle email, checkbox admin e reinvio esplicito quando abilitato.
Migrazione sorgente `20261028153619_verifica_email_collaudo_reload.sql`, applicata
production `20261028154059`; flag abilitato il28/10 alle16:45:15 Europe/Rome
dopo il deploy `838c0a6` / Netlify `6ae21810a3cc31721d8192c3` (16:43:59),
CI `40718797608` riuscita. SHA/UI verificati HTTP e dispatch notifiche-only202.
Coda vuota alla rilettura, nessuna email fittizia inviata e nessun nuovo collaudo
avviato. Modalita serale collaudo invariata; advisor sicurezza invariati.
Build e504/504test riusciti, harness SQL esteso riuscito. Nessuna nuova env/dipendenza.



### Collaudo assistito con conferma del singolo contratto (28/10/2026)

Il proprietario autorizza Codex a confermare il singolo contratto dopo un collaudo
interamente positivo, senza chiedere una nuova autorizzazione per ogni conferma.
La simulazione del worker resta separata dalla conferma assistita successiva;
questa autorizzazione non abilita la modalita automatica serale o test massivi.
Prima della conferma controllare ultima esecuzione collaudo conforme e recente,
versione corrente, zero errori/attese, revisione non cambiata, nessuna analisi in
corso e fingerprint identico di contratto/anagrafica/pratica/documenti/regole.
Rileggere anche i byte degli allegati e confrontare SHA256/pagine con le prove.
Eventuali integrazioni vanno salvate e riscontrate in un nuovo collaudo coerente.
Conferma transazionale con confronto ottimistico e audit: stato contratto e
verifica `controllato`, job fermo, autore assistito esplicito nelle note/log;
non attribuire l’azione a un profilo umano inventato. Punteggi e dati commerciali
inalterati. Problemi, attese CSV o cambiamenti bloccano la conferma. Le notifiche
restano soggette alla configurazione esistente; nessuna attivazione globale.
Nessuna nuova modalita UI, migration o modifica schema/RLS/CC: procedura operativa.

Prima conferma assistita del28/10 eseguita dopo rilettura di entrambi i PDF,
fingerprint identico e zero errori/attese del collaudo online. Contratto e verifica
controllati, job fermo, una voce audit dedicata; solo quattro campi conferma
modificati, nessun punteggio/dato commerciale cambiato e zero notifiche.

## Correzione dopo primo collaudo reale del28/10

Il proprietario conferma il caso Mobile nuova SIM senza portabilita: numero
definitivo e numero della SIM sono quelli in `DATI DELLA SIM WINDTRE`, distinti
dal recapito per firma elettronica. L’AI serale lasciava portabilita null mentre
il parser upload la riconosceva false. La PDA del caso era nitida e digitale.

Il lettore `2026-10-28.1` riusa il parser per coordinate: integra false e
numero SIM con pagina/citazione soltanto su Mobile, in assenza di MNP, se tutte
le pagine contengono testo e numerazione progressiva coerente. Controlla anche
le immagini: piccoli loghi consentiti, immagini estese o operazioni non
riconosciute rendono incerta la deduzione. I PDF scansionati, parziali e le
numerazioni ambigue non diventano automaticamente nuove attivazioni; evidenze
AI esplicitamente discordanti restano bloccanti. Gli altri tipi non cambiano.

Nuovo `readPdfData` nel parser condiviso espone campi, pagine e completezza dal
medesimo PDF; `readPdfFields` conserva il comportamento upload preesistente.
Cache con nuova versione, nessuna migration/env o dipendenza. Pubblicata con
`a609019`, CI `40704725248` riuscita e Netlify `6ae204566efd25ade3a381f4`
online alle15:19:45 Europe/Rome. Rivalutazione locale del caso con PDF reale e precedente
trascrizione AI: esito conforme, zero errori; tutte le scritture intercettate,
nessuna nuova chiamata AI. Collaudo online ripetuto dopo il deploy: esito conforme, zero errori/attese.
Il contratto resta da_controllare e le notifiche sono zero. Modalita collaudo
invariata. Nessuna approvazione/email.

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
  del cliente; per Business CF personale del rappresentante dalla PDA e documento; Nome referente nelle categorie senza PDA.
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
il contratto, non applica i dati proposti e non abilita il turno; le email sono
  disponibili con email_collaudo attivo. Non abilita il turno
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

Un documento senza data firma o un Business senza CF personale PDA/documento
riscontrabile (Nome referente e nascita dove previsto) resta bloccato con motivo esplicito; non si presume che upload coincida con firma.
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
Fornitore e modello dell’OCR corrente: Claude Haiku 5.5
`claude-haiku-5-5`, `ANTHROPIC_API_KEY` esistente. Nessuna nuova dipendenza
npm o modifica alle chiavi esterne. I file sono inviati direttamente dal backend.
La cache privata usa hash byte PDF + modello + hash prompt; un nuovo CSV riusa le
letture invariate, mentre il collaudo richiesto dall'admin forza una nuova lettura.

- CB Reload Disattivazione cliente dopo verifica positiva: `mirko.piasenti@gmail.com`.
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

## Evoluzione locale 29/10: scanner guidato e barcode reale

QR automatico nello step Documenti con acquisizione smartphone fronte/retro in
memoria; fallback PDF e preview manuale esistenti. CIE sola/TS facoltativa,
cartacea o patente con TS fronte/retro; passaporto/Turista PDF e manuale senza OCR
identita. Decoder server ZXing sui byte PDF e checksum CF: valore univoco completo
prevale sulle lettere AI; assenza/incompletezza/conflitti richiedono manuale. TS
fonte CF, distinta da numero/tipo/scadenza identita. Business mantiene CF personale
dalla PDA e riscontro azienda. Modello AI invariato, ancora usato per scadenza/parti
e altri documenti; versione lettore e core serale2026-10-29.1. Riuso ricevuta upload
solo con dati/byte/PDA invariati. Nessuna attivazione verifica o invio nuovo.
Codice non pubblicato; migration privata gia pronta. Test sintetici non convalidano
qualita reale: collaudo iPhone/Android e documenti con proprietario ancora necessario.
[Architettura, sicurezza, verifiche e limiti](SCANNER_DOCUMENTI_2026-10-29.md).

### Preparazione scanner30/10

Motore/lettore2026-10-30.1: CF della sola tessera richiede confronto indipendente
di nome e nascita fra identita e tessera, come scelto dal proprietario30/10.
Nessun blocco generale nome OCR contro anagrafica. Dati mancanti/discordanti o
CF diverso stampato sull’identita richiedono controllo manuale della coppia.
Tessera richiesta incompleta comporta controllo manuale quando la ricevuta upload
non e riusabile. Ricevuta manuale valida con medesimi byte/cliente/cluster/PDA
continua a evitare OCR identita serale. Altri controlli e notifiche invariati.
Preflight read-only: modalita collaudo,email_collaudo=true,0collaudi pendenti o
verifiche in corso. Nessuna nuova verifica/email/scrittura avviata. Rilascio da
pubblicare solo su richiesta; rapporto SCANNER_COLLAUDO_RILASCIO_2026-10-30.md.
