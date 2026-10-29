# /database/ — Migrazioni SQL storiche

I file `.sql` nella root di questa cartella sono **migrazioni storiche parziali** applicate manualmente nel SQL Editor di Supabase (o via CLI) durante lo sviluppo. `staging/` contiene invece bootstrap one-shot destinati esclusivamente a database staging nuovi e vuoti.

## Planning personale — migration applicata production29/10/2026

`20261029200010_personale_planning.sql` aggiunge esclusivamente tre tabelle nuove:
`personale_planning_config` (roster/orari/account e versione),
`personale_planning_mesi` (mese/versione/bozza/snapshot pubblicato),
`personale_planning_audit` (autore UUID, mese/versione/azione/data).
RLS abilitata e privilegi PUBLIC/anon/authenticated revocati su tabelle e RPC;
`personale_salva_config` e `personale_salva_mese` sono INVOKER/service-only,
admin attivo riletto, CAS con errore40001 e audit/pubblicazione nella stessa transazione.
Collegamento logico al profilo esistente, nessuna modifica o FK su profili/CC,
nessun seed di account o associazione automatica. Configurazione iniziale tramite UI.
Collaudo SQL PostgreSQL WASM isolato riuscito: ACL/RLS, RPC, ruolo, conflitti,
snapshot e audit. Applicata production come20261029210434 dopo richiesta di push;
privilegi/RLS/RPC riletti e tabelle inizialmente vuote. Tabelle condivise invariate.
Advisor sicurezza: stesse7categorie, sole3INFO RLS senza policy attese;
performance: solo nuovo indice audit inutilizzato. Deploy verificato online29/10. Dettagli: [Planning personale](../docs/PLANNING_PERSONALE.md).
Debug29/10: migration invariata, ricollaudata isolata; corrette UI e PDF, inclusa
la conservazione del documento/versione CAS dopo caricamento mensile fallito.
Nessun nuovo DDL o applicazione production per il planning.

## Permessi pagine Mirox — migration applicata 27/10/2026

La query Admin usa le colonne esistenti `nome`/`username` di profili, senza
richiedere una colonna email o modificare la tabella condivisa.

Migration sorgente CLI `20261027221833_permessi_pagine_mirox.sql`, applicata
in production con versione registrata `20261027224328` dopo consenso esplicito:
catalogo `mirox_pagine`, ACL `mirox_permessi_utente` con FK a profili, audit
`mirox_permessi_audit` e RPC invoker/service-only `mirox_salva_permessi_pagine`.
RLS ON e privilegi minimi sulle tre tabelle nuove; salvataggio admin validato,
versione ottimistica, lock e audit atomico. Seed tutte le 19 pagine per i profili
esistenti; nuovi utenti/pagine negati in assenza di true esplicito.
Helper interno `mirox_private.can_pages(text[])` vincolato all'identita corrente,
search_path vuoto, schema privato. Policy AS RESTRICTIVE additive sulle risorse
vendita e Storage, viste pubbliche report/storico invoker con gate modulo;
storico legge aggregazione privata autorizzata per conservare le UNION CC.
Nessuna modifica a schema/RLS/RPC/trigger di profili o tabelle CC condivise.
Verificati19pagine/7ACL tuttetrue/0audit,84policy restrittive e privilegi;
profili/permessiCC/schema/RLS/trigger condivisi e RPC esistenti identici allo
snapshot precedente. Advisor sicurezza/performance7->7, nessun nuovo rilievo.
Operatore e identita senzaACL verificati in READONLY/ROLLBACK, nessun dato
cliente modificato. Procedura, limiti dati condivisi e signed URL gia emesse:
[`docs/PERMESSI_PAGINE.md`](../docs/PERMESSI_PAGINE.md).

## Verifica automatica contratti (27/10/2026, migration applicata)

`20261027172616_verifica_automatica_contratti.sql`, generata con CLI: sei tabelle
private `vendita_verifica_config`, `vendita_verifiche`, `vendita_verifica_csv`,
`vendita_verifica_esecuzioni`, `vendita_verifica_documenti`, `vendita_verifica_notifiche`.
RLS ON e grant soltanto service_role, RPC nuove INVOKER con search_path vuoto e
EXECUTE revocato a PUBLIC/anon/authenticated. Nessun cambio a tabelle/RLS/RPC CC
né schema/trigger anagrafica: quest'ultima è solo letta e bloccata FOR SHARE nel commit.

Nuovi trigger su sole vendita_contratti/vendita_documenti/vendita_pratiche per
invalidation e registrazione turno21:00Europe/Rome; esiti separati per compatibilità
stato_controllo e trigger post-vendita. Claim2worker/lease12min, commit+audit+outbox
atomici, CAS/revisioni e sorgenti concorrenti bloccanti. Attribuzione sistema:
controllato_da NULL, nota e audit dedicati. Cache per SHA256+modello+prompt;
CSV originale e righe non esposte al browser. Firma alla data effettiva, ICCID
in evidenze private, nessuna nuova colonna ICCID sul contratto. Stato L&G e
ultimo_csv_upload_at non modificati dal nuovo upload verifica.

Default configurazione **collaudo**: nessun contratto approvato o email inviata.
Test PostgreSQL in memoria con `scripts/verifica-automatica-sql.js`: grant,
claim, collaudo, allegato/CSV/anagrafica concorrenti, rollback patch, idempotenza,
riapertura, riesame e dedupe. Migration applicata production27/10, registro
`20261027172616`; nome file allineato alla versione Supabase dopo generazione CLI.
Sei tabelle RLS/grant e sei RPC INVOKER riletti: anon/authenticated senza accesso.
Configurazione collaudo,31lavori registrati, zero esecuzioni/notifiche; impronta
degli stati dei2720contratti identica prima/dopo, nessun dato contratto modificato.
Guida: [Verifica automatica](../docs/VERIFICA_AUTOMATICA_CONTRATTI.md).

Diagnosi elenchi27/10: con SET LOCAL ROLE authenticated,2720contratti visibili,
zero pratiche e zero risultati con inner join (RLS pratiche senza SELECT).
Correzione solo frontend, query senza join pratica e guardia caricamenti; nessuna
nuova migration/policy/grant o modifica dati.31da_controllare/2689controllati presenti.

Preparazione collaudo diurno28/10, pubblicata84bb310: nessuna modifica schema, trigger,
permessi o dati production. Lettore tool a schema + testo PDF per pagina, cache
con versione lettore esplicita oltre a modello/prompt/hash byte. I collaudi
restano senza patch contratto o notifiche; storico affidato al proprietario.
SQL isolato riconferma grant/claim/CAS/rollback e assenza effetti del collaudo.
Letture live SQL/REST riprese alle22:15 del27/10 dopo passaggio Nano->Micro
effettuato dal proprietario; modalità collaudo riconfermata,0verifiche in corso
e0notifiche verifica. Nessuna modifica schema/dati o attivazione dall’assistente.

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

### Conferma assistita del singolo collaudo (28/10/2026)

Operazione dati autorizzata dal proprietario, senza migration/schema/RLS nuovi.
Conferma solo con snapshot e prove documentali immutati, esito interamente positivo
ed esecuzione/revisione attuali; transazione aggiorna contratto/verifica e registra
`conferma_collaudo_assistita` in `vendita_log_modifiche`, responsabile Codex nelle
note/audit senza impersonare un profilo. `mirox.verifica_commit` evita la coda di
riesame dello stesso commit; gli altri trigger post-vendita restano abilitati.
Prima esecuzione verificata: solo campi conferma modificati, job fermo, zero
notifiche e configurazione collaudo invariata. Nessun dato cliente nei file pubblici.



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

La successiva correzione del lettore Mobile senza MNP (versione
`2026-10-28.1`) modifica soltanto estrazione/cache documentale: nessuna nuova
migration, schema, policy o modifica dei contratti esistenti. Prova locale con
trascrizione precedente e PDF originale, senza persistenza dei risultati.

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

## Professional Cloud Mobile e Fisso Business (28/10/2026, migration applicata)

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

## Codici cliente WindTre anagrafici (27/10/2026, migration applicata)

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

## Identificazione PDA e dati Mobile (27/10/2026, migration applicata)

`20261027110402_vendita_codice_pda_mobile.sql` applicata in produzione27/10
(versione MCP20261027110402), riletti7campi/indice/trigger INVOKER con search_path
vuoto. Nessuna segnalazione advisor sulle nuove funzioni. Prova INSERT su bozza,
unicita, coerenza MNP e sync Fisso bidirezionale eseguita con ROLLBACK; zero righe
di collaudo conservate, tutti i codici storici restano NULL.
Aggiunge a `vendita_contratti` sette colonne nullable: `codice_contratto` text,
`costo_offerta_mensile` numeric(7,2), `portabilita` boolean e i text
`numero_telefono`, `numero_provvisorio`, `numero_mnp`, `operatore_provenienza`.
Codice canonico maiuscolo senza spazi (zeri preservati), indice UNIQUE parziale
`vendita_contratti_codice_pda_unique` su tutti i valori non NULL, nessun filtro per
categoria/negozio/mese/stato/pratica. CHECK formato/importo/numerazioni e coerenza
nuovo numero oppure MNP; le righe legacy con tutti i campi NULL restano valide.
Il backend richiede il codice sui nuovi PDA e dati completi solo per Mobile;
Customer Base/Fisso solo codice. Nessuna estrazione o riscrittura dello storico.

Due nuove funzioni/trigger INVOKER con search_path vuoto, nessun SECURITY DEFINER:
all'INSERT del controllo Fisso si copia il codice tracciato; le correzioni si
propagano nelle due direzioni senza ricorsione, sotto lo stesso vincolo UNIQUE.
Gli storici senza codice tracciato non vengono cambiati. Il client mantiene le
RLS esistenti: modifiche del codice tracciato tramite Function autenticata; un
client legacy senza UPDATE sul contratto riceve errore anziche' lasciare divergenze.
Nessuna modifica a tabelle/RPC/trigger/policy CC o schema anagrafica; il contatto
viene aggiornato dai normali upsert applicativi gia' esistenti. La normalizzazione applicativa accetta il prefisso 39 senza + soltanto su lunghezze internazionali, prima dei CHECK nazionali; nessun nuovo cambio schema per questo caso.

Collaudo offline con `scripts/verifica-vendita-pda-sql.js`, PostgreSQL in memoria
PGlite0.5.12 installato soltanto nello scratchpad esterno (nessuna dipendenza CRM):
`MIROX_PGLITE_MODULE=/percorso/assoluto/node_modules/@electric-sql/pglite node scripts/verifica-vendita-pda-sql.js`.
Verificati compatibilita storico, CHECK, UNIQUE, due tentativi concorrenti,
sincronizzazione bidirezionale e comportamento RLS con client legacy.
CLI migration new tentata ma indisponibile per il profilo locale senza formato;
nome UTC generato localmente, nessuna modifica delle credenziali/config CLI.
Migration e codice applicativo pubblicati; nove PDF reali con OCR convalidato.
Pulizia13copie temporanee di collaudo riconciliate per hash/dimensione;149temp
preesistenti conservati, zero contratti test e zero codici storici popolati.
Prima del primo utilizzo ricaricare i client.

UI upload27/10: costo solo nel popup, dati Mobile automatici/nascosti con AI e
visibili nel manuale. Gli stessi sette campi continuano a essere validati e
scritti. pda_lettura e' metadato client delle bozze/carrello, escluso dal payload
server: nessuna nuova colonna/migration o modifica di dati storici.

Recupero numerazioni27/10: il backend legge anche il testo PDF per coordinate
(unpdf1.9.1) prima di normalizzare SIM/MNP/gestore. Stessi campi e vincoli; nessuna
migration, riscrittura o modifica allo storico/CC/anagrafica.

Codice nascosto nel wizard/carrello AI: stessa validazione, payload, colonna e
UNIQUE; nessuna modifica DB o storico. Manuale e consultazione restano visibili.

Opzioni Mobile27/10: preselezione dal catalogo esistente, senza scritture di
catalogo/collegamenti/punteggi. Codice rivenditore dei nuovi create fissato lato
server a9001415852 (anche con input precedente Cerea); CHECK DB e storico invariati.
Nessuna nuova colonna o migration; pda_opzione_manuale resta solo nel client.

Conferma override opzione27/10: popup solo client prima di cambiare la scelta
automatica; backend, catalogo, punteggi e schema invariati.

Dispositivo automatico27/10: stessi campi dispositivo DB, con nuova conferma UI
prima dell'override. pda_dispositivo_auto/manuale restano nel draft/carrello client,
esclusi dall'invio server. Nessuna modifica schema, storico o catalogo.

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

## Backup e recupero (05/10/2026)

Controllo storico 23/10: ultima copia 17:18:54 Europe/Rome verificata integralmente
(7.298 file/11 bucket, dump leggibile/1.658 voci TOC), nessun nuovo restore SQL.
418/441 copie automatiche riuscite, 23 fallite, massimo intervallo circa 8 ore;
full/checkpoint giornalieri 20-23/10 mancanti, da correggere separatamente.
176 manifest conservati validi; scadenze sintetiche osservate 13/23 ottobre.
Rapporto: [`verifica storico`](../docs/BACKUP_VERIFICA_STORICO_2026-10-23.md).

Runner read-only Aruba in `scripts/backup/`, VPS IT1/Storage R1-IT, cifratura client
AES-GCM/versioni/Compliance. Prima copia completa: 10 bucket/6.579 oggetti; tutti
i 6.584 file riscaricati e verificati da Aruba. Restore DB isolato dalla copia
Aruba: 100 tabelle/51.252 righe con tutti i valori identici, 20,4 secondi,
container senza rete/cron off; API/ACL Supabase gestite non collaudate.
68 test Python sul VPS e 128 npm passati; timer orario enabled/active dopo
collaudo off-site, restore e avvisi errore/assenza. Email errore e custodia chiave confermate. Un PDF assente
nella sorgente recuperato da duplicato con checksum/dimensione verificati, senza
scritture in produzione. Export Netlify autorizzato: 20/28 valori Production
nel secret privato e nel recovery.json cifrato Aruba, readback/confronto verificati;
8 Secret write-only mancanti, utente senza copie. Configurazioni esterne ancora
parziali, nessuna rotazione; inventario statico da aggiornare dopo modifiche.
CA ufficiale Supabase tramite `database.sslrootcert` assoluto e `verify-full`.
Backup nativi fisici 27/09-04/10 presenti; PITR non attivo, nessun restore production.
Audit quotidiano 06:47 UTC e restore DB trimestrale abilitati sul VPS; ultima prova
100 tabelle/51.313 righe identiche in 18,5 s. Docker avviato solo durante la prova
e fermato dopo; controllo scadenza su versione sintetica ancora in osservazione.
Nuovo progetto per restore CRM completo rinviato espressamente dall'utente fino
alla rimozione del Call Center test. Auth SMTP/sessioni/13 template, 7 pagine avanzate e zona DNS
autorevole BIND conservati privatamente; 8 chiavi Netlify ancora mancanti.
Copia indipendente checkpoint 11:46 sul Mac: 6.585 file/1,16 GB, SHA256/AES-GCM
verificati senza rete e senza credenziali S3; strumenti in `.backup-private/offline/`.
Custodia fisica su supporto scollegato ancora da confermare dal proprietario.
Il precedente template AWS
non e' la destinazione scelta. Nessuna migration o modifica schema/RLS richiesta. Dump DB e inventario
Storage condividono uno snapshot; i byte degli allegati sono copiati separatamente.
I file SQL storici non costituiscono un backup dei dati. Il dump custom completo
include oggetti gestiti Supabase e non va applicato integralmente su un nuovo
progetto gestito: serve un restore selettivo collaudato, inclusi Auth, policy Storage
e configurazioni esterne. Restore solo su ambiente isolato; il DB production e'
condiviso col CC storico. Copertura e punti ancora da completare in
[`docs/BACKUP_RIPRISTINO.md`](../docs/BACKUP_RIPRISTINO.md).

## ⚠️ Stato del DB

Fino alla `069_baseline_allineamento.sql` (2026-08-22) i file riflettono lo stato di produzione: la 069 recupera il drift accumulato dalle modifiche fatte a caldo prima del tracciamento. Le categorie di drift recuperate erano:
- Tabelle create direttamente dalla dashboard
- Colonne e indici aggiunti via SQL Editor senza salvare il file qui
- RLS, RPC, trigger e viste applicati a caldo

La correzione Guardian del 2026-08-21 non modifica lo schema: i callback Telegram mantengono la richiesta selezionata in `kona_ai_telegram_sessioni.incidente_attivo_id`, mentre l'archiviazione azzera il riferimento usando le tabelle esistenti.

**Per lo stato attuale, NON fare affidamento su questi file.** Interrogare direttamente Supabase con query di introspezione su `information_schema` e `pg_*` (vedi anche `../CLAUDE.md`).

## Configurazioni mensili gare (06/10/2026)

`configura_gare_2026_10.sql` configura solo i 9 obiettivi ottobre dei tre operatori
canonici Francesca/Matteo/Mirko. Non cambia schema, profili, metriche globali,
RLS, RPC, contratti o altri mesi. Default `applica=false`: preflight senza
scritture; rilettura live e controllo vecchi valori oppure valori nuovi identici.
Applicazione `applica=true` solo dopo il deploy del frontend compatibile; blocco
transazionale in caso di drift, nessun aggiornamento se gia' identico.

`compenso_regola.gara` contiene gli override mensili: descrizione, tipo conteggio,
colonna punti, punto vendita e ID canonici della squadra. `obiettivi_combinati`
contiene importo e condizioni indipendenti nome/soglia/regola, tutte obbligatorie.
TIED35/100 EUR; CB35 telefoni Consumer VAR/Finanziamento +15 cambi piano TIED
Consumer/MOBILE Business (equivalenza confermata)/100 EUR; Assicurazioni10 punti
`punteggio_gara_totale` Legnago della squadra/50 EUR per ciascun destinatario.
Le tre righe Assicurazioni restano per operatore, con la stessa allowlist squadra;
non serve spostare gli obiettivi su operatore NULL. Nessuna migration schema.
Stato: applicata in production il 06/10/2026 dopo il deploy `ab44097`
(Netlify `6ac4e89af38fe1000833072a`). Tutti i 9 obiettivi riletti e confrontati
con la configurazione prevista; hash di tutte le altre righe obiettivi e delle
metriche globali identici alla copia precedente. Preflight successivo riuscito.
Copia precedente privata in `.backup-private/gare-2026-10/prima.json`.
Alla verifica iniziale del06/10: 2 Assicurazioni = 1 punto complessivo squadra.
Rilettura read-only28/10: 7 polizze di Matteo, 5 punti squadra, zero punti
personali Francesca/Mirko; bonus ancora zero fino a 10 punti. Correzione solo
applicativa28/10: Dashboard/PNG mostrano punti personali e squadra distinti;
`tipo_compenso=squadra` valuta il compenso sul totale anche con conteggio personale
(PARTITA IVA:26 Matteo/0 Francesca/11 Mirko, totale37 ->150 EUR ciascuno).
Nessuna migration, scrittura DB o variazione delle regole mensili/scaglioni.

## Conteggio Netto Luce & Gas (26/10/2026)

Solo calcolo applicativo, nessuna migration/scrittura DB. Il netto Standard
richiede stato controllo valorizzato: esclusi vuoti, trattini, Annullato e
Rifiutato (trim/case-insensitive), ammessi gli altri stati anche manuali.
Periodo e perimetro della riga Standard, un pezzo per contratto.
Data/ora accanto: massimo globale del campo esistente `ultimo_csv_upload_at`
(migration020), cioe' ultimo CSV che ha aggiornato almeno una riga. Non usare
`updated_at` o il solo mese corrente; timestamp mostrato in Europe/Rome,
assenza esplicita. Errori query bloccanti. Catalogo/obiettivi invariati.

Riepilogo info: soltanto esiti e conteggi aggregati, nessun dettaglio cliente
o contratto. Il caricamento mensile non richiede join anagrafica/PC/POD; usa
le date contratto gia' lette, senza modifiche schema/RLS/dati. Stati assenti classificati per
Data Inserimento del Controllo L&G (data_contratto, fallback created_at):
dopo ultimo_csv_upload_at globale = Da verificare, prima/uguale = Contratto
non trovato; senza date affidabili = Da verificare. Etichette calcolate,
mai salvate come stati effettivi.

## Luce & Gas P.IVA: esclusione annullati (22/10/2026)

Solo regola applicativa nel motore condiviso: LUCE & GAS P.IVA ed EXTRA GARA
P.IVA escludono `Rifiutato` e `Annullato`, sia pezzi sia punti. Gli altri stati
e l’assenza del controllo restano ammessi. Standard Energia invariato.
Nessuna migration o modifica DB, al catalogo o agli obiettivi.

## Conteggio FISSI Standard (08/10/2026)

Regola applicata dal motore condiviso, senza SQL/migration o modifiche ai dati.
Metrica FISSI Standard: Legnago e Cerea, Consumer/Business, senza KO e
reinserimenti. Non-FTTC: mese `data_contratto`, stati `Da completare`,
`In Attivazione`, `Attivo`; FTTC: solo Attivo e mese `data_attivazione`.
I contratti ancora da verificare, senza riga post-vendita, contano come
pendenti nel mese di firma: il trigger crea la riga solo dopo la verifica.
Tecnologia vuota segue i non-FTTC. Errori di lettura dei controlli bloccanti,
mai assimilati a record assente. Nessuna riga DB creata per il conteggio.
Punteggio somma `punteggio_gara_totale`, obiettivi esistenti conservati.
Altre metriche Avanzamento e Day by Day restano Legnago; alias e operatori
attivi gestiti allo stesso modo da pagina e Target.

## Riga Avanzamento CAMBI PIANO (06/10/2026)

`configura_avanzamento_cambi_piano.sql` inserisce solo una metrica Standard,
`CAMBI PIANO`, ordine35 tra TELEFONI CB30/FISSI40. Default preflight, applicazione
esplicita `applica=true`; lock breve di catalogo e verifica idempotente, nessun
DDL/RLS/RPC/trigger nuovo o modifica delle metriche/obiettivi esistenti.
Match: Customer Base TIED Consumer o MOBILE Business (equivalenza autorizzata).
`punteggio_campo=NULL` usa il conteggio pezzi:1punto anche per i Business con
snapshot0. Per CAMBI PIANO il motore Avanzamento esclude Cerea/reinserimenti e risolve gli alias.
Obiettivo non inserito: si configura mensilmente dall'Admin senza usare la soglia
individuale15 come obiettivo collettivo. La nuova riga vale nel catalogo per tutti
i mesi ed e' letta automaticamente da Dashboard/PNG/Target senza deploy frontend.
Applicata e riletta production:id23, ordine35. Hash delle altre metriche e di
tutti gli obiettivi identici prima-dopo, preflight successivo riuscito.
Verifica reale ottobre:Matteo2,Francesca0,Mirko0, punteggio totale2.

## Elenco file

| File | Cosa introduce |
|---|---|
| `001_create_vendita_upload_contratti.sql` | Tabelle base upload contratti vendita |
| `002_cataloghi_opzioni_reload_e_associazioni_offerta.sql` | Opzioni, reload e link N:M con offerte |
| `003_offerte_abilita_dispositivo.sql` | Flag `abilita_dispositivo` su `vendita_offerte` |
| `004_offerte_abilita_switch_sim.sql` | Flag `abilita_switch_sim` su `vendita_offerte` |
| `005_moduli_vendita_post_vendita.sql` | Tabelle moduli operativi (`vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `post_vendita_dispositivi_comodato`, `post_vendita_gestione_rimborsi`) |
| `006_ticket.sql` | Sistema ticket |
| `007_anagrafica_unificata.sql` | Unificazione anagrafica + RPC `cerca_o_crea_anagrafica` |
| `008_ordini_smartphone_stati.sql` | CHECK constraint stati ordine smartphone |
| `009_bucket_moduli_template.sql` | Bucket `moduli-template` + policy |
| `010_switch_sim_mail_rientro.sql` | Colonna `mail_rientro_inviata_at` per cron giornaliero |
| `011_email_centro.sql` | `email_template` + `email_log` |
| `012_contratti_extra_fields.sql` | `pod_pdr`, `numero_contratto_energia`, `prezzo_fisso`, `reload_exchange` su `vendita_contratti` |
| `013_storico_cliente_vendita_contratti.sql` | Vista `storico_cliente` |
| `014_dashboard_pezzi_giornaliera.sql` | Viste `view_vendita_dashboard_giornaliera` e `_mensile` |
| `015_anagrafica_email_e_pda_doc_rules.sql` | Aggiunge `anagrafica.email`, aggiorna RPC `cerca_o_crea_anagrafica` con `p_email`, disattiva regole `contratto` per Energia/Allarmi/Assicurazioni (refactor wizard PDA-first) |
| `016_vendita_contratti_tipo_firma.sql` | Aggiunge `vendita_contratti.tipo_firma` ('elettronica'/'cartacea'/NULL) per il nuovo step Firma del wizard |
| `017_vendita_contratti_convergenza.sql` | Aggiunge `vendita_contratti.convergenza` (text + CHECK su 7 valori) per i contratti Fisso |
| `048_convergenza_seconda_casa.sql` | Estende il CHECK convergenza aggiungendo il valore 'Seconda Casa' (8 valori totali) |
| `049_bonus_assicurazione_annuale.sql` | INSERT chiave `bonus_assicurazione_annuale` in `impostazioni` (default 0.5) — bonus applicato al `punteggio_gara_opzione` dei contratti Assicurazioni Annuali dal backend |
| `018_post_vendita_controllo_fissi.sql` | Crea `post_vendita_controllo_fissi` (follow-up contratti Fisso) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_fissi` (popolamento automatico al cambio `stato_controllo` su contratti Fisso) + backfill di quelli gia' `controllato`. Il ripristino applicativo admin compare accanto allo stato nel popup e consente di correggere stati `Attivo` o `KO` riportandoli a `In Attivazione`, con conferma, audit aggiornato e rimozione del motivo KO |
| `019_post_vendita_controllo_lg.sql` | Aggiunge `vendita_contratti.ex_fornitore` (obbligatorio per Energia in fase di verifica). Crea `post_vendita_controllo_lg` (follow-up contratti Energia) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_lg` (popolamento automatico al cambio `stato_controllo` su contratti Energia) + backfill |
| `020_lg_csv_import_fields.sql` | Aggiunge a `post_vendita_controllo_lg` le colonne popolate dall'upload CSV WindTre: `causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento` (solo per stato='Rifiutato'), `ultimo_csv_upload_at`, `ultimo_csv_upload_da` (audit). Niente CHECK constraint sullo stato (flessibilita' verso nuovi stati del portale). |
| `021_vendita_contratti_assicurazione_fields.sql` | Aggiunge `vendita_contratti.modalita_pagamento_assicurazione` (CHECK: RID/Carta di Credito/Carta di Debito) e `ricorrenza_assicurazione` (CHECK: Mensile/Annuale). Obbligatori solo per la categoria Assicurazioni nel wizard. |
| `022_post_vendita_controllo_assicurazioni.sql` | Crea `post_vendita_controllo_assicurazioni` (follow-up contratti Assicurazioni) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_assicurazioni` (popolamento automatico al cambio `stato_controllo` su contratti Assicurazioni) + backfill. Tabella minimal (nessuno stato). |
| `023_post_vendita_controllo_allarmi.sql` | Crea `post_vendita_controllo_allarmi` (follow-up contratti Allarmi) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_allarmi` (popolamento automatico al cambio `stato_controllo` su contratti Allarmi) + backfill. Tabella minimal. |
| `024_storico_cliente_extend_call_center.sql` | Estende la vista `storico_cliente` con 4 UNION nuove (`chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`). Il modulo `storico_cliente.html` mostra ora anche chiamate, appuntamenti e blacklist del CC. Vedi "Viste" in `../CLAUDE.md`. |
| `025_chiamate_appuntamenti_anagrafica_autolink.sql` | Trigger `BEFORE INSERT` su `chiamate` e `appuntamenti` per auto-popolare `anagrafica_id` via lookup CF/PIVA. Backfill di 872 chiamate + 9 appuntamenti orfani (ora 100% chiamate / 99.2% appuntamenti collegati). Il CC prod continua a INSERT con `anagrafica_id=NULL`, il trigger lo riempie. |
| `026_vendita_deriva_origine_rpc.sql` | RPC `vendita_deriva_origine(p_anagrafica_id uuid) RETURNS jsonb`. Versione iniziale, priorità: appuntamento confermato oggi → chiamata `passa_in_negozio` ultimi 10gg → default `spontaneo`. Usata dal wizard upload-contratti per pre-compilare `origine_pratica`. |
| `027_vendita_deriva_origine_rilassata_e_autochiusura_cc.sql` | Rilassa `vendita_deriva_origine`: livello 1 copre anche appuntamenti futuri fino a 30 gg, livello 2 include chiamate con `passaggio_stato='in_attesa'`. Aggiunge trigger `trg_vendita_pratica_auto_chiudi_cc` (poi rimosso in 028) e RPC `vendita_chiudi_eventi_cc_per_pratica`. |
| `028_fix_autochiusura_post_commit_e_indici.sql` | DROP del trigger `trg_vendita_pratica_auto_chiudi_cc` (scattava troppo presto, lasciava eventi orfani su rollback). La logica passa nel backend `crea-vendita-pratica-carrello.js` come ultimo step. Introduce indici performance su `appuntamenti`, `chiamate` per la RPC di derivazione. |
| `029_storage_buckets_private_signed_urls.sql` | Rende **privati** 7 bucket dati cliente (`contratti-vendita`, `segnalazioni-files`, `apri-chiudi-files`, `switch-sim-files`, `comodato-files`, `rimborsi-files`, `protecta-files`). Lettura solo via signed URL con `MiroxStorage.signedUrl`. Le colonne `cartella_url` / `preventivo_pdf_url` ora contengono il path nel bucket, non URL pubblici. Vedi "Storage buckets" in `../CLAUDE.md`. |
| `030_rls_segnalazioni_authenticated.sql` | Chiude la tabella `segnalazioni` a `authenticated` (prima anon). Rilassata temporaneamente dalla 032 per il konahub legacy, poi ripristinata dalla 036 (2026-07-02) contestualmente al refactor della pagina segnalazioni. |
| `031_rls_cc_shared_close_anon.sql` | Chiude a `authenticated` le tabelle condivise col CC (`appuntamenti`, `slot_bloccati`, `blocchi`, `orari_standard`, `impostazioni`). Il form pubblico `prenota.html` passa ora per la Netlify function `public-prenota.js` con service_role + rate-limiting. |
| `032_storage_segnalazioni_anon_konahub.sql` | (Storico) Riapre `anon` SELECT + INSERT + UPDATE sulla tabella `segnalazioni` e SELECT + INSERT sul bucket `segnalazioni-files` per il konahub legacy e per la vecchia versione anon di `moduli/segnalazioni.html`. **Revocata dalla 036 il 2026-07-02** (konahub dismesso + pagina modernizzata a auth Mirox). File lasciato in cartella per traccia storica. |
| `033_reinserimenti_contratti.sql` | Anti-doppio-conteggio dashboard mensile. Aggiunge `vendita_contratti.stato_inserimento` (`'inserimento'`/`'reinserimento'`, default `'inserimento'`) + FK auto-referenziale `reinserimento_di_contratto_id` con CHECK di coerenza. Aggiunge `stato` a `post_vendita_controllo_assicurazioni` (NULL/`OK`/`KO`) e `post_vendita_controllo_allarmi` (NOT NULL `In Attivazione`/`OK`/`KO`, default `In Attivazione`) + colonne audit (`stato_cambiato_at`, `stato_cambiato_da`). 2 indici: lookup `(anagrafica_id, categoria_id, data_contratto DESC)` e drill-down inverso su `reinserimento_di_contratto_id`. La regola applicativa attuale ammette come padre solo un contratto dello **stesso mese solare Europe/Rome** e con stato post-vendita idoneo; è validata sia dal wizard sia dal backend. |
| `034_consensi_privacy_otp_cartaceo.sql` | Sistema consensi privacy GDPR. Crea tabella `vendita_consensi_privacy` (modalita' `otp_sms`/`cartaceo`, stato `pending`/`confermato`/`scaduto`/`fallito`/`revocato`, OTP hash+salt, scadenza 48 mesi, snapshot anagrafica jsonb, audit IP/UA) con CHECK + indici dedupe e cleanup + trigger `touch_updated_at` + RLS authenticated SELECT. Crea bucket privato `consensi-privacy` (PDF only, 20 MB) con policy SELECT authenticated. Vedi sezione "Sistema consensi privacy GDPR" in `../CLAUDE.md`. |
| `035_reload_forever_smartphone_reload.sql` | Aggiunge a `vendita_contratti` due bool `reload_exchange` + `reload_forever` (Mobile/Customer Base) e `smartphone_reload` + `smartphone_reload_modalita` (dispositivo associato). CHECK di coerenza `modalita NOT NULL ⇔ smartphone_reload IS TRUE`. Il catalogo `vendita_reload` è dismesso ma tabella/FK conservate per dati storici. Vedi "Note operative consapevoli" in `../CLAUDE.md`. |
| `036_segnalazioni_revoke_konahub_anon.sql` | Revoca le 5 policy `anon` introdotte dalla 032 (SELECT/INSERT/UPDATE su `segnalazioni` + SELECT/INSERT su bucket `segnalazioni-files`). Contestuale al refactor di `moduli/segnalazioni.html` che ora usa `js/config.js` + `Auth.richiediAuth`: tutte le chiamate viaggiano come `authenticated`. Il modulo funziona SOLO da Mirox loggato. Vedi sezione "Storage buckets" in `../CLAUDE.md`. |
| `038_gare_individuali_avanzamento_mensile.sql` | Modulo Gare & Avanzamento (Dashboard Pezzi, dal 2026-07-09). Aggiunge `profili.in_gara` (bool, default false). Crea `gara_metriche` (catalogo righe per le 4 tabelle: `gara_individuale` / `avanzamento_standard` / `avanzamento_piva` / `avanzamento_extra_piva`, con `regola` JSONB matching contratti + `punti_per_pezzo` per l'avanzamento mensile) e `gara_obiettivi_mensili` (`anno`, `mese`, `metrica_id`, `operatore_id` NULLABLE = obiettivo di categoria, `obiettivo` int, `compenso_regola` jsonb DSL scaglioni+bonus). Trigger `updated_at` su entrambe. UNIQUE index parziale per unicita' `(anno, mese, metrica, operatore)` con NULL coalesced. RLS SELECT authenticated + seed 21 metriche base coerenti col Google Sheet legacy. |
| `039_gare_rls_admin_write.sql` | Policy scrittura admin per `gara_metriche` e `gara_obiettivi_mensili` (INSERT/UPDATE/DELETE gated da subquery `profili.ruolo='admin'`). Grant su sequenze `_id_seq` per l'INSERT lato admin. |
| `041_gare_metriche_squadra_e_protecta.sql` | Aggiunge `gara_metriche.tipo_conteggio` text NOT NULL DEFAULT 'individuale' CHECK IN ('individuale','squadra'). Le metriche `squadra` calcolano l'ATTUALE sommando tutti gli operatori del mese e l'obiettivo/compenso e' salvato con `operatore_id=NULL` (comune, uguale per ogni operatore in gara). Refactor seed: `PROTECTA` diventa 2 righe (`PROTECTA - Finanziato` con `modalita_pagamento=Finanziamento` su Allarmi + `PROTECTA - Anticipo` con `modalita_pagamento=Anticipo` su Allarmi) cosi' i compensi differenziati (es. €50/pz vs €30/pz) si configurano come metriche indipendenti senza inventare DSL condizionali. `PARTITA IVA` passa a `tipo_conteggio='squadra'`. |
| `040_profili_alias.sql` | Aggiunge `profili.alias_di uuid` (self-FK) per unificare due account della stessa persona in un unico operatore ai fini dei report. Trigger generico `trg_alias_operatore` agganciato a 9 tabelle (`vendita_contratti`, `vendita_pratiche`, `vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `vendita_simulatore_protecta`, `vendita_consensi_privacy`, `post_vendita_gestione_rimborsi`, `ticket`) che redireziona `operatore_id` al canonico su ogni INSERT/UPDATE. Funzione `risolvi_operatore_canonico(uuid)` (max 3 hop). RPC `applica_alias_backfill(uuid)` riassegna tutti i record storici di un alias al canonico e ritorna un jsonb con il conteggio per tabella (chiamata dall'UI in `admin-utenti.html`). |
| `053_hardening_scritture_e_bonifica_storico.sql` | Revoca EXECUTE anon dalle RPC SECURITY DEFINER sensibili senza modificarne i body; aggiunge `applica_alias_backfill_v2(uuid)` SECURITY DEFINER con controllo admin; completa `vendita_pratiche.operatore_id` e `vendita_documenti.uploaded_by` storici; corregge a Cerea i 35 contratti del profilo Cerea; elimina 16 record documento duplicati e aggiunge UNIQUE `(storage_bucket, storage_path)`. È applicabile prima del deploy senza interrompere il frontend corrente. |
| `054_post_deploy_chiudi_scritture_browser.sql` | Migration post-deploy: disabilita l'invocazione client di `applica_alias_backfill` v1 e rimuove le policy di scrittura browser su `vendita_contratti`, `vendita_documenti` e sui sette bucket dati ora serviti dalle Netlify Functions. Applicare solo dopo il deploy di `upload-documento-modulo`, `gestisci-vendita-contratto` e dei relativi refactor frontend. |
| `055_privacy_24_mesi_prenotazioni_atomiche.sql` | Porta a 24 mesi la scadenza massima dei consensi/dichiarazioni privacy già confermati (la migration storica 034 nasceva con 48 mesi), chiarisce i commenti DB su presa visione e consenso marketing, crea il rate limit pubblico persistente `mirox_public_rate_limits` + RPC service-role `mirox_public_rate_limit_v1` e la RPC service-role `public_prenota_appuntamento_v1`. Quest'ultima serializza le richieste concorrenti con advisory lock e ricontrolla lo slot nella stessa transazione dell'INSERT senza modificare le RPC o le colonne condivise col Call Center legacy. |
| `056_operazioni_sensibili_admin.sql` | Migration post-deploy: rende `post_vendita_gestione_rimborsi` scrivibile soltanto dalla service role, limita la relativa RPC di generazione codice al backend e aggiunge un trigger che consente di introdurre `vendita_apri_chiudi.stato='KO'` soltanto ad admin o service role. Dal 2026-08-27 `mark_apri_chiudi_ko` è un'azione backend per tutti gli account autenticati attivi e usa la service role dopo il controllo JWT; il trigger continua a bloccare le scritture browser dirette dei non-admin. |
| `057_deduplica_anagrafiche.sql` | Consolida 7 duplicazioni anagrafiche certe dovute a zero iniziale P.IVA omesso, carattere di controllo CF errato o identificatore import manifestamente invalido. Completa il survivor, sposta tutte le 19 FK effettive, registra il loser completo in `vendita_log_modifiche` e poi lo elimina. Le omonimie con CF/P.IVA validi distinti non vengono toccate. |
| `058_integrita_e_audit_punteggi.sql` | Aggiunge e valida 3 CHECK di coerenza per componenti/totali gara, extra e colonne legacy; crea `vendita_audit_punteggi()` + trigger AFTER per registrare ogni nuovo contratto e ogni futura variazione dei quattro componenti in `vendita_log_modifiche`. |
| `059_deduplica_anagrafica_test_case.sql` | Consolida l'ultimo doppione tecnico case-insensitive `TEST`/`test`, due righe di collaudo prive di riferimenti operativi. Conserva la riga più vecchia, aggiorna dinamicamente ogni FK reale e audita integralmente il loser prima della cancellazione. |
| `060_ripristina_bonus_assicurazioni_annuali.sql` | Ripristina 0,5 punti su 3 Assicurazioni Annuali di luglio: il vecchio bug di verifica aveva azzerato il bonus e il riallineamento successivo al solo catalogo base non poteva ricostruirlo. Guardie su ID/stato/bonus, ricalcolo totali via trigger e marcatura dei 3 audit generati dalla migration 058. |
| `061_ripristina_opzione_iliad_snapshot.sql` | Ripristina ID e nome dell'opzione MNP Iliad da 1 punto su 7 contratti Mobile: il punteggio era già corretto, ma il vecchio flusso di verifica aveva perso i metadati opzione. Evidenza verificata sui 7 PDA (`Operatore attuale: Iliad Italia`), copia SIM presente, associazione offerta-opzione valida e audit esplicito per ogni riga. |
| `062_controllo_lg_esiti_manuali.sql` | Aggiunge a `post_vendita_controllo_lg` origine dello stato, blocco CSV, motivazione/autore/data dell'esito manuale e audit dello sblocco. CHECK di coerenza, indice parziale e trigger DB consentono la gestione manuale soltanto ad admin/service role e impediscono agli operatori di sovrascrivere una riga protetta. |
| `063_compilatore_disdette.sql` | Crea la tabella server-only `disdette_generate` per lo storico minimo dei quattro moduli di recesso e il bucket privato `disdette-files` (PDF, max 5 MB). Revoca ogni accesso diretto a `anon`/`authenticated`: generazione, elenco e signed URL passano esclusivamente dalla function autenticata `gestisci-disdette`. Migration additiva e isolata dalle tabelle condivise col Call Center. |
| `064_disdette_duplica_ricerca.sql` | Estende soltanto `disdette_generate` con `utenza` e `dati_compilazione jsonb`, entrambi server-only, per mostrare il numero cessato e duplicare i dati tra SIM/Fisso dello stesso cluster. Non modifica `anagrafica`: la ricerca CRM è una lettura autenticata eseguita dalla Function. |
| `065_kona_ai_guardian.sql` | Crea le quattro tabelle server-only del primo agente KONA AI Guardian: incidenti, messaggi, approvazioni e sessione Telegram. Revoca ogni accesso diretto ad `anon`/`authenticated`, conserva audit delle decisioni di Mirko e imposta a 90 giorni la scadenza obiettivo dei dettagli tecnici. Migration additiva e isolata dalle tabelle condivise col Call Center. **Applicata il 2026-08-10 a staging `blwgxrszvsoqcmcmhhqr` e production `lbgwamhjkjjfwgusafbi`.** |
| `066_kona_ai_tipologia_richiesta.sql` | Estende soltanto il dominio Guardian con `kona_ai_incidenti.tipo_richiesta IN ('problema','miglioria')`, indice per tipo/stato e indice univoco dell'approvazione attiva `prepara_fix`. Le righe esistenti diventano `problema`; nessuna tabella CRM o Call Center viene modificata. **Applicata il 2026-08-10 a staging `blwgxrszvsoqcmcmhhqr` e production `lbgwamhjkjjfwgusafbi`.** |
| `067_kona_ai_codex_esecuzioni.sql` | Crea `kona_ai_esecuzioni`, tabella server-only per il contratto operativo delle esecuzioni Guardian/Codex: fase, stato, workflow, commit, branch, pull request, heartbeat, timeout ed esito. Include un indice univoco per impedire due esecuzioni attive dello stesso tipo sulla stessa richiesta. Additiva e isolata dalle tabelle CRM/Call Center. **Applicata il 2026-08-11 a staging `blwgxrszvsoqcmcmhhqr` e production `lbgwamhjkjjfwgusafbi`.** |
| `068_kona_ai_observer.sql` | Aggiunge il dominio server-only del Guardian Observer: `kona_ai_eventi_tecnici` (eventi già ripuliti, retention 30 giorni), `kona_ai_segnali` (fingerprint e soglie), `kona_ai_notifiche` (outbox Telegram con retry) e `kona_ai_observer_checkpoint` (checkpoint/budget). Estende in modo additivo i tipi di `kona_ai_esecuzioni` con `analisi_automatica` e `scansione_migliorie`; non modifica tabelle CRM/Call Center. **Applicata il 2026-08-11 a staging `blwgxrszvsoqcmcmhhqr` e production `lbgwamhjkjjfwgusafbi`.** |
| `069_baseline_allineamento.sql` | **Baseline di allineamento** (NON applicare su produzione). Recupera il drift non tracciato dello schema `public`: 18 tabelle, 62 colonne, 73 policy RLS, 32 function, 32 trigger, 53 indici, 2 viste, 1 sequence. Da applicare solo su database puliti dopo 001–068. |
| `070_comuni_istat_normalizzazione_anagrafica.sql` | Crea il catalogo server-only `mirox_comuni_istat` con 7.893 comuni ufficiali aggiornati al 21/02/2026, RLS senza accesso browser e indice per autocomplete prefix. Aggiunge su `anagrafica` il trigger sintattico non bloccante `trg_anagrafica_normalizza_localita`, che uniforma maiuscole, spazi, apostrofi ed entità HTML su INSERT/UPDATE senza rifiutare località legacy. **Applicata il 2026-08-26 a production `lbgwamhjkjjfwgusafbi`.** |
| `071_bonifica_localita_anagrafica.sql` | Bonifica transazionale delle località storiche: 1.094 aggiornamenti verificati (formato, province derivabili, accorpamenti/frazioni e decisioni manuali), eliminazione della sola riga isolata `ALTEDO` e conservazione delle due anagrafiche con storico tramite azzeramento della località errata. Crea `mirox_anagrafica_localita_audit`, server-only e con RLS, includendo lo snapshot recuperabile del record eliminato. Le 119 province con sigla corrente ma in conflitto restano intenzionalmente escluse. **Applicata il 2026-08-26 a production `lbgwamhjkjjfwgusafbi`.** |
| `072_limita_telefoni_cb_dashboard.sql` | Allinea `TELEFONI CB` di Gare Individuali e Avanzamento Mensile al KPI Customer Base Consumer: conta soltanto `Telefono Incluso` con dispositivo associato e `tipo_acquisto` VAR o Finanziamento, escludendo Cambi Piano e Caring. |

| `20261005185700_mirox_ai_target.sql` | Nuove `mirox_target_sessioni` e `mirox_target_jobs` server-only: memoria, lease, coda con dedupe/checkpoint e stato incerto. RLS e grant espliciti alla sola service role; nessun cambio a tabelle CC/RPC esistenti. Migration applicata il 05/10/2026 a production `lbgwamhjkjjfwgusafbi`; versione locale allineata al registro Supabase. RLS e privilegi anon/authenticated/service_role verificati. |
| `20261027172616_verifica_automatica_contratti.sql` | Verifica documentale: configurazione default collaudo, lavori/esiti, CSV, letture cache, audit/outbox privati, nuovi trigger/RPC solo vendita. **Applicata production27/10, versione20261027172616**. PGlite e rilettura grant/configurazione riusciti; nessuna modifica CC o stato contratto. |
| `20261018180938_compilatore_subentri.sql` | Crea `subentri_generati` con bozze idempotenti private per operatore, manifest allegati immutabile, snapshot e indice dei PDF generati; bucket privato `subentri-files` per PDF/JPEG/PNG max 4 MiB. RLS e grant solo service role, nessuna policy Storage browser, nessuna modifica alle tabelle condivise. **Applicata e verificata il 18/10/2026 su production `lbgwamhjkjjfwgusafbi`**; anon/authenticated senza SELECT/INSERT, archivio inizialmente vuoto. |
| `20261018184140_subentri_modalita_compilazione.sql` | Aggiunge `subentri_generati.modalita_compilazione` con valori `invia_pratica` (default compatibile con lo storico) e `standard`. CHECK documenti condizionale: 3–12 file per Invia pratica, array vuoto per standard. **Applicata e verificata il 18/10/2026**: casi validi/invalidi provati in transazione con rollback, zero record conservati; RLS/grant/bucket e tabelle CRM/CC invariati. Pubblicazione delle due modalità richiesta il 19/10/2026; esito nel promemoria. |

Dal 05/10 i nuovi report Target salvano in `messaggi` una stringa vendite e due
oggetti immagine (SVG, dimensioni, caption e testo alternativo). Il JSONB array
esistente li supporta: nessuna nuova migration. PNG non salvati nel DB/Storage,
memoria conversazione solo testo e compatibilita con i job precedenti stringa.
Gli intenti AI di invio sono risolti prima di salvare i messaggi: richieste
libere e cron conservano gli stessi snapshot/formati e checkpoint esistenti.

## Bootstrap esclusivi staging

| File | Cosa introduce |
|---|---|
| `20261005110504_guardian_owner_conversation.sql` | Memoria degli ultimi 30 messaggi Telegram del proprietario nella colonna JSONB `conversazione` di `kona_ai_telegram_sessioni`. Additiva/server-only, nessun cambio grant/RLS o tabelle condivise. **Applicata e verificata production il 05/10/2026**, su richiesta esplicita del proprietario. Nome timestamp generato da CLI per evitare collisioni Call Director. |
| `staging/001_guardian_bootstrap.sql` | Bootstrap one-shot del Supabase `Mirox CRM - Staging` (`blwgxrszvsoqcmcmhhqr`): crea la sola tabella `profili` minima per Auth/Guardian, con SELECT autenticata limitata al proprio UUID. Un guard interrompe l'esecuzione se `public` contiene gia' tabelle, quindi non puo' essere applicato accidentalmente al production corrente. Non crea utenti e non copia dati. |

## Linee guida

- **Non aggiungere nuove migrazioni** senza coordinarle con l'utente
- Per nuove modifiche schema: applicare via SQL Editor Supabase E aggiungere il file qui con prefisso numerico progressivo (`015_`, `016_`, ...) oppure timestamp generato con `supabase migration new` per evitare collisioni tra filoni
- **Anche** RLS policies, RPC, trigger, viste e indici vanno salvati in un file `.sql` con prefisso progressivo, come tabelle e colonne. L'eccezione precedente ("possono evolvere senza file") è rimossa: è la causa del drift recuperato dalla migration `069`
- Quando si aggiunge un nuovo file `.sql` in questa cartella, **aggiornare contestualmente la tabella "Elenco file"** sopra (regola di manutenzione documentale — vedi sezione "Manutenzione di questa guida" in `../CLAUDE.md`)

## Registro aggiornamenti

- **2026-10-18, ricerche Subentri**: modifica solo applicativa, nessuna migration/schema/RLS o scrittura anagrafica. La Function accetta esclusivamente P.IVA completa per il cedente e CF personale completo per il subentrante, normalizza maiuscole e cerca il solo `cf_piva` esatto (case-insensitive), mantenendo il filtro cluster. Il browser presenta l’intestatario selezionato al posto della ricerca, con Annulla indipendente.

- **2026-10-18, Compilatore Subentri**: migration `20261018180938_compilatore_subentri.sql` generata dalla CLI e conservata in `/database/`, applicata su autorizzazione allo sviluppo completo. Nuova tabella/bucket isolati senza FK, trigger, RPC o modifiche RLS a tabelle CRM/CC. RLS ON senza policy e nessun privilegio anon/authenticated; service role autorizzata. Bucket privato, MIME/limite riletti, zero record reali. Advisor aggiunge soltanto [INFO intenzionale RLS senza policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) sulla nuova tabella; avvisi preesistenti invariati. Backend e browser collaudati con dati sintetici, pubblicazione codice autorizzata il 18/10/2026, esito nel promemoria.

- **2026-10-05, identita per contratto**: nessuna migration/schema/RLS modificati. Nuovi carrelli: PDF distinti e INSERT batch in `vendita_documenti` per tutti i contratti, controllo copertura prima di `finalize`. Bonifica autorizzata dal 01/07/2026 Europe/Rome con `scripts/backfill-identita-contratti.js`: solo aggiunta di record/copie mancanti, SHA256/readback, originali invariati e UNIQUE `(storage_bucket, storage_path)` rispettata. `--same-client` e un'eccezione esplicitamente autorizzata dal proprietario per il PDF piu recente di uno stesso `anagrafica_id`. Piano/provenienza e risultati in `.backup-private/identity-backfill/`, mai nella build/Git. Esito finale nel promemoria e in `docs/IDENTITA_CONTRATTI_2026-10-05.md`.

- **2026-09-01**: applicata su production la migration `072`. Le due metriche `TELEFONI CB` (`gara_individuale` e `avanzamento_standard`) usano ora la stessa regola del KPI Customer Base Consumer. La verifica su agosto 2026 riconcilia entrambe a 58 telefoni, escludendo 8 Cambi Piano TIED e 3 Caring Mobile prima inclusi nel totale 69.
- **2026-08-27**: modifica frontend/backend senza cambio schema. Nel riepilogo Apri/Chiudi il passaggio `IN CORSO` → `KO` è disponibile a tutti gli account autenticati attivi tramite `mark_apri_chiudi_ko`; la Function verifica ancora lo stato corrente e aggiorna con service role. Il trigger della migration `056` resta invariato e continua a bloccare le scritture dirette dei non-admin.
- **2026-08-26**: applicata su production la migration `071` dopo simulazione integrale in rollback. Verifica post-migration: 1.094 update e 1 delete nell'audit, 8.808 anagrafiche residue, zero comuni non riconosciuti tra i valori ancora compilati, `CAPITELLO` riallineato a `CONCAMARISE (VR)`, `ALTEDO` eliminata e tutti i 7 riferimenti storici delle due anagrafiche non determinabili conservati. `mirox_anagrafica_localita_audit` ha RLS attiva, nessun grant browser e accesso SELECT solo service role; l'unico advisor specifico è l'INFO intenzionale `rls_enabled_no_policy`.
- **2026-08-26**: applicata su production la migration additiva `070`. Verifica post-migration: 7.893 comuni nel catalogo ISTAT server-only, zero grant ad `anon`/`authenticated`, RLS attiva, indice prefix utilizzato dalla query di autocomplete e trigger sintattico testato su tabella temporanea (`boschi sant&#039;anna` + `vr` → `BOSCHI SANT'ANNA` + `VR`). Nessuna riga cliente è stata riscritta dalla migration.
- **2026-08-22**: generata e tracciata la migration di baseline `069_baseline_allineamento.sql`, che recupera il drift dello schema `public` accumulato dalle modifiche fatte a caldo prima del tracciamento. Non applicata su production (gli oggetti esistono già); serve a riprodurre lo stato attuale su database puliti e come punto di partenza per il tracciamento futuro.
- **2026-08-10**: attivato Guardian sul production `lbgwamhjkjjfwgusafbi` applicando le migration additive `065` e `066`. Verifica post-migration: 4 tabelle Guardian, RLS attiva su tutte, zero grant ad `anon`/`authenticated`, default e CHECK problema/miglioria e indice univoco `prepara_fix` presenti. Nessuna tabella condivisa col Call Center modificata.
- **2026-08-10**: creato il progetto Supabase separato `Mirox CRM - Staging` (`blwgxrszvsoqcmcmhhqr`, `eu-west-3`) e applicati, in quest'ordine, `staging/001_guardian_bootstrap.sql`, `065_kona_ai_guardian.sql` e `066_kona_ai_tipologia_richiesta.sql`. Il controllo post-migration conferma RLS attiva, nessun privilegio Guardian per `anon`/`authenticated`, colonna `tipo_richiesta` con CHECK problema/miglioria, indici Guardian attesi, accesso completo della sola `service_role` e nessun dato CRM copiato. E' stato poi creato il solo account Auth di Mirko e il corrispondente profilo `admin`.
- **2026-08-11**: applicate sul Supabase staging `blwgxrszvsoqcmcmhhqr` e poi sul production `lbgwamhjkjjfwgusafbi` le migration additive `067_kona_ai_codex_esecuzioni.sql` e `068_kona_ai_observer.sql`, dopo verifica del dominio Guardian esistente. Il controllo production conferma 5 tabelle Observer/Codex, RLS attiva su tutte, zero grant ad `anon`/`authenticated` e il vincolo aggiornato sui tipi di esecuzione. Nessun dato CRM e nessuna tabella condivisa Call Center sono stati modificati.
- **2026-08-11**: corretto l'export del collector telemetria, che veniva importato dal worker Guardian e causava un errore runtime Netlify `handler is not defined`; il fix è incluso nel rilascio production insieme ai controlli di separazione HMAC tra worker staging e production.
- **2026-10-18**: Compilatore disdette: prima scelta del tipo di modulo, poi ricerca cliente obbligatoria nel frontend, anche entrando da duplicazione. Ricerca senza risultati apre il modulo scelto vuoto per la compilazione completa manuale; errori non sbloccano il form. Riusa `gestisci-disdette`, `disdette_generate` e il bucket esistenti: nessuna migration, scrittura anagrafica o modifica schema/RLS.
- **2026-08-07**: migrations `063` e `064` applicate su production. La `063` aggiunge `disdette_generate` e il bucket `disdette-files`; la `064` estende soltanto quella tabella con numero cessato e snapshot server-only. Nessuna delle due modifica tabelle, RPC o policy del Call Center condiviso.
- **2026-07-27**: migration `062` applicata su production. Controllo L&G distingue gli stati CSV dagli esiti manuali admin-only, conserva motivazione/autore/data e impedisce agli upload successivi di sovrascrivere una riga protetta finche' un admin non riattiva esplicitamente l'automatismo.
- **2026-07-26**: migrations `057`–`061` applicate su production. Otto duplicazioni anagrafiche certe consolidate (8.477 → 8.469 record), incluse le due righe di collaudo `TEST`/`test`; tutte le FK spostate e loser auditati, nessuna omonimia con identificativi validi distinti è stata unita. L'audit di 247 contratti luglio ha confermato gli 8 totali zero legittimi, corretto 3 Assicurazioni Annuali rimaste senza bonus 0,5 e ripristinato l'opzione Iliad su 7 contratti il cui punto era già corretto. Attivati CHECK e audit permanente dei punteggi.
- **2026-07-26**: migration `056` applicata su production dopo il deploy di `gestisci-operazioni-post-vendita`. Al momento del rilascio rimborso manuale e passaggio Apri/Chiudi a `KO` erano entrambi esclusivamente admin; la regola applicativa del KO è stata poi estesa agli account autenticati il 2026-08-27, senza modificare il trigger DB.
- **2026-07-26**: migration `055` applicata su production. Ha ridotto a 24 mesi la scadenza di 170 documenti privacy confermati (nessuna scadenza immediata), attivato il rate limit pubblico persistente e aggiunto la prenotazione appuntamenti atomica. È additiva sulle tabelle Call Center condivise: non modifica `get_slot_disponibili` né colonne/RPC esistenti.
- **2026-07-26**: migrations `053` + `054` e refactor frontend/backend. La `053` contiene bonifica storico, indice anti-duplicati, hardening RPC e alias v2; la `054` è deliberatamente post-deploy e chiude le RLS di scrittura browser. Upload PDF dei moduli operativi e PDF/immagini per Segnalazioni via `upload-documento-modulo`/`MiroxStorageUpload`; Verifica Contratti via `gestisci-vendita-contratto`.
- **2026-08-21**: modifica solo frontend/test per il Simulatore Protecta. Il preventivo non viene inserito se l’upload non restituisce un `storage_path`; nessuna modifica allo schema Supabase o ai bucket. Gli sconti separati su anticipo e rata sono salvati nel JSONB `vendita_simulatore_protecta.preventivo_payload.calcolo` insieme ai valori originali/applicati; con finanziamento la rata viene confrontata tramite la tabella finanziaria e può restare invariata se il totale non cambia fascia.
- **2026-08-21**: la stessa struttura JSONB conserva anche `totale_sconto_attivo`, `totale_sconto` e `scadenza_preventivo`: il totale sconto è un'evidenza manuale indipendente dai calcoli, mostrata in grande nel riepilogo/PDF, mentre la scadenza è un testo manuale riportato tra canone totale mensile e rimborso detrazione fiscale con dimensione maggiore. Nessuna migration Supabase è richiesta.
- **2026-07-25**: hardening applicativo senza modifica schema. Il wizard propaga correttamente `codice_rivenditore` e i campi reinserimento; il backend valida il reinserimento nello stesso mese solare e stato post-vendita, deriva operatore/upload dal JWT e usa il ciclo pratica `bozza` → upload → `finalize` con rollback compensativo su errore. `upload-vendita-documento` verifica PDF e relazioni tra UUID. Nessuna migration Supabase richiesta.
- **2026-07-02**: modifiche solo frontend/mailer, nessun cambio schema Supabase. Aggiornati layout `dashboard_pezzi` con larghezza tabella fissata a 622px (270px offerte + 4 colonne operatori da 88px), redirect post-invio e validazione cluster `Turista` di `upload-contratti-vendita` (indirizzo nascosto/non richiesto, opzione contratto non richiesta), favicon mancanti e link CTA delle email di comunicazione verso `https://www.mirox-crm.it`.
- **2026-07-02**: aggiunta cancellazione definitiva da Verifica Contratti senza nuova migration. La function admin-only `elimina-vendita-contratto` usa le FK/cascade gia' presenti (`vendita_documenti` e tabelle post-vendita su `vendita_contratti`) e rimuove gli allegati Storage; se la pratica resta senza contratti elimina anche `vendita_pratiche`. L'anagrafica non viene cancellata.
- **2026-07-03**: modifica solo frontend, nessun cambio schema Supabase. `js/mirox-upload.js` ora mostra anteprima PDF prima di mantenere file selezionati o trascinati nei moduli Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato.
- **2026-07-03**: modifica solo frontend, nessun cambio schema Supabase. `moduli/verifica_contratti.html` aggiunge filtro per giorno specifico nelle tab Da Verificare e Verificati, calcolato su `vendita_contratti.data_contratto`.
- **2026-07-03**: modifica solo frontend, nessun cambio schema Supabase. `moduli/verifica_contratti.html` mostra e salva `vendita_contratti.convergenza` nel popup dettaglio dei contratti Fisso, usando la colonna gia' introdotta dalla migration 017.
- **2026-07-03**: modifica solo backend, nessun cambio schema Supabase. Per cluster vendita `Turista`, `garantisci-anagrafica` e `crea-vendita-pratica-carrello` salvano `anagrafica.cluster='Consumer'` e mantengono `vendita_contratti.cluster_cliente='Turista'`, evitando modifiche al CHECK della tabella condivisa `anagrafica`.
- **2026-07-03**: modifica frontend/backend, nessun cambio schema Supabase. Per cluster vendita `Turista`, `upload-contratti-vendita` nasconde/invia `email=null` e le functions `garantisci-anagrafica` / `crea-vendita-pratica-carrello` non richiedono email; per `Consumer`/`Business` resta obbligatoria.
- **2026-07-09**: nuovo modulo **Gare & Avanzamento** (migrazioni 038 + 039). Dashboard Pezzi passa a 3 tab: Day by Day (invariata), Gare Individuali (una tabella per operatore `in_gara` con ATTUALE / OBIETTIVO / COMPENSO) e Avanzamento Mensile (3 sezioni Standard / P.IVA / Extra con pezzi per operatore, punteggio, andamento %, eccedenza). Nuova pagina admin `admin-gare.html` con editor visuale scaglioni + bonus una tantum e bottone "Duplica dal mese precedente".
- **2026-07-09**: alias tra profili (migrazione 040). `profili.alias_di` unifica due account della stessa persona ai fini di Dashboard Pezzi, Gare e report. Trigger BEFORE INSERT/UPDATE su 9 tabelle riscrive `operatore_id` sul canonico; RPC `applica_alias_backfill` riassegna anche il pregresso. In `admin-utenti.html` nuova colonna "Alias di" con dropdown + backfill guidato.

### Baseline Guardian settembre (05/10/2026)

Intervento applicativo documentato in `../docs/GUARDIAN_BUG_SETTEMBRE_2026.md`.
Non modifica schema, RPC, RLS o dati commerciali/consensi reali. Dopo deploy
verificato aggiorna solo gli stati dei casi Guardian KG8–21 e dei segnali
collegati, aggiungendo messaggi di audit. Storico messaggi/esecuzioni conservato;
incidenti tecnici mitigati e scansioni fallite sono archiviati con motivazione,
non dichiarati bug risolti. Nuovi eventi sono separati dal commit di rilascio.

### Guardian: conferma finale Telegram, 05/10/2026

Nessuna nuova migration: `kona_ai_approvazioni.risultato.release_contract` lega
l’approvazione al commit patch, base main, PR e test; la transizione condizionale
`in_attesa` → `approvata` è consumabile una volta sola. L’esecuzione di rilascio
usa lo stesso UUID, conserva il contratto nell’audit e chiude l’incidente soltanto
dopo verifica del commit distribuito e salute Guardian. Notifica persistente in
`kona_ai_notifiche`. Tabelle CRM/Call Center, schema, grant e RLS invariati.

### Guardian: coda vocali, 06/10/2026

`20261006190000_guardian_voice_jobs.sql` aggiunge solo `kona_ai_vocali_jobs`:
file/update ID univoco, incidente originale, trascrizione/risposta, checkpoint
invio, lease e massimo cinque tentativi. Indice parziale: una elaborazione per
chat. RLS e grant solo service_role; nessuna modifica schema/RLS a tabelle CRM,
Call Center o Target. Applicata e verificata production il 06/10/2026 prima del deploy: RLS attiva,
privilegi browser assenti e indice univoco presenti. Riclassificazione usa le colonne esistenti
`tipo_richiesta`/`riepilogo_ai` e audit, senza ulteriori DDL.

Guardian06/10: collegamento `kona_ai_messaggi.voice_job_id` UUID con unicita
per autore; `id` messaggio resta bigint GENERATED ALWAYS e non va fornito
dal client. Migration additiva `20261006194000_guardian_voice_message_link.sql`,
privata Guardian, senza cambi CRM/Call Center. Errori coda distinguono fase e
codice tecnico ripulito, senza stampare testo dei vocali o segreti.

Guardian06/10: il consenso allo sviluppo e alla prosecuzione dei test e' conservato
nel JSON `risultato.development` di `kona_ai_approvazioni`/`kona_ai_esecuzioni`: hash
requisito, owner, sorgente e ID messaggio/job. Il worker non puo' attribuirsi questa
autorita' con il risultato. Nessuna migration o modifica alle tabelle CRM/CC;
restano RLS server-only e vincoli delle esecuzioni attive esistenti.

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

## Proposta Customer Base con telefono (06/10/2026)

`../netlify/functions/_lib/guardian-catalog-kg23.json` è una configurazione dati
transazionale, non una migration schema: propone due offerte Consumer Customer
Base (`Cambio Piano + Telefono Finanziato` e `Cambio Piano + Telefono VAR`) a 1
punto complessivo ciascuna, con dispositivo abilitato, e due righe Day by Day
separate per `Finanziamento` e `VAR`. L’applicazione tramite RPC richiede conferma finale Telegram e precondizioni
sulle righe attese, senza SQL libero. Non è ancora attivo.

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
