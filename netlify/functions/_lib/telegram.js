'use strict';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';

// Client Telegram del bot KONA AI Guardian.
// Solo testo: la trascrizione dei messaggi vocali e' stata RIMOSSA dal progetto
// (nessun download audio, nessuna chiamata all'API di trascrizione). Il webhook
// risponde a un vocale con una richiesta di scrivere il testo.

function getBotToken() {
  return String(process.env.TELEGRAM_GUARDIAN_BOT_TOKEN || '').trim();
}

function isTelegramConfigured() {
  return Boolean(getBotToken() && String(process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || '').trim());
}

async function telegramRequest(method, payload = {}) {
  const token = getBotToken();
  if (!token) throw new Error('TELEGRAM_GUARDIAN_BOT_TOKEN non configurato');

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

async function sendTelegramMessage(chatId, text, options = {}) {
  return telegramRequest('sendMessage', {
    chat_id: String(chatId),
    text: String(text || '').slice(0, 4000),
    disable_web_page_preview: true,
    ...(options.reply_markup ? { reply_markup: options.reply_markup } : {})
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  return telegramRequest('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text: String(text).slice(0, 180) } : {})
  });
}

module.exports = {
  answerCallbackQuery,
  isTelegramConfigured,
  sendTelegramMessage,
  telegramRequest
};
