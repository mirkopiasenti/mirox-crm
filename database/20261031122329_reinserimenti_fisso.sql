-- CLI `supabase migration new reinserimenti_fisso` non avviabile (EPERM
-- telemetry prima del comando); timestamp UTC letto dall'orologio della sessione.
-- Applicare prima del frontend. Nessuna modifica alle tabelle condivise CC.
BEGIN;

ALTER TABLE public.vendita_contratti
  ADD COLUMN reinserimento_fisso_finalizzato boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendita_contratti
  ADD CONSTRAINT vendita_reinserimento_fisso_finalizzato_chk CHECK (
    NOT reinserimento_fisso_finalizzato OR
    (categoria_snapshot = 'Fisso' AND stato_inserimento = 'reinserimento'
      AND reinserimento_di_contratto_id IS NOT NULL)
  );

-- Un solo successore inviato per origine, anche con finalize concorrenti.
CREATE UNIQUE INDEX vendita_fisso_un_successore_finalizzato
  ON public.vendita_contratti (reinserimento_di_contratto_id)
  WHERE reinserimento_fisso_finalizzato;

CREATE FUNCTION public.vendita_finalizza_reinserimenti_fisso()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  child record;
  parent record;
  old_post public.post_vendita_controllo_fissi%ROWTYPE;
  previous_verifica_setting text;
BEGIN
  FOR child IN
    SELECT c.* FROM public.vendita_contratti c
    WHERE c.pratica_id = NEW.id AND c.categoria_snapshot = 'Fisso'
      AND c.stato_inserimento = 'reinserimento'
    ORDER BY c.reinserimento_di_contratto_id, c.id
  LOOP
    SELECT c.*, p.stato_pratica AS stato_origine INTO parent
      FROM public.vendita_contratti c
      JOIN public.vendita_pratiche p ON p.id = c.pratica_id
      WHERE c.id = child.reinserimento_di_contratto_id FOR UPDATE OF c;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contratto origine del reinserimento Fisso non trovato';
    END IF;
    IF parent.id = child.id OR parent.pratica_id = NEW.id
      OR parent.stato_origine <> 'inviata'
      OR parent.anagrafica_id IS DISTINCT FROM child.anagrafica_id
      OR parent.categoria_id IS DISTINCT FROM child.categoria_id
      OR parent.categoria_snapshot IS DISTINCT FROM 'Fisso'
      OR date_trunc('month', parent.data_contratto AT TIME ZONE 'Europe/Rome')
         IS DISTINCT FROM date_trunc('month', child.data_contratto AT TIME ZONE 'Europe/Rome')
    THEN
      RAISE EXCEPTION 'Origine non valida per il reinserimento Fisso';
    END IF;
    IF EXISTS (SELECT 1 FROM public.vendita_contratti c
      WHERE c.reinserimento_di_contratto_id = parent.id
        AND c.reinserimento_fisso_finalizzato AND c.id <> child.id) THEN
      RAISE EXCEPTION 'Il Fisso origine ha gia un reinserimento inviato: selezionare l ultimo tentativo';
    END IF;
    SELECT * INTO old_post FROM public.post_vendita_controllo_fissi
      WHERE contratto_id = parent.id FOR UPDATE;
    IF NOT FOUND OR old_post.stato NOT IN ('KO', 'In Attivazione') THEN
      RAISE EXCEPTION 'Stato origine non idoneo al reinserimento Fisso';
    END IF;
    IF old_post.stato <> 'KO' THEN
      UPDATE public.post_vendita_controllo_fissi SET stato = 'KO',
        motivo_ko = concat_ws(E'\n', nullif(motivo_ko, ''),
          'Sostituito dal reinserimento Fisso ' || child.id::text),
        stato_cambiato_at = now(), stato_cambiato_da = NEW.operatore_id
        WHERE contratto_id = parent.id;
      INSERT INTO public.vendita_log_modifiche
        (tabella, record_id, azione, dati_precedenti, dati_nuovi, created_by)
      SELECT 'post_vendita_controllo_fissi', f.id, 'ko_per_reinserimento_fisso',
        to_jsonb(old_post), to_jsonb(f) || jsonb_build_object('reinserimento_id', child.id), NEW.operatore_id
      FROM public.post_vendita_controllo_fissi f WHERE f.contratto_id = parent.id;
    END IF;
    -- Solo metadato di conteggio: non invalida la verifica documentale.
    -- Ripristinare il contesto prima degli altri trigger della pratica.
    previous_verifica_setting := current_setting('mirox.verifica_commit', true);
    PERFORM set_config('mirox.verifica_commit', 'yes', true);
    UPDATE public.vendita_contratti SET reinserimento_fisso_finalizzato = true
      WHERE id = child.id;
    PERFORM set_config('mirox.verifica_commit', coalesce(previous_verifica_setting, ''), true);
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.vendita_finalizza_reinserimenti_fisso() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vendita_finalizza_reinserimenti_fisso() TO service_role;
CREATE TRIGGER trg_vendita_finalizza_reinserimenti_fisso
  AFTER UPDATE OF stato_pratica ON public.vendita_pratiche
  FOR EACH ROW WHEN (OLD.stato_pratica = 'bozza' AND NEW.stato_pratica = 'inviata')
  EXECUTE FUNCTION public.vendita_finalizza_reinserimenti_fisso();

-- Recupero storico: validare tutte le origini prima di qualsiasi modifica.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.vendita_contratti child
    JOIN public.vendita_pratiche p ON p.id = child.pratica_id
    LEFT JOIN public.vendita_contratti parent ON parent.id = child.reinserimento_di_contratto_id
    LEFT JOIN public.vendita_pratiche pp ON pp.id = parent.pratica_id
    LEFT JOIN public.post_vendita_controllo_fissi f ON f.contratto_id = parent.id
    WHERE child.categoria_snapshot = 'Fisso' AND child.stato_inserimento = 'reinserimento'
      AND p.stato_pratica = 'inviata' AND (
        parent.id IS NULL OR parent.id = child.id OR parent.pratica_id = child.pratica_id
        OR pp.stato_pratica IS DISTINCT FROM 'inviata'
        OR parent.anagrafica_id IS DISTINCT FROM child.anagrafica_id
        OR parent.categoria_id IS DISTINCT FROM child.categoria_id
        OR parent.categoria_snapshot IS DISTINCT FROM 'Fisso'
        OR f.stato IS NULL OR f.stato NOT IN ('KO', 'In Attivazione')
        OR date_trunc('month', parent.data_contratto AT TIME ZONE 'Europe/Rome')
          IS DISTINCT FROM date_trunc('month', child.data_contratto AT TIME ZONE 'Europe/Rome')
      )
  ) THEN
    RAISE EXCEPTION 'Storico reinserimenti Fisso incoerente: verificare prima del rilascio';
  END IF;
END;
$$;

DO $$
DECLARE previous_verifica_setting text := current_setting('mirox.verifica_commit', true);
BEGIN
  PERFORM set_config('mirox.verifica_commit', 'yes', true);
  UPDATE public.vendita_contratti c SET reinserimento_fisso_finalizzato = true
  FROM public.vendita_pratiche p WHERE p.id = c.pratica_id AND p.stato_pratica = 'inviata'
    AND c.categoria_snapshot = 'Fisso' AND c.stato_inserimento = 'reinserimento';
  PERFORM set_config('mirox.verifica_commit', coalesce(previous_verifica_setting, ''), true);
END;
$$;

WITH old_rows AS MATERIALIZED (
  SELECT f.*, c.id AS nuovo_contratto_id, p.operatore_id AS autore
  FROM public.post_vendita_controllo_fissi f
  JOIN public.vendita_contratti c ON c.reinserimento_di_contratto_id = f.contratto_id
  JOIN public.vendita_pratiche p ON p.id = c.pratica_id
  WHERE c.reinserimento_fisso_finalizzato AND f.stato = 'In Attivazione'
), changed AS (
  UPDATE public.post_vendita_controllo_fissi f SET stato = 'KO',
    motivo_ko = concat_ws(E'\n', nullif(f.motivo_ko, ''),
      'Sostituito dal reinserimento Fisso ' || o.nuovo_contratto_id::text),
    stato_cambiato_at = now(), stato_cambiato_da = o.autore
  FROM old_rows o WHERE f.id = o.id RETURNING f.*
)
INSERT INTO public.vendita_log_modifiche
  (tabella, record_id, azione, dati_precedenti, dati_nuovi, created_by)
SELECT 'post_vendita_controllo_fissi', f.id, 'ko_per_reinserimento_fisso_storico',
  to_jsonb(o) - 'nuovo_contratto_id' - 'autore',
  to_jsonb(f) || jsonb_build_object('reinserimento_id', o.nuovo_contratto_id), o.autore
FROM changed f JOIN old_rows o ON o.id = f.id;

COMMENT ON COLUMN public.vendita_contratti.reinserimento_fisso_finalizzato IS
  'Reinserimento Fisso inviato: conteggiabile nel mensile secondo stato/tecnologia; false per bozze. Day by Day e Gare mantengono i propri filtri.';
COMMIT;
