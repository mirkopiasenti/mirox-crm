# Permessi pagine Mirox

Rilascio 27/10/2026, autorizzato dal proprietario. Migration applicata e
verificata in produzione con versione `20261027224328` (sorgente CLI
`20261027221833_permessi_pagine_mirox.sql`). Tutti i 7 account presenti
conservano inizialmente le 19 pagine abilitate; nessun accesso ristretto.
Ultima verifica: build e 453/453 test Node locali (uno Backup preesistente),
13 regressioni ACL, 542 verifiche SQL isolate e `git diff --check` riusciti.
Snapshot di rilascio separato dai WIP:452/452 test versionabili riusciti.
Verifica production:84policy restrittive,3nuove tabelleRLS,0audit iniziali,
RPC service-only e audit senza privilegi UPDATE/DELETE del backend.
Hash profili/permessiCC/colonne/RLS/trigger condivisi e RPC esistenti invariati.
Advisor sicurezza/performance7->7, nessun nuovo rilievo. Prove READONLY/ROLLBACK:
operatore attivo vede la propria ACL e lo storico; identita senza ACL non
legge contratti, storico, ticket o allegati. Nessuna riga cliente modificata.

## Utilizzo

Admin → Configurazioni → Permessi pagine. Scegliere un utente, abilitare le
pagine per gruppo e salvare dopo il riepilogo. Copia da un altro operatore
modifica soltanto la bozza: occorre salvare per applicarla. Annulla modifiche
ripristina l'ultima configurazione caricata. Un conflitto con un altro admin
richiede Ricarica e una nuova scelta; non sovrascrive il salvataggio precedente.
Lo storico mostra gli ultimi 30 salvataggi con autore, data Europe/Rome e
pagine abilitate/disabilitate. Il seed iniziale non e' un intervento manuale.

19 pagine: 6 Vendita, 11 Post-Vendita (Ticket incluso), 2 Applicazioni.
KONA AI Guardian resta disponibile a tutti gli account attivi. Dashboard home
e logout rimangono raggiungibili senza assegnazioni. Il Call Center conserva
chiavi, UI e autorizzazioni preesistenti in `profili.pagine_accessibili`.

Gli admin attivi hanno sempre accesso completo: i loro interruttori non sono
modificabili. Per gli operatori occorre un booleano `true` esplicito. Le ACL
appartengono all'account di accesso, non al suo alias commerciale. Un account
disabilitato non ottiene accesso anche se conserva assegnazioni. Le restrizioni
admin-only gia presenti per singole operazioni rimangono applicate.

## Regole e dipendenze

- I link non consentiti vengono nascosti prima di mostrare la pagina. Un
  reparto senza card visibili scompare; Applicazioni si nasconde se vuoto.
  Link diretto negato: schermata con accesso alla dashboard.
- Il catalogo canonico browser/CommonJS e' `js/mirox-permissions-core.js`.
  Percorsi, dipendenze e chiavi devono essere aggiunti qui e nella migration
  del catalogo; un nuovo modulo assente dal catalogo e' bloccato anche tramite
  URL diretto e la verifica di completezza fallisce. Nessun fallback permissivo.
- `Auth.richiediAuth()` carica profilo e ACL; errore di lettura bloccante.
  Aggiornamento al ritorno alla scheda (minimo 10s tra letture) e ogni 60s
  quando visibile. Non modifica i form aperti se il permesso rimane valido.
- Le API dichiarano un endpoint statico tramite wrapper di `requireAuth`.
  `_lib/page-permissions.js` rilegge ruolo, stato e ACL prima delle operazioni
  protette, anche con JWT/profilo gia in cache. Non usa Referer o header pagina.
  `upload-documento-modulo` verifica anche il bucket effettivamente richiesto.
- Il permesso di una pagina permette i dati necessari al suo funzionamento:
  Storico Cliente comprende contratti, ordini, comodati, rimborsi, Apri/Chiudi,
  Switch SIM e gli eventi CC gia inclusi. Dashboard Pezzi legge i contratti e
  gli stati post-vendita per calcolare i report. Nascondere un altro modulo
  non elimina queste letture condivise. Le scritture dirette richiedono invece
  la pagina operativa, mantenendo le restrizioni precedenti.
- Nuove policy `AS RESTRICTIVE` in AND alle esistenti, mai sostitutive, su 20
  tabelle vendita/post-vendita e 8 bucket. Non ampliano i privilegi precedenti.
  Le viste report sono invoker e vincolate al permesso Dashboard Pezzi.
  `public.storico_cliente` e' invoker; legge la vista proprietaria privata
  `mirox_private.storico_cliente_dati`, con gate su `auth.uid()` tramite helper.
  Questo conserva gli eventi CC dello storico senza alterare le loro RLS.
- I dati anagrafici e le RPC condivise col CC conservano le autorizzazioni
  precedenti. Questa funzione gestisce le pagine Mirox, non ridefinisce il
  modello di accesso del Call Center o separazioni per cliente/campo/negozio.
- Una revoca blocca le successive operazioni autorizzate lato server/DB.
  Operazioni gia iniziate possono completarsi. File gia scaricati e URL firmate
  gia emesse non sono revocabili con questo sistema: le URL scadono secondo
  il termine impostato alla generazione. La revoca impedisce nuove emissioni
  nei bucket senza altre dipendenze abilitate.

## Schema

Migration `database/20261027221833_permessi_pagine_mirox.sql`:

| Oggetto | Funzione |
|---|---|
| `mirox_pagine` | Catalogo delle 19 pagine; SELECT autenticata, scrittura service_role |
| `mirox_permessi_utente` | PK/FK utente_id, pagine JSONB, versione e updated_at; SELECT propria riga/admin |
| `mirox_permessi_audit` | Prima/dopo, autore, destinatario, versione e data; solo backend |
| `mirox_salva_permessi_pagine(...)` | RPC invoker/service-only, validazione completa, controllo admin fresco, lock versione e audit atomico |
| `mirox_private.can_pages(text[])` | Lookup interno definer con search_path vuoto e identita auth.uid; nessun utente arbitrario in input |

Nessuna colonna, RLS, trigger o RPC esistente delle tabelle CC condivise viene
modificata. La FK dei nuovi permessi riferisce `profili` senza cambiarla.
I privilegi delle tabelle nuove sono espliciti e la RLS e' abilitata.

## Attivazione

1. Su richiesta di pubblicazione, verificare che catalogo e migration siano
   quelli collaudati, e rileggere schema/policy rilevanti. Conservare snapshot
   privato dei permessi CC e conteggio profili per il confronto.
2. Applicare la migration prima del deploy compatibile. Il seed assegna tutte
   le 19 pagine agli utenti presenti in quel momento, inclusi gli account
   disabilitati (che rimangono disabilitati). Nuovi account senza riga ACL non
   accedono ad alcuna pagina di questi tre gruppi.
3. Rileggere oggetti, policy restrittive, righe seed, privilegi e advisor;
   confrontare le tabelle/RLS/RPC condivise, che devono essere invariate.
4. Pubblicare soltanto su push esplicitamente richiesto dal proprietario;
   verificare CI e asset online. Non restringere utenti reali prima che le
   pagine compatibili siano pubblicate. Poi configurare gli operatori da Admin.
5. Collaudo UI a cura del proprietario: menu filtrati, URL diretto negato,
   copia/annullamento, conflitto e revoca con scheda aperta. L'assistente non
   usa il browser per questo progetto secondo la preferenza del 27/10.

I client precedenti possono ancora mostrare link dopo una revoca, ma RLS e API
proteggono i dati; ricaricare per ottenere la navigazione aggiornata. Un rollback
del solo frontend non rimuove le restrizioni DB o le ACL: mantenere utenti
abilitati se serve ripristinare temporaneamente gli accessi.

## Verifiche locali

- `npm test`: build, sintassi/link e suite completa, comprese regressioni ACL.
- `tests/permessi-pagine.test.js`: catalogo, endpoint, revoca con JWT in cache,
  ruoli, bucket multipart, autore server, conflitto e aggiornamento sessione.
- `scripts/verifica-permessi-pagine-sql.js` con PGlite gia disponibile tramite
  `MIROX_PGLITE_MODULE`: PostgreSQL isolato, seed/nuovo utente, revoche su tutte
  le risorse, matrice di ogni singola pagina, viste/CC/Storage, ruolo admin,
  input e audit/versioni. Nessuna
  dipendenza runtime aggiunta al CRM.

Questi controlli non sostituiscono un collaudo grafico o la verifica delle RLS
sul servizio dopo l'applicazione della migration.
