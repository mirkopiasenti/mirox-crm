BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.vendita_contratti
  DROP CONSTRAINT vendita_codice_pda_formato,
  ADD CONSTRAINT vendita_codice_pda_formato CHECK (
    codice_contratto IS NULL OR (
      codice_contratto COLLATE "C" ~ '^[A-Z0-9._/+#@&*%=-]{1,80}$'
      AND codice_contratto COLLATE "C" ~ '[A-Z0-9]'
    )
  );

COMMIT;
