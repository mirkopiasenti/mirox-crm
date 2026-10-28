# Backup e ripristino Mirox CRM

Verifica aggiornata al **23/10/2026**: sistema attivo e ultima copia integra,
ma 23/441 esecuzioni automatiche fallite, massimo intervallo senza nuova copia
circa 8 ore; controlli completi/checkpoint giornalieri del 20-23/10 mancanti.
Scadenza sintetica effettiva osservata il 13 e 23/10. Nessuna correzione operativa
applicata nel controllo. Dettagli: [storico verificato](BACKUP_VERIFICA_STORICO_2026-10-23.md).
La descrizione seguente documenta l'attivazione iniziale del 05/10.

Stato al 05/10/2026: **prima copia completa Aruba, verifica off-site e ripristino
DB isolato riusciti; timer orario enabled/active**.
VPS `mirox-backup-prod` O2A4 Ubuntu 24.04 IT1, 6,29 EUR/mese + IVA;
Object Storage R1-IT a consumo, bucket privato/versionato/Compliance e lifecycle.
Runner con dipendenze hash-verified, Python 3.12.3/client PostgreSQL 17.11;
68 test Linux superati come utente non privilegiato e 128 test npm superati.

Prima copia: 10 bucket/6.579 oggetti, dump DB, ruoli senza password, inventario
configurazioni parziale, mirror GitHub CRM e pacchetto codice locale. Verifica
indipendente: tutti i **6.584 file** riscaricati/decifrati e checksum/dimensioni validi.
Restore da dump e ruoli scaricati da Aruba: **100 tabelle/51.252 righe**, tutti i
valori COPY identici, 20,4 secondi, container senza rete e cron off, già rimosso.
API Auth/Storage e ACL/ownership di un nuovo progetto gestito non collaudate.
Un PDF sorgente di Segnalazioni non disponibile è stato recuperato da un duplicato
con dimensione/checksum verificati: nel manifest è annotato il recupero; nessuna
scrittura sulla sorgente. Il file originale in produzione resta non scaricabile.

Custodia separata chiave ed email errore confermate dall’utente. Prova assenza
ping riuscita: passaggio up→down con soglia 1 minuto + 1 minuto, senza nuovi ping
e senza segnalare /fail. Frequenza finale: 1 ora, tolleranza 1 ora; email ON.
Timer abilitato il 05/10/2026; prima esecuzione automatica delle 09:17 Europe/Rome
riuscita, ulteriore copia dopo l’allineamento finale del runner riuscita.
I file numerici decifrati del collaudo sono stati rimossi dopo la verifica;
manifest e risultati privati conservati.
Export credenziali Netlify autorizzato esplicitamente il 05/10/2026: inventariate
28 variabili Production, recuperati 20 valori (inclusi SMTP, SMS e Supabase).
Salvati in `.backup-private/` esclusa da Git e in `recovery.json` cifrato su Aruba;
checkpoint delle 10:38 Europe/Rome riscaricato/decifrato, checksum/dimensioni e
corrispondenza con il file privato verificati. Configurazioni esterne ancora parziali:
8 valori marcati Secret sono write-only; l'utente conferma di non averne copie.
Domini, record DNS pubblici e policy/URL/provider Auth inventariati privatamente.
Nessun push, migration, modifica schema/RLS, env Netlify o restore production.
Zona DNS Aruba autorevole esportata BIND il 05/10: 19 record, inclusi MX e NS; SMTP Auth disabilitato, sessioni
e 13 template email, MFA/limiti/protezioni/hook/OAuth/Passkeys conservati nel recovery privato. Nessuna impostazione modificata.
Audit quotidiano e restore trimestrale DB attivi: prova 100 tabelle/51.313 righe
identiche in 18,5 s; secondo run senza ripetere la prova nello stesso trimestre.
Nuovo progetto Supabase/collaudo CRM completo rinviato esplicitamente dall'utente
fino alla rimozione del Call Center test; nessun progetto creato o costo aggiunto.
Scadenza effettiva delle versioni lifecycle non osservata nel tempo; protezioni
AES-GCM/readback/ACL/Compliance e impossibilità di ridurre il lock verificate live.
Account/credito/autoricarica del proprietario completati: 10 EUR sotto 5 EUR;
credito osservato 13,71 EUR, rinnovo VPS 04/11/2026. Costi sono indicativi.

Primo accesso SSH riuscito durante cloud-init; successivi timeout e cambio chiave
host dopo l'inizializzazione. Nuova impronta verificata dalla console Aruba
autenticata e confrontata prima di aggiornare known_hosts. Login SSH ora solo
con chiave; password e keyboard-interactive disabilitati, forwarding disabilitato.
UFW del template gia' attivo con sola apertura OpenSSH. Kernel aggiornato
6.8.0-146; accesso e timer verificati dopo riavvio. Individuato bootcmd exit 126:
`/usr/bin/resizelvm` del template non eseguibile e con LV obsoleto `vg-lv_root`,
mentre il root reale e' `lv-root`, gia' espanso sui 40 GB. Override cloud-init
disabilita **solo** il comando legacy, dopo confronto del layout e della dimensione
root/disco >=98%; nessuna operazione su partizioni. Futuri ampliamenti disco
richiedono verifica e resize esplicito. Secondo reboot verificato: cloud-init `done`,
nessun servizio fallito al reboot; test del runner superati anche dopo il riavvio.
Dump DB di collaudo ora presente sul VPS, protetto root-only.
Materiale SSH e password iniziale in `.backup-private/`, mai in Git o documentazione.

## Destinazione e funzionamento scelti

**Aruba Cloud Object Storage in Italia**, account Storage dedicato ai backup,
separato dagli accessi operativi CRM. Configurazione iniziale R1-IT, endpoint
`https://r1-it.storage.cloud.it`; R3-IT e' l'altra opzione italiana in allowlist.
Confermare la region dell'account nel pannello prima di usare la configurazione.
`signing_region=us-east-1` e' un parametro di firma S3 verificato su R1-IT, non indica
trasferimenti negli USA: ogni richiesta S3 usa esclusivamente l'endpoint italiano.

Archivio con ACL private, nessuna bucket policy aggiuntiva, versioni e Object Lock
**Compliance** per ogni copia. Il periodo impostato non puo' essere abbreviato,
neppure dal proprietario: verificare la policy di conservazione aziendale prima
di caricare dati reali. Il runner non contiene operazioni Delete. Non presumere
che le API di blocco accesso pubblico, SSE e checksum AWS esistano anche su Aruba.
Le verifiche ACL/policy/versioni/retention falliscono se non disponibili: risolvere
il problema nel collaudo, senza rimuoverle per far passare il backup.

Ogni file, compresi dump, inventario e configurazioni, viene cifrato sul runner con
AES-256-GCM (`cryptography`), nonce casuale e autenticazione legata alla chiave
oggetto. Il readback di ogni upload verifica i byte cifrati, decifra e confronta
SHA256 e dimensione in chiaro. La notte controlla anche gli oggetti gia' archiviati.
Chiave casuale di 32 byte: una copia protetta serve sul VPS per il funzionamento,
una copia separata va custodita dal proprietario in un password manager/mezzo offline.
Non salvare la chiave soltanto dentro il backup cifrato; perderla rende i dati
irrecuperabili. Non sostituirla senza un piano di migrazione delle copie pregresse.

**VPS Linux italiano** dedicato (inizialmente O2A4: 2 CPU, 4 GB RAM, 40 GB disco),
Python 3.12 e client PostgreSQL 17. Funziona a Mac spento. Credenziali root-only
in `/etc/mirox-backup/private.json`, rese disponibili al servizio con LoadCredential;
processo `mirox-backup` senza privilegi root e directory temporanee private.
`mirox-backup.timer` avvia il servizio ogni ora al minuto 17 UTC. I file non
installano/abilitano automaticamente il timer. Nessun nuovo cron o env var Netlify.

Monitor indipendente Healthchecks configurato dal pannello autenticato: periodo 1 ora, grace
1 ora dopo il collaudo iniziale. Riceve ping vuoti di
inizio/successo/errore, senza dati CRM, nomi file, credenziali o log allegati; il
servizio vede comunque IP e orario del runner. Deve avvisare anche se il VPS e'
spento e il job non parte. Account/email verificati nel pannello, test errore
inviato e ricezione email confermata dall’utente; prova mancata esecuzione
riuscita. Timer enabled/active solo dopo prima copia completa, restore da Aruba e monitor.

Conservazione:

| Copia | Frequenza | Conservazione |
|---|---|---|
| Oraria | Ogni ora tranne il checkpoint delle 03 UTC | 48 ore |
| Giornaliera | 03:17 UTC, lunedi-sabato | 30 giorni |
| Settimanale | Domenica 03:17 UTC | 90 giorni |
| File e codice referenziati | Versioni riutilizzate | Lock 120 giorni, esteso prima di referenziarli con meno di 91 giorni residui |

Il modello `aruba-lifecycle.json` scade ciascuna classe un giorno dopo la retention; i file
riutilizzati restano protetti dal lock esteso. Non eliminare manualmente versioni
o accorciare la retention: un manifest deve poter recuperare tutte le dipendenze.
Eventuali variazioni vanno verificate insieme in config, lifecycle e test. Compatibilita
tag/lifecycle/Object Lock e rilascio effettivo delle versioni scadute da provare
con oggetti sintetici, senza dichiarare una cancellazione automatica gia' collaudata.

## Ricognizione produzione (sola lettura)

- Organizzazione KONA TECH: piano Supabase **Pro**; project `lbgwamhjkjjfwgusafbi`,
  regione Parigi `eu-west-3`, PostgreSQL 17.6.
- Database: 56.134.803 byte (circa 56 MB decimali).
- Dieci bucket, **6.577 oggetti**, totale dai metadati **1.120.319.526 byte**
  (circa 1,12 GB decimali). Non equivale a una verifica dei byte fisici disponibili.
- Schemi con tabelle: public, auth, storage, cron, realtime e vault.
- Vault: zero segreti; il ruolo login aggiuntivo è una sessione temporanea
  `cli_login_postgres*` con scadenza, verificata il 05/10. Nessun ruolo login
  applicativo aggiuntivo rilevato; il dump ruoli non salva password.
- Pannello autenticato verificato: backup nativi fisici giornalieri 27/09-04/10,
  ultimo 04/10/2026 02:25:43 UTC; PITR non attivo (offerto come add-on). Nessun
  restore avviato. I backup DB Supabase **non** includono i byte Storage.
- Account Aruba/Storage R1-IT, VPS IT1 e bucket protetto creati; custodia separata della chiave ed email di errore confermate; manca
  il collaudo della prima copia off-site e della mancata esecuzione. Password DB
  verificata con export completo read-only dal runner. Chiave service_role esistente recuperata dal pannello
  autenticato e salvata privatamente; elenco dei 10 bucket letto dal VPS.
  Host diretto confermato via MCP:
  `db.lbgwamhjkjjfwgusafbi.supabase.co`, utente `postgres`, porta 5432; verifica
  IPv6/TLS 1.3 e hostname verificati dal VPS
  con la CA scaricata dal link ufficiale del pannello autenticato. Non usare `postgres.<ref>` sull'host diretto.

## Contenuto e limiti della copia

Il runner non ha scritture SQL o Storage Supabase. Una connessione read-only
esporta lo snapshot PostgreSQL: inventario di **tutti** i bucket/oggetti e archivio
`pg_dump` custom completo, compresi Auth e le definizioni DB accessibili. Un controllo
TOC richiede almeno i dati `auth.users`, `public.profili` e `storage.objects`.
`pg_dumpall --roles-only --no-role-passwords` conserva i ruoli globali; ogni warning
o errore degli strumenti invalida il job, senza dichiarare copertura completa.

Il dump grezzo comprende oggetti gestiti da Supabase: **non applicarlo integralmente
a un nuovo progetto gestito**. Il restore richiede selezione delle sezioni, versioni
compatibili, estensioni/ruoli e gestione dei conflitti con gli schemi di piattaforma.
L'export puo' fallire se il login non legge oggetti gestiti: risolvere nel collaudo
con la procedura ufficiale Supabase, senza escludere silenziosamente dati essenziali.

I file vengono copiati attraverso l’API Storage autenticata, con un massimo di
8 trasferimenti simultanei (`storage_workers`), file temporanei separati e
controlli DB serializzati. Un errore annulla i lavori in attesa; il manifest resta
ordinato come l’inventario e viene pubblicato solo dopo tutti i successi. Le chiavi S3 sono
opache e derivano dalla revisione della sorgente; il manifest privato conserva nomi,
bucket, metadati e mapping verso **versione S3 + SHA256**. Download incompleti,
file mancanti o sostituiti durante la copia impediscono il commit. File gia' copiati
si riutilizzano solo se versione, metadati integrita/cifratura e lock sono verificabili.
Ogni notte si riscaricano sorgente e versione archiviata per confrontarne i byte.

Il primo trasferimento ha individuato un PDF di Segnalazioni con metadati ma
byte non disponibili (API not_found 404). Trovato un duplicato disponibile:
dimensione 541.716 byte e checksum multipart a un solo part identici e verificati
sui byte. Il runner puo’ recuperare da un altro record dello stesso inventario
solo dopo 404 e corrispondenza eTag/dimensione/checksum (MD5 semplice o -1),
controllando stabilità di entrambi i record e annotando il recupero nel manifest.
Non modifica il file mancante in produzione. Errori di autorizzazione, duplicati
diversi e checksum multipart ambigui restano bloccanti; nessuna esclusione silenziosa.

DB e Storage non offrono una transazione unica: il dump e l'inventario condividono
lo snapshot DB, mentre i byte sono acquisiti successivamente. Una modifica
contemporanea puo' far fallire la prima copia. Le revisioni gia' archiviate rimangono
recuperabili. Un file creato e cancellato tra due esecuzioni puo' sfuggire al backup.
L'obiettivo di perdita massima di un'ora **non e' ancora garantito**; se necessario
anche per file transitori, progettare l'acquisizione all'upload e la cancellazione
differita dopo aver collaudato il sistema, come intervento separato sul CRM.

Solo quando tutto riesce si pubblica `manifest.json.gz` cifrato e il ping di successo.
Un errore lascia eventuali copie parziali, mai un punto di recupero completo.
La concorrenza e' limitata dall'unita' systemd oneshot e da un advisory lock di
sessione PostgreSQL. Il timeout del servizio e' 3 ore; se termina bruscamente,
il monitor deve rilevare la mancata conclusione, anche senza ping di errore.

Codice: il pacchetto locale comprende bundle Git con **tutti i ref locali** e copia
dei file tracciati nel working tree, comprese modifiche non committate. Esclude i
file non tracciati estranei (`output/`, `tmp/`, `ed.hup`) e i file `.env` ignorati.
La copia locale nella cartella protetta non e' un backup off-site ed e' in chiaro.
Se configurati nel secret, repository GitHub privati vengono copiati ogni esecuzione
con mirror/bundle di tutti i ref accessibili: il repository CRM pubblico viene
letto senza token, per repository privati serve un token Contents read. Repository
inaccessibili fanno fallire il job, senza manifest completo.
Il pannello Netlify del 05/10/2026 conferma che `mirox-crm.netlify.app` è alias
dello stesso site/repository CRM; la vecchia attribuzione a un CC separato è obsoleta.
L’eventuale repository storico CC resta da identificare e aggiungere.
Il pacchetto locale non aggiorna da solo il lavoro futuro non committato sul Mac.

Configurazioni: `recovery.json` salva soltanto l'inventario fornito nel secret
(Netlify, Supabase Auth, DNS, credenziali integrazioni e password ruoli custom).
Non c'e' un export automatico delle configurazioni dei fornitori: va completato
e aggiornato dopo ogni modifica. `platform_recovery.status=verified` si imposta
solo dopo verifica concreta. Se Vault contiene segreti, il runner si ferma finche'
non e' stata conservata la chiave di recupero corretta separatamente.
Auth utenti/password hash nel DB non sostituisce SMTP, redirect, provider e chiavi.

### Credenziali Netlify: copertura concreta

L'export del 05/10/2026 conserva i valori Production, nomi, scopes e riepilogo
dei contesti; non esporta i valori di staging/dev. Inventario privato:
`.backup-private/netlify-inventory.json`, incluso in
`platform_recovery.netlify.export_inventory` del secret del runner. Il backup
orario include automaticamente questo inventario, ma una successiva modifica
Netlify richiede di aggiornare la fonte privata; non c'è sincronizzazione delle
variabili dai pannelli dei fornitori. La chiave Supabase esportata da Netlify è
di tipo `sb_secret_`; la chiave service_role JWT già verificata del runner resta
quella operativa per il backup.

I seguenti 8 valori Production non sono esportabili dal pannello, CLI o API:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GUARDIAN_GITHUB_TOKEN`,
`GUARDIAN_TELEMETRY_HASH_SECRET`, `GUARDIAN_WORKER_SECRET`,
`TELEGRAM_GUARDIAN_BOT_TOKEN`, `TELEGRAM_GUARDIAN_OWNER_CHAT_ID`,
`TELEGRAM_GUARDIAN_WEBHOOK_SECRET`. Netlify restituisce valori mascherati per le
variabili marcate Secret: non considerarli credenziali recuperate, né assumere
che un valore dev sia identico a Production. Vedi la
[policy ufficiale Secrets Controller](https://docs.netlify.com/build/environment-variables/secrets-controller/).

Senza copie originali serve un intervento distinto di riemissione/ricostruzione,
coordinato fra fornitori, Netlify, worker e GitHub Environments: verificare quali
chiavi sono condivise prima di sostituirle, evitare interruzioni e custodire i
nuovi valori prima di salvarli come Secret. Questa sessione non ha cambiato
variabili, creato chiavi, ruotato credenziali o pubblicato il CRM. Il file privato
`netlify-secrets-mancanti.json` contiene solo le chiavi con valori null; serve per
la futura raccolta, non viene interpretato automaticamente dal runner.
SMTP custom Auth disabilitato, policy sessioni, 13 template e sette pagine avanzate
(MFA, rate limit, protezioni, hook, OAuth server/app e Passkeys) sono inventariati
da pannello autenticato. Zona DNS Aruba autorevole esportata BIND (19 record,
inclusi MX e quattro NS). Entrambi inclusi nel recovery cifrato, riscaricati e
confrontati esattamente alle 11:46 Europe/Rome. Nessuna impostazione modificata.
`platform_recovery.status` resta `DA_COMPLETARE` per le otto chiavi mancanti;
l'inventario e' statico e il recupero gestito non e' stato collaudato.

## Attivazione concreta

Materiale: `scripts/backup/aruba.py`, `aruba-config.json`, `aruba-secret.example.json`,
`aruba-lifecycle.json`, `mirox-backup.service`, `mirox-backup.timer` e
`requirements-aruba.lock` per Python 3.12 Linux x86_64, con versioni/hash delle dipendenze.
Le librerie sono separate da npm e non vengono installate nelle Netlify Functions.
Test completi: `MIROX_BACKUP_TEST_PYTHON=/PERCORSO_VENV/bin/python npm test`, con
dipendenze Aruba installate. Senza `cryptography`, i test di cifratura sono saltati
con diagnostica esplicita: una suite solo base non certifica l'adattamento Aruba.

1. Proprietario: creare/accedere all'account aziendale Aruba Cloud, completando
   personalmente email, identita', fatturazione e autenticazione aggiuntiva disponibile.
   Nessuna password o chiave in chat. Account e credito completati dall'utente.
2. Concordare e verificare il riepilogo concreto dei servizi: VPS O2A4 Linux in
   Italia, Object Storage pay-per-use in R1-IT o R3-IT, budget iniziale indicativo
   10-15 EUR/mese + IVA. Account/credito/pannello necessari prima del provisioning;
   non acquistare pacchetti da 4 TB o Cloud Backup generico per questo runner.
   VPS O2A4 creato e riepilogo/addebito verificati il 04/10/2026.
3. Configurare account Storage dedicato, bucket privato con Object Lock attivo
   **alla creazione**, versioning e lifecycle dal modello. Testare prima con dati
   sintetici: blocco Delete, estensione Compliance, readback/cifratura, tag e
   lifecycle. Non abbreviare lock o usare credenziali CRM come password Storage.
4. Predisporre VPS con Ubuntu 24.04, aggiornamenti di sicurezza e SSH con chiave;
   installare client PostgreSQL 17 dal repository ufficiale firmato, Git e Python
   3.12/venv. Creare utente di servizio senza login, copiare il pacchetto sotto
   `/opt/mirox-backup`, con codice e venv non scrivibili dall'utente di servizio.
   Installare con `pip install --require-hashes -r scripts/backup/requirements-aruba.lock`.
   `provision-aruba.sh` prepara Ubuntu amd64 e client PG17 dal repository firmato,
   verifica la fingerprint PGDG, aggiorna pacchetti e kernel senza rimozioni e attiva aggiornamenti automatici
   senza riavvio automatico. Non contiene credenziali, non avvia il backup e non
   configura SSH: l'accesso con chiave va collaudato separatamente prima di
   disabilitare le password. Lo script rifiuta un cloud-final ancora in esecuzione
   o senza boot-finished. Gestisce il resize legacy IT1 non eseguibile solo con
   il layout verificato sopra; non ignora volumi non espansi o layout differenti.
   Installazione Linux e unit systemd verificate sul VPS il 04/10/2026; 68 test
   includono recupero del pacchetto codice cifrato. I test isolano la directory
   corrente per non leggere il pacchetto reale durante i casi con dati sintetici.
5. Generare la chiave casuale di cifratura in un file locale privato e conservarne
   una copia separata verificata dal proprietario. Completare `private.json` dal
   modello Aruba, mode 0600, root-owned sul VPS. Inserire connessione DB diretta
   o session pooler porta 5432 copiata da Supabase Connect, password DB esistente,
   chiave Storage server-only e token GitHub Contents read per i soli repo necessari.
   Scaricare la CA dal pannello Database Settings > SSL configuration > Download
   certificate; installarla root-owned/read-only in
   `/opt/mirox-backup/certs/supabase-ca.crt` e usare questo percorso assoluto in
   `database.sslrootcert`. Il runner conserva `verify-full` e passa la CA anche
   a pg_dump/pg_dumpall; nessuna modifica alla fiducia TLS globale. CA osservata:
   SHA256 `807025AD50D4ED219D2C9C7D299C004F824EB00CF7F65AFEF607D07B72E6CAFA`,
   scadenza 26/04/2031; al rinnovo ottenere la nuova CA dal pannello autenticato.
   Non resettare password DB: altri servizi possono usarla. Completare inventario
   configurazioni/ruoli e repository CC storico, senza segreti in Git.
6. Creare il check indipendente Healthchecks (piano gratuito sufficiente per un
   check), configurare destinatario e provare avviso per errore/mancata esecuzione.
   Inserire il ping URL in `private.json`, non nei log. Il runner non invia email
   da solo: le notifiche dipendono dall'integrazione configurata sul monitor.
7. Eseguire `python3 scripts/backup/package.py` per il pacchetto privato; installare
   service/timer sul VPS, fare daemon-reload senza enable, quindi preflight e
   prima esecuzione manuale con `systemctl start mirox-backup.service`. Il preflight
   e' read-only; non verifica upload, lifecycle o recuperabilita' dei byte.
8. Controllare prima copia e inventario, verificare tutti i byte con la CLI Aruba
   e provare un restore isolato. Misurare tempi, spazio e traffico; solo allora
   abilitare `systemctl enable --now mirox-backup.timer`. Impostare gli avvisi di
   credito Aruba disponibili e mantenere manutenzione tecnica periodica.

CLI Aruba, su macchina con dipendenze e file credenziali privato:

```sh
python scripts/backup/aruba.py preflight --secrets /PERCORSO_PRIVATO/private.json
```

L'accesso via session pooler evita il requisito IPv6 della connessione diretta;
il runner rifiuta la transaction pooler porta 6543 e verifica TLS/hostname.
I segreti sono letti solo a runtime; nelle argv compare soltanto il percorso del
file privato, mai il contenuto. `LoadCredential` evita di passarli tramite env var.

Listini Aruba consultati il 04/10/2026: VPS O2A4 6,29 EUR/mese + IVA, Object Storage
0,00028 EUR/ora per blocco di 10 GB (~0,2044 EUR/mese per 10 GB a 730 ore), traffico
in uscita 0,50 EUR ogni 10 GB. Monitor: un check nel piano gratuito Healthchecks.
Budget di infrastruttura stimato 10-15 EUR/mese + IVA, non preventivo vincolante.
Sono esclusi manutenzione professionale, terza copia e eventuali extra Supabase.
Il controllo notturno scarica ~34 GB/mese dalla sorgente ai volumi attuali e una
quantita' simile dall'archivio; misurare crescita dello storico, prima copia,
readback, verifiche e versioni non correnti prima di confermare il costo.

Il precedente template AWS (`aws-stack.json`/`buildspec.yml`/`config.json`) resta
come alternativa preparata, mai attivata; non applicarlo nella procedura Aruba.

## Verifica e ripristino

La verifica Aruba scarica/decifra ogni versione referenziata e ricontrolla byte e SHA256:

```sh
python scripts/backup/aruba.py verify --secrets /PERCORSO_PRIVATO/private.json \
  --manifest-key CHIAVE_MANIFEST --manifest-version VERSIONE_S3 \
  --output .backup-private/verifica-primo-backup
```

La directory deve essere nuova e privata. I file locali verificati sono **in chiaro**
e hanno nomi numerici opachi; il
manifest conserva il mapping verso database, ruoli, configurazioni e allegati.
Questo comando **non** esegue SQL o upload su Supabase e non equivale a un restore.

### Collaudo locale del dump, senza collegamenti alla produzione

`restore-local.py` usa l’immagine ufficiale Supabase PostgreSQL 17.6.1.084,
bloccata al digest `sha256:95d92e9563121189086690a4b7f8f2b711a4809a2499f45592199aae68ebae5f`.
Richiede Docker e crea un container temporaneo senza rete, porte esposte o volumi
host; filesystem base read-only, dati in tmpfs e cron disabilitati prima del restore.
Importa le definizioni CREATE ROLE senza password e ripristina il dump in una
transazione, senza owner/ACL; esclude solo il CREATE SCHEMA public già presente.
Confronta numero righe e SHA256 dei valori COPY ordinati per ogni tabella.
Il container viene rimosso anche in caso di errore; diagnostica privata nella directory work.

```sh
python scripts/backup/restore-local.py \
  --dump /PERCORSO_PRIVATO/database.dump \
  --roles /PERCORSO_PRIVATO/roles.sql \
  --work /PERCORSO_PRIVATO/restore-prova-nuova
```

Il 05/10/2026 il primo dump locale ha superato il collaudo: 100 tabelle, 51.240
righe, valori identici, 18 secondi. La prova è stata poi ripetuta dal dump e dai
ruoli scaricati/decifrati da Aruba: 100 tabelle, 51.252 righe, valori identici,
20,4 secondi. Le nuove righe appartengono al successivo snapshot della sorgente. Nel manifest,
l’indice dei file numerici del dump è il numero di oggetti Storage, quello dei ruoli
è il successivo. Non certifica API Auth/Storage, ownership, grant di produzione o
funzionamento completo dell’applicazione; il recupero su progetto gestito resta
una prova separata secondo i passaggi sotto. Docker service/socket sono normalmente
fermati/disabilitati; il servizio audit li avvia soltanto per la prova e li ferma
quando non restano altri container. Il backup orario non usa Docker.

### Verifiche automatiche giornaliere e trimestrali

`mirox-backup-audit.timer` e' abilitato ogni giorno alle 06:47 UTC, con ritardo
casuale fino a 2 minuti e Persistent=true. `audit.py` esegue il preflight Aruba,
controlla il manifest completo piu' recente (massimo 3 ore) e osserva la scadenza
di una versione sintetica casuale, senza dati CRM, con lock/tag 2 giorni.
L'assenza anticipata o la persistenza oltre 7 giorni falliscono il job: un errore
di autorizzazione non viene scambiato per avvenuta cancellazione. Il primo oggetto
e' stato creato il 05/10; la scadenza reale resta in osservazione, non certificata.
Una prova DB viene eseguita al primo audit riuscito di ogni trimestre, con retry
se fallisce. Il 05/10: 100 tabelle/51.313 righe identiche in 18,5 secondi; secondo
audit senza ripetere il restore. Il risultato conserva timestamp e limiti della prova.
Il servizio audit e' root soltanto per controllare Docker; codice non scrivibile,
LoadCredential, stato 0700 e report 0600 in `/var/lib/mirox-backup-audit/`.
I dump temporanei vengono eliminati. Il servizio orario resta non privilegiato.
Healthchecks separato **Mirox - verifiche backup Aruba**, periodo 24 ore/grace
12 ore/email ON; ping di successo osservato. `audit_monitor_url` solo nel secret.

### Collaudo completo del CRM su progetto gestito — rinviato

Il 05/10 l'utente ha rinviato questo passo per evitare il costo mensile di un
nuovo progetto Supabase, fino alla rimozione dell'ambiente Call Center test.
Non creare il progetto e non rimuovere quell'ambiente senza una nuova richiesta.
Quando autorizzato, con un responsabile e tempi registrati:

1. Creare un progetto di recupero vuoto e isolato, separato anche dagli staging
   Guardian/Call Director. Disabilitare cron, email, SMS, webhook e bot. Impedire
   che trigger o dati restaurati avviino notifiche o esecuzioni automatiche.
2. Verificare tutte le versioni S3. Ispezionare il TOC di `database.dump` con
   `pg_restore --list`; preparare uno script di restore basato sulla procedura
   ufficiale Supabase, senza `--clean` o connessioni a production.
3. Ripristinare schema applicativo, policy/trigger custom anche in Auth/Storage,
   dati Auth e CRM e ruoli/grant appropriati; trattare separatamente gli oggetti
   gestiti e Vault. Le credenziali dei ruoli custom e le chiavi non sono nel dump.
4. Ricreare bucket e caricare i file attraverso l'API Storage del progetto di
   recupero, preservando path e configurazioni private. Non limitarsi a inserire
   i metadati `storage.objects`: non ricrea i byte e puo' interferire con gli upload.
   Verificare anche ownership/metadati che l'API non ripristina automaticamente.
5. Configurare frontend e backend di recupero verso il nuovo progetto. Risolvere
   gli URL legacy che includono il vecchio project ref. Provare login/ruoli,
   anagrafiche, pratiche, consensi, storico, KPI e apertura documenti; confrontare
   conteggi, relazioni e hash. Gli utenti potranno dover autenticarsi nuovamente.
6. Misurare durata e perdita di dati; approvare il passaggio a production soltanto
   con un piano di manutenzione condiviso con il CC storico e conferma esplicita.

Per recuperare una singola riga/file, usare il progetto isolato come sorgente e
preparare una correzione selettiva verificabile: il restore globale del DB comune
riporta indietro **anche il lavoro del Call Center**.

### Copia cifrata indipendente e custodia offline

`maintenance.py export` scarica le versioni esatte del checkpoint in un unico TAR:
allegati, database, ruoli, recovery.json, sorgenti e repository. Include il manifest
cifrato e un indice tecnico opaco, nessun nome cliente o credenziale nell'indice.
Per ogni file confronta hash del ciphertext, autenticazione AES-GCM e hash/size
plaintext. I temporanei decifrati vengono rimossi; TAR finale creato atomicamente,
file 0600 in directory 0700, con sidecar SHA256. Richiede circa 3,5 GB liberi per
l'archivio attuale di circa 1,16 GB. Il file result contiene il riferimento manifest
restituito dall'esecuzione oraria verificata.

```sh
python scripts/backup/maintenance.py export \
  --secrets /PERCORSO_PRIVATO/private.json \
  --result /PERCORSO_PRIVATO/backup-result.json \
  --file /PERCORSO_PRIVATO/mirox-offline-nuovo.tar
python scripts/backup/maintenance.py verify \
  --secrets /PERCORSO_PRIVATO/private.json \
  --file /PERCORSO_PRIVATO/mirox-offline-nuovo.tar
```

La verifica non usa rete/S3: rifiuta chiave/progetto errati, membri extra, duplicati,
symlink, path traversal, dimensioni/hash errati e indice diverso dal manifest
cifrato autenticato. Non estrae liberamente il TAR. Per la sola verifica servono
Python con cryptography, i moduli backup/aruba/maintenance, config e chiave AES;
non servono credenziali S3 valide o accesso al VPS. Il secret di verifica puo'
contenere solo `archive.encryption_key_b64`, custodito privatamente e separato.
Non mettere credenziali o chiave dentro l'archivio di custodia.

Il 05/10 completata copia del checkpoint 11:46 Europe/Rome sul Mac:
`.backup-private/offline/mirox-offline-20261005-final.tar`, 6.585 file,
1.156.382.720 byte. SHA256 dell'intero TAR confrontato con il sidecar; tutti i
file decifrati/autenticati e hash plaintext confrontati senza rete e fornendo
solo la chiave AES (nessuna credenziale S3). Report privato `offline-verification.json`;
nessun plaintext conservato. `strumenti-verifica.zip` e `LEGGIMI.txt` nella stessa
cartella non contengono segreti. Custodia fisica su supporto scollegato non confermata.

La copia sul Mac e' indipendente da Aruba ma resta collegata: il proprietario deve
copiarla con il sidecar e gli strumenti di verifica su un supporto esterno e
scollegarlo. Confermare la custodia fisica separatamente; il software non puo'
certificarla. La copia e' un checkpoint statico del 05/10, non si aggiorna da sola:
va rinnovata dopo cambi importanti e secondo la policy aziendale di conservazione.
Allineare anche questa copia alla retention dei dati personali, evitando archivi
senza scadenza.

## Fonti ufficiali

- [Supabase: copertura backup e PITR](https://supabase.com/docs/guides/platform/backups)
- [Supabase: backup/restore e configurazioni separate](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [PostgreSQL: pg_dump e snapshot](https://www.postgresql.org/docs/17/app-pgdump.html)
- [Aruba: endpoint e localizzazione](https://kb.cloud.it/public-cloud/storage/object-storage/informazioni-connessione.aspx)
- [Aruba: Object Lock Governance/Compliance](https://kb.cloud.it/public-cloud/storage/object-storage/usare-un-account-storage/s3browser-object-lock.aspx)
- [Aruba: listino VPS](https://www.cloud.it/vps/)
- [Aruba: listino Object Storage](https://www.cloud.it/prezzi/public-cloud/cloud-object-storage)
- [Healthchecks: monitor dei job mancanti](https://healthchecks.io/docs/)
- [Healthchecks: prezzi](https://healthchecks.io/pricing/)
- [Cryptography: AES-GCM e verifica autenticazione](https://cryptography.io/en/latest/hazmat/primitives/symmetric-encryption/)
