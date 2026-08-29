-- Bonifica dello staging e preparazione del collaudo Consumer manuale
-- di lunedi' 2026-08-31 con il solo profilo `test`.
--
-- Applicare esclusivamente al progetto Supabase test
-- "Mirox CRM - Test KONA Call Director" (ref yyorullxmdxhnunsfwwa).
-- NON applicare in produzione.
--
-- Prerequisito: gli eventi Google di prova devono essere stati annullati e
-- riconciliati dal dispatcher; il guard impedisce di lasciare eventi orfani.

BEGIN;

DO $$
DECLARE
  v_schema_comment text;
  v_operatore_id uuid;
BEGIN
  SELECT obj_description('public'::regnamespace, 'pg_namespace')
  INTO v_schema_comment;

  IF COALESCE(v_schema_comment, '') NOT LIKE 'Schema minimo di test KONA Call Director:%' THEN
    RAISE EXCEPTION
      'Preparazione interrotta: il database non e'' lo staging dedicato KONA Call Director';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.kona_call_director_appuntamenti_business
    WHERE google_event_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Preparazione interrotta: esistono ancora eventi Google di prova da riconciliare';
  END IF;

  SELECT p.id
  INTO v_operatore_id
  FROM public.profili p
  WHERE p.username = 'test'
    AND p.attivo = true
  LIMIT 1;

  IF v_operatore_id IS NULL THEN
    RAISE EXCEPTION 'Preparazione interrotta: profilo test attivo non trovato';
  END IF;

  -- Registri e lavorazioni del collaudo precedente. Token Google, stato
  -- Telegram, profilo e configurazione vengono deliberatamente conservati.
  DELETE FROM public.kona_call_director_task;
  DELETE FROM public.kona_call_director_sessioni;
  DELETE FROM public.kona_call_director_piani;
  DELETE FROM public.kona_call_director_esclusioni;
  DELETE FROM public.kona_call_director_appuntamenti_business;
  DELETE FROM public.kona_call_director_arricchimenti;
  DELETE FROM public.kona_call_director_lead_telefoni;
  DELETE FROM public.kona_call_director_jobs;
  DELETE FROM public.kona_call_director_esecuzioni_programmate;
  DELETE FROM public.kona_call_director_notifiche;
  DELETE FROM public.kona_call_director_budget_riserve;
  DELETE FROM public.kona_call_director_budget_log;

  -- Il progetto e' un database minimo e isolato: tutte le righe CRM presenti
  -- derivano dai collaudi KONA e vengono eliminate prima della prova reale.
  DELETE FROM public.appuntamenti;
  DELETE FROM public.call_center_lead_outbound_chiamate;
  DELETE FROM public.call_center_lead_outbound_attivita;
  DELETE FROM public.chiamate;
  DELETE FROM public.call_center_lead_outbound;
  DELETE FROM public.blacklist;
  DELETE FROM public.anagrafica;

  UPDATE public.kona_call_director_config
  SET attivo_globale = true,
      modalita_osservazione = true,
      giorni_lavorativi = '[1,2,3,4,5]'::jsonb,
      ferie = '[]'::jsonb,
      orario_mattina = '{"inizio":"09:00","fine":"12:30"}'::jsonb,
      orario_pomeriggio = '{"inizio":"15:30","fine":"19:00"}'::jsonb,
      orario_stop_business = '18:00',
      richieste_web_max_per_lead = 0,
      lead_notte_obiettivo = 0,
      soglia_lead_minime = 0,
      aggiornato_at = now()
  WHERE id = 1;

  UPDATE public.kona_call_director_profili
  SET abilitato = (profilo_id = v_operatore_id),
      in_osservazione = true,
      abilitato_at = CASE WHEN profilo_id = v_operatore_id THEN COALESCE(abilitato_at, now()) ELSE abilitato_at END,
      ultimo_task_at = NULL,
      updated_at = now();

  INSERT INTO public.kona_call_director_piani (
    data, operatore_id, stato, contenuto, sorgente,
    proposta_at, approvata_at, approvata_da
  ) VALUES (
    DATE '2026-08-31',
    v_operatore_id,
    'approvato',
    jsonb_build_object(
      'consumer', 'fibra_fwa',
      'categorie_approvate', jsonb_build_array(),
      'direttiva_mirko', 'Lavorazione manuale lead Consumer per l''intera giornata',
      'agenda', jsonb_build_object(
        'mattina', jsonb_build_array('Contatti Consumer manuali'),
        'pomeriggio', jsonb_build_array('Contatti Consumer manuali')
      ),
      'modalita_collaudo', true,
      'nota', 'Primo collaudo operativo Isabella su profilo test; nessuna coda Business'
    ),
    'mirko',
    now(),
    now(),
    v_operatore_id
  );
END;
$$;

COMMIT;
