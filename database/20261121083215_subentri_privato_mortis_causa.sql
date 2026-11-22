-- Subentri Mobile, nuove tipologie, mortis causa e archivio 1928.
BEGIN;

ALTER TABLE public.subentri_generati
  ADD COLUMN cedente_codice_fiscale text,
  ADD COLUMN subentrante_partita_iva text,
  ADD COLUMN subentrante_ragione_sociale text,
  ADD COLUMN mortis_causa boolean NOT NULL DEFAULT false,
  ALTER COLUMN cedente_partita_iva DROP NOT NULL,
  ALTER COLUMN cedente_nome DROP NOT NULL,
  ALTER COLUMN subentrante_nome DROP NOT NULL,
  ALTER COLUMN subentrante_cognome DROP NOT NULL,
  ALTER COLUMN subentrante_codice_fiscale DROP NOT NULL,
  DROP CONSTRAINT subentri_generati_tipo_check,
  DROP CONSTRAINT subentri_generati_stato_check,
  DROP CONSTRAINT subentri_generati_numeri_check,
  DROP CONSTRAINT subentri_generati_documenti_check,
  ADD CONSTRAINT subentri_generati_tipo_check
    CHECK (tipo IN ('mobile_microbusiness_privato', 'mobile_privato_privato', 'mobile_privato_microbusiness', 'mobile_microbusiness_microbusiness', 'mobile_1928_privato')),
  ADD CONSTRAINT subentri_generati_compilazione_check CHECK (
    CASE WHEN tipo = 'mobile_1928_privato' THEN
      stato IN ('bozza', 'archiviato')
      AND (stato = 'archiviato') = (generato_at IS NOT NULL)
      AND modalita_compilazione = 'invia_pratica'
      AND dati_compilazione = jsonb_build_object('tipo', tipo)
      AND cardinality(numeri) = 0
      AND cedente_nome IS NULL AND subentrante_nome IS NULL
      AND subentrante_cognome IS NULL AND subentrante_codice_fiscale IS NULL
      AND storage_path IS NULL AND nome_file IS NULL AND pdf_sha256 IS NULL
      AND template_versione IS NULL AND numero_pagine IS NULL
    ELSE
      stato IN ('bozza', 'generato')
      AND cardinality(numeri) BETWEEN 1 AND 100
      AND cedente_nome IS NOT NULL AND subentrante_nome IS NOT NULL
      AND subentrante_cognome IS NOT NULL AND subentrante_codice_fiscale IS NOT NULL
    END
  ),
  ADD CONSTRAINT subentri_generati_cedente_identificativo_check CHECK (
    (tipo = 'mobile_1928_privato' AND cedente_partita_iva IS NULL AND cedente_codice_fiscale IS NULL)
    OR
    (tipo IN ('mobile_microbusiness_privato', 'mobile_microbusiness_microbusiness')
      AND cedente_partita_iva IS NOT NULL AND cedente_codice_fiscale IS NULL)
    OR
    (tipo IN ('mobile_privato_privato', 'mobile_privato_microbusiness')
      AND cedente_partita_iva IS NULL AND cedente_codice_fiscale IS NOT NULL
      AND cedente_codice_fiscale ~ '^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$'
      AND (cedente_codice_fiscale <> subentrante_codice_fiscale
        OR (tipo = 'mobile_privato_microbusiness' AND NOT mortis_causa)))
  ),
  ADD CONSTRAINT subentri_generati_subentrante_identificativo_check CHECK (
    (tipo IN ('mobile_microbusiness_privato', 'mobile_privato_privato', 'mobile_1928_privato')
      AND subentrante_partita_iva IS NULL AND subentrante_ragione_sociale IS NULL)
    OR (tipo IN ('mobile_privato_microbusiness', 'mobile_microbusiness_microbusiness')
      AND subentrante_partita_iva IS NOT NULL AND subentrante_partita_iva ~ '^[0-9]{11}$'
      AND (tipo <> 'mobile_microbusiness_microbusiness'
        OR (cedente_partita_iva ~ '^[0-9]{11}$' AND cedente_partita_iva <> subentrante_partita_iva)))
  ),
  ADD CONSTRAINT subentri_generati_mortis_check CHECK (
    NOT mortis_causa OR (
      tipo NOT IN ('mobile_microbusiness_privato', 'mobile_1928_privato')
      AND cardinality(numeri) <= 4
      AND (stato = 'bozza' OR numero_pagine = 2)
    )
  ),
  ADD CONSTRAINT subentri_generati_documenti_check CHECK (
    CASE
      WHEN jsonb_typeof(documenti) <> 'array' THEN false
      WHEN modalita_compilazione = 'standard' THEN jsonb_array_length(documenti) = 0
      WHEN tipo = 'mobile_privato_privato' AND NOT mortis_causa THEN jsonb_array_length(documenti) BETWEEN 2 AND 8
      WHEN tipo = 'mobile_microbusiness_microbusiness' THEN
        jsonb_array_length(documenti) BETWEEN CASE WHEN mortis_causa THEN 5 ELSE 4 END AND 12
      WHEN tipo = 'mobile_privato_microbusiness' AND mortis_causa THEN jsonb_array_length(documenti) BETWEEN 4 AND 12
      ELSE jsonb_array_length(documenti) BETWEEN 3 AND 12
    END
  );

COMMENT ON COLUMN public.subentri_generati.documenti IS
  'Manifest verificato prima della generazione. Invia pratica: gruppi per tipo, due visure distinte tra Microbusiness e certificato di morte per mortis causa. Standard: array vuoto.';

COMMIT;
