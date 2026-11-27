-- Data civile del giorno di attivazione. La validazione integrale segue
-- la riapertura degli OK preesistenti dopo il rilascio del nuovo selettore.
BEGIN;

ALTER TABLE public.post_vendita_controllo_allarmi
  ADD COLUMN data_attivazione date,
  ADD CONSTRAINT pvcal_data_attivazione_chk
    CHECK ((stato = 'OK') = (data_attivazione IS NOT NULL)
      AND (data_attivazione IS NULL OR isfinite(data_attivazione))) NOT VALID;

COMMENT ON COLUMN public.post_vendita_controllo_allarmi.data_attivazione IS
  'Data effettiva di attivazione, richiesta con OK e usata nel mese P.IVA.';

CREATE OR REPLACE FUNCTION mirox_monitor_privato.leggi(p_token text,p_revisione text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_id uuid; v_nome text; v_seen timestamptz;
  v_now timestamptz:=statement_timestamp();
  v_day date:=(statement_timestamp() AT TIME ZONE 'Europe/Rome')::date;
  v_start date; v_end date; v_hash text; v_rev text; v_result jsonb;
  v_prefix text; v_payload jsonb; v_content text;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Postazione non associata o revocata.' USING ERRCODE='42501';
  END IF;
  v_hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  SELECT id,nome,last_seen_at INTO v_id,v_nome,v_seen
    FROM public.mirox_monitor_dispositivi
    WHERE token_hash=v_hash AND stato='attivo' AND negozio='9001415852';
  IF v_id IS NULL THEN RAISE EXCEPTION 'Postazione non associata o revocata.' USING ERRCODE='42501'; END IF;
  IF p_revisione IS NOT NULL AND p_revisione !~ '^\d{4}-\d{2}-\d{2}:[a-f0-9]{32}:[a-f0-9]{32}$' THEN
    RAISE EXCEPTION 'Revisione non valida.' USING ERRCODE='22023';
  END IF;
  IF v_seen IS NULL OR v_seen<v_now-interval '5 minutes' THEN
    UPDATE public.mirox_monitor_dispositivi SET last_seen_at=v_now
      WHERE id=v_id AND stato='attivo' AND token_hash=v_hash
        AND (last_seen_at IS NULL OR last_seen_at<v_now-interval '5 minutes');
  END IF;
  v_prefix:=v_day::text||':'||md5(pg_current_snapshot()::text);
  v_result:=jsonb_build_object('versione',2,'data',v_day,'verificato_il',v_now,'postazione',v_nome);
  IF p_revisione IS NOT NULL AND left(p_revisione,43)=v_prefix
    AND pg_current_xact_id_if_assigned() IS NULL THEN
    v_result:=v_result||jsonb_build_object('revisione',p_revisione,'invariato',true);
  ELSE
    v_start:=date_trunc('month',v_day)::date;
    v_end:=(v_start+interval '1 month')::date;
    WITH attivazioni_ids AS MATERIALIZED (
      SELECT contratto_id FROM public.post_vendita_controllo_fissi
      WHERE tecnologia='FTTC' AND stato='Attivo' AND data_attivazione>=v_start AND data_attivazione<v_end
      UNION ALL
      SELECT a.contratto_id
      FROM public.post_vendita_controllo_allarmi a
      JOIN public.vendita_contratti ac ON ac.id=a.contratto_id
      WHERE a.stato='OK' AND a.data_attivazione>=v_start AND a.data_attivazione<v_end
        AND ac.categoria_snapshot='Allarmi' AND ac.cluster_cliente='Business'
        AND ac.codice_rivenditore='9001415852' AND ac.stato_inserimento<>'reinserimento'
    ), contratti AS MATERIALIZED (
      SELECT c.id,
        c.operatore_id,
        c.cluster_cliente,
        c.categoria_snapshot,
        c.nome_offerta_snapshot,
        c.nome_opzione_snapshot,
        c.nome_reload_snapshot,
        c.tipo_attivazione,
        c.apri_chiudi,
        c.intestatario,
        c.switch_sim,
        c.modalita_pagamento,
        c.dispositivo_associato,
        c.tipo_acquisto,
        c.fascia_prezzo,
        c.finanziaria,
        c.kolme,
        c.reload_exchange,
        c.data_contratto,
        c.stato_inserimento,
        c.reinserimento_fisso_finalizzato,
        c.codice_rivenditore,
        c.punteggio_gara_totale,
        c.punteggio_extra_gara_totale,
        c.punteggio_offerta,
        c.punteggio_opzione,
        c.punteggio_totale,
        c.punteggio_gara_offerta,
        c.punteggio_gara_opzione,
        c.punteggio_extra_gara_offerta,
        c.punteggio_extra_gara_opzione
      FROM public.vendita_contratti c
      WHERE c.codice_rivenditore IN ('9001415852','9000822241')
        AND ((c.data_contratto>=v_start::timestamp AT TIME ZONE 'UTC' AND c.data_contratto<v_end::timestamp AT TIME ZONE 'UTC')
          OR c.id IN (SELECT contratto_id FROM attivazioni_ids))
    )
    SELECT jsonb_build_object(
      'contratti',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM contratti c WHERE c.data_contratto>=v_start::timestamp AT TIME ZONE 'UTC' AND c.data_contratto<v_end::timestamp AT TIME ZONE 'UTC'),'[]'::jsonb),
      -- Chiave v2 esistente: il client distingue Fisso e Allarmi dalla categoria.
      'fttc',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM contratti c WHERE c.id IN (SELECT contratto_id FROM attivazioni_ids)),'[]'::jsonb),
      'righe',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM (SELECT id,nome,gruppo,colore_hex,ordine,regola FROM public.dashboard_righe_giornaliera WHERE attiva) r),'[]'::jsonb),
      'metriche',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM (
        SELECT g.id,g.nome,g.tabella,g.ordine,
          CASE WHEN s.metrica_id IS NULL THEN g.regola
            ELSE g.regola||jsonb_build_object('mirox_sprint_novembre_2026',s.punti_iniziali) END AS regola,
          g.punteggio_campo
        FROM public.gara_metriche g
        LEFT JOIN mirox_monitor_privato.sprint_novembre_2026 s
          ON s.metrica_id=g.id AND v_day>=DATE '2026-11-24' AND v_day<DATE '2026-12-01'
        WHERE g.attiva AND g.tabella IN ('avanzamento_standard','avanzamento_piva','avanzamento_extra_piva')
      ) m),'[]'::jsonb),
      'obiettivi',coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM (SELECT id,metrica_id,operatore_id,obiettivo FROM public.gara_obiettivi_mensili WHERE anno=extract(year FROM v_day) AND mese=extract(month FROM v_day) AND operatore_id IS NULL) o),'[]'::jsonb),
      'profili',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM (SELECT id,nome,attivo,in_gara,alias_di FROM public.profili) p),'[]'::jsonb),
      'post',jsonb_build_object(
        'fisso',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.contratto_id) FROM (SELECT contratto_id,stato,tecnologia FROM public.post_vendita_controllo_fissi WHERE contratto_id IN (SELECT id FROM contratti)) f),'[]'::jsonb),
        'energia',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.contratto_id) FROM (SELECT contratto_id,stato FROM public.post_vendita_controllo_lg WHERE contratto_id IN (SELECT id FROM contratti)) e),'[]'::jsonb),
        'allarmi',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.contratto_id) FROM (SELECT contratto_id,stato FROM public.post_vendita_controllo_allarmi WHERE contratto_id IN (SELECT id FROM contratti)) a),'[]'::jsonb)),
      'ultimo_csv',(SELECT max(ultimo_csv_upload_at) FROM public.post_vendita_controllo_lg),
      'agenda',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.data_ora,a.id) FROM (SELECT left(id::text,8) AS id,data_ora,durata_minuti,presentato FROM public.appuntamenti
        WHERE stato='confermato' AND data_ora>=v_day::timestamp AT TIME ZONE 'Europe/Rome' AND data_ora<(v_day+1)::timestamp AT TIME ZONE 'Europe/Rome') a),'[]'::jsonb)
    ) INTO v_payload;
    v_content:=md5(v_payload::text);
    v_rev:=v_prefix||':'||v_content;
    v_result:=v_result||jsonb_build_object('revisione',v_rev,'invariato',
      p_revisione IS NOT NULL AND left(p_revisione,10)=v_day::text AND split_part(p_revisione,':',3)=v_content);
    IF p_revisione IS NULL OR left(p_revisione,10)<>v_day::text OR split_part(p_revisione,':',3)<>v_content THEN
      v_result:=v_result||v_payload||jsonb_build_object('aggiornato_il',v_now);
    END IF;
  END IF;
  -- Revoca ricontrollata con snapshot fresco anche dopo la lettura delle fonti.
  IF NOT EXISTS(SELECT 1 FROM public.mirox_monitor_dispositivi WHERE id=v_id AND stato='attivo' AND token_hash=v_hash AND negozio='9001415852') THEN
    RAISE EXCEPTION 'Postazione non associata o revocata.' USING ERRCODE='42501';
  END IF;
  RETURN v_result;
END $$;
COMMIT;
