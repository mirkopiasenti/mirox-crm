# Stato del lavoro — Mirox CRM

Aggiornato: 2026-10-05. Promemoria di ripresa, non autorizza interventi o deploy;
istruzioni dell'utente e guide di progetto restano vincolanti.

## Guardian: intervento 05/10/2026

- Analizzati 104 messaggi settembre e DB production read-only: 80 analisi fallite
  (8 casi x 10 retry) + 5 scansioni fallite. Run campione: HTTP401 invalid_api_key;
  GitHub verde mascherava il guasto. Guardian gia' OpenAI, nessun DeepSeek.
- Secret GitHub OPENAI_API_KEY_CODEX_WORKER sostituito con autorizzazione esplicita;
  metadata 13:23:38 Europe/Rome. Chiave verificata con Responses sintetica HTTP200.
  File privato ignorato 0600; nessuna chiave stampata. Netlify env non modificate.
- Codice preparato su branch locale codex/guardian-affidabilita-chat nel worktree
  /Users/mirkopiasenti/.codex/worktrees/guardian-affidabilita-chat/Mirox CRM.
  Chat proprietario libera senza ticket/anche archiviato, memoria 30 messaggi,
  contesto tecnico, paragrafi, collegamento KG/risposta a notifica.
- Stop retry automatici stesso segnale/release, claim cron/outbox condizionali,
  notifica scansioni anche senza segnale, preflight OpenAI/URL worker per ambiente,
  modello da DB e workflow negativo visibile. Risultato tardivo non riapre archivio.
- Fix CRM riprodotti: Ticket nome con apostrofi, Comodato riferimento Apps Script
  dismesso, Apri/Chiudi SIM No su elemento DOM assente. OTP500/504 e network_error
  vendita-config restano da diagnosticare con log/riproduzione.
- 145/145 test Node + build, YAML/Bash workflow validi, diff-check pulito;
  due prove reali conversazione su contesto sintetico riuscite, nessun dato CRM.
- Migration additiva database/20261005110504_guardian_owner_conversation.sql pronta
  NON applicata. Nessun push/deploy; codice non attivo sul bot ufficiale.
- Staging documentato blwgxrszvsoqcmcmhhqr indisponibile/accesso negato; pannello
  non lo elenca e GitHub guardian-staging manca. Owner deve decidere ambiente
  isolato prima del collaudo; non creare/riutilizzare Call Director in autonomia.
- README/AGENTS/CLAUDE/database README/setup/report aggiornati nel worktree.
  Report completo: docs/GUARDIAN_DIAGNOSI_2026-10-05.md nel worktree.
  Modifiche backup preesistenti nel checkout main conservate.

## Backup: stato precedente conservato

Aruba attivo: VPS IT1 O2A4 (6,29 EUR/mese + IVA), Storage R1-IT, versioni/Compliance/
AES-GCM, backup orario minuto17 UTC; checkpoint completo 03:17 dopo cleanup CRM.
- Restore off-site 100 tabelle/51.252 righe COPY identiche, 6.584 file verificati.
  PDF sorgente404 recuperato da duplicato checksum/size, originale invariato.
- Healthchecks1h/grace1h/email e assenza ping collaudati; chiave AES separata.
  Audit06:47UTC enabled: restore trimestrale100 tabelle/51.313 righe COPY identiche,
  18,5s; skip secondo run. Lifecycle reale ancora da osservare. Docker off.
- Netlify20/28 valori privati cifrati/readback; 8 Secret write-only mancanti, nessuna
  riemissione salvo chiave Guardian sopra. Auth13 template/7pagine e DNS19 record
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
- Call Director test separato; staging Guardian da ripristinare, non presumere attivo.
- Push solo su richiesta esplicita; ogni push su `main` avvia il deploy production.
- Modifiche alle tabelle CC condivise richiedono conferma preventiva e devono
  rispettare i confini documentati in `AGENTS.md`.
