# Monitor KPI negozio — implementazione locale del 05/11/2026

Stato: codice completo in locale, migration e pacchetto Windows preparati.
**Push richiesto05/11, pubblicazione in verifica; PC/TV non configurati.**
Migration applicata su consenso esplicito, versione production20261105131100.
Restrizione successiva dei default service_role: migration monitor_privilegi_service_role
applicata05/11; soli oggetti nuovi, nessuna modifica ai default globali.
L'utente ha autorizzato lo sviluppo dopo la revisione del mockup. Windows 11 e
visione riservata al personale confermati; edizione Home/Pro e RTC da verificare.
Nessuna modifica a tabelle/RLS/RPC/trigger legacy del Call Center o ai dati cliente.

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
  tentativo. Avviso dopo 90 secondi senza dati nuovi, obsoleti dopo 5 minuti.
  Cambio giorno: dati precedenti nascosti fino al nuovo snapshot; cambio mese
  gestito dal server. Nessun numero fittizio o fallback a zero su errori.

Tela logica 1080×1920: `fit()` riduce uniformemente l'intero contenuto quando
necessario, senza scroll/tagli e senza nascondere o paginare il Day. La geometria
ha test numerici, ma leggibilita' e impaginazione finale devono essere provate
sul Samsung alla distanza reale; le righe molto numerose riducono la dimensione.
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
aggregati/codici appuntamento. Cache di processo 20 secondi con singola richiesta
condivisa tra letture concorrenti, separata per data; solo snapshot completo.
Il servizio locale interroga ogni 30 secondi, con retry fino a 60 secondi e timeout
15 secondi. Circa 1.380 richieste remote/display/giorno se acceso 08:30–20:00;
cache di processo, non cache distribuita o Supabase Realtime. Ultimo contatto
DB aggiornato al massimo ogni 5 minuti. Il frontend legge la copia locale ogni
5 secondi: revoca visibile normalmente entro 35 secondi; un guasto di rete puo'
ritardare la conferma di revoca, con avviso di dati obsoleti. Non e' latenza zero.

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
Windows 11. Eseguire `install.ps1` dalla cartella estratta come amministratore:
verifica hash, copia solo manifest, protegge ProgramData/MiroxMonitor per
SYSTEM/Administrators (proprietario/ACL e rifiuto reparse point) e registra task
SYSTEM all'avvio. Supervisor riavvia il processo se termina; non esegue restore,
non crea utenti/autologon e non cambia alimentazione, timer TV o aggiornamenti.

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
- heartbeat pagina ogni 10 secondi; dopo 2 minuti senza heartbeat (3 minuti al
  primo avvio) termina solo Edge con l'esatto URL chiosco del monitor. Assigned
  Access lo riapre. Dopo riavvio host il nuovo nonce fa ricaricare il frontend.

DPAPI LocalMachine richiede anche ACL corrette: non costituisce isolamento da
amministratori locali o dalla compromissione del PC. Aggiornamenti del servizio
solo reinstallando un nuovo pacchetto scaricato da Admin, senza eseguire codice
remoto automaticamente. La reinstallazione conserva state.bin. Uninstall rimuove
solo il task; revocare da Admin, file/credenziali non cancellati automaticamente.
Staging: pacchetto senza origine predefinita; installazione con -Origin su un
Netlify distinto, production rifiutata. Nessun dato di staging indirizzato a prod.

## Configurazione PC e Samsung ME40B

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

## Rilascio e collaudo ancora necessari

1. Migration applicata e riletta come sopra, senza rilanciare migration storiche/WIP.
2. Push richiesto dal proprietario05/11, verifica CI/Netlify/endpoints in corso.
   Non creare account o associazioni di prova reali.
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
