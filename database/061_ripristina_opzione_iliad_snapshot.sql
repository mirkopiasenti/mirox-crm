-- Migration 061
-- Ripristina ID e nome snapshot dell'opzione MNP Iliad su 7 contratti Mobile.
--
-- I punteggi erano già corretti (1 punto offerta + 1 punto opzione), ma il
-- vecchio flusso Verifica Contratti precedente al 20/07/2026 poteva aggiornare
-- opzione_id/nome snapshot senza riallineare i punteggi. L'audit dei 7 PDA ha
-- confermato testualmente "Operatore attuale: Iliad Italia" in ogni contratto;
-- tutti hanno inoltre la copia SIM MNP e l'opzione è associata alle 3 offerte.

BEGIN;

CREATE TEMP TABLE mirox_iliad_snapshot_targets
ON COMMIT DROP
AS
SELECT c.*
FROM public.vendita_contratti c
WHERE c.id IN (
  '5d6fb907-ddbe-427f-83d3-7a8768638c8a',
  '94f104d9-ecbc-4a58-8cd7-b5468cae803a',
  '6514f274-9b05-45ee-ab26-a74d4c832033',
  'c5a204cc-29cc-42f3-967b-d1f61dc62d61',
  '9aa32b6a-a7b8-480c-a442-c89042ff446e',
  '51bc1227-74be-4fe4-a2a2-0e1123a93808',
  '2b710b97-e244-421f-a8e8-94ff42030f7e'
);

DO $$
DECLARE
  v_invalid integer;
  v_option_name text;
  v_option_score numeric;
BEGIN
  IF (SELECT count(*) FROM mirox_iliad_snapshot_targets) <> 7 THEN
    RAISE EXCEPTION
      'Backfill opzione Iliad interrotto: non sono presenti tutti i 7 contratti';
  END IF;

  SELECT nome_opzione, punteggio_gara
  INTO v_option_name, v_option_score
  FROM public.vendita_opzioni
  WHERE id = '23057455-cfbe-457b-8f1c-0344f54e6ddf';

  IF v_option_name IS DISTINCT FROM
       'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali'
     OR v_option_score IS DISTINCT FROM 1::numeric THEN
    RAISE EXCEPTION
      'Backfill opzione Iliad interrotto: catalogo diverso dallo stato verificato';
  END IF;

  SELECT count(*)
  INTO v_invalid
  FROM mirox_iliad_snapshot_targets c
  WHERE c.categoria_snapshot IS DISTINCT FROM 'Mobile'
     OR c.opzione_id IS NOT NULL
     OR c.nome_opzione_snapshot IS DISTINCT FROM '—'
     OR c.punteggio_gara_opzione IS DISTINCT FROM 1::numeric
     OR c.punteggio_gara_offerta IS DISTINCT FROM 1::numeric
     OR NOT EXISTS (
       SELECT 1
       FROM public.vendita_documenti d
       WHERE d.contratto_id = c.id
         AND d.tipo_documento = 'copia_sim_mnp'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.vendita_offerte_opzioni vo
       WHERE vo.offerta_id = c.offerta_id
         AND vo.opzione_id = '23057455-cfbe-457b-8f1c-0344f54e6ddf'
     );

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION
      'Backfill opzione Iliad interrotto: % contratti non corrispondono allo stato verificato',
      v_invalid;
  END IF;
END
$$;

-- Audit esplicito: non cambia un componente punteggio, quindi il trigger della
-- migration 058 non scatta per questa correzione di metadati catalogo.
INSERT INTO public.vendita_log_modifiche (
  tabella,
  record_id,
  azione,
  dati_precedenti,
  dati_nuovi,
  created_by
)
SELECT
  'vendita_contratti',
  c.id,
  'catalog_snapshot_backfill',
  jsonb_build_object(
    'opzione_id', c.opzione_id,
    'nome_opzione_snapshot', c.nome_opzione_snapshot,
    'punteggio_gara_opzione', c.punteggio_gara_opzione
  ),
  jsonb_build_object(
    'opzione_id', '23057455-cfbe-457b-8f1c-0344f54e6ddf',
    'nome_opzione_snapshot', 'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali',
    'punteggio_gara_opzione', c.punteggio_gara_opzione,
    'migration', '061_ripristina_opzione_iliad_snapshot',
    'evidenza', 'PDA: Operatore attuale Iliad Italia'
  ),
  NULL
FROM mirox_iliad_snapshot_targets c;

UPDATE public.vendita_contratti
SET
  opzione_id = '23057455-cfbe-457b-8f1c-0344f54e6ddf',
  nome_opzione_snapshot = 'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali'
WHERE id IN (
  '5d6fb907-ddbe-427f-83d3-7a8768638c8a',
  '94f104d9-ecbc-4a58-8cd7-b5468cae803a',
  '6514f274-9b05-45ee-ab26-a74d4c832033',
  'c5a204cc-29cc-42f3-967b-d1f61dc62d61',
  '9aa32b6a-a7b8-480c-a442-c89042ff446e',
  '51bc1227-74be-4fe4-a2a2-0e1123a93808',
  '2b710b97-e244-421f-a8e8-94ff42030f7e'
);

DO $$
DECLARE
  v_invalid integer;
  v_audit integer;
BEGIN
  SELECT count(*)
  INTO v_invalid
  FROM public.vendita_contratti
  WHERE id IN (
    '5d6fb907-ddbe-427f-83d3-7a8768638c8a',
    '94f104d9-ecbc-4a58-8cd7-b5468cae803a',
    '6514f274-9b05-45ee-ab26-a74d4c832033',
    'c5a204cc-29cc-42f3-967b-d1f61dc62d61',
    '9aa32b6a-a7b8-480c-a442-c89042ff446e',
    '51bc1227-74be-4fe4-a2a2-0e1123a93808',
    '2b710b97-e244-421f-a8e8-94ff42030f7e'
  )
    AND (
      opzione_id IS DISTINCT FROM '23057455-cfbe-457b-8f1c-0344f54e6ddf'::uuid
      OR nome_opzione_snapshot IS DISTINCT FROM
        'MNP da seguenti operatori: Iliad - Coop - Poste - Tiscali'
      OR punteggio_gara_opzione IS DISTINCT FROM 1::numeric
      OR punteggio_gara_totale IS DISTINCT FROM 2::numeric
    );

  SELECT count(*)
  INTO v_audit
  FROM public.vendita_log_modifiche
  WHERE tabella = 'vendita_contratti'
    AND record_id IN (
      '5d6fb907-ddbe-427f-83d3-7a8768638c8a',
      '94f104d9-ecbc-4a58-8cd7-b5468cae803a',
      '6514f274-9b05-45ee-ab26-a74d4c832033',
      'c5a204cc-29cc-42f3-967b-d1f61dc62d61',
      '9aa32b6a-a7b8-480c-a442-c89042ff446e',
      '51bc1227-74be-4fe4-a2a2-0e1123a93808',
      '2b710b97-e244-421f-a8e8-94ff42030f7e'
    )
    AND azione = 'catalog_snapshot_backfill'
    AND dati_nuovi->>'migration' = '061_ripristina_opzione_iliad_snapshot';

  IF v_invalid <> 0 OR v_audit <> 7 THEN
    RAISE EXCEPTION
      'Backfill opzione Iliad incompleto: contratti non coerenti %, audit trovati %',
      v_invalid,
      v_audit;
  END IF;
END
$$;

COMMIT;
