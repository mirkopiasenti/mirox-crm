-- Estende la precedente migration: punto ammesso anche all'inizio e ripetuto.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.anagrafica_codici_cliente_windtre
  DROP CONSTRAINT anagrafica_codici_cliente_windtre_codice_cliente_check,
  ADD CONSTRAINT anagrafica_codici_cliente_windtre_codice_cliente_check
    CHECK (codice_cliente ~ '^[A-Z0-9.][A-Z0-9./-]{0,79}$' AND codice_cliente ~ '[0-9]');

COMMIT;
