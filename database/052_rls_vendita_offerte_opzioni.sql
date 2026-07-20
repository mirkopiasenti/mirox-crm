-- Migration 052 — RLS SELECT authenticated su vendita_offerte_opzioni
--
-- Contesto: la tabella pivot vendita_offerte_opzioni aveva RLS abilitato ma
-- zero policy → deny all per il client authenticated. Effetto: la Verifica
-- Contratti (che va diretta al DB per compilare la dropdown "Opzione" del
-- popup di modifica) riceveva sempre array vuoto e la dropdown veniva
-- nascosta, anche quando l'offerta aveva opzioni associate (es. FTTH
-- Business con "2° Linea").
--
-- Il wizard Upload Contratti non era impattato perché legge le associazioni
-- via Netlify function vendita-config (service_role bypassa RLS).
--
-- Allineamento al pattern delle altre tabelle catalogo (vendita_categorie,
-- vendita_offerte, vendita_opzioni, vendita_reload) che hanno tutte una
-- policy `auth_select_<tablename>` per authenticated in SELECT.
--
-- Modifica additiva, safe: aggiunge lettura ma non permette scritture (le
-- scritture continuano a passare da admin-vendita-config Netlify function).

CREATE POLICY auth_select_vendita_offerte_opzioni
  ON public.vendita_offerte_opzioni
  FOR SELECT
  TO authenticated
  USING (true);
