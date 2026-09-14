/**
 * Webhook Telegram dedicato a KONA Call Director (bot separato dal Guardian).
 *
 * - Secret token: header X-Telegram-Bot-Api-Secret-Token, confronto timing-safe.
 * - Allowlist chat_id: risponde SOLO al proprietario (KONA_CALL_DIRECTOR_OWNER_CHAT_ID).
 * - Stato conversazione server-side in kona_call_director_telegram.
 * - Comandi con la barra (deterministici) + dialogo in LINGUAGGIO NATURALE
 *   interpretato dall'assistente IA (DeepSeek V4.1 Flash, `_lib/kona-cd-assistente`).
 * - Le azioni che cambiano qualcosa (sospendi, riattiva, approva piano,
 *   telefoni omaggio, direttiva) NON vengono mai eseguite su interpretazione:
 *   il bot le ripropone in chiaro e aspetta "si" o "no". Le letture (stato,
 *   report, piano) rispondono subito.
 * - I messaggi VOCALI non sono supportati: nessuna trascrizione audio.
 * - Nessun dato personale cliente nel testo. Gli errori interni vengono
 *   registrati nella conversazione (HTTP 200 per ack Telegram, mai errori nascosti).
 *
 * Ciclo serale/mattutino (gestito con il dispatcher):
 *   19:10 report + domanda aperta sul piano di domani (+ pulsanti Vedi/Approva)
 *   20:00 reminder sera (condizionale alla risposta)
 *   08:00 reminder mattina (condizionale)
 *   08:30 piano predefinito (Telefoni omaggio) se Mirko non ha approvato
 */

const { createClient } = require('@supabase/supabase-js');

const { getConfig } = require('./_lib/kona-cd-config');
const { budgetSnapshot } = require('./_lib/kona-cd-budget');
const { reportGiornaliero, propostaPianoGiorno, applicaPianoDefault, pianoDi, salvaPiano } = require('./_lib/kona-cd-report');
const { timingSafeEqualText, sendMessage, answerCallbackQuery, getOwnerChatId } = require('./_lib/kona-cd-telegram');
const { monthRomeKey, nextWorkingDay, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, nowIso } = require('./_lib/kona-cd-util');
const {
  azioneInAttesa, confermaDeterministica, confermaValida, contestoAssistente,
  interpreta, richiedeConferma, tastieraConferma
} = require('./_lib/kona-cd-assistente');
const { ENV_CHIAVE, isConfigured: assistenteConfigurato } = require('./_lib/kona-cd-deepseek');

const AIUTO = [
  'KONA Call Director - puoi scrivermi in italiano, non servono i comandi.',
  'Esempi: "come sta andando oggi?", "quanti appuntamenti abbiamo?",',
  '"prepara il piano di domani", "sospendi tutto".',
  '',
  'Comandi rapidi (gratuiti, nessuna IA):',
  '/stato - stato globale e budget',
  '/report - report di oggi (aggregati)',
  '/piano [domani] - piano Business proposto',
  '/approva - approva il piano',
  '/categorie - approva/modifica le categorie da chiamare',
  '/sospendi - sospensione immediata (chiede conferma)',
  '/riattiva - riattiva il sistema (chiede conferma)',
  '/aiuto - questo elenco',
  '',
  'Le azioni che cambiano qualcosa chiedono sempre conferma: rispondi "si" o "no".',
  'I messaggi vocali non sono supportati: scrivi il testo.'
].join('\n');

function inlinePiano(dataDomani) {
  return {
    inline_keyboard: [
      [{ text: 'Vedi piano', callback_data: `piano:vedi:${dataDomani}` }],
      [{ text: 'Approva piano', callback_data: `piano:approva:${dataDomani}` }],
      [{ text: 'Modifica (Telefoni omaggio)', callback_data: `piano:telefoni_omaggio:${dataDomani}` }]
    ]
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'method not allowed' };
  }

  // Secret webhook (timing-safe): niente endpoint generico.
  const secret = String(process.env.KONA_CALL_DIRECTOR_TELEGRAM_WEBHOOK_SECRET || '');
  const headerSecret = String(event.headers['x-telegram-bot-api-secret-token'] || '');
  if (!secret || !timingSafeEqualText(headerSecret, secret)) {
    return { statusCode: 401, body: 'unauthorized' };
  }

  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return { statusCode: 200, body: 'ok' };
  }

  const updateId = Number(body?.update_id || 0);
  const message = body?.message;
  const callback = body?.callback_query;
  const chatId = String((message && message.chat && message.chat.id) || (callback && callback.message && callback.message.chat && callback.message.chat.id) || '');

  // Solo il proprietario puo' comandare: check prima di toccare Supabase.
  const ownerChatId = getOwnerChatId();
  if (!ownerChatId || chatId !== ownerChatId) {
    return { statusCode: 200, body: 'ok' };
  }

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return { statusCode: 500, body: 'missing supabase env' };
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // CLAIM ATOMICO dell'update. Prima la lettura e la scrittura erano separate:
    // due consegne concorrenti dello stesso update (Telegram ritenta se la
    // risposta e' lenta) leggevano lo stesso `ultimo_update_id` e lo eseguivano
    // entrambe. L'update viene consumato solo se e' piu' recente dell'ultimo
    // registrato, con un unico UPDATE condizionato.
    // Nota: il consumo avviene PRIMA dell'esecuzione, quindi un comando che
    // fallisce non viene rieseguito da un retry di Telegram (i comandi sono
    // idempotenti o di sola lettura).
    if (updateId) {
      await client.from('kona_call_director_telegram')
        .upsert({ chat_id: chatId }, { onConflict: 'chat_id', ignoreDuplicates: true });
      const claim = await client.from('kona_call_director_telegram')
        .update({ ultimo_update_id: updateId })
        .eq('chat_id', chatId)
        .or(`ultimo_update_id.is.null,ultimo_update_id.lt.${updateId}`)
        .select('chat_id');
      if (claim.error) return { statusCode: 500, body: 'dedupe non disponibile' };
      if (!Array.isArray(claim.data) || claim.data.length === 0) {
        return { statusCode: 200, body: 'ok' }; // update gia' consumato
      }
    }
    const stato = await caricaStato(client, chatId);

    const cfg = await getConfig(client);
    const data = todayRomeStr();
    const domani = nextWorkingDay(data, cfg.giorni_lavorativi, cfg.ferie);

    if (callback) {
      await gestisciCallback(client, cfg, chatId, callback);
      return { statusCode: 200, body: 'ok' };
    }

    const text = String(message?.text || '').trim();
    const haVocale = Boolean(message?.voice || message?.audio || message?.video_note);
    let risposta = null;
    let markup = null;

    if (!text) {
      risposta = haVocale
        ? 'I messaggi vocali non sono supportati: scrivimi il testo (o /aiuto).'
        : 'Comando non riconosciuto. /aiuto per l\'elenco.';
    } else if (text === '/aiuto') {
      risposta = AIUTO;
    } else if (text === '/stato') {
      risposta = await cmdStato(client, cfg, data);
    } else if (text === '/report') {
      risposta = await cmdReport(client, cfg, data);
    } else if (text.startsWith('/piano')) {
      const giorno = /domani/.test(text) ? domani : data;
      risposta = await cmdPiano(client, cfg, giorno);
      markup = inlinePiano(giorno);
    } else if (text === '/approva') {
      // Anche il comando esplicito passa dalla conferma: la regola e' "nessuna
      // azione che cambia qualcosa senza un si", qualunque sia la richiesta.
      ({ risposta, markup } = await proponiConferma(client, chatId, 'approva_piano', { data: domani }));
    } else if (text === '/categorie') {
      risposta = await cmdCategorie(client, chatId, domani);
    } else if (text === '/sospendi') {
      ({ risposta, markup } = await proponiConferma(client, chatId, 'sospendi', { data: domani }));
    } else if (text === '/riattiva') {
      ({ risposta, markup } = await proponiConferma(client, chatId, 'riattiva', { data: domani }));
    } else {
      // Dialogo in linguaggio naturale, interpretato dall'assistente IA.
      const esito = await gestisciLinguaggioNaturale(
        client, cfg, chatId, stato.stato_conversazione || {}, text, data, domani
      );
      risposta = esito.testo;
      markup = esito.markup || null;
    }

    if (risposta) {
      await sendMessage(chatId, risposta, markup ? { reply_markup: markup } : {});
    }
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    // Mai errori nascosti: registrati nella conversazione e visibili a Mirko.
    try {
      await sendMessage(chatId, `Errore interno KONA Call Director: ${String(e?.message || 'errore').slice(0, 300)}`);
    } catch (_) { /* il bot potrebbe essere giu' */ }
    return { statusCode: 200, body: 'ok' };
  }
};

// -- Callback (pulsanti inline) ------------------------------------------------

async function gestisciCallback(client, cfg, chatId, callback) {
  const cid = String(callback.id || '');
  const dati = String(callback.data || '').split(':');
  const tipo = dati[0];
  const arg = dati[1];
  const giorno = dati[2] || nextWorkingDay(todayRomeStr(), cfg.giorni_lavorativi, cfg.ferie);
  let risposta = null;

  if (tipo === 'conf') {
    // Conferma o annullamento dell'azione in attesa. Il click sul pulsante e'
    // gia' una decisione esplicita: si esegue.
    const stato = await caricaStato(client, chatId);
    const attesa = stato.stato_conversazione?.azione_in_attesa;
    if (arg === 'si') {
      risposta = confermaValida(attesa)
        ? (await eseguiAzione(client, cfg, chatId, attesa.azione, attesa.argomenti, giorno)).testo
        : 'Non c\'e\' piu\' nulla da confermare.';
    } else {
      await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
      if (attesa?.azione) await audita(client, chatId, 'azione_annullata', { azione: attesa.azione });
      risposta = 'Annullato: non ho fatto nulla.';
    }
  } else if (tipo === 'piano' && arg === 'vedi') risposta = await cmdPiano(client, cfg, giorno);
  else if (tipo === 'piano' && arg === 'approva') risposta = await cmdApprova(client, cfg, giorno, chatId);
  else if (tipo === 'piano' && arg === 'telefoni_omaggio') risposta = await cmdTelefoniOmaggio(client, cfg, giorno, chatId);
  else risposta = 'Azione non riconosciuta.';

  if (cid) await answerCallbackQuery(cid, risposta.slice(0, 180));
  await sendMessage(chatId, risposta);
}

// -- Comandi ------------------------------------------------------------------

async function caricaStato(client, chatId) {
  const { data } = await client.from('kona_call_director_telegram').select('*').eq('chat_id', chatId).maybeSingle();
  return data || { chat_id: chatId, stato_conversazione: {}, ultimo_update_id: null };
}

// Unico punto di scrittura dello stato conversazione: il patch viene fuso con
// lo stato letto AL MOMENTO della scrittura. Cosi' un chiamante che aveva letto
// lo stato in precedenza non riscrive piu' una copia stantia cancellando le
// voci di audit appena aggiunte da `audita` (era il caso di `categorie`).
async function aggiornaConversazione(client, chatId, patch) {
  const corrente = await caricaStato(client, chatId);
  const nuovo = { ...(corrente.stato_conversazione || {}), ...patch };
  await client.from('kona_call_director_telegram')
    .upsert({ chat_id: chatId, stato_conversazione: nuovo }, { onConflict: 'chat_id' });
  return nuovo;
}

async function audita(client, chatId, decisione, dettagli = {}) {
  const corrente = await caricaStato(client, chatId);
  const storico = Array.isArray(corrente.stato_conversazione?.storico) ? corrente.stato_conversazione.storico : [];
  storico.push(cleanLog({ ts: nowIso(), decisione, ...dettagli }));
  // Rilegge lo stato dentro il helper: l'append non viene mai sovrascritto.
  await aggiornaConversazione(client, chatId, { storico: storico.slice(-200) });
}

async function operatoriAbilitati(client) {
  const { data, error } = await client.from('kona_call_director_profili').select('profilo_id').eq('abilitato', true);
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => r.profilo_id);
}

async function cmdStato(client, cfg, data) {
  const budget = await budgetSnapshot(client, cfg, monthRomeKey(data));
  const operatori = await operatoriAbilitati(client);
  return [
    `KONA Call Director - Stato (${data})`,
    `Attivo: ${cfg.attivo_globale ? 'SI' : 'NO'}`,
    `Modalita' osservazione: ${cfg.modalita_osservazione ? 'SI' : 'NO'}`,
    `Operatrici abilitate: ${operatori.length}`,
    `Budget ${budget.mese}: speso ${budget.speso.toFixed(2)} su ${budget.budget.toFixed(2)} euro (${budget.percentuale}%)`,
    `Assistente Telegram: ${budget.riserva_telegram.speso.toFixed(2)} su ${budget.riserva_telegram.budget.toFixed(2)} euro (${budget.telegram_messaggi} messaggi)`,
    `Interpretazione IA: ${assistenteConfigurato() ? 'configurata' : `NON configurata (manca ${ENV_CHIAVE})`}`
  ].join('\n');
}

async function cmdReport(client, cfg, data) {
  const report = await reportGiornaliero(client, cfg, { data });
  return [
    `KONA Call Director - Report ${data}`,
    `Task: ${report.task.totali}`,
    `Conferme: ${report.conferme.totali}`,
    `Appuntamenti Business: ${report.appuntamenti_business.totali}`,
    `Attivita sessioni: ${report.sessioni.attivita_totali || 0}`,
    `Budget: ${report.budget.speso.toFixed(2)} euro`
  ].join('\n');
}

async function cmdPiano(client, cfg, data) {
  const proposta = await propostaPianoGiorno(client, cfg, { data });
  if (proposta.totale === 0) return `Piano ${data}: nessun appuntamento Business programmato.`;
  const righe = (proposta.perZona || [])
    .map((z) => `${z.zona}: ${z.n} appuntamenti (${z.finestra.da}-${z.finestra.a})`)
    .join('\n');
  return `Piano ${data}\n${righe}\n\n${proposta.suggerimento}`;
}

async function cmdApprova(client, cfg, data, chatId) {
  const operatori = await operatoriAbilitati(client);
  if (operatori.length === 0) return 'Nessuna operatrice abilitata: nessun piano da approvare.';
  let approvati = 0;
  for (const opId of operatori) {
    const esistente = await pianoDi(client, { data, operatoreId: opId });
    if (esistente) {
      await client.from('kona_call_director_piani').update({ stato: 'approvato', approvata_at: nowIso() }).eq('data', data).eq('operatore_id', opId);
    } else {
      await applicaPianoDefault(client, cfg, { data, operatoreId: opId });
      await client.from('kona_call_director_piani').update({ stato: 'approvato', approvata_at: nowIso() }).eq('data', data).eq('operatore_id', opId);
    }
    approvati += 1;
  }
  await audita(client, chatId, 'approva_piano', { data, operatori: approvati });
  return `Piano ${data} approvato per ${approvati} operatrici.`;
}

async function cmdTelefoniOmaggio(client, cfg, data, chatId) {
  // Piano predefinito residuo: Telefoni omaggio da liste cartacee (Consumer manuale).
  const operatori = await operatoriAbilitati(client);
  for (const opId of operatori) {
    await salvaPiano(client, {
      data, operatoreId: opId,
      contenuto: { totale: 0, perZona: [], suggerimento: 'Telefoni omaggio da liste cartacee (Consumer manuale)', consumer: 'telefoni_omaggio' },
      sorgente: 'mirko', stato: 'approvato'
    });
    await client.from('kona_call_director_sessioni').upsert(
      { data, operatore_id: opId, tipo: 'mattina', stato: 'attiva', categoria: 'telefoni_omaggio' },
      { onConflict: 'data,operatore_id,tipo' }
    );
  }
  await audita(client, chatId, 'piano_telefoni_omaggio', { data });
  return `Piano ${data}: Telefoni omaggio da liste cartacee. Sessione Consumer manuale registrata.`;
}

async function cmdCategorie(client, chatId, data) {
  await audita(client, chatId, 'categorie_richieste', { data });
  // Nessuna copia stantia dello stato: il flag si applica allo stato corrente
  // e non cancella la voce di audit appena registrata.
  await aggiornaConversazione(client, chatId, { in_attesa_categorie: true });
  return 'Quali categorie vuoi chiamare domani? (es. "Bar, negozi, officine") Rispondi con l\'elenco.';
}

async function cmdSospendi(client, chatId) {
  await client.from('kona_call_director_config').upsert({ id: 1, attivo_globale: false, aggiornato_at: nowIso() }, { onConflict: 'id' });
  await client.from('kona_call_director_task').update({ stato: 'sospeso' }).eq('stato', 'attivo');
  await audita(client, chatId, 'sospensione_immediata', {});
  return 'KONA Call Director sospeso: globale off e task attivi in pausa.';
}

async function cmdRiattiva(client, chatId) {
  await client.from('kona_call_director_config').upsert({ id: 1, attivo_globale: true, aggiornato_at: nowIso() }, { onConflict: 'id' });
  const { error } = await client.from('kona_call_director_task').update({
    stato: 'attivo', lease_until: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), lease_owner: 'telegram'
  }).eq('stato', 'sospeso');
  if (error) return `KONA riattivato, ma i task sospesi richiedono verifica: ${error.message}`;
  await audita(client, chatId, 'riattivazione', {});
  return 'KONA Call Director riattivato e task sospesi ripresi.';
}

// -- Conferma delle azioni delicate -------------------------------------------

// Propone un'azione delicata: la salva come PENDENTE e chiede conferma.
// Nessuna scrittura sul sistema avviene qui.
async function proponiConferma(client, chatId, azione, argomenti) {
  const attesa = azioneInAttesa(azione, argomenti || {});
  await aggiornaConversazione(client, chatId, { azione_in_attesa: attesa, in_attesa_categorie: false });
  await audita(client, chatId, 'conferma_richiesta', { azione });
  return {
    risposta: `${attesa.riassunto}\n\nRispondi "si" oppure "no".`,
    markup: tastieraConferma()
  };
}

// Esegue un'azione GIA' confermata.
async function eseguiAzione(client, cfg, chatId, azione, argomenti = {}, giornoDefault) {
  const giorno = argomenti?.data || giornoDefault || nextWorkingDay(todayRomeStr(), cfg.giorni_lavorativi, cfg.ferie);
  let testo;
  if (azione === 'sospendi') testo = await cmdSospendi(client, chatId);
  else if (azione === 'riattiva') testo = await cmdRiattiva(client, chatId);
  else if (azione === 'approva_piano') testo = await cmdApprova(client, cfg, giorno, chatId);
  else if (azione === 'telefoni_omaggio') testo = await cmdTelefoniOmaggio(client, cfg, giorno, chatId);
  else if (azione === 'direttiva') testo = await applicaDirettiva(client, cfg, chatId, giorno, argomenti);
  else testo = `Azione non riconosciuta: ${azione}`;
  await aggiornaConversazione(client, chatId, { azione_in_attesa: null, in_attesa_categorie: false });
  await audita(client, chatId, 'azione_confermata', { azione, data: giorno });
  return { testo };
}

// Categoria di sessione dedotta dal testo libero (stesso comportamento di prima).
function categoriaDaTesto(testo) {
  const lower = String(testo || '').toLowerCase();
  if (lower.includes('telefono') && lower.includes('omaggio')) return 'telefoni_omaggio';
  if (lower.includes('fibra') || lower.includes('fwa')) return 'fibra_fwa';
  if (lower.includes('business')) return 'business';
  return null;
}

// Applica al piano la direttiva confermata (categorie e/o nota libera).
async function applicaDirettiva(client, cfg, chatId, data, argomenti = {}) {
  const categorie = Array.isArray(argomenti.categorie) ? argomenti.categorie : [];
  const nota = String(argomenti.nota || '').slice(0, 1000);
  const categoriaSessione = categoriaDaTesto(`${nota} ${categorie.join(' ')}`);
  const operatori = await operatoriAbilitati(client);
  for (const opId of operatori) {
    const esistente = await pianoDi(client, { data, operatoreId: opId });
    const contenuto = {
      ...(esistente?.contenuto || {}),
      ...(nota ? { direttiva_mirko: nota } : {}),
      ...(categorie.length ? { categorie_approvate: categorie } : {}),
      ...(categoriaSessione ? { categoria_sessione: categoriaSessione } : {}),
      ...(['telefoni_omaggio', 'fibra_fwa'].includes(categoriaSessione) ? { consumer: categoriaSessione } : {})
    };
    const salvato = await salvaPiano(client, {
      data, operatoreId: opId, contenuto: cleanLog(contenuto), sorgente: 'mirko', stato: 'approvato'
    });
    if (!salvato.ok) throw new Error('Impossibile salvare la direttiva sul piano');
  }
  await audita(client, chatId, 'direttiva_libera_approvata', { data, categoria_sessione: categoriaSessione, categorie });
  const riepilogo = categorie.length ? `Categorie: ${categorie.join(', ')}` : (nota || 'nessun dettaglio');
  return `Direttiva registrata e approvata per ${data}. ${riepilogo}`.slice(0, 900);
}

// -- Dialogo libero ------------------------------------------------------------

// Unico ingresso del testo libero. Ordine:
//   1. conferma/annullamento deterministico di un'azione in attesa (gratis);
//   2. interpretazione IA del messaggio;
//   3. letture eseguite subito, azioni delicate solo PROPOSTE.
async function gestisciLinguaggioNaturale(client, cfg, chatId, conv, text, data, domani) {
  const attesa = conv?.azione_in_attesa;
  if (attesa && confermaValida(attesa)) {
    const scelta = confermaDeterministica(text);
    if (scelta === 'si') return await eseguiAzione(client, cfg, chatId, attesa.azione, attesa.argomenti, domani);
    if (scelta === 'no') {
      await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
      await audita(client, chatId, 'azione_annullata', { azione: attesa.azione });
      return { testo: 'Annullato: non ho fatto nulla.' };
    }
    // Risposta che non e' un si/no: la proposta DECADE. Senza questo, un "si"
    // scritto piu' tardi (dopo una domanda diversa) eseguirebbe l'azione
    // vecchia, mai confermata: esattamente il rischio da evitare.
    await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
    await audita(client, chatId, 'conferma_abbandonata', { azione: attesa.azione });
    conv = { ...conv, azione_in_attesa: null };
  } else if (attesa) {
    // Conferma scaduta: non si esegue nulla di proposto troppo tempo prima.
    await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
  }

  const operatori = await operatoriAbilitati(client);
  const contesto = await contestoAssistente(client, cfg, { oggi: data, domani, operatori, conv });
  const esito = await interpreta({ supabase: client, cfg, testo: text, contesto });

  if (!esito.ok) return await rispostaSenzaIa(client, chatId, conv, text, domani, esito);

  if (richiedeConferma(esito.azione)) {
    if (!esito.argomenti.data) esito.argomenti.data = domani;
    const proposta = await proponiConferma(client, chatId, esito.azione, esito.argomenti);
    return { testo: `${proposta.risposta}`, markup: proposta.markup };
  }

  if (esito.azione === 'stato') return { testo: await cmdStato(client, cfg, data) };
  if (esito.azione === 'report') return { testo: await cmdReport(client, cfg, data) };
  if (esito.azione === 'piano') {
    const giorno = esito.argomenti.data || domani;
    return { testo: await cmdPiano(client, cfg, giorno) };
  }
  if (esito.azione === 'aiuto') return { testo: AIUTO };
  if (esito.azione === 'categorie') return { testo: await cmdCategorie(client, chatId, domani) };
  if (esito.azione === 'conferma') {
    return { testo: 'Non c\'e\' nessuna azione in attesa di conferma. /aiuto per l\'elenco.' };
  }
  if (esito.azione === 'annulla') {
    return { testo: 'Non c\'e\' nulla da annullare.' };
  }
  // 'altro': risposta libera dell'assistente (senza dati inventati: il prompt
  // vieta di produrre numeri non presenti nel contesto).
  return { testo: esito.risposta || `Non ho capito. ${AIUTO}` };
}

// IA non disponibile: nessuna azione viene eseguita. Se Mirko stava rispondendo
// alla domanda sulle categorie, la conferma viene comunque chiesta in modo
// deterministico, cosi' il flusso non si blocca.
async function rispostaSenzaIa(client, chatId, conv, text, domani, esito) {
  if (conv?.in_attesa_categorie) {
    const categorie = text.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 8);
    const proposta = await proponiConferma(client, chatId, 'direttiva', { categorie, data: domani, nota: '' });
    return { testo: `Assistente non disponibile (${esito.error_code}). ${proposta.risposta}`, markup: proposta.markup };
  }
  // Chiave mancante: errore di CONFIGURAZIONE, non guasto temporaneo. Il
  // messaggio dice esattamente cosa manca, perche' l'alternativa ("non riesco a
  // interpretare") non permette di capirlo. Le env di Netlify arrivano al
  // processo delle function solo con un NUOVO deploy.
  if (esito.error_code === 'no_api_key') {
    return {
      testo: [
        `Assistente non configurato: manca la variabile ${ENV_CHIAVE} su Netlify.`,
        'Aggiungila (o correggine il nome) e poi lancia un NUOVO deploy: le variabili',
        'entrano nelle function solo al deploy successivo.',
        '',
        'Nel frattempo i comandi con la barra funzionano: /stato, /report, /piano.'
      ].join('\n')
    };
  }
  return { testo: `Adesso non riesco a interpretare (${esito.error_code}).\n\n${AIUTO}` };
}
