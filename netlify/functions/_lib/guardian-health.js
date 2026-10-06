'use strict';

const { generateOwnerReply } = require('./kona-ai-guardian');

async function guardianHealth(supabase) {
  const checks = await Promise.all([
    (async () => {
      if (!process.env.OPENAI_API_KEY) return { ok: false, code: 'openai_key_missing' };
      try {
        await generateOwnerReply(null, [], 'Verifica tecnica sintetica. Rispondi solo OK.', { incidents: [], executions: [], history: [] });
        return { ok: true, model: process.env.OPENAI_GUARDIAN_MODEL || 'gpt-5.6-luna' };
      } catch (error) {
        const codes = ['openai_invalid_key', 'openai_quota_exceeded', 'openai_model_unavailable', 'openai_unavailable'];
        return { ok: false, code: codes.includes(error?.code) ? error.code : 'openai_unavailable' };
      }
    })(),
    (async () => {
      const token = process.env.TELEGRAM_GUARDIAN_BOT_TOKEN;
      if (!token || !process.env.TELEGRAM_GUARDIAN_OWNER_CHAT_ID || !process.env.TELEGRAM_GUARDIAN_WEBHOOK_SECRET) return { ok: false, code: 'telegram_not_configured' };
      try {
        const request = async method => {
          const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, { signal: AbortSignal.timeout(10000) });
          const body = await response.json();
          if (!response.ok || !body.ok) throw new Error('telegram_unavailable');
          return body.result;
        };
        const [bot, webhook] = await Promise.all([request('getMe'), request('getWebhookInfo')]);
        const correctBot = bot.username === 'MiroxAiGuardianBot';
        const correctWebhook = webhook.url === 'https://mirox-crm.it/.netlify/functions/guardian-telegram-webhook';
        return { ok: correctBot && correctWebhook, correct_bot: correctBot, correct_webhook: correctWebhook, pending_updates: Number(webhook.pending_update_count || 0), last_error_date: webhook.last_error_date || null };
      } catch (_) { return { ok: false, code: 'telegram_unavailable' }; }
    })(),
    (async () => {
      try {
        const { error } = await supabase.from('kona_ai_telegram_sessioni').select('conversazione').limit(1);
        return { ok: !error, code: error ? 'guardian_memory_unavailable' : null };
      } catch (_) { return { ok: false, code: 'guardian_memory_unavailable' }; }
    })(),
    (async () => {
      try {
        const { error } = await supabase.from('kona_ai_vocali_jobs').select('id').limit(1);
        return { ok: !error, code: error ? 'guardian_voice_queue_unavailable' : null };
      } catch (_) { return { ok: false, code: 'guardian_voice_queue_unavailable' }; }
    })()
  ]);
  return { ok: checks.every(c => c.ok), chat_openai: checks[0], telegram: checks[1], memory: checks[2], voice_queue: checks[3] };
}

module.exports = { guardianHealth };
