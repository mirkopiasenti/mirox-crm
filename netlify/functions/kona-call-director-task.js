/**
 * KONA Call Director — task operatore (POST action-based, auth).
 *
 * Azioni:
 *   prossimo   -> materializza il prossimo contatto e ritorna il dettaglio
 *   attivo     -> ri-verifica blacklist/esclusioni del task corrente PRIMA di
 *                 mostrarlo (fail-closed); se bloccato lo annulla e materializza
 *                 il successivo
 *   esito      -> registra esito valido / skip motivato / blacklist (persistita)
 *   sospendi   -> sospende il task attivo (un solo task lavorabile per operatrice)
 *   riprendi   -> riattiva il task sospeso (deterministico: ne esiste uno solo)
 *   avvia_consumer -> apre la sessione Consumer della fascia in corso
 *   registra_chiamata_manuale -> conta una chiamata fatta sulle liste cartacee
 *                 (fascia manuale: KONA non propone contatti, l'operatrice
 *                 telefona e registra)
 *
 * Il dettaglio contatto (nome, telefono, ecc.) e' restituito SOLO all'operatore
 * in questa function: mai in Telegram, mai nei log. Gli esiti passano dal
 * motore deterministico (kona-cd-engine) che valida, conta i tentativi
 * PERSISTENTI e applica le esclusioni.
 */

const { authAndEnabled } = require('./_lib/kona-cd-config');
const { getTaskLavorabile, materializeNextTask, modalitaConsumerAttiva, prenotaAppuntamentoNegozio, verificaTaskAttivo, getTaskDettaglio, registerEsito, registraChiamataConsumerCanonica } = require('./_lib/kona-cd-engine');
const { enqueueNotifica } = require('./_lib/kona-cd-notifiche');
const { notificaEsauriti } = require('./_lib/kona-cd-conferme');
const { nowRomeParts, todayRomeStr } = require('./_lib/kona-cd-time');
const { isUuid, jsonError, jsonOk, readJsonBody } = require('./_lib/kona-cd-util');

// Riprende l'eventuale task lasciato in pausa.
// Senza questo, dopo un refresh della pagina l'action `attivo` non trovava
// nulla (cerca solo stato='attivo'), `riprendi` non veniva mai invocato perche'
// il frontend non ha piu' il task in memoria, e il task sospeso restava a
// bloccare l'indice unico per 24 ore: l'operatrice vedeva "Giornata completata"
// senza poter lavorare.
// Compensazione di un appuntamento appena creato da `prenota_negozio`.
// La chiamata canonica creata nella stessa richiesta referenzia l'appuntamento
// (fk_chiamate_appuntamento senza ON DELETE): va rimossa PRIMA, altrimenti il
// DELETE dell'appuntamento viola la FK, l'errore resta silenzioso e al retry
// l'operatrice crea un secondo appuntamento + una seconda chiamata.
async function compensaAppuntamento(client, appuntamentoId) {
  if (!appuntamentoId) return;
  const { error: chiamateError } = await client.from('chiamate').delete().eq('appuntamento_id', appuntamentoId);
  if (chiamateError) {
    console.error('KONA compensazione appuntamento: delete chiamate fallita', chiamateError.message);
  }
  const { error } = await client.from('appuntamenti').delete().eq('id', appuntamentoId);
  if (error) {
    console.error('KONA compensazione appuntamento: delete appuntamento fallita', error.message);
  }
}

async function riprendiTaskSospeso(client, profiloId) {
  const lavorabile = await getTaskLavorabile(client, profiloId);
  if (!lavorabile || lavorabile.stato !== 'sospeso') return null;
  const { error } = await client.from('kona_call_director_task')
    .update({ stato: 'attivo', lease_until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
    .eq('id', lavorabile.id)
    .eq('stato', 'sospeso');
  if (error) return null;
  return getTaskDettaglio(client, { ...lavorabile, stato: 'attivo' });
}

function esitoCompletatoIdempotente(task, esitoRichiesto) {
  const salvato = task?.esito && typeof task.esito === 'object' ? task.esito : {};
  if (task?.stato !== 'completato' || String(salvato.esito || '') !== String(esitoRichiesto || '')) return null;
  return {
    esito: String(salvato.esito),
    esaurito: Boolean(salvato.tentativi_esauriti),
    tentativo: Number(salvato.tentativo || task.tentativi) || 1,
    ricontatto: salvato.ricontatto || null,
    gia_registrato: true
  };
}

async function recuperaEsitoCompletato(client, { taskId, profiloId, esitoRichiesto }) {
  const { data, error } = await client.from('kona_call_director_task')
    .select('id, operatore_id, stato, esito, tentativi')
    .eq('id', taskId)
    .eq('operatore_id', profiloId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'verifica_esito_precedente_fallita');
  return esitoCompletatoIdempotente(data, esitoRichiesto);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }, body: '' };
  }
  if (event.httpMethod !== 'POST') return jsonError(405, 'Metodo non consentito');

  const body = await readJsonBody(event);
  const action = String(body.action || '');

  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return jsonError(500, 'Configurazione Supabase mancante');
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const guard = await authAndEnabled(event, { supabase: client, response: jsonError });
  if (guard.response) return guard.response;
  const { cfg, profiloId } = guard;

  try {
    switch (action) {
      case 'prossimo': {
        const esito = await materializeNextTask({ supabase: client, cfg, profiloId, oggi: null });
        if (!esito.ok) {
          if (esito.reason === 'task_attivo') {
            const corrente = await verificaTaskAttivo({ supabase: client, profiloId });
            if (corrente.task && corrente.dettaglio) {
              return jsonOk({ task: corrente.dettaglio, motivo: 'task_attivo' });
            }
            // Il task lavorabile e' in pausa: riprendilo invece di dichiarare
            // che non c'e' nulla da fare.
            const ripreso = await riprendiTaskSospeso(client, profiloId);
            if (ripreso) return jsonOk({ task: ripreso, motivo: 'task_ripreso' });
          }
          return jsonOk({ task: null, motivo: esito.reason || 'nessun_candidato' });
        }
        const dettaglio = await getTaskDettaglio(client, esito.task);
        return jsonOk({ task: dettaglio });
      }

      case 'attivo': {
        // Ri-verifica blacklist/esclusioni PRIMA di mostrare (fail-closed).
        const verificato = await verificaTaskAttivo({ supabase: client, profiloId });
        if (verificato.blocked) {
          // Se il task era bloccato e annullato, materializza il successivo.
          const esito = await materializeNextTask({ supabase: client, cfg, profiloId, oggi: null });
          if (!esito.ok) return jsonOk({ task: null, motivo: esito.reason || 'nessun_candidato' });
          const dettaglio = await getTaskDettaglio(client, esito.task);
          return jsonOk({ task: dettaglio });
        }
        if (!verificato.task) {
          // Pausa + refresh: il task sospeso viene ripreso automaticamente.
          const ripreso = await riprendiTaskSospeso(client, profiloId);
          if (ripreso) return jsonOk({ task: ripreso, ripreso: true });
          return jsonOk({ task: null });
        }
        return jsonOk({ task: verificato.dettaglio });
      }

      case 'esito': {
        const esitoRichiesto = String(body.esito || '');
        const taskIdRichiesto = body.task_id ? String(body.task_id) : null;
        if (taskIdRichiesto && !isUuid(taskIdRichiesto)) return jsonError(400, 'Task non valido');
        const task = (await verificaTaskAttivo({ supabase: client, profiloId })).task;
        if (!task) {
          // Il primo click puo' aver completato il task mentre il browser sta
          // ancora aspettando la risposta. Un retry dello stesso esito deve
          // confermare il successo, non mostrare il falso errore "Nessun task".
          const precedente = taskIdRichiesto
            ? await recuperaEsitoCompletato(client, { taskId: taskIdRichiesto, profiloId, esitoRichiesto })
            : null;
          if (precedente) return jsonOk({ esito: precedente });
          return jsonError(409, 'Nessun task attivo');
        }
        if (taskIdRichiesto && task.id !== taskIdRichiesto) {
          return jsonError(409, 'Il contatto attivo e\' cambiato: aggiorna la scheda');
        }
        const esito = await registerEsito({
          supabase: client,
          cfg,
          task,
          profiloId,
          esito: esitoRichiesto,
          dettagli: {
            skip_reason: body.skip_reason,
            spiegazione: body.spiegazione,
            motivo: body.motivo,
            appuntamento_tipo: body.appuntamento_tipo,
            dettagli: body.dettagli || {}
          }
        });
        if (!esito.ok) return jsonError(400, esito.error);
        // Conferme esaurite (4 non risposti): notifica Telegram senza PII.
        if (esito.notifica === 'conferma_non_risposti_esauriti') {
          const payload = task.payload || {};
          const dettaglio = notificaEsauriti({
            appuntamento_business_id: payload.appuntamento_business_id,
            zona: payload.zona,
            data_appuntamento: (payload.data_ora || '').slice(0, 10)
          });
          await enqueueNotifica(client, {
            dedupeKey: `conferma_esauriti_${payload.appuntamento_business_id}_${todayRomeStr()}`,
            testo: dettaglio.messaggio,
            extra: dettaglio
          });
        }
        return jsonOk({ esito: esitoRecordPublic(esito) });
      }

      case 'prenota_negozio': {
        // Appuntamento nato da una rilavorazione standard: stessa sequenza del
        // flusso manuale (slot negozio -> appuntamento canonico -> nuova
        // chiamata con esito appuntamento -> chiusura della sorgente).
        const verificato = await verificaTaskAttivo({ supabase: client, profiloId });
        const task = verificato.task;
        const tipiAmmessi = ['ricontatto_programmato', 'auto_non_risposto', 'non_presentato', 'passa_a_cerea', 'passa_in_negozio'];
        if (!task || !tipiAmmessi.includes(task.tipo)) return jsonError(409, 'Nessuna rilavorazione attiva prenotabile');
        const start = new Date(String(body.data_ora || ''));
        if (Number.isNaN(start.getTime()) || start.getTime() <= Date.now()) return jsonError(400, 'Orario non valido o passato');
        const dataSlot = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
        }).format(start);
        const { data: disponibili, error: slotError } = await client.rpc('get_slot_disponibili', { p_data: dataSlot });
        if (slotError) return jsonError(500, slotError.message);
        if (!(disponibili || []).some((s) => new Date(s).getTime() === start.getTime())) {
          return jsonError(409, 'Slot non disponibile');
        }
        const dettaglio = await getTaskDettaglio(client, task);
        const contatto = dettaglio?.contatto || {};
        if (!contatto.nome || !contatto.cellulare) return jsonError(400, 'Contatto incompleto per la prenotazione');
        const { data: profilo } = await client.from('profili').select('nome').eq('id', profiloId).maybeSingle();
        // Prenotazione ATOMICA (RPC con advisory lock, migration 076): il check
        // dello slot e l'INSERT avvengono nella stessa transazione. Il vecchio
        // check-then-insert lasciava una finestra di doppia prenotazione.
        const campiAppuntamento = {
          nome: String(contatto.nome).slice(0, 120),
          codice_fiscale: String(contatto.cf_piva || '').trim() || null,
          telefono: String(contatto.cellulare).trim(),
          motivo: String(contatto.motivo || 'Appuntamento Consumer').slice(0, 300),
          note: String(contatto.note || '').slice(0, 500) || null,
          anagrafica_id: isUuid(contatto.anagrafica_id) ? contatto.anagrafica_id : null,
          fissato_da_operatore_id: profiloId,
          fissato_da_nome: profilo?.nome || null,
          data_ora: start.toISOString(),
          durata_minuti: 30,
          fonte: 'interno',
          stato: 'confermato',
          originato_da_id: task.sorgente_tipo === 'appuntamento' ? task.sorgente_id : null
        };
        const atomico = await prenotaAppuntamentoNegozio(client, {
          nome: campiAppuntamento.nome,
          codice_fiscale: campiAppuntamento.codice_fiscale,
          telefono: campiAppuntamento.telefono,
          motivo: campiAppuntamento.motivo,
          note: campiAppuntamento.note,
          anagrafica_id: campiAppuntamento.anagrafica_id,
          operatore_id: profiloId,
          operatore_nome: profilo?.nome || null,
          data_ora: campiAppuntamento.data_ora,
          durata_minuti: 30,
          originato_da_id: campiAppuntamento.originato_da_id
        });
        if (atomico.conflitto) return jsonError(409, 'Slot non disponibile: appena occupato');
        let appuntamento = null;
        if (atomico.ok) {
          appuntamento = { id: atomico.id };
        } else if (atomico.rpcAssente) {
          // Migration 076 non ancora applicata: comportamento precedente.
          const { data: inserito, error: appError } = await client.from('appuntamenti').insert(campiAppuntamento).select('id').single();
          if (appError || !inserito) return jsonError(500, appError?.message || 'Prenotazione negozio fallita');
          appuntamento = inserito;
        } else {
          return jsonError(500, atomico.motivo || 'Prenotazione negozio fallita');
        }

        let registrato;
        try {
          registrato = await registerEsito({
            supabase: client,
            cfg,
            task,
            profiloId,
            esito: 'appuntamento',
            dettagli: { appuntamento_id: appuntamento.id }
          });
        } catch (e) {
          await compensaAppuntamento(client, appuntamento.id);
          throw e;
        }
        if (!registrato.ok) {
          await compensaAppuntamento(client, appuntamento.id);
          return jsonError(400, registrato.error);
        }
        const { error: linkError } = await client.from('appuntamenti')
          .update({ chiamata_id: registrato.chiamata_id || null }).eq('id', appuntamento.id);
        return jsonOk({
          appuntamento: { id: appuntamento.id, data_ora: start.toISOString() },
          chiamata_id: registrato.chiamata_id || null,
          registrata: true,
          collegamento_completo: !linkError
        });
      }

      case 'sessione': {
        // Apre/chiude una sessione operativa (Consumer manuale o Business).
        const tipo = body.tipo === 'pomeriggio' || body.tipo === 'mattina'
          ? body.tipo
          : (nowRomeParts().hh >= 15 ? 'pomeriggio' : 'mattina');
        const statoSessione = body.stato === 'chiudi' ? 'chiudi' : 'apri';
        const data = todayRomeStr();
        if (statoSessione === 'apri') {
          const categoria = ['telefoni_omaggio', 'fibra_fwa', 'business'].includes(String(body.categoria || '')) ? body.categoria : null;
          const { error: sessioneOpenError } = await client.from('kona_call_director_sessioni').upsert(
            { data, operatore_id: profiloId, tipo, stato: 'attiva', categoria, aperta_at: new Date().toISOString(), chiusa_at: null, note: { obiettivo_minuti: categoria === 'business' ? (cfg.durata_sessione_business_minuti || 90) : null } },
            { onConflict: 'data,operatore_id,tipo' }
          );
          if (sessioneOpenError) return jsonError(500, sessioneOpenError.message);
          return jsonOk({ sessione: true, tipo, categoria });
        }
        const { data: chiusa, error } = await client
          .from('kona_call_director_sessioni')
          .update({ stato: 'chiusa', chiusa_at: new Date().toISOString() })
          .eq('data', data).eq('operatore_id', profiloId).eq('tipo', tipo).eq('stato', 'attiva')
          .select('id')
          .single();
        if (error) return jsonError(500, error.message);
        return jsonOk({ sessione_chiusa: true, tipo, id: chiusa?.id || null });
      }

      case 'avvia_consumer': {
        // KONA determina e apre automaticamente la sessione Consumer prevista
        // dalla FASCIA IN CORSO della programmazione (non piu' da un campo
        // generico del piano): l'operatore non sceglie la modalita'.
        const data = todayRomeStr();
        const parts = nowRomeParts();
        const tipo = parts.hh >= 15 ? 'pomeriggio' : 'mattina';
        const [fascia, sessioneRes] = await Promise.all([
          modalitaConsumerAttiva(client, cfg, { profiloId, oggi: data, oraParts: parts }),
          client.from('kona_call_director_sessioni')
            .select('categoria').eq('data', data).eq('operatore_id', profiloId)
            .eq('stato', 'attiva').limit(1).maybeSingle()
        ]);
        // La sessione aperta a mano resta valida solo se la fascia in corso non
        // e' una fascia "aziendali" (lead dalle liste).
        const inAziendali = Boolean(fascia && fascia.dal_blocco && !fascia.manuale);
        const categoria = !inAziendali
          ? ((fascia && fascia.modalita) || sessioneRes.data?.categoria || null)
          : null;
        if (!categoria) {
          return jsonOk({
            consumer: null,
            motivo: inAziendali ? 'fascia_aziendali_in_corso' : 'nessuna_modalita_consumer_in_corso',
            attivita_corrente: fascia ? { opzione: fascia.opzione, etichetta: fascia.etichetta, da: fascia.da, a: fascia.a } : null
          });
        }
        const { error: sessioneOpenError } = await client.from('kona_call_director_sessioni').upsert(
          { data, operatore_id: profiloId, tipo, stato: 'attiva', categoria, aperta_at: new Date().toISOString(), chiusa_at: null, note: { obiettivo_minuti: null } },
          { onConflict: 'data,operatore_id,tipo' }
        );
        if (sessioneOpenError) return jsonError(500, sessioneOpenError.message);
        return jsonOk({ consumer: { modalita: categoria }, sessione: true, tipo });
      }

      // Una chiamata fatta sulle LISTE CARTACEE della fascia in corso. Non crea
      // un contatto nel CRM (il cliente non e' censito): registra solo l'esito
      // nella sessione, cosi' il contatore della fascia e' reale. La categoria
      // la decide la programmazione, non l'operatrice.
      case 'registra_chiamata_manuale': {
        const data = todayRomeStr();
        const parts = nowRomeParts();
        const tipo = parts.hh >= 15 ? 'pomeriggio' : 'mattina';
        const fascia = await modalitaConsumerAttiva(client, cfg, { profiloId, oggi: data, oraParts: parts });
        const categoria = fascia && fascia.manuale ? fascia.modalita : null;
        if (!categoria) {
          return jsonOk({
            registrata: false,
            motivo: (fascia && fascia.dal_blocco) ? 'fascia_non_manuale' : 'nessuna_fascia_manuale_in_corso',
            attivita_corrente: fascia ? { opzione: fascia.opzione, etichetta: fascia.etichetta, da: fascia.da, a: fascia.a } : null
          });
        }
        const esito = String(body.esito || 'chiamata');
        if (!['chiamata', 'non_risposto', 'non_interessato', 'interessato', 'passa_in_negozio', 'altro', 'appuntamento'].includes(esito)) {
          return jsonError(400, 'Esito chiamata manuale non valido');
        }
        const { data: sessione, error: sessioneError } = await client.from('kona_call_director_sessioni').upsert(
          { data, operatore_id: profiloId, tipo, stato: 'attiva', categoria, aperta_at: new Date().toISOString(), chiusa_at: null, note: { obiettivo_minuti: null } },
          { onConflict: 'data,operatore_id,tipo' }
        ).select('id, categoria').single();
        if (sessioneError || !sessione) return jsonError(500, sessioneError?.message || 'Sessione manuale non aperta');

        const { data: attivita, error } = await client.from('kona_call_director_sessione_attivita').insert({
          sessione_id: sessione.id,
          operatore_id: profiloId,
          categoria,
          esito,
          note: String(body.note || '').slice(0, 500) || null
        }).select('id, created_at').single();
        if (error || !attivita) return jsonError(500, error?.message || 'Registrazione chiamata manuale fallita');
        const { count } = await client.from('kona_call_director_sessione_attivita')
          .select('id', { count: 'exact', head: true }).eq('sessione_id', sessione.id);
        return jsonOk({
          registrata: true,
          categoria,
          esito,
          attivita,
          totale_sessione: Number(count) || 0,
          attivita_corrente: { opzione: fascia.opzione, etichetta: fascia.etichetta, da: fascia.da, a: fascia.a }
        });
      }

      case 'registra_attivita_consumer': {
        const categoria = String(body.categoria || '');
        const esito = String(body.esito || '');
        if (!['telefoni_omaggio', 'fibra_fwa'].includes(categoria)) return jsonError(400, 'Categoria Consumer non valida');
        if (!['chiamata', 'non_risposto', 'non_interessato', 'passa_in_negozio', 'interessato', 'altro', 'appuntamento'].includes(esito)) return jsonError(400, 'Esito Consumer non valido');
        const { data: sessione, error: sessioneError } = await client.from('kona_call_director_sessioni')
          .select('id, categoria').eq('data', todayRomeStr()).eq('operatore_id', profiloId)
          .eq('stato', 'attiva').eq('categoria', categoria).limit(1).maybeSingle();
        if (sessioneError || !sessione) return jsonError(409, 'Nessuna sessione Consumer attiva per questa categoria');

        const cfPiva = String(body.cf_piva || '').trim();
        const nome = String(body.nome || '').trim();
        const telefono = String(body.telefono || '').trim();
        const motivo = String(body.motivo || '').trim();
        if (!cfPiva || !nome || !telefono || !motivo) {
          return jsonError(400, 'Il flusso Consumer integrato richiede cliente, telefono e motivo completi');
        }

        // Scrittura CANONICA: la chiamata Consumer va nella tabella `chiamate`
        // (stessa del Call Center manuale), cosi' l'esito e' visibile in Elenco
        // Chiamate. L'attivita' di sessione resta come audit.
        let chiamataId = null;
        const { data: profilo } = await client.from('profili').select('nome').eq('id', profiloId).maybeSingle();
        chiamataId = await registraChiamataConsumerCanonica(client, cfg, {
          operatoreId: profiloId,
          operatoreNome: profilo?.nome || null,
          cfPiva,
          nomeCliente: nome,
          cellulare: telefono,
          copertura: String(body.copertura || '').trim(),
          esito,
          motivo,
          note: String(body.note || '').slice(0, 500) || null
        });

        const { data: attivita, error } = await client.from('kona_call_director_sessione_attivita').insert({
          sessione_id: sessione.id,
          operatore_id: profiloId,
          categoria,
          esito,
          note: String(body.note || '').slice(0, 500) || null
        }).select('id, created_at').single();
        if (error || !attivita) {
          await client.from('chiamate').delete().eq('id', chiamataId);
          return jsonError(500, error?.message || 'Registrazione attività fallita');
        }
        const { count } = await client.from('kona_call_director_sessione_attivita')
          .select('id', { count: 'exact', head: true }).eq('sessione_id', sessione.id);
        return jsonOk({ registrata: true, attivita, chiamata_id: chiamataId, totale_sessione: Number(count) || 0 });
      }

      case 'sospendi': {
        const { data: sospeso, error } = await client
          .from('kona_call_director_task')
          .update({ stato: 'sospeso', lease_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
          .eq('operatore_id', profiloId)
          .eq('stato', 'attivo')
          .select('id')
          .single();
        if (error) return jsonError(500, error.message);
        return jsonOk({ sospeso: true, task_id: sospeso?.id || null });
      }

      case 'riprendi': {
        const { data: ripreso, error } = await client
          .from('kona_call_director_task')
          .update({ stato: 'attivo', lease_until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
          .eq('operatore_id', profiloId)
          .eq('stato', 'sospeso')
          .select('id')
          .single();
        if (error) return jsonError(500, error.message);
        return jsonOk({ ripreso: true, task_id: ripreso?.id || null });
      }

      default:
        return jsonError(400, 'Action non valida');
    }
  } catch (e) {
    return jsonError(500, String(e?.message || 'errore'));
  }
};

// Risposta pubblica: mai dettagli personali, solo esito + conteggio tentativi
// + eventuale ricontatto assegnato dal backend.
function esitoRecordPublic(esito) {
  return {
    esito: esito.esito,
    esaurito: Boolean(esito.esaurito),
    tentativo: esito.tentativo || 1,
    ricontatto: esito.ricontatto || null
  };
}

exports._test = { esitoCompletatoIdempotente };
