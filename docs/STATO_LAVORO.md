# Stato del lavoro — Mirox CRM

Aggiornato:2026-11-25. Promemoria di ripresa; non autorizza push, attivazioni o ripresa di attività sospese. Dettagli tecnici in AGENTS/README/databaseREADME e nelle guide citate.

## Subentri, caselle del codice cliente —25/11, in locale

- Ripristinate le dieci caselle originali nei quattro percorsi con modulo. Oltre dieci caratteri il codice si distribuisce in gruppi consecutivi centrati nelle caselle, fino al limite già supportato di 40. Il modello WindTre rimane intatto. La ripresa di una chiusura interrotta riconosce il PDF già caricato solo se coincide byte per byte con quello generato dalla stessa bozza con uno dei due layout.
- Build e 909/909 test in copia isolata, di cui 39 Subentri. Poppler e confronto pixel confermano tutte le linee originali in otto render, compresi `P1010637274`, simboli, zeri iniziali e limite di 40 caratteri. README, AGENTS e databaseREADME aggiornati. Correzione applicativa senza migration, da pubblicare su richiesta.

## Anteprima Monitor Legnago —24/11

- Verificati via HTTPS pagina, CSS e script del monitor pubblicato. Anteprima verticale 1080×1920 con Day by Day, agenda e mensile, popolata con dati di esempio; nella colonna giornaliera di novembre compaiono Matteo, Mirko e Cerea. HTML statico e PNG consegnati fuori dal repo. Otto test DOM verdi. I valori live e la versione installata richiedono verifica dalla postazione associata.

## Sprint Monitor Legnago —24/11

- Pubblicato “Chiudiamo novembre” in toni di grigio: residui Mobile +30, Fisso +8, Business +12 da EXTRA GARA P.IVA, Luce & Gas +5 da Standard. Base mensile fissata il 24/11 alle 23:01 Europe/Rome e conservata nella proiezione riservata. Dal 1° dicembre Europe/Rome ritorna il riquadro precedente. Day by Day e agenda conservati.
- Migration sorgente `20261124215619_monitor_sprint_novembre.sql`, applicata/riletta come `20261124220113`. RLS e assenza di grant verificati, quattro basi rilette. Build e suite 907/907 in copia isolata, 79 verifiche SQL PGlite includono riservatezza, revisione e trasporto v2. DOM verifica punti decimali, rettifica e passaggio a dicembre.
- Push richiesto `034fc66` su main. Netlify online alle 23:03 Europe/Rome, verificati manifest e 12 file per SHA, entrambe le URL HTML, CSS, JS e ZIP. CI `45496990997` verde su Linux e Windows. La TV associata scarica la pagina al prossimo controllo del manifest. Prove private in `.backup-private/sprint-monitor-20261124/`.

## Upload Contratti, simboli nel codice PDA —23/11, pubblicato

- In Continua senza AI per Mobile, Fisso e Customer Base si possono immettere codici come `00123.45` o `AB_001#2`. La validazione condivisa conserva separatori e zeri iniziali nel salvataggio e nei duplicati; lettura PDF e riscontro Business confrontano il codice intero. Il formato e la lista di simboli sono in README, AGENTS e databaseREADME.
- Build e 906/906 test in copia isolata. PGlite 0.5.13 ha verificato la migration `20261123174819_vendita_codice_pda_separatori.sql` su storico, NULL, limite, simboli, duplicati e sincronizzazione Fisso. Verificata la codifica del filtro con il client Supabase.
- Migration applicata e riletta come `20261123175336` prima del push richiesto. Impronte dei 2.924 contratti e di Controllo Fissi, altri vincoli, indici univoci, trigger, policy e conteggi degli advisor identici. Tutti i 516 codici precedenti rispettano il nuovo formato.
- Commit runtime `d5e1435` su main, CI `45232731922` verde Linux/Windows e Netlify `6b047de9153430dfe33c29af` online, verificato alle 18:57 Europe/Rome. I due JS e le due URL della pagina corrispondono alla build con la sola riscrittura del link Dashboard. Due API 401 senza sessione. La prossima pratica manuale con simboli può essere inserita dal wizard live.

## Subentri, nuove anagrafiche e codice cliente —22/11, pubblicati

- Nei quattro percorsi con modulo, Invia pratica e Compilazione standard censiscono nel CRM cedente e cessionario mancanti per CF/P.IVA. Si salvano nome/ragione sociale, cluster, referente per Business, recapito e indirizzo pertinente quando disponibili. Schede già presenti conservate. Documenti, IBAN, consensi e codice cliente restano nella pratica. 1928 e storico già chiuso fuori perimetro.
- RPC INVOKER service-only `subentri_finalizza_con_anagrafiche` rende atomici censimento e chiusura dopo verifica degli allegati e salvataggio PDF. Migration `20261122163641_subentri_censisci_anagrafiche.sql`, applicata e riletta su Supabase come `20261122164822`; niente modifiche a schema/trigger/RLS dell’anagrafica condivisa. Verificati in PGlite permessi, quattro tipi, 1928, schede legacy con spazi/minuscole, rollback, retry, sede legale e profilo operatore.
- Codice cliente fino a 40 caratteri stampabili con maiuscole/minuscole, zeri, punti e simboli conservati. Il rilascio del 22/11 usava una riga adattata oltre dieci caratteri, oggetto della correzione del 25/11. Quattro PDF numerici identici alla versione precedente. Build e 904/904 test, 37 Subentri.
- Push e migration esplicitamente autorizzati. RPC riletta INVOKER service-only, senza variazioni a vincoli, ACL, trigger e RLS delle due tabelle o ai conteggi degli advisor sicurezza. Push `8fb8616`, CI `45045979868` verde Linux/Windows, Netlify `6b031d20511c5ba9ba7ea813` verificato alle 17:51 Europe/Rome. Due URL HTML, JS/CSS, due API 401 e PDF PEC 404 via percorso statico verificati. Prove HTTP in `.backup-private/release-subentri-anagrafiche-20261122/`. Prossimo passo: normale uso dei subentri con anagrafiche mancanti.

## Segnalazioni, chiusura Più Sicuri —22/11, pubblicata

- Nel dettaglio Da gestire, Disattivata sostituisce il riquadro di azione/note/allegati delle pratiche Più Sicuri. Registra Disattivata e Chiuso con data in un unico aggiornamento condizionato alla presenza in coda. Il Riepilogo mostra la pratica tra le chiuse. Testato con pratiche sintetiche, doppio clic e conflitto concorrente; nessuna chiusura reale di collaudo.
- Build e suite 902/902 in copia isolata (58 Segnalazioni), client Supabase verificato con risposte simulate. Guide allineate. Push richiesto `d97568a`, CI `45039668598` verde Linux/Windows, Netlify `6b030d17c7ebeeafc4d6bfb7` online. Commit e script inline verificati via HTTP sulle due URL pubbliche. Prossimo passo: uso operativo del pulsante.

## Raccolta PDA Reload e Cloud —22/11

- Consegnato sul Desktop ZIP con 33 PDA dal 15/10 al 22/11 per data contratto: 6 Mobile, 6 Fisso, 21 Customer Base. Selezione da flag CRM e opzioni presenti nelle PDA; per Telefono Incluso CB, Smartphone Reload = Sì nel CRM. Verificati ZIP e copia tramite SHA256. Due contratti Mobile del periodo senza PDA associata non sono verificabili; una PDA CB ha pagine originali 1, 2, 3 e 6. Evidenze private in `.backup-private/pda-raccolta-20261015-20261122/`. Nessuna modifica dati; nessun seguito richiesto.

## Segnalazioni, Disattivazione Più Sicuri —22/11, pubblicata

- In produzione aggiornato il tipo di gestione delle tre segnalazioni richieste, tutte ancora in Da gestire. Transazione con controllo delle tre righe e rilettura indipendente, compresa la storica chiusa dello stesso cliente. Gli altri campi delle tre righe corrispondono per impronta, salvo il timestamp ordinario di modifica.
- Nuova voce nel menu Gestione pratica, validata in inserimento e visibile in lista e dettaglio. Build e 900 test verificati in copia isolata. Primo push `8ad0dbf`, CI `45038783133` verde Linux/Windows, Netlify `6b030acf879fb3820071ceef` verificato. Il flusso di chiusura aggiornato è descritto sopra.

## Popup Smartphone Reload upload —22/11, pubblicato

- Quando Smartphone Reload è rilevata dalla PDA o impostata manualmente su Sì, l'upload chiede al cliente se disattivare o mantenere attivo tramite popup. Scelta visibile e modificabile con pulsante dedicato, chiusura senza scelta non permette di proseguire. Bozze/carrello conservati, risposta tardiva protetta dal cambio PDA o contratto. Nessuna modifica al DB. Push richiesto dal proprietario.
- Build e suite 900/900 in copia isolata. Test mirati del popup, scelta/modifica, chiusura, risposta tardiva e applicazione OCR. Push `da7623a`; CI `45028417372` verde Linux/Windows, pagina online con script inline identici alla build. Nessuna verifica browser con contratto reale. Prossimo passo: uso operativo dell'upload.

## Segnalazioni Customer Base —22/11, pubblicate

- In Verifica Contratti, anche nei Verificati, il pulsante Apri segnalazione offre Reload Forever (ASK - Normalizzazione) o Altro (Interna negozio con nota). Stessa ACL, copia degli allegati e retry del flusso Mobile, validazione server su categoria canonica e snapshot. Flag Reload Forever del contratto indipendente. Estensione applicativa senza migration, con test API e del popup.
- Build e suite completa 897/897 in copia isolata, di cui 27 test Segnalazioni. Lettura su produzione: tutti gli 823 contratti con snapshot Customer Base hanno la categoria di catalogo coerente. Push `34ebb86`, CI `45021920857` verde su Linux e Windows. In produzione, pagina Verifica raggiungibile, core e popup identici alla build, motivi controllati e API HTTP 401 senza sessione. Creazione verificata con dati simulati. Prossimo passo: uso operativo dal dettaglio Customer Base.

## Verifica PDA Customer Base —22/11

- Controllo in sola lettura sugli ultimi 50 Customer Base con offerta Telefono Incluso, per data inserimento: Smartphone Reload attiva su 14, con 8 Mantenere attivo e 6 Disattivazione cliente; 36 senza flag. Reload Forever risulta disattivata sui 50. Nessuna scrittura dati.
- Consegnato archivio temporaneo con le otto PDA associate ai contratti con Smartphone Reload da mantenere, verificati download, lettura e integrità ZIP. La PDA 1634370773727 contiene quattro pagine con numerazione originale 1, 2, 3 e 6.
- Letti in sola consultazione gli ultimi 50 contratti per data di inserimento e i 50 PDF associati: Reload Forever Basic compare in tre PDA, anche nell'elenco opzioni; due hanno il flag CRM disattivato. Nessuna modifica ai dati. Testo estratto e cinque PDF con immagini/testo incompleto ricontrollati visivamente; uno dei PDF contiene solo le pagine numerate 1, 2, 3 e 6. Evidenze private in `.backup-private/customer-base-reload-20261122/`.

## Rilascio Subentri —22/11, pubblicato

- Il proprietario ha chiesto il push unico e ha autorizzato esplicitamente la migration production. La migration è stata applicata come `20261122104944`. La rilettura conferma i nuovi vincoli, archivio vuoto, zero oggetti nel bucket, RLS e grant invariati.
- Push unico `a075d68` su main. Build e 894/894 test sulla copia esatta del runtime, CI `45014440360` Linux e Windows verde. Netlify `6b02c9279e9525aaf86a1d1d` verificata online alle 11:54 Europe/Rome. HTML e Pretty URL coerenti con la build, con la sola riscrittura del link dashboard di Netlify. JS e CSS identici, storico e PDF PEC 401 senza sessione, percorso statico diretto PDF 404. Advisor Supabase con gli stessi tipi e conteggi. Evidenze HTTP in `.backup-private/release-subentri-20261122/`. Prossimo passo: uso operativo dei cinque percorsi Mobile.

## Subentri 1928 → Privato —22/11, incluso nel rilascio

- Riepilogo del proprietario con nuova SIM Consumer, Windtre Business Pos → Passaggio da P.IVA vs CF (tab arancione) e dichiarazione dell’azienda via PEC a konatechsrl@pec.it. Prosegui apre il popup Procedura invio PEC con il PDF originale dietro ACL Subentri. Apri PDF per stampare o Scarica PDF sblocca Continua. Errori di caricamento con Riprova.
- Tre gruppi obbligatori in ordine: identità e tessera sanitaria del rappresentante legale, visura azienda, identità e tessera sanitaria del nuovo intestatario. Dichiarazione nel flusso PEC. Conferma e chiudi pratica verifica gli allegati e salva archiviato. Storico con soli allegati per quel tipo, senza dati del modulo, ricerca, mortis causa, PDF generato, duplicazione o invii automatici.
- Build e 894/894 test, 35 Subentri. DOM Node con retry PEC, apertura/download, chiusura e recupero di una risposta persa. PDF PEC confrontato byte per byte con l’originale e controllato a video, assente dalla build pubblica. Otto PDF/snapshot preesistenti identici. Migration locale `20261121083215_subentri_privato_mortis_causa.sql` estesa e verificata in PGlite per vincoli delle cinque categorie, storico, RLS e privilegi. Guide aggiornate. Quattro nuove tipologie Mobile incluse nel push unico.

## Subentri Microbusiness → Microbusiness —22/11, incluso nel rilascio

- Riepilogo del proprietario con visure cedente e cessionario e percorso ASK fino a Subentro (tab arancione). Dopo Prosegui, Sì/No per mortis causa. Entrambi i soggetti per P.IVA Business, con P.IVA distinte e scelta esplicita impresa o professionista/artigiano per ciascuno. Il PDF compila i riquadri pertinenti dei modelli già in uso, identici agli allegati consegnati. Il ramo mortis usa il professionista o delegato del cessionario per la dichiarazione, con quattro numeri al massimo per due pagine.
- Invia pratica richiede due documenti d’identità e due visure in gruppi distinti, più il certificato di morte se serve. Standard archivia il PDF. Storico e duplicazione espongono e riconfermano entrambe le P.IVA.
- Build e suite 892/892, 33 Subentri. DOM Node con entrambe le visure, popup, storico e duplicazione. Tre pagine sintetiche renderizzate e controllate. Sei PDF e snapshot precedenti identici. Migration locale `20261121083215_subentri_privato_mortis_causa.sql` estesa e verificata in PGlite 0.5.13 per vincoli, storico, RLS e privilegi. Guide aggiornate. Pubblicazione inclusa nel push unico.

## Subentri Privato → Microbusiness —22/11, incluso nel rilascio

- Riepilogo fornito dal proprietario con visura camerale confermata e percorso ASK fino a Subentro Consumer-Microbusiness (tab nero). Dopo Prosegui, Sì/No esplicito per mortis causa. Cedente CF Consumer/Turista, cessionario P.IVA Business. Il professionista compila il blocco persona, l’impresa aggiunge ragione sociale/recapito/sede legale. La residenza del delegato resta distinta e alimenta la dichiarazione nel caso mortis causa. Fino a quattro numeri in quel ramo per mantenere il PDF di due pagine.
- Invia pratica richiede i due documenti d’identità e la visura. Nel ramo mortis causa aggiunge il certificato di morte separato. Standard archivia il solo PDF generato. Storico con P.IVA e ragione sociale se presente, duplicazione dopo nuovo riscontro CF/P.IVA e nuova scelta mortis causa.
- Build e suite 889/889, 30 test Subentri. DOM Node verificato per popup, visura, certificato, sede, storico e duplicazione. PDF sintetici ordinario professionista e mortis impresa controllati visivamente. Quattro PDF e snapshot delle tipologie precedenti identici al confronto. Estesa la migration locale `20261121083215_subentri_privato_mortis_causa.sql` e validata in PGlite 0.5.13 con storico, RLS/grant e vincoli delle tre categorie. Guide aggiornate. Pubblicazione inclusa nel push unico.

- Loghi CRM 21/11: consegnato ZIP locale con logo Mirox, due favicon, Kona Guardian, logo del simulatore Protecta e grafica WindTre/159 estratta dai moduli in PDF vettoriale e PNG. Verificati i formati, l'integrità dello ZIP e l'anteprima dei file. Nessun seguito richiesto.

## Invio contratti Energia —21/11, correzione pubblicata

- Riprodotto l’errore prima della bolletta: la Function confrontava una ricevuta d’identità assente anche se il carrello era solo Energia. Dopo la creazione, il wizard cercava la cittadinanza nella ricevuta assente. Corrette entrambe le fasi. Il consenso, il blocco POD/PDR giornaliero e la bolletta per contratto restano obbligatori. Il carrello misto verifica i contratti soggetti e carica il permesso VAR extra UE quando richiesto.
- Pubblicato su richiesta con `c7b9393`. Build e 882/882 test sulla copia esatta del rilascio, CI `44920182519` verde Linux/Windows e Netlify `6b01babf704546363e9e1ea5` online dalle 16:38 Europe/Rome. Due URL di Upload Contratti, due core JS e pagina Subentri confrontati con la build. Function carrello HTTP 401 senza JWT. Creazione Consumer/Business, upload della bolletta e finalizzazione verificati con dati simulati. Guide README, AGENTS e databaseREADME aggiornate. Prossimo passo operativo: riprovare l’invio della pratica Energia. Evidenze in `.backup-private/release-energia-identita-20261121/`.

## Compilatore Subentri —21/11, modifiche locali

- Nel popup Mobile Microbusiness → Privato, sostituito il riepilogo con il testo fornito dal proprietario su cedente, cessionario, sei punti per il nuovo intestatario Micro Business e percorso ASK fino al tab arancione Subentro. Corpo scorrevole su schermi bassi. README, AGENTS e databaseREADME allineati.
- Build locale e 23 test Subentri verdi. Verificati in Node il testo distribuito, Indietro, Prosegui e duplicazione. Prossimo passo: proseguire con le richieste del proprietario in locale, poi un solo push su sua richiesta esplicita.
- Privato → Privato attivo in locale. Riepilogo fornito dal proprietario e domanda successiva Sì/No per mortis causa. Ricerche per CF personale di entrambi. PDF ordinario usa solo il primo foglio WindTre, già identico al modello in repo. Per mortis causa produce due fogli diversi, modulo WindTre e dichiarazione compilata dal primo foglio dell’allegato. Dichiarante dal cessionario, testo inserito dall’operatore, domicilio facoltativo, firme a mano. Limite quattro numeri per il PDF di due pagine. Invia pratica richiede i due documenti d’identità e, in caso di decesso, il certificato come allegato separato. Con Standard il certificato si aggiunge a parte.
- Verifiche Privato → Privato: build e 884/884 test verdi, 27 Subentri. DOM in Node per sequenza, chiusura, Sì/No, ricerche e ritorno al Microbusiness. PDF sintetici renderizzati e controllati. Dati e PDF Microbusiness identici a HEAD nei casi provati, inclusi retry multipagina. Migration locale `20261121083215_subentri_privato_mortis_causa.sql` validata in PGlite per storico, RLS/grant e nuovi vincoli. Per esito migration e pubblicazione vedi Rilascio Subentri sopra.
- Consegnati due PDF di esempio con dati fittizi generati dal codice locale: ordinario con IBAN (1 pagina) e mortis causa con bollettino e dichiarazione compilata (2 pagine). Controllate a video tutte e tre le pagine. File di prova fuori dal repository.

## Ex Fornitore in In Attesa – Energia —20/11, aggiornato in produzione

- Su richiesta svuotati i 39 valori presenti sulle 56 pratiche Energia in attesa, con prova in rollback, salvataggio privato e rilettura finale a zero. Controllate le impronte di esiti CSV, revisioni, allegati, Controllo L&G, altri contratti e altri campi. I 369 valori presenti nei verificati risultano conservati. Prove in `.backup-private/svuota-ex-fornitore-energia-20261120/`. Operazione dati una tantum.

## Formato CSV WindTre —20/11, correzione pubblicata

- Riprodotto il blocco del file del titolare: 7 record, PDR arrotondati in notazione scientifica alle righe 2–3, Data Firma con anno a due cifre su tutte le righe. Il backend ora legge le date brevi e indica esplicitamente la riga con il punto alterato, prima della RPC. Serve un export con PDR completi. Il file originale è intatto.
- Build e suite 880/880, 14 test mirati e harness SQL verdi. Riprodotto localmente il nuovo HTTP 400 con l’allegato e verificata la lettura di tutti i 7 record con due punti sintetici in memoria. Push `47a4ecf`, CI 44735836115 Linux/Windows verde, Netlify `6b003c8680fefbca0982fc1a` online. Due URL Verifica e asset JS identici alla build, endpoint import 401 senza JWT. README, AGENTS e databaseREADME aggiornati. Nessuna migrazione o import. Prove in `.backup-private/release-energia-formati-csv-20261120/`.

## Reset del test Energia novembre 2026 —20/11, eseguito in produzione

- 56 contratti Energia inviati per Data Inserimento Mirox a novembre Europe/Rome. Riaperti 30 verificati, 26 erano già pendenti. Azzerati 50 numeri, riscontri e 20 esiti manuali; 30 righe Controllo L&G rimosse e salvate nel backup privato. Verifica indipendente finale: 56 **IN ATTESA CSV**, zero in Verificati e in Controllo L&G, zero numeri e tipi, 56 bollette e 39 gestori uscenti presenti.
- Script `database/ripristina_attesa_csv_energia_novembre_2026.sql` provato in rollback, applicato con impronta e riletto. Impronte di contratti estranei, allegati, pratiche, note, fonte corrente, registro tipi e Controllo L&G degli altri periodi identiche. Prove in `.backup-private/ripristino-energia-novembre-20261120/`.

## Data Firma obbligatoria ed Errore CSV —20/11, pubblicati

- Primo riscontro Energia per POD/PDR e Data Firma M uguale a Data Inserimento Mirox (Europe/Rome), anche quando c’è una sola riga. Fiscale e scarto Annullato sui duplicati. Fallimenti per pratica in **ERRORE CSV** con nota. La lista, il filtro Esito, il riepilogo dell’import e il popup delle motivazioni mostrano il nuovo stato. L’icona apre la nota di revisione anche per **DA VERIFICARE**, destinato al passo successivo con Grogbot.
- Migrazione `20261120102022_energia_data_firma_errore_csv.sql`: stato e nota obbligatoria, riclassificazione dei precedenti errori CSV pendenti, riesame automatico al prossimo file. Esiti manuali e prove già pronte conservati. Il flusso successivo con Grogbot resta da integrare.
- Build e 879/879 test verdi in copia isolata. PGlite 0.5.13 verde su data coincidente/diversa/mancante/non valida, mezzanotte Rome, recupero con CSV corretto, nota obbligatoria e tutela degli esiti manuali.
- Migrazione applicata/riletta come `20261120121655`. SQL in sola lettura conferma accettazione data singola coincidente, rifiuto data diversa o mancante, nota obbligatoria e accesso RPC service-only. Advisor invariati. Push `888cca1`, CI 44734579640 Linux/Windows verde, Netlify `6b003a67800d5e0d6bc2b8bd` online. Confrontati HTML e Pretty URL di Verifica e JS contro la build, API import 401 senza JWT. Dopo il deploy risultano ancora 56 in attesa CSV, 0 verificati e 0 in Controllo L&G a novembre. Prove in `.backup-private/release-energia-data-firma-20261120/`. Prossimo passo: nuovo import a cura del proprietario.

## Upload Luce & Gas con bolletta e blocco giornaliero —19/11, pubblicato e bonifica conclusa

- Luce & Gas Consumer/Business richiede la sola bolletta. Documento e controllo identità esclusi anche nelle bozze Energia con altri contratti; i PDF si associano ai soli contratti che li richiedono. Finalize verifica per contratto. In Verifica Energia pendente sparisce il documento d’identità dagli allegati e dalle scelte.
- POD/PDR normalizzato, giorno di inserimento `created_at` Europe/Rome, entrambi i negozi. Blocco nel wizard, nel carrello e nella Function; indice univoco parziale e trigger privato per gli inserimenti concorrenti e i cambi di chiave dei contratti di oggi. Storico preesistente conservato. Migrazione sorgente `20261119173949_energia_upload_bolletta_duplicati.sql`.
- Build e suite completa 879/879 verdi in copia isolata. Harness PGlite 0.5.13 verde su ACL, storico, cambio giorno e ora legale, cancellazione bozza e rollback del doppio inserimento. Verificati flusso Energia con sola bolletta, carrello misto, errore di duplicato e allegati Verifica. Nessun browser.
- Migrazione applicata e riletta come `20261119175643`: trigger e indice validi, RPC service-only, vero per punto presente oggi e falso per chiave assente. Advisor sicurezza e prestazioni invariati. Pubblicato `4fa8ae4`, CI 44582737396 Linux/Windows verde, Netlify `6aff389dfeaa03f91cf70ebc` online. Quattro URL HTML e core JS verificati contro build, tre API 401 senza JWT.
- Bonifica dopo il deploy con prova di rollback e controllo delle associazioni sotto lock. Rimosse 35 righe documento e 35 PDF via Storage API. Rilettura indipendente conferma zero identità Energia pendenti e zero oggetti residui, tutte le 35 pratiche e bollette presenti, 368 identità Energia verificate conservate. Prove private in `.backup-private/energia-upload-20261119/`. README, AGENTS e databaseREADME aggiornati.

## TV senza polling Netlify —18–19/11, pubblicata/TV funzionante; intervallo30s pubblicato, reinstallazione PC pendente

- Richiesta: costo TV quasi zero, dati e calcoli come Dashboard. Helper Windows legge direttamente Supabase ogni3s con la credenziale dispositivo esistente; KPI calcolati nel browser con il core Dashboard/Target condiviso. Nessuna Function Netlify ordinaria e nessun fallback al vecchio GET.
- Richiesta19/11: nuovo helper ogni30s (90%letture in meno), prima lettura immediata e nessuna sovrapposizione; avviso45s/obsoleto90s.51test monitor/build verdi con timer virtuale e confini avvisi. Suite completa874/874/build verde in copia pulita. Push2827530, CI44529659573 Linux/Windows verde, Netlify6afef39570837fbda0636185 online. HTTP12asset/ZIP25file/SHA/PrettyURL/API401–403/preflight RPC e intervallo30000ms/avvisi45–90verificati. Nessun DB modificato. Serve nuovo ZIP/reinstallazione; attuale PC resta3s diretti Supabase. Prove private release-tv-30s-20261119.
- Manifest web API2/12asset ogni15min, ZIP25file; soltanto contenuti browser scaricati, mai codice eseguito da Node/SYSTEM. Circa0,576crediti/mese per le sole richieste manifest24h, oltre a banda/download; le letture Supabase usano il database esistente.
- Migration `20261118223737_monitor_diretto_supabase.sql` creata con CLI e applicata/riletta production20261119123037: schema privato e lettore DEFINER autenticato da capability256bit/stato/negozio, wrapper pubblico INVOKER; nessuna tabella/trigger/policy/grant sulle sorgenti CC/Vendita. Fingerprint MVCC più hash proiezione: niente trasferimenti se invariata, anche per scritture estranee. Heartbeat dispositivo5min e revoca controllata sempre.
- Allowlist senza anagrafica/documenti/codici cliente/note; ID contratto pseudonimizzati prima del browser. Giorno/mese server Rome, verificato_il distinto dall'ultimo trasferimento. Installer verifica la disponibilità della nuova RPC con credenziale vuota prima di fermare il servizio esistente; conserva DPAPI/associazione.
- Build e873/873test verdi in copia pulita aggiornata a f6523b6;98mirati monitor/core/Target/DOM/host/updater, simulazione1000poll senza Netlify/un solo trasferimento completo. PGlite63check nuova RPC e55registro legacy verdi. Nel checkout il test link considera erroneamente HTML nei backup privati ignorati; nessuna modifica a tali backup/test estranei. Nessun browser; collaudo production in transazione annullata,0dispositivi test persistenti.
- README/AGENTS/CLAUDE/databaseREADME/guidaMonitor/LEGGIMI aggiornati. Proprietario autorizza19/11 migration e push.87/88tabelle identiche per impronta; solo checkpoint del cron Guardian variato durante la finestra, strutture/policy/grant/trigger/funzioni precedenti e advisor invariati. Pubblicato runtime bcf2009, Netlify6afeed2cc8e8a2b629369ea0; CI44526065285 Linux/Windows verde873test e prove native installazione/SYSTEM/DPAPI/aggiornamento/rollback. Mock QA corretto in0138569 senza nuovo deploy. HTTP manifest API2/12asset/ZIP25file/SHA/pagine/PrettyURL/API401–403/preflight RPC verificati. Prove private release-tv-diretto-20261119. Proprietario conferma installazione riuscita e TV funzionante dopo prima foto ERR_CONNECTION_REFUSED; causa boot non provata, prossimo riavvio da ricontrollare. LogSupabase143risposte20013:49:07–13:56:23Rome,heartbeat attivo; Netlify19,99/minprima,ultima13:47:29e0invocazioni13:49–13:57:40(log puntuali,paginazione completa). Prove private consumi-netlify-prima-dopo.json; misura relativa al pacchetto3s prima del rilascio30s.

## Netlify —diagnosi crediti18/11

- Free sospeso14/11 per Functions limit (HTTP503/usage_exceeded), Personal9USD/1000crediti attivato dal proprietario e sito ripristinato. Account12maggio2025, ciclo14novembre–14dicembre.
- Lettura18/11:763,60013usati/236,39987disponibili;23production deploy=345crediti, Functions36,059GB-h=360,59014, richieste33,6116, banda24,39839, AI Gateway/Agent Runners/NetlifyDB=0. Tutti i23deploy successivi all'upgrade sono CRM;8solo docs=120crediti evitabili. Non presumere sufficienti1000crediti/mese al ritmo attuale.
- TV monitor-kpi121494chiamate/22,8655ore dopo upgrade: circa228,66crediti stimati. Poll3s continuo anche senza browser/schermo, cache server1s. Altri consumi stimati: CallDirectorTEST47,74, staging23,83, mirox-personal/aruba-sync23,96, VodafoneRetail6,51, CRM cronVerifica15,73/Guardian7,08/Target1,95. Functions già78–89crediti/giorno15–17novembre, non tutto dovuto all'OCR18/11.
- API ufficiali/Analytics; evidenze `.backup-private/netlify-crediti-20261118/`. Nessuna modifica a piano/ricariche/automatismi degli altri siti. Ridurre deploy solo documentali e valutare separatamente gli ambienti non operativi col proprietario.

## Verifica Energia solo CSV —18/11, pubblicata; supera i tentativi OCR precedenti

- Ultimo push2273016, CI44415577273 Linux/Windows verde, Netlify6afe2c0a6616c84e78c1d4d6 e HTTP/API verificati. CSV caricato manualmente dal proprietario: riscontro immediato POD/PDR, proposta H e tipo K; univoco→IN ATTESA VERIFICA, assente/ambiguo/incompleto→DA VERIFICARE con nota. Ex Fornitore facoltativo, controllo umano allegati; L&G conserva blocchi manuali.
- Migrazione sorgente20261118223152 applicata/riletta production20261118224831: vecchie RPC/coda OCR ferme, nuove correzioni punto/numero richiedono CSV; esiti manuali/prove pronte conservati. Non riattivare o monitorare i vecchi giri OCR sospesi.
- Script autorizzato ripristina_attesa_csv_energia.sql:45numeri/49fornitori svuotati,53/53pendenti IN ATTESA CSV, nessun residuo/coda; POD/PDR/allegati/fonte/tipi/L&G e campi estranei identici per impronta. Backup privato e advisor verificati. Prossimo: proprietario carica il nuovo CSV.
- Tipo pratica18/11: fcc415a, migration20261118220440/20261118221012; tipo K da599righe/645chiavi,474/523Energia e429/468L&G abbinati,49senza univocità. Colonna ricercabile anche nei verificati, tipi delle proposte assenti conservati. Precedenti rollout/guardie/QA e catena migration documentati in README/AGENTS/databaseREADME.

## Call Center e Fisso —ultimi rilasci pubblicati

- Black List18/11:7434890, CI44406058769verde, migration20261118215150. Chiusura atomica rilavorazioni collegate senza perdere storico/prenotazioni. Pregresso1ricontatto/13passaggi/1nonpresentato chiusi,180voci blacklist conservate. Rilettura al focus e controllo schede già aperte.
- Fisso17/11:f723b79/migration20261117074610. Tecnologia dettagliata distinta da catalogo/punti; Professional Box Si/No solo Business. Upload readonly dalla PDA, correzione solo Verifica. Cliente/codice contratto/POS9001415852 in Verifica; Controllo Fissi solo riepilogo, nuovi completi In Attivazione, stati storici conservati.
- Storico406Fissi:393tecnologie,6Box,374codici univoci aggiunti;13tecnologie senza fonte e8codici duplicati conservati senza assegnazione. Impronte contratti/controlli/punti/date/chat/estranei verificate, nessun altro backfill richiesto.
- Opzioni FWA17/11:7161506/CI44117849495/Netlify6afc76710f27189c6728439e,829test/HTTP verdi. syncFixedOffer rigenera opzioni dal pivot senza scelte arbitrarie. Guide AGENTS/README; prove private fisso-20261117.

## Segnalazioni, note e opzioni —pubblicate

- Apertura Mobile14/11 e Fisso18/11:9f23b10 ultimo ampliamento,845test/HTTP verdi. Sola ACL Verifica dal16/11(c600aea), pagina Segnalazioni mantiene ACL separata. Mobile Reload Forever/Professional Cloud/Altro; Fisso solo Cloud/Altro. Conferma/spinner/retry, copia di tutti gli allegati del solo contratto, permanenza sul dettaglio. Nessun invio ASK/email/disattivazione.
- Registro Mobile/RPC service-only migration live20261114092756. Pulizia test autorizzata14/11:segnalazioni625/626/627,3richieste e8copie eliminate, altre606pratiche/originali/sequenza627 identici; prove private elimina-segnalazioni-test-20261114.
- Note contratto16/11:7f82817/migration20261116172228,820test/HTTP verdi. Registro append-only vendita_note_contratto, autore fresco/data/4000caratteri/retry; bozza distinta dal dirty contratto, nessun riesame o approvazione. Lettura verificata su vecchi contratti senza note reali di collaudo.
- Business17/11:569908f nasconde Reload nelle due categorie Business; CloudNULL mostra Non rilevato. f9a8ec1 riusa checkbox/conferme/gestione Forever per Professional Cloud Mobile/Fisso Business. Nessun backfill dai soli NULL, punteggio o stato modificato.
- Segnalazioni11–12/11: gestione ASK con sottotipo/Angel/Interna, percorsi Da gestire dedicati; nessuna assegnazione/email. Ultimi497617c/b5d4563/bb9dfe6, CI/HTTP verificati. Regole dettagliate in README/AGENTS/databaseREADME.

## Roster, gare, planning e TV installata

- Uscita Vincenzo14/11:e0d8752/migration20261114090359. Da novembre escluso da Day/Gare/Mensile/PNG/Target/Admin/Personale, nessun sostituto; ottobre e precedenti con Francesca. Account conservato/disabilitato, UUID storico immutato. Planning conserva raw/turni cessati e merge da vecchi client; nessuna rigenerazione turni altrui.
- CC da novembre dipende dalla sola presenza Matteo, conferma esplicita proprietario. Snapshot approvato, assenze/riposi/chiusure/offsite e durata intera; fallback legacy senza prima pubblicazione. Nessun appuntamento spostato. Guida docs/PLANNING_PERSONALE.md;789test/113checkSQL/HTTP verdi.
- Gare04/11: replica ottobre→novembre2026–dicembre2100 applicata,19580INSERT/890mesi, Avanzamento escluso. Poi11570descrizioni e2670soglie Fisso aggiornate. Retry replica originale può segnalare conflitto con descrizioni successive: mai sovrascrivere. Storico/catalogo/profili/finanze estranee verificati.
- Accesso bonus da novembre:10Fissi/10Energia/10MobileBusiness(noCB)/1FissoBusiness incluso nei10; personali obbligatori anche per squadra, firma mese/entrambi negozi/alias/no reinserimenti. Righe compensi conservate, totale0se manca soglia. Avvisi! soltanto con almeno una riga>=1EUR; OK/KO grassetto.72ee5ee/3bf67e2, suite/HTTP verdi.
- Avanzamento FISSI: due negozi/ConsumerBusiness, nonFTTC mese firma/stati ammessi o pendenti, FTTC Attivo/mese attivazione; reinserimenti finalizzati inclusi31/10. EnergiaPIVA noAnnullato/Rifiutato, Standard noRifiutato; NettoStandard esiti utili/ultimoCSVglobale/popup aggregati. CAMBI PIANO metrica23 con target separato. Core condiviso, nessun target dedotto dai bonus individuali.
- TV precedente:helper42ddc96/layout0536f25, manifest4ae3bc51, ZIP22file/API1, poll Netlify3s/manifest30s. Proprietario conferma nuovo pacchetto funzionante19/11; letture dirette/stop Netlify verificati, intervallo30s pubblicato da reinstallare, vedi sopra. Guide docs/MONITOR_NEGOZIO.md e docs/MONITOR_DEBUG_2026-11-06.md.

## Moduli e collaudi ancora aperti

- Malpractis13/11:storico/duplicazione231faa7, PDF KONA TECH SRL v4 d16830f, centratura703a1bc. Vecchi PDF immutati: rigenerare da Duplica dati. Codici cliente con punti/prefissi/zeri conservati, verifica readonly18d71f6. Nessun rilascio pendente.
- Identità/scanner:0fbf10d/ff1737a/1f102ea/3335a1c pubblicati, ricevute HMAC/snapshot/hash/byte e recupero manuale confermato. Collaudo fisico UNA pratica CIE col proprietario, poi TS/Business/VAR; nessun test massivo/attivazione serale automatica. File in memoria da riselezionare dopo reload. Guide docs/SCANNER_COLLAUDO_RILASCIO_2026-10-30.md e docs/IDENTITA_RECUPERO_MANUALE_2026-10-30.md.
- Verifiche/email:collaudo=true, nessun recupero vecchie email/WhatsApp/disattivazione automatica. Conferma assistita di UNA pratica solo dopo esito positivo. Modifiche Energia successive sono quelle soloCSV sopra, non riattivare OCR storico.
- Planning: formazione9–10ottobre ancora da chiarire, non scegliere date. PDF/ore/nota interna conservati. Seconda linea Fisso:script31/10 già applicato,1,50punti gara/Extra1,00,nessuna nuova esecuzione; reinserimenti Fisso31/10 già finalizzati. Dettagli nelle guide tecniche.
- Subentri Mobile: Microbusiness→Privato pubblicato. Privato→Privato, Privato→Microbusiness, Microbusiness→Microbusiness e 1928→Privato inclusi nel rilascio del 22/11. Disdette: ricerca CRM prima del manuale. Non estendere in autonomia.

## Vincoli persistenti

- NON USARE IL BROWSER. Solo DOM Node/HTTP/CLI/SQL; prove UI/documenti reali col proprietario. Nessuna automazione browser dopo stop.
- Push main deploya mirox-crm.it: solo richiesta esplicita. Nessuna attivazione automatica o force-push. Schema/RLS/RPC/trigger condivisi CC/anagrafica secondo consenso AGENTS; nuovo Supabase/restore gestito sospesi fino rimozione CC test.
- Segreti/PDF/dati reali solo .backup-private ignorata. dist pubblica soltanto HTML/assets/css/js/moduli e librerie browser consentite, nessun backend/QA/dato privato. mirox-crm.it e mirox-crm.netlify.app sono lo stesso site; deploy storico CC ancora da identificare.
- Guardian unico production autorizzato; nessun ripristino ambienti separati, messaggio o consenso simulato. ACL per pagina separate dal CC, admin attivi sempre ammessi; non dedurre permessi dal nome/alias/ruolo operativo.

## Backup, infrastruttura e altri punti aperti

- Aruba/VPSItalia AES-GCM/readback/Compliance; timer orario17UTC/full03:17UTC, audit06:47UTC/restore trimestrale. Verifica05–23/10:418/441OK,23falliti/max8h; full20–23mancanti. Ultima copia23/10 valida7298file/11bucket/176manifest, lifecycle13/23. Diagnostica/retry/recupero full e soglia audit ancora aperti: non presumere regolare. docs/BACKUP_VERIFICA_STORICO_2026-10-23.md.
- Inventario offsiteNetlify28/20/8 da riallineare,7Secret senza copie più nuovaOpenAI; custodia offline da confermare, AES separata confermata. Restore05/10:100tabelle/51313righe identiche, nessun testAPI/ACLgestite. docs/BACKUP_RIPRISTINO.md.
- SupabaseSmall/PG17.11 dopo incidente26–27/10. Ultima lettura infrastruttura11/11:ACTIVE_HEALTHY/carico basso/0HTTP5xx, nessun upgrade giustificato; piccola quota swap da monitorare, budgetIO non verificato. docs/INCIDENTE_ACCESSO_REPORT_2026-10-27.md.
- GuardianKG23 chiusa/PR13merge81412e4;95cd066 vocali/comandi senza duplicati. KG25 aperta. Correzione anagrafica Business duplicata ancora decisione proprietario, zero scritture.
- WhatsApp:WAHA candidato non ufficiale, numero/VPS/flussi da definire; nulla installato. CallDirector non integrato, ambienti/migration079/072 da riallineare. Automatismi dei siti separati restano invariati nella revisione TV.
