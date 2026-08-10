'use strict';

const TELEGRAM_API_ROOT = 'https://api.telegram.org';
const MAX_VOICE_BYTES = 25 * 1024 * 1024;

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

async function downloadTelegramFile(fileId) {
  const token = getBotToken();
  const file = await telegramRequest('getFile', { file_id: fileId });
  if (!file?.file_path) throw new Error('Telegram non ha restituito il percorso del vocale');
  if (Number(file.file_size || 0) > MAX_VOICE_BYTES) {
    throw new Error('Il messaggio vocale supera il limite di 25 MB');
  }

  const response = await fetch(`${TELEGRAM_API_ROOT}/file/bot${token}/${file.file_path}`, {
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Download vocale Telegram non riuscito (${response.status})`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_VOICE_BYTES) throw new Error('Il messaggio vocale supera il limite di 25 MB');

  return {
    bytes,
    filename: String(file.file_path).split('/').pop() || 'vocale.ogg',
    mimeType: 'audio/ogg'
  };
}

async function transcribeVoice(file) {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY non configurata per la trascrizione vocale');

  const form = new FormData();
  form.append('model', String(process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe'));
  form.append('file', new Blob([file.bytes], { type: file.mimeType }), file.filename);
  form.append('prompt', 'Messaggio tecnico in italiano per KONA AI Guardian sul CRM Mirox.');
  form.append('languages[]', 'it');

  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Trascrizione OpenAI non riuscita (${response.status})`);
  }
  const text = String(payload.text || '').trim();
  if (!text) throw new Error('Il vocale non contiene una trascrizione utilizzabile');
  return text;
}

module.exports = {
  answerCallbackQuery,
  downloadTelegramFile,
  isTelegramConfigured,
  sendTelegramMessage,
  telegramRequest,
  transcribeVoice
};
