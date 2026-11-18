BEGIN;

SELECT pg_advisory_xact_lock(761258, 1);

ALTER TABLE public.vendita_energia_csv
  ADD CONSTRAINT vendita_energia_csv_versione_unica UNIQUE (id);

ALTER TABLE public.vendita_energia_csv_righe ADD COLUMN fonte_id uuid;

UPDATE public.vendita_energia_csv_righe AS r
SET fonte_id = f.id
FROM public.vendita_energia_csv f
WHERE f.singleton AND r.fonte_id IS NULL;

ALTER TABLE public.vendita_energia_csv_righe
  ALTER COLUMN fonte_id SET NOT NULL,
  ADD CONSTRAINT vendita_energia_csv_righe_fonte_fkey
    FOREIGN KEY (fonte_id) REFERENCES public.vendita_energia_csv (id);
CREATE INDEX vendita_energia_csv_righe_per_fonte ON public.vendita_energia_csv_righe (fonte_id);

CREATE OR REPLACE FUNCTION mirox_private.energia_esito_lg(p_numero text, p_punto text, p_fiscale text, p_business boolean, p_solo_numero boolean)
RETURNS SETOF public.vendita_energia_csv_righe
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH fonte AS MATERIALIZED (
    SELECT r.*, CASE WHEN p_business THEN r.piva ELSE r.cf END AS fiscale
    FROM public.vendita_energia_csv_righe r
    WHERE r.numero = p_numero AND (
      (r.punto <> '' AND r.punto = p_punto)
      OR (r.punto = '' AND p_solo_numero AND NOT EXISTS (
        SELECT 1 FROM public.vendita_energia_csv_righe x WHERE x.numero = p_numero AND x.punto <> ''))
    )
  )
  SELECT numero, punto, cf, piva, stato, causale, messaggio, annullamento, fonte_id
  FROM fonte WHERE fiscale = p_fiscale AND p_fiscale <> '' AND stato IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM fonte WHERE fiscale <> '' AND fiscale <> p_fiscale)
  ORDER BY array_position(ARRAY['Rifiutato','Annullato','In lavorazione','In attivazione','Nuovo','Attivato'], stato) NULLS LAST,
    stato, cf, piva LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.vendita_energia_importa_csv(p_hash text, p_autore uuid, p_righe jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  fonte public.vendita_energia_csv%ROWTYPE;
  totale integer;
  aggiornati integer;
  protetti integer;
BEGIN
  IF p_autore IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_righe) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CSV non valido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_righe) NOT BETWEEN 1 AND 60000 THEN
    RAISE EXCEPTION 'Numero righe CSV non valido' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(761258, 1);
  SELECT * INTO fonte FROM public.vendita_energia_csv WHERE singleton;
  IF fonte.sha256 = p_hash THEN
    RETURN jsonb_build_object('duplicato', true, 'aggiornati', 0, 'protetti', 0);
  END IF;

  -- Le righe appartengono a una fonte precisa. La sostituzione rimuove
  -- soltanto la versione letta sotto lo stesso lock e aggiorna fonte ed esiti
  -- nella stessa transazione.
  IF fonte.id IS NOT NULL THEN
    DELETE FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id;
  END IF;

  INSERT INTO public.vendita_energia_csv AS f (sha256, caricato_da) VALUES (p_hash, p_autore)
  ON CONFLICT (singleton) DO UPDATE SET id = excluded.id, sha256 = excluded.sha256,
    caricato_at = excluded.caricato_at, caricato_da = excluded.caricato_da
  RETURNING * INTO fonte;

  INSERT INTO public.vendita_energia_csv_righe (fonte_id, numero, punto, cf, piva, stato, causale, messaggio, annullamento)
  SELECT fonte.id, x.numero, x.punto, x.cf, x.piva, x.stato, x.causale, x.messaggio, x.annullamento
  FROM jsonb_to_recordset(p_righe) AS x(numero text, punto text, cf text, piva text, stato text,
    causale text, messaggio text, annullamento text);
  IF NOT EXISTS (
    SELECT 1 FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id AND r.punto <> ''
  ) THEN
    RAISE EXCEPTION 'Il CSV non contiene punti di fornitura utilizzabili' USING ERRCODE = '22023';
  END IF;

  -- Il conteggio precede il filtro fiscale: lo stesso numero/punto presente in
  -- più righe Mirox è ambiguo anche se una sola anagrafica combacia.
  WITH controlli AS MATERIALIZED (
    SELECT l.id, l.esito_manuale_bloccato AS bloccato, k.numero, k.punto,
      mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster)) AS fiscale,
      lower(trim(coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster))) = 'business' AS business,
      count(*) OVER (PARTITION BY k.numero, k.punto) AS copie_punto,
      count(*) OVER (PARTITION BY k.numero) AS copie_numero
    FROM public.post_vendita_controllo_lg l
    JOIN public.vendita_contratti c ON c.id = l.contratto_id
    JOIN public.anagrafica a ON a.id = c.anagrafica_id
    CROSS JOIN LATERAL (SELECT mirox_private.energia_codice(c.numero_contratto_energia) AS numero,
      mirox_private.energia_codice(c.pod_pdr) AS punto) k
    WHERE k.numero <> ''
  ), esiti AS MATERIALIZED (
    SELECT c.id, c.bloccato, r.stato, r.causale, r.messaggio, r.annullamento
    FROM controlli c
    CROSS JOIN LATERAL mirox_private.energia_esito_lg(c.numero, c.punto, c.fiscale, c.business, c.copie_numero = 1) r
    WHERE c.copie_punto = 1
  ), scritti AS (
    UPDATE public.post_vendita_controllo_lg l SET stato = e.stato, stato_origine = 'csv',
      causale_stato_pratica = e.causale, messaggio_esito_sap = e.messaggio, causa_annullamento = e.annullamento,
      ultimo_csv_upload_at = fonte.caricato_at, ultimo_csv_upload_da = fonte.caricato_da
    FROM esiti e WHERE l.id = e.id AND NOT l.esito_manuale_bloccato
    RETURNING l.id
  )
  SELECT (SELECT count(*) FROM esiti), (SELECT count(*) FROM scritti),
    (SELECT count(*) FROM esiti WHERE bloccato) INTO totale, aggiornati, protetti;
  RETURN jsonb_build_object('duplicato', false, 'aggiornati', aggiornati, 'protetti', protetti,
    'corrispondenze', totale, 'caricato_at', fonte.caricato_at);
END;
$$;

COMMIT;
