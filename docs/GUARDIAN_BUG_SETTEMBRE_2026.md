# Intervento sui bug di settembre 2026

Data: 05/10/2026. Richiesta del proprietario: correggere il backlog e ripartire
dalle nuove segnalazioni. Deploy production gia' autorizzato nella stessa chat.

## Ricognizione completa

DB Guardian: 14 casi creati a settembre (KG8–21), nove segnalazioni tecniche o
manuali e cinque scansioni automatiche non concluse. Nessun messaggio di
settembre sui casi precedenti KG1–7: restano fuori dalla chiusura di questo mese.
KG4 e' una richiesta di funzionalita' di agosto e KG6 Protecta riguarda agosto;
non vengono chiusi da questo intervento.

| Caso | Evidenza e intervento | Esito previsto dopo deploy verificato |
|---|---|---|
| KG14, KG15, KG20 | Ticket: nome con apostrofo decodificato nell'onclick produce SyntaxError; listener separato gia' distribuito. Ora UPDATE deve restituire la riga Lavorata e doppia conferma impedita. RLS live consente gli account autenticati, quindi non e' stata allargata. | Risolti, test di apertura con apostrofi e salvataggio/zero righe |
| KG18 | Comodato: controllo APPS_SCRIPT_URL inesistente, rimosso. Analisi Codex reale riuscita dopo recupero chiave. | Risolto |
| KG19 | Apri/Chiudi SIM No: accesso al nodo info-sim inesistente, sostituito con render lista corrente e reset campi. | Risolto |
| KG10 | HTTP500 OTP 07/09 16:50:44 UTC: upload consensi-privacy con DatabaseTimeout/544 alle 16:50:43.956 UTC, durata 6.866 ms nei log Supabase. Recupero controllato del timeout, single-flight UI e UPDATE condizionale. | Correzione applicativa verificata; indisponibilita' persistente Supabase resta possibile |
| KG9 | HTTP504 OTP 04/09: nessun log Storage nella finestra 07:15–07:18; causa precisa non dimostrata, log Netlify storici fuori retention. Recupero manuale con stesso codice e risposta idempotente, meno letture server superflue, diagnostica per fase. | Archiviato come evento storico mitigato, non come causa eliminata |
| KG12, KG16 | Load failed/Failed to fetch su prewarm catalogo dalla dashboard. Un retry GET con limite, stop offline e diagnostica conservata. Non prova se la causa fosse rete operatore, browser o servizio. | Archiviati con mitigazione verificata, causa storica non dimostrata |
| KG8, KG11, KG13, KG17, KG21 | Scansioni preventive fallite a causa del vecchio worker, nessun risultato di analisi. Infrastruttura ripristinata e collaudata; non sono cinque bug del CRM. | Archiviate come scansioni non concluse, senza inventare risultati |

## Correzioni aggiuntive e prove

- Catalogo: opt-in `__miroxReadRetry:true`, GET senza body, massimo due richieste
  con attesa 350 ms; solo errori rete/502/503/504. POST, HTTP500, abort e offline
  non vengono ripetuti. Dashboard e wizard usano lo stesso wrapper.
- OTP: niente POST duplicati da Enter/click, reinvio SMS bloccato durante verifica.
  Dopo errore rete/5xx si puo' verificare lo stesso consenso senza nuovo SMS.
- PDF: path include UUID consenso, upload upsert:false. Dopo timeout si ripete
  una volta lo stesso path; conflitto accettato solo dopo riscaricamento e SHA256.
  Conflitti reali usano suffisso; vecchi PDF non vengono rinominati.
- Scritture OTP: confronto stato pending, hash e tentativi; nessuna conferma di un
  record gia' revocato o aggiornato da altra verifica. Una risposta DB persa viene
  verificata con rilettura, senza cancellare il PDF referenziato. Se neppure la
  rilettura riesce, il file resta per evitare danni; possibile orfano da riconciliare.
  Tentativo errato non dichiarato registrato se UPDATE fallisce.
- Errori server: fase/request_id e codici chiusi Guardian, senza OTP, SMS, cliente
  o messaggi grezzi del provider nella telemetria.
- Ticket: apertura con apostrofi/contenuto simile a codice, UPDATE senza righe e
  salvataggio riuscito verificati; messaggio di successo solo sul risultato reale.

Suite completa: 160/160 test Node e build statica riusciti. Le prove simulano
DatabaseTimeout, timeout dopo upload riuscito, file diverso, perdita risposta DB,
concorrenza, revoca e rete/abort. Il generatore PDF reale e' gia' nella suite.
Nessun SMS reale o consenso cliente creato per fare prove. Il flusso completo
con operatore e cliente verra' validato sul prossimo uso, non e' simulato come
un collaudo end-to-end live. Schema e RLS di CRM/Call Center invariati.

## Baseline e storico

Dopo conferma deploy: cinque bug UI e la correzione applicativa KG10 sono marcati
risolti; tre eventi di rete/timeout mitigati e cinque scansioni incompiute sono
archiviati con note esplicite. Nessun messaggio/esecuzione eliminato. Nuove
occorrenze sul nuovo commit hanno segnali separati e possono riaprire il lavoro.
Un utente con una vecchia scheda deve ricaricare la pagina per usare il codice
nuovo; telemetria con vecchio commit resta distinguibile.

Riferimento retention Netlify: [Function logs](https://docs.netlify.com/manage/monitoring/logs/)
(documentazione ufficiale: fino a sette giorni in base al piano).

## Verifica produzione

Commit applicativo `fca1c00d4015c138b46670a693c1d3767162a70d`, Netlify deploy
`6ac3b9f91d650e0007c6553d` ready/pubblicato 05/10/2026 16:54:15 Europe/Rome.
Ticket, wizard, wrapper API, dashboard, Comodato e Apri/Chiudi HTTP200 con codice
atteso; verifica OTP e catalogo senza sessione rifiutati con HTTP401.
[Healthcheck production](https://github.com/mirkopiasenti/mirox-crm/actions/runs/37328685582)
riuscito alle 16:55:56: OpenAI/bot/webhook/memoria OK, zero update Telegram pendenti.

Aggiornamento DB Guardian dopo deploy: sei casi risolti, otto archiviati,
otto segnali chiusi e quattordici nuovi messaggi audit. Rilettura indipendente:
zero casi di settembre ancora aperti. Storico conservato; nessuna notifica
Telegram agli operatori/proprietario generata da questa chiusura manuale.
Cinque bug UI sono distinti da tre cause tecniche uniche (Ticket, Comodato, SIM);
KG10 aggiunge la correzione applicativa dei timeout del provider. Nessuna prova
live di compilazione pratica o acquisizione consenso cliente viene dichiarata.

Guide aggiornate: README, AGENTS, CLAUDE, database/README e STATO_LAVORO.
Modifiche backup preesistenti del checkout principale preservate e non distribuite.
