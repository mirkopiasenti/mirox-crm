-- =============================================================
-- 037 - Sistema consensi privacy v2 (marketing granulare + audit)
-- =============================================================
-- Contesto:
-- Refactor completo del sistema consensi privacy GDPR. La v1
-- (migration 034) resta in piedi durante lo sviluppo e finche' non
-- avviene lo switch atomico (step 3 del rollout).
--
-- Differenze rispetto alla v1:
--
--   1. Preferenze marketing granulari per 3 canali (email, whatsapp,
--      telefonate operatore) invece del singolo booleano
--      consenso_marketing. NO SMS marketing separato (decisione
--      2026-07-02 - il testo legale approvato non lo prevede).
--
--   2. Presa visione informativa legata alla VERSIONE del documento
--      attivo (privacy_policy_versions), non piu' con scadenza
--      naturale 48 mesi. Cambio versione = nuova presa visione.
--
--   3. Marketing con scadenza autonoma di 24 mesi dal consenso,
--      indipendente dalla presa visione.
--
--   4. Numero OTP separato dal numero principale, con motivazione
--      obbligatoria se i due differiscono.
--
--   5. Audit trail append-only con trigger che vietano UPDATE/DELETE:
--      ogni evento sul consenso (invio SMS, verifica OK/KO, conferma,
--      revoca per canale, scadenza marketing) e' una nuova riga.
--
-- Riuso:
--   - Bucket storage 'consensi-privacy' (creato nella 034)
--   - Signed URL client-side via MiroxStorage.openAttachment(...)
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1) privacy_policy_versions
--    Traccia le versioni dell'informativa. Al massimo 1 attiva.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.privacy_policy_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identificativo umano-leggibile della versione (es. 'PRIVACY_V2_2026_06_29')
    version_slug text NOT NULL UNIQUE,

    -- SHA256 del contenuto markdown verbatim al momento dell'attivazione.
    -- Permette di verificare che il file docs/approved_privacy_copy_v2.md
    -- non sia stato alterato inavvertitamente.
    content_hash_sha256 text NOT NULL,

    -- Copia integrale del testo markdown al momento dell'attivazione.
    -- Fonte di verita' immutabile: anche se il file su disco cambia,
    -- il testo mostrato ai clienti che hanno firmato questa versione
    -- resta questo. Necessario per contenziosi legali.
    markdown_content text NOT NULL,

    -- Finestra di validita'
    active_from timestamptz NOT NULL DEFAULT now(),
    active_to timestamptz NULL,

    note text NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Al massimo 1 versione attiva alla volta
CREATE UNIQUE INDEX IF NOT EXISTS uidx_privacy_policy_versions_one_active
    ON public.privacy_policy_versions ((true))
    WHERE active_to IS NULL;

COMMENT ON TABLE public.privacy_policy_versions IS
    'Versioni dell''informativa privacy. Ogni cambio testo = nuova riga con active_from = now(); la vecchia versione riceve active_to = now() (fine attivita''). Al massimo una versione attiva alla volta.';

-- -------------------------------------------------------------
-- 2) vendita_consensi_privacy_v2
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendita_consensi_privacy_v2 (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Cliente
    anagrafica_id uuid NOT NULL REFERENCES public.anagrafica(id) ON DELETE RESTRICT,

    -- Pratica di origine (dove e' stato raccolto)
    pratica_id uuid NULL REFERENCES public.vendita_pratiche(id) ON DELETE SET NULL,

    -- Versione informativa mostrata al cliente
    informativa_version_id uuid NOT NULL REFERENCES public.privacy_policy_versions(id) ON DELETE RESTRICT,

    -- Identificativo pubblico stampato nel PDF (F4 opzione A)
    consent_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),

    -- SHA256 del contenuto markdown effettivamente reso (post placeholder replacement).
    -- Insieme a consent_uuid identifica univocamente il documento.
    document_hash text NOT NULL,

    -- ---- Numeri di telefono ----
    -- Numero principale del cliente al momento del consenso (readonly, da anagrafica)
    main_phone text NOT NULL,
    -- Numero destinatario dell'OTP (puo' differire dal principale)
    otp_phone text NOT NULL,
    -- Motivazione della differenza (obbligatoria se main_phone <> otp_phone)
    otp_phone_motivazione text NULL,

    -- ---- Preferenze marketing granulari (3 canali) ----
    marketing_email boolean NOT NULL DEFAULT false,
    marketing_whatsapp boolean NOT NULL DEFAULT false,
    marketing_phone_operator boolean NOT NULL DEFAULT false,

    -- ---- Scadenze ----
    -- Presa visione informativa: legata alla versione. Non ha scadenza naturale
    -- (F5): dedupe = stessa versione ancora attiva -> valida.
    presa_visione_at timestamptz NULL,
    -- Marketing: scade 24 mesi dopo la conferma (F5). Null se nessun canale attivo.
    marketing_valido_fino_al timestamptz NULL,

    -- ---- OTP fields ----
    otp_hash text NULL,
    otp_salt text NULL,
    otp_inviato_at timestamptz NULL,
    otp_scade_at timestamptz NULL,
    otp_confermato_at timestamptz NULL,
    otp_tentativi int NOT NULL DEFAULT 0,
    otp_reinvii int NOT NULL DEFAULT 0,
    sms_provider_id text NULL,

    -- ---- Stato workflow ----
    stato text NOT NULL DEFAULT 'pending',
    stato_cambiato_at timestamptz NOT NULL DEFAULT now(),

    -- ---- PDF finale (bucket consensi-privacy) ----
    pdf_storage_path text NULL,
    pdf_filename text NULL,
    pdf_hash text NULL,

    -- ---- Snapshot audit ----
    snapshot_anagrafica jsonb NULL,
    operatore_id uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    ip_operatore text NULL,
    user_agent_operatore text NULL,

    -- ---- Revoca globale (tutte le preferenze marketing off in un colpo)
    -- La revoca per singolo canale non tocca queste colonne, ma resetta
    -- il flag marketing_<canale> e crea audit event dedicato.
    revocato_at timestamptz NULL,
    revocato_motivo text NULL,
    revocato_da uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger auto-update updated_at
CREATE OR REPLACE FUNCTION public.vendita_consensi_privacy_v2_touch_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    IF NEW.stato IS DISTINCT FROM OLD.stato THEN
        NEW.stato_cambiato_at = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vcp_v2_updated_at ON public.vendita_consensi_privacy_v2;
CREATE TRIGGER trg_vcp_v2_updated_at
    BEFORE UPDATE ON public.vendita_consensi_privacy_v2
    FOR EACH ROW EXECUTE FUNCTION public.vendita_consensi_privacy_v2_touch_updated_at();

-- -------------------------------------------------------------
-- 3) CHECK constraints
-- -------------------------------------------------------------
ALTER TABLE public.vendita_consensi_privacy_v2
    DROP CONSTRAINT IF EXISTS vcp_v2_stato_chk;
ALTER TABLE public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vcp_v2_stato_chk
    CHECK (stato IN ('pending','confermato','scaduto','fallito','revocato'));

-- Motivazione obbligatoria se otp_phone != main_phone
ALTER TABLE public.vendita_consensi_privacy_v2
    DROP CONSTRAINT IF EXISTS vcp_v2_otp_phone_motivazione_chk;
ALTER TABLE public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vcp_v2_otp_phone_motivazione_chk
    CHECK (
        main_phone = otp_phone
        OR (otp_phone_motivazione IS NOT NULL AND length(trim(otp_phone_motivazione)) > 0)
    );

-- Confermato: deve avere presa_visione_at + pdf_storage_path + pdf_hash
ALTER TABLE public.vendita_consensi_privacy_v2
    DROP CONSTRAINT IF EXISTS vcp_v2_confermato_completo_chk;
ALTER TABLE public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vcp_v2_confermato_completo_chk
    CHECK (
        stato <> 'confermato'
        OR (
            presa_visione_at IS NOT NULL
            AND pdf_storage_path IS NOT NULL
            AND pdf_hash IS NOT NULL
        )
    );

-- Revocato: revocato_at obbligatorio
ALTER TABLE public.vendita_consensi_privacy_v2
    DROP CONSTRAINT IF EXISTS vcp_v2_revocato_completo_chk;
ALTER TABLE public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vcp_v2_revocato_completo_chk
    CHECK (stato <> 'revocato' OR revocato_at IS NOT NULL);

-- Marketing scadenza coerente: se almeno un canale marketing e' true,
-- e' ammesso avere marketing_valido_fino_al valorizzato. Se tutti i
-- canali sono false, marketing_valido_fino_al deve essere NULL.
-- Non e' un CHECK stretto (l'utente puo' aver revocato per canale e
-- lasciato la scadenza vecchia come audit): commentato per ora.

-- -------------------------------------------------------------
-- 4) Indici
-- -------------------------------------------------------------
-- Dedupe presa visione: per (anagrafica, versione informativa) trova
-- l'ultimo consenso confermato non revocato
CREATE INDEX IF NOT EXISTS idx_vcp_v2_dedupe_presa_visione
    ON public.vendita_consensi_privacy_v2
        (anagrafica_id, informativa_version_id, presa_visione_at DESC)
    WHERE stato = 'confermato' AND revocato_at IS NULL;

-- Scan consensi con marketing scaduto (per eventuale cron/report)
CREATE INDEX IF NOT EXISTS idx_vcp_v2_marketing_scadenza
    ON public.vendita_consensi_privacy_v2 (marketing_valido_fino_al)
    WHERE marketing_valido_fino_al IS NOT NULL AND revocato_at IS NULL;

-- Cleanup pending
CREATE INDEX IF NOT EXISTS idx_vcp_v2_pending_scadenza
    ON public.vendita_consensi_privacy_v2 (otp_scade_at)
    WHERE stato = 'pending';

-- Drill-down per pratica
CREATE INDEX IF NOT EXISTS idx_vcp_v2_pratica
    ON public.vendita_consensi_privacy_v2 (pratica_id)
    WHERE pratica_id IS NOT NULL;

-- -------------------------------------------------------------
-- 5) RLS
-- -------------------------------------------------------------
ALTER TABLE public.vendita_consensi_privacy_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vcp_v2_authenticated_select
    ON public.vendita_consensi_privacy_v2;
CREATE POLICY vcp_v2_authenticated_select
    ON public.vendita_consensi_privacy_v2
    FOR SELECT
    TO authenticated
    USING (true);

ALTER TABLE public.privacy_policy_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_policy_versions_authenticated_select
    ON public.privacy_policy_versions;
CREATE POLICY privacy_policy_versions_authenticated_select
    ON public.privacy_policy_versions
    FOR SELECT
    TO authenticated
    USING (true);

-- -------------------------------------------------------------
-- 6) vendita_consensi_privacy_audit (append-only)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vendita_consensi_privacy_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    consenso_id uuid NOT NULL REFERENCES public.vendita_consensi_privacy_v2(id) ON DELETE RESTRICT,

    -- Tipo evento (tassonomia estendibile senza migration: lasciato text)
    evento_tipo text NOT NULL,
    evento_at timestamptz NOT NULL DEFAULT now(),

    -- Chi ha causato l'evento
    attore_tipo text NOT NULL,
    attore_id uuid NULL REFERENCES public.profili(id) ON DELETE SET NULL,
    attore_ip text NULL,

    -- Payload contestuale liberamente strutturato
    dettaglio jsonb NULL,

    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vendita_consensi_privacy_audit
    DROP CONSTRAINT IF EXISTS vcp_audit_attore_tipo_chk;
ALTER TABLE public.vendita_consensi_privacy_audit
    ADD CONSTRAINT vcp_audit_attore_tipo_chk
    CHECK (attore_tipo IN ('operatore','admin','sistema','cliente'));

CREATE INDEX IF NOT EXISTS idx_vcp_audit_consenso_time
    ON public.vendita_consensi_privacy_audit (consenso_id, evento_at DESC);

CREATE INDEX IF NOT EXISTS idx_vcp_audit_tipo_time
    ON public.vendita_consensi_privacy_audit (evento_tipo, evento_at DESC);

-- ---- Trigger append-only: vietato UPDATE e DELETE ----
CREATE OR REPLACE FUNCTION public.vcp_audit_no_update()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'vendita_consensi_privacy_audit e append-only: UPDATE non consentito (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.vcp_audit_no_delete()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'vendita_consensi_privacy_audit e append-only: DELETE non consentito (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vcp_audit_no_update ON public.vendita_consensi_privacy_audit;
CREATE TRIGGER trg_vcp_audit_no_update
    BEFORE UPDATE ON public.vendita_consensi_privacy_audit
    FOR EACH ROW EXECUTE FUNCTION public.vcp_audit_no_update();

DROP TRIGGER IF EXISTS trg_vcp_audit_no_delete ON public.vendita_consensi_privacy_audit;
CREATE TRIGGER trg_vcp_audit_no_delete
    BEFORE DELETE ON public.vendita_consensi_privacy_audit
    FOR EACH ROW EXECUTE FUNCTION public.vcp_audit_no_delete();

ALTER TABLE public.vendita_consensi_privacy_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vcp_audit_authenticated_select
    ON public.vendita_consensi_privacy_audit;
CREATE POLICY vcp_audit_authenticated_select
    ON public.vendita_consensi_privacy_audit
    FOR SELECT
    TO authenticated
    USING (true);

-- -------------------------------------------------------------
-- 7) Comments (documentazione introspect)
-- -------------------------------------------------------------
COMMENT ON TABLE public.vendita_consensi_privacy_v2 IS
    'Consensi privacy v2 (marketing granulare 3 canali + presa visione legata a versione informativa). Rimpiazzera'' la tabella v1 (vendita_consensi_privacy) allo switch finale.';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.consent_uuid IS
    'Identificativo pubblico del consenso stampato nel PDF (F4 opzione A). Diverso dall''id interno.';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.document_hash IS
    'SHA256 del testo markdown effettivamente reso (post placeholder replacement). Per verificare che il documento firmato non sia stato alterato.';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.marketing_valido_fino_al IS
    'Scade 24 mesi dopo la conferma (F5). La presa visione dell''informativa NON scade insieme al marketing.';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.marketing_email IS
    'Preferenza marketing granulare canale email. Default false (mai preselezionato).';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.marketing_whatsapp IS
    'Preferenza marketing granulare canale WhatsApp. Default false.';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.marketing_phone_operator IS
    'Preferenza marketing granulare telefonate effettuate da operatore umano. Default false.';
COMMENT ON COLUMN public.vendita_consensi_privacy_v2.otp_phone IS
    'Numero destinatario dell''OTP. Puo'' differire dal main_phone; in tal caso otp_phone_motivazione e'' obbligatoria (CHECK vcp_v2_otp_phone_motivazione_chk).';

COMMENT ON TABLE public.vendita_consensi_privacy_audit IS
    'Audit trail append-only dei consensi v2. UPDATE e DELETE bloccati da trigger. Ogni evento (invio SMS, verifica OK/KO, conferma, revoca per canale, scadenza marketing, riemissione PDF) = una riga nuova.';

COMMENT ON TABLE public.privacy_policy_versions IS
    'Versioni dell''informativa privacy. Il markdown_content e'' la copia integrale al momento dell''attivazione: fonte di verita'' immutabile per chi ha firmato quella versione.';

COMMIT;
