-- =============================================================================
-- Migration 046: aggiorna regole metriche + separa tipo_compenso da tipo_conteggio
-- =============================================================================
-- Modifiche richieste:
--
-- 1. ATTIVAZIONI TIED (gara_individuale) — allarga offerta_match per includere
--    "Fwa Indoor" oltre a tutte le varianti Tied (Tied, Tied Call Your Country,
--    Tied Underground, Tied Dati). Esclusione "Untied" invariata.
--
-- 2. TELEFONI CB (gara_individuale) — regola OR: matcha sia i Customer Base sia
--    le offerte "Telefono Incluso" (indipendente dalla categoria).
--
-- 3. FISSO (gara_individuale) — regola invariata, ma introdotto meccanismo
--    `bonus_conteggio`: ogni contratto Fisso conta 1, se ha opzione "2° Linea"
--    conta 2 (bonus di 1). Match opzione: 2 Linea / 2° Linea / 2ª Linea /
--    Seconda Linea (case insensitive, senza distinguere apostrofi/simboli).
--
-- 4. PARTITA IVA (gara_individuale) — scisso il tipo_conteggio (individuale) dal
--    tipo_compenso (squadra): ogni operatore vede i propri pezzi P.IVA, ma
--    l'obiettivo e il compenso sono comuni al negozio.
--    Serve nuova colonna gara_metriche.tipo_compenso.
-- =============================================================================

BEGIN;

-- Nuova colonna tipo_compenso -----------------------------------------------
ALTER TABLE public.gara_metriche
    ADD COLUMN IF NOT EXISTS tipo_compenso text NOT NULL DEFAULT 'individuale';

ALTER TABLE public.gara_metriche
    DROP CONSTRAINT IF EXISTS gm_tipo_compenso_chk;
ALTER TABLE public.gara_metriche
    ADD CONSTRAINT gm_tipo_compenso_chk CHECK (tipo_compenso IN ('individuale', 'squadra'));

COMMENT ON COLUMN public.gara_metriche.tipo_compenso IS
    '''individuale''=obiettivo/compenso per operatore; ''squadra''=obiettivo/compenso comune al negozio (salvato con operatore_id=NULL). Scisso da tipo_conteggio: si possono avere metriche con conteggio individuale e compenso di squadra (es. Partita IVA).';

-- Backfill: metriche con conteggio squadra ereditano compenso squadra
-- (comportamento invariato per chi era gia' impostato "squadra")
UPDATE public.gara_metriche
    SET tipo_compenso = 'squadra'
    WHERE tipo_conteggio = 'squadra';

-- 1. ATTIVAZIONI TIED --------------------------------------------------------
UPDATE public.gara_metriche
    SET regola = '{"categoria":"Mobile","offerta_match":"fwa\\s*indoor|tied","offerta_not_match":"untied"}'::jsonb
    WHERE tabella = 'gara_individuale' AND nome = 'ATTIVAZIONI TIED';

-- 2. TELEFONI CB -------------------------------------------------------------
-- OR: categoria Customer Base OPPURE offerta contiene "Telefono Incluso"
UPDATE public.gara_metriche
    SET regola = '{"or":[{"categoria":"Customer Base"},{"offerta_match":"telefono\\s*incluso"}]}'::jsonb
    WHERE tabella = 'gara_individuale' AND nome = 'TELEFONI CB';

-- 3. FISSO — bonus_conteggio per opzione "2° Linea" -------------------------
UPDATE public.gara_metriche
    SET regola = '{"categoria":"Fisso","bonus_conteggio":[{"opzione_match":"2\\s*(a|°|ª)?\\s*linea|seconda\\s*linea","peso":1}]}'::jsonb
    WHERE tabella = 'gara_individuale' AND nome = 'FISSO';

-- 4. PARTITA IVA — conteggio individuale, compenso squadra ------------------
UPDATE public.gara_metriche
    SET tipo_conteggio = 'individuale',
        tipo_compenso = 'squadra'
    WHERE tabella = 'gara_individuale' AND nome = 'PARTITA IVA';

COMMIT;
