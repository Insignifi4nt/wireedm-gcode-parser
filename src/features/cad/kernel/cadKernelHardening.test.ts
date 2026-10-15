// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import type { CadDocument, CadFeature, CadPlane, CadSketchFeature } from '../../../domain/cad/cadDocument';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import { prepareCadSolidImport } from './cadKernelImport';
import { buildCadKernelModel } from './cadKernelModel';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);
const base = (id: string) => ({ id, name: id, suppressed: false });
function rectangle(id: string, width: number): CadSketchFeature {
  return { ...base(id), kind: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: `${id}_outline`, name: 'Outline', construction: false,
    geometry: { kind: 'rectangle', x: 0, y: 0, width, height: 10, cornerRadius: 0 } }] };
}
const pad = (id: string, sketchId: string): CadFeature => ({ ...base(id), kind: 'extrude', sketchId, distance: 10, symmetric: false, operation: 'new', targetId: null });
function intersection(toolWidth: number): CadDocument {
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'material_audit', name: 'Material audit', units: 'mm', parameters: {}, features: [
    rectangle('seed_sketch', 10), pad('seed', 'seed_sketch'),
    { ...base('pattern'), kind: 'linear-pattern', sourceId: 'seed', count: 2, spacing: [20, 0, 0] },
    rectangle('tool_sketch', toolWidth), pad('tool', 'tool_sketch'),
    { ...base('common'), kind: 'boolean', operation: 'intersect', targetId: 'pattern', toolId: 'tool' }
  ] });
}

describe('native material integrity across dependent operations', () => {
  it('rebuilds a shelled, bored and patterned body from correlated dimensions and preserves every STEP solid', async () => {
    const features: readonly CadFeature[] = [rectangle('stock_sketch', 10), pad('stock', 'stock_sketch'),
      { ...base('shell'), kind: 'shell', targetId: 'stock', thickness: 'wall', opening: { kind: 'faces', expectedCount: 1,
        predicates: [{ kind: 'plane', normal: [0, 0, 1], offset: 10 }] } },
      { ...base('bore_sketch'), kind: 'sketch', plane: 'YZ', offset: -1, profiles: [{ id: 'bore', name: 'Side bore', construction: false,
        geometry: { kind: 'circle', x: 5, y: 5, radius: 'bore_radius' } }] },
      { ...base('bored'), kind: 'pocket', sketchId: 'bore_sketch', targetId: 'shell', extent: { kind: 'through-all', direction: 'both' } },
      { ...base('copies'), kind: 'linear-pattern', sourceId: 'bored', count: 3, spacing: [20, 0, 0] }
    ];
    const original = JSON.stringify(features);
    for (const [wall, radius] of [[1, .5], [2, .4]]) {
      const document = parseCadDocument({ ...intersection(19), parameters: { wall, bore_radius: radius }, features });
      const model = buildCadKernelModel(document);
      try {
        const expected = 3 * (1000 - (10 - 2 * wall) ** 2 * (10 - wall) - 2 * wall * Math.PI * radius ** 2);
        expect(model.result.diagnostics).toEqual([]);
        expect(model.result.meshes.map(mesh => mesh.featureId)).toEqual(['copies']);
        expect(model.result.meshes[0].volume).toBeCloseTo(expected, 6);
        expect(model.result.meshes[0].bounds.max[0]).toBeCloseTo(50, 6);
        // The side bore opens both walls, splitting each midheight ring into two U sections.
        const section = model.section({ bodyId: 'copies', plane: 'XY', offset: 5 });
        expect(section.contourCount).toBe(6);
        expect(section.entities.every(entity => entity.type === 'line')).toBe(true);
        const imported = prepareCadSolidImport({ format: 'step', encoding: 'utf8', fileName: 'brackets.step', data: await model.export('step').text() });
        expect(imported.solidCount).toBe(3);
        expect(imported.volume).toBeCloseTo(expected, 6);
      } finally { model.dispose(); }
    }
    expect(JSON.stringify(features)).toBe(original);
  });
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('preserves nested material during partial Revolve on offset %s and its equatorial section', plane => {
    for (const angle of [90, 135, 270]) {
      const source: CadSketchFeature = { ...base('source'), kind: 'sketch', plane, offset: 7, profiles: [
        { id: 'outer', name: 'Outer', construction: false, geometry: { kind: 'rectangle', x: 5, y: 0, width: 5, height: 4, cornerRadius: 0 } },
        { id: 'void', name: 'Void', construction: false, geometry: { kind: 'circle', x: 7.5, y: 2, radius: .5 } }
      ] };
      const document = parseCadDocument({ ...intersection(19), features: [source,
        { ...base('revolved'), kind: 'revolve', sketchId: 'source', axis: 'y', angle, operation: 'new', targetId: null }
      ] });
      const model = buildCadKernelModel(document);
      try {
        expect(model.result.diagnostics).toEqual([]);
        // Annular rectangle minus a toroidal void: Pappus, then angular fraction.
        expect(model.result.meshes[0].volume).toBeCloseTo((300 * Math.PI - 3.75 * Math.PI ** 2) * Math.abs(angle) / 360, 6);
        const section = model.section({ bodyId: 'revolved', plane: plane === 'XY' ? 'XZ' : 'XY', offset: plane === 'XY' ? -2 : 2 });
        expect(section.contourCount).toBe(2);
        const radii = section.entities.flatMap(entity => entity.type === 'arc' || entity.type === 'circle' ? [entity.radius] : []);
        for (const radius of [5, 7, 8, 10]) expect(radii.some(actual => Math.abs(actual - radius) < 1e-8)).toBe(true);
      } finally { model.dispose(); }
    }
  });
  it('exports only positive solid material when another patterned instance merely contacts the cutter', () => {
    // The tool contains the first cube and only touches the second cube at x=20.
    const model = buildCadKernelModel(intersection(20));
    try {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes.map(mesh => mesh.featureId)).toEqual(['common']);
      expect(model.result.meshes[0].volume).toBeCloseTo(1000, 7);
      model.result.meshes[0].bounds.max.forEach(coordinate => expect(coordinate).toBeCloseTo(10, 6));
      expect(model.section({ bodyId: 'common', plane: 'XY', offset: 5 }).entities).toHaveLength(4);
    } finally { model.dispose(); }
  });
  it('keeps a disconnected target intersection with strictly solid material and removes the other instance', () => {
    const model = buildCadKernelModel(intersection(19));
    try {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes).toHaveLength(1);
      expect(model.result.meshes[0].featureId).toBe('common');
      expect(model.result.meshes[0].volume).toBeCloseTo(1000, 7);
      model.result.meshes[0].bounds.max.forEach(coordinate => expect(coordinate).toBeCloseTo(10, 6));
      const section = model.section({ bodyId: 'common', plane: 'XY', offset: 5 });
      expect(section.contourCount).toBe(1);
      expect(section.entities).toHaveLength(4);
    } finally { model.dispose(); }
  });
});
