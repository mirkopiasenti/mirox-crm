BEGIN;

CREATE TABLE public.vendita_energia_csv (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  caricato_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  caricato_da uuid NOT NULL
);

CREATE TABLE public.vendita_energia_csv_righe (
  numero text NOT NULL,
  punto text NOT NULL,
  cf text NOT NULL,
  piva text NOT NULL,
  stato text,
  causale text,
  messaggio text,
  annullamento text,
  PRIMARY KEY (numero, punto, cf, piva)
);
CREATE INDEX vendita_energia_csv_righe_per_fornitura ON public.vendita_energia_csv_righe (punto, cf, piva, numero);

CREATE TABLE public.vendita_energia_verifiche (
  contratto_id uuid PRIMARY KEY REFERENCES public.vendita_contratti(id) ON DELETE CASCADE,
  stato text NOT NULL DEFAULT 'in_attesa_csv' CHECK (stato IN ('in_attesa_csv', 'in_attesa_verifica')),
  motivo text CHECK (motivo IN ('bolletta_assente', 'bolletta_illeggibile', 'bolletta_ambigua', 'intestatario_diverso',
    'fornitore_incerto', 'punto_incerto', 'cliente_incompleto', 'csv_assente', 'csv_non_trovato', 'csv_fiscale_diverso', 'csv_ambiguo', 'errore_lettura')),
  csv_id uuid,
  csv_at timestamptz,
  punto_originale text,
  contesto jsonb,
  riscontro jsonb,
  esito_csv jsonb,
  lettura_da uuid,
  lease uuid,
  lease_until timestamptz,
  riprova_at timestamptz
);

ALTER TABLE public.vendita_energia_csv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_energia_csv_righe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendita_energia_verifiche ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendita_energia_csv, public.vendita_energia_csv_righe, public.vendita_energia_verifiche FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendita_energia_csv, public.vendita_energia_csv_righe, public.vendita_energia_verifiche TO service_role;
GRANT SELECT (contratto_id, stato, motivo, punto_originale, csv_at) ON public.vendita_energia_verifiche TO authenticated;
CREATE POLICY vendita_energia_verifiche_lettura ON public.vendita_energia_verifiche FOR SELECT TO authenticated
  USING ((SELECT mirox_private.can_pages(ARRAY['verifica_contratti']::text[]))
    AND EXISTS (SELECT 1 FROM public.vendita_contratti c WHERE c.id = contratto_id
      AND coalesce(nullif(trim(c.categoria_snapshot), ''), (SELECT nome FROM public.vendita_categorie WHERE id = c.categoria_id)) = 'Energia'));

CREATE FUNCTION mirox_private.energia_categoria(p_id uuid, p_snapshot text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT coalesce(nullif(trim(p_snapshot), ''), (SELECT nome FROM public.vendita_categorie WHERE id = p_id), '') = 'Energia';
$$;

INSERT INTO public.vendita_energia_verifiche (contratto_id)
SELECT c.id FROM public.vendita_contratti c
JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
WHERE mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot) AND c.stato_controllo = 'da_controllare';

CREATE FUNCTION mirox_private.energia_codice(p_valore text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT upper(regexp_replace(coalesce(p_valore, ''), '[[:space:]]+', '', 'g'));
$$;

CREATE FUNCTION mirox_private.energia_fiscale(p_fiscale text, p_cluster text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN lower(trim(p_cluster)) = 'business' THEN
    CASE WHEN mirox_private.energia_codice(p_fiscale) ~ '^[0-9]{1,11}$' THEN lpad(mirox_private.energia_codice(p_fiscale), 11, '0') ELSE '' END
    WHEN mirox_private.energia_codice(p_fiscale) ~ '^[A-Z0-9]{16}$' THEN mirox_private.energia_codice(p_fiscale)
    ELSE '' END;
$$;

CREATE FUNCTION mirox_private.energia_contesto(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'fiscale', mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster)),
    'business', coalesce(lower(trim(coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster))) = 'business', false),
    'documenti', coalesce(d.documenti, '[]'::jsonb)
  )
  FROM public.vendita_contratti c
  JOIN public.anagrafica a ON a.id = c.anagrafica_id
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object('id', id, 'bucket', storage_bucket, 'path', storage_path,
      'uploaded_at', uploaded_at, 'sha256', sha256, 'size', file_size) ORDER BY id) AS documenti
    FROM public.vendita_documenti WHERE contratto_id = c.id AND tipo_documento = 'copia_bolletta'
  ) d ON true
  WHERE c.id = p_id AND mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot);
$$;

CREATE FUNCTION mirox_private.energia_esito_lg(p_numero text, p_punto text, p_fiscale text, p_business boolean, p_solo_numero boolean)
RETURNS SETOF public.vendita_energia_csv_righe
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH fonte AS MATERIALIZED (
    SELECT r.*, CASE WHEN p_business THEN r.piva ELSE r.cf END AS fiscale
    FROM public.vendita_energia_csv_righe r
    WHERE r.numero = p_numero AND (
      (r.punto <> '' AND r.punto = p_punto)
      OR (r.punto = '' AND p_solo_numero AND NOT EXISTS (
        SELECT 1 FROM public.vendita_energia_csv_righe x WHERE x.numero = p_numero AND x.punto <> ''))
    )
  )
  SELECT numero, punto, cf, piva, stato, causale, messaggio, annullamento
  FROM fonte WHERE fiscale = p_fiscale AND p_fiscale <> '' AND stato IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM fonte WHERE fiscale <> '' AND fiscale <> p_fiscale)
  ORDER BY array_position(ARRAY['Rifiutato','Annullato','In lavorazione','In attivazione','Nuovo','Attivato'], stato) NULLS LAST,
    stato, cf, piva LIMIT 1;
$$;

CREATE FUNCTION public.vendita_energia_importa_csv(p_hash text, p_autore uuid, p_righe jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  fonte public.vendita_energia_csv%ROWTYPE;
  totale integer;
  aggiornati integer;
  protetti integer;
BEGIN
  IF p_autore IS NULL OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_righe) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CSV non valido' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_righe) NOT BETWEEN 1 AND 60000 THEN
    RAISE EXCEPTION 'Numero righe CSV non valido' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(761258, 1);
  SELECT * INTO fonte FROM public.vendita_energia_csv WHERE singleton;
  IF fonte.sha256 = p_hash THEN
    RETURN jsonb_build_object('duplicato', true, 'aggiornati', 0, 'protetti', 0);
  END IF;

  DELETE FROM public.vendita_energia_csv_righe;
  INSERT INTO public.vendita_energia_csv_righe (numero, punto, cf, piva, stato, causale, messaggio, annullamento)
  SELECT x.numero, x.punto, x.cf, x.piva, x.stato, x.causale, x.messaggio, x.annullamento
  FROM jsonb_to_recordset(p_righe) AS x(numero text, punto text, cf text, piva text, stato text,
    causale text, messaggio text, annullamento text);
  IF NOT EXISTS (SELECT 1 FROM public.vendita_energia_csv_righe WHERE punto <> '') THEN
    RAISE EXCEPTION 'Il CSV non contiene punti di fornitura utilizzabili' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.vendita_energia_csv AS f (sha256, caricato_da) VALUES (p_hash, p_autore)
  ON CONFLICT (singleton) DO UPDATE SET id = excluded.id, sha256 = excluded.sha256,
    caricato_at = excluded.caricato_at, caricato_da = excluded.caricato_da
  RETURNING * INTO fonte;

  -- Il conteggio precede il filtro fiscale: lo stesso numero/punto presente in
  -- più righe Mirox è ambiguo anche se una sola anagrafica combacia.
  WITH controlli AS MATERIALIZED (
    SELECT l.id, l.esito_manuale_bloccato AS bloccato, k.numero, k.punto,
      mirox_private.energia_fiscale(a.cf_piva, coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster)) AS fiscale,
      lower(trim(coalesce(nullif(trim(c.cluster_cliente), ''), a.cluster))) = 'business' AS business,
      count(*) OVER (PARTITION BY k.numero, k.punto) AS copie_punto,
      count(*) OVER (PARTITION BY k.numero) AS copie_numero
    FROM public.post_vendita_controllo_lg l
    JOIN public.vendita_contratti c ON c.id = l.contratto_id
    JOIN public.anagrafica a ON a.id = c.anagrafica_id
    CROSS JOIN LATERAL (SELECT mirox_private.energia_codice(c.numero_contratto_energia) AS numero,
      mirox_private.energia_codice(c.pod_pdr) AS punto) k
    WHERE k.numero <> ''
  ), esiti AS MATERIALIZED (
    SELECT c.id, c.bloccato, r.stato, r.causale, r.messaggio, r.annullamento
    FROM controlli c
    CROSS JOIN LATERAL mirox_private.energia_esito_lg(c.numero, c.punto, c.fiscale, c.business, c.copie_numero = 1) r
    WHERE c.copie_punto = 1
  ), scritti AS (
    UPDATE public.post_vendita_controllo_lg l SET stato = e.stato, stato_origine = 'csv',
      causale_stato_pratica = e.causale, messaggio_esito_sap = e.messaggio, causa_annullamento = e.annullamento,
      ultimo_csv_upload_at = fonte.caricato_at, ultimo_csv_upload_da = fonte.caricato_da
    FROM esiti e WHERE l.id = e.id AND NOT l.esito_manuale_bloccato
    RETURNING l.id
  )
  SELECT (SELECT count(*) FROM esiti), (SELECT count(*) FROM scritti),
    (SELECT count(*) FROM esiti WHERE bloccato) INTO totale, aggiornati, protetti;
  RETURN jsonb_build_object('duplicato', false, 'aggiornati', aggiornati, 'protetti', protetti,
    'corrispondenze', totale, 'caricato_at', fonte.caricato_at);
END;
$$;

CREATE FUNCTION public.vendita_energia_prossimo(p_prendi boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  versione uuid;
  candidato record;
  token uuid;
BEGIN
  IF p_prendi THEN
    PERFORM pg_advisory_xact_lock(761258, 2);
    IF (SELECT count(*) FROM public.vendita_energia_verifiche WHERE lease_until > now()) >= 1 THEN RETURN NULL; END IF;
  END IF;
  SELECT id INTO versione FROM public.vendita_energia_csv WHERE singleton;
  IF versione IS NULL THEN RETURN NULL; END IF;
  SELECT c.id, c.updated_at, x.contesto INTO candidato
  FROM public.vendita_contratti c
  JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
  LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id = c.id
  CROSS JOIN LATERAL (SELECT mirox_private.energia_contesto(c.id) AS contesto) x
  WHERE mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot) AND c.stato_controllo = 'da_controllare'
    AND (v.lease_until IS NULL OR v.lease_until <= now())
    AND (v.contesto IS DISTINCT FROM x.contesto
      OR (v.stato = 'in_attesa_verifica' AND v.riscontro IS DISTINCT FROM jsonb_build_array(c.pod_pdr, c.numero_contratto_energia, c.ex_fornitore))
      OR (v.stato = 'in_attesa_csv' AND (v.csv_id IS DISTINCT FROM versione OR v.riprova_at <= now())))
  ORDER BY c.created_at, c.id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT p_prendi THEN RETURN jsonb_build_object('contratto_id', candidato.id); END IF;
  token := gen_random_uuid();
  INSERT INTO public.vendita_energia_verifiche (contratto_id, lease, lease_until)
  VALUES (candidato.id, token, now() + interval '3 minutes')
  ON CONFLICT (contratto_id) DO UPDATE SET lease = excluded.lease, lease_until = excluded.lease_until;
  RETURN jsonb_build_object('contratto_id', candidato.id, 'updated_at', candidato.updated_at,
    'contesto', candidato.contesto, 'lease', token, 'csv_id', versione);
END;
$$;

CREATE FUNCTION public.vendita_energia_contesto_manuale(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT mirox_private.energia_contesto(c.id)
  FROM public.vendita_contratti c
  JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
  WHERE c.id = p_id AND c.stato_controllo = 'da_controllare';
$$;

CREATE FUNCTION public.vendita_energia_riscontra(
  p_id uuid, p_updated timestamptz, p_contesto jsonb, p_lease uuid, p_csv_id uuid, p_punto text,
  p_gestore text, p_motivo text, p_autore uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.vendita_contratti%ROWTYPE;
  v public.vendita_energia_verifiche%ROWTYPE;
  fonte public.vendita_energia_csv%ROWTYPE;
  riga public.vendita_energia_csv_righe%ROWTYPE;
  expected_count integer;
  punto_precedente text;
  setting_precedente text;
  motivo text := p_motivo;
  fase text := 'in_attesa_csv';
BEGIN
  SELECT * INTO c FROM public.vendita_contratti WHERE id = p_id FOR NO KEY UPDATE;
  SELECT * INTO v FROM public.vendita_energia_verifiche WHERE contratto_id = p_id FOR UPDATE;
  IF p_lease IS NOT NULL AND v.lease IS DISTINCT FROM p_lease THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock_shared(761258, 1);
  SELECT * INTO fonte FROM public.vendita_energia_csv WHERE singleton;
  IF c.id IS NULL OR NOT mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot) OR c.stato_controllo <> 'da_controllare'
    OR c.updated_at IS DISTINCT FROM p_updated OR p_contesto IS NULL
    OR p_contesto IS DISTINCT FROM public.vendita_energia_contesto_manuale(p_id)
    OR (p_lease IS NOT NULL AND fonte.id IS DISTINCT FROM p_csv_id) THEN
    UPDATE public.vendita_energia_verifiche SET lease = NULL, lease_until = NULL
      WHERE contratto_id = p_id AND lease = p_lease;
    RETURN NULL;
  END IF;
  IF p_lease IS NULL AND v.stato = 'in_attesa_verifica' AND v.contesto = p_contesto
    AND v.riscontro = jsonb_build_array(c.pod_pdr, c.numero_contratto_energia, c.ex_fornitore) THEN RETURN NULL; END IF;

  IF motivo IS NULL THEN
    IF fonte.id IS NULL THEN
      motivo := 'csv_assente';
    ELSIF jsonb_array_length(p_contesto->'documenti') = 0 THEN
      motivo := 'bolletta_assente';
    ELSIF coalesce(p_punto, '') !~ '^(IT[0-9]{3}E[A-Z0-9]{8,10}|[0-9]{14})$' THEN
      motivo := 'punto_incerto';
    ELSIF char_length(trim(coalesce(p_gestore, ''))) NOT BETWEEN 2 AND 160 THEN
      motivo := 'fornitore_incerto';
    ELSIF coalesce(p_contesto->>'fiscale', '') = '' THEN
      motivo := 'cliente_incompleto';
    ELSE
      SELECT count(DISTINCT r.numero) INTO expected_count
      FROM public.vendita_energia_csv_righe r WHERE r.punto = p_punto
        AND (p_contesto->>'fiscale') = CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END;
      IF expected_count = 1 THEN
        SELECT r.* INTO riga
        FROM public.vendita_energia_csv_righe r WHERE r.punto = p_punto
          AND (p_contesto->>'fiscale') = CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END
        ORDER BY array_position(ARRAY['Rifiutato','Annullato','In lavorazione','In attivazione','Nuovo','Attivato'], r.stato) NULLS LAST,
          r.stato NULLS LAST, r.cf, r.piva LIMIT 1;
        IF EXISTS (SELECT 1 FROM public.vendita_energia_csv_righe r WHERE r.punto = p_punto AND r.numero = riga.numero
          AND (p_contesto->>'fiscale') IS DISTINCT FROM CASE WHEN (p_contesto->>'business')::boolean THEN nullif(r.piva, '') ELSE nullif(r.cf, '') END
          AND CASE WHEN (p_contesto->>'business')::boolean THEN r.piva <> '' ELSE r.cf <> '' END) THEN
          motivo := 'csv_fiscale_diverso';
        END IF;
      ELSIF expected_count > 1 THEN
        motivo := 'csv_ambiguo';
      ELSIF EXISTS (SELECT 1 FROM public.vendita_energia_csv_righe WHERE punto = p_punto) THEN
        motivo := 'csv_fiscale_diverso';
      ELSE
        motivo := 'csv_non_trovato';
      END IF;
    END IF;
  END IF;

  IF motivo IS NULL THEN
    -- Due pratiche Mirox non possono appropriarsi della stessa proposta per
    -- la stessa fornitura. Due punti distinti della stessa proposta sì.
    PERFORM pg_advisory_xact_lock(hashtextextended('mirox-energia/' || p_punto || '/' || riga.numero, 0));
    IF EXISTS (
      SELECT 1 FROM public.vendita_contratti other
      LEFT JOIN public.vendita_energia_verifiche proof ON proof.contratto_id = other.id
      WHERE other.id <> p_id AND mirox_private.energia_categoria(other.categoria_id, other.categoria_snapshot)
        AND mirox_private.energia_codice(other.pod_pdr) = p_punto
        AND mirox_private.energia_codice(other.numero_contratto_energia) = riga.numero
        AND (other.stato_controllo = 'controllato' OR proof.stato = 'in_attesa_verifica')
    ) THEN
      motivo := 'csv_ambiguo';
    END IF;
  END IF;
  IF motivo IS NULL THEN
    fase := 'in_attesa_verifica';
    punto_precedente := CASE WHEN mirox_private.energia_codice(c.pod_pdr) <> p_punto THEN nullif(c.pod_pdr, '') ELSE v.punto_originale END;
    setting_precedente := coalesce(current_setting('mirox.verifica_commit', true), '');
    PERFORM set_config('mirox.verifica_commit', 'yes', true);
    UPDATE public.vendita_contratti SET pod_pdr = p_punto, numero_contratto_energia = riga.numero, ex_fornitore = trim(p_gestore)
      WHERE id = p_id AND ROW(pod_pdr, numero_contratto_energia, ex_fornitore)
        IS DISTINCT FROM ROW(p_punto, riga.numero, trim(p_gestore));
    PERFORM set_config('mirox.verifica_commit', setting_precedente, true);
  END IF;

  INSERT INTO public.vendita_energia_verifiche AS q (contratto_id, stato, motivo, csv_id, csv_at, punto_originale,
    contesto, riscontro, esito_csv, lettura_da, riprova_at)
  VALUES (p_id, fase, motivo, fonte.id, fonte.caricato_at, punto_precedente, p_contesto,
    CASE WHEN fase = 'in_attesa_verifica' THEN jsonb_build_array(p_punto, riga.numero, trim(p_gestore)) END,
    CASE WHEN fase = 'in_attesa_verifica' THEN to_jsonb(riga) || jsonb_build_object('csv_at', fonte.caricato_at, 'csv_da', fonte.caricato_da) END, p_autore,
    CASE WHEN motivo = 'errore_lettura' AND (v.riprova_at IS NULL OR v.csv_id IS DISTINCT FROM fonte.id OR v.contesto IS DISTINCT FROM p_contesto)
      THEN now() + interval '5 minutes' END)
  ON CONFLICT (contratto_id) DO UPDATE SET stato = excluded.stato, motivo = excluded.motivo, csv_id = excluded.csv_id,
    csv_at = excluded.csv_at, punto_originale = excluded.punto_originale, contesto = excluded.contesto, riscontro = excluded.riscontro,
    esito_csv = excluded.esito_csv, lettura_da = excluded.lettura_da, lease = NULL, lease_until = NULL, riprova_at = excluded.riprova_at;
  RETURN jsonb_build_object('stato', fase, 'motivo', motivo);
END;
$$;

-- I due stati rappresentano un passaggio operativo Energia. Il valore tecnico
-- da_controllare resta quello consultato da report, permessi e trigger legacy.
CREATE FUNCTION public.vendita_energia_pronta(p_id uuid, p_punto text, p_numero text, p_gestore text) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vendita_energia_verifiche v
    WHERE v.contratto_id = p_id AND v.stato = 'in_attesa_verifica'
      AND v.contesto = public.vendita_energia_contesto_manuale(p_id)
      AND v.riscontro = jsonb_build_array(p_punto, p_numero, p_gestore)
  );
$$;

CREATE FUNCTION mirox_private.energia_proteggi_conferma() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.stato_controllo = 'controllato' AND OLD.stato_controllo = 'da_controllare'
    AND mirox_private.energia_categoria(NEW.categoria_id, NEW.categoria_snapshot)
    AND (current_setting('mirox.verifica_commit', true) = 'yes'
      OR NEW.anagrafica_id IS DISTINCT FROM OLD.anagrafica_id OR NEW.pratica_id IS DISTINCT FROM OLD.pratica_id
      OR NEW.cluster_cliente IS DISTINCT FROM OLD.cluster_cliente
      OR NOT public.vendita_energia_pronta(NEW.id, NEW.pod_pdr, NEW.numero_contratto_energia, NEW.ex_fornitore)) THEN
    RAISE EXCEPTION 'Ricarica la pratica. Serve il riscontro della bolletta e del CSV WindTre prima di confermare.' USING ERRCODE = '40001';
  END IF;
  IF OLD.stato_controllo = 'controllato' AND NEW.stato_controllo = 'da_controllare'
    AND mirox_private.energia_categoria(OLD.categoria_id, OLD.categoria_snapshot) THEN
    DELETE FROM public.vendita_energia_verifiche WHERE contratto_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_energia_proteggi_conferma BEFORE UPDATE OF stato_controllo ON public.vendita_contratti
  FOR EACH ROW EXECUTE FUNCTION mirox_private.energia_proteggi_conferma();

CREATE FUNCTION mirox_private.energia_invalida_bolletta() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  id_prima uuid;
  id_dopo uuid;
  c_id uuid;
BEGIN
  IF TG_OP <> 'INSERT' AND OLD.tipo_documento = 'copia_bolletta' THEN id_prima := OLD.contratto_id; END IF;
  IF TG_OP <> 'DELETE' AND NEW.tipo_documento = 'copia_bolletta' THEN id_dopo := NEW.contratto_id; END IF;
  IF id_prima IS NULL AND id_dopo IS NULL THEN RETURN NULL; END IF;
  FOR c_id IN SELECT id FROM public.vendita_contratti WHERE id IN (id_prima, id_dopo)
    AND mirox_private.energia_categoria(categoria_id, categoria_snapshot) AND stato_controllo = 'da_controllare' ORDER BY id FOR NO KEY UPDATE
  LOOP
    UPDATE public.vendita_energia_verifiche SET stato = 'in_attesa_csv', motivo = NULL, contesto = NULL,
      riscontro = NULL, esito_csv = NULL, csv_at = NULL, lease = NULL, lease_until = NULL
    WHERE contratto_id = c_id;
  END LOOP;
  RETURN NULL;
END;
$$;
CREATE TRIGGER trg_energia_invalida_bolletta AFTER INSERT OR DELETE OR UPDATE OF contratto_id, tipo_documento, storage_path, storage_bucket,
  sha256, uploaded_at, file_size ON public.vendita_documenti FOR EACH ROW EXECUTE FUNCTION mirox_private.energia_invalida_bolletta();

-- Inizializza il nuovo controllo con il CSV già caricato. I due passaggi (import
-- e inserimento L&G) sono serializzati per non perdere esiti in concorrenza.
CREATE FUNCTION mirox_private.energia_inizializza_esito_lg() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  prova public.vendita_energia_verifiche%ROWTYPE;
  fonte public.vendita_energia_csv%ROWTYPE;
  dati jsonb;
  contesto jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(761258, 1);
  SELECT * INTO prova FROM public.vendita_energia_verifiche WHERE contratto_id = NEW.contratto_id AND stato = 'in_attesa_verifica';
  IF prova.contratto_id IS NULL OR NEW.esito_manuale_bloccato OR NEW.stato IS NOT NULL THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.post_vendita_controllo_lg l JOIN public.vendita_contratti c ON c.id = l.contratto_id
    WHERE l.contratto_id <> NEW.contratto_id AND mirox_private.energia_codice(c.pod_pdr) = (prova.riscontro->>0)
      AND mirox_private.energia_codice(c.numero_contratto_energia) = (prova.riscontro->>1)) THEN RETURN NEW; END IF;
  SELECT * INTO fonte FROM public.vendita_energia_csv WHERE singleton;
  contesto := prova.contesto;
  IF EXISTS (SELECT 1 FROM public.vendita_energia_csv_righe r
    WHERE r.numero = (prova.riscontro->>1) AND r.punto = (prova.riscontro->>0)) THEN
    SELECT to_jsonb(r) || jsonb_build_object('csv_at', fonte.caricato_at, 'csv_da', fonte.caricato_da) INTO dati
    FROM mirox_private.energia_esito_lg(prova.riscontro->>1, prova.riscontro->>0,
      contesto->>'fiscale', (contesto->>'business')::boolean, false) r;
  ELSE
    dati := prova.esito_csv;
  END IF;
  IF dati->>'stato' IS NULL THEN RETURN NEW; END IF;
  NEW.stato := dati->>'stato';
  NEW.stato_origine := 'csv';
  NEW.causale_stato_pratica := dati->>'causale';
  NEW.messaggio_esito_sap := dati->>'messaggio';
  NEW.causa_annullamento := dati->>'annullamento';
  NEW.ultimo_csv_upload_at := (dati->>'csv_at')::timestamptz;
  NEW.ultimo_csv_upload_da := (dati->>'csv_da')::uuid;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_energia_inizializza_esito_lg BEFORE INSERT ON public.post_vendita_controllo_lg
  FOR EACH ROW EXECUTE FUNCTION mirox_private.energia_inizializza_esito_lg();

REVOKE ALL ON FUNCTION public.vendita_energia_importa_csv(text, uuid, jsonb), public.vendita_energia_prossimo(boolean),
  public.vendita_energia_contesto_manuale(uuid), public.vendita_energia_pronta(uuid, text, text, text),
  public.vendita_energia_riscontra(uuid, timestamptz, jsonb, uuid, uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_energia_importa_csv(text, uuid, jsonb), public.vendita_energia_prossimo(boolean),
  public.vendita_energia_contesto_manuale(uuid), public.vendita_energia_pronta(uuid, text, text, text),
  public.vendita_energia_riscontra(uuid, timestamptz, jsonb, uuid, uuid, text, text, text, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION mirox_private.energia_codice(text), mirox_private.energia_fiscale(text,text), mirox_private.energia_contesto(uuid),
  mirox_private.energia_categoria(uuid, text),
  mirox_private.energia_esito_lg(text, text, text, boolean, boolean),
  mirox_private.energia_proteggi_conferma(), mirox_private.energia_invalida_bolletta(), mirox_private.energia_inizializza_esito_lg() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mirox_private.energia_codice(text), mirox_private.energia_fiscale(text,text), mirox_private.energia_contesto(uuid),
  mirox_private.energia_categoria(uuid, text),
  mirox_private.energia_esito_lg(text, text, text, boolean, boolean) TO service_role;

COMMIT;
