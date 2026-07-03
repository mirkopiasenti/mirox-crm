# /database/ — Migrazioni SQL storiche

I 35 file `.sql` in questa cartella sono **migrazioni storiche parziali** applicate manualmente nel SQL Editor di Supabase (o via `.bin/supabase db query --linked --file ...`) durante lo sviluppo.

## ⚠️ NON sono lo stato attuale del DB

Lo schema reale di Supabase contiene anche modifiche fatte:
- Direttamente dalla dashboard (creazione tabelle, colonne aggiuntive, indici)
- Tramite SQL Editor senza salvare il file qui
- Cambiamenti a RLS, RPC, trigger, viste applicati a caldo

**Per lo stato attuale, NON fare affidamento su questi file.** Interrogare direttamente Supabase con query di introspezione su `information_schema` e `pg_*` (vedi anche `../CLAUDE.md`).

## Elenco file

| File | Cosa introduce |
|---|---|
| `001_create_vendita_upload_contratti.sql` | Tabelle base upload contratti vendita |
| `002_cataloghi_opzioni_reload_e_associazioni_offerta.sql` | Opzioni, reload e link N:M con offerte |
| `003_offerte_abilita_dispositivo.sql` | Flag `abilita_dispositivo` su `vendita_offerte` |
| `004_offerte_abilita_switch_sim.sql` | Flag `abilita_switch_sim` su `vendita_offerte` |
| `005_moduli_vendita_post_vendita.sql` | Tabelle moduli operativi (`vendita_apri_chiudi`, `vendita_switch_sim`, `vendita_ordini_smartphone`, `post_vendita_dispositivi_comodato`, `post_vendita_gestione_rimborsi`) |
| `006_ticket.sql` | Sistema ticket |
| `007_anagrafica_unificata.sql` | Unificazione anagrafica + RPC `cerca_o_crea_anagrafica` |
| `008_ordini_smartphone_stati.sql` | CHECK constraint stati ordine smartphone |
| `009_bucket_moduli_template.sql` | Bucket `moduli-template` + policy |
| `010_switch_sim_mail_rientro.sql` | Colonna `mail_rientro_inviata_at` per cron giornaliero |
| `011_email_centro.sql` | `email_template` + `email_log` |
| `012_contratti_extra_fields.sql` | `pod_pdr`, `numero_contratto_energia`, `prezzo_fisso`, `reload_exchange` su `vendita_contratti` |
| `013_storico_cliente_vendita_contratti.sql` | Vista `storico_cliente` |
| `014_dashboard_pezzi_giornaliera.sql` | Viste `view_vendita_dashboard_giornaliera` e `_mensile` |
| `015_anagrafica_email_e_pda_doc_rules.sql` | Aggiunge `anagrafica.email`, aggiorna RPC `cerca_o_crea_anagrafica` con `p_email`, disattiva regole `contratto` per Energia/Allarmi/Assicurazioni (refactor wizard PDA-first) |
| `016_vendita_contratti_tipo_firma.sql` | Aggiunge `vendita_contratti.tipo_firma` ('elettronica'/'cartacea'/NULL) per il nuovo step Firma del wizard |
| `017_vendita_contratti_convergenza.sql` | Aggiunge `vendita_contratti.convergenza` (text + CHECK su 7 valori) per i contratti Fisso |
| `018_post_vendita_controllo_fissi.sql` | Crea `post_vendita_controllo_fissi` (follow-up contratti Fisso) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_fissi` (popolamento automatico al cambio `stato_controllo` su contratti Fisso) + backfill di quelli gia' `controllato` |
| `019_post_vendita_controllo_lg.sql` | Aggiunge `vendita_contratti.ex_fornitore` (obbligatorio per Energia in fase di verifica). Crea `post_vendita_controllo_lg` (follow-up contratti Energia) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_lg` (popolamento automatico al cambio `stato_controllo` su contratti Energia) + backfill |
| `020_lg_csv_import_fields.sql` | Aggiunge a `post_vendita_controllo_lg` le colonne popolate dall'upload CSV WindTre: `causale_stato_pratica`, `messaggio_esito_sap`, `causa_annullamento` (solo per stato='Rifiutato'), `ultimo_csv_upload_at`, `ultimo_csv_upload_da` (audit). Niente CHECK constraint sullo stato (flessibilita' verso nuovi stati del portale). |
| `021_vendita_contratti_assicurazione_fields.sql` | Aggiunge `vendita_contratti.modalita_pagamento_assicurazione` (CHECK: RID/Carta di Credito/Carta di Debito) e `ricorrenza_assicurazione` (CHECK: Mensile/Annuale). Obbligatori solo per la categoria Assicurazioni nel wizard. |
| `022_post_vendita_controllo_assicurazioni.sql` | Crea `post_vendita_controllo_assicurazioni` (follow-up contratti Assicurazioni) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_assicurazioni` (popolamento automatico al cambio `stato_controllo` su contratti Assicurazioni) + backfill. Tabella minimal (nessuno stato). |
| `023_post_vendita_controllo_allarmi.sql` | Crea `post_vendita_controllo_allarmi` (follow-up contratti Allarmi) + RLS + trigger `touch_updated_at` + trigger `trg_vendita_contratti_to_controllo_allarmi` (popolamento automatico al cambio `stato_controllo` su contratti Allarmi) + backfill. Tabella minimal. |
| `024_storico_cliente_extend_call_center.sql` | Estende la vista `storico_cliente` con 4 UNION nuove (`chiamata_cc`, `chiamata_cc_outbound`, `appuntamento_cc`, `blacklist`). Il modulo `storico_cliente.html` mostra ora anche chiamate, appuntamenti e blacklist del CC. Vedi "Viste" in `../CLAUDE.md`. |
| `025_chiamate_appuntamenti_anagrafica_autolink.sql` | Trigger `BEFORE INSERT` su `chiamate` e `appuntamenti` per auto-popolare `anagrafica_id` via lookup CF/PIVA. Backfill di 872 chiamate + 9 appuntamenti orfani (ora 100% chiamate / 99.2% appuntamenti collegati). Il CC prod continua a INSERT con `anagrafica_id=NULL`, il trigger lo riempie. |
| `026_vendita_deriva_origine_rpc.sql` | RPC `vendita_deriva_origine(p_anagrafica_id uuid) RETURNS jsonb`. Versione iniziale, priorità: appuntamento confermato oggi → chiamata `passa_in_negozio` ultimi 10gg → default `spontaneo`. Usata dal wizard upload-contratti per pre-compilare `origine_pratica`. |
| `027_vendita_deriva_origine_rilassata_e_autochiusura_cc.sql` | Rilassa `vendita_deriva_origine`: livello 1 copre anche appuntamenti futuri fino a 30 gg, livello 2 include chiamate con `passaggio_stato='in_attesa'`. Aggiunge trigger `trg_vendita_pratica_auto_chiudi_cc` (poi rimosso in 028) e RPC `vendita_chiudi_eventi_cc_per_pratica`. |
| `028_fix_autochiusura_post_commit_e_indici.sql` | DROP del trigger `trg_vendita_pratica_auto_chiudi_cc` (scattava troppo presto, lasciava eventi orfani su rollback). La logica passa nel backend `crea-vendita-pratica-carrello.js` come ultimo step. Introduce indici performance su `appuntamenti`, `chiamate` per la RPC di derivazione. |
| `029_storage_buckets_private_signed_urls.sql` | Rende **privati** 7 bucket dati cliente (`contratti-vendita`, `segnalazioni-files`, `apri-chiudi-files`, `switch-sim-files`, `comodato-files`, `rimborsi-files`, `protecta-files`). Lettura solo via signed URL con `MiroxStorage.signedUrl`. Le colonne `cartella_url` / `preventivo_pdf_url` ora contengono il path nel bucket, non URL pubblici. Vedi "Storage buckets" in `../CLAUDE.md`. |
| `030_rls_segnalazioni_authenticated.sql` | Chiude la tabella `segnalazioni` a `authenticated` (prima anon). Rilassata temporaneamente dalla 032 per il konahub legacy, poi ripristinata dalla 036 (2026-07-02) contestualmente al refactor della pagina segnalazioni. |
| `031_rls_cc_shared_close_anon.sql` | Chiude a `authenticated` le tabelle condivise col CC (`appuntamenti`, `slot_bloccati`, `blocchi`, `orari_standard`, `impostazioni`). Il form pubblico `prenota.html` passa ora per la Netlify function `public-prenota.js` con service_role + rate-limiting. |
| `032_storage_segnalazioni_anon_konahub.sql` | (Storico) Riapre `anon` SELECT + INSERT + UPDATE sulla tabella `segnalazioni` e SELECT + INSERT sul bucket `segnalazioni-files` per il konahub legacy e per la vecchia versione anon di `moduli/segnalazioni.html`. **Revocata dalla 036 il 2026-07-02** (konahub dismesso + pagina modernizzata a auth Mirox). File lasciato in cartella per traccia storica. |
| `033_reinserimenti_contratti.sql` | Anti-doppio-conteggio dashboard mensile. Aggiunge `vendita_contratti.stato_inserimento` (`'inserimento'`/`'reinserimento'`, default `'inserimento'`) + FK auto-referenziale `reinserimento_di_contratto_id` con CHECK di coerenza. Aggiunge `stato` a `post_vendita_controllo_assicurazioni` (NULL/`OK`/`KO`) e `post_vendita_controllo_allarmi` (NOT NULL `In Attivazione`/`OK`/`KO`, default `In Attivazione`) + colonne audit (`stato_cambiato_at`, `stato_cambiato_da`). 2 indici: lookup `(anagrafica_id, categoria_id, data_contratto DESC)` e drill-down inverso su `reinserimento_di_contratto_id`. Vedi sezione "Reinserimento contratti" in `../CLAUDE.md`. |
| `034_consensi_privacy_otp_cartaceo.sql` | Sistema consensi privacy GDPR. Crea tabella `vendita_consensi_privacy` (modalita' `otp_sms`/`cartaceo`, stato `pending`/`confermato`/`scaduto`/`fallito`/`revocato`, OTP hash+salt, scadenza 48 mesi, snapshot anagrafica jsonb, audit IP/UA) con CHECK + indici dedupe e cleanup + trigger `touch_updated_at` + RLS authenticated SELECT. Crea bucket privato `consensi-privacy` (PDF only, 20 MB) con policy SELECT authenticated. Vedi sezione "Sistema consensi privacy GDPR" in `../CLAUDE.md`. |
| `035_reload_forever_smartphone_reload.sql` | Aggiunge a `vendita_contratti` due bool `reload_exchange` + `reload_forever` (Mobile/Customer Base) e `smartphone_reload` + `smartphone_reload_modalita` (dispositivo associato). CHECK di coerenza `modalita NOT NULL ⇔ smartphone_reload IS TRUE`. Il catalogo `vendita_reload` è dismesso ma tabella/FK conservate per dati storici. Vedi "Note operative consapevoli" in `../CLAUDE.md`. |
| `036_segnalazioni_revoke_konahub_anon.sql` | Revoca le 5 policy `anon` introdotte dalla 032 (SELECT/INSERT/UPDATE su `segnalazioni` + SELECT/INSERT su bucket `segnalazioni-files`). Contestuale al refactor di `moduli/segnalazioni.html` che ora usa `js/config.js` + `Auth.richiediAuth`: tutte le chiamate viaggiano come `authenticated`. Il modulo funziona SOLO da Mirox loggato. Vedi sezione "Storage buckets" in `../CLAUDE.md`. |

## Linee guida

- **Non aggiungere nuove migrazioni** senza coordinarle con l'utente
- Per nuove modifiche schema: applicare via SQL Editor Supabase E aggiungere il file qui con prefisso numerico progressivo (`015_`, `016_`, ...)
- Le **RLS policies**, **RPC** e **trigger** possono evolvere senza file associato qui: per uno snapshot affidabile esportare via dashboard Supabase o via query di introspezione
- Quando si aggiunge un nuovo file `.sql` in questa cartella, **aggiornare contestualmente la tabella "Elenco file"** sopra (regola di manutenzione documentale — vedi sezione "Manutenzione di questa guida" in `../CLAUDE.md`)

## Aggiornamenti senza migrazione

- **2026-07-02**: modifiche solo frontend/mailer, nessun cambio schema Supabase. Aggiornati layout `dashboard_pezzi` con larghezza tabella fissata a 622px (270px offerte + 4 colonne operatori da 88px), redirect post-invio e validazione cluster `Turista` di `upload-contratti-vendita` (indirizzo nascosto/non richiesto, opzione contratto non richiesta), favicon mancanti e link CTA delle email di comunicazione verso `https://www.mirox-crm.it`.
- **2026-07-02**: aggiunta cancellazione definitiva da Verifica Contratti senza nuova migration. La function admin-only `elimina-vendita-contratto` usa le FK/cascade gia' presenti (`vendita_documenti` e tabelle post-vendita su `vendita_contratti`) e rimuove gli allegati Storage; se la pratica resta senza contratti elimina anche `vendita_pratiche`. L'anagrafica non viene cancellata.
- **2026-07-03**: modifica solo frontend, nessun cambio schema Supabase. `js/mirox-upload.js` ora mostra anteprima PDF prima di mantenere file selezionati o trascinati nei moduli Upload Contratti, Switch SIM, Apri/Chiudi, Verifica Contratti, Segnalazioni e Dispositivo Comodato.
- **2026-07-03**: modifica solo frontend, nessun cambio schema Supabase. `moduli/verifica_contratti.html` aggiunge filtro per giorno specifico nelle tab Da Verificare e Verificati, calcolato su `vendita_contratti.data_contratto`.
- **2026-07-03**: modifica solo frontend, nessun cambio schema Supabase. `moduli/verifica_contratti.html` mostra e salva `vendita_contratti.convergenza` nel popup dettaglio dei contratti Fisso, usando la colonna gia' introdotta dalla migration 017.
- **2026-07-03**: modifica solo backend, nessun cambio schema Supabase. Per cluster vendita `Turista`, `garantisci-anagrafica` e `crea-vendita-pratica-carrello` salvano `anagrafica.cluster='Consumer'` e mantengono `vendita_contratti.cluster_cliente='Turista'`, evitando modifiche al CHECK della tabella condivisa `anagrafica`.
- **2026-07-03**: modifica frontend/backend, nessun cambio schema Supabase. Per cluster vendita `Turista`, `upload-contratti-vendita` nasconde/invia `email=null` e le functions `garantisci-anagrafica` / `crea-vendita-pratica-carrello` non richiedono email; per `Consumer`/`Business` resta obbligatoria.
