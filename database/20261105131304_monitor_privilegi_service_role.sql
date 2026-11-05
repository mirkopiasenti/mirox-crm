-- Supabase assegna ALL a service_role tramite default privileges.
-- Restringere esclusivamente i tre oggetti Monitor appena introdotti.
BEGIN;
REVOKE ALL ON public.mirox_monitor_dispositivi,public.mirox_monitor_audit,public.mirox_monitor_rate FROM service_role;
GRANT SELECT,INSERT,UPDATE ON public.mirox_monitor_dispositivi TO service_role;
GRANT SELECT,INSERT ON public.mirox_monitor_audit TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.mirox_monitor_rate TO service_role;
COMMIT;
