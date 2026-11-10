BEGIN;

CREATE TABLE public.vendita_stati_verifica_manuale (
  contratto_id uuid PRIMARY KEY REFERENCES public.vendita_contratti(id) ON DELETE CASCADE,
  stato text NOT NULL CHECK (stato IN ('da_verificare', 'da_confermare')),
  aggiornato_da uuid NOT NULL,
  aggiornato_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendita_stati_verifica_manuale ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendita_stati_verifica_manuale FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT (contratto_id, stato) ON public.vendita_stati_verifica_manuale TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendita_stati_verifica_manuale TO service_role;
CREATE POLICY vendita_stati_verifica_lettura ON public.vendita_stati_verifica_manuale
  FOR SELECT TO authenticated
  USING ((SELECT mirox_private.can_pages(ARRAY['verifica_contratti']::text[]))
    AND EXISTS (SELECT 1 FROM public.vendita_contratti c
      WHERE c.id = vendita_stati_verifica_manuale.contratto_id AND c.stato_controllo = 'da_controllare'));

CREATE FUNCTION public.vendita_imposta_stato_verifica_manuale(
  p_contratto_id uuid, p_stato text, p_stato_atteso text, p_versione_attesa timestamptz, p_autore uuid
) RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  fase text;
  versione timestamptz;
  stato_corrente text;
BEGIN
  -- Ordine comune con approvazione e riapertura: prima il contratto, poi lo stato operativo.
  SELECT c.stato_controllo, c.updated_at INTO fase, versione
    FROM public.vendita_contratti c WHERE c.id = p_contratto_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Contratto non trovato';
  END IF;
  IF fase <> 'da_controllare' OR versione IS DISTINCT FROM p_versione_attesa THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Il contratto è cambiato. Riapri il dettaglio.';
  END IF;

  SELECT s.stato INTO stato_corrente FROM public.vendita_stati_verifica_manuale s
    WHERE s.contratto_id = p_contratto_id;
  IF stato_corrente IS NOT DISTINCT FROM p_stato AND stato_corrente IS NOT NULL THEN
    RETURN stato_corrente;
  END IF;
  IF stato_corrente IS DISTINCT FROM p_stato_atteso THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Lo stato è cambiato. Riapri il dettaglio.';
  END IF;

  INSERT INTO public.vendita_stati_verifica_manuale (contratto_id, stato, aggiornato_da)
  VALUES (p_contratto_id, p_stato, p_autore)
  ON CONFLICT (contratto_id) DO UPDATE
  SET stato = EXCLUDED.stato, aggiornato_da = EXCLUDED.aggiornato_da, aggiornato_at = now();
  RETURN p_stato;
END;
$$;
REVOKE ALL ON FUNCTION public.vendita_imposta_stato_verifica_manuale(uuid, text, text, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vendita_imposta_stato_verifica_manuale(uuid, text, text, timestamptz, uuid) TO service_role;

CREATE FUNCTION public.vendita_pulisci_stato_verifica_manuale() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  DELETE FROM public.vendita_stati_verifica_manuale WHERE contratto_id = NEW.id;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.vendita_pulisci_stato_verifica_manuale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_pulisci_stato_verifica_manuale() TO service_role;
CREATE TRIGGER trg_vendita_pulisci_stato_verifica_manuale
  AFTER UPDATE OF stato_controllo ON public.vendita_contratti FOR EACH ROW
  WHEN (OLD.stato_controllo = 'da_controllare' AND NEW.stato_controllo IS DISTINCT FROM OLD.stato_controllo)
  EXECUTE FUNCTION public.vendita_pulisci_stato_verifica_manuale();

COMMIT;
