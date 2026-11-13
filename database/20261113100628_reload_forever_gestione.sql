-- Scelta cliente separata dall’opzione; NULL conserva lo storico e i client precedenti.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE public.vendita_contratti
  ADD COLUMN reload_forever_gestione text,
  ADD CONSTRAINT vendita_reload_forever_gestione_coerenza CHECK (
    reload_forever_gestione IS NULL OR (
      reload_forever IS TRUE
      AND (categoria_snapshot IN ('Mobile', 'Customer Base')) IS TRUE
      AND reload_forever_gestione IN ('Mantieni attiva', 'Richiedi disattivazione')
    )
  );
COMMENT ON COLUMN public.vendita_contratti.reload_forever_gestione IS
  'Intenzione del cliente per Reload Forever. NULL=non indicata; Richiedi disattivazione non certifica una disattivazione eseguita.';
COMMIT;
