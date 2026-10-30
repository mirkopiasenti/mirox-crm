# Scanner e controllo identita — rapporto di rilascio30/10/2026

Stato: preparato localmente, non pubblicato. Ramo `codex/scanner-rilascio`, worktree
`/Users/mirkopiasenti/.codex/worktrees/scanner-rilascio/Mirox CRM`.
Base `origin/main`01a8470: planning gia pubblicato conservato integralmente.
Nessuna modifica ai suoi file, dashboard, shell o API; checkout originale preservato.
I commit scanner sono integrati sul ramo di rilascio; non serve forzare main.

## Esito e perimetro

Build/suite finale **601/601test verdi su Node22.22.0**, inclusi19planning.
SQL isolato PGlite0.5.13: ACL/RLS/vincoli/CAS verificati. Quattro pacchetti creati
con il bundler ufficiale Netlify zisi16.6.0, asset Canvas/WASM presenti; API identita
eseguita dal bundle estratto isolato con PDF e barcode reali sintetici.
QA nativa su macOS/darwin-arm64; il build Linux di CI resta da eseguire al push.
Nessuna automazione browser, nuova chiamata AI, email, documento cliente analizzato,
verifica/approvazione contratto o scrittura production durante questa revisione.

Il flusso integrato usa endpoint scanner/identita, multipart e PDF reali generati,
decoder effettivo, ricevuta firmata, tre contratti sintetici predisposti nella
fixture, salvataggio/copie, handler reale finalize e recupero rollback quando la
risposta positiva viene persa; poi lettura/verifica successiva con riuso identita.
Client AI, Auth, DB e RPC sono fixture locali: non e un collaudo cliente reale.
Creazione commerciale, punteggi, privacy e altre categorie restano coperti dalla
suite preesistente, senza nuove scritture o simulazioni di approvazione in CRM.

## Matrice verificata

| Area | Prova / comportamento |
|---|---|
| CIE | Barcode proprio supera errore lettera OCR; CF/data firma/scadenza e parti verificate |
| CF errato/multiplo | Checksum invalido non accettato; CF discordanti richiedono manuale |
| Carta/patente + TS | CF solo tessera: confronto nome e nascita fra i due documenti; dati mancanti/discordanti richiedono preview |
| Facciate TS | Fronte/retro con evidenza distinti da facciate/scadenza identita; incerto→manuale |
| Business | Azienda PDA/anagrafica e CF rappresentante PDA/documento, nessun bypass manuale delle fonti |
| Passaporto/Turista | PDF/manuale; tipo selezionato erroneamente non basta per approvarlo automaticamente |
| VAR extraUE | Permesso obbligatorio; cittadinanza ignota blocca il caso specifico, almeno unaUE esclude obbligo |
| QR | Owner, permesso fresco, cluster, TTL, revoca/rinnovo, invalidazioni e risposte tardive |
| Trasferimento | Retry stessi byte, hash, idempotenza,4MiB, multipart interrotto, doppio invio |
| Copie persistenti | Risposta insert persa non elimina file registrati; stato non rileggibile conserva byte |
| Finalize | Ogni contratto coperto, stessi hash/cliente/PDA e permesso; risposta persa recuperata senza cancellare inviato |
| Serale | Riuso soltanto stessi byte/cliente/cluster/PDA, scadenza alla firma; altri controlli invariati |
| Recupero UI | Reset/bozze/file modificati/preview obsolete, nessuna ricevuta vecchia sul nuovo documento |
| Packaging |4bundle, moduli esterni, WASM locale e API funzionante dall’archivio estratto |

## Correzioni finali

- Risposta DB persa durante copia identita definitiva: rilettura righe per path,
  contratto, cliente, tipo e SHA; recupero del successo o conservazione se incerto.
- Errori stream anche nell’upload definitivo, senza crash per multipart troncati.
- CF collegato alla pagina identita: barcode su fronte/retro del documento oppure
  stesso CF esplicito stampato su una di quelle pagine. Tessera corretta + documento
  diverso non puo essere approvato per il solo CF; nessun blocco generale sul nome OCR.
  Scelta esplicita del proprietario30/10: se CF solo tessera, confrontare nome e
  nascita fra i due documenti con evidenze separate. Ordine dei nomi e diacritici
  normalizzati, data identica; dati mancanti/discordanti o CF diverso stampato
  sull’identita richiedono preview manuale. Nessun confronto generale nome-anagrafica.
  Tool con nome/nascita/CF tessera separati dai dati della carta o patente.
- TS richiesta: evidenza fronte/retro, altrimenti preview anche nel controllo
  successivo se la ricevuta upload non e riusabile.
- Cluster espliciti diversi invalidano ricevute e riuso, senza rompere legacy privo
  di cluster. Lettore/cache e motore versione2026-10-30.1.
- PDF fotografici: risoluzioni realmente differenti,1800/2600px come massimi;
  rimangono8pagine/8MP raster e controllo cooperativo del tempo.
- Budget lettura API42s condiviso con Business, timeout SDK entro residuo e
  decoder entro residuo12s; esaurimento restituisce controllo manuale per identita.
  PDF/render nativi hanno controllo cooperativo, non un hard timeout per istruzione.
- Limiti browser4MiB per file e4MiB complessivi per richiesta identita, verificati
  prima del trasferimento. Allegati validati prima di aggiungerli al carrello;
  errore esplicito, selezione conservata, nessuna ricompressione automatica.
  Il vecchio massimo backend20MB non significa che il browser possa trasferirli.
  Netlify documenta6MB di payload e circa4,5MB per binari per l’overhead Base64;
  il margine4MiB evita richieste oltre limite. [Configurazione Netlify](https://docs.netlify.com/build/functions/configuration/).

## Preflight production: soltanto letture

- vendita_scanner_sessioni presente e vuota, RLS ON; anon SELECT e authenticated
  INSERT negati, CRUD service_role consentito. contratti-vendita privato.
- Migration scanner20261029202906 gia applicata, nessuna migration nuova richiesta.
- modalita=collaudo, email_collaudo=true,0collaudi in coda e0verifiche in corso
  al momento del controllo. Nessun flag cambiato o vecchio esito riaccodato.
- Destinatari Reload/Cloud Gmail e problemi mail.com invariati, nessun WhatsApp.

## Ripetibilita QA

Eseguire `npm ci` e `npm test` con Node22. Per SQL, installare PGlite0.5.13 in
una directory temporanea e passare MIROX_PGLITE_MODULE a scripts/check-scanner-sql.cjs.
Per packaging, installare @netlify/zip-it-and-ship-it16.6.0 solo fuori dal progetto,
passare il percorso del suo dist/main.js in MIROX_ZISI_MODULE ed eseguire
`node scripts/check-scanner-package.mjs`. Script crea soltanto temporanei privati,
mai dist, non chiama AI/Supabase o deploy. Quella variabile non e env di produzione.
Prova integrata ripetibile: `node --test tests/scanner-workflow.test.js`.

## Pubblicazione e primo collaudo

1. Su richiesta esplicita di push, rileggere origin/main e verificare che sia
   antenato del ramo di rilascio. Se avanzato, integrare e verificare prima; mai force.
2. Pubblicare il ramo preparato su main, poi attendere CI Linux e deploy Netlify.
   Non pubblicare un preview con credenziali Supabase production: il guard staging
   deve restare attivo. Nessun nuovo progetto o cambio env richiesto.
3. Verificare commit pubblico, asset, camera policy e401 API senza JWT; configurazione
   ancora collaudo. Nessun lancio massivo di verifiche o email al deploy.
4. Con proprietario: una nuova pratica reale, prima CIE, usando iPhone/Android;
   controllare nitidezza/riflessi, QR/scadenza, invio e preview, CF e scadenza,
   ricevuta, copie definitive e successivo collaudo assistito. Solo dopo passare
   a carta/patente+TS, Business e VAR. Le email collaudo restano attive come richiesto.
5. Se OCR incerto, usare conferma manuale soltanto dopo avere visualizzato tutti
   gli originali. Se trasferimento fallisce, riprovare stessa sessione o PDF;
   se rollback non confermato, conservare ID mostrato e riconciliare prima di reinviare.

Il collaudo fisico non e sostituibile da fixture: fotocamera/permessi iOS-Android,
qualita reale e lettura AI sul documento cliente non sono stati certificati qui.
Un errore tecnico prima dell’invio conserva i file nella pagina; chiudere/ricaricare
il wizard richiede riselezione o nuova acquisizione, come per le bozze esistenti.

Ripristino, se necessario: revert dei soli commit scanner successivi a01a8470,
conservando planning e tabella privata; nessun DROP o cancellazione dati clienti.
Nuove pratiche gia inserite vanno riconciliate singolarmente, mai annullate in blocco.

## Dipendenze e audit finale

Avvisi preesistenti corretti con fflate0.8.3 e Nodemailer10.3.1, versioni fissate
nel lockfile; npm audit riporta0vulnerabilita note nel ramo preparato. Il primo
aggiornamento Nodemailer9.1.1 lasciava avvisi residui: esaminata la migrazione10,
che richiede Node20 gia soddisfatto dal progetto>=22 e conserva CommonJS.
[Note Nodemailer10](https://github.com/nodemailer/nodemailer/releases/tag/v10.0.0),
[advisory fflate](https://github.com/advisories/GHSA-px8p-9vwx-vf98).

Provati autenticazione/destinatari/MIME con SMTP su127.0.0.1 che non consegna
nulla all’esterno, ZIP/UTF8 e601test complessivi Node22. Bundle isolato verifica
anche la composizione email senza rete. Configurazioni SMTP, destinatari, template
e logiche di invio invariati. In produzione restano le versioni precedenti fino
al push; nessuna env o credenziale cambiata.
