# CLAUDE.md — Guida per AI assistants


## Planning personale (rilascio29/10/2026)

Nuovo reparto Admin Personale: `admin-planning.html`, consultazione del solo proprio pubblicato in `planning-personale.html` dalla dashboard. Bozza e approvato separati, orari configurabili, alternanza settimanale con assegnazione iniziale manuale, assenze/codice malattia, consuntivo e straordinari manuali, PDF personali/collettivi senza causali e schede ore solo Admin. Tre tabelle `personale_planning_*` private con RPC INVOKER/service-only, CAS e audit; nessuna modifica a profili/CC o alle19ACL. Avvio novembre con Matteo/Vincenzo/Isabella, scelta02/11 aperta. Migration `20261029200010_personale_planning.sql` applicata production20261029210434; push del solo planning autorizzato, nessuna associazione account eseguita. Fonte primaria AGENTS e `docs/PLANNING_PERSONALE.md`. Debug29/10: UI conserva documento/versione nei fallimenti di cambio mese, svuota i dati personali su errore, ritenta configurazione e blocca alternanza non applicata; PDF con intestazioni dinamiche e gruppi di4dipendenti.580/580test e SQL/DOM/renderPDF riusciti, nessun DDL/deploy.

## Verifica automatica contratti (27/10/2026, modalità collaudo)

Sviluppati motore puro, lettura PDF, CSV, pannello esiti/collaudo, worker, cron,
cache e outbox. Guida: `docs/VERIFICA_AUTOMATICA_CONTRATTI.md` e sezione AGENTS.
Migration `20261027172616_verifica_automatica_contratti.sql` collaudata isolata,
applicata/riletta a production27/10, versione20261027172616. Rilascio autorizzato;
nessuna email o lettura AI dei clienti ancora eseguita, configurazione collaudo.
Default collaudo: una pratica richiesta dall'admin, zero conferme/email.
Identità valida alla data firma, Business su CF personale del rappresentante dalla PDA (Nome referente senza PDA), ICCID copia SIM vs
SIM uscente PDA MNP. Energia prime2pagine bolletta/POD/PDR, gestore da bolletta e
numero da CSV fiscale+punto univoco. CSV mancante o pratica assente = In attesa CSV.
Turno21:00Europe/Rome, sospesi corretti ripartono subito; dati discordanti da
verificare. Reload CB a mirko.piasenti@gmail.com appena verificato, problemi semplici a
mirko.piasenti@mail.com. WhatsApp manuale. Nessun cambio a schema/RLS/RPC CC;
esiti additivi separati da stato_controllo, punti e anagrafica non riscritti.
Pubblicazione su richiesta esplicita, con modalità collaudo iniziale.

Correzione elenchi27/10: vendita_pratiche non restituisce righe al browser per RLS.
Nessun inner join/filtro pratica negli elenchi; idoneità inviata verificata backend.
Polling non sostituisce caricamenti/errori con liste vuote. Nessun cambio RLS.

Preparazione pubblicata per28/10: storico al controllo manuale del proprietario,
nuovi contratti in collaudo diurno uno alla volta. Lettura tool a schema con
evidenze anche per booleani, un secondo tentativo sul formato errato, testo
digitale del medesimo PDF numerato per pagina + PDF integro per scansioni/visione.
Cache versionata; polling dettaglio aggiornato anche dopo focus sul pulsante,
data in modifica preservata. Nessuna dipendenza/env/migration; correzioni pubblicate
su richiesta84bb310, CI425/425 e Netlify6ae0f23563f8ffded0ed96e1 verificatiHTTP. Nessuna nuova lettura AI cliente o email avviata.
Dopo l’incidente Disk IO e il passaggio Nano->Micro effettuato dal proprietario,
alle22:15 del27/10 Auth/REST/SQL rispondono e modalità collaudo è riconfermata;
nessuna attivazione/analisi cliente/notifica avviata dall’assistente.

Controllo successivo 27/10 alle 22:45: proprietario conferma Small e upgrade;
PostgreSQL 17.11 (build Supabase 17.11.0.003) confermato SQL/metadati, progetto
ACTIVE_HEALTHY e Auth/REST HTTP200 in circa 0,4s. Modalità collaudo confermata,
zero verifiche in corso e zero notifiche verifica. Test completi sui nuovi
contratti previsti il 28/10; consumo IO da misurare. Dettagli nel rapporto
`docs/INCIDENTE_ACCESSO_REPORT_2026-10-27.md`.




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
Correzione pubblicata insieme al Business; regressioni sintetiche
e nessuna nuova chiamata Anthropic sui PDF reali, ispezionati localmente.

### Identita nell’upload e permesso di soggiorno (28/10/2026, pubblicato)

Correzione pubblicata del28/10: per Mobile
con PDA digitale completa, pagine numerate coerentemente e nessuna sezione MNP,
il numero definitivo viene da `DATI DELLA SIM WINDTRE` e portabilita e false.
Il lettore serale riusa il parser per coordinate dell’upload; immagini estese,
pagine mancanti o discordanza fra evidenze restano incerte. Cache lettore
`2026-10-28.1`, nessuna migration o nuova env.

Controllo anticipato del solo documento di riconoscimento, confronto con anagrafica:
Consumer CF esatto (CF assente: conferma esplicita nella correzione sopra); Business CF rappresentante
dalla PDA, oppure Nome referente per categorie senza PDA. Data firma esplicita, tipo e fronte/retro; esiti
coerente/da correggere/da confermare, conferma preview manuale tracciata dopo esito negativo/incerto, come sopra.
Cittadinanza esplicita o confermata, mai dedotta da residenza/nascita/nome:
permesso PDF obbligatorio solo Mobile Consumer + dispositivo VAR + extra UE.
Nuova API `verifica-identita-upload` con JWT e permesso Upload, ricevuta HMAC
legata ad autore/dati/hash PDF, verifica server su create/upload/finalize e audit.
Nuovi helper `js/identita-upload-core.js`, `js/identita-upload-ui.js`,
`netlify/functions/_lib/identita-upload.js` e `_lib/pda-business-identity.js`;
nessuna nuova dipendenza/env.
Migration sorgente `20261028122800_identita_upload_permesso_soggiorno.sql`,
applicata a production come `20261028131258`: JSONB audit in vendita_pratiche e SHA256 in vendita_documenti, nullable
per legacy, grant/RLS/CC invariati. Nuovo tipo allegato `permesso_soggiorno`.
Verifica serale conserva PDA/SIM/bollette/CSV e data firma effettiva; riusa identita
solo con anagrafica e byte coincidenti. Nessun cambio modalita/email o storico.
Guida e limiti: `docs/IDENTITA_UPLOAD_2026-10-28.md`. Pubblicato; collaudo
scansioni reali e UI al proprietario, senza browser da parte dell’assistente.

## Professional Cloud Mobile e Fisso Business (28/10/2026)

Professional Cloud e' separata dall'opzione MNP, solo Mobile e Fisso Business. Il wizard
mostra Si/No anche con lettura AI; presenza ricavata da Opzioni/servizi della SIM
contrattuale con Piano Telefonico per Mobile, dal riquadro Opzioni aggiuntive per
Fisso, ignorando prevalidazione e condizioni generali.
Testo PDF per coordinate + OCR: presenza testuale esplicita prevale; No richiede
lista completa/leggibile e accordo della lettura AI, altrimenti scelta manuale.
Nessuna assenza dedotta da PDF ibrido/troncato. In presenza di riquadro contrattuale,
anche numero SIM viene letto da quello, evitando conflitti con la prevalidazione.

Con Si il popup Gestione Professional Cloud richiede Mantieni attiva oppure
Richiedi disattivazione, senza default. Chiudere lascia la decisione da completare;
non si prosegue senza scelta. Presenza e gestione modificabili con conferma: fino
al consenso niente modifiche a valori/decisione/bozza; No a Si richiede anche la
nuova decisione, annullamento conserva la situazione precedente. Input select non
salva valori prematuri; doppi cambi e risposte tardive su PDA/offerta/cliente/cluster
o editor chiuso non si applicano. Nuova PDA azzera, draft/carrello conservano la
coppia. Al cambio cluster fuori Business la UI rimuove i dati Cloud; correzione
categoria fuori Mobile/Fisso nell'editor generale li azzera. Dati consultabili e
correggibili negli editor PDA Verifica/Storico; Storico mostra anche No esplicito.

`vendita_contratti.professional_cloud` boolean nullable e
`professional_cloud_gestione` text nullable (Mantieni attiva/Richiedi disattivazione).
CHECK: solo Mobile e Fisso Business; Si richiede decisione valida, No/NULL nessuna decisione.
Migration `20261028085821_professional_cloud_mobile_business.sql` applicata/riletta:
nessun default o backfill,0righe storiche valorizzate, vincolo validato. Nessun
cambio a tabelle/permessi/RPC CC o RLS esistenti. Validazione browser/server;
nuovo wizard obbliga Si/No Business, compatibilita client legacy senza campo e
storico sconosciuto mantenuta. Nessuna disattivazione sul portale, email/notifica,
modifica MNP/catalogo/punteggi o verifica automatica avviata da questo rilascio.
Collaudo PostgreSQL isolato con `scripts/verifica-professional-cloud-sql.js`.

Estensione Fisso28/10: migration `20261028091505_professional_cloud_fisso_business.sql`
applicata/riletta, nuovo CHECK vendita_professional_cloud_business_coerenza
validato per Mobile/Fisso Business prima di rimuovere il precedente vincolo.
Nessuna nuova colonna, riscrittura dati o modifica a CC/RLS/RPC/permessi.
Il parser riconosce Opzioni aggiuntive Fisso e si ferma ai riquadri successivi;
assenza incerta resta manuale, No richiede lo stesso accordo testo/AI. UI,
DTO create ed editor conservano Cloud sul Fisso e azzerano solo i dati specifici
Mobile. Consumer, Turista e Customer Base restano esclusi. Stessi popup, conferme
e salvataggio di presenza/gestione; nessuna disattivazione o notifica automatica.

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

## Upload PDA: codice univoco e dati Mobile (27/10/2026, online)

Codice contratto obbligatorio Mobile/Fisso/Customer Base; codice cliente escluso.
Manuale: popup codice e controllo prima dell'upload. AI: legge ogni PDA, anche
nel carrello multi-contratto; campo mancante da compilare, errori bloccanti.
Unicita globale fra negozi/categorie/stati/mesi/operatori, anche bozze e carrello;
reinserimenti con codice nuovo. Solo Mobile: costo mensile base (primo importo,
nessun accessorio/device) sempre confermato, nuovo numero oppure MNP con numero
SIM provvisorio, definitivo=MNP e operatore provenienza. Customer Base solo codice.
Turista conserva catalogo automatico e campi anagrafici ridotti; step3 solo dati PDA.
Contatto OTP esclusivamente DATI FIRMA ELETTRONICA, manuale se assente; dopo
la prima PDA contatto conservato, modifica OTP e riuso consenso valido invariati.
Upsert esistenti aggiornano il cellulare cambiato. Tutti gli utenti attivi possono
correggere i nuovi dati in Verifica Contratti (anche verificati), Storico Cliente e
codice Fisso in Controllo Fissi. Editor dedicato senza variazione punteggi/stato,
controllo ottimistico updated_at e codice Fisso sincronizzato in entrambe le direzioni.
Motore `js/vendita-pda-core.js` + UI `js/vendita-pda-ui.js`; backend in
`_lib/pda-contract.js`, action `check_codice`/`update_pda` su gestisci-vendita-contratto.
Migration `20261027110402_vendita_codice_pda_mobile.sql` applicata e verificata:
colonne nullable, CHECK, UNIQUE e nuovi trigger INVOKER su sole tabelle vendita/Fisso.
Nessuna modifica schema/RLS/RPC CC e nessun recupero storico in questa fase.
Migration e deploy c4176c8 online, CI40498935335 riuscita e asset verificati.
OCR reale9/9PDF con esito atteso, inclusa SIM dati Business. Refresh client prima del primo utilizzo.
Debug: chiusura loader su duplicato al submit, divieto azzeramento dati Mobile
tracciati, blocco PDA di altro cliente, editor non annullabile durante salvataggio
e protezione input non salvati degli altri popup. Risposte tardive reinserimento scartate. OCR SIM dati Business esplicito e prefisso 39 senza + normalizzato solo su lunghezze internazionali.340test locali (339versionati) e SQL isolato OK.


Aggiornamento UI27/10: durante l'upload il costo Mobile compare soltanto nel
popup (precompilato con AI se letto, altrimenti vuoto) e viene salvato come prima.
Con Analizza con AI scelta nuovo numero/portabilita, numeri e gestore restano
nascosti e compilati automaticamente, anche nel riepilogo del carrello. Con
Continua senza AI i campi telefonici sono visibili: Numero di cellulare per
nuova attivazione; con portabilita Numero provvisorio, Numero da portare (MNP)
e Operatore di provenienza. La modalita di lettura e' metadato solo del draft/
carrello, conservato al ripristino e azzerato sul nuovo contratto; vecchie bozze
senza modalita restano manuali. OCR fallito o numerazioni/gestore incompleti:
blocco prima dello staging e invito a riprovare AI o scegliere esplicitamente
il percorso manuale, senza inventare valori o mostrare automaticamente i campi.
Editor post-vendita completi; nessuna modifica schema o payload dei dati DB.


Recupero numerazioni PDF27/10: `ocr-pda` usa anche `_lib/pda-pdf-text.js`
con `unpdf@1.9.1` (PDF.js serverless, Node22+, modulo esterno esbuild).
Ricostruisce tutte le pagine per coordinate: l'ordine interno del content stream
puo' collocare il numero prima del titolo della sezione pur mostrandolo sotto.
Da DATI DELLA SIM WINDTRE recupera solo numero SIM; da PASSA A WINDTRE numero
MNP e Operatore attuale. Valori testuali univoci prevalgono sul risultato AI;
valori discordanti/invalidi non vengono scelti arbitrariamente. Nessun fallback
sul contatto firma e nessuna deduzione di prezzo/codice dal testo di altre sezioni.
Pagine ibride/scansioni senza sezione testuale non provano assenza MNP: resta
la lettura AI. Limiti del parser60pagine/100mila elementi/5s dopo apertura;
PDF non estraibile o oltre limiti usa la lettura AI esistente. Dati solo in memoria,
nessun log del testo o invio aggiuntivo. Campi AI nascosti e popup costo invariati;
nessuna modifica DB/storico. Dipendenza fissata nel lockfile e mantenuta esterna
per preservare l'import ESM dinamico di PDF.js.

Codice PDA nel percorso AI: nascosto anche in Dati Contratto e nel riepilogo
carrello, per Mobile/Fisso/Customer Base; resta conservato in bozza/payload/DB e
nel controllo duplicati. Manuale ed editor post-vendita mantengono il codice
visibile. Se AI non legge il codice, blocco con invito a riprovare o scegliere
il manuale esplicitamente, senza aprire il popup codice nel percorso AI.

Opzioni Mobile e rivenditore27/10: `MiroxPda.mobileOptionId` preseleziona
Nessuna opzione senza portabilita; con MNP sceglie la voce per Iliad/Coop/Poste/
Tiscali (alias Iliad Italia, CoopVoce, PosteMobile/PostePay) oppure MNP standard
per gli altri gestori. Usa catalogo attivo e soli collegamenti dell'offerta;
nessuna voce inventata o scelta arbitraria se ambigua/non disponibile. Senza
gestore o portabilita determinabili resta da scegliere. Campo Opzione visibile
come prima e modificabile: la correzione dell'operatore prevale fino a nuova
lettura/PDA, si conserva nel carrello/draft e al cambio offerta se ancora ammessa.
Metadato client `pda_opzione_manuale`, escluso dal payload DB; vecchie scelte
senza metadato si conservano. Punteggi e documenti dipendono dalla voce scelta,
sempre tramite il catalogo esistente; nessuna modifica dei punteggi di catalogo.
Codice rivenditore nascosto per tutte le categorie upload e fissato9001415852
(Legnago), anche nel backend create e nei restore/cart/payload: OCR, input
precedenti o client vecchi non possono cambiare il negozio del nuovo inserimento.
Storico e correzioni post-vendita invariati; nessuna migration o backfill.
Su istruzione del proprietario27/10: non usare il browser per i collaudi;
assistente esegue soltanto test interni/debug e controlli HTTP/CI. Test UI a cura
del proprietario fino a nuova indicazione.

Conferma cambio opzione27/10: quando si modifica una preselezione automatica
Mobile, popup MiroxUI con valore originale/proposto, Conferma modifica e
Mantieni scelta automatica. Fino alla conferma resta selezionato il valore
originale: nessuna variazione anticipata a punteggi, documenti o bozza. Annulla/
chiusura conserva la scelta automatica; conferma applica l'override manuale.
Scelte gia' manuali o senza preselezione non richiedono il popup. Nuova PDA
riparte dall'automatismo. Doppio cambio e conferme tardive su altra PDA/offerta/
contratto non applicano modifiche alla nuova compilazione. Nessun cambio DB.

Dispositivo automatico27/10: dove il catalogo consente la scelta, la PDA
preseleziona Si per dispositivo presente e No per assenza esplicita; dato mancante,
parziale o contraddittorio resta senza selezione. OCR non trasforma piu' campi
non letti in false. Prima di modificare la scelta automatica compare MiroxUI:
Conferma modifica oppure Mantieni scelta automatica. Fino al consenso il valore
precedente e IMEI/prezzo/acquisto restano invariati; annulla/chiusura li conserva.
Dopo conferma prevale la correzione manuale. Stato automatico/override conservato
in draft/carrello tramite pda_dispositivo_auto e pda_dispositivo_manuale (solo
client, esclusi dal payload DB), azzerato con nuova PDA; bozze legacy preservate.
Conferme tardive e doppio cambio protetti. Vincoli FWA Indoor e Customer Base con
telefono obbligatorio restano attivi: dispositivo Si e acquisto vincolato non
vengono sovrascritti dall'OCR. Campi positivi ancora precompilati; niente dati OCR
della pratica precedente riapplicati al contratto ripristinato. Nessuna migration,
dipendenza, riscrittura storica o cambio punteggi. Collaudi solo interni/HTTP, mai
browser su istruzione proprietario.

Tipo attivazione Fisso automatico27/10: dalla casella selezionata nella sezione
"Linea telefonica su cui attivare il servizio", nuova linea -> Nuova Attivazione,
numero attivo -> Portabilita. OCR visuale e testo PDF per coordinate leggono il
segno effettivo (compresa codifica WindTre); entrambe/nessuna casella selezionata,
sezione assente o illeggibile non producono una scelta. Nessuna deduzione da
telefono, codice migrazione o offerta. Campo visibile/modificabile: prima di
cambiare la preselezione compare MiroxUI; annulla conserva l'originale, conferma
applica l'override manuale. Doppi cambi e risposte tardive protetti. Auto/override
conservati in draft/carrello con pda_tipo_attivazione_auto e
pda_tipo_attivazione_manuale, esclusi dal payload DB; nuova PDA azzera lo stato,
bozze legacy conservano la scelta. Si usa la colonna tipo_attivazione esistente,
nessuna migration o riscrittura storica. Solo test interni/HTTP, senza browser.

Codici cliente WindTre anagrafici (27/10): una anagrafica puo' avere piu' codici,
conservati tutti senza sostituzione. Da PDA Mobile/Fisso/Customer Base si legge
"Codice Cliente", distinto dal codice contratto; testo con prefissi e zeri
iniziali, nessuna conversione numerica. Nuovo campo anagrafico nel wizard;
manuale obbligatorio dopo il controllo duplicati e prima dello staging. AI lo
compila dalla PDA; se assente/illeggibile/discordante chiede input, senza
riutilizzare il codice di un'altra PDA. Ogni contratto del carrello conserva il
proprio valore, anche in bozza; OTP e anti-duplicati contratto restano invariati.
Altri reparti non acquisiscono nuovi codici. Nuovi valori si aggiungono anche su
cliente esistente; assenza non cancella quelli registrati. Consultabili nella
scheda Anagrafiche e nell'export XLSX (celle testuali). Nessun backfill storico o
sincronizzazione automatica del vecchio codice cliente del Controllo Fissi.

Registro `anagrafica_codici_cliente_windtre` (PK anagrafica_id/codice_cliente,
FK indicizzata dal prefisso PK, created_at): RLS ON, niente grant anon/authenticated,
service_role solo SELECT/INSERT; upsert ignoreDuplicates senza UPDATE/DELETE.
Migration `20261027220802_anagrafica_codici_cliente_windtre.sql` applicata e riletta:
registro vuoto al rilascio, nessuna modifica a schema/RPC/RLS anagrafica/CC o
colonne contratto. `_lib/windtre-customer-codes.js` riusato da garantisci-anagrafica
e crea-vendita-pratica-carrello; search-anagrafica e gestisci-anagrafiche espongono
la relazione in left join dal backend. Core PDA separa normalizzazione codici
cliente/contratto. Chiamanti legacy senza nuovo campo restano compatibili; nuovo
wizard richiede sempre il codice cliente della PDA. Test esclusivamente interni/
HTTP, nessun browser. Verifica PostgreSQL isolata: `scripts/verifica-codici-cliente-sql.js`.

## Compilatore Subentri (18/10/2026)

Nuova Applicazione `moduli/compilatore_subentri.html`: scelta Mobile/Fisso (Fisso
inattivo), cinque categorie Mobile, solo Microbusiness→Privato implementata.
Popup documenti prima delle due ricerche CRM distinte: solo P.IVA completa per
cedente e CF personale completo per subentrante, validati browser/server. Dopo
selezione barra/stato nascosti, intestatario in evidenza e Annulla indipendente
per rifare la ricerca, conservando l’altra selezione. Entrambe devono riuscire
con selezione o assenza risultati prima del form. Solo IBAN/bollettino, niente
codice domiciliazione, sei consensi espliciti, firme vuote. Quattro numeri per
pagina con ripetizione automatica. Popup iniziale con tre documenti in elenco puntato.
Sotto luogo/data scelta obbligatoria senza default: Invia pratica archivia PDF e
documenti nello storico CRM; Compilazione standard archivia solo PDF, senza
allegati. Nessun invio esterno. Upload visibile/obbligatorio solo per Invia pratica:
tre gruppi PDF/JPEG/PNG, 4 MiB/file, fronte/retro identità e tessera più visura.
Passare a standard svuota i file selezionati; storico e azioni distinguono le modalità.
`js/subentri-core.js` condivide campi/validazione browser-server;
`gestisci-subentri` gestisce bozze idempotenti con manifest/SHA256, upload,
finalize con verifica byte, storico, signed URL 300s e duplicazione (nuove
ricerche, nuovi consensi e scelta modalità, allegati nuovi solo per Invia pratica). Template privato `_templates/subentri/`,
PDF deterministico `pdf-subentro.js`. Migration `20261018180938_compilatore_subentri.sql`
applicata production: `subentri_generati`/`subentri-files` server-only e isolati,
nessuna modifica a tabelle/RPC/policy CC. Migration
`20261018184140_subentri_modalita_compilazione.sql` applicata: modalità immutabile e
CHECK manifest vuoto solo standard. Compatibilità retry/client precedenti mantenuta.
Pubblicazione del nuovo flusso richiesta il 19/10/2026; esito nel promemoria. Bozze non cancellate automaticamente,
retry nel form; nessuna ripresa dopo chiusura scheda. Push autorizzato il 18/10/2026; verifica pubblicazione nel promemoria.
Dettagli e regole aggiornate in AGENTS/README/database README.

## Compilatore disdette: prima modulo, poi ricerca (18/10/2026)

All’apertura mostra le quattro tipologie di disdetta. Dopo la scelta mostra la
ricerca CRM obbligatoria. Il form del modulo scelto si apre dopo selezione cliente
o ricerca riuscita senza risultati: «Nessuna anagrafica trovata», compilazione
completa con modulo vuoto. Errori non sbloccano il form. Cambiare ricerca azzera
i dati mantenendo il tipo; Cambia modulo azzera tutto e torna alle quattro scelte.
Anche dallo storico prima scelta SIM/Fisso nello stesso cluster, poi ricerca:
snapshot solo per la stessa anagrafica. Nessuna modifica DB/schema/RLS.

## Avanzamento: riga CAMBI PIANO (06/10/2026)

Metrica `avanzamento_standard` attiva, ordine35 tra TELEFONI CB/FISSI: TIED
Consumer e MOBILE Business solo Legnago, senza reinserimenti,1punto per cambio.
Obiettivo configurabile da Admin, nessuna soglia collettiva dedotta dalla gara
individuale. Riga dinamica condivisa con PNG/Target, anche nei mesi storici.
Script dati additivo/idempotente `database/configura_avanzamento_cambi_piano.sql`
applicato production (id23); altre metriche/obiettivi invariati. Nessun frontend,
schema/RLS o contratto modificato; test comportamento integrato copre i criteri.

## Gare mensili ottobre 2026

Correzione applicativa28/10: schede Gare/PNG distinguono produzione personale e
totale squadra; Assicurazioni ottobre mostra punti personali e punti squadra,
bonus invariato50 EUR ciascuno a10 complessivi. `tipo_compenso=squadra` usa il
totale anche con conteggio personale (PARTITA IVA:37 ->150 EUR a ciascuno).
Il motore mantiene perimetro, alias, conteggio/punti configurati e scaglioni.
Nessuna modifica DB o configurazione; stato rilascio in docs/STATO_LAVORO.md.

Variazioni solo in `gara_obiettivi_mensili.compenso_regola`: override `gara`
(descrizione/conteggio/punteggio/punto vendita/operatori canonici) e DSL
`obiettivi_combinati` con tutte le soglie obbligatorie. Motore condiviso
`js/dashboard-report-core.js` usato da Dashboard e Admin; editor conserva gli
override mensili. TIED35/100 EUR; CB35 telefoni Consumer VAR/Finanziamento +15
cambi piano TIED Consumer/MOBILE Business (equivalenza autorizzata)/100 EUR;
Assicurazioni squadra Francesca/Matteo/Mirko solo Legnago,10 punti reali/50 EUR
ciascuno. Storico e Avanzamento preservati. Script dati
`database/configura_gare_2026_10.sql`: default preflight senza scritture,
applicazione solo dopo deploy compatibile. Applicata e riletta il 06/10/2026
dopo `ab44097`: 9 obiettivi corretti, altre righe e metriche globali invariate.
Nessuna modifica profili/schema/RLS.


Questo file viene letto automaticamente all'avvio di ogni sessione Claude. Contiene il contesto necessario per essere subito produttivi senza ri-esplorare il repo.

## Ripresa del lavoro fra chat

**Procedura obbligatoria all'avvio di ogni nuova chat in questo progetto, prima di esplorare il repository:**

1. Leggere esplicitamente [`docs/STATO_LAVORO.md`](docs/STATO_LAVORO.md), risolto rispetto alla root del repository.
2. Controllare branch, `git status --short` e `git log --oneline -20`; riconfermare soltanto le informazioni pertinenti cambiate o obsolete.
3. Per richieste mirate leggere i file coinvolti e le sezioni pertinenti delle guide. Una nuova chat non richiede di per sé scansioni complete o interrogazioni ai servizi esterni; ampliare l'analisi quando richiesta, dipendenze o rischi lo richiedono. Se il promemoria manca, ricostruire il contesto necessario dalle guide e da Git, segnalando l'assenza.
4. Aggiornare il promemoria a fine intervento nella stessa sessione con risultato, verifiche, punti aperti e prossimo passo, mantenendolo intorno a 80 righe e sostituendo lo stato superato.

Il promemoria non sostituisce `AGENTS.md` né le guide tecniche e non autorizza attività sospese o deploy. Un altro checkout o worktree deve contenere questi file per applicare la stessa procedura.

## Identita per contratto (05/10/2026)

Nuova regola documentata in AGENTS, sezione Documenti; il carrello carica una volta e il backend associa un PDF indipendente a ogni riga prima di `finalize`. Bonifica dello storico dal 1 luglio: 128contratti/129PDF verificati, inclusi 3riusi autorizzati dello stesso cliente;4residui senza PDF all'origine. Nessuna modifica schema/CC; risultati in `docs/IDENTITA_CONTRATTI_2026-10-05.md` e report operativi privati. Commit7c5afef online, Netlify6ac411ed e metadati/HTML verificati, CI37374083065 riuscita;221test del commit pulito. Backup preesistente escluso dal push.

## MIROX AI - Target (05/10/2026)

Secondo bot privato di Mirko: tre report alle 19:45
Europe/Rome, lun-sab escluse festivita nazionali/Pasquetta e dialogo libero.
Motore condiviso `js/dashboard-report-core.js`, webhook Target dedicato, worker
background HMAC e cron ogni 5 minuti; coda/memoria in due nuove tabelle server-only.
Chiave OpenAI dedicata `OPENAI_TARGET_API_KEY` per testo e vocali, senza fallback
Guardian. Nessuna modifica a tabelle CC condivise. Migration applicata e credenziali
Production configurate il 05/10; bot online, tre report del giorno e dialogo reale
verificati, trascrizione sintetica riuscita. Regole complete in [AGENTS.md](AGENTS.md) e
[setup Target](docs/MIROX_AI_TARGET.md).
Vendite in testo spaziato; CC e mensile in PNG tramite `@resvg/resvg-js@2.6.2`.
Font Lato OFL in `netlify/functions/_assets/target/`, esclusi dalla build pubblica.
Snapshot SVG + testo nella coda; rasterizzazione prima del checkpoint Telegram,
memoria AI con solo testo, nessuna migration o API immagini.
Foto oltre i limiti Telegram in un singolo documento PNG completo.
Richieste libere di invio: alias diretti e tool `invia_report` restituiscono
intento data/tipo validato alla coda, che usa i formati originali testo/PNG.
Analisi e confronti restano nel dialogo con `leggi_report`.

## Cos'è questo progetto

**Mirox CRM Vendita** — modulo di gestione vendite e post-vendita di Konatech. Static HTML + Netlify Functions (Node) + Supabase Postgres.

---

## Manutenzione di questa guida (regola persistente)

**Regola fondamentale**: ogni task che modifica codice, struttura o regole del progetto deve aggiornare i file di documentazione (`README.md`, `CLAUDE.md`, `database/README.md`) **nella stessa sessione**, prima di considerarsi concluso. Niente "lo aggiorno dopo" — il drift documentale si crea così e questa guida diventa inutile (è già successo con il vecchio `README_UNIFICATO.txt`).

### Tabella trigger → cosa aggiornare

| Cosa cambia nel progetto | Aggiorna |
|---|---|
| Stack, dipendenza npm, libreria JS condivisa | `README.md` (Stack + Struttura) + `CLAUDE.md` (Architettura) |
| Struttura cartelle (nuova / spostata / rimossa) | `README.md` (Struttura) + `CLAUDE.md` (Architettura) |
| Env var Netlify (nuova / rimossa / rinominata) | `README.md` (Env vars) |
| Pagina HTML aggiunta / rimossa / spostata | `README.md` (tabella moduli) + `CLAUDE.md` (Flusso vendita se impattato) |
| Netlify function aggiunta / rimossa / rinominata | `README.md` (tabella Functions) + `CLAUDE.md` (Architettura layer 2) |
| Tabella / colonna / vista / RPC / trigger / RLS / bucket Supabase | `CLAUDE.md` (Mappa Supabase) + valutare migration in `/database/` + `database/README.md` |
| Nuova regola di business o validazione | `CLAUDE.md` (Regole di business) |
| Nuova convenzione (path, naming, libreria d'uso obbligata) | `CLAUDE.md` (Convenzioni) |
| Cron / schedule (nuovo / modificato / rimosso) | `README.md` (Schedulazioni) + `CLAUDE.md` (Architettura layer 2) |
| Nuova "nota operativa consapevole" (limitazione nota, soluzione temporanea) | `CLAUDE.md` (Note operative consapevoli) |
| Limitazione documentata risolta / password admin rimossa, ecc. | `CLAUDE.md` (rimuovere o aggiornare la nota corrispondente) |
| Cambio modello permessi / ruoli / pagine pannello Admin | `CLAUDE.md` (sezione "Pannello Admin Mirox") + `README.md` (sezione "Pannello Admin Mirox") |

### Self-check di fine task

Prima di dichiarare un task concluso:
1. Cosa ho toccato? (codice, schema, path, regola, dipendenza)
2. Riconosco la categoria nella tabella sopra?
3. Apro i file pertinenti e aggiorno
4. Cito brevemente nel report all'utente quali doc ho aggiornato

---

## Collaborazione AI (aggiornata 2026-07-25)

**Codex è l'assistente principale per tutto lo sviluppo**: analisi, fix, nuovi moduli, Netlify functions, migration DB, refactor e documentazione. Claude Code ha realizzato gran parte dello storico e può essere usato occasionalmente dall'utente; la Claude API resta attiva per l'OCR PDA fino alla futura migrazione a OpenAI.

Le regole seguenti valgono per qualunque assistant lavori sul repository:

1. **Fonti di verità condivise**: `README.md` (utente-facing) + `AGENTS.md` (fonte primaria Codex) + `CLAUDE.md` (questo file, compatibilità storica) + `database/README.md` (schema). Ogni modifica va riflessa nei file pertinenti **nella stessa sessione** in cui si tocca il codice.
2. **Nessuna azione irreversibile senza conferma esplicita dell'utente**: no `git push --force`, no DROP tabelle/colonne, no `rm -rf` fuori dallo scratchpad, no revoca policy RLS, no cambio env var Netlify. Se una modifica DB rompe potenzialmente il CC prod (vedi lista tabelle condivise in "Roadmap & boundaries") → **bloccarsi e chiedere prima**.
3. **Push su GitHub solo quando l'utente lo dice**: si può preparare un commit locale, ma `git push origin main` va lanciato solo su richiesta esplicita ("push", "carica su github", "manda in produzione"). Netlify fa deploy automatico al push, quindi ogni push è un deploy production su `mirox-crm.it`.
4. **Un commit = un cambio coerente**: ogni commit deve poter essere letto dall'altro assistant come "ok, qui hanno fatto X per Y". Messaggio in italiano, primo verbo all'imperativo (`fix(...)`, `feat(...)`, `docs(...)`, `refactor(...)`, `chore(...)`). Corpo opzionale con contesto se non ovvio. Sempre firma `Co-Authored-By` per capire chi ha scritto (Claude Code aggiunge la propria, Codex la propria).
5. **Prima di iniziare, leggere gli ultimi commit**: `git log --oneline -20` mostra cosa ha fatto l'altro. Se un commit recente tocca la stessa area del task che stai per fare, allineati con lo stato attuale invece di sovrascriverlo.
6. **Convenzioni tecniche identiche**: no emoji in HTML/JS visibili (vedi sezione dedicata), niente `alert()`/`confirm()` nativi (usare `MiroxUI.*`), niente `fetch()` diretto verso Netlify functions (usare `MiroxApi.fetch()`), niente `db.storage.from().upload()` dal client (solo via Netlify function). Vedi sezione "Convenzioni" per l'elenco completo.
7. **Note operative consapevoli**: prima di "correggere" qualcosa che sembra sbagliato, controllare la sezione "Note operative consapevoli" — molte scelte apparentemente inconsistenti sono volute (es. cluster `Turista`, catalogo Reload dismesso, file SQL parziali).
8. **In caso di conflitto**: se una convenzione, un pattern o un vincolo non è documentato qui e la tua modifica lo richiederebbe, **prima documentalo** in `CLAUDE.md` (sezione appropriata) e poi implementalo. Non lasciare tribal knowledge nel codice.

L'utente può chiedere in qualsiasi momento "cosa ha fatto Codex nell'ultima sessione?" / "cosa ha fatto Claude Code?": la risposta si costruisce da `git log --author=...` + diff dei commit + eventuali sezioni nuove in `CLAUDE.md`.

---

## Convenzione UI — Niente emoji (regola permanente)

**Regola assoluta**: nessuna emoji è ammessa in nessun file HTML o JS del progetto — né nelle pagine esistenti né in quelle nuove. Questo vale per:
- Testo visibile all'utente (label bottoni, titoli sezioni, intestazioni popup/modal, messaggi alert/confirm, stati empty-state)
- Testo nei `console.log` / `console.warn` / `console.error`
- Attributi HTML (`title`, `placeholder`, `aria-label`, ecc.)
- Commenti inline nel codice visibile (non quelli nello `<script>`)

Sostituire sempre con testo descrittivo (es. `🔄 Aggiorna` → `Aggiorna`, `⚠ Attenzione:` → `Attenzione:`, `✓ Conferma` → `Conferma`).

---

## Roadmap & boundaries (LEGGERE PRIMA DI MODIFICARE)

- **Vendita / Post-Vendita** = focus storico, completato in larga parte
- **Call Center integrato** = a partire dal 2026-06-20 le pagine CC sono integrate in `moduli/call-center/` (Fase 1: mount UI). Lo storico CC condivide il project Supabase; il pannello del 05/10/2026 conferma `mirox-crm.netlify.app` come alias del CRM attuale, quindi il vecchio deploy distinto va reidentificato
- **Integrazione CC completata nelle fasi 2–4**: `storico_cliente` esteso, backfill/auto-link di `chiamate.anagrafica_id` e convergenza Upload Contratti con `origine_pratica` automatica sono già applicati. Le eventuali estensioni successive sono nuove funzionalità, non attività arretrate.

### URL deploy
- **Repo GitHub**: `git@github.com:mirkopiasenti/mirox-crm.git` (dal 2026-07-02, prima era `konahub-vendita-test` — redirect ancora attivo ma va usato il nome nuovo)
- **Netlify site di questa codebase**: **`mirox-crm`** (nome sito Netlify dal 2026-07-02, prima era il vecchio nome legato al test). Custom domain **`mirox-crm.it`** in production dal 2026-06-29 — tutte le functions (auth + OTP + backend) rispondono qui. Env vars (Supabase, Smshosting, Anthropic, SMTP) configurate su questo site
- `test-upload-contratti-konahub.netlify.app` — vecchio URL di test del repo. **Non è più aggiornato** (le functions OTP rispondono 404). Deprecato — l'URL "buono" è `mirox-crm.it`
- `mirox-crm.netlify.app` — il 05/10/2026 il pannello Netlify Domain management lo mostra come alias del site `mirox-crm`, collegato a questo repository e a `mirox-crm.it`. La precedente indicazione di un progetto CC distinto su questo URL è obsoleta. Il repository/deploy storico del CC resta da identificare; i vincoli sulle tabelle condivise restano validi.

### Tabelle condivise — toccare con cautela (regole NON negoziabili)

Modifiche a schema / RLS / RPC / trigger su queste tabelle hanno rischio di **rompere il Call Center in produzione**:

`profili`, `anagrafica`, `appuntamenti`, `chiamate`, `call_center_lead_outbound*`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`, `blacklist`

3 regole di coordinamento col CC prod:
1. **Solo modifiche DB additive** — mai DROP/RENAME colonne, mai CHECK più stretti
2. **Mai modificare RPC esistenti** (solo aggiungerne di nuove con nuovi nomi, es. `cerca_o_crea_anagrafica_v2`)
3. **Le RLS nuove devono includere anche le pagine vecchie** — chiavi `pagine_accessibili` riutilizzate identiche (no prefisso `cc_`)

→ **chiedere conferma all'utente** prima di alterare qualsiasi tabella di questa lista.

---

## Architettura 3 layer

### Backup Aruba attivo (05/10/2026)

Destinazione scelta: Aruba Object Storage in Italia e VPS italiano. Runner isolato
in `scripts/backup/aruba.py`, versioni/Object Lock Compliance, cifratura client
AES-256-GCM, readback di ogni upload e controllo notturno anche delle copie riusate.
Timer systemd orario abilitato dopo collaudo; monitor esterno Healthchecks configurato, senza dati CRM nei ping. Credenziali private via LoadCredential;
chiave cifratura custodita anche separatamente. Dipendenze Python isolate con hash.
Sorgenti 404 recuperabili solo da duplicati con checksum/dimensione verificati
e record stabili; recupero annotato nel manifest, nessuna scrittura production.
Trasferimenti Storage limitati a 8 worker con file temporanei separati e
controlli DB serializzati; errori impediscono il manifest completo.
Legge DB e inventario Storage dallo stesso snapshot, pubblica il manifest completo
per ultimo e non esegue restore o deploy. Dati e pacchetti locali esclusivamente
in `.backup-private/` ignorata da Git. Nessun Delete nel runner, lock Compliance
non riducibile durante la retention. Lifecycle/tag e compatibilità API verificati live; scadenza effettiva sintetica osservata il 13 e 23/10/2026.
Ripristino del DB condiviso coinvolge il CC storico: prove solo su ambiente isolato
con integrazioni disattivate. Account Aruba e VPS O2A4 IT1 creati; Storage R1-IT
attivo, bucket privato/versionato/Compliance creato; password in file privato.
Preflight e prove sintetiche live superati, scadenza lifecycle da osservare. Runner installato,
68 test superati sul VPS, timer enabled/active.
Password DB/export verificati, monitor 1h/grace 1h e avvisi errore/assenza collaudati;
prima copia Aruba completa e 6.584 file verificati; restore 100 tabelle/51.252 righe. Repo CRM pubblico letto
senza token; CC storico da identificare, repository inaccessibili bloccano il job. Chiave Storage esistente recuperata
in file privato; TLS IPv6 verificato con CA ufficiale Supabase. `database.sslrootcert`
assoluto configura la CA per connessione e pg_dump, sempre con `verify-full`.
`provision-aruba.sh` prepara Ubuntu 24.04 amd64 senza abilitare il timer; verificare
l'identita' SSH dopo cloud-init prima di accettare un cambio chiave host;
resize legacy errato del template IT1 disabilitato solo con root gia' espanso.
Eventuali futuri ampliamenti del disco richiedono verifica manuale;
il template AWS precedente resta disponibile ma non e' la destinazione scelta.
Restore locale `restore-local.py`: immagine Supabase PG17.6 fissata al digest,
nessuna rete, cron off, container effimero. Restore da Aruba: 100 tabelle/51.252 righe
con valori COPY identici. API/ACL non collaudate.
Export Netlify autorizzato il 05/10: 20/28 valori Production privati e cifrati
Aruba, readback/confronto verificati; 8 Secret write-only mancanti, utente senza
copie originali. Serve riemissione coordinata distinta, nessuna rotazione eseguita.
Inventario statico da aggiornare dopo cambi configurazione; status DA_COMPLETARE.
Guida: `docs/BACKUP_RIPRISTINO.md`.


Controlli nativi VPS: `audit.py` + `mirox-backup-audit.service/.timer` abilitati
alle 06:47 UTC ogni giorno (ritardo casuale massimo 2 minuti). Preflight e ultimo
manifest completo entro 3 ore; prova lifecycle su una versione sintetica con lock
2 giorni, allarme se scompare prima o persiste oltre 7 giorni. Scadenza reale sintetica osservata il 13 e 23/10/2026. Una volta per trimestre ripristina dump/ruoli Aruba tramite
`restore-local.py`: prima prova 05/10, 100 tabelle/51.313 righe, valori COPY identici,
18,5 s; seconda esecuzione verifica lo skip trimestrale. Audit root solo per
avviare/arrestare Docker, codice root-owned, LoadCredential e stato root-only;
backup orario resta non privilegiato. Monitor dedicato 24h/grace 12h/email ON,
ping di successo osservato. Nessuna API Auth/Storage o ACL di produzione collaudata.
`maintenance.py` esporta una copia TAR indipendente cifrata da versioni esatte,
verifica SHA256 e AES-GCM, senza conservare plaintext. Verifica offline senza S3,
progetto/chiave/manifest e nomi TAR vincolati; niente estrazione libera. La custodia
su supporto fisicamente scollegato richiede il proprietario, chiave separata.
Copia indipendente checkpoint 11:46 sul Mac: 6.585 file/1,16 GB, SHA256/AES-GCM
verificati senza rete e senza credenziali S3; strumenti in `.backup-private/offline/`.
Custodia fisica su supporto scollegato ancora da confermare dal proprietario.
Config Auth SMTP disabilitato/sessioni/13 template e 7 pagine avanzate salvata privatamente; zona DNS
Aruba autorevole esportata BIND. Config esterne statiche da aggiornare dopo cambi.
Il 05/10 l'utente ha rinviato esplicitamente nuovo progetto Supabase e collaudo CRM
completo fino alla rimozione del Call Center test: non creare progetti o rimuovere
ambienti in autonomia. Otto Secret Netlify e restore gestito restano punti aperti.


Verifica storico read-only 23/10: 441 avvii orari, 418 riusciti/23 falliti,
massimo intervallo copie circa 8 ore; ultima full/checkpoint giornaliero riuscita
19/10, quattro successivi falliti. Ultima copia 23/10 17:18 valida: 7.298 file,
11 bucket (Subentri incluso), hash/AES verificati; 176 manifest conservati validi.
Audit: una failure 22/10 e successo 23/10, probabile soglia lifecycle da verificare,
causa non certa per log generici. Nessuna correzione ancora applicata: servono
diagnostica ripulita, retry e recupero giornaliero. Inventario Netlify off-site
ancora iniziale (28/20/8), successive configurazioni da riallineare. Rapporto:
`docs/BACKUP_VERIFICA_STORICO_2026-10-23.md`; non presumere che tutto sia regolare.

### 1. Frontend (`/`, `/moduli/`, `/moduli/call-center/`, `/js/`, `/css/`)

Pagine HTML statiche, no bundler. Netlify esegue `scripts/build-static.js` e pubblica esclusivamente `dist/`, generata copiando gli HTML root e le directory `assets/`, `css/`, `js/`, `moduli/`; `dist/` è ignorata da Git. La build sostituisce il guard sorgente `js/config.js` con la configurazione Supabase dell'ambiente e genera `dist/_headers` con una CSP limitata allo stesso host. Ogni branch Netlify diversa da `main` e' staging: senza `MIROX_PUBLIC_SUPABASE_URL` e `MIROX_PUBLIC_SUPABASE_ANON_KEY` dedicate la build fallisce, e il project ref produzione `lbgwamhjkjjfwgusafbi` e' sempre rifiutato. `imposta-password.html` gestisce il callback Auth degli inviti, rimuove i token dalla URL e salva una password di almeno 12 caratteri tramite `auth.updateUser()`. Backend, migration, test, script, file Markdown e configurazioni non devono mai essere aggiunti alla lista pubblica. `/moduli/call-center/` contiene il modulo CC integrato (Fase 1, vedi sezione dedicata). `dashboard.html` espone `Segnala Problema`, collegato alla chat autenticata `moduli/segnala-problema.html` del primo agente KONA AI Guardian. Le pagine `admin*.html` alla root costituiscono il **Pannello Admin Mirox** (`admin.html` hub + `admin-utenti.html` + `admin-call-center-config.html` + `admin-vendita-config.html` + `admin-gare.html`), tutte gated da `profili.ruolo='admin'`. JS condiviso Mirox esposto su `window`:

| File JS | Espone | Uso |
|---|---|---|
| `js/config.js` | `window.db`, `window.MiroxEnvironment` | Guard nel sorgente; la build genera il client con URL + publishable/anon key dell'ambiente |
| `js/auth.js` | `window.Auth` | `richiediAuth()` guard, `logout()`, `getProfilo()`. Le operazioni sensibili sono autorizzate per ruolo lato server; il frontend non richiede password operative o una seconda immissione della password account |
| `js/mirox-safe.js` | `window.MiroxSafe` | `escapeHtml`, `safeUrl`, `isUuid`, `isRecordId`, `safeCssColor`. Caricato da tutte le pagine per impedire che dati DB/input diventino markup, URL o handler eseguibili |
| `js/anagrafica-helper.js` | `window.AnagraficaHelper` | `detectKind`, `cerca`, `cercaOcrea`, `setupAnagraficaSection` |
| `js/mirox-ui.js` | `window.MiroxUI` | `alert/confirm/prompt/loading/toast/allegati`. `allegati()` accetta sia `{url}` legacy sia `{bucket, path}` (genera signed URL on-click via MiroxStorage) |
| `js/mirox-storage.js` | `window.MiroxStorage` | `signedUrl(bucket,path,exp)`, `openAttachment(bucket,path)` — signed URL on-demand per i bucket privati (vedi sezione "Storage buckets") |
| `js/mirox-storage-upload.js` | `window.MiroxStorageUpload` | `upload({file,bucket,path})` — invia i PDF dei moduli e gli allegati PDF/immagine di Segnalazioni a `upload-documento-modulo`; nessuna scrittura Storage diretta dal browser |
| `js/mirox-api.js` | `window.MiroxApi` | `fetch(url, opts)` wrapper che inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. Usare per TUTTE le chiamate alle Netlify functions (vedi "Auth functions"). **Auto-refresh trasparente del JWT** (dal 2026-07-01): se il token e' entro 60s dalla scadenza chiama `refreshSession()` prima del fetch; se una function risponde 401 tenta refresh + retry una volta; se anche il retry fallisce mostra toast "Sessione scaduta" e redireziona a `index.html`. Refresh proattivo anche su `visibilitychange`/`pageshow` e via heartbeat 5 min (copre PC in sleep e tab in background dove il timer interno di supabase-js viene throttled dal browser). Espone anche `MiroxApi.refreshSession()` per forzare un refresh esplicito |
| `js/mirox-upload.js` | `window.MiroxUpload` | drag-drop binding su `.mx-drop-zone` e `.file-drop`; anteprima PDF prima di accettare file selezionati/trascinati (`previewPdfFile`, `previewPdfFiles`, `confirmFilesForInput`) |
| `js/mirox-folder.js` | `window.MiroxFolder` | `build(oldName, newName, date)` per nomi cartella Storage |
| `js/mirox-mailer.js` | `window.MiroxMailer` | `send({to, template, vars})` |
| `js/vendita-storage-helper.js` | `uploadVenditaDocumento(...)` | wrapper upload PDF via Netlify function |

### 2. Server (`/netlify/functions/`, Node >=22)

Tutte le functions usano `SUPABASE_SERVICE_ROLE_KEY` e bypassano le RLS. Per questo motivo **TUTTE le functions tranne i due cron Netlify, `public-prenota` e `guardian-telegram-webhook`** richiedono `Authorization: Bearer <jwt>` valido (validato via `_lib/require-auth.js`). Il webhook Guardian e' protetto da secret token Telegram e allowlist rigida del `chat_id` di Mirko. `admin-vendita-config`, `admin-kpi-vendita-consumer`, `gestisci-controllo-fissi`, `elimina-vendita-contratto`, le action manuali di `gestisci-controllo-lg` e le action sensibili di `gestisci-operazioni-post-vendita` richiedono ulteriore check `ruolo='admin'`. Il client deve usare `MiroxApi.fetch()` o aggiungere l'header manualmente. 26 functions + 9 lib condivise, inclusi `_lib/kona-ai-guardian.js` e `_lib/telegram.js`:

- `vendita-config.js` (GET) — catalogo per wizard
- `admin-vendita-config.js` (GET/POST action-based) — CRUD admin offerte/opzioni/reload + replace regole documentali
- `crea-vendita-pratica-carrello.js` (POST action-based) — `create`: anagrafica upsert → pratica `bozza` → N contratti, PDA e validazioni; l'operatore è derivato dal JWT e non dal payload. I PDA di più contratti della stessa categoria vengono promossi con suffisso progressivo per evitare collisioni Storage. I quattro componenti punteggio sono letti dal catalogo con parser stretto, poi confrontati con la riga realmente restituita dal DB: una divergenza attiva il rollback della pratica in bozza. `finalize`: dopo tutti gli upload passa la pratica a `inviata` e chiude gli eventi CC. `rollback_upload_failure`: elimina in modo compensativo pratica `bozza`, contratti, record documento e file già caricati. Le action sono idempotenti e consentite solo all'operatore proprietario o a un admin. Il reinserimento è validato anche server-side su stessa anagrafica, categoria, mese solare Europe/Rome e stato post-vendita. Cellulare obbligatorio; email obbligatoria per `Consumer`/`Business` e facoltativa per `Turista`. Prima di scrivere anagrafica/bozza, verifica categoria e campi PDA, duplicati nel payload e a DB; l’indice UNIQUE intercetta le gare concorrenti, con rollback compensativo e risposta 409.
- `upload-vendita-documento.js` (POST multipart busboy, max 20MB) — accetta solo file con MIME e firma `%PDF-`, verifica proprietà operatore/admin per le bozze e consente agli operatori attivi la gestione delle pratiche `inviata` da Verifica Contratti. Valida relazioni pratica/anagrafica/contratto, deriva il path dalla pratica a DB e usa come `uploaded_by` il profilo autenticato. Rollback del file se l'INSERT DB fallisce. In staging con `temp_session_id` salva in `temp/<sess>/` senza record DB.
- `upload-documento-modulo.js` (POST multipart busboy, max 20MB) — upload server-side autenticato per `apri-chiudi-files`, `switch-sim-files`, `comodato-files`, `rimborsi-files`, `protecta-files`, `segnalazioni-files`. Verifica firma e MIME dei PDF e delle immagini accettate in Segnalazioni, bucket, struttura path e limite di 20 MB; usa `upsert:false`, genera un suffisso anti-collisione conservando l'estensione e registra `uploaded_by` dal JWT nei metadati Storage.
- `gestisci-vendita-contratto.js` (POST action-based) — `update` (`save`/`verify`/`reopen`) e `delete_document` per Verifica Contratti. Accetta solo campi in allowlist; aggiorna snapshot/punteggi dal catalogo soltanto quando cambia l'ID corrispondente, rifiuta punteggi nulli/non numerici e confronta la riga post-UPDATE con i componenti attesi. Imposta `controllato_da`/`updated_by` dal JWT e gestisce rimozione Storage + record DB. Sostituisce UPDATE/INSERT/DELETE diretti dal browser su `vendita_contratti`/`vendita_documenti`. Nuove action PDA: `check_codice` consulta globalmente; `update_pda` modifica solo gli sette nuovi campi per utenti attivi, con `expected_updated_at`, senza punteggi/stato/anagrafica. Collisione DB = 409 `contratto_duplicato`.
- `gestisci-controllo-fissi.js` (POST action-based, admin-only) — `reopen_activation` riporta una riga da `Attivo` o `KO` a `In Attivazione` soltanto se lo stato corrente è ancora uno dei due, azzera `data_attivazione` e `motivo_ko` e registra data/autore del ripristino dai dati JWT.
- `gestisci-controllo-lg.js` (POST action-based) — `csv_update_batch` applica fino a 50 esiti WindTre per richiesta agli account autenticati e ricontrolla atomicamente `esito_manuale_bloccato=false`; `set_manual_outcome` e `unlock_manual_outcome` sono admin-only. Lo stato manuale richiede motivazione, registra autore/data, azzera i dettagli rifiuto provenienti dal CSV e rimane protetto finche' un admin non riattiva l'automatismo.
- `gestisci-operazioni-post-vendita.js` (POST action-based) — sostituisce tutte le scritture browser su `post_vendita_gestione_rimborsi`: creazione, associazione path PDF e completamento restano disponibili agli account autenticati; `create_rimborso_manuale` è admin-only. `mark_apri_chiudi_ko` è disponibile agli account autenticati attivi, accetta soltanto pratiche ancora `IN CORSO` e aggiorna tramite service role. Operatore e stato del rimborso manuale sono derivati lato server. Migration post-deploy `056`: rimborsi write server-only e trigger DB che continua a impedire di introdurre `vendita_apri_chiudi.stato='KO'` con una scrittura diretta da sessioni non-admin.
- `elimina-vendita-contratto.js` (POST) — **admin-only**. Usata da `moduli/verifica_contratti.html` per eliminare definitivamente una riga contratto. Richiede doppia conferma lato UI e `requireAuth(event, { adminOnly: true })` lato server. Cancella `vendita_contratti` (con cascade su `vendita_documenti` e tabelle post-vendita), rimuove gli allegati dal bucket `contratti-vendita`, elimina i log collegati e cancella `vendita_pratiche` solo se dopo la rimozione non restano altri contratti. Non cancella mai `anagrafica`. Se il contratto e' padre di un reinserimento (`reinserimento_di_contratto_id`) ritorna 409 e blocca l'eliminazione.
- `ocr-pda.js` (POST multipart, max 20MB) — OCR del PDA via Claude API (`claude-haiku-5-5`). **Dati cliente**: cf_piva, ragione_sociale, nome_referente, cellulare, email, provincia, comune, via, civico. **Codice Rivenditore** (dal 2026-07-18, migration `050`): estrae `codice_rivenditore` dal "Codice POS" WindTre. Valori ammessi solo `'9001415852'` (Legnago) o `'9000822241'` (Cerea); qualsiasi altro codice trovato → `null`. Il POS estratto non cambia il rivenditore fisso Legnago nei nuovi inserimenti. **Dati dispositivo** (dal 2026-06-26, PDA WindTre Mobile/Customer Base): `dispositivo_presente` (bool nullable: presenza/assenza esplicita/incerto), `tipo_acquisto` ('VAR' o 'Finanziamento'), `imei` (15 cifre), `prezzo_device` (stringa numerica es. "399.9"), `smartphone_reload` (bool nullable: true=SI[X], false=NO[X], null=sezione assente). Riconoscimento VAR vs Finanziamento via 3 segnali concordi nel PDA: titolo pagina ("Offerta con Finanziamento" vs "Offerta Vendita a Rate"), header sezione ("OFFERTA CON FINANZIAMENTO" vs "VENDITA A RATE"), riga Opzioni/servizi della SIM ("Vendita con Finanziamento" vs "Vendita a rate"). Validazione server-side: tipo_acquisto solo enum, imei regex 15 cifre, prezzo_device regex numerico (altrimenti `null` per evitare di sporcare il form). `finanziaria` e `kolme` NON sono estratti (non presenti nel PDA, compilazione manuale operatore). 200 con `data: {...}` se l'OCR estrae (campi `null` se parziale). In caso di errore "hard" l'errore Anthropic viene classificato in `error_code` strutturato: `ocr_credit_exhausted` (credit balance low → 503), `ocr_rate_limited` (429 → 503), `ocr_unavailable` (5xx/529 → 503), `ocr_auth_error` (401/403 → 503), `ocr_generic_error` (default → 500). Payload errore: `{success:false, error, error_code, http_status, provider_status, provider_message}`. Il client decide il popup in base a `error_code`. Richiede `ANTHROPIC_API_KEY`. Estrae inoltre codice PDA e dati Mobile (costo base, numero SIM, MNP, operatore, presenza portabilita); `cellulare` proviene esclusivamente dalla firma elettronica. Output max2400 token ed effort low su Haiku5.5; stessa chiave API, senza modifica delle regole estrattive. Estrae `tipo_attivazione_fisso` dalla casella nuova linea/numero attivo, con null per dato assente o ambiguo. Numerazioni e tipo attivazione recuperati anche da testo PDF per coordinate tramite `_lib/pda-pdf-text.js` e `unpdf@1.9.1`, esterno esbuild. Estrae anche codice_cliente WindTre, distinto dal codice contratto. Estrae professional_cloud nullable dalla SIM contrattuale Mobile o da Opzioni aggiuntive Fisso; No testuale richiede accordo AI, incerto manuale.
- **Compatibilità cellulare OCR**: il prompt di `ocr-pda` deve accettare ed estrarre numerazioni mobili italiane di 9 o 10 cifre; non reintrodurre l'assunzione rigida delle sole 10 cifre.
- `search-anagrafica.js` (GET) — lookup CF/PIVA Include codici cliente WindTre dal registro anagrafico, con relazione opzionale.
- `mirox-send-email.js` (POST) — mailer autenticato
- `guardian-incidents.js` (GET/POST action-based) — raccolta autenticata KONA AI Guardian. Gli operatori accedono solo ai propri incidenti; gli admin possono elencarli tutti. Tabelle server-only e identita' derivata dal JWT.
- `guardian-telegram-webhook.js` (POST) — eccezione webhook protetta da secret token + owner `chat_id`. Gestisce testo, vocali trascritti, conversazione, analisi Guardian approvata e archiviazione auditata. Nella prima versione non accede al repository e non esegue Codex.
- `cron-rientro-sim.js` (scheduled `0 7 * * *`) — notifica giornaliera switch SIM. **Non auth-gated** (chiamata dal cron Netlify, non da utente). Con `MIROX_DEPLOY_ENV=staging` termina subito con `skipped`, senza DB o email.
- `cron-pulizia-operativa.js` (scheduled `30 2 * * *`) — scade OTP pending, elimina contatori rate-limit scaduti e recupera fino a 100 pratiche `bozza` oltre 24 ore eliminando prima i PDF noti e poi il record DB. **Non auth-gated** (cron Netlify). Con `MIROX_DEPLOY_ENV=staging` termina subito con `skipped`, senza DB o Storage.
- `public-prenota.js` (GET/POST) — **endpoint pubblico** chiamato dal form `prenota.html` (anon). GET ritorna gli slot via `get_slot_disponibili`; POST usa la nuova RPC `public_prenota_appuntamento_v1` (migration `055`), che prende un advisory lock e ricontrolla lo slot nella stessa transazione dell'INSERT. Rate limit persistente su Postgres tramite fingerprint SHA256 dell'IP: 60 GET e 6 POST ogni 10 minuti; fail-closed se il limiter non risponde. **Non auth-gated** (intenzionalmente pubblico).
- `garantisci-anagrafica.js` (POST) — upsert anagrafica (lookup CF/PIVA → update campi vuoti / cambiati o insert). Chiamato dal wizard upload-contratti PRIMA della raccolta consenso privacy: il consenso ha bisogno di `anagrafica_id` ma il backend del carrello finora la creava solo al submit. Idempotente con `crea-vendita-pratica-carrello` (entrambi fanno lo stesso lookup/update). Per cluster vendita `Turista`, salva/aggiorna `anagrafica.cluster='Consumer'` perché la tabella condivisa non deve contenere il cluster vendita turistico e non richiede email. Vedi sezione "Sistema consensi privacy GDPR". Aggiunge codici cliente WindTre al registro collegato senza sostituire i precedenti.
- `check-consenso-privacy.js` (GET) — `?anagrafica_id=<uuid>`. Cerca una dichiarazione `stato='confermato'`, non scaduta, non revocata e con `informativa_versione` appartenente alle versioni correnti cartacea/digitale. Il filtro impedisce di riusare retroattivamente informative precedenti. Con `include_history=true` la response additiva espone anche `esito` (valido, assente, in attesa, fallito, scaduto, revocato o da rinnovare) e `documento`, cioè l'ultimo PDF privacy archiviato anche se non più riutilizzabile; `storico_cliente.html` li usa per badge e download dedicato senza leggere direttamente la tabella protetta. Senza il parametro il wizard mantiene response e singola query originarie.
- `richiedi-otp-privacy.js` (POST) — richiede `consenso_marketing` booleano esplicito, accetta cellulari italiani di 9 o 10 cifre (incluse numerazioni legacy) e li normalizza in E.164, genera OTP 6 cifre, salva hash SHA256+salt random e invia SMS via Smshosting. Rate-limit 3 invii/ora per `anagrafica_id` + cooldown 60s tra invii. Invalida automaticamente i record `pending` precedenti dello stesso cliente. Richiede `SMSHOSTING_API_KEY`, `SMSHOSTING_API_SECRET`. Se `SMSHOSTING_SIMULATE=true` non invia davvero, logga e ritorna id fittizio (utile per dev/test).
- `verifica-otp-privacy.js` (POST) — `{consenso_id, otp}`. Re-hash dell'OTP inserito e confronto. Max 3 tentativi (poi `stato='fallito'`). Se OK genera il PDF digitale v6 con entrambe le opzioni marketing, una sola marcata, scelta nel riquadro probatorio ed evidenze reali (cellulare, invio/conferma, esito/tentativi, IP, user agent, hash SHA256, ID SMS), upload su bucket `consensi-privacy`, segna `stato='confermato'` + `valido_fino_al = now()+24 mesi` + `informativa_hash`.
- `genera-pdf-consenso-cartaceo.js` (GET) — `?anagrafica_id=<uuid>&consenso_marketing=true|false`. Stream binario del modulo v6 **precompilato in modalità cartacea**: una sola pagina A4, bianco e nero, corpo 10 pt, due colonne per l'informativa, dati/dichiarazioni/firma a larghezza piena e scelta marketing già marcata. Rifiuta la richiesta se la scelta manca.
- `upload-consenso-cartaceo.js` (POST multipart busboy, max 20 MB) — riceve la scansione PDF del modulo firmato e richiede l'esito marketing `true|false` riportato sul foglio. Calcola SHA256, carica nel bucket `consensi-privacy` e crea il record `modalita='cartaceo'`, `stato='confermato'` (no OTP).
- `_lib/mailer.js` — helper SMTP Gmail + template DB + log
- `_lib/require-auth.js` — helper auth: valida JWT Supabase nell'header `Authorization: Bearer <token>`, ritorna `{ok, user, profilo}` o `{ok:false, status, error}`. Supporta opt `adminOnly: true` per richiedere `ruolo='admin'`. Usare in TUTTE le nuove functions
- `_lib/smshosting.js` — wrapper REST API Smshosting per invio SMS transactional. Espone `sendOtpSms({to, otp})`, `normalizeMobileNumber(raw)`, `generateOtp(6)`. `normalizeMobileNumber` accetta cellulari italiani nazionali di 9–10 cifre con iniziale `3`, oltre ai numeri già in formato E.164, e restituisce sempre `+39...` per quelli italiani. Auth HTTP Basic. Endpoint `https://api.smshosting.it/rest/api/sms/send`. Timeout 12s. Modalità simulazione tramite env `SMSHOSTING_SIMULATE=true`. Vedi `docs/SMSHOSTING_SETUP.md` per il setup account.
- `_lib/privacy-config.js` — fonte unica delle due versioni informative correnti: `v6_2026_07_26` cartacea e `v6_2026_07_26_dig` digitale OTP. Espone anche l'elenco accettato dal dedupe/backend.
- `_lib/pdf-consenso.js` — generatore `pdfkit` con due template: cartaceo v6 su una pagina A4 monocromatica e digitale v6 `_dig` su tre pagine con layout storico. La ragione sociale del Titolare è `KONA TECH SRL`. Finalità, basi giuridiche, conservazione e perimetro marketing sono equivalenti. Entrambe le varianti mostrano ACCONSENTO e NON ACCONSENTO con una sola scelta marcata; il digitale la ripete nel riquadro probatorio e descrive il flusso OTP reale. Esporta `{buffer, hash, informativaVersione}`.
- `_lib/score-integrity.js` — parser stretto dei punteggi catalogo e verifica condivisa dei quattro componenti, dei totali gara/extra e delle colonne legacy. Usato sia alla creazione sia in Verifica Contratti.
- `_lib/kona-ai-guardian.js` — prompt e output strutturati, fallback raccolta, analisi proprietario, codici `KG-*` e notifica Telegram.
- `_lib/telegram.js` — client Telegram privato, download vocali max 25 MB e trascrizione OpenAI `gpt-transcribe`.

### 3. Database (Supabase Postgres)

~80 tabelle. Project ref produzione: `lbgwamhjkjjfwgusafbi`. La configurazione pubblica di produzione e' in `scripts/build-static.js`; quella staging arriva soltanto dalle env Netlify e viene materializzata in `dist/js/config.js`.

Guardian usa esclusivamente Supabase production `lbgwamhjkjjfwgusafbi`; migration additive `065`–`068` e memoria Telegram del 05/10/2026 applicate.

---

## Mappa Supabase per dominio

### Anagrafica & Auth (condiviso)
- `profili` — utenti CRM, `ruolo` IN ('admin','operatore'), `pagine_accessibili` jsonb per ACL Call Center, `in_gara` bool (dal 2026-07-09, migration 038) per includere l'operatore nella tab "Gare Individuali" del Dashboard Pezzi, `alias_di` uuid (dal 2026-07-09, migration 040) self-FK opzionale per unificare due account della stessa persona: se valorizzato, il profilo e' un alias del profilo canonico indicato e ogni INSERT/UPDATE su tabelle con `operatore_id` viene redirezionato al canonico tramite trigger `trg_alias_operatore`. Il backfill usa `applica_alias_backfill_v2(uuid)` (migration `053`), SECURITY DEFINER con controllo admin; la v1 viene chiusa al client dalla migration post-deploy `054`.
- `anagrafica` — cliente unificato, `cf_piva` UNIQUE, `cluster` operativo condiviso (`Consumer`/`Business`; i passaporti cluster vendita `Turista` vengono salvati qui come `Consumer`). Colonna `email` (text, NULL ammesso a livello DB; obbligatoria lato wizard solo per `Consumer`/`Business`). RPC `cerca_o_crea_anagrafica(p_..., p_email)` UPSERT. Migrations `057` + `059`: consolidate 8 duplicazioni certe da identificativi fiscali/import errati e dal doppione tecnico `TEST`/`test`, spostando tutte le FK e conservando ogni record eliminato in `vendita_log_modifiche`; le omonimie con CF/P.IVA validi distinti restano separate.
- `anagrafica_codici_cliente_windtre` — piu codici testuali per anagrafica, PK (anagrafica_id,codice_cliente), RLS ON e registro append-only via backend. Migration `20261027220802` applicata; nessun backfill.

### Call Center (condiviso, gestito dall'altro progetto)
- `chiamate`, `appuntamenti`, `blacklist`, `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni`
- `call_center_lead_outbound` + `_chiamate` + `_attivita` + `_import` — outbound business con dedupe (`dedupe_key` UNIQUE), normalizzazione testo/telefono/email
- RPC chiave: `crm_can_access_page(text)`, `crm_normalize_*`, `crm_import_call_center_lead_outbound_batch`

### Vendita (focus di questo progetto)
- `vendita_categorie` — Mobile, Fisso, Energia, Allarmi, Customer Base, Assicurazioni
- `vendita_offerte` — `cluster_cliente`, `punteggio_gara`, `punteggio_extra_gara`, `abilita_dispositivo`, `abilita_switch_sim`
- `vendita_opzioni` — `punti_base`, `punti_extra_piva`
- `vendita_reload` — top-up. **Catalogo dismesso dal 2026-06-26** (vedi "Note operative consapevoli"). Tabella + colonna FK `vendita_contratti.reload_id` conservati per dati storici.
- `vendita_offerte_opzioni`, `vendita_offerte_reload` — link N:M. `vendita_offerte_reload` dismesso col catalogo Reload (vedi sopra)
- `vendita_pratiche` — `origine_pratica`, `stato_pratica`, `nome_cartella_storage`, `storage_base_path`
- `vendita_contratti` — riga venduta con snapshot + punteggi server-side + `stato_controllo`. Migration `058`: tre CHECK validati impongono coerenza tra componenti, totali gara/extra e colonne legacy; `trg_vendita_contratti_audit_punteggi` registra ogni INSERT e ogni variazione futura dei quattro componenti in `vendita_log_modifiche`. Migration `060`: ripristina il bonus 0,5 su 3 Assicurazioni Annuali residue del vecchio bug di verifica. Migration `061`: ripristina ID/nome opzione Iliad su 7 Mobile il cui punto era già corretto, con evidenza PDA. **Codice Rivenditore** (`codice_rivenditore`, migration `050`): text NOT NULL DEFAULT `'9001415852'` CHECK IN (`'9001415852'`,`'9000822241'`). Identifica il punto vendita di inserimento: `9001415852` = Legnago (negozio principale), `9000822241` = Cerea. Il wizard deve propagare sempre il valore dal draft a `buildInvioPayload`; se lo omette il backend applica il default Legnago e falsifica il punto vendita. Filtra Dashboard Pezzi Day by Day e Avanzamento Mensile (Legnago, con FISSI Standard anche Cerea dal 08/10/2026); Gare Individuali conteggia entrambi. Indice `idx_vendita_contratti_codice_rivenditore`. Vedi sezione "Codice rivenditore".
- `vendita_documenti`, `vendita_documenti_regole`, `vendita_compensi_regole`, `vendita_log_modifiche`. Migration `053`: UNIQUE `(storage_bucket, storage_path)`; migration post-deploy `054`: INSERT/DELETE documenti soltanto via backend.
- `vendita_consensi_privacy` — registra presa visione dell'informativa CRM e consenso promozionale opzionale (migration 034; durata originaria 48 mesi ridotta e clamped a 24 mesi dalla migration 055). Modalità `otp_sms` o `cartaceo`, stato workflow (`pending`/`confermato`/`scaduto`/`fallito`/`revocato`), OTP hash+salt+scadenza+tentativi, audit IP/UA, snapshot anagrafica jsonb, `valido_fino_al`, `pdf_storage_path` privato. I ricontatti di servizio sulla pratica specifica non dipendono dal consenso marketing.
- Moduli operativi: `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `vendita_simulatore_protecta`. **`vendita_simulatore_protecta.trattativa_id`** uuid NOT NULL DEFAULT `gen_random_uuid()` (migration `051`, dal 2026-07-20): raggruppa piu' preventivi generati per lo stesso cliente. Ogni INSERT senza id esplicito crea una trattativa nuova (comportamento legacy). Il wizard `moduli/simulatore_protecta.html` chiede la modalita' di sessione all'ingresso: `Nuova trattativa` (nuovo uuid), `Aggiungi a trattativa esistente` (riusa uuid di una trattativa `In corso`), `Simula senza preventivo` (nessun uuid, nessun salvataggio). Backfill: ogni record legacy ha ricevuto un uuid distinto (33 record → 33 trattative). Indice `idx_vsp_trattativa_id`. Vedi sezione "Modalita' Simulatore Protecta".

### KONA AI Guardian
- `kona_ai_incidenti` — registro server-only migration `065`: codice `KG-*`, stato/priorita', reporter, contesto minimo, riepiloghi e scadenza dettagli tecnici a 90 giorni.
- `kona_ai_messaggi` — cronologia CRM/Telegram/Guardian/Codex/sistema per incidente.
- `kona_ai_approvazioni` — audit delle decisioni di Mirko. Sono eseguibili `analizza_guardian`, `archivia` e la sola registrazione `prepara_fix`; le azioni Codex/staging/produzione restano senza esecutore.
- `kona_ai_telegram_sessioni` — incidente attivo e dedupe `update_id` per il solo chat Telegram proprietario.

### Post-Vendita
- `post_vendita_dispositivi_comodato` — codice generato da RPC `genera_codice_comodato()`
- `post_vendita_gestione_rimborsi` — codice da RPC `genera_codice_rimborso()`. Dalla migration `056` le scritture e la RPC sono server-only: gli operatori usano `gestisci-operazioni-post-vendita`, mentre la creazione manuale è esclusivamente admin.
- `post_vendita_controllo_fissi` — follow-up dei contratti Fisso dopo conferma in Verifica Contratti. Stati: `Da completare` → `In Attivazione` → (`Attivo` | `KO`); un admin può correggere un `Attivo` o `KO` errato riportandolo a `In Attivazione` tramite backend, con azzeramento di `data_attivazione` e `motivo_ko`. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_fissi` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Fisso passa a `controllato`. Campi manuali: `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`, `numero_fisso`, `attivazione_prevista`, `data_attivazione`, `motivo_ko`. Chat in `storico_chat` jsonb (`[{timestamp, message, autore}]`). CHECK constraint su `stato`, `tecnologia` (FTTC/FWA OUT/FWA IN/FWA VOCE/FTTH_OF/FTTH_FWCOP), `cod_pos` (9001415852/9000822241).
- `post_vendita_controllo_lg` — follow-up dei contratti Energia (L&G = Luce & Gas, nome user-facing del modulo) dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_lg` su UPDATE `vendita_contratti.stato_controllo` quando un contratto Energia passa a `controllato`. I dati contratto/cliente sono letti dai join con `vendita_contratti` (`numero_contratto_energia`, `pod_pdr`, `ex_fornitore`, `operatore_id`) e `anagrafica`. L'upload CSV aggiorna `stato`, dettagli rifiuto e audit CSV. Migration `062`: `stato_origine`, flag `esito_manuale_bloccato`, motivazione/data/admin dell'esito manuale e audit dello sblocco; CHECK di coerenza + trigger DB impediscono agli operatori di creare/rimuovere il blocco o sovrascrivere una riga protetta.
- `post_vendita_controllo_assicurazioni` — follow-up dei contratti Assicurazioni dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_assicurazioni`. Dati di display dal join con `vendita_contratti` (`nome_offerta_snapshot`, `modalita_pagamento_assicurazione`, `ricorrenza_assicurazione`, `operatore_id`) e `anagrafica`. **Stato** (migration 033): colonna `stato` text NULL CHECK IN (`OK`,`KO`), default NULL. Dropdown in `controllo_assicurazioni.html` per scegliere l'esito (l'operatore lo seleziona quando ha l'esito; NULL = ancora da valutare, mostrato come "—"). `KO` rende il contratto candidato a essere padre di un reinserimento (vedi "Reinserimento contratti" in Regole di business). Audit: `stato_cambiato_at`, `stato_cambiato_da`.
- `post_vendita_controllo_allarmi` — follow-up dei contratti Allarmi dopo conferma in Verifica Contratti. Popolata in automatico dal trigger `trg_vendita_contratti_to_controllo_allarmi`. Dati di display dal join con `vendita_contratti` (`nome_offerta_snapshot`, `modalita_pagamento`, `operatore_id`) e `anagrafica`. **Stato** (migration 033): colonna `stato` text NOT NULL CHECK IN (`In Attivazione`,`OK`,`KO`), default `In Attivazione`. Dropdown in `controllo_allarmi.html` per cambiare stato. `In Attivazione` (default alla creazione automatica) e `KO` rendono il contratto candidato a essere padre di un reinserimento. Audit: `stato_cambiato_at`, `stato_cambiato_da`.

### Trasversali
- `segnalazioni` (+ `segnalazioni_backup`)
- `ticket` — badge in dashboard quando `stato='Da gestire'`
- `email_template` (con `{{placeholder}}`), `email_log` (`status` IN sent/error)
- `dashboard_righe_giornaliera` — config righe dashboard custom (tab Day by Day del Dashboard Pezzi)
- `mirox_public_rate_limits` — contatori temporanei del rate limit pubblico; fingerprint IP solo come SHA256, RLS attiva, nessun grant `anon`/`authenticated`. Scrittura/lettura tramite RPC service-role `mirox_public_rate_limit_v1` (migration `055`)
- `gara_metriche` (dal 2026-07-09, migration 038 + 041) — catalogo righe delle 4 tabelle del modulo Gare (`tabella` IN `gara_individuale`/`avanzamento_standard`/`avanzamento_piva`/`avanzamento_extra_piva`). Ogni riga ha `regola` JSONB (stesso DSL di `dashboard_righe_giornaliera`) + `punti_per_pezzo` numeric (moltiplicatore della colonna "Punteggio" nell'Avanzamento) + `tipo_conteggio` (`individuale`/`squadra`, migration 041). Le metriche `squadra` calcolano l'ATTUALE sommando tutti gli operatori del mese; obiettivo comune con `operatore_id=NULL`, compenso uguale in ogni card operatore. Trigger `updated_at`. RLS SELECT authenticated, INSERT/UPDATE/DELETE riservati agli admin (migration 039)
- `gara_obiettivi_mensili` (dal 2026-07-09, migration 038) — obiettivi mensili + regola compenso. Chiave `(anno, mese, metrica_id, operatore_id)` con `operatore_id` NULLABLE (NULL = obiettivo di categoria per l'Avanzamento Mensile; NOT NULL = obiettivo individuale per la Gara). `compenso_regola` jsonb DSL scaglioni + bonus (vedi "Modulo Gare & Avanzamento"). Trigger `updated_at`. RLS SELECT authenticated, INSERT/UPDATE/DELETE riservati agli admin (migration 039)

### RPC prenotazione pubblica (migration 055)
- `public_prenota_appuntamento_v1(...) RETURNS text` — RPC additiva service-role-only. Serializza lo stesso timestamp con advisory lock, richiama `get_slot_disponibili` e inserisce l'appuntamento nella stessa transazione. Non modifica la RPC legacy né la tabella condivisa.

### Viste
- `vw_elenco_chiamate_unificate`, `vw_rilavorazione_ricontatti_unificata` — UNION standard + outbound
- `view_vendita_dashboard_giornaliera` / `_mensile` — aggregati `vendita_contratti`
- `storico_cliente` — **dal 2026-06-20 estesa con 4 UNION CC** (totale 12): tipi `ordine_smartphone`, `dispositivo_comodato`, `rimborso`, `apri_chiudi_vecchio`/`_nuovo`, `switch_sim_attuale`/`_rientro`, `contratto_vendita`, + nuovi `chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`. Schema invariato (`anagrafica_id`, `tipo`, `record_id`, `riferimento`, `data_op`, `stato`, `descrizione`, `operatore_nome`). Definizione in `database/024_storico_cliente_extend_call_center.sql`. La scheda cliente mostra inoltre l'esito privacy calcolato da `check-consenso-privacy` e consente di scaricare l'ultimo modulo privacy archiviato dal bucket privato `consensi-privacy`.

### RPC derivazione origine pratica (dal 2026-06-20, rilassata 2026-06-24)
- `vendita_deriva_origine(p_anagrafica_id uuid) RETURNS jsonb` — usata dal wizard Upload Contratti per pre-compilare `origine_pratica`. Output: `{origine_pratica, evento_tipo, evento_id, descrizione}`. Priorità:
  1. **Appuntamento confermato non gestito** (presentato IS NULL OR 'si') per anagrafica, con `data_ora` tra oggi e oggi+30gg → `appuntamento_callcenter`. Include sia "oggi" sia "cliente arrivato in anticipo per appuntamento futuro" (la descrizione lo segnala)
  2. **Chiamata** `passa_in_negozio`/`passa_a_cerea` per anagrafica negli ultimi 10gg, con `passaggio_stato <> 'chiuso'` (quindi `in_attesa` o `passato`) → `contatto_callcenter_entro_10_giorni`. Rilassato per coprire il caso in cui l'operatore CC non ha ancora cliccato "Presentato" in Rilavorazione ma il cliente è già passato
  3. Default → `spontaneo`
  - Migration 026 (versione iniziale) + 027 (rilassamento + trigger auto-chiusura)

### Auto-chiusura eventi CC su nuova pratica (dal 2026-06-24, fix B1)
**ATTENZIONE**: il vecchio trigger DB `trg_vendita_pratica_auto_chiudi_cc` è stato **DROPPATO** in migration 028. Motivo: scattava su INSERT pratica PRIMA della creazione contratti, lasciando appuntamenti annullati orfani in caso di rollback. La logica è stata spostata nel backend Netlify per essere eseguita solo dopo successo completo.

- **RPC** `vendita_chiudi_eventi_cc_per_pratica(p_anagrafica_id uuid, p_pratica_id uuid) RETURNS jsonb` — chiamata dall'action `finalize` di `crea-vendita-pratica-carrello.js` solo DOPO che pratica, contratti, PDA e tutti i documenti restanti sono stati caricati. Prima la pratica resta `stato_pratica='bozza'`; un upload fallito attiva `rollback_upload_failure` senza toccare gli eventi CC. Ritorna `{appuntamenti_annullati, chiamate_chiuse, skipped}`. Best-effort: un errore RPC diventa warning ma non annulla la pratica finalizzata.
- Logica identica al vecchio trigger:
  - **Annulla** `appuntamenti` con `stato='confermato'` AND `presentato IS NULL` AND `data_ora >= ieri` → `stato='annullato'` + `motivo_modifica='Chiuso automaticamente: cliente passato in anticipo, pratica vendita <uuid>'`. Lascia stare `presentato='si'` (vanno esitati in "Esiti Appuntamenti") e `presentato='no'` (restano per "Rilavorazione → Non Presentati")
  - **Chiude** `chiamate` con `rilavorazione_stato='da_lavorare'` OR `passaggio_stato='in_attesa'` → `rilavorazione_stato='completato'` + `passaggio_stato='chiuso'` (solo se era `'in_attesa'`)
  - Anti-rollback safety: verifica che la pratica esista davvero prima di operare
- Migration: `database/027` (introduce funzione + trigger originale) + `database/028` (rimuove trigger, mantiene funzione + nuova variante con pratica_id)

### Indici performance RPC (dal 2026-06-24)
- `idx_appuntamenti_anagrafica_stato_data` — `(anagrafica_id, stato, data_ora) WHERE anagrafica_id IS NOT NULL` — usato da `vendita_deriva_origine` livello 1
- `idx_chiamate_anagrafica_esito_data` — `(anagrafica_id, esito, data_ora DESC) WHERE anagrafica_id IS NOT NULL` — usato da `vendita_deriva_origine` livello 2
- `idx_chiamate_anagrafica_rilavorazione` — `(anagrafica_id) WHERE anagrafica_id IS NOT NULL AND (rilavorazione_stato='da_lavorare' OR passaggio_stato='in_attesa')` — usato da `vendita_chiudi_eventi_cc_per_pratica`

### Wizard: pass-through evento origine al backend
Il wizard Upload Contratti, al submit, passa `pratica.appuntamento_id` e `pratica.chiamata_id` valorizzati con `runtimeState.origineAutoRilevata.evento_id` (solo se l'operatore non ha overridato l'origine auto-rilevata). Le colonne FK su `vendita_pratiche` esistono già da schema legacy e vengono ora effettivamente riempite per il flusso CC.

### Trigger auto-link anagrafica (dal 2026-06-20)
- `trg_chiamate_auto_link_anagrafica` — `BEFORE INSERT OR UPDATE OF cf_piva ON chiamate`: se `anagrafica_id` NULL e `cf_piva` non vuoto, fa lookup su `anagrafica` (UPPER+TRIM match) e popola `anagrafica_id`. Non sovrascrive mai un valore esplicito
- `trg_appuntamenti_auto_link_anagrafica` — stessa logica su `appuntamenti.codice_fiscale`
- Backfill già eseguito su 872 chiamate e 9 appuntamenti orfani: ora il 100% delle chiamate e il 99.2% degli appuntamenti hanno `anagrafica_id`. Definizione in `database/025_chiamate_appuntamenti_anagrafica_autolink.sql`

### Storage buckets

Dal 2026-06-24 (migration `029`) i bucket dati clienti sono **PRIVATI**. Lettura solo via **signed URL** generato lato client con `MiroxStorage.signedUrl(bucket, path)` o `MiroxStorage.openAttachment(bucket, path)` (scadenza default 5 min).

| Bucket | Public | Contenuto |
|---|---|---|
| `contratti-vendita` | privato | PDF dei contratti vendita + documenti identità clienti |
| `segnalazioni-files` | privato | Allegati PDF e immagini di Segnalazioni (JPG/JPEG, PNG, GIF, WEBP, BMP, TIFF, HEIC/HEIF, AVIF; max 20 MB ciascuno) + modelli disdetta in `modelli/<tipo>/` |
| `apri-chiudi-files` | privato | PDF apri/chiudi (cartella per pratica) |
| `switch-sim-files` | privato | PDF switch SIM (cartella per pratica) |
| `comodato-files` | privato | PDF moduli consegna/riconsegna comodato |
| `rimborsi-files` | privato | PDF moduli gestione rimborsi |
| `protecta-files` | privato | PDF preventivi simulatore Protecta |
| `consensi-privacy` | privato | PDF informativa GDPR firmati (OTP o scansione cartaceo). MIME only `application/pdf`, max 20 MB. Naming cartaceo `Privacy_<RagSocSafe>_<CF>_<DD_MM_YYYY>.pdf`; i nuovi PDF OTP aggiungono `_<consenso_uuid>` prima di `.pdf`, con ulteriore suffisso casuale per collisioni. Path `<YYYY>/<MM>/`. Migration 034 |
| `moduli-template` | **pubblico** | Template modulistici (disdetta_fisso_consumer.pdf, ecc.) — generici, leggibili anche da non autenticati |

**Convenzione campi DB**: dopo migration 029 le colonne `cartella_url` / `preventivo_pdf_url` su `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_simulatore_protecta` contengono il **path** nel bucket (es. `dispositivo_X/file.pdf`), NON più un URL pubblico. I record legacy hanno ancora gli URL completi: il codice di lettura li gestisce entrambi (regex `replace` su prefisso `https://...storage/v1/object/public/<bucket>/`).

**RLS storage** (migration post-deploy `054`): i bucket privati restano leggibili da `authenticated` per signed URL/list. Le policy INSERT/UPDATE/DELETE browser sui sette bucket dati vengono rimosse; le scritture passano esclusivamente da `upload-vendita-documento`, `upload-documento-modulo` o dalle altre functions specializzate con service role. Il bucket `consensi-privacy` era già server-only. `moduli-template` resta l'unica eccezione pubblica/gestibile separatamente.

**Segnalazioni hardened al pari degli altri moduli** (migration `036` + refactor `moduli/segnalazioni.html`, 2026-07-02): storicamente il modulo segnalazioni faceva le sue chiamate come `anon` — la pagina Mirox creava un proprio client Supabase con la anon key hardcoded (`sb = createClient(URL, ANON_KEY)`), senza `js/config.js` ne' `Auth.richiediAuth`. Per non romperlo la migration 032 aveva riaperto `anon` (SELECT/INSERT/UPDATE su tabella + SELECT/INSERT su bucket). Il konahub legacy usava lo stesso trick.

Al 2026-07-02 il konahub e' stato dismesso e `moduli/segnalazioni.html` e' stata **modernizzata**: include `js/config.js` + `js/auth.js`, chiama `Auth.richiediAuth()` al boot, aliasa `const sb = window.db` (client persistSession della sessione Mirox). La migration 036 revoca le 5 policy `anon` residue; dalla migration post-deploy `054` anche gli upload authenticated passano da `upload-documento-modulo` e non esiste più una policy INSERT browser sul bucket.

Da questo momento il modulo segnalazioni funziona **solo da Mirox loggato**. Se qualcuno prova a chiamare `segnalazioni` come `anon` (konahub tornante online, client esterni) riceve RLS violation.

---

## Flusso vendita end-to-end

1. `index.html` → login Supabase + check `profili.attivo`
2. `dashboard.html` → tab Vendita → card "Upload Contratti"
3. `moduli/upload-contratti-vendita.html` → wizard **5 step** con carrello multi-contratto:
   1. **Categoria + PDA**: Mobile/Customer Base/Fisso richiedono PDF. Analizza con AI legge codice e campi anche dal secondo contratto; Continua senza AI chiede prima il codice manuale. Controllo globale e nel carrello prima di upload staging (`upload-vendita-documento`, `temp_session_id` UUID); duplicato o errore bloccano. Se il codice o il contatto firma mancano, popup manuale. Contatto della prima pratica conservato.
   2. **Anagrafica**: cf_piva (auto-detect cluster CF→Consumer, P.IVA→Business), cellulare, ragione sociale, email per Consumer/Business, ecc. Pre-compilata se l'OCR ha estratto dati. **Skippato automaticamente dal 2° contratto in poi** (anagrafica gia' nota nella pratica).
   3. **Dati contratto**: offerta/opzione/reload e campi specifici. Codice PDA visibile/correggibile; solo Mobile richiede numerazioni/portabilita e popup di conferma costo mensile base (precompilato se letto). Turista conserva defaults catalogo, mostra solo nuovi dati PDA.
   4. **Firma** (solo per categorie PDA): scelta tra `elettronica` o `cartacea`. Skippato per Energia/Allarmi/Assicurazioni. Il valore finisce in `vendita_contratti.tipo_firma`.
   5. **Documenti cliente**: documento_identita + eventuali copia_bolletta/copia_sim_mnp. Se `tipo_firma='cartacea'` appare anche il campo upload **"Contratto firmato"** (PDF della scansione del PDA firmato a mano dal cliente). **Niente upload contratto PDF originale qui** — quello e' gia' in staging dallo step 1.
   - **Regola multi-contratto**: dopo "Aggiungi un altro contratto" il wizard conserva solo anagrafica e documenti condivisi della pratica; categoria, PDA/input file/cache, stato visivo della drop-zone, firma e campi specifici vengono azzerati. Anche "Aggiungi altro contratto" dal carrello applica lo stesso reset. Non preselezionare mai categoria o PDF dal contratto precedente.
4. Submit "Invia pratica" → **prima del fetch al backend**, il wizard esegue il pre-step **consenso privacy GDPR** (vedi sezione "Sistema consensi privacy GDPR"):
   1. `POST garantisci-anagrafica` con i dati cliente → `anagrafica_id`
   2. `GET check-consenso-privacy?anagrafica_id=...` → se valido, entro 24 mesi e appartenente alle versioni informative v6 correnti, riusa `consenso_id` e procede senza modale
   3. Altrimenti popup di scelta modalità: **OTP via SMS** (Smshosting + 6 cifre + verifica server-side + PDF generato) oppure **modulo cartaceo** (download PDF precompilato + upload scansione firmata)
   4. Risultato: `consenso_id` valido, passato al backend nel campo `pratica.consenso_id`
5. → `POST /netlify/functions/crea-vendita-pratica-carrello`:
   - Upsert `anagrafica` (cerca per `cf_piva`, aggiorna campi vuoti o cambiati, cellulare incluso). Cellulare obbligatorio; email obbligatoria solo per `Consumer`/`Business` (facoltativa per `Turista`).
   - **Guard informativa privacy** (migration 034): query `vendita_consensi_privacy` per anagrafica_id con `stato='confermato'`, `informativa_versione` appartenente alle due v6 correnti, `revocato_at IS NULL` e `valido_fino_al > now()`. Se non esiste → errore 400. Se il client ha passato `pratica.consenso_id` verifica anche che corrisponda al record attivo (anti-tampering).
   - INSERT `vendita_pratiche` con `stato_pratica='bozza'`; `operatore_id` deriva dal profilo autenticato e il valore client viene ignorato
   - Back-link: se il consenso non aveva `pratica_id` (caso "appena raccolto"), aggiorna il record con la nuova pratica creata. Se aveva già `pratica_id` (caso riuso in dedupe 24 mesi) lascia il riferimento originale come audit.
   - Calcolo `nome_cartella_storage` = `Contratto_<RAGSOC>_<DD_MM_YYYY>_<id6>`
   - INSERT N × `vendita_contratti` con snapshot categoria/offerta/opzione/reload + punteggi calcolati server-side
   - **Promozione PDA**: per ogni contratto con `pda_temp_path`, sposta il file da `temp/<sess>/` a `<cartella>/contratto_<categoria>.pdf` e crea il record `vendita_documenti` (tipo `contratto`). Dalla seconda occorrenza della stessa categoria usa il suffisso progressivo `_2`, `_3`, ecc.
   - Rollback pratica + documenti Storage se anche un solo contratto o la promozione PDA falliscono
6. Upload PDF restanti (identita/bolletta/SIM) → `POST /netlify/functions/upload-vendita-documento` (multipart):
   - Verifica firma PDF e coerenza `pratica_id`/`anagrafica_id`/`contratto_id`; path e `uploaded_by` sono derivati server-side
   - Upload su bucket `contratti-vendita` in `<YYYY>/<MM>/<cartella_safe>/`
   - INSERT `vendita_documenti`
   - Rollback file su Storage se INSERT DB fallisce
   - Al termine action `finalize`: pratica `bozza` → `inviata` + auto-chiusura eventi CC
   - Se un upload fallisce action `rollback_upload_failure`: elimina pratica incompleta e file già caricati, evitando duplicati al nuovo tentativo
7. Verifica contratto in `moduli/verifica_contratti.html` → `gestisci-vendita-contratto` action `update`, mode `verify`, che imposta server-side `stato_controllo='controllato'`, `controllato_da` dal JWT e gli snapshot/punteggi catalogo. Le tab "Da Verificare" e "Verificati" hanno ricerca, filtro categoria e filtro `Giorno` su `vendita_contratti.data_contratto` (data Europe/Rome). Il popup di conferma per i contratti Fisso/Energia evidenzia il passaggio rispettivamente al modulo Controllo Fissi / Controllo L&G. Per categoria Fisso, nella sezione "Campi specifici categoria" sono visibili `prezzo_fisso` e `convergenza` (valori ammessi da migration 017), editabili nella tab "Da Verificare" e read-only nella tab "Verificati". Per categoria Energia, sono obbligatori in fase di verifica `numero_contratto_energia` E `ex_fornitore` (entrambi compilati nella sezione "Campi specifici categoria" del popup verifica). Il popup (solo tab "Da Verificare", editabile) contiene una sezione "Inserimento pratica" con **Data di upload** (`vendita_contratti.data_contratto`, input `datetime-local` in ora Europe/Rome) e **Operatore inserimento** (`vendita_contratti.operatore_id`, dropdown dei `profili` attivi) modificabili — salvati sia da "Salva modifica" sia da "Conferma verifica". Nella tab "Verificati" sono read-only. Dal 2026-07-02 il popup contiene anche "Elimina definitivamente": visibile a tutti, disabilitato per operatori, attivo solo per admin e collegato alla function `elimina-vendita-contratto`. La pagina accetta il deep-link `?contratto_id=<uuid>`: dopo aver caricato entrambe le liste valida l'UUID, rileva lo stato corrente, seleziona `Da Verificare` o `Verificati` e apre direttamente il popup del contratto.
8. Post-vendita Fisso: il trigger `trg_vendita_contratti_to_controllo_fissi` crea automaticamente una riga in `post_vendita_controllo_fissi` con stato `Da completare`. L'operatore compila i 4 campi obbligatori (Cod. Cliente, Tecnologia, Cod. Contratto, Cod. POS) in `moduli/controllo_fissi.html` → click "Compilazione Completata" → stato `In Attivazione`. Poi via dropdown stato → `Attivo` (con data attivazione effettiva obbligatoria) oppure `KO` (azzera `attivazione_prevista`). Solo gli admin possono ripristinare una riga `Attivo` o `KO` a `In Attivazione`: il pulsante "Rimetti in attivazione" compare accanto allo stato nel popup, dopo l'inizializzazione del profilo, e apre una conferma; il backend ricontrolla ruolo e stato, azzera `data_attivazione` e rimuove `motivo_ko`.
9. Post-vendita Energia (L&G): il trigger `trg_vendita_contratti_to_controllo_lg` crea automaticamente una riga in `post_vendita_controllo_lg`. La pagina `moduli/controllo_lg.html` mostra tutti i dati incolonnati in tabella (nessun popup dettagli, nessuno step di completamento): Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contratto, POD/PDR, Ex Fornitore, Contatto (cellulare), Operatore, Stato.
10. Post-vendita Assicurazioni: il trigger `trg_vendita_contratti_to_controllo_assicurazioni` crea automaticamente una riga in `post_vendita_controllo_assicurazioni`. La pagina `moduli/controllo_assicurazioni.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Metodo di pagamento (RID/Carta di Credito/Carta di Debito), Ricorrenza (Mensile/Annuale).
11. Post-vendita Allarmi: il trigger `trg_vendita_contratti_to_controllo_allarmi` crea automaticamente una riga in `post_vendita_controllo_allarmi`. La pagina `moduli/controllo_allarmi.html` mostra in tabella: Data Inserimento, Ragione Sociale, CF/PIVA, Numero Contatto, Offerta scelta, Operatore, Modalità di pagamento (Finanziamento/Anticipo).

Le pagine post-vendita dei punti 8–11 espongono `Vai alla pratica` per ogni riga e propagano `vendita_contratti.id` al deep-link di Verifica Contratti. Usare sempre l'ID contratto, non `pratica_id`, perché una pratica può contenere più contratti.

---

## Regole di business chiave

### CF/PIVA → Cluster
- CF italiano (16 char, regex con caratteri omocodia) → `Consumer`
- P.IVA (11 cifre + Luhn IT) → `Business`
- Nessuno dei due → errore "verifica il dato" (no fallback)
- `Turista` → forza `categoria=Mobile`, `offerta="Untied - Call Your Country"` e non richiede opzione nel wizard. Accettato da `garantisci-anagrafica.js` e `crea-vendita-pratica-carrello.js`: nei contratti/pratica resta `Turista`, mentre in `anagrafica.cluster` viene scritto `Consumer`.

### Campi anagrafici obbligatori
Sia UI (`validateClienteData` in `upload-contratti-vendita.html`) sia backend (`crea-vendita-pratica-carrello.js`) **bloccano** la pratica se uno qualsiasi di questi campi e' vuoto o malformato:
- `cf_piva`, `cluster`, `ragione_sociale` (sempre obbligatori)
- `nome_referente`
- `cellulare`
- `email` (obbligatoria e verificata con regex per `Consumer`/`Business`; per `Turista` il wizard la nasconde e la invia `null`)
- `provincia`, `comune`, `via`, `civico` (indirizzo completo obbligatorio per `Consumer`/`Business`; per `Turista` il wizard nasconde i campi e li invia `null`)

L'email viene normalizzata in lowercase quando presente.

### OCR sovrascrive sempre i dati anagrafici esistenti
Quando l'utente carica un PDA + sceglie "Analizza con AI", i dati estratti dall'OCR **sovrascrivono sempre** i valori dei campi del form, anche se l'anagrafica esiste gia' a DB con valori precedenti. Razionale: il PDA appena firmato e' la fonte di verita' piu' recente, l'anagrafica e' "always fresh".
- Implementazione: `applyOcrToAnagrafica` overwrite incondizionato + salva `runtimeState.lastOcrData`.
- Se l'utente clicca "Cerca cliente" dopo l'OCR, il risultato DB viene comunque sovrascritto da `lastOcrData` (re-applied in `cercaCliente`).
- `lastOcrData` viene azzerato quando si reset il form contratto (nuovo contratto nello stesso carrello).

### Categorie ammesse al flusso PDA
- Costante `CATEGORIE_PDA = ['Mobile', 'Customer Base', 'Fisso']`.
- Per queste 3 categorie il PDA (contratto PDF) e' obbligatorio e viene caricato allo step 1 del wizard in staging (`temp/<temp_session_id>/pda_<rand>.pdf`); poi promosso a `<cartella_pratica>/contratto_<categoria>.pdf` al submit. Più contratti della stessa categoria usano nomi progressivi (`contratto_<categoria>_2.pdf`, `_3.pdf`, ecc.).
- Per `Energia`, `Allarmi`, `Assicurazioni`: NESSUN PDA, NESSUN documento "contratto" (resta solo `documento_identita` + eventuali bolletta/SIM).
- L'OCR del PDA e' opzionale: il bottone "Continua senza AI" salta la chiamata a Claude API ma carica comunque il file in staging.

### Step Firma (solo categorie PDA)
- Solo per Mobile / Customer Base / Fisso il wizard chiede tra step Contratto e step Documenti la modalita' di firma: `elettronica` o `cartacea`. Il valore finisce in `vendita_contratti.tipo_firma` (vincolato dal CHECK constraint).
- `elettronica`: nessun upload aggiuntivo. Il PDA originale gia' in staging diventa l'unico `contratto.pdf` in cartella pratica.
- `cartacea`: nello step Documenti compare un upload "Contratto firmato" obbligatorio. Il file viene caricato a parte tramite `/upload-vendita-documento` con `tipo_documento='contratto_firmato'` e salvato come `<cartella_pratica>/contratto_firmato_<categoria>.pdf` (affianca il PDA originale); anche questo nome diventa progressivo quando la categoria ricorre più volte.
- Per Energia/Allarmi/Assicurazioni lo step Firma e' saltato e `tipo_firma` resta NULL nel DB.

### Punteggi (anti-tampering)
- **Creazione contratto**: il frontend NON manda i punteggi. Il backend `crea-vendita-pratica-carrello.js` li legge dal catalogo (`vendita_offerte.punteggio_gara/punteggio_extra_gara` + `vendita_opzioni.punteggio_gara/punteggio_extra_gara`) e li scrive come **snapshot** nelle 4 colonne `vendita_contratti.punteggio_gara_offerta`, `punteggio_extra_gara_offerta`, `punteggio_gara_opzione`, `punteggio_extra_gara_opzione`.
- **Guardie pre/post INSERT (dal 2026-07-26)**: il backend fa una seconda query indipendente sul catalogo, rifiuta tutti e quattro i componenti nulli/vuoti/non numerici tramite `_lib/score-integrity.js`, quindi confronta i componenti e i totali della riga realmente restituita dal DB con quelli attesi. Una divergenza fa fallire la creazione e attiva il rollback della pratica ancora in bozza.
- **Modifica contratto in Verifica Contratti**: il client non invia mai campi punteggio e il backend li deriva dal catalogo **solo se `offerta_id` o `opzione_id` cambiano**. Senza cambio conserva i quattro componenti già presenti; con cambio rifiuta cataloghi nulli/non numerici. Dopo l'UPDATE verifica componenti, totali e colonne legacy della riga restituita.
- **Bug 25/07/2026** (fixato): la SELECT di `caricaContratti()` in `verifica_contratti.html` NON caricava i 4 campi `punteggio_gara_offerta` / `punteggio_extra_gara_offerta` / `punteggio_gara_opzione` / `punteggio_extra_gara_opzione`. Quindi `c.punteggio_gara_offerta = undefined`, `numOr(undefined, 0) = 0`, e ogni "Conferma verifica" senza cambio offerta **sovrascriveva a 0** gli snapshot corretti. Impatto: 25+ contratti luglio azzerati (poi rifixati manualmente via UPDATE SQL da catalogo). Fix: omettere del tutto i 4 campi dal patch UPDATE se offerta/opzione non sono state cambiate. Il trigger DB ricalcola i totali dai valori NEW (che sono i valori DB attuali se non passati).
- **Prima del 2026-07-20**: il popup di Verifica Contratti aggiornava solo `opzione_id` / `offerta_id` senza toccare i punteggi. Se un operatore aggiungeva un'opzione a un contratto esistente, `punteggio_gara_opzione` restava a 0 e la Gara Individuale non contava il punto. Bug fixato dal 2026-07-20 (che ha introdotto il bug 25/07/2026, fixato definitivamente col patch selettivo sopra).
- **Trigger** `vendita_calcola_punteggio_totale` (BEFORE INSERT/UPDATE): somma i 4 punteggi (offerta + opzione) e li scrive nelle colonne totale (`punteggio_gara_totale`, `punteggio_extra_gara_totale`). NON legge dal catalogo — si limita a sommare i valori già presenti in NEW.
- **Vincoli e audit DB** (migration `058`): tre CHECK validati impediscono la persistenza di totali gara/extra o colonne legacy incoerenti. Il trigger AFTER `trg_vendita_contratti_audit_punteggi` registra da ora ogni INSERT e ogni variazione dei quattro componenti in `vendita_log_modifiche`.
- **Bonus Assicurazione Annuale**: vale 0,5 ed è parte dello snapshot `punteggio_gara_opzione`, non del catalogo opzioni. La configurazione è letta in modalità fail-closed: se manca o non è numerica la creazione/modifica interessata viene bloccata, mai degradata silenziosamente a zero.
- **Audit production 26/07/2026**: 247 contratti di luglio, tutti controllati; zero incoerenze strutturali e zero cataloghi mancanti. Gli 8 contratti con totale 0 sono legittimi: 7 `Sim Convergente *INTERNA*` e 1 `CB Caring - MOBILE`, tutte offerte con punteggio catalogo 0. L'analisi della regola bonus ha trovato 3 Assicurazioni Annuali create dopo l'attivazione del bonus ma poi riallineate al solo catalogo base dal vecchio fix: migration `060` le ha corrette da 1,5 a 2,0 punti totali. Altri 7 Mobile avevano correttamente 1 punto opzione ma `opzione_id`/nome persi: tutti i PDA indicano Iliad Italia e migration `061` ha ripristinato i metadati senza cambiare il punteggio.

### Validazioni categoria-specifiche (in `crea-vendita-pratica-carrello.js → validateCategorySpecificRules`)
- **Fisso**: `tipo_attivazione` IN ('Nuova Attivazione','Portabilita'); `apri_chiudi` Si/No; se Sì → `intestatario` IN ('Stesso intestatario','Intestatario diverso'). Al passaggio step 2 → step Firma il wizard apre un popup che richiede 2 campi obbligatori: `prezzo_fisso` (numerico >= 0) e `convergenza` IN ('Mobile','L&G','Allarme','Assicurazione','Sim Interna','NO Convergenza','Coupon','Seconda Casa'). La `convergenza` è enforced anche a livello DB con CHECK constraint (vedi migration 017 + 048 che aggiunge 'Seconda Casa').
- **Allarmi**: `modalita_pagamento` IN ('Finanziamento','Anticipo')
- **Fisso FWA Indoor** (offerta nome contiene "fwa" + "indoor", case-insensitive): logica speciale dal 2026-06-27. `dispositivo_associato` è **forzato a Si e non modificabile** (il modem c'è sempre). `tipo_acquisto` è **forzato a 'VAR' e non modificabile** (modem sempre a rate, mai finanziamento). Mostra solo IMEI, Prezzo Device, Tipo Acquisto (locked VAR). **Nasconde** Kolme + Smartphone Reload + modalita + Finanziaria (non rilevanti per il modem FWA). OCR estrae `imei` da "Seriale/IMEI:" o "SERIALE MODEM" + `prezzo_device` da "prezzo pari a X,XX euro" o "cede l'importo di X,XX euro" (virgola → punto). `tipo_acquisto` e `smartphone_reload` restano null nell'OCR, il client/server forzano `tipo_acquisto='VAR'`. Backend `crea-vendita-pratica-carrello.js` forza server-side `tipo_acquisto='VAR'`, `finanziaria=null`, `kolme=null`, `smartphone_reload=null`, `smartphone_reload_modalita=null` per offerte FWA Indoor (safety net contro client legacy).
- **Dispositivo** (solo se `vendita_offerte.abilita_dispositivo=true` E `dispositivo_associato=true`):
  - `imei` regex `^\d{15}$`
  - `fascia_prezzo` obbligatoria. Dal 2026-06-26 **non è più una dropdown a range** (`0-249`/`250-599`/...) ma un **input testo numerico libero** che contiene il **prezzo puntuale del device in euro** (es. `399.90`, `1509.90`). Auto-compilato dall'OCR del PDA (campo `Prezzo device: X.XX euro`). Validazione wizard: regex `^\d+(\.\d{1,2})?$` (virgola viene normalizzata a punto). Colonna DB `vendita_contratti.fascia_prezzo` è già `text`, nessuna migration. Il nome del campo a DB è mantenuto per compatibilità storica/dashboard pezzi; semanticamente ora è "prezzo device"
  - `tipo_acquisto` IN ('VAR','Finanziamento'); se Finanziamento → `finanziaria` IN ('Findomestic','Compass'). Auto-compilato dall'OCR (riconoscimento via 3 segnali concordi titolo+sezione+riga SIM del PDA WindTre). `finanziaria` resta manuale (non presente nel PDA)
  - `kolme` boolean obbligatorio. Resta manuale (non presente nel PDA)
- **Energia**: campo `pod_pdr` raccolto nel wizard. `numero_contratto_energia` e `ex_fornitore` (text libero) sono predisposti vuoti dal wizard e diventano **obbligatori in fase di verifica** (`moduli/verifica_contratti.html` → `confermaVerifica` valida entrambi prima del passaggio a `stato_controllo='controllato'`).
- **Assicurazioni**: `modalita_pagamento_assicurazione` IN ('RID','Carta di Credito','Carta di Debito') e `ricorrenza_assicurazione` IN ('Mensile','Annuale'), entrambi obbligatori (CHECK DB su migration 021). Sono colonne separate dal `modalita_pagamento` di Allarmi. **Bonus Annuale** (migration `049`): se `ricorrenza_assicurazione='Annuale'`, il backend `crea-vendita-pratica-carrello.js` somma il valore di `impostazioni['bonus_assicurazione_annuale']` (default `0.5`) al `punteggio_gara_opzione` alla creazione del contratto. Valore snapshot alla creazione, i contratti storici NON vengono ricalcolati se l'admin cambia il bonus. Editabile da Admin → Configurazione Vendita (sezione "Bonus Assicurazione Annuale").
- **Mobile / Customer Base**: 2 checkbox `reload_exchange` + `reload_forever` (migration `035`). Entrambi boolean NOT NULL DEFAULT false. Allineati esteticamente sotto la dropdown Offerta nel wizard, visibili solo per Mobile/Customer Base. Catalogo `vendita_reload` non più gestito (vedi "Note operative consapevoli").

### Codice rivenditore (dal 2026-07-18, migration `050`)
Ogni contratto è etichettato col punto vendita di **inserimento**: `9001415852` = Legnago (negozio principale, dove gira Mirox), `9000822241` = Cerea (piccolo negozio, senza gestionale locale). Un contratto acquisito a Legnago può poi essere spostato amministrativamente su Cerea, ma resta contabilizzato al negozio di **inserimento**.

- Dal27/10 su richiesta proprietario, campo nascosto e fisso9001415852 per tutte le nuove pratiche, senza variazioni da OCR o input precedenti
- Carrello, draft e payload conservano il valore Legnago; il backend create lo forza anche per client/bozze precedenti. Nessuna riscrittura dei contratti storici
- OCR puo' ancora leggere il Codice POS dal documento, ma tale dato non cambia il rivenditore del nuovo inserimento
- **Editabile in Verifica Contratti** (tab "Da Verificare", sezione "Inserimento pratica" accanto a Data upload + Operatore). Read-only nella tab "Verificati"
- **Dashboard Pezzi** (`moduli/dashboard_pezzi.html`, costante `CODICE_LEGNAGO`):
  - **Day by Day** → filtro `.codice_rivenditore === '9001415852'` sui contratti caricati (Cerea escluso)
  - **Avanzamento Mensile** → motore `MiroxDashboardReport.monthlyRows` con perimetro `inMonthlyScope`: Legnago per tutte le righe, FISSI Standard anche Cerea dal 08/10/2026. Caricamento FTTC e operatori canonici condividono il perimetro; operatori con soli Fissi Cerea inclusi.
  - **Gare Individuali** → nessun filtro (usa `contrattiMatchPerOperatore` / `contrattiMatchTotali` originali). Ogni operatore vede la produzione totale personale a prescindere dal punto vendita di inserimento
- Backfill contratti storici pre-migration: implicito col DEFAULT SQL `'9001415852'` (tutti 1835 contratti Legnago).
- **Smartphone Reload** (solo se `dispositivo_associato=true`, migration `035`): risposta alla riga "È stata richiesta l'attivazione contestuale dell'opzione SMARTPHONE RELOAD SI [X] NO [X]" del PDA WindTre. `smartphone_reload` boolean NULL (true=Si, false=No, NULL=non specificato). Auto-compilato dall'OCR. Se `smartphone_reload=true` allora `smartphone_reload_modalita` text NOT NULL CHECK IN ('Mantenere attivo','Disattivazione cliente') — **manuale operatore** (non estraibile dal PDA). CHECK DB di coerenza: modalita IS NULL ⇔ smartphone_reload IS NOT TRUE.

### Origine pratica (CHECK constraint su `vendita_pratiche`)
`appuntamento_callcenter`, `contatto_callcenter_entro_10_giorni`, `spontaneo`

### Consenso privacy GDPR (dal 2026-06-26, migration 034)
- Ogni pratica creata da Upload Contratti richiede una dichiarazione privacy valida in `vendita_consensi_privacy` per l'`anagrafica_id`. Il backend `crea-vendita-pratica-carrello.js` richiede `stato='confermato'`, una delle due versioni informative v6 correnti, scadenza futura e nessuna revoca.
- Il wizard `upload-contratti-vendita.html` intercetta il submit `btnInviaPratica` e, prima di POST al carrello, fa il pre-step:
  1. `garantisci-anagrafica` → ottiene `anagrafica_id` (upsert)
  2. `check-consenso-privacy?anagrafica_id=...` → **dedupe 24 mesi + versioni v6 correnti**: se valido, salta tutto e propaga `consenso_id` al carrello
  3. Altrimenti modale 2 scelte (`OTP via SMS` consigliato, `cartaceo` fallback)
- Validità massima: 24 mesi dalla conferma, calcolata nelle due functions con `addMonthsClamped`. La migration `055` accorcia anche i record storici che superano tale termine.
- Backend valida `consenso_id` opzionalmente passato dal client come **anti-tampering**: deve corrispondere al consenso attivo per quell'anagrafica.
- `consenso_contratto` rappresenta la presa visione dell'informativa, non la base giuridica del contratto. `consenso_marketing` è facoltativo, separato e revocabile per canale; è però obbligatorio esprimere esplicitamente una delle due scelte ACCONSENTO/NON ACCONSENTO prima del download cartaceo o dell'invio OTP.

### Reinserimento contratti (dal 2026-06-25, migration 033)
Quando una pratica va in KO post-vendita (o `Rifiutata`/`Annullata`/`In lavorazione` per Energia) e viene ricaricata come pratica nuova dopo qualche giorno, la dashboard mensile dei pezzi rischierebbe il **doppio conteggio** (KO + reinserita = 2 pezzi quando è 1 sola vendita). Per evitarlo:

**Schema** (migration 033 su `vendita_contratti`):
- `stato_inserimento` text NOT NULL DEFAULT `'inserimento'` CHECK IN (`'inserimento'`,`'reinserimento'`)
- `reinserimento_di_contratto_id` uuid NULL REFERENCES `vendita_contratti(id)` ON DELETE SET NULL
- CHECK di coerenza: `'reinserimento'` ⇒ FK NOT NULL; `'inserimento'` ⇒ FK IS NULL
- Indice composto `(anagrafica_id, categoria_id, data_contratto DESC)` per il lookup; indice parziale su `reinserimento_di_contratto_id` per il drill-down inverso

**Flusso wizard** (`upload-contratti-vendita.html`):
1. All'apertura dello **step 3 (Dati contratto)** il wizard chiama `checkReinserimento(anagrafica_id, categoria_id, categoria_nome)` se la coppia (anagrafica, categoria) non è già stata verificata in sessione (`runtimeState.lastReinsCheckKey`)
2. La funzione fa due query: prima recupera i contratti `vendita_contratti` del cliente per quella categoria nel **mese solare corrente** (timezone Europe/Rome, estremi calcolati con offset distinti per gestire correttamente i cambi ora legale di marzo/ottobre, `data_contratto >= inizio_mese AND < inizio_mese_successivo`, `stato_inserimento='inserimento'`, esclude catene), poi recupera dalla tabella post-vendita appropriata gli stati che fanno scattare il popup. Un contratto del mese precedente è sempre un inserimento nuovo
3. Mapping categoria → tabella → stati trigger:
   - **Fisso** → `post_vendita_controllo_fissi.stato` IN (`KO`,`In Attivazione`)
   - **Energia** → `post_vendita_controllo_lg.stato` IN (`Rifiutato`,`Annullato`,`Nuovo`,`In lavorazione`,`In attivazione`) (tutto tranne `Attivato`/NULL)
   - **Allarmi** → `post_vendita_controllo_allarmi.stato` IN (`KO`,`In Attivazione`)
   - **Assicurazioni** → `post_vendita_controllo_assicurazioni.stato` = `KO`
   - Mobile / Customer Base → no check (nessuna tabella post-vendita)
4. Se ≥1 candidato → popup modale (riusa `loadingOverlay`) con elenco (radio: data, offerta, eventuali numero contratto/POD, stato post-vendita) + 2 bottoni `Sì, è un reinserimento` / `No, è un inserimento nuovo`
5. La scelta finisce in `runtimeState.pendingReinserimento` (`{contratto_id, descrizione}` o `null`), poi nel draft del carrello (`stato_inserimento`, `reinserimento_di_contratto_id`)
6. In carrello: chip arancione **Reinserimento** se `stato_inserimento='reinserimento'`. Il popup non si rimostra per la stessa coppia (anagrafica, categoria); reset alla prossima `resetContractFields()` (multi-contratto: l'utente può aggiungere un secondo contratto Fisso dello stesso cliente che viene ri-chiesto)

**Backend** (`crea-vendita-pratica-carrello.js`):
- Default `stato_inserimento='inserimento'` se non passato; CHECK enum
- Se `'reinserimento'`: valida `reinserimento_di_contratto_id` come UUID, verifica **stessa anagrafica**, **stessa categoria**, **stesso mese solare Europe/Rome** e ricontrolla lo stato ammesso nella tabella post-vendita pertinente (errori 400 altrimenti)
- Se `'inserimento'`: forza `reinserimento_di_contratto_id=null` (idempotente)

**Dashboard**: i contratti con `stato_inserimento='reinserimento'` sono esclusi dal conteggio sia nel **Day by Day** (`caricaDay` → `DPState.contrattiDay` filtrato in `moduli/dashboard_pezzi.html`) sia nel **mensile** (`caricaDatiMensili` → `DPState.contrattiMese`). Metrica derivata "tasso di rilavorazione = reinserimenti / inserimenti totali" ancora da implementare come bonus.

### Controllo Fissi (post-vendita)
- Tabella: `post_vendita_controllo_fissi` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_fissi`: alla conferma verifica di un contratto Fisso (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_fissi` con stato `Da completare`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Stati ammessi** (CHECK `pvcf_stato_chk`): `Da completare`, `In Attivazione`, `Attivo`, `KO`. Transizioni: `Da completare` → `In Attivazione` (via bottone "Compilazione Completata") → `Attivo` (richiede `data_attivazione` effettiva) | `KO` (azzera `attivazione_prevista`, opzionale `motivo_ko`). `KO` è normalmente terminale, ma un admin può correggere un esito inserito per errore e riportare sia `KO` sia `Attivo` a `In Attivazione` dopo conferma esplicita. Il ripristino aggiorna l'audit, azzera `data_attivazione` e rimuove `motivo_ko`.
- **Campi obbligatori** per "Compilazione Completata" (validati lato UI in `moduli/controllo_fissi.html`): `codice_cliente`, `tecnologia`, `cod_contratto`, `cod_pos`. `numero_fisso` e `attivazione_prevista` opzionali.
- **Tecnologia** (CHECK `pvcf_tecnologia_chk`): `FTTC`, `FWA OUT`, `FWA IN`, `FWA VOCE`, `FTTH_OF`, `FTTH_FWCOP`.
- **Cod. POS** (CHECK `pvcf_cod_pos_chk`): `9001415852` (Legnago), `9000822241` (Cerea). Il codice Cerea era stato inserito troncato a 9 cifre (`900822241`) fino alla migration `050`, che ha ricreato il CHECK con il valore corretto. Lo stesso valore è quello del **Codice Rivenditore** su `vendita_contratti` (vedi sezione "Codice rivenditore").
- **Chat note**: array JSONB `storico_chat = [{timestamp, message, autore}]` — stesso pattern di `segnalazioni.storico_chat`.
- **UI a 2 tab**: `Da Completare` (pratiche aperte) + `Elenco Contratti` (vista unificata In Attivazione / Attivo / KO). La tab Elenco ha 3 filtri dropdown (Cluster, Tecnologia, Stato) e una search; la search è mutuamente esclusiva coi filtri (digitando si svuotano i dropdown, cambiando un filtro si svuota la search). Default all'apertura della tab Elenco: filtro Stato = `In Attivazione`. Tre stat-card live sopra la tabella: `In Attivazione` (totale aperti), `Attivati nel mese` (`stato=Attivo` AND `data_attivazione` nel mese corrente), `KO nel mese` (`stato=KO` AND `stato_cambiato_at` nel mese corrente).

### Controllo L&G (post-vendita Energia)
- Tabella: `post_vendita_controllo_lg` (vedi Mappa Supabase → Post-Vendita).
- **Trigger automatico** `trg_vendita_contratti_to_controllo_lg`: alla conferma verifica di un contratto Energia (UPDATE `vendita_contratti.stato_controllo` da `da_controllare` a `controllato`) viene creata una riga in `post_vendita_controllo_lg`. Idempotente grazie a UNIQUE su `contratto_id`.
- **Campi colonna** (UI `moduli/controllo_lg.html`, tabella diretta senza popup dettagli): Data Inserimento (`vendita_contratti.data_contratto`), Ragione Sociale, CF/PIVA, Numero Contratto (`vendita_contratti.numero_contratto_energia`, compilato in verifica), POD/PDR (`vendita_contratti.pod_pdr`), Ex Fornitore (`vendita_contratti.ex_fornitore`, compilato in verifica), Contatto (`anagrafica.cellulare`), Operatore (`profili.nome` via `vendita_contratti.operatore_id`), Stato (`post_vendita_controllo_lg.stato`). L'elenco e' ordinato sulla stessa Data Inserimento mostrata, dalla pratica piu' recente alla piu' datata; usa come fallback `vendita_contratti.created_at` e poi la data della riga L&G.
- **Filtri elenco**: Cluster, Operatore, Stato, Mese e Anno sono combinabili; il filtro Operatore e' popolato soltanto con i profili effettivamente presenti nei contratti caricati. La ricerca testuale resta mutuamente esclusiva con tutti i filtri e li azzera quando viene digitata.
- **`stato`**: text NULLABLE senza CHECK constraint (l'utente vuole flessibilita' nel caso il portale WindTre aggiunga stati nuovi). UI mostra "—" se NULL. Pillola colorata in base al valore (Attivato verde, Rifiutato rosso, ecc.).
- **Upload CSV WindTre** (bottone "📥 Carica CSV WindTre" nella tab Elenco):
  - Parser via PapaParse (CDN), separatore `;`, header riga 1.
  - **Match primario composito**: `Proposta di Contratto` + POD/PDR (CSV) ↔ `vendita_contratti.numero_contratto_energia` + `vendita_contratti.pod_pdr`. Gli header punto riconosciuti coprono sia una colonna combinata (`POD/PDR`, `POD o PDR`, `Codice POD/PDR`, `Punto di fornitura`) sia colonne separate `POD`/`PDR` e relative varianti `Codice`/`Numero`. PC uguali con punti differenti restano record indipendenti e aggiornano ciascun contatore.
  - **Fallback storico sicuro**: se il CSV non espone il POD/PDR, il match per sola PC e' ammesso esclusivamente quando quella PC identifica una sola riga Mirox. Una PC multipla senza punto, un punto CSV non presente tra i contratti della PC o un POD/PDR duplicato a DB non vengono aggiornati e finiscono rispettivamente nel report `Abbinamenti ambigui` / `POD/PDR non trovati`.
  - **Double check**: per cluster `Consumer` confronta `Codice Fiscale` (col E) con `anagrafica.cf_piva`. Per `Business` confronta `Partita Iva` (col F) **normalizzata con padding zeri a sinistra fino a 11 cifre** (il portale rimuove gli zeri iniziali).
  - **Sovrascrittura automatica**: se il match passa, lo `stato` viene aggiornato anche se gia' valorizzato (es. da `Nuovo` a `Rifiutato` dopo qualche giorno), salvo `esito_manuale_bloccato=true`.
  - **Aggregazione dei soli duplicati reali**: la priorita' `Rifiutato > Annullato > In lavorazione > In attivazione > Nuovo > Attivato` si applica soltanto a righe con la stessa coppia PC + POD/PDR. Non viene mai usata per comprimere punti di fornitura differenti sotto la stessa PC.
  - **Colonne dettaglio rifiuto** (`causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento`) valorizzate **solo** se stato='Rifiutato' (azzerate altrimenti).
  - **Report finale**: popup con stat-card e tabelle dettagliate per PC assenti, POD/PDR non trovati, abbinamenti ambigui, CF/P.IVA discordanti, esiti manuali protetti, stati invariati ed errori di salvataggio.
- **Esito manuale admin-only** (migration `062`): il bottone `Esita manualmente` e' visibile solo agli admin. Richiede uno stato canonico e una motivazione di almeno 5 caratteri; salva `stato_origine='manuale'`, autore/data e `esito_manuale_bloccato=true`. L'elenco manuale include anche `NON TROVATO`, opzione esclusivamente admin con pillola fucsia e non appartenente alla gerarchia degli stati CSV. Tutti i futuri CSV saltano la riga e la elencano come protetta. `Riattiva aggiornamenti CSV` rimuove esclusivamente il blocco: lo stato resta manuale fino al successivo CSV valido, che lo sostituisce e riporta `stato_origine='csv'`. Il controllo ruolo e' duplicato in Netlify Function e trigger DB.
- **Icona occhio 👁️** in fondo alle righe con stato='Rifiutato': apre popup con i 3 campi dettaglio (causale/messaggio/causa). Per gli altri stati nessuna icona.

### Storage folder naming
- Contratti vendita: `Contratto_<RAGSOC_SAFE>_<DD_MM_YYYY>_<praticaIdShort6>` sotto `<YYYY>/<MM>/` (lowercase)
- Altri moduli: `MiroxFolder.build(old, new, date)` → `OLD_NEW_GG_MM_AA` (uppercase)

### Documenti
- Bucket: `contratti-vendita`
- Tipi gestiti: `documento_identita`, `permesso_soggiorno` (pubblicato28/10), `contratto`, `contratto_firmato`, `copia_bolletta`, `copia_sim_mnp`
- Regole con `campo_condizione='admin_config'` sono gestibili da UI admin
- Nome standard: `documento_identita.pdf`, `contratto_<categoria_slug>[_N].pdf`, `contratto_firmato_<categoria_slug>[_N].pdf` (solo per firma cartacea), `copia_sim_mnp.pdf`, `copia_bolletta.pdf`. `[_N]` parte da `_2` quando più contratti della stessa categoria condividono la pratica.
- Solo `application/pdf`, max 20 MB

### Modalita' Simulatore Protecta (dal 2026-07-20, migration `051`)

Il modulo `moduli/simulatore_protecta.html` chiede all'ingresso pagina la modalita' di sessione tramite un modal 4-scelte (`#sessionModeOverlay`). La scelta guida il flusso di generazione preventivo e il valore di `vendita_simulatore_protecta.trattativa_id`:

- **Nuova trattativa**: genera un nuovo `trattativa_id` lato client (`crypto.randomUUID()`), form cliente vuoto, PDF abilitato. E' l'equivalente del comportamento pre-2026-07-20.
- **Aggiungi a trattativa esistente**: apre un secondo modal (`#existingTrattativeOverlay`) con la lista delle trattative `stato='In corso'` raggruppate per `trattativa_id` (cliente, telefono, operatore, N preventivi, data ultimo). Click su una → `trattativa_id` = quella scelta, cliente/telefono pre-filled e read-only nella result card. Piu' preventivi collegati alla stessa trattativa restano visibili come UNA card nella modale Trattative.
- **Simula senza preventivo**: `trattativa_id=null`, la result card mostra i numeri ma nasconde il form cliente e il bottone "Scarica PDF Preventivo". Nessuna INSERT su `vendita_simulatore_protecta`, nessun file su Storage.
- **Solo consulta trattative** (bottone secondario): non setta `sessionState.mode`, apre direttamente la modale Trattative. Alla chiusura (`chiudiTrattative`) l'entry modal si riapre automaticamente per far scegliere all'utente cosa fare dopo (in questo modo il simulatore non resta usabile senza modalita' impostata).

**Banner di sessione** (`#sessionBanner` in cima al simulatore): mostra la modalita' corrente + bottone "Cambia modalita'" che riapre il modal iniziale. Al cambio di modalita' la result card corrente viene svuotata (evita di lasciare form cliente vecchi).

**Modale Trattative** (`apriTrattative`): raggruppa `vendita_simulatore_protecta` per `trattativa_id` (fallback `legacy_<id>` per righe pre-migration senza raggruppamento). Ogni card = una trattativa; l'accordion interno lista i N preventivi con kit, data e link "Apri PDF" (via `MiroxStorage.openAttachment('protecta-files', path)`). I bottoni **Vinto/Perso sono a livello trattativa**: `aggiornaStatoTrattativa` fa `UPDATE ... WHERE trattativa_id=<id>` propagando lo stato a tutti i preventivi collegati. Per i record legacy (nessun trattativa_id, non aggregabili) l'update ricade su `WHERE id=<legacy_id>` singolo.

**Backfill**: la migration 051 ha assegnato `gen_random_uuid()` distinto ai 33 record pre-esistenti. La migration `052` (stesso giorno) ha poi **unificato retroattivamente** i preventivi con lo stesso `numero_cellulare` sotto un unico `trattativa_id` (il canonical e' il piu' vecchio cronologicamente); inoltre se un gruppo contiene almeno un preventivo `Vinto`, tutti i preventivi del gruppo vengono forzati a `Vinto` (regola commerciale: una trattativa e' vinta se il cliente ha comprato uno dei kit proposti, gli altri sono alternative scartate). Risultato: 33 righe → 21 trattative. Se in futuro un cellulare viene riutilizzato da un cliente diverso (raro), l'operatore deve creare esplicitamente "Nuova trattativa" dal wizard invece di aggangiarsi a quella esistente.

---

## Modulo Gare & Avanzamento (dal 2026-07-09, migration 038 + 039)

Sostituisce la tab unica del vecchio `dashboard_pezzi.html` con **3 tab**: Day by Day (invariata), Gare Individuali, Avanzamento Mensile. La configurazione (metriche, obiettivi mensili, regole compenso, flag `in_gara` sugli operatori) sta sotto Admin → **Gare & Avanzamento** (`admin-gare.html`).

Motivazione: prima gli obiettivi e i compensi vivevano in un Google Sheet aggiornato a mano; ogni cambio gara aziendale (mensile) richiedeva ri-copiare il foglio e ricomunicarlo ai venditori. Ora tutto e' in Mirox e l'utente admin aggiorna i numeri direttamente da UI, mese per mese.

### Struttura DB

| Tabella | Cosa contiene |
|---|---|
| `profili.in_gara` | Flag bool per selezionare quali operatori vedono la loro tabella nella tab "Gare Individuali" |
| `gara_metriche` | Catalogo righe delle 4 tabelle (`tabella` IN `gara_individuale`/`avanzamento_standard`/`avanzamento_piva`/`avanzamento_extra_piva`). `regola` JSONB stesso engine di `dashboard_righe_giornaliera` (matching contratti). `punti_per_pezzo` numeric per la colonna Punteggio dell'Avanzamento. Trigger `updated_at`. Seed iniziale = 21 righe coerenti col Google Sheet legacy (Attivazioni Tied / Telefoni Finanziati GA / Telefoni CB / Fisso / L&G / P.IVA / Assicurazioni / Protecta per la gara + Mobili / Device Finanziati GA / Telefoni CB / Fissi / L&G / Assicurazioni / Allarmi per l'avanzamento standard + le stesse varianti P.IVA + Extra Gara P.IVA) |
| `gara_obiettivi_mensili` | Un record per `(anno, mese, metrica_id, operatore_id)`. `operatore_id` NULLABLE: NULL = obiettivo di categoria (avanzamento mensile, calcolato dalla somma di tutti gli operatori), NOT NULL = obiettivo individuale (gara). `obiettivo` int + `compenso_regola` jsonb DSL. Unique index parziale su `(anno, mese, metrica, coalesce(operatore, ffff))` per garantire unicita' anche con NULL. Trigger `updated_at`. RLS SELECT authenticated, scrittura admin |

### DSL compenso (JSONB)

Un solo tipo `scaglioni_e_bonus` copre tutti i casi visti nel Sheet legacy (per pezzo, per pezzo oltre soglia, scaglioni multipli, bonus una tantum al raggiungimento di N pezzi):

```json
{
  "tipo": "scaglioni",
  "scaglioni": [
    { "da": 0,  "a": 20,   "per_pezzo": 10 },
    { "da": 20, "a": null, "per_pezzo": 15 }
  ],
  "bonus_soglie": [ { "soglia": 40, "bonus": 50 } ],
  "label": ""
}
```

Interpretazione: se `attuale = 25` → 20 × 10 + 5 × 15 = 275 €. Se `attuale = 45` → 20 × 10 + 25 × 15 = 575 € + bonus 50 € = 625 €.

Variante `{ "tipo": "nessuno", "label": "DEC." }` = riga senza calcolo compenso, la cella mostra solo il label (es. la cella "DEC." dei mesi in decurtazione). `a: null` = infinito. Motivazioni della scelta:
- **Sicuro**: nessuna eval di formula testuale, tutte le operazioni sono `min/max/*/+` con valori numerici tipizzati.
- **Coerente**: la stessa funzione `calcolaCompenso(attuale, regola)` gira in `admin-gare.html` (preview) e in `moduli/dashboard_pezzi.html` (rendering finale). Se la logica cambia, un solo posto da toccare.
- **Estendibile**: se in futuro serve un tipo nuovo, si aggiunge `{tipo: 'xyz', ...}` con branch dedicato nella funzione, senza rompere il vecchio.

### UI operatori — `moduli/dashboard_pezzi.html`

3 tab. Toolbar con:
- **Day by Day**: input `date` (invariato)
- **Gare Individuali** / **Avanzamento Mensile**: `<select>` Mese + `<select>` Anno (default = mese corrente)

Tab **Gare Individuali**: una card `.gara-card` per ogni operatore con `in_gara=true`, contenente una tabella `Metrica | Attuale | Obiettivo | Compenso` e riga "Totale compensi". "Attuale" = conteggio contratti del mese in cui `operatore_id = ` operatore E `matchRegola(contratto, metrica.regola)`. "Compenso" = `calcolaCompenso(attuale, obiettivo.compenso_regola)`. Se `compenso_regola.tipo='nessuno'` mostra il label (es. "DEC.") in rosso, non contribuisce al totale. Filtro: i contratti con `stato_inserimento='reinserimento'` sono esclusi (coerente con la regola anti-doppio-conteggio).

Tab **Avanzamento Mensile**: 2 sezioni (Standard / Avanzamento P.IVA — che raggruppa le P.IVA di categoria + la riga aggregata Extra Gara P.IVA). Colonne operatore dinamiche = union `profili.in_gara=true` + qualsiasi operatore con almeno un contratto nel mese. Righe: pezzi per operatore + Punteggio + Obiettivo/Andamento/Eccedenza.

- **Sezione Standard**: colonne Obiettivo/Andamento/Eccedenza in header + righe valorizzate. Punteggio = `somma_pezzi × punti_per_pezzo` (o `sommaCampoPunteggio` se `punteggio_campo` è impostato). Andamento % (`attuale/obiettivo × 100`, verde ≥100%) + Eccedenza (`max(0, attuale − obiettivo)`, verde >0).
  - **Eccezione ASSICURAZIONI** (dal 2026-07-15): la riga Assicurazioni della sezione Standard usa come Punteggio la **somma di `vendita_contratti.punteggio_gara_totale`** sui contratti Assicurazioni del mese (tutti i cluster), invece del conteggio pezzi. Le celle per operatore restano conteggio pezzi. Configurato via mappa hardcoded `CAMPO_PUNTEGGIO_STANDARD = { 'Assicurazioni': 'punteggio_gara_totale' }` in `renderAvanzamento` — estendibile aggiungendo entry per altre categorie Standard.
  - **Eccezione LUCE & GAS** (dal 2026-07-15): la riga L&G della sezione Standard esclude i contratti Energia con `post_vendita_controllo_lg.stato` = `Rifiutato`. Tutti gli altri stati (incluso NULL / non ancora esitato) contano. Il conteggio pezzi resta il valore della colonna Punteggio (nessun cambio formula, solo filtro). Il caricamento degli stati post-vendita in `caricaDatiMensili` è stato allargato a **tutti i cluster** (non solo Business) proprio per servire anche questo filtro Standard oltre a quelli P.IVA.
  - **Conteggio Netto LUCE & GAS** (26/10/2026): annotazione nera, peso normale dopo Eccedenza sulla riga Standard, inclusa nel PNG della pagina. Conta contratti (non punti/pesi) del medesimo perimetro con stato non vuoto/non trattino e diverso da Annullato/Rifiutato (trim/case-insensitive); ammessi stati manuali. Data accanto: massimo globale `ultimo_csv_upload_at` del controllo, anche per altri mesi/stati, senza fallback `updated_at`; mancanza esplicita ed errori bloccanti. Il motore restituisce `conteggioNetto` solo per Energia Standard e fornisce `dettaglioEnergiaMensile` per il popup info. Il popup compatto mostra soltanto esiti e conteggi aggregati (una riga per esito, senza distinzione maiuscole), includendo tutti i contratti del perimetro; nessun dettaglio contratto/cliente e nessun join anagrafica o PC/POD nel caricamento mensile. Nomi esito escaped. Per stati assenti, data_contratto (Data Inserimento Controllo L&G, fallback created_at) dopo ultimo CSV = Da verificare, prima/uguale = Contratto non trovato; senza date affidabili = Da verificare. Solo classificazione UI, nessuna scrittura esiti. Sfondo/bordi della colonna extra rimossi con selettori specifici; titolo sezione limitato alla larghezza originaria. Nessun cambio ai valori ordinari, P.IVA o report Target.
  - **Eccezione FISSI** (dal 2026-07-15): la riga FISSI della sezione Standard usa come Punteggio la **somma di `vendita_contratti.punteggio_gara_totale`** sui contratti Fisso validi. La validità è calcolata a due bucket:
    1. **Non-FTTC del mese** (data_contratto nel mese): inclusi se `post_vendita_controllo_fissi.stato` ∈ (`Da completare`, `In Attivazione`, `Attivo`) dal 08/10/2026. Esclusi KO. I contratti ancora da verificare, senza riga post-vendita, contano come pendenti nel mese di firma: il trigger crea il controllo solo dopo la verifica. Tecnologia non compilata segue questo ramo. Un errore di lettura dei controlli blocca il report e non viene interpretato come record assente.
    2. **FTTC attivati nel mese** (`data_attivazione` nel mese, qualsiasi `data_contratto`): inclusi solo se `stato = Attivo`. Un FTTC firmato a giugno e attivato a luglio conta a luglio, non a giugno. Un FTTC ancora "In Attivazione" non conta finché non viene attivato.
    - Dal 08/10/2026 entrambi i bucket includono Legnago e Cerea, Consumer e Business, senza reinserimenti. Dashboard, PNG e Target applicano il motore condiviso; gli altri avanzamenti restano solo Legnago.
    - Caricamento: `DPState.fissoFTTCAttivatiMese` popolato con una query separata su `post_vendita_controllo_fissi WHERE tecnologia='FTTC' AND stato='Attivo' AND data_attivazione IN month`, poi join a `vendita_contratti`. `DPState.tecnologiaFisso = Map<contratto_id, tecnologia>` per il branch non-FTTC.
    - `DPState.operatoriAttiviMese` include anche gli operatori dei FTTC attivati nel mese (che potrebbero non avere altri contratti firmati nel mese).
    - La riga **FISSI P.IVA** dell'Avanzamento P.IVA **non applica** questa regola FTTC: resta sulla logica mese di firma + stato IN (`In Attivazione`,`Attivo`). Se in futuro si vuole allineare, applicare la stessa doppia-bucket anche lì.
- **Sezione Avanzamento P.IVA** (dal 2026-07-15): logica speciale — le colonne Obiettivo/Andamento/Eccedenza sono vuote sulle righe P.IVA di categoria (MOBILI/FISSI/L&G/ASSICURAZIONI/W3 PROTETTI) e le intestazioni scendono in una sotto-intestazione grigia posizionata sopra la riga aggregata Extra Gara P.IVA (che rimane l'unica valorizzata su Ob/And/Ecc).
  - **Colonna Punteggio** = somma di `vendita_contratti.punteggio_extra_gara_totale` sui contratti filtrati (non conteggio pezzi).
  - **Filtro post-vendita per categoria** applicato SIA alle righe P.IVA singole SIA alla riga Extra Gara P.IVA (per garantire che la somma delle righe = riga aggregata):
    - **Fisso** → incluso solo se `post_vendita_controllo_fissi.stato` IN (`In Attivazione`, `Attivo`)
    - **Energia** → escluso se `post_vendita_controllo_lg.stato` IN (`Rifiutato`, `Annullato`) dal 22/10/2026 (NULL e assenza ammessi); vale per LUCE & GAS P.IVA ed EXTRA GARA P.IVA, sia pezzi sia punti. Standard conserva il filtro precedente.
    - **Allarmi** → incluso solo se `post_vendita_controllo_allarmi.stato` = `OK`
    - Altre categorie (Mobile, Customer Base, Assicurazioni) → sempre incluse
  - Celle per operatore mostrano il numero di **pezzi filtrati** (coerenti col filtro post-vendita).
  - Implementazione: `DPState.statoPostVendita = {fisso, energia, allarmi}` (Map contratto_id → stato) caricato in `caricaDatiMensili`; helper `isContrattoValidoAvanzamentoPiva(c)`; branch `usaFiltroExtraPiva = sez.key === 'piva'` in `renderAvanzamento`.

Solo numeri, no drill-down (scelta UX dell'utente per non appesantire il render).

### UI admin — `admin-gare.html`

Gated `ruolo='admin'` (vedi guard pattern in "Pannello Admin Mirox").

- **Card "Operatori in gara"** — toggle checkbox `profili.in_gara` con save inline
- **Card "Obiettivi Gara Individuali"** — dropdown operatore + tabella metriche `gara_individuale` con obiettivo (input number) + colonna "Compenso" con badge riassunto (X scaglioni / Y bonus, oppure "DEC.") + bottone "Modifica compenso" che apre modale editor
- **Card "Avanzamento Mensile"** — 3 tabelle (Standard / P.IVA / Extra) con obiettivo (input number, `operatore_id=NULL`) + input punti/pezzo direttamente sulla riga metrica (edit di `gara_metriche.punti_per_pezzo`)
- **Card "Configurazione avanzata metriche"** (collassata di default) — CRUD `nome/attiva/ordine/regola` JSONB delle metriche
- **Bottone "Duplica dal mese precedente"** — copia tutti gli obiettivi e le regole compenso dal mese precedente. Skip di ogni obiettivo già presente nel mese corrente (idempotente). Confirm-modale prima di procedere

### Editor scaglioni (modale)

Aperto dal bottone "Modifica compenso" nella tab Gara Individuali. Interfaccia:
- Radio: `Scaglioni + bonus` / `Nessun compenso`
- Campo `Label` opzionale (es. "DEC.")
- Elenco scaglioni: righe con `Da` / `A` (vuoto = infinito) / `€ / pezzo` + bottone rimozione + bottone `+ Scaglione`
- Elenco bonus: righe con `Al raggiungimento di` / `Bonus €` + rimozione + `+ Bonus`
- Anteprima live: mostra il compenso calcolato a 10 / 20 / 30 / 40 / 50 pezzi con la regola attuale

Alla conferma: upsert su `gara_obiettivi_mensili.compenso_regola`. Nessuna funzione Netlify: il client scrive direttamente grazie alle policy admin di RLS (migration 039).

### Che cosa NON e' incluso

- **Grafici storici** (es. andamento mensile confrontato con mesi passati) — v1 mostra solo il mese corrente
- **Export CSV/PDF** — se serve, si aggiunge lato client
- **Notifica automatica agli operatori al raggiungimento del bonus** — nessun trigger email/toast
- **Compenso lordo/netto o ritenute** — la colonna Compenso e' un numero puro, spetta al proprietario applicare eventuali conversioni

---

## Modulo Call Center integrato (Fase 1, dal 2026-06-20)

Le 11 pagine CC + asset stanno in `moduli/call-center/` (la 12esima — `configurazione.html` — è stata spostata sotto Admin Mirox il 2026-06-24, vedi sezione "Pannello Admin Mirox"). Sono **port pragmatico** dalle pagine prod del CC: logica interna invariata (è testata in produzione da mesi), modifiche minimali per integrarle in Mirox.

### Cosa è stato modificato nel port (Fase 1 + harmonization 2026-06-24 + Admin split 2026-06-24)

1. **Redirect login**: `window.location.href='index.html'` → `'../../index.html'` (nei 11 HTML loggati + 4 JS: `js/auth.js`, `js/call-center-lead-outbound.js`, `js/prenota-interno-outbound.js`, `js/registra-chiamata-outbound.js`)
2. **Rimosso `index.html`** del CC (Mirox ha il proprio login alla root)
3. **Sidebar laterale CC RIMOSSA** (harmonization 2026-06-24): sostituita da `cc-header` (topbar + tabs orizzontali), generato dinamicamente da `js/cc-header.js`. Le tab sono filtrate per `pagine_accessibili` come la vecchia sidebar
4. **CSS DEDUPLICATO**: cancellata cartella `moduli/call-center/css/` (era duplicato byte-per-byte di `css/style.css`). Tutte le pagine CC ora referenziano `../../css/style.css` (single source of truth)
5. **Layout classes**: `.app-layout` → `.cc-layout`, `.main-content` → `.cc-main` (nuove classi in `css/style.css` senza margin-left della sidebar)
6. **Vecchio breadcrumb arancione rimosso**: era redundante con il bottone "Dashboard" nella nuova topbar
7. **`configurazione.html` ELIMINATA**: spostata fuori dal CC in `admin-call-center-config.html` (root). La tab Utenti è stata estratta in pagina separata `admin-utenti.html`. La vecchia chiave `configurazione` resta in `profili.pagine_accessibili` per coerenza col CC prod, ma non è più consumata da Mirox

### Componente JS `js/cc-header.js`

Esposto globalmente come `window.CcHeader`. API: `CcHeader.render(paginaChiavePerm)`. Genera in `#ccHeader`:
- **Topbar**: bottone "Dashboard" arancione (a sinistra) + logo Mirox (centro) + user chip + bottone logout (a destra)
- **Tab nav orizzontale**: 9 voci CC, filtrate per `profili.pagine_accessibili[perm]` (admin vede tutte). Tab corrente in evidenza arancione. La voce `configurazione` è stata rimossa il 2026-06-24 quando la pagina è migrata sotto Admin Mirox

### Compatibilità UI ancora presente (debito tecnico non bloccante)

Le pagine CC ancora usano:
- `Utils.toast/openModal/closeModal/showLoading/...` (in `moduli/call-center/js/app.js`) invece di `MiroxUI.*`

La creazione anagrafica in `registra-chiamata.html` passa da `AnagraficaHelper.cercaOcrea`, quindi è idempotente anche in caso di richieste concorrenti. Non restano `alert()`/`confirm()` nativi nei flussi CC controllati. La sostituzione integrale di `Utils.*` è un refactor estetico/architetturale facoltativo, non un difetto di sicurezza aperto.

### Accesso dalla dashboard Mirox

- **Solo via bottone topbar** "Call Center" — niente tab/card nella dashboard (scelta UX dell'utente: la dashboard è focus Vendita/Post-Vendita, il CC ha la sua sidebar interna come navigazione)
- **Redirect dinamico runtime**: al caricamento dashboard, il JS calcola la **prima pagina CC accessibile** per l'utente (ordine: registra_chiamata → elenco_chiamate → rilavorazione → call_center_lead_outbound → appuntamenti → prenota_interno → appuntamenti_oggi → esiti_appuntamenti → blacklist) e imposta `href` del bottone topbar a quell'URL diretto
- **Disabilitato se nessun permesso**: se l'utente non ha **nessuna** delle chiavi CC in `pagine_accessibili` (e non è admin), il bottone resta in classe `.disabled` (come nasce nell'HTML statico) e il click è bloccato
- **Bottone "Torna alla dashboard Mirox"** in cima a ogni pagina CC integrata: arancione, ben visibile (era un breadcrumb piccolo, ora è un bottone stilizzato — eccetto `prenota.html` pubblica)

### Chiavi permessi (riusate identiche al CC prod)

`registra_chiamata`, `elenco_chiamate`, `rilavorazione`, `call_center_lead_outbound`, `appuntamenti`, `prenota_interno`, `appuntamenti_oggi`, `esiti_appuntamenti`, `blacklist`. La chiave `configurazione` resta valida in DB (CC prod la usa) ma da Mirox la pagina è sotto Admin (gated da `ruolo='admin'`, NON da `pagine_accessibili`).

→ Zero migrazione utenti: chi ha permesso `'registra_chiamata'` su `mirox-crm.netlify.app` vede la stessa card anche qua.

### Pagina pubblica `prenota.html`

Form esterno per prenotazioni dal sito/social. **NON in dashboard** (non ha auth guard). Raggiungibile solo via URL diretto e non parla direttamente con Supabase. La function `public-prenota.js` applica validazione, allowlist motivi e rate limit persistente; la RPC additiva della migration `055` impedisce il doppio booking concorrente. Gli errori sono mostrati in un riquadro accessibile, senza `alert()` nativo.

### Rischi e limiti noti

- **Permessi CC**: la modale "Permessi CC" in `admin-utenti.html` lista solo le 9 chiavi CC. Le ACL Vendita/Post-Vendita/Applicazioni sono separate in `admin-permessi.html`, dopo migration/deploy. Restano valide tutte le eccezioni admin-only preesistenti.
- **`vw_elenco_chiamate_unificate` / `vw_rilavorazione_ricontatti_unificata`**: usate dalle pagine CC, dipendono dalla colonna `chiamate.rilavorazione_stato` (esiste) e dalle viste già createSE — verificate online in Fase 1
- **`get_slot_disponibili` RPC**: usata da `prenota.html`, `prenota-interno.html`, `appuntamenti.html` (per spostamento). Confermata esistente nel DB

---

## Pannello Admin Mirox (dal 2026-06-24)

Hub centralizzato di amministrazione, gated da `profili.ruolo='admin'`. Visibile dalla dashboard come bottone topbar "Admin" (disabilitato per operatori).

### Pagine

| Pagina | Scopo |
|---|---|
| `admin.html` | Hub con 3 card di navigazione (Gestione Utenti / Configurazione CC / Catalogo Vendita) |
| `admin-utenti.html` | CRUD su `profili`: cambio ruolo admin↔operatore con conferma, abilita/disabilita, modale permessi granulari CC (9 chiavi). Un admin non può togliersi il ruolo né disabilitarsi |
| `admin-call-center-config.html` | Configurazione CC (orari settimanali, blocchi/chiusure, parametri sistema). Spostata da `moduli/call-center/configurazione.html` (eliminata). NON dipende da `CcHeader` o dai JS del CC: usa solo `js/config.js` + `js/auth.js` + `js/mirox-ui.js` Mirox |
| `admin-vendita-config.html` | Esistente: CRUD cataloghi vendita. Aggiunto check `ruolo='admin'` (prima era solo `richiediAuth`). Bottone "← Admin" rimpiazza "← Dashboard" |
| `admin-gare.html` | Nuova dal 2026-07-09. Configurazione **Gare & Avanzamento**: flag `in_gara` sugli operatori, obiettivi mensili + regola compenso a scaglioni per la tab Gare Individuali, obiettivi di categoria + punti/pezzo per la tab Avanzamento Mensile. Editor visuale scaglioni + bonus con anteprima live. Bottone "Duplica dal mese precedente". Scrittura via RLS admin (migration 039), niente Netlify function |

### Guard pattern (riusato in tutte le pagine admin*)

```js
const profilo = await Auth.richiediAuth();
if (!profilo) return;
if (profilo.ruolo !== 'admin') {
  await MiroxUI.alert('Accesso riservato agli amministratori.');
  window.location.href = 'dashboard.html';
  return;
}
```

### Attivazione bottone Admin in dashboard

In `dashboard.html` lo script di init aggiunge `href='admin.html'` e rimuove `.disabled` dal `#btnAdmin` solo se `profilo.ruolo === 'admin'`. Per gli operatori il bottone resta visibile ma in stato disabled (no click).

### Rimozione bottone Admin in upload

Il bottone "Admin" dentro `moduli/upload-contratti-vendita.html` è stato **rimosso** (sia HTML sia handler JS). L'accesso al pannello Admin avviene esclusivamente dalla topbar della dashboard (bottone `#btnAdmin`, attivo solo se `ruolo='admin'`). La vecchia password client-side `'1234'` non esiste più.

### Note operative

- La creazione di un nuovo utente richiede ancora due step manuali (Supabase Authentication → add user con email/password, poi qui si gli assegna ruolo/permessi). Una function `admin-create-user` con service_role potrebbe automatizzare in futuro
- Permessi Vendita/Post-Vendita/Applicazioni: rilascio27/10 in `admin-permessi.html`, catalogo `js/mirox-permissions-core.js`, 19 pagine. ACL/audit separati dal CC, guard UI/API/RLS/Storage. Migration sorgente `20261027221833`, applicata con versione live `20261027224328`; admin sempre abilitati e utenti esistenti conservati nel seed. Vedi `docs/PERMESSI_PAGINE.md` e AGENTS (fonte primaria).

---

## KONA AI Guardian (prima versione, dal 2026-08-10)

Il reporter globale `js/mirox-error-reporter.js` e tutte le email automatiche per errori tecnici sono stati rimossi. Non reintrodurli. Restano operativi `mirox-send-email`, `MiroxMailer`, i template email di processo e i popup locali; il wizard Upload Contratti conserva l'orario dell'errore e i messaggi OCR strutturati.

### Flusso e autorizzazioni

- gli utenti autenticati aprono `moduli/segnala-problema.html`, scelgono problema o miglioria e possono creare/proseguire soltanto le proprie richieste;
- Guardian pone una domanda breve per volta, massimo due chiarimenti, quindi assegna un codice `KG-*` e notifica Telegram anche se restano dettagli da approfondire;
- soltanto `TELEGRAM_GUARDIAN_OWNER_CHAT_ID` puo' conversare via bot, con testo o vocali conclusi;
- analisi Guardian, approvazione lavorazione e archiviazione richiedono un callback Telegram di Mirko e producono un record in `kona_ai_approvazioni`;
- la prima versione non legge il repository, non esegue Codex, non crea patch e non distribuisce codice.

Le migration `065_kona_ai_guardian.sql` e `066_kona_ai_tipologia_richiesta.sql` creano ed estendono il dominio Guardian server-only. I dettagli tecnici hanno una scadenza obiettivo a 90 giorni; il cleanup automatico non e' ancora attivo. Riepilogo e audit restano permanenti.

Guardian opera su `mirox-crm.it`, `main` e Supabase `lbgwamhjkjjfwgusafbi`. Sviluppo e collaudo direttamente in produzione autorizzati dal proprietario il 05/10/2026. Vedi AGENTS e la guida Guardian.

### Aggiornamenti UI e comunicazioni storici

- `moduli/dashboard_pezzi.html`: layout compatto con tabella fissata a 622px.
- `moduli/upload-contratti-vendita.html`: redirect alla dashboard dopo submit; gestione dedicata del cluster `Turista`; popup OCR e orario locale restano senza invio email tecnico.
- `moduli/verifica_contratti.html`: filtro Giorno e convergenza Fisso nel dettaglio.
- `js/mirox-upload.js`: anteprima PDF centralizzata per i moduli operativi.
- `netlify/functions/_lib/mailer.js`: i link CTA delle email operative vengono normalizzati a `https://www.mirox-crm.it`.

---
## Sistema consensi privacy GDPR (dal 2026-06-26)

Mirox archivia nel CRM di proprietà/gestione Kona Tech dati e documenti consegnati per la specifica pratica. Prima dell'invio il wizard registra la presa visione dell'informativa ex artt. 13-14 GDPR e, separatamente, l'eventuale consenso facoltativo ai ricontatti promozionali. I contatti di servizio sulla pratica specifica possono avvenire tramite chiamata, WhatsApp o email e non dipendono dal flag marketing. Il modulo non disciplina il contratto WindTre/altro fornitore né sostituisce la relativa informativa.

### Componenti

| Layer | Componente | Cosa fa |
|---|---|---|
| DB | `vendita_consensi_privacy` | Tabella consensi (migration 034) |
| Storage | `consensi-privacy` (privato) | PDF informativa/dichiarazione OTP o scansione cartacea |
| Functions | `garantisci-anagrafica` | Upsert anagrafica prima del consenso |
| Functions | `check-consenso-privacy` | Dedupe 24 mesi limitato alle due versioni correnti cartacea/digitale |
| Functions | `richiedi-otp-privacy` | Genera OTP, invia SMS via Smshosting |
| Functions | `verifica-otp-privacy` | Verifica OTP, genera PDF con evidenze della dichiarazione e salva |
| Functions | `genera-pdf-consenso-cartaceo` | Modulo A4 monocromatico di una pagina per il fallback cartaceo |
| Functions | `upload-consenso-cartaceo` | Upload scansione modulo firmato a mano |
| Helper | `_lib/pdf-consenso.js` | Generazione PDF con `pdfkit` |
| Helper | `_lib/privacy-config.js` | Versioni correnti separate per cartaceo e digitale |
| Helper | `_lib/smshosting.js` | Wrapper REST Smshosting + normalizzazione numeri |
| Frontend | `upload-contratti-vendita.html` | Modale OTP/cartaceo dentro `ensureConsensoPrivacy()` |

### Flusso OTP via SMS

1. Operatore inserisce dati cliente nel wizard. Al click "Invia pratica" il wizard chiama `garantisci-anagrafica` → `anagrafica_id`.
2. `check-consenso-privacy` ritorna `valido=false` se il cliente è nuovo, la dichiarazione è scaduta/revocata oppure appartiene a una versione precedente dell'informativa.
3. Modale scelta → operatore seleziona la dichiarazione elettronica via OTP SMS.
4. Modale OTP mostra dati cliente, cellulare pre-compilato (con bottone "Modifica numero") e due radio ACCONSENTO/NON ACCONSENTO. "Invia SMS" resta disabilitato finché non viene espressa una scelta.
5. Operatore seleziona una delle due opzioni e clicca "Invia SMS" → `richiedi-otp-privacy` valida il booleano, genera OTP 6 cifre, hash SHA256+salt random, salva record `pending` con `otp_scade_at = now() + 10 min`, invia SMS via Smshosting al cellulare. Se operatore ha modificato il numero, popup "Aggiorno anche anagrafica?" → conferma sì → secondo POST `garantisci-anagrafica` con nuovo cellulare.
6. Cliente legge l'OTP dall'SMS, lo dice all'operatore. Operatore digita codice → "Verifica OTP".
7. `verifica-otp-privacy`: re-hash OTP, confronto. Se OK → genera PDF informativa con metadata firma trascritti, upload bucket `consensi-privacy`, segna `stato='confermato'` + `valido_fino_al = now()+24 mesi` + `informativa_hash` (SHA256 del PDF).
8. Modale si chiude, wizard procede al submit pratica con `payload.pratica.consenso_id` valorizzato.

### Flusso cartaceo (fallback)

1-3. Identici (fino alla modale scelta).
4. Operatore clicca "Modulo cartaceo".
5. Modale cartaceo mostra dati cliente, procedura, bottone "Scarica modulo PDF" disabilitato e due radio ACCONSENTO/NON ACCONSENTO.
6. L'operatore seleziona una scelta; il download si abilita e `genera-pdf-consenso-cartaceo` ritorna il modulo v6 di una pagina A4, corpo 10 pt, con quella scelta già marcata e riga firma separata dal testo. Dopo il download le radio vengono bloccate per mantenere coerenti PDF e dato archiviato.
7. Operatore stampa, raccoglie la firma e scansiona il foglio.
8. Operatore carica il PDF e conferma. Senza download, scansione e scelta esplicita il submit resta disabilitato.
9. `upload-consenso-cartaceo` valida `consenso_marketing=true|false`, salva il PDF in `consensi-privacy`, calcola SHA256 e inserisce il record `modalita='cartaceo'`, `stato='confermato'`, `valido_fino_al = now()+24 mesi`.

### Inquadramento legale implementato

- **OTP via SMS**: il PDF digitale v6 `_dig` mostra entrambe le opzioni marketing con una sola scelta marcata, la ripete nel riquadro probatorio e descrive il flusso effettivo: codice OTP di 6 cifre via SMS e memorizzazione di invio/conferma, ID SMS, esito/tentativi, IP, user agent e hash SHA256 del documento. Non contiene riferimenti a firma cartacea o scansione.
- **Cartaceo**: conserva la scansione del documento sottoscritto e il relativo hash SHA256. Il valore probatorio concreto dipende dal processo e dalle circostanze.
- **Testi v6 CRM**: cartaceo `v6_2026_07_26` e digitale `v6_2026_07_26_dig` riportano il Titolare come `KONA TECH SRL`, limitano il perimetro ai trattamenti della società nel CRM Mirox e mantengono equivalenti finalità, basi giuridiche, conservazione e consenso marketing.
- **Nessuna estensione retroattiva**: le informative v1/v2/v3/v4/v5 restano archiviate come evidenza; `check-consenso-privacy` e il backend accettano soltanto le due versioni v6 correnti.
- **Validazione necessaria**: prima di considerare il testo un parere legale definitivo, un consulente privacy deve confermare titolare/ruoli, DPO se designato, tempi di conservazione, contratti con responsabili/sub-responsabili, trasferimenti e canali effettivi di revoca.

### Smshosting (provider SMS)

Account aziendale Kona Tech. Endpoint `https://api.smshosting.it/rest/api/sms/send`, auth HTTP Basic (`SMSHOSTING_API_KEY` + `SMSHOSTING_API_SECRET`), mittente alfanumerico (`SMSHOSTING_SENDER`, default `MIROX`, max 11 caratteri). **Modalità simulazione** via `SMSHOSTING_SIMULATE=true`: non invia davvero, logga il testo, ritorna id fittizio (per test dev senza spendere credito). Vedi `docs/SMSHOSTING_SETUP.md` per il setup account.

Il costo SMS va stimato sui volumi reali di clienti unici e sul listino Smshosting corrente; il passaggio da 48 a 24 mesi può aumentare i rinnovi e rende obsoleta la precedente stima fissa.

### Cosa NON è incluso

- **Revoca del consenso**: la tabella ha le colonne `revocato_at`, `revocato_motivo`, `revocato_da` ma non c'è ancora UI admin per gestirla. Per ora va fatta a mano via SQL.
- **Cleanup pending**: gestito ogni giorno da `cron-pulizia-operativa`, che marca `scaduto` gli OTP pending oltre `otp_scade_at`.
- **Cron pre-scadenza consensi**: dopo 24 mesi il consenso non è più valido e il cliente deve rifirmare. Non c'è notifica automatica al cliente di pre-scadenza (eventuale futuro modulo).
- **Revisione legale**: le versioni correnti sono `v6_2026_07_26` e `v6_2026_07_26_dig`; resta necessaria la validazione professionale descritta in `docs/PRIVACY_LEGAL_REVIEW_2026-07-26.md`.

---

## Convenzioni (rispettare per coerenza)

- **Path**: pagine in `/moduli/` → JS/CSS/link con `../` (es. `../js/config.js`, `../dashboard.html`). Pagine in `/moduli/call-center/` → JS/CSS/link Mirox con `../../` (es. `../../index.html`). I JS interni del CC (`/moduli/call-center/js/`) sono path-relativi alla pagina e funzionano out-of-the-box
- **Auth guard**: ogni pagina chiama `Auth.richiediAuth()` (gestisce redirect a `../index.html` o `index.html` in base al pathname). Le pagine CC continuano a usare il proprio `Auth` (in `moduli/call-center/js/auth.js`) — è un'entità separata da `js/auth.js` di Mirox, ma fa la stessa cosa
- **Modali**: usare `window.MiroxUI.{alert,confirm,prompt,toast,loading,allegati}`. **MAI** `alert()` / `confirm()` nativo del browser
- **Azioni sensibili per ruolo**: **MAI** password operative hardcoded nel frontend. Rimborso manuale ed esiti manuali protetti restano admin-only tramite Netlify Function con `requireAuth(..., {adminOnly:true})`. Nel riepilogo Apri/Chiudi, invece, ogni account autenticato attivo può portare una pratica da `IN CORSO` a `KO`: il bottone è disponibile sia nella riga sia nel dettaglio e chiama `mark_apri_chiudi_ko`; le scritture dirette browser restano bloccate dalla migration `056`.
- **Anagrafica**: SEMPRE via `AnagraficaHelper.cerca` / `cercaOcrea` (RPC `cerca_o_crea_anagrafica`) per evitare doppioni
- **Upload PDF**: SEMPRE via Netlify function. Per i moduli operativi usare `MiroxStorageUpload.upload(...)`; per i documenti vendita usare `uploadVenditaDocumento(...)`. MAI `db.storage.from(...).upload()` dal client — la service_role non deve mai uscire dal server
- **Anteprima PDF upload**: nei moduli Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato ogni PDF selezionato o trascinato deve passare da `MiroxUpload` prima di essere mantenuto nell'input. Bottone rosso `X` = rimuovi, bottone verde `Conferma` = il file resta selezionato. Per drop-zone custom usare `MiroxUpload.previewPdfFiles()` o `MiroxUpload.confirmFilesForInput()` invece di assegnare il file direttamente.
- **Lettura allegati da bucket privati**: SEMPRE via `MiroxStorage.openAttachment(bucket, path)` o `MiroxStorage.signedUrl(...)`. **MAI** `getPublicUrl()` per i bucket privati (vedi sezione "Storage buckets"). Eccezione: `moduli-template` resta pubblico e accetta `getPublicUrl()`
- **Chiamate a Netlify functions dal client**: SEMPRE via `MiroxApi.fetch(url, opts)` — inietta `Authorization: Bearer <jwt>` dalla sessione Supabase. MAI `fetch()` diretto, altrimenti la function ritorna 401. Per FormData, NON settare `Content-Type` manualmente (il browser inserisce il boundary)
- **Auth in nuove Netlify functions**: usare `const { requireAuth } = require('./_lib/require-auth')` e all'inizio dell'handler `const auth = await requireAuth(event); if (!auth.ok) return response(auth.status, { success: false, error: auth.error });`. Per endpoint solo admin: `requireAuth(event, { adminOnly: true })`. CORS `Access-Control-Allow-Headers` deve includere `Authorization`
- **Identità server-side**: campi audit/ownership come `operatore_id`, `uploaded_by`, `created_by` non sono fonte di verità se arrivano dal client; derivarli da `auth.profilo`/`auth.user` e validare le relazioni fra gli UUID ricevuti.
- **Email**: via `MiroxMailer.send({to, template, vars})` → endpoint `mirox-send-email`. Mai SMTP diretto dal client.
- **Segnalazioni tecniche**: non inviare email automatiche e non agganciare handler globali. Gli operatori usano `moduli/segnala-problema.html`; future fonti automatiche devono creare/deduplicare incidenti Guardian lato server. I popup locali restano responsabili del feedback immediato all'utente.
- **Nomi cartelle Storage**: via `MiroxFolder.build()` lato client o pattern equivalente nelle Netlify functions (`sanitizeSegment`)
- **Timestamp**: `timestamptz` salvati in UTC, mostrati in `Europe/Rome` lato UI (vedi pattern `formatCrmDateTime` nei moduli)
- **Nessun bundler**: import solo come `<script src=...>`, niente `import` / `require` lato browser
- **HTML dinamico / XSS**: ogni dato proveniente da DB, Storage o input inserito in template HTML deve passare da `MiroxSafe.escapeHtml`; URL da `safeUrl`, colori da `safeCssColor`, ID inline da `isUuid`/`isRecordId`. Preferire `textContent`, `replaceChildren` e listener a `innerHTML`/handler inline. Markup statico fidato può restare in template.
- **CDN e header**: librerie CDN sempre con versione esatta, `integrity` SHA384 e `crossorigin="anonymous"`. La CSP/HSTS/Permissions-Policy vive in `netlify.toml`; `'unsafe-inline'` è una compatibilità temporanea col frontend legacy e non va ampliata.
- **Test**: prima di chiudere un task eseguire `npm test`. La suite `node:test` in `/tests` copre regressioni prioritarie, sintassi di JS/script HTML inline e link locali.
- **Sync con GitHub**: SOLO via `git push` dalla cartella locale (SSH già configurato per `mirkopiasenti`). **Mai upload via interfaccia web** GitHub — causerebbe drift fra locale e remoto. Repo: `git@github.com:mirkopiasenti/mirox-crm.git` (rinominato da `konahub-vendita-test` il 2026-07-02; remote locale aggiornato, redirect GitHub ancora attivo per sicurezza). Netlify site collegato: `mirox-crm` con custom domain `mirox-crm.it`
- **Accesso Supabase autonomo (AI)**: il progetto `lbgwamhjkjjfwgusafbi` è già linkato. Usare la CLI portable `./.bin/supabase-go` (gitignored); se la sessione locale manca, completare il login ufficiale con `./.bin/supabase-go login` senza assumere un percorso fisso per il token. Per introspezione/SQL remoto: `./.bin/supabase-go db query --linked "SELECT ..."` (Management API, non richiede la password DB). Prima di migration, DDL o altre scritture seguire le regole di conferma del progetto.

---

## Note operative consapevoli (non "correggere" senza chiedere)

- **Edge Functions Supabase**: non in uso, non aggiungerne senza discutere prima
- **Guardian production**: conversazione libera, analisi repository read-only, patch su branch da main, test locali e PR draft. Il deploy segue l'autorizzazione del proprietario; nessun secondo ambiente richiesto.
- **Cluster `Turista`**: è un cluster di vendita, non un cluster anagrafico condiviso. `garantisci-anagrafica.js` e `crea-vendita-pratica-carrello.js` lo accettano dal wizard, mantengono `Turista` su pratica/contratti, salvano `anagrafica.cluster='Consumer'` e non richiedono email.
- **File SQL in `/database/`**: parziali, NON riflettono lo stato attuale del DB (vedi `database/README.md`)
- **Modulo `simulatore_protecta.html`**: ~960 KB, molto pesante perché contiene asset embedded. Modificare con cautela.
- **Permessi Vendita/Post-Vendita/Applicazioni**: rilascio27/10 con migration applicata/verificata, versione live20261027224328. Mappa e audit indipendenti da `profili.pagine_accessibili`, riservata al CC. Nessun cambio schema/RLS/RPC condivise. Permessi di pagina conservano i vincoli admin-only preesistenti. Signed URL gia emesse restano valide fino alla scadenza. Vedi `docs/PERMESSI_PAGINE.md`.
- **`vendita_contratti.fascia_prezzo`**: dal 2026-06-26 contiene il **prezzo puntuale del device** (es. `"399.90"`), non più una fascia-range (`"250-599"`). La dashboard pezzi (migration `014`, regole seed in `dashboard_righe_giornaliera`) **non binara mai** per `fascia_prezzo` né `fascia_prezzo_in`, quindi il cambio è transparent per il conteggio mensile attuale. Se in futuro servisse raggruppare per fasce: aggiungere una colonna derivata o una regola DSL che faccia il binning lato dashboard. **Non re-introdurre la dropdown** in `upload-contratti-vendita.html` o `verifica_contratti.html` senza prima discutere.
- **Catalogo `vendita_reload` dismesso** (migration `035`, 2026-06-26): la dropdown Reload nel wizard upload-contratti, la sezione "Reload (catalogo)" in `admin-vendita-config.html` e il multiselect "Reload disponibili" nelle offerte sono **disabilitati** (UI nascosta o no-op via shim JS). La tabella DB `vendita_reload`, il link `vendita_offerte_reload` e la colonna `vendita_contratti.reload_id` sono **conservati** per dati storici — niente DROP. Le Netlify functions `vendita-config.js` e `admin-vendita-config.js` continuano a leggere/scrivere ma il wizard non invia più `reload_id` né nuovi link. Se serve riabilitare in futuro: ripristinare HTML/JS nei 3 punti citati e gli shim no-op in `upload-contratti-vendita.html`. **Non eliminare** la tabella DB senza prima migrare i contratti storici.
- **`vendita_contratti.smartphone_reload` + `smartphone_reload_modalita`** (migration `035`, 2026-06-26): non confondere con il vecchio catalogo Reload. Sono campi del singolo contratto, ricavati dalla riga "SMARTPHONE RELOAD SI/NO" del PDA. Il CHECK DB `vc_smartphone_reload_coerenza_chk` impone `modalita NOT NULL ⇔ smartphone_reload IS TRUE`: se vuoi cambiare smartphone_reload da true a false, **prima** azzera la modalita.
- **Import storico konahub completato** (2026-06-29): importati 1665 contratti + 1366 pratiche + 81 anagrafiche + dati post-vendita (217 fissi, 271 L&G, 10 allarmi, 8 assicurazioni) + switch (57) + apri/chiudi (36) + comodato (7) + ordini (27) + protecta (26) + ticket (136). Tutti i contratti con `stato_controllo='controllato'`, `stato_inserimento='inserimento'`, `origine_pratica='spontaneo'`. La migration `053` ha completato gli operatori mancanti delle pratiche, valorizzato `vendita_documenti.uploaded_by`, corretto a Cerea i 35 contratti storici del profilo Cerea ed eliminato 16 record documento duplicati senza cancellare i PDF. **81 anagrafiche nuove sono passaporti** (cluster='Consumer' a DB ma cf_piva contiene un codice passaporto, NON un CF italiano). Script di import in `database/imports/konahub/` (`.gitignored` per CSV/zip/docs). Backup pre-import in `database/backups/pre_cleanup_2026-06-29/`.
- **Cleanup konahub segnalazioni fatto** (migration `036` + refactor `moduli/segnalazioni.html`, 2026-07-02): konahub dismesso, pagina segnalazioni modernizzata (auth guard + `window.db` di `js/config.js`), 5 policy `anon` revocate. Da adesso il modulo funziona solo da Mirox loggato — vedi sezione "Storage buckets" per il dettaglio.

---

## Quick reference

| Devo... | Faccio... |
|---|---|
| Aggiungere una nuova **regola di business** | Modificare in 3 punti: CHECK constraint DB + UI wizard + Netlify function di validazione |
| **Verificare un consenso** o gestire una revoca | Query/UPDATE manuale su `vendita_consensi_privacy`. Non c'è ancora UI admin. Per revoca: `UPDATE ... SET revocato_at=now(), revocato_motivo='...', revocato_da=<uuid_admin>` |
| **Aggiornare gare/obiettivi/compensi** all'inizio del mese | Dashboard → Admin → **Gare & Avanzamento** (`admin-gare.html`). Seleziona mese/anno, clicca "Duplica dal mese precedente" per partire dagli obiettivi del mese scorso, poi correggi i numeri cambiati dall'azienda + modifica le regole compenso con l'editor scaglioni visuale. La tab Dashboard Pezzi → Gare Individuali si aggiorna sola. |
| Aggiungere una nuova **metrica gara** (nuova riga nella tabella) | Admin Gare → sezione "Configurazione avanzata metriche" (collassata) → nuova riga con nome + tabella (`gara_individuale` / `avanzamento_standard` / `avanzamento_piva` / `avanzamento_extra_piva`) + `regola` JSONB (stesso engine di `dashboard_righe_giornaliera`). L'INSERT via UI oggi manca — aggiungerla o farlo direttamente da SQL editor Supabase. |
| **Includere/escludere un operatore dalla Gara Individuale** | Admin Gare → prima card "Operatori in gara" → toggle checkbox `in_gara` per profilo. Effetto immediato sulla tab Gare Individuali della Dashboard Pezzi. |
| Cambiare **testo informativa** | Modificare `_lib/pdf-consenso.js` e le costanti cartacea/digitale in `_lib/privacy-config.js`. Aggiornare insieme l'elenco versioni correnti; i record vecchi conservano la versione storica. Far revisionare da legale e renderizzare entrambe le varianti. |
| Cambiare **scadenza 24 mesi** | Modificare costante `VALIDITA_MESI` in `verifica-otp-privacy.js` E `upload-consenso-cartaceo.js`. Stessa logica `addMonthsClamped(now, N)` |
| Aggiungere un **tipo documento** | Aggiornare `vendita_documenti_regole`, UI admin in `admin-vendita-config.html`, e nome standardizzato in `upload-vendita-documento.js` (`suggestedFileName`) |
| Aggiungere una **categoria vendita** | INSERT su `vendita_categorie` + eventuale ramo in `validateCategorySpecificRules` (carrello function) + UI wizard se ha campi speciali |
| Sapere lo **stato reale dello schema** | Query a `information_schema` / `pg_*` dal SQL Editor Supabase (non fidarsi dei file in `/database/`) |
| Modificare le **regole di accesso pagine Call Center** | NON farlo da qui — è gestito dall'altro progetto. Coordinare con utente. |
| **Promuovere un utente ad Admin** o gestire i permessi CC | Dashboard → Admin → Gestione Utenti (`admin-utenti.html`). Bottoni "Rendi Admin"/"Rendi Operatore" + modale "Permessi CC". Solo accessibile se sei admin |
| **Aggiungere una nuova pagina al pannello Admin** | Nuova card in `admin.html` + nuova pagina `admin-<nome>.html` alla root, riusare guard pattern `Auth.richiediAuth()` + check `ruolo === 'admin'` (vedi sezione "Pannello Admin Mirox") |

## Guardian: aggiornamento 05/10/2026

Correzioni di chat libera, memoria e affidabilita' preparate nel worktree, non
distribuite in produzione. Migration della memoria applicata.
Seguire AGENTS e `docs/GUARDIAN_DIAGNOSI_2026-10-05.md`; nessun deploy, env Netlify
o nuovo progetto senza le autorizzazioni previste.


### Recupero dei bug segnalati a settembre (05/10/2026)

Ticket verifica la riga restituita dall'UPDATE prima di mostrare successo ed
impedisce conferme simultanee. Il nome cliente resta fuori dagli handler inline.
Il catalogo vendita usa `MiroxApi.fetch(..., {__miroxReadRetry:true})`: un solo
retry GET dopo 350 ms per rete o HTTP 502/503/504, nessun retry di POST/upload,
abort o browser offline; ogni errore resta nella telemetria.
OTP: verifica unica in UI, reinvio bloccato durante la conferma, upload con
`privacy-pdf-storage` e un retry sullo stesso path `upsert:false`; un conflitto
dopo timeout e' accettato solo se il PDF riscaricato ha SHA256 identico.
UPDATE condizionale su pending/hash/tentativi, rilettura dopo risposta persa,
nessuna cancellazione del PDF referenziato; errore di rilettura conserva il file
per non eliminare un consenso eventualmente salvato. Errori tecnici a codici
chiusi con fase/request_id Guardian, senza OTP o dati cliente.
Il nome dei nuovi PDF OTP include l'UUID del consenso; i PDF storici non cambiano.
Timeout persistenti del provider e perdita di rete restano possibili: nessuna
promessa di eliminazione; eventi storici senza causa dimostrata sono archiviati
con nota di mitigazione, senza dichiararli risolti. Report completo in
`docs/GUARDIAN_BUG_SETTEMBRE_2026.md`. Schema/RLS CRM e CC invariati.

## Guardian: pubblicazione finale Telegram (05/10/2026)

La pubblicazione finale si approva da Telegram: dopo i test, `Approva pubblicazione`
mostra PR, riepilogo e commit verificato; `Pubblica in produzione` oppure `OK pubblica`
in risposta a quel messaggio autorizzano il merge. La conferma dura un'ora e vale
per una sola versione. Il workflow attendibile su `main` verifica nuovamente test,
proprietario, commit della patch e base production; esegue il merge e attende che
`mirox-crm.it` esponga il relativo commit, quindi verifica la salute Guardian.
Solo allora chiude la richiesta. Esiti Telegram in outbox persistente; se GitHub
è aggiornato ma il deploy non è confermato, la richiesta resta aperta e viene
segnalato esplicitamente. Workflow/configurazioni, dipendenze e SQL richiedono
revisione manuale; nessuna modifica a segreti, schema o protezioni GitHub.

Dettagli e vincoli aggiornati in AGENTS e `docs/GUARDIAN_PUBBLICAZIONE_TELEGRAM.md`.

Netlify 05/10/2026: anteprime PR disabilitate (`skip_prs=true`); production main
e deploy automatici al merge restano attivi (`stop_builds=false`). Il controllo
GitHub fallito dell'anteprima PR12 è storico e non un guasto del CRM production.

## Guardian: vocali e riclassificazione (06/10/2026)

Vocali persistiti in `kona_ai_vocali_jobs` prima dell’ack Telegram, elaborati da
`guardian-voice-background` con HMAC/timestamp e lease; retry limitati, checkpoint
trascrizione/risposta, consegna incerta sospesa con ripresa esplicita. Il cron
Observer risveglia la coda. Riclassificazione su chiarimento del proprietario con
storico/audit conservati e approvazioni pendenti invalidate. Nessuna env nuova,
nessuna modifica Call Center; guida `docs/GUARDIAN_VOCALI_2026-10-06.md`.

Guardian06/10: i chiarimenti aggiornano il riepilogo anche per una richiesta già
classificata come miglioria; storico conservato e vecchie approvazioni pendenti
scadute. Nessuna implementazione o pubblicazione autorizzata dal dialogo.

Guardian06/10: collegamento `kona_ai_messaggi.voice_job_id` UUID con unicita
per autore; `id` messaggio resta bigint GENERATED ALWAYS e non va fornito
dal client. Migration additiva `20261006194000_guardian_voice_message_link.sql`,
privata Guardian, senza cambi CRM/Call Center. Errori coda distinguono fase e
codice tecnico ripulito, senza stampare testo dei vocali o segreti.

### Guardian: sviluppo da Telegram (06/10/2026)

Un comando diretto del proprietario, per esempio “Procedi con l’implementazione”,
avvia il worker `prepara_patch` sul repository senza un'altra analisi discorsiva.
Le altre formulazioni libere possono proporre `Sviluppa e verifica`; le domande,
negazioni, citazioni e condizioni non avviano lavoro tramite classificazione AI.
Anche i vecchi pulsanti `Analisi Guardian` avviano ora l'analisi Codex del codice.
La patch approvata include i test della branch, avviati dal risultato e recuperati
dal cron se il passaggio si interrompe. Consenso, origine del messaggio e hash
dei requisiti restano nei JSON delle approvazioni/esecuzioni; retry vocali e
richieste duplicate non avviano una seconda patch. Esiti senza modifica, domanda
concreta o blocco fermano la catena; i test falliti non ripartono in un ciclo.
Dopo i test viene proposta la pubblicazione: resta obbligatorio l'OK finale
Telegram sulla versione verificata. Secret, workflow, SQL e aree protette
continuano a richiedere revisione tecnica separata. Nessuna nuova env o tabella.

Guardian06/10: le richieste di catalogo/Day by Day/gare ricevono uno snapshot
read-only (offerte, metriche e righe giornaliere, massimo250 per tabella,
troncamento esplicito), senza dati clienti o segreti. Punteggi/regole nuovi non
vanno inventati: conservare gli esistenti o chiedere una sola scelta concreta.
Le proposte SQL di configurazione dati possono essere conservate in PR draft
con `manual_review/blocked`, test locali e notifica persistente. Il workflow
non esegue SQL e la conferma finale continua a rifiutare database/*.sql.
La revisione resta separata da Codex. Un piano catalogo validato e vincolato
alla versione puo essere applicato dal rilascio dopo la conferma finale Telegram. Secret,
workflow, dipendenze e deploy rimangono bloccati prima del push della patch.

### Guardian: piano catalogo revisionato e conferma Telegram

La migration `20261006182105_guardian_reviewed_catalog.sql` aggiunge due RPC,
senza alterare schema/RLS CRM o tabelle CC. `guardian_catalog_apply_v1` e' il
core privato, senza EXECUTE per service_role/anon/authenticated;
`guardian_apply_reviewed_catalog` e' service-only e richiede lease, SHA, test,
revisione Codex locale e consenso finale Telegram non scaduto. Accetta solo
inserimenti `vendita_offerte`/`dashboard_righe_giornaliera` e aggiornamenti
`regola` delle righe giornaliere con precondizioni su nome/regola; massimo10
operazioni per gruppo, nessun DELETE, SQL libero, DDL, RLS, RPC o dati clienti.
Il piano serializzato/hash e la revisione vivono nel JSON dell'approvazione patch
server-only, vincolati alla head SHA. Il workflow non puo' attribuirsi la revisione.
La conferma finale mostra anche il piano dati; cambi a head/piano/requisiti
invalideranno l'approvazione. Il rilascio controlla merge e SHA online prima
di applicare il piano in una transazione; verifica salute prima di chiudere.
Checkpoint nell'approvazione finale impedisce duplicati. Un fallimento dati
lascia la richiesta aperta e non viene dichiarato un rilascio riuscito.
Migration applicata/riletta06/10: privilegi verificati, core e rollback dopo
precondizione fallita collaudati in transazioni annullate,0record sintetici residui.

KG23: il piano JSON backend aggiunge2offerte Consumer/2righe Day by Day a1punto
complessivo. Aggiorna soltanto le regole delle righe telefono14/15 per escludere
le nuove combinazioni, preservando tutti i telefoni storici. Il helper condiviso
`js/customer-base-device.js` vincola dispositivo obbligatorio e tipo acquisto
Finanziamento/VAR nel wizard e server; altre offerte restano immutate. Script
SQL iniziale non eseguito e sostituito da piano revisionato, non da SQL spostato.
Applicazione subordinata alla conferma finale Telegram e alla head SHA verificata.

Convenzione piani catalogo Guardian: solo `netlify/functions/_lib/guardian-catalog-<codice>.json`; il validator li classifica catalog_required/manual_review/blocked, come le proposte SQL. Senza revisione server legata alla head non si puo proporre il rilascio del piano.


Guardian vocali06/10 sera: il download Telegram mantiene i byte Ogg originali
ma usa filename `vocale.ogg` e MIME `audio/ogg`, anche quando getFile restituisce
`.oga`; la API richiede metadati formato riconoscibili. Parametro `languages[]`
solo per `gpt-transcribe`, `language` per i modelli precedenti configurati.
Errori OpenAI persistiti come codici ripuliti (HTTP/formato/chiave/quota), senza
messaggi grezzi; un errore4xx permanente sospende il singolo vocale e permette
al successivo di procedere. Timeout/429 restano ritentabili e in ordine.
“Aprimi una nuova richiesta” crea subito il caso e collega la sessione prima del
vocale successivo; il primo dettaglio sostituisce il testo provvisorio. Nessuna
modifica di schema, segreti, modello predefinito o conferme di pubblicazione.

## Scanner documenti guidato (locale29/10/2026)

QR automatico nello step Documenti Upload, acquisizione web fronte/retro in memoria
senza galleria, PDF massimo4MiB e sessione10minuti revocabile. CIE sola o con TS
facoltativa; cartacea/patente con TS fronte/retro; passaporto/Turista soltanto PDF e
preview manuale, senza OCR identita. Fallback PDF esplicito e conferma preview
esistenti. Lettore reale barcode server ZXing+checksum CF, AI resta per scadenza e
parti; TS non impone numero/tipo/scadenza identita. CF Business dalla PDA invariato.
Nuova POST scanner-documenti: JWT desktop, capability HMAC limitata telefono con
owner ACL fresche, tabella vendita_scanner_sessioni privata/service-only gia applicata
production20261029202906, sorgente20261029201139. Nessuna modifica CC/env/schedule.
qrcode1.5.4, zxing-wasm3.1.6, @napi-rs/canvas1.0.13 fissati; WASM locale e PDF-lib
browser vendorizzato dalla build. Nessun push; camera iPhone/Android da collaudare
con proprietario dopo rilascio autorizzato. Fonte AGENTS e docs/SCANNER_DOCUMENTI_2026-10-29.md.

### Debug scanner29/10 (locale)

Fix asincronia facciate/abbandono pagina/riapertura QR; retry ricezione PC senza
perdere QR/scansione,503 per errori servizio e rilettura DB prima di compensare
un esito ambiguo (mai cancellare PDF gia pronto o di stato non rileggibile).
Decoder verifica entrambe le scale per trovare CF discordanti anche sulla stessa
pagina. Nessuna modifica schema/ambiente o nuovo test cliente; fonte AGENTS e
sezione Debug di docs/SCANNER_DOCUMENTI_2026-10-29.md.

### Secondo debug scanner29/10 (locale)

Reset completo CIE/TS/QR, preview obsolete chiuse e richieste identita distinte con
deduplica dei doppi click; stream multipart interrotti gestiti nei due ingressi.
QR prima della insert, cancel proprietario idempotente anche dopo scadenza, CAS
con scadenza prima di Storage, cluster e UUID verificati. Nessun nuovo schema o
test cliente. Prima di pubblicare scanner integrare il planning gia su origin/main,
senza force-push del main locale divergente. Fonte AGENTS e guida scanner.
