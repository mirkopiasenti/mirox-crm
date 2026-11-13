-- Rettifica dati autorizzata il 31/10/2026: Seconda linea = 1,50 punti gara.
-- Nessuna modifica schema/RLS/RPC. Default sola verifica; impostare applica=true
-- soltanto dopo il preflight. Tutto lo storico, inclusi KO, reinserimenti e bozze.
DO $seconda_linea$
DECLARE
  applica boolean := false;
  opzione public.vendita_opzioni%ROWTYPE;
  prima_opzione jsonb;
  prima_contratti jsonb;
  prima_verifiche text;
  prima_notifiche text;
  dopo_verifiche text;
  dopo_notifiche text;
  ids uuid[];
  modificati uuid[];
  numero integer;
  cambiati integer;
  audit_n integer;
  contesto_precedente text;
  campi_gara text[] := ARRAY['punteggio_gara_opzione','punteggio_gara_totale',
    'punteggio_opzione','punteggio_totale','updated_at'];
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  -- Impedisce che catalogo o righe cambino durante il confronto prima/dopo.
  LOCK TABLE public.vendita_opzioni, public.vendita_contratti IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*) INTO numero FROM public.vendita_opzioni WHERE nome_opzione='2° Linea';
  IF numero<>1 THEN RAISE EXCEPTION 'Attesa una sola opzione 2° Linea, trovate %',numero; END IF;
  SELECT * INTO opzione FROM public.vendita_opzioni WHERE nome_opzione='2° Linea';
  IF opzione.punteggio_gara IS NULL OR opzione.punteggio_gara NOT IN (1,1.5)
    OR opzione.punti_base IS NULL OR opzione.punti_base NOT IN (1,1.5)
    OR opzione.punteggio_extra_gara IS DISTINCT FROM 1::numeric
    OR opzione.punti_extra_piva IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION 'Catalogo Seconda linea diverso dal preflight: rileggere prima di applicare';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendita_contratti
    WHERE nome_opzione_snapshot ~* '(2|seconda).*linea'
      AND opzione_id IS DISTINCT FROM opzione.id) THEN
    RAISE EXCEPTION 'Snapshot Seconda linea senza collegamento coerente: verificare prima';
  END IF;
  SELECT array_agg(c.id ORDER BY c.id),jsonb_agg(to_jsonb(c) ORDER BY c.id),count(*)
    INTO ids,prima_contratti,numero FROM public.vendita_contratti c WHERE c.opzione_id=opzione.id;
  IF numero<>9 THEN RAISE EXCEPTION 'Attesi 9 contratti Seconda linea, trovati %',numero; END IF;
  IF EXISTS (SELECT 1 FROM public.vendita_contratti c WHERE c.id=ANY(ids) AND (
    c.categoria_snapshot IS DISTINCT FROM 'Fisso' OR c.cluster_cliente IS DISTINCT FROM 'Business'
    OR c.punteggio_gara_opzione IS NULL OR c.punteggio_gara_opzione NOT IN (1,1.5)
    OR c.punteggio_extra_gara_opzione IS DISTINCT FROM 1::numeric)) THEN
    RAISE EXCEPTION 'Contratti Seconda linea diversi dal preflight';
  END IF;
  SELECT array_agg(c.id ORDER BY c.id),count(*) INTO modificati,numero
    FROM public.vendita_contratti c WHERE c.id=ANY(ids) AND c.punteggio_gara_opzione<>1.5;
  IF numero NOT IN (0,7) THEN RAISE EXCEPTION 'Attesi 7 contratti da correggere (oppure 0 al retry), trovati %',numero; END IF;
  IF NOT applica THEN
    RAISE NOTICE 'Preflight riuscito: 1 opzione, 9 contratti, % da correggere; nessuna scrittura',numero;
    RETURN;
  END IF;

  prima_opzione := to_jsonb(opzione);
  SELECT md5(string_agg(to_jsonb(v)::text,'' ORDER BY v.contratto_id)) INTO prima_verifiche
    FROM public.vendita_verifiche v WHERE v.contratto_id=ANY(ids);
  SELECT md5(string_agg(to_jsonb(n)::text,'' ORDER BY n.id)) INTO prima_notifiche
    FROM public.vendita_verifica_notifiche n WHERE n.contratto_id=ANY(ids);

  UPDATE public.vendita_opzioni SET punteggio_gara=1.5,punti_base=1.5
    WHERE id=opzione.id AND (punteggio_gara IS DISTINCT FROM 1.5 OR punti_base IS DISTINCT FROM 1.5);
  GET DIAGNOSTICS cambiati=ROW_COUNT;
  IF cambiati=1 THEN
    INSERT INTO public.vendita_log_modifiche(tabella,record_id,azione,dati_precedenti,dati_nuovi)
    SELECT 'vendita_opzioni',o.id,'rettifica_seconda_linea_catalogo',prima_opzione,
      to_jsonb(o)||jsonb_build_object('rettifica','seconda_linea_2026_10_31')
      FROM public.vendita_opzioni o WHERE o.id=opzione.id;
  END IF;

  -- Solo rettifica punteggio: preserva verifiche, revisioni, coda e notifiche.
  -- Il trigger dei punteggi e il suo audit restano attivi.
  contesto_precedente := current_setting('mirox.verifica_commit',true);
  PERFORM set_config('mirox.verifica_commit','yes',true);
  UPDATE public.vendita_contratti SET punteggio_gara_opzione=1.5 WHERE id=ANY(modificati);
  GET DIAGNOSTICS cambiati=ROW_COUNT;
  PERFORM set_config('mirox.verifica_commit',coalesce(contesto_precedente,''),true);
  IF cambiati<>numero THEN RAISE EXCEPTION 'Rettifica incompleta: attesi %, modificati %',numero,cambiati; END IF;

  UPDATE public.vendita_log_modifiche SET dati_nuovi=dati_nuovi||jsonb_build_object(
    'rettifica','seconda_linea_2026_10_31','origine','richiesta_proprietario')
    WHERE tabella='vendita_contratti' AND record_id=ANY(modificati)
      AND azione='punteggio_update' AND created_at>=transaction_timestamp()
      AND (dati_precedenti->>'punteggio_gara_opzione')::numeric=1
      AND (dati_nuovi->>'punteggio_gara_opzione')::numeric=1.5;
  GET DIAGNOSTICS audit_n=ROW_COUNT;
  IF audit_n<>numero THEN RAISE EXCEPTION 'Audit rettifica incompleto: attesi %, trovati %',numero,audit_n; END IF;

  IF EXISTS (SELECT 1 FROM public.vendita_contratti c WHERE c.id=ANY(ids) AND (
    c.punteggio_gara_opzione IS DISTINCT FROM 1.5::numeric
    OR c.punteggio_gara_totale IS DISTINCT FROM coalesce(c.punteggio_gara_offerta,0)+1.5
    OR c.punteggio_opzione IS DISTINCT FROM 1.5::numeric
    OR c.punteggio_totale IS DISTINCT FROM c.punteggio_gara_totale
    OR (to_jsonb(c)-campi_gara) IS DISTINCT FROM
      (SELECT old_row-campi_gara FROM jsonb_array_elements(prima_contratti) old_row WHERE old_row->>'id'=c.id::text)
  )) THEN RAISE EXCEPTION 'Punteggi non coerenti o dati estranei modificati'; END IF;
  IF EXISTS (SELECT 1 FROM public.vendita_opzioni WHERE id=opzione.id
    AND (punteggio_gara IS DISTINCT FROM 1.5::numeric OR punti_base IS DISTINCT FROM 1.5::numeric)) THEN
    RAISE EXCEPTION 'Punteggio catalogo non aggiornato a 1,50';
  END IF;
  IF (SELECT to_jsonb(o)-ARRAY['punteggio_gara','punti_base','updated_at'] FROM public.vendita_opzioni o WHERE o.id=opzione.id)
    IS DISTINCT FROM (prima_opzione-ARRAY['punteggio_gara','punti_base','updated_at']) THEN
    RAISE EXCEPTION 'Campi catalogo estranei modificati';
  END IF;
  SELECT md5(string_agg(to_jsonb(v)::text,'' ORDER BY v.contratto_id)) INTO dopo_verifiche
    FROM public.vendita_verifiche v WHERE v.contratto_id=ANY(ids);
  SELECT md5(string_agg(to_jsonb(n)::text,'' ORDER BY n.id)) INTO dopo_notifiche
    FROM public.vendita_verifica_notifiche n WHERE n.contratto_id=ANY(ids);
  IF prima_verifiche IS DISTINCT FROM dopo_verifiche OR prima_notifiche IS DISTINCT FROM dopo_notifiche THEN
    RAISE EXCEPTION 'Verifiche o notifiche alterate: rettifica annullata';
  END IF;
  RAISE NOTICE 'Rettifica riuscita: 9 contratti a 1,50; modificati %, audit %, Extra P.IVA invariato',cambiati,audit_n;
END;
$seconda_linea$;
