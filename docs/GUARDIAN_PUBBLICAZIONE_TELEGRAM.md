# Guardian: pubblicazione approvata da Telegram

Richiesta del proprietario, 05/10/2026. Ambiente unico production.

## Uso

1. Preparare la modifica dopo l’analisi: Guardian apre una PR draft.
2. Premere `Verifica modifica`: test della patch insieme alla base main corrente.
3. Dopo i test Guardian mostra la conferma finale con PR, riepilogo e versione.
   `Approva pubblicazione` permette di richiederla nuovamente.
4. Premere `Pubblica in produzione`, oppure rispondere a quel messaggio con
   `OK pubblica`. Un messaggio generico di assenso non avvia la pubblicazione.
5. Guardian unisce la PR su main e attende la pubblicazione del relativo commit
   su mirox-crm.it. Verifica poi OpenAI, Telegram/webhook e memoria.
6. Esito in Telegram: successo online, interruzione prima del merge oppure
   GitHub aggiornato con deploy non confermato. Solo il primo chiude il caso.

`/pubblica KG-000001` è una scorciatoia facoltativa per mostrare la conferma,
mai un comando che pubblica da solo. Le conferme scadono dopo un’ora. Una nuova
proposta annulla quelle precedenti ancora in attesa. Doppio clic: un solo job.

## Vincoli

- Owner privato Telegram, webhook con secret e autorizzazione registrata.
- Contratto in JSONB esistente: repo, PR, branch, head/base SHA, test e incidente.
- Conferma confrontata nuovamente dal worker HMAC immediatamente prima del merge.
- Workflow eseguito da main attendibile; token GitHub limitato al relativo job.
- SHA head obbligatorio nella richiesta merge. Base main deve coincidere con
  quella testata; se cambia prima del merge occorrono nuovi test/conferma.
- Verifica dei due parent del commit merge: eventuale corsa con altri push non
  viene dichiarata un rilascio verificato. Non si modificano protezioni GitHub.
- Rifiutati fork, PR chiuse, elenchi incompleti o oltre 300 file, workflow/script
  GitHub, env/config Netlify, package JSON e migration SQL (anche rinominati).
- Nessuna rotazione secret, migration DB, rollback automatico o dato cliente AI.
- Netlify resta collegato a main. Conferma online tramite metadata pubblici
  `window.MiroxEnvironmentInfo` e commit esatto, senza nuovo secret Netlify.
- Attesa circa 11 minuti, heartbeat e risultato; un deploy assente o un controllo
  fallito lascia il caso aperto. Esito Telegram persistente tramite outbox.

## Verifiche

Suite CRM e casi di pubblicazione: autorizzazione, scadenza, doppio clic,
base/head cambiati, test assenti/falliti, percorsi protetti/rinominati, reply al
messaggio preciso, merge rifiutato, deploy assente, salute fallita, audit/outbox.
Il collaudo live con il pulsante di Mirko è separato dalle prove simulate e viene
registrato qui soltanto dopo la sua esecuzione reale.

### Collaudo reale KG-000022

La proposta di collaudo modifica soltanto questa guida. Il pulsante Telegram
consente di verificare approvazione, merge GitHub e pubblicazione Netlify senza
modificare pagine, dati CRM, segreti o configurazioni.

Esito reale del 05/10/2026: il proprietario ha premuto il pulsante Telegram.
[Test branch](https://github.com/mirkopiasenti/mirox-crm/actions/runs/37337090495)
riusciti; [workflow rilascio](https://github.com/mirkopiasenti/mirox-crm/actions/runs/37339405520)
riuscito. Merge `ffe515da613cc39c293bffb3a83c1ae287fc5208` alle 18:15:37,
Netlify production pronto alle 18:16:08 (`6ac3cd2b2d14710008b20284`), commit online
verificato tramite metadata pubblici e salute Guardian superata alle 18:16:14.
Notifica finale Telegram consegnata alle 18:20:22 al primo tentativo. La outbox è
elaborata ogni cinque minuti: l’attesa dopo il deploy è prevista.
Anteprime PR Netlify disabilitate; production main e build restano attivi.
