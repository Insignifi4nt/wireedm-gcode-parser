// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it, vi } from 'vitest';
import initialize from 'replicad-opencascadejs';
import { getOC, HASH_CODE_MAX, makeBox, measureVolume, setOC } from 'replicad';
import type { TopAbs_ShapeEnum, TopoDS_Shape } from 'replicad-opencascadejs';
import { cadKernelDisposeShape, cadKernelIsValid } from '../../src/features/cad/kernel/cadKernelShapes';
import { CadKernelTopology } from '../../src/features/cad/kernel/cadKernelTopology';
import { meshCadKernelPreview } from '../../src/features/cad/kernel/cadKernelMeshing';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initialize({ wasmBinary, print() {}, printErr() {} }));
}, 60_000);

function numbers(pointer: number, size: number, kind: 'float' | 'unsigned' | 'signed'): number[] {
  const heap = getOC().wasmMemory.buffer;
  const values = kind === 'float' ? new Float32Array(heap) : kind === 'unsigned' ? new Uint32Array(heap) : new Int32Array(heap);
  return Array.from(values.subarray(pointer / 4, pointer / 4 + size));
}

function checkGroups(shape: TopoDS_Shape, kind: TopAbs_ShapeEnum, legacy: number[], indexed: number[], expected: number) {
  const oc = getOC(), map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  const explorer = new oc.TopExp_Explorer(shape, kind, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (explorer.More()) {
      const element = explorer.Current();
      try { map.Add(element); } finally { element.Nullify(); element.delete(); }
      explorer.Next();
    }
    expect(map.Extent()).toBe(expected);
    expect(indexed).toHaveLength(legacy.length);
    const identities = new Set<number>();
    for (let group = 0; group < indexed.length; group += 3) {
      expect(indexed.slice(group, group + 2)).toEqual(legacy.slice(group, group + 2));
      const index = indexed[group + 2];
      expect(index).toBeGreaterThan(0); expect(index).toBeLessThanOrEqual(expected);
      identities.add(index);
      const element = map.FindKey(index);
      try { expect(oc.ReplicadShapeHasher.HashCode(element, HASH_CODE_MAX)).toBe(legacy[group + 2]); }
      finally { element.Nullify(); element.delete(); }
    }
    expect(identities.size).toBe(expected);
  } finally { explorer.delete(); map.delete(); }
}

it('adds exact indexed extractor identities while preserving every legacy geometry and sampling buffer', () => {
  const oc = getOC(), shape = makeBox([7, -13, 19], [27, -3, 24]);
  try {
    const legacy = oc.ReplicadMeshExtractor.extract(shape.wrapped, .005, 30, false);
    try {
      const indexed = oc.ReplicadMeshExtractor.extractWithTopologyIndices(shape.wrapped, .005, 30, false);
      try {
        expect(numbers(indexed.getVerticesPtr(), indexed.getVerticesSize(), 'float')).toEqual(numbers(legacy.getVerticesPtr(), legacy.getVerticesSize(), 'float'));
        expect(numbers(indexed.getNormalsPtr(), indexed.getNormalsSize(), 'float')).toEqual(numbers(legacy.getNormalsPtr(), legacy.getNormalsSize(), 'float'));
        expect(numbers(indexed.getTrianglesPtr(), indexed.getTrianglesSize(), 'unsigned')).toEqual(numbers(legacy.getTrianglesPtr(), legacy.getTrianglesSize(), 'unsigned'));
        checkGroups(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_FACE, numbers(legacy.getFaceGroupsPtr(), legacy.getFaceGroupsSize(), 'signed'), numbers(indexed.getFaceGroupsPtr(), indexed.getFaceGroupsSize(), 'signed'), 6);
      } finally { indexed.delete(); }
    } finally { legacy.delete(); }
    const legacyEdges = oc.ReplicadEdgeMeshExtractor.extract(shape.wrapped, .005, 30);
    try {
      const indexedEdges = oc.ReplicadEdgeMeshExtractor.extractWithTopologyIndices(shape.wrapped, .005, 30);
      try {
        expect(numbers(indexedEdges.getLinesPtr(), indexedEdges.getLinesSize(), 'float')).toEqual(numbers(legacyEdges.getLinesPtr(), legacyEdges.getLinesSize(), 'float'));
        checkGroups(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_EDGE, numbers(legacyEdges.getEdgeGroupsPtr(), legacyEdges.getEdgeGroupsSize(), 'signed'), numbers(indexedEdges.getEdgeGroupsPtr(), indexedEdges.getEdgeGroupsSize(), 'signed'), 12);
      } finally { indexedEdges.delete(); }
    } finally { legacyEdges.delete(); }
  } finally { cadKernelDisposeShape(shape); }
});

it.each(['inventory-explorer', 'preview-second-map', 'preview-explorer'] as const)('releases indexed maps after %s constructor failure and preserves exact source material', fault => {
  const oc = getOC(), source = makeBox([0, 0, 0], [10, 20, 5]);
  const NativeMap = oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher, Explorer = oc.TopExp_Explorer;
  const created: InstanceType<typeof NativeMap>[] = [], deleted = new Set<object>(), failure = new Error(`Native ${fault} constructor failed`);
  const release = NativeMap.prototype.delete;
  const released = vi.spyOn(NativeMap.prototype, 'delete').mockImplementation(function(this: InstanceType<typeof NativeMap>) {
    release.call(this); deleted.add(this);
  });
  let mapCalls = 0;
  oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher = new Proxy(NativeMap, { construct(target, args) {
    if (++mapCalls === 2 && fault === 'preview-second-map') throw failure;
    const value: InstanceType<typeof NativeMap> = Reflect.construct(target, args); created.push(value); return value;
  } });
  if (fault !== 'preview-second-map') oc.TopExp_Explorer = new Proxy(Explorer, { construct() { throw failure; } });
  try {
    expect(() => {
      if (fault === 'inventory-explorer') new CadKernelTopology(source);
      else meshCadKernelPreview(source, { min: [0, 0, 0], max: [10, 20, 5] }, { tolerance: .005, angularTolerance: 30 });
    }).toThrow(failure);
    expect(created.length).toBe(fault === 'preview-explorer' ? 2 : 1);
    expect(created.every(value => deleted.has(value))).toBe(true);
    expect(source.isNull).toBe(false); expect(measureVolume(source)).toBeCloseTo(1000, 8); expect(cadKernelIsValid(source)).toBe(true);
  } finally {
    oc.TopExp_Explorer = Explorer; oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher = NativeMap; released.mockRestore();
    for (const value of created) if (!deleted.has(value)) value.delete();
    cadKernelDisposeShape(source);
  }
});
