# Stato del lavoro — Mirox CRM

Aggiornato:2026-11-20. Promemoria di ripresa; non autorizza push, attivazioni o ripresa di attività sospese. Dettagli tecnici in AGENTS/README/databaseREADME e nelle guide citate.

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
- Subentri:Microbusiness→Privato tre gruppi, Standard soloPDF, altre4procedure da raccogliere. Disdette: ricerca CRM prima del manuale. Non estendere in autonomia.

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
