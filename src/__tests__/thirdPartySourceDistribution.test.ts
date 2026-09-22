import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkStepSourceDistribution, distributeStepSources, obtainSourceArchive, type SourceArchive
} from '../../scripts/distribute-step-sources';
import sourceManifest from '../../docs/thirdparty/occt-import-js-sources.json';
import { MACHINE_IMPORT_THIRD_PARTY } from '../features/simulation/machine-import/thirdPartyNotices';

const temporaryRoots: string[] = [];
const temporaryPrefix = path.join(os.tmpdir(), 'wire-edm-third-party-');
const payloads = [Buffer.from('complete importer source fixture'), Buffer.from('complete OCCT source fixture')];
const metadata = (fileName: string, bytes: Buffer) => ({
  fileName, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex')
});
async function temporaryRoot() {
  const root = await mkdtemp(temporaryPrefix);
  temporaryRoots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const absolute = path.resolve(root);
    if (!absolute.startsWith(path.resolve(temporaryPrefix)) || path.dirname(absolute) !== path.resolve(os.tmpdir())) {
      throw new Error('Refusing to remove a directory outside the test temporary prefix.');
    }
    await rm(absolute, { recursive: true, force: true });
  }
});
const archive = (bytes = payloads[0]): SourceArchive => ({
  ...sourceManifest.archives[0], ...metadata(sourceManifest.archives[0].fileName, bytes)
});
const respond = (bytes: Buffer, advertiseLength = true) => new Response(new Uint8Array(bytes), {
  headers: advertiseLength ? { 'content-length': String(bytes.byteLength) } : undefined
});
async function fixture() {
  const root = await temporaryRoot();
  const manifest = structuredClone(sourceManifest);
  manifest.archives = manifest.archives.map((entry, index) => ({ ...entry, ...metadata(entry.fileName, payloads[index]) }));
  const binaries = [Buffer.from('paired JavaScript fixture'), Buffer.from('paired WASM fixture')];
  manifest.installedArtifacts = manifest.installedArtifacts.map((entry, index) => metadata(entry.fileName, binaries[index]));
  const files: Array<[string, string | Buffer]> = [
    ['package.json', JSON.stringify({ dependencies: { 'occt-import-js': manifest.packageVersion } })],
    ['node_modules/occt-import-js/package.json', JSON.stringify({ name: manifest.packageName, version: manifest.packageVersion })],
    ['docs/thirdparty/occt-import-js-sources.json', JSON.stringify(manifest)],
    ['docs/thirdparty/occt-import-js-rebuild.md', 'Complete fixture rebuild instructions.'],
    ...manifest.installedArtifacts.map((entry, index): [string, Buffer] => [`node_modules/occt-import-js/dist/${entry.fileName}`, binaries[index]]),
    ...['occt-import-js-LGPL-2.1.txt', 'OCCT-LGPL-2.1.txt', 'OCCT-LGPL-exception.txt'].map((name): [string, string] => [`src/features/simulation/machine-import/notices/${name}`, `Complete notice: ${name}`])
  ];
  for (const [name, contents] of files) {
    const destination = path.join(root, name);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents);
  }
  const download = vi.fn<typeof fetch>(async input => {
    const index = manifest.archives.findIndex(entry => entry.url === String(input));
    if (index < 0) throw new Error(`Unexpected source URL: ${String(input)}`);
    return respond(payloads[index]);
  });
  return { root, manifest, download };
}

describe('pinned STEP corresponding source downloads', () => {
  it('copies exact downloaded bytes, verifies cached content and works offline after the first build', async () => {
    const cache = await temporaryRoot();
    const download = vi.fn<typeof fetch>().mockResolvedValue(respond(payloads[0]));
    const destination = await obtainSourceArchive(cache, archive(), download);
    expect(await readFile(destination)).toEqual(payloads[0]);
    expect(download).toHaveBeenCalledWith(archive().url, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
    const offline = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    expect(await obtainSourceArchive(cache, archive(), offline)).toBe(destination);
    expect(offline).not.toHaveBeenCalled();
    expect(await readdir(cache)).toEqual([archive().fileName]);
  });

  it('retains corrupt cache bytes for diagnosis and refuses an automatic replacement download', async () => {
    const cache = await temporaryRoot();
    const damaged = Buffer.alloc(payloads[0].byteLength, 88);
    await writeFile(path.join(cache, archive().fileName), damaged);
    const download = vi.fn<typeof fetch>();
    await expect(obtainSourceArchive(cache, archive(), download)).rejects.toThrow('SHA-256 mismatch');
    expect(await readFile(path.join(cache, archive().fileName))).toEqual(damaged);
    expect(download).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong digest', () => respond(Buffer.alloc(payloads[0].byteLength, 88)), 'SHA-256 mismatch'],
    ['oversized stream without Content-Length', () => respond(Buffer.concat([payloads[0], Buffer.from('!')]), false), 'exceeds its pinned byte limit'],
    ['truncated stream without Content-Length', () => respond(payloads[0].subarray(1), false), 'size mismatch'],
    ['unexpected Content-Length', () => respond(Buffer.from('short')), 'differs from the pinned manifest'],
    ['unavailable upstream', () => new Response(null, { status: 503 }), 'Source download failed (503)']
  ])('fails closed for %s and removes only its incomplete download', async (_name, response, expected) => {
    const cache = await temporaryRoot();
    await writeFile(path.join(cache, 'unrelated.partial'), 'preserve this file');
    const download = vi.fn<typeof fetch>().mockResolvedValue(response());
    await expect(obtainSourceArchive(cache, archive(), download)).rejects.toThrow(expected);
    expect(await readdir(cache)).toEqual(['unrelated.partial']);
  });
});

describe('STEP source distribution build gate', () => {
  it('distributes and checks both complete archives, exact licenses and instructions with working UI download links', async () => {
    const { root, manifest, download } = await fixture();
    await distributeStepSources(root, download);
    expect(download).toHaveBeenCalledTimes(2);
    expect(await checkStepSourceDistribution(root)).toBe(payloads[0].byteLength + payloads[1].byteLength);
    for (const [index, entry] of manifest.archives.entries()) {
      expect(await readFile(path.join(root, 'dist/third-party', entry.fileName))).toEqual(payloads[index]);
      expect(MACHINE_IMPORT_THIRD_PARTY.links.some(link => link.href === `${import.meta.env.BASE_URL}third-party/${entry.fileName}`)).toBe(true);
    }
    await writeFile(path.join(root, 'dist/third-party/OCCT-LGPL-exception.txt'), 'changed notice');
    await expect(checkStepSourceDistribution(root)).rejects.toThrow('missing or changed: OCCT-LGPL-exception.txt');
  });

  it('rejects a corrupt published archive even when its byte length is unchanged', async () => {
    const { root, manifest, download } = await fixture();
    await distributeStepSources(root, download);
    await writeFile(path.join(root, 'dist/third-party', manifest.archives[1].fileName), Buffer.alloc(payloads[1].byteLength));
    await expect(checkStepSourceDistribution(root)).rejects.toThrow('SHA-256 mismatch');
  });

  it('refuses to publish any sources if either required archive cannot be obtained', async () => {
    const { root, download } = await fixture();
    download.mockResolvedValueOnce(respond(payloads[0])).mockRejectedValueOnce(new Error('offline'));
    await expect(distributeStepSources(root, download)).rejects.toThrow('offline');
    await expect(readdir(path.join(root, 'dist/third-party'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('blocks an unrecorded replacement library before downloads or distribution writes', async () => {
    const { root, download } = await fixture();
    await writeFile(path.join(root, 'node_modules/occt-import-js/dist/occt-import-js.wasm'), 'unrecorded rebuild');
    await expect(distributeStepSources(root, download)).rejects.toThrow('size mismatch');
    expect(download).not.toHaveBeenCalled();
    await expect(readdir(path.join(root, 'dist/third-party'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
