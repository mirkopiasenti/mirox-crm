BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE INDEX vendita_contratti_energia_punto_normalizzato
  ON public.vendita_contratti ((upper(regexp_replace(pod_pdr, '[[:space:]]+', '', 'g'))))
  WHERE pod_pdr IS NOT NULL;

CREATE TABLE mirox_private.energia_tipi_csv (
  numero text NOT NULL CHECK (char_length(numero) BETWEEN 1 AND 80),
  punto text NOT NULL CHECK (punto = '' OR punto ~ '^(IT[0-9]{3}E[A-Z0-9]{8,10}|[0-9]{14})$'),
  fiscale_hash bytea NOT NULL CHECK (octet_length(fiscale_hash) = 32),
  tipo_pratica text CHECK (char_length(tipo_pratica) BETWEEN 1 AND 100),
  PRIMARY KEY (punto, fiscale_hash, numero)
);
CREATE INDEX energia_tipi_csv_numero ON mirox_private.energia_tipi_csv (numero);

ALTER TABLE mirox_private.energia_tipi_csv ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON mirox_private.energia_tipi_csv FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON mirox_private.energia_tipi_csv TO service_role;

CREATE FUNCTION public.vendita_energia_importa_tipi(p_righe jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  scritti integer;
BEGIN
  IF jsonb_typeof(p_righe) IS DISTINCT FROM 'array' OR jsonb_array_length(p_righe) > 60000 THEN
    RAISE EXCEPTION 'Righe tipo pratica non valide' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_righe) AS x(riga) WHERE riga ? 'tipo_pratica') THEN
    RETURN jsonb_build_object('tipi_aggiornati', 0);
  END IF;

  PERFORM pg_advisory_xact_lock(761258, 1);
  INSERT INTO mirox_private.energia_tipi_csv AS t (numero, punto, fiscale_hash, tipo_pratica)
  SELECT x.numero, x.punto, sha256(convert_to(f.codice, 'UTF8')),
    CASE WHEN count(DISTINCT x.tipo) = 1 AND bool_and(x.tipo IS NOT NULL) THEN min(x.tipo) END
  FROM jsonb_array_elements(p_righe) AS j(riga)
  CROSS JOIN LATERAL (
    SELECT mirox_private.energia_codice(riga->>'numero') AS numero,
      mirox_private.energia_codice(riga->>'punto') AS punto,
      mirox_private.energia_fiscale(riga->>'cf', 'Consumer') AS cf,
      mirox_private.energia_fiscale(riga->>'piva', 'Business') AS piva,
      nullif(trim(regexp_replace(riga->>'tipo_pratica', '[[:space:]]+', ' ', 'g')), '') AS tipo
  ) x
  CROSS JOIN LATERAL (VALUES (x.cf), (x.piva)) f(codice)
  WHERE riga ? 'tipo_pratica' AND f.codice <> '' AND char_length(x.numero) BETWEEN 1 AND 80
    AND (x.punto = '' OR x.punto ~ '^(IT[0-9]{3}E[A-Z0-9]{8,10}|[0-9]{14})$')
    AND (x.tipo IS NULL OR (char_length(x.tipo) BETWEEN 1 AND 100 AND x.tipo NOT IN ('-', '—')))
  GROUP BY x.numero, x.punto, f.codice
  ON CONFLICT (punto, fiscale_hash, numero) DO UPDATE SET tipo_pratica = excluded.tipo_pratica
    WHERE t.tipo_pratica IS DISTINCT FROM excluded.tipo_pratica;
  GET DIAGNOSTICS scritti = ROW_COUNT;
  RETURN jsonb_build_object('tipi_aggiornati', scritti);
END;
$$;

-- Il catalogo è privato. Il resolver riceve l'ID memorizzato e usa anche
-- le pratiche concorrenti non visibili all'operatore per rilevare ambiguità.
CREATE FUNCTION mirox_private.energia_tipo_per_contratto(p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH pratica AS MATERIALIZED (
    SELECT c.id, mirox_private.energia_codice(c.numero_contratto_energia) AS numero,
      mirox_private.energia_codice(c.pod_pdr) AS punto,
      mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster)) AS fiscale
    FROM public.vendita_contratti c
    JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
    JOIN public.anagrafica a ON a.id = c.anagrafica_id
    WHERE c.id = p_id AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
  ), puntuale AS (
    SELECT min(t.tipo_pratica) AS tipo, min(t.numero) AS numero
    FROM pratica p JOIN mirox_private.energia_tipi_csv t
      ON t.punto = p.punto AND t.fiscale_hash = sha256(convert_to(p.fiscale, 'UTF8'))
      AND (p.numero = '' OR t.numero = p.numero)
    WHERE p.fiscale <> '' AND p.punto <> ''
    HAVING count(*) = 1
  ), sul_numero AS (
    SELECT min(t.tipo_pratica) FILTER (WHERE t.fiscale_hash = sha256(convert_to(p.fiscale, 'UTF8'))) AS tipo,
      min(t.numero) AS numero
    FROM pratica p JOIN mirox_private.energia_tipi_csv t ON t.numero = p.numero
    WHERE p.numero <> '' AND p.fiscale <> '' AND NOT EXISTS (SELECT 1 FROM puntuale)
    HAVING count(DISTINCT t.punto) = 1 AND bool_and(t.punto = '' OR p.punto = '')
       AND count(*) FILTER (WHERE t.fiscale_hash = sha256(convert_to(p.fiscale, 'UTF8'))) = 1
  ), riscontro AS (
    SELECT tipo, numero, false AS solo_numero FROM puntuale
    UNION ALL SELECT tipo, numero, true FROM sul_numero
  )
  SELECT r.tipo FROM pratica p CROSS JOIN riscontro r
  WHERE r.tipo IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.vendita_contratti c
      JOIN public.vendita_pratiche s ON s.id = c.pratica_id AND s.stato_pratica = 'inviata'
      JOIN public.anagrafica a ON a.id = c.anagrafica_id
      WHERE NOT r.solo_numero AND c.id <> p.id AND c.pod_pdr IS NOT NULL
        AND upper(regexp_replace(c.pod_pdr, '[[:space:]]+', '', 'g')) = p.punto
        AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
        AND (mirox_private.energia_codice(c.numero_contratto_energia) = r.numero OR
          (p.numero = '' AND mirox_private.energia_codice(c.numero_contratto_energia) = '' AND
            mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster)) = p.fiscale))
    ) AND NOT EXISTS (
      SELECT 1 FROM public.vendita_contratti c
      JOIN public.vendita_pratiche s ON s.id = c.pratica_id AND s.stato_pratica = 'inviata'
      WHERE r.solo_numero AND c.id <> p.id AND mirox_private.energia_codice(c.numero_contratto_energia) = r.numero
        AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
    );
$$;

-- PostgREST legge il campo calcolato con le RLS di vendita_contratti.
-- Il parametro composito senza nome evita l'esposizione come RPC.
CREATE FUNCTION public.tipo_pratica_energia(public.vendita_contratti) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT mirox_private.energia_tipo_per_contratto(c.id)
  FROM public.vendita_contratti c
  WHERE c.id = ($1).id
    AND (current_user <> 'authenticated' OR
      (SELECT mirox_private.can_pages(ARRAY['verifica_contratti','controllo_lg']::text[])));
$$;

REVOKE ALL ON FUNCTION public.vendita_energia_importa_tipi(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tipo_pratica_energia(public.vendita_contratti),
  mirox_private.energia_tipo_per_contratto(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendita_energia_importa_tipi(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tipo_pratica_energia(public.vendita_contratti),
  mirox_private.energia_tipo_per_contratto(uuid) TO authenticated, service_role;

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
  PERFORM public.vendita_energia_importa_tipi(p_righe);
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
