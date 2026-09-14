'use strict';

const { parseHHmm } = require('./kona-cd-time');

// Costruttore di agenda della giornata (solo logica pura, nessun accesso al
// database): serve a far PROPORRE al bot le attivita' di chiamata e a costruire
// l'agenda un pezzo alla volta, finche' le ore previste non sono coperte.
//
// Le fasce costruite qui sono VINCOLANTI per il motore: dentro una fascia il
// sistema propone solo l'attivita' prevista (o niente, se e' una fascia
// manuale). Le priorita' 1-6 restano comunque sempre davanti a tutto.
//
// Unita' di misura: MINUTI dalla mezzanotte. Le finestre lavorative arrivano
// dalla configurazione (`orario_mattina`, `orario_pomeriggio`): nessun orario e'
// scritto qui dentro, e la programmazione base sta in `programmazione_base`.

// Le tre attivita' che il bot puo' proporre. `id` e' anche il valore salvato nel
// piano (`consumer`/`categoria_sessione`) per le due modalita' Consumer.
const OPZIONI = [
  {
    id: 'aziendali',
    etichetta: 'Lead Outbound Aziendali',
    breve: 'aziendali',
    consumer: null
  },
  {
    id: 'fibra_fwa',
    etichetta: 'Fisso (liste cartacee)',
    breve: 'fisso',
    consumer: 'fibra_fwa'
  },
  {
    id: 'telefoni_omaggio',
    etichetta: 'Telefoni Omaggio (liste cartacee)',
    breve: 'telefoni omaggio',
    consumer: 'telefoni_omaggio'
  }
];

function opzionePerId(id) {
  return OPZIONI.find((o) => o.id === String(id || '')) || null;
}

function fmtHHmm(minuti) {
  const n = Number(minuti);
  if (!Number.isFinite(n) || n < 0) return '';
  const ore = Math.floor(n / 60);
  const min = n % 60;
  return `${String(ore).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function fmtDurata(minuti) {
  const n = Math.max(0, Math.round(Number(minuti) || 0));
  if (n < 60) return `${n} minuti`;
  const ore = Math.floor(n / 60);
  const min = n % 60;
  if (min === 0) return ore === 1 ? '1 ora' : `${ore} ore`;
  return `${ore === 1 ? '1 ora' : `${ore} ore`} e ${min} minuti`;
}

// Finestre lavorative in minuti, nell'ordine in cui compaiono in configurazione.
function finestreGiorno(cfg) {
  const out = [];
  for (const fascia of [cfg?.orario_mattina, cfg?.orario_pomeriggio]) {
    if (!fascia) continue;
    const da = parseHHmm(fascia.inizio);
    const a = parseHHmm(fascia.fine);
    if (da !== null && a !== null && a > da) out.push({ da, a });
  }
  return out;
}

function minutiTotali(finestre) {
  return (finestre || []).reduce((somma, f) => somma + (f.a - f.da), 0);
}

// Spazi ancora liberi: le finestre meno i blocchi gia' pianificati.
function buchiResidui(finestre, blocchi = []) {
  let liberi = (finestre || []).map((f) => ({ da: f.da, a: f.a }));
  for (const b of blocchi) {
    const da = Number(b.da);
    const a = Number(b.a);
    const prossimi = [];
    for (const spazio of liberi) {
      if (a <= spazio.da || da >= spazio.a) { prossimi.push(spazio); continue; }
      if (da > spazio.da) prossimi.push({ da: spazio.da, a: da });
      if (a < spazio.a) prossimi.push({ da: a, a: spazio.a });
    }
    liberi = prossimi;
  }
  return liberi.sort((x, y) => x.da - y.da);
}

function minutiResidui(finestre, blocchi = []) {
  return minutiTotali(buchiResidui(finestre, blocchi));
}

function minutiPianificati(blocchi = []) {
  return (blocchi || []).reduce((somma, b) => somma + Math.max(0, Number(b.a) - Number(b.da)), 0);
}

// Accetta "15:30-17:00", "dalle 15:30 alle 17:00", "15.30 17.00", "90 minuti",
// "1 ora e mezza". Ritorna { ok:true, da, a } oppure { ok:true, durata }
// oppure { ok:false }.
function parseIntervallo(testo) {
  const grezzo = String(testo || '').toLowerCase().trim();
  if (!grezzo) return { ok: false };
  const normalizzato = grezzo
    .replace(/[–—]/g, '-')
    .replace(/\balle\b/g, '-')
    .replace(/\bdalle\b/g, ' ')
    .replace(/\b(dalle|dalla)\b/g, ' ')
    .replace(/(\d{1,2})[.](\d{2})/g, '$1:$2')
    .replace(/\s+/g, ' ')
    .trim();

  const intervallo = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(normalizzato);
  if (intervallo) {
    const da = Number(intervallo[1]) * 60 + Number(intervallo[2]);
    const a = Number(intervallo[3]) * 60 + Number(intervallo[4]);
    if (a <= da) return { ok: false };
    return { ok: true, da, a };
  }

  // Le durate a parole vanno lette PRIMA dei numeri: "1 ora e mezza" contiene
  // "1 ora" e senza questo controllo diventerebbe 60 minuti invece di 90.
  if (/mezz'?\s?ora|mezza ora/.test(normalizzato)) return { ok: true, durata: 30 };
  if (/ora e mezza/.test(normalizzato)) return { ok: true, durata: 90 };

  const minuti = /(\d{1,3})\s*(?:min|minuti)/.exec(normalizzato);
  if (minuti) return { ok: true, durata: Number(minuti[1]) };

  const ore = /(\d{1,2})\s*(?:ora|ore)/.exec(normalizzato);
  if (ore) return { ok: true, durata: Number(ore[1]) * 60 };

  const soloOra = /(\d{1,2}):(\d{2})/.exec(normalizzato);
  if (soloOra) {
    // Un solo orario: si intende "da qui in avanti fino a fine spazio".
    return { ok: true, da: Number(soloOra[1]) * 60 + Number(soloOra[2]) };
  }
  return { ok: false };
}

// Trasforma cio' che ha detto Mirko in un blocco valido dentro le finestre e
// senza sovrapposizioni. Non inventa mai un orario fuori dagli spazi liberi.
function componiBlocco({ da, a, durata }, finestre, blocchi = []) {
  const buchi = buchiResidui(finestre, blocchi);
  if (buchi.length === 0) return { ok: false, errore: 'non_resta_tempo' };

  if (Number.isFinite(da) && Number.isFinite(a)) {
    const spazio = buchi.find((b) => da >= b.da && a <= b.a);
    if (!spazio) {
      return {
        ok: false,
        errore: 'fuori_finestra',
        liberi: buchi
      };
    }
    return { ok: true, blocco: { da, a } };
  }

  if (Number.isFinite(durata) && durata > 0) {
    const spazio = buchi.find((b) => (b.a - b.da) >= durata);
    if (!spazio) return { ok: false, errore: 'durata_troppo_lunga', liberi: buchi };
    return { ok: true, blocco: { da: spazio.da, a: spazio.da + durata } };
  }

  // Solo l'inizio: si prende tutto lo spazio libero che comincia li'.
  if (Number.isFinite(da)) {
    const spazio = buchi.find((b) => da >= b.da && da < b.a);
    if (!spazio) return { ok: false, errore: 'fuori_finestra', liberi: buchi };
    return { ok: true, blocco: { da, a: spazio.a } };
  }

  return { ok: false, errore: 'orario_non_compreso' };
}

// Le opzioni compatibili con l'agenda in costruzione: le due liste Consumer
// sono una modalita' al giorno, quindi una esclude l'altra.
function opzioniDisponibili(agenda = {}) {
  const consumerGiaScelto = (agenda.blocchi || [])
    .map((b) => opzionePerId(b.opzione))
    .find((o) => o && o.consumer);
  return OPZIONI.filter((o) => !o.consumer || !consumerGiaScelto || o.consumer === consumerGiaScelto.consumer);
}

// Riconosce l'opzione dal testo libero (i pulsanti usano l'id diretto).
function opzioneDaTesto(testo) {
  const t = String(testo || '').toLowerCase();
  if (/telefon\w*|omaggio/.test(t) && !/aziend/.test(t)) return opzionePerId('telefoni_omaggio');
  if (/fibra|fwa/.test(t)) return opzionePerId('fibra_fwa');
  if (/aziend|business|outbound|lead|uffici|negozi|ristoraz/.test(t)) return opzionePerId('aziendali');
  return null;
}

function righeBlocchi(agenda = {}) {
  return (agenda.blocchi || []).map((b) => {
    const opzione = opzionePerId(b.opzione);
    return `${fmtHHmm(b.da)}-${fmtHHmm(b.a)} ${opzione ? opzione.etichetta : b.opzione}`;
  });
}

// -- Programmazione della giornata --------------------------------------------
// Le fasce arrivano dal piano (scelte da Mirko col bot) o dalla programmazione
// base di configurazione. In entrambi i casi vengono normalizzate in minuti,
// cosi' il motore puo' confrontarle con l'ora corrente.

function normalizzaBlocchi(blocchi) {
  if (!Array.isArray(blocchi)) return [];
  const out = [];
  for (const b of blocchi) {
    const da = typeof b?.da === 'number' ? b.da : parseHHmm(b?.da);
    const a = typeof b?.a === 'number' ? b.a : parseHHmm(b?.a);
    const opzione = opzionePerId(b?.opzione);
    if (da === null || a === null || a <= da || !opzione) continue;
    out.push({ opzione: opzione.id, da, a });
  }
  return out.sort((x, y) => x.da - y.da);
}

// Le fasce del piano del giorno, se ce ne sono di valide; altrimenti la base.
function blocchiGiorno(contenuto, cfg) {
  const dalPiano = normalizzaBlocchi(contenuto?.agenda_blocchi);
  if (dalPiano.length > 0) return { blocchi: dalPiano, origine: 'piano' };
  const base = normalizzaBlocchi(cfg?.programmazione_base);
  return { blocchi: base, origine: base.length > 0 ? 'base' : 'nessuna' };
}

// Forma salvabile nel piano: minuti -> "HH:MM", cosi' il contenuto del piano
// resta leggibile a occhio nel DB.
function serializzaBlocchi(blocchi) {
  return normalizzaBlocchi(blocchi).map((b) => ({
    opzione: b.opzione,
    da: fmtHHmm(b.da),
    a: fmtHHmm(b.a)
  }));
}

// Attivita' in corso a una certa ora (minuti dalla mezzanotte), o null.
function attivitaCorrente(blocchi, oraMin) {
  const ora = Number(oraMin);
  if (!Number.isFinite(ora)) return null;
  return normalizzaBlocchi(blocchi).find((b) => ora >= b.da && ora < b.a) || null;
}

// Una fascia manuale non propone contatti: l'operatrice lavora le liste
// cartacee e registra ogni chiamata.
function bloccoManuale(blocco) {
  const opzione = opzionePerId(blocco?.opzione);
  return Boolean(opzione && opzione.consumer);
}

function riepilogoAgenda(agenda = {}, cfg) {
  const finestre = finestreGiorno(cfg);
  const righe = righeBlocchi(agenda);
  const residuo = minutiResidui(finestre, agenda.blocchi);
  return [
    `Agenda ${agenda.data || ''}`.trim(),
    ...(righe.length ? righe : ['(nessuna attivita)']),
    residuo > 0 ? `Tempo non coperto: ${fmtDurata(residuo)}` : 'Tutte le ore previste sono coperte.'
  ].join('\n');
}

// Fotografia del piano di una giornata in righe leggibili: e' quello che KONA
// fara' DAVVERO (fasce della giornata, categorie aziendali, liste Consumer).
// Serve a chi chiede "mostrami il piano": gli appuntamenti Business da soli non
// dicono niente di quello che succede in giornata.
function descriviPiano(contenuto, cfg) {
  const dalPiano = normalizzaBlocchi(contenuto?.agenda_blocchi);
  const { blocchi, origine } = blocchiGiorno(contenuto, cfg);
  const grezze = Array.isArray(contenuto?.categorie_approvate)
    ? contenuto.categorie_approvate
    : (Array.isArray(contenuto?.categorie) ? contenuto.categorie : []);
  const categorie = grezze.map((c) => String(c).trim()).filter(Boolean);
  const consumerGrezzo = String(contenuto?.consumer || contenuto?.categoria_sessione || '');
  const opzioneConsumer = OPZIONI.find((o) => o.consumer && o.consumer === consumerGrezzo);
  const righe = righeBlocchi({ blocchi }).map((r) => r);
  return {
    origine,
    dalPiano: dalPiano.length > 0,
    fasce: blocchi.length,
    righe,
    categorie,
    consumer: opzioneConsumer ? opzioneConsumer.consumer : null,
    consumerEtichetta: opzioneConsumer ? opzioneConsumer.etichetta : null
  };
}

// Testo con cui il bot ripropone le opzioni per il tempo che resta.
function domandaOpzioni(agenda = {}, cfg) {
  const finestre = finestreGiorno(cfg);
  const buchi = buchiResidui(finestre, agenda.blocchi);
  const residuo = minutiResidui(finestre, agenda.blocchi);
  const righe = righeBlocchi(agenda);
  const disponibili = opzioniDisponibili(agenda);
  return [
    ...(righe.length ? ['Agenda finora:', ...righe, ''] : []),
    `Ti restano ${fmtDurata(residuo)} di lavoro${buchi.length ? ` (${buchi.map((b) => `${fmtHHmm(b.da)}-${fmtHHmm(b.a)}`).join(', ')})` : ''}.`,
    'Cosa metto nel tempo che resta? Scegli una delle opzioni:',
    ...disponibili.map((o) => `- ${o.etichetta}`),
    '',
    'Oppure scrivi "basta cosi\'" per chiudere l\'agenda.'
  ].join('\n');
}

// Tastiera con le opzioni disponibili.
function tastieraOpzioni(agenda = {}) {
  const righe = opzioniDisponibili(agenda).map((o) => ([{ text: o.breve, callback_data: `ag:${o.id}` }]));
  righe.push([{ text: 'Basta cosi', callback_data: 'ag:stop' }]);
  return { inline_keyboard: righe };
}

function tastieraConfermaAgenda() {
  return {
    inline_keyboard: [[
      { text: 'Si, applica', callback_data: 'ag:conferma' },
      { text: 'No, annulla', callback_data: 'ag:annulla' }
    ]]
  };
}

module.exports = {
  OPZIONI,
  attivitaCorrente,
  bloccoManuale,
  blocchiGiorno,
  buchiResidui,
  componiBlocco,
  descriviPiano,
  domandaOpzioni,
  finestreGiorno,
  fmtDurata,
  fmtHHmm,
  minutiPianificati,
  minutiResidui,
  minutiTotali,
  normalizzaBlocchi,
  opzioneDaTesto,
  opzionePerId,
  opzioniDisponibili,
  parseIntervallo,
  riepilogoAgenda,
  righeBlocchi,
  serializzaBlocchi,
  tastieraConfermaAgenda,
  tastieraOpzioni,
  _test: {
    attivitaCorrente, bloccoManuale, blocchiGiorno, buchiResidui, componiBlocco, descriviPiano, domandaOpzioni,
    finestreGiorno, fmtDurata, fmtHHmm, minutiPianificati, minutiResidui, minutiTotali,
    normalizzaBlocchi, opzioneDaTesto, opzionePerId, opzioniDisponibili, parseIntervallo,
    riepilogoAgenda, righeBlocchi, serializzaBlocchi
  }
};
