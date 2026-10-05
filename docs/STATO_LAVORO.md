# Stato del lavoro — Mirox CRM

Aggiornato: 2026-10-05. Promemoria di ripresa, non autorizza interventi o deploy;
istruzioni dell'utente e guide di progetto restano vincolanti.

## Guardian: distribuito production il 05/10/2026

- 104 messaggi settembre:80 analisi fallite (8casi x10retry)+5scansioni. Chiave
  GitHub invalid_api_key nel run campione; job verde mascherava il guasto.
- Chiave GitHub sostituita con consenso specifico13:23:38; health reale ha trovato
  anche chiave chat Netlify rifiutata. Secondo consenso specifico ottenuto,
  OPENAI_API_KEY production sostituita16:18:50, secret/contesti preservati.
- Funzioni/pagine commit f9ec4de su main, deploy ready16:09:42 e ridistribuzione
  con nuova chiave16:20:49. Health finale16:21:36: chat OpenAI/bot/webhook/memoria
  OK,0updatependenti. Run37322760353 attempt2. Nessun blocco residuo auto-review.
- Analisi Codex reale KG18 completata16:17:28, run37323380962; preflight/Codex/
  callback riusciti e DB completata senza errore. Conferma fix Comodato corrente.
- Chat libera senza ticket/anche archiviato, memoria30messaggi, contesto tecnico,
  paragrafi e collegamento KG/risposta a notifica. Nessun dialogo generale crea ticket.
- Stop retry automatici sullo stesso segnale/release, claim condizionali cron/
  outbox, notifica scansioni senza segnale, preflight/URL worker/model da DB,
  workflow fallito visibile; risultato tardivo non riapre un caso archiviato.
- Il proprietario esclude definitivamente vecchio staging Guardian e autorizza
  sviluppo/collaudo/deploy su produzione. Vincolo rimosso da AGENTS e guide.
  Patch da main, branch codex/kg-*, test locali, PR verso main; tipo storico
  test_staging conservato solo per compatibilita' DB. Nessun CC riutilizzato.
- Migration database/20261005110504_guardian_owner_conversation.sql applicata
  e verificata production: JSONB NOT NULL default[], RLS/grant invariati.
- Fix CRM: Ticket apostrofi, Comodato APPS_SCRIPT_URL dismesso, Apri/Chiudi SIM No.
  OTP500/504 e network_error vendita-config restano da diagnosticare con log.
- 148/148 test+build,6workflow YAML/25blocchi Bash validi, diffcheck pulito;
  HTTP200 su pagine corrette, health senzaHMAC401. Vocali reali/flussi CRM non
  esercitati automaticamente sul DB operativo. Netlify/GitHub gia' OpenAI.
- Guide/report/promemoria aggiornati; worktree guardian-affidabilita-chat attaccato
  alla chat. Report docs/GUARDIAN_DIAGNOSI_2026-10-05.md presente anche su main.
  Backup preesistente preservato, non incluso nei push Guardian; stash recuperabile.

## Backup: stato precedente conservato

Aruba attivo: VPS IT1 O2A4 (6,29 EUR/mese + IVA), Storage R1-IT, versioni/Compliance/
AES-GCM, backup orario minuto17 UTC; checkpoint completo 03:17 dopo cleanup CRM.
- Restore off-site 100 tabelle/51.252 righe COPY identiche, 6.584 file verificati.
  PDF sorgente404 recuperato da duplicato checksum/size, originale invariato.
- Healthchecks1h/grace1h/email e assenza ping collaudati; chiave AES separata.
  Audit06:47UTC enabled: restore trimestrale100 tabelle/51.313 righe COPY identiche,
  18,5s; skip secondo run. Lifecycle reale ancora da osservare. Docker off.
- Netlify20/28 valori privati cifrati/readback; 7 altri Secret senza copie; chiave OpenAI
  nuova recuperabile localmente, off-site configurazioni precedente da riallineare. Auth13 template/7pagine e DNS19 record
  salvati; inventari statici. Repo pubblico e working tree cifrati off-site.
- Runner8worker, verify-full/CA, LoadCredential root0440/read-only, SSH/UFW;
  kernel6.8.0-146, resize legacy disabilitato su root gia' espanso.
- TAR indipendente11:46:6.585 file/1.156.382.720byte, SHA256/AES verificati offline;
  .backup-private/offline/, custodia fisica su supporto scollegato da confermare.
- Utente ha rinviato nuovo Supabase/collaudo completo fino a rimozione CC test:
  non creare/rimuovere senza nuova decisione. Budget10-15EUR+IVA.
- Main9b06c8b, precedenti68 test Python e128 npm; backup locale non committato,
  ed.hup/output/tmp preesistenti invariati. Dettagli: docs/BACKUP_RIPRISTINO.md.
- Call Director kona-call-director/5ce82af non integrato; precedente313/313.

## Punti aperti dalla ricognizione precedente

- KPI read-only04/10, PNG finale aggiornato05/10, dati fino04/10: Mobile Tied
  giugno-settembre15/9,24/6,32/7,20/3 (91/25); CB Cambio Piano TIED74, Telefono
  Incluso616 (1Business), device true VAR/Finanziamento, escluse3 senza device.
- Fissi Attivo per attivazione giugno-settembre37,35,32,36 (140). CF normalizzato:
  SIM interna dallo stesso giorno in poi2,6,9,8 (25); altre SIM20,14,9,8 (51),
  finestra inserimento fisso-5mesi → fine mese successivo, esclusa interna,
  EXISTS/COUNT DISTINCT,2sovrapposti. Settembre25finestre ancora aperte.
- Residuo66 (16,15,14,21):5Mobile fuori criterio,61nessun recordMobile. Titolo
  scelto utente «Gia' Clienti W3 Mobile» per tutto il residuo, non derivato dal DB.
  SIM usano data_contratto; storicoMobile da gennaio2026. Luglio1IMEI/VAR flag
  devicefalse escluso da chiarire; nessuna modifica DB/app/deploy per questi KPI.
- Call Director079gia' applicata staging: chiusura vendita→CC richiede verifica
  autorizzazioni/relazioni/stato/nonpresentati; mancano tabelle vendita staging.
  Comuni prima vuota, geografica da verificare; main da allineare,072 collide.
  Flusso completo/doc da verificare; non integrare senza nuova autorizzazione.
- Permessi granulari Vendita/Post-Vendita/UI revoca privacy: limitazioni note,
  nessuna nuova richiesta. Dettagli: docs/KONA_CALL_DIRECTOR.md del relativo branch.

## Riferimenti e vincoli

- Guide: AGENTS, README, database/README (non rappresenta da solo il DB vivo).
- Produzione CRM: `mirox-crm.it`, alias `mirox-crm.netlify.app`; repo CC storico ignoto.
- Guardian unico ambiente production; Call Director test separato.
- Push solo su richiesta esplicita; ogni push su `main` avvia il deploy production.
- Modifiche alle tabelle CC condivise richiedono conferma preventiva e devono
  rispettare i confini documentati in `AGENTS.md`.

Controllo runtime privato: guardian-healthcheck.yml verifica OpenAI/Telegram e
memoria dal worker Netlify, con HMAC; nessun messaggio Telegram o dato CRM AI.
