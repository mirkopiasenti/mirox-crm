BEGIN;
ALTER TABLE public.kona_ai_messaggi ADD COLUMN IF NOT EXISTS voice_job_id uuid REFERENCES public.kona_ai_vocali_jobs(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS kona_ai_messaggi_voice_author ON public.kona_ai_messaggi(voice_job_id,autore_tipo);
COMMENT ON COLUMN public.kona_ai_messaggi.voice_job_id IS 'Collegamento idempotente al vocale; id messaggio resta bigint identity, senza assegnazioni client.';
NOTIFY pgrst, 'reload schema';
COMMIT;
