import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { iconSource } from '../../../scripts/icon-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check with npm run check:package.');
const temporaryRoot = resolve(tmpdir());
const scratch = mkdtempSync(join(temporaryRoot, 'wire-edm-icons-'));
function runNpm(args, cwd) {
  return execFileSync(process.execPath, [npm, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
try {
  const [packed] = JSON.parse(runNpm(['pack', '--json', '--ignore-scripts', '--pack-destination', scratch], root));
  assert.equal(packed.files.filter(file => /^dist\/icons\/[^/]+\.js$/.test(file.path)).length, iconSource.length);
  assert.equal(packed.files.filter(file => /^dist\/icons\/[^/]+\.d\.ts$/.test(file.path)).length, iconSource.length);
  assert.equal(packed.files.some(file => /^(?:src|scripts|test)\//.test(file.path)), false);
  const consumer = join(scratch, 'consumer');
  mkdirSync(consumer);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'icons-packed-consumer', private: true, type: 'module' }));
  runNpm(['install', '--ignore-scripts', '--legacy-peer-deps', '--offline', '--no-audit', '--no-fund', '--package-lock=false', join(scratch, packed.filename)], consumer);
  // Supply the consumer's React peer and type package without registry/network access.
  symlinkSync(dirname(require.resolve('react/package.json')), join(consumer, 'node_modules/react'), process.platform === 'win32' ? 'junction' : 'dir');
  mkdirSync(join(consumer, 'node_modules/@types'), { recursive: true });
  symlinkSync(dirname(require.resolve('@types/react/package.json')), join(consumer, 'node_modules/@types/react'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(consumer, 'resolve.mjs'), `import assert from 'node:assert/strict';
import { AddIcon, Plus } from '@wire-edm/icons-react';
import { AddIcon as SingleAdd } from '@wire-edm/icons-react/icons/add';
import { WorkbenchIcon, iconCatalog } from '@wire-edm/icons-react/dynamic';
import { iconCatalog as catalog } from '@wire-edm/icons-react/catalog';
assert.equal(AddIcon, Plus); assert.equal(AddIcon, SingleAdd);
assert.equal(typeof WorkbenchIcon.render, 'function'); assert.equal(iconCatalog, catalog);
`);
  execFileSync(process.execPath, ['resolve.mjs'], { cwd: consumer, stdio: 'pipe' });
  writeFileSync(join(consumer, 'types.tsx'), `import { AddIcon, type WorkbenchIconProps, type IconName } from '@wire-edm/icons-react';
import { PadIcon } from '@wire-edm/icons-react/icons/pad';
import { WorkbenchIcon } from '@wire-edm/icons-react/dynamic';
const name: IconName = 'pad';
// @ts-expect-error Unknown icon IDs must be rejected by the generated declaration.
const invalidName: IconName = 'not-an-icon';
const props: WorkbenchIconProps = { size: 16, absoluteStrokeWidth: true, onClick: event => event.currentTarget.focus() };
export const examples = [<AddIcon {...props} />, <PadIcon aria-label="Extrude" />, <WorkbenchIcon name={name} />];
`);
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--jsx', 'react-jsx', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'types.tsx'], { cwd: consumer, stdio: 'pipe' });

  const bundle = await build({
    absWorkingDir: consumer,
    stdin: { contents: "export { AddIcon } from '@wire-edm/icons-react';", resolveDir: consumer, sourcefile: 'named-entry.js' },
    bundle: true, format: 'esm', platform: 'neutral', external: ['react', 'react/*'],
    treeShaking: true, minify: true, write: false, metafile: true
  });
  const output = Object.values(bundle.metafile.outputs)[0];
  const retained = Object.entries(output.inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name.replaceAll('\\', '/'));
  assert.deepEqual(retained.filter(name => /\/dist\/icons\//.test(name)).map(name => name.split('/').at(-1)), ['add.js']);
  assert.equal(retained.some(name => /\/dist\/(?:catalog|dynamic)\.js$/.test(name)), false);
  assert.equal(bundle.outputFiles[0].text.includes('iconCatalog'), false);
  const installed = JSON.parse(readFileSync(join(consumer, 'node_modules/@wire-edm/icons-react/package.json'), 'utf8'));
  assert.equal(installed.sideEffects, false);
  console.log(`Packed ${iconSource.length} icons; isolated consumer ESM/types resolve; AddIcon bundle ${bundle.outputFiles[0].contents.length} bytes retains one drawing and no dynamic catalog.`);
} finally {
  // oxlint-disable-next-line no-unsafe-finally -- refusing to delete an unexpected directory must win.
  if (!resolve(scratch).startsWith(`${temporaryRoot}${sep}`) || !scratch.split(sep).at(-1)?.startsWith('wire-edm-icons-')) throw new Error('Invalid package-check cleanup directory.');
  rmSync(scratch, { recursive: true, force: true });
}
