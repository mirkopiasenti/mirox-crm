-- Nuova riga Avanzamento Standard: dati di catalogo, nessuna modifica schema.
-- Il frontend/Target gia' leggono dinamicamente le metriche: nessun deploy
-- necessario per mostrare la riga. Default preflight, applica=true per inserirla.
DO $avanzamento$
DECLARE
  applica boolean := false;
  configurazione jsonb := $metrica${
    "nome":"CAMBI PIANO","tabella":"avanzamento_standard","gruppo":"Standard",
    "colore_hex":"#F8D7DA","punti_per_pezzo":1,"punteggio_campo":null,
    "tipo_conteggio":"individuale","tipo_compenso":"individuale","attiva":true,
    "regola":{"or":[
      {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*-\\s*tied$"},
      {"categoria":"Customer Base","cluster":"Business","offerta_match":"^cambio\\s+piano\\s*-\\s*mobile$"}
    ]},
    "descrizione":"Cambi piano TIED Consumer e Cambio Piano - MOBILE Business a Legnago, esclusi reinserimenti. Ogni cambio vale un pezzo e un punto. Obiettivo del mese configurabile da Admin; la soglia individuale della gara CB resta separata."
  }$metrica$::jsonb;
  ordine_cb integer;
  ordine_fissi integer;
  ordine_nuovo integer;
  numero integer;
  esistente public.gara_metriche%ROWTYPE;
BEGIN
  -- Serializza gli inserimenti concorrenti, senza introdurre vincoli/schema.
  LOCK TABLE public.gara_metriche IN SHARE ROW EXCLUSIVE MODE;
  SELECT count(*), min(ordine) INTO numero, ordine_cb FROM public.gara_metriche
   WHERE tabella='avanzamento_standard' AND nome='TELEFONI CB' AND attiva;
  IF numero<>1 THEN RAISE EXCEPTION 'Attesa una metrica TELEFONI CB attiva'; END IF;
  SELECT count(*), min(ordine) INTO numero, ordine_fissi FROM public.gara_metriche
   WHERE tabella='avanzamento_standard' AND nome='FISSI' AND attiva;
  IF numero<>1 OR ordine_fissi-ordine_cb<2 THEN
    RAISE EXCEPTION 'Impossibile collocare CAMBI PIANO tra TELEFONI CB e FISSI senza riordinare le righe';
  END IF;
  ordine_nuovo := ordine_cb+(ordine_fissi-ordine_cb)/2;
  SELECT count(*) INTO numero FROM public.gara_metriche
   WHERE tabella='avanzamento_standard' AND nome='CAMBI PIANO';
  IF numero>1 THEN RAISE EXCEPTION 'Metriche CAMBI PIANO duplicate'; END IF;
  IF numero=1 THEN
    SELECT * INTO esistente FROM public.gara_metriche
     WHERE tabella='avanzamento_standard' AND nome='CAMBI PIANO';
    IF esistente.ordine<>ordine_nuovo OR
      (to_jsonb(esistente)-ARRAY['id','created_at','updated_at','ordine']) IS DISTINCT FROM configurazione THEN
      RAISE EXCEPTION 'CAMBI PIANO esistente diversa dal piano; rileggere prima di applicare';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.gara_metriche WHERE tabella='avanzamento_standard'
      AND attiva AND ordine=ordine_nuovo) THEN
      RAISE EXCEPTION 'Ordine % gia occupato da altra metrica',ordine_nuovo;
    END IF;
    IF applica THEN
      INSERT INTO public.gara_metriche
        (nome,tabella,gruppo,ordine,colore_hex,punti_per_pezzo,regola,attiva,
         tipo_conteggio,tipo_compenso,descrizione,punteggio_campo)
      VALUES (configurazione->>'nome',configurazione->>'tabella',configurazione->>'gruppo',
        ordine_nuovo,configurazione->>'colore_hex',1,configurazione->'regola',true,
        'individuale','individuale',configurazione->>'descrizione',NULL);
    END IF;
  END IF;
  RAISE NOTICE 'Verifica CAMBI PIANO ordine % riuscita; applicazione: %',ordine_nuovo,applica;
END;
$avanzamento$;
