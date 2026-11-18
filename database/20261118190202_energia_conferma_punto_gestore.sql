BEGIN;

ALTER TABLE public.vendita_energia_verifiche
  DROP CONSTRAINT vendita_energia_verifiche_stato_check,
  ADD CONSTRAINT vendita_energia_verifiche_stato_check CHECK (stato IN ('in_attesa_csv', 'in_attesa_verifica', 'da_verificare')),
  ADD COLUMN gestore_riscontrato text,
  ADD COLUMN motivo_fornitore text,
  ADD COLUMN motivo_csv text;

GRANT SELECT (motivo_fornitore, motivo_csv) ON public.vendita_energia_verifiche TO authenticated;

-- Le istanze del lettore precedente smettono di acquisire lavori prima del
-- deploy applicativo. I lavori in corso perderanno il loro token e torneranno in coda.
CREATE OR REPLACE FUNCTION public.vendita_energia_prossimo(p_prendi boolean) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT NULL::jsonb $$;

UPDATE public.vendita_energia_verifiche SET lease = NULL, lease_until = NULL WHERE lease IS NOT NULL;

CREATE FUNCTION public.vendita_energia_prossimo_gestore(p_prendi boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  versione uuid;
  candidato record;
  token uuid;
BEGIN
  IF p_prendi IS TRUE THEN PERFORM pg_advisory_xact_lock(761258, 2); END IF;
  IF EXISTS (SELECT 1 FROM public.vendita_energia_verifiche WHERE lease_until > now()) THEN RETURN NULL; END IF;
  SELECT id INTO versione FROM public.vendita_energia_csv WHERE singleton;

  SELECT c.id, c.updated_at, x.contesto,
    CASE WHEN v.contesto = x.contesto AND v.gestore_riscontrato = c.ex_fornitore THEN v.gestore_riscontrato END AS gestore,
    coalesce(v.lease_until <= now(), false) AS lettura_scaduta
  INTO candidato
  FROM public.vendita_contratti c
  JOIN public.vendita_pratiche p ON p.id = c.pratica_id AND p.stato_pratica = 'inviata'
  LEFT JOIN public.vendita_energia_verifiche v ON v.contratto_id = c.id
  CROSS JOIN LATERAL (SELECT mirox_private.energia_contesto(c.id) AS contesto) x
  WHERE mirox_private.energia_categoria(c.categoria_id, c.categoria_snapshot) AND c.stato_controllo = 'da_controllare'
    AND x.contesto IS NOT NULL
    AND (v.lease_until IS NULL OR v.lease_until <= now())
    AND (v.contesto IS DISTINCT FROM x.contesto
      OR v.riscontro IS DISTINCT FROM jsonb_build_array(c.pod_pdr, c.numero_contratto_energia, c.ex_fornitore)
      OR (v.stato <> 'in_attesa_verifica' AND v.csv_id IS DISTINCT FROM versione))
  ORDER BY (v.lease_until IS NOT NULL), c.created_at, c.id
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_prendi IS NOT TRUE THEN RETURN jsonb_build_object('contratto_id', candidato.id); END IF;
  token := gen_random_uuid();
  INSERT INTO public.vendita_energia_verifiche (contratto_id, lease, lease_until)
  VALUES (candidato.id, token, now() + interval '3 minutes')
  ON CONFLICT (contratto_id) DO UPDATE SET lease = excluded.lease, lease_until = excluded.lease_until;
  RETURN jsonb_build_object('contratto_id', candidato.id, 'updated_at', candidato.updated_at,
    'contesto', candidato.contesto, 'lease', token, 'csv_id', versione,
    'gestore', candidato.gestore, 'lettura_scaduta', candidato.lettura_scaduta);
END;
$$;

REVOKE ALL ON FUNCTION public.vendita_energia_prossimo_gestore(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_energia_prossimo_gestore(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.vendita_energia_riscontra(
  p_id uuid, p_updated timestamptz, p_contesto jsonb, p_lease uuid, p_csv_id uuid, p_punto text,
  p_gestore text, p_motivo text, p_autore uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  c public.vendita_contratti%ROWTYPE;
  v public.vendita_energia_verifiche%ROWTYPE;
  fonte public.vendita_energia_csv%ROWTYPE;
  riga public.vendita_energia_csv_righe%ROWTYPE;
  codice text;
  punto_salvato text;
  numero_salvato text;
  gestore_salvato text;
  prova_csv jsonb;
  conteggio integer;
  motivo_fornitore text;
  motivo_csv text;
  motivo text;
  fase text;
  setting_precedente text;
BEGIN
  IF (p_lease IS NULL) = (p_autore IS NULL) THEN RETURN NULL; END IF;
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

  punto_salvato := CASE WHEN p_autore IS NULL THEN c.pod_pdr ELSE mirox_private.energia_codice(p_punto) END;
  codice := mirox_private.energia_codice(punto_salvato);
  IF p_autore IS NOT NULL AND codice !~ '^(IT[0-9]{3}E[A-Z0-9]{8,10}|[0-9]{14})$' THEN RETURN NULL; END IF;

  IF jsonb_array_length(p_contesto->'documenti') = 0 THEN
    motivo_fornitore := 'bolletta_assente';
  ELSIF p_motivo IN ('bolletta_assente', 'bolletta_illeggibile', 'bolletta_ambigua', 'intestatario_diverso', 'errore_lettura') THEN
    motivo_fornitore := p_motivo;
  ELSIF p_motivo IS NOT NULL OR char_length(trim(coalesce(p_gestore, ''))) NOT BETWEEN 2 AND 160 THEN
    motivo_fornitore := 'fornitore_incerto';
  END IF;

  IF codice !~ '^(IT[0-9]{3}E[A-Z0-9]{8,10}|[0-9]{14})$' THEN
    motivo_csv := 'punto_incerto';
  ELSIF coalesce(p_contesto->>'fiscale', '') = '' THEN
    motivo_csv := 'cliente_incompleto';
  ELSIF fonte.id IS NOT NULL THEN
    SELECT count(DISTINCT r.numero) INTO conteggio
    FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id AND r.punto = codice
      AND (p_contesto->>'fiscale') = CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END;
    IF conteggio = 1 THEN
      SELECT r.* INTO riga
      FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id AND r.punto = codice
        AND (p_contesto->>'fiscale') = CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END
      ORDER BY array_position(ARRAY['Rifiutato','Annullato','In lavorazione','In attivazione','Nuovo','Attivato'], r.stato) NULLS LAST,
        r.stato NULLS LAST, r.cf, r.piva LIMIT 1;
      IF EXISTS (SELECT 1 FROM public.vendita_energia_csv_righe r
        WHERE r.fonte_id = fonte.id AND r.punto = codice AND r.numero = riga.numero
          AND nullif(CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END, '') <> (p_contesto->>'fiscale')) THEN
        motivo_csv := 'csv_fiscale_diverso';
      END IF;
    ELSIF conteggio > 1 THEN
      motivo_csv := 'csv_ambiguo';
    ELSIF EXISTS (SELECT 1 FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id AND r.punto = codice) THEN
      motivo_csv := 'csv_fiscale_diverso';
    ELSE
      motivo_csv := 'csv_non_trovato';
    END IF;
  END IF;

  IF motivo_csv IS NULL AND riga.numero IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('mirox-energia/' || codice || '/' || riga.numero, 0));
    IF EXISTS (
      SELECT 1 FROM public.vendita_contratti other
      LEFT JOIN public.vendita_energia_verifiche proof ON proof.contratto_id = other.id
      WHERE other.id <> p_id AND mirox_private.energia_categoria(other.categoria_id, other.categoria_snapshot)
        AND mirox_private.energia_codice(other.pod_pdr) = codice
        AND mirox_private.energia_codice(other.numero_contratto_energia) = riga.numero
        AND (other.stato_controllo = 'controllato' OR proof.stato = 'in_attesa_verifica'
          OR (proof.csv_id = fonte.id AND proof.esito_csv->>'numero' = riga.numero AND proof.esito_csv->>'punto' = codice))
    ) THEN
      motivo_csv := 'csv_ambiguo';
    ELSE
      prova_csv := to_jsonb(riga) || jsonb_build_object('csv_at', fonte.caricato_at, 'csv_da', fonte.caricato_da);
    END IF;
  END IF;

  numero_salvato := CASE WHEN prova_csv IS NOT NULL THEN riga.numero
    WHEN v.esito_csv->>'numero' = c.numero_contratto_energia THEN NULL ELSE c.numero_contratto_energia END;
  gestore_salvato := CASE WHEN motivo_fornitore IS NULL THEN trim(p_gestore)
    WHEN v.gestore_riscontrato = c.ex_fornitore THEN NULL ELSE c.ex_fornitore END;
  motivo := coalesce(motivo_csv, motivo_fornitore);
  fase := CASE WHEN motivo IS NOT NULL THEN 'da_verificare'
    WHEN prova_csv IS NOT NULL THEN 'in_attesa_verifica' ELSE 'in_attesa_csv' END;

  setting_precedente := coalesce(current_setting('mirox.verifica_commit', true), '');
  PERFORM set_config('mirox.verifica_commit', 'yes', true);
  UPDATE public.vendita_contratti SET pod_pdr = punto_salvato, numero_contratto_energia = numero_salvato, ex_fornitore = gestore_salvato
    WHERE id = p_id AND ROW(pod_pdr, numero_contratto_energia, ex_fornitore) IS DISTINCT FROM ROW(punto_salvato, numero_salvato, gestore_salvato);
  PERFORM set_config('mirox.verifica_commit', setting_precedente, true);

  INSERT INTO public.vendita_energia_verifiche (contratto_id, stato, motivo, motivo_fornitore, motivo_csv,
    csv_id, csv_at, punto_originale, contesto, riscontro, esito_csv, lettura_da, gestore_riscontrato)
  VALUES (p_id, fase, motivo, motivo_fornitore, motivo_csv, fonte.id, fonte.caricato_at,
    CASE WHEN codice <> mirox_private.energia_codice(c.pod_pdr) THEN nullif(c.pod_pdr, '') ELSE v.punto_originale END,
    p_contesto, jsonb_build_array(punto_salvato, numero_salvato, gestore_salvato), prova_csv,
    coalesce(p_autore, CASE WHEN motivo_fornitore IS NULL AND v.contesto = p_contesto AND v.gestore_riscontrato = gestore_salvato THEN v.lettura_da END),
    CASE WHEN motivo_fornitore IS NULL THEN gestore_salvato END)
  ON CONFLICT (contratto_id) DO UPDATE SET stato = excluded.stato, motivo = excluded.motivo,
    motivo_fornitore = excluded.motivo_fornitore, motivo_csv = excluded.motivo_csv,
    csv_id = excluded.csv_id, csv_at = excluded.csv_at, punto_originale = excluded.punto_originale,
    contesto = excluded.contesto, riscontro = excluded.riscontro, esito_csv = excluded.esito_csv,
    lettura_da = excluded.lettura_da, gestore_riscontrato = excluded.gestore_riscontrato,
    lease = NULL, lease_until = NULL, riprova_at = NULL;
  RETURN jsonb_build_object('stato', fase, 'motivo', motivo, 'motivo_csv', motivo_csv, 'motivo_fornitore', motivo_fornitore);
END;
$$;

CREATE OR REPLACE FUNCTION mirox_private.energia_invalida_bolletta() RETURNS trigger
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
    UPDATE public.vendita_energia_verifiche SET stato = 'in_attesa_csv', motivo = NULL, motivo_fornitore = NULL,
      motivo_csv = NULL, contesto = NULL, riscontro = NULL, lease = NULL, lease_until = NULL
    WHERE contratto_id = c_id;
  END LOOP;
  RETURN NULL;
END;
$$;

COMMIT;
