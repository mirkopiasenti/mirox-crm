-- Dati del Fisso persistiti sul contratto. Catalogo, snapshot economici e stati
-- storici conservati; nessun backfill implicito e nessuna modifica al CC.
ALTER TABLE public.vendita_contratti
 ADD COLUMN IF NOT EXISTS tecnologia_fisso text,
 ADD COLUMN IF NOT EXISTS professional_box boolean,
 ADD COLUMN IF NOT EXISTS codice_cliente_fisso text,
 ADD COLUMN IF NOT EXISTS codice_pos_fisso text;

ALTER TABLE public.vendita_contratti ADD CONSTRAINT vendita_fisso_dati_chk CHECK (
 (tecnologia_fisso IS NULL AND professional_box IS NULL AND codice_cliente_fisso IS NULL AND codice_pos_fisso IS NULL)
 OR (categoria_snapshot='Fisso'
 AND (codice_pos_fisso IS NULL OR codice_pos_fisso='9001415852')
 AND (codice_cliente_fisso IS NULL OR (codice_cliente_fisso ~ '^[A-Z0-9.][A-Z0-9./-]{0,79}$' AND codice_cliente_fisso ~ '[0-9]'))
 AND (tecnologia_fisso IS NULL OR tecnologia_fisso IN (
 'FTTC 100','FTTC 200','FWA Outdoor','FWA Indoor','FWA Voce','FTTH Aree Bianche','FTTH OF-FWCOP',
 'FTTC 100 - Professional Box','FTTC 200 - Professional Box','FWA Outdoor - Professional Box',
 'FWA Indoor - Professional Box','FTTH Aree Bianche - Professional Box','FTTH OF-FWCOP - Professional Box'))
 AND (professional_box IS DISTINCT FROM true OR cluster_cliente='Business')
 AND (tecnologia_fisso IS NULL OR (tecnologia_fisso LIKE '% - Professional Box') = COALESCE(professional_box,false)))
);

-- La famiglia legacy postvendita resta compatibile con report/CSV/client vecchi.
-- La tecnologia completa e la risposta Professional Box vivono sul contratto
-- e sono lette dal join del riepilogo, senza cambiare punti o stati esistenti.
CREATE OR REPLACE FUNCTION public.vendita_fisso_famiglia(p_tecnologia text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT CASE WHEN p_tecnologia LIKE 'FTTC %' THEN 'FTTC'
 WHEN p_tecnologia LIKE 'FWA Indoor%' THEN 'FWA IN'
 WHEN p_tecnologia LIKE 'FWA Outdoor%' THEN 'FWA OUT'
 WHEN p_tecnologia='FWA Voce' THEN 'FWA VOCE'
 WHEN p_tecnologia LIKE 'FTTH %' THEN 'FTTH_OF' END;
$$;
REVOKE ALL ON FUNCTION public.vendita_fisso_famiglia(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vendita_fisso_famiglia(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_vendita_contratti_to_controllo_fissi()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.categoria_snapshot='Fisso' AND NEW.stato_controllo='controllato'
 AND COALESCE(OLD.stato_controllo,'')<>'controllato' THEN
   -- Il ramo legacy permette il rilascio additivo prima del nuovo frontend.
   INSERT INTO public.post_vendita_controllo_fissi
    (contratto_id,pratica_id,anagrafica_id,stato,codice_cliente,tecnologia,cod_contratto,cod_pos,
     compilazione_completata_at,compilazione_completata_da)
   VALUES (NEW.id,NEW.pratica_id,NEW.anagrafica_id,
    CASE WHEN NEW.tecnologia_fisso IS NOT NULL AND NEW.codice_cliente_fisso IS NOT NULL
         AND NEW.codice_contratto IS NOT NULL AND NEW.codice_pos_fisso='9001415852'
      THEN 'In Attivazione' ELSE 'Da completare' END,
    NEW.codice_cliente_fisso,public.vendita_fisso_famiglia(NEW.tecnologia_fisso),NEW.codice_contratto,
    '9001415852',CASE WHEN NEW.tecnologia_fisso IS NOT NULL THEN now() END,NEW.controllato_da)
   ON CONFLICT (contratto_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.vendita_fisso_sync_dati()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF NEW.categoria_snapshot='Fisso' THEN
  UPDATE public.post_vendita_controllo_fissi SET
   codice_cliente=COALESCE(NEW.codice_cliente_fisso,codice_cliente),
   cod_contratto=COALESCE(NEW.codice_contratto,cod_contratto),
   cod_pos=COALESCE(NEW.codice_pos_fisso,cod_pos),
   tecnologia=COALESCE(public.vendita_fisso_famiglia(NEW.tecnologia_fisso),tecnologia)
  WHERE contratto_id=NEW.id AND (codice_cliente IS DISTINCT FROM COALESCE(NEW.codice_cliente_fisso,codice_cliente)
   OR cod_contratto IS DISTINCT FROM COALESCE(NEW.codice_contratto,cod_contratto)
   OR cod_pos IS DISTINCT FROM COALESCE(NEW.codice_pos_fisso,cod_pos)
   OR tecnologia IS DISTINCT FROM COALESCE(public.vendita_fisso_famiglia(NEW.tecnologia_fisso),tecnologia));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.vendita_fisso_sync_dati() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_fisso_sync_dati() TO service_role;
CREATE TRIGGER trg_vendita_fisso_sync_dati
 AFTER UPDATE OF tecnologia_fisso,professional_box,codice_cliente_fisso,codice_pos_fisso
 ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.vendita_fisso_sync_dati();
