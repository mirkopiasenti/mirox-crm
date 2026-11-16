BEGIN;
CREATE TABLE public.vendita_note_contratto (
 id uuid PRIMARY KEY,
 contratto_id uuid NOT NULL REFERENCES public.vendita_contratti(id) ON DELETE CASCADE,
 testo text NOT NULL CHECK (char_length(testo) BETWEEN 1 AND 4000 AND btrim(testo) <> ''),
 autore_id uuid NOT NULL,
 autore_nome text NOT NULL CHECK (char_length(autore_nome) BETWEEN 1 AND 250 AND btrim(autore_nome) <> ''),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vendita_note_contratto_storico ON public.vendita_note_contratto(contratto_id,created_at DESC,id DESC);
ALTER TABLE public.vendita_note_contratto ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendita_note_contratto FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.vendita_note_contratto TO service_role;
COMMENT ON TABLE public.vendita_note_contratto IS 'Annotazioni interne append-only per contratto: autore login e nome snapshot, data DB. Lettura/aggiunta soltanto via Function con ACL Verifica Contratti; nessun backfill.';
COMMIT;
