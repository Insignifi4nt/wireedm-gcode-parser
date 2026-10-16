import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obtainSourceArchive, verifyPinnedFile, type SourceArchive } from './distribute-step-sources';

const directory = 'vendor/sketch-solver';
const manifestName = 'planegcs-sources.json';
const packageName = '@salusoft89/planegcs';
const packageVersion = '1.3.0';
const gitHead = '9d26baef0b240fe0eef4186d4e5e5e66ec3620b7';
const npmIntegrity = 'sha512-ugIkFCPnKRK1Yed+5297S/RmmfgEhIp5Xxx8PYhgfbcS+AxYV3chZ8LMGlEbEqrkbK6fwmNVLtEpLFq5KDl2lw==';
const npmTarball = 'https://registry.npmjs.org/@salusoft89/planegcs/-/planegcs-1.3.0.tgz';
const expectedArchives = [
  ['eigen3_3.4.0.orig.tar.bz2', 'https://archive.ubuntu.com/ubuntu/pool/universe/e/eigen3/eigen3_3.4.0.orig.tar.bz2'],
  ['eigen3_3.4.0-4build0.1.debian.tar.xz', 'https://archive.ubuntu.com/ubuntu/pool/universe/e/eigen3/eigen3_3.4.0-4build0.1.debian.tar.xz'],
  ['boost1.83_1.83.0.orig.tar.xz', 'https://archive.ubuntu.com/ubuntu/pool/main/b/boost1.83/boost1.83_1.83.0.orig.tar.xz'],
  ['boost1.83_1.83.0-2.1ubuntu3.2.debian.tar.xz', 'https://archive.ubuntu.com/ubuntu/pool/main/b/boost1.83/boost1.83_1.83.0-2.1ubuntu3.2.debian.tar.xz'],
  ['emscripten-d6c521a7f05449857c76bd99e396895583cf2083.tar.gz', 'https://codeload.github.com/emscripten-core/emscripten/tar.gz/d6c521a7f05449857c76bd99e396895583cf2083'],
  ['emsdk-a2b92777574c2feda07994cd4f1079a3dfc151f8.tar.gz', 'https://codeload.github.com/emscripten-core/emsdk/tar.gz/a2b92777574c2feda07994cd4f1079a3dfc151f8']
];
const expectedLocalNames = [
  'npm-1.3.0-metadata.json', 'salusoft89-planegcs-1.3.0.tgz', `planegcs-${gitHead}.tar.gz`,
  'eigen3_3.4.0-4build0.1.dsc', 'boost1.83_1.83.0-2.1ubuntu3.2.dsc',
  'GNU-Library-GPL-2.0.txt', 'GNU-GPL-2.0.txt', 'planegcs-LGPL-2.1.txt',
  ...['APACHE', 'BSD', 'GPL', 'LGPL', 'MINPACK', 'MPL2', 'README'].map(suffix => `Eigen-COPYING.${suffix}.txt`),
  'Boost-LICENSE-1.0.txt', 'Eigen-Ubuntu-copyright.txt', 'Boost-Ubuntu-copyright.txt',
  'Emscripten-LICENSE.txt', 'Emscripten-AUTHORS.txt', 'musl-COPYRIGHT.txt',
  'LLVM-libcxx-LICENSE.txt', 'LLVM-libcxxabi-LICENSE.txt', 'LLVM-libunwind-LICENSE.txt',
  'LLVM-compiler-rt-LICENSE.txt', 'emmalloc-notice.txt', 'REBUILD.md'
];
const fileProperties = {
  fileName: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$', maxLength: 160 }),
  byteLength: Type.Integer({ minimum: 1, maximum: 128 * 1024 * 1024 }),
  sha256: Type.String({ pattern: '^[a-f0-9]{64}$' })
};
const manifestSchema = Type.Object({
  format: Type.Literal('wire-edm-sketch-solver-sources'), schemaVersion: Type.Literal(1),
  packageName: Type.Literal(packageName), packageVersion: Type.Literal(packageVersion), gitHead: Type.Literal(gitHead),
  copiedFreecadCommit: Type.Literal('5f8eac49f31626354ee69bf40616bac801ca5560'), npmIntegrity: Type.Literal(npmIntegrity),
  provenance: Type.Object({
    originalToolchainImage: Type.Literal('emscripten/emsdk:6.0.10'), originalContainerDigest: Type.Literal('not-published'),
    originalHeaderVersions: Type.Literal('not-published'), availableHeaderInputsMatchOriginalBinary: Type.Literal('not-proven'),
    originalBinaryReproduction: Type.Literal('not-verified'), originalBuildReceipt: Type.Literal('not-published'),
    availableEigenSourcePackage: Type.Literal('3.4.0-4build0.1'), availableBoostSourcePackage: Type.Literal('1.83.0-2.1ubuntu3.2'),
    availableEmscriptenCommit: Type.Literal('d6c521a7f05449857c76bd99e396895583cf2083'),
    availableEmsdkCommit: Type.Literal('a2b92777574c2feda07994cd4f1079a3dfc151f8'),
    sourceAssociation: Type.Literal('npm-publisher-gitHead'), nativeRebuildPerformed: Type.Literal(false)
  }, { additionalProperties: false }),
  nativeWasm: Type.Literal('dist/planegcs_dist/planegcs.wasm'),
  localFiles: Type.Array(Type.Object({ ...fileProperties, source: Type.String() }, { additionalProperties: false }), { minItems: 27, maxItems: 27 }),
  archives: Type.Array(Type.Object({ ...fileProperties, url: Type.String() }, { additionalProperties: false }), { minItems: 6, maxItems: 6 }),
  installedArtifacts: Type.Array(Type.Object({
    ...fileProperties, directory: Type.Union(['', 'dist', 'dist/planegcs_dist', 'dist/sketch', 'planegcs_dist', 'sketch'].map(value => Type.Literal(value)))
  }, { additionalProperties: false }), { minItems: 54, maxItems: 54 })
}, { additionalProperties: false });
const dependencies = Type.Object({ [packageName]: Type.Literal(packageVersion) });
const releaseSchema = Type.Object({
  name: Type.Literal(packageName), version: Type.Literal(packageVersion), gitHead: Type.Literal(gitHead),
  dist: Type.Object({ integrity: Type.Literal(npmIntegrity), tarball: Type.Literal(npmTarball) })
});

async function packageFiles(root: string, relative = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await packageFiles(root, name));
    else if (entry.isFile()) files.push(name);
    else throw new Error(`Unexpected sketch solver package entry: ${name}`);
  }
  return files.sort();
}

async function inputs(root: string) {
  const manifestText = await readFile(path.join(root, directory, manifestName), 'utf8');
  const manifest: unknown = JSON.parse(manifestText);
  if (!Value.Check(manifestSchema, manifest)) throw new Error('Invalid sketch solver source manifest.');
  manifest.archives.forEach((archive, index) => {
    const [name, url] = expectedArchives[index];
    if (archive.fileName !== name || archive.url !== url) throw new Error('Sketch solver archive differs from its pinned official input.');
  });
  const localNames = manifest.localFiles.map(file => file.fileName);
  if ([...localNames].sort().join('\n') !== [...expectedLocalNames].sort().join('\n')) throw new Error('Sketch solver source files or notices are incomplete or duplicate distribution paths.');
  for (const file of manifest.localFiles) await verifyPinnedFile(path.join(root, directory, file.fileName), file);
  const registry: unknown = JSON.parse(await readFile(path.join(root, directory, 'npm-1.3.0-metadata.json'), 'utf8'));
  const app: unknown = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock: unknown = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  const installedRoot = path.join(root, 'node_modules', packageName);
  const installed: unknown = JSON.parse(await readFile(path.join(installedRoot, 'package.json'), 'utf8'));
  if (!Value.Check(releaseSchema, registry) || !Value.Check(Type.Object({ dependencies }), app)
    || !Value.Check(Type.Object({ name: Type.Literal(packageName), version: Type.Literal(packageVersion) }), installed)
    || !Value.Check(Type.Object({ packages: Type.Object({
      '': Type.Object({ dependencies }),
      [`node_modules/${packageName}`]: Type.Object({ version: Type.Literal(packageVersion), resolved: Type.Literal(npmTarball), integrity: Type.Literal(npmIntegrity) })
    }) }), lock)) throw new Error('Installed sketch solver, dependency lock or registry evidence differs from the pinned release.');
  const npmBytes = await readFile(path.join(root, directory, 'salusoft89-planegcs-1.3.0.tgz'));
  if (`sha512-${createHash('sha512').update(npmBytes).digest('base64')}` !== npmIntegrity) throw new Error('Sketch solver npm payload integrity mismatch.');
  const artifactNames = manifest.installedArtifacts.map(file => file.directory ? `${file.directory}/${file.fileName}` : file.fileName).sort();
  if (artifactNames.join('\n') !== (await packageFiles(installedRoot)).join('\n') || !artifactNames.includes(manifest.nativeWasm)) throw new Error('Sketch solver installed package file set differs from its complete release manifest.');
  for (const file of manifest.installedArtifacts) await verifyPinnedFile(path.join(installedRoot, file.directory, file.fileName), file);
  const index = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sketch solver licenses and source</title><body>
<h1>Sketch solver licenses and source</h1><p>Wire EDM Workbench uses unmodified @salusoft89/planegcs 1.3.0. The wrapper carries LGPL 2.1-or-later notices; the copied FreeCAD core carries GNU Library GPL 2-or-later notices. The library is provided without warranty.</p>
<p>The exact published package and its publisher-pinned wrapper/native source are supplied below. Available pinned Eigen, Boost and Emscripten inputs support rebuilding. Upstream did not publish the original resolved header versions or container digest. These available inputs are not claimed to reproduce the original binary.</p>
<p><a href="${manifestName}">Source and installed artifact manifest</a> · <a href="REBUILD.md">Build, modification and replacement instructions</a></p>
<h2>Package, source, build instructions and notices</h2><ul>${manifest.localFiles.map(file => `<li><a download href="${file.fileName}">${file.fileName}</a> (${file.byteLength} bytes), SHA-256 <code>${file.sha256}</code></li>`).join('\n')}</ul>
<h2>Available header and toolchain source inputs</h2><ul>${manifest.archives.map(file => `<li><a download href="${file.fileName}">${file.fileName}</a> (${file.byteLength} bytes), SHA-256 <code>${file.sha256}</code></li>`).join('\n')}</ul>
<p>Downloads do not receive sketch or project files. Preserve the library notices when redistributing modified versions. The application adds no restriction on reverse engineering to debug library modifications.</p></body></html>\n`;
  return { manifest, texts: new Map([[manifestName, manifestText], ['index.html', index]]) };
}

// The existing archive helper intentionally accepts only pinned GitHub archives.
// Ubuntu source packages use their fixed official pool URLs and the same byte/hash checks.
async function obtainUbuntuSource(cache: string, archive: SourceArchive, fetchSource: typeof fetch) {
  await mkdir(cache, { recursive: true });
  const destination = path.join(cache, archive.fileName);
  try { await stat(destination); await verifyPinnedFile(destination, archive); return destination; }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  const temporary = `${destination}.partial-${randomUUID()}`;
  try {
    const response = await fetchSource(archive.url, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`Sketch solver source download failed (${response.status}): ${archive.fileName}`);
    const advertised = response.headers.get('content-length');
    if (advertised !== null && Number(advertised) !== archive.byteLength) {
      await response.body.cancel(); throw new Error(`Sketch solver download size differs: ${archive.fileName}`);
    }
    const file = await open(temporary, 'wx');
    let received = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        if (received > archive.byteLength) throw new Error(`Sketch solver source exceeds its byte limit: ${archive.fileName}`);
        await file.writeFile(chunk);
      }
    } finally { await file.close(); }
    await verifyPinnedFile(temporary, archive);
    await rename(temporary, destination);
    return destination;
  } finally { await rm(temporary, { force: true }); }
}

export async function distributeSketchSolverSources(root = process.cwd(), fetchSource: typeof fetch = fetch) {
  const { manifest, texts } = await inputs(root);
  const cache = path.join(root, '.cache/third-party-sources');
  const sources: string[] = [];
  for (const archive of manifest.archives) sources.push(archive.url.startsWith('https://codeload.github.com/')
    ? await obtainSourceArchive(cache, archive, fetchSource, ['emscripten-core/emscripten', 'emscripten-core/emsdk'])
    : await obtainUbuntuSource(cache, archive, fetchSource));
  const destination = path.join(root, 'dist/third-party/sketch-solver');
  await mkdir(destination, { recursive: true });
  for (const [index, archive] of manifest.archives.entries()) await copyFile(sources[index], path.join(destination, archive.fileName));
  for (const file of manifest.localFiles) await copyFile(path.join(root, directory, file.fileName), path.join(destination, file.fileName));
  for (const [file, content] of texts) await writeFile(path.join(destination, file), content);
}

export async function checkSketchSolverSourceDistribution(root = process.cwd()) {
  const { manifest, texts } = await inputs(root);
  const destination = path.join(root, 'dist/third-party/sketch-solver');
  for (const file of [...manifest.archives, ...manifest.localFiles]) await verifyPinnedFile(path.join(destination, file.fileName), file);
  for (const [file, expected] of texts) if (await readFile(path.join(destination, file), 'utf8') !== expected) throw new Error(`Sketch solver distribution text differs: ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== '--check') throw new Error('Usage: distribute-sketch-solver.ts [--check]');
  if (!args.length) await distributeSketchSolverSources();
  await checkSketchSolverSourceDistribution();
  console.log('Sketch solver source verified: published npm payload, 54 installed files, pinned source/build inputs, notices and replacement instructions.');
}
