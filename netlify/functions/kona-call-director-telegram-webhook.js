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
  azioneInAttesa, confermaDeterministica, confermaValida, contestoAssistente, dataDaTesto, etichettaGiorno,
  giornoDaTesto, giornoRichiesto, interpreta, richiedeConferma, tastieraConferma
} = require('./_lib/kona-cd-assistente');
const { ENV_CHIAVE, isConfigured: assistenteConfigurato } = require('./_lib/kona-cd-deepseek');
const { categoriaCorrisponde } = require('./_lib/kona-cd-engine');
const agenda = require('./_lib/kona-cd-agenda');

const AIUTO = [
  'KONA Call Director - puoi scrivermi in italiano, non servono i comandi.',
  'Esempi: "come sta andando oggi?", "quanti appuntamenti abbiamo?",',
  '"prepara il piano di domani", "sospendi tutto",',
  '"quali categorie posso scegliere?" (te le elenco con quanti contatti hai).',
  '',
  'Comandi rapidi (gratuiti, nessuna IA):',
  '/agenda [domani] - costruiamo insieme la giornata, un pezzo alla volta',
  '/stato - stato globale e budget',
  '/report - report di oggi (aggregati)',
  '/piano [domani] - piano Business proposto',
  '/approva - approva il piano',
  '/categorie - elenco delle categorie che puoi chiamare, poi scegli',
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
      ({ risposta, markup } = await proponiConferma(client, chatId, 'approva_piano', { data: domani }, { oggi: data, domani }));
    } else if (text === '/categorie') {
      risposta = await cmdCategorie(client, chatId, domani);
    } else if (text.startsWith('/agenda')) {
      // Costruzione guidata della giornata: prima il giorno, poi le attivita'.
      // `cfg` e' obbligatorio: senza, le finestre di lavoro risultavano vuote e
      // lo stato dell'agenda finiva salvato sotto la chat sbagliata.
      const giorno = /domani/.test(text) ? domani : data;
      ({ risposta, markup } = await avviaAgenda(client, cfg, chatId, giorno, { oggi: data, domani }));
    } else if (text === '/sospendi') {
      ({ risposta, markup } = await proponiConferma(client, chatId, 'sospendi', {}, { oggi: data, domani }));
    } else if (text === '/riattiva') {
      ({ risposta, markup } = await proponiConferma(client, chatId, 'riattiva', {}, { oggi: data, domani }));
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
  let markup = null;

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
  else if (tipo === 'ag') {
    const esito = await gestisciAgendaCallback(client, cfg, chatId, arg);
    risposta = esito.testo;
    if (esito.markup) markup = esito.markup;
  } else risposta = 'Azione non riconosciuta.';

  if (cid) await answerCallbackQuery(cid, risposta.slice(0, 180));
  await sendMessage(chatId, risposta, markup ? { reply_markup: markup } : {});
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

// "Mostrami il piano": prima cosa KONA fara' in giornata (fasce, categorie,
// liste Consumer), poi gli appuntamenti Business. Prima mostrava solo gli
// appuntamenti e con zero appuntamenti rispondeva "nessun appuntamento
// programmato", che non dice nulla sulla giornata.
async function cmdPiano(client, cfg, data) {
  const operatori = await operatoriAbilitati(client);
  const piano = operatori.length
    ? await pianoDi(client, { data, operatoreId: operatori[0] })
    : null;
  const descrizione = agenda.descriviPiano(piano?.contenuto, cfg);
  const righe = [
    descrizione.dalPiano
      ? `Piano ${data} (scelto con /agenda)`
      : `Piano ${data} (programmazione base)`
  ];
  if (descrizione.righe.length) righe.push(...descrizione.righe.map((r) => `- ${r}`));
  else righe.push('- nessuna fascia di lavoro: nessun contatto proposto');
  righe.push(descrizione.categorie.length
    ? `Categorie aziendali approvate: ${descrizione.categorie.join(', ')}`
    : 'Nessuna categoria aziendale approvata: i lead aziendali non partiranno.');
  if (descrizione.consumer) righe.push(`Liste Consumer: ${descrizione.consumerEtichetta}`);

  const proposta = await propostaPianoGiorno(client, cfg, { data });
  righe.push(proposta.totale > 0
    ? `Appuntamenti Business: ${(proposta.perZona || []).map((z) => `${z.zona} (${z.n})`).join(', ')}`
    : 'Nessun appuntamento Business programmato.');
  if (proposta.totale > 0 && proposta.suggerimento) righe.push('', proposta.suggerimento);
  return righe.join('\n').slice(0, 2000);
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

// Le categorie tra cui si puo' scegliere NON sono nel codice: sono i settori
// dei contatti Business presenti in `call_center_lead_outbound`. Un elenco di
// esempio inventato ("Bar, negozi, officine") ha gia' fatto scrivere una
// direttiva con nomi inesistenti: qui si legge la realta'.
async function categorieDisponibili(client) {
  const { data, error } = await client
    .from('call_center_lead_outbound')
    .select('categoria')
    .eq('do_not_call', false)
    .in('stato_lead', ['nuovo', 'da_contattare', 'ricontattare'])
    .limit(1000);
  if (error || !Array.isArray(data)) return null;
  const conteggi = new Map();
  for (const row of data) {
    const categoria = String(row.categoria || '').trim();
    if (!categoria) continue;
    conteggi.set(categoria, (conteggi.get(categoria) || 0) + 1);
  }
  return [...conteggi.entries()]
    .map(([categoria, contatti]) => ({ categoria, contatti }))
    .sort((a, b) => b.contatti - a.contatti || a.categoria.localeCompare(b.categoria));
}

function etichettaCategorie(elenco, massimo = 12) {
  return elenco.slice(0, massimo).map((c) => `${c.categoria} (${c.contatti})`).join(', ');
}

// Le due modalita' Consumer sono invece fisse e note dal codice.
const CATEGORIE_CONSUMER = [
  'telefoni_omaggio (contatti Consumer da liste cartacee)',
  'fibra_fwa (contatti Consumer Fibra/FWA)'
];

async function cmdCategorie(client, chatId, data) {
  await audita(client, chatId, 'categorie_richieste', { data });
  // Nessuna copia stantia dello stato: il flag si applica allo stato corrente
  // e non cancella la voce di audit appena registrata.
  await aggiornaConversazione(client, chatId, { in_attesa_categorie: true });
  const elenco = await categorieDisponibili(client);
  if (elenco === null) {
    return 'Quali categorie vuoi chiamare? Scrivi l\'elenco separato da virgole.';
  }
  if (elenco.length === 0) {
    return [
      'Quali categorie vuoi chiamare? Al momento non ci sono contatti Business',
      'disponibili in nessuna categoria.',
      '',
      'Le modalita\' Consumer (sempre disponibili, liste manuali) sono:',
      ...CATEGORIE_CONSUMER.map((c) => `- ${c}`)
    ].join('\n');
  }
  return [
    'Quali categorie vuoi chiamare? Queste sono le categorie dei contatti Business',
    'disponibili adesso (fra parentesi quanti contatti):',
    etichettaCategorie(elenco),
    '',
    'Rispondi con uno o piu\' di questi nomi, separati da virgola.',
    'Le modalita\' Consumer (liste manuali) sono invece:',
    ...CATEGORIE_CONSUMER.map((c) => `- ${c}`)
  ].join('\n');
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
async function proponiConferma(client, chatId, azione, argomenti, contesto = {}) {
  const attesa = azioneInAttesa(azione, argomenti || {}, contesto);
  await aggiornaConversazione(client, chatId, { azione_in_attesa: attesa, in_attesa_categorie: false });
  await audita(client, chatId, 'conferma_richiesta', { azione, data: attesa.argomenti?.data || null });
  return {
    risposta: `${attesa.riassunto}\n\nRispondi "si" oppure "no".`,
    markup: tastieraConferma()
  };
}

// Chiede per QUALE giornata, invece di sceglierne una in silenzio: una
// direttiva "per oggi" non deve finire su domani (e' successo davvero).
// L'azione resta in sospeso SENZA data: al messaggio successivo "oggi"/"domani"
// viene completata e riproposta per la conferma.
async function chiediGiorno(client, chatId, azione, argomenti, contesto = {}) {
  const attesa = {
    azione,
    argomenti: { ...(argomenti || {}), data: null },
    creato_at: nowIso(),
    in_attesa_giorno: true,
    riassunto: null
  };
  await aggiornaConversazione(client, chatId, { azione_in_attesa: attesa, in_attesa_categorie: false });
  await audita(client, chatId, 'giorno_richiesto', { azione });
  return {
    testo: [
      `Per quale giornata vuoi ${azione === 'direttiva' ? 'applicare questa direttiva' : 'questa azione'}?`,
      `Scrivi "oggi" (${etichettaGiorno(contesto.oggi, contesto)}) oppure "domani" (${etichettaGiorno(contesto.domani, contesto)}).`,
      'Il giorno lo scegli tu: non lo decido io.'
    ].join('\n')
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

// Scrittura UNICA di una direttiva sul piano (usata dalla direttiva libera e
// dall'agenda guidata): cosi' le due strade non possono divergere.
// La modalita' Consumer e' una scelta ESPLICITA del chiamante: non si deduce
// mai dalle parole della nota (la parola "fibra" e' anche il nome di un'offerta
// e non deve riconfigurare la giornata da sola).
// `blocchi` (agenda guidata) diventa `contenuto.agenda_blocchi`: e' cio' che il
// motore legge per sapere, ora per ora, se proporre lead aziendali o lasciare
// all'operatrice le liste cartacee.
async function scriviPianoDirettiva(client, chatId, { data, categorie = [], nota = '', modalitaConsumer = null, blocchi = null }) {
  const operatori = await operatoriAbilitati(client);
  const agendaBlocchi = Array.isArray(blocchi) && blocchi.length ? agenda.serializzaBlocchi(blocchi) : null;
  for (const opId of operatori) {
    const esistente = await pianoDi(client, { data, operatoreId: opId });
    const contenuto = {
      ...(esistente?.contenuto || {}),
      ...(nota ? { direttiva_mirko: nota } : {}),
      ...(categorie.length ? { categorie_approvate: categorie } : {}),
      ...(modalitaConsumer ? { categoria_sessione: modalitaConsumer, consumer: modalitaConsumer } : {}),
      ...(agendaBlocchi ? { agenda_blocchi: agendaBlocchi } : {})
    };
    const salvato = await salvaPiano(client, {
      data, operatoreId: opId, contenuto: cleanLog(contenuto), sorgente: 'mirko', stato: 'approvato'
    });
    if (!salvato.ok) throw new Error('Impossibile salvare la direttiva sul piano');
  }
  await audita(client, chatId, 'direttiva_libera_approvata', { data, categoria_sessione: modalitaConsumer, categorie, blocchi: agendaBlocchi ? agendaBlocchi.length : 0 });
  return operatori.length;
}

// Applica al piano la direttiva confermata (categorie, nota e, se dichiarata,
// la modalita' Consumer).
async function applicaDirettiva(client, cfg, chatId, data, argomenti = {}) {
  const categorie = Array.isArray(argomenti.categorie) ? argomenti.categorie : [];
  const nota = String(argomenti.nota || '').slice(0, 1000);
  const modalitaConsumer = ['telefoni_omaggio', 'fibra_fwa'].includes(argomenti.modalita_consumer)
    ? argomenti.modalita_consumer
    : null;
  await scriviPianoDirettiva(client, chatId, { data, categorie, nota, modalitaConsumer });
  const riepilogo = categorie.length ? `Categorie: ${categorie.join(', ')}` : (nota || 'nessun dettaglio');
  const consumerRiga = modalitaConsumer
    ? `Modalita' Consumer: ${modalitaConsumer === 'fibra_fwa' ? 'liste Fibra/FWA' : 'liste telefoni omaggio'}.`
    : '';
  const avviso = await avvisoCategorie(client, categorie);
  const testo = [
    `Direttiva registrata e approvata per ${data}. ${riepilogo}`,
    consumerRiga,
    avviso ? '' : null,
    avviso
  ].filter((riga) => riga !== null && riga !== '').join('\n');
  return testo.slice(0, 900);
}

// Le categorie di una direttiva sono i nomi delle categorie dei CONTATTI
// ("Ristorazione", "Negozi", ...), non le offerte ("fissi", "mobile") ne'
// descrizioni generiche. Se nessun contatto corrisponde, la giornata
// rimarrebbe senza telefonate: meglio dirlo subito, con i nomi disponibili.
async function avvisoCategorie(client, categorie) {
  if (!Array.isArray(categorie) || categorie.length === 0) return '';
  const elenco = await categorieDisponibili(client);
  if (elenco === null) return '';
  const totale = elenco.reduce((somma, c) => somma + c.contatti, 0);
  // La corrispondenza si conta sui NOMI disponibili: il filtro dei candidati
  // usa la stessa regola (`categoriaCorrisponde`), quindi un nome approvato che
  // non compare qui non produrra' nessun contatto.
  const corrispondenti = elenco
    .filter((c) => categoriaCorrisponde(c.categoria, categorie))
    .reduce((somma, c) => somma + c.contatti, 0);
  if (corrispondenti > 0) {
    return `Contatti disponibili con queste categorie: ${corrispondenti} su ${totale}.`;
  }
  if (elenco.length === 0) {
    return [
      'ATTENZIONE: nessun contatto Business e\' disponibile in questo momento,',
      'quindi il piano non produrra\' telefonate Business.'
    ].join('\n');
  }
  return [
    'ATTENZIONE: nessun contatto corrisponde a queste categorie, quindi il piano',
    'non produrra\' telefonate Business. Le categorie che puoi scegliere sono:',
    `${etichettaCategorie(elenco)}.`,
    'Ripeti la direttiva usando uno di questi nomi (contatti fra parentesi).'
  ].join('\n');
}

// -- Agenda guidata ------------------------------------------------------------

// Costruzione della giornata a tappe: il bot propone le attivita', Mirko sceglie,
// il bot chiede l'orario, e finche' le ore previste non sono coperte ripropone
// cosa mettere nel tempo che resta. Nessuna scrittura sul piano fino alla
// conferma finale.

const AGENDA_SCADENZA_MINUTI = 60;

async function salvaAgenda(client, chatId, valore) {
  return aggiornaConversazione(client, chatId, { agenda: valore });
}

function agendaScaduta(a) {
  if (!a?.creato_at) return false;
  const creato = Date.parse(String(a.creato_at));
  if (!Number.isFinite(creato)) return true;
  return Date.now() - creato > AGENDA_SCADENZA_MINUTI * 60 * 1000;
}

// Avvia l'agenda per una giornata GIA' scelta dal chiamante.
// `cfg` deve essere la configurazione: se arriva qualcos'altro (capitava quando
// un chiamante dimenticava l'argomento) NON si scrive nessuno stato a meta',
// perche' un'agenda senza orari resterebbe appesa nella conversazione.
async function avviaAgenda(client, cfg, chatId, giorno, contesto = {}) {
  if (!cfg || typeof cfg !== 'object' || !chatId) {
    return { risposta: 'Agenda non avviata per un errore interno di configurazione. Riprova con /agenda.', markup: null };
  }
  const stato = {
    attiva: true,
    data: giorno,
    stato_fase: 'scelta_opzione',
    opzione: null,
    categorie: [],
    blocchi: [],
    creato_at: nowIso()
  };
  await salvaAgenda(client, chatId, stato);
  await audita(client, chatId, 'agenda_avviata', { data: giorno });
  const finestre = agenda.finestreGiorno(cfg);
  return {
    risposta: [
      `Costruiamo l'agenda di ${etichettaGiorno(giorno, contesto)}.`,
      finestre.length
        ? `Le ore di lavoro sono ${finestre.map((f) => `${agenda.fmtHHmm(f.da)}-${agenda.fmtHHmm(f.a)}`).join(' e ')} (${agenda.fmtDurata(agenda.minutiTotali(finestre))}).`
        : 'Non trovo orari di lavoro configurati.',
      'Per un\'altra giornata scrivi "domani" oppure la data (per esempio 16/09).',
      '',
      agenda.domandaOpzioni(stato, cfg)
    ].join('\n'),
    markup: agenda.tastieraOpzioni(stato)
  };
}

// Chiede l'orario per l'opzione scelta.
function chiediOrario(stato, fase) {
  const etichetta = agenda.opzionePerId(stato.opzione)?.etichetta || stato.opzione;
  const residuo = agenda.buchiResidui(fase.finestre, stato.blocchi)
    .map((b) => `${agenda.fmtHHmm(b.da)}-${agenda.fmtHHmm(b.a)}`).join(', ');
  return [
    `Quale orario per "${etichetta}"?`,
    `Scrivi per esempio "15:30-17:00", oppure una durata ("90 minuti").`,
    residuo ? `Spazi liberi: ${residuo}.` : ''
  ].filter(Boolean).join('\n');
}

// Carica i dati che servono in ogni passo (finestre + categorie reali).
async function faseAgenda(client, cfg) {
  const finestre = agenda.finestreGiorno(cfg);
  const categorie = await categorieDisponibili(client);
  return { finestre, categorie };
}

// Scelta dell'opzione, da pulsante o da testo: identica nei due percorsi.
async function scegliOpzione(client, cfg, chatId, stato, opzioneId, fase) {
  const opzione = agenda.opzionePerId(opzioneId);
  if (!opzione) {
    return { testo: agenda.domandaOpzioni(stato, cfg), markup: agenda.tastieraOpzioni(stato) };
  }
  const consumerGia = (stato.blocchi || [])
    .map((b) => agenda.opzionePerId(b.opzione))
    .find((o) => o && o.consumer);
  if (opzione.consumer && consumerGia && consumerGia.consumer !== opzione.consumer) {
    return {
      testo: [
        `Le liste Consumer sono una modalita' al giorno: hai gia' scelto "${consumerGia.etichetta}".`,
        'Per cambiare modalita\' Consumer, annulla l\'agenda e ricominciala.',
        '',
        agenda.domandaOpzioni(stato, cfg)
      ].join('\n'),
      markup: agenda.tastieraOpzioni(stato)
    };
  }

  if (opzione.consumer) {
    stato.opzione = opzione.id;
    stato.stato_fase = 'attesa_orario';
    await salvaAgenda(client, chatId, stato);
    return { testo: chiediOrario(stato, fase) };
  }

  // Lead aziendali: prima le categorie reali, poi l'orario.
  if (!fase.categorie || fase.categorie.length === 0) {
    return {
      testo: [
        'Non ci sono contatti Business disponibili in questo momento: per oggi le',
        'chiamate aziendali non produrrebbero nulla.',
        '',
        agenda.domandaOpzioni(stato, cfg)
      ].join('\n'),
      markup: agenda.tastieraOpzioni(stato)
    };
  }
  stato.opzione = opzione.id;
  stato.stato_fase = 'scelta_categorie';
  await salvaAgenda(client, chatId, stato);
  return {
    testo: [
      'Quali categorie di contatti aziendali? (fra parentesi quanti ne hai)',
      etichettaCategorie(fase.categorie),
      '',
      'Rispondi con uno o piu\' nomi separati da virgola, oppure "tutte".'
    ].join('\n')
  };
}

// Aggiunge il blocco e decide il passo successivo: se resta tempo ripropone le
// opzioni, altrimenti chiede la conferma finale.
async function aggiungiBlocco(client, cfg, chatId, stato, blocco, fase) {
  stato.blocchi = [...(stato.blocchi || []), { opzione: stato.opzione, da: blocco.da, a: blocco.a }];
  const residuo = agenda.minutiResidui(fase.finestre, stato.blocchi);
  const opzione = agenda.opzionePerId(stato.opzione);
  const conferma = `Aggiunto: ${agenda.fmtHHmm(blocco.da)}-${agenda.fmtHHmm(blocco.a)} ${opzione ? opzione.etichetta : ''}.`;
  if (residuo <= 0) {
    stato.stato_fase = 'conferma';
    await salvaAgenda(client, chatId, stato);
    return {
      testo: [
        conferma,
        '',
        agenda.riepilogoAgenda(stato, cfg),
        '',
        'Confermi questa agenda? Rispondi "si" oppure "no".'
      ].join('\n'),
      markup: agenda.tastieraConfermaAgenda()
    };
  }
  stato.stato_fase = 'scelta_opzione';
  stato.opzione = null;
  await salvaAgenda(client, chatId, stato);
  return {
    testo: [conferma, '', agenda.domandaOpzioni(stato, cfg)].join('\n'),
    markup: agenda.tastieraOpzioni(stato)
  };
}

// Scrive l'agenda nel piano della giornata.
async function applicaAgenda(client, cfg, chatId, stato) {
  const blocchi = stato.blocchi || [];
  const consumer = blocchi
    .map((b) => agenda.opzionePerId(b.opzione))
    .find((o) => o && o.consumer);
  const nota = agenda.righeBlocchi(stato).join('; ').slice(0, 1000);
  const scritti = await scriviPianoDirettiva(client, chatId, {
    data: stato.data,
    categorie: Array.isArray(stato.categorie) ? stato.categorie : [],
    nota,
    modalitaConsumer: consumer ? consumer.consumer : null,
    blocchi
  });
  // Senza operatrici abilitate il piano non esiste: dirlo invece di confermare
  // un'agenda che il motore non leggera' mai. Lo stato resta aperto per riprovare.
  if (scritti === 0) {
    await audita(client, chatId, 'agenda_non_applicata', { data: stato.data, motivo: 'nessuna_operatrice_abilitata' });
    return {
      testo: [
        'Non ho applicato l\'agenda: non risulta nessuna operatrice abilitata a KONA.',
        'Controlla i profili abilitati e poi riscrivi /agenda.',
        '',
        agenda.riepilogoAgenda(stato, cfg)
      ].join('\n')
    };
  }
  await salvaAgenda(client, chatId, null);
  await audita(client, chatId, 'agenda_applicata', { data: stato.data, blocchi: blocchi.length, operatrici: scritti });
  const avviso = await avvisoCategorie(client, stato.categorie || []);
  return {
    testo: [
      `Agenda di ${stato.data} applicata (${scritti} operatrici).`,
      agenda.riepilogoAgenda(stato, cfg),
      '',
      'Nota: le ore indicano cosa mettere in giornata e in quale fascia. Dentro',
      '"Lead Outbound Aziendali" KONA ti propone i lead delle categorie',
      'approvate; nelle fasce manuali non propone nulla e registri tu le',
      'chiamate fatte sulle liste cartacee.',
      avviso
    ].filter(Boolean).join('\n').slice(0, 1200)
  };
}

// Pulsanti dell'agenda.
async function gestisciAgendaCallback(client, cfg, chatId, arg) {
  const stato = (await caricaStato(client, chatId)).stato_conversazione?.agenda;
  if (!stato?.attiva || agendaScaduta(stato)) {
    return { testo: 'Non c\'e\' nessuna agenda in costruzione. Usa /agenda per iniziarne una.' };
  }
  const fase = await faseAgenda(client, cfg);
  if (arg === 'annulla') {
    await salvaAgenda(client, chatId, null);
    await audita(client, chatId, 'agenda_annullata', { data: stato.data });
    return { testo: 'Agenda annullata: non ho scritto nulla nel piano.' };
  }
  if (arg === 'stop') {
    if (!(stato.blocchi || []).length) {
      await salvaAgenda(client, chatId, null);
      return { testo: 'Agenda annullata: non c\'era ancora nessuna attivita\'.' };
    }
    stato.stato_fase = 'conferma';
    await salvaAgenda(client, chatId, stato);
    return {
      testo: [
        agenda.riepilogoAgenda(stato, cfg),
        '',
        'Confermi questa agenda? Rispondi "si" oppure "no".'
      ].join('\n'),
      markup: agenda.tastieraConfermaAgenda()
    };
  }
  if (arg === 'conferma') {
    if (!(stato.blocchi || []).length) {
      await salvaAgenda(client, chatId, null);
      return { testo: 'Agenda vuota: non ho scritto nulla.' };
    }
    return await applicaAgenda(client, cfg, chatId, stato);
  }
  const esito = await scegliOpzione(client, cfg, chatId, stato, arg, fase);
  return { testo: esito.testo, markup: esito.markup };
}

// Testo libero mentre l'agenda e' in costruzione. Ritorna null se non c'e'
// un'agenda attiva (il chiamante prosegue con il dialogo normale).
async function gestisciAgendaTesto(client, cfg, chatId, conv, text, contesto) {
  const stato = conv?.agenda;
  if (!stato?.attiva) return null;
  if (agendaScaduta(stato)) {
    await salvaAgenda(client, chatId, null);
    return { testo: 'L\'agenda era rimasta aperta troppo a lungo e l\'ho chiusa. Scrivi /agenda per ricominciare.' };
  }
  const t = String(text || '').trim().toLowerCase();
  const fase = await faseAgenda(client, cfg);

  if (/^(annulla|cancella|lascia stare|stop|basta|chiudi|fine)\b/.test(t)) {
    if (/^(basta|stop|chiudi|fine)\b/.test(t) && (stato.blocchi || []).length) {
      return await gestisciAgendaCallback(client, cfg, chatId, 'stop');
    }
    await salvaAgenda(client, chatId, null);
    await audita(client, chatId, 'agenda_annullata', { data: stato.data });
    return { testo: 'Agenda annullata: non ho scritto nulla nel piano.' };
  }

  // Cambio giornata a agenda aperta ("voglio costruire l'agenda per martedi'
  // 15/09/2026"). Se non c'e' ancora nessuna attivita' si riparte sulla
  // giornata nuova; se qualcosa e' gia' stato messo non si butta via niente in
  // silenzio.
  const chiesto = giornoDaTesto(text, contesto);
  if (chiesto && chiesto !== stato.data) {
    if ((stato.blocchi || []).length) {
      return {
        testo: [
          `Sto costruendo l'agenda di ${etichettaGiorno(stato.data, contesto)} e ci sono gia' ${stato.blocchi.length} attivita'.`,
          `Confermala con "basta cosi'", oppure scrivi "annulla" e poi /agenda per ${etichettaGiorno(chiesto, contesto)}.`
        ].join('\n')
      };
    }
    const nuova = await avviaAgenda(client, cfg, chatId, chiesto, contesto);
    return {
      testo: [`Cambio giornata: ${etichettaGiorno(chiesto, contesto)}.`, '', nuova.risposta].join('\n'),
      markup: nuova.markup
    };
  }
  // Data scritta ma non utilizzabile: dirlo, invece di rispondere "non ho
  // capito quale attivita' vuoi" a chi ha appena indicato una giornata.
  const esplicita = dataDaTesto(text, contesto);
  if (esplicita.motivo) {
    const motivo = esplicita.motivo === 'data_passata'
      ? 'quella data e\' passata'
      : (esplicita.motivo === 'data_troppo_lontana'
        ? 'quella data e\' troppo in la\' nel tempo'
        : 'quella data non esiste');
    return { testo: `Non posso usare quella giornata: ${motivo}. Scrivi "oggi", "domani" oppure una data valida.` };
  }

  if (stato.stato_fase === 'scelta_opzione') {
    const opzione = agenda.opzioneDaTesto(t);
    if (!opzione) {
      return {
        testo: [
          'Non ho capito quale attivita\' vuoi. Scegli con i pulsanti qui sotto,',
          'oppure scrivi "domani" (o una data) per cambiare giornata.',
          '',
          agenda.domandaOpzioni(stato, cfg)
        ].join('\n'),
        markup: agenda.tastieraOpzioni(stato)
      };
    }
    return await scegliOpzione(client, cfg, chatId, stato, opzione.id, fase);
  }

  if (stato.stato_fase === 'scelta_categorie') {
    const disponibili = fase.categorie || [];
    const scelte = /tutte|tutti/.test(t)
      ? disponibili.map((c) => c.categoria)
      : disponibili
        .filter((c) => t.split(',').some((nome) => {
          const n = nome.trim().toLowerCase();
          return n && (c.categoria.toLowerCase().includes(n) || n.includes(c.categoria.toLowerCase()));
        }))
        .map((c) => c.categoria);
    if (scelte.length === 0) {
      return {
        testo: [
          'Nessuna di queste corrisponde alle categorie disponibili. Scegli fra:',
          etichettaCategorie(disponibili),
          '',
          'oppure scrivi "tutte".'
        ].join('\n')
      };
    }
    stato.categorie = scelte;
    stato.stato_fase = 'attesa_orario';
    await salvaAgenda(client, chatId, stato);
    return { testo: [`Categorie scelte: ${scelte.join(', ')}.`, '', chiediOrario(stato, fase)].join('\n') };
  }

  if (stato.stato_fase === 'attesa_orario') {
    const parsed = agenda.parseIntervallo(t);
    if (!parsed.ok) {
      return { testo: `Non ho capito l'orario. Scrivi per esempio "15:30-17:00" oppure "90 minuti".\n\n${chiediOrario(stato, fase)}` };
    }
    const esito = agenda.componiBlocco(parsed, fase.finestre, stato.blocchi);
    if (!esito.ok) {
      const liberi = (esito.liberi || []).map((b) => `${agenda.fmtHHmm(b.da)}-${agenda.fmtHHmm(b.a)}`).join(', ');
      const motivo = esito.errore === 'non_resta_tempo'
        ? 'Le ore previste sono gia\' tutte coperte.'
        : esito.errore === 'durata_troppo_lunga'
          ? 'Non c\'e\' abbastanza tempo libero per questa durata.'
          : 'Quell\'orario non e\' dentro le finestre di lavoro o si sovrappone a un\'altra attivita\'.';
      return { testo: [motivo, liberi ? `Spazi liberi: ${liberi}.` : ''].filter(Boolean).join('\n') };
    }
    return await aggiungiBlocco(client, cfg, chatId, stato, esito.blocco, fase);
  }

  if (stato.stato_fase === 'conferma') {
    const scelta = confermaDeterministica(text);
    if (scelta === 'si') return await applicaAgenda(client, cfg, chatId, stato);
    if (scelta === 'no') {
      await salvaAgenda(client, chatId, null);
      await audita(client, chatId, 'agenda_annullata', { data: stato.data });
      return { testo: 'Agenda annullata: non ho scritto nulla nel piano.' };
    }
    return {
      testo: [agenda.riepilogoAgenda(stato, cfg), '', 'Rispondi "si" per applicarla oppure "no" per annullare.'].join('\n'),
      markup: agenda.tastieraConfermaAgenda()
    };
  }

  return { testo: agenda.domandaOpzioni(stato, cfg), markup: agenda.tastieraOpzioni(stato) };
}

// -- Dialogo libero ------------------------------------------------------------

// Unico ingresso del testo libero. Ordine:
//   1. conferma/annullamento deterministico di un'azione in attesa (gratis);
//   2. interpretazione IA del messaggio;
//   3. letture eseguite subito, azioni delicate solo PROPOSTE.
async function gestisciLinguaggioNaturale(client, cfg, chatId, conv, text, data, domani) {
  const contestoGiorni = { oggi: data, domani };
  const attesa = conv?.azione_in_attesa;
  if (attesa && !confermaValida(attesa)) {
    // Conferma scaduta: non si esegue nulla di proposto troppo tempo prima.
    await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
    conv = { ...conv, azione_in_attesa: null };
  } else if (attesa && attesa.in_attesa_giorno) {
    // Stavamo aspettando il giorno. Se ora Mirko lo dice, l'azione riparte con
    // la data giusta; altrimenti il chiarimento decade e il messaggio viene
    // interpretato come una richiesta nuova.
    const giorno = giornoDaTesto(text, contestoGiorni);
    if (giorno && attesa.azione === 'agenda') {
      // L'agenda non e' una proposta da confermare: parte subito con il giorno.
      await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
      return await avviaAgenda(client, cfg, chatId, giorno, contestoGiorni);
    }
    if (giorno) {
      const proposta = await proponiConferma(client, chatId, attesa.azione, { ...(attesa.argomenti || {}), data: giorno }, contestoGiorni);
      return { testo: proposta.risposta, markup: proposta.markup };
    }
    await aggiornaConversazione(client, chatId, { azione_in_attesa: null });
    await audita(client, chatId, 'conferma_abbandonata', { azione: attesa.azione, motivo: 'giorno_non_indicato' });
    conv = { ...conv, azione_in_attesa: null };
  } else if (attesa) {
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
  }

  const operatori = await operatoriAbilitati(client);

  // Agenda in costruzione: ha la precedenza sull'interpretazione IA, perche' e'
  // una procedura a tappe e ogni messaggio e' la risposta alla domanda
  // precedente (opzione, categorie, orario).
  const esitoAgenda = await gestisciAgendaTesto(client, cfg, chatId, conv, text, contestoGiorni);
  if (esitoAgenda) return esitoAgenda;

  const contesto = await contestoAssistente(client, cfg, { oggi: data, domani, operatori, conv });
  const esito = await interpreta({ supabase: client, cfg, testo: text, contesto });

  if (!esito.ok) return await rispostaSenzaIa(client, chatId, conv, text, data, domani, esito);

  // Avvio dell'agenda guidata: come le altre azioni che scrivono su un piano,
  // senza una giornata indicata si CHIEDE quale.
  if (esito.azione === 'agenda') {
    if (!esito.argomenti.data) {
      return await chiediGiorno(client, chatId, 'agenda', {}, contestoGiorni);
    }
    return await avviaAgenda(client, cfg, chatId, esito.argomenti.data, contestoGiorni);
  }

  if (richiedeConferma(esito.azione)) {
    // Nessun giorno scelto di nascosto: se Mirko non ha detto QUALE giornata,
    // si chiede. Un default silenzioso ("domani") ha gia' fatto scrivere una
    // direttiva "di oggi" sul piano di domani.
    if (!esito.argomenti.data && giornoRichiesto(esito.azione)) {
      return await chiediGiorno(client, chatId, esito.azione, esito.argomenti, contestoGiorni);
    }
    const proposta = await proponiConferma(client, chatId, esito.azione, esito.argomenti, contestoGiorni);
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
async function rispostaSenzaIa(client, chatId, conv, text, data, domani, esito) {
  if (conv?.in_attesa_categorie) {
    const categorie = text.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 8);
    const proposta = await proponiConferma(client, chatId, 'direttiva', { categorie, data: domani, nota: '' }, { oggi: data, domani });
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

// Esposti per i test: la function Netlify usa soltanto `handler`.
module.exports._test = { applicaAgenda, avviaAgenda, avvisoCategorie, categorieDisponibili, cmdPiano, etichettaCategorie, gestisciAgendaCallback, gestisciAgendaTesto, scriviPianoDirettiva };
