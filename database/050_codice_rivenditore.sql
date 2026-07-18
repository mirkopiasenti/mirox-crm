-- Migrazione 050 - Codice Rivenditore (punto vendita di inserimento)
--
-- Contesto: due negozi Kona Tech con codice punto vendita distinto:
--   * Legnago: 9001415852 (negozio principale, dove lavora Mirox)
--   * Cerea:   9000822241 (negozio piccolo, senza gestionale)
-- I contratti acquisiti a Legnago possono essere spostati amministrativamente
-- a Cerea. La distinzione serve per filtrare Dashboard Pezzi Day by Day e
-- Avanzamento Mensile (solo Legnago), mentre Gare Individuali conteggia tutto.
--
-- Backfill: tutti i contratti storici prendono il DEFAULT '9001415852' (Legnago).
--
-- Fix collaterale: pvcf_cod_pos_chk in post_vendita_controllo_fissi aveva il
-- codice Cerea troncato a 9 cifre ('900822241' invece di '9000822241'). Verifica
-- in prod: 244 righe con Legnago, 0 con la vecchia stringa Cerea. Update sicuro.

-- ============================================================================
-- 1) vendita_contratti.codice_rivenditore
-- ============================================================================
ALTER TABLE vendita_contratti
  ADD COLUMN IF NOT EXISTS codice_rivenditore text NOT NULL DEFAULT '9001415852';

ALTER TABLE vendita_contratti DROP CONSTRAINT IF EXISTS vc_codice_rivenditore_chk;
ALTER TABLE vendita_contratti
  ADD CONSTRAINT vc_codice_rivenditore_chk
  CHECK (codice_rivenditore IN ('9001415852','9000822241'));

CREATE INDEX IF NOT EXISTS idx_vendita_contratti_codice_rivenditore
  ON vendita_contratti (codice_rivenditore);

COMMENT ON COLUMN vendita_contratti.codice_rivenditore IS
  'Codice punto vendita di inserimento del contratto. 9001415852 = Legnago, 9000822241 = Cerea. Filtro Day by Day / Avanzamento (solo Legnago). Migration 050.';

-- ============================================================================
-- 2) Fix pvcf_cod_pos_chk (codice Cerea 9 -> 10 cifre)
-- ============================================================================
ALTER TABLE post_vendita_controllo_fissi DROP CONSTRAINT IF EXISTS pvcf_cod_pos_chk;
ALTER TABLE post_vendita_controllo_fissi
  ADD CONSTRAINT pvcf_cod_pos_chk
  CHECK (cod_pos IS NULL OR cod_pos IN ('9001415852','9000822241'));
