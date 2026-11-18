BEGIN;

CREATE OR REPLACE FUNCTION public.vendita_energia_prossimo(p_prendi boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  versione uuid;
  candidato record;
  token uuid;
BEGIN
  IF p_prendi THEN
    PERFORM pg_advisory_xact_lock(761258, 2);
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendita_energia_verifiche WHERE lease_until > now()) THEN RETURN NULL; END IF;
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
  -- Prima le pratiche che non hanno già impegnato il lettore in questo giro.
  -- Un timeout o un lease scaduto non deve far aspettare tutta la coda.
  ORDER BY CASE WHEN v.lease_until IS NOT NULL
    OR (v.csv_id = versione AND v.riprova_at IS NOT NULL) THEN 1 ELSE 0 END, c.created_at, c.id
  LIMIT 1;
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

COMMIT;
