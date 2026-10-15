/** Stage/fingerprint a compatible single-thread-only local npm distribution.
 * node scripts/native-repair/package-candidate.mjs stage|finish
 * npm pack ./tmp/cad-native-repair/package2 --pack-destination ./vendor/cad-kernel
 * Build the source recipe archive and copy the verified source patch before finish.
 */
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const candidate = path.join(root, 'tmp/cad-native-repair/candidate2');
const staged = path.join(root, 'tmp/cad-native-repair/package2');
const vendor = path.join(root, 'vendor/cad-kernel');
const artifactNames = ['replicad-opencascadejs-1.1.0-wireedm.2.tgz',
  'replicad-ownership-backport.patch', 'replicad-indexed-topology.patch', 'replicad-ownership-rebuild.tar.gz'];
const fingerprint = async (directory, fileName) => {
  const bytes = await readFile(path.join(directory, fileName));
  return { fileName, byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
};
const hashes = { 'replicad_single.js': '5ba5161518781c04af771ae4e841956613dde4e679766ddaaeb581b778e1a8be',
  'replicad_single.wasm': 'f3315403717f650c207eccd2f372afc380005b4f219bad31991d6f115fdc1744',
  'replicad_single.d.ts': '28ae81bd478d13e1abb3a1f2c908666250c670d7c2aac2cc2a70f4ab5e951fcd' };
for (const [name, sha256] of Object.entries(hashes)) assert.equal((await fingerprint(candidate, name)).sha256, sha256);

if (process.argv[2] === 'stage') {
  const original = path.join(root, 'node_modules/replicad-opencascadejs');
  const manifest = JSON.parse(await readFile(path.join(original, 'package.json'), 'utf8'));
  assert(['1.1.0', '1.1.0-wireedm.1', '1.1.0-wireedm.2'].includes(manifest.version));
  assert.equal(manifest.gitHead, 'e4b05f67dc4e2393a876ce8c5064a9c93db05bf1');
  await mkdir(path.join(staged, 'dist'), { recursive: true });
  await mkdir(vendor, { recursive: true });
  for (const name of Object.keys(hashes)) await copyFile(path.join(candidate, name), path.join(staged, 'dist', name));
  // Upstream CJS is only a dynamic import adapter, so it safely loads the paired
  // repaired ESM factory rather than embedding another native ownership policy.
  await copyFile(path.join(original, 'dist', 'replicad_single.cjs'), path.join(staged, 'dist', 'replicad_single.cjs'));
  await copyFile(path.join(original, 'LICENSE'), path.join(staged, 'LICENSE'));
  const packageManifest = { ...manifest, version: '1.1.0-wireedm.2',
    description: 'Replicad compatible single-thread CAD binding with native ownership repair and exact topology extractors',
    exports: { '.': manifest.exports['.'], './wasm': manifest.exports['./wasm'], './package.json': manifest.exports['./package.json'] },
    files: ['dist/replicad_single.js', 'dist/replicad_single.wasm', 'dist/replicad_single.d.ts', 'dist/replicad_single.cjs', 'LICENSE', 'README.md'],
    wireedmNativeRepair: { upstreamCommit: '193f3339893c909abdd5e62a6f1dc6742369fa30',
      bindingGeneratorCommit: 'ebd263f15337b440b391492af073662707e86482', variant: 'single-threaded', topologyIdentity: 'indexed-map' } };
  delete packageManifest.scripts;
  delete packageManifest.devDependencies;
  await writeFile(path.join(staged, 'package.json'), JSON.stringify(packageManifest, null, 2) + '\n');
  await writeFile(path.join(staged, 'README.md'), '# Replicad single-thread native repair\n\nCompatible default ESM/CJS factory and single-thread WASM/types from Replicad1.1.0, with the coupled native destructor/borrowed-pointer repair backported to the original Emscripten5.0.1/OCCT8.0.1 toolchain. Both mesh extractors add `extractWithTopologyIndices`, whose group IDs use exact OCCT indexed-map identity. The original hash-based extractor methods and geometry/sampling are unchanged. The required NCollection_BaseMap base is also bound so the existing indexed map can be constructed. Only the single-thread variant is distributed: `./multi` and `./multi/wasm` are unavailable. Exact corresponding source archives, ownership and indexed-topology patches, build recipe and hashes accompany the Wire EDM app. Original LGPL notices and OCCT exception remain applicable.\n');
  console.log('Compatible single-thread local package staged.');
} else if (process.argv[2] === 'finish') {
  const build = { format: 'wireedm-cad-native-ownership-build', schemaVersion: 1,
    packageName: 'replicad-opencascadejs', packageVersion: '1.1.0-wireedm.2',
    upstreamOwnershipCommit: '193f3339893c909abdd5e62a6f1dc6742369fa30',
    bindingGeneratorCommit: 'ebd263f15337b440b391492af073662707e86482',
    replicadCommit: 'e4b05f67dc4e2393a876ce8c5064a9c93db05bf1',
    occtCommit: 'b8f597c677811d1f9f4d8a97f5ae2825c0353a42',
    toolchainImage: 'ghcr.io/taucad/opencascade.js@sha256:215198af0e2ca4c5f308e5540869f2419784dc290062d3eb03d34e4f22e0188c',
    emscriptenVersion: '5.0.1', variant: 'single-threaded', topologyIdentity: 'indexed-map',
    publicSurfaceAdditions: ['ReplicadMeshExtractor.extractWithTopologyIndices',
      'ReplicadEdgeMeshExtractor.extractWithTopologyIndices', 'NCollection_BaseMap'],
    repairedArtifacts: await Promise.all(Object.keys(hashes).map(name => fingerprint(candidate, name))),
    originalArtifacts: await Promise.all(['replicad_single.js', 'replicad_single.wasm'].map(name => fingerprint(path.join(root, 'tmp/cad-native-repair/originals'), name))),
    sourceFilesModified: ['src/ocjs_bindgen/codegen/embind/class_.py', 'src/ocjs_bindgen/embind_builtins.py',
      'src/patches/libembind-overloading.patch', 'src/patches/libembind-overloading.expected.sha256',
      'packages/replicad-opencascadejs/build-config/wrappers/mesh-extractor.cpp',
      'packages/replicad-opencascadejs/build-config/wrappers/edge-mesh-extractor.cpp',
      'packages/replicad-opencascadejs/build-config/custom_build_single.yml'],
    artifacts: await Promise.all(artifactNames.map(name => fingerprint(vendor, name))),
    acceptance: { nativeFixtures: { files: 27, tests: 275 }, borrowedCloneOwnerSurvival: true,
      indexedTopology: { legacyGeometryBuffersUnchanged: true, forcedHashCollisionAllFaceAndEdgePicks: true,
        constructorFailureOwnersReleased: true },
      mixedEditExportLifecycle: { sequences: 24, retainedBuildSnapshots: true, unchangedSections: true,
        repairedReserveMiB: 100, repairedReserveGrowthMiB: 0, cachedExportsAndGrowShrink: true },
      stepOwnedHandlesReleased: true,
      nativeAnalyzerBuilders: { repeats: 4096, originalReserveGrowthMiB: 312.875, repairedReserveGrowthMiB: 0 },
      nativeArrays: { repeats: 128, points: 100000, originalReserveGrowthMiB: 494.625, repairedReserveGrowthMiB: 0 },
      defaultGears: { repeats: 32, tolerance: 0.005, exactVolume: 22493.43335045167,
        originalWarmReserveGrowthMiB: 145, repairedReserveMiB: 163.0625, repairedReserveGrowthMiB: 0 },
      precisionUnchanged: true, forcedGc: false, manualAllocatorFree: false } };
  await writeFile(path.join(vendor, 'replicad-ownership-build.json'), JSON.stringify(build, null, 2) + '\n');
  console.log(JSON.stringify(await Promise.all([...artifactNames, 'replicad-ownership-build.json'].map(name => fingerprint(vendor, name))), null, 2));
} else throw new Error('Expected stage or finish.');
