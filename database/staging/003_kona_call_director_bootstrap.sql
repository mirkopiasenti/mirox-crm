-- Bootstrap one-shot del progetto Supabase "Mirox CRM - Test KONA Call Director".
-- Ricostruisce esclusivamente le dipendenze CRM usate dal modulo KONA CD.
-- Lo schema e' derivato in sola lettura dai cataloghi production il 2026-08-28;
-- non copia righe, utenti Auth, dati cliente, chiamate o appuntamenti.
--
-- Ordine sul progetto test vuoto:
--   1. questo bootstrap
--   2. database/072_kona_call_director.sql
--   3. database/staging/002_kona_call_director_seed.sql

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
  ) THEN
    RAISE EXCEPTION
      'Bootstrap KONA CD staging interrotto: lo schema public contiene gia'' tabelle';
  END IF;
END;
$$;

CREATE TABLE public.profili (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  nome text NOT NULL,
  ruolo text NOT NULL DEFAULT 'operatore' CHECK (ruolo IN ('admin', 'operatore')),
  attivo boolean NOT NULL DEFAULT true,
  colore text DEFAULT '#FF6600',
  slug text UNIQUE,
  pagine_accessibili jsonb NOT NULL DEFAULT '{"blacklist":false,"appuntamenti":false,"rilavorazione":false,"configurazione":false,"elenco_chiamate":false,"prenota_interno":false,"appuntamenti_oggi":false,"registra_chiamata":false,"esiti_appuntamenti":false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  in_gara boolean NOT NULL DEFAULT false,
  alias_di uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  ordine_gara integer NOT NULL DEFAULT 0,
  CONSTRAINT profili_alias_di_no_self CHECK (alias_di IS NULL OR alias_di <> id)
);

CREATE TABLE public.anagrafica (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cf_piva text NOT NULL UNIQUE,
  cluster text CHECK (cluster IN ('Consumer', 'Business')),
  ragione_sociale text,
  nome_referente text,
  cellulare text,
  provincia text,
  comune text,
  via text,
  civico text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  creato_da uuid REFERENCES public.profili(id),
  email text
);

CREATE TABLE public.blacklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cf_piva text NOT NULL,
  nome_cognome text,
  cellulare text,
  motivo text,
  inserito_da uuid REFERENCES public.profili(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.call_center_lead_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
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
  telefono_tipo text NOT NULL DEFAULT 'sconosciuto' CHECK (telefono_tipo IN ('fisso', 'mobile', 'sconosciuto')),
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
  stato_lead text NOT NULL DEFAULT 'nuovo',
  assegnato_a uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  ultimo_contatto_at timestamptz,
  prossimo_followup_at timestamptz,
  note_ultima text,
  pinned boolean NOT NULL DEFAULT false,
  do_not_call boolean NOT NULL DEFAULT false,
  times_seen integer NOT NULL DEFAULT 1,
  first_import_at timestamptz NOT NULL DEFAULT now(),
  last_import_at timestamptz NOT NULL DEFAULT now(),
  dedupe_strategy text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  created_by uuid DEFAULT auth.uid() REFERENCES public.profili(id) ON DELETE SET NULL,
  updated_by uuid DEFAULT auth.uid() REFERENCES public.profili(id) ON DELETE SET NULL,
  CONSTRAINT call_center_lead_outbound_stato_lead_check CHECK (
    stato_lead IN ('nuovo','non_risposto','ricontattare','non_interessato',
      'appuntamento_fissato_negozio','appuntamento_fissato_esterno',
      'da_contattare','in_lavorazione','richiamare','appuntamento_fissato','chiuso')
  ) NOT VALID
);

CREATE TABLE public.call_center_lead_outbound_attivita (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  lead_id uuid NOT NULL REFERENCES public.call_center_lead_outbound(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('nota','chiamata','esito','followup','assegnazione','sistema')),
  testo text,
  stato_precedente text,
  stato_nuovo text,
  operatore_id uuid DEFAULT auth.uid() REFERENCES public.profili(id) ON DELETE SET NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.call_center_lead_outbound_chiamate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.call_center_lead_outbound(id) ON DELETE CASCADE,
  anagrafica_id uuid REFERENCES public.anagrafica(id) ON DELETE SET NULL,
  operatore_id uuid NOT NULL REFERENCES public.profili(id) ON DELETE RESTRICT,
  operatore_nome text NOT NULL,
  data_ora timestamptz NOT NULL DEFAULT now(),
  ragione_sociale_snapshot text NOT NULL,
  telefono_snapshot text,
  localita_snapshot text,
  provincia_snapshot text,
  esito text NOT NULL,
  note text,
  data_ricontatto date,
  fascia_ricontatto text,
  appuntamento_tipo text CHECK (appuntamento_tipo IN ('negozio', 'esterno')),
  appuntamento_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  rilavorazione_stato text CHECK (rilavorazione_stato IN ('da_lavorare', 'completato'))
);

CREATE TABLE public.chiamate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operatore_id uuid NOT NULL REFERENCES public.profili(id),
  operatore_nome text NOT NULL,
  anagrafica_id uuid REFERENCES public.anagrafica(id) ON DELETE SET NULL,
  cf_piva text NOT NULL,
  nome_cliente text NOT NULL,
  cellulare text,
  copertura text,
  motivo_chiamata text,
  esito text NOT NULL CHECK (esito IN ('non_risposto','non_interessato','passa_in_negozio','ricontattare','appuntamento','passa_a_cerea')),
  note text,
  data_ricontatto date,
  fascia_ricontatto text CHECK (fascia_ricontatto IN ('Mattina', 'Pomeriggio')),
  rilavorazione_stato text DEFAULT 'da_lavorare' CHECK (rilavorazione_stato IN ('da_lavorare','completato','non_applicabile')),
  passaggio_stato text CHECK (passaggio_stato IN ('in_attesa','passato','ricontattare','chiuso')),
  passaggio_data_scadenza date,
  appuntamento_id uuid,
  data_ora timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  esito_finale text,
  dettagli_esito text,
  esitato_at timestamptz
);

CREATE TABLE public.appuntamenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  codice_fiscale text,
  telefono text NOT NULL,
  motivo text NOT NULL,
  note text,
  anagrafica_id uuid REFERENCES public.anagrafica(id) ON DELETE SET NULL,
  fissato_da_operatore_id uuid REFERENCES public.profili(id),
  fissato_da_nome text,
  chiamata_id uuid REFERENCES public.chiamate(id) ON DELETE SET NULL,
  data_ora timestamptz NOT NULL,
  durata_minuti integer NOT NULL DEFAULT 30,
  fonte text NOT NULL DEFAULT 'interno' CHECK (fonte IN ('pubblico', 'interno')),
  stato text NOT NULL DEFAULT 'confermato' CHECK (stato IN ('confermato', 'rischedulato', 'annullato')),
  motivo_modifica text,
  rischedulato_in_id uuid REFERENCES public.appuntamenti(id),
  originato_da_id uuid REFERENCES public.appuntamenti(id),
  presentato text CHECK (presentato IN ('si', 'no')),
  presentato_at timestamptz,
  esito_finale text CHECK (esito_finale IN ('vinta', 'persa')),
  dettagli_esito text,
  esitato_at timestamptz,
  non_presentato_stato text CHECK (non_presentato_stato IN ('da_lavorare', 'presentato', 'lavorato')),
  storico jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  lead_outbound_id uuid REFERENCES public.call_center_lead_outbound(id) ON DELETE SET NULL,
  chiamata_outbound_id uuid REFERENCES public.call_center_lead_outbound_chiamate(id) ON DELETE SET NULL
);

ALTER TABLE public.call_center_lead_outbound_chiamate
  ADD CONSTRAINT call_center_lead_outbound_chiamate_appuntamento_id_fkey
  FOREIGN KEY (appuntamento_id) REFERENCES public.appuntamenti(id) ON DELETE SET NULL;

ALTER TABLE public.chiamate
  ADD CONSTRAINT fk_chiamate_appuntamento
  FOREIGN KEY (appuntamento_id) REFERENCES public.appuntamenti(id);

CREATE TABLE public.mirox_comuni_istat (
  codice_istat text PRIMARY KEY CHECK (codice_istat ~ '^[0-9]{6}$'),
  nome text NOT NULL,
  provincia_sigla text NOT NULL CHECK (provincia_sigla ~ '^[A-Z]{2}$'),
  provincia_nome text NOT NULL,
  regione text NOT NULL,
  aggiornato_al date NOT NULL DEFAULT DATE '2026-02-21'
);

CREATE OR REPLACE FUNCTION public.kona_cd_staging_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profili_updated_at
BEFORE UPDATE ON public.profili
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_staging_touch_updated_at();
CREATE TRIGGER trg_anagrafica_updated_at
BEFORE UPDATE ON public.anagrafica
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_staging_touch_updated_at();
CREATE TRIGGER trg_appuntamenti_updated_at
BEFORE UPDATE ON public.appuntamenti
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_staging_touch_updated_at();
CREATE TRIGGER trg_chiamate_updated_at
BEFORE UPDATE ON public.chiamate
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_staging_touch_updated_at();
CREATE TRIGGER trg_call_center_lead_outbound_touch_updated_at
BEFORE UPDATE ON public.call_center_lead_outbound
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_staging_touch_updated_at();
CREATE TRIGGER trg_cclobc_touch_updated_at
BEFORE UPDATE ON public.call_center_lead_outbound_chiamate
FOR EACH ROW EXECUTE FUNCTION public.kona_cd_staging_touch_updated_at();

CREATE INDEX idx_profili_alias_di ON public.profili(alias_di) WHERE alias_di IS NOT NULL;
CREATE INDEX idx_anagrafica_cf_piva ON public.anagrafica(upper(cf_piva));
CREATE INDEX idx_blacklist_cf_piva ON public.blacklist(upper(cf_piva));
CREATE INDEX idx_appuntamenti_data_stato ON public.appuntamenti(data_ora, stato);
CREATE INDEX idx_chiamate_operatore ON public.chiamate(operatore_id);
CREATE INDEX idx_chiamate_rilavorazione ON public.chiamate(rilavorazione_stato, data_ricontatto)
  WHERE rilavorazione_stato = 'da_lavorare';
CREATE INDEX idx_call_center_lead_outbound_stato ON public.call_center_lead_outbound(stato_lead);
CREATE INDEX idx_call_center_lead_outbound_categoria ON public.call_center_lead_outbound(categoria);
CREATE INDEX idx_call_center_lead_outbound_followup ON public.call_center_lead_outbound(prossimo_followup_at);
CREATE INDEX idx_call_center_lead_outbound_attivita_lead
  ON public.call_center_lead_outbound_attivita(lead_id, created_at DESC);
CREATE INDEX cclobc_rilav_esito_data_lead_idx
  ON public.call_center_lead_outbound_chiamate(rilavorazione_stato, esito, data_ricontatto, lead_id);
CREATE INDEX mirox_comuni_istat_nome_prefix_idx
  ON public.mirox_comuni_istat(nome text_pattern_ops);

CREATE VIEW public.vw_rilavorazione_ricontatti_unificata
WITH (security_invoker = true) AS
SELECT
  'standard'::text AS origine_tipo,
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
FROM public.chiamate c
LEFT JOIN public.anagrafica a ON a.id = c.anagrafica_id
WHERE c.esito IN ('non_risposto', 'ricontattare')
  AND c.rilavorazione_stato = 'da_lavorare'
UNION ALL
SELECT
  'outbound_business'::text AS origine_tipo,
  o.id AS origine_id,
  o.lead_id,
  o.id AS chiamata_origine_id,
  COALESCE(l.ragione_sociale, o.ragione_sociale_snapshot) AS nome_cliente,
  COALESCE(l.ragione_sociale, o.ragione_sociale_snapshot) AS ragione_sociale_view,
  COALESCE(NULLIF(l.partita_iva, ''), NULLIF(l.codice_fiscale, '')) AS cf_piva,
  COALESCE(NULLIF(l.telefono_raw, ''), o.telefono_snapshot) AS telefono,
  o.operatore_id,
  o.operatore_nome,
  o.esito,
  o.note,
  NULL::text AS copertura,
  'Outbound business'::text AS motivo_chiamata,
  o.data_ora,
  COALESCE(o.data_ricontatto, (o.data_ora AT TIME ZONE 'Europe/Rome')::date) AS data_ricontatto,
  o.fascia_ricontatto,
  o.rilavorazione_stato
FROM public.call_center_lead_outbound_chiamate o
LEFT JOIN public.call_center_lead_outbound l ON l.id = o.lead_id
WHERE o.esito IN ('non_risposto', 'ricontattare')
  AND o.rilavorazione_stato = 'da_lavorare';

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'profili','anagrafica','blacklist','call_center_lead_outbound',
    'call_center_lead_outbound_attivita','call_center_lead_outbound_chiamate',
    'chiamate','appuntamenti','mirox_comuni_istat'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.vw_rilavorazione_ricontatti_unificata FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.vw_rilavorazione_ricontatti_unificata TO service_role;
REVOKE ALL ON FUNCTION public.kona_cd_staging_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_staging_touch_updated_at() TO service_role;

COMMENT ON SCHEMA public IS
  'Schema minimo di test KONA Call Director: struttura compatibile, nessun dato production.';

COMMIT;
