-- Migration 072
-- Fondamenta server-only del modulo KONA Call Director.
--
-- KONA Call Director coordina la giornata dell'operatore autorizzato del
-- Call Center: conferme degli appuntamenti Business del giorno successivo,
-- ricontatti programmati, gestione "Passa a Cerea" / "Passa in negozio",
-- campagne urgenti approvate, attivita' standard, preparazione notturna dei
-- lead Business e pianificazione quotidiana con Mirko tramite un bot Telegram
-- separato da quello del Guardian. 22 tabelle server-only.
--
-- Regole:
--  * Migration additiva e reversibile: crea soltanto nuove tabelle, viste,
--    indici e funzioni; non modifica mai tabelle/RPC esistenti.
--  * Nessuna SECURITY DEFINER.
--  * Tutte le tabelle sono server-only: ENABLE ROW LEVEL SECURITY +
--    REVOKE ALL da PUBLIC/anon/authenticated + GRANT al solo service_role.
--    Il browser non accede mai direttamente: ogni operazione passa da
--    Netlify Functions con service role e controlli espliciti di identita'.
--  * Il prefisso kona_call_director_* e' dedicato: kona_ai_* e' occupato
--    dal Guardian.
--  * I prezzi seed in kona_call_director_config.prezzi_openai sono STIME
--    configurabili (mai hardcodate nella logica); vanno verificate contro
--    il progetto OpenAI dedicato prima di attivare i conti.

BEGIN;

-- =============================================================================
-- 1. Configurazione globale (singola riga id=1)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Interruttore globale di sicurezza: KONA nasce spento.
  attivo_globale boolean NOT NULL DEFAULT false,
  -- Prime due settimane in modalita' osservazione: nessun giudizio negativo.
  modalita_osservazione boolean NOT NULL DEFAULT true,
  -- Budget mensile OpenAI (dedicato al progetto KONA Call Director).
  budget_mensile_eur numeric(10,2) NOT NULL DEFAULT 50.00 CHECK (budget_mensile_eur >= 0),
  riserva_arricchimento_eur numeric(10,2) NOT NULL DEFAULT 40.00 CHECK (riserva_arricchimento_eur >= 0),
  riserva_dialogo_eur numeric(10,2) NOT NULL DEFAULT 10.00 CHECK (riserva_dialogo_eur >= 0),
  -- Modello OpenAI di default (override via env KONA_CALL_DIRECTOR_OPENAI_MODEL).
  modello_openai text NOT NULL DEFAULT 'gpt-5.6-luna',
  -- Stime costo per modello e per web_search. Formato:
  -- {"<modello>":{"input":x,"output":y,"web_search":z}}. Valori per 1M token
  -- e per ricerca. Configurabili da admin/SQL; se assenti costo 0 + warning.
  prezzi_openai jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Soglie percentuali di notifica budget su Telegram.
  soglie_budget jsonb NOT NULL DEFAULT '[70,85,95,100]'::jsonb,
  -- Giorni lavorativi (JS getDay: 1=Lun .. 5=Ven).
  giorni_lavorativi jsonb NOT NULL DEFAULT '[1,2,3,4,5]'::jsonb,
  -- Ferie/assenze configurate: array di date 'YYYY-MM-DD' (giornate non operative).
  ferie jsonb NOT NULL DEFAULT '[]'::jsonb,
  orario_mattina jsonb NOT NULL DEFAULT '{"inizio":"09:00","fine":"12:30"}'::jsonb,
  orario_pomeriggio jsonb NOT NULL DEFAULT '{"inizio":"15:30","fine":"19:00"}'::jsonb,
  -- Business standard bloccato a quest'ora (default 18:00).
  orario_stop_business text NOT NULL DEFAULT '18:00',
  -- Appuntamenti esterni Business.
  durata_appuntamento_minuti integer NOT NULL DEFAULT 45 CHECK (durata_appuntamento_minuti BETWEEN 10 AND 180),
  distanza_km_indicativa numeric(6,1) NOT NULL DEFAULT 20.0 CHECK (distanza_km_indicativa >= 0),
  -- Arricchimento notturno.
  richieste_web_max_per_lead integer NOT NULL DEFAULT 2 CHECK (richieste_web_max_per_lead BETWEEN 0 AND 10),
  lead_notte_obiettivo integer NOT NULL DEFAULT 50 CHECK (lead_notte_obiettivo >= 0),
  soglia_lead_minime integer NOT NULL DEFAULT 50 CHECK (soglia_lead_minime >= 0),
  -- Soglia di affidabilita' sotto cui un arricchimento NON viene applicato.
  soglia_affidabilita_arricchimento numeric(3,2) NOT NULL DEFAULT 0.60 CHECK (soglia_affidabilita_arricchimento BETWEEN 0 AND 1),
  orario_inizio_arricchimento text NOT NULL DEFAULT '02:00',
  -- Sequenza quotidiana Telegram.
  orario_report_sera text NOT NULL DEFAULT '19:10',
  orario_reminder_sera text NOT NULL DEFAULT '20:00',
  orario_reminder_mattina text NOT NULL DEFAULT '08:00',
  orario_piano_default text NOT NULL DEFAULT '08:30',
  -- Conferme appuntamenti del giorno successivo (orari Europe/Rome).
  conferme_ore jsonb NOT NULL DEFAULT '["09:00","11:30","15:30","18:00"]'::jsonb,
  -- Calendario Google.
  calendario_google_id text,
  giorni_orizzonte_calendario integer NOT NULL DEFAULT 14 CHECK (giorni_orizzonte_calendario BETWEEN 1 AND 60),
  orario_calendario_inizio text NOT NULL DEFAULT '08:30',
  orario_calendario_fine text NOT NULL DEFAULT '19:00',
  localita_riferimento text NOT NULL DEFAULT 'Legnago',
  localita_partenza text NOT NULL DEFAULT 'Casaleone',
  tempi_trasferta_minuti integer NOT NULL DEFAULT 15 CHECK (tempi_trasferta_minuti BETWEEN 0 AND 180),
  buffer_appuntamento_minuti integer NOT NULL DEFAULT 15 CHECK (buffer_appuntamento_minuti BETWEEN 0 AND 180),
  -- Tentativi normali per contatto (max 3, alternanza mattina/pomeriggio).
  tentativi_massimi integer NOT NULL DEFAULT 3 CHECK (tentativi_massimi BETWEEN 1 AND 10),
  -- Retention dati (giorni), cleanup idempotente programmato.
  retention_arricchimenti_giorni integer NOT NULL DEFAULT 180,
  retention_attivita_giorni integer NOT NULL DEFAULT 365,
  retention_aggregati_giorni integer NOT NULL DEFAULT 730,
  -- Rate limit per-ora sulle chiamate OpenAI a pagamento (fail-closed).
  max_chiamate_openai_ora integer NOT NULL DEFAULT 120 CHECK (max_chiamate_openai_ora >= 0),
  -- Notifiche immediate Telegram attive/false.
  notifiche_immediate jsonb NOT NULL DEFAULT '{"appuntamento_annullato":true,"quattro_non_risposti":true,"calendario_non_disponibile":true,"sync_fallito":true,"lead_sotto_soglia":true,"attivita_fuori_standard":true,"budget":true}'::jsonb,
  aggiornato_at timestamptz NOT NULL DEFAULT now(),
  aggiornato_da uuid REFERENCES public.profili(id) ON DELETE SET NULL
);

-- Seed iniziale: prezzi ufficiali OpenAI aggiornati al 2026-08-27 (GPT-5.6 Luna:
-- input $0.20/M token, output $1.20/M token, web search reasoning $10.00/1000
-- chiamate + token del contenuto). Configurabili da admin/SQL.
INSERT INTO public.kona_call_director_config (id, prezzi_openai, soglia_lead_minime)
VALUES (
  1,
  '{"gpt-5.6-luna":{"input":0.20,"output":1.20,"web_search":10.00}}'::jsonb,
  50
)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.kona_call_director_config IS
  'Configurazione globale KONA Call Director. Singola riga id=1, accesso server-only.';
COMMENT ON COLUMN public.kona_call_director_config.attivo_globale IS
  'Interruttore globale di sicurezza. KONA nasce disattivato: resta spento finche''
  un admin non lo abilita esplicitamente.';
COMMENT ON COLUMN public.kona_call_director_config.prezzi_openai IS
  'Stime di costo configurabili (mai hardcodate nella logica). Verificare contro il
  progetto OpenAI dedicato prima di attivare i conti.';

-- =============================================================================
-- 2. Accesso per profilo (nessun UUID hardcodato)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_profili (
  profilo_id uuid PRIMARY KEY REFERENCES public.profili(id) ON DELETE CASCADE,
  abilitato boolean NOT NULL DEFAULT false,
  in_osservazione boolean NOT NULL DEFAULT true,
  abilitato_at timestamptz,
  abilitato_da uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  ultimo_task_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kona_call_director_profili IS
  'Abilitazione KONA Call Director per singolo operatore (admin gestisce da UI).';

-- =============================================================================
-- 3. Piani giornalieri
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_piani (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  operatore_id uuid NOT NULL REFERENCES public.profili(id) ON DELETE CASCADE,
  stato text NOT NULL DEFAULT 'proposta' CHECK (stato IN ('proposta','approvato','applicato','scaduto')),
  contenuto jsonb NOT NULL DEFAULT '{}'::jsonb,
  sorgente text NOT NULL DEFAULT 'openai' CHECK (sorgente IN ('openai','default','mirko')),
  proposta_at timestamptz NOT NULL DEFAULT now(),
  approvata_at timestamptz,
  approvata_da uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  applicata_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data, operatore_id)
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_piani_data
  ON public.kona_call_director_piani(data DESC, operatore_id);

COMMENT ON TABLE public.kona_call_director_piani IS
  'Piano giornaliero proposto (OpenAI), approvato da Mirko via Telegram o applicato di default.';

-- =============================================================================
-- 4. Sessioni operative (mattina/pomeriggio)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_sessioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  operatore_id uuid NOT NULL REFERENCES public.profili(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('mattina','pomeriggio')),
  stato text NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva','chiusa')),
  categoria text,
  aperta_at timestamptz NOT NULL DEFAULT now(),
  chiusa_at timestamptz,
  note jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Una sola sessione per (data, operatore, tipo): il vincolo e' PIENO (non
-- parziale) cosi' l'ON CONFLICT (data, operatore_id, tipo) degli upsert del
-- backend trova un constraint corrispondente. La sessione transita da
-- 'attiva' a 'chiusa' nello stesso record.
CREATE UNIQUE INDEX IF NOT EXISTS ux_kona_call_director_sessioni_data_operatore_tipo
  ON public.kona_call_director_sessioni(data, operatore_id, tipo);

COMMENT ON TABLE public.kona_call_director_sessioni IS
  'Sessione mattina/pomeriggio dell''operatore. Una sola attiva per tipo/giorno.';

-- =============================================================================
-- 5. Task operativi (un contatto alla volta)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  operatore_id uuid NOT NULL REFERENCES public.profili(id) ON DELETE CASCADE,
  posizione integer NOT NULL CHECK (posizione >= 0),
  tipo text NOT NULL CHECK (tipo IN (
    'conferma_appuntamento_business',
    'ricontatto_programmato',
    'auto_non_risposto',
    'passa_a_cerea',
    'passa_in_negozio',
    'campagna_urgente',
    'sessione_business',
    'enrichment_review'
  )),
  sorgente_id uuid,
  sorgente_tipo text,
  descrizione text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  stato text NOT NULL DEFAULT 'in_coda' CHECK (stato IN ('in_coda','attivo','completato','annullato','sospeso')),
  esito jsonb,
  tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi >= 0),
  lease_until timestamptz,
  lease_owner text,
  assegnato_at timestamptz,
  completato_at timestamptz,
  creato_da uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Un solo task LAVORABILE per operatore (attivo O sospeso): lease atomico per
-- "un contatto alla volta". La sospensione non crea mai task multipli e la
-- ripresa e' deterministica (ne esiste uno solo).
CREATE UNIQUE INDEX IF NOT EXISTS ux_kona_call_director_task_attivo
  ON public.kona_call_director_task(operatore_id)
  WHERE stato IN ('attivo','sospeso');

CREATE INDEX IF NOT EXISTS idx_kona_call_director_task_coda
  ON public.kona_call_director_task(operatore_id, data, posizione)
  WHERE stato IN ('in_coda','attivo','sospeso');

COMMENT ON TABLE public.kona_call_director_task IS
  'Task materializzati dalla priorita'' 1..7. L''indice unico parziale su
  stato IN (attivo, sospeso) garantisce un solo task lavorabile per operatore:
  il contatto successivo viene sbloccato solo dopo un esito valido del
  precedente. lease_until/lease_owner permettono il recupero dei task orfani.';
COMMENT ON COLUMN public.kona_call_director_task.sorgente_id IS
  'Riferimento polimorfico al record sorgente (chiamata, lead outbound, appuntamento).';
COMMENT ON COLUMN public.kona_call_director_task.lease_until IS
  'Scadenza del lease di lavorazione: oltre, il task puo'' essere reclamato/scaduto.';
COMMENT ON COLUMN public.kona_call_director_task.lease_owner IS
  'Owner del lease (engine/operatore/dispatcher) per il recupero dei task orfani.';

-- =============================================================================
-- 6. Eventi/audit dei task
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_task_eventi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.kona_call_director_task(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('materializzazione','esito','blacklist','esclusione','skip','sblocco','errore','nota')),
  dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_task_eventi_task
  ON public.kona_call_director_task_eventi(task_id, created_at);

-- =============================================================================
-- 7. Arricchimento notturno lead Business
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_arricchimenti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.call_center_lead_outbound(id) ON DELETE CASCADE,
  data date NOT NULL,
  stato text NOT NULL DEFAULT 'ok' CHECK (stato IN ('ok','parziale','fallito','saltato')),
  ricerca_ordine jsonb NOT NULL DEFAULT '[]'::jsonb,
  valori_estratti jsonb NOT NULL DEFAULT '{}'::jsonb,
  valori_applicati jsonb NOT NULL DEFAULT '{}'::jsonb,
  affidabilita numeric(3,2) CHECK (affidabilita >= 0 AND affidabilita <= 1),
  valore_lead numeric(6,2) CHECK (valore_lead >= 0),
  fonte_utilizzata text,
  errore text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, data)
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_arricchimenti_data
  ON public.kona_call_director_arricchimenti(data DESC);

CREATE TABLE IF NOT EXISTS public.kona_call_director_arricchimento_fonti (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arricchimento_id uuid NOT NULL REFERENCES public.kona_call_director_arricchimenti(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('web_search','url')),
  url text,
  titolo text,
  data_lettura date NOT NULL,
  affidabilita numeric(3,2) CHECK (affidabilita >= 0 AND affidabilita <= 1),
  valore text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_fonti_arricchimento
  ON public.kona_call_director_arricchimento_fonti(arricchimento_id);

COMMENT ON TABLE public.kona_call_director_arricchimenti IS
  'Risultato dell''arricchimento notturno di un lead Business. Mai sovrascrivere
  valori gia'' presenti: vengono applicati soltanto campi vuoti ad alta confidenza.';

-- =============================================================================
-- 8. Appuntamenti esterni Business (stato Google + conferme)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_appuntamenti_business (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appuntamento_id uuid REFERENCES public.appuntamenti(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.call_center_lead_outbound(id) ON DELETE SET NULL,
  anagrafica_id uuid REFERENCES public.anagrafica(id) ON DELETE SET NULL,
  operatore_id uuid NOT NULL REFERENCES public.profili(id) ON DELETE CASCADE,
  data_ora timestamptz NOT NULL,
  durata_minuti integer NOT NULL DEFAULT 45 CHECK (durata_minuti BETWEEN 10 AND 180),
  zona text,
  stato text NOT NULL DEFAULT 'proposto' CHECK (stato IN ('proposto','confermato','annullato','da_riprogrammare','concluso','non_risposto')),
  esito jsonb NOT NULL DEFAULT '{}'::jsonb,
  google_event_id text,
  sync_stato text NOT NULL DEFAULT 'non_sincronizzato' CHECK (sync_stato IN ('non_sincronizzato','sincronizzato','da_recuperare','errore')),
  sync_dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  creato_da uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  creato_at timestamptz NOT NULL DEFAULT now(),
  riprogrammato_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_cd_appuntamenti_business_data
  ON public.kona_call_director_appuntamenti_business(data_ora);
CREATE INDEX IF NOT EXISTS idx_kona_cd_appuntamenti_business_lead
  ON public.kona_call_director_appuntamenti_business(lead_id);
CREATE INDEX IF NOT EXISTS idx_kona_cd_appuntamenti_business_zona
  ON public.kona_call_director_appuntamenti_business(zona, data_ora);
CREATE INDEX IF NOT EXISTS idx_kona_cd_appuntamenti_business_sync
  ON public.kona_call_director_appuntamenti_business(sync_stato)
  WHERE sync_stato IN ('da_recuperare','errore');

COMMENT ON TABLE public.kona_call_director_appuntamenti_business IS
  'Appuntamenti esterni Business creati da KONA. La riga speculare in
  appuntamenti resta la fonte per il CC; qui vivono stato Google, conferme e sync.';

-- =============================================================================
-- 9. Tentativi di conferma appuntamenti Business
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_conferme (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appuntamento_business_id uuid NOT NULL REFERENCES public.kona_call_director_appuntamenti_business(id) ON DELETE CASCADE,
  data date NOT NULL,
  orario_previsto text NOT NULL,
  tentativo integer NOT NULL DEFAULT 1 CHECK (tentativo >= 1),
  esito text CHECK (esito IN ('confermato','non_risposto','annullato','da_riprogrammare','errore')),
  esito_at timestamptz,
  dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appuntamento_business_id, data, orario_previsto)
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_conferme_business
  ON public.kona_call_director_conferme(appuntamento_business_id, data);

-- =============================================================================
-- 10. Esclusioni permanenti
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_esclusioni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.call_center_lead_outbound(id) ON DELETE SET NULL,
  anagrafica_id uuid REFERENCES public.anagrafica(id) ON DELETE SET NULL,
  chiamata_id uuid REFERENCES public.chiamate(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('trattative_in_corso','gia_cliente_windtre','altro','manuale')),
  motivo text,
  dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  escluso_da uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  escluso_at timestamptz NOT NULL DEFAULT now(),
  stato text NOT NULL DEFAULT 'attiva' CHECK (stato IN ('attiva','revocata')),
  revocata_at timestamptz,
  revocata_da uuid REFERENCES public.profili(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_esclusioni_attive
  ON public.kona_call_director_esclusioni(stato, lead_id, anagrafica_id, chiamata_id)
  WHERE stato = 'attiva';

COMMENT ON TABLE public.kona_call_director_esclusioni IS
  'Esclusioni permanenti: "trattative in corso" (record conservato), "gia'' cliente
  WindTre" (lista dedicata futura), skip motivato "altro" registrato come da verificare.';

-- =============================================================================
-- 11. Registro budget OpenAI locale
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_budget_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data date NOT NULL,
  mese text NOT NULL,
  attivita text NOT NULL CHECK (attivita IN ('arricchimento','dialogo','piano','analisi','altro')),
  modello text,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  web_ricerche integer NOT NULL DEFAULT 0 CHECK (web_ricerche >= 0),
  costo_stimato_eur numeric(12,6) NOT NULL DEFAULT 0 CHECK (costo_stimato_eur >= 0),
  dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_budget_mese
  ON public.kona_call_director_budget_log(mese, data);
CREATE INDEX IF NOT EXISTS idx_kona_call_director_budget_attivita
  ON public.kona_call_director_budget_log(attivita, data);

COMMENT ON TABLE public.kona_call_director_budget_log IS
  'Registro locale di ogni chiamata OpenAI: attivita'', modello, token, ricerche
  web e costo stimato. Nessun prezzo hardcodato nella logica: le stime sono in
  kona_call_director_config.prezzi_openai.';

-- =============================================================================
-- 12. Stato conversazione Telegram (bot separato dal Guardian)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_telegram (
  chat_id text PRIMARY KEY,
  stato_conversazione jsonb NOT NULL DEFAULT '{}'::jsonb,
  ultimo_update_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kona_call_director_notifiche (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  stato text NOT NULL DEFAULT 'in_coda' CHECK (stato IN ('in_coda','in_invio','inviata','fallita','morta')),
  tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi >= 0),
  prossimo_tentativo_at timestamptz NOT NULL DEFAULT now(),
  ultimo_errore text,
  inviata_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_notifiche_coda
  ON public.kona_call_director_notifiche(stato, prossimo_tentativo_at)
  WHERE stato IN ('in_coda','fallita');

COMMENT ON TABLE public.kona_call_director_notifiche IS
  'Outbox Telegram di KONA Call Director: nessun dato personale nel payload,
  retry backoff 1/5/15/60 min, morta dopo 8 tentativi.';

-- =============================================================================
-- 13. Credenziali calendario Google (token cifrato, mai in chiaro)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_google_token (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refresh_token_cipher text,
  token_iv text,
  token_tag text,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  collegato_at timestamptz,
  collegato_da uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  ultimo_sync_at timestamptz,
  ultimo_sync_esito text
);

COMMENT ON TABLE public.kona_call_director_google_token IS
  'Refresh token Google cifrato (AES-256-GCM, chiave da env separata
  KONA_CALL_DIRECTOR_GOOGLE_TOKEN_KEY). Solo connessione admin.';

-- =============================================================================
-- 14. Job e lease (arricchimento, sync, retention, retry Telegram)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('arricchimento_batch','recupero_sync_google','retention','telegram_retry')),
  stato text NOT NULL DEFAULT 'in_coda' CHECK (stato IN ('in_coda','in_corso','completato','fallito','annullato')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  risultato jsonb NOT NULL DEFAULT '{}'::jsonb,
  lease_until timestamptz,
  lease_owner text,
  tentativi integer NOT NULL DEFAULT 0 CHECK (tentativi >= 0),
  prossimo_tentativo_at timestamptz NOT NULL DEFAULT now(),
  creato_at timestamptz NOT NULL DEFAULT now(),
  completato_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_jobs_coda
  ON public.kona_call_director_jobs(stato, prossimo_tentativo_at)
  WHERE stato IN ('in_coda','fallita');

COMMENT ON TABLE public.kona_call_director_jobs IS
  'Job a lunga esecuzione con lease atomico (UPDATE condizionale) e retry/backoff.
  Il dispatcher non esegue mai lavoro lungo in linea.';

-- =============================================================================
-- 15. Registro esecuzioni programmate (idempotenza data+evento)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_esecuzioni_programmate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chiave text UNIQUE NOT NULL,
  data date NOT NULL,
  evento text NOT NULL,
  eseguita_at timestamptz NOT NULL DEFAULT now(),
  esito jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_esecuzioni_data
  ON public.kona_call_director_esecuzioni_programmate(data, evento);

COMMENT ON TABLE public.kona_call_director_esecuzioni_programmate IS
  'Registry di idempotenza per gli eventi schedulati: una sola esecuzione per
  chiave data+evento. Il dispatcher gira ogni 5 minuti ed esegue ogni evento
  al massimo una volta.';

-- =============================================================================
-- 16. Coordinate comuni (per distanze; tabella vuota in attesa di import)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_comuni (
  codice_istat text PRIMARY KEY REFERENCES public.mirox_comuni_istat(codice_istat) ON DELETE CASCADE,
  nome text NOT NULL,
  provincia_sigla text NOT NULL,
  lat numeric(10,6) NOT NULL,
  lon numeric(10,6) NOT NULL,
  sorgente text,
  licenza text,
  importata_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_comuni_nome
  ON public.kona_call_director_comuni(nome, provincia_sigla);

COMMENT ON TABLE public.kona_call_director_comuni IS
  'Coordinate dei centri dei comuni da dataset pubblico autoritativo con
  licenza/attribuzione (import pendente, vedi docs). Fino ad allora il modulo
  usa il fallback: priorita'' stesso comune + nota "distanza non disponibile".';

-- =============================================================================
-- 17. Prenotazioni budget OpenAI (atomiche, hard stop concorrenza sicura)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_budget_riserve (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chiave text UNIQUE NOT NULL,
  mese text NOT NULL,
  attivita text NOT NULL DEFAULT 'altro',
  importo_eur numeric(12,6) NOT NULL DEFAULT 0 CHECK (importo_eur >= 0),
  stato text NOT NULL DEFAULT 'riservato' CHECK (stato IN ('riservato','consumato','liberato')),
  scadenza timestamptz NOT NULL,
  creato_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_budget_riserve_attive
  ON public.kona_call_director_budget_riserve(mese, stato, scadenza)
  WHERE stato = 'riservato';

COMMENT ON TABLE public.kona_call_director_budget_riserve IS
  'Prenotazioni ATOMICHE del budget OpenAI: il dispatcher/engine prenota il
  costo potenziale PRIMA della chiamata (advisory lock sul mese), il costo
  reale finisce in budget_log e la riserva viene liberata. Scadenza 10 minuti.';

-- =============================================================================
-- 18. Numeri di telefono multipli dei lead (arricchimento)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_lead_telefoni (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.call_center_lead_outbound(id) ON DELETE CASCADE,
  telefono text NOT NULL,
  telefono_norm text,
  fonte text,
  affidabilita numeric(3,2) CHECK (affidabilita >= 0 AND affidabilita <= 1),
  inserito_manualmente boolean NOT NULL DEFAULT false,
  creato_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, telefono)
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_lead_telefoni_lead
  ON public.kona_call_director_lead_telefoni(lead_id);

COMMENT ON TABLE public.kona_call_director_lead_telefoni IS
  'Numeri aggiuntivi dei lead Business raccolti dall''arricchimento (fonte,
  data e affidabilita''). telefono_norm viene mantenuto in sync col trigger
  esistente su call_center_lead_outbound: qui salviamo anche numeri che non
  possono stare nel campo singolo della tabella condivisa.';

-- =============================================================================
-- 19. Nonce OAuth (single-use per lo state della connessione Google)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_oauth_stati (
  nonce text PRIMARY KEY,
  usato_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kona_call_director_oauth_stati IS
  'Nonce OAuth gia'' consumati: rende lo state single-use (anti replay).';

-- =============================================================================
-- 20. Audit azioni amministrative e decisioni
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kona_call_director_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  azione text NOT NULL,
  dettagli jsonb NOT NULL DEFAULT '{}'::jsonb,
  autore uuid REFERENCES public.profili(id) ON DELETE SET NULL,
  creato_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kona_call_director_audit_azione
  ON public.kona_call_director_audit(azione, creato_at);

COMMENT ON TABLE public.kona_call_director_audit IS
  'Audit delle modifiche di configurazione, toggle globali, abilitazioni
  profilo e approvazioni (chi, cosa, quando). Nessun dato personale cliente.';

-- =============================================================================
-- Trigger updated_at
-- =============================================================================

CREATE OR REPLACE FUNCTION public.kona_call_director_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kona_cd_config_updated_at ON public.kona_call_director_config;
CREATE TRIGGER trg_kona_cd_config_updated_at
BEFORE UPDATE ON public.kona_call_director_config
FOR EACH ROW EXECUTE FUNCTION public.kona_call_director_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_cd_profili_updated_at ON public.kona_call_director_profili;
CREATE TRIGGER trg_kona_cd_profili_updated_at
BEFORE UPDATE ON public.kona_call_director_profili
FOR EACH ROW EXECUTE FUNCTION public.kona_call_director_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_cd_piani_updated_at ON public.kona_call_director_piani;
CREATE TRIGGER trg_kona_cd_piani_updated_at
BEFORE UPDATE ON public.kona_call_director_piani
FOR EACH ROW EXECUTE FUNCTION public.kona_call_director_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_cd_task_updated_at ON public.kona_call_director_task;
CREATE TRIGGER trg_kona_cd_task_updated_at
BEFORE UPDATE ON public.kona_call_director_task
FOR EACH ROW EXECUTE FUNCTION public.kona_call_director_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_cd_appuntamenti_business_updated_at ON public.kona_call_director_appuntamenti_business;
CREATE TRIGGER trg_kona_cd_appuntamenti_business_updated_at
BEFORE UPDATE ON public.kona_call_director_appuntamenti_business
FOR EACH ROW EXECUTE FUNCTION public.kona_call_director_touch_updated_at();

DROP TRIGGER IF EXISTS trg_kona_cd_telegram_updated_at ON public.kona_call_director_telegram;
CREATE TRIGGER trg_kona_cd_telegram_updated_at
BEFORE UPDATE ON public.kona_call_director_telegram
FOR EACH ROW EXECUTE FUNCTION public.kona_call_director_touch_updated_at();

-- =============================================================================
-- Sicurezza: RLS + revoche + grant service_role
-- =============================================================================

ALTER TABLE public.kona_call_director_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_profili ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_piani ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_sessioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_task ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_task_eventi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_arricchimenti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_arricchimento_fonti ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_appuntamenti_business ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_conferme ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_esclusioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_budget_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_telegram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_notifiche ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_google_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_esecuzioni_programmate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_comuni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_budget_riserve ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_lead_telefoni ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_oauth_stati ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kona_call_director_audit ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'kona_call_director_config',
    'kona_call_director_profili',
    'kona_call_director_piani',
    'kona_call_director_sessioni',
    'kona_call_director_task',
    'kona_call_director_task_eventi',
    'kona_call_director_arricchimenti',
    'kona_call_director_arricchimento_fonti',
    'kona_call_director_appuntamenti_business',
    'kona_call_director_conferme',
    'kona_call_director_esclusioni',
    'kona_call_director_budget_log',
    'kona_call_director_telegram',
    'kona_call_director_notifiche',
    'kona_call_director_google_token',
    'kona_call_director_jobs',
    'kona_call_director_esecuzioni_programmate',
    'kona_call_director_comuni',
    'kona_call_director_budget_riserve',
    'kona_call_director_lead_telefoni',
    'kona_call_director_oauth_stati',
    'kona_call_director_audit'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated;', t);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role;', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.kona_call_director_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_call_director_touch_updated_at() TO service_role;

-- =============================================================================
-- RPC advisory lock per la ri-verifica slot prima della conferma finale
-- =============================================================================
-- Trasforma la chiave in un advisory lock di transazione (pg_try_*):
-- se due conferme concorrenti cercano lo stesso slot, solo una vince.
-- Nessun accesso a tabelle: niente SECURITY DEFINER necessario.

CREATE OR REPLACE FUNCTION public.kona_cd_try_advisory_lock(p_chiave text)
RETURNS boolean
LANGUAGE sql
SET search_path = public
AS $$
  SELECT pg_try_advisory_xact_lock(hashtextextended(p_chiave, 0));
$$;

REVOKE ALL ON FUNCTION public.kona_cd_try_advisory_lock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_try_advisory_lock(text) TO service_role;

-- =============================================================================
-- RPC prenotazione slot Business (atomica e concorrenza sicura)
-- =============================================================================
-- Advisory lock di transazione + ricontrollo conflitti (Mirox + condiviso) +
-- INSERT nella STESSA transazione. Il lock NON viene rilasciato prima
-- dell'INSERT (a differenza di una chiamata RPC separata dal client).
-- Nessun SECURITY DEFINER: invocata dal service role che ha gia' i grant.

CREATE OR REPLACE FUNCTION public.kona_cd_prenota_slot_v1(
  p_lead_id uuid,
  p_operatore_id uuid,
  p_data_ora timestamptz,
  p_durata_minuti integer DEFAULT 45,
  p_zona text DEFAULT NULL,
  p_buffer_minuti integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_chiave text;
  v_bs timestamptz;
  v_be timestamptz;
  v_conflitto boolean;
  v_id uuid;
BEGIN
  v_chiave := 'kona_cd_slot_' || to_char(p_data_ora AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  IF NOT pg_try_advisory_xact_lock(hashtextextended(v_chiave, 0)) THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'lock');
  END IF;

  v_bs := p_data_ora - make_interval(mins => COALESCE(p_buffer_minuti, 15));
  v_be := p_data_ora + make_interval(mins => COALESCE(p_durata_minuti, 45) + COALESCE(p_buffer_minuti, 15));

  SELECT EXISTS (
    SELECT 1 FROM kona_call_director_appuntamenti_business b
    WHERE b.operatore_id = p_operatore_id
      AND b.stato IN ('proposto','confermato','da_riprogrammare')
      AND b.data_ora < v_be
      AND b.data_ora + make_interval(mins => COALESCE(b.durata_minuti, 45)) > v_bs
  ) OR EXISTS (
    SELECT 1 FROM appuntamenti a
    WHERE a.fissato_da_operatore_id = p_operatore_id
      AND a.stato IN ('confermato','rischedulato')
      AND a.data_ora < v_be
      AND a.data_ora + make_interval(mins => COALESCE(a.durata_minuti, 30)) > v_bs
  ) INTO v_conflitto;

  IF v_conflitto THEN
    RETURN jsonb_build_object('ok', false, 'motivo', 'conflitto');
  END IF;

  INSERT INTO kona_call_director_appuntamenti_business
    (lead_id, operatore_id, data_ora, durata_minuti, zona, stato, sync_stato, creato_at)
  VALUES
    (p_lead_id, p_operatore_id, p_data_ora, COALESCE(p_durata_minuti, 45), p_zona, 'proposto', 'non_sincronizzato', now())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.kona_cd_prenota_slot_v1(uuid, uuid, timestamptz, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kona_cd_prenota_slot_v1(uuid, uuid, timestamptz, integer, text, integer) TO service_role;


COMMIT;
