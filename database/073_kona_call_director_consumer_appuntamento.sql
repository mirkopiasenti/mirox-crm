-- Migration 073 — additiva per KONA Call Director (Consumer "Appuntamento").
--
-- Estende il CHECK sugli esiti della sessione Consumer con il valore
-- 'appuntamento': l'operatrice, dentro KONA, prenota un appuntamento nel
-- calendario del negozio (flusso Call Center esistente) e KONA registra
-- l'esito nella sessione.
--
-- Additiva e reversibile: rilassa soltanto un CHECK su una tabella server-only,
-- nessun DROP di colonne, nessun dato toccato. Applicabile SOLO allo staging
-- dopo approvazione; NON applicare a production in questa fase.

BEGIN;

ALTER TABLE public.kona_call_director_sessione_attivita
  DROP CONSTRAINT IF EXISTS kona_call_director_sessione_attivita_esito_check;

ALTER TABLE public.kona_call_director_sessione_attivita
  ADD CONSTRAINT kona_call_director_sessione_attivita_esito_check
  CHECK (esito IN (
    'chiamata',
    'non_risposto',
    'non_interessato',
    'passa_in_negozio',
    'interessato',
    'altro',
    'appuntamento'
  ));

COMMIT;
