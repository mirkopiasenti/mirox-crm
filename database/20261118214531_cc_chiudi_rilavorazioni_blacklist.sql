BEGIN;

-- Usata dal trigger e, una sola volta, per le voci già in blacklist.
CREATE FUNCTION mirox_cc_privato.chiudi_rilavorazioni_blacklist_v1(p_codici text[])
RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
    v_codici text[];
    v_clienti uuid[];
    v_lead uuid[];
BEGIN
    SELECT ARRAY(
        SELECT DISTINCT upper(btrim(codice))
        FROM unnest(p_codici) AS c(codice)
        WHERE btrim(codice) <> ''
    ) INTO v_codici;
    IF cardinality(v_codici) = 0 THEN RETURN; END IF;

    SELECT ARRAY(
        SELECT id FROM public.anagrafica
        WHERE upper(btrim(cf_piva)) = ANY(v_codici)
    ) INTO v_clienti;

    SELECT ARRAY(
        SELECT id FROM public.call_center_lead_outbound
        WHERE upper(btrim(codice_fiscale)) = ANY(v_codici)
           OR upper(btrim(partita_iva)) = ANY(v_codici)
    ) INTO v_lead;

    UPDATE public.chiamate AS c
    SET rilavorazione_stato = 'completato',
        passaggio_stato = CASE
            WHEN c.esito IN ('passa_in_negozio', 'passa_a_cerea')
                 AND c.passaggio_stato IN ('in_attesa', 'ricontattare')
            THEN 'chiuso' ELSE c.passaggio_stato
        END
    WHERE (upper(btrim(c.cf_piva)) = ANY(v_codici) OR c.anagrafica_id = ANY(v_clienti))
      AND ((c.esito IN ('non_risposto', 'ricontattare') AND c.rilavorazione_stato = 'da_lavorare')
           OR (c.esito IN ('passa_in_negozio', 'passa_a_cerea')
               AND c.passaggio_stato IN ('in_attesa', 'ricontattare')));

    UPDATE public.call_center_lead_outbound_chiamate AS c
    SET rilavorazione_stato = 'completato'
    WHERE (c.lead_id = ANY(v_lead) OR c.anagrafica_id = ANY(v_clienti))
      AND c.esito IN ('non_risposto', 'ricontattare')
      AND c.rilavorazione_stato = 'da_lavorare';

    UPDATE public.appuntamenti AS a
    SET non_presentato_stato = 'lavorato'
    WHERE a.stato = 'confermato' AND a.presentato = 'no'
      AND a.non_presentato_stato = 'da_lavorare'
      AND (upper(btrim(a.codice_fiscale)) = ANY(v_codici)
           OR a.anagrafica_id = ANY(v_clienti)
           OR a.lead_outbound_id = ANY(v_lead)
           OR EXISTS (
               SELECT 1 FROM public.chiamate AS c WHERE c.id = a.chiamata_id
                 AND (upper(btrim(c.cf_piva)) = ANY(v_codici) OR c.anagrafica_id = ANY(v_clienti))
           )
           OR EXISTS (
               SELECT 1 FROM public.call_center_lead_outbound_chiamate AS c
               WHERE c.id = a.chiamata_outbound_id
                 AND (c.lead_id = ANY(v_lead) OR c.anagrafica_id = ANY(v_clienti))
           ));

    WITH aperti AS (
        SELECT l.id, l.stato_lead
        FROM public.call_center_lead_outbound AS l
        WHERE l.id = ANY(v_lead)
          AND l.stato_lead IN ('nuovo', 'non_risposto', 'ricontattare',
                               'da_contattare', 'in_lavorazione', 'richiamare')
        ORDER BY l.id
        FOR UPDATE
    ), chiusi AS (
        UPDATE public.call_center_lead_outbound AS l
        SET stato_lead = 'chiuso', prossimo_followup_at = NULL
        FROM aperti
        WHERE l.id = aperti.id
        RETURNING l.id, aperti.stato_lead
    )
    INSERT INTO public.call_center_lead_outbound_attivita
        (lead_id, tipo, testo, stato_precedente, stato_nuovo, operatore_id)
    SELECT id, 'sistema', 'Chiuso automaticamente per blacklist', stato_lead, 'chiuso',
        (SELECT p.id FROM public.profili AS p WHERE p.id = auth.uid())
    FROM chiusi;
END;
$$;
REVOKE ALL ON FUNCTION mirox_cc_privato.chiudi_rilavorazioni_blacklist_v1(text[])
    FROM PUBLIC, anon, authenticated, service_role;

-- L'inserimento conserva la RLS esistente. Il trigger chiude anche le attività
-- di altri operatori come effetto dell'inserimento autorizzato.
CREATE FUNCTION mirox_cc_privato.dopo_inserimento_blacklist_v1()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL AND current_setting('role', true) IN ('anon', 'authenticated') THEN
        RAISE EXCEPTION 'Accesso negato' USING ERRCODE = '42501';
    END IF;

    PERFORM mirox_cc_privato.chiudi_rilavorazioni_blacklist_v1(ARRAY[NEW.cf_piva]);
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION mirox_cc_privato.dopo_inserimento_blacklist_v1()
    FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER trg_mirox_cc_chiudi_rilavorazioni_blacklist
AFTER INSERT ON public.blacklist
FOR EACH ROW EXECUTE FUNCTION mirox_cc_privato.dopo_inserimento_blacklist_v1();

SELECT mirox_cc_privato.chiudi_rilavorazioni_blacklist_v1(
    ARRAY(SELECT cf_piva FROM public.blacklist)
);

COMMIT;
