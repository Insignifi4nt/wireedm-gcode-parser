// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { drawCircle, drawRoundedRectangle, setOC } from 'replicad';
import type { CadDocument, CadFeature, CadPlane, CadProfile, CadSketchFeature } from '@/domain/cad/cadDocument';
import { parseCadDocument } from '@/domain/cad/cadSchema';
import { cadEntitiesToCam } from '@/domain/cad/cadCam';
import { parsePortableUpid } from '@/domain/upid/portableUpidProject';
import { buildCadKernelModel } from './cadKernelModel';
import { sectionCadKernelShape } from './cadKernelSection';

beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)), print: () => undefined, printErr: () => undefined }));
}, 60_000);
const base = (id: string) => ({ id, name: id, suppressed: false });
const sketch = (geometry: CadProfile, plane: CadPlane = 'XY', offset = 0): CadSketchFeature => ({ ...base('sketch'), kind: 'sketch', plane, offset,
  profiles: [{ id: 'profile', name: 'Profile', construction: false, role: 'outer', geometry }] });
function document(features: readonly CadFeature[]): CadDocument {
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'cad_numeric', name: 'Numeric', units: 'mm', parameters: {}, features });
}
function model(features: readonly CadFeature[], check: (built: ReturnType<typeof buildCadKernelModel>) => void) {
  const built = buildCadKernelModel(document(features));
  try { check(built); } finally { built.dispose(); }
}
const extrude = (distance = 5): CadFeature => ({ ...base('body'), kind: 'extrude', sketchId: 'sketch', distance, symmetric: false, operation: 'new', targetId: null });

describe('independent exact CAD numerical review', () => {
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('keeps clockwise polygon geometry and negative pad direction consistent on %s', plane => {
    const offset = 20; const normalAxis = plane === 'XY' ? 2 : plane === 'XZ' ? 1 : 0;
    model([sketch({ kind: 'polygon', points: [[0, 0], [0, 10], [20, 10], [20, 0]] }, plane, offset), extrude(-5)], built => {
      expect(built.result.diagnostics).toEqual([]);
      expect(built.result.meshes[0].volume).toBeCloseTo(1000, 6);
      const bounds = built.result.meshes[0].bounds;
      expect(bounds.min[normalAxis]).toBeCloseTo(plane === 'XZ' ? -20 : 15, 5);
      expect(bounds.max[normalAxis]).toBeCloseTo(plane === 'XZ' ? -15 : 20, 5);
      const section = built.section({ bodyId: 'body', plane, offset: 17.5 });
      const cam = cadEntitiesToCam(section.entities);
      expect(cam.contours).toHaveLength(1); expect(cam.contours[0].area).toBeCloseTo(200, 7);
      expect(parsePortableUpid(JSON.stringify({ format: 'upid', schemaVersion: cam.schemaVersion, document: cam }))).toMatchObject({ ok: true });
    });
  });
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('revolves about the sketch-local y axis at a nonzero plane offset on %s', plane => {
    model([sketch({ kind: 'rectangle', x: 5, y: 0, width: 5, height: 10, cornerRadius: 0 }, plane, 25), {
      ...base('body'), kind: 'revolve', sketchId: 'sketch', angle: 360, axis: 'y', operation: 'new', targetId: null
    }], built => {
      expect(built.result.diagnostics).toEqual([]);
      expect(built.result.meshes[0].volume).toBeCloseTo(Math.PI * 750, 4);
      const bounds = built.result.meshes[0].bounds;
      const normalAxis = plane === 'XY' ? 2 : plane === 'XZ' ? 1 : 0;
      const center = plane === 'XZ' ? -25 : 25;
      expect(bounds.min[normalAxis]).toBeCloseTo(center - 10, 5); expect(bounds.max[normalAxis]).toBeCloseTo(center + 10, 5);
    });
  });
  it('rejects self-overlapping revolutions instead of exporting invalid retained geometry', () => {
    model([sketch({ kind: 'rectangle', x: -5, y: 0, width: 10, height: 10, cornerRadius: 0 }), {
      ...base('body'), kind: 'revolve', sketchId: 'sketch', angle: 360, axis: 'y', operation: 'new', targetId: null
    }], built => { expect(built.result.diagnostics.length).toBeGreaterThan(0); expect(() => built.export('step')).toThrow('Fix the feature diagnostics'); });
  });
  it.each(['XY', 'XZ', 'YZ'] satisfies CadPlane[])('preserves circle and arc section support after reflection on %s', plane => {
    model([sketch({ kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 2 }, plane), extrude(), {
      ...base('mirror'), kind: 'mirror', sourceId: 'body', plane
    }], built => {
      expect(built.result.diagnostics).toEqual([]);
      const section = built.section({ bodyId: 'mirror', plane, offset: -2 });
      const arcs = section.entities.filter(entity => entity.type === 'arc');
      expect(arcs).toHaveLength(4);
      for (const arc of arcs) {
        expect(arc.radius).toBeCloseTo(2, 8);
        expect(arc.end.x).toBeCloseTo(arc.center.x + arc.radius * Math.cos(arc.endAngle), 8);
        expect(arc.end.y).toBeCloseTo(arc.center.y + arc.radius * Math.sin(arc.endAngle), 8);
      }
      expect(cadEntitiesToCam(section.entities).contours).toHaveLength(1);
    });
  });
  it('returns explicit diagnostics for shapes below kernel precision rather than an empty successful preview', () => {
    model([sketch({ kind: 'rectangle', x: 0, y: 0, width: 1e-5, height: 1e-5, cornerRadius: 0 }), extrude(1e-5)], built => {
      expect(built.result.diagnostics.length).toBeGreaterThan(0);
      expect(built.result.meshes).toEqual([]);
      expect(() => built.export('stl')).toThrow('Fix the feature diagnostics');
    });
  });
  it('reduces full turns before rotation so very large angles retain their canonical geometry', () => {
    const bounds = [280, 1e9].map(angle => {
      const built = buildCadKernelModel(document([sketch({ kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 }), extrude(), {
        ...base('rotated'), kind: 'transform', sourceId: 'body', translation: [0, 0, 0], rotation: [0, 0, angle]
      }]));
      try { expect(built.result.diagnostics).toEqual([]); return built.result.meshes[0].bounds; }
      finally { built.dispose(); }
    });
    expect(bounds[1]).toEqual(bounds[0]);
  });
  it('rejects ambiguous native near-full circular sections rather than filling a narrow machined notch', () => {
    const circle = drawCircle(1e4); const rectangle = drawRoundedRectangle(1, .0005);
    const translated = rectangle.translate(10000.49, 0);
    const circleSketch = circle.blueprint.sketchOnPlane('XY'); const notchSketch = translated.blueprint.sketchOnPlane('XY');
    const body = circleSketch.extrude(5); const tool = notchSketch.extrude(5); const cut = body.cut(tool);
    try {
      // At this scale OCCT rounds the section's major arc to a complete circle.
      // The remaining notch edges expose that loss; the topology guard must
      // refuse a handoff rather than silently fill the opening.
      expect(() => sectionCadKernelShape(cut, { bodyId: 'cut', plane: 'XY', offset: 2 })).toThrow('open, touching or branching');
    } finally { cut.delete(); tool.delete(); body.delete(); circleSketch.delete(); notchSketch.delete(); circle.blueprint.delete(); rectangle.blueprint.delete(); translated.blueprint.delete(); }
  }, 60_000);
});
