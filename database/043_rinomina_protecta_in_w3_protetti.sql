-- =============================================================================
-- Migration 043: rinomina PROTECTA in "W3 PROTETTI"
-- =============================================================================
-- Nome commerciale corretto: la riga metrica va mostrata come "W3 PROTETTI"
-- sia nella tab Gara Individuali sia nell'Avanzamento Mensile (dove eventualmente
-- venga aggiunta in futuro) sia nell'editor admin.
-- =============================================================================

BEGIN;

UPDATE public.gara_metriche
    SET nome = 'W3 PROTETTI'
    WHERE nome = 'PROTECTA';

-- Coerenza: se in futuro esistono ancora residui di PROTECTA - Finanziato/Anticipo
-- (post migrations 041/042), li porto anche loro sul nome nuovo.
UPDATE public.gara_metriche
    SET nome = replace(nome, 'PROTECTA', 'W3 PROTETTI')
    WHERE nome ILIKE '%PROTECTA%';

COMMIT;
