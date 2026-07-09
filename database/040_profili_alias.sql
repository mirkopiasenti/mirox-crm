-- =============================================================================
-- Migration 040: Alias tra profili
-- =============================================================================
-- Problema: un operatore reale (persona) puo' avere 2 account Mirox distinti
-- (es. uno admin + uno operatore). Quando fa upload contratti con l'uno o
-- l'altro, i record salvano `operatore_id` differenti — nella Dashboard
-- Pezzi la stessa persona compare come 2 colonne "gemelle".
--
-- Soluzione: colonna `profili.alias_di` che punta al profilo canonico.
--   - Nessun cambio auth: entrambi gli account restano loggabili
--   - Trigger BEFORE INSERT/UPDATE su tutte le tabelle con `operatore_id`
--     redirige automaticamente al profilo canonico se il profilo di
--     inserimento e' un alias
--   - RPC `applica_alias_backfill(p_alias uuid)` esegue una UPDATE una-tantum
--     su TUTTE le tabelle esistenti per riassegnare i record storici
-- =============================================================================

BEGIN;

-- 1. Colonna alias_di --------------------------------------------------------
ALTER TABLE public.profili
    ADD COLUMN IF NOT EXISTS alias_di uuid REFERENCES public.profili(id) ON DELETE SET NULL;

-- No self-loop
ALTER TABLE public.profili
    DROP CONSTRAINT IF EXISTS profili_alias_di_no_self;
ALTER TABLE public.profili
    ADD CONSTRAINT profili_alias_di_no_self CHECK (alias_di IS NULL OR alias_di <> id);

COMMENT ON COLUMN public.profili.alias_di IS
    'Se valorizzato, questo profilo e'' un alias del profilo indicato. I record inseriti con questo profilo vengono automaticamente riassegnati al profilo canonico (via trigger BEFORE INSERT/UPDATE).';

CREATE INDEX IF NOT EXISTS idx_profili_alias_di
    ON public.profili(alias_di) WHERE alias_di IS NOT NULL;

-- 2. Funzione risoluzione alias ----------------------------------------------
-- Ritorna il profilo canonico dato un profilo (che puo' essere gia' canonico
-- o un alias). Supporta al massimo 3 hop di indirection (paranoia).
CREATE OR REPLACE FUNCTION public.risolvi_operatore_canonico(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
    v_id uuid := p_id;
    v_next uuid;
    v_hops int := 0;
BEGIN
    IF p_id IS NULL THEN RETURN NULL; END IF;
    LOOP
        SELECT alias_di INTO v_next FROM public.profili WHERE id = v_id;
        IF v_next IS NULL OR v_next = v_id THEN RETURN v_id; END IF;
        v_id := v_next;
        v_hops := v_hops + 1;
        IF v_hops > 3 THEN RETURN v_id; END IF; -- safety
    END LOOP;
END;
$fn$;

-- 3. Trigger generico: risolve operatore_id al canonico ---------------------
CREATE OR REPLACE FUNCTION public.trg_normalizza_operatore_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_canonico uuid;
BEGIN
    IF NEW.operatore_id IS NOT NULL THEN
        v_canonico := public.risolvi_operatore_canonico(NEW.operatore_id);
        IF v_canonico IS DISTINCT FROM NEW.operatore_id THEN
            NEW.operatore_id := v_canonico;
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

-- 4. Aggancia il trigger a tutte le tabelle con `operatore_id` --------------
-- Elenco esplicito (piu' sicuro che scoprirle a runtime), esclude Call Center.
DO $$
DECLARE
    t text;
    tables text[] := ARRAY[
        'vendita_contratti',
        'vendita_pratiche',
        'vendita_apri_chiudi',
        'vendita_switch_sim',
        'vendita_ordini_smartphone',
        'vendita_simulatore_protecta',
        'vendita_consensi_privacy',
        'post_vendita_gestione_rimborsi',
        'ticket'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_alias_operatore ON public.%I;', t);
        EXECUTE format(
            'CREATE TRIGGER trg_alias_operatore
                BEFORE INSERT OR UPDATE OF operatore_id ON public.%I
                FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();',
            t
        );
    END LOOP;
END $$;

-- Copertura opzionale della v2 privacy (esiste solo se la feature/privacy-v2
-- e' stata deployata; controllo dinamico per non fallire sul main).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='vendita_consensi_privacy_v2') THEN
        DROP TRIGGER IF EXISTS trg_alias_operatore ON public.vendita_consensi_privacy_v2;
        CREATE TRIGGER trg_alias_operatore
            BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_consensi_privacy_v2
            FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();
    END IF;
END $$;

-- 5. RPC di backfill una-tantum ---------------------------------------------
-- Chiamata dall'admin quando setta l'alias. Riassegna TUTTI i record storici
-- che avevano `operatore_id = p_alias_id` al canonico corrente.
-- Ritorna un jsonb {tabella: righe_aggiornate, ...}.
CREATE OR REPLACE FUNCTION public.applica_alias_backfill(p_alias_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
    v_canonico uuid;
    v_result jsonb := '{}'::jsonb;
    v_count int;
    t text;
    tables text[] := ARRAY[
        'vendita_contratti',
        'vendita_pratiche',
        'vendita_apri_chiudi',
        'vendita_switch_sim',
        'vendita_ordini_smartphone',
        'vendita_simulatore_protecta',
        'vendita_consensi_privacy',
        'post_vendita_gestione_rimborsi',
        'ticket'
    ];
BEGIN
    v_canonico := public.risolvi_operatore_canonico(p_alias_id);
    IF v_canonico IS NULL OR v_canonico = p_alias_id THEN
        RETURN jsonb_build_object('error', 'Il profilo non e'' un alias (alias_di NULL o coincidente)');
    END IF;

    FOREACH t IN ARRAY tables LOOP
        EXECUTE format(
            'UPDATE public.%I SET operatore_id = $1 WHERE operatore_id = $2',
            t
        ) USING v_canonico, p_alias_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_result := v_result || jsonb_build_object(t, v_count);
    END LOOP;

    -- Privacy v2 opzionale
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema='public' AND table_name='vendita_consensi_privacy_v2') THEN
        EXECUTE 'UPDATE public.vendita_consensi_privacy_v2 SET operatore_id = $1 WHERE operatore_id = $2'
            USING v_canonico, p_alias_id;
        GET DIAGNOSTICS v_count = ROW_COUNT;
        v_result := v_result || jsonb_build_object('vendita_consensi_privacy_v2', v_count);
    END IF;

    RETURN jsonb_build_object(
        'alias_id', p_alias_id,
        'canonico_id', v_canonico,
        'aggiornati', v_result
    );
END;
$fn$;

REVOKE ALL ON FUNCTION public.applica_alias_backfill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.applica_alias_backfill(uuid) TO authenticated;

COMMIT;
