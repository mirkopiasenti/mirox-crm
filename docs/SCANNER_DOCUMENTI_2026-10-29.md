# Scanner guidato e lettura reale del codice fiscale

Sviluppo richiesto e completato localmente il29/10/2026. Nessun push o deploy
eseguito in questo intervento. La nuova tabella privata e gia pronta in Supabase;
il codice precedente resta online fino a richiesta esplicita di pubblicazione.

## Percorso operatore

1. Completata l’anagrafica, entrando nello step Documenti compare il QR.
2. Scegliere il tipo documento; cambiare tipo o cliente invalida il collegamento.
3. Dal telefono aprire il QR e autorizzare la fotocamera. Non serve installare app
   o accedere con l’account CRM sul telefono.
4. Acquisire ogni facciata seguendo le etichette, controllare le miniature,
   ripetere eventuali scatti e premere Invia al CRM.
5. Il PC riceve il PDF nella selezione documenti della sessione corrente.
   Eseguire il normale controllo identita e continuare l’inserimento.
6. Se la fotocamera non e utilizzabile, scegliere il pulsante esplicito
   «Non e possibile acquisire la scansione da smartphone: carica PDF».
   Il caricamento PDF e la preview manuale esistenti restano disponibili.

| Tipo | Acquisizioni guidate |
|---|---|
| CIE | Fronte e retro; tessera sanitaria facoltativa, anch’essa fronte e retro |
| Carta d’identita cartacea | Fronte e retro documento + fronte e retro tessera sanitaria |
| Patente | Fronte e retro documento + fronte e retro tessera sanitaria |
| Passaporto / cliente Turista | PDF e controllo manuale tramite preview, nessuna OCR identita |

Il percorso smartphone controlla il numero esatto di pagine previsto,2o4.
L’ordine delle facciate e guidato, ma la presenza di una pagina non certifica
che sia fotografato il lato corretto: occorrono controllo di lettura e anteprima.
Per PDF tradizionali la dichiarazione manuale richiama anche la tessera sanitaria
quando richiesta. Foto errate o PDF incompleti non diventano documenti validi per
il solo fatto di essere stati inviati dal telefono.

## Barcode e controlli

Il vecchio codice non conteneva un decoder barcode reale. Ora i byte del medesimo
PDF vengono rasterizzati con unpdf/Canvas e passati al lettore ZXing WASM locale:
Code39,Code128,DataMatrix,PDF417; rotazione/inversione e seconda scala di lettura.
Si accettano soltanto CF personali di16caratteri con struttura e checksum corretti,
comprese posizioni omocodiche. Il valore atteso CRM non viene passato al decoder.
Sono conservati valore, formato e pagina del codice realmente decodificato.

Un CF barcode univoco e completo prevale su una lettera trascritta male dall’AI.
Si confronta con l’anagrafica Consumer o con il CF personale del rappresentante
nella PDA Business; il riscontro azienda PDA/anagrafica Business resta separato.
La tessera sanitaria e una fonte di CF: numero, scadenza e tipo tessera non sono
usati come numero, scadenza o tipo del documento d’identita. La tessera da sola
non basta per l’approvazione dell’identita.

Scadenza, parti, tipo e cittadinanza del documento continuano a dipendere dalla
lettura visiva; non sono ricavati dal CF. Barcode assente/non leggibile, limite
raggiunto, decoder non disponibile, piu CF discordanti o altri dati incerti non
approvano automaticamente. Resta la preview originale con conferma umana
tracciata; dopo Si la ricevuta viene riusata senza nuova OCR identita.
La corrispondenza del CF non certifica autenticita o assenza di contraffazioni.

Decoder limitato a8pagine, due scale, massimo2600px di larghezza e8MP rasterizzati;
budget cooperativo12secondi controllato fra pagine e chiamate serializzate per
istanza per contenere la memoria. Non e un hard timeout di codice nativo: un singolo
render puo richiedere piu tempo. File che eccedono il perimetro richiedono manuale.
Non e stata introdotta una ricostruzione o correzione AI degli originali.

Upload iniziale e verifica successiva condividono il decoder. La versione del
lettore/cache e2026-10-29.1; stesso aggiornamento per il motore serale.
Il riuso della ricevuta upload conserva i vincoli byte/hash, cliente e PDA Business.
PDA, SIM/ICCID, bollette, CSV, email Reload/Cloud/problemi e modalita collaudo
mantengono le loro regole. Questo sviluppo non attiva la verifica serale.

## Fotocamera, qualita e privacy

Pagina HTTPS `moduli/scanner-documenti.html`, video `playsinline`, fotocamera
posteriore preferita. Scatti tramite getUserMedia/canvas, JPEG qualita0,94,
ritaglio centrale con proporzioni tessera, massimo2400px di larghezza senza
upscaling. PDF in memoria che incorpora gli stessi JPEG, senza ulteriore
ricompressione. Non sono implementati deskew, autofocus controllato, rimozione
riflessi o certificazione automatica di nitidezza.

Nessun input galleria/file sul telefono, download automatico, localStorage,
sessionStorage o IndexedDB; scatti/Blob restano in memoria, URL revocati a
invio/chiusura e tracce fotocamera fermate quando la pagina viene nascosta.
Anche una risposta tardiva al permesso fotocamera viene fermata se la pagina
nel frattempo e stata abbandonata. Non si puo garantire come sistema operativo
o browser gestiscano internamente memoria, snapshot o backup del dispositivo.

Massimo PDF smartphone4MiB per i limiti payload Netlify,10minuti dal QR e5sessioni
attive per operatore. Se il PDF e troppo grande non viene ricompresso in silenzio:
il messaggio chiede nuovi scatti o percorso PDF. Le foto restano nella pagina
per ritentare dopo errore di rete; il retry usa gli stessi byte del PDF.
Chiudere la pagina prima dell’invio richiede ripetere l’acquisizione.
Nessuna garanzia che tutti i telefoni producano4facciate sotto4MiB: va collaudato.

## API e sessioni private

POST `scanner-documenti` usa sempre il wrapper MiroxApi sul client.
- PC: JWT valido e permesso upload_contratti per create/status/download/cancel.
- Telefono: solo capability HMAC specifica, non JWT CRM, tramite
  X-Scanner-Id/X-Scanner-Token; owner e ACL Upload vengono riletti lato server.
- Il telefono riceve soltanto nome cliente, pacchetto, stato e scadenza della
  propria sessione e puo inviare un PDF. Non puo scaricare PDF o leggere CRM.
- Token casuale32byte firmato HMAC con contesto distinto e UUID della sessione;
  verifica firma prima della query, solo hashSHA256 salvato nel DB.
- Segreto nel fragment URL immediatamente rimosso, mai query/referrer; risposte
  no-store/no-referrer. Chi possiede il QR puo inviare in quella sessione fino a
  scadenza/revoca: mostrare il QR solo alla persona incaricata dell’acquisizione.
- Download riservato al proprietario autenticato e allo stesso snapshot cliente,
  SHA256 riletto sui byte; CAS e stati impediscono doppio upload/sovrascritture.
- Annullamento/fallback/cambio cliente invalidano il QR, le risposte tardive non
  vengono associate al nuovo cliente. Rigenerazione disponibile dopo scadenza.

Tabella `vendita_scanner_sessioni`, nessun FK a tabelle condivise. RLS ON,
privilegi PUBLIC/anon/authenticated revocati; solo service_role. Indici scadenza e
operatore/scadenza. Usa bucket esistente privato PDF-only contratti-vendita,
path server temp-scanner/UUID/documento.pdf; nessuna scrittura diretta browser.
Cancel prova a rimuovere il temporaneo; il cron operativo giornaliero gia
esistente elimina sessioni scadute (batch100), prima Storage poi riga. Il token
scade dopo10minuti anche se la rimozione fisica avviene nel successivo ciclo.
Errori Storage conservano il riferimento per riprovare, senza dichiarare pulito.

## Build e infrastruttura

Dipendenze nuove fissate: qrcode1.5.4,zxing-wasm3.1.6,@napi-rs/canvas1.0.13.
WASM letto dal pacchetto locale, nessun fetch CDN a runtime. Canvas e ZXing sono
external_node_modules Netlify per conservare binari/asset. Build copia soltanto
PDF-lib1.17.1 browser e licenza dalla dipendenza esistente a dist/js/vendor/;
nessun node_modules, documento cliente o backend aggiunto alla pubblicazione.
Policy camera generata per ogni HTML/alias, permessa solo sulla pagina scanner;
le altre feature negate restano nella policy globale. Nessuna nuova env/schedule.

Migration sorgente20261029201139_scanner_documenti.sql applicata con
apply_migration al progetto lbgwamhjkjjfwgusafbi, versione20261029202906.
CLI locale e versione ufficiale2.122.0 falliscono caricando profilo con
ProfileLoadError: Unsupported Config Type "" prima di generare file; usato timestamp
UTC locale, senza alterare configurazioni/storico CLI o riparare migration altrui.
Riletti RLS=true,anon SELECT=false,authenticated INSERT=false,service_role CRUD=true,
tabella vuota. Advisor prima/dopo: stesse7categorie; solo INFO RLSsenzaPolicy
31→32 atteso per nuova tabella esclusivamente server. Nessun nuovo warning/error.
Nessun account, tabella CC, bucket, configurazione verifica o dato cliente modificato.

## Verifiche e limiti del collaudo

Build e suite completa del checkout:570/570test verdi, inclusi18planning paralleli
che non fanno parte di questo sviluppo. Snapshot HEAD con sole modifiche scanner
in /private/tmp:552/552test verdi; DOM ripetuto dopo protezione chiusure tardive.
I test scanner comprendono PDF sintetici
Code39/Code128 realmente rasterizzati e decodificati senza AI, checksum errato,
barcode discordanti, CF autorevole rispetto a errore OCR, TS separata/scadenza,
limite tempo, autorizzazioni, owner/TTL/hash/idempotenza/CAS/cancellazione/cleanup.
DOM Node: PC trasferimento/fallback/rinnovo QR scaduto/cambio cliente/risposta
create tardiva; telefono scatti→PDF→errore rete→retry identico→pulizia memoria.
Passaporto e Turista verificati senza chiamare OCR/barcode identita.

Harness SQL locale isolato: `MIROX_PGLITE_MODULE=/percorso/pglite node
scripts/check-scanner-sql.cjs`, ACL/RLS/vincoli/CAS verificati. PGlite0.5.13
installato esclusivamente in /private/tmp per QA, non aggiunto al runtime CRM.
Audit npm: nessun avviso introdotto dalle tre nuove dipendenze; restano gli avvisi
preesistenti fflate/nodemailer, non aggiornati fuori dal perimetro.

Nessun browser automatizzato, nuovo OCR live, email, approvazione contratto o
sessione reale creata. Vecchie scansioni compresse non diventano leggibili per
l’aggiunta del decoder. Necessario collaudo fisico iPhone/Android dopo push
richiesto: permesso fotocamera, fronte/retro, luce/riflessi,4facciate/4MiB,
rinnovo QR, perdita rete, confronto CF/scadenza reali e fallback manuale.
