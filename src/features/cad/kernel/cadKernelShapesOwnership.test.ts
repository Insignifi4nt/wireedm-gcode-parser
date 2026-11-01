// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it, vi } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { Compound, getOC, makeBox, makeCompound, measureVolume, setOC, Shape, Solid } from 'replicad';
import type { TopoDS_Shape } from 'replicad-opencascadejs';
import type { CadDocument, CadFeature } from '../../../domain/cad/cadDocument';
import { buildCadKernelModel } from './cadKernelModel';
import { cadKernelDisposeShape, cadKernelIsValid, cadKernelSolids } from './cadKernelShapes';
import { cadKernelBuilders } from './cadKernelBuilders';
import { watchCadKernelBuilders } from './__tests__/cadKernelBuilderWatch';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

it('releases independent wrapper copies and explored solids without nullifying the borrowed source', () => {
  const source = makeBox([100, 200, 300], [110, 220, 305]), copy = source.clone();
  try {
    expect(copy.isSame(source)).toBe(true);
    cadKernelDisposeShape(copy);
    for (let iteration = 0; iteration < 4; iteration++) {
      const solids = cadKernelSolids(source);
      expect(solids).toHaveLength(1); expect(solids[0].isSame(source)).toBe(true);
      solids.forEach(cadKernelDisposeShape);
      expect(source.isNull).toBe(false); expect(cadKernelIsValid(source)).toBe(true); expect(measureVolume(source)).toBeCloseTo(1000, 8);
      const bounds = source.boundingBox;
      try {
        bounds.bounds[0].forEach((value, axis) => expect(value).toBeCloseTo([100, 200, 300][axis], 6));
        bounds.bounds[1].forEach((value, axis) => expect(value).toBeCloseTo([110, 220, 305][axis], 6));
      } finally { bounds.delete(); }
    }
  } finally { cadKernelDisposeShape(copy); cadKernelDisposeShape(source); }
});

it('preserves the primary transform failure and borrowed source while cleaning a failed owned input', () => {
  const source = makeBox([0, 0, 0], [10, 20, 5]), owned = source.clone(), failure = new Error('Primary transform failure');
  const watch = watchCadKernelBuilders({ kinds: ['transform'], call: 1, error: failure });
  try {
    expect(() => cadKernelBuilders.translate(owned, [30, 40, 50])).toThrow(failure);
    // The failed adapter released its builder and transformation, and left its borrowed input to its owner.
    expect(watch.failed).toHaveLength(1); expect(watch.outstanding()).toBe(0);
    expect(owned.isNull).toBe(false); expect(measureVolume(owned)).toBeCloseTo(1000, 8);
    expect(cadKernelIsValid(source)).toBe(true); expect(measureVolume(source)).toBeCloseTo(1000, 8);
    cadKernelDisposeShape(owned); cadKernelDisposeShape(owned);
    expect(() => owned.wrapped).toThrow(); expect(measureVolume(source)).toBeCloseTo(1000, 8);
  } finally { watch.restore(); cadKernelDisposeShape(owned); cadKernelDisposeShape(source); }
});

it('retains independently placed compound material after repeated validation and solid traversal disposal', () => {
  const source = makeBox([0, 0, 0], [10, 20, 5]);
  const copy = source.clone(), moved = cadKernelBuilders.translate(copy, [30, 40, 50]);
  // The translated copy owns its own geometry once its input is released.
  cadKernelDisposeShape(copy);
  const compound = makeCompound([source.clone(), moved]).asShape3D();
  try {
    for (let iteration = 0; iteration < 3; iteration++) {
      const solids = cadKernelSolids(compound);
      try {
        expect(solids).toHaveLength(2);
        solids.forEach(solid => expect(measureVolume(solid)).toBeCloseTo(1000, 8));
      } finally { solids.forEach(cadKernelDisposeShape); }
      expect(cadKernelIsValid(compound)).toBe(true); expect(measureVolume(compound)).toBeCloseTo(2000, 8);
      expect(measureVolume(source)).toBeCloseTo(1000, 8);
      const bounds = compound.boundingBox;
      try { bounds.bounds[1].forEach((value, axis) => expect(value).toBeCloseTo([40, 60, 55][axis], 6)); }
      finally { bounds.delete(); }
    }
  } finally { cadKernelDisposeShape(compound); cadKernelDisposeShape(source); }
});

it.each(['linear-pattern', 'circular-pattern', 'stl'] as const)('releases application-owned %s temporaries without retaining their BRep references', kind => {
  const aliases: TopoDS_Shape[] = [];
  const capture = (shape: { readonly wrapped: TopoDS_Shape }) => {
    const raw = shape.wrapped;
    if (!('clone' in raw) || typeof raw.clone !== 'function') throw new Error('Expected native handle aliases');
    const alias: unknown = raw.clone();
    if (!(alias instanceof getOC().TopoDS_Shape)) throw new Error('Expected native shape alias');
    aliases.push(alias);
  };
  const fuse = cadKernelBuilders.fuse, watch = watchCadKernelBuilders();
  const fused = vi.spyOn(cadKernelBuilders, 'fuse').mockImplementation((union, copy) => {
    capture(copy); return fuse(union, copy);
  });
  const clone = Shape.prototype.clone, blobSTL = Shape.prototype.blobSTL;
  const cloned = vi.spyOn(Shape.prototype, 'clone').mockImplementation(function(this: typeof Shape.prototype) { const copy = clone.call(this); capture(copy); return copy; });
  const exported = vi.spyOn(Shape.prototype, 'blobSTL').mockImplementation(function(this: typeof Shape.prototype, ...args: Parameters<typeof blobSTL>) { capture(this); return blobSTL.apply(this, args); });
  const pattern: readonly CadFeature[] = kind === 'linear-pattern' ? [{ id: 'copies', name: 'Copies', kind, suppressed: false, sourceId: 'pad', count: 3, spacing: [20, 0, 0] }]
    : kind === 'circular-pattern' ? [{ id: 'copies', name: 'Copies', kind, suppressed: false, sourceId: 'pad', count: 3, axis: 'z', center: [0, 0, 0], angle: 360 }] : [];
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'temporary_audit', name: 'Temporary audit', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Square', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'square', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: 10, y: 0, width: 4, height: 4, cornerRadius: 0 } }] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }, ...pattern
  ] };
  try {
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]);
      expect(model.result.meshes[0].volume).toBeCloseTo(kind === 'stl' ? 80 : 240, 7);
      if (kind === 'stl') expect(model.export('stl').size).toBeGreaterThan(0);
      expect(model.section({ bodyId: kind === 'stl' ? 'pad' : 'copies', plane: 'XY', offset: 2 }).contourCount).toBe(kind === 'stl' ? 1 : 3);
    } finally { model.dispose(); }
    expect(aliases.length).toBeGreaterThan(0);
    expect(aliases.every(alias => alias.IsNull())).toBe(true);
    expect(watch.builders.length).toBe(kind === 'stl' ? 0 : 4); expect(watch.outstanding()).toBe(0);
  } finally {
    fused.mockRestore(); cloned.mockRestore(); exported.mockRestore(); watch.restore();
    for (const alias of aliases) { alias.Nullify(); alias.delete(); }
  }
});

it('releases the STL compound when builder construction fails and retains the accepted native body', () => {
  const compounds: Compound[] = [], solids: Solid[] = [];
  const register = FinalizationRegistry.prototype.register;
  const registered = vi.spyOn(FinalizationRegistry.prototype, 'register').mockImplementation(function(this: typeof FinalizationRegistry.prototype, ...args: Parameters<typeof register>) {
    if (args[0] instanceof Compound) compounds.push(args[0]);
    if (args[0] instanceof Solid) solids.push(args[0]);
    return register.apply(this, args);
  });
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'failed_stl', name: 'Failed STL', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Square', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'square', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } }] },
    { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
  ] };
  const model = buildCadKernelModel(document), oc = getOC(), Builder = oc.TopoDS_Builder;
  try {
    expect(model.result.diagnostics).toEqual([]);
    const source = solids.find(solid => { try { return !solid.isNull; } catch { return false; } });
    if (!source) throw new Error('Expected the accepted native solid');
    expect(measureVolume(source)).toBeCloseTo(1000, 8);
    const failure = new Error('Native STL builder constructor failed');
    oc.TopoDS_Builder = new Proxy(Builder, { construct() { throw failure; } });
    try {
      expect(() => model.export('stl')).toThrow(failure);
      expect(compounds).toHaveLength(1);
      expect(() => compounds[0].wrapped).toThrow('This object has been deleted');
    } finally { oc.TopoDS_Builder = Builder; }
    expect(source.isNull).toBe(false); expect(cadKernelIsValid(source)).toBe(true); expect(measureVolume(source)).toBeCloseTo(1000, 8);
    const section = model.section({ bodyId: 'pad', plane: 'XY', offset: 5 });
    expect(section.contourCount).toBe(1); expect(section.entities).toHaveLength(4);
    expect(model.export('stl').size).toBeGreaterThan(0);
  } finally {
    oc.TopoDS_Builder = Builder; registered.mockRestore();
    for (const compound of compounds) cadKernelDisposeShape(compound);
    model.dispose();
  }
});
