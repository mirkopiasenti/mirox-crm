'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TEMPLATE_VERSION = 'windtre-2024-06';
const TEMPLATE_DIRECTORY = path.join(__dirname, '..', '_templates', 'disdette');

const VARIANTS = Object.freeze({
  sim_consumer: {
    label: 'SIM Consumer',
    business: false,
    fixed: false,
    template: 'recesso-sim-consumer.pdf',
    top: {
      name: 147.2,
      fiscalCode: 169.2,
      document: 182.2,
      holderPhone: 196.2,
      address: 210.2,
      province: 224.2,
      alternatePhone: 238.2,
      line: 294.4,
      date: 613.7
    },
    checks: {
      reason: { ordinario: 322.0, modifiche_contrattuali: 336.0, entro_14_giorni: 350.5 },
      payment: { rateizzato: 557.4, unica_soluzione: 571.4 }
    }
  },
  sim_business: {
    label: 'SIM Business',
    business: true,
    fixed: false,
    template: 'recesso-sim-business.pdf',
    top: {
      company: 147.2,
      delegate: 159.0,
      name: 170.8,
      fiscalCode: 195.5,
      document: 207.4,
      holderPhone: 219.2,
      address: 231.0,
      province: 242.9,
      alternatePhone: 254.7,
      line: 310.0,
      date: 585.1
    },
    checks: {
      reason: { ordinario: 337.5, modifiche_contrattuali: 351.5 },
      payment: { rateizzato: 525.4, unica_soluzione: 539.4 }
    }
  },
  fisso_consumer: {
    label: 'Fisso Consumer',
    business: false,
    fixed: true,
    template: 'recesso-fisso-consumer.pdf',
    top: {
      name: 147.2,
      fiscalCode: 171.8,
      document: 183.7,
      holderPhone: 195.5,
      address: 207.4,
      province: 219.2,
      alternatePhone: 231.0,
      line: 254.9,
      date: 729.7
    },
    checks: {
      reason: { ordinario: 265.4, modifiche_contrattuali: 277.3, entro_14_giorni: 289.6 },
      termination: { cessazione_definitiva: 312.7, portabilita: 324.6 },
      payment: { rateizzato: 703.0, unica_soluzione: 712.0 }
    }
  },
  fisso_business: {
    label: 'Fisso Business',
    business: true,
    fixed: true,
    template: 'recesso-fisso-business.pdf',
    top: {
      company: 147.2,
      delegate: 159.0,
      name: 170.8,
      fiscalCode: 195.5,
      document: 207.4,
      holderPhone: 219.2,
      address: 231.0,
      province: 242.9,
      alternatePhone: 254.7,
      line: 278.6,
      date: 723.5
    },
    checks: {
      reason: { ordinario: 291.9, modifiche_contrattuali: 303.8 },
      termination: { cessazione_definitiva: 330.2, portabilita: 342.1 },
      payment: { rateizzato: 678.8, unica_soluzione: 687.8 }
    }
  }
});

const REASONS = new Set(['ordinario', 'modifiche_contrattuali', 'entro_14_giorni']);
const PAYMENTS = new Set(['rateizzato', 'unica_soluzione']);
const TERMINATIONS = new Set(['cessazione_definitiva', 'portabilita']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FISCAL_CODE_RE = /^[A-Z0-9]{16}$/;
const VAT_RE = /^\d{11}$/;
const PHONE_RE = /^[0-9+(). /-]{5,30}$/;

function cleanText(value, maxLength, label, { required = true, uppercase = false } = {}) {
  let text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (uppercase) text = text.toUpperCase();
  if (required && !text) throw new Error(`${label} obbligatorio`);
  if (text.length > maxLength) throw new Error(`${label} troppo lungo`);
  return text;
}

function validDate(value) {
  const date = String(value ?? '').trim();
  if (!date) return '';
  if (!DATE_RE.test(date)) throw new Error('Data non valida');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('Data non valida');
  }
  return date;
}

function requiredEnum(value, allowed, label) {
  const normalized = String(value ?? '').trim();
  if (!allowed.has(normalized)) throw new Error(`${label} non valido`);
  return normalized;
}

function validPhone(value, label) {
  const phone = cleanText(value, 30, label);
  if (!PHONE_RE.test(phone)) throw new Error(`${label} non valido`);
  const compact = phone.replace(/[ ().\/-]/g, '');
  if (!/^\+?\d{5,15}$/.test(compact)) throw new Error(`${label} non valido`);
  return phone;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Dati della disdetta non validi');
  }

  const type = String(payload.tipo ?? '').trim();
  const variant = VARIANTS[type];
  if (!variant) throw new Error('Tipo di modulo non valido');

  const result = {
    tipo: type,
    nome: cleanText(payload.nome, 60, variant.business ? 'Nome del rappresentante legale' : 'Nome'),
    cognome: cleanText(payload.cognome, 60, variant.business ? 'Cognome del rappresentante legale' : 'Cognome'),
    codice_fiscale: cleanText(payload.codice_fiscale, 16, 'Codice fiscale', { uppercase: true }),
    documento_tipo: cleanText(payload.documento_tipo, 40, 'Tipo documento'),
    documento_numero: cleanText(payload.documento_numero, 40, 'Numero documento', { uppercase: true }),
    numero_titolare: validPhone(payload.numero_titolare, variant.business ? 'Numero del rappresentante legale' : 'Numero del titolare'),
    via: cleanText(payload.via, 80, 'Via di residenza'),
    civico: cleanText(payload.civico, 15, 'Numero civico'),
    citta: cleanText(payload.citta, 60, 'Città'),
    provincia: cleanText(payload.provincia, 2, 'Provincia', { uppercase: true }),
    cap: cleanText(payload.cap, 5, 'CAP'),
    recapito_alternativo: validPhone(payload.recapito_alternativo, variant.business ? 'Recapito del referente delegato' : 'Recapito alternativo'),
    utenza: validPhone(payload.utenza, 'Utenza'),
    motivo_recesso: requiredEnum(payload.motivo_recesso, REASONS, 'Motivo del recesso'),
    pagamento_rate: requiredEnum(payload.pagamento_rate, PAYMENTS, 'Modalità di pagamento'),
    data: validDate(payload.data)
  };

  if (!FISCAL_CODE_RE.test(result.codice_fiscale)) {
    throw new Error('Il codice fiscale deve contenere 16 caratteri alfanumerici');
  }
  if (!/^[A-Z]{2}$/.test(result.provincia)) throw new Error('La provincia deve contenere 2 lettere');
  if (!/^\d{5}$/.test(result.cap)) throw new Error('Il CAP deve contenere 5 cifre');
  if (!variant.business && result.motivo_recesso === 'entro_14_giorni') {
    // Consentito per entrambi i moduli Consumer.
  } else if (variant.business && result.motivo_recesso === 'entro_14_giorni') {
    throw new Error('Il recesso entro 14 giorni non è previsto per i moduli Business');
  }

  if (variant.business) {
    result.ragione_sociale = cleanText(payload.ragione_sociale, 100, 'Ragione sociale');
    result.partita_iva = cleanText(payload.partita_iva, 11, 'Partita IVA');
    result.referente_nome = cleanText(payload.referente_nome, 60, 'Nome del referente legale o delegato');
    result.referente_cognome = cleanText(payload.referente_cognome, 60, 'Cognome del referente legale o delegato');
    if (!VAT_RE.test(result.partita_iva)) throw new Error('La partita IVA deve contenere 11 cifre');
  } else {
    result.ragione_sociale = '';
    result.partita_iva = '';
    result.referente_nome = '';
    result.referente_cognome = '';
  }

  result.modalita_cessazione = variant.fixed
    ? requiredEnum(payload.modalita_cessazione, TERMINATIONS, 'Modalità di cessazione')
    : '';

  return result;
}

function formattedDate(value) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

function drawFitText(page, font, text, options) {
  const value = String(text || '');
  if (!value) return;
  let size = options.size || 8.4;
  const minSize = options.minSize || 6.2;
  while (size > minSize && font.widthOfTextAtSize(value, size) > options.maxWidth) size -= 0.25;
  page.drawText(value, {
    x: options.x,
    y: page.getHeight() - options.top - size,
    size,
    font,
    color: rgb(0.05, 0.05, 0.05)
  });
}

function drawFiscalCode(page, font, value, top) {
  const start = 94.84;
  const step = 12.62;
  const size = 7.2;
  [...value].forEach((character, index) => {
    const center = start + (step * index) + (step / 2);
    const width = font.widthOfTextAtSize(character, size);
    page.drawText(character, {
      x: center - (width / 2),
      y: page.getHeight() - top - size,
      size,
      font,
      color: rgb(0.02, 0.02, 0.02)
    });
  });
}

function drawCheck(page, font, top) {
  page.drawText('X', {
    x: 153.8,
    y: page.getHeight() - top - 8,
    size: 8,
    font,
    color: rgb(0.02, 0.02, 0.02)
  });
}

async function generateDisdettaPdf(rawPayload) {
  const data = validatePayload(rawPayload);
  const variant = VARIANTS[data.tipo];
  const templatePath = path.join(TEMPLATE_DIRECTORY, variant.template);
  const templateBytes = fs.readFileSync(templatePath);
  const document = await PDFDocument.load(templateBytes);
  const page = document.getPages()[0];
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const top = variant.top;

  if (variant.business) {
    drawFitText(page, font, data.ragione_sociale, { x: 101, top: top.company, maxWidth: 296, size: 8.2 });
    drawFitText(page, font, data.partita_iva, { x: 443, top: top.company, maxWidth: 108, size: 8.2 });
    drawFitText(page, font, `${data.referente_nome} ${data.referente_cognome}`, { x: 140, top: top.delegate, maxWidth: 411, size: 8.2 });
    drawFitText(page, font, `${data.nome} ${data.cognome}`, { x: 145, top: top.name, maxWidth: 406, size: 8.2 });
  } else {
    drawFitText(page, font, `${data.nome} ${data.cognome}`, { x: 112, top: top.name, maxWidth: 439, size: 8.2 });
  }

  drawFiscalCode(page, bold, data.codice_fiscale, top.fiscalCode);
  drawFitText(page, font, data.documento_tipo, { x: 149, top: top.document, maxWidth: 140, size: 8 });
  drawFitText(page, font, data.documento_numero, { x: 329, top: top.document, maxWidth: 222, size: 8 });
  drawFitText(page, font, data.numero_titolare, { x: variant.business ? 171 : 190, top: top.holderPhone, maxWidth: variant.business ? 380 : 361, size: 8 });
  drawFitText(page, font, data.via, { x: 140, top: top.address, maxWidth: 145, size: 8 });
  drawFitText(page, font, data.civico, { x: 322, top: top.address, maxWidth: 41, size: 8 });
  drawFitText(page, font, data.citta, { x: 389, top: top.address, maxWidth: 162, size: 8 });
  drawFitText(page, font, data.provincia, { x: 80, top: top.province, maxWidth: 205, size: 8 });
  drawFitText(page, font, data.cap, { x: 310, top: top.province, maxWidth: 241, size: 8 });
  drawFitText(page, font, data.recapito_alternativo, { x: variant.business ? 285 : 242, top: top.alternatePhone, maxWidth: variant.business ? 266 : 309, size: 8 });
  drawFitText(page, bold, data.utenza, { x: variant.fixed ? 130 : 205, top: top.line, maxWidth: variant.fixed ? 421 : 304, size: 8.2 });

  drawCheck(page, bold, variant.checks.reason[data.motivo_recesso]);
  if (variant.fixed) drawCheck(page, bold, variant.checks.termination[data.modalita_cessazione]);
  drawCheck(page, bold, variant.checks.payment[data.pagamento_rate]);
  drawFitText(page, font, formattedDate(data.data), { x: 63, top: top.date, maxWidth: variant.business ? 116 : 222, size: 8.2 });

  document.setTitle(`Disdetta ${variant.label}`);
  document.setSubject('Richiesta di recesso WINDTRE compilata tramite Mirox CRM');
  document.setCreator('Mirox CRM');
  document.setProducer('Mirox CRM - pdf-lib');
  document.setModificationDate(new Date());

  const bytes = await document.save({ useObjectStreams: false });
  return {
    buffer: Buffer.from(bytes),
    data,
    variant,
    templateVersion: TEMPLATE_VERSION
  };
}

module.exports = {
  generateDisdettaPdf,
  validatePayload,
  VARIANTS,
  TEMPLATE_VERSION,
  _test: { formattedDate, drawFitText }
};
