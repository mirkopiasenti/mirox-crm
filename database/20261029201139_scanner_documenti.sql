-- Scanner documenti: sessioni temporanee server-only, nessuna modifica a tabelle condivise.
BEGIN;
CREATE TABLE public.vendita_scanner_sessioni (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operatore_id uuid NOT NULL,
 cliente_snapshot jsonb NOT NULL CHECK (jsonb_typeof(cliente_snapshot)='object'),
 pacchetto jsonb NOT NULL CHECK (jsonb_typeof(pacchetto)='object'),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 stato text NOT NULL DEFAULT 'aperta' CHECK(stato IN ('aperta','in_caricamento','pronta','consumata','annullata')),
 sha256 text CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 CHECK(expires_at > created_at)
);
ALTER TABLE public.vendita_scanner_sessioni ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendita_scanner_sessioni FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.vendita_scanner_sessioni TO service_role;
CREATE INDEX vendita_scanner_scadenza ON public.vendita_scanner_sessioni(expires_at);
CREATE INDEX vendita_scanner_operatore ON public.vendita_scanner_sessioni(operatore_id,expires_at);
COMMENT ON TABLE public.vendita_scanner_sessioni IS 'Sessioni QR brevi e revocabili. Token solo hash; PDF privati temporanei eliminati dal cron operativo.';
COMMIT;
