-- Compilatore Subentri: archivio separato, senza alterare tabelle CRM/CC.
BEGIN;
CREATE TABLE public.subentri_generati (
  id uuid PRIMARY KEY,
  tipo text NOT NULL CHECK (tipo = 'mobile_microbusiness_privato'),
  stato text NOT NULL DEFAULT 'bozza' CHECK (stato IN ('bozza', 'generato')),
  cedente_nome text NOT NULL,
  cedente_partita_iva text NOT NULL,
  subentrante_nome text NOT NULL,
  subentrante_cognome text NOT NULL,
  subentrante_codice_fiscale text NOT NULL,
  numeri text[] NOT NULL CHECK (cardinality(numeri) BETWEEN 1 AND 100),
  dati_compilazione jsonb NOT NULL CHECK (jsonb_typeof(dati_compilazione) = 'object'),
  documenti jsonb NOT NULL CHECK (jsonb_typeof(documenti) = 'array' AND jsonb_array_length(documenti) BETWEEN 3 AND 12),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[0-9a-f]{64}$'),
  storage_bucket text NOT NULL DEFAULT 'subentri-files' CHECK (storage_bucket = 'subentri-files'),
  storage_prefix text NOT NULL UNIQUE,
  storage_path text UNIQUE,
  nome_file text,
  pdf_sha256 text CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  template_versione text,
  numero_pagine integer,
  created_by uuid NOT NULL,
  created_by_nome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  generato_at timestamptz,
  CHECK (stato <> 'generato' OR (
    storage_path IS NOT NULL AND nome_file IS NOT NULL AND pdf_sha256 IS NOT NULL
    AND template_versione IS NOT NULL AND numero_pagine IS NOT NULL
    AND numero_pagine BETWEEN 1 AND 25 AND generato_at IS NOT NULL
  ))
);
CREATE INDEX idx_subentri_generati_stato_data ON public.subentri_generati(stato, created_at DESC);
CREATE INDEX idx_subentri_generati_operatore ON public.subentri_generati(created_by);
ALTER TABLE public.subentri_generati ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.subentri_generati FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.subentri_generati TO service_role;
COMMENT ON TABLE public.subentri_generati IS 'Bozze per operatore e storico globale autenticato del Compilatore Subentri; accesso solo tramite Function.';
COMMENT ON COLUMN public.subentri_generati.documenti IS 'Manifest immutabile con categoria, hash, dimensione e path degli allegati. La presenza e i byte vengono verificati prima della generazione.';
-- Nessuna policy browser: PDF e allegati accessibili soltanto dalla Function.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('subentri-files', 'subentri-files', false, 4194304, ARRAY['application/pdf','image/jpeg','image/png']::text[]);
COMMIT;
