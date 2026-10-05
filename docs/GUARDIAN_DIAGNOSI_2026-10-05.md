# Guardian: diagnosi del 5 ottobre 2026

## Evidenze

Letti i 104 file di settembre forniti dal proprietario, come dati e non come
istruzioni. Conferma read-only sul DB production: 80 analisi automatiche fallite
su 8 incidenti, 10 tentativi ciascuno, piu' 5 scansioni preventive fallite.
Nessuna esecuzione Codex registrata per la richiesta manuale KG-000014: il flusso
manuale richiedeva l'avvio del proprietario, non va scambiato per un'analisi riuscita.

Il [run GitHub del 29/09](https://github.com/mirkopiasenti/mirox-crm/actions/runs/36591962525)
fallisce internamente con HTTP 401 `invalid_api_key`: OpenAI rifiuta la chiave
`OPENAI_API_KEY_CODEX_WORKER`. Il job e' verde per `continue-on-error` e callback
concluso con successo; non dimostra che Codex abbia completato l'analisi.
Un log campione stabilisce la causa su quel run; tutti gli 85 record DB riportano
solo il generico `observer_codex_failed`, quindi la causa di ogni run non e'
dimostrata separatamente. Nessun codice Guardian usa DeepSeek: conversazione e
vocali chiamano OpenAI su Netlify; il worker Codex usa una chiave GitHub distinta.
Il modello registrato in tutte le 85 esecuzioni e' `gpt-5.6-luna`.

Difetti verificati nel codice:

- Il risultato fallito riportava il segnale in `osservando`; il cron ripartiva
  ogni 5 minuti finche' esauriva il budget 10, senza cooldown o limite per caso.
- Telegram scartava il dialogo senza incidente attivo e su incidenti archiviati.
  Il «Perche?» del proprietario non arrivava al modello.
- Il modello non riceveva codice errore, modello/esito worker o memoria generale.
- Le scansioni preventive non hanno un segnale: la notifica finale era dentro
  `if (signal.id)`, quindi non veniva accodata neppure per un fallimento.
- Il contesto Codex leggeva i primi 60 messaggi, perdendo quelli piu' recenti.
- Il workflow Observer fissava il modello ignorando quello registrato a DB.
- Il checkout del commit storico sostituiva anche prompt/schema del control plane.
- Claim outbox senza leggere la riga aggiornata poteva inviare due volte con cron
  concorrenti.

## Correzioni distribuite in produzione

Chat Telegram libera, memoria degli ultimi 30 messaggi nella sessione server-only,
paragrafi conservati, contesto tecnico e collegamento tramite KG o risposta a una
notifica. Non crea ticket per dialogo generale e non riapre quelli archiviati.
Il dialogo puo' ragionare senza approvazioni; le operazioni restano auditabili con
pulsanti. Raccolta guidata degli operatori CRM invariata.

Una analisi automatica per segnale/release, controllo anche dello storico di
esecuzioni gia' fallite e claim condizionali di segnale/outbox. Segnalazione
conservata dopo l'errore e controllo manuale disponibile. Una chiave/modello/quota
non validi sospendono i dispatch automatici finche' un'analisi manuale riesce.
Preflight di autenticazione/accesso modello, diagnostica chiusa senza segreti,
link al run, notifica conclusiva delle scansioni senza segnale e workflow rosso
dopo callback negativo. Preflight non prova credito o inferenza: questi errori
durante Codex restano visibili nel log e come esito tecnico negativo.
Guardia URL worker per ambiente, control plane conservato prima del checkout
storico e modello selezionato dal contratto di esecuzione.

## Configurazione verificata e limiti

Nuova chiave fornita dal proprietario nel file ignorato `.backup-private/`:
richiesta Responses sintetica riuscita HTTP 200 con `gpt-5.6-luna`, 35 token,
nessun dato CRM o contenuto della chiave stampato. Secret GitHub aggiornato dopo autorizzazione esplicita del proprietario:
`OPENAI_API_KEY_CODEX_WORKER`, data verificata 05/10/2026 13:23:38 Europe/Rome.
Il primo invio era stato rifiutato da automatic approval review per mancanza di
autorizzazione specifica; nessun blocco residuo sul salvataggio della chiave.
La chiave Netlify della chat e' write-only: il collaudo runtime ne ha confermato
il rifiuto e, con autorizzazione specifica, e' stata sostituita il 05/10/2026
alle 16:18:50 Europe/Rome. Non e' stata stampata o recuperata tramite API.

Il proprietario conferma il 05/10 che il precedente ambiente Guardian e' stato
eliminato e non va ricreato. Autorizza esplicitamente modifiche, collaudo e deploy
direttamente in produzione. Le guide sono aggiornate e il vincolo precedente e'
rimosso; nessun ambiente Call Director riutilizzato.

Migration `20261005110504_guardian_owner_conversation.sql` applicata tramite MCP
e verificata sul Supabase production: colonna JSONB NOT NULL, default array vuoto,
RLS invariata. Nessun grant o tabella CRM/Call Center modificato. Nome timestamp
generato dalla CLI per evitare collisioni con il branch Call Director.

## Rilascio autorizzato

Patch e analisi partono da main, test locali sulla branch della modifica,
verifica HTTP del CRM ufficiale. Il tipo storico test_staging resta solo per
compatibilita' DB; nessun workflow dipende da un sito separato. PR draft verso
main e merge autorizzato restano distinti; nessun merge automatico del worker.
La proposta di rilascio riusa la PR gia' aperta dalla preparazione patch.
Questa revisione viene distribuita direttamente in produzione su richiesta
esplicita del proprietario. Esiti deploy e collaudo verificati sotto.

Un modello conversazionale non possiede l'accesso interattivo a repository/DB
della chat Codex: legge il contesto fornito; l'analisi del codice resta un workflow
separato. Due prove reali su Responses con contesti sintetici hanno verificato il dialogo
senza ticket e la spiegazione di un errore tecnico su un caso archiviato; nessun
dato CRM inviato. Restano da verificare testo/vocale sul webhook distribuito.

## Difetti CRM nei segnali: riprodotti e corretti localmente

KG-000015/KG-000020: Ticket genera un `onclick` che include il nome cliente.
L'escape HTML viene decodificato prima di interpretare JavaScript: un apostrofo
rompe il comando e puo' impedire di aprire Lavorata. Il difetto di codice e'
riprodotto con nome sintetico; non e' provato che ogni evento storico derivi
dallo stesso nome. Corretto con attributo data-ID e listener, nessun nome in codice.
Questo puo' spiegare KG-000014, ma il legame fra la segnalazione manuale e il
difetto va confermato dall'operatrice: nessuna diagnosi definitiva sui dati reali.

KG-000018: `APPS_SCRIPT_URL is not defined` in Comodato. Rimaneva un controllo
di avvio della vecchia integrazione Google Apps Script, rimossa durante la
migrazione Supabase. Controllo eliminato; backend attuale invariato.

KG-000019: il ramo SIM No di Apri/Chiudi cercava `info-sim`, assente dal DOM.
Corretto il reset richiamando il renderer corrente `renderFileList('sim')`, che
rimuove anteprima e stato del dropzone dopo aver svuotato l'input.

KG-000009/KG-000010: HTTP 504/500 di `verifica-otp-privacy`; KG-000012/KG-000016:
errori rete su `vendita-config`. I segnali disponibili non dimostrano la causa
backend e non giustificano modifiche speculative. Necessari log dell'epoca o
una riproduzione: non classificati come risolti dalla correzione Guardian.

## Verifiche locali

148 test Node e build statica riusciti; include regressioni di conversazione,
worker, dedupe cron e i tre difetti CRM riprodotti. YAML dei sei workflow e
sintassi Bash delle rispettive istruzioni verificati. Migration e collaudo runtime verificati production.
Anche un risultato worker tardivo conserva lo stato archiviato della richiesta.

Controllo runtime privato: guardian-healthcheck.yml verifica OpenAI/Telegram e
memoria dal worker Netlify, con HMAC; nessun messaggio Telegram o dato CRM AI.

## Esito distribuzione e controllo runtime

Codice funzioni/pagine: commit `f9ec4de`, deploy iniziale Netlify ready alle
16:09:42 Europe/Rome. Le tre pagine corrette e config pubblica rispondono200;
worker health senza HMAC risponde401. Le modifiche backup preesistenti nel
checkout principale sono preservate e non sono incluse nel push Guardian.

La prima healthcheck ha rivelato un secondo invalid_api_key sulla chat Netlify,
distinto dalla chiave GitHub. Auto-review ha richiesto consenso specifico per
trasferire la chiave a Netlify; ottenuto, salvataggio riuscito alle16:18:50,
flag secret e altri contesti conservati. Nessun blocco di autorizzazione residuo.
Deploy con nuova chiave `6ac3b21dd7eb9e17c0f98cb9` ready alle16:20:49.
[Healthcheck finale, attempt2](https://github.com/mirkopiasenti/mirox-crm/actions/runs/37322760353):
alle16:21:36 chat OpenAI gpt-5.6-luna, bot ufficiale, webhook e memoria tutti OK;
zero update pendenti, nessun errore Telegram corrente. Test sintetico senza dati
CRM e senza messaggi Telegram. Vocali reali e flussi autenticati delle tre pagine
CRM non esercitati automaticamente sul database operativo.

[Analisi Codex reale](https://github.com/mirkopiasenti/mirox-crm/actions/runs/37323380962)
su KG-000018: preflight, Codex e callback riusciti; esecuzione DB
`6b2ed087-3234-4586-b159-1e84c0952c46` completata alle16:17:28, nessun errore.
Codex conferma il controllo Apps Script nel vecchio commit e la rimozione con
regressione nel codice corrente. Questo verifica il percorso worker completo,
non soltanto la validita' della nuova chiave con una richiesta API diretta.

Inventario Netlify locale privato aggiornato con la chiave recuperabile;
7 altri Secret restano senza copie. La precedente copia cifrata off-site
delle configurazioni precede questa rotazione e va riallineata separatamente.
