-- Migration 068
-- Telemetria, aggregazione e coda operativa del KONA AI Guardian Observer.
--
-- Le tabelle sono server-only e contengono soltanto eventi gia' ripuliti dal
-- collector. Nessun dato CRM, allegato o segreto deve essere scritto qui.

BEGIN;

CREATE TABLE IF NOT EXISTS public.kona_ai_segnali (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente text NOT NULL CHECK (ambiente IN ('staging', 'production')),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 32 AND 128),
  stato text NOT NULL DEFAULT 'nuovo' CHECK (
    stato IN ('nuovo', 'osservando', 'in_analisi', 'notificato', 'silenzioso', 'risolto')
  ),
  priorita text NOT NULL DEFAULT 'media' CHECK (priorita IN ('bassa', 'media', 'alta', 'critica')),
  kind text NOT NULL,
  source text NOT NULL DEFAULT 'mirox',
  release_commit_sha text,
  deploy_id text,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_sample jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrence_count integer NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  affected_actor_count integer NOT NULL DEFAULT 0 CHECK (affected_actor_count >= 0),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  last_analyzed_at timestamptz,
  silenced_until timestamptz,
  reopened_count integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  incidente_id uuid REFERENCES public.kona_ai_incidenti(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kona_ai_segnali_release_length CHECK (
    release_commit_sha IS NULL OR char_length(release_commit_sha) BETWEEN 7 AND 128
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_kona_ai_segnali_fingerprint_env_release
  ON public.kona_ai_segnali(ambiente, fingerprint, COALESCE(release_commit_sha, ''));

CREATE TABLE IF NOT EXISTS public.kona_ai_eventi_tecnici (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE,
  segnale_id uuid REFERENCES public.kona_ai_segnali(id) ON DELETE SET NULL,
  ambiente text NOT NULL CHECK (ambiente IN ('staging', 'production')),
  kind text NOT NULL,
  source text NOT NULL DEFAULT 'mirox',
  severity_hint text NOT NULL DEFAULT 'error' CHECK (severity_hint IN ('info', 'warning', 'error', 'critical')),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  release_commit_sha text,
  deploy_id text,
  request_id text,
  actor_hash text,
  location jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb NOT NULL DEFAULT '{}'::jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_ai_eventi_tecnici_segnale_received
  ON public.kona_ai_eventi_tecnici(segnale_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_kona_ai_eventi_tecnici_expires
  ON public.kona_ai_eventi_tecnici(expires_at);

CREATE TABLE IF NOT EXISTS public.kona_ai_notifiche (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incidente_id uuid REFERENCES public.kona_ai_incidenti(id) ON DELETE CASCADE,
  segnale_id uuid REFERENCES public.kona_ai_segnali(id) ON DELETE CASCADE,
  canale text NOT NULL DEFAULT 'telegram' CHECK (canale IN ('telegram')),
  dedupe_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  stato text NOT NULL DEFAULT 'in_coda' CHECK (stato IN ('in_coda', 'in_invio', 'inviata', 'fallita', 'morta')),
  tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi >= 0),
  prossimo_tentativo_at timestamptz NOT NULL DEFAULT now(),
  telegram_message_id bigint,
  ultimo_errore text,
  inviata_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_ai_notifiche_pending
  ON public.kona_ai_notifiche(stato, prossimo_tentativo_at)
  WHERE stato IN ('in_coda', 'in_invio', 'fallita');

CREATE TABLE IF NOT EXISTS public.kona_ai_observer_checkpoint (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ambiente text NOT NULL CHECK (ambiente IN ('staging', 'production')),
  tipo text NOT NULL CHECK (tipo IN ('observer', 'digest', 'scansione_migliorie')),
  ultimo_commit_sha text,
  ultima_esecuzione_at timestamptz,
  ultimo_esito text,
  budget_giornaliero integer NOT NULL DEFAULT 0 CHECK (budget_giornaliero >= 0),
  budget_data date,
  dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ambiente, tipo)
);

DROP TRIGGER IF EXISTS trg_kona_ai_segnali_updated_at ON public.kona_ai_segnali;
CREATE TRIGGER trg_kona_ai_segnali_updated_at
BEFORE UPDATE ON public.kona_ai_segnali
FOR EACH ROW EXECUTE FUNCTION public.kona_ai_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_ai_notifiche_updated_at ON public.kona_ai_notifiche;
CREATE TRIGGER trg_kona_ai_notifiche_updated_at
BEFORE UPDATE ON public.kona_ai_notifiche
FOR EACH ROW EXECUTE FUNCTION public.kona_ai_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_ai_observer_checkpoint_updated_at ON public.kona_ai_observer_checkpoint;
CREATE TRIGGER trg_kona_ai_observer_checkpoint_updated_at
BEFORE UPDATE ON public.kona_ai_observer_checkpoint
FOR EACH ROW EXECUTE FUNCTION public.kona_ai_touch_updated_at();

DO $$
BEGIN
  ALTER TABLE public.kona_ai_esecuzioni
    DROP CONSTRAINT IF EXISTS kona_ai_esecuzioni_tipo_esecuzione_check;
  ALTER TABLE public.kona_ai_esecuzioni
    ADD CONSTRAINT kona_ai_esecuzioni_tipo_esecuzione_check
    CHECK (tipo_esecuzione IN (
      'analisi_codex', 'analisi_automatica', 'scansione_migliorie',
      'prepara_patch', 'test_staging', 'rilascio_produzione'
    ));
EXCEPTION WHEN undefined_table THEN
  NULL;
END;
$$;

ALTER TABLE public.kona_ai_segnali ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_ai_eventi_tecnici ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_ai_notifiche ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_ai_observer_checkpoint ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.kona_ai_segnali FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kona_ai_eventi_tecnici FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kona_ai_notifiche FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.kona_ai_observer_checkpoint FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.kona_ai_segnali TO service_role;
GRANT ALL ON TABLE public.kona_ai_eventi_tecnici TO service_role;
GRANT ALL ON TABLE public.kona_ai_notifiche TO service_role;
GRANT ALL ON TABLE public.kona_ai_observer_checkpoint TO service_role;

COMMENT ON TABLE public.kona_ai_eventi_tecnici IS
  'Eventi tecnici Guardian gia'' ripuliti, con conservazione limitata e accesso server-only.';
COMMENT ON TABLE public.kona_ai_segnali IS
  'Aggregati deduplicati usati per decidere quando aprire un incidente Guardian.';
COMMENT ON TABLE public.kona_ai_notifiche IS
  'Outbox persistente per notifiche Telegram Guardian con retry.';
COMMENT ON TABLE public.kona_ai_observer_checkpoint IS
  'Checkpoint e budget delle scansioni automatiche Guardian.';

COMMIT;
