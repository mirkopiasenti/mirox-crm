/* Calendario e conteggi Personale condivisi da Admin, consultazione e PDF. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiroxPlanning = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const TYPES = ['ferie', 'permessi', 'malattia'];
  const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error(message); };
  function month(value) {
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(value || '') || value < '2026-11') fail('Mese non valido: si parte da novembre 2026');
    return value;
  }
  function dates(value) {
    month(value);
    const [year, m] = value.split('-').map(Number);
    return Array.from({ length: new Date(Date.UTC(year, m, 0)).getUTCDate() }, (_, i) => `${value}-${String(i + 1).padStart(2, '0')}`);
  }
  function weekday(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }
  function minutes(time) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time || '')) fail('Orario non valido');
    const [h, m] = time.split(':').map(Number); return h * 60 + m;
  }
  const hours = value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  function integer(value, max = 1440) {
    if (!Number.isInteger(value) || value < 0 || value > max) fail('Minuti non validi'); return value;
  }
  function slots(value) {
    if (!Array.isArray(value) || value.length > 4) fail('Inserire al massimo quattro fasce');
    const result = value.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || minutes(pair[0]) >= minutes(pair[1])) fail('Fascia oraria non valida');
      return [pair[0], pair[1]];
    }).sort((a, b) => minutes(a[0]) - minutes(b[0]));
    result.forEach((pair, i) => { if (i && minutes(pair[0]) < minutes(result[i - 1][1])) fail('Le fasce si sovrappongono'); });
    return result;
  }
  function parseSlots(text) {
    if (!String(text).trim()) return [];
    return slots(String(text).split(/[;,\n]+/).map(s => s.trim().split(/\s*-\s*/)));
  }
  const formatSlots = value => value.map(pair => pair.join('-')).join(' / ');
  const slotMinutes = value => value.reduce((sum, pair) => sum + minutes(pair[1]) - minutes(pair[0]), 0);
  function defaultConfig() {
    const schedule = (morning, afternoon, saturday) => [[], ...Array.from({length: 5}, () => [morning, afternoon]), saturday];
    return { employees: [
      { id: 'matteo', name: 'Matteo', profileId: null, contractMinutes: 2400, from: '2026-11', until: null,
        week: schedule(['09:30','12:30'], ['15:30','19:30'], [['09:30','12:30'],['15:30','19:00']]) },
      { id: 'vincenzo', name: 'Vincenzo', profileId: null, contractMinutes: 2400, from: '2026-11', until: null,
        week: schedule(['09:00','12:00'], ['15:30','19:30'], [['09:00','12:30'],['15:30','19:00']]) },
      { id: 'isabella', name: 'Isabella', profileId: null, contractMinutes: 1800, from: '2026-11', until: null,
        week: schedule(['09:00','12:30'], ['15:30','19:00'], []) }
    ] };
  }
  function validateConfig(input) {
    if (!input || !Array.isArray(input.employees) || !input.employees.length || input.employees.length > 20) fail('Elenco dipendenti non valido');
    const ids = new Set(), profiles = new Set();
    return { employees: input.employees.map(e => {
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(e.id || '') || ids.has(e.id)) fail('Identificativo dipendente non valido o duplicato');
      ids.add(e.id);
      if (typeof e.name !== 'string' || !e.name.trim() || e.name.length > 80) fail('Nome dipendente non valido');
      if (e.profileId !== null && (!UUID.test(e.profileId || '') || profiles.has(e.profileId))) fail('Account non valido o già associato');
      if (e.profileId) profiles.add(e.profileId);
      month(e.from); if (e.until !== null && (month(e.until) < e.from)) fail('Fine rapporto precedente all’inizio');
      if (!Array.isArray(e.week) || e.week.length !== 7) fail('Settimana non valida');
      return { id: e.id, name: e.name.trim(), profileId: e.profileId, contractMinutes: integer(e.contractMinutes, 10080),
        from: e.from, until: e.until, week: e.week.map(slots) };
    }) };
  }
  function generate(value, config, firstMondayOff = null) {
    const employees = validateConfig(config).employees.filter(e => e.from <= month(value) && (!e.until || e.until >= value));
    if (!employees.length) fail('Nessun dipendente attivo nel mese');
    if (firstMondayOff !== null && !['matteo','vincenzo'].includes(firstMondayOff)) fail('Alternanza non valida');
    const days = dates(value), firstMonday = days.find(d => weekday(d) === 1);
    const entries = [];
    for (const date of days) {
      const wd = weekday(date);
      const weekIndex = Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${firstMonday}T12:00:00Z`)) / 604800000);
      const mondayOff = weekIndex % 2 === 0 ? firstMondayOff : firstMondayOff === 'matteo' ? 'vincenzo' : 'matteo';
      for (const employee of employees) {
        let shift = clone(employee.week[wd]);
        if (firstMondayOff && ['matteo','vincenzo'].includes(employee.id)) {
          if (wd === 1 && employee.id === mondayOff) shift = shift.filter(p => minutes(p[0]) >= 720);
          if (wd === 6 && employee.id !== mondayOff) shift = shift.filter(p => minutes(p[1]) <= 900);
        }
        entries.push({ date, employeeId: employee.id, slots: shift, absences: [], workedMinutes: null, extraMinutes: 0, note: '', closed: false });
      }
    }
    return { month: value, firstMondayOff, employees: employees.map(({profileId, week, from, until, ...e}) => e), entries };
  }
  function validateDocument(input) {
    if (!input || typeof input !== 'object') fail('Planning non valido');
    const ds = dates(input.month), dateSet = new Set(ds);
    if (input.firstMondayOff !== null && !['matteo','vincenzo'].includes(input.firstMondayOff)) fail('Alternanza non valida');
    if (!Array.isArray(input.employees) || !input.employees.length || input.employees.length > 20) fail('Dipendenti del mese non validi');
    const ids = new Set();
    const employees = input.employees.map(e => {
      if (!/^[a-z][a-z0-9_-]{0,39}$/.test(e.id || '') || ids.has(e.id) || typeof e.name !== 'string' || !e.name.trim() || e.name.length > 80) fail('Dipendente del mese non valido');
      ids.add(e.id); return {id: e.id, name: e.name.trim(), contractMinutes: integer(e.contractMinutes, 10080)};
    });
    if (!Array.isArray(input.entries) || input.entries.length !== ds.length * employees.length) fail('Planning incompleto');
    const seen = new Set();
    const entries = input.entries.map(d => {
      const key = `${d.date}/${d.employeeId}`;
      if (!dateSet.has(d.date) || !ids.has(d.employeeId) || seen.has(key)) fail('Giorno non valido o duplicato');
      seen.add(key);
      const shift = slots(d.slots), total = slotMinutes(shift);
      if (typeof d.closed !== 'boolean' || (d.closed && shift.length)) fail('La chiusura deve essere senza turni');
      if (!Array.isArray(d.absences) || d.absences.length > 8) fail('Assenze non valide');
      const ranges = [];
      const absences = d.absences.map(a => {
        if (!TYPES.includes(a.type) || typeof a.fullDay !== 'boolean') fail('Causale assenza non valida');
        const code = a.code || '';
        if (typeof code !== 'string' || code.length > 80 || (a.type !== 'malattia' && code)) fail('Codice malattia non valido');
        if (a.fullDay) {
          if (d.absences.length !== 1 || !total) fail('Assenza intera giornata solo su turno previsto, senza altre assenze');
          ranges.push([0,1440]); return {type: a.type, fullDay: true, start: null, end: null, code};
        }
        const start = minutes(a.start), end = minutes(a.end);
        if (end <= start) fail('Intervallo assenza non valido');
        const overlap = shift.reduce((s,p) => s + Math.max(0, Math.min(end,minutes(p[1])) - Math.max(start,minutes(p[0]))),0);
        if (!overlap) fail('Assenza fuori dal turno previsto');
        ranges.push([start,end]); return {type: a.type, fullDay: false, start: a.start, end: a.end, code};
      });
      ranges.sort((a,b) => a[0]-b[0]).forEach((r,i) => { if (i && r[0] < ranges[i-1][1]) fail('Le assenze si sovrappongono'); });
      const workedMinutes = d.workedMinutes === null ? null : integer(d.workedMinutes);
      const extraMinutes = integer(d.extraMinutes);
      if (workedMinutes !== null && workedMinutes + absenceMinutes({slots:shift,absences}) > total) fail('Le ore ordinarie e le assenze superano il previsto: usa lo straordinario per le ore extra');
      if ((workedMinutes ?? total - absenceMinutes({slots:shift,absences})) + extraMinutes > 1440) fail('Ore giornaliere superiori a 24');
      if (typeof d.note !== 'string' || d.note.length > 1000) fail('Nota troppo lunga');
      return { date:d.date, employeeId:d.employeeId, slots:shift, absences, workedMinutes, extraMinutes, note:d.note, closed:d.closed };
    });
    return { month:input.month, firstMondayOff:input.firstMondayOff, employees, entries };
  }
  function absenceMinutes(day, type) {
    return day.absences.filter(a => !type || a.type === type).reduce((sum,a) => sum + (a.fullDay ? slotMinutes(day.slots) : day.slots.reduce((n,p) => n + Math.max(0,Math.min(minutes(a.end),minutes(p[1]))-Math.max(minutes(a.start),minutes(p[0]))),0)),0);
  }
  function availableSlots(day) {
    let intervals = day.slots.map(p => p.map(minutes));
    for (const a of day.absences) {
      if (a.fullDay) return [];
      const start = minutes(a.start), end = minutes(a.end);
      intervals = intervals.flatMap(([l,r]) => end <= l || start >= r ? [[l,r]] : [[l,Math.min(r,start)],[Math.max(l,end),r]].filter(([x,y]) => y>x));
    }
    return intervals.map(p => p.map(n => hours(n).padStart(5, '0')));
  }
  function summary(document, employeeId) {
    return document.entries.filter(e => e.employeeId === employeeId).reduce((sum,d) => {
      const planned = slotMinutes(d.slots), absent = absenceMinutes(d);
      sum.planned += planned; sum.ordinary += d.workedMinutes ?? planned-absent; sum.extra += d.extraMinutes;
      for (const type of TYPES) sum[type] += absenceMinutes(d,type);
      if (d.workedMinutes === null && planned > absent) sum.pending++;
      return sum;
    }, {planned:0, ordinary:0, extra:0, ferie:0, permessi:0, malattia:0, pending:0});
  }
  function publicDocument(document, employeeId) {
    const clean = validateDocument(document);
    return { month:clean.month, employees:clean.employees.filter(e => e.id === employeeId).map(e => ({id:e.id,name:e.name})),
      entries:clean.entries.filter(e => e.employeeId === employeeId).map(d => ({date:d.date,employeeId:d.employeeId,slots:availableSlots(d),absentMinutes:absenceMinutes(d),closed:d.closed})) };
  }
  function holiday(date) {
    const recurring = {'01-01':'Capodanno','01-06':'Epifania','04-25':'Liberazione','05-01':'Festa del lavoro','06-02':'Festa della Repubblica','08-15':'Ferragosto','11-01':'Ognissanti','12-08':'Immacolata','12-25':'Natale','12-26':'Santo Stefano'};
    if (recurring[date.slice(5)]) return recurring[date.slice(5)];
    const y = Number(date.slice(0,4)), a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
    const easter = new Date(Date.UTC(y,Math.floor(n/31)-1,(n%31)+1));
    if (easter.toISOString().slice(0,10) === date) return 'Pasqua';
    easter.setUTCDate(easter.getUTCDate()+1);
    return easter.toISOString().slice(0,10) === date ? 'Lunedì dell’Angelo' : '';
  }
  return {TYPES,WEEKDAYS,UUID,clone,month,dates,weekday,minutes,hours,slots,parseSlots,formatSlots,slotMinutes,defaultConfig,validateConfig,generate,validateDocument,absenceMinutes,availableSlots,summary,publicDocument,holiday};
});
