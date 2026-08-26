-- =============================================================================
-- 071_bonifica_localita_anagrafica.sql
-- Bonifica conservativa dei valori comune/provincia storici di anagrafica.
--
-- Ambito approvato il 26/08/2026:
-- - canonicalizza formattazione e province derivabili senza ambiguita' dal
--   catalogo ISTAT introdotto dalla migration 070;
-- - converte ex comuni, frazioni e toponimi gia' verificati nel comune corrente;
-- - applica la decisione manuale CAPITELLO -> CONCAMARISE (VR);
-- - elimina soltanto la riga isolata ALTEDO;
-- - conserva le due anagrafiche con storico collegato e azzera la localita'
--   errata 3397390920 / FELICE CAVALLOTTI.
--
-- Le 119 province con una sigla corrente ma in conflitto restano escluse.
-- La migration fallisce integralmente se conteggi, valori sorgente o dipendenze
-- cambiano rispetto all'analisi approvata.
-- =============================================================================

BEGIN;

SET LOCAL statement_timeout = '45s';
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.mirox_anagrafica_localita_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    migration_key text NOT NULL,
    anagrafica_id uuid NOT NULL,
    operazione text NOT NULL CHECK (operazione IN ('update', 'delete')),
    motivo text NOT NULL,
    valori_precedenti jsonb NOT NULL,
    valori_successivi jsonb,
    record_eliminato jsonb,
    eseguito_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT mirox_anagrafica_localita_audit_unq
        UNIQUE (migration_key, anagrafica_id),
    CONSTRAINT mirox_anagrafica_localita_audit_payload_chk CHECK (
        (operazione = 'update' AND valori_successivi IS NOT NULL AND record_eliminato IS NULL)
        OR
        (operazione = 'delete' AND valori_successivi IS NULL AND record_eliminato IS NOT NULL)
    )
);

COMMENT ON TABLE public.mirox_anagrafica_localita_audit IS
    'Audit server-only delle bonifiche comune/provincia, inclusa copia recuperabile dei record eliminati.';

ALTER TABLE public.mirox_anagrafica_localita_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mirox_anagrafica_localita_audit FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.mirox_anagrafica_localita_audit_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mirox_anagrafica_localita_audit TO service_role;
GRANT SELECT ON SEQUENCE public.mirox_anagrafica_localita_audit_id_seq TO service_role;

CREATE TEMP TABLE bonifica_071_mappature (
    comune_sorgente text PRIMARY KEY,
    comune_destinazione text NOT NULL,
    provincia_destinazione text NOT NULL,
    motivo text NOT NULL,
    righe_attese integer NOT NULL CHECK (righe_attese > 0),
    imposta_civico boolean NOT NULL DEFAULT false,
    civico_destinazione text
) ON COMMIT DROP;

INSERT INTO bonifica_071_mappature
    (comune_sorgente, comune_destinazione, provincia_destinazione, motivo, righe_attese, imposta_civico, civico_destinazione)
VALUES
    ('SERMIDE', 'SERMIDE E FELONICA', 'MN', 'accorpamento_comune_storico', 11, false, null),
    ('FELONICA', 'SERMIDE E FELONICA', 'MN', 'accorpamento_comune_storico', 2, false, null),
    ('REVERE', 'BORGO MANTOVANO', 'MN', 'accorpamento_comune_storico', 2, false, null),
    ('SAN GIORGIO DI MANTOVA', 'SAN GIORGIO BIGARELLO', 'MN', 'accorpamento_comune_storico', 2, false, null),
    ('BARBARANO VICENTINO', 'BARBARANO MOSSANO', 'VI', 'accorpamento_comune_storico', 1, false, null),
    ('BRENZONE', 'BRENZONE SUL GARDA', 'VR', 'rinomina_comune_storico', 1, false, null),
    ('CARBONARA DI PO', 'BORGOCARBONARA', 'MN', 'accorpamento_comune_storico', 1, false, null),
    ('CORIGLIANO CALABRO', 'CORIGLIANO-ROSSANO', 'CS', 'accorpamento_comune_storico', 1, false, null),
    ('MEGLIADINO SAN FIDENZIO', 'BORGO VENETO', 'PD', 'accorpamento_comune_storico', 2, false, null),
    ('SALETTO', 'BORGO VENETO', 'PD', 'accorpamento_comune_storico', 1, false, null),
    ('SANTA MARGHERITA D''ADIGE', 'BORGO VENETO', 'PD', 'accorpamento_comune_storico', 1, false, null),
    ('VIRGILIO', 'BORGO VIRGILIO', 'MN', 'accorpamento_comune_storico', 1, false, null),
    ('SAN PIETRO DI LEGNAGO', 'LEGNAGO', 'VR', 'frazione_o_toponimo', 2, false, null),
    ('SNA PIETRO DI LEGNAGO', 'LEGNAGO', 'VR', 'correzione_refuso', 1, false, null),
    ('ALBAREDO', 'ALBAREDO D''ADIGE', 'VR', 'denominazione_comune_incompleta', 1, false, null),
    ('BADOERE DI MORGANO', 'MORGANO', 'TV', 'frazione_o_toponimo', 1, false, null),
    ('BARUCHELLA', 'GIACCIANO CON BARUCHELLA', 'RO', 'frazione_o_toponimo', 1, false, null),
    ('BATORCOLO', 'LEGNAGO', 'VR', 'via_inserita_come_comune', 1, false, null),
    ('BONAVICINA', 'SAN PIETRO DI MORUBIO', 'VR', 'frazione_o_toponimo', 1, false, null),
    ('CHIESA NUOVA', 'BORGO VENETO', 'PD', 'frazione_o_toponimo', 1, false, null),
    ('MAREGA', 'BEVILACQUA', 'VR', 'frazione_o_toponimo', 1, false, null),
    ('SUSTINENZA', 'CASALEONE', 'VR', 'frazione_o_toponimo', 1, false, null),
    ('VALLESE', 'OPPEANO', 'VR', 'frazione_o_toponimo', 1, false, null),
    ('VILLA D''ADIGE', 'BADIA POLESINE', 'RO', 'frazione_o_toponimo', 1, false, null),
    ('EUROPA', 'MINERBE', 'VR', 'via_inserita_come_comune_verificata_internamente', 1, false, null),
    ('19', 'ROVERCHIARA', 'VR', 'campi_comune_civico_invertiti', 1, true, '19'),
    ('CAPITELLO', 'CONCAMARISE', 'VR', 'correzione_manual_utente', 1, false, null);

DO $check_mappature$
DECLARE
    r record;
    v_righe integer;
BEGIN
    FOR r IN SELECT * FROM bonifica_071_mappature ORDER BY comune_sorgente LOOP
        SELECT count(*)
        INTO v_righe
        FROM public.anagrafica a
        WHERE upper(trim(coalesce(a.comune, ''))) = r.comune_sorgente;

        IF v_righe <> r.righe_attese THEN
            RAISE EXCEPTION
                'Bonifica 071 annullata: comune % atteso %, trovato %',
                r.comune_sorgente, r.righe_attese, v_righe;
        END IF;
    END LOOP;
END
$check_mappature$;

CREATE TEMP TABLE bonifica_071_updates (
    id uuid PRIMARY KEY,
    comune_precedente text,
    provincia_precedente text,
    civico_precedente text,
    comune_nuovo text,
    provincia_nuova text,
    imposta_civico boolean NOT NULL DEFAULT false,
    civico_nuovo text,
    motivo text NOT NULL
) ON COMMIT DROP;

-- 1 riga: valore corretto ma formattazione non canonica.
WITH base AS (
    SELECT
        a.*,
        nullif(
            upper(
                regexp_replace(
                    trim(
                        replace(
                            replace(
                                replace(
                                    replace(
                                        replace(coalesce(a.comune, ''), '&#039;', ''''),
                                        '&apos;', ''''
                                    ),
                                    '’', ''''
                                ),
                                '‘', ''''
                            ),
                            '`', ''''
                        )
                    ),
                    '\s+', ' ', 'g'
                )
            ),
            ''
        ) AS comune_norm,
        nullif(upper(regexp_replace(trim(coalesce(a.provincia, '')), '\s+', '', 'g')), '') AS provincia_norm
    FROM public.anagrafica a
)
INSERT INTO bonifica_071_updates
    (id, comune_precedente, provincia_precedente, civico_precedente, comune_nuovo, provincia_nuova, motivo)
SELECT
    b.id,
    b.comune,
    b.provincia,
    b.civico,
    c.nome,
    c.provincia_sigla,
    'formato_istat'
FROM base b
JOIN public.mirox_comuni_istat c
  ON c.nome = b.comune_norm
 AND c.provincia_sigla = b.provincia_norm
WHERE b.comune IS DISTINCT FROM c.nome
   OR b.provincia IS DISTINCT FROM c.provincia_sigla;

-- 1.049 righe: nome ISTAT corrente e univoco, provincia assente, estesa oppure
-- non piu' valida. Le sigle correnti in conflitto vengono escluse.
WITH base AS (
    SELECT
        a.*,
        nullif(
            upper(
                regexp_replace(
                    trim(
                        replace(
                            replace(
                                replace(
                                    replace(
                                        replace(coalesce(a.comune, ''), '&#039;', ''''),
                                        '&apos;', ''''
                                    ),
                                    '’', ''''
                                ),
                                '‘', ''''
                            ),
                            '`', ''''
                        )
                    ),
                    '\s+', ' ', 'g'
                )
            ),
            ''
        ) AS comune_norm,
        nullif(upper(regexp_replace(trim(coalesce(a.provincia, '')), '\s+', '', 'g')), '') AS provincia_norm
    FROM public.anagrafica a
), catalogo_univoco AS (
    SELECT
        nome,
        min(provincia_sigla) AS provincia_sigla,
        min(provincia_nome) AS provincia_nome
    FROM public.mirox_comuni_istat
    GROUP BY nome
    HAVING count(*) = 1
)
INSERT INTO bonifica_071_updates
    (id, comune_precedente, provincia_precedente, civico_precedente, comune_nuovo, provincia_nuova, motivo)
SELECT
    b.id,
    b.comune,
    b.provincia,
    b.civico,
    c.nome,
    c.provincia_sigla,
    'provincia_da_catalogo_istat'
FROM base b
JOIN catalogo_univoco c ON c.nome = b.comune_norm
WHERE b.provincia_norm IS DISTINCT FROM c.provincia_sigla
  AND (
      b.provincia_norm IS NULL
      OR upper(regexp_replace(c.provincia_nome, '\s+', '', 'g')) = b.provincia_norm
      OR NOT EXISTS (
          SELECT 1
          FROM public.mirox_comuni_istat p
          WHERE p.provincia_sigla = b.provincia_norm
      )
  );

-- 42 righe: successioni storiche, frazioni/toponimi e CAPITELLO approvato.
INSERT INTO bonifica_071_updates
    (id, comune_precedente, provincia_precedente, civico_precedente, comune_nuovo, provincia_nuova, imposta_civico, civico_nuovo, motivo)
SELECT
    a.id,
    a.comune,
    a.provincia,
    a.civico,
    m.comune_destinazione,
    m.provincia_destinazione,
    m.imposta_civico,
    m.civico_destinazione,
    m.motivo
FROM public.anagrafica a
JOIN bonifica_071_mappature m
  ON upper(trim(coalesce(a.comune, ''))) = m.comune_sorgente;

-- 2 righe con storico collegato: la localita' errata viene rimossa senza
-- cancellare anagrafica, chiamate, pratica, contratto o documenti.
INSERT INTO bonifica_071_updates
    (id, comune_precedente, provincia_precedente, civico_precedente, comune_nuovo, provincia_nuova, motivo)
SELECT
    a.id,
    a.comune,
    a.provincia,
    a.civico,
    null,
    null,
    'localita_non_determinabile_con_storico_collegato'
FROM public.anagrafica a
WHERE (a.id = 'c502c5a2-0ebd-4e00-92b1-34ef8edb44d9'::uuid
       AND a.comune = '3397390920'
       AND a.provincia = 'VR')
   OR (a.id = 'aafa568f-898d-4306-a0ee-e7362c01ef3f'::uuid
       AND a.comune = 'FELICE CAVALLOTTI'
       AND a.provincia = 'VR');

DO $check_updates$
DECLARE
    v_formato integer;
    v_province integer;
    v_mappature integer;
    v_svuotate integer;
    v_totale integer;
BEGIN
    SELECT count(*) FILTER (WHERE motivo = 'formato_istat'),
           count(*) FILTER (WHERE motivo = 'provincia_da_catalogo_istat'),
           count(*) FILTER (WHERE motivo NOT IN (
               'formato_istat',
               'provincia_da_catalogo_istat',
               'localita_non_determinabile_con_storico_collegato'
           )),
           count(*) FILTER (WHERE motivo = 'localita_non_determinabile_con_storico_collegato'),
           count(*)
    INTO v_formato, v_province, v_mappature, v_svuotate, v_totale
    FROM bonifica_071_updates;

    IF v_formato <> 1
       OR v_province <> 1049
       OR v_mappature <> 42
       OR v_svuotate <> 2
       OR v_totale <> 1094 THEN
        RAISE EXCEPTION
            'Bonifica 071 annullata: conteggi update formato %, province %, mappature %, svuotate %, totale %',
            v_formato, v_province, v_mappature, v_svuotate, v_totale;
    END IF;
END
$check_updates$;

-- ALTEDO deve essere una sola riga, isolata da tutto lo storico CRM.
DO $check_delete$
DECLARE
    v_target uuid := '8c685507-624a-48ee-9e95-19485f180db7'::uuid;
    v_righe integer;
BEGIN
    SELECT count(*) INTO v_righe
    FROM public.anagrafica
    WHERE id = v_target
      AND comune = 'ALTEDO'
      AND provincia = 'CA';

    IF v_righe <> 1 THEN
        RAISE EXCEPTION 'Bonifica 071 annullata: target ALTEDO non corrisponde allo snapshot approvato';
    END IF;

    IF EXISTS (SELECT 1 FROM public.appuntamenti WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.call_center_lead_outbound_chiamate WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.chiamate WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.post_vendita_controllo_allarmi WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.post_vendita_controllo_assicurazioni WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.post_vendita_controllo_fissi WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.post_vendita_controllo_lg WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.post_vendita_dispositivi_comodato WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.post_vendita_gestione_rimborsi WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_apri_chiudi WHERE anagrafica_nuovo_id = v_target OR anagrafica_vecchio_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_consensi_privacy WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_consensi_privacy_v2 WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_contratti WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_documenti WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_ordini_smartphone WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_pratiche WHERE anagrafica_id = v_target)
       OR EXISTS (SELECT 1 FROM public.vendita_switch_sim WHERE anagrafica_attuale_id = v_target OR anagrafica_rientro_id = v_target) THEN
        RAISE EXCEPTION 'Bonifica 071 annullata: ALTEDO ha acquisito collegamenti CRM';
    END IF;
END
$check_delete$;

-- Blocca tutte le righe in ordine stabile e verifica che nessuna sia cambiata
-- dalla costruzione dello snapshot temporaneo.
DO $lock_targets$
BEGIN
    PERFORM 1
    FROM public.anagrafica a
    WHERE a.id IN (
        SELECT id FROM bonifica_071_updates
        UNION ALL
        SELECT '8c685507-624a-48ee-9e95-19485f180db7'::uuid
    )
    ORDER BY a.id
    FOR UPDATE;

    IF EXISTS (
        SELECT 1
        FROM bonifica_071_updates u
        JOIN public.anagrafica a ON a.id = u.id
        WHERE a.comune IS DISTINCT FROM u.comune_precedente
           OR a.provincia IS DISTINCT FROM u.provincia_precedente
           OR a.civico IS DISTINCT FROM u.civico_precedente
    ) THEN
        RAISE EXCEPTION 'Bonifica 071 annullata: una localita'' e'' cambiata durante la preparazione';
    END IF;
END
$lock_targets$;

INSERT INTO public.mirox_anagrafica_localita_audit
    (migration_key, anagrafica_id, operazione, motivo, valori_precedenti, valori_successivi)
SELECT
    '071_bonifica_localita_anagrafica',
    u.id,
    'update',
    u.motivo,
    jsonb_build_object(
        'comune', u.comune_precedente,
        'provincia', u.provincia_precedente,
        'civico', u.civico_precedente
    ),
    jsonb_build_object(
        'comune', u.comune_nuovo,
        'provincia', u.provincia_nuova,
        'civico', CASE WHEN u.imposta_civico THEN u.civico_nuovo ELSE u.civico_precedente END
    )
FROM bonifica_071_updates u
ORDER BY u.id;

INSERT INTO public.mirox_anagrafica_localita_audit
    (migration_key, anagrafica_id, operazione, motivo, valori_precedenti, valori_successivi, record_eliminato)
SELECT
    '071_bonifica_localita_anagrafica',
    a.id,
    'delete',
    'eliminazione_autorizzata_utente_senza_collegamenti',
    jsonb_build_object('comune', a.comune, 'provincia', a.provincia, 'civico', a.civico),
    null,
    to_jsonb(a)
FROM public.anagrafica a
WHERE a.id = '8c685507-624a-48ee-9e95-19485f180db7'::uuid;

UPDATE public.anagrafica a
SET comune = u.comune_nuovo,
    provincia = u.provincia_nuova,
    civico = CASE WHEN u.imposta_civico THEN u.civico_nuovo ELSE a.civico END
FROM bonifica_071_updates u
WHERE a.id = u.id;

DELETE FROM public.anagrafica
WHERE id = '8c685507-624a-48ee-9e95-19485f180db7'::uuid;

DO $verify$
DECLARE
    v_audit_update integer;
    v_audit_delete integer;
BEGIN
    SELECT count(*) FILTER (WHERE operazione = 'update'),
           count(*) FILTER (WHERE operazione = 'delete')
    INTO v_audit_update, v_audit_delete
    FROM public.mirox_anagrafica_localita_audit
    WHERE migration_key = '071_bonifica_localita_anagrafica';

    IF v_audit_update <> 1094 OR v_audit_delete <> 1 THEN
        RAISE EXCEPTION
            'Bonifica 071 annullata: audit update %, delete %',
            v_audit_update, v_audit_delete;
    END IF;

    IF EXISTS (
        SELECT 1
        FROM bonifica_071_updates u
        JOIN public.anagrafica a ON a.id = u.id
        WHERE a.comune IS DISTINCT FROM u.comune_nuovo
           OR a.provincia IS DISTINCT FROM u.provincia_nuova
           OR (u.imposta_civico AND a.civico IS DISTINCT FROM u.civico_nuovo)
    ) THEN
        RAISE EXCEPTION 'Bonifica 071 annullata: verifica finale update fallita';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.anagrafica
        WHERE id = '8c685507-624a-48ee-9e95-19485f180db7'::uuid
    ) THEN
        RAISE EXCEPTION 'Bonifica 071 annullata: eliminazione ALTEDO fallita';
    END IF;
END
$verify$;

COMMIT;
