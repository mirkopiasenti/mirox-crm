# Planning dipendenti — rilascio 29/10/2026

Modulo richiesto dal proprietario per novembre 2026 in poi, solo Legnago.
Rilascio autorizzato dal proprietario29/10: soltanto planning, esclusi i commit scanner.
Migration production20261029210434 applicata; deploy in corso di verifica dal checkout isolato basato su origin/main7f9d930.
Nessuna modifica agli account, alle gare o alle tabelle condivise col Call Center.

## Accessi e pagine

- Admin → Personale → Planning dipendenti (`admin-planning.html`): planning, schede ore e configurazione.
- Dashboard → Applicazioni → Il mio planning (`planning-personale.html`): solo versione approvata del dipendente collegato al login.
- La pagina personale usa la proprieta' del planning e non aggiunge una ventesima ACL al catalogo Vendita/Post-Vendita. Il link e' disponibile agli autenticati; un account non collegato riceve un messaggio, nessun dato personale.
- Il collegamento account/dipendente e' esplicito in Dipendenti e orari, modificabile solo dagli Admin. Nessun riconoscimento dal nome, nessuna creazione o riattivazione automatica di account. Vincenzo richiede un proprio account esistente prima di poter essere collegato; i PDF restano utilizzabili senza collegamento.
- Francesca non e' nei dipendenti iniziali; nessuna cancellazione, disattivazione o rinomina del suo profilo CRM.

## Orari iniziali confermati

| Dipendente | Contratto settimanale | Lun-ven, giornata piena | Sabato pieno |
|---|---|---|---|
| Matteo | 40 ore | 09:30-12:30; 15:30-19:30 | 09:30-12:30; 15:30-19:00 |
| Vincenzo | 40 ore | 09:00-12:00; 15:30-19:30 | 09:00-12:30; 15:30-19:00 |
| Isabella | 30 ore | 09:00-12:30; 15:30-19:00 | Riposo |

Isabella lavora lunedi-venerdi: 35 ore programmate confermate, distinte dalle 30 contrattuali dichiarate. Matteo: 38h30 nella settimana con lunedi mattina libero, 38h nella settimana con sabato pomeriggio libero. Vincenzo: rispettivamente 39h e 38h30. Le fasce sono modificabili; non si aggiungono ore o straordinari per raggiungere il monte contrattuale.

Matteo e Vincenzo si alternano settimanalmente: uno ha libero il lunedi mattina e lavora sabato pomeriggio, l'altro fa il contrario. L'Admin sceglie chi ha libero il primo lunedi del mese e applica l'alternanza. Per novembre, lunedi 2, la scelta del proprietario resta aperta: il sistema non la decide e impedisce di pubblicare senza assegnazione. Nei mesi che iniziano a settimana avviata, i giorni precedenti il primo lunedi appartengono alla settimana alternata precedente. La scelta va controllata anche nei mesi successivi per mantenere continuita'.

Domenica riposo nel modello iniziale. Festivita' nazionali e Pasqua/Pasquetta sono evidenziate, non trasformate automaticamente in chiusure o ferie. Nel dettaglio e' possibile marcare una chiusura senza turno; chiusure patronali o straordinarie sono manuali.

## Flusso mensile

1. Configurare dipendenti, eventuale ultimo mese di presenza, account e orari ricorrenti; salvare la configurazione.
2. Aprire il mese, scegliere l'alternanza e applicare gli orari. Questa azione sostituisce tutta la bozza, incluse variazioni/assenze/consuntivi/note, solo dopo conferma MiroxUI.
3. Modificare i giorni dal planning o dalla scheda ore. Fino a quattro fasce giornaliere, senza sovrapposizioni. Una fascia vuota e' riposo.
4. Registrare ferie, permessi o malattia per intera giornata prevista o intervallo orario. Le assenze parziali contano solo l'intersezione con il turno, mai la pausa. Le assenze non possono sovrapporsi o cadere interamente fuori turno; una giornata intera esclude altre assenze nello stesso giorno.
5. Codice malattia facoltativo per ogni registrazione, senza allegati o diagnosi. Nota interna disponibile. Nessun saldo residuo o maturazione.
6. Ore ordinarie effettive facoltative (anche zero), separate dagli straordinari manuali. Senza conferma, si mostra una stima dal previsto meno le assenze. Le ordinarie piu assenze non possono superare il previsto: le ore extra si inseriscono nella colonna straordinari. Nessuna banca ore o calcolo automatico dello straordinario. Tutti i conteggi usano minuti interi.
7. Salvare la bozza e approvare/pubblicare quando pronta. Ogni modifica successiva conserva l'ultima versione approvata fino a nuova pubblicazione. Nessun invio automatico; i PDF si scaricano per inviarli manualmente.

Il cambio degli orari ricorrenti non riscrive i mesi esistenti. Il roster mensile e i turni sono uno snapshot; le rettifiche giornaliere appartengono al mese. Per un'uscita usare Ultimo mese, preservando l'identita' storica.

## PDF e riservatezza

- Planning collettivo: fasce effettivamente disponibili dopo le assenze, riposi e chiusure; nessuna causale, codice o nota.
- Planning personale: un dipendente, fasce disponibili e indicazione generica dell'assenza; nessuna causale, codice o nota. Scaricabile anche dal dipendente, solo dalla versione pubblicata.
- Scheda ore: solo Admin, previsto/ordinario/extra/ferie/permessi/malattia e codici malattia, totali mensili e numero di giorni ordinari ancora stimati. L'export dalla vista Schede ore usa la bozza salvata, come il riepilogo a schermo.
- Admin puo esportare planning dalla bozza salvata o dall'ultima approvata; le modifiche non salvate bloccano gli export per evitare PDF incoerenti.
- PDF in memoria su richiesta, risposta privata `no-store`; nessun PDF archiviato nel sito o nello Storage. Logo ufficiale incluso nella Function tramite Netlify.
- Gli export di novembre dei tre dipendenti stanno su una pagina ciascuno. Il collettivo suddivide oltre quattro dipendenti in gruppi su pagine distinte; altezza delle intestazioni e del sottotitolo misurata sul testo, senza sovrapposizioni con i giorni. Le continuazioni ripetono mese, stato e intestazioni.

## Implementazione e database

Frontend: `css/planning.css`, `js/planning.js`, motore puro `js/planning-core.js` condiviso dal backend/PDF. API `gestisci-planning`, PDFKit gia' presente, nessuna nuova dipendenza runtime di questo modulo, env o cron.

Migration `database/20261029200010_personale_planning.sql`, generata con CLI e conservata in database come le altre migration del progetto:

- `personale_planning_config`: singleton versionato con dipendenti/orari/collegamenti account.
- `personale_planning_mesi`: mese, versione ottimistica, bozza e snapshot pubblicato distinto con data/versione.
- `personale_planning_audit`: autore UUID, mese, versione, azione e timestamp. Non duplica dati sanitari nei log.
- `personale_salva_config` e `personale_salva_mese`: nuove RPC INVOKER/service-only, ruolo admin attivo riletto nel DB; aggiornamenti/snapshot/audit nella stessa transazione, conflitto SQL40001/API409 senza sovrascrivere altri salvataggi.

RLS ON e nessun privilegio per PUBLIC/anon/authenticated su tabelle/RPC. Tutte le chiamate passano da MiroxApi e dalla Function, JWT validato e profilo attivo/ruolo riletti a ogni operazione. Il dipendente e' individuato esclusivamente dal proprio ID autenticato e dal collegamento corrente; riceve una proiezione pubblica di un solo dipendente, mai il documento completo o la bozza. PDF collettivo/scheda ore/bozza/altrui vietati ai non Admin. Errori lettura DB bloccanti, mai interpretati come mese vuoto.

## Verifiche

- `node --test tests/planning.test.js`: calendario, alternanza, orari/contratti, assenze/pausa, sovrapposizioni, proprieta', revoche, errori API, CAS e snapshot, contenuto e numero pagine PDF, migrazione privata.
- `npm test`: build e suite completa, 580/580 nel checkout condiviso dopo il debug29/10 (19 test planning). I precedenti errori transitori dello scanner parallelo non sono presenti in questa verifica; nessuna modifica scanner appartiene al debug planning.
- Collaudo SQL reale PostgreSQL WASM isolato e DOM senza browser, ripetibili con strumenti temporanei separati dalle dipendenze del progetto:

```sh
npm install --prefix /private/tmp/mirox-planning-qa --no-save --package-lock=false @electric-sql/pglite@0.3.14 linkedom@0.18.12
NODE_PATH=/private/tmp/mirox-planning-qa/node_modules node scripts/check-planning-sql.cjs
NODE_PATH=/private/tmp/mirox-planning-qa/node_modules node scripts/check-planning-dom.cjs
```

SQL: migration eseguita, SELECT/RPC autenticati negati, admin riletto, CAS/storia pubblicazione e audit verificati. DOM: generazione, blocco approvazione senza alternanza, dettaglio/assenza/codice/consuntivo/extra, salvataggio/pubblicazione e lettura personale. PDF di esempio con dati sintetici in `tmp/pdfs/planning-*.pdf`, render Poppler e controllo visivo; mai nella build pubblica. Il collaudo non ha usato browser, account reali o database production.

## Debug 29/10/2026

Riprodotti i problemi prima delle correzioni e aggiunte regressioni DOM/PDF:

- Un mese ricevuto malformato aggiornava la versione CAS prima di validare il documento: documento, mese e versione ora vengono sostituiti insieme solo dopo la validazione. Errori o annullamento ripristinano il selettore al mese ancora aperto, conservando le modifiche precedenti.
- Cambiare il selettore mese senza caricarlo ora blocca modifiche, pubblicazione e export fino ad Apri mese. Il salvataggio verifica anche il periodo effettivamente aperto.
- Un errore di caricamento personale ora svuota tabella/nominativo, nasconde il risultato precedente e disabilita il PDF. Non viene presentato come assenza di planning.
- Dopo un errore iniziale di configurazione, Apri mese ripete la lettura della configurazione e consente di recuperare senza riaprire la pagina. Azioni dipendenti dai dati disabilitate finche il caricamento non riesce.
- Un cambio di alternanza non ancora applicato ai turni blocca modifica giorni/salvataggio/pubblicazione/export: l'Admin deve applicare la scelta oppure ripristinare quella gia applicata.
- Nomi lunghi nel collettivo potevano sovrapporsi ai giorni: intestazioni dimensionate sul testo, massimo quattro dipendenti per gruppo, periodo/stato ripetuti sulle continuazioni.

SQL isolato, DOM Node e PDF nuovamente verificati. Test PDF controlla margini, nomi integri e separazione tra intestazione e prima riga; test privacy preesistenti restano verdi. Nessun browser, nuova dipendenza, migration/schema/DDL o produzione modificati. Guide README/AGENTS/CLAUDE/databaseREADME e promemoria aggiornati.

## Rilascio autorizzato 29/10/2026

Il proprietario ha richiesto il push del solo planning. Checkout isolato basato su origin/main7f9d930, senza f5c50d8/a789caa o modifiche scanner, dipendenze npm invariate. Suite del solo rilascio553/553verdi; gli580/580precedenti comprendevano anche lo scanner locale. Migration sorgente20261029200010 applicata come20261029210434, tre tabelle vuote e due RPC: RLS ON, nessun privilegio anon/authenticated, solo service_role; schema/trigger/RLS delle tabelle condivise identici (fingerprint a102deb709d5b66a73851dd50b40696e). Advisor sicurezza: stesse7categorie, INFO RLS senza policy32->35 atteso per le tre tabelle private; performance: solo unused_index104->105 per il nuovo indice audit ancora inutilizzato. Nessun dato dipendente o mese creato; nessun account collegato. Deploy/CI ancora da verificare.

Dopo il rilascio: collegare gli account dalla UI, assegnare l'alternanza del 2 novembre e pubblicare soltanto dopo verifica del proprietario. Nessun profilo storico o tabella condivisa va alterato per attivare questo modulo.
