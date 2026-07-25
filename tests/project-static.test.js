const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

const projectFiles = walk(ROOT);

test('tutti i file JavaScript e gli script HTML inline hanno sintassi valida', () => {
  const syntaxErrors = [];

  projectFiles.filter((file) => file.endsWith('.js')).forEach((file) => {
    try {
      new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file });
    } catch (error) {
      syntaxErrors.push(error.message);
    }
  });

  projectFiles.filter((file) => file.endsWith('.html')).forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
      .map((match) => match[1])
      .filter((source) => source.trim());

    scripts.forEach((source, index) => {
      try {
        new vm.Script(source, { filename: `${file}#inline-${index + 1}` });
      } catch (error) {
        syntaxErrors.push(error.message);
      }
    });
  });

  assert.deepEqual(syntaxErrors, []);
});

test('i link locali statici puntano a file esistenti', () => {
  const missing = [];

  projectFiles.filter((file) => file.endsWith('.html')).forEach((file) => {
    const html = fs.readFileSync(file, 'utf8');
    const hrefs = [...html.matchAll(/\shref\s*=\s*["']([^"']+)["']/gi)]
      .map((match) => match[1].trim());

    hrefs.forEach((href) => {
      if (
        !href
        || href.startsWith('#')
        || href.startsWith('http://')
        || href.startsWith('https://')
        || href.startsWith('mailto:')
        || href.startsWith('tel:')
        || href.startsWith('javascript:')
        || href.includes('${')
      ) return;

      const cleanHref = href.split('#')[0].split('?')[0];
      if (!cleanHref || cleanHref.startsWith('/.netlify/')) return;
      const target = cleanHref.startsWith('/')
        ? path.join(ROOT, cleanHref.slice(1))
        : path.resolve(path.dirname(file), cleanHref);
      const resolvedTarget = cleanHref.endsWith('/') ? path.join(target, 'index.html') : target;

      if (!fs.existsSync(resolvedTarget)) {
        missing.push(`${path.relative(ROOT, file)} -> ${href}`);
      }
    });
  });

  assert.deepEqual(missing, []);
});
