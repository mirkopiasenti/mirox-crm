# Identita nell’Upload Contratti e permesso di soggiorno

Rilascio autorizzato dal proprietario il 28/10/2026 con «push di tutto».
Migration applicata a production, versione `20261028131258`.
Codice `fe5cfd0` pubblicato su Netlify `6ae1f51da2899fc2fc7f5ec9` alle
14:14:53 Europe/Rome; CI `40694567890` riuscita, asset HTTP identici e API
protetta (401 senza JWT). Advisor sicurezza invariati prima/dopo la migration.
Richiesta: anticipare soltanto il controllo del documento di riconoscimento;
PDA, firma, SIM, bollette e CSV rimangono nella verifica automatica successiva.
Business aggiornato su richiesta successiva: CF personale dalla PDA e scadenza;
Nome referente resta il riscontro quando manca il CF sul documento o la PDA.



### Identita Business: CF del rappresentante dalla PDA (28/10/2026)

Il controllo anticipato legge dalla PDA Business il CF personale nella sezione
rappresentante legale/delegato, distinto da PIVA aziendale e pagatore SEPA.
Prima riscontra CF/PIVA aziendale con l’anagrafica CRM; poi confronta esattamente
CF del rappresentante con documento e scadenza alla firma. Con CF coincidente
il nome OCR e informativo anche Business. Senza CF sul documento resta il
riscontro Nome referente completo e nascita coerente; se incerto serve manuale.
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
Senza CF restano nome completo e nascita riscontrata nel CF CRM, oppure controllo
manuale se incerto. Business usa il CF personale dalla PDA come descritto sotto;
la PIVA aziendale non identifica la persona. Nessuna nuova colonna anagrafica.
Motore successivo versione `2026-10-28.2` usa la medesima priorita; PDA/intestazione,
MNP/ICCID, Energia/CSV e notifiche invariati. Ricevuta salva `criterio_identita`
e `confronto.nome_informativo`; firme/hash/anagrafica e regole anti-risposte tardive
restano vincolati come prima. Diagnostica nomi conservata; ricontrollo nome resta
solo nei percorsi senza riscontro CF, con conferma manuale tracciata
se due letture discordano e gli altri identificativi coincidono.
Nessuna migration/env/dipendenza o modifica dei dati CRM. Push richiesto dal
proprietario insieme all’estensione Business. Fonte CIE: https://www.cartaidentita.interno.gov.it/cose-la-carta/caratteristiche-del-documento/

### Diagnostica nome e ricontrollo identita (28/10/2026)

Dopo un blocco reale, l’operatore conferma nome/CF identici a carta e PDA. Il
vecchio esito non conserva sul server la trascrizione dell’upload rifiutato:
non attribuire lettere specifiche all’AI senza la relativa risposta. Nessuna
correzione dell’anagrafica omonima con altro CF senza riscontro/autorizzazione.
Il risultato espone `confronto` con campo anagrafico usato, nome atteso e nomi
trascritti. UI escaped nel popup di blocco (Controlla/Aggiungi/Invia) e conferma
manuale; i nomi restano fuori da error.message/telemetria, nessun CF aggiunto al log.
Nei percorsi senza CF coincidente, se l’unico errore certo e il nome
e il primo giro dura meno di18secondi, il backend
richiede una seconda lettura indipendente dello stesso PDF, senza nome atteso o
prima risposta. Istruzione su campi stampati/MRZ, non firma/annotazioni; timeout
SDK20secondi e un solo tentativo formato nel ricontrollo, nessun retry illimitato.
Se seconda lettura coincide con anagrafica, stesso numero documento, nessuna
contraddizione CF/nascita/scadenza/tipo e nessun altro errore, il nome passa a
INCERTO: restano entrambe le trascrizioni e la seconda lettura nella ricevuta,
conferma manuale esplicita/motivo obbligatori. Mai approvazione automatica del
nome discordante. Fallimento, errore stabile o altri dati discordanti conservano
il blocco; CF/documento diverso/scadenza non aggirabili. Nessuna migration/env
nuova, nessun dato anagrafico atteso inviato al modello.
Correzione inclusa nel push richiesto insieme al Business; regressioni sintetiche
e nessuna nuova chiamata Anthropic sui PDF reali, ispezionati localmente.

## Flusso operatore

Nello step Documenti si caricano i PDF del medesimo documento (massimo quattro,
20 MB complessivi) e si indica la data effettiva di firma per controllarne la
validita, senza preselezionarla dalla data upload. Il pulsante Controlla documento
consente il riscontro immediato; Aggiungi al carrello e Invia lo richiedono comunque.
Identita condivisa fra tutti i contratti della pratica, con copie Storage indipendenti.

Il lettore riconosce carta d’identita, passaporto e patente; trascrive nome, CF
italiano esplicito, nascita, scadenza, tipo, numero documento, cittadinanza esplicita e presenza delle
parti necessarie. Ogni campo richiede pagina/citazione; dati attesi non inviati
al modello. Numeri di documento discordanti fra PDF sono bloccanti. Fronte/retro per carta/patente, pagina dati per passaporto. Nessuna
biometria o certificazione di autenticita. Modello Haiku 4.5 e chiave esistenti,
nessuna nuova dipendenza o env. Errori di lettura diventano esito incerto; PDF
invalido o fuori limite resta bloccante. Letture parallele limitate a quattro;
client Anthropic timeout 20 secondi, senza retry SDK, un solo retry sul formato.

Confronto Consumer/Turista aggiornato: CF esatto prioritario e nome
informativo; se CF assente nel documento,
serve nome completo e nascita coerente col CF dell’anagrafica. Business: CF
rappresentante dalla PDA come sopra; senza PDA si usa Nome referente. Nomi normalizzati anche per ordine/accenti.
Se il record CRM esiste, viene letto e confrontato prima dell’AI. Soltanto i campi
anagrafici ancora vuoti possono essere presi dal form; differenze nei dati gia
presenti richiedono di correggere/rileggere l’anagrafica. Nuovi clienti confrontati
col form anagrafico, poi nuovamente col record CRM effettivamente salvato.
L’endpoint di analisi non scrive l’anagrafica.

Esiti: coerente, da correggere, da confermare. Problemi certi bloccano; per
incertezze l’operatore controlla il documento, conferma esplicitamente e descrive
il controllo (almeno dieci caratteri). Scadenza non leggibile richiede una data
verificata manualmente, valida alla firma. Autore, data e motivo sono conservati.

## Permesso di soggiorno

Regola operativa scelta dal proprietario: obbligo solo con tutte le condizioni:
Mobile, Consumer, dispositivo associato, acquisto VAR, cittadinanza extra UE.
Sono esclusi Fisso, Customer Base, Business, Turista, Finanziamento e nessun
dispositivo. UE comprende Italia e gli altri 26 Stati; non equivale a Schengen.
Fonte elenco: https://european-union.europa.eu/principles-countries-history/eu-countries_en
Paese di residenza, nascita, rilascio documento, nome e CF non provano cittadinanza.
Cittadinanza ISO esplicita dal documento; se assente, per i soli Consumer VAR
serve conferma UE/extra UE con motivo. Una cittadinanza UE fra piu cittadinanze
rende la richiesta non necessaria. Incerto non diventa automaticamente extra UE.
Per gli altri contratti, cittadinanza sconosciuta non blocca da sola l’invio.

Dopo il riscontro extra UE appare il nuovo upload PDF Permesso di soggiorno
per il contratto interessato. File conservati nel medesimo bucket privato,
con tipo `permesso_soggiorno`, nomi progressivi e riferimenti al contratto.
Nel carrello si conservano i file; il draft salva soltanto metadati, quindi dopo
refresh servono riselezione e nuovo controllo. Le modifiche del contratto
ripristinano gli allegati selezionati; nessun file ereditato da un altro contratto.
Il permesso viene controllato per presenza/PDF e integrita, non con OCR o una
nuova validazione della sua scadenza: questa estensione richiede l’upload.

## Controlli server e persistenza

Nuova `verifica-identita-upload`: JWT/account attivo e permesso `upload_contratti`,
multipart per analisi, JSON per conferma manuale. Ricevuta HMAC con contesto
separato, autore, snapshot anagrafico, hash SHA256 dei PDF, letture ed esito.
Durata quattro ore; non trasferibile ad altri utenti/dati. Il client non puo
sostituire l’esito con un semplice flag. Nome/date/file cambiati invalidano il riuso;
risposte tardive scartate e richieste simultanee accorpate.
L’invalidazione copre anche le modifiche durante il calcolo locale degli hash.

`crea-vendita-pratica-carrello` richiede ricevuta valida prima delle scritture,
confronta nuovamente l’anagrafica salvata e registra l’audit nella pratica.
`upload-vendita-documento` calcola il digest dei byte; le identita nelle nuove
bozze devono coincidere con i PDF controllati. `finalize` verifica copertura di
tutti gli hash per ciascun contratto, anagrafica attuale e permesso per ogni
Consumer VAR extra UE. Cittadinanza sconosciuta non consente di aggirare l’obbligo.
Il nuovo tipo di upload e rifiutato fuori perimetro. Gli eventi CC vengono chiusi
soltanto dopo questi controlli, con il flusso esistente.

Migration CLI `20261028122800_identita_upload_permesso_soggiorno.sql`:
`vendita_pratiche.identita_verifica_upload` JSONB e `vendita_documenti.sha256` text,
nullable per storico, CHECK coerenti. Nessun backfill, nuova tabella/RPC/trigger,
nessun cambio schema/RLS/permessi anagrafica o Call Center. Pratiche legacy gia
create senza ricevuta mantengono il controllo presenza identita esistente.
Lettura live dei soli metadati conferma pratica RLS senza policy e documenti con
scritture authenticated bloccate; digest e audit non sono impostabili dal browser.

## Verifica successiva

PDA, MNP, firme, Energia/CSV, punteggi, orari e notifiche rimangono nel loro flusso.
Il motore `2026-10-28.2` applica la priorita CF anche in lettura serale; Business
confronta CF personale PDA/documento, con controllo separato dell’azienda CRM.
Nomi OCR informativi se il CF personale coincide. Riusa l’esito upload solo se anagrafica e insieme dei byte
identita coincidono; continua a verificare la scadenza alla firma effettiva letta
nel contratto/CSV o attestata nella verifica. La data inserita nell’upload per
il primo riscontro non sostituisce in automatico la fonte firma dei singoli contratti.
PDF o anagrafica cambiati fanno perdere il riuso; si ritorna alla lettura documentale.
Se manca una parte dell’insieme controllato, vengono rilette anche le parti gia
riconosciute, evitando un fascicolo estratto parziale.
Il permesso mancante rimane bloccante anche nella verifica successiva.
Nessun abilitatore automatico della modalita attiva, invio email o approvazione.

## Verifica e pubblicazione

Test sintetici Node e DOM senza browser; helper AI/Storage simulati, nessun
file di un cliente inviato al fornitore. Harness SQL con PGlite:
`MIROX_PGLITE_MODULE=/percorso/pglite node scripts/verifica-identita-upload-sql.js`.
Testano scope UE/VAR, anagrafica/referente, date, fronte/retro, manuale, HMAC,
risposte tardive, hash/permesso al finalize, riuso serale e regressioni esistenti.
Suite iniziale: 495/495; estensione CF/Business: 519/519 test Node, con 68 test Python Backup
completi nel relativo harness; prove SQL identita e verifica automatica riuscite.
Accuratezza OCR e collaudo grafico con scansioni reali restano da fare insieme.
Ordine di rilascio: migration additiva applicata prima del push; endpoint, client
e backend pubblicati insieme per il nuovo formato ricevuta. Modalita serale
`collaudo` riconfermata dopo la migration; nessuna verifica/email avviata.
