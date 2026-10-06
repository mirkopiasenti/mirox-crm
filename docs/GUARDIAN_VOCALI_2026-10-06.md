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

247 test CRM e build superati, inclusi 14 casi dedicati: timeout, doppio update,
doppio worker, lease, contesto originale, trascrizione/risposta salvate, 429,
consegna incerta, retry esauriti, HMAC, riclassificazione e webhook 503 ritentabile.
Migration applicata e verificata production: RLS, browser senza grant e indice
univoco di elaborazione. KG23 riclassificata come miglioria su chiarimento
esplicito in questa chat, con audit; requisito completo ancora da recuperare.
Deploy production da verificare nella sessione.

La trascrizione del file originale allegato richiede consenso esplicito per
l’invio a OpenAI: auto-review ha bloccato il tentativo e nessun payload audio è
stato spedito. La correzione software procede indipendentemente dal consenso.

Riferimenti: [OpenAI trascrizioni](https://developers.openai.com/api/docs/guides/speech-to-text),
[Netlify background](https://docs.netlify.com/build/functions/background-functions/).
