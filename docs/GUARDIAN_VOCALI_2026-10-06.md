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
Questo primo collaudo non usava il vocale originale. Il proprietario ha poi
autorizzato esplicitamente la trascrizione: HTTP200 in 2,531 secondi, testo
recuperato e accodato in KG23 per riprendere la conversazione.

Il primo tentativo di invio dell’allegato era stato bloccato dall’auto-review.
Solo dopo il successivo consenso esplicito del proprietario il file è stato
inviato a OpenAI. Nessun aggiramento del blocco; chiave privata non esposta.
Il requisito recuperato riguarda due righe Day by Day e due opzioni Customer
Base: cambio piano con telefono finanziato oppure VAR. È una proposta di
funzionalità; nessuna modifica a catalogo, conteggi o pagine CRM applicata.

Riferimenti: [OpenAI trascrizioni](https://developers.openai.com/api/docs/guides/speech-to-text),
[Netlify background](https://docs.netlify.com/build/functions/background-functions/).

Il collaudo completo del vocale recuperato ha rilevato un errore del collegamento
audit: ID UUID fornito a un bigint identity. Corretto con colonna separata
voice_job_id e indice univoco per autore; fixture test ora impone il tipo e
il divieto di assegnare id. Nessun dato audio perso; retry riusa la trascrizione.

## Recupero completo verificato

Correzione `0d76d28` online alle 19:34:30, Netlify `6ac53101841eac0007863ebe`,
CI `37504526771` riuscita e 248 test/build passati con fixture BIGINT identity.
Il job originale recuperato ha riusato la trascrizione, completato il dialogo e
consegnato la risposta alle 19:35:36 (Telegram172). Due messaggi con ID numerico
collegati dal voice_job_id, senza duplicati. Guardian riconosce le due righe
Day by Day e le due opzioni Customer Base e propone Analisi Guardian.
La nuova funzionalità CRM resta da analizzare/approvare e implementare.
