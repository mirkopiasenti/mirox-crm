BEGIN;

ALTER TABLE public.vendita_stati_verifica_manuale
  DROP CONSTRAINT vendita_stati_verifica_manuale_stato_check,
  DROP CONSTRAINT vendita_stati_verifica_motivo_valido,
  ADD CONSTRAINT vendita_stati_verifica_manuale_stato_check
    CHECK (stato IN ('da_verificare', 'da_confermare', 'in_attesa_csv', 'in_attesa_verifica')),
  ADD CONSTRAINT vendita_stati_verifica_motivo_valido CHECK (
    (stato IN ('da_confermare', 'in_attesa_csv', 'in_attesa_verifica') AND motivo IS NULL)
    OR (stato = 'da_verificare' AND motivo IS NOT NULL
      AND char_length(motivo) BETWEEN 1 AND 2000 AND motivo ~ '[^[:space:]]')
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.vendita_imposta_stato_verifica_manuale(
  p_contratto_id uuid, p_stato text, p_stato_atteso text, p_versione_attesa timestamptz, p_autore uuid,
  p_motivo text, p_versione_revisione_attesa bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  fase text;
  energia boolean;
  versione_contratto timestamptz;
  revisione public.vendita_stati_verifica_manuale%ROWTYPE;
  motivo_normalizzato text;
BEGIN
  IF p_stato IS NULL OR p_stato NOT IN ('da_verificare', 'da_confermare', 'in_attesa_csv', 'in_attesa_verifica')
    OR (p_stato_atteso IS NOT NULL AND p_stato_atteso NOT IN ('da_verificare', 'da_confermare', 'in_attesa_csv', 'in_attesa_verifica'))
    OR p_autore IS NULL
    OR (p_versione_revisione_attesa IS NOT NULL AND p_versione_revisione_attesa < 1) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Stato o versione non validi.';
  END IF;
  motivo_normalizzato := nullif(regexp_replace(coalesce(p_motivo, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  IF p_stato = 'da_verificare' AND motivo_normalizzato IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Scrivi la motivazione per Da verificare.';
  END IF;
  IF char_length(motivo_normalizzato) > 2000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'La motivazione può contenere al massimo 2000 caratteri.';
  END IF;
  IF p_stato <> 'da_verificare' THEN motivo_normalizzato := NULL; END IF;

  -- Ordine comune con approvazione e riapertura: contratto, poi stato operativo.
  SELECT c.stato_controllo, c.updated_at, mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
    INTO fase, versione_contratto, energia
    FROM public.vendita_contratti c WHERE c.id = p_contratto_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Contratto non trovato.';
  END IF;
  IF fase <> 'da_controllare' OR versione_contratto IS DISTINCT FROM p_versione_attesa THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Il contratto è cambiato. Riapri il dettaglio.';
  END IF;
  IF (energia AND p_stato = 'da_confermare')
    OR (NOT energia AND p_stato IN ('in_attesa_csv', 'in_attesa_verifica')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Esito non valido per questa categoria.';
  END IF;

  SELECT * INTO revisione FROM public.vendita_stati_verifica_manuale
    WHERE contratto_id = p_contratto_id FOR UPDATE;

  IF revisione.versione IS DISTINCT FROM p_versione_revisione_attesa THEN
    -- Retry dopo una risposta persa, solo per il medesimo salvataggio e autore.
    IF revisione.versione = coalesce(p_versione_revisione_attesa, 0) + 1
      AND revisione.stato = p_stato AND revisione.motivo IS NOT DISTINCT FROM motivo_normalizzato
      AND revisione.aggiornato_da = p_autore THEN
      RETURN jsonb_build_object('stato', revisione.stato, 'motivo', revisione.motivo, 'versione', revisione.versione);
    END IF;
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Stato o motivazione modificati. Riapri il dettaglio.';
  END IF;
  IF revisione.stato IS DISTINCT FROM p_stato_atteso THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Lo stato è cambiato. Riapri il dettaglio.';
  END IF;
  IF revisione.stato = p_stato AND revisione.motivo IS NOT DISTINCT FROM motivo_normalizzato THEN
    RETURN jsonb_build_object('stato', revisione.stato, 'motivo', revisione.motivo, 'versione', revisione.versione);
  END IF;

  INSERT INTO public.vendita_stati_verifica_manuale (contratto_id, stato, motivo, versione, aggiornato_da)
  VALUES (p_contratto_id, p_stato, motivo_normalizzato, coalesce(revisione.versione, 0) + 1, p_autore)
  ON CONFLICT (contratto_id) DO UPDATE
    SET stato = EXCLUDED.stato, motivo = EXCLUDED.motivo, versione = EXCLUDED.versione,
      aggiornato_da = EXCLUDED.aggiornato_da, aggiornato_at = now()
  RETURNING * INTO revisione;
  RETURN jsonb_build_object('stato', revisione.stato, 'motivo', revisione.motivo, 'versione', revisione.versione);
END;
$$;

CREATE OR REPLACE FUNCTION public.vendita_energia_pronta(p_id uuid, p_punto text, p_numero text, p_gestore text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendita_energia_verifiche v
    WHERE v.contratto_id = p_id AND v.stato = 'in_attesa_verifica'
      AND v.contesto = public.vendita_energia_contesto_manuale(p_id)
      AND v.riscontro = jsonb_build_array(p_punto, p_numero, p_gestore)
      AND NOT EXISTS (
        SELECT 1 FROM public.vendita_stati_verifica_manuale m
        WHERE m.contratto_id = p_id AND m.stato IN ('in_attesa_csv', 'da_verificare')
      )
  );
$$;

COMMIT;
