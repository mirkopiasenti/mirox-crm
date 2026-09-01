-- =============================================================================
-- Migration 072: limita TELEFONI CB ai soli telefoni realmente inclusi
-- =============================================================================
-- Allinea le metriche della Dashboard Pezzi al KPI Customer Base Consumer.
-- Prima della correzione entrambe conteggiavano l'intera categoria Customer Base,
-- includendo anche Cambi Piano e Caring.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  metriche_attese integer;
BEGIN
  SELECT count(*)
    INTO metriche_attese
    FROM public.gara_metriche
   WHERE nome = 'TELEFONI CB'
     AND tabella IN ('gara_individuale', 'avanzamento_standard')
     AND attiva = true;

  IF metriche_attese <> 2 THEN
    RAISE EXCEPTION 'Attese 2 metriche TELEFONI CB attive, trovate %', metriche_attese;
  END IF;
END;
$$;

UPDATE public.gara_metriche
   SET regola = jsonb_build_object(
         'or', jsonb_build_array(
           jsonb_build_object(
             'categoria', 'Customer Base',
             'cluster', 'Consumer',
             'offerta_match', 'telefono incluso',
             'dispositivo_associato', true,
             'tipo_acquisto', 'VAR'
           ),
           jsonb_build_object(
             'categoria', 'Customer Base',
             'cluster', 'Consumer',
             'offerta_match', 'telefono incluso',
             'dispositivo_associato', true,
             'tipo_acquisto', 'Finanziamento'
           )
         )
       ),
       updated_at = now()
 WHERE nome = 'TELEFONI CB'
   AND tabella IN ('gara_individuale', 'avanzamento_standard')
   AND attiva = true;

DO $$
DECLARE
  metriche_corrette integer;
BEGIN
  SELECT count(*)
    INTO metriche_corrette
    FROM public.gara_metriche
   WHERE nome = 'TELEFONI CB'
     AND tabella IN ('gara_individuale', 'avanzamento_standard')
     AND attiva = true
     AND jsonb_array_length(regola->'or') = 2
     AND regola->'or' @> '[{"categoria":"Customer Base","cluster":"Consumer","offerta_match":"telefono incluso","dispositivo_associato":true,"tipo_acquisto":"VAR"}]'::jsonb
     AND regola->'or' @> '[{"categoria":"Customer Base","cluster":"Consumer","offerta_match":"telefono incluso","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}]'::jsonb;

  IF metriche_corrette <> 2 THEN
    RAISE EXCEPTION 'Verifica regole TELEFONI CB fallita: % metriche corrette', metriche_corrette;
  END IF;
END;
$$;

COMMIT;
