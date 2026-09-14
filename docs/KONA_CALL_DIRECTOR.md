# KONA Call Director — stato, setup e attivazione

## Stato verificato

Il modulo e' completo lato codice ed e' stato riesaminato localmente dopo le
correzioni di chiusura. La suite dedicata passa 113/113 test; la suite completa
del CRM passa 236/236 test. La build statica e i controlli di sintassi sono
verdi.

Il Supabase test dedicato `Mirox CRM - Test KONA Call Director`
(`yyorullxmdxhnunsfwwa`, `eu-west-3`) e' attivo e contiene il solo schema
minimo ricostruito senza dati production, le migration `072`-`075` e il seed
fail-closed. Il dataset sintetico `staging/004` e' stato rimosso tramite
`database/staging/005_kona_call_director_preparazione_isabella_20260831.sql`:
contatti, chiamate, lead, appuntamenti, task e sessioni partono da zero; resta
un solo piano approvato per lunedi' 31/08, Consumer manuale per l'intera
giornata, senza Business o arricchimenti automatici. Il sito Netlify isolato
`mirox-kona-call-director-test.netlify.app` e' collegato alla branch
`kona-call-director`, con env staging e service role protetta del solo
Supabase test. L'invocazione HTTP diretta del dispatcher e' bloccata da
Netlify con `403`.
Production non contiene oggetti KONA Call Director e resta invariata.
Il login staging usa una sola policy browser su `profili`: ogni utente
autenticato puo' leggere esclusivamente la propria riga (`id=auth.uid()`);
scritture, altre righe e tabelle KONA restano server-only.
Le pagine Call Center caricano il client Supabase generato dalla build per
l'ambiente corrente; la vecchia configurazione interna fissata al production
e' stata rimossa, quindi la sessione Auth test resta valida entrando dal
dashboard staging. Anche il caricamento profilo usa esplicitamente quel client
condiviso (`db`), evitando di invocare direttamente il namespace della libreria.

Dal 2026-08-29 il collaudo controllato e' attivo esclusivamente nello staging:
i due env switch e il toggle globale sono `true`, un solo profilo test e'
abilitato, la modalità osservazione resta `true` e Google Calendar e' collegato
con ultimo sync `ok`. Production resta invariata.

Al database di test sono applicate anche le migration `076`, `077` e `078`.
La `078` (assistente Telegram con DeepSeek) introduce la riserva Telegram da 10
EUR/mese, la mappa dei provider e la RPC di budget `kona_cd_reserve_budget_v2`;
il codice mantiene comunque il fallback sulla `v1` con verifica del tetto
Telegram prima di ogni chiamata.

Per il test del 31/08 Isabella usa il profilo `test` e inserisce manualmente i
contatti Consumer reali dentro l'agente. Quei dati sono salvati soltanto nel
Supabase test, non diventano dati del CRM production e vanno eliminati dopo il
collaudo.

## Funzione operativa

KONA Call Director coordina l'operatore autorizzato del Call Center con un
solo contatto visibile alla volta. Il motore delle priorita' e' deterministico;
l'IA e' confinata ad arricchimento Business da fonti pubbliche, valutazione
degli skip, proposta del piano e analisi aggregata della giornata. Non genera
script telefonici.

Due provider, con capacita' diverse (la scelta e' in
`kona_call_director_config.provider_per_attivita`, non nel codice):

- **OpenAI** — ricerca web per i dati aziendali dei lead Business e valutazione
  degli skip. E' l'unico provider con ricerca web: se la ricerca viene chiesta a
  DeepSeek la chiamata **fallisce** invece di degradare in silenzio.
- **DeepSeek V4.1 Flash** (`deepseek-flash`) — dialogo in linguaggio naturale
  del bot Telegram, **proposta del piano** giornaliero e **analisi della
  giornata**. Nessuna ricerca web, nessuna trascrizione audio.

La mappa effettiva e' `provider_per_attivita` fuso con i default di codice:
`{telegram, piano, analisi}` vanno su DeepSeek, tutto il resto su OpenAI.
Spostare un'attivita' e' una riga di configurazione (modificabile dal pannello
Admin), non una modifica di codice.

### Assistente Telegram in linguaggio naturale

Al bot si puo' scrivere in italiano ("come sta andando oggi?", "prepara il piano
di domani", "sospendi tutto"). L'assistente classifica il messaggio e risponde.
Regole non negoziabili:
- le **letture** (stato, report, piano, aiuto) rispondono subito;
- le **azioni che cambiano qualcosa** (sospendi, riattiva, approva piano,
  telefoni omaggio, direttiva sul piano) non vengono **mai** eseguite
  sull'interpretazione: il bot le ripropone in chiaro e aspetta un "si" oppure
  un "no". Una proposta non confermata scade dopo 30 minuti. Vale anche per i
  comandi con la barra: `/sospendi` chiede conferma;
- "si"/"no" sono riconosciuti **senza** chiamare l'IA (nessun costo, risposta
  immediata);
- se il modello non e' disponibile nessuna azione viene eseguita: il bot
  risponde con l'elenco dei comandi;
- **il giorno non viene mai scelto di nascosto.** Se Mirko scrive "oggi",
  "domani" o una data ("15/09", "15/09/2026", "2026-09-15") quella giornata
  vince su qualunque deduzione del modello; se non lo dice, il bot **chiede** per
  quale giorno e aspetta "oggi"/"domani"/una data (non esiste un default
  automatico a domani: una direttiva "di oggi" e' finita sul piano di domani ed
  e' il motivo di questa regola). La richiesta di conferma mostra sempre
  `oggi 14/09/2026` / `domani 15/09/2026`, mai una data ISO nuda. Orari e durate
  non vengono mai letti come date;
- **le categorie di una direttiva sono le categorie dei CONTATTI**
  ("Ristorazione", "Negozi", "Servizi", ...), non le offerte ("fissi",
  "mobile"): sono quelle che il motore confronta per decidere chi chiamare. Se
  nessun contatto corrisponde, il bot lo dice subito con l'elenco dei nomi
  disponibili, invece di lasciare una giornata senza telefonate. Orari,
  offerte e priorita' vanno nella nota libera;
- **l'elenco di ciò che si può scegliere è nei dati, non nel codice.** Non
  esiste una lista fissa di categorie Business: sono i settori dei contatti
  presenti in `call_center_lead_outbound`. Il comando `/categorie` (oppure la
  domanda "quali categorie posso scegliere?") stampa l'elenco reale con il
  numero di contatti per categoria, e lo stesso elenco compare nell'avviso
  quando una direttiva non corrisponde a nulla. Le due modalita' **Consumer**
  sono invece fisse: `telefoni_omaggio` (liste cartacee) e `fibra_fwa`;
- **la modalita' Consumer e' una scelta esplicita**, mai dedotta dalle parole
  della nota: "fibra" e' anche il nome di un'offerta. L'assistente la dichiara
  in un campo dedicato (`modalita_consumer`) solo quando Mirko chiede
  esplicitamente di lavorare le liste; una nota che nomina la fibra non
  riconfigura piu' la giornata;
- al modello arrivano **solo aggregati** (numero di task, appuntamenti, budget,
  zone). Mai nomi, telefoni, codici fiscali o email dei clienti: l'unico
  oggetto che esce dal server e' costruito da `contestoAssistente`.
- **"mostrami il piano" mostra la giornata, non solo gli appuntamenti.** Il
  piano di una giornata e' reso leggibile da `descriviPiano`
  (`_lib/kona-cd-agenda.js`): fasce con orari, categorie aziendali approvate e
  liste Consumer. Se il piano non ha fasce proprie lo dice ("programmazione
  base") invece di far credere che siano state scelte. Gli appuntamenti Business
  restano una riga in piu' e la loro assenza non e' piu' l'intera risposta. Lo
  stesso testo compare nel report serale delle 19:10 come piano di domani.
- i **messaggi vocali non sono supportati** (nessuna trascrizione): il bot
  chiede di scrivere il testo.

### Agenda guidata (`/agenda`)

Invece di dettare una direttiva in un colpo solo, il bot **propone** le
attivita' e costruisce la giornata a tappe:

1. si sceglie la giornata (oggi o domani) e il bot mostra le ore di lavoro
   configurate (`orario_mattina` + `orario_pomeriggio`) e quanto tempo c'e' in
   totale. La giornata si puo' cambiare **anche a agenda aperta** scrivendo
   "domani" oppure una data: se non c'e' ancora nessuna attivita' si riparte
   sulla giornata nuova, altrimenti il bot avvisa invece di buttare via il
   lavoro fatto. Le date si possono scrivere per esteso ("15/09/2026",
   "15-09-2026", "15.09.2026", "15/09", "2026-09-15") e vengono validate
   (esistente, non passata, entro 60 giorni); gli **orari non sono date**, quindi
   "15:30-17:00" e "17.01-19.00" restano orari;
2. propone le tre attivita' con i pulsanti: **lead outbound aziendali**,
   **liste Consumer Fibra/FWA**, **liste Consumer telefoni omaggio**;
3. per i lead aziendali chiede prima le **categorie reali** (con il numero di
   contatti, lette da `call_center_lead_outbound`) oppure "tutte";
4. chiede l'**orario** del blocco ("15:30-17:00", "90 minuti", "17:00"); un
   orario fuori dalle finestre o sovrapposto viene rifiutato con gli spazi
   liberi;
5. finche' resta tempo **richiede cosa mettere nel tempo che resta**, con gli
   spazi liberi residui; "basta cosi'" chiude;
6. alla fine mostra il riepilogo e chiede conferma: solo allora scrive il piano
   (stato `approvato`, sorgente `mirko`) salvando le fasce in
   `contenuto.agenda_blocchi` come `[{opzione, da: "HH:MM", a: "HH:MM"}]`.

Vincoli: le due liste Consumer sono una modalita' al giorno (la seconda viene
rifiutata). Le fasce confermate **diventano vincolanti** per il motore: dentro
"Lead Outbound Aziendali" KONA propone i lead delle categorie approvate, nelle
fasce manuali non propone nulla e lascia il contatore delle chiamate
all'operatrice; fuori dalle fasce restano lavorabili solo le priorita' 1-6.
Se il piano non ha fasce proprie si usa la `programmazione_base` di
configurazione, quindi la giornata ha sempre una forma anche senza aprire
`/agenda`.

Nella schermata dell'operatrice il briefing mostra **cosa c'e' in corso adesso**
(con la fascia oraria), i **lead aziendali pronti** e il lavoro in coda diviso fra
MATTINA e POMERIGGIO; mostra anche le **categorie approvate** e, se non
corrisponde nessun contatto, lo dice esplicitamente: un piano che non puo'
partire si vede subito invece che a fine giornata.

### Attesa prima di riproporre non presentati e passaggi

Chi non si e' presentato all'appuntamento, o chi ha detto che sarebbe passato in
negozio (o a Cerea), **non viene richiamato il giorno stesso**: il cliente ha
detto che passa fra qualche giorno. Questi eventi restano fuori dalla coda per
`giorni_attesa_ripresentazione` giorni (default **5**, valore di configurazione)
calcolati dalla data dell'appuntamento mancato o della chiamata che li ha
generati; al quinto giorno tornano lavorabili. Con `0` tornano lavorabili subito
(comportamento precedente).

**Alla vendita si chiude tutto.** Quando una pratica viene finalizzata da Upload
Contratti, per quel cliente la RPC `vendita_chiudi_eventi_cc_per_pratica_v2`
(migration `079`) annulla gli appuntamenti ancora aperti, chiude le chiamate in
rilavorazione e i passaggi, porta i **non presentati** a "lavorato" e marca
`esito_finale='vinta'` sugli appuntamenti del cliente (quelli con esito ancora
aperto, entro 90 giorni): cosi' un cliente che ha comprato non resta in coda e la
vendita risulta vinta nel KPI Call Center. Senza la v2 (migration non applicata)
il codice usa la v1: le due chiusure nuove non avvengono.

Costo: l'assistente ha una riserva dedicata di **10 EUR/mese**
(`riserva_telegram_eur`) e un tetto di 60 messaggi interpretati all'ora
(`max_messaggi_telegram_ora`). La spesa e' registrata nel registro budget con
attivita' `telegram`, quindi e' distinguibile da quella OpenAI. Il tetto orario
Telegram e' separato da `max_chiamate_openai_ora`: una raffica di messaggi non
consuma il tetto delle chiamate, e il tetto dei messaggi non limita piano e
analisi (che sono chiamate di sistema, non messaggi).

Piano giornaliero e analisi della giornata usano lo stesso provider DeepSeek ma
restano fuori dalla riserva Telegram: sono attivita' `piano` e `analisi`, quindi
ricadono nella riserva "dialogo" (`riserva_dialogo_eur`) del budget dedicato.

**Trasferimento dati extra-UE**: il testo dei messaggi di Mirko e gli aggregati
della giornata (conteggi, zone, budget) vengono inviati a DeepSeek (server in
Cina). Non contengono dati di clienti, ma il trasferimento va citato
nell'informativa privacy del Titolare.

Priorita' operative:

1. conferme degli appuntamenti Business esterni del giorno lavorativo
   successivo, nelle finestre 09:00, 11:30, 15:30 e 18:00;
2. ricontatti programmati;
3. non risposti automatici;
4. appuntamenti non presentati;
5. Passa a Cerea;
6. Passa in negozio;
7. lead outbound aziendali (solo dentro una fascia "Lead Outbound Aziendali",
   filtrati dalle categorie approvate).

Le priorita' 1-6 valgono sempre e vincono anche dentro le fasce manuali. I lead
aziendali, invece, vengono proposti **solo** se la fascia in corso della
programmazione del giorno e' "Lead Outbound Aziendali": nelle fasce manuali
("Fisso", "Telefoni Omaggio") il sistema non propone nessun contatto e
l'operatrice telefona sulle liste cartacee registrando ogni chiamata col
contatore. Le vecchie priorita' 7 (campagne urgenti sui lead `pinned`) e 8
(nuovi lead Business sempre proposti) non esistono piu': un lead bloccato dal
proprietario e' un lead come gli altri e rientra nella lista se la sua categoria
e' approvata.

La fascia oraria in corso si legge in quest'ordine:

1. `contenuto.agenda_blocchi` del piano del giorno, se presente (fasce scelte da
   Mirko con l'agenda guidata su Telegram);
2. `programmazione_base` di configurazione (09:00-10:30 aziendali,
   10:31-12:30 Fisso, 15:30-17:00 aziendali, 17:01-19:00 Fisso);
3. fuori da ogni fascia: nessuna attivita' programmata, quindi nessun lead
   aziendale (le priorita' 1-6 restano comunque lavorabili).

La coda viene **ricomposta a ogni contatto concluso**: non e' "finisco la
categoria 1, poi la 2". Se fra un contatto e il successivo diventa dovuto un
ricontatto o un non presentato, quello scavalca i nuovi lead. Dopo le 18:00
(`orario_stop_business`) i nuovi lead Business non vengono piu' proposti.
Gli eventi con attesa (non presentati, passaggi) compaiono solo quando
l'attesa di `giorni_attesa_ripresentazione` e' scaduta.

La scheda contatto mostra telefono, CF/P.IVA, comune/provincia e l'indirizzo
canonico disponibile: `via` + `civico` dall'anagrafica condivisa oppure
`indirizzo` del lead Business. Le code Rilavorazione riusano esattamente le
fonti e gli stati del manuale. Per non presentati, Passa in negozio e Passa a
Cerea l'operatrice sceglie prima `Presentato` (o `Presentato (dimenticanza)`)
oppure `Ricontatta`; soltanto il secondo apre la chiamata e i suoi esiti. Un
eventuale appuntamento durante la rilavorazione usa gli slot del calendario
negozio condiviso e salva chiamata/appuntamento nelle tabelle canoniche.

Dopo quattro tentativi di conferma senza risposta non avviene alcun
annullamento automatico: Mirko riceve una notifica Telegram e decide.
Le attivita' Business standard non iniziano dopo le 18:00 e non partono se il
piano approvato non contiene almeno una categoria esplicita; il contatto gia'
in corso puo' essere terminato.

## Doppia interfaccia e dati canonici condivisi

KONA Call Director non e' un modulo aggiuntivo del Call Center manuale: quando
e' attivo per un'operatrice, diventa la sua unica interfaccia operativa.

- KONA globalmente disattivato: tutti usano il sistema manuale.
- KONA attivo + profilo non abilitato: il profilo usa il sistema manuale.
- KONA attivo + operatrice non-admin abilitata: vede **solo** KONA, senza
  navigazione delle vecchie sezioni; l'accesso diretto a una pagina manuale
  reindirizza a `kona-call-director.html`.
- Admin: mantiene l'accesso manuale e vede la tab `KONA CD` + il pannello
  `admin-kona-call-director.html` per attivare/disattivare/abilitare. Quando
  entra nella pagina agente, anche l'admin vede soltanto la shell KONA senza
  alcuna tab del sistema manuale.

Il routing e' deciso server-side da `kona-call-director-route` (ruolo +
`kona_call_director_profili.abilitato` + toggle globale): il controllo non e'
cosmetico. `js/cc-header.js` applica la decisione nascondendo le tab o
reindirizzando. Se il routing non e' verificabile, un profilo non-admin vede un
blocco temporaneo e non il sistema manuale: un errore di rete non diventa un
bypass di KONA.

**Una sola fonte di verita' per i dati operativi.** Gli esiti KONA scrivono
nelle stesse tabelle canoniche del Call Center manuale:

- gli esiti Consumer vengono registrati in `chiamate` (oltre che nell'audit di
  sessione `kona_call_director_sessione_attivita`), con `registraChiamataConsumerCanonica`;
- gli appuntamenti Consumer vanno in `appuntamenti` (fonte `interno`) e la
  chiamata collegata in `chiamate` con esito `appuntamento`;
- Business/rilavorazioni scrivono gia' `call_center_lead_outbound_chiamate` /
  `chiamate`; la Black List e' la tabella condivisa `blacklist`.
- la ricerca istantanea per numero legge anagrafiche, chiamate e lead Business
  canonici; la correzione dello stesso esito entro la giornata aggiorna
  `chiamate` in transazione e aggiunge una riga immutabile in
  `kona_call_director_correzioni_esito`.

Le tabelle `kona_call_director_*` contengono solo orchestrazione, sessioni,
task/lease, briefing/piani, audit, dialogo e telemetria: mai una seconda copia
dei dati definitivi.

## Esperienza operatore (macchina a stati)

La pagina `moduli/call-center/kona-call-director.html` e' una macchina a stati
esplicita: una sola schermata visibile alla volta, nessun pannello tecnico e
nessuna scelta manuale fra Consumer, Business, rilavorazioni o calendario.

Stati:

1. `welcome` — saluto coerente con l'orario, nome dell'operatore autenticato,
   un unico pulsante `Avvia` (o `Riprendi` se esiste gia' un task lavorabile).
2. `briefing` — il **programma dell'intera giornata**, separato in MATTINA e
   POMERIGGIO, ricavato dalle attivita' realmente disponibili (stesso motore
   dei candidati, nessuna fonte parallela). Mostra solo attivita' non vuote e
   tiene separati il piano giornaliero dalla coda immediatamente lavorabile.
   Pulsante `Avvia chiamate`.
3. `contact` — un solo contatto: nome/ragione sociale, telefono, numeri
   alternativi, comune/provincia, categoria, motivo, ultimo esito e note,
   tentativi effettuati. Pulsante `Inizia chiamata` (nessuna chiamata
   automatica, nessuno script).
4. `outcome` — gli esiti previsti dal flusso, dipendenti dal tipo di task.
5. `followup` — azione condizionale: `Ricontattare` permette di affidare data e
   fascia all'alternanza automatica del backend oppure di registrare giorno e
   fascia concordati dall'operatrice, anche nella fase Consumer; `Altro` chiede una spiegazione obbligatoria
   (valutata una sola volta dall'IA, la decisione resta dell'operatrice).
6. `calendar` — visibile SOLO dopo l'esito `Appuntamento` su un lead Business:
   almeno dieci giornate lavorative nell'orizzonte standard, slot liberi,
   riepilogo e conferma. Nessun titolo o dettaglio degli eventi privati. Dopo
   la sincronizzazione l'esito viene completato e KONA passa al contatto
   successivo; un retry dello stesso task non duplica l'evento.
7. `manuale` — la schermata delle **fasce manuali** ("Fisso", "Telefoni
   Omaggio"). KONA non propone nessun contatto: mostra l'attivita' in corso con
   la sua fascia oraria, il contatore delle chiamate registrate
   (`chiamate_fascia`, letto dalla sessione e non dal browser) e il pulsante
   `Registra chiamata` (esito + nota facoltativa) che chiama
   `registra_chiamata_manuale`. La categoria la decide la programmazione, non
   l'operatrice. `Aggiorna fascia` rilegge lo stato e rimette l'operatrice sulla
   fase giusta quando la fascia cambia, `Censisci cliente` apre il flusso
   Consumer completo per chi vuole anche l'anagrafica.
8. `consumer` — fase automatica quando la fascia in corso e' una lista Consumer
   e non restano task materializzabili: KONA **avvia da solo la sessione
   Consumer della fascia** (`avvia_consumer`), cerca il CF/P.IVA, mostra o
   raccoglie l'anagrafica completa e registra l'esito canonico senza aprire
   `registra-chiamata.html`. L'esito `Appuntamento` apre lo schermo `negozio`,
   che riusa `get_slot_disponibili` + prenotazione nel calendario del negozio
   (nessun Google Calendar personale).

La modalita' Consumer della fascia in corso (`fibra_fwa` o `telefoni_omaggio`)
viene da `agenda_blocchi` del piano o dalla `programmazione_base`; solo fuori da
ogni fascia resta il fallback sul campo canonico `consumer` del piano (e sul
legacy Telegram `categoria_sessione`), cosi' le direttive scritte prima
dell'agenda guidata continuano a funzionare.
La prenotazione negozio e la registrazione dell'esito sono compensate: se l'esito
non viene salvato, l'appuntamento appena creato viene rimosso.
9. `negozio` — calendario del negozio per il contatto Consumer gia' caricato
   nella scheda agente (anagrafica, motivo, slot e conferma). Reusa API,
   disponibilita' e prenotazione del flusso Call Center esistente, senza
   duplicare la logica backend.
10. `transition` — breve passaggio quando cambia **famiglia** (conferme,
    rilavorazioni, Business, Consumer), mai fra task della stessa famiglia.
    L'ingresso nel Consumer e il completamento sono gestiti.
11. `completed` — fine delle attivita' previste, con `Ricontrolla`.
12. `error` — errore con `Riprova`, senza perdere il task corrente.

La barra agente mostra avanzamento e fase corrente. Gli strumenti persistenti
`Ricerca numero`, `Chiamate di oggi` e `Pausa` restano nella stessa pagina:
la ricerca apre immediatamente cliente, motivo e storico; le chiamate
modificabili nello stesso giorno espongono una correzione motivata e auditata.
Un errore reale del servizio AI, riconosciuto da una allowlist server-side,
blocca il flusso KONA e abilita per 30 minuti il sistema manuale soltanto per
quel profilo, accodando a Mirko una notifica Telegram priva di PII.

Separazione calendari: Business usa il Google Calendar personale collegato a
KONA; Consumer rimanda al calendario del negozio gia' usato dal flusso Call
Center. Il client non sceglie il calendario: il tipo di task lo determina.

Idempotenza: `Avvia` non crea sessioni; `Avvia chiamate` e `Prossimo` ritornano
il task gia' attivo senza duplicarlo; un doppio click sull'esito non salva due
volte; il refresh riprende il task attivo. Lo stato server (task, sessione,
piano, esiti) resta la fonte di verita': il frontend non simula completamenti.

## Garanzie applicate

- Tre interruttori indipendenti: env, globale DB e profilo operatore.
- L'env e' fail-closed: KONA parte soltanto con
  `KONA_CALL_DIRECTOR_ENABLED=true` esplicito.
- Blacklist ed esclusioni sono ricontrollate prima di proporre un contatto;
  in caso di errore la coda si ferma in sicurezza.
- Lease, acquisizione job e prenotazione budget sono atomici.
- La registrazione dei tentativi usa chiavi stabili e impedisce duplicati.
- Il budget OpenAI usa riserve atomiche, conversione USD/EUR configurabile e
  notifiche alle soglie 70/85/95/100%.
- Ogni lead usa al massimo due web search complessive; non esiste retry inline
  automatico che possa raddoppiare un costo incerto.
- Google Calendar viene ricontrollato immediatamente prima della prenotazione;
  create, modifica e annullamento hanno compensazione e riconciliazione.
- Lo stato OAuth e' firmato, scade ed e' consumabile una sola volta.
- Telegram accetta soltanto il bot dedicato, il secret del webhook e il
  `chat_id` del proprietario.
- Telegram e log non ricevono PII; gli appuntamenti privati di Mirko non sono
  mostrati all'operatore, che vede solo le fasce disponibili.
- I dati Consumer identificativi non vengono inviati a OpenAI.
- Al modello che interpreta i messaggi Telegram arrivano soltanto aggregati, e
  nessuna azione che cambia lo stato viene eseguita senza un "si" esplicito.
- I messaggi vocali non vengono trascritti: nessun audio inviato a provider.
- Le 25 tabelle `kona_call_director_*` sono server-only con RLS e privilegi
  riservati alla service role.
- Le correzioni esito sono atomiche e ammesse solo nella giornata corrente
  all'operatore proprietario o a un admin; il relativo audit non consente
  UPDATE o DELETE.
- Il failover non e' un interruttore globale: scade automaticamente ed e'
  limitato al solo profilo coinvolto.

## Prerequisiti esterni

Prima del collaudo operativo servono:

- progetto OpenAI dedicato e chiave server-side;
- account DeepSeek con chiave server-side per l'assistente Telegram;
- OAuth Google Calendar per il calendario personale di Mirko Piasenti;
- bot Telegram separato e relativo `chat_id` proprietario;
- dataset autorevole delle coordinate dei comuni;

La migration `070` deve essere gia' presente, perche'
`kona_call_director_comuni` referenzia `mirox_comuni_istat`.

## Variabili Netlify

| Variabile | Impostazione iniziale |
|---|---|
| `KONA_CALL_DIRECTOR_ENABLED` | `false`; passare a `true` solo durante il collaudo controllato |
| `KONA_CALL_DIRECTOR_OPENAI_API_KEY` | chiave del progetto OpenAI dedicato, solo server-side |
| `KONA_CALL_DIRECTOR_OPENAI_MODEL` | modello approvato e coerente con i prezzi configurati |
| `KONA_CALL_DIRECTOR_DEEPSEEK_API_KEY` | chiave DeepSeek del dialogo Telegram, solo server-side |
| `KONA_CALL_DIRECTOR_DEEPSEEK_MODEL` | opzionale, default `deepseek-flash` (DeepSeek V4.1 Flash) |

**Le variabili entrano nel processo delle function soltanto al deploy
successivo**: dopo aver aggiunto o corretto una env su Netlify serve un nuovo
deploy, altrimenti il codice continua a vederla assente. Il sintomo tipico e'
il bot Telegram che risponde "Assistente non configurato: manca la variabile
`KONA_CALL_DIRECTOR_DEEPSEEK_API_KEY`"; il comando `/stato` mostra la riga
`Interpretazione IA: configurata / NON configurata`, utile per distinguere una
chiave mancante da un guasto temporaneo del provider.
| `KONA_CALL_DIRECTOR_GOOGLE_CLIENT_ID` | OAuth client ID |
| `KONA_CALL_DIRECTOR_GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `KONA_CALL_DIRECTOR_GOOGLE_REDIRECT_URI` | callback dell'ambiente verso `kona-cc-google-callback` |
| `KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY` | 64 caratteri hex, dedicata alla cifratura AES-256-GCM |
| `KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN` | token del bot KONA Call Director |
| `KONA_CALL_DIRECTOR_TELEGRAM_WEBHOOK_SECRET` | secret casuale configurato anche nel webhook Telegram |
| `KONA_CALL_DIRECTOR_OWNER_CHAT_ID` | solo chat di Mirko |
| `KONA_CALL_DIRECTOR_STAGING_RUN` | `false` finche' lo staging non e' pronto; poi `true` per provare il cron |

Con la Scheduled Function Netlify nativa lasciare
`KONA_CALL_DIRECTOR_CRON_SECRET` **non impostata**: la schedulazione nativa non
aggiunge l'header personalizzato richiesto dal controllo opzionale. Il secret
serve soltanto se in futuro il dispatcher viene invocato da uno scheduler
esterno controllato.

## Procedura di attivazione in staging

1. Stato completato il 2026-08-28: progetto test creato in `eu-west-3` e
   bootstrap minimo `database/staging/003_kona_call_director_bootstrap.sql`
   applicato senza copiare dati production.
2. Stato completato: migration `database/072_kona_call_director.sql`,
   `database/073_kona_call_director_consumer_appuntamento.sql` e
   `database/074_kona_call_director_agente_unificato.sql` applicate soltanto
   al progetto test; seed disattivato applicato.
3. Stato completato il 2026-08-29: verificate 25 tabelle KONA, sei RPC
   `kona_cd_*`, RLS, zero grant browser sui nuovi oggetti, zero dati personali
   nei registri 074 e nessuna funzione `SECURITY DEFINER`.
4. Importare le coordinate da una fonte autorevole in
   `kona_call_director_comuni`. Senza import il sistema continua a funzionare,
   ma la priorita' geografica resta degradata a `unknown`.
5. Configurare le env dello staging mantenendo
   `KONA_CALL_DIRECTOR_ENABLED=false` e `KONA_CALL_DIRECTOR_STAGING_RUN=false`.
6. Stato completato: il sito `mirox-kona-call-director-test.netlify.app`
   pubblica la branch `kona-call-director` con service role del solo database
   test. Dal 2026-08-29 i due interruttori sono attivi esclusivamente per il
   collaudo controllato.
7. Salvare e ricontrollare: budget 50 euro, riserve 40/10/10, cambio USD/EUR,
   prezzo del modello OpenAI e del modello DeepSeek, 50 lead/notte, due web
   search massime, sessione Business 90 minuti, durata appuntamento 45 minuti,
   raggio indicativo 20 km e orari.
8. Applicare a mano `database/078_kona_call_director_telegram_ai.sql` al solo
   database di test (fatto il 2026-09-14) e impostare
   `KONA_CALL_DIRECTOR_DEEPSEEK_API_KEY` **seguita da un nuovo deploy**: le env
   di Netlify entrano nelle function solo al deploy successivo. Senza la
   migration l'assistente funziona lo stesso (fallback sulla RPC `v1` con
   controllo del tetto in JS), ma il tetto Telegram non e' atomico.
9. Collegare Google dal pannello Admin. Verificare lettura free/busy,
   creazione, modifica e annullamento di un appuntamento di prova; controllare
   che Isabella non veda titolo o dettagli degli eventi privati.
10. Registrare il webhook Telegram dell'ambiente sulla function dedicata usando
    lo stesso secret configurato in Netlify. Provare `/stato`, `/piano`,
    `/approva`, `/sospendi`, `/riattiva`, un messaggio libero e la conferma
    "si"/"no". Verificare che un vocale riceva la richiesta di scrivere il testo.
11. Abilitare soltanto il profilo di Isabella e mantenere
    `modalita_osservazione=true`; lasciare ancora spento il toggle globale.
12. Portare `KONA_CALL_DIRECTOR_ENABLED=true` e
    `KONA_CALL_DIRECTOR_STAGING_RUN=true`, poi attivare il toggle globale dal
    pannello Admin. Questo ordine rende l'attivazione deliberata e reversibile.
13. Eseguire almeno un ciclo completo di prova e verificare database, pagina
    operatore, report Telegram, audit e consumo budget (compresa la voce
    Telegram separata).

### Preparazione operativa del 31/08/2026

- Stato DB verificato: zero contatti, chiamate, lead, appuntamenti, task e
  sessioni; collegamenti Google e Telegram conservati.
- Solo il profilo `test` e' abilitato e resta in osservazione.
- Il piano approvato prevede Consumer manuale sia al mattino sia al pomeriggio;
  categorie Business vuote e arricchimento automatico disabilitato.
- Orari: lunedi'-venerdi', 09:00-12:30 e 15:30-19:00.
- Isabella accede allo staging, preme `Avvia`, poi `Avvia chiamate` e inserisce
  CF/P.IVA, nominativo, telefono e dati anagrafici del contatto reale. Tutto il
  flusso resta dentro KONA.
- Dopo la prova esportare solo gli elementi tecnici necessari alla diagnosi e
  bonificare dal Supabase test i dati personali inseriti.

#### Verifiche obbligatorie PRIMA del collaudo (audit 2026-09-01)

**Stato al 2026-09-14: tutti e tre i file SQL sono stati applicati al Supabase
test `yyorullxmdxhnunsfwwa` e il controllo automatico e' passato su 10 verifiche
su 10.** Production non e' stata toccata. Restano qui sotto come traccia.

1. **Calendario negozio (blocco K1)** — RISOLTO. `database/staging/006_kona_call_director_negozio_dipendenze.sql`
   applicato: le quattro tabelle di configurazione, `get_slot_disponibili` e gli
   orari lun-ven risultano presenti. L'esito Consumer `Appuntamento` (schermo
   `negozio`) e' ora collaudabile.
2. **Migration di hardening** — APPLICATE. `database/076_kona_call_director_hardening.sql`
   e `database/077_kona_call_director_rpc_hardening.sql` sono attive sul database
   di test: vista ricontatti con `anagrafica_id`, registri di controllo
   append-only, prenotazione negozio atomica, tetto orario di spesa, dead-letter
   dei job e autorizzazione delle correzioni lette dal database.
3. **Arricchimento disattivato**. `richieste_web_max_per_lead = 0` e
   `lead_notte_obiettivo = 0` ora sono rispettati come valori espliciti: con
   questi valori non partono chiamate OpenAI e non viene piu' inviato il falso
   allarme notturno "Anomalia arricchimento".
4. **Pausa**. Se l'operatrice mette in pausa e ricarica la pagina, il task
   sospeso viene ora ripreso automaticamente all'ingresso.

## Collaudo obbligatorio

Il collaudo staging deve coprire almeno:

- blacklist per CF e per tutti i numeri disponibili;
- un solo contatto attivo per operatore e sblocco dopo esito;
- pressione ripetuta di `Prossimo contatto` restituisce lo stesso task attivo
  senza nascondere la scheda o crearne un secondo;
- skip motivato, contestazione una sola volta e decisione finale operatrice;
- tre tentativi ordinari e quattro tentativi per le conferme;
- conferma di venerdi proposta per lunedi, salvo ferie configurate;
- appuntamento creato, riprogrammato e annullato con Google;
- indisponibilita' Google: nessuna doppia prenotazione e notifica;
- sessione Business bloccata dopo le 18:00;
- sessione Business standard bloccata senza categorie approvate e filtrata
  esclusivamente sulle categorie del piano;
- sessione Consumer manuale tracciata senza suggerimento automatico di lead;
- lookup/creazione anagrafica Consumer, esito canonico visibile anche nel
  sistema manuale e appuntamento sul calendario negozio;
- ricerca istantanea di una chiamata in entrata per numero e apertura del
  relativo motivo/storico;
- correzione motivata di un esito nella stessa giornata, con audit append-only,
  e rifiuto della correzione oltre la giornata o su chiamate altrui;
- guasto AI simulato: bypass manuale limitato al profilo, scadenza 30 minuti e
  notifica Telegram senza PII;
- arricchimento notturno di un piccolo lotto e fonti realmente registrate;
- esaurimento simulato delle riserve OpenAI e notifica soglia budget;
- report 19:10, proposta 20:05, reminder 20:00 e 08:00, piano default 08:30;
- spegnimento immediato tramite toggle globale ed env.

## Cron

Il dispatcher gira ogni cinque minuti e usa l'orologio Europe/Rome. Gli eventi
ordinari hanno una finestra di recupero di 20 minuti; arricchimento e retention
di 60 minuti. Ogni evento e' idempotente per data e nome e ha al massimo tre
tentativi nella propria finestra.

Sequenza: 02:00 arricchimento, 03:30 retention, 08:00 reminder mattina, 08:30
piano default, 19:10 report serale, 20:00 reminder sera e 20:05 proposta del
piano del giorno lavorativo successivo. A ogni tick vengono inoltre gestiti
task, conferme, piccoli batch di job, riconciliazione Google e outbox Telegram.

## Passaggio in production

Passare in production soltanto dopo il collaudo staging firmato. Ripetere gli
step 1-12 usando credenziali, callback, bot, webhook, database e calendario di
production distinti. Effettuare il primo avvio in un giorno lavorativo
sorvegliato, con Isabella presente, `modalita_osservazione=true` e Mirko
raggiungibile su Telegram. Mantenere l'osservazione per almeno la prima
settimana e confrontare chiamate, appuntamenti, scarti, anomalie e costi.

## Arresto e rollback operativo

Per fermare KONA senza perdere dati:

1. disattivare immediatamente il toggle globale nel pannello Admin;
2. impostare `KONA_CALL_DIRECTOR_ENABLED=false` e ridistribuire la config;
3. disabilitare il profilo di Isabella;
4. mettere in pausa il webhook Telegram e, se necessario, disconnettere Google;
5. conservare tabelle e audit per diagnosi: non e' necessario alcun rollback DB.

La migration e' additiva, ma rimuovere tabelle o funzioni KONA e' un'azione
distruttiva. Un eventuale rollback strutturale va preparato separatamente,
dopo export dei dati e approvazione esplicita, eliminando soltanto oggetti con
prefisso `kona_call_director_*` e RPC `kona_cd_*` nell'ordine corretto delle
dipendenze. Non eseguire DROP durante il normale arresto.

## Verifica locale conclusiva

Ogni richiesta operativa della pagina agente usa il popup di caricamento
condiviso e blocca i click successivi fino alla risposta. Il lock delle
operazioni composte viene sempre rilasciato anche in errore.

- `node --test tests/kona-call-director.test.js`: 113/113 pass.
- `npm test`: 236/236 pass, inclusa build statica production.
- Nessuna modifica o migration production fa parte di questa correzione.
