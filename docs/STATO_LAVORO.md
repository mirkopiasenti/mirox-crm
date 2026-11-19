# Stato del lavoro — Mirox CRM

Aggiornato:2026-11-19. Promemoria di ripresa; non autorizza push, attivazioni o ripresa di attività sospese. Dettagli tecnici in AGENTS/README/databaseREADME e nelle guide citate.

## Tipo pratica nel dettaglio e duplicati Energia —19/11, pubblicati

- Campo Tipo pratica in sola lettura nei Campi specifici categoria. In caso di più righe per POD/PDR, criteri progressivi M (Data Firma rispetto a giorno Data Inserimento Mirox, Europe/Rome), E/F (CF o P.IVA), X (esclusione Annullato). Zero o più righe finali → Da verificare con nota. Il prossimo CSV riprende i soli esiti automatici da verificare, con tutela degli override e della coppia proposta–POD/PDR.
- Migrazione `20261118230401_energia_csv_screma_duplicati.sql` applicata e riletta produzione come `20261118231007`. Riletti 42 tipi disponibili e 10 esiti automatici riesaminabili. SQL PGlite, prova produzione in sola lettura, build e 863/863 test verdi. CSV originale conferma il tracciato M con 512 date. Il titolare eseguirà il caricamento dopo il deploy.
- Push `f6523b6`, CI 44418597892 verde Linux e Windows, Netlify `6afe30b4c08e5cf2d3172d03` online. Verificati campo Tipo pratica e script serviti nelle due URL di Verifica, Controllo L&G e import 401 senza JWT. Il prossimo caricamento manuale è pronto.

## TV senza polling Netlify —18–19/11, rilascio autorizzato in corso

- Richiesta: costo TV quasi zero, dati e calcoli come Dashboard. Helper Windows legge direttamente Supabase ogni3s con la credenziale dispositivo esistente; KPI calcolati nel browser con il core Dashboard/Target condiviso. Nessuna Function Netlify ordinaria e nessun fallback al vecchio GET.
- Manifest web API2/12asset ogni15min, ZIP25file; soltanto contenuti browser scaricati, mai codice eseguito da Node/SYSTEM. Circa0,576crediti/mese per le sole richieste manifest24h, oltre a banda/download; le letture Supabase usano il database esistente.
- Migration `20261118223737_monitor_diretto_supabase.sql` creata con CLI e applicata/riletta production20261119123037: schema privato e lettore DEFINER autenticato da capability256bit/stato/negozio, wrapper pubblico INVOKER; nessuna tabella/trigger/policy/grant sulle sorgenti CC/Vendita. Fingerprint MVCC più hash proiezione: niente trasferimenti se invariata, anche per scritture estranee. Heartbeat dispositivo5min e revoca controllata sempre.
- Allowlist senza anagrafica/documenti/codici cliente/note; ID contratto pseudonimizzati prima del browser. Giorno/mese server Rome, verificato_il distinto dall'ultimo trasferimento. Installer verifica la disponibilità della nuova RPC con credenziale vuota prima di fermare il servizio esistente; conserva DPAPI/associazione.
- Build e873/873test verdi in copia pulita aggiornata a f6523b6;98mirati monitor/core/Target/DOM/host/updater, simulazione1000poll senza Netlify/un solo trasferimento completo. PGlite63check nuova RPC e55registro legacy verdi. Nel checkout il test link considera erroneamente HTML nei backup privati ignorati; nessuna modifica a tali backup/test estranei. Nessun browser; collaudo production in transazione annullata,0dispositivi test persistenti.
- README/AGENTS/CLAUDE/databaseREADME/guidaMonitor/LEGGIMI aggiornati. Proprietario autorizza19/11 migration e push.87/88tabelle identiche per impronta; solo checkpoint del cron Guardian variato durante la finestra, strutture/policy/grant/trigger/funzioni precedenti e advisor invariati. Prossimo: pubblicare e reinstallare una volta il servizio sul PC conservando state.bin. Vecchio helper continua a consumare Netlify finché non sostituito. Nuovo collaudo Windows/TV e misura consumi dopo installazione ancora da fare. Nessun push TV eseguito.

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
- TV attualmente installata:helper42ddc96/layout0536f25, manifest4ae3bc51, ZIP22file/API1. WindowsSYSTEM/DPAPI/ACL/updater/rollback già verificati in CI; attuale poll Netlify3s/manifest30s fino alla reinstallazione nuova. Guide docs/MONITOR_NEGOZIO.md e docs/MONITOR_DEBUG_2026-11-06.md.

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
