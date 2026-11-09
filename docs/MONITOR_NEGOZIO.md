# Monitor KPI negozio — servizio Windows e aggiornamenti pagina

Stato: **aggiornamento06/11 pubblicato con codice42ddc96**, Netlify
6aee57bbf9012b875feb1a2e. CI42306373563(ramo tecnico) e42306680853(main):
687test Linux/Node22 e prove Windows native verdi. HTTP10payload/ZIP22file/SHA,
API senza credenziali e updater reale HTTPS→loopback verificati. Nessun browser.

L’utente ha installato il pacchetto autoaggiornabile e mostra i KPI sul Samsung
verticale il 09/11. Windows 11 Pro e visione solo personale confermati.
Restano da verificare il nuovo layout sul Samsung, il timer e la giornata completa.
Migration05/11 gia applicate20261105131100/20261105131331, nessuna nuova migration
per questo aggiornamento e nessuna modifica ai DB condivisi del Call Center.

## Pagina e layout concordati

`monitor.html`, `css/monitor.css`, `js/monitor-core.js`, `js/monitor.js`:
logo originale del repository, appuntamenti in alto, Day by Day al centro,
avanzamento mensile in basso. Tema Mirox chiaro/arancione e Inter 4.1 locale
(`assets/fonts/InterVariable.woff2`, licenza SIL OFL allegata), senza CDN sul TV.

- Agenda: previsti/presentati/non presentati/in attesa; prossimo appuntamento
  sempre fisso, conto alla rovescia o ritardo; successivi tre per pagina, cambio
  ogni 15 secondi se necessario. Solo codici, orari e durata: nessun nome,
  recapito, motivo libero, documento o nota cliente letto per il monitor.
- Day by Day: tutte le righe attive e i gruppi della Dashboard Pezzi, stessi
  nomi/colori/ordine, intestazioni MATTEO/MIRKO/VINCENZO/CEREA dal core per
  periodo, zeri vuoti e data arancione. Nessuna colonna Totale aggiunta.
  Totale pezzi sopra la tabella: somma delle corrispondenze, non contratti unici.
  Alla lettura della configurazione in fase mockup erano 39 righe/6 gruppi;
  il runtime usa il catalogo corrente e non congela questi numeri.
- Mensile: Standard, P.IVA ed Extra P.IVA, **senza dettaglio pezzi**; soli punti,
  obiettivi e andamento. Le righe P.IVA senza obiettivo conservano i soli punti.
  Netto L&G e ultimo CSV globale restano distinti.
- Data/ora Europe/Rome; timestamp dell'ultimo snapshot riuscito, non dell'ultimo
  tentativo. Nel nuovo pacchetto06/11: avviso dopo15secondi senza dati nuovi,
  obsoleti dopo60secondi (rilascio05/11:90s/5min).
  Cambio giorno: dati precedenti nascosti fino al nuovo snapshot; cambio mese
  gestito dal server. Nessun numero fittizio o fallback a zero su errori.

Tela logica 1080×1920. Dopo il taglio osservato sul Samsung, la correzione 09/11
riserva il 3% dell’altezza sopra la tela e il 2,5% sotto, prima di ridurre il
contenuto in scala uniforme. Il nuovo ritaglio include tutta la scritta del logo
e la fusione CSS uniforma il fondo, riusando il file originale. Suite 695/695
verde e passaggio dal pacchetto del 06/11 al manifest
della nuova build verificato con l’updater. La leggibilità va provata sul TV
dopo la pubblicazione. Le righe molto numerose riducono la dimensione del testo.
La pagina remota e' una shell senza dati e spiega come installare la postazione.

## Dati e backend

`monitor-kpi`:
- GET: soltanto `Authorization: MiroxMonitor <segreto dispositivo>`; nessun JWT
  operatore, parametro data/negozio o privilegio operativo. Verifica stato e
  negozio sia prima sia dopo il calcolo/cache. Risposta no-store, senza CORS.
- POST `associa`: codice monouso emesso dall'Admin e hash della credenziale
  generata dal servizio Windows. Rate limit persistente: 20 tentativi/15 minuti
  per chiave HMAC dell'IP Netlify, fallback a bucket comune se manca l'header
  affidabile. Nessun indirizzo IP o token in chiaro conservato a database.
- Qualunque scrittura KPI o altro metodo e' rifiutato. Il codice dispositivo
  non e' un utente Auth e non permette l'accesso a REST/Storage o moduli CRM.

`_lib/monitor-snapshot.js` riusa `dashboard-report-core` e i loader puri
`paged`/`monthlyState` di Target. Solo export additivo `CONTRACT_FIELDS` al loader
Target; report, invii e calcoli Target precedenti invariati. Day: data contratto
UTC e Legnago come Dashboard; mensile: perimetri, decorrenza account, stati,
reinserimenti e FTTC del core. Fissi Standard comprende Cerea; altri avanzamenti
conservano il proprio perimetro. FTTC di mesi precedenti: carica anche i loro
controlli post-vendita. Netto L&G legge l'ultimo CSV globale; errori bloccanti.
Appuntamenti confermati nella giornata Europe/Rome, cancellati esclusi;
Passa in negozio non viene sommato implicitamente.

Il server legge contratti senza anagrafica/documenti, calcola e restituisce solo
aggregati/codici appuntamento. Nuovo sviluppo06/11: cache di processo1secondo con singola richiesta
condivisa tra letture concorrenti, separata per data; solo snapshot completo.
Il servizio locale interroga ogni3secondi (intervallo fra inizi, senza sovrapporre
richieste), con retry fino30secondi e timeout15secondi. Circa13800richieste
remote/display/giorno in08:30–20:00,28800se sempre acceso; dieci volte il poll
del05/11. Cache di processo1s condivisa anche fra display concorrenti, nessuna
scrittura/ricalcolo nei moduli CRM operativi e nessuna modifica ai conteggi;
cache di processo, non cache distribuita o Supabase Realtime. Ultimo contatto
DB aggiornato al massimo ogni 5 minuti. Il frontend legge la copia locale ogni
secondo: latenza attesa indicativamente3–6secondi con rete/server regolari, a cui
si aggiungono eventuali rallentamenti di rete/query. Revoca normalmente entro4s
oltre al tempo di richiesta; guasti possono ritardarla, con avviso di dati obsoleti.
Non e' un limite massimo garantito. I pacchetti precedenti mantengono il poll30s:
per il nuovo intervallo anche sul PC serve installare una volta il nuovo helper.

## Associazione, Admin e migration

`admin-monitor.html` nell'area Configurazioni Admin, API `admin-monitor`:
autenticazione `requireAuth(adminOnly)`, profilo riletto da `authorizePages` e
controllo admin anche nella RPC di scrittura. Operatore/disabilitato negati.
Elenco ultime 200 postazioni con stato/ultimo contatto, creazione codice e revoca.
Codice mostrato solo nella risposta alla creazione, validita' 15 minuti;
nessun hash/credenziale nelle liste. Il codice non e' in URL o log.

Migration `database/20261105123113_monitor_kpi_dispositivi.sql`:
- `mirox_monitor_dispositivi`: nome, negozio Legnago, stato, hash SHA256 univoco
  della credenziale casuale 256 bit, hash codice, scadenza, autore e timestamp.
- `mirox_monitor_audit`: crea/associa/revoca append-only per service_role.
- `mirox_monitor_rate`: contatori limitati, rimozione bucket oltre 24 ore durante
  i tentativi; limite di 10.000 bucket. Nessun nuovo cron.
- RPC INVOKER/service-only `mirox_monitor_amministra`, `mirox_monitor_associa`,
  `mirox_monitor_limita`, search_path vuoto. Associazione/update e audit atomici,
  recupero idempotente dopo risposta persa, codice non riutilizzabile per altri
  segreti. Revoca idempotente; nessun trasferimento automatico della postazione.
- RLS ON, nessun accesso PUBLIC/anon/authenticated. Nessuna policy permissiva,
  nessuna funzione DEFINER; nessuna modifica a schema/RLS/RPC/trigger CC.
  `20261105131304_monitor_privilegi_service_role.sql` restringe i privilegi ALL
  ereditati dai default Supabase sulle sole tre tabelle: niente DELETE/TRUNCATE
  dispositivi o UPDATE/DELETE/TRUNCATE audit. Testati anche default production.

Attivazione05/11: consenso DB esplicito ricevuto dopo scadenza conferma del
connettore. Migration production20261105131100 applicata/riletta: RLS e grant
verificati, tabelle vuote, impronte profili/appuntamenti/RPC/policy/trigger legacy
identiche; WARN/ERROR advisor invariati (3 nuove INFO RLS senza policy attese
per gli archivi server-only). Nessun account o dispositivo di prova creato.

CLI ufficiale ha creato la migration, poi spostata in database come convenzione
CRM. La variante CLI Bun non scriveva telemetry nel sandbox; usata CLI Go con
XDG_CONFIG_HOME temporanea; applicazione autorizzata e verificata come sopra.

## Pacchetto e servizio Windows

`npm run build` genera `dist/assets/mirox-monitor-windows.zip` e file SHA256 con
`scripts/build-monitor-package.js` e fflate gia presente. Il pacchetto contiene
soltanto i file frontend del monitor, font/licenza, helper e istruzioni in
allowlist; manifest SHA256 per ciascun file. Niente backend, SQL, env o dati.
Download da Admin → Monitor negozio. Sorgenti in `tools/monitor-windows/`.

Prerequisito: Node.js LTS >=22 installato in Program Files, Edge aggiornato,
Windows 11. Nella cartella estratta, tasto destro su `installa-monitor.cmd` e
**Esegui come amministratore**, quindi confermare la richiesta Windows.
Non serve digitare comandi. Il launcher lascia aperta la console, distingue
errore/successo e richiama `install.ps1` con Windows PowerShell di sistema e
percorso quotato. Disponibile nel nuovo pacchetto locale06/11 (22file), non nello
ZIP20file pubblicato05/11. Trasferimento dal Mac al PC anche tramite chiavetta USB;
estrarre tutto sul PC prima dell'avvio, senza eseguire file dall'interno dello ZIP.
In alternativa eseguire `install.ps1` dalla cartella estratta come amministratore:
verifica hash, copia solo manifest, protegge ProgramData/MiroxMonitor per
SYSTEM/Administrators (proprietario/ACL e rifiuto reparse point) e registra task
SYSTEM all'avvio. Supervisor riavvia il processo se termina; non esegue restore,
non crea utenti/autologon e non cambia alimentazione, timer TV o Windows Update.
Debug06/11: verifica tutti gli hash prima di fermare la postazione, prepara uno
staging con ACL protette, arresta/attende soltanto i propri processi, copia lo
stato ancora cifrato e sostituisce la directory. Conferma successo solo dopo
risposta HTTP locale; in caso di avvio fallito ripristina directory e task
precedenti. Una pulizia incompleta della copia precedente non annulla il nuovo
servizio funzionante. La reinstallazione non richiede un nuovo codice se la
postazione e gia associata. Dettagli in [debug rilascio](MONITOR_DEBUG_2026-11-06.md).

`monitor-host.cjs`:
- bind solo 127.0.0.1:8765; route statiche/API in allowlist, niente proxy generico;
- controlli Host/Origin/Sec-Fetch-Site, nonce casuale per processo inserito nella
  pagina e richiesto sulle API; CSP locale, niente CORS e solo risorse locali;
- segreto generato localmente prima dell'associazione e salvato via DPAPI
  LocalMachine in `state.bin`, nella cartella riservata a SYSTEM/admin;
- credenziale lunga mai nel browser, URL, argomenti CLI o log; solo in memoria
  del servizio e sul canale HTTPS verso l'origine vincolata, senza redirect;
- nessuno snapshot scritto su disco. La copia in memoria rimane con timestamp
  durante guasti di rete, viene eliminata alla conferma di revoca;
- heartbeat pagina ogni5secondi; dopo 2 minuti senza heartbeat (3 minuti al
  primo avvio) termina solo Edge con l'esatto URL chiosco del monitor. Assigned
  Access lo riapre. Dopo riavvio host il nuovo nonce fa ricaricare il frontend.

DPAPI LocalMachine richiede anche ACL corrette: non costituisce isolamento da
amministratori locali o dalla compromissione del PC. Aggiornamenti del servizio
solo reinstallando un nuovo pacchetto scaricato da Admin, senza eseguire codice
remoto automaticamente. La reinstallazione conserva state.bin. Uninstall rimuove
solo il task; revocare da Admin, file/credenziali non cancellati automaticamente.
Staging: pacchetto senza origine predefinita; installazione con -Origin su un
Netlify distinto, production rifiutata. Nessun dato di staging indirizzato a prod.

## Aggiornamenti pagina dopo push — pubblicati06/11

Flusso scelto: modifiche richieste in chat, sviluppo/verifica locale, push solo
su richiesta esplicita del proprietario. Il push continua ad avviare il deploy
Netlify dell'intero repository; il commit puo riguardare solo il monitor.
Non e stato aggiunto uno scheduler di push o un cron notturno.

La build genera il manifest pubblico `/assets/monitor-release.json` con
formato/API1, elenco fisso10asset web, dimensioni e SHA256. L'identificatore della
versione deriva dal contenuto, quindi push estranei al monitor non ricaricano
lo schermo. Gli asset stanno in `/assets/monitor-releases/<versione>/`;
manifest no-store e URL di contenuto immutabili. Nessun dato KPI o credenziale.
Il trasporto aggiunge `.bin` ai nomi per escludere le riscritture HTML/PrettyURL
dell'hosting; i nomi originali e il MIME corretto vengono ripristinati dal servizio
loopback. Non si confronta un HTML post-processato con il suo sorgente di build.

`monitor-updates.cjs` interroga il manifest ogni30s e al primo avvio. Scarica
soltanto dall'origine HTTPS gia validata, senza credenziale dispositivo, con
redirect vietati, timeout20s, manifest max16KiB, file max2MiB/totale4MiB e
allowlist fissa di percorsi. Convalida API/dimensioni/impronte e presenza del
segnaposto di sessione HTML; attiva tutti i byte insieme solo a download completo.
Asset conservati solo in memoria, mai importati/eseguiti dal processo Node/SYSTEM.
Helper, PowerShell, config e state.bin non rientrano nel manifest remoto.

Il servizio inietta nella pagina nonce e versione, riscrive le risorse a URL
loopback versionati e notifica la versione corrente in `/api/snapshot`. Il
frontend rileva la differenza e si ricarica entro il successivo poll1s. Le
richieste di una pagina precedente continuano a leggere i propri byte, evitando
HTML/CSS/JS di versioni diverse. La credenziale resta nel servizio e non cambia.

La nuova pagina conferma il proprio avvio con heartbeat solo dopo un poll e
rendering riusciti (o form associazione pronto). Se non conferma entro45s dalla
prima apertura, il controllo watchdog15s torna alla pagina precedente e richiede
la riapertura della sola finestra monitor ad Assigned Access. La versione guasta
non viene riprovata finche il processo resta acceso, salvo piu di32versioni
guaste successive. La verifica rileva errori di avvio/rendering, non giudica la
leggibilita' grafica: quella va ancora verificata sul TV. Si conserva al massimo
la versione inclusa nel pacchetto, quella attiva e quella precedente. Al riavvio
si riparte dal pacchetto installato e si ricontrolla il server; senza rete rimane
la pagina inclusa, senza simulare dati KPI nuovi.
Debug06/11: il timer di passaggio parte anche se il viewer continua a inviare
heartbeat della vecchia versione senza ricaricare. Un errore rendering dopo una
prima conferma riapre la verifica45s e puo ripristinare la precedente. L'attesa
del primo snapshot resta distinta dall'errore pagina: browser vivo senza falsa
conferma rendering. Risorse HTML/CSS verificate anche in build; risposte compresse
limitate sui byte decodificati, download paralleli annullati in caso di errore.

Prima attivazione: pubblicare manifest/API/cache aggiornati con push autorizzato,
poi installare una volta il nuovo ZIP22file usando installa-monitor.cmd come
amministratore e riavviare il PC. Associazione esistente e configurazione chiosco
conservate. Dopo, le modifiche web compatibili nei10asset arrivano automaticamente
entro il controllo30s piu download/reload, dopo che il deploy e online; non serve
toccare file o riavviare il PC. Per cambiare il codice nativo del servizio Windows
o il protocollo oltreAPI1 rimane necessaria un'installazione esplicita.

QA del nuovo sistema:687/687test con build verdi, nessuno skip, sia in locale
sia in CI Linux/Node22. Windows nativo (runner windows-2025-vs2026) verifica
DPAPI fra admin e SYSTEM, ACL, installazione/reinstallazione, stato cifrato
identico, rifiuto pacchetto corrotto, rollback su avvio fallito e supervisor.
HTTP production: tutti i10payload .bin verificati per byte/dimensione/SHA,
ZIP22file identici per contenuto alla build e checksum pubblico coerente,
APIadmin401/device403senza credenziali. Una baseline sintetica ha scaricato la
release reale e servito HTML/CSS dal loopback, senza credenziali o letture KPI.
Release web `6b92eeb42fb1727dbea45128f797f43dc61d6331f2e960da988db1bcbc2df00c`.
[Pacchetto corrente](https://mirox-crm.it/assets/mirox-monitor-windows.zip),
[checksum corrente](https://mirox-crm.it/assets/mirox-monitor-windows.sha256).
Prove archiviate in tmp/monitor-debug-20261106, report MONITOR_DEBUG_2026-11-06.md.
Il precedente ZIP locale automatico405949byte e superato. Collaudo sul PC/TV
fisico e latenza effettiva del DB reali restano da verificare dal proprietario.

## Configurazione PC e Samsung ME40B

### Correzione riassociazione06/11 — inclusa nel rilascio

Windows PowerShell converte `$null` nel parametro string .NET in stringa vuota.
Il terzo parametro di `File.Replace` deve invece essere un vero null per non
creare un backup: vault.ps1 usa ora
`[System.Management.Automation.Language.NullString]::Value`. Conservati DPAPI
LocalMachine, sostituzione atomica, ACL e file esistente; nessuna cancellazione
della credenziale. Questo difetto riguarda le scritture successive alla prima.

L'helper aggiorna la credenziale in memoria solo dopo il successo del salvataggio;
se la conferma locale fallisce dopo il successo remoto, il retry conserva lo stesso
segreto gia persistito. Messaggio archivio esplicito, limite429 distinto, nessun
dettaglio interno o segreto esposto. Test Node con fallimento iniziale/finale,
retry con stessa chiave, recupero da nuovo host e revoca/riassociazione.
`scripts/check-monitor-vault.ps1` prova DPAPI reale su dati sintetici in directory
temporanea, prima scrittura, aggiornamenti e riassociazione; aggiunto job Windows
PowerShell in CI. Non eseguibile sul Mac; ora eseguito con successo sul runner Windows.
QA locale:19test monitor mirati e suite completa668/668 con build verdi;
nessuna prova Windows/DPAPI reale o scrittura DB eseguita da Codex.
Il nuovo ZIP viene generato dalla build; aggiornamento completo tramite reinstallazione
del pacchetto corretto, conservando state.bin. Nessuna migration necessaria.

Per assistenza immediata sul PC gia installato si puo correggere il solo
vault.ps1 protetto da una PowerShell amministratore, sostituendo esattamente
`[IO.File]::Replace($temp,$Path,$null)` con
`[IO.File]::Replace($temp,$Path,[System.Management.Automation.Language.NullString]::Value)`.
Non serve riavviare l'helper: invoca lo script ad ogni operazione di archivio.
La correzione manuale non aggiorna il manifest installato: completare poi la
reinstallazione del pacchetto corretto, evitando di reinstallare lo ZIP05/11.

Revisione2 locale06/11: l'utente conferma installazione riuscita ma stesso errore
generico. Log production letti in sola lettura (senza hash/codici/parametri)
confermano23505 sul vincolo mirox_monitor_dispositivi_token_hash_key; prima
associazione riuscita, poi revoca, nuovi tentativi con credenziale gia registrata.
Il bug vault poteva lasciare associated:false persistito, pur mostrando KPI nella
prima sessione. Dopo riavvio/revoca l'helper trattava il token come tentativo
pendente e lo riutilizzava, entrando in conflitto con la riga revocata conservata.
Ora un403 confermato invalida la chiave per il prossimo pairing anche se pending;
la nuova chiave e persistita prima del POST. Senza403 i retry mantengono lo stesso
segreto, incluso il recupero dopo risposta persa. Nessuna modifica DB o RPC.
Regressione host riprodotta con503prima/200dopo; prova SQL isolata verifica
vincolo23505, nuovo codice intatto dopo errore, vecchia revoca invariata e successo
con una nuova chiave/audit singolo. Nuovo ZIP distinto ripristino-2, installer
identifica revisione2. Trasferire via USB, estrarre in cartella nuova, eseguire
installa-monitor.cmd come amministratore e riavviare il PC; poi codice appena
creato da Admin. avvia-monitor.cmd si apre normalmente, senza elevazione.
QA revisione2: suite669/669 con build e55check SQL PGlite isolati verdi.
Consegna locale distinta: tmp/monitor-ripristino-20261106/mirox-monitor-ripristino-2.zip,
21file/402636byte, SHA256
84e0f155b202745a6f1425938f4caa720ac681e27e8114f5b9dc6cc4bde342fa.
Il precedente mirox-monitor-corretto.zip e superato. Nessun push/pubblicazione;
l'utente conferma "Funziona!" dopo installazione revisione2. Resta il collaudo
completo di avvio autonomo, recupero rete/browser, timer e giornata08:30–20.

### Impostazioni della postazione

1. Windows 11 Pro (o altra edizione con Assigned Access): account locale standard
   dedicato → Impostazioni → Account → Altri utenti → Configura un chiosco → Edge
   cartellonistica → `http://127.0.0.1:8765/monitor`, nessun reset per inattivita'.
   Autologon locale da verificare sul PC reale. Home: avvia-monitor.cmd offre
   schermo pieno, ma non il blocco delle altre app o la riapertura Assigned Access.
2. HDMI, Samsung come unico schermo attivo; desktop verticale 1080×1920 a 60 Hz,
   scala Windows e zoom Edge 100%. Manuale Samsung: rotazione oraria, LED in basso;
   ventilazione e montaggio corretti, ingresso HDMI fisso, nessun overscan/taglio.
3. Non sospendere/spegnere schermo o salvaschermo durante la fascia diurna;
   notifiche/audio disattivati, Ethernet preferita, aggiornamenti fuori orario.
4. PC pronto alle 08:20. Accensione da spento richiede RTC BIOS/UEFI; un task
   Windows da solo non lo accende. Se assente lasciare il PC acceso. Verificare
   ripartenza dopo corrente. Non impostare arresto serale finche' il test riesce.
5. Samsung: orologio corretto, On Timer 08:30 con HDMI, Off Timer 20:00 sui giorni
   desiderati, volume zero, alimentazione/standby disponibili. Nessun Sleep Timer
   che interrompa la giornata. Ricontrollare ora legale e dopo blackout.
6. Luminosita' adeguata e protezione immagini statiche. Pixel Shift hardware non
   disponibile in Screen Fit secondo manuale: verificare la modalita' effettiva,
   senza promettere entrambe le opzioni. Spegnimento notturno del pannello.

## Rilascio verificato e collaudo PC/TV

1. Migration applicata e riletta come sopra, senza rilanciare migration storiche/WIP.
2. Push88794dd completato; CI665/665, Netlify e SHA del commit verificati.
   HTTP200 per12asset/pagine (HTMLAdmin con sola riscrittura Netlify del link
   monitor.html→/monitor), ZIP20file/401390byte con contenuti identici alla build
   collaudata e checksum pubblico corrispondente. APIadmin401/device403senza
   credenziali e no-store. Nessun account/dispositivo/sessione di prova creato.
3. Scaricare il pacchetto, installare/configurare il PC e associare da Admin.
4. Confrontare Day e mensile con Dashboard/Target; verificare leggibilita' a
   distanza, timer, avvio freddo/blackout, rete assente/ripristinata, browser chiuso
   o congelato, codice scaduto, revoca, cambio giorno/mese/ora legale.
5. Una giornata completa 08:30–20:00 sul Samsung. Nessuna vendita/appuntamento
   fittizio nel DB per collaudo; usare dati sintetici solo nelle prove isolate.

Verifiche locali finali: 665/665 test Node e build verdi, DOM delle pagine
reali senza browser, host
HTTP loopback con remoto sintetico, ZIP/hash e SQL PGlite 0.5.13 isolato (50 check).
Script PowerShell/DPAPI/Assigned Access/timer non eseguiti sul Mac: richiedono
collaudo Windows. La preferenza persistente NON USARE IL BROWSER e' rispettata.

## Fonti

- [Samsung LH40MEBPLGC/EN](https://www.samsung.com/it/support/model/LH40MEBPLGC/EN/)
- [Manuale Samsung ME40B, BN46-00098G-03](https://en.beamsystems.nl/media/1717/bn46-00098g-eng.pdf)
- [Microsoft Edge kiosk/InPrivate](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-configure-kiosk-mode)
- [Assigned Access](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/configure-single-app-kiosk)
- [DPAPI ProtectedData](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata)
- [Inter 4.1 ufficiale](https://github.com/rsms/inter/releases/tag/v4.1), SIL OFL.
