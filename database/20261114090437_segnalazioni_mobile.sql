-- Registro privato per copia completa degli allegati e creazione idempotente.
-- Nessuna modifica a colonne, policy o trigger di vendita/Segnalazioni/CC.
BEGIN;
CREATE TABLE public.segnalazioni_mobile_richieste (
 id uuid PRIMARY KEY,
 created_by uuid NOT NULL,
 contratto_id uuid NOT NULL,
 richiesta_sha256 text NOT NULL CHECK (richiesta_sha256 ~ '^[0-9a-f]{64}$'),
 sorgente_sha256 text NOT NULL CHECK (sorgente_sha256 ~ '^[0-9a-f]{64}$'),
 segnalazione_id integer NOT NULL UNIQUE DEFAULT nextval('public.segnalazioni_id_seq'::regclass),
 dati jsonb NOT NULL CHECK (jsonb_typeof(dati) = 'object'),
 allegati jsonb NOT NULL CHECK (jsonb_typeof(allegati) = 'array' AND jsonb_array_length(allegati) > 0),
 lease_id uuid,
 lease_fino timestamptz,
 completata boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 completata_at timestamptz,
 CHECK ((lease_id IS NULL) = (lease_fino IS NULL)),
 CHECK (completata = (completata_at IS NOT NULL))
);
ALTER TABLE public.segnalazioni_mobile_richieste ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.segnalazioni_mobile_richieste FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.segnalazioni_mobile_richieste TO service_role;
COMMENT ON TABLE public.segnalazioni_mobile_richieste IS 'Server-only: prenotazione ID, snapshot, lease e retry delle segnalazioni aperte da Mobile. Copie incomplete non sono segnalazioni visibili.';

CREATE FUNCTION public.prepara_segnalazione_mobile(
 p_id uuid, p_autore uuid, p_contratto uuid, p_richiesta text, p_sorgente text,
 p_dati jsonb, p_allegati jsonb, p_lease uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.segnalazioni_mobile_richieste%ROWTYPE;
BEGIN
 IF p_lease IS NULL THEN RAISE EXCEPTION 'MOBILE_CONFLICT'; END IF;
 INSERT INTO public.segnalazioni_mobile_richieste(id,created_by,contratto_id,richiesta_sha256,sorgente_sha256,dati,allegati)
 VALUES(p_id,p_autore,p_contratto,p_richiesta,p_sorgente,p_dati,p_allegati)
 ON CONFLICT(id) DO NOTHING;
 SELECT * INTO STRICT r FROM public.segnalazioni_mobile_richieste WHERE id=p_id FOR UPDATE;
 IF r.created_by<>p_autore OR r.contratto_id<>p_contratto OR r.richiesta_sha256<>p_richiesta THEN RAISE EXCEPTION 'MOBILE_CONFLICT'; END IF;
 IF r.completata THEN RETURN to_jsonb(r); END IF;
 IF r.lease_fino>clock_timestamp() THEN RAISE EXCEPTION 'MOBILE_BUSY'; END IF;
 IF r.sorgente_sha256<>p_sorgente THEN RAISE EXCEPTION 'MOBILE_SOURCE_CHANGED'; END IF;
 UPDATE public.segnalazioni_mobile_richieste SET lease_id=p_lease,lease_fino=clock_timestamp()+interval '2 minutes'
 WHERE id=p_id RETURNING * INTO r;
 RETURN to_jsonb(r);
END;
$$;

CREATE FUNCTION public.completa_segnalazione_mobile(p_id uuid,p_lease uuid)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE r public.segnalazioni_mobile_richieste%ROWTYPE;
BEGIN
 SELECT * INTO STRICT r FROM public.segnalazioni_mobile_richieste WHERE id=p_id FOR UPDATE;
 IF r.lease_id IS DISTINCT FROM p_lease OR p_lease IS NULL THEN RAISE EXCEPTION 'MOBILE_CONFLICT'; END IF;
 IF r.completata THEN RETURN r.segnalazione_id; END IF;
 IF r.lease_fino<=clock_timestamp() THEN RAISE EXCEPTION 'MOBILE_BUSY'; END IF;
 -- La presenza di tutte le copie e' ricontrollata nella stessa transazione dell'INSERT.
 IF EXISTS (SELECT 1 FROM jsonb_array_elements(r.allegati) d WHERE NOT EXISTS (
   SELECT 1 FROM storage.objects o WHERE o.bucket_id='segnalazioni-files'
   AND o.name='segnalazione_'||r.segnalazione_id||'/'||(d->>'nome_destinazione')
 )) THEN RAISE EXCEPTION 'MOBILE_FILES_MISSING'; END IF;
 INSERT INTO public.segnalazioni(id,stato,operatore,ragione_sociale,codice_fiscale_piva,numero_contatto,gestione_pratica,tipo_ask,dettagli_segnalazione)
 VALUES(r.segnalazione_id,'Da gestire',r.dati->>'operatore',r.dati->>'ragione_sociale',r.dati->>'codice_fiscale_piva',
   r.dati->>'numero_contatto',r.dati->>'gestione_pratica',r.dati->>'tipo_ask',r.dati->>'dettagli_segnalazione');
 UPDATE public.segnalazioni_mobile_richieste SET completata=true,completata_at=clock_timestamp() WHERE id=p_id;
 RETURN r.segnalazione_id;
END;
$$;
REVOKE ALL ON FUNCTION public.prepara_segnalazione_mobile(uuid,uuid,uuid,text,text,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.completa_segnalazione_mobile(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepara_segnalazione_mobile(uuid,uuid,uuid,text,text,jsonb,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.completa_segnalazione_mobile(uuid,uuid) TO service_role;
COMMIT;
