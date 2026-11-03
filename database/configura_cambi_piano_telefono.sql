-- Proposta di configurazione dati: include i cambi piano con telefono.
-- Nessuna modifica schema/RLS/RPC; default preflight, non eseguire dal worker.
DO $cambi_piano_telefono$
DECLARE
  applica boolean := false;
  regola_nuova jsonb := $regola${"or":[
    {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*-\\s*tied$"},
    {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*\\+\\s*telefono\\s+finanziato$","tipo_acquisto":"Finanziamento","dispositivo_associato":true},
    {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*\\+\\s*telefono\\s+var$","tipo_acquisto":"VAR","dispositivo_associato":true},
    {"categoria":"Customer Base","cluster":"Business","offerta_match":"^cambio\\s+piano\\s*-\\s*mobile$"}
  ]}$regola$::jsonb;
  vecchia_regola jsonb := '{"or":[
    {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*-\\s*tied$"},
    {"categoria":"Customer Base","cluster":"Business","offerta_match":"^cambio\\s+piano\\s*-\\s*mobile$"}
  ]}'::jsonb;
  metriche integer;
  obiettivi integer;
BEGIN
  SELECT count(*) INTO metriche
    FROM public.gara_metriche
   WHERE tabella='avanzamento_standard' AND nome='CAMBI PIANO' AND attiva
     AND regola IN (vecchia_regola, regola_nuova);
  IF metriche <> 1 THEN
    RAISE EXCEPTION 'Attesa una metrica CAMBI PIANO con regola nota, trovate %', metriche;
  END IF;

  IF applica THEN
    UPDATE public.gara_metriche
       SET regola=regola_nuova
     WHERE tabella='avanzamento_standard' AND nome='CAMBI PIANO' AND attiva
       AND regola=vecchia_regola;
    IF NOT FOUND THEN
      RAISE NOTICE 'Metrica CAMBI PIANO gia'' aggiornata';
    END IF;
  END IF;

  -- Aggiorna solo la seconda condizione del bonus CB di ottobre; soglie,
  -- importo, descrizione e tutte le altre condizioni restano invariati.
  SELECT count(*) INTO obiettivi
    FROM public.gara_obiettivi_mensili o
    JOIN public.gara_metriche m ON m.id=o.metrica_id
   WHERE o.anno=2026 AND o.mese=10 AND m.tabella='gara_individuale'
     AND m.nome IN ('TELEFONI CB','COSTUMER BASE')
     AND jsonb_typeof(o.compenso_regola->'condizioni')='array'
     AND jsonb_array_length(o.compenso_regola->'condizioni')=2
     AND o.compenso_regola->'condizioni'->1->'regola' IN (vecchia_regola, regola_nuova);
  IF obiettivi <> 3 THEN
    RAISE EXCEPTION 'Attesi 3 obiettivi CB ottobre con regola nota, trovati %', obiettivi;
  END IF;

  IF applica THEN
    UPDATE public.gara_obiettivi_mensili o
       SET compenso_regola=jsonb_set(o.compenso_regola, '{condizioni,1,regola}', regola_nuova, false)
      FROM public.gara_metriche m
     WHERE m.id=o.metrica_id AND o.anno=2026 AND o.mese=10
       AND m.tabella='gara_individuale' AND m.nome IN ('TELEFONI CB','COSTUMER BASE')
       AND o.compenso_regola->'condizioni'->1->'regola'=vecchia_regola;
  END IF;
  RAISE NOTICE 'Verifica cambi piano con telefono riuscita; applicazione: %', applica;
END;
$cambi_piano_telefono$;
