-- =============================================================================
-- Migration 044: rinomina metriche "ALLARMI" in "W3 PROTETTI"
-- =============================================================================
-- Solo etichette: le regole matching restano ancorate a categoria='Allarmi'
-- (che e' il valore salvato in vendita_contratti.categoria_snapshot).
--
-- avanzamento_standard: "ALLARMI"       → "W3 PROTETTI"
-- avanzamento_piva:     "ALLARMI P.IVA" → "W3 PROTETTI P.IVA"
-- =============================================================================

BEGIN;

UPDATE public.gara_metriche
    SET nome = 'W3 PROTETTI'
    WHERE tabella = 'avanzamento_standard' AND nome = 'ALLARMI';

UPDATE public.gara_metriche
    SET nome = 'W3 PROTETTI P.IVA'
    WHERE tabella = 'avanzamento_piva' AND nome = 'ALLARMI P.IVA';

COMMIT;
