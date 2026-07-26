# Revisione privacy tecnica — 26 luglio 2026

## Scopo e limite

Questa revisione migliora il testo e il flusso del CRM sulla base del GDPR e delle fonti ufficiali disponibili. È una revisione tecnico-documentale, non un parere legale e non sostituisce la validazione di un avvocato o consulente privacy che conosca i rapporti contrattuali effettivi di Kona Tech.

La versione PDF risultante è `v2_2026_07_26`.

## Correzioni implementate

- La durata massima del riutilizzo è ridotta da 48 a **24 mesi** sia per OTP sia per cartaceo. La migration `055`, applicata su production il 26 luglio 2026, ha accorciato anche i 170 record già confermati che eccedevano il nuovo termine; nessuno è scaduto immediatamente.
- La presa visione dell'informativa non viene più descritta come un “consenso obbligatorio”. Contratto, obblighi di legge, assistenza e sicurezza hanno basi giuridiche distinte; il consenso resta facoltativo per il marketing.
- Il consenso marketing indica finalità, canali (SMS, email e chiamata), durata massima di 24 mesi e revoca anche per singolo canale.
- Sono state distinte le categorie di dati, le finalità e le basi giuridiche; sono descritti destinatari, possibili trasferimenti extra SEE, tempi di conservazione e diritti dell'interessato.
- L'OCR tramite Anthropic è dichiarato come supporto alla trascrizione con verifica umana e senza decisione esclusivamente automatizzata con effetti significativi.
- Il flusso OTP è descritto come registrazione elettronica della dichiarazione e delle relative evidenze. Non è qualificato come firma elettronica qualificata né come automaticamente equivalente alla firma autografa.
- Il PDF contiene tre pagine numerate, versione dell'informativa, dati cliente, scelta marketing e metadati probatori o spazio per la firma cartacea.

## Decisioni da far validare prima di considerare il testo definitivo

1. **Titolare e ruoli privacy**: confermare che `KONA TECH S.r.l.` sia titolare per tutti i trattamenti descritti e definire il ruolo dei partner WindTre, energia, sicurezza e assicurazioni nei rispettivi flussi.
2. **DPO/RPD**: verificare se ne sia stato formalmente designato uno. Il testo attuale non attribuisce il ruolo a nessuna persona e rinvia alla pubblicazione dei recapiti in caso di designazione.
3. **Responsabili e sub-responsabili**: verificare contratti ex art. 28 GDPR con Supabase, Netlify, Anthropic, Smshosting, Google/SMTP e gli eventuali fornitori di assistenza.
4. **Trasferimenti internazionali**: verificare regioni effettive, Data Processing Addendum, clausole contrattuali standard, misure supplementari e informative dei fornitori. Il testo usa una formula generale perché la configurazione contrattuale effettiva non è deducibile dal codice.
5. **Conservazione e cancellazione**: approvare i termini indicati (10 anni per dati contrattuali/amministrativi, massimo 24 mesi marketing, di regola 12 mesi per log tecnici, fino a 10 anni per evidenze) e tradurli in una policy operativa di cancellazione/anomizzazione. Il CRM non dispone ancora di una cancellazione automatica completa dei documenti privacy a fine retention.
6. **Revoca**: indicare all'interessato canali realmente presidiati e garantire che la revoca marketing sia registrata ed eseguita su tutti i sistemi. Oggi esistono colonne DB di revoca ma manca una UI amministrativa dedicata.
7. **Art. 14 GDPR**: verificare per quali dati provenienti da partner anziché direttamente dall'interessato servano informazioni aggiuntive e con quali tempi.
8. **Evidenza OTP**: validare il processo operativo (identificazione del cliente, consegna dell'OTP, log, integrità, accessi e contestazioni). L'art. 25(1) eIDAS impedisce di negare effetti alla forma elettronica solo per tale forma, ma il valore probatorio concreto resta valutato in base al processo e alle circostanze.

## Fonti ufficiali usate

- [Regolamento (UE) 2016/679 — GDPR, in particolare artt. 5, 6, 7, 13, 14, 15-22, 28, 32 e 44-49](https://eur-lex.europa.eu/eli/reg/2016/679/oj/ita)
- [EDPB — trattare dati personali lecitamente](https://www.edpb.europa.eu/sme-data-protection-guide/process-personal-data-lawfully_it)
- [EDPB — Linee guida 05/2020 sul consenso](https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en)
- [Garante — Linee guida in materia di attività promozionale e contrasto allo spam](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/2543820)
- [Garante — provvedimento su informativa, consenso e marketing](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/8981258)
- [Regolamento eIDAS consolidato — art. 25](https://eur-lex.europa.eu/eli/reg/2014/910/2024-10-18)
- [Corte di giustizia UE — valore probatorio e verifica della firma elettronica](https://eur-lex.europa.eu/legal-content/it/TXT/?uri=CELEX%3A62023CJ0302)
- [Anthropic Privacy Center — conservazione dei dati commerciali/API](https://privacy.anthropic.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)
- [Anthropic Privacy Center — ubicazione dei server](https://privacy.anthropic.com/en/articles/7996890-where-are-your-servers-located-do-you-host-your-models-on-eu-servers)
- [Anthropic Privacy Center — ruolo di responsabile/titolare](https://privacy.anthropic.com/en/articles/9267385-does-anthropic-act-as-a-data-processor-or-controller)
