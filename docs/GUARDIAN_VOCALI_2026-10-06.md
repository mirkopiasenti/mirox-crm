# Guardian: recupero vocali e correzione del requisito

Il 06/10 il proprietario apre KG-000023 e invia una spiegazione vocale: precisa
che la segnalazione descrive una nuova funzionalità, non un guasto. Il webhook
risponde “Trascrizione del vocale in corso” e poi timeout. Nessuna spiegazione
risulta nel registro: prima dell’errore non venivano salvati file ID o trascrizione.
Il file allegato dura 33,6 secondi e pesa 133.028 byte. La pipeline precedente
scaricava/trascriveva/rispondeva dentro la stessa function sincrona; il messaggio
non identifica con certezza quale richiesta HTTP abbia esaurito il suo timeout.

## Correzione

- Coda privata `kona_ai_vocali_jobs`, salvata prima dell’ack e dedupe generale.
- File ID e richiesta originale, indipendenti dalla successiva conversazione.
- Worker Netlify background, HMAC con timestamp fresco; secret già esistente.
- Deadline trascrizione 180 secondi, massimo cinque tentativi con backoff.
- Trascrizione salvata prima del dialogo: un retry non rispedisce l’audio già letto.
- Risposta pronta salvata prima di Telegram, audit con ID stabile; doppio worker
  non elabora lo stesso vocale e lo stesso update non crea due job.
- Esito ambiguo sospeso, senza retry che duplicano risposte. Pulsante proprietario
  per riprendere esplicitamente. Cron Observer risveglia la coda ogni cinque minuti.
- Chiarimento esplicito del proprietario: problema/miglioria e riepilogo aggiornati
  sulla stessa richiesta ancora in raccolta/ricevuto/in_attesa_approvazione, con
  audit e scadenza delle approvazioni pendenti. Nessun codice o deploy dal dialogo.

## Verifiche

248 test CRM e build superati, inclusi 15 casi dedicati: timeout, doppio update,
doppio worker, lease, contesto originale, trascrizione/risposta salvate, 429,
consegna incerta, retry esauriti, HMAC, riclassificazione e webhook 503 ritentabile.
Migration applicata e verificata production: RLS, browser senza grant e indice
univoco di elaborazione. KG23 riclassificata come miglioria su chiarimento
esplicito in questa chat, con audit; requisito completo ancora da recuperare.
Feature `0d0caba` online alle 19:09:30, Netlify `6ac52b25e0260a00086f3d19`,
CI `37501275540` e health `37501521350` riuscite, incluso accesso alla coda.
Collaudo sintetico senza audio utente: job marcato COLLAUDO_SINTETICO_SENZA_AUDIO,
recuperato dal cron e consegnato alle 19:15:30 al primo tentativo, messaggio170.
Non prova la trascrizione del vocale originale, il cui consenso resta pendente.

La trascrizione del file originale allegato richiede consenso esplicito per
l’invio a OpenAI: auto-review ha bloccato il tentativo e nessun payload audio è
stato spedito. La correzione software procede indipendentemente dal consenso.

Riferimenti: [OpenAI trascrizioni](https://developers.openai.com/api/docs/guides/speech-to-text),
[Netlify background](https://docs.netlify.com/build/functions/background-functions/).
