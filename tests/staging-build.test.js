const assert = require('node:assert/strict');
const test = require('node:test');

const { _test } = require('../scripts/build-static');

const STAGING_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const STAGING_KEY = 'sb_publishable_staging_key_for_automated_tests';

test('una branch Netlify diversa da main viene trattata come staging', () => {
  assert.equal(_test.normalizeDeployEnvironment({ BRANCH: 'main' }), 'production');
  assert.equal(
    _test.normalizeDeployEnvironment({ BRANCH: 'codex/kona-ai-guardian-staging' }),
    'staging'
  );
});

test('nessuna variabile puo\' forzare produzione su una branch staging', () => {
  assert.throws(
    () => _test.normalizeDeployEnvironment({
      BRANCH: 'codex/kona-ai-guardian-staging',
      MIROX_DEPLOY_ENV: 'production'
    }),
    /non puo' usare MIROX_DEPLOY_ENV=production/
  );
  assert.throws(
    () => _test.normalizeDeployEnvironment({
      BRANCH: 'main',
      MIROX_DEPLOY_ENV: 'staging'
    }),
    /main non puo' usare MIROX_DEPLOY_ENV=staging/
  );
});

test('la build staging richiede credenziali frontend dedicate', () => {
  assert.throws(
    () => _test.resolveFrontendConfig({ BRANCH: 'codex/kona-ai-guardian-staging' }),
    /Build staging bloccata/
  );
});

test('la build staging rifiuta il project ref Supabase di produzione', () => {
  assert.throws(
    () => _test.resolveFrontendConfig({
      MIROX_DEPLOY_ENV: 'staging',
      MIROX_PUBLIC_SUPABASE_URL: `https://${_test.PRODUCTION_PROJECT_REF}.supabase.co`,
      MIROX_PUBLIC_SUPABASE_ANON_KEY: STAGING_KEY
    }),
    /produzione non e' consentito/
  );
});

test('config e CSP staging contengono soltanto l\'host Supabase staging', () => {
  const config = _test.resolveFrontendConfig({
    MIROX_DEPLOY_ENV: 'staging',
    MIROX_PUBLIC_SUPABASE_URL: STAGING_URL,
    MIROX_PUBLIC_SUPABASE_ANON_KEY: STAGING_KEY
  });
  const frontend = _test.renderFrontendConfig(config);
  const headers = _test.renderSecurityHeaders(config);

  assert.match(frontend, new RegExp(STAGING_URL));
  assert.match(frontend, /MiroxEnvironment = "staging"/);
  assert.match(headers, /https:\/\/abcdefghijklmnopqrst\.supabase\.co/);
  assert.match(headers, /wss:\/\/abcdefghijklmnopqrst\.supabase\.co/);
  assert.doesNotMatch(headers, new RegExp(_test.PRODUCTION_PROJECT_REF));
});

test('la service role viene rifiutata dalla configurazione pubblica', () => {
  assert.throws(
    () => _test.validateFrontendConfig({
      environment: 'staging',
      url: STAGING_URL,
      anonKey: 'sb_secret_this_must_never_reach_the_browser'
    }),
    /non deve mai essere pubblicata/
  );
});
