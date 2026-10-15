import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const [checkpoint, referenceDirectory] = process.argv.slice(2);
if (!/^[a-f0-9]{40}$/.test(checkpoint || '') || !referenceDirectory) {
  throw new Error('Usage: node scripts/freeze-icon-inventory.mjs <full-published-commit> <read-only-reference-directory>');
}
const destination = resolve('docs/design/inventory/checkpoints', checkpoint.slice(0, 7));
const sourceDirectory = resolve(referenceDirectory, 'docs/design');
const files = ['icon-inventory.audit.json', 'icon-inventory.md'];
const originals = files.map(name => {
  const bytes = readFileSync(resolve(sourceDirectory, name));
  const published = execFileSync('git', ['show', `${checkpoint}:docs/design/${name}`], {maxBuffer: 16 * 1024 * 1024});
  if (!bytes.equals(published)) throw new Error(`${name} differs from its published checkpoint; refusing to stamp a moving snapshot.`);
  const path = resolve(destination, name);
  if (existsSync(path) && !readFileSync(path).equals(bytes)) throw new Error(`Conflicting frozen evidence: ${path}`);
  return { name, path, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
});
const audit = JSON.parse(originals[0].bytes.toString('utf8'));
if (typeof audit.generatedAt !== 'string' || typeof audit.revision !== 'string' || !Array.isArray(audit.occurrences)) {
  throw new Error('Inventory metadata or occurrence records are missing.');
}
const provenance = { publishedCheckpoint: checkpoint, snapshotGeneratedAt: audit.generatedAt,
  snapshotBaseRevision: audit.revision, sourceDirectory, files: originals.map(({name,bytes,sha256})=>({name,bytes:bytes.length,sha256})) };
mkdirSync(destination, { recursive:true });
for (const {path, bytes} of originals) writeFileSync(path, bytes);
writeFileSync(resolve(destination, 'provenance.json'), JSON.stringify(provenance,null,2)+'\n');
writeFileSync(resolve(destination, 'README.md'), `# Published CAD inventory checkpoint\n\nExact byte-preserved inventory from published CAD commit \`${checkpoint}\`. Both source files were compared with the published Git blobs before copying. The original earlier inventory remains in its existing location.\n\nThe audit was generated at ${audit.generatedAt} against \`${audit.revision}\` with its recorded local changes. Publication includes those changes; generation metadata is retained rather than rewritten. File digests are in [provenance.json](provenance.json).\n`);
console.log(JSON.stringify({destination,...provenance},null,2));
