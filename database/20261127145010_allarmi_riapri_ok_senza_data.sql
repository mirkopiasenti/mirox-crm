-- Applicare dopo la pubblicazione del flusso con data e la copia privata
-- degli esiti preesistenti. In Attivazione è mostrato come In Attesa.
BEGIN;

UPDATE public.post_vendita_controllo_allarmi
   SET stato = 'In Attivazione',
       stato_cambiato_at = statement_timestamp(),
       stato_cambiato_da = NULL
 WHERE stato = 'OK'
   AND data_attivazione IS NULL;

ALTER TABLE public.post_vendita_controllo_allarmi
  VALIDATE CONSTRAINT pvcal_data_attivazione_chk;

COMMIT;
