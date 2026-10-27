-- Codici cliente WindTre: molti codici per anagrafica, senza cambiare lo schema CC.
BEGIN;
CREATE TABLE public.anagrafica_codici_cliente_windtre (
  anagrafica_id uuid NOT NULL REFERENCES public.anagrafica(id) ON DELETE CASCADE,
  codice_cliente text NOT NULL CHECK (codice_cliente ~ '^[A-Z0-9][A-Z0-9/-]{0,79}$' AND codice_cliente ~ '[0-9]'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (anagrafica_id, codice_cliente)
);
COMMENT ON TABLE public.anagrafica_codici_cliente_windtre IS
  'Codici cliente WindTre anagrafici da PDA Mobile/Fisso/Customer Base; nessuna sostituzione automatica.';
ALTER TABLE public.anagrafica_codici_cliente_windtre ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.anagrafica_codici_cliente_windtre FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.anagrafica_codici_cliente_windtre TO service_role;
COMMIT;
