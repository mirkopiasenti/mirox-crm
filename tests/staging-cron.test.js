const assert = require('node:assert/strict');
const test = require('node:test');

const rientro = require('../netlify/functions/cron-rientro-sim');
const pulizia = require('../netlify/functions/cron-pulizia-operativa');

test('i cron CRM non eseguono operazioni nel sito Guardian staging', async () => {
  const previousEnvironment = process.env.MIROX_DEPLOY_ENV;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    process.env.MIROX_DEPLOY_ENV = 'staging';
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    for (const cron of [rientro, pulizia]) {
      assert.equal(cron._test.isStagingEnvironment(), true);
      const response = await cron.handler();
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), {
        ok: true,
        skipped: true,
        environment: 'staging'
      });
    }
  } finally {
    if (previousEnvironment === undefined) delete process.env.MIROX_DEPLOY_ENV;
    else process.env.MIROX_DEPLOY_ENV = previousEnvironment;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('i cron restano attivi quando staging non e dichiarato esplicitamente', () => {
  const previousEnvironment = process.env.MIROX_DEPLOY_ENV;

  try {
    delete process.env.MIROX_DEPLOY_ENV;
    assert.equal(rientro._test.isStagingEnvironment(), false);
    assert.equal(pulizia._test.isStagingEnvironment(), false);
    process.env.MIROX_DEPLOY_ENV = 'production';
    assert.equal(rientro._test.isStagingEnvironment(), false);
    assert.equal(pulizia._test.isStagingEnvironment(), false);
  } finally {
    if (previousEnvironment === undefined) delete process.env.MIROX_DEPLOY_ENV;
    else process.env.MIROX_DEPLOY_ENV = previousEnvironment;
  }
});
