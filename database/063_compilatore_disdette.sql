-- Migration 063
-- Storico persistente e bucket privato del Compilatore disdette.
--
-- La generazione e la lettura dei PDF passano esclusivamente dalla Netlify
-- Function autenticata gestisci-disdette, che usa la service role. Nessuna
-- policy consente accesso diretto dal browser alla tabella o al bucket.

BEGIN;

CREATE TABLE IF NOT EXISTS public.disdette_generate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (
    tipo IN ('sim_consumer', 'sim_business', 'fisso_consumer', 'fisso_business')
  ),
  nome text,
  cognome text,
  codice_fiscale text,
  ragione_sociale text,
  partita_iva text,
  storage_bucket text NOT NULL DEFAULT 'disdette-files'
    CHECK (storage_bucket = 'disdette-files'),
  storage_path text NOT NULL,
  nome_file text NOT NULL,
  pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  template_versione text NOT NULL,
  created_by uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  created_by_nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disdette_generate_cliente_coerente CHECK (
    (
      tipo IN ('sim_consumer', 'fisso_consumer')
      AND nome IS NOT NULL
      AND cognome IS NOT NULL
      AND codice_fiscale ~ '^[A-Z0-9]{16}$'
      AND ragione_sociale IS NULL
      AND partita_iva IS NULL
    )
    OR
    (
      tipo IN ('sim_business', 'fisso_business')
      AND nome IS NULL
      AND cognome IS NULL
      AND codice_fiscale IS NULL
      AND ragione_sociale IS NOT NULL
      AND partita_iva ~ '^[0-9]{11}$'
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_disdette_generate_storage_path
  ON public.disdette_generate(storage_bucket, storage_path);

CREATE INDEX IF NOT EXISTS idx_disdette_generate_created_at
  ON public.disdette_generate(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_disdette_generate_codice_fiscale
  ON public.disdette_generate(codice_fiscale)
  WHERE codice_fiscale IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_disdette_generate_partita_iva
  ON public.disdette_generate(partita_iva)
  WHERE partita_iva IS NOT NULL;

ALTER TABLE public.disdette_generate ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.disdette_generate FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.disdette_generate TO service_role;

COMMENT ON TABLE public.disdette_generate IS
  'Indice server-only dei PDF creati dal Compilatore disdette Mirox.';
COMMENT ON COLUMN public.disdette_generate.storage_path IS
  'Path privato nel bucket disdette-files; il browser riceve solo signed URL temporanei.';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'disdette-files',
  'disdette-files',
  false,
  5242880,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
