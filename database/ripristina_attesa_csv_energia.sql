-- Intervento dati una tantum dopo energia_verifica_solo_csv.
-- La transazione di prova termina in rollback. Per applicare, impostare
-- mirox.energia_reset_applica = 'yes' e mirox.energia_reset_impronta
-- con l'impronta del salvataggio privato, poi terminare con COMMIT.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '6s';
SET LOCAL statement_timeout = '25s';

DO $ripristino$
DECLARE
  ids uuid[];
  attesa text := nullif(current_setting('mirox.energia_reset_impronta', true), '');
  impronta text;
  prima jsonb;
  dopo jsonb;
  passaggio integer;
  aggiornate integer;
  esiti_manuali integer;
  con_numero integer;
  con_fornitore integer;
BEGIN
  SELECT ARRAY(
    SELECT c.id FROM public.vendita_contratti c
    JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
    WHERE c.stato_controllo = 'da_controllare' AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot)
    ORDER BY c.id FOR NO KEY UPDATE OF c
  ) INTO ids;
  PERFORM pg_advisory_xact_lock(761258, 1);

  IF cardinality(ids) = 0 OR EXISTS (SELECT 1 FROM public.post_vendita_controllo_lg WHERE contratto_id = ANY(ids)) THEN
    RAISE EXCEPTION 'Perimetro delle pratiche Energia inatteso';
  END IF;
  IF public.vendita_energia_prossimo_gestore(false) IS NOT NULL THEN
    RAISE EXCEPTION 'La coda precedente deve essere disattivata';
  END IF;
  SELECT md5(jsonb_agg(jsonb_build_array(c.id,c.numero_contratto_energia,c.ex_fornitore,c.updated_at,to_jsonb(m))
    ORDER BY c.id)::text),
    count(*) FILTER (WHERE c.numero_contratto_energia IS NOT NULL),
    count(*) FILTER (WHERE c.ex_fornitore IS NOT NULL)
    INTO impronta, con_numero, con_fornitore
    FROM public.vendita_contratti c LEFT JOIN public.vendita_stati_verifica_manuale m ON m.contratto_id = c.id
    WHERE c.id = ANY(ids);
  IF attesa IS DISTINCT FROM impronta
    AND (attesa IS NOT NULL OR current_setting('mirox.energia_reset_applica', true) = 'yes') THEN
    RAISE EXCEPTION 'Pratiche modificate dopo il salvataggio privato. Aggiornamento annullato';
  END IF;

  FOR passaggio IN 1..2 LOOP
    SELECT jsonb_build_object(
      'contratti', (SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text) FROM public.vendita_contratti c WHERE NOT (c.id = ANY(ids))),
      'altri_campi_pendenti', (SELECT md5(jsonb_agg(to_jsonb(c) - ARRAY['numero_contratto_energia','ex_fornitore','updated_at']
        ORDER BY c.id)::text) FROM public.vendita_contratti c WHERE c.id = ANY(ids)),
      'documenti', (SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text) FROM public.vendita_documenti d),
      'luce_gas', (SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text) FROM public.post_vendita_controllo_lg l),
      'esiti_manuali_altrui', (SELECT md5(jsonb_agg(to_jsonb(m) ORDER BY m.contratto_id)::text)
        FROM public.vendita_stati_verifica_manuale m WHERE NOT (m.contratto_id = ANY(ids))),
      'riscontri_altrui', (SELECT md5(jsonb_agg(to_jsonb(v) ORDER BY v.contratto_id)::text)
        FROM public.vendita_energia_verifiche v WHERE NOT (v.contratto_id = ANY(ids))),
      'verifica_documentale', (SELECT md5(jsonb_agg(to_jsonb(v) ORDER BY v.contratto_id)::text) FROM public.vendita_verifiche v),
      'fonte', (SELECT md5(to_jsonb(f)::text) FROM public.vendita_energia_csv f WHERE f.singleton),
      'righe_csv', (SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY r.numero,r.punto,r.cf,r.piva)::text) FROM public.vendita_energia_csv_righe r),
      'tipi_acquisiti', (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY t.punto,t.fiscale_hash,t.numero)::text) FROM mirox_private.energia_tipi_csv t)
    ) INTO dopo;
    IF passaggio = 2 THEN
      IF prima IS DISTINCT FROM dopo THEN
        RAISE EXCEPTION 'Il ripristino ha toccato dati esterni al perimetro. Aggiornamento annullato';
      END IF;
      EXIT;
    END IF;
    prima := dopo;
    PERFORM set_config('mirox.verifica_commit', 'yes', true);
    PERFORM set_config('mirox.energia_importazione', 'yes', true);
    UPDATE public.vendita_contratti SET numero_contratto_energia = NULL, ex_fornitore = NULL
      WHERE id = ANY(ids) AND (numero_contratto_energia IS NOT NULL OR ex_fornitore IS NOT NULL);
    GET DIAGNOSTICS aggiornate = ROW_COUNT;
    DELETE FROM public.vendita_stati_verifica_manuale WHERE contratto_id = ANY(ids);
    GET DIAGNOSTICS esiti_manuali = ROW_COUNT;
    DELETE FROM public.vendita_energia_verifiche WHERE contratto_id = ANY(ids);
    INSERT INTO public.vendita_energia_verifiche (contratto_id) SELECT unnest(ids);
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.vendita_contratti c
    LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id = c.id
    WHERE c.id = ANY(ids) AND (c.numero_contratto_energia IS NOT NULL OR c.ex_fornitore IS NOT NULL
      OR v.stato IS DISTINCT FROM 'in_attesa_csv' OR public.tipo_pratica_energia(c) IS NOT NULL
      OR jsonb_strip_nulls(to_jsonb(v) - ARRAY['contratto_id','stato']) <> '{}'::jsonb))
  THEN RAISE EXCEPTION 'Ripristino incompleto'; END IF;
  PERFORM set_config('mirox.energia_reset_risultato',
    jsonb_build_object('in_attesa_csv', cardinality(ids), 'contratti_ripuliti', aggiornate,
      'numeri_svuotati', con_numero, 'fornitori_svuotati', con_fornitore,
      'esiti_manuali_rimossi', esiti_manuali, 'impronta', impronta)::text, true);
END
$ripristino$;

SELECT current_setting('mirox.energia_reset_risultato')::jsonb AS risultato;
ROLLBACK;
