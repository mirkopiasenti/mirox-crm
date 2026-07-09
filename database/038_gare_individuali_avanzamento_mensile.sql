-- =============================================================================
-- Migration 038: Gare individuali + Avanzamento mensile
-- =============================================================================
-- Introduce le tabelle a supporto delle nuove tab del modulo Dashboard Pezzi:
--
--   Tab "Gare Individuali"   -> una tabella per operatore con
--                               ATTUALE / OBIETTIVO / COMPENSO per metrica.
--   Tab "Avanzamento Mensile"-> tabelle a categorie (Standard + P.IVA + Extra),
--                               con pezzi per operatore, punteggio, andamento,
--                               eccedenza.
--
-- Modello dati:
--   profili.in_gara            -> flag per includere l'operatore nelle Gare Individuali
--
--   gara_metriche              -> catalogo righe delle tre tabelle
--                                 (tabella IN gara_individuale / avanzamento_standard /
--                                  avanzamento_piva / avanzamento_extra_piva)
--
--   gara_obiettivi_mensili     -> obiettivo + regola compenso per operatore/mese
--                                 (operatore_id NULL = obiettivo di categoria per la
--                                 tab Avanzamento Mensile, valido per il totale del mese).
--
-- La logica di conteggio "attuale" NON e' in DB: il client Dashboard Pezzi filtra
-- i contratti del mese via matching JSONB su `regola` (stesso engine di
-- dashboard_righe_giornaliera). La RPC lato DB non serve perche' i dati sono
-- di sola lettura e la view e' aggregata operatore-per-operatore lato UI.
-- =============================================================================
--
-- Regola compenso (JSONB) - DSL unificato:
--   {
--     "tipo": "scaglioni",              -- oppure "nessuno"
--     "scaglioni": [
--       { "da": 0,  "a": 20,  "per_pezzo": 10 },
--       { "da": 20, "per_pezzo": 15 }
--     ],
--     "bonus_soglie": [
--       { "soglia": 40, "bonus": 50 }
--     ],
--     "label": "DEC."                   -- opzionale, mostrata al posto dell'importo
--   }
-- =============================================================================

BEGIN;

-- 1. Flag operatore in gara --------------------------------------------------
ALTER TABLE public.profili
    ADD COLUMN IF NOT EXISTS in_gara boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profili.in_gara IS
    'Se true, l''operatore compare come tabella nella tab Gare Individuali del Dashboard Pezzi';

-- 2. gara_metriche -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gara_metriche (
    id           bigserial PRIMARY KEY,
    nome         text NOT NULL,
    tabella      text NOT NULL,
    gruppo       text,
    ordine       integer NOT NULL DEFAULT 0,
    colore_hex   text NOT NULL DEFAULT '#f1f5f9',
    punti_per_pezzo numeric(10, 2) NOT NULL DEFAULT 1,
    regola       jsonb NOT NULL DEFAULT '{}'::jsonb,
    attiva       boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gm_tabella_chk CHECK (
        tabella IN ('gara_individuale', 'avanzamento_standard',
                    'avanzamento_piva', 'avanzamento_extra_piva')
    )
);

CREATE INDEX IF NOT EXISTS idx_gara_metriche_tabella_ordine
    ON public.gara_metriche(tabella, ordine);

ALTER TABLE public.gara_metriche ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gara_metriche TO authenticated;

DROP POLICY IF EXISTS "auth_select_gara_metriche" ON public.gara_metriche;
CREATE POLICY "auth_select_gara_metriche"
    ON public.gara_metriche FOR SELECT
    TO authenticated USING (true);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.trg_gara_metriche_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_gara_metriche_updated ON public.gara_metriche;
CREATE TRIGGER trg_gara_metriche_updated
    BEFORE UPDATE ON public.gara_metriche
    FOR EACH ROW EXECUTE FUNCTION public.trg_gara_metriche_touch();

-- 3. gara_obiettivi_mensili --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gara_obiettivi_mensili (
    id              bigserial PRIMARY KEY,
    anno            smallint NOT NULL,
    mese            smallint NOT NULL,
    metrica_id      bigint NOT NULL REFERENCES public.gara_metriche(id) ON DELETE CASCADE,
    operatore_id    uuid REFERENCES public.profili(id) ON DELETE CASCADE,
    obiettivo       integer NOT NULL DEFAULT 0,
    compenso_regola jsonb NOT NULL DEFAULT '{"tipo":"nessuno"}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT gom_anno_chk CHECK (anno BETWEEN 2024 AND 2100),
    CONSTRAINT gom_mese_chk CHECK (mese BETWEEN 1 AND 12),
    CONSTRAINT gom_obiettivo_chk CHECK (obiettivo >= 0)
);

-- Unicita' per (anno, mese, metrica, operatore) -- NULL operatore_id ammesso una volta
-- (obiettivo di categoria per l'avanzamento mensile).
CREATE UNIQUE INDEX IF NOT EXISTS uq_gom_anno_mese_metrica_op
    ON public.gara_obiettivi_mensili(anno, mese, metrica_id, COALESCE(operatore_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_gom_anno_mese
    ON public.gara_obiettivi_mensili(anno, mese);

ALTER TABLE public.gara_obiettivi_mensili ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.gara_obiettivi_mensili TO authenticated;

DROP POLICY IF EXISTS "auth_select_gara_obiettivi" ON public.gara_obiettivi_mensili;
CREATE POLICY "auth_select_gara_obiettivi"
    ON public.gara_obiettivi_mensili FOR SELECT
    TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.trg_gom_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_gom_updated ON public.gara_obiettivi_mensili;
CREATE TRIGGER trg_gom_updated
    BEFORE UPDATE ON public.gara_obiettivi_mensili
    FOR EACH ROW EXECUTE FUNCTION public.trg_gom_touch();

-- 4. SEED metriche di partenza ----------------------------------------------
-- Le regole sono ipotesi ragionevoli basate sugli screenshot del Google Sheet
-- attuale. L'admin puo' modificarle liberamente da admin-gare.html.

-- GARA INDIVIDUALE (una tabella per operatore in_gara)
INSERT INTO public.gara_metriche (nome, tabella, gruppo, ordine, colore_hex, regola) VALUES
    ('ATTIVAZIONI TIED',      'gara_individuale', 'Gara', 10, '#BEE3F8',
        '{"categoria":"Mobile","offerta_match":"tied","offerta_not_match":"untied"}'),
    ('TELEFONI FINANZIATI GA','gara_individuale', 'Gara', 20, '#E9D8FD',
        '{"categoria":"Mobile","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}'),
    ('TELEFONI CB',           'gara_individuale', 'Gara', 30, '#FED7AA',
        '{"categoria":"Customer Base"}'),
    ('FISSO',                 'gara_individuale', 'Gara', 40, '#C6F6D5',
        '{"categoria":"Fisso"}'),
    ('LUCE & GAS',            'gara_individuale', 'Gara', 50, '#FEF3C7',
        '{"categoria":"Energia"}'),
    ('PARTITA IVA',           'gara_individuale', 'Gara', 60, '#DDD6FE',
        '{"cluster":"Business"}'),
    ('ASSICURAZIONI',         'gara_individuale', 'Gara', 70, '#BFDBFE',
        '{"categoria":"Assicurazioni"}'),
    ('PROTECTA',              'gara_individuale', 'Gara', 80, '#FECACA',
        '{}');

-- AVANZAMENTO MENSILE - STANDARD
INSERT INTO public.gara_metriche (nome, tabella, gruppo, ordine, colore_hex, punti_per_pezzo, regola) VALUES
    ('MOBILI',            'avanzamento_standard', 'Standard', 10, '#FFE8A3', 1.5,
        '{"categoria":"Mobile"}'),
    ('DEVICE FINANZIATI GA','avanzamento_standard','Standard', 20, '#E9D8FD', 1,
        '{"categoria":"Mobile","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}'),
    ('TELEFONI CB',       'avanzamento_standard', 'Standard', 30, '#FED7AA', 1,
        '{"categoria":"Customer Base"}'),
    ('FISSI',             'avanzamento_standard', 'Standard', 40, '#C6F6D5', 1,
        '{"categoria":"Fisso"}'),
    ('LUCE & GAS',        'avanzamento_standard', 'Standard', 50, '#FEF3C7', 1,
        '{"categoria":"Energia"}'),
    ('ASSICURAZIONI',     'avanzamento_standard', 'Standard', 60, '#BFDBFE', 1,
        '{"categoria":"Assicurazioni"}'),
    ('ALLARMI',           'avanzamento_standard', 'Standard', 70, '#FCA5A5', 1,
        '{"categoria":"Allarmi"}');

-- AVANZAMENTO MENSILE - P.IVA
INSERT INTO public.gara_metriche (nome, tabella, gruppo, ordine, colore_hex, punti_per_pezzo, regola) VALUES
    ('MOBILI P.IVA',        'avanzamento_piva', 'P.IVA', 10, '#FFE8A3', 1,
        '{"categoria":"Mobile","cluster":"Business"}'),
    ('FISSI P.IVA',         'avanzamento_piva', 'P.IVA', 20, '#C6F6D5', 1,
        '{"categoria":"Fisso","cluster":"Business"}'),
    ('LUCE & GAS P.IVA',    'avanzamento_piva', 'P.IVA', 30, '#FEF3C7', 1,
        '{"categoria":"Energia","cluster":"Business"}'),
    ('ASSICURAZIONI P.IVA', 'avanzamento_piva', 'P.IVA', 40, '#BFDBFE', 1,
        '{"categoria":"Assicurazioni","cluster":"Business"}'),
    ('ALLARMI P.IVA',       'avanzamento_piva', 'P.IVA', 50, '#FCA5A5', 1,
        '{"categoria":"Allarmi","cluster":"Business"}');

-- AVANZAMENTO MENSILE - EXTRA GARA P.IVA (regola custom da definire in admin)
INSERT INTO public.gara_metriche (nome, tabella, gruppo, ordine, colore_hex, punti_per_pezzo, regola) VALUES
    ('EXTRA GARA P.IVA',    'avanzamento_extra_piva', 'Extra', 10, '#A7F3D0', 1,
        '{"cluster":"Business"}');

COMMIT;
