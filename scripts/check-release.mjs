import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const read = (file) => JSON.parse(readFileSync(file, 'utf8'));
const pkg = read('package.json');
const lock = read('package-lock.json');
assert.match(pkg.version, /^0\.0\.\d+$/, 'Use the established 0.0.N app release sequence.');
assert.equal(lock.version, pkg.version);
assert.equal(lock.packages[''].version, pkg.version);
const release = read(`docs/releases/${pkg.version}.json`);
assert.equal(release.version, pkg.version);
assert.equal(Number(pkg.version.split('.')[2]), Number(release.previousVersion.split('.')[2]) + 1);
for (const key of ['schema', 'events', 'capabilities', 'auditAndOutput', 'installationAndStorage', 'verification']) {
  assert.ok(release.checklist[key]?.trim(), `Missing compatibility checklist: ${key}`);
}
assert.ok(release.summary && release.warning && release.postCompatibility);
assert.ok(release.publicNotes?.summary && release.publicNotes?.compatibility && release.publicNotes?.action);
assert.ok(release.publicNotes.changes.length > 0, 'Record user-facing release changes.');
const base = process.argv[2];
if (base) {
  // Pass a trusted git ref (CI uses origin/main), never shell-interpolate it.
  const previous = JSON.parse(execFileSync('git', ['show', `${base}:package.json`], { encoding: 'utf8' }));
  const baseSha = execFileSync('git', ['rev-parse', base], { encoding: 'utf8' }).trim();
  const expected = baseSha === release.baseline?.commit ? '0.0.685' : previous.version;
  assert.equal(release.previousVersion, expected, 'Rebase onto current main and update the release number/checklist.');
  const changed = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' }).trim().split('\n');
  for (const file of changed.filter((file) => /^docs\/releases\/.*\.json$/.test(file))) {
    assert.equal(file, `docs/releases/${pkg.version}.json`, 'Historical release records are immutable.');
  }
}
console.log(`Release ${pkg.version}: version and compatibility checklist verified.`);
