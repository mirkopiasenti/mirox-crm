-- =============================================================================
-- Migration 042: unifica le due righe PROTECTA in una sola metrica
-- =============================================================================
-- La migration 041 aveva splittato PROTECTA in due righe distinte
-- (PROTECTA - Finanziato, PROTECTA - Anticipo) per configurare compensi
-- differenti per tipo pagamento. UX pesante perche' ogni operatore vede due
-- righe con conteggi separati che semanticamente sono la stessa metrica.
--
-- Con l'introduzione del nuovo tipo compenso `per_pezzo_variabile` (DSL:
-- `{tipo:'per_pezzo_variabile', campo:'modalita_pagamento', casi:[{valore,importo}]}`),
-- una sola riga PROTECTA (matcha tutti i contratti Allarmi) copre entrambi
-- i casi: il compenso viene calcolato sommando il caso corrispondente al
-- valore del campo per ciascun contratto.
--
-- Azioni:
--   1. Riporta la riga PROTECTA - Finanziato al nome originale PROTECTA
--      con regola generica su Allarmi
--   2. Cancella la riga PROTECTA - Anticipo (cascade toglie eventuali
--      obiettivi orfani su gara_obiettivi_mensili)
-- =============================================================================

BEGIN;

UPDATE public.gara_metriche
    SET nome = 'PROTECTA',
        regola = '{"categoria":"Allarmi"}'::jsonb,
        ordine = 80
    WHERE tabella = 'gara_individuale' AND nome = 'PROTECTA - Finanziato';

DELETE FROM public.gara_metriche
    WHERE tabella = 'gara_individuale' AND nome = 'PROTECTA - Anticipo';

COMMIT;
