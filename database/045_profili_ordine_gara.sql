-- =============================================================================
-- Migration 045: ordine_gara sui profili
-- =============================================================================
-- Aggiunge una colonna `ordine_gara` int (default 0) usata per ordinare le
-- colonne operatore nella Dashboard Pezzi (Gare Individuali, Avanzamento).
-- Ordinamento effettivo: ordine_gara ASC, poi nome ASC come tiebreaker.
--
-- Valori iniziali richiesti dall'utente: Matteo=10, Francesca=20, Mirko=30
-- (nell'ordine da sinistra a destra).
-- =============================================================================

BEGIN;

ALTER TABLE public.profili
    ADD COLUMN IF NOT EXISTS ordine_gara integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profili.ordine_gara IS
    'Peso di ordinamento delle colonne operatore nella Dashboard Pezzi (piu'' basso = piu'' a sinistra). 0 = default; fallback su nome per profili con lo stesso valore.';

UPDATE public.profili SET ordine_gara = 10 WHERE nome = 'Matteo';
UPDATE public.profili SET ordine_gara = 20 WHERE nome = 'Francesca';
UPDATE public.profili SET ordine_gara = 30 WHERE nome = 'Mirko';

COMMIT;
