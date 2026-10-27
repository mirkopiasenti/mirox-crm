# Verifica automatica contratti

Versione sviluppata il 27/10/2026, rilascio autorizzato in modalità collaudo.
Migration applicata e riletta a production, versione `20261027172616`.
Configurazione confermata collaudo: nessuna conferma contratto o email automatica. Checklist e decisioni storiche:
[analisi](VERIFICA_AUTOMATICA_CONTRATTI_ANALISI_2026-10-27.md).

## Funzionamento

- Primo turno alle **21:00 Europe/Rome**, tutti i giorni. Nuovi invii dopo il
  turno attendono quello successivo. Le pratiche già presenti al primo avvio
  ricevono il prossimo turno, senza approvazione retroattiva immediata.
- Il passaggio pratica bozza → inviata registra il turno. Il cron ogni minuto
  recupera i lavori dovuti; non anticipa il primo esame. Ora legale/solare
  gestita nel DB con Europe/Rome.
- Dopo il primo tentativo, correzioni al contratto/PDA, allegati nuovi/rimossi,
  data firma attestata e nuovo CSV accodano subito il riesame. Il backend sollecita
  il worker; il cron recupera un eventuale dispatch fallito entro il minuto successivo.
  Le modifiche anagrafiche sono rilevate senza scrivere o aggiungere trigger
  sulla tabella condivisa `anagrafica`.
- Esiti visibili: Da controllare, Controllato, Da verificare, In attesa CSV.
  I sospesi restano `stato_controllo='da_controllare'` nel modello esistente;
  il dettaglio dell'esito è separato. Conteggi e trigger post-vendita conservati.
- In attesa CSV anche quando il CSV è valido ma la pratica non vi compare.
  Problemi documentali effettivi hanno precedenza e restano spiegati, insieme
  all'eventuale mancanza CSV. Un errore tecnico non è una prova documentale positiva.

## Controlli implementati

- PDA intestata allo stesso CF/P.IVA, codice contratto corrispondente, identità
  del cliente; per Business identità del **firmatario della PDA**, non della società.
- Documento d'identità con nome e CF coerenti; se il CF non è leggibile, servono
  nome completo e data nascita riscontrata nella PDA o nel CF del soggetto.
  Il solo nome non basta. Nessuna biometria o attestazione di autenticità.
- Documento non scaduto alla **data firma**, incluso il giorno di scadenza.
  Mai sostituita automaticamente con data upload/creazione. Data firma da PDF,
  da colonna CSV esplicitamente di firma/sottoscrizione oppure attestata dal
  verificatore tramite il campo dedicato, con attribuzione al profilo.
- Portabilità: ICCID della copia SIM uguale a quello della SIM uscente nella
  sezione MNP della PDA. Numero telefonico e seriale nuova SIM non sostituiscono
  questo confronto. Le numerazioni Mobile sono riscontrate separatamente.
- Firma cartacea: scansione contratto presente e coerente per soggetto/codice;
  nessuna nuova validazione tecnica della firma introdotta.
- Energia: identità, bolletta dello stesso soggetto e POD/PDR, almeno le prime
  due pagine effettive della stessa bolletta, gestore uscente leggibile.
- Dati categoria e integrità dei punteggi già registrati validati prima
  dell'approvazione. Allarmi e Assicurazioni mantengono percorso senza PDA:
  servono identità e data firma affidabile; per Business il firmatario deve
  comunque essere identificabile da documentazione aggiuntiva.

L'AI trascrive dati con documento, pagina e breve evidenza; non decide l'esito e
non emette patch eseguibili. Documenti/risposte sono dati non fidati. Dati incerti,
duplicati o discordanti non diventano approvazioni.
La verifica completa solo campi contratto vuoti documentati: codice, dati Mobile,
device/acquisto, tipo attivazione Fisso, numero Energia ed ex fornitore. Valori
esistenti discordanti richiedono correzione esplicita. Nessuna riscrittura autonoma
di anagrafica condivisa, offerta/opzione, attribuzione operatore, date commerciali
o punteggi storici. Una scelta di disattivazione Reload non è dedotta dall'AI.

## CSV Energia

Upload da Verifica Contratti, riservato admin, CSV originale con separatore `;`,
max 4 MiB, parsing server con virgolette/multilinea/BOM e colonne in allowlist.
Colonne minime: Codice Fiscale, Partita Iva, Proposta di Contratto, POD/PDR
(sono gestiti gli alias e le colonne POD/PDR separate già note al portale).
Una colonna Data firma/Data sottoscrizione esplicita può fornire la data firma;
date esportazione o commerciali non vengono usate a tale scopo.

Numero nuovo contratto ricavato da **fiscale + punto di fornitura**, soltanto se
esiste una sola Proposta di Contratto distinta. Più proposte o fiscale discordante
sono Da verificare. Se il verificatore integra esplicitamente il numero corretto,
il riesame lo riscontra anche nel CSV con lo stesso fiscale+punto: una scelta
esplicita documentata può così risolvere l'ambiguità. Zeri iniziali e codici restano stringhe.
File originale, impronta SHA256, righe normalizzate e caricatore sono privati
nel DB, senza esposizione browser delle righe. CSV non valido non sostituisce
quello precedente. Il nuovo file riaccoda gli Energia già esaminati. Per un
turno iniziale serve un caricamento nel giorno italiano del turno o successivo;
una correzione il giorno dopo può riusare la fonte già valida per quel turno.
È tracciata la data upload; non si presume una data export non presente nel file.

Il pulsante esistente in Controllo L&G continua ad aggiornare gli stati post-vendita
con le protezioni manuali correnti. L'upload per verifica archivia la fonte e
recupera il numero: **non modifica gli esiti L&G o `ultimo_csv_upload_at`**.
Per aggiornare quegli esiti resta il flusso L&G esistente. In questo rilascio
non viene unificato il caricamento fisico fra i due moduli.

## Modalità e collaudo

Configurazione singleton `vendita_verifica_config.modalita`:

- `collaudo` (default): analisi di una pratica selezionata dall'admin, nessuna
  modifica al contratto e nessuna notifica. Vengono registrati soltanto lavoro,
  valutazione e audit nelle nuove tabelle private. Il collaudo non anticipa il
  primo turno automatico e non conta come primo tentativo reale.
- `attiva`: primo turno serale, riesame dei sospesi e notifiche abilitati.
  La conferma manuale è nascosta e rifiutata dal backend; si salvano le correzioni.
- `spenta`: nessuna nuova analisi. Un lavoro automatico già avviato non può
  confermare se la modalità è stata disattivata prima del commit.

Il pannello admin permette di scegliere la modalità con conferma MiroxUI.
Per collaudare insieme: aprire un contratto non controllato, scegliere
«Collauda questo contratto», leggere controlli/errori/dati ricavati nel dettaglio,
confrontare i PDF con il proprietario, correggere e riprovare. Minimo un minuto
fra prove sulla stessa pratica. L'esito si aggiorna senza ricaricare la pagina.

Un documento senza data firma o un Business senza prova del firmatario resta
bloccato con motivo esplicito; non si presume che upload coincida con firma.
Le letture reali e la qualità OCR vanno collaudate sui fascicoli del proprietario:
i test sintetici non certificano quelle letture.

## Affidabilità e notifiche

Claim atomico con lease 12 minuti, revisioni e controllo ottimistico. Una modifica
di contratto/allegati/CSV/anagrafica durante l'analisi impedisce di applicare
l'esito obsoleto. Conferma, audit e creazione notifiche avvengono nella stessa
RPC transazionale. Nessuna persona simulata: `controllato_da=NULL` per il sistema,
nota automatica e audit separato. I punteggi non vengono ricalcolati dal catalogo.

Massimo2lavori concorrenti. Massimo 5 tentativi tecnici con attesa crescente; esaurimento segnala Da verificare
con un motivo tecnico comprensibile e notifica. Limiti lettura: 20 PDF, 20 MiB e
60 pagine per file, 50 MiB per fascicolo e controllo tempo fra documenti.
Fornitore e modello riusati dall'OCR corrente: Claude Haiku 4.5
`claude-haiku-4-5-20251001`, `ANTHROPIC_API_KEY` esistente. Nessuna nuova dipendenza
npm o modifica alle chiavi esterne. I file sono inviati direttamente dal backend.
La cache privata usa hash byte PDF + modello + hash prompt; un nuovo CSV riusa le
letture invariate, mentre il collaudo richiesto dall'admin forza una nuova lettura.

- CB Reload Disattivazione cliente dopo verifica positiva: `info@konatech.it`.
- Esito Da verificare: motivi/azioni semplici in italiano a `mirko.piasenti@mail.com`.
- La sola attesa CSV non invia l'email problemi. Nessun invio WhatsApp automatico.

Outbox privata con dedupe. Rifiuti SMTP certi temporanei vengono ritentati;
fallimenti permanenti restano visibili. Invio incerto o processo morto dopo SMTP
restano da riconciliare, senza reinvio cieco. SMTP accettato non significa letto
o consegnato. Le email contengono riferimento e link autenticato, mai PDF identità.
Gli admin vedono le notifiche incerte/fallite e possono confermare la ricezione
oppure richiedere esplicitamente il reinvio dopo controllo, con autore e data registrati.

## Componenti e installazione

Migration `database/20261027172616_verifica_automatica_contratti.sql`, generata
con CLI e collaudata in PostgreSQL isolato. Aggiunge sei tabelle server-only
con RLS e grant esclusivamente service_role: configurazione, verifiche, CSV,
esecuzioni, cache letture, notifiche. Nuovi trigger INVOKER solo su tabelle vendita/pratiche/
documenti, nuove RPC server-only; nessuna modifica schema/RLS/RPC CC o anagrafica.

- `gestisci-verifica-automatica`: status, collaudo, riesame, data firma, CSV,
  modalità; JWT/account attivo, admin per collaudo/CSV/configurazione.
- `verifica-contratti-background`: worker autenticato HMAC con chiave derivata
  e contesto dedicato dalla service role, firma con timestamp valido60s;
  nessun riuso dei segreti Guardian/Target e nessuna nuova env richiesta.
- `cron-verifica-contratti`: recupero ogni minuto, solo production; in collaudo
  recupera soltanto prove esplicitamente richieste, in attiva anche turni e notifiche.
- `js/verifica-contratti-core.js`: regole pure condivise; relativo JS/CSS pagina.

Migration applicata il27/10/2026 e nome file allineato al registro Supabase;
rilascio del codice autorizzato dal proprietario mantenendo `collaudo`. Avviare prima le prove assistite e soltanto dopo scegliere
`attiva`. Push/deploy richiedono richiesta esplicita secondo AGENTS.md.
Sei tabelle private e sei RPC verificate: anon/authenticated senza grant, solo
service_role. Configurazione collaudo,31lavori registrati e zero analisi/notifiche;
2720contratti con impronta stati identica prima/dopo. Nessun messaggio di prova inviato.

Verifiche: `npm test` e
`MIROX_PGLITE_MODULE=/percorso/node_modules/@electric-sql/pglite node scripts/verifica-automatica-sql.js`.
SQL test con grant, claim, collaudo, invalidazione concorrente, rollback patch,
commit idempotente, riapertura, riesame CSV, dedupe notifiche e anagrafica concorrente.

Suite locale finale: 410/410 test (409 versionati + test backup preesistente),
30 nuove regressioni del modulo. Nessun collaudo browser eseguito per preferenza
del proprietario. Letture AI dei fascicoli reali e qualità dell'interfaccia ancora
da verificare insieme dopo pubblicazione in modalità collaudo.
