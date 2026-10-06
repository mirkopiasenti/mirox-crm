# Stato del lavoro — Mirox CRM

Aggiornato: 2026-10-06. Promemoria di ripresa, non autorizza interventi o deploy;
istruzioni dell'utente e guide di progetto restano vincolanti.

## Guardian: sviluppo Telegram06/10 in collaudo

- Loop KG23: Analisi Guardian solo discorsiva; implementa non dispatchava Codex. Comando diretto owner ora avvia patch e include test/recupero cron, poi proposta finale Telegram. AI propone pulsanti senza autorizzare lavoro; vecchi callback analisi leggono repository.
- Consenso/hash requisito/sorgente persistiti, deduplica vocali e richieste attive; niente test su requisiti superati o ripetizioni infinite. Needs-info/blocked/no-change fermano la catena; nessun merge senza conferma finale.264/264test+build (16nuovi), 00176fa online19:57:11/CI37507449399/health37507655840 OK. Prova reale: worker sviluppa ma SQL scartato; follow-up conserva PR SQL in revisione, catalogo read-only e1punto complessivo confermato. Nessuna nuova migration/env.
- Vocali0d76d28 online19:34:30/248test: FK voice_job_id conserva BIGINT identity. Audio autorizzato HTTP200/2,531s, job baa8d026 completato/TG17219:35:36; KG23 richiede due righe Day by Day e due opzioni CB, CP+telefono finanziato/VAR. Non ancora implementata nel CRM.
- Guide README/AGENTS/CLAUDE/databaseREADME e docs/GUARDIAN_SVILUPPO_TELEGRAM_2026-10-06 aggiornati. Backup e lavori estranei preservati.

## Avanzamento: CAMBI PIANO aggiunta online 06/10

- Riga Standard id23/ordine35 tra TELEFONI CB e FISSI; TIED Consumer/MOBILE Business solo Legnago, senza reinserimenti, 1 punto per cambio. Per operatore e totale; anche mesi storici, PNG e Target tramite catalogo dinamico.
- `database/configura_avanzamento_cambi_piano.sql` applicato/riletto, hash altre metriche e tutti gli obiettivi invariati, preflight successivo OK. Nessun frontend/schema/RLS/CC modificato. Obiettivo mensile configurabile da Admin, senza inventare target collettivo15.
- Ottobre reale: Matteo2/Francesca0/Mirko0, totale2. 234/234test+build locali (233versionati+1backup), nuova regressione Avanzamento/alias/scopo/punti Business. Guide README/AGENTS/CLAUDE/database README aggiornate; backup preesistente preservato. Riga gia' disponibile, ricaricare la pagina per rileggerla.

## Gare ottobre 2026: online e configurazione applicata 06/10

- Confermato: TIED individuali 35/100 EUR; CB 35 telefoni Consumer VAR/Finanziamento + 15 cambi piano Consumer TIED/Business MOBILE (equivalenza autorizzata)/100 EUR; Assicurazioni squadra Francesca/Matteo/Mirko solo Legnago, 10 punti reali/50 EUR a ciascuno.
- DSL `obiettivi_combinati` e override mensile `compenso_regola.gara`; motore condiviso, doppio progresso CB/descrizione mensile Dashboard, editor Admin conserva condizioni/scope e modifica soglie/bonus. Storico e Avanzamento invariati.
- Push esplicito autorizzato: `ab44097` online, Netlify `6ac4e89af38fe1000833072a`, CI `37463079339` riuscita. SHA/metadati/core e HTML pubblicati verificati (sole riscritture Pretty URLs Netlify); function senza JWT 401. Snapshot del commit: 232/232 test+build; locale con backup preesistente: 233/233, 11 test dedicati.
- SQL `database/configura_gare_2026_10.sql` applicato e 9 righe confrontate con il piano. Hash altri obiettivi/metriche globali identici prima-dopo, preflight successivo riuscito; nessuna modifica profili/schema/RLS/CC. Default file `applica=false` conservato. Copia prima privata `.backup-private/gare-2026-10/prima.json`.
- Dati reali: 2 Assicurazioni Matteo = 1 punto squadra per tutte e tre le schede, bonus 0 sotto soglia. Guide README/AGENTS/CLAUDE/database README aggiornate; pubblicazione richiesta comprende la chiusura documentale. Backup preesistente escluso dal commit e preservato. Nessun punto aperto sulle tre gare; obiettivi Avanzamento ottobre restano separati e non configurati.

## Identita per contratto: online e bonifica applicata 05/10

- Dal01/07/2026 Europe/Rome:837contratti,132senzaidentita;125recuperati stessa pratica+3con riuso piu recente stesso cliente esplicitamente autorizzato.128contratti/129PDF indipendenti verificati SHA256/readback, zero errori, copie prima luglio0/file mancanti0;833coperti,4residui Energia/2pratiche senza PDF per il cliente. Elenco privato `.backup-private/identity-backfill/DA_INTEGRARE.md`; ultima rilettura0recuperabili/idempotente.
- Regola online: identita sempre obbligatoria, una selezione/fanout server su tutti i contratti bozza, batch atomico/rollback, finalize blocca righe senzaidentita. Upload successivi specifici; nessuna modifica schema/RLS/CC.222/222test+build locali (221versionati+1backup),15test dedicati; snapshot commit pulito221/221. Guide/rapporto `docs/IDENTITA_CONTRATTI_2026-10-05.md` aggiornati, backup preesistente escluso dal push.
- Push autorizzato: commit7c5afef online, Netlify6ac411ed17611f0008c6aa5e, metadati e carrello HTTP200/SHA esatto;2function senzaJWT401. CI37374083065 riuscita. Auto-review secondo apply prima bloccato per piano concorrente17righe, poi nuova query/dry-run3esatti e retry approvato/riuscito; nessun blocco residuo. Prossimo: PDF dei4residui Energia/2pratiche.

## MIROX AI - Target: attivo production 05/10

- Bot `@MiroxAiTargetBot` solo Mirko; tre report alle 19:45 Europe/Rome, lun-sab escluse festivita' nazionali/Pasquetta; aggiornamento manuale e dialogo testo/vocali, memoria30, strumenti read-only aggregati.
- Presentazione aggiornata: vendite testuali spaziate con totale in alto; CC e mensile in PNG locali (resvg2.6.2 + font Lato OFL), nessuna API immagini. Snapshot SVG+testo nella coda, raster prima del checkpoint, memoria solo testo; limiti foto -> documento PNG.203/203 test+build locali (202versionati+1backup preesistente), anteprime reali private controllate. Layout47a7beb pubblicato: Netlify6ac406309a8a3d0008d7fa39 online; job layout-check3/3 inviati20:20:36UTC al primo tentativo, nessun errore. CI37368961629 in attesa; memoria10 solo testo e lease rilasciato.
- Richieste libere corrette: la frase «Rimandami il report completo di oggi (tutti e 3)» prima passava al dialogo e generava1testo. Alias diretti + toolAI invia_report restituiscono intento validato alla stessa coda testo/PNG.207/207 test+build locali (206versionati+1backup), regressione/retry/invalidi e OpenAI reale su dati sintetici OK; analisi/spiegazioni restano testuali. Fix98dfc79 online (Netlify6ac4092ffb22420009086e70); ripetuta la frase esatta, job repair3/3 testo+PNG+PNG inviati20:32:52UTC al primo tentativo/zero errori. CI37370299191 in coda.
- Vendite: data contratto UTC come Day, solo Legnago, esclusi reinserimenti, categorie non-zero per operatore. CC: Consumer+outbound, tentativi/risposte/non risposte/nuovi fissati, spostamenti separati e totali. Mensile: Standard+sola Extra Gara P.IVA, Andamento/Eccedenza.
- Feature84a8232 pubblicata su richiesta, CI37360431887 OK; Netlify6ac3f57c online e metadati/HTML/motore HTTP200.198/198test+build locali, rendering mensile identico su dati reali e60mesi calendario. Backup preesistente fuori dal commit e preservato.
- Migration20261005185700 applicata: sessioni/jobs server-only, RLS+CRUD anon/authenticated negati e service_role concessi. Nessuna tabella CC/Guardian alterata.
- 6valori dedicati Production Secret Builds/Functions/Runtime (scope isolato non disponibile); 2modelli facoltativi vuoti, default nel codice. Primo deploy bloccato per nomi modello marcati Secret, retry riuscito senza disabilitare scanner. Chiave OpenAI dedicata solo Target.
- Webhook/HMAC reali verificati, pending0/errori0; cron evening:2026-10-05 creato19:10UTC e3/3report consegnati19:15UTC al primo tentativo. Recupero serale dopo attivazione fuori orario;2messaggi utente (Avvia/dialogo libero) elaborati, memoria7 e lease rilasciato.
- Testo OpenAI reale e trascrizione WAV sintetica riusciti; vocale entrante Telegram da provare col proprietario. Ottobre senza obiettivi: Andamento esplicitamente non configurato, non copiare settembre.
- Guide README/AGENTS/CLAUDE/database README e docs/MIROX_AI_TARGET.md aggiornate; inventario privato Netlify riallineato localmente. Config recovery off-site precedente da aggiornare. Prossimo passo funzionale: obiettivi ottobre decisi dal proprietario e prova vocale reale.

## Guardian: distribuito production il 05/10/2026

- 104messaggi settembre:80analisi fallite+5scan. Run campione invalid_api_key, workflow verde mascherava guasto; gia' OpenAI, nessun DeepSeek nel codice.
- Con consensi specifici chiave GitHub aggiornata13:23:38 e Netlify16:18:50; health16:21:36 OK, analisi Codex KG18 run37323380962 riuscita16:17:28.
  Secret/contesti preservati, chiave privata0600; nessun blocco auto-review residuo.
- Chat libera senza ticket/anche archiviato, memoria30messaggi, paragrafi e contesto tecnico. Dialogo generale non crea ticket; operazioni auditabili con pulsanti.
- Una analisi automatica per segnale/release, claim condizionali cron/outbox, notifica scan senza segnale, preflight/URL/modello da DB, workflow rosso su errore;
  callback tardivi non riaprono archiviati. Migration conversazione JSONB applicata.
- Proprietario esclude vecchio staging e autorizza sviluppo/collaudo/deploy prod; vincolo rimosso da guide. Worker patch da main/PR draft, pubblicazione con seconda conferma Telegram.
- Report docs/GUARDIAN_DIAGNOSI_2026-10-05.md; checkout guardian-affidabilita-chat attaccato. Lavoro backup preesistente preservato, stash recuperabile.

## Backlog settembre: distribuito e chiuso 05/10

- Commit fca1c00, deploy ready16:54:15;160/160test+build,6pagine/codice HTTP200, OTP/catalogo senza sessione401. Health37328685582 alle16:55:56 tuttoOK.
- KG14/15/20 Ticket,18Comodato,19SIM,10Storage544:6risolti. Retry GET catalogo, OTP single-flight/CAS/rilettura PDF; niente SMS/consensi reali di collaudo.
- KG9 504,12/16rete:3storici mitigati/archiviati, causa non dimostrata;
 5scan fallite archiviate senza inventare risultati.14audit,8segnali chiusi, zero casi settembre aperti. Nuovo commit separa eventuali ricorrenze.
- KG1–7agosto fuori scope, nessun messaggio settembre; storico conservato.
- Report docs/GUARDIAN_BUG_SETTEMBRE_2026.md; guide aggiornate, backup preservato.

## Pubblicazione finale Telegram: collaudo completato

- Feature73a8c0d online17:56:04;178/178 test+build,6workflow/24shell validi; health37336874018 OK.
- Conferma finale1h legata a SHA head/base/PR/test/owner, CAS/doppio clic, workflow da main.
- KG22/PR12 sola documentazione: test37337090495 OK; proprietario ha premuto il pulsante Telegram.
- Run37339405520 riuscito: mergeffe515d alle18:15:37, Netlify6ac3cd2b ready18:16:08, healthOK18:16:14.
- Metadati pubblici HTTP200 confermano il commit esatto; incidente risolto, approvazione eseguita.
- Notifica finale outbox consegnata18:20:22 al primo tentativo. Ritardo previsto: cron ogni5min.
- Nessun consenso simulato, migration o secret nuovo. Flusso merge/deploy reale ora verificato.
- Preview PR12 fallita: anteprime Netlify disabilitate (`skip_prs=true`), main/build e altre impostazioni invariati.
- Guide e rapporto collaudo aggiornati; chiusura documentale committata localmente, non nuova pubblicazione.

## Backup: stato precedente conservato

Aruba attivo: VPS IT1 O2A4 (6,29 EUR/mese + IVA), Storage R1-IT, versioni/Compliance/
AES-GCM, backup orario minuto17 UTC; checkpoint completo 03:17 dopo cleanup CRM.
- Restore off-site 100 tabelle/51.252 righe COPY identiche, 6.584 file verificati. PDF sorgente404 recuperato da duplicato checksum/size, originale invariato.
- Healthchecks1h/grace1h/email e assenza ping collaudati; chiave AES separata. Audit06:47UTC enabled: restore trimestrale100 tabelle/51.313 righe COPY identiche,
  18,5s; skip secondo run. Lifecycle reale ancora da osservare. Docker off.
- Netlify20/28 valori privati cifrati/readback; 7 altri Secret senza copie; chiave OpenAI
  nuova recuperabile localmente, off-site configurazioni precedente da riallineare. Auth13 template/7pagine e DNS19 record salvati; inventari statici. Repo pubblico e working tree cifrati off-site.
- Runner8worker, verify-full/CA, LoadCredential root0440/read-only, SSH/UFW; kernel6.8.0-146, resize legacy disabilitato su root gia' espanso.
- TAR indipendente11:46:6.585 file/1.156.382.720byte, SHA256/AES verificati offline; .backup-private/offline/, custodia fisica su supporto scollegato da confermare.
- Utente ha rinviato nuovo Supabase/collaudo completo fino a rimozione CC test: non creare/rimuovere senza nuova decisione. Budget10-15EUR+IVA.
- Backup locale non committato, precedenti68 test Python; ed.hup/output/tmp preesistenti invariati. Dettagli: docs/BACKUP_RIPRISTINO.md.
- Call Director kona-call-director/5ce82af non integrato; precedente313/313.

## Punti aperti dalla ricognizione precedente

- KPI read-only04/10, PNG finale aggiornato05/10, dati fino04/10: Mobile Tied giugno-settembre15/9,24/6,32/7,20/3 (91/25); CB Cambio Piano TIED74, Telefono
  Incluso616 (1Business), device true VAR/Finanziamento, escluse3 senza device.
- Fissi Attivo per attivazione giugno-settembre37,35,32,36 (140). CF normalizzato: SIM interna dallo stesso giorno in poi2,6,9,8 (25); altre SIM20,14,9,8 (51),
  finestra inserimento fisso-5mesi → fine mese successivo, esclusa interna, EXISTS/COUNT DISTINCT,2sovrapposti. Settembre25finestre ancora aperte.
- Residuo66 (16,15,14,21):5Mobile fuori criterio,61nessun recordMobile. Titolo scelto utente «Gia' Clienti W3 Mobile» per tutto il residuo, non derivato dal DB.
  SIM usano data_contratto; storicoMobile da gennaio2026. Luglio1IMEI/VAR flag devicefalse escluso da chiarire; nessuna modifica DB/app/deploy per questi KPI.
- Call Director079gia' applicata staging: chiusura vendita→CC richiede verifica autorizzazioni/relazioni/stato/nonpresentati; mancano tabelle vendita staging.
  Comuni prima vuota, geografica da verificare; main da allineare,072 collide. Flusso completo/doc da verificare; non integrare senza nuova autorizzazione.
- Permessi granulari Vendita/Post-Vendita/UI revoca privacy: limitazioni note, nessuna nuova richiesta. Dettagli: docs/KONA_CALL_DIRECTOR.md del relativo branch.

## Riferimenti e vincoli

- Guide: AGENTS, README, database/README (non rappresenta da solo il DB vivo).
- Produzione CRM: `mirox-crm.it`, alias `mirox-crm.netlify.app`; repo CC storico ignoto.
- Guardian unico ambiente production; Call Director test separato.
- Push solo su richiesta esplicita; ogni push su `main` avvia il deploy production.
- Modifiche alle tabelle CC condivise richiedono conferma preventiva e devono rispettare i confini documentati in `AGENTS.md`.

Controllo runtime privato: guardian-healthcheck.yml verifica OpenAI/Telegram e
memoria dal worker Netlify, con HMAC; nessun messaggio Telegram o dato CRM AI.
