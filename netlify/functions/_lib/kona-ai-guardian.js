'use strict';

const { isTelegramConfigured, sendTelegramMessage } = require('./telegram');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES = ['bassa', 'media', 'alta', 'critica'];
const OPEN_INCIDENT_STATES = [
  'raccolta',
  'ricevuto',
  'in_analisi',
  'in_attesa_approvazione',
  'fix_approvato',
  'in_lavorazione',
  'in_test'
];

function cleanText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function profileId(auth) {
  const value = auth?.profilo?.alias_di || auth?.profilo?.id || auth?.user?.id;
  return UUID_RE.test(String(value || '')) ? String(value).toLowerCase() : null;
}

function profileName(auth) {
  return cleanText(auth?.profilo?.nome || auth?.profilo?.email || auth?.user?.email || 'Operatore Mirox', 250);
}

function incidentCode(numero) {
  return `KG-${String(numero || 0).padStart(6, '0')}`;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && content.text) return String(content.text).trim();
    }
  }
  return '';
}

async function openaiStructured({ instructions, input, name, schema, maxOutputTokens = 700 }) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: String(process.env.OPENAI_GUARDIAN_MODEL || 'gpt-5.6-luna'),
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name,
          strict: true,
          schema
        }
      }
    }),
    signal: AbortSignal.timeout(45000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `OpenAI Responses API ${response.status}`);
  }
  const output = extractOutputText(payload);
  if (!output) throw new Error('OpenAI non ha restituito un testo strutturato');
  return JSON.parse(output);
}

function intakeFallback(messages) {
  const humanMessages = messages.filter((item) => item.autore_tipo === 'operatore' || item.autore_tipo === 'mirko');
  const total = humanMessages.map((item) => item.testo).join(' ').length;
  if (humanMessages.length < 2 || total < 140) {
    return {
      reply: 'Per capire bene mi servono ancora tre elementi: cosa stavi facendo, cosa ti aspettavi e cosa è successo invece. Se compare un messaggio di errore, riportalo per intero.',
      complete: false,
      title: null,
      priority: 'media',
      summary: null
    };
  }
  return {
    reply: 'Grazie, ho registrato la segnalazione. KONA AI Guardian la porterà nella chat privata di Mirko per l’analisi e le eventuali approvazioni.',
    complete: true,
    title: 'Problema segnalato dal CRM',
    priority: 'media',
    summary: cleanText(humanMessages.map((item) => item.testo).join(' '), 1200)
  };
}

async function generateIntakeReply(messages, incidentContext = {}) {
  const input = messages.slice(-16).map((item) => ({
    role: item.autore_tipo === 'guardian' ? 'assistant' : 'user',
    content: cleanText(item.testo, 4000)
  }));

  const schema = {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      complete: { type: 'boolean' },
      title: { type: ['string', 'null'] },
      priority: { type: 'string', enum: PRIORITIES },
      summary: { type: ['string', 'null'] }
    },
    required: ['reply', 'complete', 'title', 'priority', 'summary'],
    additionalProperties: false
  };
  const pageHint = cleanText(incidentContext.pagina_path || 'pagina non indicata', 300);
  const instructions = [
    'Sei KONA AI Guardian, il raccoglitore di problemi tecnici del CRM Mirox.',
    'Parla in italiano semplice con un operatore non tecnico e fai una sola domanda breve per volta.',
    'Raccogli almeno: operazione in corso, risultato atteso, risultato reale, eventuale messaggio di errore e possibilità di riprodurlo.',
    'Non chiedere password, codici OTP, dati di carte, token, chiavi API o documenti personali.',
    'Non promettere una correzione e non dichiarare di aver analizzato il codice.',
    'Imposta complete=true solo quando la descrizione consente a Mirko di iniziare un’analisi.',
    `Pagina di provenienza: ${pageHint}.`
  ].join(' ');

  try {
    const result = await openaiStructured({
      instructions,
      input,
      name: 'kona_guardian_intake',
      schema,
      maxOutputTokens: 600
    });
    if (!result) return intakeFallback(messages);
    const reply = cleanText(result.reply, 1800);
    const title = result.title ? cleanText(result.title, 180) : null;
    return {
      reply: reply || intakeFallback(messages).reply,
      complete: Boolean(result.complete),
      title: title && title.length >= 3 ? title : null,
      priority: PRIORITIES.includes(result.priority) ? result.priority : 'media',
      summary: result.summary ? cleanText(result.summary, 2000) : null
    };
  } catch (error) {
    console.warn('KONA AI intake fallback:', error?.message || String(error));
    return intakeFallback(messages);
  }
}

async function generateOwnerReply(incident, messages, ownerMessage) {
  const input = [
    {
      role: 'user',
      content: `Incidente ${incidentCode(incident.numero)}\nTitolo: ${incident.titolo || 'Non definito'}\nPriorità: ${incident.priorita}\nStato: ${incident.stato}\nRiepilogo: ${incident.riepilogo_ai || incident.descrizione_iniziale}`
    },
    ...messages.slice(-14).map((item) => ({
      role: item.autore_tipo === 'guardian' ? 'assistant' : 'user',
      content: cleanText(item.testo, 4000)
    })),
    { role: 'user', content: cleanText(ownerMessage, 4000) }
  ];
  const schema = {
    type: 'object',
    properties: {
      reply: { type: 'string' },
      suggested_action: { type: 'string', enum: ['nessuna', 'analizza_guardian', 'archivia'] }
    },
    required: ['reply', 'suggested_action'],
    additionalProperties: false
  };
  const instructions = [
    'Sei KONA AI Guardian e parli esclusivamente con Mirko, proprietario del CRM.',
    'Ragiona sull’incidente usando solo le informazioni fornite.',
    'Distingui sempre fatti, ipotesi e verifiche mancanti.',
    'Non affermare di aver letto il repository, eseguito test o applicato correzioni se non è documentato nei messaggi.',
    'Qualsiasi analisi ulteriore o archiviazione deve essere proposta e richiede conferma esplicita di Mirko.',
    'Non proporre mai direttamente il rilascio in produzione.'
  ].join(' ');

  const result = await openaiStructured({
    instructions,
    input,
    name: 'kona_guardian_owner_reply',
    schema,
    maxOutputTokens: 900
  });
  if (!result) {
    return {
      reply: 'La conversazione Telegram è attiva, ma l’analisi intelligente richiede la variabile OPENAI_API_KEY nell’ambiente di staging.',
      suggestedAction: 'nessuna'
    };
  }
  return {
    reply: cleanText(result.reply, 3500) || 'Non ho una risposta utilizzabile. Puoi riformulare la richiesta?',
    suggestedAction: ['nessuna', 'analizza_guardian', 'archivia'].includes(result.suggested_action)
      ? result.suggested_action
      : 'nessuna'
  };
}

async function generateGuardianAnalysis(incident, messages) {
  const schema = {
    type: 'object',
    properties: {
      analysis: { type: 'string' },
      probable_causes: { type: 'array', items: { type: 'string' } },
      checks: { type: 'array', items: { type: 'string' } },
      recommended_next_step: { type: 'string' }
    },
    required: ['analysis', 'probable_causes', 'checks', 'recommended_next_step'],
    additionalProperties: false
  };
  const input = [{
    role: 'user',
    content: JSON.stringify({
      incident: {
        code: incidentCode(incident.numero),
        title: incident.titolo,
        priority: incident.priorita,
        page: incident.pagina_path,
        summary: incident.riepilogo_ai,
        initial_description: incident.descrizione_iniziale
      },
      conversation: messages.slice(-24).map((item) => ({
        author: item.autore_tipo,
        text: cleanText(item.testo, 4000)
      }))
    })
  }];
  const result = await openaiStructured({
    instructions: [
      'Analizza un incidente del CRM Mirox esclusivamente dai dati forniti.',
      'Non hai accesso al repository, ai log di produzione o al database: dichiaralo nel testo.',
      'Separa cause probabili da fatti confermati e proponi verifiche non distruttive.',
      'Non proporre modifiche in produzione e non dichiarare il problema risolto.'
    ].join(' '),
    input,
    name: 'kona_guardian_analysis',
    schema,
    maxOutputTokens: 1300
  });
  if (!result) throw new Error('OPENAI_API_KEY non configurata per l’analisi Guardian');
  return [
    cleanText(result.analysis, 2200),
    '',
    'Cause probabili:',
    ...(result.probable_causes || []).slice(0, 5).map((item) => `- ${cleanText(item, 500)}`),
    '',
    'Verifiche consigliate:',
    ...(result.checks || []).slice(0, 6).map((item) => `- ${cleanText(item, 500)}`),
    '',
    `Prossimo passo: ${cleanText(result.recommended_next_step, 800)}`
  ].join('\n').slice(0, 3500);
}

function incidentNotificationKeyboard(incidentId) {
  return {
    inline_keyboard: [
      [{ text: 'Apri conversazione', callback_data: `open:${incidentId}` }],
      [{ text: 'Analisi Guardian', callback_data: `analyze:${incidentId}` }],
      [{ text: 'Archivia', callback_data: `archive:${incidentId}` }]
    ]
  };
}

async function notifyOwnerOfIncident(incident) {
  if (!isTelegramConfigured()) return { sent: false, reason: 'telegram_not_configured' };
  const chatId = String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID).trim();
  const text = [
    `Nuovo incidente ${incidentCode(incident.numero)}`,
    `Priorità: ${incident.priorita}`,
    `Segnalato da: ${incident.reporter_nome}`,
    `Pagina: ${incident.pagina_path || 'non indicata'}`,
    '',
    incident.titolo || 'Problema CRM',
    incident.riepilogo_ai || incident.descrizione_iniziale
  ].join('\n');
  const result = await sendTelegramMessage(chatId, text, {
    reply_markup: incidentNotificationKeyboard(incident.id)
  });
  return { sent: true, messageId: result.message_id, chatId };
}

module.exports = {
  OPEN_INCIDENT_STATES,
  cleanText,
  generateGuardianAnalysis,
  generateIntakeReply,
  generateOwnerReply,
  incidentCode,
  incidentNotificationKeyboard,
  notifyOwnerOfIncident,
  profileId,
  profileName
};
