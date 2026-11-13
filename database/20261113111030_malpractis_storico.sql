-- Archivio Malpractis isolato, modello Disdette. Nessun UPDATE a dati esistenti.
BEGIN;
CREATE TABLE public.malpractis_generati (
 id uuid PRIMARY KEY,
 intestatario text NOT NULL CHECK (char_length(intestatario) BETWEEN 1 AND 100),
 cf_piva text NOT NULL CHECK (cf_piva ~ '^([A-Z0-9]{16}|[0-9]{11})$'),
 numero_fisso text NOT NULL,
 stato_linea text NOT NULL CHECK (stato_linea IN ('nuova','attiva')),
 dati_compilazione jsonb NOT NULL CHECK (jsonb_typeof(dati_compilazione)='object'),
 richiesta_sha256 text NOT NULL CHECK (richiesta_sha256 ~ '^[0-9a-f]{64}$'),
 storage_bucket text NOT NULL DEFAULT 'malpractis-files' CHECK (storage_bucket='malpractis-files'),
 storage_path text NOT NULL UNIQUE,
 nome_file text NOT NULL,
 pdf_sha256 text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
 template_versione text NOT NULL,
 created_by uuid REFERENCES public.profili(id) ON DELETE SET NULL,
 created_by_nome text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX malpractis_generati_data ON public.malpractis_generati(created_at DESC,id DESC);
CREATE INDEX malpractis_generati_autore ON public.malpractis_generati(created_by);
ALTER TABLE public.malpractis_generati ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.malpractis_generati FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.malpractis_generati TO service_role;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('malpractis-files','malpractis-files',false,5242880,ARRAY['application/pdf']::text[]);
COMMENT ON TABLE public.malpractis_generati IS 'Storico server-only Malpractis: PDF privati, snapshot per duplicazione e retry idempotenti.';
COMMIT;
