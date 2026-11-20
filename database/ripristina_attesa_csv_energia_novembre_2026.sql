-- Operazione dati una tantum per Energia, mese di inserimento novembre 2026.
-- Richiede mirox.energia_novembre_impronta dal manifest privato. Dopo il
-- collaudo in rollback, impostare l'impronta e concludere con COMMIT.
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL lock_timeout = '6s';
SET LOCAL statement_timeout = '25s';

DO $ripristino$
DECLARE
  ids uuid[];
  attesa text := nullif(current_setting('mirox.energia_novembre_impronta', true), '');
  impronta text;
  righe jsonb;
  prima jsonb;
  dopo jsonb;
  passaggio integer;
  approvate integer;
  numeri integer;
  esiti_manuali integer;
  controlli_lg integer;
BEGIN
  SELECT ARRAY(
    SELECT c.id
    FROM public.vendita_contratti c JOIN public.vendita_pratiche p ON p.id=c.pratica_id AND p.stato_pratica='inviata'
    WHERE c.stato_controllo IN ('da_controllare','controllato')
      AND coalesce(c.data_contratto,c.created_at) >= TIMESTAMPTZ '2026-11-01 00:00:00 Europe/Rome'
      AND coalesce(c.data_contratto,c.created_at) < TIMESTAMPTZ '2026-12-01 00:00:00 Europe/Rome'
      AND mirox_private.energia_categoria(c.categoria_id,c.categoria_snapshot)
    ORDER BY c.id FOR NO KEY UPDATE OF c
  ) INTO ids;
  IF cardinality(ids) = 0 THEN RAISE EXCEPTION 'Perimetro Energia di novembre vuoto'; END IF;
  PERFORM pg_advisory_xact_lock(761258, 1);
  PERFORM l.id FROM public.post_vendita_controllo_lg l
    WHERE l.contratto_id = ANY(ids) ORDER BY l.id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE contype = 'f' AND confrelid IN ('public.post_vendita_controllo_lg'::regclass,
      'public.vendita_energia_verifiche'::regclass, 'public.vendita_stati_verifica_manuale'::regclass)
  ) THEN
    RAISE EXCEPTION 'Dipendenze inattese nel perimetro Energia';
  END IF;

  SELECT (SELECT jsonb_agg(jsonb_build_object(
   'contratto', jsonb_build_object('id',c.id,'stato_controllo',c.stato_controllo,
     'controllato_da',c.controllato_da,'controllato_at',c.controllato_at,
     'numero_contratto_energia',c.numero_contratto_energia,'updated_at',c.updated_at),
   'riscontro', to_jsonb(v), 'revisione', to_jsonb(m), 'controllo_lg', to_jsonb(l)) ORDER BY c.id)
   FROM public.vendita_contratti c
   LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id=c.id
   LEFT JOIN public.vendita_stati_verifica_manuale m ON m.contratto_id=c.id
   LEFT JOIN public.post_vendita_controllo_lg l ON l.contratto_id=c.id
   WHERE c.id = ANY(ids)) INTO righe;
  impronta := md5(righe::text);
  IF attesa IS DISTINCT FROM impronta THEN
    RAISE EXCEPTION 'Impronta del salvataggio privato assente o non più valida';
  END IF;

  SELECT count(*) FILTER (WHERE stato_controllo = 'controllato'),
    count(*) FILTER (WHERE numero_contratto_energia IS NOT NULL)
    INTO approvate, numeri
  FROM public.vendita_contratti WHERE id = ANY(ids);

  FOR passaggio IN 1..2 LOOP
    SELECT jsonb_build_object(
      'contratti_altrui', (SELECT md5(jsonb_agg(to_jsonb(c) ORDER BY c.id)::text)
        FROM public.vendita_contratti c WHERE NOT (c.id = ANY(ids))),
      'campi_preservati', (SELECT md5(jsonb_agg(to_jsonb(c)
        - ARRAY['stato_controllo','controllato_da','controllato_at','numero_contratto_energia','updated_at'] ORDER BY c.id)::text)
        FROM public.vendita_contratti c WHERE c.id = ANY(ids)),
      'pratiche', (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) FROM public.vendita_pratiche p),
      'documenti', (SELECT md5(jsonb_agg(to_jsonb(d) ORDER BY d.id)::text) FROM public.vendita_documenti d),
      'note_contratti', (SELECT md5(jsonb_agg(to_jsonb(n) ORDER BY n.id)::text) FROM public.vendita_note_contratto n),
      'luce_gas_altri_mesi', (SELECT md5(jsonb_agg(to_jsonb(l) ORDER BY l.id)::text)
        FROM public.post_vendita_controllo_lg l WHERE NOT (l.contratto_id = ANY(ids))),
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
        RAISE EXCEPTION 'Il ripristino ha toccato dati esterni al perimetro';
      END IF;
      EXIT;
    END IF;
    prima := dopo;
    PERFORM set_config('mirox.verifica_commit', 'yes', true);
    PERFORM set_config('mirox.energia_importazione', 'yes', true);

    UPDATE public.vendita_contratti
    SET stato_controllo = 'da_controllare', controllato_da = NULL, controllato_at = NULL,
        numero_contratto_energia = NULL
    WHERE id = ANY(ids) AND (stato_controllo <> 'da_controllare' OR controllato_da IS NOT NULL
      OR controllato_at IS NOT NULL OR numero_contratto_energia IS NOT NULL);
    DELETE FROM public.vendita_stati_verifica_manuale WHERE contratto_id = ANY(ids);
    GET DIAGNOSTICS esiti_manuali = ROW_COUNT;
    DELETE FROM public.post_vendita_controllo_lg WHERE contratto_id = ANY(ids);
    GET DIAGNOSTICS controlli_lg = ROW_COUNT;
    DELETE FROM public.vendita_energia_verifiche WHERE contratto_id = ANY(ids);
    INSERT INTO public.vendita_energia_verifiche (contratto_id) SELECT unnest(ids);
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM public.vendita_contratti c
    LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id = c.id
    WHERE c.id = ANY(ids) AND (c.stato_controllo <> 'da_controllare'
      OR c.controllato_da IS NOT NULL OR c.controllato_at IS NOT NULL
      OR c.numero_contratto_energia IS NOT NULL OR public.tipo_pratica_energia(c) IS NOT NULL
      OR v.stato IS DISTINCT FROM 'in_attesa_csv'
      OR jsonb_strip_nulls(to_jsonb(v) - ARRAY['contratto_id','stato']) <> '{}'::jsonb)
  ) OR EXISTS (SELECT 1 FROM public.vendita_stati_verifica_manuale WHERE contratto_id = ANY(ids))
    OR EXISTS (SELECT 1 FROM public.post_vendita_controllo_lg WHERE contratto_id = ANY(ids))
  THEN RAISE EXCEPTION 'Ripristino Energia incompleto'; END IF;

  PERFORM set_config('mirox.energia_novembre_risultato',
    jsonb_build_object('in_attesa_csv', cardinality(ids), 'riaperte_dai_verificati', approvate,
      'numeri_svuotati', numeri, 'esiti_manuali_azzerati', esiti_manuali,
      'righe_luce_gas_rimosse', controlli_lg, 'impronte_dati_preservati', dopo)::text, true);
END
$ripristino$;

SELECT current_setting('mirox.energia_novembre_risultato')::jsonb AS risultato;
ROLLBACK;
