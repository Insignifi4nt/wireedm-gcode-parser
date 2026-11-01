// @vitest-environment node
import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import initOpenCascade from 'replicad-opencascadejs';
import { getOC, setOC } from 'replicad';
import { parseCadDocument } from '../../../domain/cad/cadSchema';
import type { CadDocument, CadFeature } from '../../../domain/cad/cadDocument';
import { buildCadKernelModel, type CadKernelModel } from './cadKernelModel';
import { cadKernelParityModels } from './__tests__/cadKernelParity';
import { watchCadKernelNativeObjects } from './__tests__/cadKernelNativeObjects';

beforeAll(async () => {
  const wasmBinary = await readFile(new URL('../../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm', import.meta.url));
  setOC(await initOpenCascade({ wasmBinary, print: () => undefined, printErr: () => undefined }));
}, 60_000);

// Every builder, coordinate system, point, direction, vector, adaptor and 2D transform that a rebuild, a topology
// inspection or a section makes for its booleans, patterns, transforms, sketches, profiles, planes, prisms, revolves,
// shells, selected edges and descriptors. Replicad leaves the GProp_GProps of its measurements to garbage collection,
// which releases them, so they are not counted.
const counted = ['BRepAlgoAPI_Fuse', 'BRepAlgoAPI_Cut', 'BRepAlgoAPI_Common', 'BRepAlgoAPI_Section', 'BRepBuilderAPI_Transform', 'BRepFilletAPI_MakeFillet',
  'BRepFilletAPI_MakeChamfer', 'BRepOffsetAPI_MakeThickSolid', 'BRepPrimAPI_MakePrism', 'BRepPrimAPI_MakeRevol', 'BRepBuilderAPI_MakeEdge', 'BRepBuilderAPI_MakeWire',
  'BRepBuilderAPI_MakeFace', 'ShapeFix_Face', 'NCollection_List_TopoDS_Shape', 'gp_Trsf', 'gp_Ax1', 'gp_Ax2', 'gp_Ax3', 'gp_Pnt', 'gp_Dir', 'gp_Vec', 'gp_Pln',
  'gp_Pnt2d', 'gp_Vec2d', 'gp_Trsf2d', 'gp_GTrsf2d', 'BRepAdaptor_Curve', 'BRepAdaptor_Surface', 'BRepGProp_Face'] as const;
// Methods whose results are new native objects the caller deletes: raw builder results, the extrusion vector's
// intermediates, curve points, the copies Replicad's Vector makes, and the shape a list's Append returns.
const returned = ['BRepAlgoAPI_Algo.Shape', 'BRepBuilderAPI_MakeShape.Shape', 'BRepBuilderAPI_Transform.ModifiedShape', 'BRepBuilderAPI_MakeEdge.Edge',
  'BRepBuilderAPI_MakeWire.Wire', 'BRepBuilderAPI_MakeFace.Face', 'ShapeFix_Face.Face', 'gp_Vec.Normalized', 'gp_Vec.Multiplied', 'gp_Pnt.XYZ', 'gp_Vec.XYZ',
  'gp_Dir.XYZ', 'BRepAdaptor_Curve.Value', 'NCollection_List_TopoDS_Shape.Append', 'GProp_GProps.CentreOfMass'] as const;
const watch = () => watchCadKernelNativeObjects(counted, returned);
const parts = new Map(cadKernelParityModels().map(item => [item.id, item.document]));
function part(id: string): CadDocument {
  const document = parts.get(id);
  if (!document) throw new Error(`Expected the ${id} part`);
  return document;
}
function build(document: CadDocument, after?: (model: CadKernelModel) => void) {
  const model = buildCadKernelModel(document);
  try { expect(model.result.diagnostics).toEqual([]); after?.(model); } finally { model.dispose(); }
}

const base = (id: string) => ({ id, name: id, suppressed: false });
const holedBox = parseCadDocument({ format: 'wireedm-cad', schemaVersion: 1, id: 'part', name: 'Part', units: 'mm', parameters: {}, features: [
  { ...base('sketch'), kind: 'sketch', plane: 'XY', offset: 0, profiles: [
    { id: 'outer', name: 'Outer', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } },
    { id: 'hole', name: 'Hole', construction: false, role: 'hole', geometry: { kind: 'circle', x: 10, y: 5, radius: 2 } }] },
  { ...base('box'), kind: 'extrude', sketchId: 'sketch', distance: 5, symmetric: false, operation: 'new', targetId: null }] });
// The same box with an angled slot for its hole, so its profile is rotated as well as translated.
const slottedBox = parseCadDocument({ ...holedBox, features: holedBox.features.map(feature => feature.kind !== 'sketch' ? feature : { ...feature, profiles: feature.profiles.map(profile =>
  profile.id !== 'hole' ? profile : { ...profile, geometry: { kind: 'slot', x: 10, y: 5, length: 8, width: 3, angle: 30 } }) }) });
const withFeature = (feature: Record<string, unknown>) => parseCadDocument({ ...holedBox, features: [...holedBox.features, feature as unknown as CadFeature] });
// The top edge along X, and the two half circles drawCircle gives the hole's top rim.
const lineEdge = { expectedCount: 1, queries: [{ kind: 'edges', expectedCount: 1, predicates: [{ kind: 'line-endpoints', start: [0, 0, 5], end: [20, 0, 5] }] }] };
const rimEdges = { expectedCount: 2, queries: [{ kind: 'edges', expectedCount: 2, predicates: [{ kind: 'circle', center: [10, 5, 5], axis: [0, 0, 1], radius: 2 }] }] };
function inspectAll(model: CadKernelModel) {
  for (const mesh of model.result.meshes) for (const topology of ['edge', 'face'] as const) {
    let offset: number | null = 0, seen = 0;
    while (offset !== null) {
      const page = model.inspectTopology({ bodyId: mesh.featureId, expectedBuildId: model.result.buildId, selection: { kind: 'page', topology, offset, limit: 100 } });
      seen += page.descriptors.length; offset = page.nextOffset;
    }
    expect(seen).toBeGreaterThan(0);
  }
}

/** Forced collection when the runtime allows it; the counts do not depend on it. */
function collector(): (() => void) | undefined {
  try { setFlagsFromString('--expose-gc'); return runInNewContext('gc') as () => void; } catch { return undefined; }
}

it('rebuilds a plate cut by a hole pattern 20 times with no outstanding native builders and a flat heap', async () => {
  const gc = collector(), memory = (getOC() as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory;
  const settle = async () => { gc?.(); await new Promise(resolve => setTimeout(resolve, 0)); gc?.(); };
  const objects = watch(), plate = part('bench-plate-hole-pattern-0');
  try {
    // Warm-up builds grow the heap to the part's working size.
    build(plate); build(plate); await settle();
    const heap = memory.buffer.byteLength;
    expect(objects.outstanding()).toEqual({});
    // Rebuild synchronously, as a queue of edits does, so nothing waits on garbage collection.
    for (let rebuild = 0; rebuild < 20; rebuild++) { build(plate); expect(objects.outstanding(), `rebuild ${rebuild + 1}`).toEqual({}); }
    await settle();
    expect(objects.made()).toBeGreaterThan(22 * 10);
    expect(memory.buffer.byteLength).toBe(heap);
  } finally { objects.restore(); }
}, 60_000);

// Parts whose features reach every other owned path: revolve axes, mirror and transform, loft, sweep,
// Pocket, datum-plane sketches, shell, all-edge fillet and chamfer, and circular patterns.
it.each(['revolve-mirror-transform', 'datum-pad-revolve', 'loft-sweep-pocket', 'shell-fillet', 'box-chamfer-all', 'near-full-turn-pattern'])(
  'builds %s with no outstanding native object', id => {
    const objects = watch();
    try { build(part(id)); expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({}); }
    finally { objects.restore(); }
  });

// Slot profiles are rotated and translated. Topology descriptors and sections read curve points, tangents and face normals; selected-edge fillets and
// chamfers resolve their edges through the same descriptors.
const queries: readonly { name: string; document: () => CadDocument; after?: (model: CadKernelModel) => void }[] = [
  { name: 'builds a box with an angled slot', document: () => slottedBox },
  { name: 'inspects every edge and face of a holed box', document: () => holedBox, after: inspectAll },
  { name: 'inspects every edge and face of the heavy pattern', document: () => part('pattern-heavy'), after: inspectAll },
  { name: 'sections a holed box across XY', document: () => holedBox, after: model => { expect(model.section({ bodyId: 'box', plane: 'XY', offset: 2.5 }).contourCount).toBe(2); } },
  { name: 'sections a holed box across XZ through the hole', document: () => holedBox, after: model => { expect(model.section({ bodyId: 'box', plane: 'XZ', offset: -5 }).contourCount).toBe(2); } },
  { name: 'fillets a selected straight edge', document: () => withFeature({ ...base('round'), kind: 'fillet', targetId: 'box', radius: 0.5, selection: lineEdge }) },
  { name: 'chamfers a selected circular rim', document: () => withFeature({ ...base('bevel'), kind: 'chamfer', targetId: 'box', radius: 0.5, selection: rimEdges }) }
];
it.each(queries)('$name with no outstanding native object', query => {
  const document = query.document(), objects = watch();
  try { build(document, query.after); expect(objects.made()).toBeGreaterThan(0); expect(objects.outstanding()).toEqual({}); }
  finally { objects.restore(); }
});
