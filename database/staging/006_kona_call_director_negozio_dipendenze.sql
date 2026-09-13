-- Staging 006 — dipendenze del calendario negozio per il collaudo KONA.
--
-- PROBLEMA RISOLTO (finding K1 dell'audit)
--   Il bootstrap `staging/003` ricostruisce solo nove dipendenze CRM e NON crea
--   `orari_standard`, `blocchi`, `slot_bloccati`, `impostazioni` ne' la funzione
--   `get_slot_disponibili`. Di conseguenza, sul progetto di test KONA:
--     * `kona-call-director-dialog` action `negozio_slot` / `negozio_prenota`
--     * `kona-call-director-task`  action `prenota_negozio`
--   falliscono con "function ... does not exist": lo schermo `negozio` (esito
--   Consumer "Appuntamento", parita' introdotta dalla migration 073) NON e'
--   collaudabile.
--
-- COSA FA
--   Ricrea in modo MINIMALE e idempotente le quattro tabelle di configurazione
--   del calendario e la funzione `get_slot_disponibili`, con orari lun-ven
--   09:00-12:30 / 15:30-19:00 compatibili con la configurazione KONA.
--
-- SICUREZZA
--   * Da applicare SOLO al progetto di test
--     "Mirox CRM - Test KONA Call Director" (`yyorullxmdxhnunsfwwa`).
--   * Il guard in testa interrompe l'esecuzione su qualunque altro database.
--   * NON tocca production: le tabelle sono create solo se assenti.

BEGIN;

DO $$
DECLARE
  v_comment text;
BEGIN
  SELECT obj_description('public'::regnamespace, 'pg_namespace') INTO v_comment;
  IF COALESCE(v_comment, '') NOT LIKE 'Schema minimo di test KONA Call Director:%' THEN
    RAISE EXCEPTION
      'Dipendenze negozio: il database non e'' lo staging dedicato KONA Call Director';
  END IF;
END $$;

-- =============================================================================
-- 1. Tabelle di configurazione del calendario (solo se assenti)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.impostazioni (
  chiave text PRIMARY KEY,
  valore text,
  descrizione text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.orari_standard (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  giorno smallint NOT NULL CHECK (giorno BETWEEN 1 AND 7),
  ora_inizio time NOT NULL,
  ora_fine time NOT NULL,
  attivo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.blocchi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('giornata', 'fascia')),
  data_inizio date NOT NULL,
  data_fine date NOT NULL,
  ora_inizio time,
  ora_fine time,
  motivo text
);

CREATE TABLE IF NOT EXISTS public.slot_bloccati (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_ora timestamptz NOT NULL,
  scadenza timestamptz NOT NULL,
  motivo text,
  creato_da uuid
);

-- =============================================================================
-- 2. Configurazione minima (solo se assente: non sovrascrive valori esistenti)
-- =============================================================================

INSERT INTO public.impostazioni (chiave, valore, descrizione) VALUES
  ('durata_slot', '15', 'Passo della griglia slot in minuti'),
  ('durata_appuntamento', '30', 'Durata predefinita di un appuntamento'),
  ('buffer_appuntamenti', '0', 'Minuti di margine fra due appuntamenti'),
  ('anticipo_minimo', '2', 'Ore minime di preavviso per prenotare'),
  ('anticipo_massimo', '60', 'Giorni massimi di anticipo per prenotare')
ON CONFLICT (chiave) DO NOTHING;

-- Lunedi'-venerdi', mattina e pomeriggio (stessi orari configurati in KONA).
INSERT INTO public.orari_standard (giorno, ora_inizio, ora_fine, attivo)
SELECT g.giorno, f.ora_inizio, f.ora_fine, true
FROM (VALUES (1), (2), (3), (4), (5)) AS g(giorno)
CROSS JOIN (VALUES (TIME '09:00', TIME '12:30'), (TIME '15:30', TIME '19:00')) AS f(ora_inizio, ora_fine)
WHERE NOT EXISTS (SELECT 1 FROM public.orari_standard o WHERE o.giorno = g.giorno);

-- =============================================================================
-- 3. get_slot_disponibili (copia fedele dalla baseline 069)
-- =============================================================================
-- Identica alla definizione di produzione: legge impostazioni, orari_standard,
-- blocchi, slot_bloccati e appuntamenti. SECURITY DEFINER come in produzione,
-- cosi' il comportamento collaudato e' lo stesso.

CREATE OR REPLACE FUNCTION public.get_slot_disponibili(p_data date) RETURNS timestamp with time zone[]
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_giorno SMALLINT;
    v_slots TIMESTAMPTZ[] := '{}';
    v_slot TIMESTAMP;
    v_slot_tz TIMESTAMPTZ;
    v_slot_fine TIMESTAMP;
    v_ora_corrente TIMESTAMPTZ;
    v_ora_minima TIMESTAMPTZ;
    v_ora_massima TIMESTAMPTZ;
    v_fascia RECORD;
    v_conflitto BOOLEAN;
    v_durata_slot INT;
    v_durata_appuntamento INT;
    v_buffer INT;
    v_anticipo_minimo INT;
    v_anticipo_massimo INT;
BEGIN
    SELECT COALESCE(valore::INT, 15) INTO v_durata_slot FROM impostazioni WHERE chiave = 'durata_slot';
    SELECT COALESCE(valore::INT, 30) INTO v_durata_appuntamento FROM impostazioni WHERE chiave = 'durata_appuntamento';
    SELECT COALESCE(valore::INT, 0) INTO v_buffer FROM impostazioni WHERE chiave = 'buffer_appuntamenti';
    SELECT COALESCE(valore::INT, 2) INTO v_anticipo_minimo FROM impostazioni WHERE chiave = 'anticipo_minimo';
    SELECT COALESCE(valore::INT, 60) INTO v_anticipo_massimo FROM impostazioni WHERE chiave = 'anticipo_massimo';

    v_giorno := EXTRACT(ISODOW FROM p_data);
    v_ora_corrente := NOW();
    v_ora_minima := v_ora_corrente + (v_anticipo_minimo || ' hours')::INTERVAL;
    v_ora_massima := v_ora_corrente + (v_anticipo_massimo || ' days')::INTERVAL;

    IF EXISTS (
        SELECT 1 FROM blocchi
        WHERE tipo = 'giornata'
        AND p_data BETWEEN data_inizio AND data_fine
    ) THEN
        RETURN v_slots;
    END IF;

    FOR v_fascia IN
        SELECT ora_inizio, ora_fine FROM orari_standard
        WHERE giorno = v_giorno AND attivo = true
        ORDER BY ora_inizio
    LOOP
        v_slot := p_data + v_fascia.ora_inizio;

        WHILE v_slot + (v_durata_appuntamento || ' minutes')::INTERVAL <= (p_data + v_fascia.ora_fine) LOOP
            v_slot_fine := v_slot + (v_durata_appuntamento || ' minutes')::INTERVAL;
            v_slot_tz := (v_slot::TEXT || ' Europe/Rome')::TIMESTAMPTZ;

            IF v_slot_tz >= v_ora_minima AND v_slot_tz <= v_ora_massima THEN
                v_conflitto := false;

                IF EXISTS (
                    SELECT 1 FROM appuntamenti
                    WHERE stato = 'confermato'
                    AND data_ora < (v_slot_fine::TEXT || ' Europe/Rome')::TIMESTAMPTZ + (v_buffer || ' minutes')::INTERVAL
                    AND data_ora + (durata_minuti || ' minutes')::INTERVAL + (v_buffer || ' minutes')::INTERVAL > v_slot_tz
                ) THEN
                    v_conflitto := true;
                END IF;

                IF NOT v_conflitto AND EXISTS (
                    SELECT 1 FROM blocchi
                    WHERE tipo = 'fascia'
                    AND p_data BETWEEN data_inizio AND data_fine
                    AND (p_data + ora_inizio) < v_slot_fine
                    AND (p_data + ora_fine) > v_slot
                ) THEN
                    v_conflitto := true;
                END IF;

                IF NOT v_conflitto AND EXISTS (
                    SELECT 1 FROM slot_bloccati
                    WHERE data_ora = v_slot_tz AND scadenza > NOW()
                ) THEN
                    v_conflitto := true;
                END IF;

                IF NOT v_conflitto THEN
                    v_slots := array_append(v_slots, v_slot_tz);
                END IF;
            END IF;

            v_slot := v_slot + (v_durata_slot || ' minutes')::INTERVAL;
        END LOOP;
    END LOOP;

    RETURN v_slots;
END;
$$;

-- La funzione e' chiamata dalle Netlify function con service role; il form
-- pubblico usa `public-prenota` (sempre service role). Nessun accesso browser.
REVOKE ALL ON FUNCTION public.get_slot_disponibili(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slot_disponibili(date) TO service_role, authenticated;

COMMIT;
