-- Migration 079 — vendita: chiusura "vinto" degli eventi Call Center alla vendita.
--
-- CONTESTO
-- La RPC `vendita_chiudi_eventi_cc_per_pratica` (migration 028) viene chiamata
-- dalla finalizzazione del carrello vendita e, per il cliente della pratica:
--   (a) annulla gli appuntamenti ancora aperti e non gestiti;
--   (b) chiude le chiamate in rilavorazione (ricontatti, non risposti) e i
--       passaggi "in_attesa" (passa in negozio / passa a Cerea).
--
-- Due buchi segnalati dall'utente, che rendono insicura la ripresentazione
-- degli stessi eventi dopo alcuni giorni:
--   1. gli appuntamenti NON PRESENTATI (`presentato='no'`,
--      `non_presentato_stato='da_lavorare'`) non venivano chiusi: un cliente che
--      e' passato e ha comprato sarebbe rimasto in coda come "non presentato";
--   2. nessuna funzione scriveva `appuntamenti.esito_finale = 'vinta'`, mentre
--      il KPI Call Center conta i "Chiusi / vinti" proprio da quel campo: la
--      vendita non risultava vinta da nessuna parte.
--
-- REGOLE DI PROGETTO RISPETTATE
-- - La RPC esistente NON viene toccata: se ne aggiunge una nuova con nome nuovo
--   (`..._v2`), come da convenzione del repository.
-- - Nessun DROP, nessun RENAME, nessuna modifica a RLS o a vincoli.
-- - Il codice chiama la v2 e ricade sulla v1 se la migration non e' applicata.
--
-- NON applicata ad alcun database da questa sessione: va eseguita a mano sul
-- database di test, come le 076, 077 e 078.

BEGIN;

CREATE OR REPLACE FUNCTION public.vendita_chiudi_eventi_cc_per_pratica_v2(
    p_anagrafica_id uuid,
    p_pratica_id uuid,
    p_giorni_finestra integer DEFAULT 90
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_app_count integer;
    v_chi_count integer;
    v_np_count integer;
    v_vinti_count integer;
    v_motivo text;
    v_pratica_created_at timestamptz;
    v_finestra integer;
BEGIN
    IF p_anagrafica_id IS NULL OR p_pratica_id IS NULL THEN
        RETURN jsonb_build_object(
            'appuntamenti_annullati', 0,
            'chiamate_chiuse', 0,
            'non_presentati_chiusi', 0,
            'appuntamenti_vinti', 0,
            'skipped', true,
            'reason', 'anagrafica_o_pratica_null'
        );
    END IF;

    -- Anti-rollback safety: la pratica deve esistere davvero.
    SELECT created_at INTO v_pratica_created_at
    FROM public.vendita_pratiche
    WHERE id = p_pratica_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'appuntamenti_annullati', 0,
            'chiamate_chiuse', 0,
            'non_presentati_chiusi', 0,
            'appuntamenti_vinti', 0,
            'skipped', true,
            'reason', 'pratica_inesistente'
        );
    END IF;

    v_motivo := 'Chiuso automaticamente: cliente passato in anticipo, '
             || 'pratica vendita ' || p_pratica_id::text
             || ' creata il ' || to_char(v_pratica_created_at AT TIME ZONE 'Europe/Rome', 'DD/MM/YYYY HH24:MI');
    v_finestra := GREATEST(0, COALESCE(p_giorni_finestra, 90));

    -- (a) Annulla appuntamenti futuri/odierni non ancora gestiti.
    UPDATE public.appuntamenti
    SET stato = 'annullato',
        motivo_modifica = v_motivo
    WHERE anagrafica_id = p_anagrafica_id
      AND stato = 'confermato'
      AND presentato IS NULL
      AND data_ora >= (now() AT TIME ZONE 'Europe/Rome')::date - interval '1 day';
    GET DIAGNOSTICS v_app_count = ROW_COUNT;

    -- (b) Chiudi chiamate in rilavorazione (ricontatti, non risposti, passaggi).
    UPDATE public.chiamate
    SET rilavorazione_stato = 'completato',
        passaggio_stato = CASE
            WHEN passaggio_stato = 'in_attesa' THEN 'chiuso'
            ELSE passaggio_stato
        END
    WHERE anagrafica_id = p_anagrafica_id
      AND (
            rilavorazione_stato = 'da_lavorare'
         OR passaggio_stato = 'in_attesa'
      );
    GET DIAGNOSTICS v_chi_count = ROW_COUNT;

    -- (c) NUOVO: i non presentati diventano "lavorato" e vincono.
    UPDATE public.appuntamenti
    SET non_presentato_stato = 'lavorato',
        esito_finale = 'vinta',
        motivo_modifica = COALESCE(motivo_modifica || ' - ', '') || 'Esito vinto: vendita registrata'
    WHERE anagrafica_id = p_anagrafica_id
      AND presentato = 'no'
      AND non_presentato_stato = 'da_lavorare';
    GET DIAGNOSTICS v_np_count = ROW_COUNT;

    -- (d) NUOVO: appuntamenti presentati con esito ancora aperto -> vinti,
    --     limitati alla finestra (default 90 giorni) per non riscrivere il
    --     risultato di mesi vecchi nel KPI Call Center.
    UPDATE public.appuntamenti
    SET esito_finale = 'vinta',
        motivo_modifica = COALESCE(motivo_modifica || ' - ', '') || 'Esito vinto: vendita registrata'
    WHERE anagrafica_id = p_anagrafica_id
      AND presentato = 'si'
      AND esito_finale IS NULL
      AND data_ora >= now() - make_interval(days => v_finestra);
    GET DIAGNOSTICS v_vinti_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'appuntamenti_annullati', v_app_count,
        'chiamate_chiuse', v_chi_count,
        'non_presentati_chiusi', v_np_count,
        'appuntamenti_vinti', v_vinti_count,
        'skipped', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.vendita_chiudi_eventi_cc_per_pratica_v2(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendita_chiudi_eventi_cc_per_pratica_v2(uuid, uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.vendita_chiudi_eventi_cc_per_pratica_v2(uuid, uuid, integer) IS
  'Come vendita_chiudi_eventi_cc_per_pratica, ma chiude anche i non presentati e
  marca esito_finale=vinta sugli appuntamenti del cliente. La v1 resta invariata
  e in uso finche'' questa migration non e'' applicata.';

COMMIT;
