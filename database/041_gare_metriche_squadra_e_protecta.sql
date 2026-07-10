-- =============================================================================
-- Migration 041: tipo_conteggio + refactor metriche Protecta e P.IVA
-- =============================================================================
-- 1) Aggiunge gara_metriche.tipo_conteggio ('individuale' | 'squadra').
--    Metriche squadra = obiettivo di negozio, calcolato sommando i contratti
--    di TUTTI gli operatori del mese. Il compenso viene mostrato uguale in
--    ogni card operatore (l'obiettivo si salva con operatore_id=NULL, come
--    per l'Avanzamento).
--
-- 2) Refactor riga PROTECTA (che era senza regola): diventa 2 righe distinte
--    - PROTECTA - Finanziato  → Allarmi con modalita_pagamento=Finanziamento
--    - PROTECTA - Anticipo    → Allarmi con modalita_pagamento=Anticipo
--    Cosi' i due compensi (€50/pz e €30/pz nel caso attuale) si configurano
--    da admin come metriche indipendenti, senza inventare DSL condizionali.
--
-- 3) Refactor riga PARTITA IVA: da individuale a squadra.
-- =============================================================================

BEGIN;

-- 1. tipo_conteggio ---------------------------------------------------------
ALTER TABLE public.gara_metriche
    ADD COLUMN IF NOT EXISTS tipo_conteggio text NOT NULL DEFAULT 'individuale';

ALTER TABLE public.gara_metriche
    DROP CONSTRAINT IF EXISTS gm_tipo_conteggio_chk;
ALTER TABLE public.gara_metriche
    ADD CONSTRAINT gm_tipo_conteggio_chk CHECK (tipo_conteggio IN ('individuale', 'squadra'));

COMMENT ON COLUMN public.gara_metriche.tipo_conteggio IS
    '''individuale''=conteggio per operatore (attuale = contratti dell''operatore); ''squadra''=conteggio negozio (attuale = tutti i contratti del mese). Obiettivo squadra e'' salvato con operatore_id=NULL in gara_obiettivi_mensili.';

-- 2. Refactor PROTECTA -------------------------------------------------------
-- Aggiorna la riga esistente a Finanziato
UPDATE public.gara_metriche
    SET nome = 'PROTECTA - Finanziato',
        regola = '{"categoria":"Allarmi","modalita_pagamento":"Finanziamento"}'::jsonb,
        ordine = 80
    WHERE tabella = 'gara_individuale' AND nome = 'PROTECTA';

-- Inserisce la seconda variante Anticipo (solo se non esiste gia')
INSERT INTO public.gara_metriche (nome, tabella, gruppo, ordine, colore_hex, regola)
    SELECT 'PROTECTA - Anticipo', 'gara_individuale', 'Gara', 85, '#FECACA',
           '{"categoria":"Allarmi","modalita_pagamento":"Anticipo"}'::jsonb
    WHERE NOT EXISTS (
        SELECT 1 FROM public.gara_metriche
        WHERE tabella='gara_individuale' AND nome='PROTECTA - Anticipo'
    );

-- 3. PARTITA IVA passa a squadra --------------------------------------------
UPDATE public.gara_metriche
    SET tipo_conteggio = 'squadra'
    WHERE tabella = 'gara_individuale' AND nome = 'PARTITA IVA';

COMMIT;
