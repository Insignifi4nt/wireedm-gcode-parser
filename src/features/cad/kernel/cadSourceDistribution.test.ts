// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCadSourceDistribution, distributeCadSources } from '../../../../scripts/distribute-cad-sources';
import sourceManifest from '../../../../docs/thirdparty/replicad-sources.json';

const roots: string[] = [];
const prefix = path.join(os.tmpdir(), 'wireedm-cad-source-test-');
const metadata = (fileName: string, bytes: Buffer) => ({ fileName, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
const notices = ['replicad-MIT.txt', 'replicad-opencascadejs-LGPL-2.1.txt', 'OCCT-LGPL-2.1.txt', 'OCCT-LGPL-exception.txt', 'rapidjson-license.txt', 'freetype-FTL.txt', 'flatbush-ISC.txt', 'flatqueue-ISC.txt', 'opentype-MIT.txt', 'tiny-inflate-MIT.txt', 'codepointat-MIT.txt'];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.resolve(root).startsWith(prefix)) throw new Error('Test temporary directory escaped its allocated prefix.');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(prefix); roots.push(root);
  const manifest = structuredClone(sourceManifest);
  const sources = manifest.archives.map((archive, index) => Buffer.from(`complete CAD source archive ${index}`));
  const artifacts = manifest.installedArtifacts.map((archive, index) => Buffer.from(`paired kernel artifact ${index}`));
  manifest.archives = manifest.archives.map((archive, index) => ({ ...archive, ...metadata(archive.fileName, sources[index]) }));
  manifest.installedArtifacts = manifest.installedArtifacts.map((file, index) => metadata(file.fileName, artifacts[index]));
  const files: [string, string | Buffer][] = [
    ['docs/thirdparty/replicad-sources.json', JSON.stringify(manifest)],
    ['docs/thirdparty/replicad-rebuild.md', 'Exact source and relink instructions.'],
    ['node_modules/replicad-opencascadejs/package.json', JSON.stringify({ name: manifest.packageName, version: manifest.packageVersion, gitHead: manifest.gitHead })],
    ...manifest.installedArtifacts.map((file, index): [string, Buffer] => [`node_modules/replicad-opencascadejs/dist/${file.fileName}`, artifacts[index]]),
    ...notices.map((name): [string, string] => [`src/features/cad/kernel/notices/${name}`, `Complete license: ${name}`])
  ];
  for (const [name, contents] of files) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), contents); }
  const fetchSource: typeof fetch = async url => {
    const index = manifest.archives.findIndex(archive => archive.url === String(url));
    if (index < 0) throw new Error('Unexpected archive URL.');
    return new Response(new Uint8Array(sources[index]));
  };
  return { root, manifest, sources, fetchSource };
}
describe('CAD corresponding source distribution', () => {
  it('publishes all exact archives, notices and relink instructions and verifies them offline', async () => {
    const { root, manifest, sources, fetchSource } = await fixture();
    await distributeCadSources(root, fetchSource);
    await checkCadSourceDistribution(root);
    for (const [index, archive] of manifest.archives.entries()) expect(await readFile(path.join(root, 'dist/third-party/cad', archive.fileName))).toEqual(sources[index]);
    expect(await readFile(path.join(root, 'dist/third-party/cad/index.html'), 'utf8')).toContain('FreeType Project');
    await writeFile(path.join(root, 'dist/third-party/cad/replicad-MIT.txt'), 'changed');
    await expect(checkCadSourceDistribution(root)).rejects.toThrow('distribution text differs');
  });
  it('rejects modified installed artifacts before publishing source downloads', async () => {
    const { root, fetchSource } = await fixture();
    await writeFile(path.join(root, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm'), 'unpaired kernel');
    await expect(distributeCadSources(root, fetchSource)).rejects.toThrow('size mismatch');
    await expect(readdir(path.join(root, 'dist/third-party/cad'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects corrupt cached sources without replacing original bytes', async () => {
    const { root, manifest, sources, fetchSource } = await fixture();
    const cached = path.join(root, '.cache/third-party-sources', manifest.archives[0].fileName);
    await mkdir(path.dirname(cached), { recursive: true });
    const corrupt = Buffer.alloc(sources[0].byteLength, 1);
    await writeFile(cached, corrupt);
    await expect(distributeCadSources(root, fetchSource)).rejects.toThrow('SHA-256 mismatch');
    expect(await readFile(cached)).toEqual(corrupt);
    await expect(readdir(path.join(root, 'dist/third-party/cad'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
