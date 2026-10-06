BEGIN;
CREATE TABLE IF NOT EXISTS public.kona_ai_vocali_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 update_id bigint NOT NULL UNIQUE,
 chat_id text NOT NULL,
 incidente_id uuid REFERENCES public.kona_ai_incidenti(id) ON DELETE SET NULL,
 file_id text NOT NULL CHECK (length(file_id) BETWEEN 1 AND 500),
 stato text NOT NULL DEFAULT 'in_coda' CHECK (stato IN ('in_coda','in_corso','inviato','fallito','incerto')),
 tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi BETWEEN 0 AND 5),
 transcript text, risposta jsonb,
 in_flight boolean NOT NULL DEFAULT false,
 lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 errore_codice text, telegram_message_id bigint,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kona_ai_vocali_one_active ON public.kona_ai_vocali_jobs(chat_id) WHERE stato='in_corso';
CREATE INDEX IF NOT EXISTS kona_ai_vocali_pending ON public.kona_ai_vocali_jobs(chat_id,created_at) WHERE stato IN ('in_coda','in_corso');
ALTER TABLE public.kona_ai_vocali_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kona_ai_vocali_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.kona_ai_vocali_jobs TO service_role;
COMMIT;
