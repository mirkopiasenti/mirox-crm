-- =============================================================================
-- Migration 048: descrizione operatore-facing sulle metriche
-- =============================================================================
-- Testo semplice mostrato in popup quando l'operatore clicca sulla riga della
-- metrica nella tab "Gare Individuali" del Dashboard Pezzi.
-- Editabile dall'admin nella card "Configurazione avanzata metriche".
-- =============================================================================

BEGIN;

ALTER TABLE public.gara_metriche
    ADD COLUMN IF NOT EXISTS descrizione text;

COMMENT ON COLUMN public.gara_metriche.descrizione IS
    'Testo semplice mostrato agli operatori come popup di aiuto sulla riga della metrica (tab Gare Individuali). Editabile da admin-gare.';

COMMIT;
