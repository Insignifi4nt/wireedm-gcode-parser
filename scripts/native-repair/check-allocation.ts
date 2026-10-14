/** Isolated native-library acceptance probe; never replaces the installed pair.
 * npx tsx scripts/native-repair/check-allocation.ts <loader.js> <library.wasm>
 * Each case initializes a fresh native realm. Capacity is allocator reserve,
 * not a direct live-allocation count; no forced GC/manual free is used. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setOC } from 'replicad';
import type { OpenCascadeInstance, Standard_Transient } from 'replicad-opencascadejs';
import { buildCadKernelModel } from '../../src/features/cad/kernel/cadKernelModel';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '../../src/domain/cad/plugins/cadPlugins';
import type { CadDocument } from '../../src/domain/cad/cadDocument';

const [loaderPath, wasmPath] = process.argv.slice(2);
assert(loaderPath && wasmPath, 'Supply an explicit loader and WASM pair.');
const init = (await import(pathToFileURL(resolve(loaderPath)).href)).default as
  (options: { wasmBinary: Buffer; print(): void; printErr(): void }) => Promise<OpenCascadeInstance>;
const wasmBinary = await readFile(resolve(wasmPath));
const initialize = async () => {
  const oc = await init({ wasmBinary, print() {}, printErr() {} });
  setOC(oc); return oc;
};
const failures: string[] = [];
const mib = (bytes: number) => bytes / 1024 / 1024;
const selected = process.argv[4] ?? 'all';
assert(['all', 'borrowed', 'analyzer', 'arrays', 'gears'].includes(selected));
function cloneTransient(value: Standard_Transient, oc: OpenCascadeInstance): Standard_Transient {
  assert('clone' in value && typeof value.clone === 'function', 'Public native aliases are required.');
  const alias: unknown = value.clone();
  assert(alias instanceof oc.Standard_Transient, 'The public alias must preserve its native class.');
  return alias;
}

if (selected === 'all' || selected === 'borrowed') {
  const oc = await initialize();
  // A raw get()/This() points into a Handle-owned curve. Releasing it and
  // its public JS clone must not destroy the curve or its algorithm owner.
  const start = new oc.gp_Pnt2d(0, 0), end = new oc.gp_Pnt2d(10, 0);
  const segment = new oc.GC_MakeSegment2d(start, end);
  const handle = segment.Value();
  try {
    const borrowed = handle.This();
    const alias = cloneTransient(borrowed, oc);
    alias.delete(); borrowed.delete();
    const curve = handle;
    const transient = curve.This(), transientAlias = cloneTransient(transient, oc);
    transientAlias.delete(); transient.delete();
    const point = curve.Value(5);
    try { assert.deepEqual([point.X(), point.Y()], [5, 0]); }
    finally { point.delete(); }
    const again = segment.Value(), againPoint = again.Value(8);
    try { assert.equal(againPoint.X(), 8); }
    finally { againPoint.delete(); again.delete(); }
  } finally { handle.delete(); segment.delete(); end.delete(); start.delete(); }
  console.log(JSON.stringify({ case: 'borrowed-direct-downcast-clone', passed: true }));
}

if (selected === 'all' || selected === 'analyzer') {
  const oc = await initialize(), capacity: number[] = [];
  // No Init/Clear workaround: the actual analyzer destructor must release
  // its full geometric/topological result map and owning input reference.
  for (let index = 0; index < 4096; index++) {
    const builder = new oc.BRepPrimAPI_MakeBox(10, 10, 10), shape = builder.Shape();
    const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, false);
    try { assert.equal(analyzer.IsValid(), true); }
    finally { analyzer.delete(); shape.delete(); builder.delete(); }
    capacity.push(oc.wasmMemory.buffer.byteLength);
  }
  const growth = capacity.at(-1)! - capacity[1];
  console.log(JSON.stringify({ case: 'full-analyzer-4096', capacityMiB: [...new Set(capacity)].map(mib), growthMiB: mib(growth) }));
  if (growth > 20 * 1024 * 1024) failures.push('Full native analyzer/builder destructors do not reuse their warmed reserve.');
}

if (selected === 'all' || selected === 'arrays') {
  const oc = await initialize(), capacity: number[] = [];
  for (let index = 0; index < 128; index++) {
    const array = new oc.NCollection_Array1_gp_Pnt(1, 100_000);
    try { assert.equal(array.Length(), 100_000); } finally { array.delete(); }
    capacity.push(oc.wasmMemory.buffer.byteLength);
  }
  const growth = capacity.at(-1)! - capacity[1];
  console.log(JSON.stringify({ case: 'owned-array-128', capacityMiB: capacity.map(mib), growthMiB: mib(growth) }));
  if (growth > 20 * 1024 * 1024) failures.push('Owned-array destructors do not reuse their warmed reserve.');
}

if (selected === 'all' || selected === 'gears') {
  const oc = await initialize(), capacity: number[] = [], volumes: number[] = [];
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'repeat_gear', name: 'Repeated gear', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Gear', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'gear', name: 'Gear', construction: false, geometry: createCadPluginProfile(CAD_GEAR_V3_PLUGIN) }
    ] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
  ] };
  for (let index = 0; index < 32; index++) {
    const model = buildCadKernelModel(document);
    try {
      assert.deepEqual(model.result.diagnostics, []);
      volumes.push(model.result.meshes[0].volume);
      assert.equal(model.result.meshes[0].volume, 22493.43335045167);
    } finally { model.dispose(); }
    capacity.push(oc.wasmMemory.buffer.byteLength);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const growth = Math.max(...capacity.slice(4)) - capacity[3];
  console.log(JSON.stringify({ case: 'exact-default-gear-32', capacityMiB: capacity.map(mib), growthMiB: mib(growth), exactVolume: volumes[0] }));
  if (growth > 20 * 1024 * 1024) failures.push('Identical disposed gears keep expanding their warmed reserve.');
}
assert.deepEqual(failures, [], failures.join('\n'));
