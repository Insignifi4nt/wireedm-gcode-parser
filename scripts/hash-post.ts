import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseWireEdmPostPackage } from '../src/domain/post-processor/postPackage.ts';
import { canonicalJson } from '../src/domain/post-processor/canonicalJson.ts';

if (process.argv.length !== 3) throw new Error('Usage: npm run post:hash -- <post.wireedm-post.json>');
const parsed = parseWireEdmPostPackage(await readFile(process.argv[2], 'utf8'));
if (!parsed.ok) throw new Error(JSON.stringify(parsed.diagnostics));
console.log(JSON.stringify({
  packageId: parsed.package.manifest.id,
  version: parsed.package.manifest.version,
  contentHash: createHash('sha256').update(canonicalJson(parsed.package)).digest('hex')
}, null, 2));
