BEGIN;

-- Le liste leggono molti contratti alla volta. Separa il riscontro ordinario
-- dal recupero dei soli codici legacy, così ogni caso usa solo le sue query.
CREATE OR REPLACE FUNCTION mirox_private.energia_tipo_per_contratto(p_id uuid) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  codice text;
  punto_pratica text;
  fiscale text;
  fiscale_hash_pratica bytea;
  proposta text;
  tipo text;
  candidati integer := 0;
BEGIN
  SELECT mirox_private.energia_codice(c.numero_contratto_energia),
    mirox_private.energia_codice(c.pod_pdr),
    mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster))
  INTO codice, punto_pratica, fiscale
  FROM public.vendita_contratti c
  JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
  JOIN public.anagrafica a ON a.id = c.anagrafica_id
  WHERE c.id = p_id AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot);

  IF NOT FOUND OR fiscale = '' OR (codice = '' AND punto_pratica = '') THEN
    RETURN NULL;
  END IF;
  fiscale_hash_pratica := sha256(convert_to(fiscale, 'UTF8'));

  IF punto_pratica <> '' THEN
    SELECT count(*), min(t.tipo_pratica), min(t.numero)
    INTO candidati, tipo, proposta
    FROM mirox_private.energia_tipi_csv t
    WHERE t.punto = punto_pratica AND t.fiscale_hash = fiscale_hash_pratica
      AND (codice = '' OR t.numero = codice);
  END IF;

  IF candidati = 1 THEN
    IF tipo IS NULL OR EXISTS (
      SELECT 1 FROM public.vendita_contratti c
      JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
      JOIN public.anagrafica a ON a.id = c.anagrafica_id
      WHERE c.id <> p_id AND c.pod_pdr IS NOT NULL
        AND upper(regexp_replace(c.pod_pdr, '[[:space:]]+', '', 'g')) = punto_pratica
        AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
        AND (mirox_private.energia_codice(c.numero_contratto_energia) = proposta OR
          (codice = '' AND mirox_private.energia_codice(c.numero_contratto_energia) = '' AND
            mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster)) = fiscale))
    ) THEN
      RETURN NULL;
    END IF;
    RETURN tipo;
  END IF;

  IF codice = '' THEN RETURN NULL; END IF;
  SELECT min(t.tipo_pratica) FILTER (WHERE t.fiscale_hash = fiscale_hash_pratica)
  INTO tipo
  FROM mirox_private.energia_tipi_csv t
  WHERE t.numero = codice
  HAVING count(DISTINCT t.punto) = 1 AND bool_and(t.punto = '' OR punto_pratica = '')
    AND count(*) FILTER (WHERE t.fiscale_hash = fiscale_hash_pratica) = 1;

  IF tipo IS NULL OR EXISTS (
    SELECT 1 FROM public.vendita_contratti c
    JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
    WHERE c.id <> p_id AND mirox_private.energia_codice(c.numero_contratto_energia) = codice
      AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN tipo;
END;
$$;

CREATE OR REPLACE FUNCTION public.tipo_pratica_energia(public.vendita_contratti) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(nullif(trim(($1).categoria_snapshot), ''), 'Energia') = 'Energia'
      AND (current_user <> 'authenticated' OR
        (SELECT mirox_private.can_pages(ARRAY['verifica_contratti','controllo_lg']::text[])))
    THEN (SELECT mirox_private.energia_tipo_per_contratto(c.id)
      FROM public.vendita_contratti c WHERE c.id = ($1).id)
  END;
$$;

COMMIT;
