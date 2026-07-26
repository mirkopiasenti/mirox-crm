-- Migration 059
-- Consolida il doppione tecnico TEST/test emerso dal controllo case-insensitive.
-- Entrambe le righe sono dati di collaudo e non hanno relazioni operative;
-- si conserva il record più vecchio e si audita integralmente quello eliminato.

BEGIN;

DO $$
DECLARE
  v_survivor constant uuid := '03cf3323-3da0-45d5-9de3-87d64a651af2';
  v_loser constant uuid := '5a4c4708-dcbc-4609-8a03-f308ffaa651c';
  v_survivor_row public.anagrafica%ROWTYPE;
  v_loser_row public.anagrafica%ROWTYPE;
  r record;
  v_remaining bigint;
BEGIN
  SELECT * INTO v_survivor_row
  FROM public.anagrafica
  WHERE id = v_survivor;

  SELECT * INTO v_loser_row
  FROM public.anagrafica
  WHERE id = v_loser;

  IF v_survivor_row.id IS NULL
     OR v_loser_row.id IS NULL
     OR v_survivor_row.cf_piva IS DISTINCT FROM 'TEST'
     OR v_loser_row.cf_piva IS DISTINCT FROM 'test' THEN
    RAISE EXCEPTION
      'Bonifica TEST/test interrotta: dataset diverso da quello verificato';
  END IF;

  INSERT INTO public.vendita_log_modifiche (
    tabella,
    record_id,
    azione,
    dati_precedenti,
    dati_nuovi,
    created_by
  )
  VALUES (
    'anagrafica',
    v_loser,
    'merge_duplicate',
    to_jsonb(v_loser_row),
    jsonb_build_object(
      'survivor_id', v_survivor,
      'survivor_cf_piva', v_survivor_row.cf_piva,
      'migration', '059_deduplica_anagrafica_test_case'
    ),
    NULL
  );

  -- Aggiorna dinamicamente ogni FK reale, comprese eventuali FK additive
  -- introdotte in futuro ma già presenti quando la migration viene eseguita.
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_catalog = kcu.constraint_catalog
     AND tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_catalog = rc.constraint_catalog
     AND tc.constraint_schema = rc.constraint_schema
     AND tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_catalog = ccu.constraint_catalog
     AND rc.unique_constraint_schema = ccu.constraint_schema
     AND rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'anagrafica'
      AND ccu.column_name = 'id'
  LOOP
    EXECUTE format(
      'UPDATE %I.%I SET %I = $1 WHERE %I = $2',
      r.table_schema,
      r.table_name,
      r.column_name,
      r.column_name
    )
    USING v_survivor, v_loser;
  END LOOP;

  DELETE FROM public.anagrafica
  WHERE id = v_loser;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bonifica TEST/test incompleta: loser non eliminato';
  END IF;

  -- Verifica finale su tutte le FK effettive.
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_catalog = kcu.constraint_catalog
     AND tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_catalog = rc.constraint_catalog
     AND tc.constraint_schema = rc.constraint_schema
     AND tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_catalog = ccu.constraint_catalog
     AND rc.unique_constraint_schema = ccu.constraint_schema
     AND rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'anagrafica'
      AND ccu.column_name = 'id'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I WHERE %I = $1',
      r.table_schema,
      r.table_name,
      r.column_name
    )
    INTO v_remaining
    USING v_loser;

    IF v_remaining <> 0 THEN
      RAISE EXCEPTION
        'Bonifica TEST/test incompleta: %.%.% contiene ancora % riferimenti',
        r.table_schema,
        r.table_name,
        r.column_name,
        v_remaining;
    END IF;
  END LOOP;
END
$$;

COMMIT;
