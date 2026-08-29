-- Migration 075 — parita' delle rilavorazioni KONA con il Call Center manuale.
--
-- SOLO staging/test in questa fase. Non applicare a production senza una
-- conferma separata. Estende esclusivamente il dominio task server-only di
-- KONA per rappresentare gli appuntamenti non presentati.

BEGIN;

ALTER TABLE public.kona_call_director_task
  DROP CONSTRAINT IF EXISTS kona_call_director_task_tipo_check;

ALTER TABLE public.kona_call_director_task
  ADD CONSTRAINT kona_call_director_task_tipo_check CHECK (tipo IN (
    'conferma_appuntamento_business',
    'ricontatto_programmato',
    'auto_non_risposto',
    'non_presentato',
    'passa_a_cerea',
    'passa_in_negozio',
    'campagna_urgente',
    'sessione_business',
    'enrichment_review'
  ));

COMMENT ON COLUMN public.kona_call_director_task.tipo IS
  'Tipo di attivita KONA; non_presentato replica la coda appuntamenti del Call Center manuale.';

COMMIT;
