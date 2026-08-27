'use strict';

// Helper tempo Europe/Rome, DST-safe.
// Le date "YYYY-MM-DD" sono giorni solari Rome; i timestamptz DB sono UTC.

const ROME_TZ = 'Europe/Rome';
const ROME_OFFSET_MS_MIN = 60 * 60 * 1000;   // CET
const ROME_OFFSET_MS_MAX = 2 * 60 * 60 * 1000; // CEST

const WALL_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: ROME_TZ,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

// Componenti dell'orologio Rome per un istante UTC.
function romeWallParts(date) {
  const parts = {};
  for (const p of WALL_FMT.formatToParts(date)) parts[p.type] = p.value;
  const hour = parts.hour === '24' ? '0' : parts.hour;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    hh: Number(hour),
    mm: Number(parts.minute),
    ss: Number(parts.second),
    dow: new Intl.DateTimeFormat('en-US', { timeZone: ROME_TZ, weekday: 'short' }).format(date)
  };
}

// Converti un'ora di muro Rome ("YYYY-MM-DD" + "HH:MM") nell'istante UTC.
// Metodo: tratta l'ora come se fosse UTC, misura l'offset Rome a quell'istante
// approssimativo e sottrae. Corretto per gli orari operativi (9-19), mai a
// cavallo delle transizioni DST (02/03 di notte).
function romeToUtc(dateStr, hhmm = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = String(hhmm).split(':').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0, 0);
  const wall = romeWallParts(new Date(naiveUtc));
  const wallAsUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm, wall.ss);
  const offsetMs = wallAsUtc - naiveUtc;
  return new Date(naiveUtc - offsetMs);
}

// Intervallo UTC [inizio, fine) del giorno solare Rome.
function romeDayRange(dateStr) {
  const start = romeToUtc(dateStr, '00:00');
  const end = romeToUtc(addDaysStr(dateStr, 1), '00:00');
  return { start, end };
}

// Offset Rome (in ms) a un istante UTC: determinato dal delta tra orologio
// Rome e l'istante letto come se fosse UTC.
function romeOffsetMs(date) {
  const wall = romeWallParts(date);
  const wallAsUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm, wall.ss);
  return wallAsUtc - date.getTime();
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateStr(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function addDaysStr(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return formatDateStr(new Date(Date.UTC(y, m - 1, d + days)));
}

function todayRomeStr() {
  const now = new Date();
  const wall = romeWallParts(now);
  return `${wall.y}-${pad2(wall.m)}-${pad2(wall.d)}`;
}

function nowRomeParts() {
  return romeWallParts(new Date());
}

function monthRomeKey(dateStr) {
  return String(dateStr || todayRomeStr()).slice(0, 7); // "YYYY-MM"
}

// Minuti dall'inizio del giorno Rome per un istante UTC.
function minuteOfDayRome(date) {
  const wall = romeWallParts(date);
  return wall.hh * 60 + wall.mm;
}

function parseHHmm(hhmm) {
  const [hh, mm] = String(hhmm || '00:00').split(':').map(Number);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function hhmmFromMinutes(minutes) {
  const total = Math.max(0, Math.round(minutes || 0));
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

// Giorni lavorativi per orologio Rome. giorniLavorativi = array di dow JS (1-5 default).
function isWorkingDay(dateStr, giorniLavorativi = [1, 2, 3, 4, 5]) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Dom
  return giorniLavorativi.includes(dow);
}

// Confronta l'ora corrente Rome con "HH:MM".
function nowIsBeforeHHmm(hhmm, now = new Date()) {
  const target = parseHHmm(hhmm);
  if (target === null) return false;
  return minuteOfDayRome(now) < target;
}

function nowIsAfterHHmm(hhmm, now = new Date()) {
  const target = parseHHmm(hhmm);
  if (target === null) return false;
  return minuteOfDayRome(now) >= target;
}

// Data Rome formattata "DD/MM/YYYY HH:mm" per l'UI.
function formatRomeDateTime(date) {
  const wall = romeWallParts(date);
  return `${pad2(wall.d)}/${pad2(wall.m)}/${wall.y} ${pad2(wall.hh)}:${pad2(wall.mm)}`;
}

module.exports = {
  ROME_OFFSET_MS_MIN,
  ROME_OFFSET_MS_MAX,
  addDaysStr,
  formatDateStr,
  formatRomeDateTime,
  hhmmFromMinutes,
  isWorkingDay,
  minuteOfDayRome,
  monthRomeKey,
  nowIsAfterHHmm,
  nowIsBeforeHHmm,
  nowRomeParts,
  parseHHmm,
  romeDayRange,
  romeOffsetMs,
  romeToUtc,
  romeWallParts,
  todayRomeStr,
  _test: {}
};
