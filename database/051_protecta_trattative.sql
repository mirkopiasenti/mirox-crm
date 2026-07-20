-- 051_protecta_trattative.sql
-- Introduce il concetto di "trattativa" nel simulatore Protecta.
--
-- Motivazione: piu' preventivi generati per lo stesso cliente (kit diversi,
-- scenari alternativi) sono tecnicamente la stessa trattativa commerciale.
-- Ad oggi ogni preventivo = una riga separata nella lista Trattative,
-- inquinando la vista con duplicati (es. 4 righe uguali per lo stesso cliente
-- in 10 minuti). Con trattativa_id il wizard puo' agganciare piu' preventivi
-- alla stessa trattativa e la UI li mostra raggruppati.
--
-- Retrocompatibilita': ogni record esistente diventa la propria trattativa
-- (uuid auto-generato in backfill). Nessuna aggregazione retroattiva dei
-- vecchi preventivi (troppo rischioso senza intervento operatore).
--
-- Default: gen_random_uuid() -> ogni INSERT senza trattativa_id esplicito
-- crea una trattativa nuova (comportamento identico al passato).

ALTER TABLE public.vendita_simulatore_protecta
  ADD COLUMN IF NOT EXISTS trattativa_id uuid;

UPDATE public.vendita_simulatore_protecta
   SET trattativa_id = gen_random_uuid()
 WHERE trattativa_id IS NULL;

ALTER TABLE public.vendita_simulatore_protecta
  ALTER COLUMN trattativa_id SET NOT NULL,
  ALTER COLUMN trattativa_id SET DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS idx_vsp_trattativa_id
  ON public.vendita_simulatore_protecta(trattativa_id);

COMMENT ON COLUMN public.vendita_simulatore_protecta.trattativa_id IS
  'Raggruppa piu'' preventivi generati per lo stesso cliente/trattativa. Default uuid nuovo (comportamento legacy = un preventivo per trattativa). La UI del wizard puo'' agganciare esplicitamente piu'' preventivi alla stessa trattativa.';
