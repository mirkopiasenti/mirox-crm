# Guardian: dal dialogo allo sviluppo reale

## Problema riscontrato

KG-000023: chiarimento corretto alle19:35, richiesta esplicita di implementazione
alle19:40, risposta che rimandava ancora a “Analisi Guardian”. Questa analisi
riceveva solo testi e non leggeva il repository. Il dialogo non disponeva di
un'azione di sviluppo e gli step patch/test erano separati senza prosecuzione.

## Correzione

Il comando diretto del proprietario avvia la patch, che include l'analisi dei file.
Per formulazioni ambigue la chat mostra Sviluppa e verifica, senza inventare
autorizzazioni. I pulsanti di analisi precedenti ora leggono il repository.
Consenso persistito, hash requisito e ID sorgente impediscono test su requisiti
superati e patch duplicate da retry vocali. Il risultato patch avvia i test; il
cron recupera il passaggio interrotto, senza ripetere quelli falliti. Una patch
che necessita informazioni formula una sola domanda; non ricomincia analisi
discorsive. Test riusciti portano alla conferma finale Telegram legata a SHA/PR.
Il rilascio continua a verificare merge, commit online e salute prima di chiudere.

## Verifiche

13 regressioni mirate: comando reale del dialogo, assenza di dispatch del modello,
vecchio callback di analisi, patch→test→proposta senza deploy, negazioni/citazioni,
blocchi, chiarimenti, requisito superato, cron e retry vocali. Suite completa e
prova reale KG23 da registrare dopo il rilascio. Nessun nuovo schema o secret.

## Colloquio reale e secondo blocco

00176fa online19:57:11, CI37507449399/health37507655840 riusciti.
EsecuzioneKG23/run37507651277: codice preparato, gate SQL bloccava tutto senza
conservare una proposta. Inoltre il modello aveva assegnato zero punti senza
regola: proprietario conferma1 punto complessivo per ciascuna combinazione.
Il validator conserva soltanto le proposte SQL per revisione, senza eseguirle
o consentire merge automatico; altri path protetti rimangono rifiutati. Esiti
di sviluppo nella outbox persistente. Snapshot catalogo reale fornito al worker,
regole di business sconosciute richiedono domanda, non valori inventati.
Gli script SQL non sono eseguiti dal bot. La revisione Codex puo produrre un
piano catalogo a schema chiuso, approvato insieme alla versione su Telegram e
applicato atomicamente dopo il deploy. Cambi schema/RLS/RPC e altri dati restano
fuori da questa possibilita. Non dichiarare pubblicato dal solo deploy.

## Piano catalogo dopo la conferma finale

Migration20261006182105 applicata: due RPC con privilegi minimi, core privato e
wrapper service-only. Piano digest/SHA/test/lease/owner/conferma1h, solo2tabelle
config e precondizioni sulle regole vecchie. Merge e SHA pubblico verificati
prima dell'applicazione; checkpoint atomico, dati falliti non chiudono il caso.
Prove PostgreSQL reali in rollback: inserimenti/rilettura1punto+device, precondizione
fallita dopo un inserimento annulla tutto, lease inesistente rifiutato. Zero
record di prova residui; nessuna approvazione finale reale simulata.7regressioni
Node nuove su piano, consenso, drift, ordine deploy-dati-salute e fallimenti.
PR13 conservata realmente dal worker: revisionare sovrapposizione Day by Day e
vincoli acquisto/device, convertire SQL proposto in piano revisionato e portare
la proposta concreta alla conferma finale Telegram.

## Revisione concreta KG23

Fondazione finale22e85df online22:52:52/CI37529716847/health37529988819OK,
274test. PR13/head ea944a291f5f revisionata:280test+build (6regressioni feature
con render wizard/validator server veri), piano2offerte/2righe a1punto e sole
regole14/15 per evitare duplicati preservando Telefono Incluso storico. Vincoli
telefono obbligatorio e tipo Finanziamento/VAR, altre offerte/FWA invariate.
Intero piano PostgreSQL eseguito in transazione annullata,0nuove righe/offerte
attive dopo rollback. Nessun SQL spostato/eseguito, nessuna conferma simulata.
Piano JSON/digest approvazione patch6ebcabfa legati alla head. I test finali del
workflow e la proposta Telegram precedono il consenso del proprietario; schema
fuori da questo piano e altre tabelle protette richiedono revisione separata.

## Esito finale del collaudo

Il cron riprende automaticamente il piano revisionato alle23:01:08. Test2c36f914/
workflow37530802409 riuscito su head ea944a291f5f e base22e85df: install/test/
smoke superati. Conferma finale Telegram consegnata23:01:35, messaggio185,
approvazione474d0db6 in_attesa fino07/10 00:01:35Europe/Rome. Comprende piano
dati a1punto e hash dc9c7539; nessun errore di proposta. PR13 draft/open/mergeable.
La funzionalita non e ancora online: attende il consenso finale del proprietario.
Nessun nuovo push main/PR o modifica piano dopo questo punto, per preservare
l'approvazione legata alla versione.


## Pubblicazione KG23 verificata06/10 sera

Conferma reale del proprietario: releaseb5a7b0f3 completata23:08:53,
merge81412e40fbe5/Netlify6ac5632e pronto23:08:32, healthOK e piano catalogo applicato
con hash dc9c7539. Due offerte Consumer rilette a1punto/deviceTRUE; caso chiuso.
La successiva KG25 riguarda anche i conteggi Avanzamento/Gare: audio recuperato
23:35 e requisito registrato, sviluppo della nuova regola ancora da avviare.
