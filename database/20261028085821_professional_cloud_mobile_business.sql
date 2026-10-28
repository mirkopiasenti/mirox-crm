-- Due dati nullable: presenza opzione e intenzione cliente, senza azioni esterne.
BEGIN;
ALTER TABLE public.vendita_contratti
 ADD COLUMN professional_cloud boolean,
 ADD COLUMN professional_cloud_gestione text,
 ADD CONSTRAINT vendita_professional_cloud_coerenza CHECK (
   CASE WHEN professional_cloud IS NULL THEN professional_cloud_gestione IS NULL
   WHEN (categoria_snapshot = 'Mobile' AND cluster_cliente = 'Business') IS NOT TRUE THEN false
   WHEN professional_cloud = false THEN professional_cloud_gestione IS NULL
   ELSE professional_cloud_gestione IS NOT NULL AND professional_cloud_gestione IN ('Mantieni attiva','Richiedi disattivazione') END
 );
COMMENT ON COLUMN public.vendita_contratti.professional_cloud_gestione IS
 'Intenzione del cliente; Richiedi disattivazione non certifica una disattivazione eseguita.';
COMMIT;
