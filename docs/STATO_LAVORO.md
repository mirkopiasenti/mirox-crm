# Stato del lavoro — Mirox CRM

Aggiornato: 2026-10-05. Promemoria di ripresa, non autorizza interventi o deploy;
istruzioni dell'utente e guide di progetto restano vincolanti.

## Guardian: distribuito production il 05/10/2026

- 104messaggi settembre:80analisi fallite+5scan. Run campione invalid_api_key,
  workflow verde mascherava guasto; gia' OpenAI, nessun DeepSeek nel codice.
- Con consensi specifici chiave GitHub aggiornata13:23:38 e Netlify16:18:50;
  health16:21:36 OK, analisi Codex KG18 run37323380962 riuscita16:17:28.
  Secret/contesti preservati, chiave privata0600; nessun blocco auto-review residuo.
- Chat libera senza ticket/anche archiviato, memoria30messaggi, paragrafi e contesto
  tecnico. Dialogo generale non crea ticket; operazioni auditabili con pulsanti.
- Una analisi automatica per segnale/release, claim condizionali cron/outbox,
  notifica scan senza segnale, preflight/URL/modello da DB, workflow rosso su errore;
  callback tardivi non riaprono archiviati. Migration conversazione JSONB applicata.
- Proprietario esclude vecchio staging e autorizza sviluppo/collaudo/deploy prod;
  vincolo rimosso da guide. Worker patch da main/PR draft, pubblicazione con seconda conferma Telegram.
- Report docs/GUARDIAN_DIAGNOSI_2026-10-05.md; checkout guardian-affidabilita-chat
  attaccato. Lavoro backup preesistente preservato, stash recuperabile.

## Backlog settembre: distribuito e chiuso 05/10

- Commit fca1c00, deploy ready16:54:15;160/160test+build,6pagine/codice HTTP200,
  OTP/catalogo senza sessione401. Health37328685582 alle16:55:56 tuttoOK.
- KG14/15/20 Ticket,18Comodato,19SIM,10Storage544:6risolti. Retry GET catalogo,
  OTP single-flight/CAS/rilettura PDF; niente SMS/consensi reali di collaudo.
- KG9 504,12/16rete:3storici mitigati/archiviati, causa non dimostrata;
 5scan fallite archiviate senza inventare risultati.14audit,8segnali chiusi,
  zero casi settembre aperti. Nuovo commit separa eventuali ricorrenze.
- KG1–7agosto fuori scope, nessun messaggio settembre; storico conservato.
- Report docs/GUARDIAN_BUG_SETTEMBRE_2026.md; guide aggiornate, backup preservato.

## Pubblicazione finale Telegram: intervento attuale

- Richiesta esplicita proprietario: approvare il deploy da Telegram.
- Pulsante finale/OK pubblica in reply alla proposta: contratto SHA head/base/PR,
  test e owner, conferma1h, CAS/doppio clic; dispatch rilascio da main attendibile.
- Merge SHA verificato, attesa metadata online esatti e salute Guardian; esito
  persistente outbox. Guasti dopo merge lasciano caso aperto, nessun rollback.
- Nessuna migration/secret nuovo; guide e report pubblicazione aggiornati.
- Verifiche locali 178/178 test+build,6workflow YAML/24blocchi shell validi.
- Deploy/collaudo Telegram live ancora da completare in questa sessione.

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
