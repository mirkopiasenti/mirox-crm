# Recupero manuale identita — correzione locale30/10/2026

Stato: sviluppato e verificato localmente, non pubblicato. Produzione rimane al
rilascio49cb5c3. Nessuna richiesta di push dedotta dalla nuova segnalazione.

## Problema riprodotto

Il messaggio nello screenshot IMG_2864 non e un errore OCR: il controllo dei dati
del modulo rispetto al record CRM lanciava un errore prima di leggere i PDF.
Inoltre parser/barcode, errori HTTP o una risposta non valida potevano interrompere
il flusso senza produrre la prima ricevuta richiesta dalla preview precedente.

Regola richiesta: una lettura automatica non conclusa deve avere un percorso di
controllo personale e conferma, senza costringere ad abbandonare la pratica.

## Comportamento corretto

- Differenza modulo/CRM: anteprima con avviso, entrambi i nominativi e CF/P.IVA.
  Conferma riferita ai dati correnti del modulo; lo snapshot CRM e conservato.
  Nessun update in questo endpoint; il normale create commerciale continua a
  salvare i dati del modulo come prima. I cambi successivi invalidano la ricevuta.
- OCR/barcode/parser: esito da confermare anche se il PDF non e analizzabile dal
  motore. Un file privo della firma PDF resta da sostituire.
- Errori HTTP/rete/JSON o attesa eccessiva: preview locale degli originali. Budget
  client45s comprensivo di richiesta e lettura risposta; tentativo interrotto.
- Conferma senza prima ricevuta: multipart autenticato manual_preview con file
  originali, dati del modulo e attestazione. Nessuna OCR, parser o decodifica;
  hash server confrontati con quelli visualizzati, nuova ricevuta firmata.
- Viewer non disponibile: apertura originale a dimensione intera, attestazione
  esplicita per ogni PDF. Il solo click sulla checkbox senza apertura non abilita.
- Registrazione non riuscita: finestra, scadenza inserita e file restano disponibili;
  si riprova senza ripetere lettura o upload iniziale. Ricevuta valida solo al successo.
- Business: se manca la lettura PDA, hash/path sono conservati senza dipendere
  dall’AI. Il CF personale deve essere verificato su PDA e documento e riportato
  dall’operatore. Create/finalize continuano a verificare codice contratto e byte;
  una fonte non puo coprire codici diversi. Il CF personale non viene confrontato
  con la P.IVA dell’azienda.
- Serale: ricevuta riusata solo per stessi cliente/file/PDA, anche con parser
  identita indisponibile. Gli altri controlli automatici continuano come prima.

## Verifiche

Build e suite **611/611test,0skip, Node22.22.0** e quattro pacchetti Netlify
verificati localmente con zisi16.6.0, incluso PDF/Canvas/WASM/ricevuta dal bundle
estratto isolato (darwin/arm64). Dieci nuovi test rispetto ai601pubblicati. Copertura:
errore CRM prima di AI, OCR/provider e barcode non disponibili, parser fallito,
richiesta e corpo JSON bloccati, rete/HTTP/JSON malformato, retry conferma, viewer
alternativo, ricevuta/autore/file/data non trasferibili e CF rappresentante Business.

Prova UI con errore iniziale e recupero attraverso multipart reale: endpoint firma
la conferma dei byte originali senza parser/OCR/barcode. Prova Business con tutti
i sei campi multipart, CF personale, autorizzazione e vincoli create/finalize.
Nessun documento cliente, browser, provider AI, email o DB production coinvolto.

## Pubblicazione

Non sono richieste migration, nuove env o cambi di modalita. Frontend e function
vanno pubblicati insieme; rimane la modalita collaudo gia scelta dal proprietario.
Dopo richiesta esplicita di push: verificare CI/deploy, poi col proprietario ripetere
una pratica bloccata. Nessuna verifica o conferma cliente automatica in questo fix.

Il recupero elimina il blocco da lettura, non sostituisce i servizi di salvataggio:
se rete/backend non rispondono anche alla registrazione, la conferma resta aperta
e ritentabile; la pratica non viene dichiarata inviata senza risposta positiva.
