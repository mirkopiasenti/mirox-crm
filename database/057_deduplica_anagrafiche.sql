-- Migration 057
-- Consolida sette anagrafiche duplicate certe individuate il 26/07/2026.
--
-- Criteri ammessi per questa bonifica:
--   - stessa P.IVA con zero iniziale omesso;
--   - stesso CF con carattere di controllo errato;
--   - identificatore manifestamente invalido duplicato nello stesso import.
--
-- Le omonimie con CF/P.IVA validi e distinti NON vengono consolidate.
-- Tutte le FK sono spostate prima della cancellazione e il record eliminato
-- resta recuperabile in vendita_log_modifiche.

BEGIN;

CREATE TEMP TABLE mirox_anagrafica_merge_map (
  loser_id uuid PRIMARY KEY,
  survivor_id uuid NOT NULL,
  expected_loser_cf text NOT NULL,
  expected_survivor_cf text NOT NULL
) ON COMMIT DROP;

INSERT INTO mirox_anagrafica_merge_map
  (loser_id, survivor_id, expected_loser_cf, expected_survivor_cf)
VALUES
  ('067eb0a0-d032-4745-b652-4845fbf5e8a9', '7a1546af-ad35-4e7e-ab7a-b04f831f169f', '3956870236',       '03956870236'),
  ('1d8bfe49-831a-4c79-80b9-7a64229ed94e', '50bd3b5c-0810-4096-bf82-ef26e7400b23', '3451630283',       '03451630283'),
  ('e4570cdd-2503-41d9-b229-f7333fc8dcf5', 'c0582fa1-9b6b-4bba-9b3b-95b5a2819315', '3474500001',       '03474500001'),
  ('6eaa2c5a-3faf-446a-bf0f-ffd471e66939', '8c685507-624a-48ee-9e95-19485f180db7', '3984861207',       '03984861207'),
  ('13cfb945-be49-44e2-8151-ca9d56aea2b1', '2720e3b0-a42f-459b-a71a-299bd5ad3235', 'CRZRRT67H06E512L', 'CRZRRT67H06E512K'),
  ('241ca62e-1e5b-4d3a-96b6-c76c0e875cb9', '01e3a2fa-99ed-475d-b999-e428f29a8d83', 'MARCO CAVALLETTO', 'CVLMRC75P12A539Q'),
  ('dfd71db9-1cb2-4b0b-bf81-19de1b3e8832', 'b99db9d5-8a7a-4e83-bca5-d95d752d994a', 'DLCWTR62A19D548A', 'DLCWTR70L10E512S');

-- Guardia contro applicazioni sul dataset sbagliato o parzialmente mutato.
DO $$
DECLARE
  v_invalid integer;
BEGIN
  SELECT count(*)
  INTO v_invalid
  FROM mirox_anagrafica_merge_map m
  LEFT JOIN public.anagrafica loser ON loser.id = m.loser_id
  LEFT JOIN public.anagrafica survivor ON survivor.id = m.survivor_id
  WHERE loser.id IS NULL
     OR survivor.id IS NULL
     OR loser.cf_piva IS DISTINCT FROM m.expected_loser_cf
     OR survivor.cf_piva IS DISTINCT FROM m.expected_survivor_cf;

  IF v_invalid <> 0 THEN
    RAISE EXCEPTION
      'Bonifica anagrafiche interrotta: % mapping non corrispondono al dataset atteso',
      v_invalid;
  END IF;
END
$$;

-- Audit recuperabile dei record che verranno eliminati.
INSERT INTO public.vendita_log_modifiche (
  tabella,
  record_id,
  azione,
  dati_precedenti,
  dati_nuovi,
  created_by
)
SELECT
  'anagrafica',
  loser.id,
  'merge_duplicate',
  to_jsonb(loser),
  jsonb_build_object(
    'survivor_id', survivor.id,
    'survivor_cf_piva', survivor.cf_piva,
    'migration', '057_deduplica_anagrafiche'
  ),
  NULL
FROM mirox_anagrafica_merge_map m
JOIN public.anagrafica loser ON loser.id = m.loser_id
JOIN public.anagrafica survivor ON survivor.id = m.survivor_id;

-- Completa il survivor solo con eventuali dati mancanti presenti nel loser.
UPDATE public.anagrafica survivor
SET
  cluster = coalesce(nullif(btrim(survivor.cluster), ''), loser.cluster),
  ragione_sociale = coalesce(nullif(btrim(survivor.ragione_sociale), ''), loser.ragione_sociale),
  nome_referente = coalesce(nullif(btrim(survivor.nome_referente), ''), loser.nome_referente),
  cellulare = coalesce(nullif(btrim(survivor.cellulare), ''), loser.cellulare),
  email = coalesce(nullif(btrim(survivor.email), ''), loser.email),
  provincia = coalesce(nullif(btrim(survivor.provincia), ''), loser.provincia),
  comune = coalesce(nullif(btrim(survivor.comune), ''), loser.comune),
  via = coalesce(nullif(btrim(survivor.via), ''), loser.via),
  civico = coalesce(nullif(btrim(survivor.civico), ''), loser.civico),
  updated_at = now()
FROM mirox_anagrafica_merge_map m
JOIN public.anagrafica loser ON loser.id = m.loser_id
WHERE survivor.id = m.survivor_id;

-- FK Call Center.
UPDATE public.appuntamenti x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.chiamate x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.call_center_lead_outbound_chiamate x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

-- FK Vendita.
UPDATE public.vendita_pratiche x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.vendita_contratti x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.vendita_documenti x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.vendita_consensi_privacy x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.vendita_consensi_privacy_v2 x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.vendita_ordini_smartphone x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.vendita_apri_chiudi x
SET anagrafica_vecchio_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_vecchio_id = m.loser_id;

UPDATE public.vendita_apri_chiudi x
SET anagrafica_nuovo_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_nuovo_id = m.loser_id;

UPDATE public.vendita_switch_sim x
SET anagrafica_attuale_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_attuale_id = m.loser_id;

UPDATE public.vendita_switch_sim x
SET anagrafica_rientro_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_rientro_id = m.loser_id;

-- FK Post-Vendita.
UPDATE public.post_vendita_controllo_fissi x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.post_vendita_controllo_lg x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.post_vendita_controllo_allarmi x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.post_vendita_controllo_assicurazioni x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.post_vendita_dispositivi_comodato x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

UPDATE public.post_vendita_gestione_rimborsi x
SET anagrafica_id = m.survivor_id
FROM mirox_anagrafica_merge_map m
WHERE x.anagrafica_id = m.loser_id;

-- Verifica dinamica: nessuna FK reale può ancora puntare ai loser.
DO $$
DECLARE
  r record;
  v_remaining bigint;
BEGIN
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_catalog = kcu.constraint_catalog
     AND tc.constraint_schema = kcu.constraint_schema
     AND tc.constraint_name = kcu.constraint_name
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_catalog = rc.constraint_catalog
     AND tc.constraint_schema = rc.constraint_schema
     AND tc.constraint_name = rc.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON rc.unique_constraint_catalog = ccu.constraint_catalog
     AND rc.unique_constraint_schema = ccu.constraint_schema
     AND rc.unique_constraint_name = ccu.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'anagrafica'
      AND ccu.column_name = 'id'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I.%I x JOIN mirox_anagrafica_merge_map m ON x.%I = m.loser_id',
      r.table_schema,
      r.table_name,
      r.column_name
    )
    INTO v_remaining;

    IF v_remaining <> 0 THEN
      RAISE EXCEPTION
        'Bonifica anagrafiche interrotta: %.%.% contiene ancora % riferimenti',
        r.table_schema,
        r.table_name,
        r.column_name,
        v_remaining;
    END IF;
  END LOOP;
END
$$;

DELETE FROM public.anagrafica loser
USING mirox_anagrafica_merge_map m
WHERE loser.id = m.loser_id;

DO $$
DECLARE
  v_remaining integer;
BEGIN
  SELECT count(*)
  INTO v_remaining
  FROM public.anagrafica a
  JOIN mirox_anagrafica_merge_map m ON a.id = m.loser_id;

  IF v_remaining <> 0 THEN
    RAISE EXCEPTION
      'Bonifica anagrafiche incompleta: % loser ancora presenti',
      v_remaining;
  END IF;
END
$$;

COMMIT;
