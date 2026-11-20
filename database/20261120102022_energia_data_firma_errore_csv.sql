BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.vendita_energia_verifiche
  DROP CONSTRAINT vendita_energia_verifiche_stato_check,
  ADD CONSTRAINT vendita_energia_verifiche_stato_check
    CHECK (stato IN ('in_attesa_csv', 'in_attesa_verifica', 'da_verificare', 'errore_csv')),
  ADD CONSTRAINT vendita_energia_verifiche_errore_csv_nota_check
    CHECK (stato <> 'errore_csv' OR nullif(btrim(nota_csv), '') IS NOT NULL);

-- Riclassifica gli errori del vecchio import nelle sole pratiche ancora aperte.
-- Le decisioni manuali nella tabella separata mantengono la precedenza.
UPDATE public.vendita_energia_verifiche v SET stato = 'errore_csv'
FROM public.vendita_contratti c
JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
WHERE v.contratto_id = c.id
  AND c.stato_controllo = 'da_controllare'
  AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
  AND v.stato = 'da_verificare'
  AND v.motivo_csv IS NOT NULL
  AND nullif(btrim(v.nota_csv), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION mirox_private.energia_scegli_proposta(p_righe jsonb, p_giorno text, p_fiscale text, p_business boolean)
RETURNS TABLE(numero text, tipo text, motivo text, nota text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH righe AS MATERIALIZED (
    SELECT * FROM jsonb_to_recordset(coalesce(p_righe, '[]'::jsonb))
      AS r(numero text, tipo_pratica text, cf text, piva text, data_firma text, stato text)
  ), per_data AS MATERIALIZED (
    SELECT r.* FROM righe r
    WHERE r.data_firma = p_giorno
  ), per_fiscale AS MATERIALIZED (
    SELECT r.* FROM per_data r
    WHERE (SELECT count(*) FROM per_data) = 1
      OR (p_fiscale <> '' AND p_fiscale = CASE WHEN p_business THEN r.piva ELSE r.cf END)
  ), per_stato AS (
    SELECT r.* FROM per_fiscale r
    WHERE (SELECT count(*) FROM per_fiscale) = 1 OR lower(trim(coalesce(r.stato, ''))) <> 'annullato'
  ), finale AS (
    SELECT count(*) AS totale, min(nullif(r.numero,'')) AS codice, min(nullif(r.tipo_pratica,'')) AS tipo_pratica
    FROM per_stato r
  )
  SELECT CASE WHEN totale = 1 THEN codice END, CASE WHEN totale = 1 THEN tipo_pratica END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM righe) THEN 'csv_non_trovato'
      WHEN totale <> 1 OR codice IS NULL OR tipo_pratica IS NULL THEN 'csv_ambiguo' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM righe) THEN 'Il POD/PDR inserito non è presente nel CSV WindTre caricato.'
      WHEN NOT EXISTS (SELECT 1 FROM righe WHERE data_firma IS NOT NULL AND data_firma <> '')
        THEN 'La Data Firma (colonna M) manca o non è valida per questo POD/PDR.'
      WHEN NOT EXISTS (SELECT 1 FROM per_data)
        THEN 'Per questo POD/PDR nessuna riga del CSV ha la Data Firma (colonna M) uguale alla Data Inserimento Mirox.'
      WHEN NOT EXISTS (SELECT 1 FROM per_fiscale) THEN 'Nessuna riga rimasta per questo POD/PDR ha lo stesso codice fiscale o P.IVA della pratica.'
      WHEN totale = 0 THEN 'Le righe rimaste per questo POD/PDR sono tutte Annullato.'
      WHEN totale > 1 THEN 'Restano più righe per questo POD/PDR dopo i controlli su data, codice fiscale o P.IVA e stato Annullato.'
      WHEN codice IS NULL OR tipo_pratica IS NULL THEN 'Nella riga CSV individuata manca il numero contratto o il tipo pratica.' END
  FROM finale;
$$;
REVOKE ALL ON FUNCTION mirox_private.energia_scegli_proposta(jsonb,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mirox_private.energia_scegli_proposta(jsonb,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION mirox_private.energia_compila_da_csv(p_pratiche uuid[], p_righe jsonb, p_fonte uuid, p_data timestamptz, p_autore uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  pratica record;
  motivo text;
  nota text;
  esito_lg jsonb;
  pronti integer := 0;
  errori_csv integer := 0;
  importazione_precedente text := coalesce(current_setting('mirox.energia_importazione', true), '');
  verifica_precedente text := coalesce(current_setting('mirox.verifica_commit', true), '');
BEGIN
  IF cardinality(p_pratiche) = 0 THEN
    RETURN jsonb_build_object('in_attesa_verifica', 0, 'errore_csv', 0, 'da_verificare', 0);
  END IF;

  PERFORM set_config('mirox.energia_importazione', 'yes', true);
  PERFORM set_config('mirox.verifica_commit', 'yes', true);
  FOR pratica IN
    WITH per_punto AS (
      SELECT r.punto, jsonb_agg(jsonb_build_object('numero', r.numero, 'cf', r.cf, 'piva', r.piva) || variante.riga) AS righe
      FROM jsonb_to_recordset(p_righe) AS r(punto text, numero text, cf text, piva text,
        tipo_pratica text, stato text, varianti_verifica jsonb)
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.varianti_verifica,
        jsonb_build_array(jsonb_build_object('tipo_pratica', r.tipo_pratica, 'stato', r.stato)))) AS variante(riga)
      WHERE r.punto <> ''
      GROUP BY r.punto
    ), decisioni AS MATERIALIZED (
      SELECT c.id, k.punto, f.fiscale, f.business, scelta.*
      FROM public.vendita_contratti c
      LEFT JOIN public.anagrafica a ON a.id = c.anagrafica_id
      CROSS JOIN LATERAL (SELECT mirox_private.energia_codice(c.pod_pdr) AS punto,
        trim(coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster, '')) AS cluster) k
      CROSS JOIN LATERAL (SELECT mirox_private.energia_fiscale(a.cf_piva, k.cluster) AS fiscale,
        lower(k.cluster) = 'business' AS business) f
      LEFT JOIN per_punto r ON r.punto = k.punto
      LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id = c.id
      LEFT JOIN public.vendita_stati_verifica_manuale m ON m.contratto_id = c.id
      CROSS JOIN LATERAL mirox_private.energia_scegli_proposta(r.righe,
        to_char(coalesce(c.data_contratto, c.created_at) AT TIME ZONE 'Europe/Rome', 'YYYY-MM-DD'),
        f.fiscale, f.business) scelta
      WHERE c.id = ANY(p_pratiche)
        AND (coalesce(m.stato, v.stato, 'in_attesa_csv') = 'in_attesa_csv'
          OR (m.contratto_id IS NULL AND v.stato = 'errore_csv'))
    )
    SELECT d.*, d.motivo IS NULL AND (
      EXISTS (SELECT 1 FROM decisioni x WHERE x.id <> d.id AND x.motivo IS NULL AND x.punto = d.punto AND x.numero = d.numero)
      OR EXISTS (
        SELECT 1 FROM public.vendita_contratti c
        JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
        WHERE c.id <> d.id AND c.pod_pdr IS NOT NULL
          AND upper(regexp_replace(c.pod_pdr, '[[:space:]]+', '', 'g')) = d.punto
          AND mirox_private.energia_codice(c.numero_contratto_energia) = d.numero
          AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
      )) AS proposta_condivisa
    FROM decisioni d
    ORDER BY d.id
  LOOP
    motivo := pratica.motivo;
    nota := pratica.nota;
    esito_lg := NULL;
    IF pratica.proposta_condivisa THEN
      motivo := 'csv_ambiguo';
      nota := 'La stessa proposta WindTre per questo POD/PDR è associata o compatibile con più pratiche nel CRM.';
    END IF;
    IF motivo IS NULL THEN
      UPDATE public.vendita_contratti SET numero_contratto_energia = pratica.numero, updated_by = p_autore
      WHERE id = pratica.id AND numero_contratto_energia IS DISTINCT FROM pratica.numero;
      SELECT to_jsonb(r) || jsonb_build_object('csv_at', p_data, 'csv_da', p_autore) INTO esito_lg
      FROM mirox_private.energia_esito_lg(pratica.numero, pratica.punto, pratica.fiscale, pratica.business, false) r;
    END IF;

    INSERT INTO public.vendita_energia_verifiche AS v
      (contratto_id, stato, motivo, motivo_csv, nota_csv, csv_id, csv_at, riscontro, tipo_pratica_csv, contesto, esito_csv)
    VALUES (pratica.id, CASE WHEN motivo IS NULL THEN 'in_attesa_verifica' ELSE 'errore_csv' END,
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
    ELSE errori_csv := errori_csv + 1;
    END IF;
  END LOOP;
  PERFORM set_config('mirox.energia_importazione', importazione_precedente, true);
  PERFORM set_config('mirox.verifica_commit', verifica_precedente, true);
  -- Il vecchio contatore resta disponibile durante il passaggio del frontend.
  RETURN jsonb_build_object('in_attesa_verifica', pronti, 'errore_csv', errori_csv, 'da_verificare', errori_csv);
END;
$$;

COMMIT;
