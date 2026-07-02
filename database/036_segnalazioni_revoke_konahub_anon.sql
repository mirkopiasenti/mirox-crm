-- 036 — Revoca policy anon konahub su segnalazioni (rollback della 032)
--
-- Contesto: la migration 032 aveva riaperto l'accesso `anon` a tabella
-- `segnalazioni` (SELECT/INSERT/UPDATE) e bucket `segnalazioni-files`
-- (SELECT/INSERT) per due motivi:
--   1. il konahub (CRM provvisorio, deploy separato) chiamava il modulo
--      segnalazioni senza auth
--   2. anche `moduli/segnalazioni.html` di Mirox faceva le sue chiamate
--      come role `anon` (client Supabase creato con anon key hardcoded)
--
-- Al 2026-07-02 entrambi i vincoli sono spariti:
--   1. il konahub e' stato dismesso
--   2. `moduli/segnalazioni.html` e' stata modernizzata nello stesso PR: ora
--      usa `js/config.js` (window.db con persistSession) + `Auth.richiediAuth`,
--      quindi tutte le chiamate viaggiano come role `authenticated` col JWT
--      dell'utente Mirox loggato — coperte dalle policy authenticated esistenti.
--
-- Effetto: revochiamo le 5 policy `anon` e torniamo allo stato hardened
-- post-029/030. Da adesso l'unico modo per leggere/scrivere segnalazioni
-- e' passare da Mirox loggato.
--
-- IMPATTO:
--   - Mirox loggato: NESSUN cambiamento funzionale (le policy authenticated
--     restano in piedi).
--   - Chiamate `anon` residue (se il konahub tornasse online, se qualcuno
--     colpisse le API dall'esterno): RLS violation. Voluto.
--
-- CHECK finale (post-apply):
--   SELECT policyname, roles::text FROM pg_policies
--   WHERE tablename='segnalazioni' OR (schemaname='storage' AND policyname ILIKE '%segnalazioni%')
--   ORDER BY policyname;
-- Devono restare SOLO le 4 policy authenticated:
--   segnalazioni_authenticated_all           {authenticated}
--   Read auth segnalazioni files             {authenticated}
--   Upload auth segnalazioni files           {authenticated}
--   Delete auth segnalazioni files           {authenticated}

BEGIN;

-- Tabella segnalazioni: revoca policy anon
DROP POLICY IF EXISTS "segnalazioni_anon_select" ON segnalazioni;
DROP POLICY IF EXISTS "segnalazioni_anon_insert" ON segnalazioni;
DROP POLICY IF EXISTS "segnalazioni_anon_update" ON segnalazioni;

-- Bucket segnalazioni-files: revoca policy anon
DROP POLICY IF EXISTS "Read anon segnalazioni files" ON storage.objects;
DROP POLICY IF EXISTS "Upload anon segnalazioni files" ON storage.objects;

COMMIT;
