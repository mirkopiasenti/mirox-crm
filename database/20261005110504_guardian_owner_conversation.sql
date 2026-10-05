-- Memoria limitata della conversazione Telegram proprietario, server-only.
-- Additiva: nessuna tabella CRM/Call Center e nessun grant/RLS modificato.
BEGIN;
ALTER TABLE public.kona_ai_telegram_sessioni
  ADD COLUMN IF NOT EXISTS conversazione jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN public.kona_ai_telegram_sessioni.conversazione IS
  'Ultimi 30 messaggi proprietario/Guardian, ripuliti e con riferimenti opzionali agli incidenti. Nessun segreto.';
COMMIT;
