-- =============================================================================
-- Migration 039: Policy scrittura admin per gara_metriche + gara_obiettivi_mensili
-- =============================================================================
-- Le policy di lettura per authenticated sono state create in 038.
-- Qui aggiungiamo INSERT/UPDATE/DELETE riservate agli admin, con subquery
-- su profili.ruolo = 'admin'. Idem per profili.in_gara (colonna gia' esistente,
-- serve solo il permesso di aggiornarla dagli utenti admin).
--
-- Nota: profili ha gia' policy di scrittura piu' larghe gestite altrove.
-- =============================================================================

BEGIN;

-- gara_metriche ---------------------------------------------------------------
DROP POLICY IF EXISTS "admin_write_gara_metriche" ON public.gara_metriche;
CREATE POLICY "admin_write_gara_metriche"
    ON public.gara_metriche FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profili p
            WHERE p.id = auth.uid() AND p.ruolo = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profili p
            WHERE p.id = auth.uid() AND p.ruolo = 'admin'
        )
    );

GRANT INSERT, UPDATE, DELETE ON public.gara_metriche TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.gara_metriche_id_seq TO authenticated;

-- gara_obiettivi_mensili ------------------------------------------------------
DROP POLICY IF EXISTS "admin_write_gara_obiettivi" ON public.gara_obiettivi_mensili;
CREATE POLICY "admin_write_gara_obiettivi"
    ON public.gara_obiettivi_mensili FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profili p
            WHERE p.id = auth.uid() AND p.ruolo = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profili p
            WHERE p.id = auth.uid() AND p.ruolo = 'admin'
        )
    );

GRANT INSERT, UPDATE, DELETE ON public.gara_obiettivi_mensili TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.gara_obiettivi_mensili_id_seq TO authenticated;

COMMIT;
