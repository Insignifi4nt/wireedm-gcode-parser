// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it, vi } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC, type Shape3D } from 'replicad';
import { buildCadKernelModel } from './cadKernelModel';
import { prepareCadSolidImport } from './cadKernelImport';
import { cadKernelBuilders } from './cadKernelBuilders';
import { watchCadKernelBuilders } from './__tests__/cadKernelBuilderWatch';
import { cadBytesToBase64 } from '../../../domain/cad/cadImports';
import type { CadDocument } from '../../../domain/cad/cadDocument';
import type { TopoDS_Shape } from 'replicad-opencascadejs';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

it('releases native curve-to-edge builders on each exact profile construction while retaining the solid', () => {
  const oc = getOC(), Original = oc.BRepBuilderAPI_MakeEdge;
  const builders: InstanceType<typeof Original>[] = [];
  const deleted = new Set<object>(), originalDelete = Original.prototype.delete;
  const release = vi.spyOn(Original.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof Original>) { deleted.add(this); originalDelete.call(this); });
  oc.BRepBuilderAPI_MakeEdge = new Proxy(Original, { construct(target, args) {
    const builder = Reflect.construct(target, args) as InstanceType<typeof Original>;
    builders.push(builder); return builder;
  } });
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'ownership', name: 'Ownership', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Dodecagon', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'profile', name: 'Boundary', construction: false, geometry: { kind: 'polygon',
        points: Array.from({ length: 12 }, (_, i) => [10 * Math.cos(i * Math.PI / 6), 10 * Math.sin(i * Math.PI / 6)] as const) } }
    ] },
    { id: 'solid', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
  ] };
  try {
    for (let i = 0; i < 3; i++) {
      const model = buildCadKernelModel(document);
      try {
        expect(model.result.diagnostics).toEqual([]);
        expect(model.result.meshes[0].volume).toBeCloseTo(12 * 100 * Math.sin(Math.PI / 6) / 2 * 5, 6);
        expect(model.section({ bodyId: 'solid', plane: 'XY', offset: 2 }).contourCount).toBe(1);
      } finally { model.dispose(); }
      expect(builders.length).toBeGreaterThan(0);
      expect(builders.every(builder => deleted.has(builder))).toBe(true);
    }
    expect(release).toHaveBeenCalledTimes(builders.length);
  } finally {
    oc.BRepBuilderAPI_MakeEdge = Original; release.mockRestore();
    for (const builder of builders) if (!deleted.has(builder)) builder.delete();
  }
});

it('releases owned topology traversal references after an actual STL import while preserving its material', async () => {
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'import_ownership', name: 'Import ownership', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Square', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'profile', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'solid', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
  ] };
  const model = buildCadKernelModel(document), oc = getOC(), aliases: TopoDS_Shape[] = [];
  const data = cadBytesToBase64(new Uint8Array(await model.export('stl').arrayBuffer()));
  const current = oc.TopExp_Explorer.prototype.Current;
  const spy = vi.spyOn(oc.TopExp_Explorer.prototype, 'Current').mockImplementation(function(this: InstanceType<typeof oc.TopExp_Explorer>) {
    const raw = current.call(this);
    if (!('clone' in raw) || typeof raw.clone !== 'function') throw new Error('Expected public native handle cloning');
    const alias: unknown = raw.clone();
    if (!(alias instanceof oc.TopoDS_Shape)) throw new Error('Expected native topology alias');
    aliases.push(alias); return raw;
  });
  try {
    const imported = prepareCadSolidImport({ format: 'stl', fileName: 'owned.stl', units: 'mm', encoding: 'base64', data });
    expect(imported.volume).toBeCloseTo(500, 7); expect(imported.solidCount).toBe(1);
    expect(aliases.length).toBeGreaterThan(0);
    expect(aliases.every(alias => alias.IsNull())).toBe(true);
    expect(model.section({ bodyId: 'solid', plane: 'XY', offset: 2 }).contourCount).toBe(1);
  } finally {
    spy.mockRestore(); model.dispose();
    for (const alias of aliases) { alias.Nullify(); alias.delete(); }
  }
});

it('releases consumed transform inputs without changing their independently built output material', () => {
  const aliases: TopoDS_Shape[] = [];
  function capture(shape: Shape3D) {
    const raw = shape.wrapped;
    if (!('clone' in raw) || typeof raw.clone !== 'function') throw new Error('Expected public embind handle cloning');
    const alias: unknown = raw.clone();
    if (!(alias instanceof getOC().TopoDS_Shape)) throw new Error('Expected native shape alias');
    aliases.push(alias);
  }
  const { rotate, translate } = cadKernelBuilders, watch = watchCadKernelBuilders();
  const rotated = vi.spyOn(cadKernelBuilders, 'rotate').mockImplementation((shape, angle, center, direction) => { capture(shape); return rotate(shape, angle, center, direction); });
  const translated = vi.spyOn(cadKernelBuilders, 'translate').mockImplementation((shape, offset) => { capture(shape); return translate(shape, offset); });
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'consumed', name: 'Consumed', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Rectangle', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'profile', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'solid', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null },
    { id: 'moved', name: 'Moved', kind: 'transform', suppressed: false, sourceId: 'solid', translation: [30, 0, 0], rotation: [0, 0, 90] }
  ] };
  try {
    const model = buildCadKernelModel(document);
    try {
      expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(1000, 7);
      expect(model.result.meshes[0].bounds.min[0]).toBeCloseTo(20, 6); expect(model.result.meshes[0].bounds.max[0]).toBeCloseTo(30, 6);
      expect(model.section({ bodyId: 'moved', plane: 'XY', offset: 2 }).contourCount).toBe(1);
    } finally { model.dispose(); }
    expect(aliases).toHaveLength(2);
    expect(aliases.every(alias => alias.IsNull())).toBe(true);
    expect(watch.builders.map(item => item.kind)).toEqual(['transform', 'transform']); expect(watch.outstanding()).toBe(0);
  } finally {
    rotated.mockRestore(); translated.mockRestore(); watch.restore();
    for (const alias of aliases) { alias.Nullify(); alias.delete(); }
  }
});

it.each(['extrusion', 'solid-exploration'] as const)('releases raw whole-shape %s handles after retaining only owned wrappers', kind => {
  const oc = getOC(), rawShapes: TopoDS_Shape[] = [];
  const deleted = new Set<object>(), cleared = new Set<object>(), originalDelete = oc.TopoDS_Shape.prototype.delete;
  const release = vi.spyOn(oc.TopoDS_Shape.prototype, 'delete').mockImplementation(function(this: TopoDS_Shape) {
    if (this.IsNull()) cleared.add(this);
    deleted.add(this); originalDelete.call(this);
  });
  // Capture native return values, independently of the application's ownership set.
  const capture = (shape: TopoDS_Shape) => { rawShapes.push(shape); return shape; };
  const prismShape = oc.BRepPrimAPI_MakePrism.prototype.Shape, current = oc.TopExp_Explorer.prototype.Current;
  const spy = kind === 'extrusion'
    ? vi.spyOn(oc.BRepPrimAPI_MakePrism.prototype, 'Shape').mockImplementation(function(this: InstanceType<typeof oc.BRepPrimAPI_MakePrism>) { return capture(prismShape.call(this)); })
    : vi.spyOn(oc.TopExp_Explorer.prototype, 'Current').mockImplementation(function(this: InstanceType<typeof oc.TopExp_Explorer>) { return capture(current.call(this)); });
  const document: CadDocument = { format: 'wireedm-cad', schemaVersion: 1, id: 'raw_handles', name: 'Raw handles', units: 'mm', parameters: {}, features: [
    { id: 'sketch', name: 'Square', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'profile', name: 'Square', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 10, height: 10, cornerRadius: 0 } }
    ] },
    { id: 'solid', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }
  ] };
  try {
    const model = buildCadKernelModel(document);
    try { expect(model.result.diagnostics).toEqual([]); expect(model.result.meshes[0].volume).toBeCloseTo(500, 7); }
    finally { model.dispose(); }
    expect(rawShapes.length).toBeGreaterThan(0);
    expect(rawShapes.every(shape => deleted.has(shape))).toBe(true);
    expect(rawShapes.every(shape => cleared.has(shape))).toBe(true);
  } finally {
    spy.mockRestore(); release.mockRestore();
    for (const shape of rawShapes) if (!deleted.has(shape)) shape.delete();
  }
});
