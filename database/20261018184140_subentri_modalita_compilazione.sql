-- Due modalità Subentri: nessuna modifica a tabelle CRM/CC o permessi.
BEGIN;
ALTER TABLE public.subentri_generati
  ADD COLUMN modalita_compilazione text NOT NULL DEFAULT 'invia_pratica'
    CONSTRAINT subentri_generati_modalita_compilazione_check
    CHECK (modalita_compilazione IN ('invia_pratica', 'standard'));
ALTER TABLE public.subentri_generati
  DROP CONSTRAINT subentri_generati_documenti_check,
  ADD CONSTRAINT subentri_generati_documenti_check CHECK (
    jsonb_typeof(documenti) = 'array' AND (
      (modalita_compilazione = 'standard' AND jsonb_array_length(documenti) = 0)
      OR (modalita_compilazione = 'invia_pratica' AND jsonb_array_length(documenti) BETWEEN 3 AND 12)
    )
  );
COMMENT ON COLUMN public.subentri_generati.modalita_compilazione IS 'Invia pratica archivia PDF e documenti obbligatori nel CRM; standard archivia soltanto il PDF. Nessun invio esterno.';
COMMENT ON COLUMN public.subentri_generati.documenti IS 'Manifest immutabile verificato prima della generazione: tre gruppi obbligatori per invia_pratica, array vuoto per standard.';
COMMIT;
