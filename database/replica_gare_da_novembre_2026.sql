-- Richiesta04/11/2026: intera scheda Gare Individuali di ottobre in tutti i mesi
-- successivi. Il CRM ammette anni2024..2100: novembre2026..dicembre2100,
-- 890mesi x22configurazioni =19580righe. Nessuno schema/cron/codice da cambiare.
-- Francesca -> Vincenzo SOLO nei destinatari, nell'allowlist e nella descrizione.
-- Default preflight. Non sovrascrive configurazioni future discordanti.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $replica_gare$
DECLARE
  applica boolean := false;
  francesca constant uuid := '0284cf55-d97a-4709-9ece-d3f4894b80a7';
  vincenzo constant uuid := 'c8c45da2-0cda-41eb-86cc-0272b8baa200';
  matteo constant uuid := '53f8fdfc-0595-4864-af49-5090bf3177db';
  mirko constant uuid := '3785e971-03a3-4598-8f19-15ef80a5f5fa';
  modello jsonb := '[]'::jsonb;
  regola jsonb;
  r record;
  numero integer;
  mancanti integer;
  inseriti integer;
  ids_precedenti bigint[];
  hash_precedenti text;
  hash_catalogo text;
  hash_profili text;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.gara_obiettivi_mensili IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.gara_obiettivi_mensili'::regclass
    AND conname='gom_anno_chk' AND pg_get_constraintdef(oid) LIKE '%2100%') THEN
    RAISE EXCEPTION 'Limite anni del CRM diverso dal preflight: rileggere il perimetro';
  END IF;
  SELECT count(*) INTO numero FROM public.profili
    WHERE id IN (vincenzo,matteo,mirko) AND attivo AND in_gara AND alias_di IS NULL;
  IF numero<>3 OR NOT EXISTS (SELECT 1 FROM public.profili WHERE id=francesca
    AND NOT attivo AND NOT in_gara AND alias_di IS NULL) THEN
    RAISE EXCEPTION 'Avvicendamento operatori diverso dal preflight';
  END IF;
  SELECT count(*) INTO numero FROM public.gara_obiettivi_mensili o
    JOIN public.gara_metriche m ON m.id=o.metrica_id
    WHERE o.anno=2026 AND o.mese=10 AND m.tabella='gara_individuale' AND m.attiva;
  IF numero<>22 THEN RAISE EXCEPTION 'Attese22configurazioni Gara Individuale ottobre, trovate%',numero; END IF;
  IF EXISTS (SELECT 1 FROM public.gara_obiettivi_mensili o JOIN public.gara_metriche m ON m.id=o.metrica_id
    WHERE o.anno=2026 AND o.mese=10 AND m.tabella='gara_individuale' AND m.attiva
      AND (o.operatore_id IS NOT NULL AND o.operatore_id NOT IN (francesca,matteo,mirko)
        OR o.operatore_id IS NULL AND m.nome<>'PARTITA IVA')) THEN
    RAISE EXCEPTION 'Destinatari ottobre inattesi';
  END IF;
  SELECT count(*) INTO numero FROM (SELECT o.operatore_id,count(*) n
    FROM public.gara_obiettivi_mensili o JOIN public.gara_metriche m ON m.id=o.metrica_id
    WHERE o.anno=2026 AND o.mese=10 AND m.tabella='gara_individuale' AND m.attiva
      AND o.operatore_id IS NOT NULL GROUP BY o.operatore_id HAVING count(*)=7) s;
  IF numero<>3 THEN RAISE EXCEPTION 'Attese7righe per ciascuno dei3operatori'; END IF;

  FOR r IN SELECT o.*,m.nome FROM public.gara_obiettivi_mensili o
    JOIN public.gara_metriche m ON m.id=o.metrica_id
    WHERE o.anno=2026 AND o.mese=10 AND m.tabella='gara_individuale' AND m.attiva
    ORDER BY m.id,o.operatore_id
  LOOP
    IF r.nome='ATTIVAZIONI TIED' AND (r.obiettivo<>35 OR r.compenso_regola#>>'{scaglioni,0,da}' IS DISTINCT FROM '35'
      OR r.compenso_regola#>>'{scaglioni,0,importo}' IS DISTINCT FROM '100') THEN
      RAISE EXCEPTION 'TIED ottobre diverso dal35/100richiesto';
    END IF;
    IF r.nome IN ('COSTUMER BASE','TELEFONI CB') AND (r.obiettivo<>35
      OR r.compenso_regola->>'tipo' IS DISTINCT FROM 'obiettivi_combinati'
      OR r.compenso_regola->>'importo' IS DISTINCT FROM '100'
      OR r.compenso_regola#>>'{condizioni,0,soglia}' IS DISTINCT FROM '35'
      OR r.compenso_regola#>>'{condizioni,1,soglia}' IS DISTINCT FROM '15') THEN
      RAISE EXCEPTION 'Customer Base ottobre diverso dal35+15/100richiesto';
    END IF;
    IF r.nome='ASSICURAZIONI' AND (r.obiettivo<>10
      OR r.compenso_regola#>>'{gara,tipo_conteggio}' IS DISTINCT FROM 'squadra'
      OR r.compenso_regola#>>'{gara,punteggio_campo}' IS DISTINCT FROM 'punteggio_gara_totale'
      OR r.compenso_regola#>>'{scaglioni,0,importo}' IS DISTINCT FROM '50'
      OR (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(r.compenso_regola#>'{gara,operatori}'))
         IS DISTINCT FROM (SELECT array_agg(id::text ORDER BY id::text) FROM unnest(ARRAY[francesca,matteo,mirko]) id)) THEN
      RAISE EXCEPTION 'Assicurazioni ottobre diverse dalla squadra10punti/50EUR';
    END IF;
    regola := r.compenso_regola;
    IF regola#>'{gara,operatori}' IS NOT NULL THEN
      regola := jsonb_set(regola,'{gara,operatori}',(SELECT jsonb_agg(
        CASE WHEN value=to_jsonb(francesca::text) THEN to_jsonb(vincenzo::text) ELSE value END ORDER BY ordinalita)
        FROM jsonb_array_elements(regola#>'{gara,operatori}') WITH ORDINALITY a(value,ordinalita)));
    END IF;
    IF regola#>>'{gara,descrizione}' IS NOT NULL THEN
      regola := jsonb_set(regola,'{gara,descrizione}',to_jsonb(replace(regola#>>'{gara,descrizione}','Francesca','Vincenzo')));
    END IF;
    IF regola::text LIKE '%'||francesca::text||'%' OR regola::text LIKE '%Francesca%' THEN
      RAISE EXCEPTION 'Riferimento uscente residuo nella regola futura';
    END IF;
    modello := modello||jsonb_build_array(jsonb_build_object('metrica_id',r.metrica_id,
      'operatore_id',CASE WHEN r.operatore_id=francesca THEN vincenzo ELSE r.operatore_id END,
      'obiettivo',r.obiettivo,'compenso_regola',regola));
  END LOOP;

  WITH attesi AS (SELECT extract(year FROM d)::smallint anno,extract(month FROM d)::smallint mese,t.*
    FROM generate_series(timestamp '2026-11-01',timestamp '2100-12-01',interval '1 month') d
    CROSS JOIN jsonb_to_recordset(modello) t(metrica_id bigint,operatore_id uuid,obiettivo integer,compenso_regola jsonb))
  SELECT count(*) FILTER (WHERE o.id IS NULL),count(*) FILTER (WHERE o.id IS NOT NULL
    AND (o.obiettivo<>a.obiettivo OR o.compenso_regola IS DISTINCT FROM a.compenso_regola))
    INTO mancanti,numero FROM attesi a LEFT JOIN public.gara_obiettivi_mensili o
      ON o.anno=a.anno AND o.mese=a.mese AND o.metrica_id=a.metrica_id
      AND coalesce(o.operatore_id,'00000000-0000-0000-0000-000000000000'::uuid)
        =coalesce(a.operatore_id,'00000000-0000-0000-0000-000000000000'::uuid);
  IF numero<>0 THEN RAISE EXCEPTION '%obiettivi futuri discordanti: non sovrascrivere',numero; END IF;
  IF EXISTS (SELECT 1 FROM public.gara_obiettivi_mensili o JOIN public.gara_metriche m ON m.id=o.metrica_id
    WHERE (o.anno,o.mese)>=(2026,11) AND m.tabella='gara_individuale' AND o.operatore_id=francesca) THEN
    RAISE EXCEPTION 'Obiettivi futuri attribuiti a Francesca: verificare senza cancellare';
  END IF;
  IF NOT applica THEN
    RAISE NOTICE 'Preflight OK:22regole,890mesi,19580destinazioni,%righe mancanti; nessuna scrittura',mancanti;
    RETURN;
  END IF;
  SELECT array_agg(o.id ORDER BY o.id),md5(string_agg(md5(to_jsonb(o)::text),'' ORDER BY o.id))
    INTO ids_precedenti,hash_precedenti FROM public.gara_obiettivi_mensili o;
  SELECT md5(string_agg(md5(to_jsonb(m)::text),'' ORDER BY id)) INTO hash_catalogo FROM public.gara_metriche m;
  SELECT md5(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id)) INTO hash_profili FROM public.profili p;

  WITH attesi AS (SELECT extract(year FROM d)::smallint anno,extract(month FROM d)::smallint mese,t.*
    FROM generate_series(timestamp '2026-11-01',timestamp '2100-12-01',interval '1 month') d
    CROSS JOIN jsonb_to_recordset(modello) t(metrica_id bigint,operatore_id uuid,obiettivo integer,compenso_regola jsonb))
  INSERT INTO public.gara_obiettivi_mensili(anno,mese,metrica_id,operatore_id,obiettivo,compenso_regola)
    SELECT a.* FROM attesi a WHERE NOT EXISTS (SELECT 1 FROM public.gara_obiettivi_mensili o
      WHERE o.anno=a.anno AND o.mese=a.mese AND o.metrica_id=a.metrica_id
      AND coalesce(o.operatore_id,'00000000-0000-0000-0000-000000000000'::uuid)
        =coalesce(a.operatore_id,'00000000-0000-0000-0000-000000000000'::uuid));
  GET DIAGNOSTICS inseriti=ROW_COUNT;
  IF inseriti<>mancanti THEN RAISE EXCEPTION 'Replica incompleta: attesi%,inseriti%',mancanti,inseriti; END IF;
  WITH attesi AS (SELECT extract(year FROM d)::smallint anno,extract(month FROM d)::smallint mese,t.*
    FROM generate_series(timestamp '2026-11-01',timestamp '2100-12-01',interval '1 month') d
    CROSS JOIN jsonb_to_recordset(modello) t(metrica_id bigint,operatore_id uuid,obiettivo integer,compenso_regola jsonb))
  SELECT count(*) INTO numero FROM attesi a JOIN public.gara_obiettivi_mensili o
    ON o.anno=a.anno AND o.mese=a.mese AND o.metrica_id=a.metrica_id
    AND coalesce(o.operatore_id,'00000000-0000-0000-0000-000000000000'::uuid)
      =coalesce(a.operatore_id,'00000000-0000-0000-0000-000000000000'::uuid)
    WHERE o.obiettivo=a.obiettivo AND o.compenso_regola=a.compenso_regola;
  IF numero<>19580 THEN RAISE EXCEPTION 'Attese19580configurazioni identiche al modello, trovate%',numero; END IF;
  IF (SELECT md5(string_agg(md5(to_jsonb(o)::text),'' ORDER BY o.id)) FROM public.gara_obiettivi_mensili o
      WHERE id=ANY(ids_precedenti)) IS DISTINCT FROM hash_precedenti
    OR (SELECT md5(string_agg(md5(to_jsonb(m)::text),'' ORDER BY id)) FROM public.gara_metriche m) IS DISTINCT FROM hash_catalogo
    OR (SELECT md5(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id)) FROM public.profili p) IS DISTINCT FROM hash_profili THEN
    RAISE EXCEPTION 'Modifica inattesa allo storico/catalogo/profili: annullamento';
  END IF;
  RAISE NOTICE 'Replica completata:19580regole in890mesi,%inserite; preesistenti/catalogo/profili identici',inseriti;
END;
$replica_gare$;
COMMIT;

SELECT o.anno,o.mese,count(*) AS configurazioni FROM public.gara_obiettivi_mensili o
  JOIN public.gara_metriche m ON m.id=o.metrica_id WHERE m.tabella='gara_individuale'
    AND (o.anno,o.mese) IN ((2026,10),(2026,11),(2026,12),(2027,1),(2100,12))
  GROUP BY o.anno,o.mese ORDER BY o.anno,o.mese;
