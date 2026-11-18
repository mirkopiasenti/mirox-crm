BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.vendita_energia_verifiche
  ADD COLUMN nota_csv text CHECK (char_length(nota_csv) BETWEEN 1 AND 2000),
  ADD COLUMN tipo_pratica_csv text CHECK (char_length(tipo_pratica_csv) BETWEEN 1 AND 100);
GRANT SELECT (nota_csv) ON public.vendita_energia_verifiche TO authenticated;

-- Le versioni già in esecuzione della Function non possono acquisire lavori
-- o salvare risultati OCR durante la pubblicazione.
CREATE OR REPLACE FUNCTION public.vendita_energia_prossimo_gestore(p_prendi boolean) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT NULL::jsonb $$;

CREATE OR REPLACE FUNCTION public.vendita_energia_riscontra(
  p_id uuid, p_updated timestamptz, p_contesto jsonb, p_lease uuid, p_csv_id uuid, p_punto text,
  p_gestore text, p_motivo text, p_autore uuid
) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT NULL::jsonb $$;

-- I precedenti esiti automatici negativi tornano disponibili per il prossimo
-- caricamento. Le scelte manuali e i dati già registrati restano consultabili.
UPDATE public.vendita_energia_verifiche v SET
  stato = CASE WHEN v.stato = 'da_verificare' THEN 'in_attesa_csv' ELSE v.stato END,
  motivo = CASE WHEN v.stato <> 'da_verificare' THEN v.motivo END,
  motivo_csv = CASE WHEN v.stato <> 'da_verificare' THEN v.motivo_csv END,
  motivo_fornitore = CASE WHEN v.stato <> 'da_verificare' THEN v.motivo_fornitore END,
  lease = NULL, lease_until = NULL, riprova_at = NULL
FROM public.vendita_contratti c
WHERE c.id = v.contratto_id AND c.stato_controllo = 'da_controllare'
  AND (v.stato = 'da_verificare' OR v.lease IS NOT NULL OR v.lease_until IS NOT NULL);

DROP TRIGGER trg_energia_invalida_bolletta ON public.vendita_documenti;

CREATE OR REPLACE FUNCTION mirox_private.energia_registra_modifica_manuale() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_setting('mirox.energia_importazione', true) = 'yes'
    OR ROW(mirox_private.energia_codice(NEW.pod_pdr), mirox_private.energia_codice(NEW.numero_contratto_energia))
       = ROW(mirox_private.energia_codice(OLD.pod_pdr), mirox_private.energia_codice(OLD.numero_contratto_energia))
    OR NOT mirox_private.energia_categoria(NEW.categoria_id, NEW.categoria_snapshot)
    OR NOT EXISTS (SELECT 1 FROM public.vendita_pratiche p WHERE p.id = NEW.pratica_id AND p.stato_pratica = 'inviata')
  THEN RETURN NULL; END IF;

  INSERT INTO public.vendita_energia_verifiche (contratto_id) VALUES (NEW.id)
  ON CONFLICT (contratto_id) DO UPDATE SET
    stato = 'in_attesa_csv', motivo = NULL, motivo_csv = NULL, motivo_fornitore = NULL,
    nota_csv = NULL, csv_id = NULL, csv_at = NULL, riscontro = NULL, tipo_pratica_csv = NULL,
    esito_csv = NULL, contesto = NULL, numero_manuale = NULL, lease = NULL, lease_until = NULL, riprova_at = NULL;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.vendita_energia_pronta(p_id uuid, p_punto text, p_numero text, p_gestore text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendita_energia_verifiche v
    WHERE v.contratto_id = p_id AND v.stato = 'in_attesa_verifica'
      AND mirox_private.energia_codice(p_punto) <> '' AND mirox_private.energia_codice(p_numero) <> ''
      AND mirox_private.energia_codice(v.riscontro->>0) = mirox_private.energia_codice(p_punto)
      AND mirox_private.energia_codice(v.riscontro->>1) = mirox_private.energia_codice(p_numero)
      AND (v.tipo_pratica_csv IS NOT NULL OR jsonb_array_length(v.riscontro) = 3)
      AND NOT EXISTS (
        SELECT 1 FROM public.vendita_stati_verifica_manuale m
        WHERE m.contratto_id = p_id AND m.stato IN ('in_attesa_csv', 'da_verificare')
      )
  );
$$;

CREATE OR REPLACE FUNCTION mirox_private.energia_proteggi_conferma() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.stato_controllo = 'controllato' AND OLD.stato_controllo = 'da_controllare'
    AND mirox_private.energia_categoria(NEW.categoria_id, NEW.categoria_snapshot)
    AND (current_setting('mirox.verifica_commit', true) = 'yes'
      OR NEW.anagrafica_id IS DISTINCT FROM OLD.anagrafica_id OR NEW.pratica_id IS DISTINCT FROM OLD.pratica_id
      OR NEW.cluster_cliente IS DISTINCT FROM OLD.cluster_cliente
      OR NOT public.vendita_energia_pronta(NEW.id, NEW.pod_pdr, NEW.numero_contratto_energia, NEW.ex_fornitore)) THEN
    RAISE EXCEPTION 'Ricarica la pratica. Serve il riscontro del CSV WindTre prima di confermare.' USING ERRCODE = '40001';
  END IF;
  IF OLD.stato_controllo = 'controllato' AND NEW.stato_controllo = 'da_controllare'
    AND mirox_private.energia_categoria(OLD.categoria_id, OLD.categoria_snapshot) THEN
    UPDATE public.vendita_energia_verifiche
      SET stato = 'in_attesa_csv', motivo = NULL, motivo_csv = NULL, motivo_fornitore = NULL, nota_csv = NULL
      WHERE contratto_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- Il riscontro registrato per numero e punto è disponibile dopo la conferma
-- anche in Controllo L&G. I contratti precedenti usano il registro storico.
CREATE FUNCTION mirox_private.energia_tipo_da_csv(p_id uuid, p_punto text, p_numero text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT v.tipo_pratica_csv FROM public.vendita_energia_verifiche v
  WHERE v.contratto_id = p_id AND v.tipo_pratica_csv IS NOT NULL
    AND v.riscontro->>0 = mirox_private.energia_codice(p_punto)
    AND v.riscontro->>1 = mirox_private.energia_codice(p_numero)
    AND (current_setting('role', true) <> 'authenticated' OR
      (SELECT mirox_private.can_pages(ARRAY['verifica_contratti','controllo_lg']::text[])));
$$;
REVOKE ALL ON FUNCTION mirox_private.energia_tipo_da_csv(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION mirox_private.energia_tipo_da_csv(uuid,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tipo_pratica_energia(public.vendita_contratti) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE
    WHEN coalesce(nullif(trim(($1).categoria_snapshot), ''), 'Energia') = 'Energia'
      AND (current_user <> 'authenticated' OR
        (SELECT mirox_private.can_pages(ARRAY['verifica_contratti','controllo_lg']::text[])))
    THEN (SELECT coalesce(mirox_private.energia_tipo_da_csv(c.id, c.pod_pdr, c.numero_contratto_energia),
        CASE WHEN c.stato_controllo = 'controllato' OR nullif(trim(c.numero_contratto_energia), '') IS NOT NULL
          THEN mirox_private.energia_tipo_per_contratto(c.id) END)
      FROM public.vendita_contratti c WHERE c.id = ($1).id)
  END;
$$;

CREATE FUNCTION mirox_private.energia_compila_da_csv(p_pratiche uuid[], p_righe jsonb, p_fonte uuid, p_data timestamptz, p_autore uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pratica record;
  motivo text;
  nota text;
  esito_lg jsonb;
  pronti integer := 0;
  da_verificare integer := 0;
  importazione_precedente text := coalesce(current_setting('mirox.energia_importazione', true), '');
  verifica_precedente text := coalesce(current_setting('mirox.verifica_commit', true), '');
BEGIN
  IF cardinality(p_pratiche) = 0 THEN
    RETURN jsonb_build_object('in_attesa_verifica', 0, 'da_verificare', 0);
  END IF;

  PERFORM set_config('mirox.energia_importazione', 'yes', true);
  PERFORM set_config('mirox.verifica_commit', 'yes', true);
  FOR pratica IN
    WITH per_punto AS (
      SELECT r.punto, min(r.numero) AS numero, count(DISTINCT nullif(r.numero, '')) AS proposte,
        bool_and(nullif(r.numero, '') IS NOT NULL) AS numeri_completi,
        CASE WHEN count(DISTINCT r.tipo_pratica) = 1 AND bool_and(nullif(trim(r.tipo_pratica), '') IS NOT NULL)
          THEN min(trim(r.tipo_pratica)) END AS tipo
      FROM jsonb_to_recordset(p_righe) AS r(punto text, numero text, tipo_pratica text)
      WHERE r.punto <> ''
      GROUP BY r.punto
    )
    SELECT c.id, k.punto, r.numero, r.proposte, r.numeri_completi, r.tipo,
      mirox_private.energia_fiscale(a.cf_piva, k.cluster) AS fiscale, lower(k.cluster) = 'business' AS business,
      EXISTS (
        SELECT 1 FROM public.vendita_contratti x
        JOIN public.vendita_pratiche p ON p.id = x.pratica_id AND p.stato_pratica = 'inviata'
        WHERE x.id <> c.id AND x.pod_pdr IS NOT NULL
          AND upper(regexp_replace(x.pod_pdr, '[[:space:]]+', '', 'g')) = k.punto
          AND mirox_private.energia_categoria(x.categoria_id, x.categoria_snapshot)
          AND (x.stato_controllo = 'da_controllare' OR
            mirox_private.energia_codice(x.numero_contratto_energia) = r.numero)
      ) AS punto_condiviso
    FROM public.vendita_contratti c
    LEFT JOIN public.anagrafica a ON a.id = c.anagrafica_id
    CROSS JOIN LATERAL (SELECT mirox_private.energia_codice(c.pod_pdr) AS punto,
      trim(coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster, '')) AS cluster) k
    LEFT JOIN per_punto r ON r.punto = k.punto
    LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id = c.id
    LEFT JOIN public.vendita_stati_verifica_manuale m ON m.contratto_id = c.id
    WHERE c.id = ANY(p_pratiche) AND coalesce(m.stato, v.stato, 'in_attesa_csv') = 'in_attesa_csv'
    ORDER BY c.id
  LOOP
    motivo := NULL;
    nota := NULL;
    esito_lg := NULL;
    IF pratica.proposte IS NULL THEN
      motivo := 'csv_non_trovato';
      nota := 'Il POD/PDR inserito non è presente nel CSV WindTre caricato.';
    ELSIF pratica.proposte > 1 OR pratica.punto_condiviso THEN
      motivo := 'csv_ambiguo';
      nota := CASE WHEN pratica.proposte > 1 THEN 'Più numeri di contratto nel CSV WindTre per questo POD/PDR.'
        ELSE 'Lo stesso POD/PDR è associato a più pratiche nel CRM. Controlla l’abbinamento.' END;
    ELSIF NOT pratica.numeri_completi OR pratica.tipo IS NULL THEN
      motivo := 'csv_ambiguo';
      nota := 'Il CSV WindTre non indica un numero di contratto e un tipo pratica univoci per questo POD/PDR.';
    ELSE
      UPDATE public.vendita_contratti SET numero_contratto_energia = pratica.numero, updated_by = p_autore
      WHERE id = pratica.id AND numero_contratto_energia IS DISTINCT FROM pratica.numero;
      SELECT to_jsonb(r) || jsonb_build_object('csv_at', p_data, 'csv_da', p_autore) INTO esito_lg
      FROM mirox_private.energia_esito_lg(pratica.numero, pratica.punto, pratica.fiscale, pratica.business, false) r;
    END IF;

    INSERT INTO public.vendita_energia_verifiche AS v
      (contratto_id, stato, motivo, motivo_csv, nota_csv, csv_id, csv_at, riscontro, tipo_pratica_csv, contesto, esito_csv)
    VALUES (pratica.id, CASE WHEN motivo IS NULL THEN 'in_attesa_verifica' ELSE 'da_verificare' END,
      motivo, motivo, nota, p_fonte, p_data,
      CASE WHEN motivo IS NULL THEN jsonb_build_array(pratica.punto, pratica.numero) END,
      CASE WHEN motivo IS NULL THEN pratica.tipo END,
      CASE WHEN motivo IS NULL THEN jsonb_build_object('fiscale', pratica.fiscale, 'business', pratica.business) END,
      esito_lg)
    ON CONFLICT (contratto_id) DO UPDATE SET
      stato = excluded.stato, motivo = excluded.motivo, motivo_csv = excluded.motivo_csv, nota_csv = excluded.nota_csv,
      csv_id = excluded.csv_id, csv_at = excluded.csv_at, riscontro = excluded.riscontro, tipo_pratica_csv = excluded.tipo_pratica_csv,
      contesto = excluded.contesto, esito_csv = excluded.esito_csv, motivo_fornitore = NULL,
      lease = NULL, lease_until = NULL, riprova_at = NULL;
    DELETE FROM public.vendita_stati_verifica_manuale WHERE contratto_id = pratica.id AND stato = 'in_attesa_csv';

    IF motivo IS NULL THEN pronti := pronti + 1;
    ELSE da_verificare := da_verificare + 1;
    END IF;
  END LOOP;
  PERFORM set_config('mirox.energia_importazione', importazione_precedente, true);
  PERFORM set_config('mirox.verifica_commit', verifica_precedente, true);
  RETURN jsonb_build_object('in_attesa_verifica', pronti, 'da_verificare', da_verificare);
END;
$$;
REVOKE ALL ON FUNCTION mirox_private.energia_compila_da_csv(uuid[],jsonb,uuid,timestamptz,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mirox_private.energia_compila_da_csv(uuid[],jsonb,uuid,timestamptz,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vendita_energia_importa_csv(p_hash text, p_autore uuid, p_righe jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  fonte public.vendita_energia_csv%ROWTYPE;
  totale integer;
  aggiornati integer;
  protetti integer;
  pratiche uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_autore IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_righe) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CSV non valido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_righe) NOT BETWEEN 1 AND 60000 THEN
    RAISE EXCEPTION 'Numero righe CSV non valido' USING ERRCODE = '22023';
  END IF;
  -- Come nella conferma: blocca prima il contratto, poi la fonte condivisa.
  -- Un retry dello stesso file può trovare nuove pratiche in attesa.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_righe) AS x(riga) WHERE riga ? 'tipo_pratica') THEN
    SELECT ARRAY(
      SELECT c.id FROM public.vendita_contratti c
      JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
      WHERE c.stato_controllo = 'da_controllare' AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
      ORDER BY c.id FOR NO KEY UPDATE OF c
    ) INTO pratiche;
  END IF;
  PERFORM pg_advisory_xact_lock(761258, 1);
  PERFORM public.vendita_energia_importa_tipi(p_righe);
  SELECT * INTO fonte FROM public.vendita_energia_csv WHERE singleton;
  IF fonte.sha256 = p_hash THEN
    RETURN jsonb_build_object('duplicato', true, 'aggiornati', 0, 'protetti', 0)
      || mirox_private.energia_compila_da_csv(pratiche, p_righe, fonte.id, fonte.caricato_at, p_autore);
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
    'corrispondenze', totale, 'caricato_at', fonte.caricato_at)
    || mirox_private.energia_compila_da_csv(pratiche, p_righe, fonte.id, fonte.caricato_at, p_autore);
END;
$$;

COMMIT;
