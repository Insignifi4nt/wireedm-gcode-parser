// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import { buildCadKernelModel } from './cadKernelModel';
import { CAD_GEAR_V3_PLUGIN, createCadPluginProfile } from '../../../domain/cad/plugins/cadPlugins';
import type { CadDocument } from '../../../domain/cad/cadDocument';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

it('reuses the native allocation high-water reserve across repeatedly validated and disposed default gears', async () => {
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'memory_gear', name: 'Memory gear', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Gear', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'profile', name: 'Gear', construction: false, geometry: createCadPluginProfile(CAD_GEAR_V3_PLUGIN) }
    ] },
    { id: 'solid', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
  ] };
  const capacities: number[] = [], volumes: number[] = [];
  for (let i = 0; i < 32; i++) {
    const model = buildCadKernelModel(document);
    try { expect(model.result.diagnostics).toEqual([]); volumes.push(model.result.meshes[0].volume); }
    finally { model.dispose(); }
    capacities.push(getOC().wasmMemory.buffer.byteLength);
    // Let ordinary wrapper finalizers run; correctness must not require forced GC.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  expect(volumes.every(volume => volume === volumes[0])).toBe(true);
  // OCCT/Emscripten retain a high-water reserve. Reusing identical allocations
  // after four warm builds must not keep expanding it with each validation.
  // The old destructor bug passed eight builds but grew another145MiB by32.
  expect(Math.max(...capacities.slice(4))).toBeLessThanOrEqual(capacities[3] + 20 * 1024 * 1024);
// Thirty-two complete builds include the rare hash-collision iteration and
// exceed the former sixteen-build time allowance on this host.
}, 120_000);

it('destroys owned large native containers and full validation graphs without resets or forced garbage collection', async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  for (const kind of ['arrays', 'analyzers'] as const) {
    const oc = await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined });
    const capacities: number[] = [];
    for (let index = 0; index < (kind === 'arrays' ? 128 : 4096); index++) {
      if (kind === 'arrays') {
        const points = new oc.NCollection_Array1_gp_Pnt(1, 100_000);
        try { expect(points.Length()).toBe(100_000); } finally { points.delete(); }
      } else {
        const builder = new oc.BRepPrimAPI_MakeBox(10, 10, 10), shape = builder.Shape();
        const analyzer = new oc.BRepCheck_Analyzer(shape, true, false, false);
        try { expect(analyzer.IsValid()).toBe(true); }
        finally { analyzer.delete(); shape.delete(); builder.delete(); }
      }
      capacities.push(oc.wasmMemory.buffer.byteLength);
    }
    expect(capacities.at(-1)! - capacities[1]).toBeLessThanOrEqual(20 * 1024 * 1024);
  }
}, 60_000);
