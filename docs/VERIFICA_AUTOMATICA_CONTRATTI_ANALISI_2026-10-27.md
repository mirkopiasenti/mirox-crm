# Verifica automatica contratti — analisi del processo

Aggiornamento: versione sviluppata, migration applicata e rilascio autorizzato
in modalità collaudo, descritto nella
[guida operativa](VERIFICA_AUTOMATICA_CONTRATTI.md). Il resto del documento conserva
analisi iniziale e proposte; la guida distingue quanto effettivamente implementato.
Decisioni finali: identità valida alla data firma; Business sul firmatario PDA.

Data analisi: 27/10/2026. Base applicativa: `main`, commit `883c485`.
Richiesta: rendere automatica la verifica, comprese integrazione dati e correzioni,
eliminando la pressione ordinaria di «Conferma verifica».

Analisi del codice locale, documentazione e test; nessun accesso browser,
interrogazione production, chiamata AI, modifica applicativa o deploy.
Le migration locali descrivono gli effetti attesi e non certificano da sole il DB vivo.
La checklist della sezione 3.1 è stata confermata dal proprietario durante questa
chat. Architettura e modalità operative proposte restano da definire; nulla è attivo.

## 1. Processo attuale ricostruito

1. Il wizard raccoglie uno o più contratti della stessa pratica/anagrafica.
   Mobile, Customer Base e Fisso richiedono PDA; la lettura AI è opzionale.
   Energia, Allarmi e Assicurazioni seguono attualmente il percorso senza PDA.
2. L'OCR precompila dati cliente, identificazione PDA, numerazioni Mobile,
   costo base, dispositivo e tipo attivazione Fisso. Non produce un verbale
   di verifica con evidenze per campo, pagine e criteri superati.
3. Il backend crea la pratica in `bozza` e i contratti in `da_controllare`;
   promuove i PDA e il client carica gli altri allegati.
4. `finalize` controlla la presenza del record identità per ciascun contratto
   e porta la pratica a `inviata`. Questo è anche il punto di chiusura degli
   eventi CC; non coincide con la successiva verifica documentale.
5. Verifica Contratti elenca i contratti per `stato_controllo`. La query non
   filtra esplicitamente `vendita_pratiche.stato_pratica='inviata'`.
6. L'operatore apre il dettaglio, confronta PDF e dati, integra/corregge:
   anagrafica condivisa, categoria/offerta/opzione, device, dati categoria,
   data di inserimento, operatore e negozio. I dati PDA hanno anche un editor
   separato, disponibile sui verificati. CF/P.IVA e cluster sono in sola lettura
   nel popup principale; email e tipo firma non sono modificabili da quel popup.
7. «Salva modifica» conserva `da_controllare`. «Conferma verifica» invia
   `action=update, mode=verify`, insieme ai dati del popup.
8. Il server aggiorna prima l'anagrafica, poi il contratto; assegna
   `controllato_da` al profilo canonico del JWT e `controllato_at` all'ora server.
   Conserva i punteggi snapshot se gli ID catalogo non cambiano; quando cambiano,
   deriva i nuovi componenti dal catalogo, incluso il bonus Assicurazione Annuale.
9. Il passaggio a `controllato` alimenta, tramite i trigger documentati,
   Controllo Fissi, L&G, Assicurazioni e Allarmi. Per Mobile/CB non esiste
   questo corrispondente passaggio a una delle quattro tabelle di controllo.
10. «Rimetti in verifica» azzera stato/attribuzione/data verifica sul contratto.
    I trigger locali di inserimento post-vendita non rimuovono le righe già create;
    la riapertura non è un rollback completo del percorso successivo.

La vendita verificata e l'attivazione del servizio sono fasi diverse: un Fisso
verificato entra inizialmente in `Da completare`, non diventa automaticamente Attivo.
Anche i conteggi commerciali hanno già filtri propri: verifica automatica non deve
introdurre una nuova esclusione generale dei contratti ancora da controllare.

## 2. Controlli presenti e lacune da chiudere

| Area | Stato osservato nel codice | Conseguenza per l'automazione |
|---|---|---|
| Identificazione PDA | Normalizzazione, unicità globale e controlli Mobile condivisi; compatibilità legacy senza nuovi dati | Riutilizzare questi controlli, distinguendo storico e nuovi inserimenti |
| Dati categoria | Creazione e popup hanno validazioni diverse | Unificare un motore server di ammissibilità alla verifica |
| Energia | Numero contratto ed ex fornitore bloccano la conferma UI; `updateContract` non li esige | La sola chiamata `mode=verify` non certifica completezza |
| Allegati | Apertura/scaricamento manuale; errore lettura lista trattato come elenco vuoto | Errori di lettura devono sospendere il controllo, non significare documento assente o valido |
| Contenuto PDF | Upload controlla formato/relazioni; verifica non legge i byte | Presenza di un record o firma `%PDF` non prova leggibilità, titolare o correttezza |
| Documenti richiesti | Regole catalogo usate dal wizard per SIM/bolletta; contratto firmato richiesto in UI per firma cartacea | Rivalutare lato server il fascicolo completo prima dell'approvazione |
| Finalizzazione | Verifica copertura identità tramite record DB | Non equivale alla verifica contenutistica di tutti i documenti |
| Firma | `tipo_firma` è una scelta raccolta nel wizard; OCR legge il contatto nella sezione firma | Non esiste una verifica implementata della firma contrattuale |
| Catalogo | Snapshot e integrità punti gestiti lato server; selettori popup alimentati da voci attive | Preservare gli ID storici; non sostituire offerte con somiglianza del nome o prezzi |
| Concorrenza | `update_pda` controlla `updated_at`; aggiornamento generale `save/verify` no | Evitare conferme su dati o allegati cambiati durante l'analisi |
| Atomicità | Anagrafica e contratto aggiornati con richieste separate; integrità punti verificata dopo UPDATE | Possibili modifiche parziali o errore dopo scrittura; rendere atomico l'esito finale |
| Attribuzione | Verificatore sempre umano, ricavato dal JWT | Il sistema automatico richiede attribuzione distinta, senza simulare una persona |
| Audit | Audit permanente dei punteggi; nessun verbale completo documentale in questo endpoint | Registrare controlli, prove, differenze, correzioni e versioni del motore |

Simulazione locale dell'handler reale, con DB e autenticazione sostituiti da stub:
contratto Energia, numero contratto ed ex fornitore null, `contratto={}` e
`mode=verify` → HTTP 200 e `stato_controllo=controllato`.
L'handler ha interrogato/aggiornato solo `vendita_contratti`: nessuna lettura
di pratica, documenti o privacy. Prova limitata al comportamento applicativo;
non dimostra l'assenza di ulteriori vincoli nel DB production.

## 3. Fonti disponibili per categoria

| Categoria | Fonte attuale | Dati e verifiche da coprire |
|---|---|---|
| Mobile | PDA, identità e SIM quando richiesta | Intestatario, codice, offerta/opzione, costo base, SIM/MNP/gestore, eventuale device e modalità firma |
| Customer Base | PDA e identità, allegati richiesti dal catalogo | Tipo operazione, offerta, device/acquisto, codice, intestatario e firma; non estendere automaticamente gli obblighi numerazioni Mobile a CB |
| Fisso | PDA e identità, scansione se cartaceo | Codice, intestatario, indirizzo linea, attivazione, offerta/prezzo/convergenza e FWA; campi successivi di Controllo Fissi da trattare separatamente |
| Energia | Dati wizard, identità ed eventuale bolletta | POD/PDR, intestatario, numero nuovo contratto, ex fornitore; manca una fonte obbligatoria del nuovo contratto nel flusso standard |
| Allarmi | Dati wizard e identità | Offerta, pagamento e prova documentale da definire |
| Assicurazioni | Dati wizard e identità | Offerta, ricorrenza, pagamento e prova documentale da definire |

Una bolletta precedente può documentare POD/PDR ed ex fornitore, non necessariamente
il numero del nuovo contratto Energia. Finanziaria, Kolme e scelta di mantenere/
disattivare Smartphone Reload sono descritti dalle guide come dati manuali non
estraibili dal PDA. Occorre una fonte gestionale o una dichiarazione esplicita
già raccolta; un campo mancante non deve diventare un valore dedotto.

### 3.1 Checklist confermata dal proprietario

Ordine attuale da riprodurre: completare i dati mancanti dove necessario, poi
eseguire il confronto documentale e confermare se il fascicolo è conforme.
La compilazione non sostituisce il controllo della fonte e dell'intestatario.

| Controllo richiesto | Esito positivo necessario |
|---|---|
| Contratto allegato, nei percorsi che lo prevedono | Intestato alla persona corretta, coerente con il soggetto della pratica |
| Documento d'identità | Appartiene alla persona del contratto ed è non scaduto |
| SIM allegata per portabilità | ICCID/seriale della SIM allegata uguale al seriale nella sezione portabilità della PDA |
| Energia: identità e bolletta | Documenti della persona corretta; bolletta effettivamente intestata al soggetto corretto |
| Energia: completezza bolletta | Almeno le prime due pagine, con nome intestatario e POD oppure PDR visibili e coerenti con la pratica |
| Customer Base con Reload in disattivazione | Avviso al proprietario perché invii manualmente il promemoria WhatsApp al cliente |

Per la bolletta non basta contare due pagine: devono essere riconoscibili come
le prime due della stessa bolletta, pertinenti alla fornitura inserita. Un codice
leggibile ma diverso dal POD/PDR della pratica è un'incongruenza, non un successo.
La presenza dei campi si valuta sul documento completo richiesto, senza imporre
che il nome e il codice siano ripetuti entrambi in ciascuna pagina.

Per l'identità occorre leggere scadenza e dati identificativi: il solo nome
omonimo non dimostra la corrispondenza. Dati illeggibili o contrastanti producono
esito non determinabile. Non sono state richieste verifica biometrica del volto,
certificazione di autenticità del documento o nuove validazioni tecniche delle
firme; non introdurle implicitamente nella checklist. Restano gli obblighi di
caricamento già previsti dal flusso, incluso il contratto firmato se cartaceo.
La data di riferimento del controllo scadenza va precisata (verifica o firma);
proposta iniziale: giorno della verifica in Europe/Rome, con regola esplicita
per il giorno esatto di scadenza e per dati mancanti.

Per Energia la bolletta è ora una fonte documentale confermata del controllo:
non serve dedurre da questa checklist un nuovo obbligo di caricare il contratto
Energia. La fonte del numero del nuovo contratto è il CSV ufficiale WindTre,
mentre il gestore uscente si legge dalla bolletta. Allarmi e Assicurazioni non hanno ancora una
checklist specifica confermata oltre ai controlli identità applicabili.

### 3.2 Customer Base: promemoria Reload richiesto

Il requisito riguarda `Customer Base` con `smartphone_reload_modalita` uguale
a `Disattivazione cliente`; nel modello attuale la modalità richiede anche
`smartphone_reload=true`. La scelta di disattivazione è esplicita dell'operatore:
non va inventata dall'AI. Non confondere questo campo con il catalogo Reload
dismesso, `reload_exchange` o `reload_forever`; non estendere automaticamente
il nuovo avviso alle altre categorie.

Il proprietario vuole essere avvisato per scrivere personalmente il messaggio
WhatsApp al cliente. L'automazione WhatsApp è rinviata: il futuro avviso interno
non equivale a un messaggio già inviato al cliente o a una disattivazione eseguita.
Canale confermato: email a `info@konatech.it` appena dopo la verifica positiva,
sia nel turno serale sia in un riesame immediato dei giorni successivi.

Proposta operativa:

- Alla verifica positiva salvare anche un'attività «Promemoria WhatsApp Reload»
  e la notifica da spedire in una coda persistente. Se la registrazione necessaria
  fallisce, non dichiarare conclusa quella transizione.
- L'email segnala il cliente da contattare, il contratto e la scelta registrata;
  i recapiti necessari sono quelli verificati, con accesso alla pratica autenticata.
  Nessun allegato d'identità o bolletta nell'email. Contenuto minimo da approvare.
- Un errore SMTP conserva la notifica pendente con tentativi limitati e problema
  visibile nel CRM; non annulla la verifica documentale già salvata insieme alla coda.
- Una nuova esecuzione sulla stessa scelta non deve creare un secondo promemoria.
  Prima dell'invio rileggere la condizione; modifica/riapertura richiedono gestione
  esplicita dell'avviso superato. Se già spedito, conservarne lo storico.
- Separare gli stati dell'attività (da contattare/contattato, proposta UI) dagli
  stati email. SMTP accettato non prova consegna o lettura; un esito incerto dopo
  l'invio non consente di promettere assenza assoluta di duplicati.

Supporto locale trovato in `netlify/functions/_lib/mailer.js`: Gmail SMTP,
template DB ed `email_log`, già richiamabile dal backend. Non è una coda durabile:
il log è best effort e il codice non controlla il campo `error` restituito
dall'INSERT Supabase. L'helper browser restituisce `ok:false` sugli errori di invio.
Il futuro worker deve gestire l'esito esplicitamente. I template esistenti
normalizzano `link_*` alla home CRM: un collegamento diretto al contratto richiede
una scelta implementativa dedicata, senza cambiare implicitamente le CTA globali.
Nessun nuovo template, messaggio, job, env var o invio di prova creato.

## 4. Flusso automatico proposto

```text
Pratica inviata con upload completati
  -> Da controllare fino al turno delle 21:00 Europe/Rome
  -> Accodamento persistente e analisi di ogni contratto eleggibile
  -> Fotografia versionata di dati, documenti e regole
  -> Lettura documentale e confronto campo per campo
  -> Integrazioni/correzioni ammesse e nuova validazione
  -> Conferma automatica se tutti i controlli obbligatori passano
  -> Passaggio ai moduli post-vendita esistenti

Documento mancante / contrasto / lettura impossibile
  -> Esito esplicito con motivo e integrazione necessaria
  -> Nuova analisi automatica quando cambia il fascicolo
```

- Avvio confermato alle 21:00 di ogni sera, tutti i giorni, Europe/Rome.
  Dopo `finalize` si registra il lavoro, mantenendo Da controllare fino al turno.
  Coda e recupero dei contratti non accodati devono resistere a riavvii/errori;
  nessun lavoro deve partire su una bozza ancora in upload.
- Elaborazione per `contratto_id`, anche nei carrelli multipli: gli allegati di
  un'altra riga o di un altro cliente non valgono come prova del contratto.
- Lettura PDF per coordinate e AI per i contenuti visivi, con output strutturato:
  valore, documento, pagina/sezione, evidenza e conflitti. I documenti sono dati
  da esaminare; istruzioni contenute nei PDF non autorizzano azioni del sistema.
- Decisione tramite regole versionate. Un generico punteggio di fiducia AI non
  sostituisce i controlli obbligatori né la corrispondenza dei soggetti.
- Integrazione di un dato vuoto o correzione soltanto con fonte univoca e regola
  ammessa. Conservare prima/dopo e prova; rilanciare i controlli dopo la correzione.
  Conflitti di identità, contratto, offerta o scelta esplicita dell'operatore
  richiedono una politica concordata, non una sovrascrittura silenziosa.
- Prima della scrittura finale rileggere versioni e impronte dei PDF. Se qualcosa
  cambia durante il lavoro, scartare l'esito obsoleto e riesaminare.
- Conferma atomica, idempotente e attribuita al sistema. Non richiamare l'endpoint
  attuale con un JWT umano conservato; estrarre la logica condivisibile e mantenere
  separata l'autenticazione del worker. Verificare gli effetti post-vendita.
- Errori temporanei: tentativi limitati con attese crescenti. Mancanze reali:
  attesa integrazione senza ripetere inutilmente la stessa analisi AI.
- La pagina espone i quattro esiti concordati nella sezione 4.1. Elaborazione
  e tentativi tecnici sono metadati visibili, senza introdurre ulteriori esiti
  commerciali o confondere un errore tecnico con un documento non conforme.

Obiettivo: nessuna approvazione umana ordinaria per pratiche conformi, anche dopo
una correzione certa. Una scansione obbligatoria assente o un'identità
contraddittoria richiedono una nuova fonte o un'integrazione: non possono essere
trasformate in una verifica positiva con la sola automazione.

### 4.1 Stati richiesti e riesame immediato

| Etichetta richiesta | Significato e comportamento |
|---|---|
| Da controllare | Pratica nuova durante la giornata, prima della prima verifica serale |
| Controllato | Tutti i controlli necessari superati; compare nell'elenco dei verificati come oggi |
| Da verificare | Controllo eseguito con problemi; mostra motivi semplici in italiano e intervento necessario |
| In attesa CSV | CSV necessario non ancora disponibile, oppure contratto non ancora presente nel CSV valido caricato |

Requisito confermato: dopo il tentativo del 27 alle 21:00, una correzione o
integrazione del 28 deve avviare subito una nuova verifica, senza aspettare le
21 del 28. Questo vale sia per Da verificare sia per In attesa CSV. Il salvataggio
o la richiesta di riesame riavvia il motore; non certifica direttamente il successo.
Anche upload/rimozione allegati, modifica dati PDA e nuovo CSV pertinente devono
invalidare l'analisi precedente e accodare il riesame della pratica già esaminata.
Le pratiche nuove del 28 restano invece soggette al loro primo turno serale.

Proposta di implementazione: conservare `vendita_contratti.stato_controllo`
con i valori compatibili attuali e salvare l'esito documentale in un archivio
additivo. I contratti sospesi rimangono non controllati per il sistema esistente,
ma nella pagina si distinguono tramite Da verificare/In attesa CSV. Alla conferma
si imposta `controllato` e si lasciano operare i trigger. I CHECK locali contemplano
anche `errore`/`annullato`: non convertirli automaticamente nei nuovi esiti.
La scelta evita che nuovi valori non riconosciuti cambino conteggi o rami post-vendita;
va validata sullo schema effettivo prima dell'implementazione.

Memorizzare scadenza del primo turno, inizio primo tentativo e revisione sorgenti,
senza usare soltanto la data contratto modificabile per riconoscere una pratica
già esaminata. Fuso Europe/Rome, passaggi ora legale/solare, esecuzioni doppie e
recupero dopo fermo richiedono copertura di test. Proposta per nuovi invii dopo
la chiusura del turno: primo esame alle 21 del giorno seguente; comportamento
di confine ancora da confermare, non applicato in questa analisi.

Proposta di precedenza: se oltre al CSV manca un documento o c'è un'incongruenza,
mostrare Da verificare e tutti i motivi, inclusa l'attesa CSV. In attesa CSV è
riservato ai casi il cui solo impedimento è quella fonte. Non interrompere i
controlli identità/bolletta appena si rileva l'assenza del CSV.

### 4.2 CSV ufficiale WindTre e completamento Energia

Requisiti confermati: upload giornaliero del medesimo export già usato da
Controllo L&G, disponibile anche in Verifica Contratti. Numero Contratto Energia
dal CSV; gestore uscente dalla bolletta. L'upload successivo riavvia subito i casi
in attesa già passati dal turno serale, senza anticipare le nuove pratiche del giorno.

Comportamento attuale verificato: `controllo_lg.html` legge il CSV nel browser,
indicizza per Proposta di Contratto + POD/PDR e poi controlla CF/P.IVA. Manda a
`gestisci-controllo-lg` batch di ID/esiti, non il file completo o un archivio delle
righe sorgenti. Il backend aggiorna soltanto record post-vendita già presenti,
rispettando `esito_manuale_bloccato`; non recupera numeri contratto mancanti.
`ultimo_csv_upload_at` è aggiornato per le righe effettivamente processate.

Per la verifica serve il verso opposto: intestatario fiscale + POD/PDR
  -> insieme delle righe CSV corrispondenti
  -> una sola Proposta di Contratto identificabile
  -> numero nuovo contratto da integrare con prova della riga sorgente.

Non è sufficiente la sola somiglianza del nome e non si può cercare usando
proprio il numero contratto ancora sconosciuto. Conservare zeri iniziali e
valori come stringhe; validare CF/P.IVA secondo il cluster; duplicati della stessa
proposta/punto non vanno confusi con proposte differenti sulla stessa fornitura.
Più numeri compatibili richiedono disambiguazione esplicita, mai scelta casuale,
ultima riga o precedenza dello stato commerciale usata come prova d'identità.

Proposta: un servizio di importazione server salva versione/file privato,
impronta, caricamento e righe validate; i due punti di upload possono riusare
la stessa fonte senza obbligare al doppio caricamento fisico. Disponibilità del
file in verifica e aggiornamento stati post-vendita sono operazioni distinte.
Non retrodatare o aggiornare `ultimo_csv_upload_at` L&G se non è stato realmente
applicato l'import corrispondente; preservare filtri Netto e protezioni manuali.
Le righe L&G create dopo la verifica devono poter essere riconciliate con il CSV
già disponibile, senza richiedere un secondo upload per il solo ordine degli eventi.

Un CSV malformato non sostituisce la versione valida. Conservare distinzione fra
fonte giornaliera non caricata, errore tecnico, riga assente e abbinamento ambiguo.
Scelta confermata: anche con CSV valido ma contratto non presente, mantenere
In attesa CSV. Mostrare «Contratto non presente nell’ultimo CSV caricato» con data
della fonte; quando manca il file mostrare invece «CSV non ancora caricato». Ogni
nuovo CSV riavvia subito il confronto delle pratiche già esaminate. La sola assenza
non genera l’email problemi riservata a Da verificare. Abbinamenti ambigui o dati
fiscali discordanti restano problemi distinti, non assenza della riga.

### 4.3 ICCID e comunicazioni

ICCID confermato: leggere separatamente il seriale sulla copia SIM e quello
del gestore uscente nella sezione portabilità della PDA, evitando il seriale
della nuova SIM WindTre. Non sostituire il confronto con quello dei numeri telefonici.
Il modello PDA attuale non conserva ICCID e l'OCR esistente non lo estrae come
campo dedicato: servono nuove letture/evidenze nel verificatore. Non è ancora
stabilito se persisterlo come nuova colonna o soltanto nelle prove della verifica.

| Evento | Destinatario confermato | Momento |
|---|---|---|
| Customer Base Reload in Disattivazione cliente, verifica superata | `info@konatech.it` | Appena dopo la verifica, anche se è un riesame diurno |
| Esito Da verificare | `mirko.piasenti@mail.com` | Comunicazione dei problemi riscontrati |

Conservare esattamente il dominio `mail.com` indicato dal proprietario.
Il destinatario dei problemi è distinto da quello del promemoria Reload.
Testi brevi, semplici e in italiano: problema, conseguenza e cosa integrare.
Esempi: «Il documento d'identità è scaduto. Carica un documento valido»;
«Il seriale della SIM allegata è diverso da quello indicato nella portabilità»;
«Manca la seconda pagina della bolletta»; «Il POD/PDR della bolletta non coincide
con quello della pratica». Niente stack trace o soli codici tecnici.
Proposta invio al nuovo esito/con nuovi motivi, dedupe per contratto e revisione;
nessuna ripetizione identica ad ogni passaggio del worker. Errori SMTP persistenti
e tentativi tracciati, senza perdere il promemoria. In attesa CSV deve ricordare
l'upload nella pagina; l'email richiesta riguarda espressamente Da verificare,
nessuna email aggiuntiva per attesa CSV è stata richiesta.

## 5. Integrazione e confini

Proposta additiva: archivio privato di lavori/esecuzioni, esiti per controllo e
audit delle correzioni, con versioni di regole/modello e impronte documentali.
Il progetto ha già pattern di coda persistente in Target/Guardian, da valutare
senza condividere dati, segreti o identità fra gli agenti.
Nomi, schema, worker e fornitore AI non sono ancora scelti. Pianificazione e
destinatari sono requisiti confermati nelle sezioni precedenti, non job già attivi.

PDA Mobile/CB/Fisso ed Energia hanno ora una checklist documentale descritta nella
sezioni 3.1 e 4; confronto ICCID e fonti Energia sono stati precisati dal proprietario.
Per Allarmi/Assicurazioni occorre ancora raccogliere eventuali controlli specifici.
Le verifiche tecniche delle firme non sono state incluse dal proprietario nella
checklist e non diventano un requisito aggiuntivo per effetto di questa analisi.

L'anagrafica è condivisa con il CC: non pianificare fusioni automatiche,
riassociazioni o nuove scritture generalizzate senza una politica esplicita.
Eventuali cambi schema/RLS/RPC/trigger sulle tabelle condivise restano soggetti
al consenso preventivo previsto da AGENTS.md. Nessun cambio necessario a quelle
tabelle è stato accertato in questa analisi.

Non riaprire lo storico in massa. Per il collaudo iniziale proporre una modalità
di sola valutazione: confrontare esiti automatici con quelli umani su un insieme
rappresentativo, misurando soprattutto false approvazioni e correzioni errate.
Quindi abilitare la conferma automatica per regole/categorie validate.
Questo è un percorso di collaudo verso l'autonomia richiesta, non l'obbligo di
lasciare un pulsante di approvazione su ogni pratica.

## 6. Verifiche e punti da precisare

- 64/64 test mirati superati: `vendita-pda`, `regression-prioritari`,
  `collegamento-pratica-controlli`. Coprono le protezioni esistenti, non attestano
  una verifica automatica documentale che oggi non esiste.
- Simulazione isolata dell'endpoint Energia descritta sopra; zero accessi reali.
- Ulteriori 12/12 test mirati esistenti superati: Controllo L&G manuale,
  dashboard Customer Base e collegamenti pratica/controlli. Le due esecuzioni
  condividono test di collegamento, non sommare i totali come test distinti.
- Confermati: confronto ICCID copia SIM/PDA MNP, CSV WindTre numero Energia,
  bolletta gestore uscente, verifica21:00Europe/Rome quotidiana, quattro esiti,
  riesame immediato delle pratiche sospese modificate, due email e destinatari.
- Confermato anche In attesa CSV per contratto assente da un CSV valido, con
  motivo distinto e riesame immediato a ogni nuovo caricamento.
- Da scegliere: politica CSV giornaliero e abbinamenti multipli, invii nuovi
  dopo21 e avvisi aggregati/individuali.
- Restano da definire data di riferimento scadenza identità, gestione soggetti
  Business/referenti, correzioni consentite e anagrafica condivisa.
- Da scegliere prima dell'implementazione: categorie iniziali,
  trattamento dei contratti già verificati poi modificati,
  conservazione delle evidenze e requisiti operativi di costo/tempo.
- Prima di una futura migration: verificare schema/trigger/grant effettivi e
  documentazione attuale dei servizi; nessuna proposta SQL è stata applicata.

## Riferimenti applicativi

- `moduli/verifica_contratti.html`: `caricaContratti`, `apriDettaglioContratto`,
  `leggiPayloadDalPopup`, `confermaVerifica`, `salvaModifiche`, `rimettiInVerifica`.
- `netlify/functions/gestisci-vendita-contratto.js`: `updateContract`,
  `deriveCatalogSnapshots`, `updatePda`.
- `netlify/functions/crea-vendita-pratica-carrello.js`: `finalize`,
  `validateCategorySpecificRules`, creazione contratti e promozione PDA.
- `netlify/functions/ocr-pda.js`, `_lib/pda-pdf-text.js`,
  `js/vendita-pda-core.js`, `netlify/functions/upload-vendita-documento.js`.
- `js/mirox-mailer.js`, `netlify/functions/_lib/mailer.js`,
  `netlify/functions/mirox-send-email.js`, `netlify/functions/cron-rientro-sim.js`.
- `moduli/controllo_lg.html`: import CSV; `netlify/functions/gestisci-controllo-lg.js`:
  `csv_update_batch`, timestamp CSV e protezione esiti manuali.
- `database/018`, `019`, `022`, `023`, `058` e migration PDA del 27/10;
  AGENTS.md: flusso vendita, validazioni categoria, documenti, confini CC.
