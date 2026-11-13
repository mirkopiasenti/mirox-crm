/* Domande e validazione condivise dal Compilatore Malpractis. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MalpractisCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const dealer = Object.freeze({ ragione_sociale: 'KONA TECH', codice: '9001415852' });
  const reasons = [
    ['mai_contattato', 'nuova', 'Il cliente non è mai stato contattato per l’appuntamento?', 52.5, 314.2],
    ['tecnico_assente', 'nuova', 'Il tecnico non si è presentato all’appuntamento?', 52.5, 338.3],
    ['problemi_tecnici', 'nuova', 'Il tecnico ha comunicato problemi tecnici che impediscono l’attivazione?', 52.5, 358.3],
    ['lavori_impianto', 'nuova', 'Il tecnico ha comunicato la necessità di lavori per realizzare l’impianto?', 52.5, 382.4],
    ['promozione_concorrenti', 'nuova', 'Il tecnico ha promosso concorrenti o denigrato WINDTRE durante l’attivazione?', 50.5, 406.5],
    ['proposta_dopo_ko', 'nuova', 'Il cliente ha ricevuto una proposta commerciale dopo un KO?', 50.5, 446.6],
    ['altro', 'nuova', 'Si tratta di un altro problema da specificare nella descrizione?', 50.5, 470.7],
    ['informazioni_false', 'attiva', 'Un altro operatore ha fornito informazioni false o denigratorie sul servizio WINDTRE?', 305.5, 310.2],
    ['falso_windtre', 'attiva', 'Un altro operatore si è presentato come WINDTRE comunicando un aumento di prezzo?', 305.5, 334.3],
    ['chiamate_indesiderate', 'attiva', 'Il cliente ha ricevuto ripetute chiamate indesiderate da un altro operatore?', 305.5, 358.3],
    ['contatto_dopo_guasto', 'attiva', 'Un altro operatore ha chiamato ripetutamente dopo la segnalazione di un guasto?', 305.5, 382.4],
    ['offerta_non_richiesta', 'attiva', 'Un altro operatore ha comunicato l’attivazione di un’offerta mai richiesta?', 305.5, 410.5],
    ['anomalie_rete', 'attiva', 'Un altro operatore ha segnalato anomalie WINDTRE e offerto promozioni per far cambiare operatore?', 305.5, 438.6]
  ].map(([key, group, label, x, top]) => Object.freeze({ key, group, label, x, top }));
  const fields = [
    ['intestatario', 'Qual è il cognome e nome o la ragione sociale del cliente?', 100],
    ['cf_piva', 'Qual è il codice fiscale o la partita IVA del cliente?', 16],
    ['codice_contratto', 'Qual è il codice contratto?', 40],
    ['codice_cliente', 'Qual è il codice cliente?', 40],
    ['documento_numero', 'Qual è il numero del documento di identità?', 40],
    ['numero_fisso', 'Qual è la numerazione fissa interessata?', 30],
    ['cellulare', 'Qual è il recapito cellulare del cliente?', 30],
    ['email', 'Qual è l’indirizzo e-mail del cliente?', 100]
  ].map(([key, label, max]) => Object.freeze({ key, label, max }));
  function text(value, max, label, required = true) {
    const result = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (required && !result) throw new Error(`${label}: dato obbligatorio`);
    if (result.length > max) throw new Error(`${label}: testo troppo lungo`);
    if (/[^\x20-\x7e\u00a0-\u00ff€’‘“”–—]/u.test(result)) throw new Error(`${label}: caratteri non supportati nel modulo PDF`);
    return result;
  }
  function choice(value, allowed, label) {
    if (!allowed.includes(value)) throw new Error(`${label}: scelta obbligatoria o non valida`);
    return value;
  }
  function date(value, label, time = false) {
    const raw = String(value || '');
    const pattern = time ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
    if (!pattern.test(raw)) throw new Error(`${label}: data non valida`);
    const parsed = new Date(raw + (time ? ':00Z' : 'T00:00:00Z'));
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, time ? 16 : 10) !== raw) throw new Error(`${label}: data non valida`);
    return raw;
  }
  function validate(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Dati del modulo non validi');
    const data = {};
    for (const f of fields) data[f.key] = text(payload[f.key], f.max, f.label);
    data.cf_piva = data.cf_piva.toUpperCase();
    if (!/^(?:[A-Z0-9]{16}|\d{11})$/.test(data.cf_piva)) throw new Error('Codice fiscale o partita IVA non validi');
    for (const key of ['numero_fisso', 'cellulare']) {
      if (!/^\+?\d{5,15}$/.test(data[key].replace(/[ ().\/-]/g, ''))) throw new Error('Numero di telefono non valido');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error('Indirizzo e-mail non valido');
    data.tipo_segnalazione = choice(payload.tipo_segnalazione, ['sollecito', 'problematica'], 'Tipo di segnalazione');
    data.stato_linea = choice(payload.stato_linea, ['nuova', 'attiva'], 'Stato della linea');
    data.documento_tipo = choice(payload.documento_tipo, ['ci', 'patente', 'passaporto', 'altro'], 'Tipo documento');
    data.motivi = {};
    if (reasons.some(r => r.group !== data.stato_linea && payload.motivi?.[r.key] === 'si')) throw new Error('Motivo non valido per lo stato della linea');
    for (const r of reasons) data.motivi[r.key] = r.group === data.stato_linea
      ? choice(payload.motivi?.[r.key], ['si', 'no'], r.label) : 'no';
    if (Object.values(data.motivi).filter(value => value === 'si').length !== 1) throw new Error('Scegli un solo motivo della segnalazione');
    data.open_fiber = data.stato_linea === 'nuova' ? choice(payload.open_fiber, ['si', 'no'], 'Operatore Open Fiber') : 'no';
    data.tim_prima = data.stato_linea === 'attiva' ? choice(payload.tim_prima, ['si', 'no'], 'Operatore TIM/Telecom Italia, prima casella') : 'no';
    data.tim_seconda = data.stato_linea === 'attiva' ? choice(payload.tim_seconda, ['si', 'no'], 'Operatore TIM/Telecom Italia, seconda casella') : 'no';
    data.conoscenza_cliente = choice(payload.conoscenza_cliente, ['si', 'no', 'non_so'], 'Conoscenza del cliente WINDTRE');
    const description = String(payload.descrizione || '').replace(/\r\n?/g, '\n').trim();
    data.descrizione = description.split('\n').map(line => text(line, 1200, 'Descrizione', false)).join('\n');
    if (!data.descrizione || data.descrizione.length > 1200) throw new Error('Descrizione obbligatoria, massimo 1200 caratteri');
    data.primo_appuntamento = payload.primo_appuntamento ? date(payload.primo_appuntamento, 'Primo appuntamento', true) : '';
    data.nuovo_appuntamento = payload.nuovo_appuntamento ? date(payload.nuovo_appuntamento, 'Nuovo appuntamento', true) : '';
    data.data = date(payload.data, 'Data del modulo');
    return data;
  }
  function prefill(row) {
    return { intestatario: row.ragione_sociale || row.nome_referente || '', cf_piva: row.cf_piva || '', cellulare: row.cellulare || '', email: row.email || '' };
  }
  return { dealer, reasons: Object.freeze(reasons), fields: Object.freeze(fields), validate, prefill };
});
