-- Migration 049 — Bonus configurabile per Assicurazioni con ricorrenza Annuale
--
-- Business rule: quando un contratto Assicurazioni viene salvato con
-- ricorrenza_assicurazione='Annuale', il backend somma un bonus fisso al
-- campo punteggio_gara_opzione del contratto. L'ammontare del bonus e'
-- configurabile da Admin -> Configurazione Vendita (chiave key/value in
-- tabella impostazioni).
--
-- Perche' nel backend e non nel trigger DB:
-- - il valore si applica alla creazione (INSERT) del contratto e resta li'
-- - non deve retroagire su contratti storici se l'admin cambia il valore
-- - il trigger vendita_calcola_punteggio_totale gia' somma opzione+offerta
--   → basta caricare opzione gia' maggiorato dal backend
--
-- Default iniziale 0.5, come richiesto dal proprietario.

INSERT INTO impostazioni (chiave, valore, descrizione)
VALUES (
  'bonus_assicurazione_annuale',
  '0.5',
  'Bonus (in punti gara) sommato al punteggio_gara_opzione dei contratti Assicurazioni con ricorrenza Annuale. Applicato dal backend crea-vendita-pratica-carrello alla creazione della pratica. Editabile da Admin -> Configurazione Vendita.'
)
ON CONFLICT (chiave) DO UPDATE
  SET descrizione = EXCLUDED.descrizione,
      updated_at = now();
