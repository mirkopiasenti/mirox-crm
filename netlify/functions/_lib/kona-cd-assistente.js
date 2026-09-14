'use strict';

const { aiStructured } = require('./kona-cd-ai');
const { budgetSnapshot } = require('./kona-cd-budget');
const { pianoDi } = require('./kona-cd-report');
const { monthRomeKey } = require('./kona-cd-time');
const { cleanLog, cleanText, nowIso } = require('./kona-cd-util');

// Assistente in linguaggio naturale del bot Telegram di KONA Call Director.
//
// COME FUNZIONA
// Il messaggio di Mirko viene interpretato da un modello (DeepSeek V4.1 Flash)
// che deve restituire un oggetto JSON con l'azione riconosciuta. Il modello NON
// esegue nulla: classifica e propone. L'esecuzione resta nel webhook.
//
// REGOLA DELLE AZIONI DELICATE (richiesta esplicita di Mirko)
// Le letture (stato, report, piano) rispondono subito. Le azioni che CAMBIANO
// qualcosa (sospendi, riattiva, approva piano, telefoni omaggio, direttiva sul
// piano) NON vengono eseguite: il bot le ripropone in chiaro e aspetta un
// "si" o un "no" esplicito. Cosi' un fraintendimento dell'IA non puo' spegnere
// il call center.
//
// PRIVACY
// Al modello arrivano SOLO numeri e aggregati (quanti task, quanti
// appuntamenti, budget, zone). Mai nomi, telefoni, codici fiscali o email dei
// clienti: `contestoAssistente` costruisce l'unico oggetto che esce dal server
// e non legge alcuna tabella anagrafica.
//
// COSTO
// Ogni messaggio interpretato e' una chiamata a pagamento registrata come
// attivita' `telegram`, dentro la riserva dedicata (default 10 EUR/mese).
// Il "si"/"no" di conferma e i comandi con la barra NON chiamano l'IA.

// Azioni che l'assistente puo' proporre.
const AZIONI = [
  'stato', 'report', 'piano', 'aiuto', 'categorie',
  'approva_piano', 'sospendi', 'riattiva', 'telefoni_omaggio', 'direttiva',
  'conferma', 'annulla', 'altro'
];

// Azioni che MODIFICANO lo stato: mai eseguite senza un "si" esplicito.
const AZIONI_DELICATE = ['approva_piano', 'sospendi', 'riattiva', 'telefoni_omaggio', 'direttiva'];

// Dopo questo tempo una conferma in sospeso decade (non si conferma per sbaglio
// un'azione proposta mezz'ora prima).
const ATTESA_CONFERMA_MINUTI = 30;

function richiedeConferma(azione) {
  return AZIONI_DELICATE.includes(String(azione || ''));
}

// "si"/"no" riconosciuti SENZA chiamare l'IA: la conferma non deve costare
// nulla ed essere immediata.
const SI = /^(si|sì|ok|okay|va bene|va bene cosi|confermo|conferma|procedi|vai|fai|yes|y)$/i;
const NO = /^(no|annulla|annullo|lascia stare|lascia perdere|cancella|stop|n|no grazie)$/i;

function confermaDeterministica(testo) {
  const t = String(testo || '').trim().replace(/[.!]+$/, '').toLowerCase();
  if (!t) return null;
  if (SI.test(t)) return 'si';
  if (NO.test(t)) return 'no';
  return null;
}

// La conferma in sospeso e' ancora valida?
function confermaValida(attesa, adesso = Date.now()) {
  if (!attesa || !attesa.azione) return false;
  const creato = Date.parse(String(attesa.creato_at || ''));
  if (!Number.isFinite(creato)) return false;
  return adesso - creato <= ATTESA_CONFERMA_MINUTI * 60 * 1000;
}

function schemaIntento() {
  return {
    type: 'object',
    properties: {
      azione: { type: 'string', enum: AZIONI },
      data: { type: 'string' },
      categorie: { type: 'array' },
      nota: { type: 'string' },
      risposta: { type: 'string' },
      confidenza: { type: 'number' }
    },
    required: ['azione', 'risposta', 'confidenza'],
    additionalProperties: false
  };
}

// Normalizza gli argomenti prodotti dal modello: il contenuto e' NON fidato
// (testo libero) e viene troncato e ripulito prima di toccare il database.
function normalizzaArgomenti(value, contesto) {
  const categorie = Array.isArray(value?.categorie)
    ? value.categorie
      .map((c) => cleanText(String(c || ''), 40).replace(/[^\p{L}\p{N}\s&''-]/gu, '').trim())
      .filter(Boolean)
      .slice(0, 8)
    : [];
  const dataGrezza = String(value?.data || '').trim().toLowerCase();
  const data = dataGrezza === 'oggi' ? contesto?.oggi
    : dataGrezza === 'domani' ? contesto?.domani
      : /^\d{4}-\d{2}-\d{2}$/.test(dataGrezza) ? dataGrezza
        : null;
  return {
    categorie,
    data,
    nota: cleanText(String(value?.nota || ''), 500)
  };
}

function istruzioniAssistente(contesto) {
  return [
    'Sei l\'assistente Telegram di KONA Call Director, il sistema di call center',
    'automatico di Mirox. Parli con Mirko, il proprietario, in italiano.',
    'Devi classificare il suo messaggio e rispondere in modo breve e concreto.',
    '',
    'Azioni possibili:',
    '- stato: chiede lo stato del sistema o il budget.',
    '- report: chiede i numeri della giornata.',
    '- piano: chiede il piano di una giornata.',
    '- categorie: chiede quali categorie far chiamare.',
    '- approva_piano: approva il piano gia\' proposto.',
    '- sospendi: vuole fermare tutto subito.',
    '- riattiva: vuole riaccendere il sistema.',
    '- telefoni_omaggio: vuole il piano Telefoni omaggio da liste cartacee.',
    '- direttiva: da\' un\'indicazione libera sul piano di domani (per esempio un',
    '  elenco di categorie o una nota operativa).',
    '- conferma / annulla: risponde si o no a una domanda precedente.',
    '- aiuto: chiede l\'elenco dei comandi.',
    '- altro: tutto il resto (domande generiche, saluti).',
    '',
    'Regole:',
    '- Non inventare numeri: usa solo i dati nel contesto.',
    '- Se non sei sicuro dell\'azione, usa "altro" e chiedi di precisare.',
    '- Per una richiesta distruttiva o ambigua ("ferma", "lascia perdere") usa',
    '  l\'azione corrispondente solo se la richiesta e\' chiara; altrimenti "altro".',
    '- "risposta" e\' il testo che verra\' mostrato a Mirko: massimo 400 caratteri,',
    '  nessuna emoji, nessun dato personale dei clienti.',
    '- "confidenza" e\' un numero fra 0 e 1.',
    '',
    `Contesto corrente (solo aggregati, nessun dato cliente): ${JSON.stringify(contesto?.dati || {})}`
  ].join('\n');
}

// Unico punto in cui si costruisce cio' che esce dal server verso il modello.
// Nessuna tabella anagrafica viene letta: solo conteggi e configurazione.
async function contestoAssistente(client, cfg, { oggi, domani, operatori = [], conv = {} } = {}) {
  const mese = monthRomeKey(oggi);
  let budget = null;
  try {
    budget = await budgetSnapshot(client, cfg, mese);
  } catch {
    budget = null;
  }
  const piano = domani
    ? await pianoDi(client, { data: domani, operatoreId: operatori[0] }).catch(() => null)
    : null;
  return cleanLog({
    oggi,
    domani,
    dati: {
      data_oggi: oggi,
      data_domani: domani,
      attivo: Boolean(cfg.attivo_globale),
      modalita_osservazione: Boolean(cfg.modalita_osservazione),
      operatrici_abilitate: operatori.length,
      budget_mese: budget ? {
        speso_eur: budget.speso,
        totale_eur: budget.budget,
        percentuale: budget.percentuale,
        telegram_speso_eur: budget.riserva_telegram.speso,
        telegram_limite_eur: budget.riserva_telegram.budget,
        telegram_messaggi: budget.telegram_messaggi
      } : null,
      piano_domani: piano?.contenuto ? {
        totale_appuntamenti: piano.contenuto.totale || 0,
        zone: (piano.contenuto.perZona || []).map((z) => ({ zona: z.zona, quanti: z.n })),
        categorie_approvate: piano.contenuto.categorie_approvate || [],
        direttiva: piano.contenuto.direttiva_mirko || null
      } : null,
      attesa_elenco_categorie: Boolean(conv.in_attesa_categorie),
      categorie_approvate: Array.isArray(conv.categorie_approvate) ? conv.categorie_approvate : []
    }
  });
}

// Interpreta il messaggio. Ritorna sempre un esito descrittivo: se l'IA non e'
// disponibile il chiamante risponde con l'elenco dei comandi, senza mai
// eseguire nulla.
async function interpreta({ supabase, cfg, testo, contesto }) {
  const result = await aiStructured({
    supabase,
    cfg,
    activity: 'telegram',
    name: 'kona_telegram_intento',
    instructions: istruzioniAssistente(contesto),
    input: cleanText(String(testo || ''), 1000),
    schema: schemaIntento(),
    maxOutputTokens: 500,
    webSearch: false,
    details: { canale: 'telegram' }
  });
  if (!result.ok) return { ok: false, error_code: result.error_code, error: result.error };

  const azione = AZIONI.includes(String(result.value?.azione || '')) ? String(result.value.azione) : 'altro';
  return {
    ok: true,
    azione,
    argomenti: normalizzaArgomenti(result.value, contesto?.dati || {}),
    risposta: cleanText(String(result.value?.risposta || ''), 800),
    confidenza: Number(result.value?.confidenza) || 0,
    cost_eur: result.costEur || 0
  };
}

// Testo della richiesta di conferma per un'azione delicata.
function riassuntoConferma(azione, argomenti = {}) {
  const giorno = argomenti.data || 'domani';
  switch (azione) {
    case 'sospendi':
      return 'Vuoi che SOSPENDA KONA Call Director? (globale off e task attivi in pausa)';
    case 'riattiva':
      return 'Vuoi che RIATTIVI KONA Call Director e riprenda i task sospesi?';
    case 'approva_piano':
      return `Vuoi che approvi il piano del ${giorno} per tutte le operatrici abilitate?`;
    case 'telefoni_omaggio':
      return `Vuoi che imposti il piano del ${giorno} su Telefoni omaggio (liste cartacee)?`;
    case 'direttiva': {
      const elenco = argomenti.categorie?.length ? `Categorie: ${argomenti.categorie.join(', ')}. ` : '';
      const nota = argomenti.nota ? `Nota: ${argomenti.nota}` : '';
      return `Vuoi che applichi questa direttiva al piano del ${giorno}? ${elenco}${nota}`.trim();
    }
    default:
      return `Vuoi che esegua: ${azione}?`;
  }
}

// Tastiera di conferma (pulsanti inline).
function tastieraConferma() {
  return {
    inline_keyboard: [[
      { text: 'Si, procedi', callback_data: 'conf:si' },
      { text: 'No, annulla', callback_data: 'conf:no' }
    ]]
  };
}

// Voce di audit/stato per l'azione in attesa.
function azioneInAttesa(azione, argomenti) {
  return {
    azione,
    argomenti,
    creato_at: nowIso(),
    riassunto: riassuntoConferma(azione, argomenti)
  };
}

module.exports = {
  ATTESA_CONFERMA_MINUTI,
  AZIONI,
  AZIONI_DELICATE,
  azioneInAttesa,
  confermaDeterministica,
  contestoAssistente,
  interpreta,
  istruzioniAssistente,
  normalizzaArgomenti,
  richiedeConferma,
  riassuntoConferma,
  schemaIntento,
  tastieraConferma,
  confermaValida,
  _test: { confermaDeterministica, confermaValida, normalizzaArgomenti, richiedeConferma, riassuntoConferma }
};
