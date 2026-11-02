-- Avvicendamento autorizzato dal proprietario il 02/11/2026.
-- Solo dati: Francesca disabilitata, Vincenzo Di Pietro nuovo operatore distinto.
-- Nessun alias/backfill, nessuna riscrittura dello storico o degli obiettivi.
-- Default preflight; sostituire applica=false con true solo dopo la verifica.
BEGIN ISOLATION LEVEL REPEATABLE READ;
DO $avvicendamento$
DECLARE
  applica boolean := false;
  uscente constant uuid := '0284cf55-d97a-4709-9ece-d3f4894b80a7';
  entrante constant uuid := 'c8c45da2-0cda-41eb-86cc-0272b8baa200';
  amministratore constant uuid := 'fd67b457-b82b-4037-8d57-2a92295fac9f';
  vecchio public.profili%ROWTYPE;
  nuovo public.profili%ROWTYPE;
  acl jsonb;
  prima_profili jsonb;
  prima_acl jsonb;
  prima_storico jsonb := '{}'::jsonb;
  impronta jsonb;
  tab record;
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  LOCK TABLE public.profili,public.mirox_permessi_utente IN SHARE ROW EXCLUSIVE MODE;
  SELECT * INTO STRICT vecchio FROM public.profili WHERE id=uscente;
  IF vecchio.nome <> 'Francesca' OR vecchio.ruolo <> 'operatore' OR vecchio.alias_di IS NOT NULL THEN
    RAISE EXCEPTION 'Profilo uscente diverso dal preflight';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=entrante
    AND email='v.dipietro@konatech.it' AND email_confirmed_at IS NOT NULL
    AND (banned_until IS NULL OR banned_until<now())) THEN
    RAISE EXCEPTION 'Account Auth entrante assente o non abilitato';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profili WHERE id=amministratore AND ruolo='admin' AND attivo) THEN
    RAISE EXCEPTION 'Amministratore non abilitato';
  END IF;
  SELECT pagine INTO STRICT acl FROM public.mirox_permessi_utente WHERE utente_id=uscente;
  IF (SELECT count(*) FROM jsonb_each(acl))<>19 OR EXISTS (
    SELECT 1 FROM jsonb_each(acl) WHERE value<>'true'::jsonb
  ) THEN RAISE EXCEPTION 'Permessi sorgente diversi dal preflight'; END IF;
  SELECT * INTO nuovo FROM public.profili WHERE id=entrante;
  IF FOUND AND (nuovo.nome<>'Vincenzo' OR nuovo.username<>'v.dipietro'
    OR nuovo.slug IS DISTINCT FROM 'vincenzo' OR nuovo.ruolo<>'operatore'
    OR NOT nuovo.attivo OR NOT nuovo.in_gara OR nuovo.alias_di IS NOT NULL
    OR nuovo.ordine_gara IS DISTINCT FROM vecchio.ordine_gara
    OR nuovo.colore IS DISTINCT FROM vecchio.colore
    OR nuovo.pagine_accessibili IS DISTINCT FROM vecchio.pagine_accessibili) THEN
    RAISE EXCEPTION 'Profilo entrante esistente diverso dal risultato atteso';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mirox_permessi_utente WHERE utente_id=entrante AND pagine IS DISTINCT FROM acl) THEN
    RAISE EXCEPTION 'Permessi entrante gia configurati diversamente: non sovrascrivere';
  END IF;
  IF NOT applica THEN
    RAISE NOTICE 'Preflight OK: account confermato, profili distinti, 19 permessi; nessuna scrittura';
    RETURN;
  END IF;

  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO prima_profili FROM public.profili p WHERE id<>entrante;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY utente_id) INTO prima_acl FROM public.mirox_permessi_utente a WHERE utente_id<>entrante;
  -- Impronte di tutte le altre tabelle pubbliche nel medesimo snapshot.
  -- Comprende contratti/pratiche, documenti, CC, obiettivi, verifiche e planning.
  FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='public'
    AND tablename NOT IN ('profili','mirox_permessi_utente','mirox_permessi_audit') ORDER BY tablename
  LOOP
    EXECUTE format('SELECT jsonb_build_object(''righe'',count(*),''hash'',md5(coalesce(string_agg(h,'''' ORDER BY h),''''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t) s',tab.tablename) INTO impronta;
    prima_storico := prima_storico||jsonb_build_object(tab.tablename,impronta);
  END LOOP;
  INSERT INTO public.profili(id,username,nome,ruolo,attivo,colore,slug,pagine_accessibili,in_gara,alias_di,ordine_gara)
    VALUES(entrante,'v.dipietro','Vincenzo','operatore',true,vecchio.colore,'vincenzo',vecchio.pagine_accessibili,true,null,vecchio.ordine_gara)
    ON CONFLICT(id) DO NOTHING;
  -- Usa la RPC pubblicata per mantenere validazione, versione e audit ACL.
  EXECUTE 'SET LOCAL ROLE service_role';
  PERFORM public.mirox_salva_permessi_pagine(amministratore,entrante,acl,
    coalesce((SELECT versione FROM public.mirox_permessi_utente WHERE utente_id=entrante),0));
  EXECUTE 'RESET ROLE';
  UPDATE public.profili SET attivo=false,in_gara=false WHERE id=uscente AND (attivo OR in_gara);

  IF (SELECT jsonb_agg(CASE WHEN id=uscente
      THEN to_jsonb(p)||jsonb_build_object('attivo',vecchio.attivo,'in_gara',vecchio.in_gara,'updated_at',vecchio.updated_at)
      ELSE to_jsonb(p) END ORDER BY id) FROM public.profili p WHERE id<>entrante) IS DISTINCT FROM prima_profili THEN
    RAISE EXCEPTION 'Modifica inattesa ai profili preesistenti';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(a) ORDER BY utente_id) FROM public.mirox_permessi_utente a WHERE utente_id<>entrante) IS DISTINCT FROM prima_acl
    OR (SELECT pagine FROM public.mirox_permessi_utente WHERE utente_id=entrante) IS DISTINCT FROM acl THEN
    RAISE EXCEPTION 'Permessi inattesi';
  END IF;
  FOR tab IN SELECT key FROM jsonb_each(prima_storico) LOOP
    EXECUTE format('SELECT jsonb_build_object(''righe'',count(*),''hash'',md5(coalesce(string_agg(h,'''' ORDER BY h),''''))) FROM (SELECT md5(to_jsonb(t)::text) h FROM public.%I t) s',tab.key) INTO impronta;
    IF impronta IS DISTINCT FROM prima_storico->tab.key THEN
      RAISE EXCEPTION 'Storico alterato nella tabella %: annullamento',tab.key;
    END IF;
  END LOOP;
  RAISE NOTICE 'Avvicendamento completato; % tabelle storiche identiche',(SELECT count(*) FROM jsonb_object_keys(prima_storico));
END;
$avvicendamento$;
COMMIT;

SELECT p.id,p.nome,p.ruolo,p.attivo,p.in_gara,p.alias_di,p.ordine_gara,
  a.versione AS versione_permessi
FROM public.profili p LEFT JOIN public.mirox_permessi_utente a ON a.utente_id=p.id
WHERE p.id IN ('0284cf55-d97a-4709-9ece-d3f4894b80a7','c8c45da2-0cda-41eb-86cc-0272b8baa200')
ORDER BY p.nome;
