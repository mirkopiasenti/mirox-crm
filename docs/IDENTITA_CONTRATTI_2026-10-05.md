# Documento identita su ogni contratto

Richiesta del proprietario, 05/10/2026: associare il documento d'identita a ogni
riga di contratto, anche nei carrelli, e sistemare lo storico dal 1 luglio 2026.

## Nuovo comportamento preparato

- Documento obbligatorio in ogni nuovo carrello, anche per offerte prive della
  precedente regola catalogo. L'operatore lo seleziona una sola volta.
- `upload-vendita-documento`, su una bozza, ricava dal DB tutti i contratti della
  stessa pratica/anagrafica e salva record/PDF distinti. Il primo conserva il
  nome richiesto; le copie hanno suffisso `_contratto_<uuid>`.
- INSERT batch dopo le copie; errore di copia/INSERT rimuove soltanto i file
  appena creati. Nessun riferimento Storage condiviso fra contratti: rimozione
  di un allegato o contratto non danneggia gli altri.
- `finalize` controlla che ogni contratto abbia un documento d'identita prima
  di inviare la pratica e chiudere eventi Call Center.
- Gli upload su pratiche gia inviate restano specifici del contratto selezionato.
  Verifica Contratti continua a leggere gli allegati per `contratto_id`.
- Nessuna migration, modifica RLS o tabella Call Center condivisa.

**Pubblicazione autorizzata dal proprietario con «vai con push».**
Codice testato; dopo il push verificare CI e deploy production del commit esatto.

## Bonifica applicata in produzione

Intervallo su `vendita_contratti.data_contratto`: dal 01/07/2026 00:00 Europe/Rome
(30/06/2026 22:00 UTC), inclusivo. Solo righe senza documento d'identita.

| Verifica | Esito |
|---|---:|
| Contratti nell'intervallo | 837 |
| Senza identita prima della bonifica | 132 |
| Recuperati dalla stessa pratica/anagrafica | 125 |
| Recuperati da altra pratica dello stesso cliente, con consenso esplicito | 3 |
| Contratti sistemati | 128 |
| PDF distinti copiati e riscaricati, SHA256/dimensione/firma PDF verificati | 129 |
| Contratti ora con identita | 833 |
| Residui senza documento registrato per il cliente | 4 (2 pratiche) |
| Errori / copie prive di oggetto Storage / copie prima di luglio | 0 / 0 / 0 |

Per le stesse pratiche sono stati conservati gli insiemi di PDF identita del
contratto sorgente (anche fronte/retro). Per i tre riusi autorizzati e stato
scelto il singolo PDF piu recente dello stesso `anagrafica_id`, senza matching
approssimato su nome o CF. Le copie risiedono nella pratica destinataria;
autore/data documentali originali conservati, provenienza nel report privato.
Originali e documenti gia presenti non sovrascritti.

`scripts/backfill-identita-contratti.js` usa dry-run predefinito, `--apply` per la
bonifica e `--same-client` esclusivamente con consenso al riuso. Piani, risultati,
checksum e elenco operativo dei residui sono in `.backup-private/identity-backfill/`,
ignorati da Git e fuori dalla build. La rilettura finale non propone altre copie
(4 mancanti, 0 recuperabili), confermando l'idempotenza.

Un piano letto mentre la prima bonifica era ancora in corso mostrava 17 righe
recuperabili: auto-review ha bloccato la seconda esecuzione. Dopo il completamento,
nuovo dry-run e query SQL indipendente hanno confermato esattamente 3 righe;
la seconda esecuzione e stata approvata ed e riuscita. Nessun blocco residuo.

## Verifiche e punti aperti

- `npm test`: build statica e 222/222 test (221 versionati + 1 backup preesistente).
  15 test dedicati coprono singolo/carrello, rollback copia/DB, indipendenza file,
  isolamento cliente/pratica, riuso autorizzato, confronto byte e blocco `finalize`.
- Query SQL finale conferma copertura, intervallo e presenza delle 129 copie.
- Per quattro righe Energia di due clienti il PDF non e mai stato registrato:
  serve integrazione manuale, elenco privato `DA_INTEGRARE.md`.
- Pubblicazione autorizzata; registrare l'esito delle verifiche post-deploy.
- Guide README/AGENTS/CLAUDE/database README e promemoria aggiornati.
