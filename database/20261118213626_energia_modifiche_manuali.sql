BEGIN;

ALTER TABLE public.vendita_energia_verifiche
  ADD COLUMN numero_manuale text,
  DROP CONSTRAINT vendita_energia_verifiche_motivo_check,
  ADD CONSTRAINT vendita_energia_verifiche_motivo_check CHECK (motivo IN (
    'bolletta_assente', 'bolletta_illeggibile', 'bolletta_ambigua', 'intestatario_diverso',
    'fornitore_incerto', 'punto_incerto', 'cliente_incompleto', 'csv_assente', 'csv_non_trovato',
    'csv_fiscale_diverso', 'csv_ambiguo', 'csv_numero_diverso', 'errore_lettura'
  ));

CREATE FUNCTION mirox_private.energia_registra_modifica_manuale() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  contesto_attuale jsonb;
  gestore_modificato boolean := NEW.ex_fornitore IS DISTINCT FROM OLD.ex_fornitore;
  numero_modificato boolean := NEW.numero_contratto_energia IS DISTINCT FROM OLD.numero_contratto_energia;
  punto_modificato boolean := NEW.pod_pdr IS DISTINCT FROM OLD.pod_pdr;
  numero_scelto text;
  gestore_scelto text;
BEGIN
  IF current_setting('mirox.verifica_commit', true) = 'yes' THEN RETURN NULL; END IF;
  contesto_attuale := public.vendita_energia_contesto_manuale(NEW.id);
  IF contesto_attuale IS NULL THEN RETURN NULL; END IF;

  IF numero_modificato THEN
    numero_scelto := nullif(mirox_private.energia_codice(NEW.numero_contratto_energia), '');
  END IF;
  IF gestore_modificato AND jsonb_array_length(contesto_attuale->'documenti') > 0 THEN
    gestore_scelto := nullif(trim(NEW.ex_fornitore), '');
  END IF;

  INSERT INTO public.vendita_energia_verifiche AS v
    (contratto_id, contesto, numero_manuale, gestore_riscontrato, lettura_da, punto_originale)
  VALUES (NEW.id, contesto_attuale, numero_scelto, gestore_scelto,
    CASE WHEN gestore_scelto IS NOT NULL THEN NEW.updated_by END,
    CASE WHEN punto_modificato THEN nullif(OLD.pod_pdr, '') END)
  ON CONFLICT (contratto_id) DO UPDATE SET
    stato = 'in_attesa_csv', motivo = NULL, motivo_csv = NULL, motivo_fornitore = NULL,
    contesto = contesto_attuale, riscontro = NULL,
    esito_csv = CASE WHEN NOT (numero_modificato OR punto_modificato) THEN v.esito_csv END,
    numero_manuale = CASE WHEN numero_modificato THEN numero_scelto ELSE v.numero_manuale END,
    gestore_riscontrato = CASE WHEN gestore_modificato THEN gestore_scelto
      WHEN v.contesto = contesto_attuale THEN coalesce(v.gestore_riscontrato,
        CASE WHEN v.stato = 'in_attesa_verifica' AND v.riscontro->>2 = NEW.ex_fornitore THEN NEW.ex_fornitore END)
      END,
    lettura_da = CASE WHEN gestore_modificato THEN excluded.lettura_da
      WHEN v.contesto = contesto_attuale THEN v.lettura_da END,
    punto_originale = CASE WHEN punto_modificato THEN excluded.punto_originale ELSE v.punto_originale END,
    lease = NULL, lease_until = NULL, riprova_at = NULL;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION mirox_private.energia_registra_modifica_manuale() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mirox_private.energia_registra_modifica_manuale() TO service_role;

CREATE TRIGGER trg_energia_registra_modifica_manuale
  AFTER UPDATE OF pod_pdr, numero_contratto_energia, ex_fornitore ON public.vendita_contratti
  FOR EACH ROW WHEN (
    current_user = 'service_role' AND NEW.stato_controllo = 'da_controllare'
    AND ROW(OLD.pod_pdr, OLD.numero_contratto_energia, OLD.ex_fornitore)
      IS DISTINCT FROM ROW(NEW.pod_pdr, NEW.numero_contratto_energia, NEW.ex_fornitore)
  ) EXECUTE FUNCTION mirox_private.energia_registra_modifica_manuale();

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
  numero_scelto text;
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
  IF v.numero_manuale = mirox_private.energia_codice(c.numero_contratto_energia) THEN
    numero_scelto := v.numero_manuale;
  END IF;
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
      AND (numero_scelto IS NULL OR r.numero = numero_scelto)
      AND (p_contesto->>'fiscale') = CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END;
    IF conteggio = 1 THEN
      SELECT r.* INTO riga
      FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id AND r.punto = codice
        AND (numero_scelto IS NULL OR r.numero = numero_scelto)
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
    ELSIF numero_scelto IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.vendita_energia_csv_righe r WHERE r.fonte_id = fonte.id AND r.punto = codice
        AND (p_contesto->>'fiscale') = CASE WHEN (p_contesto->>'business')::boolean THEN r.piva ELSE r.cf END
    ) THEN
      motivo_csv := 'csv_numero_diverso';
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

  numero_salvato := CASE WHEN numero_scelto IS NOT NULL THEN c.numero_contratto_energia
    WHEN prova_csv IS NOT NULL THEN riga.numero
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

COMMIT;
