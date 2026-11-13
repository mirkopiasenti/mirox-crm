-- Testi popup richiesti04/11/2026. Solo descrizioni da novembre2026 in avanti.
-- I popup esistenti convertono i caratteri newline reali in <br>.
-- Nessun cambiamento a obiettivi, compensi, scope, catalogo o periodi storici.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $info_gare$
DECLARE
  applica boolean := false;
  nl text := chr(10);
  modello jsonb := '[]'::jsonb;
  r record;
  prima text;
  dopo text;
  numero integer;
  mancanti integer;
  aggiornati integer;
  ids bigint[];
  hash_finanziario text;
  hash_altri text;
  hash_catalogo text;
  hash_profili text;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.gara_obiettivi_mensili IN SHARE ROW EXCLUSIVE MODE;
  FOR r IN SELECT m.id,m.nome,m.descrizione,
      (SELECT o.compenso_regola#>>'{gara,descrizione}' FROM public.gara_obiettivi_mensili o
       WHERE o.anno=2026 AND o.mese=10 AND o.metrica_id=m.id ORDER BY o.id LIMIT 1) override_ottobre
    FROM public.gara_metriche m WHERE m.attiva AND m.tabella='gara_individuale'
      AND m.nome IN ('ATTIVAZIONI TIED','COSTUMER BASE','PARTITA IVA','ASSICURAZIONI','W3 PROTETTI')
    ORDER BY m.id
  LOOP
    prima := replace(coalesce(r.override_ottobre,r.descrizione,''),'Francesca','Vincenzo');
    IF prima='' THEN RAISE EXCEPTION 'Descrizione sorgente assente per%',r.nome; END IF;
    dopo := CASE r.nome
      WHEN 'ATTIVAZIONI TIED' THEN replace(prima,'individuali. Comprende','individuali.'||nl||nl||'Comprende')
      WHEN 'COSTUMER BASE' THEN 'Bonus 100 EUR'||nl||nl||'35 Telefoni CB (VAR e Finanziati)'||nl||'15 cambi piano Mobile (esclusi SOS Caring)'
      WHEN 'PARTITA IVA' THEN 'BONUS DI SQUADRA'||nl||nl||prima
      WHEN 'ASSICURAZIONI' THEN 'BONUS DI SQUADRA'||nl||nl||'50 EUR --> 10 PUNTI'
      WHEN 'W3 PROTETTI' THEN prima||nl||nl||'50€ --> PER OGNI PROTECTA BUSINESS'
    END;
    IF dopo IS NOT DISTINCT FROM prima OR dopo IS NULL THEN
      RAISE EXCEPTION 'Testo sorgente inatteso per%',r.nome;
    END IF;
    modello := modello||jsonb_build_array(jsonb_build_object('metrica_id',r.id,'nome',r.nome,'prima',prima,'dopo',dopo));
  END LOOP;
  IF jsonb_array_length(modello)<>5 THEN RAISE EXCEPTION 'Attese5metriche info univoche'; END IF;
  SELECT array_agg(o.id ORDER BY o.id),count(*) INTO ids,numero
    FROM public.gara_obiettivi_mensili o
    JOIN jsonb_to_recordset(modello) t(metrica_id bigint) ON t.metrica_id=o.metrica_id
    WHERE (o.anno,o.mese)>=(2026,11);
  IF numero<>11570 THEN RAISE EXCEPTION 'Attese11570descrizioni mensili, trovate%',numero; END IF;
  IF EXISTS (SELECT 1 FROM public.gara_obiettivi_mensili WHERE id=ANY(ids)
    GROUP BY anno,mese HAVING count(*)<>13)
    OR (SELECT count(DISTINCT(anno,mese)) FROM public.gara_obiettivi_mensili WHERE id=ANY(ids))<>890 THEN
    RAISE EXCEPTION 'Attese13descrizioni in ciascuno degli890mesi';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gara_obiettivi_mensili o
    JOIN public.gara_metriche m ON m.id=o.metrica_id
    JOIN jsonb_to_recordset(modello) t(metrica_id bigint,prima text,dopo text) ON t.metrica_id=o.metrica_id
    WHERE o.id=ANY(ids) AND (coalesce(o.compenso_regola#>>'{gara,descrizione}',m.descrizione,'') NOT IN (t.prima,t.dopo)
      OR o.compenso_regola?'gara' AND jsonb_typeof(o.compenso_regola->'gara')<>'object')) THEN
    RAISE EXCEPTION 'Descrizione futura diversa dal preflight: non sovrascrivere';
  END IF;
  SELECT count(*) INTO mancanti FROM public.gara_obiettivi_mensili o
    JOIN jsonb_to_recordset(modello) t(metrica_id bigint,dopo text) ON t.metrica_id=o.metrica_id
    WHERE o.id=ANY(ids) AND o.compenso_regola#>>'{gara,descrizione}' IS DISTINCT FROM t.dopo;
  IF NOT applica THEN
    RAISE NOTICE 'Preflight OK:5testi,11570righe,%da aggiornare; nessuna scrittura',mancanti;
    RETURN;
  END IF;

  -- Normalizza soltanto descrizione e timestamp; ogni altro campo deve essere identico.
  SELECT md5(string_agg(md5(((to_jsonb(o)-'updated_at'-'compenso_regola')||jsonb_build_object('compenso_regola',
      (o.compenso_regola-'gara')||CASE WHEN coalesce(o.compenso_regola->'gara','{}'::jsonb)-'descrizione'='{}'::jsonb
      THEN '{}'::jsonb ELSE jsonb_build_object('gara',(o.compenso_regola->'gara')-'descrizione') END))::text),'' ORDER BY o.id))
    INTO hash_finanziario FROM public.gara_obiettivi_mensili o WHERE o.id=ANY(ids);
  SELECT md5(string_agg(md5(to_jsonb(o)::text),'' ORDER BY o.id)) INTO hash_altri
    FROM public.gara_obiettivi_mensili o WHERE NOT(o.id=ANY(ids));
  SELECT md5(string_agg(md5(to_jsonb(m)::text),'' ORDER BY id)) INTO hash_catalogo FROM public.gara_metriche m;
  SELECT md5(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id)) INTO hash_profili FROM public.profili p;

  UPDATE public.gara_obiettivi_mensili o SET compenso_regola=o.compenso_regola||jsonb_build_object('gara',
    coalesce(o.compenso_regola->'gara','{}'::jsonb)||jsonb_build_object('descrizione',t.dopo))
    FROM jsonb_to_recordset(modello) t(metrica_id bigint,dopo text)
    WHERE o.id=ANY(ids) AND o.metrica_id=t.metrica_id
      AND o.compenso_regola#>>'{gara,descrizione}' IS DISTINCT FROM t.dopo;
  GET DIAGNOSTICS aggiornati=ROW_COUNT;
  IF aggiornati<>mancanti THEN RAISE EXCEPTION 'Aggiornamento incompleto: attesi%,trovati%',mancanti,aggiornati; END IF;
  SELECT count(*) INTO numero FROM public.gara_obiettivi_mensili o
    JOIN jsonb_to_recordset(modello) t(metrica_id bigint,dopo text) ON t.metrica_id=o.metrica_id
    WHERE o.id=ANY(ids) AND o.compenso_regola#>>'{gara,descrizione}'=t.dopo;
  IF numero<>11570 THEN RAISE EXCEPTION 'Attese11570descrizioni aggiornate, trovate%',numero; END IF;
  IF (SELECT md5(string_agg(md5(((to_jsonb(o)-'updated_at'-'compenso_regola')||jsonb_build_object('compenso_regola',
      (o.compenso_regola-'gara')||CASE WHEN coalesce(o.compenso_regola->'gara','{}'::jsonb)-'descrizione'='{}'::jsonb
      THEN '{}'::jsonb ELSE jsonb_build_object('gara',(o.compenso_regola->'gara')-'descrizione') END))::text),'' ORDER BY o.id))
      FROM public.gara_obiettivi_mensili o WHERE o.id=ANY(ids)) IS DISTINCT FROM hash_finanziario
    OR (SELECT md5(string_agg(md5(to_jsonb(o)::text),'' ORDER BY o.id)) FROM public.gara_obiettivi_mensili o
      WHERE NOT(o.id=ANY(ids))) IS DISTINCT FROM hash_altri
    OR (SELECT md5(string_agg(md5(to_jsonb(m)::text),'' ORDER BY id)) FROM public.gara_metriche m) IS DISTINCT FROM hash_catalogo
    OR (SELECT md5(string_agg(md5(to_jsonb(p)::text),'' ORDER BY id)) FROM public.profili p) IS DISTINCT FROM hash_profili THEN
    RAISE EXCEPTION 'Modifica estranea ai testi: annullamento completo';
  END IF;
  RAISE NOTICE 'Info aggiornate:%righe; calcoli/storico/catalogo/profili identici',aggiornati;
END;
$info_gare$;
COMMIT;

SELECT m.nome,o.compenso_regola#>>'{gara,descrizione}' AS testo_popup,count(*) AS righe_novembre
FROM public.gara_obiettivi_mensili o JOIN public.gara_metriche m ON m.id=o.metrica_id
WHERE o.anno=2026 AND o.mese=11 AND m.tabella='gara_individuale'
  AND m.nome IN ('ATTIVAZIONI TIED','COSTUMER BASE','PARTITA IVA','ASSICURAZIONI','W3 PROTETTI')
GROUP BY m.id,m.nome,testo_popup ORDER BY m.id;
