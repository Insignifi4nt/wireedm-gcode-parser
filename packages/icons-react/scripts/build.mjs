import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(fileURLToPath(new URL('./generate.mjs', import.meta.url)), ['--check']);
const output = resolve(root, 'dist');
if (dirname(output) !== resolve(root)) throw new Error('Invalid icon build output directory.');
rmSync(output, { recursive: true, force: true });
// TypeScript 7 exports only its API, so locate tsc through the package's declared bin.
const require = createRequire(import.meta.url), typescriptManifest = require.resolve('typescript/package.json');
run(resolve(dirname(typescriptManifest), require(typescriptManifest).bin.tsc), ['-p', 'tsconfig.json']);
