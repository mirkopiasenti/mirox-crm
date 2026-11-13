-- Solo catalogo pagine: nessuna assegnazione implicita o modifica a CC/anagrafica.
-- CLI migration new tentata, non disponibile per EPERM sul profilo/telemetria.
-- Applicare prima del frontend compatibile, dopo autorizzazione al rilascio.
BEGIN;
INSERT INTO public.mirox_pagine(chiave,etichetta,reparto,percorso)
VALUES ('compilatore_malpractis','Compilatore Malpractis','Applicazioni','moduli/compilatore_malpractis.html')
ON CONFLICT (chiave) DO NOTHING;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mirox_pagine
    WHERE chiave='compilatore_malpractis' AND etichetta='Compilatore Malpractis'
      AND reparto='Applicazioni' AND percorso='moduli/compilatore_malpractis.html') THEN
    RAISE EXCEPTION 'Configurazione Malpractis discordante: nessuna sovrascrittura';
  END IF;
END $$;
COMMIT;
