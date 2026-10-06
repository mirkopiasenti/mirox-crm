-- Configurazione dati proposta: Cambio Piano + telefono Customer Base.
-- Non modifica lo schema, RLS, RPC o tabelle condivise con il Call Center.
-- Applicare manualmente solo dopo revisione e pubblicazione del codice corrente.

BEGIN;

DO $$
DECLARE
  customer_base_id uuid;
BEGIN
  SELECT id
    INTO customer_base_id
    FROM public.vendita_categorie
   WHERE nome = 'Customer Base';

  IF customer_base_id IS NULL THEN
    RAISE EXCEPTION 'Categoria Customer Base non trovata';
  END IF;

  INSERT INTO public.vendita_offerte (
    categoria_id, cluster_cliente, nome_offerta, descrizione,
    punteggio_gara, punteggio_extra_gara, abilita_dispositivo, attiva
  ) VALUES
    (
      customer_base_id, 'Consumer',
      'Cambio Piano + Telefono Finanziato',
      'Cambio piano Consumer con telefono associato acquistato tramite finanziamento',
      1, 0, true, true
    ),
    (
      customer_base_id, 'Consumer',
      'Cambio Piano + Telefono VAR',
      'Cambio piano Consumer con telefono associato in modalità VAR',
      1, 0, true, true
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.dashboard_righe_giornaliera (
    nome, gruppo, colore_hex, ordine, regola, attiva
  )
  SELECT
    'CAMBIO PIANO + TELEFONO FINANZIATO',
    'Customer Base', '#F4CCCC', 215,
    '{"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*\\+\\s*telefono\\s+finanziato$","dispositivo_associato":true,"tipo_acquisto":"Finanziamento"}'::jsonb,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dashboard_righe_giornaliera
     WHERE nome = 'CAMBIO PIANO + TELEFONO FINANZIATO'
  );

  INSERT INTO public.dashboard_righe_giornaliera (
    nome, gruppo, colore_hex, ordine, regola, attiva
  )
  SELECT
    'CAMBIO PIANO + TELEFONO VAR',
    'Customer Base', '#F4CCCC', 216,
    '{"categoria":"Customer Base","cluster":"Consumer","offerta_match":"^cambio\\s+piano\\s*\\+\\s*telefono\\s+var$","dispositivo_associato":true,"tipo_acquisto":"VAR"}'::jsonb,
    true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.dashboard_righe_giornaliera
     WHERE nome = 'CAMBIO PIANO + TELEFONO VAR'
  );

  IF (
    SELECT count(*)
      FROM public.vendita_offerte
     WHERE categoria_id = customer_base_id
       AND cluster_cliente = 'Consumer'
       AND nome_offerta IN (
         'Cambio Piano + Telefono Finanziato',
         'Cambio Piano + Telefono VAR'
       )
       AND punteggio_gara = 1
       AND punteggio_extra_gara = 0
       AND abilita_dispositivo = true
       AND attiva = true
  ) <> 2 THEN
    RAISE EXCEPTION 'Verifica offerte Cambio Piano + Telefono fallita';
  END IF;

  IF (
    SELECT count(*)
      FROM public.dashboard_righe_giornaliera
     WHERE nome IN (
       'CAMBIO PIANO + TELEFONO FINANZIATO',
       'CAMBIO PIANO + TELEFONO VAR'
     )
       AND gruppo = 'Customer Base'
       AND attiva = true
  ) <> 2 THEN
    RAISE EXCEPTION 'Verifica righe Day by Day fallita';
  END IF;
END;
$$;

COMMIT;
