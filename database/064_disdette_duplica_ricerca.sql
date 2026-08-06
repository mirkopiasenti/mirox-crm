-- Migration 064
-- Estende lo storico del Compilatore disdette con numero cessato e snapshot
-- protetto dei dati validati, necessario per la duplicazione SIM/Fisso.
--
-- La tabella resta server-only: nessun dato dello snapshot e' accessibile
-- direttamente dal browser. Le anagrafiche CRM vengono soltanto lette dalla
-- Netlify Function autenticata e non subiscono modifiche di schema o contenuto.

BEGIN;

ALTER TABLE public.disdette_generate
  ADD COLUMN IF NOT EXISTS utenza text,
  ADD COLUMN IF NOT EXISTS dati_compilazione jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'disdette_generate_utenza_formato'
      AND conrelid = 'public.disdette_generate'::regclass
  ) THEN
    ALTER TABLE public.disdette_generate
      ADD CONSTRAINT disdette_generate_utenza_formato CHECK (
        utenza IS NULL OR (char_length(utenza) BETWEEN 5 AND 30)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'disdette_generate_dati_compilazione_oggetto'
      AND conrelid = 'public.disdette_generate'::regclass
  ) THEN
    ALTER TABLE public.disdette_generate
      ADD CONSTRAINT disdette_generate_dati_compilazione_oggetto CHECK (
        dati_compilazione IS NULL OR jsonb_typeof(dati_compilazione) = 'object'
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_disdette_generate_utenza
  ON public.disdette_generate(utenza)
  WHERE utenza IS NOT NULL;

COMMENT ON COLUMN public.disdette_generate.utenza IS
  'Numero della linea oggetto del recesso, mostrato nello storico.';
COMMENT ON COLUMN public.disdette_generate.dati_compilazione IS
  'Snapshot server-only dei dati validati usato per duplicare la disdetta nello stesso cluster cliente.';

COMMIT;
