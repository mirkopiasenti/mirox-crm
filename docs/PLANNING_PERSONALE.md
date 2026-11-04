# Planning dipendenti — rilascio 29/10/2026

Modulo richiesto dal proprietario per novembre 2026 in poi, solo Legnago.
Rilascio autorizzato dal proprietario29/10: soltanto planning, esclusi i commit scanner.
Migration production20261029210434 applicata; deploy verificato dal checkout isolato basato su origin/main7f9d930.
Nessuna modifica agli account, alle gare o alle tabelle condivise col Call Center.

## Disponibilita call center — rilascio04/11/2026

**Attiva in produzione dal04/11/2026.** Richiesta del proprietario: collegare il call center attuale al planning senza attendere CC2.0. Confermati tutti i canali (operatrici, interno, outbound, link cliente e spostamenti), mantenimento degli orari CC attuali per ogni mese ancora senza prima approvazione e opzione giornaliera Fuori negozio.

La disponibilita risultante e' l'intersezione fra gli slot del motore CC storico e la presenza contemporanea di Matteo e Vincenzo, ID planning stabili `matteo` e `vincenzo`. L'intero appuntamento, non soltanto l'ora iniziale, deve rientrare nella presenza di entrambi: con Vincenzo09:00–12:00 e Matteo09:30–12:30, appuntamenti di30minuti dalle09:30 alle11:30 incluse, mai09:00 o11:45. Conservati griglia, anticipo, chiusure/blocchi, occupazione, buffer e prenotazioni temporanee del CC.

- Solo `personale_planning_mesi.pubblicato` del mese selezionato; una revisione in bozza non cambia gli slot fino alla successiva approvazione. La pubblicazione aggiorna automaticamente il filtro, senza cron o copia dei dati in `blocchi`.
- Ferie, permessi e malattia sottraggono gli intervalli dal turno; assenza intera, riposo o chiusura di uno dei due venditori chiudono la relativa disponibilita. Isabella non sostituisce nessuno dei due. Consuntivi, straordinari e testo libero non diventano presenza.
- **Fuori negozio per tutta la giornata** nel dettaglio Admin esclude il dipendente dalla disponibilita CC, conservando turni, ore lavorative e PDF. Flag `offsite` nel JSON esistente, default false nei mesi gia salvati; non dedotto da parole come formazione. Per le giornate fuori sede gia inserite occorre selezionare l'opzione, salvare e riapprovare. Il flag resta nella vista Admin; i dettagli condivisi continuano a comunicare sede/indirizzo al dipendente.
- Mese senza snapshot pubblicato: risultato storico invariato, anche se esiste una bozza. Errori DB/documenti malformati non attivano questo fallback: risposta bloccante. Mese approvato privo di uno dei venditori: nessuna presenza sostitutiva.
- Appuntamenti gia fissati conservati, senza cancellazioni o spostamenti automatici dopo una modifica del planning. Esiti, note, annullamenti e marcatura rischedulato restano ammessi; nuove prenotazioni, spostamenti, riattivazioni o cambi di durata rileggono il pubblicato al salvataggio.
- Gli operatori e il pubblico ricevono soltanto slot, mai assenze, note, codici o documenti Personale. API/risposte `no-store`; richieste obsolete scartate e selezione azzerata al cambio data/mese o errore.

Implementazione: `js/cc-disponibilita.js` usa MiroxApi verso `gestisci-disponibilita-cc`; la Function rilegge profilo attivo e permessi CC e chiama la nuova RPC INVOKER/service-only `mirox_cc_slot_disponibili_v1(date)`. `public-prenota` GET usa la stessa RPC; POST mantiene `public_prenota_appuntamento_v1` e il suo lock/rate limit. Nessuna dipendenza, env o schedulazione nuova.

Migration `database/20261104214454_cc_disponibilita_planning.sql`, generata con CLI2.109.1 e **applicata production20261104220255 dopo conferma esplicita**: nuovo schema non esposto `mirox_cc_privato`, helper puro INVOKER e trigger aggiuntivo `trg_mirox_cc_planning` su `appuntamenti`. Nessuna sostituzione di RPC, policy, colonna o trigger storico; nessuna modifica ai dati esistenti. Il solo trigger e' DEFINER per leggere il planning privato, search_path vuoto e EXECUTE revocato ai client; controlla auth.uid/profilo attivo per i chiamanti authenticated/anon. Un lock SHARE sulla tabella planning, limitato alla transazione di prenotazione, serializza il controllo con salvataggi/pubblicazioni, anche quando il mese non esisteva ancora. Il rifiuto `slot_non_disponibile_planning` e' mostrato come invito a ricaricare gli slot; lo spostamento rifiutato conserva l'originale.

Verifiche04/11: `npm test` **648/648**,0skip;90verifiche PostgreSQL WASM sintetiche (confini, durata, permessi parziali/interi di entrambi, fuori sede, alternanza, snapshot/bozza, mesi/roster, ora legale/solare e timezone, occupazione/blocchi/buffer/lock temporanei, guard su INSERT/UPDATE e RPC pubblica, privilegi e lock SHARE). Altri133confronti indipendenti SQL/JS sul replay di133slot reali del5–11novembre, dopo sole SELECT production e proiezione senza note/causali/clienti; tutti concordi. DOM Node/linkedom: round-trip Fuori negozio, pubblicazione e ore, risposte invertite e cambio data/mese sui tre flussi, errori e rifiuto spostamento senza toccare l'originale. Nessun browser o appuntamento reale creato. I lock sono verificati nella transazione isolata; non e' un carico concorrente su production.

```sh
NODE_PATH=/private/tmp/mirox-cc-planning-qa/node_modules node scripts/check-cc-planning-sql.cjs
NODE_PATH=/private/tmp/mirox-cc-planning-qa/node_modules node scripts/check-cc-planning-dom.cjs
NODE_PATH=/private/tmp/mirox-cc-planning-qa/node_modules node scripts/check-planning-dom.cjs
```

Replay opzionale: aggiungere il percorso di una proiezione privata come argomento al primo comando. Snapshot locale ignorato `.backup-private/cc-planning-20261104/replay.json`; non pubblicare dati o strumenti QA in `dist`. Suite completa eseguita fuori sandbox per il solo test SMTP localhost, senza consegne esterne.

**Rilascio autorizzato04/11:** push richiesto dal proprietario e conferma esplicita distinta per il database condiviso ricevuta dopo il blocco iniziale dell'auto-review. Migration transazionale applicata come20261104220255; schema/trigger attivo/grant riletti. Impronte appuntamenti, planning e profili identiche; RPC e policy/trigger storici identici. Advisor sicurezza: stesse7categorie e conteggi, nessun nuovo rilievo. Slot5–11novembre concordi con il replay locale (19→17,20→18,16→3,0→0,26→14,26→12,26→24); dicembre senza approvazione26→26. Nessuna prenotazione reale creata. Pubblicato `4934399`: CI41921986253 Linux/Node22 verde,648/648test e0skip; Netlify6aebabfaaa239b34864b252a online. HTTP200/byte identici per8asset e pagine; API autenticata401senzaJWT; GET pubblico no-store conferma17slot il5novembre,3il7novembre e26il1dicembre, coerenti col DB. Nessuna sessione o prenotazione di prova creata. Guide aggiornate nello stesso rilascio; WIP gare/punteggi precedenti conservati fuori commit. Novembre e' gia approvato (versione6), quindi la guard e' attiva dall'applicazione; nell'intervallo migration–deploy le vecchie pagine mostravano ancora gli slot storici ma il salvataggio rifiutava quelli privi di presenza. Ora ricaricare le pagine CC e il planning Admin per usare la nuova UI. Eventuale rollback richiede ripristino della release precedente e disabilitazione del solo nuovo trigger, mantenendo dati/RPC storici e planning; nessun rollback eseguito.

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
2. Aprire il mese, scegliere l'alternanza e applicare gli orari. Questa azione sostituisce tutta la bozza, incluse variazioni/assenze/consuntivi/dettagli/note, solo dopo conferma MiroxUI.
3. Modificare i giorni dal planning o dalla scheda ore. Fino a quattro fasce giornaliere, senza sovrapposizioni, anche fuori dagli orari del negozio per formazione. Si accettano `9:00-18:00`, `9.00–18.00`, `9-18` e più fasce separate da `;`, `,`, `/` o nuova riga; vengono salvate come `HH:mm`. Una fascia vuota e' riposo. Orari inesistenti, fine precedente all'inizio e sovrapposizioni restano rifiutati.
4. Registrare ferie, permessi o malattia per intera giornata prevista o intervallo orario. Le assenze parziali contano solo l'intersezione con il turno, mai la pausa. Le assenze non possono sovrapporsi o cadere interamente fuori turno; una giornata intera esclude altre assenze nello stesso giorno.
5. Codice malattia facoltativo per ogni registrazione, senza allegati o diagnosi. Nel campo Dettagli per il dipendente si possono scrivere formazione, sede e indirizzo (massimo500caratteri), visibili nelle Indicazioni personali e del PDF; la Nota interna resta riservata all'Admin. Nessun saldo residuo o maturazione.
6. Ore ordinarie effettive facoltative (anche zero), separate dagli straordinari manuali. Senza conferma, si mostra una stima dal previsto meno le assenze. Le ordinarie piu assenze non possono superare il previsto: le ore extra si inseriscono nella colonna straordinari. Nessuna banca ore o calcolo automatico dello straordinario. Tutti i conteggi usano minuti interi.
7. Salvare la bozza e approvare/pubblicare quando pronta. Ogni modifica successiva conserva l'ultima versione approvata fino a nuova pubblicazione. Nessun invio automatico; i PDF si scaricano per inviarli manualmente.

Il cambio degli orari ricorrenti non riscrive i mesi esistenti. Il roster mensile e i turni sono uno snapshot; le rettifiche giornaliere appartengono al mese. Per un'uscita usare Ultimo mese, preservando l'identita' storica.

## Formazione e dettagli condivisi — rilascio04/11/2026

Aggiornamento sviluppato02/11/2026, push autorizzato04/11: dettagli giornalieri condivisi (`details`, massimo500caratteri) separati dalla nota interna. Modificabili nel dettaglio Admin, visibili nel calendario Admin, nelle Indicazioni del proprio planning pubblicato e del PDF personale; nessuna esposizione di note interne/codici/causali o dettagli altrui. Campo assente nei mesi precedenti normalizzato a stringa vuota; JSONB esistente, nessuna migration o scrittura production. Orari liberi anche fuori apertura per formazione, parser tollerante a ore senza zero iniziale, punto/colon, trattini copiati e separatori ; , / o nuova riga, salvataggio canonico HH:mm. Sovrapposizioni/inversioni/orari inesistenti restano vietati; nessuna conversione automatica in straordinari. Dettagli nel PDF con righe ad altezza misurata e continuazioni; collettivo e scheda ore conservano il perimetro precedente. Push richiesto04/11, verifiche di rilascio in docs/STATO_LAVORO.md.

Verifiche02/11:26/26test planning, build e suite completa622/622(0skip), controllo DOM senza browser con round-trip dei dettagli e testo escaped, due PDF sintetici renderizzati: formazione con indirizzo e dettagli lunghi500caratteri su continuazione, nessun taglio o sovrapposizione. Nessun dato reale o production modificato.

La formazione si inserisce come turno previsto, sostituendo le fasce del negozio per quel giorno; non e' una nuova causale di assenza. Non vengono assegnati automaticamente i giorni citati dal proprietario: mese e orari precisi sono ancora da confermare. Dopo le modifiche, salva la bozza e approva nuovamente per renderle visibili al dipendente.

## PDF e riservatezza

Aggiornamento pubblicato01/11: nel PDF personale i giorni sono per esteso (es. Domenica, Lunedì, Mercoledì); intestazioni e contenuti di Giorno, Orario e Indicazioni sono centrati orizzontalmente. Dimensioni del testo e altri export conservati. Test sulle coordinate effettive del testo nel PDF, oltre al controllo visivo dei due dipendenti. Nessuna modifica DB o ai turni.

Aggiornamento online01/11 successivo alla dicitura Mezza giornata: i PDF personali mostrano `Planning mensile - Matteo Milanese` o `Planning mensile - Vincenzo Di Pietro` anche per mesi salvati con solo il nome. Gli altri dipendenti conservano il nome configurato, senza cognomi inventati. Sottotitolo `Legnago | Novembre 2026` (mese selezionato con iniziale maiuscola), senza ripetere il dipendente. Titolo22pt, sottotitolo12pt, tabella10pt e intestazioni9pt; altezza titolo misurata per evitare sovrapposizioni. Nomi completi solo nel renderer: nessuna modifica ad account o dati salvati. Pubblicato01/11:5b8eaa7, CI41309234450 riuscita, Netlify6ae738289f662938dee06d1e online.

- Planning collettivo: fasce effettivamente disponibili dopo le assenze, riposi e chiusure; nessuna causale, codice o nota.
- Planning personale: un dipendente, fasce disponibili e indicazione generica dell'assenza; nessuna causale, codice o nota interna; include i dettagli condivisi scritti dall'Admin. Scaricabile anche dal dipendente, solo dalla versione pubblicata. Aggiornamento online01/11: per Matteo e Vincenzo aggiunge `Mezza giornata` sui turni previsti entro4ore, interamente prima o dopo le14:00 e con presenza residua. Un permesso che dimezza un turno pieno non cambia la classificazione; un'assenza parziale si aggiunge alla dicitura, mentre assenza totale, chiusura e riposo non sono etichettati come mezza giornata. Pubblicata01/11 con il commit3213480; CI41308296243 riuscita, Netlify6ae7354e91e0f34527718721 online.
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

Il proprietario ha richiesto il push del solo planning. Checkout isolato basato su origin/main7f9d930, senza f5c50d8/a789caa o modifiche scanner, dipendenze npm invariate. Suite del solo rilascio553/553verdi; gli580/580precedenti comprendevano anche lo scanner locale. Migration sorgente20261029200010 applicata come20261029210434, tre tabelle vuote e due RPC: RLS ON, nessun privilegio anon/authenticated, solo service_role; schema/trigger/RLS delle tabelle condivise identici (fingerprint a102deb709d5b66a73851dd50b40696e). Advisor sicurezza: stesse7categorie, INFO RLS senza policy32->35 atteso per le tre tabelle private; performance: solo unused_index104->105 per il nuovo indice audit ancora inutilizzato. Nessun dato dipendente o mese creato; nessun account collegato. Deploy e CI verificati come descritto sotto.

Dopo il rilascio: collegare gli account dalla UI, assegnare l'alternanza del 2 novembre e pubblicare soltanto dopo verifica del proprietario. Nessun profilo storico o tabella condivisa va alterato per attivare questo modulo.

## Esito del rilascio

Rilascio verificato29/10: commit f22e8fd, CI40954897311 riuscita, Netlify6ae3b5531570a3facff51c37 online; pagine HTTP200, API401 senza JWT, JS/CSS pubblici identici. Solo planning, scanner escluso (pagina/funzione404 e commit non antenati di origin/main). Suite rilascio553/553; nessun browser o dato dipendente creato. Migration production20261029210434 applicata e privilegi verificati. Prima configurazione: collegare account, scegliere02/11e approvare il mese.

Pubblicazione giorni estesi/colonne centrate01/11: commit67772f1, CI41309810960 riuscita e Netlify6ae739d13430536274efe342 online, API401 senzaJWT.22test planning e controllo visivo dei PDF riusciti; basta riscaricare il PDF, senza rigenerare il mese.


Rilascio formazione/dettagli04/11:7a0a68f su main dopo integrazione Dashboard550f552, build/suite623/623, CI41828277095 riuscita, Netlify6aeb22d0575fcc7da2508f55 verificato online. HTML nuovo campo e JS/CSS pubblici verificati, API401senzaJWT. Nessuna migration o modifica ai mesi reali. Ricaricare la pagina; dopo aver inserito i dettagli, salvare la bozza e riapprovare per aggiornare la vista dipendente.
