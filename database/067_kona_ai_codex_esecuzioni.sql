-- Migration 067
-- Registro server-only delle esecuzioni Guardian/Codex.
--
-- La tabella contiene soltanto il contratto operativo e l'audit del worker:
-- non concede accesso diretto al browser, non contiene segreti e non abilita
-- da sola alcuna modifica del repository o del database di produzione.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kona_ai_esecuzioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incidente_id uuid NOT NULL REFERENCES public.kona_ai_incidenti(id) ON DELETE CASCADE,
  approvazione_id uuid REFERENCES public.kona_ai_approvazioni(id) ON DELETE SET NULL,
  tipo_esecuzione text NOT NULL CHECK (
    tipo_esecuzione IN ('analisi_codex', 'prepara_patch', 'test_staging', 'rilascio_produzione')
  ),
  stato text NOT NULL DEFAULT 'in_coda' CHECK (
    stato IN ('in_coda', 'in_esecuzione', 'completata', 'fallita', 'annullata', 'scaduta')
  ),
  esecutore text NOT NULL DEFAULT 'codex' CHECK (
    esecutore IN ('codex', 'sistema')
  ),
  richiesta_da text NOT NULL DEFAULT 'telegram' CHECK (
    richiesta_da IN ('telegram', 'sistema')
  ),
  modello text,
  sandbox text CHECK (
    sandbox IS NULL OR sandbox IN ('read_only', 'workspace_write')
  ),
  repository text,
  workflow_name text,
  workflow_run_id bigint,
  workflow_attempt integer CHECK (workflow_attempt IS NULL OR workflow_attempt >= 1),
  input_hash text,
  base_commit_sha text,
  result_commit_sha text,
  branch_name text,
  pull_request_url text,
  risultato jsonb NOT NULL DEFAULT '{}'::jsonb,
  codice_errore text,
  messaggio_errore text,
  lease_token_hash text,
  lease_expires_at timestamptz,
  tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi >= 0),
  avviata_at timestamptz,
  heartbeat_at timestamptz,
  completata_at timestamptz,
  timeout_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kona_ai_esecuzioni_input_hash_length CHECK (
    input_hash IS NULL OR char_length(input_hash) BETWEEN 16 AND 128
  ),
  CONSTRAINT kona_ai_esecuzioni_commit_sha_length CHECK (
    base_commit_sha IS NULL OR char_length(base_commit_sha) BETWEEN 7 AND 128
  ),
  CONSTRAINT kona_ai_esecuzioni_result_commit_sha_length CHECK (
    result_commit_sha IS NULL OR char_length(result_commit_sha) BETWEEN 7 AND 128
  ),
  CONSTRAINT kona_ai_esecuzioni_branch_length CHECK (
    branch_name IS NULL OR char_length(branch_name) BETWEEN 1 AND 255
  ),
  CONSTRAINT kona_ai_esecuzioni_error_length CHECK (
    messaggio_errore IS NULL OR char_length(messaggio_errore) <= 2000
  ),
  CONSTRAINT kona_ai_esecuzioni_lease_hash_length CHECK (
    lease_token_hash IS NULL OR char_length(lease_token_hash) = 64
  )
);

DROP TRIGGER IF EXISTS trg_kona_ai_esecuzioni_updated_at ON public.kona_ai_esecuzioni;
CREATE TRIGGER trg_kona_ai_esecuzioni_updated_at
BEFORE UPDATE ON public.kona_ai_esecuzioni
FOR EACH ROW EXECUTE FUNCTION public.kona_ai_touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_kona_ai_esecuzioni_incidente_created
  ON public.kona_ai_esecuzioni(incidente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kona_ai_esecuzioni_stato_heartbeat
  ON public.kona_ai_esecuzioni(stato, heartbeat_at NULLS FIRST, created_at);
CREATE INDEX IF NOT EXISTS idx_kona_ai_esecuzioni_workflow_run
  ON public.kona_ai_esecuzioni(workflow_run_id)
  WHERE workflow_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kona_ai_esecuzioni_lease_expires
  ON public.kona_ai_esecuzioni(lease_expires_at)
  WHERE stato = 'in_esecuzione';
CREATE UNIQUE INDEX IF NOT EXISTS idx_kona_ai_esecuzioni_one_active
  ON public.kona_ai_esecuzioni(incidente_id, tipo_esecuzione)
  WHERE stato IN ('in_coda', 'in_esecuzione');

ALTER TABLE public.kona_ai_esecuzioni ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kona_ai_esecuzioni FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.kona_ai_esecuzioni TO service_role;

COMMENT ON TABLE public.kona_ai_esecuzioni IS
  'Registro server-only delle esecuzioni Guardian/Codex, dei workflow e dei relativi esiti.';
COMMENT ON COLUMN public.kona_ai_esecuzioni.risultato IS
  'Metadati strutturati dell''esecuzione; non deve contenere segreti o token.';
COMMENT ON COLUMN public.kona_ai_esecuzioni.input_hash IS
  'Impronta del payload normalizzato usata per deduplicare retry e callback.';
COMMENT ON COLUMN public.kona_ai_esecuzioni.timeout_at IS
  'Termine oltre il quale un worker senza heartbeat puo'' essere recuperato come scaduto.';

COMMIT;
