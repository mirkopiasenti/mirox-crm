-- Risposta esplicita dell'operatore, non attestazione della compagnia assicurativa.
-- NULL conserva lo storico e la compatibilita dei contratti non Energia.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE public.vendita_contratti
  ADD COLUMN assicurazione_impianti boolean,
  ADD CONSTRAINT vendita_assicurazione_impianti_energia CHECK (
    assicurazione_impianti IS NULL OR (categoria_snapshot = 'Energia') IS TRUE
  );
COMMENT ON COLUMN public.vendita_contratti.assicurazione_impianti IS
  'Assicurazione impianti Luce e Gas dichiarata in inserimento: true=Si, false=No, NULL=non rilevata/storico o altra categoria.';
COMMIT;
