# Backup Aruba: verifica dello storico al 23/10/2026

Controllo richiesto dal proprietario dopo l'email Healthchecks UP del 23/10.
Orari Europe/Rome (UTC+2 nel periodo); dati acquisiti fino al backup delle 17:17.
Solo letture di registri/archivio e verifica in scratch privato: nessuna modifica
al CRM, database, file sorgenti, credenziali, retention o schedulazioni del VPS.

## Esito

Il sistema e' attivo e l'ultima copia e' integra, ma lo storico contiene errori.
Dal 05/10 ore 09:17 al 23/10 ore 17:17: **441 esecuzioni orarie attese e avviate,
418 riuscite, 23 fallite (94,8% riuscite)**. Nessun avvio orario mancante.
Altre 10 esecuzioni del 05/10, durante installazione/collaudo: 6 riuscite e 4
fallite, conteggiate separatamente. Totale servizio: 451 esecuzioni/424 riuscite.
I quattro errori iniziali sono gia' descritti nella guida di attivazione.

## Storico delle copie automatiche

| Giorno | Riuscite | Fallite | Osservazione |
|---|---:|---:|---|
| 05/10 dalle 09:17 | 15 | 0 | Attivazione timer |
| 06-12/10 | 168 | 0 | 24 al giorno |
| 13/10 | 22 | 2 | Errori provider/connessione |
| 14/10 | 23 | 1 | Documento sorgente assente senza duplicato verificabile |
| 15/10 | 22 | 2 | Errori provider/connessione |
| 16-19/10 | 96 | 0 | 24 al giorno |
| 20/10 | 22 | 2 | Errori provider/connessione |
| 21/10 | 20 | 4 | Errori provider/connessione |
| 22/10 | 19 | 5 | Errori provider/connessione |
| 23/10 fino alle 17:17 | 11 | 7 | Errori notturni; copie regolari dalle 07:17 |

Gli errori automatici sono 22 generici di provider/connessione e uno per un
PDF sorgente assente. Per 20 dei 22 errori generici il servizio termina dopo
circa 21 secondi senza avanzamento: compatibile con il timeout di connessione
Postgres configurato a 20 s, ma il log non conserva tipo/stadio/causa originali.
Nella stessa notte del 23/10 i log Supabase mostrano 133 ERROR SQLSTATE 57014,
15 LOG SQLSTATE 08006 e un LOG 08P01 (finestra UTC 22/10 22:00-23/10 06:00).
E' una correlazione da approfondire; non dimostra l'esatta causa di ogni backup
fallito. Nessuna diagnosi certa di rete IPv6, limite connessioni o guasto Aruba.
Nei registri kernel cercati non risultano OOM, disco pieno, I/O error o link down;
VPS senza riavvii dopo il 04/10, disco 23% usato/29 GB disponibili.

## Intervalli senza una nuova copia completa

Differenza fra conclusione delle copie, non prova di perdita di dati:

| Data | Ultima copia prima | Copia successiva | Intervallo |
|---|---|---|---|
| 13/10 | 02:18:53 | 05:22:53 | 3 h 04 min |
| 14/10 | 11:18:36 | 13:18:48 | 2 h |
| 15/10 | 01:19:07 | 03:40:14 | 2 h 21 min |
| 15/10 | 03:40:14 | 05:24:26 | 1 h 44 min |
| 20/10 | 04:18:36 | 07:18:34 | 3 h |
| 21/10 | 02:18:50 | 07:18:43 | 5 h |
| 22/10 | 01:19:16 | 07:19:04 | 6 h |
| 22-23/10 | 23:18:45 del 22 | 07:18:52 del 23 | 8 h |

La ripresa automatica salva lo stato successivo: non ricrea i punti orari saltati
e non garantisce il recupero di dati creati e cancellati interamente nell'intervallo.

## Verifica effettiva dell'archivio

- 176 manifest ancora conservati verificati con download, AES-GCM, hash e schema:
  84 correnti e 92 versioni non correnti. Tutti corrispondono a job riusciti nei log.
- Altri 248 manifest di job riusciti non sono piu' presenti: coerente con la
  scadenza delle vecchie copie orarie; lo storico operativo resta nei registri.
  Non sono stati verificati nuovamente byte che Aruba non conserva piu'.
- Ultima copia: iniziata 23/10 alle 17:17:21, manifest completo alle 17:18:54.
  Scaricati e verificati tutti i **7.298 file**: **7.293 oggetti in 11 bucket**,
  dump database, ruoli, configurazioni, pacchetto sorgenti e bundle Git.
  Ogni ciphertext e plaintext corrisponde a hash/dimensione del manifest.
- Incluso il nuovo bucket privato `subentri-files`; minimo atteso 10 non impedisce
  di includere automaticamente bucket aggiunti. Tutti gli 11 inventariati coperti.
- Dump leggibile da `pg_restore --list` (1.658 voci TOC); nessun nuovo restore SQL.
  Bundle Git include `main` al commit `80a92040387a9341145447505afd7c73c686c378`,
  coincidente con main locale letto durante il controllo.
- ACL privata, versioni, Object Lock Compliance dei manifest verificati. Codice
  runtime backup/aruba/audit/maintenance sul VPS identico ai file locali pertinenti.
- Non sono stati riscaricati tutti i byte di ogni copia storica: verifica completa
  byte sull'ultima copia; manifest/integrita' per le altre 175 versioni conservate.

## Controllo completo notturno e conservazione

Le 18 esecuzioni programmate alle 03:17 UTC (05:17 Europe/Rome) dal 06 al 23/10
hanno 14 successi e 4 fallimenti consecutivi dal 20 al 23/10. L'ultima verifica
completa automatica sorgente+archivio riuscita e' del **19/10 alle 05:22:38**.
Oggi e' stata aggiunta soltanto una verifica manuale dei byte gia' archiviati,
senza rileggere tutti i documenti dalla sorgente Supabase.

In quelle quattro notti sono saltati anche i checkpoint a conservazione giornaliera
30 giorni: le copie orarie successive restano disponibili secondo la loro retention,
ma non sono automaticamente promosse a giornaliere. Mancano quindi i checkpoint
lunghi del 20-23/10. Le settimanali del 11 e 18/10 risultano presenti.
Il recupero del controllo notturno/retention dopo un errore richiede una correzione
separata; la configurazione corrente non e' stata modificata durante questa verifica.

## Email del 23/10 e scadenza lifecycle

20 esecuzioni del controllo giornaliero in totale: due prove il 05/10 e 18
programmate dal 06 al 23/10. **19 riuscite, una fallita il 22/10 alle 08:49:15**.
Il 23/10 alle 08:47:37 il controllo e' riuscito; da qui l'email UP dopo 23 h 58 min.
Non equivale a 24 ore consecutive di mancati backup: le copie orarie diurne del
22/10 sono riuscite; resta distinto l'intervallo notturno massimo di 8 ore.

La scadenza reale di due versioni sintetiche e' stata osservata il **13 e 23/10**.
La seconda prova era stata creata il 14/10; il 21/10 era ancora presente, il 23
non lo era piu'. La soglia attuale fallisce se la versione e' presente oltre 7 giorni:
il 22/10 la prova aveva circa 8 giorni. E' quindi **probabile** un allarme sul tempo
di scadenza, ma il registro conserva solo `BackupError`, senza messaggio, e non
consente di escludere un altro errore transitorio. Non classificare come causa certa.
La distinzione fra scadenza corrente, non corrente e tempi effettivi del provider
va verificata prima di cambiare la soglia; nessuna protezione e' stata ridotta.

## Punti aperti e prossimo intervento

1. Diagnostica tecnica ripulita con fase/tipo/codice errore; evitare di perdere la
   causa dentro il messaggio generico, senza registrare credenziali o dati clienti.
2. Retry/backoff limitati e recupero della verifica/checkpoint giornalieri dopo
   errore, evitando concorrenza e mantenendo i controlli fail-closed.
3. Chiarire timeout notturni con log/metriche Supabase e misure di connessione;
   verificare poi l'effettivo rientro nei cicli successivi.
4. Verificare la soglia lifecycle con i tempi reali prima di modificarla.
5. Inventario esterno ancora datato: la copia contiene 28 variabili Netlify,
   20 valori recuperati e 8 Secret mancanti del censimento iniziale. Le successive
   configurazioni Target e la chiave Guardian aggiornata, note nel promemoria,
   richiedono riallineamento off-site; nessun export/rotazione svolto oggi.
6. Restano i limiti gia' accettati: collaudo CRM su nuovo Supabase rinviato dal
   proprietario, custodia fisica della copia offline da confermare e modifiche
   locali al Mac protette solo dallo snapshot preparato, non da sync continuo.

Report tecnico con dettagli e registri in `.backup-private/history-20261023/`
(directory 0700, file 0600); temporanei decifrati sul VPS rimossi dopo il controllo.
Nessun commit/push, nessuna modifica dei servizi production o acquisto.
