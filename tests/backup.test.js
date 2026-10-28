const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('backup: guasti parziali, integrita, versioni, retention e confini infrastruttura', (t) => {
  const result = spawnSync(process.env.MIROX_BACKUP_TEST_PYTHON || 'python3', ['-m', 'unittest', 'discover', '-s', 'scripts/backup', '-p', 'test_*.py'], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  if (/skipped=/.test(result.stderr)) {
    t.diagnostic('Test cifratura Aruba saltati: usare un Python con requirements-aruba installati tramite MIROX_BACKUP_TEST_PYTHON.');
  }
});
