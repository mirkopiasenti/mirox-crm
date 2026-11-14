-- Uscita richiesta dal proprietario14/11/2026, senza eliminare l'identità/storico.
-- Solo dati: applica=false è il preflight; true disabilita soltanto il profilo.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $uscita$
DECLARE
  applica boolean := false;
  cessato constant uuid := 'c8c45da2-0cda-41eb-86cc-0272b8baa200';
  precedente public.profili%ROWTYPE;
  prima_profili jsonb;
  storico jsonb := '{}'::jsonb;
  impronta jsonb;
  tab record;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.profili IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT precedente FROM public.profili WHERE id=cessato;
  IF precedente.nome IS DISTINCT FROM 'Vincenzo' OR precedente.username IS DISTINCT FROM 'v.dipietro'
    OR precedente.ruolo IS DISTINCT FROM 'operatore' OR precedente.alias_di IS NOT NULL
    OR precedente.slug IS DISTINCT FROM 'vincenzo' THEN
    RAISE EXCEPTION 'Profilo diverso dal preflight: nessuna modifica';
  END IF;
  IF NOT applica THEN
    RAISE NOTICE 'Preflight OK: solo attivo/in_gara da disabilitare; identità e storico conservati';
    RETURN;
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO prima_profili FROM public.profili p WHERE id<>cessato;
  FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'profili' ORDER BY tablename LOOP
    EXECUTE format('SELECT jsonb_build_object(''righe'',count(*),''hash'',md5(coalesce(string_agg(h,'''' ORDER BY h),''''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t) s',tab.tablename) INTO impronta;
    storico := storico||jsonb_build_object(tab.tablename,impronta);
  END LOOP;
  UPDATE public.profili SET attivo=false,in_gara=false WHERE id=cessato AND (attivo OR in_gara);
  IF NOT EXISTS (SELECT 1 FROM public.profili p WHERE id=cessato AND NOT attivo AND NOT in_gara
    AND (to_jsonb(p)-'attivo'-'in_gara'-'updated_at') = (to_jsonb(precedente)-'attivo'-'in_gara'-'updated_at')) THEN
    RAISE EXCEPTION 'Modifica inattesa al profilo';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM public.profili p WHERE id<>cessato) IS DISTINCT FROM prima_profili THEN
    RAISE EXCEPTION 'Altri profili modificati: annullamento';
  END IF;
  FOR tab IN SELECT key FROM jsonb_each(storico) LOOP
    EXECUTE format('SELECT jsonb_build_object(''righe'',count(*),''hash'',md5(coalesce(string_agg(h,'''' ORDER BY h),''''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t) s',tab.key) INTO impronta;
    IF impronta IS DISTINCT FROM storico->tab.key THEN RAISE EXCEPTION 'Storico alterato in %: annullamento',tab.key; END IF;
  END LOOP;
  RAISE NOTICE 'Profilo disabilitato; % altre tabelle pubbliche identiche',(SELECT count(*) FROM jsonb_object_keys(storico));
END;
$uscita$;
COMMIT;
SELECT id,nome,attivo,in_gara,alias_di FROM public.profili WHERE id='c8c45da2-0cda-41eb-86cc-0272b8baa200';
