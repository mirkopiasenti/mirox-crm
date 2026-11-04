-- Minimo Fisso e popup da novembre2026. Il vincolo sul totale e nel core condiviso.
-- Eseguire con applica=true solo insieme al rilascio del renderer compatibile.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $accesso_bonus$
DECLARE
  applica boolean := false;
  metrica bigint;
  prima text;
  dopo text;
  ids bigint[];
  n integer;
  mancanti integer;
  aggiornati integer;
  invarianti text;
  altri text;
  catalogo text;
  profili_hash text;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.gara_obiettivi_mensili IN SHARE ROW EXCLUSIVE MODE;
  SELECT id,descrizione INTO STRICT metrica,prima FROM public.gara_metriche
    WHERE attiva AND tabella='gara_individuale' AND nome='FISSO';
  dopo := replace(replace(prima,'MINIMA DI 8 PEZZI','MINIMA DI 10 PEZZI'),'DAL 8^ AL 20^','DAL 10^ AL 20^');
  IF dopo IS NULL OR dopo=prima OR position('MINIMA DI 10 PEZZI' in dopo)=0
    OR position('DAL 10^ AL 20^' in dopo)=0 THEN
    RAISE EXCEPTION 'Descrizione Fisso sorgente inattesa';
  END IF;
  SELECT array_agg(id ORDER BY id),count(*) INTO ids,n FROM public.gara_obiettivi_mensili
    WHERE metrica_id=metrica AND (anno,mese)>=(2026,11);
  IF n<>2670 OR (SELECT count(DISTINCT(anno,mese)) FROM public.gara_obiettivi_mensili WHERE id=ANY(ids))<>890
    OR EXISTS(SELECT 1 FROM public.gara_obiettivi_mensili WHERE id=ANY(ids) GROUP BY anno,mese HAVING count(*)<>3)
    OR EXISTS(SELECT 1 FROM public.gara_obiettivi_mensili WHERE id=ANY(ids) AND
      (operatore_id IS NULL OR operatore_id NOT IN
       ('c8c45da2-0cda-41eb-86cc-0272b8baa200','53f8fdfc-0595-4864-af49-5090bf3177db','3785e971-03a3-4598-8f19-15ef80a5f5fa')
       OR compenso_regola->>'tipo' IS DISTINCT FROM 'scaglioni'
       OR coalesce(compenso_regola->>'decurtazione_soglia','') NOT IN ('7','10')
       OR coalesce(compenso_regola#>>'{gara,descrizione}',prima) NOT IN (prima,dopo)
       OR compenso_regola?'gara' AND jsonb_typeof(compenso_regola->'gara')<>'object')) THEN
    RAISE EXCEPTION 'Configurazioni Fisso inattese: attese2670righe/890mesi dei tre operatori';
  END IF;
  SELECT count(*) INTO mancanti FROM public.gara_obiettivi_mensili WHERE id=ANY(ids)
    AND (compenso_regola->'decurtazione_soglia' IS DISTINCT FROM '10'::jsonb
      OR compenso_regola#>>'{gara,descrizione}' IS DISTINCT FROM dopo);
  IF NOT applica THEN
    RAISE NOTICE 'Preflight OK:2670Fisso,890mesi,%da aggiornare; nessuna scrittura',mancanti;
    RETURN;
  END IF;
  -- Rimuove dall'impronta solo i due campi autorizzati e il timestamp del trigger.
  SELECT md5(string_agg(((to_jsonb(o)-'updated_at'-'compenso_regola')||jsonb_build_object('compenso_regola',
    (compenso_regola-'decurtazione_soglia'-'gara')||CASE WHEN coalesce(compenso_regola->'gara','{}')-'descrizione'='{}'
      THEN '{}'::jsonb ELSE jsonb_build_object('gara',(compenso_regola->'gara')-'descrizione') END))::text,'' ORDER BY id))
    INTO invarianti FROM public.gara_obiettivi_mensili o WHERE id=ANY(ids);
  SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY id)) INTO altri
    FROM public.gara_obiettivi_mensili o WHERE NOT(id=ANY(ids));
  SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) INTO catalogo FROM public.gara_metriche m;
  SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) INTO profili_hash FROM public.profili p;
  UPDATE public.gara_obiettivi_mensili SET compenso_regola=compenso_regola||jsonb_build_object(
    'decurtazione_soglia',10,'gara',coalesce(compenso_regola->'gara','{}')||jsonb_build_object('descrizione',dopo))
    WHERE id=ANY(ids) AND (compenso_regola->'decurtazione_soglia' IS DISTINCT FROM '10'::jsonb
      OR compenso_regola#>>'{gara,descrizione}' IS DISTINCT FROM dopo);
  GET DIAGNOSTICS aggiornati=ROW_COUNT;
  IF aggiornati<>mancanti OR EXISTS(SELECT 1 FROM public.gara_obiettivi_mensili WHERE id=ANY(ids)
    AND (compenso_regola->'decurtazione_soglia' IS DISTINCT FROM '10'::jsonb
      OR compenso_regola#>>'{gara,descrizione}' IS DISTINCT FROM dopo))
    OR (SELECT md5(string_agg(((to_jsonb(o)-'updated_at'-'compenso_regola')||jsonb_build_object('compenso_regola',
      (compenso_regola-'decurtazione_soglia'-'gara')||CASE WHEN coalesce(compenso_regola->'gara','{}')-'descrizione'='{}'
      THEN '{}'::jsonb ELSE jsonb_build_object('gara',(compenso_regola->'gara')-'descrizione') END))::text,'' ORDER BY id))
      FROM public.gara_obiettivi_mensili o WHERE id=ANY(ids)) IS DISTINCT FROM invarianti
    OR (SELECT md5(string_agg(to_jsonb(o)::text,'' ORDER BY id)) FROM public.gara_obiettivi_mensili o WHERE NOT(id=ANY(ids))) IS DISTINCT FROM altri
    OR (SELECT md5(string_agg(to_jsonb(m)::text,'' ORDER BY id)) FROM public.gara_metriche m) IS DISTINCT FROM catalogo
    OR (SELECT md5(string_agg(to_jsonb(p)::text,'' ORDER BY id)) FROM public.profili p) IS DISTINCT FROM profili_hash THEN
    RAISE EXCEPTION 'Modifica estranea o incompleta: annullamento completo';
  END IF;
  RAISE NOTICE 'Fisso aggiornato:%righe; storico, altri compensi, scaglioni, catalogo e profili invariati',aggiornati;
END;
$accesso_bonus$;
COMMIT;
