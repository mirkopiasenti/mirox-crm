-- 052_protecta_backfill_trattative_per_cellulare.sql
-- Backfill unificato: per ogni numero_cellulare non vuoto raggruppa i
-- preventivi storici sotto un unico trattativa_id (quello del preventivo
-- piu' vecchio del gruppo, cosi' il "canonico" resta il primo record cronologico).
--
-- Prima della migration 051 ogni preventivo era una riga isolata; la 051 ha
-- fatto backfill assegnando a ogni riga il proprio uuid distinto. Questa 052
-- unifica le righe legacy che appartengono al medesimo cliente (identificato
-- dal cellulare, il dato piu' pulito nella tabella).
--
-- Poi, per coerenza commerciale, se un gruppo contiene almeno un preventivo
-- 'Vinto', tutti i preventivi del gruppo diventano 'Vinto' (una trattativa
-- e' vinta quando il cliente ha comprato uno dei kit proposti; gli altri
-- preventivi sono alternative scartate).
--
-- Idempotente: la seconda esecuzione non modifica nulla (IS DISTINCT FROM +
-- guard sul VINTO gia' propagato).

-- Passo 1: unifica trattativa_id per cellulare
WITH canonical AS (
  SELECT DISTINCT ON (numero_cellulare)
         numero_cellulare,
         trattativa_id AS canonical_trattativa_id
    FROM public.vendita_simulatore_protecta
   WHERE numero_cellulare IS NOT NULL
     AND btrim(numero_cellulare) <> ''
   ORDER BY numero_cellulare, data_preventivo ASC, id ASC
)
UPDATE public.vendita_simulatore_protecta v
   SET trattativa_id = c.canonical_trattativa_id
  FROM canonical c
 WHERE v.numero_cellulare = c.numero_cellulare
   AND v.trattativa_id IS DISTINCT FROM c.canonical_trattativa_id;

-- Passo 2: propaga Vinto a tutti i preventivi della trattativa se ne esiste almeno uno
WITH trattative_vinte AS (
  SELECT DISTINCT trattativa_id
    FROM public.vendita_simulatore_protecta
   WHERE stato = 'Vinto'
)
UPDATE public.vendita_simulatore_protecta v
   SET stato = 'Vinto'
  FROM trattative_vinte t
 WHERE v.trattativa_id = t.trattativa_id
   AND v.stato IS DISTINCT FROM 'Vinto';
