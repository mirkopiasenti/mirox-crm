'use strict';

// Client Telegram DEDICATO a KONA Call Director (bot separato dal Guardian).
// Nessun dato personale (nomi, CF/PIVA, telefoni, indirizzi) nel testo:
// ogni chiamata passa da sanitizeForTelegram() prima dell'invio.

const TELEGRAM_API_ROOT = 'https://api.telegram.org';
const { protectIsoDates, restoreIsoDates } = require('./kona-cd-util');

function getBotToken() {
  return String(process.env.KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN || '').trim();
}

function getOwnerChatId() {
  return String(process.env.KONA_CALL_DIRECTOR_OWNER_CHAT_ID || '').trim();
}

function isConfigured() {
  return Boolean(getBotToken() && getOwnerChatId());
}

// Rimuove dati identificativi dal testo Telegram (PII safe). Le NEWLINE sono
// preservate (i report e i piani usano righe multiple). Le date ISO vengono
// protette per non essere confuse con numeri di telefono.
function sanitizeForTelegram(text, maxLength = 3900) {
  const protectedDates = protectIsoDates(text || '');
  let s = protectedDates.text
    .replace(/\+?\d[\d\s.-]{8,}\d/g, '[telefono]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/g, '[cf]')
    .replace(/\b\d{11}\b/g, '[piva]');
  s = restoreIsoDates(s, protectedDates.saved);
  return s
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

async function telegramRequest(method, payload = {}) {
  const token = getBotToken();
  if (!token) throw new Error('KONA_CALL_DIRECTOR_TELEGRAM_BOT_TOKEN non configurato');

  const response = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram API ${response.status}`);
  }
  return result.result;
}

async function sendMessage(chatId, text, options = {}) {
  return telegramRequest('sendMessage', {
    chat_id: String(chatId),
    text: sanitizeForTelegram(text),
    disable_web_page_preview: true,
    ...(options.reply_markup ? { reply_markup: options.reply_markup } : {}),
    ...(options.parse_mode ? { parse_mode: options.parse_mode } : {})
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  return telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: String(text).slice(0, 180) } : {})
  });
}

// Confronto timing-safe del secret webhook.
function timingSafeEqualText(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) {
    return false;
  }
  return cryptoTimingSafeEqual(ba, bb);
}

function cryptoTimingSafeEqual(a, b) {
  // re-export per i test
  return require('crypto').timingSafeEqual(a, b);
}

module.exports = {
  answerCallbackQuery,
  getBotToken,
  getOwnerChatId,
  isConfigured,
  sanitizeForTelegram,
  sendMessage,
  telegramRequest,
  timingSafeEqualText,
  _test: { timingSafeEqualText }
};
