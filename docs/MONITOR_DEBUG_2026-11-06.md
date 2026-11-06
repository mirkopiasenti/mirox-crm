# Monitor negozio — debug e rilascio06/11/2026

Richiesta: revisione approfondita, correzioni e push. La verifica comprende il
nuovo aggiornamento della pagina, il servizio Windows, l'associazione e i KPI.
Non sono necessarie migration o modifiche ai dati/configurazioni del database.

## Difetti individuati e corretti

| Caso | Effetto precedente | Correzione e prova |
| --- | --- | --- |
| Seconda scrittura DPAPI in Windows PowerShell | `$null` diventava stringa vuota nel parametro string di File.Replace | NullString.Value; prova nativa di scritture successive/lettura cifrata |
| Credenziale pending gia registrata e poi revocata | Riutilizzo hash revocato, errore23505 confermato nei log production | Nuova chiave dopo403, persistita prima del POST; retry senza rifiuto conserva la chiave; regressione host e55controlli SQL isolati |
| Salvataggio locale fallito | Stato in memoria poteva divergere dal disco e nascondere l'errore | Aggiornamento memoria soltanto dopo persistenza, messaggio specifico, nessun segreto nel browser |
| Agenda e refresh ogni secondo | Il contatore avanzava a ogni poll e timer, accelerando la paginazione | Tempo reale trascorso;40refresh allo stesso istante non cambiano pagina, dopo15s cambia |
| Heartbeat con pagina guasta | La pagina poteva sembrare sana anche senza rendering | Versione, rendering pronto ed errore distinti; attesa dati mantiene il browser vivo senza confermare il rilascio |
| Errore dopo prima conferma o viewer fermo alla pagina vecchia | Possibile blocco senza rollback | Timeout di passaggio anche da heartbeat precedente; riapertura/rollback dopo errore successivo |
| Risposta compressa | Content-Length di trasporto poteva respingere byte decodificati validi | Hash/dimensione sui byte decodificati, limite di stream; prova specifica |
| Download fallito | Download paralleli residui potevano proseguire | Abort condiviso; pagina precedente invariata e retry verificato |
| Risorse CSS/HTML errate | Pagina con file mancanti poteva essere pubblicata o accettata | Controllo risorse in build e runtime, attributi HTML maiuscoli/spazi/percorsi relativi gestiti |
| Riscritture automatiche HTML dell'hosting | I byte pubblicati potevano differire dalle impronte di build | Trasporto dei payload come .bin; il servizio verifica i byte e li serve con il MIME corretto sul loopback |
| URI HTTP malformati e heartbeat null | Errore fuori dal controllo richieste o risposta impropria |400senza interrompere il servizio; richieste successive ancora funzionanti |
| Installer con ZIP danneggiato o nuovo servizio guasto | Il task poteva essere fermato prima della verifica o restare parzialmente aggiornato | Preflight completo, staging protetto, copia cifrata identica, swap directory, verifica HTTP, ripristino cartella/task se l'avvio fallisce |
| Supervisor e stderr nativo | Un errore PowerShell poteva fermare il ciclo di recupero | Catch nel ciclo; Windows prova almeno due avvii dopo errore nativo |

## Confini verificati

- Aggiornamenti web solo dalla stessa origine HTTPS vincolata; niente credenziale
  nei download, redirect vietati, allowlist10file, API/dimensioni/SHA256 validati.
- Attivazione atomica in memoria, risorse per versione, nessun JavaScript remoto
  eseguito da Node/SYSTEM e nessuna sostituzione remota di helper/vault/config.
- Segreto DPAPI fuori dal browser, Host/Origin/nonce e bind loopback conservati.
- KPI3s/cache1s/browser1s, nessuna sovrapposizione delle letture del servizio;
  avvisi15s/60s. Latenza reale include elaborazione e rete: non e un limite garantito.
- Regole Day/mensile/FTTC/reinserimenti/Netto, moduli CRM e invii Target invariati.
- Nessun browser automatizzato, nessun dato cliente, codice o segreto reale usato
  nei test. Windows CI usa un'origine staging fittizia e stato solo sintetico.

## Verifiche e pubblicazione

Suite locale:687/687test, build e controlli sintassi/diff verdi. Prove HTTP/SMTP
solo su localhost, DOM delle pagine reali e regressioni updater/associazione.
`scripts/check-monitor-windows.ps1` richiede CI isolata e verifica installazione
e reinstallazione reali, taskSYSTEM, lettura DPAPI fra utenti, ACL, preservazione
dei byte cifrati, rifiuto ZIP corrotto, rollback su avvio guasto e supervisor.
Prima CI sul ramo tecnico: [42305665291](https://github.com/mirkopiasenti/mirox-crm/actions/runs/42305665291)
verde sia Linux/Node22 sia Windows nativo. Prove DPAPI, taskSYSTEM, ACL,
installazione/reinstallazione con percorso contenente spazi, credenziale
preservata, ZIP corrotto rifiutato, rollback e supervisor completate.
Trasporto .bin aggiunto dopo questa prima prova: seconda CI e produzione da verificare.

Resta necessario installare una volta il nuovo pacchetto sul PC gia associato.
Il controllo fisico su Samsung, i timer, il boot/blackout e una giornata08:30–20
sono prove sul dispositivo del proprietario, non sostituibili dalla CI.
