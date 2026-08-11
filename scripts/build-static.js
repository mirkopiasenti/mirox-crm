'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'dist');
const PUBLIC_DIRECTORIES = ['assets', 'css', 'js', 'moduli'];
const PRODUCTION_PROJECT_REF = 'lbgwamhjkjjfwgusafbi';
const PRODUCTION_FRONTEND_CONFIG = Object.freeze({
  url: `https://${PRODUCTION_PROJECT_REF}.supabase.co`,
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxiZ3dhbWhqa2pqZndndXNhZmJpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MjIxMTksImV4cCI6MjA5MDE5ODExOX0.SgmrxbP07F-8jtqvf8JHYkFqCVu-2hM4KgLEH_vPvuo'
});
const FORBIDDEN_OUTPUTS = [
  'database',
  'docs',
  'netlify',
  'scripts',
  'tests',
  'AGENTS.md',
  'CLAUDE.md',
  'README.md',
  'netlify.toml',
  'package.json',
  'package-lock.json'
];

function assertSafeOutputPath() {
  if (path.dirname(OUTPUT) !== ROOT || path.basename(OUTPUT) !== 'dist') {
    throw new Error(`Percorso di build non sicuro: ${OUTPUT}`);
  }
}

function copyDirectory(name) {
  const source = path.join(ROOT, name);
  const destination = path.join(OUTPUT, name);

  if (!fs.statSync(source).isDirectory()) {
    throw new Error(`Directory pubblica mancante: ${name}`);
  }

  fs.cpSync(source, destination, {
    recursive: true,
    filter: (sourcePath) => path.basename(sourcePath) !== '.DS_Store'
  });
}

function assertPrivateSourcesExcluded() {
  const leaked = FORBIDDEN_OUTPUTS.filter((relativePath) =>
    fs.existsSync(path.join(OUTPUT, relativePath))
  );

  if (leaked.length > 0) {
    throw new Error(`File privati inclusi nella build: ${leaked.join(', ')}`);
  }
}

function normalizeDeployEnvironment(env) {
  const explicit = String(env.MIROX_DEPLOY_ENV || '').trim().toLowerCase();
  const branch = String(env.BRANCH || '').trim();

  if (explicit && !['production', 'staging'].includes(explicit)) {
    throw new Error('MIROX_DEPLOY_ENV deve essere production oppure staging');
  }

  if (branch && branch !== 'main') {
    if (explicit === 'production') {
      throw new Error('Una branch Netlify diversa da main non puo\' usare MIROX_DEPLOY_ENV=production');
    }
    return 'staging';
  }

  if (branch === 'main' && explicit === 'staging') {
    throw new Error('La branch Netlify main non puo\' usare MIROX_DEPLOY_ENV=staging');
  }

  return explicit || 'production';
}

function decodeJwtRole(key) {
  const parts = String(key).split('.');
  if (parts.length !== 3) return '';

  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role || '';
  } catch (_error) {
    return '';
  }
}

function validateFrontendConfig(config) {
  let parsed;
  try {
    parsed = new URL(config.url);
  } catch (_error) {
    throw new Error('MIROX_PUBLIC_SUPABASE_URL non e\' un URL valido');
  }

  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co')) {
    throw new Error('MIROX_PUBLIC_SUPABASE_URL deve essere un endpoint HTTPS Supabase');
  }

  if (!config.anonKey || config.anonKey.length < 20) {
    throw new Error('MIROX_PUBLIC_SUPABASE_ANON_KEY mancante o non valida');
  }

  if (config.anonKey.startsWith('sb_secret_') || decodeJwtRole(config.anonKey) === 'service_role') {
    throw new Error('La service role/secret key non deve mai essere pubblicata nel frontend');
  }

  return { ...config, host: parsed.hostname };
}

function resolveFrontendConfig(env = process.env) {
  const deployEnvironment = normalizeDeployEnvironment(env);
  const releaseInfo = {
    commitSha: String(env.COMMIT_REF || env.COMMIT_SHA || '').trim().slice(0, 128) || null,
    deployId: String(env.DEPLOY_ID || env.CONTEXT || '').trim().slice(0, 160) || null
  };

  if (deployEnvironment === 'production') {
    return validateFrontendConfig({
      environment: deployEnvironment,
      ...releaseInfo,
      ...PRODUCTION_FRONTEND_CONFIG
    });
  }

  const url = String(env.MIROX_PUBLIC_SUPABASE_URL || '').trim();
  const anonKey = String(env.MIROX_PUBLIC_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    throw new Error(
      'Build staging bloccata: configurare MIROX_PUBLIC_SUPABASE_URL e MIROX_PUBLIC_SUPABASE_ANON_KEY'
    );
  }

  if (url.includes(PRODUCTION_PROJECT_REF)) {
    throw new Error('Build staging bloccata: il Supabase di produzione non e\' consentito');
  }

  return validateFrontendConfig({ environment: deployEnvironment, url, anonKey, ...releaseInfo });
}

function renderFrontendConfig(config) {
  const environmentInfo = JSON.stringify({
    environment: config.environment,
    commit_sha: config.commitSha || null,
    deploy_id: config.deployId || null
  });
  return `/**\n * MIROX Vendita - configurazione Supabase generata dalla build.\n * Non modificare dist/js/config.js manualmente.\n */\nconst SUPABASE_URL = ${JSON.stringify(config.url)};\nconst SUPABASE_ANON_KEY = ${JSON.stringify(config.anonKey)};\n\nconst db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {\n  auth: {\n    persistSession: true,\n    autoRefreshToken: true,\n    detectSessionInUrl: false\n  }\n});\nwindow.db = db;\nwindow.MiroxEnvironment = ${JSON.stringify(config.environment)};\nwindow.MiroxEnvironmentInfo = ${environmentInfo};\n`;
  return `/**\n * MIROX Vendita - configurazione Supabase generata dalla build.\n * Non modificare dist/js/config.js manualmente.\n */\nconst SUPABASE_URL = ${JSON.stringify(config.url)};\nconst SUPABASE_ANON_KEY = ${JSON.stringify(config.anonKey)};\n\nconst db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {\n  auth: {\n    persistSession: true,\n    autoRefreshToken: true,\n    detectSessionInUrl: false\n  }\n});\nwindow.db = db;\nwindow.MiroxEnvironment = ${JSON.stringify(config.environment)};\nwindow.MiroxEnvironmentInfo = ${environmentInfo};\n`;
}

function injectTelemetryScript() {
  const htmlFiles = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.endsWith('.html')) htmlFiles.push(target);
    }
  }
  visit(OUTPUT);
  for (const filename of htmlFiles) {
    const source = fs.readFileSync(filename, 'utf8');
    if (source.includes('mirox-telemetry.js')) continue;
    const updated = source.replace(
      /(<script\s+src=["']([^"']*\/)?mirox-api\.js["']\s*><\/script>)/i,
      (match, apiTag, directory = '') => `${apiTag}\n<script src="${directory}mirox-telemetry.js"></script>`
    );
    if (updated !== source) fs.writeFileSync(filename, updated, 'utf8');
  }
}

function renderSecurityHeaders(config) {
  const supabaseHttps = `https://${config.host}`;
  const supabaseWss = `wss://${config.host}`;
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${supabaseHttps} https://script.google.com https://script.googleusercontent.com`,
    `connect-src 'self' ${supabaseHttps} ${supabaseWss} https://script.google.com https://script.googleusercontent.com`,
    `frame-src 'self' blob: ${supabaseHttps}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    'upgrade-insecure-requests'
  ].join('; ');

  return `/*\n  Content-Security-Policy: ${csp}\n`;
}

function buildStatic(env = process.env) {
  const frontendConfig = resolveFrontendConfig(env);

  assertSafeOutputPath();
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });

  const rootHtmlFiles = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name);

  if (!rootHtmlFiles.includes('index.html')) {
    throw new Error('index.html mancante dalla root del progetto');
  }

  for (const filename of rootHtmlFiles) {
    fs.copyFileSync(path.join(ROOT, filename), path.join(OUTPUT, filename));
  }

  for (const directory of PUBLIC_DIRECTORIES) {
    copyDirectory(directory);
  }

  fs.writeFileSync(
    path.join(OUTPUT, 'js', 'config.js'),
    renderFrontendConfig(frontendConfig),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUTPUT, '_headers'),
    renderSecurityHeaders(frontendConfig),
    'utf8'
  );
  injectTelemetryScript();

  assertPrivateSourcesExcluded();

  console.log(
    `Build statica ${frontendConfig.environment} completata: ${rootHtmlFiles.length} pagine root e ${PUBLIC_DIRECTORIES.length} directory pubbliche`
  );
}

if (require.main === module) {
  buildStatic();
}

module.exports._test = {
  PRODUCTION_PROJECT_REF,
  normalizeDeployEnvironment,
  resolveFrontendConfig,
  renderFrontendConfig,
  renderSecurityHeaders,
  injectTelemetryScript,
  validateFrontendConfig
};
