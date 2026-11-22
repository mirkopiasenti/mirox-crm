-- Censimento dei soli soggetti mancanti, atomico con la chiusura dei subentri con modulo.
BEGIN;

CREATE FUNCTION public.subentri_finalizza_con_anagrafiche(
  p_id uuid,
  p_operatore uuid,
  p_pdf_sha256 text,
  p_template_versione text,
  p_numero_pagine integer
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_pratica public.subentri_generati%ROWTYPE;
  v_dati jsonb;
BEGIN
  SELECT * INTO v_pratica
  FROM public.subentri_generati
  WHERE id = p_id AND created_by = p_operatore
  FOR UPDATE;

  IF NOT FOUND OR v_pratica.tipo = 'mobile_1928_privato' THEN
    RAISE EXCEPTION 'Subentro con modulo non disponibile' USING ERRCODE = 'P0002';
  END IF;
  IF v_pratica.stato = 'generato' THEN
    RETURN;
  END IF;
  IF v_pratica.stato <> 'bozza' THEN
    RAISE EXCEPTION 'Subentro non finalizzabile' USING ERRCODE = '22023';
  END IF;

  v_dati := v_pratica.dati_compilazione;
  WITH soggetti (cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico) AS (
    SELECT
      upper(btrim(coalesce(v_pratica.cedente_partita_iva, v_pratica.cedente_codice_fiscale))),
      CASE WHEN v_pratica.cedente_partita_iva IS NULL THEN 'Consumer' ELSE 'Business' END,
      v_pratica.cedente_nome,
      CASE WHEN v_pratica.cedente_partita_iva IS NOT NULL
        THEN concat_ws(' ', v_dati->>'cedente_nome', v_dati->>'cedente_cognome') END,
      coalesce(nullif(v_dati->>'cedente_telefono_impresa', ''), nullif(v_dati->>'cedente_telefono', '')),
      NULL::text, NULL::text, NULL::text, NULL::text
    UNION ALL
    SELECT
      upper(btrim(coalesce(v_pratica.subentrante_partita_iva, v_pratica.subentrante_codice_fiscale))),
      CASE WHEN v_pratica.subentrante_partita_iva IS NULL THEN 'Consumer' ELSE 'Business' END,
      coalesce(v_pratica.subentrante_ragione_sociale, concat_ws(' ', v_pratica.subentrante_nome, v_pratica.subentrante_cognome)),
      CASE WHEN v_pratica.subentrante_partita_iva IS NOT NULL
        THEN concat_ws(' ', v_pratica.subentrante_nome, v_pratica.subentrante_cognome) END,
      coalesce(nullif(v_dati->>'subentrante_telefono_impresa', ''), nullif(v_dati->>'subentrante_telefono', '')),
      CASE WHEN v_dati->>'subentrante_tipo' = 'impresa' THEN v_dati->>'subentrante_sede_provincia' ELSE v_dati->>'subentrante_provincia' END,
      CASE WHEN v_dati->>'subentrante_tipo' = 'impresa' THEN v_dati->>'subentrante_sede_comune' ELSE v_dati->>'subentrante_comune' END,
      CASE WHEN v_dati->>'subentrante_tipo' = 'impresa' THEN v_dati->>'subentrante_sede_via' ELSE v_dati->>'subentrante_via' END,
      CASE WHEN v_dati->>'subentrante_tipo' = 'impresa' THEN v_dati->>'subentrante_sede_civico' ELSE v_dati->>'subentrante_civico' END
  )
  INSERT INTO public.anagrafica (
    cf_piva, cluster, ragione_sociale, nome_referente, cellulare, provincia, comune, via, civico, creato_da
  )
  SELECT s.cf_piva, s.cluster, s.ragione_sociale, s.nome_referente, s.cellulare, s.provincia, s.comune, s.via, s.civico, p_operatore
  FROM soggetti s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.anagrafica a WHERE upper(btrim(a.cf_piva)) = s.cf_piva
  )
  ORDER BY s.cf_piva
  ON CONFLICT (cf_piva) DO NOTHING;

  UPDATE public.subentri_generati
  SET stato = 'generato',
      storage_path = v_pratica.storage_prefix || '/subentro.pdf',
      nome_file = 'subentro-' || replace(substr(v_pratica.tipo, 8), '_', '-')
        || CASE WHEN v_pratica.mortis_causa THEN '-mortis-causa' ELSE '' END || '-' || v_pratica.id || '.pdf',
      pdf_sha256 = p_pdf_sha256,
      template_versione = p_template_versione,
      numero_pagine = p_numero_pagine,
      generato_at = now()
  WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.subentri_finalizza_con_anagrafiche(uuid, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.subentri_finalizza_con_anagrafiche(uuid, uuid, text, text, integer) TO service_role;

COMMIT;
