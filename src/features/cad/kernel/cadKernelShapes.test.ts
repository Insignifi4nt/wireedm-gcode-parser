// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it, vi } from 'vitest';
import initOpenCascade from 'replicad-opencascadejs';
import { Compound, getOC, isShape3D, makeBox, makeCompound, setOC } from 'replicad';
import { cadKernelDisposeOwned, cadKernelEdges, cadKernelFaces, cadKernelIsValid, cadKernelSolids } from './cadKernelShapes';

beforeAll(async () => {
  setOC(await initOpenCascade({ wasmBinary: await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url)),
    print: () => undefined, printErr: () => undefined }));
}, 60_000);

it('enumerates distinct topology once while retaining separately located copies and their source owners', () => {
  const source = makeBox([0, 0, 0], [1, 2, 3]), moved = source.clone().translate([10, 0, 0]);
  const oc = getOC(), builder = new oc.TopoDS_Builder(), raw = new oc.TopoDS_Compound();
  builder.MakeCompound(raw); builder.Add(raw, source.wrapped); builder.Add(raw, source.wrapped); builder.Add(raw, moved.wrapped);
  const repeated = new Compound(raw); builder.delete();
  try {
    const solids = cadKernelSolids(repeated), faces = cadKernelFaces(repeated), edges = cadKernelEdges(repeated);
    try {
      expect(solids).toHaveLength(2); expect(faces).toHaveLength(12); expect(edges).toHaveLength(24);
      expect(solids.map(solid => {
        const box = solid.boundingBox;
        try { return box.bounds[0][0]; } finally { box.delete(); }
      })).toEqual([0, 10]);
    } finally { for (const shape of [...solids, ...faces, ...edges]) cadKernelDisposeOwned(shape); }
    expect(cadKernelIsValid(source)).toBe(true); expect(cadKernelIsValid(moved)).toBe(true);
    const again = cadKernelSolids(repeated);
    try { expect(again).toHaveLength(2); } finally { for (const solid of again) cadKernelDisposeOwned(solid); }
  } finally { cadKernelDisposeOwned(repeated); cadKernelDisposeOwned(moved); cadKernelDisposeOwned(source); }
});

it('keeps all faces and edges of a compound independently of enumeration and disposal order', () => {
  const boxes = Array.from({ length: 256 }, (_, i) => makeBox([2 * i, 0, 0], [2 * i + 1, 1, 1]));
  const compound = makeCompound(boxes);
  if (!isShape3D(compound)) throw new Error('Expected a solid compound.');
  try {
    const edges = cadKernelEdges(compound);
    try { expect(edges).toHaveLength(3072); } finally { for (const edge of edges) cadKernelDisposeOwned(edge); }
    const faces = cadKernelFaces(compound);
    try { expect(faces).toHaveLength(1536); } finally { for (const face of faces) cadKernelDisposeOwned(face); }
    const solids = cadKernelSolids(compound);
    try { expect(solids).toHaveLength(256); } finally { for (const solid of solids) cadKernelDisposeOwned(solid); }
    expect(cadKernelIsValid(compound)).toBe(true);
  } finally { cadKernelDisposeOwned(compound); for (const box of boxes) cadKernelDisposeOwned(box); }
});

it.each(['wrapped getter', 'explorer constructor'] as const)('does not acquire a native index map before a failing %s', failureAt => {
  const source = makeBox([0, 0, 0], [1, 2, 3]), oc = getOC();
  const MapConstructor = oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher, Explorer = oc.TopExp_Explorer;
  const acquired: InstanceType<typeof MapConstructor>[] = [], failure = new Error(`Failed ${failureAt}`);
  oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher = new Proxy(MapConstructor, { construct(target, args, newTarget) {
    const map = Reflect.construct(target, args, newTarget); acquired.push(map); return map;
  } });
  if (failureAt === 'explorer constructor') oc.TopExp_Explorer = new Proxy(Explorer, { construct() { throw failure; } });
  try {
    const input = failureAt === 'wrapped getter' ? { get wrapped(): typeof source.wrapped { throw failure; } } : source;
    expect(() => cadKernelEdges(input)).toThrow(failure);
    expect(acquired).toHaveLength(0);
    expect(cadKernelIsValid(source)).toBe(true);
  } finally {
    oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher = MapConstructor; oc.TopExp_Explorer = Explorer;
    for (const map of acquired) map.delete();
    cadKernelDisposeOwned(source);
  }
});

it('releases the existing native explorer when index-map construction fails', () => {
  const source = makeBox([0, 0, 0], [1, 2, 3]), oc = getOC();
  const MapConstructor = oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher, Explorer = oc.TopExp_Explorer;
  const deleted = vi.fn(), failure = new Error('Index map construction failed');
  oc.TopExp_Explorer = new Proxy(Explorer, { construct(target, args, newTarget) {
    const explorer = Reflect.construct(target, args, newTarget), release = explorer.delete.bind(explorer);
    explorer.delete = () => { deleted(); release(); }; return explorer;
  } });
  oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher = new Proxy(MapConstructor, { construct() { throw failure; } });
  try {
    expect(() => cadKernelEdges(source)).toThrow(failure);
    expect(deleted).toHaveBeenCalledOnce(); expect(cadKernelIsValid(source)).toBe(true);
  } finally {
    oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher = MapConstructor; oc.TopExp_Explorer = Explorer;
    cadKernelDisposeOwned(source);
  }
});
