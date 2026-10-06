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
Il rilascio automatico del bot resta limitato a cambi repository consentiti: un
cambio dati/schema richiede ancora intervento Codex separato e non va dichiarato
pubblicato dal solo deploy Netlify.
