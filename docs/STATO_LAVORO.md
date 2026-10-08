# Stato del lavoro — Mirox CRM

Aggiornato: 2026-10-08. Promemoria di ripresa, non autorizza interventi o deploy;
istruzioni dell'utente e guide di progetto restano vincolanti.

## FISSI Avanzamento Standard: correzione pendenti08/10

- Prima pubblicazione175e772/Netlify6ac7cca17641670008f4dce2/CI37813468417OK: include Cerea e stato Da completare ma ottobre resta11pezzi/14,25punti. Segnalazione utente riprodotta nel Chrome: Matteo8/Francesca3. Causa:6Fissi da_controllare senza riga post-vendita (il trigger la crea solo dopo verifica), ancora esclusi.
- Correzione: quei contratti contano come pendenti nel mese firma. Consumer/Business Legnago+Cerea, no KO/reinserimenti; FTTC solo Attivo/mese attivazione, come prima. Errori lettura controlli/attivazioni bloccano caricamento, mai assimilati a record assente. Nessuna modifica DB/schema/obiettivi o altri avanzamenti/Day.
- Verifica su dati reali letti08/10:17pezzi/24,25punti, Matteo13/Francesca4; di cui6pendenti/10punti. Motore condiviso Dashboard/PNG/Target. Build287/287test locali OK (286versionati+1backup), regressioni loader browser/report server e letture fallite. Guide AGENTS/README/CLAUDE/database README/Target aggiornate; pubblicazione correzione in corso sul push autorizzato. Backup/Guardian preesistenti preservati, anagrafica ancora sospesa sulla scelta utente.

## Guardian: KG23 online, correzione vocali06/10 sera

- KG23/PR13 pubblicata da conferma reale Telegram: merge81412e40fbe5 online23:08:32/Netlify6ac5632e. Test280, piano catalogo revisionato2offerte/2righe Consumer a1punto e regole14-15 per escludere i nuovi nomi, storico preservato. RPC transazionale/checkpoint owner/lease/SHA/test; nessun consenso simulato.
- Vocali23:15 e23:19 salvati, primo errore trascrizione generico blocca secondo. Correzione in corso: filename Telegram.oga normalizzato a.ogg con byte/MIME invariati, lingua per modello, codici API ripuliti, errore permanente libera il successivo. Nuove richieste testuali aprono caso reale, senza restare sulla KG23 chiusa. Nessuna migration/env nuova.
- Build/suite284/284test riusciti;4regressioni dedicate su filename/byte, campo lingua/errori, coda permanente e apertura+snapshot vocale. Pubblicazione e recupero vocali ancora da verificare. Guide README/AGENTS/CLAUDE/databaseREADME aggiornate; backup/altre attivita preservati.

## Correzione anagrafica Business: duplicato individuato, scelta pendente

- Richiesta di sostituire un CF con P.IVA e sistemare la pratica del 05/10. Rilettura production: stessa persona gia' presente come Business con la P.IVA e pratica del 01/07; univocita' cf_piva impedisce sostituzione diretta.
- Sorgente CF:1pratica/1contratto Mobile Business05/10,2documenti,3consensi legacy; destinazione P.IVA:1pratica/1contratto Mobile Business01/07,3documenti,1consenso. Zero collegamenti CC/post-vendita/ordini/apri-chiudi/switch/v2 per entrambe. Pratiche/contratti visualizzano il codice tramite FK anagrafica; non riscrivere PDF firmati.
- Chiesto: mantenere CF come Consumer e riassociare la pratica alla Business esistente, oppure unificare sulla P.IVA conservando lo storico. Nessuna scrittura eseguita, nessuna modifica codice/schema o push; operazione dipende dalla scelta del proprietario. Identificativi solo nel contesto privato, non nei file pubblici.

## Avanzamento: CAMBI PIANO aggiunta online 06/10

- Admin verificato direttamente nel Chrome del proprietario: `CAMBI PIANO` presente anche in «Avanzamento Mensile - Obiettivi di categoria»/Standard tra TELEFONI CB e FISSI, campo obiettivo modificabile (ottobre 2026:0). Pagina portata alla sezione; nessun obiettivo modificato, nessun fix codice necessario. Salvataggio su change del campo gia' previsto dall’Admin.
- Riga Standard id23/ordine35 tra TELEFONI CB e FISSI; TIED Consumer/MOBILE Business solo Legnago, senza reinserimenti, 1 punto per cambio. Per operatore e totale; anche mesi storici, PNG e Target tramite catalogo dinamico.
- `database/configura_avanzamento_cambi_piano.sql` applicato/riletto, hash altre metriche e tutti gli obiettivi invariati, preflight successivo OK. Nessun frontend/schema/RLS/CC modificato. Obiettivo mensile configurabile da Admin, senza inventare target collettivo15.
- Ottobre reale: Matteo2/Francesca0/Mirko0, totale2. 234/234test+build locali (233versionati+1backup), nuova regressione Avanzamento/alias/scopo/punti Business. Guide README/AGENTS/CLAUDE/database README aggiornate; commit `6048391` pubblicato, CI `37464842798` riuscita. Backup preesistente preservato. Riga gia' disponibile senza cambio frontend, ricaricare la pagina per rileggerla.

## Gare ottobre 2026: online e configurazione applicata 06/10

- Confermato: TIED individuali 35/100 EUR; CB 35 telefoni Consumer VAR/Finanziamento + 15 cambi piano Consumer TIED/Business MOBILE (equivalenza autorizzata)/100 EUR; Assicurazioni squadra Francesca/Matteo/Mirko solo Legnago, 10 punti reali/50 EUR a ciascuno.
- DSL `obiettivi_combinati` e override mensile `compenso_regola.gara`; motore condiviso, doppio progresso CB/descrizione mensile Dashboard, editor Admin conserva condizioni/scope e modifica soglie/bonus. Storico e Avanzamento invariati.
- Push esplicito autorizzato: `ab44097` online, Netlify `6ac4e89af38fe1000833072a`, CI `37463079339` riuscita. SHA/metadati/core e HTML pubblicati verificati (sole riscritture Pretty URLs Netlify); function senza JWT 401. Snapshot del commit: 232/232 test+build; locale con backup preesistente: 233/233, 11 test dedicati.
- SQL `database/configura_gare_2026_10.sql` applicato e 9 righe confrontate con il piano. Hash altri obiettivi/metriche globali identici prima-dopo, preflight successivo riuscito; nessuna modifica profili/schema/RLS/CC. Default file `applica=false` conservato. Copia prima privata `.backup-private/gare-2026-10/prima.json`.
- Dati reali: 2 Assicurazioni Matteo = 1 punto squadra per tutte e tre le schede, bonus 0 sotto soglia. Guide README/AGENTS/CLAUDE/database README aggiornate; chiusura documentale `f388f7e` pubblicata, CI `37463566168` riuscita e deploy finale `6ac4e993a68f9f000800a879` verificato per SHA/file/autenticazione. Backup preesistente escluso dal commit e preservato. Nessun punto aperto sulle tre gare; obiettivi Avanzamento ottobre restano separati e non configurati.

## WhatsApp: requisiti raccolti, nessuna implementazione avviata

- Assistenza privata umana, senza bot/menu;3-4numeri dipendenti ricevono avvisi, risposte da ignorare. Nuovo numero dedicato non accede alle chat di altri account; accesso assistenza da definire.
- Meta ufficiale esclusa dall'utente per template; nessun plugin WhatsApp trovato. WAHA candidato non ufficiale self-hosted, rischi blocchi/disconnessioni; nessuna affidabilita superiore dimostrata rispetto a Evolution/whatsapp-web.js/Baileys. Software gratuito, numero/hosting separati.
- Requisiti: numero WhatsApp attivo su smartphone, QR come dispositivo collegato, host continuo Docker/sessione persistente, backend CRM autenticato/HTTPS. Utente ritiene alti i servizi gestiti29-40USD/mese; VPS dedicato Aruba O2A4 candidato6,29EUR+IVA/mese/2vCPU4GB. Nessun acquisto/provisioning/installazione/deploy.
- Supervisore richiesto: salute continua/release giornaliera, versioni fissate, compatibilita/backup/check prima-dopo/rollback, recuperi limitati/backoff, niente logout distruttivo; restrizioni account distinte da disconnessioni. QR/passkey richiedono proprietario.
- Email riconnessione QR richieste a `mirko.piasenti@gmail.com` e `info@konatech.it` per ogni incidente: ingresso stato/dedupe/promemoria distanziati, link a pagina autenticata col QR aggiornato, niente segreti/QR in email. Nessun invio di prova.
- Coda persistente obbligatoria: salva prima del tentativo, conserva pending durante QR/guasti/update/riavvii, riprende automaticamente graduale/in ordine destinatario; tentativi/errori tracciati, niente scarti silenziosi. Invii ambigui da riconciliare prima del retry, irrisolvibili sospesi contro duplicati; accettato/consegnato distinti.
- Da raccogliere: flusso/moduli/trigger/autonomia messaggi/stati, associazione risposte-pratiche, destinatari/regole avvisi, allegati/storico/conservazione, UI/ruoli/QR, orari/volumi/invii superati, disponibilita numero/VPS e destinatario collaudo. Gmail SMTP/nodemailer CRM gia' documentato, valutare riuso senza nuovi segreti in chat.

## Identita per contratto: online/bonifica applicata05/10

- Dal01/07:837contratti,132senzaidentita;125recuperati stessa pratica+3riuso piu recente cliente autorizzato.128contratti/129PDF SHA256/readback OK;833coperti,4Energia/2pratiche senza PDF. Residui privati `.backup-private/identity-backfill/DA_INTEGRARE.md`; ultima rilettura0recuperabili.
- Identita obbligatoria per ogni contratto, selezione/fanout server sui contratti bozza, rollback atomico/finalize bloccante; upload successivi specifici. Nessun cambio schema/CC.222/222test+build (221versionati+1backup),15dedicati.
-7c5afef online su richiesta, Netlify6ac411ed17611f0008c6aa5e/metadati/carrello SHA esatto/HTTP200, function senzaJWT401, CI37374083065 OK. Auto-review retry3righe approvato, nessun blocco residuo. Guide e `docs/IDENTITA_CONTRATTI_2026-10-05.md` aggiornati. Prossimo: PDF4residui.

## Target: attivo production05/10

- Bot `@MiroxAiTargetBot` solo Mirko;3report19:45Europe/Rome lun-sab escluse festivita/Pasquetta, manuale/dialogo/vocali, memoria30, strumenti read-only. Migration20261005185700 sessioni/jobs server-only applicata; nessun cambio CC/Guardian.
-6Secret dedicati Production e chiave OpenAI soloTarget;2modelli opzionali default codice. Webhook/HMAC/testo OpenAI/trascrizione sintetica OK, pending/errori0. Cron05/10:3report consegnati19:15UTC al primo tentativo; vocale utente ancora da provare.
- Vendite testuali spaziate/totale in alto, CC/mensile PNG resvg2.6.2+Lato OFL; snapshot SVG/testo prima checkpoint, memoria solo testo, foto grandi->documento. Layout47a7beb online, job3/3 inviati20:20:36UTC; CI cancellata senza runner/step, nessun test fallito.
- Richieste libere corrette98dfc79: frase «Rimandami il report completo di oggi (tutti e 3)», alias/toolAI invia_report alla stessa coda;207/207test+build (206versionati+1backup), provaOpenAI sintetica/3job reali testo+PNG+PNG20:32:52UTC OK.2438d88 production6ac4099f62e0af000821caf6.
- Vendite dataUTC/soloLegnago/no reinserimenti/non-zero per operatore; CC Consumer+outbound/tentativi/risposte/nonrisposte/nuovifissati/spostamenti separati; mensile Standard+ExtraP.IVA/Andamento/Eccedenza. Ottobre Avanzamento senza obiettivi: non copiare settembre.
- Feature84a8232/CI37360431887 OK;198/198test+build, motore reale60mesi verificato. Guide e `docs/MIROX_AI_TARGET.md` aggiornate; inventory Netlify locale riallineato, recovery off-site precedente da aggiornare. Prossimo: obiettivi Avanzamento ottobre/prova vocale reale.

## Guardian e backlog: production05/10

- Lettura06/10: KG23 inizialmente segnalato18:40/notificato Telegram18:41; nuova funzionalita chiarita e riclassificata miglioria con audit, dettagli audio da recuperare. Testi proprietario registrati datati05/10; memoria30 senza timestamp. Solo lettura, nessun intervento DB/codice.

- Guardian unico ambiente production; utente autorizza sviluppo/collaudo diretto. KeyOpenAI GitHub13:23:38/Netlify16:18:50 aggiornate su consenso; health16:21:36/KG18 Codex37323380962 OK. Nessun DeepSeek, errore precedente invalid_api_key mascherato da workflow verde corretto.
- Chat libera anche senza ticket/archiviato, memoria30; azioni auditabili/pulsanti, analisi una per segnale/release, claim cron/outbox, scan senza segnale notificata, preflight daDB/workflow rosso/errori/callback tardivi protetti. Migration conversazione applicata; checkout guardian-affidabilita-chat attaccato/stash recuperabile.
- Backlog settembre fca1c00 online16:54:15/160test+build/healthOK:KG14/15/20Ticket,18Comodato,19SIM,10Storage risolti;KG9/12/16storici mitigati, causa ignota;5scan fallite archiviate senza inventare risultati.14audit/8segnali chiusi, zero settembre aperti;KG1-7agosto fuori scope. Rapporti `docs/GUARDIAN_DIAGNOSI_2026-10-05.md` e `docs/GUARDIAN_BUG_SETTEMBRE_2026.md`.
- Pubblicazione Telegram73a8c0d online17:56:04/178test+build/healthOK: conferma1h legata SHA/head/base/PR/test/owner,CAS,doppio clic,workflow main. KG22/PR12 approvata dal proprietario, run37339405520 mergeffe515d18:15:37/Netlify6ac3cd2b18:16:08/healthOK. Outbox18:20:22 primo tentativo; cron5min. Nessun consenso simulato; anteprime Netlify disabilitate skip_prs=true. Chiusura documentale locale, nessun nuovo deploy.

## CI05/10 sera: incidente runner GitHub

- Mail22:34/22:38 CI37368961629/37369428478 fallite per runner hosted non assegnato:runner_id0,steps vuoti, nessun test eseguito/fallito;3avvisiUbuntu26 non errori. Incident https://www.githubstatus.com/incidents/3q1yb5m7ltvb aperto19:11UTC;98dfc79/2438d88 ancora queued al controllo. Nessun rerun/push/deploy; verificare stato piu recente prima di agire.

## Backup: stato precedente conservato

- Aruba VPSIT1O2A4(6,29EUR+IVA)/StorageR1-IT,Compliance/versioni/AES-GCM, backup orario:17UTC/checkpoint03:17dopo cleanup. Restore6.584file/100tabelle51.252righe COPY identiche; PDF404 recuperato da duplicato checksum/size, sorgente invariata.
- Healthchecks1h/grace1h/email e mancata esecuzione collaudati, chiave AES separata; audit06:47UTC enabled/monitor24hgrace12h, restore trimestrale100tabelle51.313righe identiche18,5s/skip verificato. Docker off, lifecycle reale in osservazione.
- Netlify20/28valori privati cifrati/readback;7altriSecret senza copie, nuovaOpenAI recuperabile localmente/recoveryoff-site da aggiornare. Auth13template/7pagine/DNS19record salvati, inventory statico. Repo pubblico/workingtree cifrati off-site.
- Runner8worker/verify-fullCA/LoadCredentialroot0440/read-only/SSH-UFW, kernel6.8.0-146, resize legacy disabilitato dopo verifica root espanso. TAR indipendente11:46:6.585file/1.156.382.720byte SHA256/AES offline OK, `.backup-private/offline/`; custodia fisica scollegata da confermare.
- Nuovo Supabase/collaudoCRM rinviati esplicitamente fino rimozione CCtest: non creare/rimuovere senza decisione;budget10-15EUR+IVA. Backup locale non committato/68testPython;ed.hup/output/tmp preesistenti invariati. Dettagli `docs/BACKUP_RIPRISTINO.md`.

## Punti aperti precedenti

- KPI read-only04/10/PNG05/10:MobileTied giugno-settembre15/9,24/6,32/7,20/3(91/25);CBCambioPianoTIED74,TelefonoIncluso616(1Business),deviceVAR/Finanziamento,3senzaDevice esclusi. Luglio1IMEI/VARdevicefalse da chiarire; nessun cambioDB/app/deploy.
- FissiAttivo per attivazione giugno-settembre37/35/32/36(140). CFnormalizzato:SIMinterna stesso giorno in poi2/6/9/8(25),altreSIM20/14/9/8(51),finestra inserimento-5mesi->fine mese successivo/esclusa interna/EXISTS/DISTINCT/2sovrapposti;settembre25finestre aperte. Residuo66(16/15/14/21):5Mobilefuori criterio/61nessunrecord; titolo utente «Gia' Clienti W3 Mobile», non derivatoDB. SIM data_contratto/storicoMobile gennaio2026.
- CallDirector kona-call-director/5ce82af non integrato/precedente313test;079applicata staging, verifica chiusura vendita->CC/autorizzazioni/relazioni/stato/presentati, mancano tabelle vendita staging, geografia da verificare/main da allineare/072collide. Non integrare senza autorizzazione; `docs/KONA_CALL_DIRECTOR.md` sul branch.
- Permessi granulari Vendita/Post-Vendita/UI revoca privacy: limitazioni note, nessuna nuova richiesta.

## Riferimenti e vincoli

- Guide AGENTS/README/CLAUDE/database README: file SQL storici non descrivono da soli DB vivo.
- CRM `mirox-crm.it`, alias `mirox-crm.netlify.app`; repository/deploy CCstorico ancora ignoto.
- Push solo su richiesta esplicita, ogni push main deployproduction. Cambi tabelle CCcondivise richiedono consenso preventivo e confini AGENTS.
- Guardianhealthcheck privato verificaOpenAI/Telegram/memoria Netlify conHMAC, nessun messaggio Telegram/datiCRMAI. Backup preesistente da non includere nel commit delle gare.
