-- Solo tabelle vendita. Nessuna modifica ad anagrafica o al Call Center.
BEGIN;
ALTER TABLE public.vendita_pratiche ADD COLUMN identita_verifica_upload jsonb
 CHECK (identita_verifica_upload IS NULL OR (jsonb_typeof(identita_verifica_upload)='object' AND identita_verifica_upload->>'version'='1') IS TRUE);
ALTER TABLE public.vendita_documenti ADD COLUMN sha256 text
 CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$');
COMMENT ON COLUMN public.vendita_pratiche.identita_verifica_upload IS
 'Controllo identita upload: autore, snapshot anagrafico, hash PDF, esito ed eventuale conferma manuale. NULL solo per pratiche legacy.';
COMMIT;
