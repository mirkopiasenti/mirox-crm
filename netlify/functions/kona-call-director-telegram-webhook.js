/**
 * Webhook Telegram dedicato a KONA Call Director (bot separato dal Guardian).
 *
 * - Secret token: header X-Telegram-Bot-Api-Secret-Token, confronto timing-safe.
 * - Allowlist chat_id: risponde SOLO al proprietario (KONA_CALL_DIRECTOR_OWNER_CHAT_ID).
 * - Stato conversazione server-side in kona_call_director_telegram.
 * - Supporta testo libero, comandi, pulsanti inline e callback_query.
 * - Decisioni (approva piano / categorie / sospensione) auditate nello storico.
 * - I cambiamenti della giornata vengono applicati (non a metà di un contatto).
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
const { addDaysStr, monthRomeKey, nextWorkingDay, todayRomeStr } = require('./_lib/kona-cd-time');
const { cleanLog, nowIso } = require('./_lib/kona-cd-util');

const AIUTO = [
  'KONA Call Director - Comandi:',
  '/stato - stato globale e budget',
  '/report - report di oggi (aggregati)',
  '/piano [domani] - piano Business proposto',
  '/approva - approva il piano',
  '/categorie - approva/modifica le categorie da chiamare',
  '/sospendi - sospensione immediata (globale off + task in pausa)',
  '/riattiva - riattiva il sistema',
  '/aiuto - questo elenco'
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
    const stato = await caricaStato(client, chatId);
    if (updateId && stato.ultimo_update_id && updateId <= stato.ultimo_update_id) {
      return { statusCode: 200, body: 'ok' }; // duplicato
    }
    if (updateId) {
      await client.from('kona_call_director_telegram').upsert({ chat_id: chatId, ultimo_update_id: updateId }, { onConflict: 'chat_id' });
    }

    const cfg = await getConfig(client);
    const data = todayRomeStr();
    const domani = nextWorkingDay(data, cfg.giorni_lavorativi, cfg.ferie);

    if (callback) {
      await gestisciCallback(client, cfg, chatId, callback);
      return { statusCode: 200, body: 'ok' };
    }

    const text = String(message?.text || '').trim();
    let risposta = null;
    let markup = null;

    if (!text) {
      risposta = 'Comando non riconosciuto. /aiuto per l\'elenco.';
    } else if (text === '/aiuto') {
      risposta = AIUTO;
    } else if (text === '/stato') {
      risposta = await cmdStato(client, cfg, data);
    } else if (text === '/report') {
      risposta = await cmdReport(client, cfg, data);
    } else if (text === '/piano' || text === '/piano domani') {
      risposta = await cmdPiano(client, cfg, domani);
      markup = inlinePiano(domani);
    } else if (text === '/approva') {
      risposta = await cmdApprova(client, cfg, domani, chatId);
    } else if (text === '/categorie') {
      risposta = await cmdCategorie(client, chatId, domani);
    } else if (text === '/sospendi') {
      risposta = await cmdSospendi(client, chatId);
    } else if (text === '/riattiva') {
      risposta = await cmdRiattiva(client, chatId);
    } else {
      // Dialogo libero: se il proprietario sta rispondendo alla domanda sul
      // piano, la sua risposta viene applicata come direttiva/nota sul piano.
      risposta = await gestisciDialogo(client, cfg, chatId, text, domani);
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

  if (tipo === 'piano' && arg === 'vedi') risposta = await cmdPiano(client, cfg, giorno);
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

async function audita(client, chatId, decisione, dettagli = {}) {
  const stato = await caricaStato(client, chatId);
  const storico = Array.isArray(stato.stato_conversazione?.storico) ? stato.stato_conversazione.storico : [];
  storico.push(cleanLog({ ts: nowIso(), decisione, ...dettagli }));
  const nuovo = { ...(stato.stato_conversazione || {}), storico: storico.slice(-200) };
  await client.from('kona_call_director_telegram').upsert({ chat_id: chatId, stato_conversazione: nuovo }, { onConflict: 'chat_id' });
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
    `Budget ${budget.mese}: speso ${budget.speso.toFixed(2)} su ${budget.budget.toFixed(2)} euro (${budget.percentuale}%)`
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
      contenuto: { totale: 0, perZona: [], suggerimento: 'Telefoni omaggio da liste cartacee (Consumer manuale)' },
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
  const stato = await caricaStato(client, chatId);
  await audita(client, chatId, 'categorie_richieste', { data });
  await client.from('kona_call_director_telegram').upsert(
    { chat_id: chatId, stato_conversazione: { ...(stato.stato_conversazione || {}), in_attesa_categorie: true } },
    { onConflict: 'chat_id' }
  );
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

// Dialogo libero: risposta alla domanda sulle categorie o sul piano.
async function gestisciDialogo(client, cfg, chatId, text, domani) {
  const stato = await caricaStato(client, chatId);
  const conv = stato.stato_conversazione || {};
  if (conv.in_attesa_categorie) {
    const categorie = text.split(',').map((c) => c.trim()).filter(Boolean);
    await audita(client, chatId, 'categorie_approvate', { categorie });
    await client.from('kona_call_director_telegram').upsert(
      { chat_id: chatId, stato_conversazione: { ...conv, in_attesa_categorie: false, categorie_approvate: categorie } },
      { onConflict: 'chat_id' }
    );
    const operatori = await operatoriAbilitati(client);
    for (const opId of operatori) {
      const esistente = await pianoDi(client, { data: domani, operatoreId: opId });
      const contenuto = { ...(esistente?.contenuto || {}), categorie_approvate: categorie };
      const salvato = await salvaPiano(client, {
        data: domani,
        operatoreId: opId,
        contenuto: cleanLog(contenuto),
        sorgente: 'mirko',
        stato: 'approvato'
      });
      if (!salvato.ok) throw new Error('Impossibile salvare le categorie approvate');
    }
    return `Categorie approvate: ${categorie.join(', ')}.`;
  }
  const lower = text.toLowerCase();
  const categoriaSessione = lower.includes('telefono') && lower.includes('omaggio')
    ? 'telefoni_omaggio'
    : (lower.includes('fibra') || lower.includes('fwa')) ? 'fibra_fwa'
      : lower.includes('business') ? 'business' : null;
  const operatori = await operatoriAbilitati(client);
  for (const opId of operatori) {
    const esistente = await pianoDi(client, { data: domani, operatoreId: opId });
    const contenuto = {
      ...(esistente?.contenuto || {}),
      direttiva_mirko: text.slice(0, 1000),
      ...(categoriaSessione ? { categoria_sessione: categoriaSessione } : {})
    };
    await salvaPiano(client, {
      data: domani, operatoreId: opId, contenuto: cleanLog(contenuto), sorgente: 'mirko', stato: 'approvato'
    });
  }
  await audita(client, chatId, 'direttiva_libera_approvata', { data: domani, categoria_sessione: categoriaSessione });
  return `Direttiva registrata e approvata per ${domani}: ${text.slice(0, 500)}`;
}
