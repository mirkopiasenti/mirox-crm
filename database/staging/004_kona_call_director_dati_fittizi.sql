-- Dati sintetici per il collaudo di KONA Call Director.
-- Applicare esclusivamente al progetto Supabase test
-- "Mirox CRM - Test KONA Call Director" (ref yyorullxmdxhnunsfwwa).
--
-- Il seed e' idempotente per ID/chiavi deterministiche e non modifica:
-- - interruttori KONA;
-- - profili o abilitazioni;
-- - token, calendario Google o configurazioni esterne;
-- - dati diversi da quelli marcati TEST KONA.
--
-- Genera:
-- - 6 anagrafiche Consumer sintetiche;
-- - 8 lead Business sintetici in tre categorie approvate;
-- - 8 rilavorazioni Consumer (ricontatti, non risposti, non presentati, passaggi);
-- - 2 rilavorazioni Business;
-- - 3 piani giornalieri (oggi + due prossimi giorni lavorativi).

BEGIN;

DO $$
DECLARE
  v_schema_comment text;
  v_operatore_id uuid;
  v_operatore_nome text;
  v_oggi date := (now() AT TIME ZONE 'Europe/Rome')::date;
  v_prossimo date;
  v_secondo date;
  v_giorni_lavorativi jsonb;
  v_piano jsonb;
BEGIN
  SELECT obj_description('public'::regnamespace, 'pg_namespace')
  INTO v_schema_comment;

  IF COALESCE(v_schema_comment, '') NOT LIKE 'Schema minimo di test KONA Call Director:%' THEN
    RAISE EXCEPTION
      'Seed interrotto: il database non e'' il bootstrap dedicato KONA Call Director test';
  END IF;

  SELECT p.id, p.nome
  INTO v_operatore_id, v_operatore_nome
  FROM public.profili p
  JOIN public.kona_call_director_profili kp ON kp.profilo_id = p.id
  WHERE p.attivo = true
    AND kp.abilitato = true
  ORDER BY kp.updated_at DESC, p.created_at
  LIMIT 1;

  IF v_operatore_id IS NULL THEN
    RAISE EXCEPTION
      'Seed interrotto: nessun profilo test attivo e abilitato a KONA';
  END IF;

  SELECT giorni_lavorativi
  INTO v_giorni_lavorativi
  FROM public.kona_call_director_config
  WHERE id = 1;

  v_prossimo := v_oggi + 1;
  WHILE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_giorni_lavorativi, '[1,2,3,4,5]'::jsonb)) AS g(valore)
    WHERE g.valore::integer = EXTRACT(DOW FROM v_prossimo)::integer
  ) LOOP
    v_prossimo := v_prossimo + 1;
  END LOOP;

  v_secondo := v_prossimo + 1;
  WHILE NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_giorni_lavorativi, '[1,2,3,4,5]'::jsonb)) AS g(valore)
    WHERE g.valore::integer = EXTRACT(DOW FROM v_secondo)::integer
  ) LOOP
    v_secondo := v_secondo + 1;
  END LOOP;

  INSERT INTO public.anagrafica (
    id, cf_piva, cluster, ragione_sociale, nome_referente, cellulare,
    provincia, comune, via, civico, creato_da, email
  ) VALUES
    ('00000000-0000-4000-8000-00000000a001', 'TSTKNA26A00Z001A', 'Consumer', 'TEST KONA - Cliente Consumer 01', 'Cliente Test 01', '0000001001', 'VR', 'LEGNAGO', 'Via Test KONA', '1', v_operatore_id, 'consumer01@example.test'),
    ('00000000-0000-4000-8000-00000000a002', 'TSTKNA26A00Z002B', 'Consumer', 'TEST KONA - Cliente Consumer 02', 'Cliente Test 02', '0000001002', 'VR', 'CEREA', 'Via Test KONA', '2', v_operatore_id, 'consumer02@example.test'),
    ('00000000-0000-4000-8000-00000000a003', 'TSTKNA26A00Z003C', 'Consumer', 'TEST KONA - Cliente Consumer 03', 'Cliente Test 03', '0000001003', 'VR', 'BOVOLONE', 'Via Test KONA', '3', v_operatore_id, 'consumer03@example.test'),
    ('00000000-0000-4000-8000-00000000a004', 'TSTKNA26A00Z004D', 'Consumer', 'TEST KONA - Cliente Consumer 04', 'Cliente Test 04', '0000001004', 'VR', 'NOGARA', 'Via Test KONA', '4', v_operatore_id, 'consumer04@example.test'),
    ('00000000-0000-4000-8000-00000000a005', 'TSTKNA26A00Z005E', 'Consumer', 'TEST KONA - Cliente Consumer 05', 'Cliente Test 05', '0000001005', 'VR', 'LEGNAGO', 'Via Test KONA', '5', v_operatore_id, 'consumer05@example.test'),
    ('00000000-0000-4000-8000-00000000a006', 'TSTKNA26A00Z006F', 'Consumer', 'TEST KONA - Cliente Consumer 06', 'Cliente Test 06', '0000001006', 'VR', 'CEREA', 'Via Test KONA', '6', v_operatore_id, 'consumer06@example.test')
  ON CONFLICT (id) DO UPDATE SET
    cf_piva = EXCLUDED.cf_piva,
    cluster = EXCLUDED.cluster,
    ragione_sociale = EXCLUDED.ragione_sociale,
    nome_referente = EXCLUDED.nome_referente,
    cellulare = EXCLUDED.cellulare,
    provincia = EXCLUDED.provincia,
    comune = EXCLUDED.comune,
    via = EXCLUDED.via,
    civico = EXCLUDED.civico,
    creato_da = EXCLUDED.creato_da,
    email = EXCLUDED.email;

  INSERT INTO public.call_center_lead_outbound (
    id, ragione_sociale, ragione_sociale_norm, indirizzo, indirizzo_norm,
    cap, localita, localita_norm, provincia, regione, nazione,
    telefono_raw, telefono_norm, telefono_tipo, email, email_norm,
    categoria, zona, partita_iva, partita_iva_norm, stato_lead,
    assegnato_a, note_ultima, pinned, do_not_call, times_seen,
    dedupe_strategy, dedupe_key, created_by, updated_by
  ) VALUES
    ('00000000-0000-4000-8000-00000000b001', 'TEST KONA - Trattoria Alfa', 'test kona trattoria alfa', 'Via Test Business 1', 'via test business 1', '37045', 'Legnago', 'legnago', 'VR', 'Veneto', 'Italia', '0000002001', '0000002001', 'fisso', 'business01@example.test', 'business01@example.test', 'Ristorazione', 'Legnago', 'TSTBIZ00001', 'tstbiz00001', 'ricontattare', v_operatore_id, 'TEST KONA - Ricontatto Business mattina', false, false, 1, 'kona_test', 'kona-test-business-001', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b002', 'TEST KONA - Osteria Beta', 'test kona osteria beta', 'Via Test Business 2', 'via test business 2', '37053', 'Cerea', 'cerea', 'VR', 'Veneto', 'Italia', '0000002002', '0000002002', 'fisso', 'business02@example.test', 'business02@example.test', 'Ristorazione', 'Cerea', 'TSTBIZ00002', 'tstbiz00002', 'non_risposto', v_operatore_id, 'TEST KONA - Non risposto Business pomeriggio', false, false, 1, 'kona_test', 'kona-test-business-002', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b003', 'TEST KONA - Negozio Gamma', 'test kona negozio gamma', 'Via Test Business 3', 'via test business 3', '37051', 'Bovolone', 'bovolone', 'VR', 'Veneto', 'Italia', '0000002003', '0000002003', 'fisso', 'business03@example.test', 'business03@example.test', 'Negozi', 'Bovolone', 'TSTBIZ00003', 'tstbiz00003', 'nuovo', v_operatore_id, 'TEST KONA - Nuovo lead Business', false, false, 1, 'kona_test', 'kona-test-business-003', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b004', 'TEST KONA - Bottega Delta', 'test kona bottega delta', 'Via Test Business 4', 'via test business 4', '37054', 'Nogara', 'nogara', 'VR', 'Veneto', 'Italia', '0000002004', '0000002004', 'fisso', 'business04@example.test', 'business04@example.test', 'Negozi', 'Nogara', 'TSTBIZ00004', 'tstbiz00004', 'nuovo', v_operatore_id, 'TEST KONA - Nuovo lead Business', false, false, 1, 'kona_test', 'kona-test-business-004', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b005', 'TEST KONA - Studio Epsilon', 'test kona studio epsilon', 'Via Test Business 5', 'via test business 5', '37045', 'Legnago', 'legnago', 'VR', 'Veneto', 'Italia', '0000002005', '0000002005', 'fisso', 'business05@example.test', 'business05@example.test', 'Servizi', 'Legnago', 'TSTBIZ00005', 'tstbiz00005', 'nuovo', v_operatore_id, 'TEST KONA - Nuovo lead Business', false, false, 1, 'kona_test', 'kona-test-business-005', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b006', 'TEST KONA - Agenzia Zeta', 'test kona agenzia zeta', 'Via Test Business 6', 'via test business 6', '37053', 'Cerea', 'cerea', 'VR', 'Veneto', 'Italia', '0000002006', '0000002006', 'fisso', 'business06@example.test', 'business06@example.test', 'Servizi', 'Cerea', 'TSTBIZ00006', 'tstbiz00006', 'nuovo', v_operatore_id, 'TEST KONA - Nuovo lead Business', false, false, 1, 'kona_test', 'kona-test-business-006', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b007', 'TEST KONA - Pizzeria Eta', 'test kona pizzeria eta', 'Via Test Business 7', 'via test business 7', '37045', 'Legnago', 'legnago', 'VR', 'Veneto', 'Italia', '0000002007', '0000002007', 'fisso', 'business07@example.test', 'business07@example.test', 'Ristorazione', 'Legnago', 'TSTBIZ00007', 'tstbiz00007', 'nuovo', v_operatore_id, 'TEST KONA - Nuovo lead Business', false, false, 1, 'kona_test', 'kona-test-business-007', v_operatore_id, v_operatore_id),
    ('00000000-0000-4000-8000-00000000b008', 'TEST KONA - Emporio Theta', 'test kona emporio theta', 'Via Test Business 8', 'via test business 8', '37054', 'Nogara', 'nogara', 'VR', 'Veneto', 'Italia', '0000002008', '0000002008', 'fisso', 'business08@example.test', 'business08@example.test', 'Negozi', 'Nogara', 'TSTBIZ00008', 'tstbiz00008', 'nuovo', v_operatore_id, 'TEST KONA - Nuovo lead Business', false, false, 1, 'kona_test', 'kona-test-business-008', v_operatore_id, v_operatore_id)
  ON CONFLICT (id) DO UPDATE SET
    ragione_sociale = EXCLUDED.ragione_sociale,
    ragione_sociale_norm = EXCLUDED.ragione_sociale_norm,
    indirizzo = EXCLUDED.indirizzo,
    indirizzo_norm = EXCLUDED.indirizzo_norm,
    cap = EXCLUDED.cap,
    localita = EXCLUDED.localita,
    localita_norm = EXCLUDED.localita_norm,
    provincia = EXCLUDED.provincia,
    regione = EXCLUDED.regione,
    nazione = EXCLUDED.nazione,
    telefono_raw = EXCLUDED.telefono_raw,
    telefono_norm = EXCLUDED.telefono_norm,
    telefono_tipo = EXCLUDED.telefono_tipo,
    email = EXCLUDED.email,
    email_norm = EXCLUDED.email_norm,
    categoria = EXCLUDED.categoria,
    zona = EXCLUDED.zona,
    partita_iva = EXCLUDED.partita_iva,
    partita_iva_norm = EXCLUDED.partita_iva_norm,
    stato_lead = EXCLUDED.stato_lead,
    assegnato_a = EXCLUDED.assegnato_a,
    note_ultima = EXCLUDED.note_ultima,
    pinned = EXCLUDED.pinned,
    do_not_call = EXCLUDED.do_not_call,
    times_seen = EXCLUDED.times_seen,
    dedupe_strategy = EXCLUDED.dedupe_strategy,
    dedupe_key = EXCLUDED.dedupe_key,
    updated_by = EXCLUDED.updated_by;

  INSERT INTO public.chiamate (
    id, operatore_id, operatore_nome, anagrafica_id, cf_piva, nome_cliente,
    cellulare, copertura, motivo_chiamata, esito, note, data_ricontatto,
    fascia_ricontatto, rilavorazione_stato, passaggio_stato,
    passaggio_data_scadenza, data_ora
  ) VALUES
    ('00000000-0000-4000-8000-00000000c001', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000a001', 'TSTKNA26A00Z001A', 'TEST KONA - Cliente Consumer 01', '0000001001', 'Fibra', 'TEST KONA - Verifica offerta Consumer', 'ricontattare', 'TEST KONA - Richiamare in mattinata', v_oggi, 'Mattina', 'da_lavorare', NULL, NULL, now() - interval '2 days'),
    ('00000000-0000-4000-8000-00000000c002', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000a002', 'TSTKNA26A00Z002B', 'TEST KONA - Cliente Consumer 02', '0000001002', 'FWA', 'TEST KONA - Verifica copertura Consumer', 'ricontattare', 'TEST KONA - Richiamare nel pomeriggio', v_oggi, 'Pomeriggio', 'da_lavorare', NULL, NULL, now() - interval '1 day'),
    ('00000000-0000-4000-8000-00000000c003', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000a003', 'TSTKNA26A00Z003C', 'TEST KONA - Cliente Consumer 03', '0000001003', 'Fibra', 'TEST KONA - Contatto Consumer', 'non_risposto', 'TEST KONA - Primo tentativo senza risposta', v_oggi, 'Mattina', 'da_lavorare', NULL, NULL, now() - interval '3 hours'),
    ('00000000-0000-4000-8000-00000000c004', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000a004', 'TSTKNA26A00Z004D', 'TEST KONA - Cliente Consumer 04', '0000001004', 'FWA', 'TEST KONA - Contatto Consumer', 'non_risposto', 'TEST KONA - Secondo tentativo previsto', v_oggi, 'Pomeriggio', 'da_lavorare', NULL, NULL, now() - interval '4 hours'),
    ('00000000-0000-4000-8000-00000000c005', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000a005', 'TSTKNA26A00Z005E', 'TEST KONA - Cliente Consumer 05', '0000001005', 'Fibra', 'TEST KONA - Controllo passaggio', 'passa_in_negozio', 'TEST KONA - Verificare arrivo nel punto vendita', NULL, NULL, 'non_applicabile', 'in_attesa', v_oggi, now() - interval '1 day'),
    ('00000000-0000-4000-8000-00000000c006', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000a006', 'TSTKNA26A00Z006F', 'TEST KONA - Cliente Consumer 06', '0000001006', 'FWA', 'TEST KONA - Controllo passaggio Cerea', 'passa_a_cerea', 'TEST KONA - Verificare passaggio a Cerea', NULL, NULL, 'non_applicabile', 'in_attesa', v_oggi, now() - interval '1 day')
  ON CONFLICT (id) DO UPDATE SET
    operatore_id = EXCLUDED.operatore_id,
    operatore_nome = EXCLUDED.operatore_nome,
    anagrafica_id = EXCLUDED.anagrafica_id,
    cf_piva = EXCLUDED.cf_piva,
    nome_cliente = EXCLUDED.nome_cliente,
    cellulare = EXCLUDED.cellulare,
    copertura = EXCLUDED.copertura,
    motivo_chiamata = EXCLUDED.motivo_chiamata,
    esito = EXCLUDED.esito,
    note = EXCLUDED.note,
    data_ricontatto = EXCLUDED.data_ricontatto,
    fascia_ricontatto = EXCLUDED.fascia_ricontatto,
    rilavorazione_stato = EXCLUDED.rilavorazione_stato,
    passaggio_stato = EXCLUDED.passaggio_stato,
    passaggio_data_scadenza = EXCLUDED.passaggio_data_scadenza,
    data_ora = EXCLUDED.data_ora;

  INSERT INTO public.appuntamenti (
    id, nome, codice_fiscale, telefono, motivo, note, anagrafica_id,
    fissato_da_operatore_id, fissato_da_nome, chiamata_id, data_ora,
    durata_minuti, fonte, stato, presentato, non_presentato_stato
  ) VALUES
    ('00000000-0000-4000-8000-00000000e001', 'TEST KONA - Cliente Consumer 01', 'TSTKNA26A00Z001A', '0000001001', 'TEST KONA - Appuntamento non presentato', 'TEST KONA - Verificare se il cliente e passato', '00000000-0000-4000-8000-00000000a001', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000c001', now() - interval '1 day', 30, 'interno', 'confermato', 'no', 'da_lavorare'),
    ('00000000-0000-4000-8000-00000000e002', 'TEST KONA - Cliente Consumer 02', 'TSTKNA26A00Z002B', '0000001002', 'TEST KONA - Appuntamento non presentato', 'TEST KONA - Cliente da ricontattare', '00000000-0000-4000-8000-00000000a002', v_operatore_id, v_operatore_nome, '00000000-0000-4000-8000-00000000c002', now() - interval '2 days', 30, 'interno', 'confermato', 'no', 'da_lavorare')
  ON CONFLICT (id) DO UPDATE SET
    nome = EXCLUDED.nome,
    codice_fiscale = EXCLUDED.codice_fiscale,
    telefono = EXCLUDED.telefono,
    motivo = EXCLUDED.motivo,
    note = EXCLUDED.note,
    anagrafica_id = EXCLUDED.anagrafica_id,
    fissato_da_operatore_id = EXCLUDED.fissato_da_operatore_id,
    fissato_da_nome = EXCLUDED.fissato_da_nome,
    chiamata_id = EXCLUDED.chiamata_id,
    data_ora = EXCLUDED.data_ora,
    durata_minuti = EXCLUDED.durata_minuti,
    fonte = EXCLUDED.fonte,
    stato = EXCLUDED.stato,
    presentato = EXCLUDED.presentato,
    non_presentato_stato = EXCLUDED.non_presentato_stato;

  INSERT INTO public.call_center_lead_outbound_chiamate (
    id, lead_id, operatore_id, operatore_nome, data_ora,
    ragione_sociale_snapshot, telefono_snapshot, localita_snapshot,
    provincia_snapshot, esito, note, data_ricontatto,
    fascia_ricontatto, rilavorazione_stato
  ) VALUES
    ('00000000-0000-4000-8000-00000000d001', '00000000-0000-4000-8000-00000000b001', v_operatore_id, v_operatore_nome, now() - interval '2 days', 'TEST KONA - Trattoria Alfa', '0000002001', 'Legnago', 'VR', 'ricontattare', 'TEST KONA - Richiamare il titolare in mattinata', v_oggi, 'Mattina', 'da_lavorare'),
    ('00000000-0000-4000-8000-00000000d002', '00000000-0000-4000-8000-00000000b002', v_operatore_id, v_operatore_nome, now() - interval '1 day', 'TEST KONA - Osteria Beta', '0000002002', 'Cerea', 'VR', 'non_risposto', 'TEST KONA - Riprovare nel pomeriggio', v_oggi, 'Pomeriggio', 'da_lavorare')
  ON CONFLICT (id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    operatore_id = EXCLUDED.operatore_id,
    operatore_nome = EXCLUDED.operatore_nome,
    data_ora = EXCLUDED.data_ora,
    ragione_sociale_snapshot = EXCLUDED.ragione_sociale_snapshot,
    telefono_snapshot = EXCLUDED.telefono_snapshot,
    localita_snapshot = EXCLUDED.localita_snapshot,
    provincia_snapshot = EXCLUDED.provincia_snapshot,
    esito = EXCLUDED.esito,
    note = EXCLUDED.note,
    data_ricontatto = EXCLUDED.data_ricontatto,
    fascia_ricontatto = EXCLUDED.fascia_ricontatto,
    rilavorazione_stato = EXCLUDED.rilavorazione_stato;

  v_piano := jsonb_build_object(
    'dataset_test', 'kona-call-director-staging-v1',
    'categorie_approvate', jsonb_build_array('Ristorazione', 'Negozi', 'Servizi'),
    'consumer', 'fibra_fwa',
    'agenda_test', jsonb_build_object(
      'mattina', jsonb_build_array(
        'Ricontatti programmati',
        'Non risposti da riprovare',
        'Controllo Passa in negozio',
        'Controllo Passa a Cerea',
        'Nuovi lead Business'
      ),
      'pomeriggio', jsonb_build_array(
        'Ricontatti programmati',
        'Non risposti da riprovare',
        'Nuovi lead Business',
        'Contatti Consumer Fibra/FWA'
      )
    ),
    'nota_test', 'Dati interamente sintetici, solo staging KONA Call Director'
  );

  INSERT INTO public.kona_call_director_piani (
    data, operatore_id, stato, contenuto, sorgente,
    proposta_at, approvata_at, applicata_at
  ) VALUES
    (v_oggi, v_operatore_id, 'applicato', v_piano || jsonb_build_object('giorno_test', 'oggi'), 'mirko', now(), now(), now()),
    (v_prossimo, v_operatore_id, 'approvato', v_piano || jsonb_build_object('giorno_test', 'prossimo_lavorativo'), 'mirko', now(), now(), NULL),
    (v_secondo, v_operatore_id, 'approvato', v_piano || jsonb_build_object('giorno_test', 'secondo_lavorativo'), 'mirko', now(), now(), NULL)
  ON CONFLICT (data, operatore_id) DO UPDATE SET
    stato = CASE
      WHEN public.kona_call_director_piani.stato = 'applicato' THEN 'applicato'
      WHEN EXCLUDED.data = v_oggi THEN 'applicato'
      ELSE 'approvato'
    END,
    contenuto = public.kona_call_director_piani.contenuto || EXCLUDED.contenuto,
    sorgente = CASE
      WHEN public.kona_call_director_piani.sorgente = 'mirko' THEN 'mirko'
      ELSE EXCLUDED.sorgente
    END,
    approvata_at = COALESCE(public.kona_call_director_piani.approvata_at, EXCLUDED.approvata_at),
    applicata_at = CASE
      WHEN EXCLUDED.data = v_oggi THEN COALESCE(public.kona_call_director_piani.applicata_at, now())
      ELSE public.kona_call_director_piani.applicata_at
    END;
END;
$$;

COMMIT;
