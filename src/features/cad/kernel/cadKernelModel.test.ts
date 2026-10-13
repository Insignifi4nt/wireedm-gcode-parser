// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { setOC } from 'replicad';
import { buildCadKernelModel } from './cadKernelModel';
import type { CadDocument, CadFeature, CadProfile, CadSketchFeature } from '../../../domain/cad/cadDocument';
import { cadEntitiesToCam } from '../../../domain/cad/cadCam';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);
const base = (id: string) => ({ id, name: id, suppressed: false });
const sketch = (id: string, geometry: CadProfile, plane: CadSketchFeature['plane'] = 'XY'): CadSketchFeature => ({ ...base(id), kind: 'sketch', plane, offset: 0,
  profiles: [{ id: `${id}_profile`, name: id, construction: false, role: 'outer', geometry }] });
const rectangle: CadProfile = { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 };
const extrude = (id: string, sketchId: string, distance = 5): CadFeature => ({ ...base(id), kind: 'extrude', sketchId, distance, symmetric: false, operation: 'new', targetId: null });
const doc = (features: readonly CadFeature[]): CadDocument => ({ format: 'wireedm-cad', schemaVersion: 1, id: 'test', name: 'Test', units: 'mm', parameters: {}, features });
function built(features: readonly CadFeature[], check: (model: ReturnType<typeof buildCadKernelModel>) => void) {
  const model = buildCadKernelModel(doc(features));
  try { check(model); } finally { model.dispose(); model.dispose(); }
}

describe('real OpenCascade CAD kernel', () => {
  it('creates an exact box, stable tessellation and binary STL / named STEP', async () => {
    const model = buildCadKernelModel(doc([sketch('sketch', rectangle), extrude('box', 'sketch')]));
    try {
      expect(model.result.diagnostics).toEqual([]);
      const mesh = model.result.meshes[0];
      expect(mesh.volume).toBeCloseTo(1000, 6);
      expect(mesh.bounds.min[0]).toBeCloseTo(0, 5);
      expect(mesh.bounds.max[0]).toBeCloseTo(20, 5);
      expect(mesh.bounds.max[2]).toBeCloseTo(5, 5);
      expect(mesh.positions.length).toBe(mesh.normals.length);
      expect(mesh.indices.length).toBeGreaterThan(0);
      expect(mesh.edges.length).toBeGreaterThan(0);
      expect(mesh.indices.every(index => Number.isInteger(index) && index >= 0 && index < mesh.positions.length / 3)).toBe(true);
      const step = await model.export('step').text();
      expect(step).toContain('ISO-10303-21');
      expect(step).toContain('MANIFOLD_SOLID_BREP');
      expect(step).toContain('box');
      const stl = await model.export('stl').arrayBuffer();
      const triangles = new DataView(stl).getUint32(80, true);
      expect(triangles).toBeGreaterThan(0);
      expect(stl.byteLength).toBe(84 + 50 * triangles);
    } finally { model.dispose(); }
  });

  it('retains exact circular holes and nested material islands', () => {
    const holed: CadSketchFeature = { ...sketch('sketch', rectangle), profiles: [
      ...sketch('sketch', rectangle).profiles,
      { id: 'hole', name: 'hole', construction: false, role: 'hole', geometry: { kind: 'circle', x: 10, y: 5, radius: 3 } },
      { id: 'island', name: 'island', construction: false, role: 'outer', geometry: { kind: 'circle', x: 10, y: 5, radius: 1 } }
    ] };
    built([holed, extrude('body', 'sketch')], model => {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes[0].volume).toBeCloseTo((200 - 8 * Math.PI) * 5, 5);
    });
  });

  it.each(['XY', 'XZ', 'YZ'] satisfies CadSketchFeature['plane'][])('uses consistent axes and symmetric extrusion on %s', plane => {
    built([sketch('sketch', rectangle, plane), { ...base('body'), kind: 'extrude', sketchId: 'sketch', distance: 6, symmetric: true, operation: 'new', targetId: null }], model => {
      expect(model.result.diagnostics).toEqual([]);
      const mesh = model.result.meshes[0];
      expect(mesh.volume).toBeCloseTo(1200, 6);
      const normal = plane === 'XY' ? 2 : plane === 'XZ' ? 1 : 0;
      expect(mesh.bounds.min[normal]).toBeCloseTo(-3, 5);
      expect(mesh.bounds.max[normal]).toBeCloseTo(3, 5);
    });
  });

  it('performs actual union, subtraction and intersection on independent solids', () => {
    for (const [operation, expected] of [['union', 1500], ['cut', 500], ['intersect', 500]] satisfies [Extract<CadFeature, { kind: 'boolean' }>['operation'], number][]) {
      built([sketch('a', rectangle), extrude('box_a', 'a'), sketch('b', { ...rectangle, x: 10 }), extrude('box_b', 'b'),
        { ...base('boolean'), kind: 'boolean', operation, targetId: 'box_a', toolId: 'box_b' }], model => {
        expect(model.result.diagnostics).toEqual([]);
        expect(model.result.meshes).toHaveLength(1);
        expect(model.result.meshes[0].volume).toBeCloseTo(expected, 5);
      });
    }
  });

  it('revolves an offset rectangle around the sketch y axis into a hollow cylinder', () => {
    built([sketch('sketch', { ...rectangle, x: 5, width: 5, height: 10 }), { ...base('revolved'), kind: 'revolve', sketchId: 'sketch', angle: 360, axis: 'y', operation: 'new', targetId: null }], model => {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes[0].volume).toBeCloseTo(Math.PI * (100 - 25) * 10, 4);
    });
  });

  it('creates analytic rounded rectangles, polygons and rotated capsule slots', () => {
    const profiles: [CadProfile, number][] = [
      [{ ...rectangle, cornerRadius: 2 }, (200 - (4 - Math.PI) * 4) * 5],
      [{ ...rectangle, cornerRadius: 5 }, (100 + 25 * Math.PI) * 5],
      [{ ...rectangle, width: 10, cornerRadius: 5 }, 125 * Math.PI],
      [{ kind: 'polygon', points: [[0, 0], [10, 0], [0, 10]] }, 250],
      [{ kind: 'slot', x: 0, y: 0, length: 20, width: 6, angle: 35 }, (14 * 6 + 9 * Math.PI) * 5]
    ];
    for (const [profile, expected] of profiles) built([sketch('sketch', profile), extrude('body', 'sketch')], model => {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes[0].volume).toBeCloseTo(expected, 5);
    });
  });

  it('transforms, mirrors and patterns exact solids', () => {
    built([sketch('sketch', rectangle), extrude('body', 'sketch'),
      { ...base('moved'), kind: 'transform', sourceId: 'body', translation: [30, 0, 0], rotation: [0, 0, 90] },
      { ...base('mirror'), kind: 'mirror', sourceId: 'moved', plane: 'YZ' },
      { ...base('pattern'), kind: 'linear-pattern', sourceId: 'moved', count: 3, spacing: [0, 30, 0] }], model => {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes).toHaveLength(2);
      expect(model.result.meshes.find(mesh => mesh.featureId === 'pattern')?.volume).toBeCloseTo(3000, 5);
      expect(model.result.meshes.find(mesh => mesh.featureId === 'mirror')?.bounds.max[0]).toBeCloseTo(-20, 5);
    });
  });

  it('fillets and chamfers all edges, and preserves valid geometry on an impossible fillet', () => {
    for (const kind of ['fillet', 'chamfer'] satisfies ('fillet' | 'chamfer')[]) {
      built([sketch('sketch', rectangle), extrude('body', 'sketch'), { ...base('rounded'), kind, targetId: 'body', radius: 1 }], model => {
        expect(model.result.diagnostics).toEqual([]);
        expect(model.result.meshes[0].volume).toBeLessThan(1000);
        expect(model.result.meshes[0].volume).toBeGreaterThan(500);
      });
    }
    built([sketch('sketch', rectangle), extrude('body', 'sketch'), { ...base('failed'), kind: 'fillet', targetId: 'body', radius: 100 }], model => {
      expect(model.result.diagnostics[0].featureId).toBe('failed');
      expect(model.result.meshes[0].featureId).toBe('body');
      expect(model.result.meshes[0].volume).toBeCloseTo(1000, 5);
      expect(() => model.export('step')).toThrow('Fix the feature diagnostics');
    });
  });

  it('rejects consumed and suppressed body references without corrupting the current body', () => {
    built([sketch('sketch', rectangle), extrude('body', 'sketch'),
      { ...base('moved'), kind: 'transform', sourceId: 'body', translation: [1, 0, 0], rotation: [0, 0, 0] },
      { ...base('invalid'), kind: 'fillet', targetId: 'body', radius: 1 }], model => {
      expect(model.result.diagnostics[0].code).toBe('missing-body');
      expect(model.result.meshes.map(mesh => mesh.featureId)).toEqual(['moved']);
      expect(model.result.meshes[0].volume).toBeCloseTo(1000, 5);
    });
    built([sketch('sketch', rectangle), { ...extrude('body', 'sketch'), suppressed: true },
      { ...base('invalid'), kind: 'mirror', sourceId: 'body', plane: 'XY' }], model => {
      expect(model.result.diagnostics[0].code).toBe('missing-body');
      expect(model.result.meshes).toEqual([]);
    });
  });

  it('bounds amplified nested patterns before constructing the oversized operation', () => {
    built([sketch('sketch', rectangle), extrude('body', 'sketch'),
      { ...base('first'), kind: 'linear-pattern', sourceId: 'body', count: 10, spacing: [1, 0, 0] },
      { ...base('second'), kind: 'linear-pattern', sourceId: 'first', count: 100, spacing: [1, 0, 0] },
      { ...base('too-many'), kind: 'linear-pattern', sourceId: 'second', count: 2, spacing: [0, 0, 30] }], model => {
      expect(model.result.diagnostics[0].code).toBe('instance-limit');
      expect(model.result.meshes[0].featureId).toBe('second');
      expect(model.result.meshes[0].volume).toBeCloseTo(6400, 4);
    });
  }, 60_000);

  it.each(['XY', 'XZ', 'YZ'] satisfies CadSketchFeature['plane'][])('extracts exact interior sections in plane-local millimetres on %s', plane => {
    built([sketch('sketch', rectangle, plane), extrude('body', 'sketch')], model => {
      const section = model.section({ bodyId: 'body', plane, offset: 2.5 });
      expect(section.entities).toHaveLength(4);
      expect(section.entities.every(entity => entity.type === 'line')).toBe(true);
      const cam = cadEntitiesToCam(section.entities);
      expect(cam.contours).toHaveLength(1);
      expect(cam.contours[0].closed).toBe(true);
      const points = section.entities.flatMap(entity => entity.type === 'line' ? [entity.start, entity.end] : []);
      expect(Math.min(...points.map(point => point.x))).toBeCloseTo(0, 6);
      expect(Math.max(...points.map(point => point.x))).toBeCloseTo(20, 6);
      expect(Math.max(...points.map(point => point.y))).toBeCloseTo(10, 6);
      expect(() => model.section({ bodyId: 'body', plane, offset: 0 })).toThrow('interior');
      expect(() => model.section({ bodyId: 'body', plane, offset: 100 })).toThrow('interior');
    });
  });

  it('preserves exact circular arc orientation and holes in final Boolean sections', () => {
    const holed: CadSketchFeature = { ...sketch('sketch', { ...rectangle, cornerRadius: 2 }), profiles: [
      ...sketch('sketch', { ...rectangle, cornerRadius: 2 }).profiles,
      { id: 'hole', name: 'hole', construction: false, role: 'hole', geometry: { kind: 'circle', x: 10, y: 5, radius: 2 } }
    ] };
    built([holed, extrude('body', 'sketch')], model => {
      const section = model.section({ bodyId: 'body', plane: 'XY', offset: 2 });
      const cam = cadEntitiesToCam(section.entities);
      expect(cam.contours).toHaveLength(2);
      expect(cam.contours.every(contour => contour.closed)).toBe(true);
      for (const entity of section.entities) if (entity.type === 'arc') {
        expect(entity.start.x).toBeCloseTo(entity.center.x + entity.radius * Math.cos(entity.startAngle), 6);
        expect(entity.start.y).toBeCloseTo(entity.center.y + entity.radius * Math.sin(entity.startAngle), 6);
        expect(entity.end.x).toBeCloseTo(entity.center.x + entity.radius * Math.cos(entity.endAngle), 6);
        expect(entity.end.y).toBeCloseTo(entity.center.y + entity.radius * Math.sin(entity.endAngle), 6);
        expect(entity.clockwise).toBe((entity.sweepRadians ?? 0) < 0);
      }
    });
    built([sketch('a', rectangle), extrude('box_a', 'a'), sketch('b', { ...rectangle, x: 10 }), extrude('box_b', 'b'),
      { ...base('cut'), kind: 'boolean', targetId: 'box_a', toolId: 'box_b', operation: 'cut' }], model => {
      const section = model.section({ bodyId: 'cut', plane: 'XY', offset: 2 });
      const points = section.entities.flatMap(entity => entity.type === 'line' ? [entity.start, entity.end] : []);
      expect(Math.max(...points.map(point => point.x))).toBeCloseTo(10, 6);
      expect(() => model.section({ bodyId: 'box_a', plane: 'XY', offset: 2 })).toThrow('unavailable');
    });
  });

  it('rejects elliptical sections of oblique cylinders without approximating them', () => {
    built([sketch('sketch', { kind: 'circle', x: 0, y: 0, radius: 5 }),
      { ...base('cylinder'), kind: 'extrude', sketchId: 'sketch', distance: 10, symmetric: true, operation: 'new', targetId: null },
      { ...base('rotated'), kind: 'transform', sourceId: 'cylinder', translation: [0, 0, 0], rotation: [45, 0, 0] }], model => {
      expect(model.result.diagnostics).toEqual([]);
      expect(() => model.section({ bodyId: 'rotated', plane: 'XY', offset: 0 })).toThrow('exact lines and circular arcs only');
      expect(model.result.meshes[0].volume).toBeCloseTo(Math.PI * 250, 5);
    });
  });

  it('rejects tangent components inside a disconnected patterned body', () => {
    built([sketch('sketch', rectangle), extrude('body', 'sketch'),
      { ...base('pattern'), kind: 'linear-pattern', sourceId: 'body', count: 2, spacing: [0, 0, 10] }], model => {
      expect(() => model.section({ bodyId: 'pattern', plane: 'XY', offset: 5 })).toThrow('end of a solid component');
      expect(model.section({ bodyId: 'pattern', plane: 'XY', offset: 2.5 }).contourCount).toBe(1);
      expect(() => model.section({ bodyId: 'pattern', plane: 'XY', offset: 7.5 })).toThrow('does not cut');
    });
  });
});
