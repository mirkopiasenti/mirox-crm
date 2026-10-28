'use strict';
const { getAdminClient } = require('./_lib/require-auth');
const Worker = require('./_lib/verifica-worker');
async function handler(event, deps = {}) {
  const body = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  if (event.httpMethod !== 'POST' || body.length > 500 || !Worker.verify(body, event.headers?.['x-mirox-verifica'] || event.headers?.['X-Mirox-Verifica'])) return { statusCode: 403 };
  const payload = JSON.parse(body), db = deps.db || getAdminClient();
  if (!db || !Worker.production()) return { statusCode: 503 };
  const cfg = await Worker.config(db);
  if (cfg.modalita === 'spenta') return { statusCode: 200 };
  if (payload.notifications === true) {
    await Worker.notifications(db, deps);
    return { statusCode: 200 };
  }
  if (!payload.test && cfg.modalita !== 'attiva') return { statusCode: 200 };
  const start = Date.now();
  do {
    const result = await Worker.processOne(db, { id: payload.id || null, test: payload.test === true }, deps);
    if (payload.id || result.skipped || result.failed) break;
  } while (Date.now() - start < 7 * 60000);
  await Worker.notifications(db, deps);
  return { statusCode: 200 };
}
module.exports = { handler };
