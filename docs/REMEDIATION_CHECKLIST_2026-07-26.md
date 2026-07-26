# Chiusura definitiva interventi prioritari — 26 luglio 2026

## Esito

I dodici difetti tecnici prioritari individuati nell'audit iniziale risultano corretti nel codice, nelle migration di produzione e nei test automatici. Questa checklist distingue le correzioni concluse dai possibili progetti futuri, che non sono difetti ancora aperti.

| # | Difetto originario | Stato | Correzione verificabile |
|---|---|---|---|
| 1 | Contratti Cerea salvati come Legnago | Chiuso | `codice_rivenditore` viene estratto dal PDA, propagato dal wizard e validato dal backend. La migration `053` ha corretto i dati storici identificabili. |
| 2 | Reinserimento perso dal backend | Chiuso | Il wizard invia `stato_inserimento` e `reinserimento_di_contratto_id`; il backend valida categoria, cliente, mese solare Europe/Rome e stato post-vendita. |
| 3 | Creazione pratica non completamente atomica | Chiuso | Workflow `bozza` → upload → `finalize`, con `rollback_upload_failure` compensativo e pulizia automatica delle bozze abbandonate. Gli eventi Call Center vengono chiusi solo dopo il completamento. |
| 4 | Identità operatore e associazioni documento fidate dal client | Chiuso | Operatore derivato dal JWT; proprietà e relazioni pratica/anagrafica/contratto verificate nelle Functions; upload e modifiche vendita passano dal backend. |
| 5 | Password operative nel frontend | Chiuso | Password fisse eliminate. Le operazioni sensibili Rimborsi e Apri/Chiudi sono disponibili solo agli admin e verificate nuovamente lato server; il vecchio helper `Auth.riautentica` è stato rimosso. |
| 6 | Consenso riutilizzato 48 mesi e testo privacy incoerente | Chiuso tecnicamente | Durata uniformata a 24 mesi in PDF, backend e migration `055`; moduli cartaceo e OTP separati, scelta marketing obbligatoria e visibile, versioni correnti v6. |
| 7 | Upload diretti dal browser a Supabase Storage | Chiuso | Tutti gli upload operativi passano da Netlify Functions autenticate. La migration `054` ha revocato le policy di scrittura browser residue. |
| 8 | Prenotazione pubblica soggetta a doppio slot | Chiuso | Controllo e inserimento sono riuniti nella RPC atomica `public_prenota_appuntamento_v1`, protetta da lock transazionale. |
| 9 | Rate limit pubblico solo in memoria | Chiuso | Contatori persistenti nel database, applicati dalla Function pubblica e ripuliti dal cron operativo. |
| 10 | HTML dinamico e rischio XSS senza audit | Chiuso | Audit completato, helper condiviso `MiroxSafe`, dati/URL/ID/colori validati, ultimi output legacy di Segnalazioni uniformati e regressioni automatiche. |
| 11 | Header di sicurezza incompleti | Chiuso | Netlify invia CSP, HSTS, Permissions-Policy e le direttive di isolamento documentate in `netlify.toml`. |
| 12 | CDN non fissate o senza SRI | Chiuso | Versioni esatte e SRI SHA384 con `crossorigin="anonymous"` su tutte le pagine; dipendenze npm aggiornate e controllate. |

## Verifiche permanenti

La suite automatica controlla, tra le altre cose:

- propagazione rivenditore e reinserimento;
- workflow finalize/rollback e protezioni JWT/admin;
- assenza di password operative e di upload Storage browser;
- prenotazione atomica, rate limit persistente e durata privacy di 24 mesi;
- PDF privacy cartaceo a una pagina e digitale OTP;
- caricamento di `MiroxSafe`, SRI delle CDN e header Netlify;
- creazione anagrafica Call Center tramite RPC idempotente.

## Elementi non classificati come difetti aperti

- **CSP senza `unsafe-inline`**: richiede la migrazione di tutti gli script, handler e stili inline in asset separati. È una modernizzazione architetturale futura; l'audit XSS e la protezione degli output dinamici sono conclusi.
- **Uniformazione completa `Utils.*` → `MiroxUI.*` nel Call Center**: refactor di coerenza interna, senza blocco funzionale o falla nota.
- **Validazione legale esterna dell'informativa e dei rapporti con i fornitori**: il comportamento tecnico è coerente con 24 mesi e con il testo approvato dall'utente, ma una garanzia di conformità legale richiede il professionista privacy del Titolare.

Questi tre elementi possono essere pianificati come nuove attività autonome; non impediscono di considerare chiuso il pacchetto correttivo originario.
