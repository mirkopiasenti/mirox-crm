# Audit sicurezza frontend e infrastruttura — 26 luglio 2026

## Esito

L'audit ha corretto i principali punti in cui dati provenienti da database, input o Storage venivano interpolati direttamente in HTML dinamico o handler inline. È stato introdotto `window.MiroxSafe`, caricato da tutte le pagine, con codifica HTML e validazione di URL, identificatori e colori.

Interventi principali:

- rimossi record JSON completi dagli `onclick` di Rimborsi e Appuntamenti;
- sostituiti handler costruiti con nomi/path Storage in Segnalazioni, Protecta, Apri/Chiudi e Switch SIM;
- codificati dati cliente, errori backend, nomi file, badge e attributi dinamici nei moduli operativi;
- form pubblico appuntamenti riscritto con nodi DOM, `textContent` e listener;
- identità del profilo autenticato aggiunta ai metadati degli upload dei moduli;
- tutte le librerie CDN hanno versione esatta, hash SRI SHA384 e `crossorigin="anonymous"`;
- Supabase JS aggiornato a `2.110.8` e Nodemailer a `9.0.3`; `npm audit --omit=dev` non rileva vulnerabilità note;
- Netlify invia CSP, HSTS e Permissions-Policy.

## Limite residuo consapevole

Il frontend è HTML statico legacy e contiene ancora numerosi script e handler inline. Per compatibilità la CSP include temporaneamente `script-src 'unsafe-inline'` e `style-src 'unsafe-inline'`. La protezione attuale deriva quindi dalla codifica sistematica dei dati dinamici, dal blocco degli URL pericolosi, da SRI e dalle altre direttive CSP; non è ancora una CSP a nonce/hash senza inline.

Per rimuovere il limite residuo serve un refactor separato:

1. spostare tutti gli script inline in file JS locali;
2. sostituire tutti gli attributi `onclick`/`onchange` con listener;
3. spostare gli stili inline o adottare hash/nonce generati;
4. eliminare `'unsafe-inline'` dalla CSP e verificare tutte le pagine in browser.

## Verifiche automatiche

La suite `tests/security-hardening.test.js` controlla:

- comportamento di `MiroxSafe`;
- presenza della libreria in tutte le pagine;
- SRI/crossorigin su ogni script CDN;
- header CSP/HSTS/Permissions-Policy;
- validazioni dell'endpoint pubblico;
- generazione del PDF privacy digitale OTP su tre pagine e del modulo cartaceo monocromatico su una pagina, con scelta ACCONSENTO/NON ACCONSENTO obbligatoria e visibile.
