-- Migration 053
-- Hardening RPC, bonifica dati storici e RPC alias v2.
--
-- Operazioni:
--   1. chiude EXECUTE anon sulle RPC SECURITY DEFINER sensibili;
--   2. introduce applica_alias_backfill_v2 con controllo admin e search_path fisso;
--   3. completa operatore/uploaded_by storici, corregge il codice Cerea;
--   4. elimina i record vendita_documenti duplicati mantenendo un solo record
--      per oggetto Storage e impedisce nuove duplicazioni;
-- Le revoche RLS di scrittura browser sono separate nella migration 054:
-- devono essere applicate solo dopo il deploy delle nuove Netlify Functions.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Permessi RPC: nessuna modifica ai body delle funzioni condivise
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.ricerca_anagrafica(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ricerca_anagrafica(text)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cerca_o_crea_anagrafica(
  text, text, text, text, text, text, text, text, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cerca_o_crea_anagrafica(
  text, text, text, text, text, text, text, text, text, uuid, text
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.chiudi_appuntamenti_giornata()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chiudi_appuntamenti_giornata()
  TO service_role;

REVOKE ALL ON FUNCTION public.vendita_chiudi_eventi_cc_per_pratica(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vendita_chiudi_eventi_cc_per_pratica(uuid, uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.vendita_deriva_origine(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vendita_deriva_origine(uuid)
  TO authenticated, service_role;

-- get_slot_disponibili(date) resta volutamente eseguibile da anon per
-- public-prenota. Le altre RPC con auth.uid() interno non vengono cambiate.

-- ---------------------------------------------------------------------------
-- 2. Alias backfill v2: SECURITY DEFINER, solo admin autenticato
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.applica_alias_backfill_v2(p_alias_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_canonico uuid;
  v_result jsonb := '{}'::jsonb;
  v_count integer;
  v_table text;
  v_tables text[] := ARRAY[
    'vendita_contratti',
    'vendita_pratiche',
    'vendita_apri_chiudi',
    'vendita_switch_sim',
    'vendita_ordini_smartphone',
    'vendita_simulatore_protecta',
    'vendita_consensi_privacy',
    'post_vendita_gestione_rimborsi',
    'ticket'
  ];
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profili p
    WHERE p.id = auth.uid()
      AND p.ruolo = 'admin'
      AND COALESCE(p.attivo, true)
  ) THEN
    RAISE EXCEPTION 'Operazione riservata agli amministratori'
      USING ERRCODE = '42501';
  END IF;

  IF p_alias_id IS NULL THEN
    RAISE EXCEPTION 'p_alias_id obbligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_canonico := public.risolvi_operatore_canonico(p_alias_id);
  IF v_canonico IS NULL OR v_canonico = p_alias_id THEN
    RETURN jsonb_build_object(
      'error',
      'Il profilo non e'' un alias (alias_di NULL o coincidente)'
    );
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'UPDATE public.%I SET operatore_id = $1 WHERE operatore_id = $2',
      v_table
    ) USING v_canonico, p_alias_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object(v_table, v_count);
  END LOOP;

  IF to_regclass('public.vendita_consensi_privacy_v2') IS NOT NULL THEN
    EXECUTE
      'UPDATE public.vendita_consensi_privacy_v2
       SET operatore_id = $1
       WHERE operatore_id = $2'
      USING v_canonico, p_alias_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result
      || jsonb_build_object('vendita_consensi_privacy_v2', v_count);
  END IF;

  RETURN jsonb_build_object(
    'alias_id', p_alias_id,
    'canonico_id', v_canonico,
    'aggiornati', v_result
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.applica_alias_backfill_v2(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.applica_alias_backfill_v2(uuid)
  TO authenticated;

-- La v1 resta temporaneamente eseguibile fino al deploy dell'UI che usa la v2.
-- La revoca è nella migration 054 post-deploy.

-- ---------------------------------------------------------------------------
-- 3. Bonifica dati storici
-- ---------------------------------------------------------------------------

-- 32 pratiche importate non avevano operatore_id, ma tutti i relativi contratti
-- indicano in modo univoco lo stesso operatore.
WITH candidati AS (
  SELECT
    c.pratica_id,
    min(c.operatore_id::text)::uuid AS operatore_id
  FROM public.vendita_contratti c
  WHERE c.operatore_id IS NOT NULL
  GROUP BY c.pratica_id
  HAVING count(DISTINCT c.operatore_id) = 1
)
UPDATE public.vendita_pratiche p
SET operatore_id = candidati.operatore_id
FROM candidati
WHERE p.id = candidati.pratica_id
  AND p.operatore_id IS NULL;

-- uploaded_by è ricavabile dal contratto; per i documenti generali della
-- pratica usa l'operatore pratica appena completato.
WITH derivati AS (
  SELECT
    d.id,
    COALESCE(c.operatore_id, p.operatore_id) AS uploaded_by
  FROM public.vendita_documenti d
  JOIN public.vendita_pratiche p
    ON p.id = d.pratica_id
  LEFT JOIN public.vendita_contratti c
    ON c.id = d.contratto_id
  WHERE d.uploaded_by IS NULL
    AND COALESCE(c.operatore_id, p.operatore_id) IS NOT NULL
)
UPDATE public.vendita_documenti d
SET uploaded_by = derivati.uploaded_by
FROM derivati
WHERE d.id = derivati.id;

-- I contratti storici attribuiti al profilo Cerea erano stati importati con il
-- default Legnago. Il limite data circoscrive la correzione al pregresso.
DO $$
DECLARE
  v_cerea_id uuid;
  v_cerea_count integer;
BEGIN
  SELECT count(*)
    INTO v_cerea_count
  FROM public.profili
  WHERE lower(COALESCE(nome, '')) LIKE '%cerea%'
     OR lower(COALESCE(username, '')) LIKE '%cerea%';

  IF v_cerea_count <> 1 THEN
    RAISE EXCEPTION
      'Bonifica Cerea non applicabile: atteso 1 profilo, trovati %',
      v_cerea_count;
  END IF;

  SELECT id
    INTO v_cerea_id
  FROM public.profili
  WHERE lower(COALESCE(nome, '')) LIKE '%cerea%'
     OR lower(COALESCE(username, '')) LIKE '%cerea%'
  LIMIT 1;

  UPDATE public.vendita_contratti
  SET codice_rivenditore = '9000822241'
  WHERE operatore_id = v_cerea_id
    AND codice_rivenditore = '9001415852'
    AND data_contratto < timestamptz '2026-06-29 00:00:00+02';
END
$$;

-- Conserva il record più vecchio di ciascuna coppia bucket/path. I duplicati
-- puntano allo stesso PDF, quindi non va rimosso alcun oggetto Storage.
WITH duplicati AS (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY storage_bucket, storage_path
        ORDER BY uploaded_at ASC, id ASC
      ) AS posizione
    FROM public.vendita_documenti
  ) ordinati
  WHERE posizione > 1
)
DELETE FROM public.vendita_documenti d
USING duplicati
WHERE d.id = duplicati.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendita_documenti_bucket_path
  ON public.vendita_documenti(storage_bucket, storage_path);

COMMIT;
