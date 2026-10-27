-- Permessi pagine Mirox. Applicare PRIMA del codice compatibile.
-- Solo aggiunte su tabelle vendita/Storage; profili e tabelle CC invariati.
-- Gli utenti esistenti mantengono gli accessi; i nuovi richiedono assegnazione.
BEGIN;
CREATE SCHEMA IF NOT EXISTS mirox_private;
REVOKE ALL ON SCHEMA mirox_private FROM PUBLIC;
GRANT USAGE ON SCHEMA mirox_private TO authenticated, service_role;

CREATE TABLE public.mirox_pagine (
 chiave text PRIMARY KEY,
 etichetta text NOT NULL,
 reparto text NOT NULL,
 percorso text NOT NULL UNIQUE
);
INSERT INTO public.mirox_pagine(chiave,etichetta,reparto,percorso) VALUES
 ('upload_contratti','Upload Contratti','Vendita','moduli/upload-contratti-vendita.html'),
 ('apri_chiudi','Apri / Chiudi','Vendita','moduli/apri_chiudi.html'),
 ('switch_sim','Switch SIM','Vendita','moduli/switch_sim.html'),
 ('ordini_smartphone','Ordini Smartphone','Vendita','moduli/ordini_smartphone.html'),
 ('simulatore_protecta','Simulatore Protecta','Vendita','moduli/simulatore_protecta.html'),
 ('dashboard_pezzi','Dashboard Pezzi','Vendita','moduli/dashboard_pezzi.html'),
 ('anagrafiche','Anagrafiche','Post-Vendita','moduli/anagrafiche.html'),
 ('storico_cliente','Storico Cliente','Post-Vendita','moduli/storico_cliente.html'),
 ('dispositivi_comodato','Dispositivi Comodato','Post-Vendita','moduli/dispositivi_comodato.html'),
 ('gestione_rimborsi','Gestione Rimborsi','Post-Vendita','moduli/gestione_rimborsi.html'),
 ('segnalazioni','Segnalazioni','Post-Vendita','moduli/segnalazioni.html'),
 ('verifica_contratti','Verifica Contratti','Post-Vendita','moduli/verifica_contratti.html'),
 ('controllo_fissi','Controllo Fissi','Post-Vendita','moduli/controllo_fissi.html'),
 ('controllo_lg','Controllo L&G','Post-Vendita','moduli/controllo_lg.html'),
 ('controllo_assicurazioni','Controllo Assicurazioni','Post-Vendita','moduli/controllo_assicurazioni.html'),
 ('controllo_allarmi','Controllo Allarmi','Post-Vendita','moduli/controllo_allarmi.html'),
 ('ticket','Ticket','Post-Vendita','moduli/ticket.html'),
 ('compilatore_disdette','Compilatore disdette','Applicazioni','moduli/compilatore_disdette.html'),
 ('compilatore_subentri','Compilatore Subentri','Applicazioni','moduli/compilatore_subentri.html');

CREATE TABLE public.mirox_permessi_utente (
 utente_id uuid PRIMARY KEY REFERENCES public.profili(id) ON DELETE CASCADE,
 pagine jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(pagine)='object'),
 versione bigint NOT NULL DEFAULT 0 CHECK (versione>=0),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.mirox_permessi_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 utente_id uuid NOT NULL,
 autore_id uuid NOT NULL,
 prima jsonb NOT NULL,
 dopo jsonb NOT NULL,
 versione bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mirox_permessi_audit_utente_data ON public.mirox_permessi_audit(utente_id,created_at DESC,id DESC);
ALTER TABLE public.mirox_pagine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirox_permessi_utente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mirox_permessi_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mirox_pagine,public.mirox_permessi_utente,public.mirox_permessi_audit FROM anon,authenticated,service_role;
GRANT SELECT ON public.mirox_pagine,public.mirox_permessi_utente TO authenticated;
GRANT ALL ON public.mirox_pagine,public.mirox_permessi_utente TO service_role;
GRANT SELECT,INSERT ON public.mirox_permessi_audit TO service_role;
REVOKE ALL ON SEQUENCE public.mirox_permessi_audit_id_seq FROM anon,authenticated,service_role;
GRANT USAGE,SELECT ON SEQUENCE public.mirox_permessi_audit_id_seq TO service_role;

-- Lookup interno a identita vincolata, non esposto come RPC pubblica.
CREATE FUNCTION mirox_private.can_pages(p_chiavi text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT COALESCE((SELECT auth.role())='service_role',false) OR EXISTS (
  SELECT 1 FROM public.profili p
  LEFT JOIN public.mirox_permessi_utente m ON m.utente_id=p.id
  WHERE p.id=(SELECT auth.uid()) AND p.attivo IS DISTINCT FROM false
   AND (p.ruolo='admin' OR EXISTS (
    SELECT 1 FROM unnest(p_chiavi) AS k(chiave)
    JOIN public.mirox_pagine c ON c.chiave=k.chiave
    WHERE m.pagine->k.chiave='true'::jsonb
   ))
 );
$$;
REVOKE ALL ON FUNCTION mirox_private.can_pages(text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION mirox_private.can_pages(text[]) TO authenticated,service_role;
CREATE POLICY mirox_pagine_read ON public.mirox_pagine FOR SELECT TO authenticated USING (true);
CREATE POLICY mirox_permessi_read ON public.mirox_permessi_utente FOR SELECT TO authenticated
 USING (utente_id=(SELECT auth.uid()) OR (SELECT mirox_private.can_pages('{}'::text[])));

-- Fotografia degli utenti presenti al momento dell'installazione, nessun default permissivo futuro.
INSERT INTO public.mirox_permessi_utente(utente_id,pagine,versione)
 SELECT p.id,(SELECT jsonb_object_agg(chiave,true) FROM public.mirox_pagine),1 FROM public.profili p;

-- Operazione atomica con controllo versione; invocabile soltanto dal backend service_role.
CREATE FUNCTION public.mirox_salva_permessi_pagine(p_admin_id uuid,p_utente_id uuid,p_pagine jsonb,p_versione bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_old public.mirox_permessi_utente; v_new public.mirox_permessi_utente;
BEGIN
 IF current_user <> 'service_role' OR NOT EXISTS (
   SELECT 1 FROM public.profili WHERE id=p_admin_id AND ruolo='admin' AND attivo IS DISTINCT FROM false
 ) THEN RAISE EXCEPTION 'Operazione riservata agli amministratori' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.profili WHERE id=p_utente_id AND ruolo <> 'admin') THEN
  RAISE EXCEPTION 'Utente non modificabile' USING ERRCODE='22023';
 END IF;
 IF p_pagine IS NULL OR jsonb_typeof(p_pagine)<>'object' OR p_versione IS NULL OR p_versione<0 THEN
  RAISE EXCEPTION 'Permessi non validi' USING ERRCODE='22023';
 END IF;
 IF EXISTS (SELECT 1 FROM jsonb_each(p_pagine) e LEFT JOIN public.mirox_pagine c ON c.chiave=e.key
            WHERE c.chiave IS NULL OR jsonb_typeof(e.value)<>'boolean')
    OR (SELECT count(*) FROM jsonb_object_keys(p_pagine))<>(SELECT count(*) FROM public.mirox_pagine) THEN
  RAISE EXCEPTION 'Specificare tutte e sole le pagine previste con valori booleani' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.mirox_permessi_utente(utente_id) VALUES(p_utente_id) ON CONFLICT DO NOTHING;
 SELECT * INTO v_old FROM public.mirox_permessi_utente WHERE utente_id=p_utente_id FOR UPDATE;
 IF v_old.versione<>p_versione THEN RAISE EXCEPTION 'Permessi modificati da un altro amministratore. Ricarica.' USING ERRCODE='40001'; END IF;
 IF v_old.pagine=p_pagine THEN RETURN to_jsonb(v_old); END IF;
 UPDATE public.mirox_permessi_utente SET pagine=p_pagine,versione=versione+1,updated_at=clock_timestamp()
 WHERE utente_id=p_utente_id RETURNING * INTO v_new;
 INSERT INTO public.mirox_permessi_audit(utente_id,autore_id,prima,dopo,versione)
 VALUES(p_utente_id,p_admin_id,v_old.pagine,v_new.pagine,v_new.versione);
 RETURN to_jsonb(v_new);
END;
$$;
REVOKE ALL ON FUNCTION public.mirox_salva_permessi_pagine(uuid,uuid,jsonb,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mirox_salva_permessi_pagine(uuid,uuid,jsonb,bigint) TO service_role;

-- Policy restrittive: si combinano in AND con le regole esistenti, senza ampliarle.

CREATE POLICY mirox_pages_read ON public.vendita_contratti AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['upload_contratti','verifica_contratti','storico_cliente','dashboard_pezzi','controllo_fissi','controllo_lg','controllo_allarmi','controllo_assicurazioni']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_contratti AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_contratti AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_contratti AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_documenti AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['verifica_contratti','storico_cliente','controllo_fissi']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_documenti AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_documenti AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_documenti AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_apri_chiudi AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['apri_chiudi','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_apri_chiudi AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_apri_chiudi AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_apri_chiudi AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_switch_sim AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['switch_sim','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_switch_sim AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_switch_sim AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_switch_sim AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_ordini_smartphone AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['ordini_smartphone','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_ordini_smartphone AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['ordini_smartphone']::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_ordini_smartphone AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['ordini_smartphone']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['ordini_smartphone']::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_ordini_smartphone AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['ordini_smartphone']::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_simulatore_protecta AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_simulatore_protecta AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_simulatore_protecta AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_simulatore_protecta AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[])));

CREATE POLICY mirox_pages_read ON public.post_vendita_dispositivi_comodato AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.post_vendita_dispositivi_comodato AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[])));
CREATE POLICY mirox_pages_update ON public.post_vendita_dispositivi_comodato AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[])));
CREATE POLICY mirox_pages_delete ON public.post_vendita_dispositivi_comodato AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[])));

CREATE POLICY mirox_pages_read ON public.post_vendita_gestione_rimborsi AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['gestione_rimborsi','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.post_vendita_gestione_rimborsi AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.post_vendita_gestione_rimborsi AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.post_vendita_gestione_rimborsi AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.segnalazioni AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[])));
CREATE POLICY mirox_pages_insert ON public.segnalazioni AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[])));
CREATE POLICY mirox_pages_update ON public.segnalazioni AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[])));
CREATE POLICY mirox_pages_delete ON public.segnalazioni AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[])));

CREATE POLICY mirox_pages_read ON public.ticket AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['ticket']::text[])));
CREATE POLICY mirox_pages_insert ON public.ticket AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['ticket']::text[])));
CREATE POLICY mirox_pages_update ON public.ticket AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['ticket']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['ticket']::text[])));
CREATE POLICY mirox_pages_delete ON public.ticket AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['ticket']::text[])));

CREATE POLICY mirox_pages_read ON public.dashboard_righe_giornaliera AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['dashboard_pezzi']::text[])));
CREATE POLICY mirox_pages_insert ON public.dashboard_righe_giornaliera AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.dashboard_righe_giornaliera AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.dashboard_righe_giornaliera AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.gara_metriche AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['dashboard_pezzi']::text[])));
CREATE POLICY mirox_pages_insert ON public.gara_metriche AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.gara_metriche AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.gara_metriche AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.gara_obiettivi_mensili AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['dashboard_pezzi']::text[])));
CREATE POLICY mirox_pages_insert ON public.gara_obiettivi_mensili AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.gara_obiettivi_mensili AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.gara_obiettivi_mensili AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_consensi_privacy AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['upload_contratti','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_consensi_privacy AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_consensi_privacy AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_consensi_privacy AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_consensi_privacy_v2 AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['upload_contratti','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_consensi_privacy_v2 AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_consensi_privacy_v2 AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_consensi_privacy_v2 AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.vendita_consensi_privacy_audit AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['upload_contratti','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.vendita_consensi_privacy_audit AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_update ON public.vendita_consensi_privacy_audit AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY[]::text[])));
CREATE POLICY mirox_pages_delete ON public.vendita_consensi_privacy_audit AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY[]::text[])));

CREATE POLICY mirox_pages_read ON public.post_vendita_controllo_fissi AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_fissi','dashboard_pezzi','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.post_vendita_controllo_fissi AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_fissi']::text[])));
CREATE POLICY mirox_pages_update ON public.post_vendita_controllo_fissi AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_fissi']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_fissi']::text[])));
CREATE POLICY mirox_pages_delete ON public.post_vendita_controllo_fissi AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_fissi']::text[])));

CREATE POLICY mirox_pages_read ON public.post_vendita_controllo_lg AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_lg','dashboard_pezzi','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.post_vendita_controllo_lg AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_lg']::text[])));
CREATE POLICY mirox_pages_update ON public.post_vendita_controllo_lg AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_lg']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_lg']::text[])));
CREATE POLICY mirox_pages_delete ON public.post_vendita_controllo_lg AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_lg']::text[])));

CREATE POLICY mirox_pages_read ON public.post_vendita_controllo_allarmi AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_allarmi','dashboard_pezzi','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.post_vendita_controllo_allarmi AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_allarmi']::text[])));
CREATE POLICY mirox_pages_update ON public.post_vendita_controllo_allarmi AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_allarmi']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_allarmi']::text[])));
CREATE POLICY mirox_pages_delete ON public.post_vendita_controllo_allarmi AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_allarmi']::text[])));

CREATE POLICY mirox_pages_read ON public.post_vendita_controllo_assicurazioni AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_assicurazioni','dashboard_pezzi','storico_cliente']::text[])));
CREATE POLICY mirox_pages_insert ON public.post_vendita_controllo_assicurazioni AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_assicurazioni']::text[])));
CREATE POLICY mirox_pages_update ON public.post_vendita_controllo_assicurazioni AS RESTRICTIVE FOR UPDATE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_assicurazioni']::text[])))
 WITH CHECK ((SELECT mirox_private.can_pages(ARRAY['controllo_assicurazioni']::text[])));
CREATE POLICY mirox_pages_delete ON public.post_vendita_controllo_assicurazioni AS RESTRICTIVE FOR DELETE TO authenticated
 USING ((SELECT mirox_private.can_pages(ARRAY['controllo_assicurazioni']::text[])));

DO $$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_viewdef('public.storico_cliente'::regclass,true) INTO v_definition;
 v_definition:=regexp_replace(v_definition,';\s*$','');
 -- Aggregazione storica autorizzata: conserva anche gli eventi CC senza
 -- modificare le loro RLS. La vista proprietaria e' privata e vincolata
 -- all'identita' corrente; la vista pubblica usa invece SECURITY INVOKER.
 EXECUTE 'CREATE VIEW mirox_private.storico_cliente_dati WITH (security_barrier=true) AS SELECT * FROM ('
 ||v_definition||') AS dati WHERE (SELECT mirox_private.can_pages(ARRAY[''storico_cliente'']::text[]))';
 REVOKE ALL ON mirox_private.storico_cliente_dati FROM PUBLIC,anon;
 GRANT SELECT ON mirox_private.storico_cliente_dati TO authenticated,service_role;
 CREATE OR REPLACE VIEW public.storico_cliente WITH (security_invoker=true,security_barrier=true)
 AS SELECT * FROM mirox_private.storico_cliente_dati;
END;
$$;

DO $$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_viewdef('public.view_vendita_dashboard_giornaliera'::regclass,true) INTO v_definition;
 v_definition:=regexp_replace(v_definition,';\s*$','');
 EXECUTE 'CREATE OR REPLACE VIEW public.view_vendita_dashboard_giornaliera WITH (security_invoker=true,security_barrier=true) AS SELECT * FROM ('
 ||v_definition||') AS dati WHERE (SELECT mirox_private.can_pages(ARRAY[''dashboard_pezzi'']::text[]))';
END;
$$;

DO $$
DECLARE v_definition text;
BEGIN
 SELECT pg_get_viewdef('public.view_vendita_dashboard_mensile'::regclass,true) INTO v_definition;
 v_definition:=regexp_replace(v_definition,';\s*$','');
 EXECUTE 'CREATE OR REPLACE VIEW public.view_vendita_dashboard_mensile WITH (security_invoker=true,security_barrier=true) AS SELECT * FROM ('
 ||v_definition||') AS dati WHERE (SELECT mirox_private.can_pages(ARRAY[''dashboard_pezzi'']::text[]))';
END;
$$;

CREATE POLICY mirox_pages_storage_select ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
 USING (CASE bucket_id
 WHEN 'contratti-vendita' THEN (SELECT mirox_private.can_pages(ARRAY['verifica_contratti','storico_cliente','controllo_fissi']::text[]))
 WHEN 'consensi-privacy' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti','storico_cliente']::text[]))
 WHEN 'apri-chiudi-files' THEN (SELECT mirox_private.can_pages(ARRAY['apri_chiudi','storico_cliente']::text[]))
 WHEN 'switch-sim-files' THEN (SELECT mirox_private.can_pages(ARRAY['switch_sim','storico_cliente']::text[]))
 WHEN 'protecta-files' THEN (SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[]))
 WHEN 'comodato-files' THEN (SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato','storico_cliente']::text[]))
 WHEN 'rimborsi-files' THEN (SELECT mirox_private.can_pages(ARRAY['gestione_rimborsi','storico_cliente']::text[]))
 WHEN 'segnalazioni-files' THEN (SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[]))
 ELSE true END);

CREATE POLICY mirox_pages_storage_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK (CASE bucket_id
 WHEN 'contratti-vendita' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'consensi-privacy' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'apri-chiudi-files' THEN (SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[]))
 WHEN 'switch-sim-files' THEN (SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[]))
 WHEN 'protecta-files' THEN (SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[]))
 WHEN 'comodato-files' THEN (SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[]))
 WHEN 'rimborsi-files' THEN (SELECT mirox_private.can_pages(ARRAY['gestione_rimborsi']::text[]))
 WHEN 'segnalazioni-files' THEN (SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[]))
 ELSE true END);

CREATE POLICY mirox_pages_storage_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
 USING (CASE bucket_id
 WHEN 'contratti-vendita' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'consensi-privacy' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'apri-chiudi-files' THEN (SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[]))
 WHEN 'switch-sim-files' THEN (SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[]))
 WHEN 'protecta-files' THEN (SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[]))
 WHEN 'comodato-files' THEN (SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[]))
 WHEN 'rimborsi-files' THEN (SELECT mirox_private.can_pages(ARRAY['gestione_rimborsi']::text[]))
 WHEN 'segnalazioni-files' THEN (SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[]))
 ELSE true END) WITH CHECK (CASE bucket_id
 WHEN 'contratti-vendita' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'consensi-privacy' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'apri-chiudi-files' THEN (SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[]))
 WHEN 'switch-sim-files' THEN (SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[]))
 WHEN 'protecta-files' THEN (SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[]))
 WHEN 'comodato-files' THEN (SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[]))
 WHEN 'rimborsi-files' THEN (SELECT mirox_private.can_pages(ARRAY['gestione_rimborsi']::text[]))
 WHEN 'segnalazioni-files' THEN (SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[]))
 ELSE true END);

CREATE POLICY mirox_pages_storage_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING (CASE bucket_id
 WHEN 'contratti-vendita' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'consensi-privacy' THEN (SELECT mirox_private.can_pages(ARRAY['upload_contratti']::text[]))
 WHEN 'apri-chiudi-files' THEN (SELECT mirox_private.can_pages(ARRAY['apri_chiudi']::text[]))
 WHEN 'switch-sim-files' THEN (SELECT mirox_private.can_pages(ARRAY['switch_sim']::text[]))
 WHEN 'protecta-files' THEN (SELECT mirox_private.can_pages(ARRAY['simulatore_protecta']::text[]))
 WHEN 'comodato-files' THEN (SELECT mirox_private.can_pages(ARRAY['dispositivi_comodato']::text[]))
 WHEN 'rimborsi-files' THEN (SELECT mirox_private.can_pages(ARRAY['gestione_rimborsi']::text[]))
 WHEN 'segnalazioni-files' THEN (SELECT mirox_private.can_pages(ARRAY['segnalazioni']::text[]))
 ELSE true END);

COMMIT;
