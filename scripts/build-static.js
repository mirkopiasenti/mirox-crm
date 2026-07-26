'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'dist');
const PUBLIC_DIRECTORIES = ['assets', 'css', 'js', 'moduli'];
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

assertPrivateSourcesExcluded();

console.log(
  `Build statica completata: ${rootHtmlFiles.length} pagine root e ${PUBLIC_DIRECTORIES.length} directory pubbliche`
);
