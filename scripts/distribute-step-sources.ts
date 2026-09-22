import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface VerifiedFile { fileName: string; byteLength: number; sha256: string }
export interface SourceArchive extends VerifiedFile { url: string }
interface SourceManifest {
  format: string; schemaVersion: number; packageName: string; packageVersion: string; gitHead: string;
  submodule: { path: string; repository: string; commit: string };
  archives: SourceArchive[]; installedArtifacts: VerifiedFile[];
}
const manifestPath = 'docs/thirdparty/occt-import-js-sources.json';
const rebuildPath = 'docs/thirdparty/occt-import-js-rebuild.md';
const noticeDirectory = 'src/features/simulation/machine-import/notices';
const licenses = ['occt-import-js-LGPL-2.1.txt', 'OCCT-LGPL-2.1.txt', 'OCCT-LGPL-exception.txt'];
const maxArchiveBytes = 128 * 1024 * 1024;

function validateFile(file: VerifiedFile) {
  if (!/^[A-Za-z0-9._-]+$/.test(file.fileName) || file.fileName === '.' || file.fileName === '..'
    || !Number.isSafeInteger(file.byteLength) || file.byteLength <= 0 || file.byteLength > maxArchiveBytes
    || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid pinned third-party file manifest.');
}
function validateArchive(archive: SourceArchive) {
  validateFile(archive);
  if (!/^https:\/\/codeload\.github\.com\/(?:kovacsv\/occt-import-js|Open-Cascade-SAS\/OCCT)\/tar\.gz\/[a-f0-9]{40}$/.test(archive.url)) {
    throw new Error('Third-party archives must use a pinned official source URL.');
  }
}

/** No extraction or execution: distribution retains the exact reviewed upstream archive. */
export async function verifyPinnedFile(filePath: string, expected: VerifiedFile) {
  validateFile(expected);
  const metadata = await stat(filePath);
  if (!metadata.isFile() || metadata.size !== expected.byteLength) throw new Error(`Third-party size mismatch: ${filePath}`);
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk);
  if (digest.digest('hex') !== expected.sha256) throw new Error(`Third-party SHA-256 mismatch: ${filePath}`);
}

export async function obtainSourceArchive(cache: string, archive: SourceArchive, fetchSource: typeof fetch = fetch) {
  validateArchive(archive);
  await mkdir(cache, { recursive: true });
  const destination = path.join(cache, archive.fileName);
  try {
    await stat(destination);
    // Corrupt cache is an error, not an excuse to accept new upstream bytes.
    await verifyPinnedFile(destination, archive);
    return destination;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.partial-${randomUUID()}`;
  try {
    const response = await fetchSource(archive.url, { redirect: 'error', signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`Source download failed (${response.status}): ${archive.url}`);
    const advertisedSize = response.headers.get('content-length');
    if (advertisedSize !== null && Number(advertisedSize) !== archive.byteLength) {
      await response.body.cancel(); throw new Error(`Source download size differs from the pinned manifest: ${archive.fileName}`);
    }
    const file = await open(temporary, 'wx');
    let received = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.byteLength;
        if (received > archive.byteLength) throw new Error(`Source download exceeds its pinned byte limit: ${archive.fileName}`);
        await file.writeFile(chunk);
      }
    } finally { await file.close(); }
    await verifyPinnedFile(temporary, archive);
    await rename(temporary, destination);
    return destination;
  } finally {
    // Only this invocation's uniquely named incomplete download is removed.
    await rm(temporary, { force: true });
  }
}

async function loadManifest(root: string) {
  const text = await readFile(path.join(root, manifestPath), 'utf8');
  const manifest = JSON.parse(text) as SourceManifest;
  if (manifest.format !== 'wire-edm-third-party-sources' || manifest.schemaVersion !== 1 || manifest.packageName !== 'occt-import-js'
    || !/^\d+\.\d+\.\d+$/.test(manifest.packageVersion) || !/^[a-f0-9]{40}$/.test(manifest.gitHead)
    || manifest.submodule.path !== 'occt' || !/^[a-f0-9]{40}$/.test(manifest.submodule.commit)
    || manifest.archives.length !== 2 || manifest.installedArtifacts.length !== 2) throw new Error('Invalid STEP source distribution manifest.');
  manifest.archives.forEach(validateArchive); manifest.installedArtifacts.forEach(validateFile);
  if (manifest.archives[0].url !== `https://codeload.github.com/kovacsv/occt-import-js/tar.gz/${manifest.gitHead}`
    || manifest.archives[1].url !== `https://codeload.github.com/Open-Cascade-SAS/OCCT/tar.gz/${manifest.submodule.commit}`) {
    throw new Error('Source archives do not match the importer and submodule revisions.');
  }
  const installed = JSON.parse(await readFile(path.join(root, 'node_modules/occt-import-js/package.json'), 'utf8'));
  const app = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  if (installed.name !== manifest.packageName || installed.version !== manifest.packageVersion || app.dependencies['occt-import-js'] !== manifest.packageVersion) {
    throw new Error('Installed STEP importer differs from the pinned source distribution.');
  }
  for (const artifact of manifest.installedArtifacts) await verifyPinnedFile(path.join(root, 'node_modules/occt-import-js/dist', artifact.fileName), artifact);
  return { manifest, text };
}

function sourceIndex(manifest: SourceManifest) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>STEP importer source downloads</title>
<body><h1>STEP importer source downloads</h1><p>Unmodified corresponding library source and build scripts distributed alongside Wire EDM Workbench. Both archives are needed: the importer archive does not embed its OCCT submodule.</p>
<ul>${manifest.archives.map(file => `<li><a download href="${file.fileName}">${file.fileName}</a> (${file.byteLength} bytes)<br>SHA-256: <code>${file.sha256}</code></li>`).join('\n')}</ul>
<p><a href="REBUILD-occt-import-js.md">Rebuild and relink instructions</a> · <a href="occt-import-js-sources.json">Pinned source and binary manifest</a></p>
<ul>${licenses.map(file => `<li><a href="${file}">${file}</a></li>`).join('\n')}</ul>
<p>These downloads do not receive user STEP files. Libraries are provided without warranty; retain their licenses and notices when modifying or redistributing them.</p></body></html>\n`;
}

export async function distributeStepSources(root = process.cwd(), fetchSource: typeof fetch = fetch) {
  const { manifest, text } = await loadManifest(root);
  const destination = path.join(root, 'dist/third-party');
  const cache = path.join(root, '.cache/third-party-sources');
  const sources: string[] = [];
  // Validate all source inputs before publishing any source download in this build.
  for (const archive of manifest.archives) sources.push(await obtainSourceArchive(cache, archive, fetchSource));
  await mkdir(destination, { recursive: true });
  for (const [index, archive] of manifest.archives.entries()) await copyFile(sources[index], path.join(destination, archive.fileName));
  await writeFile(path.join(destination, 'occt-import-js-sources.json'), text);
  await copyFile(path.join(root, rebuildPath), path.join(destination, 'REBUILD-occt-import-js.md'));
  for (const license of licenses) await copyFile(path.join(root, noticeDirectory, license), path.join(destination, license));
  await writeFile(path.join(destination, 'index.html'), sourceIndex(manifest));
}

export async function checkStepSourceDistribution(root = process.cwd()) {
  const { manifest, text } = await loadManifest(root);
  const destination = path.join(root, 'dist/third-party');
  for (const archive of manifest.archives) await verifyPinnedFile(path.join(destination, archive.fileName), archive);
  const expectedText = new Map([
    ['occt-import-js-sources.json', text], ['index.html', sourceIndex(manifest)],
    ['REBUILD-occt-import-js.md', await readFile(path.join(root, rebuildPath), 'utf8')],
    ...await Promise.all(licenses.map(async license => [license, await readFile(path.join(root, noticeDirectory, license), 'utf8')] as const))
  ]);
  for (const [file, expected] of expectedText) if (await readFile(path.join(destination, file), 'utf8') !== expected) {
    throw new Error(`Third-party distribution text is missing or changed: ${file}`);
  }
  return manifest.archives.reduce((total, archive) => total + archive.byteLength, 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const checkOnly = process.argv.slice(2);
  if (checkOnly.length > 1 || checkOnly.length === 1 && checkOnly[0] !== '--check') throw new Error('Usage: distribute-step-sources.ts [--check]');
  if (!checkOnly.length) await distributeStepSources();
  const bytes = await checkStepSourceDistribution();
  console.log(`STEP corresponding source distribution verified: 2 archives, ${bytes} bytes, licenses and rebuild instructions.`);
}
