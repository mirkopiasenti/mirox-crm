-- Migration 060
-- Ripristina il bonus da 0,5 punti su tre Assicurazioni Annuali di luglio.
--
-- Ricostruzione:
--   - bonus configurato e attivo dal 15/07/2026;
--   - contratti creati il 20/07 e 23/07;
--   - la verifica eseguita prima del fix 25/07 azzerò i componenti;
--   - il successivo riallineamento al catalogo ripristinò il valore base, ma
--     non il bonus Annuale perché il bonus non è memorizzato nel catalogo.
--
-- La migration 058 è già attiva: ogni UPDATE viene quindi registrato anche
-- dal trigger audit punteggi, oltre alle guardie esplicite qui sotto.

BEGIN;

DO $$
DECLARE
  v_invalid integer;
  v_bonus numeric;
BEGIN
  SELECT valore::numeric
  INTO v_bonus
  FROM public.impostazioni
  WHERE chiave = 'bonus_assicurazione_annuale';

  IF v_bonus IS DISTINCT FROM 0.5::numeric THEN
    RAISE EXCEPTION
      'Backfill bonus interrotto: bonus attuale %, atteso 0.5',
      v_bonus;
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM public.vendita_contratti c
  WHERE c.id IN (
    '817fae6c-5e5a-4983-b611-81a3a0035e4b',
    '7273d933-cfae-4c6a-89ab-2333b129a7c8',
    'eb6b456b-985f-47b2-a80c-4df68b594e46'
  )
    AND (
      c.categoria_snapshot IS DISTINCT FROM 'Assicurazioni'
      OR c.ricorrenza_assicurazione IS DISTINCT FROM 'Annuale'
      OR c.opzione_id IS NOT NULL
      OR c.punteggio_gara_opzione IS DISTINCT FROM 0::numeric
      OR c.punteggio_gara_offerta IS DISTINCT FROM 1.5::numeric
    );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION
      'Backfill bonus interrotto: % contratti non corrispondono allo stato atteso',
      v_invalid;
  END IF;

  IF (
    SELECT count(*)
    FROM public.vendita_contratti
    WHERE id IN (
      '817fae6c-5e5a-4983-b611-81a3a0035e4b',
      '7273d933-cfae-4c6a-89ab-2333b129a7c8',
      'eb6b456b-985f-47b2-a80c-4df68b594e46'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'Backfill bonus interrotto: non sono presenti tutti i 3 contratti attesi';
  END IF;
END
$$;

UPDATE public.vendita_contratti
SET punteggio_gara_opzione = 0.5
WHERE id IN (
  '817fae6c-5e5a-4983-b611-81a3a0035e4b',
  '7273d933-cfae-4c6a-89ab-2333b129a7c8',
  'eb6b456b-985f-47b2-a80c-4df68b594e46'
);

-- Marca i tre audit generati dal trigger della migration 058.
UPDATE public.vendita_log_modifiche
SET dati_nuovi = coalesce(dati_nuovi, '{}'::jsonb)
  || jsonb_build_object('migration', '060_ripristina_bonus_assicurazioni_annuali')
WHERE tabella = 'vendita_contratti'
  AND record_id IN (
    '817fae6c-5e5a-4983-b611-81a3a0035e4b',
    '7273d933-cfae-4c6a-89ab-2333b129a7c8',
    'eb6b456b-985f-47b2-a80c-4df68b594e46'
  )
  AND azione = 'punteggio_update'
  AND created_at >= transaction_timestamp();

DO $$
DECLARE
  v_invalid integer;
  v_audit integer;
BEGIN
  SELECT count(*)
  INTO v_invalid
  FROM public.vendita_contratti
  WHERE id IN (
    '817fae6c-5e5a-4983-b611-81a3a0035e4b',
    '7273d933-cfae-4c6a-89ab-2333b129a7c8',
    'eb6b456b-985f-47b2-a80c-4df68b594e46'
  )
    AND (
      punteggio_gara_opzione IS DISTINCT FROM 0.5::numeric
      OR punteggio_gara_totale IS DISTINCT FROM 2::numeric
      OR punteggio_opzione IS DISTINCT FROM 0.5::numeric
      OR punteggio_totale IS DISTINCT FROM 2::numeric
    );

  SELECT count(*)
  INTO v_audit
  FROM public.vendita_log_modifiche
  WHERE tabella = 'vendita_contratti'
    AND record_id IN (
      '817fae6c-5e5a-4983-b611-81a3a0035e4b',
      '7273d933-cfae-4c6a-89ab-2333b129a7c8',
      'eb6b456b-985f-47b2-a80c-4df68b594e46'
    )
    AND azione = 'punteggio_update'
    AND dati_nuovi->>'migration' = '060_ripristina_bonus_assicurazioni_annuali';

  IF v_invalid <> 0 OR v_audit <> 3 THEN
    RAISE EXCEPTION
      'Backfill bonus incompleto: contratti non coerenti %, audit trovati %',
      v_invalid,
      v_audit;
  END IF;
END
$$;

COMMIT;
