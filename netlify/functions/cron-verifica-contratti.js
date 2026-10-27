'use strict';
const { getAdminClient } = require('./_lib/require-auth');
const Worker = require('./_lib/verifica-worker');
const { checked } = require('./_lib/verifica-documenti');
const schedule = '* * * * *';
async function handler(event = {}, deps = {}) {
  if (!Worker.production()) return { statusCode: 200, body: '{"skipped":true}' };
  const db = deps.db || getAdminClient();
  try {
    if (!db) throw new Error('database');
    const cfg = await Worker.config(db);
    if (cfg.modalita === 'spenta') return { statusCode: 200, body: '{"skipped":true}' };
    const previews = checked(await db.from('vendita_verifiche').select('contratto_id').eq('modalita_job', 'collaudo').in('stato_job', ['in_coda', 'errore', 'in_corso'])
      .lte('prossimo_at', new Date().toISOString()).lt('tentativi', 5).or('lock_until.is.null,lock_until.lt.' + new Date().toISOString()).limit(1));
    if (previews.length) await (deps.nudge || Worker.nudge)({ id: previews[0].contratto_id, test: true });
    if (cfg.modalita !== 'attiva') return { statusCode: 200, body: '{"skipped":true}' };
    checked(await db.rpc('vendita_verifica_sync'));
    const due = checked(await db.from('vendita_verifiche').select('contratto_id').in('stato_job', ['in_coda', 'errore', 'in_corso']).eq('modalita_job', 'automatica').lte('prossimo_at', new Date().toISOString()).lt('tentativi', 5).limit(1));
    const mail = checked(await db.from('vendita_verifica_notifiche').select('id').eq('stato', 'in_coda').lte('prossimo_at', new Date().toISOString()).limit(1));
    const uncertain = checked(await db.from('vendita_verifica_notifiche').select('id').eq('stato', 'in_corso').lt('updated_at', new Date(Date.now() - 15 * 60000).toISOString()).limit(1));
    if (due.length || mail.length || uncertain.length) await (deps.nudge || Worker.nudge)();
    return { statusCode: 200, body: '{"ok":true}' };
  } catch { console.error('Verifica automatica: recupero coda non riuscito.'); return { statusCode: 500, body: '{"ok":false}' }; }
}
module.exports = { handler, schedule };
