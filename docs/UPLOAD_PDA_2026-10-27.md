# Upload PDA: identificazione contratto e dati Mobile

Stato: debug completato, rilascio autorizzato in corso. Migrazione applicata e
verificata, con prove DB transazionali annullate via ROLLBACK; nessuna riga di
collaudo conservata o recupero dello storico. Pubblicazione e prova OCR reale in corso.

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

- Suite completa e build:335/335 test riusciti (334versionati e1backup preesistente),
  incluse21regressioni dedicate al nuovo flusso PDA.
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

Suite335/335 locale (334versionati+1backup preesistente),21regressioni PDA e
collaudo PostgreSQL isolato riusciti. Migration applicata tramite MCP e allineata
al timestamp del registro; colonne/indice/search_path/INVOCER riletti, nessun
nuovo rilievo advisor. Prove sul DB production con dati sintetici in transazione:
INSERT bozza, sync Fisso nelle due direzioni, rifiuto duplicato e MNP incoerente;
ROLLBACK eseguito, nessun dato di collaudo conservato.

Pubblicazione autorizzata dal proprietario dopo il debug. Si pubblica soltanto
questo intervento; backup/Guardian preesistenti restano fuori dal commit.
Dopo il deploy: verifica SHA/CI/asset e prova delle nove PDA con la vera Function
OCR (chiave Anthropic su Netlify), senza inviare pratiche/OTP o modificare clienti.
Risultati conclusivi nel promemoria di sessione. Storico ancora rinviato.

Primo collaudo online: corretta la query duplicati che presumeva una FK PostgREST
fra operatore_id e profili. Il DB usa ID senza quella relazione: lookup esplicito
separato, come nella pagina Verifica Contratti. Un errore nella lettura del nome
non nasconde un duplicato gia' individuato. Primo tentativo fermato prima dello staging
e di qualsiasi pratica; nuova pubblicazione di correzione e ripetizione collaudo.
