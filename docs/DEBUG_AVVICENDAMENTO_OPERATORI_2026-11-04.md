# Avvicendamento operatori: decorrenza novembre 2026

## Difetto e risultato richiesto

Il rilascio del 02/11 (`b1f97c2`, documentazione `550f552`) usava gli account
attivi oggi anche quando si selezionava un mese precedente. Di conseguenza,
Vincenzo compariva a ottobre e riceveva 400 EUR dalla gara PARTITA IVA:
48 contratti Business di squadra superavano le due soglie additive di 35/45,
pari a 150 + 250 EUR, anche con produzione personale zero.
Lo screenshot del proprietario e il replay dei dati reali confermano il caso.

La decorrenza corretta e il periodo `2026-11`:

| Periodo selezionato | Operatori delle gare | Day by Day |
|---|---|---|
| Fino a ottobre 2026 incluso | Matteo, Francesca, Mirko | Matteo, Mirko, Francesca, Cerea |
| Da novembre 2026 | Matteo, Vincenzo, Mirko | Matteo, Mirko, Vincenzo, Cerea |

Francesca conserva il proprio UUID, i contratti e gli obiettivi storici.
Il suo account resta disabilitato. Vincenzo conserva il proprio account e
non e ammesso nei periodi precedenti, nemmeno ai compensi di squadra.

## Correzione

- `js/dashboard-report-core.js`: `reportProfiles` proietta i profili per
  UUID canonico e periodo; `dayOperators` restituisce le colonne per la data
  richiesta. Nessuna deduzione dal nome, da oggi o da `created_at`.
- `valutaGara` controlla il periodo richiesto (oppure il mese dell'obiettivo
  quando disponibile), nega il compenso a un destinatario fuori periodo e
  conserva le regole mensili e gli scaglioni esistenti.
- Dashboard: legge anche il profilo cessato, applica la proiezione al mese
  selezionato e usa la data giornaliera per il Day. Gare, Avanzamento,
  Netto L&G e nodi catturati nei PNG seguono lo stesso periodo.
- Target: passa la data richiesta al Day e proietta gli operatori del mese
  richiesto, conservando gli altri criteri del report e del Call Center.
- Admin Gare: impostazioni account correnti separate dalla scelta operatore
  del mese. Ripristina Francesca nell'editor storico e Vincenzo da novembre;
  nega salvataggi e copie di obiettivi con destinatari fuori periodo.
  La copia del mese precedente non trasferisce obiettivi fra persone diverse.
- Caricamenti Dashboard atomici: richieste e periodo catturati prima delle
  letture, risposte superate scartate, mappe Day e Mensile distinte. Anche
  Admin scarta gli obiettivi tardivi del mese non piu selezionato.

## Verifiche

- 11 regressioni sostituiscono il precedente test che assumeva erroneamente
  Vincenzo anche a ottobre: gennaio/luglio/settembre/ottobre/novembre/dicembre
  2026 e gennaio 2027; confine 31/10–01/11; UUID distinti; sorgenti immutabili;
  bonus di squadra 400 EUR; Admin/copia; risposte di rete completate in ordine
  inverso e ritorno a ottobre dopo novembre. Eseguono loader e renderer reali
  delle tre schede, contenuti/nomi PNG e builder Target su fixture sintetiche.
- Replay locale da letture SQL: 322 contratti di ottobre/novembre e FTTC utili,
  soli campi necessari ai report, senza anagrafica o documenti cliente.
  Riprodotti i 400 EUR erronei con il codice `550f552`; dopo la correzione
  Vincenzo non compare a ottobre e il guard ne restituisce compenso zero.
- Confronto con il codice pre-avvicendamento `f4f96f9`, proiettando soltanto
  per la prova i vecchi flag account: tutte le gare/compensi e le righe di
  avanzamento ottobre sono identiche. Day del 1/15/31 ottobre identico;
  totali mensili Target coerenti. Nessuna pratica o messaggio di prova inviato.
- Dati di replay, harness ed esito solo in
  `.backup-private/avvicendamento-periodi-20261104/`, ignorata da Git.

Nessuna migration, modifica schema/RLS/RPC/Auth/ACL, scrittura DB, nuovo
obiettivo o riattivazione dell'account Francesca. Nessun browser usato.
Suite e pubblicazione finali sono registrate in `docs/STATO_LAVORO.md`.
