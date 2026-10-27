# Upload PDA: identificazione contratto e dati Mobile

Stato: online e convalidato27/10/2026. Codice c4176c8, CI40498935335 riuscita,
Netlify6ae08f9ca91e866c1212512f verificato per SHA e asset. Migrazione applicata,
prove DB transazionali annullate via ROLLBACK; nessuna riga test conservata.
Nove PDF reali con esito atteso. Nessun recupero dello storico.

## Requisiti confermati dal proprietario

| Categoria | Codice PDA obbligatorio | Nuovi dati economici/telefonici |
| --- | --- | --- |
| Mobile (Consumer/Business/Turista) | Codice Contratto | Costo base mensile, numero definitivo, portabilita, eventuale provvisorio/MNP/gestore |
| Fisso | Numero Contratto | Nessun nuovo campo Mobile; prezzo/convergenza preesistenti conservati |
| Customer Base | Codice Contratto | Nessun nuovo campo Mobile |
| Energia/Allarmi/Assicurazioni | Flusso preesistente | Nessuna modifica |

Una PDA contiene un contratto. Codice cliente escluso. Reinserimenti con codice
nuovo. Storico senza nuovi codici conservato: il recupero delle vecchie PDA e'
una fase futura, successiva alla convalida, e non fa parte di questa modifica.

## Comportamento

- Manuale: popup codice, controllo globale e nel carrello, eventuale avviso con
  data/operatore/link alla pratica; solo se libero si prosegue con upload staging.
- AI: lettura di ogni PDA, anche delle successive nello stesso carrello; codice
  assente/ambiguo da compilare manualmente. Nessun proseguimento se il controllo
  duplicati non risponde correttamente. Sostituzione file/categoria invalida i
  dati precedenti; risposte tardive ignorate.
- Codice testuale maiuscolo senza spazi, zeri iniziali preservati. Unicita su
  tutti i valori registrati, senza filtri mese/cliente/negozio/stato/categoria;
  include le bozze. Collisione durante INSERT: rollback bozza e risposta409;
  un fallimento del rollback viene dichiarato senza fingere un ripristino riuscito.
- Mobile: solo primo importo mensile base nella sezione SIM, nessuna somma di
  accessori/assicurazioni/rate o attivazione. Popup sempre da confermare; valore
  assente da compilare. Zero valido se espressamente indicato/confermato.
- Senza MNP: numero SIM=numero del contratto; con MNP: numero SIM=provvisorio,
  numero da portare=definitivo=MNP, gestore obbligatorio dalla voce Operatore attuale.
- Contatto OTP esclusivamente dalla firma elettronica della prima PDA/pratica;
  assente da compilare manualmente. Le successive non lo sovrascrivono. I normali
  upsert aggiornano il cellulare anagrafico; modifica nel popup OTP e riuso privacy
  valido conservati. Nessuna modifica a schema/trigger/RLS/RPC anagrafica o CC.
- Turista mantiene categoria/offerta automatiche e assenza email/indirizzo;
  lo step3 raccoglie soltanto i nuovi dati PDA prima della firma.
- Tutti gli utenti attivi possono correggere i dati in Verifica Contratti anche
  sui verificati, Storico Cliente e codice Fisso in Controllo Fissi. Editor
  dedicato senza modifiche a punteggi/stato, protetto da `expected_updated_at`.
  Nuovo codice Fisso coordinato con il controllo esistente nelle due direzioni.

## Implementazione e verifiche

`js/vendita-pda-core.js` condivide normalizzazione/validazione browser-server;
`js/vendita-pda-ui.js` condivide popup, controllo e editor. Nuove action
`check_codice` e `update_pda` su `gestisci-vendita-contratto`; nessuna nuova Function,
env var o dipendenza npm CRM. Modello OCR Claude invariato, output massimo1200token.

Migration `database/20261027110402_vendita_codice_pda_mobile.sql`: sette colonne
nullable, CHECK, indice UNIQUE e due nuovi trigger INVOKER su vendita/Fisso;
nessun backfill o modifica di tabelle/policy/RPC Call Center. Applicata e riletta in produzione.

- Suite completa e build:340/340 test riusciti (339versionati e1backup preesistente),
  incluse26regressioni dedicate al nuovo flusso PDA.
- Regressioni dedicate: dati mancanti, nuovo numero/MNP, storico, duplicati globali,
  errori DB, collisione concorrente, rollback riuscito/fallito, operatori non-admin,
  modifiche obsolete, carrello multi-contratto, contatto conservato e risposte tardive.
- SQL reale in memoria: migration, storico invariato, CHECK, unicita, due tentativi
  concorrenti, sincronizzazione Fisso bidirezionale e RLS legacy. Runner riproducibile
  `scripts/verifica-vendita-pda-sql.js`; PGlite0.5.12 solo nello scratchpad esterno.
- Browser locale con servizi simulati: manuale chiede codice prima dell'upload,
  duplicato bloccato con link, Mobile MNP e popup costo precompilato, firma/documenti,
  secondo contratto riletto con AI, Customer Base solo codice e riepilogo distinto.
- Nove PDF privati dell'utente ispezionati localmente (testo e pagine rilevanti):
  codici coerenti in intestazione, firma elettronica anche in pagine successive,
  Mobile con/senza costo esplicito e con/senza MNP, Customer Base. Nessun PDF o dato
  cliente copiato nel repository, nella build o nei test versionati.

## Debug aggiuntivo e rilascio autorizzato

Corretti prima del deploy:

- duplicato rilevato al submit: chiusura loader prima dell'avviso, senza consenso o bozza;
- modalita legacy: non consente di azzerare dati Mobile gia' registrati;
- secondo PDA di altro CF/PIVA: blocco prima di upload/cambio cliente;
- editor non chiudibile/annullabile durante una richiesta di salvataggio;
- nuovi editor non scartano altre modifiche non salvate in Verifica/Controllo Fissi;
- confronti fiscali senza spazi e limiti locali di lock/statement nella migration.

Suite340/340 locale (339versionati+1backup preesistente),26regressioni PDA e
collaudo PostgreSQL isolato riusciti. Migration applicata tramite MCP e allineata
al timestamp del registro; colonne/indice/search_path/INVOKER riletti, nessun
nuovo rilievo advisor. Prove sul DB production con dati sintetici in transazione:
INSERT bozza, sync Fisso nelle due direzioni, rifiuto duplicato e MNP incoerente;
ROLLBACK eseguito, nessun dato di collaudo conservato.

Pubblicazione autorizzata dal proprietario dopo il debug. Si pubblica soltanto
questo intervento; backup/Guardian preesistenti restano fuori dal commit.
Verificati SHA/CI, due asset condivisi e script inline delle quattro pagine online.
Nove PDA provate con la vera Function OCR: codice e contatto corretti in tutti i
casi, Mobile con/senza costo e MNP, Fisso/CB senza nuovi campi Mobile. Nessuna
pratica/OTP inviata o anagrafica aggiornata nel collaudo. Storico ancora rinviato.

Primo collaudo online: corretta la query duplicati che presumeva una FK PostgREST
fra operatore_id e profili. Il DB usa ID senza quella relazione: lookup esplicito
separato, come nella pagina Verifica Contratti. Un errore nella lettura del nome
non nasconde un duplicato gia' individuato. Primo tentativo fermato prima dello staging
e di qualsiasi pratica; nuova pubblicazione di correzione e ripetizione collaudo.

Nel collaudo rapido fra PDA diverse e' emersa una risposta di reinserimento
arrivata dopo l'avvio della pratica successiva. Guard aggiuntivi su revisione PDA,
cliente, categoria e step scartano sia lookup anagrafici sia candidati/callback
tardivi, senza alterare la pratica corrente. Regressioni asincrone dedicate.

PDA Business solo dati: in due letture reali il numero SIM restava vuoto pur
essendo leggibile. Rafforzate istruzioni ed esempio OCR per SIM dati; accettato
anche prefisso internazionale 39 senza + quando la lunghezza e' inequivocabile.
Riprova reale dopo la pubblicazione riuscita, compreso numero SIM e costo vuoto.
Totale nove PDF con esito atteso. Tutti i valori restano verificabili/correggibili
dall'operatore: il collaudo non garantisce la lettura perfetta di ogni futura PDA.
Suite aggiornata340/340 (339versionati),26regressioni PDA e SQL isolato OK.

Pulizia conclusiva:13copie temp create dai test riconciliate tramite MD5 e
dimensione con i PDF originali, rimosse via API Storage;149temp preesistenti
preservati. Bozza browser scartata, zero righe test persistenti e codici storici
tutti NULL. Verificato online anche popup manuale con codice richiesto per primo;
screenshot privato /private/tmp/mirox-pda-manuale-online.png. Nessun dato cliente
nei test o nel rapporto. Guide e promemoria aggiornati; ricaricare il wizard prima
del primo utilizzo della nuova versione.

## Correzione visibilita upload richiesta dopo il rilascio

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

Convalida: test per AI/manuale, blocco AI incompleta/fallita senza staging,
etichette dinamiche, dati nascosti conservati al ripristino/reset, riepilogo e
payload server completo senza metadati UI. Browser locale con API simulate:
Mobile AI MNP senza campi telefonici/costo, popup costo precompilato e vuoto,
manuale nuovo numero/MNP e costo vuoto, prosecuzione firma; AI incompleta bloccata.
Screenshot di esempio privato /private/tmp/mirox-pda-ai-campi-nascosti.png.
Nessuna pratica reale/OTP o scrittura DB nel collaudo di questa correzione.
Guide aggiornate; verifiche finali e release nel promemoria di sessione.

Correzione visibilita: suite completa346/346 (345versionati+1backup),
32regressioni PDA e build riuscite. Nessuna nuova dipendenza o modifica DB.

## Numero SIM omesso su PDA Business multipagina

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

Segnalazione proprietario14:35: errore lettura AI incompleta sul PDF privato
Downloads/1.pdf, Mobile Business senza MNP e senza costo base esplicito. Sezione
SIM nella terza pagina; contatto firma nella prima. Ispezionati testo e pagina;
nel content stream il numero precede il titolo, nelle coordinate lo segue.
Prova riproducibile in test con PDF sintetico di tre pagine, identico problema
di ordine e AI simulata che omette il numero: la Function multipart lo recupera,
conservando il contatto firma separato. Nessun dato cliente nei test versionati.

Controlli locali:352/352test (351versionati+1backup), build OK;6nuove regressioni
su layout, sezioni, MNP, ambiguita, PDF ibridi, documento multipagina e handler.
Recupero diretto con valori attesi su5PDA Mobile precedenti +1.pdf; altre4PDA
Fisso/Customer Base leggibili senza errori. Tempo caldo sui file privati15-28ms,
prima apertura102ms locale; non rappresenta il tempo OCR complessivo o production.
Nuova dipendenza senza rilievi npm audit; due rilievi preesistenti su fflate/
nodemailer, nessun aggiornamento estraneo applicato.
Riferimenti: [unpdf ufficiale](https://github.com/unjs/unpdf),
[moduli esterni Netlify](https://docs.netlify.com/build/functions/configuration/).
Pubblicazione nel deploy gia autorizzato; verifiche online nel promemoria.

## Codice nascosto anche nel percorso AI

Codice PDA nel percorso AI: nascosto anche in Dati Contratto e nel riepilogo
carrello, per Mobile/Fisso/Customer Base; resta conservato in bozza/payload/DB e
nel controllo duplicati. Manuale ed editor post-vendita mantengono il codice
visibile. Se AI non legge il codice, blocco con invito a riprovare o scegliere
il manuale esplicitamente, senza aprire il popup codice nel percorso AI.

Verifiche esistenti aggiornate per le tre categorie, codice nascosto ma conservato,
riepilogo AI senza codice e codice AI mancante senza popup o staging.
Suite completa352/352locale (351versionati+1backup) e build OK.
Pubblicazione e verifiche finali nel promemoria; backup/Guardian esclusi.

## Opzioni Mobile automatiche e rivenditore fisso

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

Ricognizione catalogo production in sola lettura: tre voci e collegamenti
Consumer/Business confermati; offerte senza collegamenti restano senza opzione.
Test interni su varianti gestori, standard/nuovo numero, campi mancanti, voci
ambigue/non collegate, override persistito/reset, invio rivenditore canonico e
normalizzazione server. Fixture Customer Base adattata al nuovo helper senza
variazioni della sua logica. Prove UI preliminari svolte prima dell'istruzione
stop browser; da quella istruzione nessun ulteriore accesso al browser, fixture
locale arrestata. Collaudo finale UI lasciato al proprietario.
Guide aggiornate; esito suite/CI/deploy nel promemoria. Backup/Guardian esclusi.

Suite finale356/356locale (355versionati+1backup) e build riuscite. Nessuna
modifica a schema/catalogo/storico; nuova preselezione non sostituisce le scelte
manuali e il backend continua a validare legami/punteggi dal catalogo.

## Conferma della modifica alla preselezione Mobile

Conferma cambio opzione27/10: quando si modifica una preselezione automatica
Mobile, popup MiroxUI con valore originale/proposto, Conferma modifica e
Mantieni scelta automatica. Fino alla conferma resta selezionato il valore
originale: nessuna variazione anticipata a punteggi, documenti o bozza. Annulla/
chiusura conserva la scelta automatica; conferma applica l'override manuale.
Scelte gia' manuali o senza preselezione non richiedono il popup. Nuova PDA
riparte dall'automatismo. Doppio cambio e conferme tardive su altra PDA/offerta/
contratto non applicano modifiche alla nuova compilazione. Nessun cambio DB.

Suite completa360/360locale (359versionati+1backup) e build riuscite. Quattro
regressioni aggiuntive: conferma/annulla senza effetti prematuri, scelta manuale/
valore identico senza popup, doppio cambio e risposta tardiva. Nessun browser
usato; test UI a cura del proprietario. Guide aggiornate, rilascio nel promemoria.

## Dispositivo Si/No automatico e conferma modifica

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

Suite370/370locale (369versionati+1backup), build OK. Dieci regressioni nuove
su presenza/assenza/incertezza OCR, entrambe le direzioni Si-No, conferma/annulla
senza perdita anticipata IMEI, cambi ripetuti/tardivi, override e metadati al
restore/reset, acquisto vincolato. Regressioni Customer Base/FWA e payload server
aggiornate/confermate. Nessun browser o contratto reale usato nel collaudo.
Guide aggiornate, rilascio e verifica finale nel promemoria.

## Tipo attivazione Fisso automatico e conferma modifica

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

Collaudo380/380locale (379versionati+1backup), build OK. Dieci regressioni nuove
su caselle WindTre/ASCII/Unicode, entrambe/nessuna selezione, assenza sezione,
conflitti, PDF sintetico con portabilita e content stream fuori ordine, conferma/
annulla in entrambe le direzioni, doppio cambio/risposta tardiva, restore/reset e
bozze legacy. Payload DB controllato senza metadati UI. Quattro PDF Fisso reali
letti localmente: tutti nuova linea, incluso contratto_fisso (3).pdf allegato;
nessuna portabilita reale disponibile, ramo coperto da PDF sintetico. Nessun
upload reale/OTP/scrittura anagrafica o browser. Guide aggiornate; rilascio e
verifiche production nel promemoria.

## Codici cliente WindTre anagrafici

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

Conferme proprietario: conservare piu codici sulla stessa anagrafica; input
manuale obbligatorio.440/440test locali (439versionati+1backup preesistente),
build OK;14nuove regressioni incluse lettura PDF, ambiguita, clienti nuovi/esistenti,
append concorrente/idempotente, input assente/invalido/categoria non ammessa,
annullamento e risposta tardiva prima upload, restore e serializer multi-PDA.
Workbook con codici multipli e zeri verificato; PostgreSQL isolato PGlite0.5.12
fuori dalle dipendenze del CRM conferma PK/FK/CHECK/grant e anagrafica invariata.
Una PDA reale gia disponibile in area privata riconosciuta localmente; i PDF
precedenti di Downloads non piu presenti, gli altri rami coperti sinteticamente.
Nessun PDF reale inviato all'AI, nessuna pratica/OTP creati. Advisory prima/dopo:
solo INFO atteso RLS senza policy sul registro server-only, rilievi preesistenti
invariati. Migration generata con CLI e allineata alla versione MCP applicata.
Rilascio frontend/backend e verifica SHA/CI nel promemoria.
