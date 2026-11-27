-- Configurazione dati: aggiunge il cambio piano Mobile Business al Day by Day.
-- Verifica per impostazione predefinita. Impostare applica=true per applicare.
DO $day_by_day$
DECLARE
  applica boolean := false;
  regola_precedente constant jsonb :=
    '{"categoria":"Customer Base","offerta_match":"tied","offerta_not_match":"untied"}'::jsonb;
  cambio_mobile_business constant jsonb := $business$
  {
    "categoria":"Customer Base",
    "cluster":"Business",
    "offerta_match":"^cambio\\s+piano\\s*-\\s*mobile$"
  }
  $business$::jsonb;
  regola_nuova constant jsonb :=
    jsonb_build_object('or', jsonb_build_array(regola_precedente, cambio_mobile_business));
  regola_attuale jsonb;
BEGIN
  SELECT regola INTO STRICT regola_attuale
    FROM public.dashboard_righe_giornaliera
   WHERE id = 13 AND nome = 'CAMBIO PIANO EASY PAY'
     AND gruppo = 'Customer Base' AND attiva
   FOR UPDATE;

  IF regola_attuale = regola_nuova THEN
    RAISE NOTICE 'CAMBIO PIANO EASY PAY già aggiornata';
    RETURN;
  END IF;
  IF regola_attuale IS DISTINCT FROM regola_precedente THEN
    RAISE EXCEPTION 'Regola di CAMBIO PIANO EASY PAY diversa da quella verificata';
  END IF;

  IF applica THEN
    UPDATE public.dashboard_righe_giornaliera
       SET regola = regola_nuova
     WHERE id = 13;
  END IF;
  RAISE NOTICE 'Verifica CAMBIO PIANO EASY PAY riuscita. Applicazione: %', applica;
END;
$day_by_day$;
