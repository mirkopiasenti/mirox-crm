-- MIROX AI - Target: stato esclusivamente server-side. Nessuna tabella CRM alterata.
BEGIN;
CREATE TABLE public.mirox_target_sessioni (
  chat_id text PRIMARY KEY CHECK (chat_id ~ '^[1-9][0-9]*$'),
  conversazione jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(conversazione)='array'),
  lock_token uuid,
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mirox_target_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  chat_id text NOT NULL REFERENCES public.mirox_target_sessioni(chat_id),
  tipo text NOT NULL CHECK (tipo IN ('report','dialogo')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  messaggi jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messaggi)='array'),
  inviati integer NOT NULL DEFAULT 0 CHECK (inviati >= 0),
  in_flight boolean NOT NULL DEFAULT false,
  stato text NOT NULL DEFAULT 'in_coda' CHECK (stato IN ('in_coda','in_corso','inviato','fallito','incerto')),
  tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi BETWEEN 0 AND 8),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  errore_codice text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (inviati <= jsonb_array_length(messaggi))
);
CREATE INDEX mirox_target_jobs_pending_idx ON public.mirox_target_jobs(next_attempt_at,created_at,id)
  WHERE stato IN ('in_coda','in_corso');
ALTER TABLE public.mirox_target_sessioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirox_target_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mirox_target_sessioni,public.mirox_target_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.mirox_target_sessioni,public.mirox_target_jobs TO service_role;
COMMENT ON TABLE public.mirox_target_jobs IS 'Coda Target: claim serializzato dalla sessione, checkpoint di invio; esito ambiguo sospeso, non ritentato automaticamente.';
COMMIT;
