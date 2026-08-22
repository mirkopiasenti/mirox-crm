-- =============================================================================
-- 069_baseline_allineamento.sql
-- Baseline di allineamento dello schema "public" di produzione (Mirox).
--
-- Generata da pg_dump dello schema live (Postgres 17.6) il 2026-08-22.
-- Recupera il drift accumulato quando le prime modifiche venivano eseguite
-- direttamente dall'SQL Editor senza essere tracciate in file.
--
-- Contiene SOLO gli oggetti presenti nel DB live ma ASSENTI dalle migrazioni
-- 001..068. Applicata su un database pulito DOPO 001..068 riproduce lo stato
-- attuale di produzione.
--
-- USO:
--  - Database pulito (staging/dev/CI): applicare 001..068 poi questo file.
--  - Produzione: NON applicare (gli oggetti esistono gia'); il file serve come
--    documentazione/tracciabilita' del drift recuperato. Da questo punto in poi
--    tracciare ogni modifica con nuovi file 070, 071, ...
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SEQUENZE (nuove: 1)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE public.segnalazioni_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


-- ---------------------------------------------------------------------------
-- FUNCTION (nuove: 32)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.calcola_giorni_risoluzione(rec public.segnalazioni) RETURNS integer
    LANGUAGE sql STABLE
    AS $$
    SELECT CASE
        WHEN rec.azione_eseguita = 'ASK'
             AND rec.data_chiusura IS NOT NULL
             AND rec.data_apertura_segnalazione IS NOT NULL
        THEN EXTRACT(DAY FROM rec.data_chiusura - rec.data_apertura_segnalazione)::INTEGER
        ELSE NULL
    END;
$$;

CREATE FUNCTION public.calcola_ricontatto_non_risposto() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    ora_chiamata INT;
BEGIN
    -- Se la chiamata è già marcata come completata (es. da rilavorazione), non toccare nulla
    IF NEW.rilavorazione_stato = 'completato' THEN
        RETURN NEW;
    END IF;

    IF NEW.esito = 'non_risposto' AND NEW.data_ricontatto IS NULL THEN
        ora_chiamata := EXTRACT(HOUR FROM NEW.data_ora AT TIME ZONE 'Europe/Rome');
        
        IF ora_chiamata >= 8 AND ora_chiamata < 13 THEN
            NEW.data_ricontatto := (NEW.data_ora AT TIME ZONE 'Europe/Rome')::DATE;
            NEW.fascia_ricontatto := 'Pomeriggio';
        ELSE
            NEW.data_ricontatto := ((NEW.data_ora AT TIME ZONE 'Europe/Rome')::DATE + INTERVAL '1 day')::DATE;
            NEW.fascia_ricontatto := 'Mattina';
        END IF;
        
        NEW.rilavorazione_stato := 'da_lavorare';
    END IF;
    
    IF NEW.esito = 'passa_in_negozio' THEN
        NEW.passaggio_stato := 'in_attesa';
        NEW.passaggio_data_scadenza := (NEW.data_ora AT TIME ZONE 'Europe/Rome')::DATE + INTERVAL '5 days';
        NEW.rilavorazione_stato := 'da_lavorare';
    END IF;
    
    IF NEW.esito = 'ricontattare' THEN
        NEW.rilavorazione_stato := 'da_lavorare';
    END IF;
    
    IF NEW.esito = 'non_interessato' THEN
        NEW.rilavorazione_stato := 'non_applicabile';
    END IF;
    
    IF NEW.esito = 'appuntamento' THEN
        NEW.rilavorazione_stato := 'completato';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.calcola_ricontatto_non_risposto_outbound() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    ora_chiamata INT;
BEGIN
    -- Se già completata, non toccare
    IF NEW.rilavorazione_stato = 'completato' THEN
        RETURN NEW;
    END IF;

    IF NEW.esito = 'non_risposto' AND NEW.data_ricontatto IS NULL THEN
        ora_chiamata := EXTRACT(HOUR FROM NEW.data_ora AT TIME ZONE 'Europe/Rome');
        
        IF ora_chiamata >= 8 AND ora_chiamata < 13 THEN
            NEW.data_ricontatto := (NEW.data_ora AT TIME ZONE 'Europe/Rome')::DATE;
            NEW.fascia_ricontatto := 'Pomeriggio';
        ELSE
            NEW.data_ricontatto := ((NEW.data_ora AT TIME ZONE 'Europe/Rome')::DATE + INTERVAL '1 day')::DATE;
            NEW.fascia_ricontatto := 'Mattina';
        END IF;
        
        NEW.rilavorazione_stato := 'da_lavorare';
    END IF;
    
    IF NEW.esito = 'ricontattare' THEN
        NEW.rilavorazione_stato := 'da_lavorare';
    END IF;
    
    IF NEW.esito = 'non_interessato' THEN
        NEW.rilavorazione_stato := 'non_applicabile';
    END IF;
    
    IF NEW.esito = 'appuntamento' THEN
        NEW.rilavorazione_stato := 'completato';
    END IF;
    
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.chiudi_appuntamenti_giornata() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    UPDATE appuntamenti 
    SET presentato = 'no', 
        non_presentato_stato = 'da_lavorare'
    WHERE stato = 'confermato' 
    AND presentato IS NULL 
    AND data_ora < (NOW() AT TIME ZONE 'Europe/Rome')::date + INTERVAL '1 day';
END;
$$;

CREATE FUNCTION public.crm_call_center_lead_outbound_chiamate_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;

CREATE FUNCTION public.crm_can_access_page(pagina_key text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    select exists (
        select 1
        from public.profili p
        where p.id = auth.uid()
          and p.attivo = true
          and (
              p.ruolo = 'admin'
              or coalesce((p.pagine_accessibili ->> pagina_key)::boolean, false) = true
          )
    );
$$;

CREATE FUNCTION public.crm_cclobc_default_rilavorazione_stato() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if new.rilavorazione_stato is null or btrim(new.rilavorazione_stato) = '' then
        if new.esito in ('non_risposto', 'ricontattare') then
            new.rilavorazione_stato := 'da_lavorare';
        else
            new.rilavorazione_stato := 'completato';
        end if;
    end if;

    return new;
end;
$$;

CREATE FUNCTION public.crm_detect_phone_type(phone_norm text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select case
        when phone_norm is null or phone_norm = '' then 'sconosciuto'
        when left(phone_norm, 1) = '0' then 'fisso'
        when left(phone_norm, 1) = '3' then 'mobile'
        else 'sconosciuto'
    end;
$$;

CREATE FUNCTION public.crm_import_call_center_lead_outbound_batch(p_import_id uuid, p_rows jsonb) RETURNS TABLE(total_rows integer, valid_rows integer, inserted_rows integer, duplicate_rows integer)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
    row_item jsonb;
    v_total integer := 0;
    v_valid integer := 0;
    v_inserted integer := 0;
    v_duplicate integer := 0;

    v_ragione_sociale text;
    v_indirizzo text;
    v_cap text;
    v_localita text;
    v_provincia text;
    v_regione text;
    v_nazione text;
    v_telefono_raw text;
    v_email text;
    v_sito text;
    v_categoria text;
    v_zona text;
    v_piva text;
    v_cf text;

    v_ragione_sociale_norm text;
    v_indirizzo_norm text;
    v_localita_norm text;
    v_telefono_norm text;
    v_telefono_tipo text;
    v_email_norm text;
    v_dominio_norm text;
    v_piva_norm text;
    v_cf_norm text;
    v_dedupe_strategy text;
    v_dedupe_key text;

    v_existing_id uuid;
begin
    if not public.crm_can_access_page('call_center_lead_outbound') then
        raise exception 'Utente non autorizzato per il modulo call_center_lead_outbound';
    end if;

    if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
        raise exception 'p_rows deve essere un array JSON';
    end if;

    for row_item in select value from jsonb_array_elements(p_rows)
    loop
        v_total := v_total + 1;

        v_ragione_sociale := nullif(trim(coalesce(row_item->>'ragione_sociale', '')), '');
        v_indirizzo := nullif(trim(coalesce(row_item->>'indirizzo', '')), '');
        v_cap := nullif(trim(coalesce(row_item->>'cap', '')), '');
        v_localita := nullif(trim(coalesce(row_item->>'localita', '')), '');
        v_provincia := nullif(trim(coalesce(row_item->>'provincia', '')), '');
        v_regione := nullif(trim(coalesce(row_item->>'regione', '')), '');
        v_nazione := nullif(trim(coalesce(row_item->>'nazione', '')), '');
        v_telefono_raw := nullif(trim(coalesce(row_item->>'telefono_raw', '')), '');
        v_email := nullif(trim(coalesce(row_item->>'email', '')), '');
        v_sito := nullif(trim(coalesce(row_item->>'sito_internet', '')), '');
        v_categoria := nullif(trim(coalesce(row_item->>'categoria', '')), '');
        v_zona := nullif(trim(coalesce(row_item->>'zona', '')), '');
        v_piva := nullif(trim(coalesce(row_item->>'partita_iva', '')), '');
        v_cf := nullif(trim(coalesce(row_item->>'codice_fiscale', '')), '');

        v_ragione_sociale_norm := public.crm_normalize_company_name(v_ragione_sociale);
        v_indirizzo_norm := public.crm_normalize_text(v_indirizzo);
        v_localita_norm := public.crm_normalize_text(v_localita);
        v_telefono_norm := public.crm_normalize_phone(v_telefono_raw);
        v_telefono_tipo := public.crm_detect_phone_type(v_telefono_norm);
        v_email_norm := public.crm_normalize_email(v_email);
        v_dominio_norm := public.crm_normalize_domain(v_sito);
        v_piva_norm := case when v_piva is null then null else regexp_replace(v_piva, '\D', '', 'g') end;
        v_cf_norm := public.crm_normalize_text(v_cf);

        select dedupe_strategy, dedupe_key
        into v_dedupe_strategy, v_dedupe_key
        from public.crm_make_call_center_lead_outbound_dedupe_key(
            v_piva,
            v_telefono_raw,
            v_ragione_sociale,
            v_indirizzo,
            v_localita,
            v_email,
            v_sito
        );

        if v_ragione_sociale is null then
            continue;
        end if;

        v_valid := v_valid + 1;

        select id
        into v_existing_id
        from public.call_center_lead_outbound
        where dedupe_key = v_dedupe_key
        limit 1;

        if v_existing_id is null then
            insert into public.call_center_lead_outbound (
                import_id,
                ragione_sociale,
                ragione_sociale_norm,
                indirizzo,
                indirizzo_norm,
                cap,
                localita,
                localita_norm,
                provincia,
                regione,
                nazione,
                telefono_raw,
                telefono_norm,
                telefono_tipo,
                email,
                email_norm,
                sito_internet,
                dominio_norm,
                categoria,
                zona,
                partita_iva,
                partita_iva_norm,
                codice_fiscale,
                codice_fiscale_norm,
                stato_lead,
                dedupe_strategy,
                dedupe_key,
                created_by,
                updated_by
            ) values (
                p_import_id,
                v_ragione_sociale,
                coalesce(v_ragione_sociale_norm, public.crm_normalize_text(v_ragione_sociale)),
                v_indirizzo,
                v_indirizzo_norm,
                v_cap,
                v_localita,
                v_localita_norm,
                v_provincia,
                v_regione,
                coalesce(v_nazione, 'Italia'),
                v_telefono_raw,
                v_telefono_norm,
                v_telefono_tipo,
                v_email,
                v_email_norm,
                v_sito,
                v_dominio_norm,
                v_categoria,
                v_zona,
                v_piva,
                v_piva_norm,
                v_cf,
                v_cf_norm,
                'nuovo',
                v_dedupe_strategy,
                v_dedupe_key,
                auth.uid(),
                auth.uid()
            );

            v_inserted := v_inserted + 1;
        else
            update public.call_center_lead_outbound
            set
                import_id = p_import_id,
                indirizzo = coalesce(nullif(indirizzo, ''), v_indirizzo),
                indirizzo_norm = coalesce(nullif(indirizzo_norm, ''), v_indirizzo_norm),
                cap = coalesce(nullif(cap, ''), v_cap),
                localita = coalesce(nullif(localita, ''), v_localita),
                localita_norm = coalesce(nullif(localita_norm, ''), v_localita_norm),
                provincia = coalesce(nullif(provincia, ''), v_provincia),
                regione = coalesce(nullif(regione, ''), v_regione),
                nazione = coalesce(nullif(nazione, ''), v_nazione),
                telefono_raw = coalesce(nullif(telefono_raw, ''), v_telefono_raw),
                telefono_norm = coalesce(nullif(telefono_norm, ''), v_telefono_norm),
                telefono_tipo = case
                    when coalesce(nullif(telefono_norm, ''), v_telefono_norm) is null then telefono_tipo
                    else coalesce(nullif(telefono_tipo, ''), v_telefono_tipo)
                end,
                email = coalesce(nullif(email, ''), v_email),
                email_norm = coalesce(nullif(email_norm, ''), v_email_norm),
                sito_internet = coalesce(nullif(sito_internet, ''), v_sito),
                dominio_norm = coalesce(nullif(dominio_norm, ''), v_dominio_norm),
                categoria = coalesce(nullif(categoria, ''), v_categoria),
                zona = coalesce(nullif(zona, ''), v_zona),
                partita_iva = coalesce(nullif(partita_iva, ''), v_piva),
                partita_iva_norm = coalesce(nullif(partita_iva_norm, ''), v_piva_norm),
                codice_fiscale = coalesce(nullif(codice_fiscale, ''), v_cf),
                codice_fiscale_norm = coalesce(nullif(codice_fiscale_norm, ''), v_cf_norm),
                times_seen = coalesce(times_seen, 0) + 1,
                last_import_at = now(),
                updated_by = auth.uid()
            where id = v_existing_id;

            v_duplicate := v_duplicate + 1;
        end if;
    end loop;

    update public.call_center_lead_outbound_import
    set
        totale_righe = v_total,
        righe_valide = v_valid,
        righe_importate = v_inserted,
        righe_duplicate_scartate = v_duplicate
    where id = p_import_id;

    return query
    select v_total, v_valid, v_inserted, v_duplicate;
end;
$$;

CREATE FUNCTION public.crm_is_directory_domain(input_text text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $$
    select coalesce(public.crm_normalize_domain(input_text), '') similar to '%(facebook\.com|instagram\.com|tripadvisor\.|thefork\.|justeat\.|glovoapp\.|cylex\.|paginegialle\.|paginebianche\.|yelp\.)%';
$$;

CREATE FUNCTION public.crm_make_call_center_lead_outbound_dedupe_key(p_partita_iva text, p_telefono text, p_ragione_sociale text, p_indirizzo text, p_localita text, p_email text, p_sito text, OUT dedupe_strategy text, OUT dedupe_key text) RETURNS record
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
    v_piva text := public.crm_normalize_text(p_partita_iva);
    v_tel text := public.crm_normalize_phone(p_telefono);
    v_nome text := public.crm_normalize_company_name(p_ragione_sociale);
    v_ind text := public.crm_normalize_text(p_indirizzo);
    v_loc text := public.crm_normalize_text(p_localita);
    v_email text := public.crm_normalize_email(p_email);
    v_sito text := public.crm_normalize_domain(p_sito);
begin
    if v_piva is not null and length(regexp_replace(v_piva, '\D', '', 'g')) = 11 then
        dedupe_strategy := 'piva';
        dedupe_key := 'piva:' || regexp_replace(v_piva, '\D', '', 'g');
        return;
    end if;

    if v_tel is not null and v_nome is not null then
        dedupe_strategy := 'telefono_nome';
        dedupe_key := 'telefono_nome:' || v_tel || '|' || v_nome;
        return;
    end if;

    if v_nome is not null and v_ind is not null and v_loc is not null then
        dedupe_strategy := 'nome_indirizzo_localita';
        dedupe_key := 'nome_indirizzo_localita:' || v_nome || '|' || v_ind || '|' || v_loc;
        return;
    end if;

    if v_email is not null and v_nome is not null and not public.crm_is_directory_domain(v_email) then
        dedupe_strategy := 'email_nome';
        dedupe_key := 'email_nome:' || v_email || '|' || v_nome;
        return;
    end if;

    if v_sito is not null and v_nome is not null and not public.crm_is_directory_domain(v_sito) then
        dedupe_strategy := 'sito_nome';
        dedupe_key := 'sito_nome:' || v_sito || '|' || v_nome;
        return;
    end if;

    dedupe_strategy := 'fallback';
    dedupe_key := 'fallback:' || md5(
        coalesce(v_nome, '') || '|' ||
        coalesce(v_ind, '') || '|' ||
        coalesce(v_loc, '') || '|' ||
        coalesce(v_tel, '') || '|' ||
        coalesce(v_email, '')
    );
end;
$$;

CREATE FUNCTION public.crm_normalize_company_name(input_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select nullif(
        trim(
            regexp_replace(
                regexp_replace(
                    regexp_replace(
                        lower(unaccent(coalesce(input_text, ''))),
                        '\m(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|societa cooperativa|cooperativa|coop|ditta individuale|impresa individuale)\M',
                        ' ',
                        'gi'
                    ),
                    '[^a-z0-9]+',
                    ' ',
                    'g'
                ),
                '\s+',
                ' ',
                'g'
            )
        ),
        ''
    );
$$;

CREATE FUNCTION public.crm_normalize_domain(input_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select nullif(
        regexp_replace(
            regexp_replace(
                lower(trim(coalesce(input_text, ''))),
                '^https?://',
                ''
            ),
            '^www\.',
            ''
        ),
        ''
    );
$$;

CREATE FUNCTION public.crm_normalize_email(input_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select nullif(lower(trim(coalesce(input_text, ''))), '');
$$;

CREATE FUNCTION public.crm_normalize_phone(input_text text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
    digits text;
    rest   text;
begin
    digits := regexp_replace(coalesce(input_text, ''), '\D', '', 'g');

    if digits = '' then
        return null;
    end if;

    -- Se arriva con prefisso internazionale italiano, lo togliamo
    -- ma conserviamo l'eventuale zero iniziale del fisso (es. +39 0442... -> 0442...)
    if left(digits, 4) = '0039' then
        digits := substr(digits, 5);
    elsif left(digits, 2) = '39' and length(digits) >= 11 then
        rest := substr(digits, 3);
        if left(rest, 1) in ('0', '3') then
            digits := rest;
        end if;
    end if;

    return digits;
end;
$$;

CREATE FUNCTION public.crm_normalize_text(input_text text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
    select nullif(
        trim(
            regexp_replace(
                lower(unaccent(coalesce(input_text, ''))),
                '[^a-z0-9]+',
                ' ',
                'g'
            )
        ),
        ''
    );
$$;

CREATE FUNCTION public.crm_prepare_call_center_lead_outbound_row() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    v_dedupe_strategy text;
    v_dedupe_key text;
begin
    new.ragione_sociale := nullif(trim(coalesce(new.ragione_sociale, '')), '');
    new.indirizzo := nullif(trim(coalesce(new.indirizzo, '')), '');
    new.cap := nullif(trim(coalesce(new.cap, '')), '');
    new.localita := nullif(trim(coalesce(new.localita, '')), '');
    new.provincia := nullif(trim(coalesce(new.provincia, '')), '');
    new.regione := nullif(trim(coalesce(new.regione, '')), '');
    new.nazione := coalesce(nullif(trim(coalesce(new.nazione, '')), ''), 'Italia');
    new.telefono_raw := nullif(trim(coalesce(new.telefono_raw, '')), '');
    new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
    new.sito_internet := nullif(trim(coalesce(new.sito_internet, '')), '');
    new.categoria := nullif(trim(coalesce(new.categoria, '')), '');
    new.zona := nullif(trim(coalesce(new.zona, '')), '');
    new.partita_iva := nullif(trim(coalesce(new.partita_iva, '')), '');
    new.codice_fiscale := nullif(trim(coalesce(new.codice_fiscale, '')), '');

    if new.ragione_sociale is null then
        raise exception 'ragione_sociale obbligatoria';
    end if;

    new.ragione_sociale_norm := coalesce(
        public.crm_normalize_company_name(new.ragione_sociale),
        public.crm_normalize_text(new.ragione_sociale)
    );
    new.indirizzo_norm := public.crm_normalize_text(new.indirizzo);
    new.localita_norm := public.crm_normalize_text(new.localita);
    new.telefono_norm := public.crm_normalize_phone(new.telefono_raw);
    new.telefono_tipo := public.crm_detect_phone_type(new.telefono_norm);
    new.email_norm := public.crm_normalize_email(new.email);
    new.dominio_norm := public.crm_normalize_domain(new.sito_internet);
    new.partita_iva_norm := case
        when new.partita_iva is null then null
        else nullif(regexp_replace(new.partita_iva, '\D', '', 'g'), '')
    end;
    new.codice_fiscale_norm := public.crm_normalize_text(new.codice_fiscale);

    select dedupe_strategy, dedupe_key
    into v_dedupe_strategy, v_dedupe_key
    from public.crm_make_call_center_lead_outbound_dedupe_key(
        new.partita_iva,
        new.telefono_raw,
        new.ragione_sociale,
        new.indirizzo,
        new.localita,
        new.email,
        new.sito_internet
    );

    new.dedupe_strategy := v_dedupe_strategy;
    new.dedupe_key := v_dedupe_key;

    if tg_op = 'INSERT' then
        new.created_at := coalesce(new.created_at, now());
        new.first_import_at := coalesce(new.first_import_at, now());
        new.last_import_at := coalesce(new.last_import_at, new.first_import_at, now());
        new.created_by := coalesce(new.created_by, auth.uid());
        new.updated_by := coalesce(new.updated_by, auth.uid());
        new.times_seen := greatest(coalesce(new.times_seen, 1), 1);
    else
        new.updated_by := coalesce(auth.uid(), new.updated_by);
        new.last_import_at := coalesce(new.last_import_at, old.last_import_at);
        new.times_seen := greatest(coalesce(new.times_seen, old.times_seen, 1), 1);
        new.first_import_at := coalesce(new.first_import_at, old.first_import_at, now());
    end if;

    return new;
end;
$$;

CREATE FUNCTION public.crm_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    new.updated_at := now();
    return new;
end;
$$;

CREATE FUNCTION public.get_disponibilita_mese(p_anno integer, p_mese integer) RETURNS TABLE(data_giorno date, stato text)
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_data DATE;
    v_primo_giorno DATE;
    v_ultimo_giorno DATE;
    v_giorno SMALLINT;
    v_slots TIMESTAMPTZ[];
    v_durata_slot INT;
    v_durata_app INT;
    v_buffer INT;
    v_anticipo_min INT;
    v_anticipo_max INT;
BEGIN
    -- Leggi impostazioni (una sola volta per tutto il mese!)
    SELECT COALESCE(valore::INT, 15) INTO v_durata_slot FROM impostazioni WHERE chiave = 'durata_slot';
    SELECT COALESCE(valore::INT, 30) INTO v_durata_app FROM impostazioni WHERE chiave = 'durata_appuntamento';
    SELECT COALESCE(valore::INT, 0) INTO v_buffer FROM impostazioni WHERE chiave = 'buffer_appuntamenti';
    SELECT COALESCE(valore::INT, 2) INTO v_anticipo_min FROM impostazioni WHERE chiave = 'anticipo_minimo';
    SELECT COALESCE(valore::INT, 60) INTO v_anticipo_max FROM impostazioni WHERE chiave = 'anticipo_massimo';
    
    v_primo_giorno := make_date(p_anno, p_mese, 1);
    v_ultimo_giorno := (v_primo_giorno + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
    
    v_data := v_primo_giorno;
    WHILE v_data <= v_ultimo_giorno LOOP
        v_giorno := EXTRACT(ISODOW FROM v_data);
        
        -- Domenica (7) o nessun orario attivo per questo giorno
        IF v_giorno = 7 OR NOT EXISTS (
            SELECT 1 FROM orari_standard WHERE giorno = v_giorno AND attivo = true
        ) THEN
            data_giorno := v_data;
            stato := 'closed';
            RETURN NEXT;
        -- Blocco giornata intera
        ELSIF EXISTS (
            SELECT 1 FROM blocchi WHERE tipo = 'giornata' AND v_data BETWEEN data_inizio AND data_fine
        ) THEN
            data_giorno := v_data;
            stato := 'closed';
            RETURN NEXT;
        ELSE
            -- Calcola slot disponibili
            v_slots := get_slot_disponibili(v_data, v_durata_slot, v_durata_app, v_buffer, v_anticipo_min, v_anticipo_max);
            
            data_giorno := v_data;
            IF array_length(v_slots, 1) > 0 THEN
                stato := 'available';
            ELSE
                stato := 'full';
            END IF;
            RETURN NEXT;
        END IF;
        
        v_data := v_data + INTERVAL '1 day';
    END LOOP;
END;
$$;

CREATE FUNCTION public.get_slot_disponibili(p_data date) RETURNS timestamp with time zone[]
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

CREATE FUNCTION public.has_page_access(p_pagina text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profili 
        WHERE id = auth.uid() 
        AND attivo = true
        AND (
            ruolo = 'admin' 
            OR (pagine_accessibili->>p_pagina)::BOOLEAN = true
        )
    );
END;
$$;

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM profili 
        WHERE id = auth.uid() AND ruolo = 'admin' AND attivo = true
    );
END;
$$;

CREATE FUNCTION public.pulisci_slot_scaduti() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
    deleted_count INT;
BEGIN
    DELETE FROM slot_bloccati WHERE scadenza <= NOW();
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

CREATE FUNCTION public.rls_auto_enable() RETURNS event_trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.set_default_permissions() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF NEW.ruolo = 'admin' THEN
        NEW.pagine_accessibili = '{
            "registra_chiamata": true,
            "elenco_chiamate": true,
            "rilavorazione": true,
            "appuntamenti": true,
            "appuntamenti_oggi": true,
            "esiti_appuntamenti": true,
            "blacklist": true,
            "configurazione": true,
            "prenota_interno": true
        }'::jsonb;
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_data_ultima_modifica() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.data_ultima_modifica = NOW();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.vcp_audit_no_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'vendita_consensi_privacy_audit e append-only: DELETE non consentito (id=%)', OLD.id;
END;
$$;

CREATE FUNCTION public.vcp_audit_no_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'vendita_consensi_privacy_audit e append-only: UPDATE non consentito (id=%)', OLD.id;
END;
$$;

CREATE FUNCTION public.vendita_calcola_punteggio_totale() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.punteggio_gara_totale =
        coalesce(NEW.punteggio_gara_offerta, 0) +
        coalesce(NEW.punteggio_gara_opzione, 0);

    NEW.punteggio_extra_gara_totale =
        coalesce(NEW.punteggio_extra_gara_offerta, 0) +
        coalesce(NEW.punteggio_extra_gara_opzione, 0);

    NEW.punteggio_offerta = coalesce(NEW.punteggio_gara_offerta, 0);
    NEW.punteggio_opzione = coalesce(NEW.punteggio_gara_opzione, 0);
    NEW.punteggio_extra = 0;

    NEW.punteggio_totale = NEW.punteggio_gara_totale;

    RETURN NEW;
END;
$$;

CREATE FUNCTION public.vendita_consensi_privacy_v2_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    IF NEW.stato IS DISTINCT FROM OLD.stato THEN
        NEW.stato_cambiato_at = now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION public.vendita_update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- TABELLE (nuove: 18)
-- ---------------------------------------------------------------------------
CREATE TABLE public.anagrafica (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cf_piva text NOT NULL,
    cluster text,
    ragione_sociale text,
    nome_referente text,
    cellulare text,
    provincia text,
    comune text,
    via text,
    civico text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    creato_da uuid,
    email text,
    CONSTRAINT anagrafica_cluster_check CHECK ((cluster = ANY (ARRAY['Consumer'::text, 'Business'::text])))
);

CREATE TABLE public.appuntamenti (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nome text NOT NULL,
    codice_fiscale text,
    telefono text NOT NULL,
    motivo text NOT NULL,
    note text,
    anagrafica_id uuid,
    fissato_da_operatore_id uuid,
    fissato_da_nome text,
    chiamata_id uuid,
    data_ora timestamp with time zone NOT NULL,
    durata_minuti integer DEFAULT 30 NOT NULL,
    fonte text DEFAULT 'interno'::text NOT NULL,
    stato text DEFAULT 'confermato'::text NOT NULL,
    motivo_modifica text,
    rischedulato_in_id uuid,
    originato_da_id uuid,
    presentato text,
    presentato_at timestamp with time zone,
    esito_finale text,
    dettagli_esito text,
    esitato_at timestamp with time zone,
    non_presentato_stato text,
    storico jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    lead_outbound_id uuid,
    chiamata_outbound_id uuid,
    CONSTRAINT appuntamenti_esito_finale_check CHECK ((esito_finale = ANY (ARRAY['vinta'::text, 'persa'::text]))),
    CONSTRAINT appuntamenti_fonte_check CHECK ((fonte = ANY (ARRAY['pubblico'::text, 'interno'::text]))),
    CONSTRAINT appuntamenti_non_presentato_stato_check CHECK ((non_presentato_stato = ANY (ARRAY['da_lavorare'::text, 'presentato'::text, 'lavorato'::text]))),
    CONSTRAINT appuntamenti_presentato_check CHECK ((presentato = ANY (ARRAY['si'::text, 'no'::text]))),
    CONSTRAINT appuntamenti_stato_check CHECK ((stato = ANY (ARRAY['confermato'::text, 'rischedulato'::text, 'annullato'::text])))
);

CREATE TABLE public.blacklist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cf_piva text NOT NULL,
    nome_cognome text,
    cellulare text,
    motivo text,
    inserito_da uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.blocchi (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tipo text NOT NULL,
    data_inizio date NOT NULL,
    data_fine date NOT NULL,
    ora_inizio time without time zone,
    ora_fine time without time zone,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    creato_da uuid,
    CONSTRAINT blocchi_tipo_check CHECK ((tipo = ANY (ARRAY['giornata'::text, 'fascia'::text])))
);

CREATE TABLE public.call_center_lead_outbound (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    import_id uuid,
    ragione_sociale text NOT NULL,
    ragione_sociale_norm text NOT NULL,
    indirizzo text,
    indirizzo_norm text,
    cap text,
    localita text,
    localita_norm text,
    provincia text,
    regione text,
    nazione text,
    telefono_raw text,
    telefono_norm text,
    telefono_tipo text DEFAULT 'sconosciuto'::text NOT NULL,
    email text,
    email_norm text,
    sito_internet text,
    dominio_norm text,
    categoria text,
    zona text,
    partita_iva text,
    partita_iva_norm text,
    codice_fiscale text,
    codice_fiscale_norm text,
    stato_lead text DEFAULT 'nuovo'::text NOT NULL,
    assegnato_a uuid,
    ultimo_contatto_at timestamp with time zone,
    prossimo_followup_at timestamp with time zone,
    note_ultima text,
    pinned boolean DEFAULT false NOT NULL,
    do_not_call boolean DEFAULT false NOT NULL,
    times_seen integer DEFAULT 1 NOT NULL,
    first_import_at timestamp with time zone DEFAULT now() NOT NULL,
    last_import_at timestamp with time zone DEFAULT now() NOT NULL,
    dedupe_strategy text NOT NULL,
    dedupe_key text NOT NULL,
    created_by uuid DEFAULT auth.uid(),
    updated_by uuid DEFAULT auth.uid(),
    CONSTRAINT call_center_lead_outbound_telefono_tipo_check CHECK ((telefono_tipo = ANY (ARRAY['fisso'::text, 'mobile'::text, 'sconosciuto'::text])))
);

CREATE TABLE public.call_center_lead_outbound_attivita (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    lead_id uuid NOT NULL,
    tipo text NOT NULL,
    testo text,
    stato_precedente text,
    stato_nuovo text,
    operatore_id uuid DEFAULT auth.uid(),
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT call_center_lead_outbound_attivita_tipo_check CHECK ((tipo = ANY (ARRAY['nota'::text, 'chiamata'::text, 'esito'::text, 'followup'::text, 'assegnazione'::text, 'sistema'::text])))
);

CREATE TABLE public.call_center_lead_outbound_chiamate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lead_id uuid NOT NULL,
    anagrafica_id uuid,
    operatore_id uuid NOT NULL,
    operatore_nome text NOT NULL,
    data_ora timestamp with time zone DEFAULT now() NOT NULL,
    ragione_sociale_snapshot text NOT NULL,
    telefono_snapshot text,
    localita_snapshot text,
    provincia_snapshot text,
    esito text NOT NULL,
    note text,
    data_ricontatto date,
    fascia_ricontatto text,
    appuntamento_tipo text,
    appuntamento_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rilavorazione_stato text,
    CONSTRAINT call_center_lead_outbound_chiamate_appuntamento_tipo_check CHECK ((appuntamento_tipo = ANY (ARRAY['negozio'::text, 'esterno'::text]))),
    CONSTRAINT cclobc_rilavorazione_stato_chk CHECK ((rilavorazione_stato = ANY (ARRAY['da_lavorare'::text, 'completato'::text])))
);

CREATE TABLE public.call_center_lead_outbound_import (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    importato_da uuid NOT NULL,
    file_name text NOT NULL,
    totale_righe integer DEFAULT 0 NOT NULL,
    righe_valide integer DEFAULT 0 NOT NULL,
    righe_importate integer DEFAULT 0 NOT NULL,
    righe_duplicate_scartate integer DEFAULT 0 NOT NULL,
    note text
);

CREATE TABLE public.chiamate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    operatore_id uuid NOT NULL,
    operatore_nome text NOT NULL,
    anagrafica_id uuid,
    cf_piva text NOT NULL,
    nome_cliente text NOT NULL,
    cellulare text,
    copertura text,
    motivo_chiamata text,
    esito text NOT NULL,
    note text,
    data_ricontatto date,
    fascia_ricontatto text,
    rilavorazione_stato text DEFAULT 'da_lavorare'::text,
    passaggio_stato text,
    passaggio_data_scadenza date,
    appuntamento_id uuid,
    data_ora timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    esito_finale text,
    dettagli_esito text,
    esitato_at timestamp with time zone,
    CONSTRAINT chiamate_esito_check CHECK ((esito = ANY (ARRAY['non_risposto'::text, 'non_interessato'::text, 'passa_in_negozio'::text, 'ricontattare'::text, 'appuntamento'::text, 'passa_a_cerea'::text]))),
    CONSTRAINT chiamate_fascia_ricontatto_check CHECK ((fascia_ricontatto = ANY (ARRAY['Mattina'::text, 'Pomeriggio'::text]))),
    CONSTRAINT chiamate_passaggio_stato_check CHECK ((passaggio_stato = ANY (ARRAY['in_attesa'::text, 'passato'::text, 'ricontattare'::text, 'chiuso'::text]))),
    CONSTRAINT chiamate_rilavorazione_stato_check CHECK ((rilavorazione_stato = ANY (ARRAY['da_lavorare'::text, 'completato'::text, 'non_applicabile'::text])))
);

CREATE TABLE public.impostazioni (
    chiave text NOT NULL,
    valore text NOT NULL,
    descrizione text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.orari_standard (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    giorno smallint NOT NULL,
    giorno_nome text NOT NULL,
    ora_inizio time without time zone NOT NULL,
    ora_fine time without time zone NOT NULL,
    attivo boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT orari_standard_giorno_check CHECK (((giorno >= 1) AND (giorno <= 7)))
);

CREATE TABLE public.privacy_policy_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version_slug text NOT NULL,
    content_hash_sha256 text NOT NULL,
    markdown_content text NOT NULL,
    active_from timestamp with time zone DEFAULT now() NOT NULL,
    active_to timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.profili (
    id uuid NOT NULL,
    username text NOT NULL,
    nome text NOT NULL,
    ruolo text DEFAULT 'operatore'::text NOT NULL,
    attivo boolean DEFAULT true NOT NULL,
    colore text DEFAULT '#FF6600'::text,
    slug text,
    pagine_accessibili jsonb DEFAULT '{"blacklist": false, "appuntamenti": false, "rilavorazione": false, "configurazione": false, "elenco_chiamate": false, "prenota_interno": false, "appuntamenti_oggi": false, "registra_chiamata": false, "esiti_appuntamenti": false}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    in_gara boolean DEFAULT false NOT NULL,
    alias_di uuid,
    ordine_gara integer DEFAULT 0 NOT NULL,
    CONSTRAINT profili_alias_di_no_self CHECK (((alias_di IS NULL) OR (alias_di <> id))),
    CONSTRAINT profili_ruolo_check CHECK ((ruolo = ANY (ARRAY['admin'::text, 'operatore'::text])))
);

CREATE TABLE public.segnalazioni (
    id integer NOT NULL,
    stato text DEFAULT 'In attesa Assegnazione'::text NOT NULL,
    urgenza text,
    operatore text,
    assegnatario text,
    numero_contatto text,
    gestione_pratica text,
    dettagli_segnalazione text,
    link_cartella_drive text,
    data_invio_richiesta timestamp with time zone DEFAULT now(),
    data_apertura_segnalazione timestamp with time zone,
    azione_eseguita text,
    tipo_ask text,
    numero_ask text,
    note_back_office text,
    storico_chat jsonb DEFAULT '[]'::jsonb,
    data_ultima_modifica timestamp with time zone DEFAULT now(),
    data_chiusura timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    ragione_sociale text,
    codice_fiscale_piva text,
    CONSTRAINT segnalazioni_urgenza_check CHECK (((urgenza = ANY (ARRAY['Normale'::text, 'Urgente'::text])) OR (urgenza IS NULL)))
);

CREATE TABLE public.segnalazioni_backup (
    id integer,
    stato text,
    urgenza text,
    operatore text,
    assegnatario text,
    nome text,
    cognome text,
    codice_fiscale text,
    numero_contatto text,
    gestione_pratica text,
    dettagli_segnalazione text,
    link_cartella_drive text,
    data_invio_richiesta timestamp with time zone,
    data_apertura_segnalazione timestamp with time zone,
    azione_eseguita text,
    tipo_ask text,
    numero_ask text,
    note_back_office text,
    storico_chat jsonb,
    data_ultima_modifica timestamp with time zone,
    data_chiusura timestamp with time zone,
    created_at timestamp with time zone
);

CREATE TABLE public.slot_bloccati (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    data_ora timestamp with time zone NOT NULL,
    session_id text NOT NULL,
    scadenza timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.vendita_consensi_privacy_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    consenso_id uuid NOT NULL,
    evento_tipo text NOT NULL,
    evento_at timestamp with time zone DEFAULT now() NOT NULL,
    attore_tipo text NOT NULL,
    attore_id uuid,
    attore_ip text,
    dettaglio jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vcp_audit_attore_tipo_chk CHECK ((attore_tipo = ANY (ARRAY['operatore'::text, 'admin'::text, 'sistema'::text, 'cliente'::text])))
);

CREATE TABLE public.vendita_consensi_privacy_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    anagrafica_id uuid NOT NULL,
    pratica_id uuid,
    informativa_version_id uuid NOT NULL,
    consent_uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    document_hash text NOT NULL,
    main_phone text NOT NULL,
    otp_phone text NOT NULL,
    otp_phone_motivazione text,
    marketing_email boolean DEFAULT false NOT NULL,
    marketing_whatsapp boolean DEFAULT false NOT NULL,
    marketing_phone_operator boolean DEFAULT false NOT NULL,
    presa_visione_at timestamp with time zone,
    marketing_valido_fino_al timestamp with time zone,
    otp_hash text,
    otp_salt text,
    otp_inviato_at timestamp with time zone,
    otp_scade_at timestamp with time zone,
    otp_confermato_at timestamp with time zone,
    otp_tentativi integer DEFAULT 0 NOT NULL,
    otp_reinvii integer DEFAULT 0 NOT NULL,
    sms_provider_id text,
    stato text DEFAULT 'pending'::text NOT NULL,
    stato_cambiato_at timestamp with time zone DEFAULT now() NOT NULL,
    pdf_storage_path text,
    pdf_filename text,
    pdf_hash text,
    snapshot_anagrafica jsonb,
    operatore_id uuid,
    ip_operatore text,
    user_agent_operatore text,
    revocato_at timestamp with time zone,
    revocato_motivo text,
    revocato_da uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT vcp_v2_confermato_completo_chk CHECK (((stato <> 'confermato'::text) OR ((presa_visione_at IS NOT NULL) AND (pdf_storage_path IS NOT NULL) AND (pdf_hash IS NOT NULL)))),
    CONSTRAINT vcp_v2_otp_phone_motivazione_chk CHECK (((main_phone = otp_phone) OR ((otp_phone_motivazione IS NOT NULL) AND (length(TRIM(BOTH FROM otp_phone_motivazione)) > 0)))),
    CONSTRAINT vcp_v2_revocato_completo_chk CHECK (((stato <> 'revocato'::text) OR (revocato_at IS NOT NULL))),
    CONSTRAINT vcp_v2_stato_chk CHECK ((stato = ANY (ARRAY['pending'::text, 'confermato'::text, 'scaduto'::text, 'fallito'::text, 'revocato'::text])))
);


-- ---------------------------------------------------------------------------
-- COLONNE aggiunte live su tabelle esistenti (62)
-- ---------------------------------------------------------------------------
ALTER TABLE public.disdette_generate ADD COLUMN IF NOT EXISTS dati_compilazione jsonb;
ALTER TABLE public.post_vendita_controllo_allarmi ADD COLUMN IF NOT EXISTS stato_cambiato_at timestamp with time zone;
ALTER TABLE public.post_vendita_controllo_allarmi ADD COLUMN IF NOT EXISTS stato_cambiato_da uuid;
ALTER TABLE public.post_vendita_controllo_assicurazioni ADD COLUMN IF NOT EXISTS stato_cambiato_at timestamp with time zone;
ALTER TABLE public.post_vendita_controllo_assicurazioni ADD COLUMN IF NOT EXISTS stato_cambiato_da uuid;
ALTER TABLE public.post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS esito_manuale_at timestamp with time zone;
ALTER TABLE public.post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS esito_manuale_bloccato boolean DEFAULT false NOT NULL;
ALTER TABLE public.post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS esito_manuale_da uuid;
ALTER TABLE public.post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS esito_manuale_note text;
ALTER TABLE public.post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS esito_manuale_sbloccato_at timestamp with time zone;
ALTER TABLE public.post_vendita_controllo_lg ADD COLUMN IF NOT EXISTS esito_manuale_sbloccato_da uuid;
ALTER TABLE public.post_vendita_dispositivi_comodato ADD COLUMN IF NOT EXISTS nome text NOT NULL;
ALTER TABLE public.post_vendita_gestione_rimborsi ADD COLUMN IF NOT EXISTS nome text NOT NULL;
ALTER TABLE public.ticket ADD COLUMN IF NOT EXISTS cellulare text NOT NULL;
ALTER TABLE public.ticket ADD COLUMN IF NOT EXISTS motivazione text NOT NULL;
ALTER TABLE public.vendita_apri_chiudi ADD COLUMN IF NOT EXISTS anagrafica_nuovo_id uuid;
ALTER TABLE public.vendita_apri_chiudi ADD COLUMN IF NOT EXISTS cluster_nuovo text;
ALTER TABLE public.vendita_apri_chiudi ADD COLUMN IF NOT EXISTS cluster_vecchio text;
ALTER TABLE public.vendita_apri_chiudi ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.vendita_apri_chiudi ADD COLUMN IF NOT EXISTS data_invio_disdetta date;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS anagrafica_id uuid NOT NULL;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS cellulare_usato text;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS consenso_contratto boolean DEFAULT true NOT NULL;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS consenso_marketing boolean DEFAULT false NOT NULL;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS informativa_hash text;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS informativa_versione text NOT NULL;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS modalita text NOT NULL;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS operatore_id uuid;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS otp_hash text;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS pdf_storage_path text;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS pratica_id uuid;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS revocato_at timestamp with time zone;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS sms_provider_id text;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS snapshot_anagrafica jsonb;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS stato text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.vendita_consensi_privacy ADD COLUMN IF NOT EXISTS valido_fino_al timestamp with time zone;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS numero_contratto_energia text;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS prezzo_fisso numeric(10,2);
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS punteggio_extra_gara_offerta numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS punteggio_extra_gara_opzione numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS punteggio_extra_gara_totale numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS punteggio_gara_offerta numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS punteggio_gara_opzione numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS punteggio_gara_totale numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS reinserimento_di_contratto_id uuid;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS reload_exchange boolean DEFAULT false NOT NULL;
ALTER TABLE public.vendita_contratti ADD COLUMN IF NOT EXISTS ricorrenza_assicurazione text;
ALTER TABLE public.vendita_opzioni ADD COLUMN IF NOT EXISTS ordine integer DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_opzioni ADD COLUMN IF NOT EXISTS punti_extra_piva numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_ordini_smartphone ADD COLUMN IF NOT EXISTS cf_piva_snapshot text;
ALTER TABLE public.vendita_ordini_smartphone ADD COLUMN IF NOT EXISTS colorazione text;
ALTER TABLE public.vendita_ordini_smartphone ADD COLUMN IF NOT EXISTS data_registrazione timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.vendita_ordini_smartphone ADD COLUMN IF NOT EXISTS modello text;
ALTER TABLE public.vendita_reload ADD COLUMN IF NOT EXISTS punti_extra_piva numeric(10,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.vendita_simulatore_protecta ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.vendita_simulatore_protecta ADD COLUMN IF NOT EXISTS preventivo_pdf_url text;
ALTER TABLE public.vendita_simulatore_protecta ADD COLUMN IF NOT EXISTS stato text DEFAULT 'In corso'::text NOT NULL;
ALTER TABLE public.vendita_switch_sim ADD COLUMN IF NOT EXISTS anagrafica_rientro_id uuid;
ALTER TABLE public.vendita_switch_sim ADD COLUMN IF NOT EXISTS giorno_attivazione date;
ALTER TABLE public.vendita_switch_sim ADD COLUMN IF NOT EXISTS numero_portabilita text;
ALTER TABLE public.vendita_switch_sim ADD COLUMN IF NOT EXISTS prima_ricarica_giorno_pianificato date;
ALTER TABLE public.vendita_switch_sim ADD COLUMN IF NOT EXISTS ragione_sociale_attuale text;

-- ---------------------------------------------------------------------------
-- DEFAULT colonne (sequence nuove)
-- ---------------------------------------------------------------------------
ALTER TABLE ONLY public.segnalazioni ALTER COLUMN id SET DEFAULT nextval('public.segnalazioni_id_seq'::regclass);


-- ---------------------------------------------------------------------------
-- CONSTRAINT (nuove tabelle: PK/UNIQUE/CHECK/FK)
-- ---------------------------------------------------------------------------
ALTER TABLE ONLY public.anagrafica
    ADD CONSTRAINT anagrafica_cf_piva_key UNIQUE (cf_piva);

ALTER TABLE ONLY public.anagrafica
    ADD CONSTRAINT anagrafica_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.anagrafica
    ADD CONSTRAINT anagrafica_creato_da_fkey FOREIGN KEY (creato_da) REFERENCES public.profili(id);

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_anagrafica_id_fkey FOREIGN KEY (anagrafica_id) REFERENCES public.anagrafica(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_chiamata_id_fkey FOREIGN KEY (chiamata_id) REFERENCES public.chiamate(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_chiamata_outbound_id_fkey FOREIGN KEY (chiamata_outbound_id) REFERENCES public.call_center_lead_outbound_chiamate(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_fissato_da_operatore_id_fkey FOREIGN KEY (fissato_da_operatore_id) REFERENCES public.profili(id);

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_lead_outbound_id_fkey FOREIGN KEY (lead_outbound_id) REFERENCES public.call_center_lead_outbound(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_originato_da_id_fkey FOREIGN KEY (originato_da_id) REFERENCES public.appuntamenti(id);

ALTER TABLE ONLY public.appuntamenti
    ADD CONSTRAINT appuntamenti_rischedulato_in_id_fkey FOREIGN KEY (rischedulato_in_id) REFERENCES public.appuntamenti(id);

ALTER TABLE ONLY public.blacklist
    ADD CONSTRAINT blacklist_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.blacklist
    ADD CONSTRAINT blacklist_inserito_da_fkey FOREIGN KEY (inserito_da) REFERENCES public.profili(id);

ALTER TABLE ONLY public.blocchi
    ADD CONSTRAINT blocchi_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.blocchi
    ADD CONSTRAINT blocchi_creato_da_fkey FOREIGN KEY (creato_da) REFERENCES public.profili(id);

ALTER TABLE ONLY public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_dedupe_key_key UNIQUE (dedupe_key);

ALTER TABLE ONLY public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_pkey PRIMARY KEY (id);

ALTER TABLE public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_stato_lead_check CHECK (((stato_lead IS NULL) OR (stato_lead = ANY (ARRAY['nuovo'::text, 'non_risposto'::text, 'ricontattare'::text, 'non_interessato'::text, 'appuntamento_fissato_negozio'::text, 'appuntamento_fissato_esterno'::text, 'da_contattare'::text, 'in_lavorazione'::text, 'richiamare'::text, 'appuntamento_fissato'::text, 'chiuso'::text])))) NOT VALID;

ALTER TABLE ONLY public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_assegnato_a_fkey FOREIGN KEY (assegnato_a) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_import_id_fkey FOREIGN KEY (import_id) REFERENCES public.call_center_lead_outbound_import(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound
    ADD CONSTRAINT call_center_lead_outbound_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound_attivita
    ADD CONSTRAINT call_center_lead_outbound_attivita_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_center_lead_outbound_attivita
    ADD CONSTRAINT call_center_lead_outbound_attivita_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.call_center_lead_outbound(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_center_lead_outbound_attivita
    ADD CONSTRAINT call_center_lead_outbound_attivita_operatore_id_fkey FOREIGN KEY (operatore_id) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound_chiamate
    ADD CONSTRAINT call_center_lead_outbound_chiamate_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_center_lead_outbound_chiamate
    ADD CONSTRAINT call_center_lead_outbound_chiamate_anagrafica_id_fkey FOREIGN KEY (anagrafica_id) REFERENCES public.anagrafica(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound_chiamate
    ADD CONSTRAINT call_center_lead_outbound_chiamate_appuntamento_id_fkey FOREIGN KEY (appuntamento_id) REFERENCES public.appuntamenti(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.call_center_lead_outbound_chiamate
    ADD CONSTRAINT call_center_lead_outbound_chiamate_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.call_center_lead_outbound(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.call_center_lead_outbound_chiamate
    ADD CONSTRAINT call_center_lead_outbound_chiamate_operatore_id_fkey FOREIGN KEY (operatore_id) REFERENCES public.profili(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.call_center_lead_outbound_import
    ADD CONSTRAINT call_center_lead_outbound_import_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.call_center_lead_outbound_import
    ADD CONSTRAINT call_center_lead_outbound_import_importato_da_fkey FOREIGN KEY (importato_da) REFERENCES public.profili(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.chiamate
    ADD CONSTRAINT chiamate_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.chiamate
    ADD CONSTRAINT chiamate_anagrafica_id_fkey FOREIGN KEY (anagrafica_id) REFERENCES public.anagrafica(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.chiamate
    ADD CONSTRAINT chiamate_operatore_id_fkey FOREIGN KEY (operatore_id) REFERENCES public.profili(id);

ALTER TABLE ONLY public.chiamate
    ADD CONSTRAINT fk_chiamate_appuntamento FOREIGN KEY (appuntamento_id) REFERENCES public.appuntamenti(id);

ALTER TABLE ONLY public.impostazioni
    ADD CONSTRAINT impostazioni_pkey PRIMARY KEY (chiave);

ALTER TABLE ONLY public.orari_standard
    ADD CONSTRAINT orari_standard_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.privacy_policy_versions
    ADD CONSTRAINT privacy_policy_versions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.privacy_policy_versions
    ADD CONSTRAINT privacy_policy_versions_version_slug_key UNIQUE (version_slug);

ALTER TABLE ONLY public.profili
    ADD CONSTRAINT profili_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.profili
    ADD CONSTRAINT profili_slug_key UNIQUE (slug);

ALTER TABLE ONLY public.profili
    ADD CONSTRAINT profili_username_key UNIQUE (username);

ALTER TABLE ONLY public.profili
    ADD CONSTRAINT profili_alias_di_fkey FOREIGN KEY (alias_di) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.profili
    ADD CONSTRAINT profili_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.segnalazioni
    ADD CONSTRAINT segnalazioni_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.slot_bloccati
    ADD CONSTRAINT slot_bloccati_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vendita_consensi_privacy_audit
    ADD CONSTRAINT vendita_consensi_privacy_audit_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vendita_consensi_privacy_audit
    ADD CONSTRAINT vendita_consensi_privacy_audit_attore_id_fkey FOREIGN KEY (attore_id) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.vendita_consensi_privacy_audit
    ADD CONSTRAINT vendita_consensi_privacy_audit_consenso_id_fkey FOREIGN KEY (consenso_id) REFERENCES public.vendita_consensi_privacy_v2(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_consent_uuid_key UNIQUE (consent_uuid);

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_anagrafica_id_fkey FOREIGN KEY (anagrafica_id) REFERENCES public.anagrafica(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_informativa_version_id_fkey FOREIGN KEY (informativa_version_id) REFERENCES public.privacy_policy_versions(id) ON DELETE RESTRICT;

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_operatore_id_fkey FOREIGN KEY (operatore_id) REFERENCES public.profili(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_pratica_id_fkey FOREIGN KEY (pratica_id) REFERENCES public.vendita_pratiche(id) ON DELETE SET NULL;

ALTER TABLE ONLY public.vendita_consensi_privacy_v2
    ADD CONSTRAINT vendita_consensi_privacy_v2_revocato_da_fkey FOREIGN KEY (revocato_da) REFERENCES public.profili(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- SEQUENCE OWNED BY (nuove)
-- ---------------------------------------------------------------------------
ALTER SEQUENCE public.segnalazioni_id_seq OWNED BY public.segnalazioni.id;


-- ---------------------------------------------------------------------------
-- INDICI (nuovi: 53)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX anagrafica_cf_piva_unique ON public.anagrafica USING btree (cf_piva);

CREATE INDEX appuntamenti_chiamata_outbound_id_idx ON public.appuntamenti USING btree (chiamata_outbound_id);

CREATE INDEX appuntamenti_lead_outbound_id_idx ON public.appuntamenti USING btree (lead_outbound_id);

CREATE INDEX cclobc_appuntamento_id_idx ON public.call_center_lead_outbound_chiamate USING btree (appuntamento_id);

CREATE INDEX cclobc_data_ora_idx ON public.call_center_lead_outbound_chiamate USING btree (data_ora DESC);

CREATE INDEX cclobc_data_ricontatto_idx ON public.call_center_lead_outbound_chiamate USING btree (data_ricontatto);

CREATE INDEX cclobc_esito_idx ON public.call_center_lead_outbound_chiamate USING btree (esito);

CREATE INDEX cclobc_lead_id_idx ON public.call_center_lead_outbound_chiamate USING btree (lead_id);

CREATE INDEX cclobc_lead_idx ON public.call_center_lead_outbound_chiamate USING btree (lead_id);

CREATE INDEX cclobc_operatore_id_idx ON public.call_center_lead_outbound_chiamate USING btree (operatore_id);

CREATE INDEX cclobc_rilav_esito_data_lead_idx ON public.call_center_lead_outbound_chiamate USING btree (rilavorazione_stato, esito, data_ricontatto, lead_id);

CREATE INDEX cclobc_rilavorazione_stato_idx ON public.call_center_lead_outbound_chiamate USING btree (rilavorazione_stato);

CREATE INDEX idx_anagrafica_cellulare ON public.anagrafica USING btree (cellulare);

CREATE INDEX idx_anagrafica_cf_piva ON public.anagrafica USING btree (upper(cf_piva));

CREATE INDEX idx_anagrafica_nome ON public.anagrafica USING btree (upper(ragione_sociale));

CREATE INDEX idx_appuntamenti_data ON public.appuntamenti USING btree (data_ora);

CREATE INDEX idx_appuntamenti_data_stato ON public.appuntamenti USING btree (data_ora, stato) WHERE (stato = 'confermato'::text);

CREATE INDEX idx_appuntamenti_esito ON public.appuntamenti USING btree (esito_finale) WHERE ((presentato = 'si'::text) AND (esito_finale IS NULL));

CREATE INDEX idx_appuntamenti_fissato_da ON public.appuntamenti USING btree (fissato_da_operatore_id);

CREATE INDEX idx_appuntamenti_non_presentato ON public.appuntamenti USING btree (non_presentato_stato) WHERE ((presentato = 'no'::text) AND (non_presentato_stato = 'da_lavorare'::text));

CREATE INDEX idx_appuntamenti_presentato ON public.appuntamenti USING btree (presentato) WHERE (presentato IS NOT NULL);

CREATE INDEX idx_appuntamenti_stato ON public.appuntamenti USING btree (stato);

CREATE INDEX idx_blacklist_cf_piva ON public.blacklist USING btree (upper(cf_piva));

CREATE INDEX idx_blocchi_date ON public.blocchi USING btree (data_inizio, data_fine);

CREATE INDEX idx_call_center_lead_outbound_assegnato ON public.call_center_lead_outbound USING btree (assegnato_a);

CREATE INDEX idx_call_center_lead_outbound_attivita_lead ON public.call_center_lead_outbound_attivita USING btree (lead_id, created_at DESC);

CREATE INDEX idx_call_center_lead_outbound_categoria ON public.call_center_lead_outbound USING btree (categoria);

CREATE INDEX idx_call_center_lead_outbound_created_at ON public.call_center_lead_outbound USING btree (created_at DESC);

CREATE INDEX idx_call_center_lead_outbound_followup ON public.call_center_lead_outbound USING btree (prossimo_followup_at);

CREATE INDEX idx_call_center_lead_outbound_import_created_at ON public.call_center_lead_outbound_import USING btree (created_at DESC);

CREATE INDEX idx_call_center_lead_outbound_localita ON public.call_center_lead_outbound USING btree (localita_norm);

CREATE INDEX idx_call_center_lead_outbound_nome ON public.call_center_lead_outbound USING btree (ragione_sociale_norm);

CREATE INDEX idx_call_center_lead_outbound_stato ON public.call_center_lead_outbound USING btree (stato_lead);

CREATE INDEX idx_call_center_lead_outbound_telefono ON public.call_center_lead_outbound USING btree (telefono_norm);

CREATE INDEX idx_chiamate_cf_piva ON public.chiamate USING btree (upper(cf_piva));

CREATE INDEX idx_chiamate_data ON public.chiamate USING btree (data_ora DESC);

CREATE INDEX idx_chiamate_esito ON public.chiamate USING btree (esito);

CREATE INDEX idx_chiamate_operatore ON public.chiamate USING btree (operatore_id);

CREATE INDEX idx_chiamate_passa_negozio ON public.chiamate USING btree (passaggio_stato, passaggio_data_scadenza) WHERE (passaggio_stato = 'in_attesa'::text);

CREATE INDEX idx_chiamate_rilavorazione ON public.chiamate USING btree (rilavorazione_stato, data_ricontatto) WHERE (rilavorazione_stato = 'da_lavorare'::text);

CREATE INDEX idx_orari_giorno ON public.orari_standard USING btree (giorno) WHERE (attivo = true);

CREATE INDEX idx_segnalazioni_assegnatario ON public.segnalazioni USING btree (assegnatario);

CREATE INDEX idx_segnalazioni_operatore ON public.segnalazioni USING btree (operatore);

CREATE INDEX idx_segnalazioni_stato ON public.segnalazioni USING btree (stato);

CREATE INDEX idx_slot_bloccati_data ON public.slot_bloccati USING btree (data_ora);

CREATE INDEX idx_slot_bloccati_scadenza ON public.slot_bloccati USING btree (scadenza);

CREATE INDEX idx_vcp_audit_consenso_time ON public.vendita_consensi_privacy_audit USING btree (consenso_id, evento_at DESC);

CREATE INDEX idx_vcp_audit_tipo_time ON public.vendita_consensi_privacy_audit USING btree (evento_tipo, evento_at DESC);

CREATE INDEX idx_vcp_v2_dedupe_presa_visione ON public.vendita_consensi_privacy_v2 USING btree (anagrafica_id, informativa_version_id, presa_visione_at DESC) WHERE ((stato = 'confermato'::text) AND (revocato_at IS NULL));

CREATE INDEX idx_vcp_v2_marketing_scadenza ON public.vendita_consensi_privacy_v2 USING btree (marketing_valido_fino_al) WHERE ((marketing_valido_fino_al IS NOT NULL) AND (revocato_at IS NULL));

CREATE INDEX idx_vcp_v2_pending_scadenza ON public.vendita_consensi_privacy_v2 USING btree (otp_scade_at) WHERE (stato = 'pending'::text);

CREATE INDEX idx_vcp_v2_pratica ON public.vendita_consensi_privacy_v2 USING btree (pratica_id) WHERE (pratica_id IS NOT NULL);

CREATE UNIQUE INDEX uidx_privacy_policy_versions_one_active ON public.privacy_policy_versions USING btree ((true)) WHERE (active_to IS NULL);


-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY (enable senza traccia: 36)
-- ---------------------------------------------------------------------------
ALTER TABLE public.anagrafica ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.appuntamenti ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.blocchi ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_center_lead_outbound ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_center_lead_outbound_attivita ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_center_lead_outbound_chiamate ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.call_center_lead_outbound_import ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.chiamate ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.impostazioni ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.orari_standard ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.post_vendita_dispositivi_comodato ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.post_vendita_gestione_rimborsi ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.privacy_policy_versions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profili ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.segnalazioni ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.segnalazioni_backup ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.slot_bloccati ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_apri_chiudi ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_categorie ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_compensi_regole ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_consensi_privacy_audit ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_consensi_privacy_v2 ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_contratti ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_documenti ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_documenti_regole ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_log_modifiche ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_offerte ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_offerte_opzioni ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_offerte_reload ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_opzioni ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_ordini_smartphone ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_pratiche ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_reload ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_simulatore_protecta ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.vendita_switch_sim ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- POLICY RLS (nuove: 73)
-- ---------------------------------------------------------------------------
CREATE POLICY anagrafica_insert ON public.anagrafica FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY anagrafica_select ON public.anagrafica FOR SELECT USING ((auth.uid() IS NOT NULL));

CREATE POLICY anagrafica_update ON public.anagrafica FOR UPDATE USING ((auth.uid() IS NOT NULL));

CREATE POLICY auth_select_anagrafica ON public.anagrafica FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_update_anagrafica ON public.anagrafica FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY appuntamenti_insert ON public.appuntamenti FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY appuntamenti_select ON public.appuntamenti FOR SELECT TO authenticated USING (true);

CREATE POLICY appuntamenti_update ON public.appuntamenti FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY blacklist_delete ON public.blacklist FOR DELETE USING (public.is_admin());

CREATE POLICY blacklist_insert ON public.blacklist FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY blacklist_select ON public.blacklist FOR SELECT USING ((auth.uid() IS NOT NULL));

CREATE POLICY blocchi_modify ON public.blocchi USING (public.is_admin());

CREATE POLICY blocchi_select ON public.blocchi FOR SELECT TO authenticated USING (true);

CREATE POLICY call_center_lead_outbound_delete_admin_policy ON public.call_center_lead_outbound FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profili p
  WHERE ((p.id = auth.uid()) AND (p.attivo = true) AND (p.ruolo = 'admin'::text)))));

CREATE POLICY call_center_lead_outbound_insert_policy ON public.call_center_lead_outbound FOR INSERT WITH CHECK (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY call_center_lead_outbound_select_policy ON public.call_center_lead_outbound FOR SELECT USING (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY call_center_lead_outbound_update_policy ON public.call_center_lead_outbound FOR UPDATE USING (public.crm_can_access_page('call_center_lead_outbound'::text)) WITH CHECK (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY cclo_insert ON public.call_center_lead_outbound FOR INSERT TO authenticated WITH CHECK ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY cclo_select ON public.call_center_lead_outbound FOR SELECT TO authenticated USING ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY cclo_update ON public.call_center_lead_outbound FOR UPDATE TO authenticated USING ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text))) WITH CHECK ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY call_center_lead_outbound_attivita_delete_admin_policy ON public.call_center_lead_outbound_attivita FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.profili p
  WHERE ((p.id = auth.uid()) AND (p.attivo = true) AND (p.ruolo = 'admin'::text)))));

CREATE POLICY call_center_lead_outbound_attivita_insert_policy ON public.call_center_lead_outbound_attivita FOR INSERT WITH CHECK (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY call_center_lead_outbound_attivita_select_policy ON public.call_center_lead_outbound_attivita FOR SELECT USING (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY call_center_lead_outbound_attivita_update_policy ON public.call_center_lead_outbound_attivita FOR UPDATE USING (public.crm_can_access_page('call_center_lead_outbound'::text)) WITH CHECK (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY ccloa_insert ON public.call_center_lead_outbound_attivita FOR INSERT TO authenticated WITH CHECK ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY ccloa_select ON public.call_center_lead_outbound_attivita FOR SELECT TO authenticated USING ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY cclobc_insert ON public.call_center_lead_outbound_chiamate FOR INSERT TO authenticated WITH CHECK ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY cclobc_select ON public.call_center_lead_outbound_chiamate FOR SELECT TO authenticated USING ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('elenco_chiamate'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY cclobc_update ON public.call_center_lead_outbound_chiamate FOR UPDATE TO authenticated USING ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text))) WITH CHECK ((public.crm_can_access_page('call_center_lead_outbound'::text) OR public.crm_can_access_page('rilavorazione'::text)));

CREATE POLICY call_center_lead_outbound_import_insert_policy ON public.call_center_lead_outbound_import FOR INSERT WITH CHECK (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY call_center_lead_outbound_import_select_policy ON public.call_center_lead_outbound_import FOR SELECT USING (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY call_center_lead_outbound_import_update_policy ON public.call_center_lead_outbound_import FOR UPDATE USING (public.crm_can_access_page('call_center_lead_outbound'::text)) WITH CHECK (public.crm_can_access_page('call_center_lead_outbound'::text));

CREATE POLICY chiamate_insert ON public.chiamate FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));

CREATE POLICY chiamate_select ON public.chiamate FOR SELECT USING ((auth.uid() IS NOT NULL));

CREATE POLICY chiamate_update ON public.chiamate FOR UPDATE USING (((operatore_id = auth.uid()) OR public.is_admin()));

CREATE POLICY auth_select_dashboard_righe ON public.dashboard_righe_giornaliera FOR SELECT TO authenticated USING (true);

CREATE POLICY admin_write_gara_metriche ON public.gara_metriche TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profili p
  WHERE ((p.id = auth.uid()) AND (p.ruolo = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profili p
  WHERE ((p.id = auth.uid()) AND (p.ruolo = 'admin'::text)))));

CREATE POLICY auth_select_gara_metriche ON public.gara_metriche FOR SELECT TO authenticated USING (true);

CREATE POLICY admin_write_gara_obiettivi ON public.gara_obiettivi_mensili TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.profili p
  WHERE ((p.id = auth.uid()) AND (p.ruolo = 'admin'::text))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.profili p
  WHERE ((p.id = auth.uid()) AND (p.ruolo = 'admin'::text)))));

CREATE POLICY auth_select_gara_obiettivi ON public.gara_obiettivi_mensili FOR SELECT TO authenticated USING (true);

CREATE POLICY impostazioni_modify ON public.impostazioni FOR UPDATE USING (public.is_admin());

CREATE POLICY impostazioni_select ON public.impostazioni FOR SELECT TO authenticated USING (true);

CREATE POLICY orari_modify ON public.orari_standard USING (public.is_admin());

CREATE POLICY orari_select ON public.orari_standard FOR SELECT TO authenticated USING (true);

CREATE POLICY post_vendita_controllo_allarmi_authenticated_all ON public.post_vendita_controllo_allarmi TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY post_vendita_controllo_assicurazioni_authenticated_all ON public.post_vendita_controllo_assicurazioni TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY post_vendita_controllo_fissi_authenticated_all ON public.post_vendita_controllo_fissi TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY post_vendita_controllo_lg_authenticated_all ON public.post_vendita_controllo_lg TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY post_vendita_dispositivi_comodato_authenticated_all ON public.post_vendita_dispositivi_comodato TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY post_vendita_gestione_rimborsi_authenticated_select ON public.post_vendita_gestione_rimborsi FOR SELECT TO authenticated USING (true);

CREATE POLICY privacy_policy_versions_authenticated_select ON public.privacy_policy_versions FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_select_profili ON public.profili FOR SELECT TO authenticated USING (true);

CREATE POLICY profili_insert ON public.profili FOR INSERT WITH CHECK (public.is_admin());

CREATE POLICY profili_select ON public.profili FOR SELECT USING (((id = auth.uid()) OR public.is_admin()));

CREATE POLICY profili_update ON public.profili FOR UPDATE USING (public.is_admin());

CREATE POLICY segnalazioni_authenticated_all ON public.segnalazioni TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY slot_delete ON public.slot_bloccati FOR DELETE TO authenticated USING (true);

CREATE POLICY slot_insert ON public.slot_bloccati FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY slot_select ON public.slot_bloccati FOR SELECT TO authenticated USING (true);

CREATE POLICY vendita_apri_chiudi_authenticated_all ON public.vendita_apri_chiudi TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY auth_select_vendita_categorie ON public.vendita_categorie FOR SELECT TO authenticated USING (true);

CREATE POLICY vendita_consensi_privacy_authenticated_select ON public.vendita_consensi_privacy FOR SELECT TO authenticated USING (true);

CREATE POLICY vcp_audit_authenticated_select ON public.vendita_consensi_privacy_audit FOR SELECT TO authenticated USING (true);

CREATE POLICY vcp_v2_authenticated_select ON public.vendita_consensi_privacy_v2 FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_select_vendita_contratti ON public.vendita_contratti FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_select_vendita_documenti ON public.vendita_documenti FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_select_vendita_offerte ON public.vendita_offerte FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_select_vendita_offerte_opzioni ON public.vendita_offerte_opzioni FOR SELECT TO authenticated USING (true);

CREATE POLICY auth_select_vendita_opzioni ON public.vendita_opzioni FOR SELECT TO authenticated USING (true);

CREATE POLICY vendita_ordini_smartphone_authenticated_all ON public.vendita_ordini_smartphone TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY auth_select_vendita_reload ON public.vendita_reload FOR SELECT TO authenticated USING (true);

CREATE POLICY vendita_simulatore_protecta_authenticated_all ON public.vendita_simulatore_protecta TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY vendita_switch_sim_authenticated_all ON public.vendita_switch_sim TO authenticated USING (true) WITH CHECK (true);


-- ---------------------------------------------------------------------------
-- TRIGGER (nuovi: 32)
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_anagrafica_updated_at BEFORE UPDATE ON public.anagrafica FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_appuntamenti_updated_at BEFORE UPDATE ON public.appuntamenti FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_cclobc_default_rilavorazione_stato BEFORE INSERT OR UPDATE OF esito, rilavorazione_stato ON public.call_center_lead_outbound_chiamate FOR EACH ROW EXECUTE FUNCTION public.crm_cclobc_default_rilavorazione_stato();

CREATE TRIGGER trg_cclobc_touch_updated_at BEFORE UPDATE ON public.call_center_lead_outbound_chiamate FOR EACH ROW EXECUTE FUNCTION public.crm_call_center_lead_outbound_chiamate_touch_updated_at();

CREATE TRIGGER trg_outbound_chiamate_auto_ricontatto BEFORE INSERT OR UPDATE ON public.call_center_lead_outbound_chiamate FOR EACH ROW EXECUTE FUNCTION public.calcola_ricontatto_non_risposto_outbound();

CREATE TRIGGER trg_call_center_lead_outbound_prepare BEFORE INSERT OR UPDATE ON public.call_center_lead_outbound FOR EACH ROW EXECUTE FUNCTION public.crm_prepare_call_center_lead_outbound_row();

CREATE TRIGGER trg_call_center_lead_outbound_touch_updated_at BEFORE UPDATE ON public.call_center_lead_outbound FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();

CREATE TRIGGER trg_chiamate_auto_ricontatto BEFORE INSERT OR UPDATE OF esito ON public.chiamate FOR EACH ROW EXECUTE FUNCTION public.calcola_ricontatto_non_risposto();

CREATE TRIGGER trg_chiamate_updated_at BEFORE UPDATE ON public.chiamate FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_impostazioni_updated_at BEFORE UPDATE ON public.impostazioni FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_post_vendita_dispositivi_comodato_touch BEFORE UPDATE ON public.post_vendita_dispositivi_comodato FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.post_vendita_gestione_rimborsi FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_post_vendita_gestione_rimborsi_touch BEFORE UPDATE ON public.post_vendita_gestione_rimborsi FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_profili_default_permissions BEFORE INSERT ON public.profili FOR EACH ROW EXECUTE FUNCTION public.set_default_permissions();

CREATE TRIGGER trg_profili_updated_at BEFORE UPDATE ON public.profili FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_update_data_modifica BEFORE UPDATE ON public.segnalazioni FOR EACH ROW EXECUTE FUNCTION public.update_data_ultima_modifica();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.ticket FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_apri_chiudi FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_vendita_apri_chiudi_touch BEFORE UPDATE ON public.vendita_apri_chiudi FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_vcp_audit_no_delete BEFORE DELETE ON public.vendita_consensi_privacy_audit FOR EACH ROW EXECUTE FUNCTION public.vcp_audit_no_delete();

CREATE TRIGGER trg_vcp_audit_no_update BEFORE UPDATE ON public.vendita_consensi_privacy_audit FOR EACH ROW EXECUTE FUNCTION public.vcp_audit_no_update();

CREATE TRIGGER trg_vcp_v2_updated_at BEFORE UPDATE ON public.vendita_consensi_privacy_v2 FOR EACH ROW EXECUTE FUNCTION public.vendita_consensi_privacy_v2_touch_updated_at();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_consensi_privacy FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_vendita_contratti_calcola_punteggio_totale BEFORE INSERT OR UPDATE ON public.vendita_contratti FOR EACH ROW EXECUTE FUNCTION public.vendita_calcola_punteggio_totale();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_ordini_smartphone FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_vendita_ordini_smartphone_touch BEFORE UPDATE ON public.vendita_ordini_smartphone FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_pratiche FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_simulatore_protecta FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_vendita_simulatore_protecta_touch BEFORE UPDATE ON public.vendita_simulatore_protecta FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER trg_alias_operatore BEFORE INSERT OR UPDATE OF operatore_id ON public.vendita_switch_sim FOR EACH ROW EXECUTE FUNCTION public.trg_normalizza_operatore_alias();

CREATE TRIGGER trg_vendita_switch_sim_touch BEFORE UPDATE ON public.vendita_switch_sim FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ---------------------------------------------------------------------------
-- VIEW (nuove: 2)
-- ---------------------------------------------------------------------------
CREATE VIEW public.vw_elenco_chiamate_unificate AS
 SELECT 'standard'::text AS origine_tipo,
    c.id AS origine_id,
    c.id,
    c.data_ora,
    c.nome_cliente,
    COALESCE(a.ragione_sociale, c.nome_cliente) AS ragione_sociale_view,
    c.cf_piva,
    c.cellulare,
    c.cellulare AS telefono,
    c.motivo_chiamata,
    c.copertura,
    c.esito,
    c.note,
    c.operatore_id,
    c.operatore_nome,
    c.anagrafica_id,
    c.appuntamento_id,
    NULL::text AS appuntamento_tipo,
    c.data_ricontatto,
    c.fascia_ricontatto
   FROM (public.chiamate c
     LEFT JOIN public.anagrafica a ON ((a.id = c.anagrafica_id)))
UNION ALL
 SELECT 'outbound_business'::text AS origine_tipo,
    o.id AS origine_id,
    o.id,
    o.data_ora,
    o.ragione_sociale_snapshot AS nome_cliente,
    o.ragione_sociale_snapshot AS ragione_sociale_view,
    NULL::text AS cf_piva,
    o.telefono_snapshot AS cellulare,
    o.telefono_snapshot AS telefono,
    'Outbound business'::text AS motivo_chiamata,
    NULL::text AS copertura,
    o.esito,
    o.note,
    o.operatore_id,
    o.operatore_nome,
    o.anagrafica_id,
    o.appuntamento_id,
    o.appuntamento_tipo,
    o.data_ricontatto,
    o.fascia_ricontatto
   FROM public.call_center_lead_outbound_chiamate o;

CREATE VIEW public.vw_rilavorazione_ricontatti_unificata AS
 SELECT 'standard'::text AS origine_tipo,
    c.id AS origine_id,
    NULL::uuid AS lead_id,
    c.id AS chiamata_origine_id,
    c.nome_cliente,
    COALESCE(a.ragione_sociale, c.nome_cliente) AS ragione_sociale_view,
    c.cf_piva,
    c.cellulare AS telefono,
    c.operatore_id,
    c.operatore_nome,
    c.esito,
    c.note,
    c.copertura,
    c.motivo_chiamata,
    c.data_ora,
    c.data_ricontatto,
    c.fascia_ricontatto,
    c.rilavorazione_stato
   FROM (public.chiamate c
     LEFT JOIN public.anagrafica a ON ((a.id = c.anagrafica_id)))
  WHERE ((c.esito = ANY (ARRAY['non_risposto'::text, 'ricontattare'::text])) AND (c.rilavorazione_stato = 'da_lavorare'::text))
UNION ALL
 SELECT 'outbound_business'::text AS origine_tipo,
    o.id AS origine_id,
    o.lead_id,
    o.id AS chiamata_origine_id,
    COALESCE(l.ragione_sociale, o.ragione_sociale_snapshot) AS nome_cliente,
    COALESCE(l.ragione_sociale, o.ragione_sociale_snapshot) AS ragione_sociale_view,
    COALESCE(NULLIF(l.partita_iva, ''::text), NULLIF(l.codice_fiscale, ''::text)) AS cf_piva,
    COALESCE(NULLIF(l.telefono_raw, ''::text), o.telefono_snapshot) AS telefono,
    o.operatore_id,
    o.operatore_nome,
    o.esito,
    o.note,
    NULL::text AS copertura,
    'Outbound business'::text AS motivo_chiamata,
    o.data_ora,
    COALESCE(o.data_ricontatto, ((o.data_ora AT TIME ZONE 'Europe/Rome'::text))::date) AS data_ricontatto,
    o.fascia_ricontatto,
    o.rilavorazione_stato
   FROM (public.call_center_lead_outbound_chiamate o
     LEFT JOIN public.call_center_lead_outbound l ON ((l.id = o.lead_id)))
  WHERE ((o.esito = ANY (ARRAY['non_risposto'::text, 'ricontattare'::text])) AND (o.rilavorazione_stato = 'da_lavorare'::text));

-- =============================================================================
-- Fine 069_baseline_allineamento.sql
-- =============================================================================
