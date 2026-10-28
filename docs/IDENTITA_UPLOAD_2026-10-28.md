# Identita nell’Upload Contratti e permesso di soggiorno

Rilascio autorizzato dal proprietario il 28/10/2026 con «push di tutto».
Migration applicata a production, versione `20261028131258`; deploy in corso.
Richiesta: anticipare soltanto il controllo del documento di riconoscimento;
PDA, firma, SIM, bollette e CSV rimangono nella verifica automatica successiva.
Il proprietario conferma per Business il confronto con **Nome referente**.

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

Confronto Consumer/Turista: nome e CF con anagrafica; se CF assente nel documento,
serve nascita coerente col CF dell’anagrafica. Business: nome con Nome referente,
non con ragione sociale o partita IVA. Nomi normalizzati anche per ordine/accenti.
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
Il motore `2026-10-28.1` confronta identita con anagrafica anche in lettura serale;
Business usa Nome referente. Se la PDA dichiara una persona diversa, resta un
problema del contratto. Riusa l’esito upload solo se anagrafica e insieme dei byte
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
Build e suite completa: 495/495 test Node riusciti, con 68 test Python Backup
completi nel relativo harness; prove SQL identita e verifica automatica riuscite.
Accuratezza OCR e collaudo grafico con scansioni reali restano da fare insieme.
Ordine di rilascio: migration additiva applicata prima del push; endpoint, client
e backend pubblicati insieme per il nuovo formato ricevuta. Modalita serale
`collaudo` riconfermata dopo la migration; nessuna verifica/email avviata.
