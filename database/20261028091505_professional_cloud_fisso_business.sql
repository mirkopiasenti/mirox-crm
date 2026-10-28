-- Estende lo scope Fisso Business senza aggiungere colonne o riscrivere lo storico.
BEGIN;
ALTER TABLE public.vendita_contratti
 ADD CONSTRAINT vendita_professional_cloud_business_coerenza CHECK (
   CASE WHEN professional_cloud IS NULL THEN professional_cloud_gestione IS NULL
   WHEN (categoria_snapshot IN ('Mobile','Fisso') AND cluster_cliente = 'Business') IS NOT TRUE THEN false
   WHEN professional_cloud = false THEN professional_cloud_gestione IS NULL
   ELSE professional_cloud_gestione IS NOT NULL AND professional_cloud_gestione IN ('Mantieni attiva','Richiedi disattivazione') END
 );
ALTER TABLE public.vendita_contratti DROP CONSTRAINT vendita_professional_cloud_coerenza;
COMMIT;
