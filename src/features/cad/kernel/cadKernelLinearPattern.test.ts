// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import initOpenCascade from 'replicad-opencascadejs';
import { _3DShape, measureVolume, setOC, type Shape3D } from 'replicad';
import type { CadDocument, CadFeature } from '../../../domain/cad/cadDocument';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import { buildCadKernelModel, type CadKernelModel } from './cadKernelModel';
import { prepareCadSolidImport } from './cadKernelImport';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);
const base = (id: string) => ({ id, name: id, suppressed: false });
const seed: readonly CadFeature[] = [
  { ...base('profile'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false,
    geometry: { kind: 'rectangle', x: 0, y: 0, width: 2, height: 3, cornerRadius: 0 } }] },
  { ...base('seed'), kind: 'extrude', sketchId: 'profile', distance: 4, symmetric: false, operation: 'new', targetId: null },
];
type Linear = Extract<CadFeature, { kind: 'linear-pattern' }>;
const linear = (overrides: Partial<Linear> = {}): Linear => ({ ...base('pattern'), kind: 'linear-pattern', sourceId: 'seed', count: 4, spacing: [3, 0, 0], ...overrides });
function document(features: readonly CadFeature[], parameters: Readonly<Record<string, number>> = {}): CadDocument {
  return parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'linear_test', name: 'Linear test', units: 'mm', parameters, features });
}
function built(features: readonly CadFeature[], check: (model: CadKernelModel) => void, parameters: Readonly<Record<string, number>> = {}) {
  const model = buildCadKernelModel(document(features, parameters));
  try { check(model); } finally { model.dispose(); model.dispose(); }
}

describe('bounded native linear-pattern staging', () => {
  it.each([3, -3])('keeps independent seed copies with signed spacing %s and exact closed section counts', spacing => {
    built([...seed, linear({ spacing: [spacing, 0, 0] })], model => {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes).toHaveLength(1);
      const mesh = model.result.meshes[0]; expect(mesh.featureId).toBe('pattern'); expect(mesh.volume).toBeCloseTo(96, 7);
      expect(mesh.solidCount).toBe(4);
      expect(mesh.bounds.min[0]).toBeCloseTo(Math.min(0, spacing * 3), 7);
      expect(mesh.bounds.max[0]).toBeCloseTo(Math.max(0, spacing * 3) + 2, 7);
      expect(model.section({ bodyId: 'pattern', plane: 'XY', offset: 2 }).contourCount).toBe(4);
      expect(() => model.section({ bodyId: 'seed', plane: 'XY', offset: 2 })).toThrow('unavailable');
    });
  });
  it.each([1, -1])('retains the fused material result for overlapping copies, spacing=%s', spacing => {
    built([...seed, linear({ spacing: [spacing, 0, 0] })], model => {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(60, 7);
      expect(model.result.meshes[0].solidCount).toBe(1);
      expect(model.section({ bodyId: 'pattern', plane: 'XY', offset: 2 }).contourCount).toBe(1);
    });
  });
  it('reevaluates a signed 3D spacing expression and roundtrips the complete STEP pattern', async () => {
    const model = buildCadKernelModel(document([...seed, linear({ spacing: ['xStep', 4, -5] })], { xStep: -3 }));
    try {
      expect(model.result.diagnostics).toEqual([]); const mesh = model.result.meshes[0]; expect(mesh.volume).toBeCloseTo(96, 7);
      mesh.bounds.min.forEach((value, index) => expect(value).toBeCloseTo([-9, 0, -15][index], 7));
      mesh.bounds.max.forEach((value, index) => expect(value).toBeCloseTo([2, 15, 4][index], 7));
      const imported = prepareCadSolidImport({ format: 'step', encoding: 'utf8', fileName: 'linear.step', data: await model.export('step').text() });
      expect(imported.solidCount).toBe(4); expect(imported.volume).toBeCloseTo(96, 7);
    } finally { model.dispose(); }
    built([...seed, linear({ spacing: ['xStep', 4, -5] })], model => {
      expect(model.result.meshes[0].bounds.min[0]).toBeCloseTo(0, 7); expect(model.result.meshes[0].bounds.max[0]).toBeCloseTo(11, 7);
    }, { xStep: 3 });
  });
  it('releases every preceding union and translated copy before the next fuse, while keeping the original seed intact', () => {
    const sourceFuse = _3DShape.prototype.fuse;
    const previousUnions: Shape3D[] = []; const copies: Shape3D[] = []; let original: Shape3D | undefined;
    const fuse = vi.spyOn(_3DShape.prototype, 'fuse').mockImplementation(function(this: Shape3D, other) {
      if (!original) original = this;
      for (const copy of copies) expect(() => copy.wrapped).toThrow();
      for (const previous of previousUnions.slice(0, -1)) expect(() => previous.wrapped).toThrow();
      expect(measureVolume(original)).toBeCloseTo(24, 7);
      copies.push(other); const next = sourceFuse.call(this, other); previousUnions.push(next); return next;
    });
    try {
      built([...seed, linear({ count: 6 })], model => {
        expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(144, 6);
        expect(copies).toHaveLength(5); expect(previousUnions).toHaveLength(5);
        for (const shape of [...copies, ...previousUnions.slice(0, -1)]) expect(() => shape.wrapped).toThrow();
      });
    } finally { fuse.mockRestore(); }
  }, 30_000);
  it.each([1, 3])('disposes all failed staging operands after fuse %s and preserves the native source and preview', failingCall => {
    const originalFuse = _3DShape.prototype.fuse; const copies: Shape3D[] = []; const unions: Shape3D[] = [];
    let source: Shape3D | undefined;
    const failure = vi.spyOn(_3DShape.prototype, 'fuse').mockImplementation(function(this: Shape3D, other) {
      if (!source) source = this; copies.push(other);
      if (copies.length === failingCall) throw new Error('Interrupted linear pattern');
      const next = originalFuse.call(this, other); unions.push(next); return next;
    });
    try {
      built([...seed, linear({ count: 6 })], model => {
        expect(model.result.diagnostics[0]).toMatchObject({ featureId: 'pattern', message: 'Interrupted linear pattern' });
        expect(model.result.meshes).toHaveLength(1); expect(model.result.meshes[0].featureId).toBe('seed'); expect(model.result.meshes[0].volume).toBeCloseTo(24, 7);
        if (!source) throw new Error('Expected original native source'); expect(measureVolume(source)).toBeCloseTo(24, 7);
        expect(copies).toHaveLength(failingCall); for (const shape of [...copies, ...unions]) expect(() => shape.wrapped).toThrow();
        expect(() => model.export('step')).toThrow('Fix the feature diagnostics');
      });
    } finally { failure.mockRestore(); }
    built([...seed, linear()], model => expect(model.result.diagnostics).toEqual([]));
  });
  it('releases an allocated clone when its translation fails without consuming the original source', () => {
    const originalTranslate = _3DShape.prototype.translate; const clones: Shape3D[] = [];
    const failure = vi.spyOn(_3DShape.prototype, 'translate').mockImplementation(function(this: Shape3D, ...args) {
      clones.push(this); if (clones.length === 2) throw new Error('Interrupted pattern translation');
      return originalTranslate.apply(this, args);
    });
    try {
      built([...seed, linear()], model => {
        expect(model.result.diagnostics[0].message).toBe('Interrupted pattern translation'); expect(model.result.meshes[0].featureId).toBe('seed');
        expect(clones).toHaveLength(2); for (const clone of clones) expect(() => clone.wrapped).toThrow();
        expect(model.result.meshes[0].volume).toBeCloseTo(24, 7);
      });
    } finally { failure.mockRestore(); }
  });
});
