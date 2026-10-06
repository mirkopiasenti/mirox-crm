-- Configurazione dati ottobre 2026. Nessuna modifica schema o metriche globali.
-- Default: verifica senza scritture. Impostare applica=true SOLO dopo il deploy
-- del motore con supporto obiettivi_combinati/override mensili, e su richiesta push.
-- Una sola transazione: 3 metriche x 3 operatori canonici, nessun altro mese.
DO $gare$
DECLARE
  applica boolean := false;
  squadra jsonb;
  numero integer;
  r record;
  nuovo jsonb;
  vecchio jsonb;
  obiettivo_nuovo integer;
  tied jsonb := $tied${
    "tipo":"scaglioni","label":"",
    "scaglioni":[{"da":35,"importo":100,"tipo_calcolo":"flat"}],"bonus_soglie":[],
    "gara":{"descrizione":"100 EUR al raggiungimento di 35 attivazioni TIED individuali. Comprende SIM TIED Mobile, SIM TIED Dati e FWA Indoor."}
  }$tied$::jsonb;
  cb jsonb := $cb${
    "tipo":"obiettivi_combinati","importo":100,
    "condizioni":[
      {"nome":"Telefoni CB","soglia":35,"regola":{"or":[
        {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"telefono incluso","dispositivo_associato":true,"tipo_acquisto":"VAR"},
        {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"telefono incluso","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}
      ]}},
      {"nome":"Cambi piano TIED","soglia":15,"regola":{"or":[
        {"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*-\\s*tied$"},
        {"categoria":"Customer Base","cluster":"Business","offerta_match":"^cambio\\s+piano\\s*-\\s*mobile$"}
      ]}}
    ],
    "gara":{"descrizione":"Bonus individuale unico di 100 EUR solo quando sono raggiunti entrambi gli obiettivi: 35 telefoni CB Consumer con dispositivo, VAR o Finanziamento, e 15 cambi piano. Contano Cambio Piano - TIED Consumer e Cambio Piano - MOBILE Business (equivalenza confermata). UNTIED, Caring e cambi piano Fisso sono esclusi. Le eccedenze non compensano una soglia mancante."}
  }$cb$::jsonb;
  assicurazioni jsonb := $assicurazioni${
    "tipo":"scaglioni","label":"",
    "scaglioni":[{"da":10,"importo":50,"tipo_calcolo":"flat"}],"bonus_soglie":[],
    "gara":{"tipo_conteggio":"squadra","punteggio_campo":"punteggio_gara_totale","codice_rivenditore":"9001415852",
      "descrizione":"Gara di squadra: al raggiungimento di 10 punti Assicurazioni complessivi, bonus unico di 50 EUR a ciascuno di Francesca, Matteo e Mirko. Somma dei punteggi reali dei tre operatori a Legnago; Cerea e reinserimenti esclusi."}
  }$assicurazioni$::jsonb;
BEGIN
  SELECT count(*), jsonb_agg(id ORDER BY nome) INTO numero, squadra
    FROM public.profili
   WHERE nome IN ('Francesca','Matteo','Mirko') AND attivo AND in_gara AND alias_di IS NULL;
  IF numero <> 3 OR (SELECT count(DISTINCT nome) FROM public.profili
      WHERE nome IN ('Francesca','Matteo','Mirko') AND attivo AND in_gara AND alias_di IS NULL) <> 3 THEN
    RAISE EXCEPTION 'Attesi tre operatori canonici attivi in gara';
  END IF;
  assicurazioni := jsonb_set(assicurazioni, '{gara,operatori}', squadra);

  SELECT count(*) INTO numero FROM public.gara_metriche
   WHERE attiva AND tabella='gara_individuale'
     AND nome IN ('ATTIVAZIONI TIED','TELEFONI CB','ASSICURAZIONI');
  IF numero <> 3 OR (SELECT count(DISTINCT nome) FROM public.gara_metriche
      WHERE attiva AND tabella='gara_individuale'
        AND nome IN ('ATTIVAZIONI TIED','TELEFONI CB','ASSICURAZIONI')) <> 3 THEN
    RAISE EXCEPTION 'Attese tre metriche univoche attive';
  END IF;
  SELECT count(*) INTO numero
    FROM public.gara_obiettivi_mensili o JOIN public.gara_metriche m ON m.id=o.metrica_id
   WHERE o.anno=2026 AND o.mese=10 AND squadra ? o.operatore_id::text
     AND m.attiva AND m.tabella='gara_individuale'
     AND m.nome IN ('ATTIVAZIONI TIED','TELEFONI CB','ASSICURAZIONI');
  IF numero <> 9 THEN RAISE EXCEPTION 'Attesi 9 obiettivi ottobre, trovati %', numero; END IF;

  FOR r IN
    SELECT o.*, m.nome FROM public.gara_obiettivi_mensili o
    JOIN public.gara_metriche m ON m.id=o.metrica_id
    WHERE o.anno=2026 AND o.mese=10 AND squadra ? o.operatore_id::text
      AND m.attiva AND m.tabella='gara_individuale'
      AND m.nome IN ('ATTIVAZIONI TIED','TELEFONI CB','ASSICURAZIONI')
    ORDER BY o.id FOR UPDATE OF o
  LOOP
    nuovo := CASE r.nome WHEN 'ATTIVAZIONI TIED' THEN tied WHEN 'TELEFONI CB' THEN cb ELSE assicurazioni END;
    obiettivo_nuovo := CASE r.nome WHEN 'ASSICURAZIONI' THEN 10 ELSE 35 END;
    vecchio := jsonb_build_object('tipo','scaglioni','label','',
      'scaglioni',jsonb_build_array(jsonb_build_object('da',
        CASE r.nome WHEN 'ATTIVAZIONI TIED' THEN 45 WHEN 'TELEFONI CB' THEN 50 ELSE 15 END,
        'importo',100,'tipo_calcolo','flat')), 'bonus_soglie','[]'::jsonb);
    IF NOT ((r.compenso_regola=vecchio AND r.obiettivo IN
        (obiettivo_nuovo, CASE r.nome WHEN 'ATTIVAZIONI TIED' THEN 45 WHEN 'TELEFONI CB' THEN 50 ELSE 15 END))
        OR (r.compenso_regola=nuovo AND r.obiettivo=obiettivo_nuovo)) THEN
      RAISE EXCEPTION 'Obiettivo % cambiato rispetto alla ricognizione; rileggere prima di applicare', r.id;
    END IF;
    IF applica AND (r.compenso_regola IS DISTINCT FROM nuovo OR r.obiettivo<>obiettivo_nuovo) THEN
      UPDATE public.gara_obiettivi_mensili SET obiettivo=obiettivo_nuovo, compenso_regola=nuovo WHERE id=r.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Obiettivo % non aggiornato', r.id; END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Verificati 9 obiettivi ottobre; applicazione: %', applica;
END;
$gare$;
