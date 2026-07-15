-- Migration 048 — Aggiunge il valore "Seconda Casa" alla lista convergenze ammesse
-- per i contratti Fisso. Estende il CHECK constraint di vendita_contratti.convergenza.
--
-- Motivazione: richiesto da operatori per censire i contratti Fisso attivati
-- come seconda linea/seconda casa dello stesso cliente, distinguendoli dalle
-- convergenze commerciali tradizionali.
--
-- Effetto: nessun impatto sui contratti storici (i vecchi valori restano validi).

ALTER TABLE vendita_contratti
  DROP CONSTRAINT IF EXISTS vendita_contratti_convergenza_chk;

ALTER TABLE vendita_contratti
  ADD CONSTRAINT vendita_contratti_convergenza_chk
  CHECK (
    convergenza IS NULL
    OR convergenza = ANY (ARRAY[
      'Mobile',
      'L&G',
      'Allarme',
      'Assicurazione',
      'Sim Interna',
      'NO Convergenza',
      'Coupon',
      'Seconda Casa'
    ])
  );
