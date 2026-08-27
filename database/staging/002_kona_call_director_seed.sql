-- Seed staging per KONA Call Director.
-- Applicare DOPO la migration 072 sul progetto Mirox CRM - Staging
-- (project ref blwgxrszvsoqcmcmhhqr). NON applicare in produzione.
--
-- KONA nasce disattivato anche in staging: attivo_globale resta false.
-- Per testare con dati sintetici abilitare un operatore specifico, ad esempio:
--
--   INSERT INTO public.kona_call_director_profili (profilo_id, abilitato, in_osservazione)
--   SELECT id, true, true FROM public.profili WHERE username = '<operatore>'
--   ON CONFLICT (profilo_id) DO UPDATE SET abilitato = true;
--
-- Poi abilitare globalmente SOLO in staging:
--
--   UPDATE public.kona_call_director_config
--   SET attivo_globale = true, aggiornato_at = now()
--   WHERE id = 1;
--
-- Nessun dato sensibile di produzione e' presente in questo seed.

BEGIN;

INSERT INTO public.kona_call_director_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMIT;
