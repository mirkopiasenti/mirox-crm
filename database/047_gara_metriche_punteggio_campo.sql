-- =============================================================================
-- Migration 047: punteggio_campo su gara_metriche + punteggio reale dai contratti
-- =============================================================================
-- Il punteggio della colonna "Punteggio" dell'Avanzamento Mensile NON e' piu'
-- un moltiplicatore fisso (punti_per_pezzo) ma la SOMMA di una colonna punteggio
-- gia' presente su vendita_contratti, calcolata per riga metrica.
--
-- `punteggio_campo` (text nullable) nomina la colonna di vendita_contratti da
-- sommare sui contratti che matchano la regola della metrica. Se NULL, il
-- frontend fa fallback al conteggio pezzi (comportamento neutro in attesa di
-- configurare la riga).
--
-- Colonne punteggio disponibili su vendita_contratti (numeric):
--   punteggio_gara_offerta, punteggio_gara_opzione, punteggio_gara_totale,
--   punteggio_extra_gara_offerta, punteggio_extra_gara_opzione,
--   punteggio_offerta, punteggio_opzione, punteggio_totale
--
-- Questa migration configura SOLO la riga MOBILI (avanzamento_standard) a
-- sommare `punteggio_gara_totale`. Le altre righe restano NULL e verranno
-- configurate nei passi successivi.
--
-- `punti_per_pezzo` resta in tabella per compatibilita' storica ma non e' piu'
-- usato dal frontend per il calcolo del punteggio.
-- =============================================================================

BEGIN;

ALTER TABLE public.gara_metriche
    ADD COLUMN IF NOT EXISTS punteggio_campo text;

COMMENT ON COLUMN public.gara_metriche.punteggio_campo IS
    'Nome della colonna numerica di vendita_contratti da sommare per la colonna Punteggio dell''Avanzamento (es. punteggio_gara_totale). NULL = fallback al conteggio pezzi.';

UPDATE public.gara_metriche
    SET punteggio_campo = 'punteggio_gara_totale'
    WHERE tabella = 'avanzamento_standard' AND nome = 'MOBILI';

COMMIT;
