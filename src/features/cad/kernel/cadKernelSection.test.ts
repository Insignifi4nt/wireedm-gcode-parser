// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { isShape3D, makeBox, makeCompound, measureVolume, setOC } from 'replicad';
import { sectionCadKernelShape } from './cadKernelSection';
import { cadKernelDisposeOwned, cadKernelIsValid } from './cadKernelShapes';
import { buildCadKernelModel } from './cadKernelModel';
import { isCadSectionResult } from '../../../domain/cad/cadSection';
import { cadEntitiesToCam } from '../../../domain/cad/cadCam';

beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)),
    print: () => undefined, printErr: () => undefined }));
}, 60_000);

it('rejects touching native section branches and retains the exact compound for another valid section', () => {
  const first = makeBox([0, 0, 0], [1, 1, 10]), second = makeBox([1, 1, 0], [2, 2, 10]), compound = makeCompound([first, second]);
  if (!isShape3D(compound)) throw new Error('Expected a solid compound.');
  try {
    expect(cadKernelIsValid(compound)).toBe(true); expect(measureVolume(compound)).toBeCloseTo(20, 8);
    expect(() => sectionCadKernelShape(compound, { bodyId: 'compound', plane: 'XY', offset: 5 })).toThrow(expect.objectContaining({ code: 'open-section' }));
    const section = sectionCadKernelShape(compound, { bodyId: 'compound', plane: 'XZ', offset: -.5 });
    expect(section.contourCount).toBe(1); expect(section.entities).toHaveLength(4);
    expect(cadKernelIsValid(compound)).toBe(true); expect(measureVolume(compound)).toBeCloseTo(20, 8);
  } finally { cadKernelDisposeOwned(compound); cadKernelDisposeOwned(first); cadKernelDisposeOwned(second); }
});

it('retains complete exact lines and bore arcs in a large accepted section without changing its source', () => {
  const count = 512, points = Array.from({ length: count }, (_, i): [number, number] => [100 * Math.cos(i * 2 * Math.PI / count), 100 * Math.sin(i * 2 * Math.PI / count)]);
  const document = { format: 'wireedm-cad' as const, schemaVersion: 1 as const, id: 'section_large', name: 'Section', units: 'mm' as const, parameters: {}, features: [
    { id: 'sketch', name: 'Exact polygon and bore', kind: 'sketch' as const, suppressed: false, plane: 'XY' as const, offset: 0, profiles: [
      { id: 'outer', name: 'Outer', construction: false, geometry: { kind: 'polygon' as const, points } },
      { id: 'bore', name: 'Bore', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 20 } }
    ] },
    { id: 'body', name: 'Ring', kind: 'extrude' as const, suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new' as const, targetId: null }
  ] };
  const original = JSON.stringify(document), model = buildCadKernelModel(document);
  try {
    expect(model.result.diagnostics).toEqual([]);
    const expectedVolume = (count / 2 * 100 ** 2 * Math.sin(2 * Math.PI / count) - Math.PI * 20 ** 2) * 10;
    expect(model.result.meshes[0].volume).toBeCloseTo(expectedVolume, 5);
    const section = model.section({ bodyId: 'body', plane: 'XY', offset: 5 });
    expect(isCadSectionResult(section)).toBe(true); expect(section.contourCount).toBe(2);
    expect(section.entities.filter(entity => entity.type === 'line')).toHaveLength(count);
    const arcs = section.entities.filter(entity => entity.type === 'arc'); expect(arcs).toHaveLength(2);
    expect(arcs.every(arc => Math.abs(arc.radius - 20) <= 1e-7)).toBe(true);
    expect(arcs.reduce((sum, arc) => sum + Math.abs(arc.sweepRadians!), 0)).toBeCloseTo(2 * Math.PI, 12);
    const cam = cadEntitiesToCam(section.entities);
    expect(cam.segments).toHaveLength(section.entities.length); expect(cam.contours.every(contour => contour.closed)).toBe(true);
    expect(() => model.section({ bodyId: 'body', plane: 'XY', offset: 0 })).toThrow('interior');
    expect(model.section({ bodyId: 'body', plane: 'XY', offset: 5 }).entities).toEqual(section.entities);
    expect(JSON.stringify(document)).toBe(original);
  } finally { model.dispose(); }
});
