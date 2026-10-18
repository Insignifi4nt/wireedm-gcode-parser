// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import { createCadDocument, parseCadDocument } from '../../../domain/cad/cadSchema';
import { buildCadKernelModel } from './cadKernelModel';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

function plate(features: readonly object[] = []) {
  return parseCadDocument({ ...createCadDocument('Plate', 'validation_reuse'), features: [
    { id: 'outline', kind: 'sketch', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'square', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: -10, y: -10, width: 20, height: 20, cornerRadius: 0 } }] },
    { id: 'solid', kind: 'extrude', name: 'Solid', suppressed: false, sketchId: 'outline', distance: 10, symmetric: false, operation: 'new', targetId: null },
    ...features
  ] });
}

const bore = [
  { id: 'holes', kind: 'sketch', name: 'Holes', suppressed: false, plane: 'XY', offset: 10, profiles: [
    { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 4 } }] },
  { id: 'cut', kind: 'extrude', name: 'Cut', suppressed: false, sketchId: 'holes', distance: -10, symmetric: false, operation: 'cut', targetId: 'solid' }
];

/** Counts OpenCascade topology validity checks, the dominant validation cost. */
function countingValidity<T>(build: () => T): { value: T; checks: number } {
  const oc = getOC() as unknown as Record<string, unknown>;
  const Analyzer = oc.BRepCheck_Analyzer as new (...args: unknown[]) => object;
  let checks = 0;
  oc.BRepCheck_Analyzer = function (...args: unknown[]) { checks++; return new Analyzer(...args); };
  try { return { value: build(), checks }; }
  finally { oc.BRepCheck_Analyzer = Analyzer; }
}

it('checks each new or cut body topology once per shape, without changing measurements', () => {
  const single = countingValidity(() => buildCadKernelModel(plate()));
  const cut = countingValidity(() => buildCadKernelModel(plate(bore)));
  try {
    expect(single.value.result.diagnostics).toEqual([]);
    expect(single.value.result.meshes[0]).toMatchObject({ solidCount: 1, volume: expect.closeTo(4000, 9) });
    // The new body is checked once, not again before meshing.
    expect(single.checks).toBe(1);
    expect(cut.value.result.diagnostics).toEqual([]);
    expect(cut.value.result.meshes[0]).toMatchObject({ featureId: 'cut', solidCount: 1, volume: expect.closeTo(4000 - 160 * Math.PI, 6) });
    // Body, then cut tool, target, common material and result: each shape once.
    expect(cut.checks).toBe(5);
  } finally { single.value.dispose(); cut.value.dispose(); }
});
