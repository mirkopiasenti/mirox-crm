-- =============================================================================
-- Migration 049: W3 PROTETTI (Avanzamento Standard) usa punteggio_gara_totale
-- =============================================================================
-- Fino ad ora la riga W3 PROTETTI (categoria Allarmi) dell'Avanzamento Standard
-- non aveva punteggio_campo → fallback al conteggio pezzi.
-- Ora la allineiamo a MOBILI/FISSI/ASSICURAZIONI: somma di punteggio_gara_totale
-- sui contratti Allarmi Legnago che passano il filtro post-vendita
-- (stato IN 'In Attivazione' o 'OK', gestito lato client in dashboard_pezzi).
-- =============================================================================

BEGIN;

UPDATE public.gara_metriche
    SET punteggio_campo = 'punteggio_gara_totale'
    WHERE tabella = 'avanzamento_standard' AND nome = 'W3 PROTETTI';

COMMIT;
