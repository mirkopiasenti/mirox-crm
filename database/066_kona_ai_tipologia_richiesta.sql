-- Migration 066
-- Distingue i problemi dalle proposte di miglioria nel flusso KONA AI Guardian.
--
-- Additiva e isolata dalle tabelle CRM/Call Center condivise. Le richieste gia'
-- presenti vengono classificate come problema tramite il DEFAULT.

BEGIN;

ALTER TABLE public.kona_ai_incidenti
  ADD COLUMN IF NOT EXISTS tipo_richiesta text NOT NULL DEFAULT 'problema';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'kona_ai_incidenti_tipo_richiesta_check'
      AND conrelid = 'public.kona_ai_incidenti'::regclass
  ) THEN
    ALTER TABLE public.kona_ai_incidenti
      ADD CONSTRAINT kona_ai_incidenti_tipo_richiesta_check
      CHECK (tipo_richiesta IN ('problema', 'miglioria'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_kona_ai_incidenti_tipo_stato_updated
  ON public.kona_ai_incidenti(tipo_richiesta, stato, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kona_ai_approvazioni_prepara_fix_attiva
  ON public.kona_ai_approvazioni(incidente_id)
  WHERE azione = 'prepara_fix' AND stato IN ('approvata', 'eseguita');

COMMENT ON COLUMN public.kona_ai_incidenti.tipo_richiesta IS
  'Tipo funzionale scelto dall''utente: problema tecnico oppure proposta di miglioria.';

COMMIT;
