import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obtainSourceArchive, verifyPinnedFile } from './distribute-step-sources';

const pinnedCommit = Type.String({ pattern: '^[a-f0-9]{40}$' });
const fileSchema = Type.Object({ fileName: Type.String({ pattern: '^[A-Za-z0-9._-]+$' }), byteLength: Type.Integer({ minimum: 1, maximum: 128 * 1024 * 1024 }), sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }) }, { additionalProperties: false });
const manifestSchema = Type.Object({
  format: Type.Literal('wire-edm-cad-kernel-sources'), schemaVersion: Type.Literal(1),
  packageName: Type.Literal('replicad-opencascadejs'), packageVersion: Type.Literal('1.1.0'),
  gitHead: pinnedCommit, bindingGeneratorCommit: pinnedCommit, occtCommit: pinnedCommit,
  archives: Type.Array(Type.Composite([fileSchema, Type.Object({ url: Type.String() })]), { minItems: 5, maxItems: 5 }),
  installedArtifacts: Type.Array(fileSchema, { minItems: 2, maxItems: 2 })
}, { additionalProperties: false });
const repositories = ['sgenoud/replicad', 'tauCAD/opencascade.js', 'Open-Cascade-SAS/OCCT', 'Tencent/rapidjson', 'freetype/freetype'];
const notices = ['replicad-MIT.txt', 'replicad-opencascadejs-LGPL-2.1.txt', 'OCCT-LGPL-2.1.txt', 'OCCT-LGPL-exception.txt', 'rapidjson-license.txt', 'freetype-FTL.txt', 'flatbush-ISC.txt', 'flatqueue-ISC.txt', 'opentype-MIT.txt', 'tiny-inflate-MIT.txt', 'codepointat-MIT.txt'];
const manifestPath = 'docs/thirdparty/replicad-sources.json';

async function inputs(root: string) {
  const manifestText = await readFile(path.join(root, manifestPath), 'utf8');
  const value: unknown = JSON.parse(manifestText);
  if (!Value.Check(manifestSchema, value)) throw new Error('Invalid CAD corresponding source manifest.');
  const installed: unknown = JSON.parse(await readFile(path.join(root, 'node_modules/replicad-opencascadejs/package.json'), 'utf8'));
  if (!Value.Check(Type.Object({ name: Type.Literal(value.packageName), version: Type.Literal(value.packageVersion), gitHead: Type.Literal(value.gitHead) }), installed)) throw new Error('Installed CAD kernel differs from its source manifest.');
  const expectedCommits = [value.gitHead, value.bindingGeneratorCommit, value.occtCommit];
  value.archives.forEach((archive, index) => {
    const prefix = `https://codeload.github.com/${repositories[index]}/tar.gz/`;
    if (!archive.url.startsWith(prefix) || !/^[a-f0-9]{40}$/.test(archive.url.slice(prefix.length))
      || index < 3 && archive.url !== prefix + expectedCommits[index]) throw new Error('CAD source URL does not match its pinned repository and commit.');
  });
  if (value.installedArtifacts.map(file => file.fileName).join(',') !== 'replicad_single.js,replicad_single.wasm') throw new Error('CAD kernel binary manifest does not match the single-thread build.');
  for (const file of value.installedArtifacts) await verifyPinnedFile(path.join(root, 'node_modules/replicad-opencascadejs/dist', file.fileName), file);
  const rebuild = await readFile(path.join(root, 'docs/thirdparty/replicad-rebuild.md'), 'utf8');
  const index = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CAD kernel licenses and corresponding source</title><body>
<h1>CAD kernel licenses and corresponding source</h1><p>Wire EDM Workbench uses unmodified Replicad 1.1.0 (MIT) and replicad-opencascadejs 1.1.0 (LGPL 2.1), with OpenCascade Technology 8.0.1 (LGPL 2.1 and its additional exception). Exact source, wrapper/build files and dependencies are available below. Models are processed locally in your browser.</p>
<ul>${value.archives.map(file => `<li><a download href="${file.fileName}">${file.fileName}</a> (${file.byteLength} bytes), SHA-256 <code>${file.sha256}</code></li>`).join('\n')}</ul>
<p><a href="replicad-sources.json">Pinned source and library binary manifest</a> · <a href="REBUILD-replicad.md">Build and relink instructions</a></p>
<ul>${notices.map(file => `<li><a href="${file}">${file}</a></li>`).join('\n')}</ul><p>These libraries are provided without warranty. FreeType is distributed under the FreeType License; portions of this software are copyright © 2023 The FreeType Project (www.freetype.org). All rights reserved.</p></body></html>\n`;
  return { manifest: value, texts: new Map([['replicad-sources.json', manifestText], ['REBUILD-replicad.md', rebuild], ['index.html', index],
    ...await Promise.all(notices.map(async file => [file, await readFile(path.join(root, 'src/features/cad/kernel/notices', file), 'utf8')] as const))]) };
}

export async function distributeCadSources(root = process.cwd(), fetchSource: typeof fetch = fetch) {
  const { manifest, texts } = await inputs(root);
  const sources: string[] = [];
  for (const archive of manifest.archives) sources.push(await obtainSourceArchive(path.join(root, '.cache/third-party-sources'), archive, fetchSource, repositories));
  const destination = path.join(root, 'dist/third-party/cad');
  await mkdir(destination, { recursive: true });
  for (const [index, archive] of manifest.archives.entries()) await copyFile(sources[index], path.join(destination, archive.fileName));
  for (const [file, content] of texts) await writeFile(path.join(destination, file), content);
}
export async function checkCadSourceDistribution(root = process.cwd()) {
  const { manifest, texts } = await inputs(root);
  const destination = path.join(root, 'dist/third-party/cad');
  for (const file of manifest.archives) await verifyPinnedFile(path.join(destination, file.fileName), file);
  for (const [file, expected] of texts) if (await readFile(path.join(destination, file), 'utf8') !== expected) throw new Error(`CAD third-party distribution text differs: ${file}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.length === 1 && args[0] !== '--check') throw new Error('Usage: distribute-cad-sources.ts [--check]');
  if (!args.length) await distributeCadSources();
  await checkCadSourceDistribution();
  console.log('CAD kernel corresponding source verified: 5 pinned archives, exact library artifacts, licenses and relink instructions.');
}
