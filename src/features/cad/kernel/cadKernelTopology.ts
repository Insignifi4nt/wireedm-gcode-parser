import { Edge, Face, getOC, type Shape3D, type ShapeEdgeMesh, type ShapeMesh } from 'replicad';
import type { gp_Dir, gp_Pnt, TopoDS_Shape } from 'replicad-opencascadejs';
import { CadError } from '../../../domain/cad/cadError';
import { cadKernelDisposeShape, cadKernelScope } from './cadKernelShapes';
import { cadKernelBounds, cadKernelCurveEnd, cadKernelCurvePointAt, cadKernelCurveStart, cadKernelCurveTangentAt, cadKernelFaceNormal } from './cadKernelQueries';
import { MAX_CAD_TOPOLOGY_ADJACENCY_ELEMENTS, type CadTopologyAdjacency } from '../../../domain/cad/cadTopologyAdjacency';
import type { CadMeshTopologyGroup } from '../../../domain/cad/cadDocument';
import {
  parseCadEdgeSelection, parseCadFaceQuery, resolveCadEdgeSelection, resolveCadFaceQuery,
  type CadTopologyDescriptor, type CadTopologyInspectRequest, type CadTopologyInspectResult,
  type CadTopologyResolvePicksRequest, type CadTopologyResolvePicksResult, type CadTopologyPick,
  type CadVector3, type CadEdgeQuery, type CadFaceQuery, type ResolvedCadEdgePredicate, type ResolvedCadFacePredicate,
  type CadEdgeSelection,
} from '../../../domain/cad/cadTopology';
import { CAD_PRECISION, cadRoundoff } from '../../../domain/precision/cadPrecision';
type EdgeDescriptor = Extract<CadTopologyDescriptor, { kind: 'edge' }>;
type FaceDescriptor = Extract<CadTopologyDescriptor, { kind: 'face' }>;
type Entry = { kind: 'edge'; key: string; shape: Edge; descriptor?: EdgeDescriptor }
  | { kind: 'face'; key: string; shape: Face; descriptor?: FaceDescriptor };
const dot = (a: CadVector3, b: CadVector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: CadVector3, b: CadVector3): CadVector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: CadVector3, b: CadVector3): CadVector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: CadVector3) => Math.hypot(...a);
const parallel = (a: CadVector3, b: CadVector3) => norm(cross(a, b)) <= CAD_PRECISION.kernelDirection;
const tolerance = (...values: number[]) => Math.max(CAD_PRECISION.kernelConfusionMm, cadRoundoff(8, Math.max(1, ...values.map(Math.abs))));
const sameNumber = (a: number, b: number) => Math.abs(a - b) <= tolerance(a, b);
const samePoint = (a: CadVector3, b: CadVector3) => norm(subtract(a, b)) <= tolerance(...a, ...b);
const tuple = (point: gp_Pnt | gp_Dir): CadVector3 => [point.X(), point.Y(), point.Z()];

function boundsOf(shape: Edge | Face): CadTopologyDescriptor['bounds'] {
  const [min, max] = cadKernelBounds(shape); return { min, max };
}
function propertiesOf(shape: Edge | Face, surface: boolean) {
  const oc = getOC();
  const properties = new oc.GProp_GProps();
  try {
    if (surface) oc.BRepGProp.SurfaceProperties(shape.wrapped, properties, false, false);
    else oc.BRepGProp.LinearProperties(shape.wrapped, properties, false, false);
    const point = properties.CentreOfMass();
    try { return { measure: properties.Mass(), centroid: tuple(point) }; } finally { point.delete(); }
  } finally { properties.delete(); }
}
function describeEdge(entry: Extract<Entry, { kind: 'edge' }>): EdgeDescriptor {
  const { measure: length, centroid } = propertiesOf(entry.shape, false);
  const base = { key: entry.key, kind: entry.kind, length, centroid, bounds: boundsOf(entry.shape) };
  const curve = entry.shape.curve;
  try {
    const nativeType = curve.curveType;
    if (nativeType !== 'LINE' && nativeType !== 'CIRCLE') return { ...base, curveType: 'other', nativeType };
    const start = cadKernelCurveStart(curve.wrapped); const end = cadKernelCurveEnd(curve.wrapped);
    if (nativeType === 'LINE') return { ...base, curveType: 'line', start, end };
    // Each native result is owned as soon as it is made, so a later failure still deletes it.
    return cadKernelScope(own => {
      const circle = own(own(new (getOC()).BRepAdaptor_Curve(entry.shape.wrapped)).Circle());
      const center = own(circle.Location()), direction = own(own(circle.Axis()).Direction());
      return { ...base, curveType: 'circle', start, end, midpoint: cadKernelCurvePointAt(curve.wrapped, .5),
        center: tuple(center), axis: tuple(direction), radius: circle.Radius(), closed: curve.isClosed };
    });
  } finally { curve.delete(); }
}
function describeFace(entry: Extract<Entry, { kind: 'face' }>): FaceDescriptor {
  const { measure: area, centroid } = propertiesOf(entry.shape, true);
  const base = { key: entry.key, kind: entry.kind, area, centroid, bounds: boundsOf(entry.shape) };
  const surface = entry.shape.surface;
  try {
    const nativeType = surface.surfaceType;
    if (nativeType !== 'PLANE' && nativeType !== 'CYLINDRE') return { ...base, surfaceType: 'other', nativeType };
    return cadKernelScope(own => {
      const adaptor = own(new (getOC()).BRepAdaptor_Surface(entry.shape.wrapped, false));
      if (nativeType === 'PLANE') {
        const origin = own(own(adaptor.Plane()).Location());
        // A reflected surface may reverse its parameter-frame handedness.
        // The plane axis plus TopAbs orientation alone then points inward.
        // BRepGProp evaluates the oriented surface normal in world coordinates.
        const rawNormal = cadKernelFaceNormal(entry.shape);
        const magnitude = norm(rawNormal);
        if (!Number.isFinite(magnitude) || magnitude <= cadRoundoff(1)) throw new CadError('unsupported-selection', 'The planar face has no reliable oriented normal.');
        const normal: CadVector3 = [rawNormal[0] / magnitude, rawNormal[1] / magnitude, rawNormal[2] / magnitude];
        return { ...base, surfaceType: 'plane', normal, offset: dot(normal, tuple(origin)) };
      }
      const cylinder = own(adaptor.Cylinder());
      const origin = own(cylinder.Location()), direction = own(own(cylinder.Axis()).Direction());
      return { ...base, surfaceType: 'cylinder', origin: tuple(origin), axis: tuple(direction), radius: cylinder.Radius() };
    });
  } finally { surface.delete(); }
}

function edgeMatches(edge: EdgeDescriptor, predicate: ResolvedCadEdgePredicate): boolean {
  switch (predicate.kind) {
    case 'curve-type': return edge.curveType === predicate.value;
    case 'length': return sameNumber(edge.length, predicate.value);
    case 'line-endpoints': return edge.curveType === 'line' &&
      (samePoint(edge.start, predicate.start) && samePoint(edge.end, predicate.end) || samePoint(edge.start, predicate.end) && samePoint(edge.end, predicate.start));
    case 'parallel': {
      if (edge.curveType !== 'line') return false;
      const direction = subtract(edge.end, edge.start); const length = norm(direction);
      return length > CAD_PRECISION.minimumLengthMm && parallel([direction[0] / length, direction[1] / length, direction[2] / length], predicate.direction);
    }
    case 'circle': return edge.curveType === 'circle' && samePoint(edge.center, predicate.center) && parallel(edge.axis, predicate.axis) && sameNumber(edge.radius, predicate.radius);
    case 'arc-points': return edge.curveType === 'circle' && !edge.closed && samePoint(edge.midpoint, predicate.midpoint) &&
      (samePoint(edge.start, predicate.start) && samePoint(edge.end, predicate.end) || samePoint(edge.start, predicate.end) && samePoint(edge.end, predicate.start));
    case 'on-plane': {
      const inPlane = (point: CadVector3) => Math.abs(dot(predicate.normal, point) - predicate.offset) <= tolerance(...point, predicate.offset);
      if (edge.curveType === 'line') return inPlane(edge.start) && inPlane(edge.end);
      if (edge.curveType === 'circle') return parallel(edge.axis, predicate.normal) && inPlane(edge.center);
      return false;
    }
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
function faceMatches(face: FaceDescriptor, predicate: ResolvedCadFacePredicate): boolean {
  switch (predicate.kind) {
    case 'surface-type': return face.surfaceType === predicate.value;
    case 'centroid': return samePoint(face.centroid, predicate.point);
    case 'area': return Math.abs(face.area - predicate.value) <= Math.max(CAD_PRECISION.kernelConfusionMm, CAD_PRECISION.kernelConfusionMm * Math.sqrt(Math.max(face.area, predicate.value)), tolerance(face.area, predicate.value));
    case 'plane': return face.surfaceType === 'plane' && norm(subtract(face.normal, predicate.normal)) <= CAD_PRECISION.kernelDirection && sameNumber(face.offset, predicate.offset);
    case 'cylinder': return face.surfaceType === 'cylinder' && parallel(face.axis, predicate.axis) && sameNumber(face.radius, predicate.radius)
      && norm(cross(subtract(face.origin, predicate.origin), predicate.axis)) <= tolerance(...face.origin, ...predicate.origin);
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
/**
 * Vertices are shared native vertices, so edges meet exactly where the solid joins them. Each end of an edge takes the vertex nearest the
 * curve's point there. Tangents are the curve's first derivatives at its ends, made unit. Faces meet smoothly along an edge when the kernel
 * reads at least tangent continuity there within `kernelDirection`; a seam, inside one face, is smooth.
 */
function readAdjacency(entries: readonly Entry[]): Omit<CadTopologyAdjacency, 'bodyId' | 'buildId'> {
  const oc = getOC();
  const edges = entries.filter((entry): entry is Extract<Entry, { kind: 'edge' }> => entry.kind === 'edge');
  const faces = entries.filter((entry): entry is Extract<Entry, { kind: 'face' }> => entry.kind === 'face');
  if (edges.length + faces.length > MAX_CAD_TOPOLOGY_ADJACENCY_ELEMENTS) throw new CadError('topology-too-large', 'This body has too many edges and faces to chain them.');
  const edgeVertices: number[] = [], edgeTangents: number[] = [], edgeFaces: number[] = [], edgeSmooth: boolean[] = [];
  const faceLoops: number[][][] = [];
  return cadKernelScope(own => {
    const edgeMap = own(new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher());
    const vertexMap = own(new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher());
    for (const entry of edges) edgeMap.Add(entry.shape.wrapped);
    const explore = (shape: TopoDS_Shape, kind: 'TopAbs_VERTEX' | 'TopAbs_WIRE' | 'TopAbs_EDGE', visit: (raw: TopoDS_Shape) => void) => {
      const explorer = new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum[kind], oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
      try {
        for (; explorer.More(); explorer.Next()) {
          const raw = explorer.Current();
          try { visit(raw); } finally { raw.Nullify(); raw.delete(); }
        }
      } finally { explorer.delete(); }
    };
    const unit = (vector: CadVector3) => {
      const length = norm(vector);
      return length > 0 && Number.isFinite(length) ? vector.map(value => value / length) : [0, 0, 0];
    };
    for (const entry of edges) {
      let ends: [CadVector3, CadVector3] | null = null, tangents = [0, 0, 0, 0, 0, 0];
      try {
        const curve = entry.shape.curve;
        try {
          ends = [cadKernelCurveStart(curve.wrapped), cadKernelCurveEnd(curve.wrapped)];
          tangents = [...unit(cadKernelCurveTangentAt(curve.wrapped, 0)), ...unit(cadKernelCurveTangentAt(curve.wrapped, 1))];
        } finally { curve.delete(); }
      } catch { /* A degenerate edge has no curve: no tangents, and its vertices still join it. */ }
      const found: { index: number; point: CadVector3 }[] = [];
      explore(entry.shape.wrapped, 'TopAbs_VERTEX', raw => {
        const index = vertexMap.Add(raw);
        if (found.some(vertex => vertex.index === index)) return;
        const vertex = oc.TopoDS.Vertex(raw), point = oc.BRep_Tool.Pnt(vertex);
        try { found.push({ index, point: tuple(point) }); } finally { point.delete(); vertex.delete(); }
      });
      const nearest = (target: CadVector3 | undefined) => {
        let best = found[0];
        if (target) for (const vertex of found) if (norm(subtract(vertex.point, target)) < norm(subtract(best.point, target))) best = vertex;
        return best?.index ?? 0;
      };
      edgeVertices.push(nearest(ends?.[0]), nearest(ends?.[1]));
      edgeTangents.push(...tangents);
    }
    const sides = edges.map((): number[] => []), seams = new Set<number>();
    faces.forEach((entry, face) => {
      const loops: number[][] = [];
      explore(entry.shape.wrapped, 'TopAbs_WIRE', wire => {
        const loop: number[] = [];
        explore(wire, 'TopAbs_EDGE', raw => {
          const edge = edgeMap.Add(raw) - 1;
          if (edge >= edges.length) return;
          // A seam runs through one face and appears in its loop once each way.
          if (loop.includes(edge)) { seams.add(edge); return; }
          loop.push(edge);
          if (sides[edge].length < 2) sides[edge].push(face);
        });
        loops.push(loop);
      });
      faceLoops.push(loops);
    });
    edges.forEach((entry, edge) => {
      const [first = -1, other = seams.has(edge) ? first : -1] = sides[edge];
      edgeFaces.push(first, other);
      if (seams.has(edge) && sides[edge].length === 1) { edgeSmooth.push(true); return; }
      if (first < 0 || other < 0) { edgeSmooth.push(false); return; }
      try {
        const continuity = oc.BRepLib.ContinuityOfFaces(entry.shape.wrapped, faces[first].shape.wrapped, faces[other].shape.wrapped, CAD_PRECISION.kernelDirection);
        edgeSmooth.push(continuity !== oc.GeomAbs_Shape.GeomAbs_C0);
      } catch { edgeSmooth.push(false); }
    });
    return { edges: edges.map(entry => entry.key), edgeVertices, edgeTangents, edgeFaces, edgeSmooth, faces: faces.map(entry => entry.key), faceLoops };
  });
}
function exactCount(actual: number, expected: number) {
  if (actual !== expected) throw new CadError(actual === 0 ? 'selection-empty' : 'selection-count-mismatch',
    `The geometric selector matched ${actual} element(s), but requires exactly ${expected}. Revise the selector; ambiguous matches are never chosen automatically.`);
}

/** One exact topology inventory owns native handles; descriptors are computed on demand. */
export class CadKernelTopology {
  private readonly entries = new Map<string, Entry>();
  private readonly indices = new Map<string, Entry>();
  private disposed = false;
  constructor(shape: Shape3D) {
    const oc = getOC();
    try {
      for (const kind of ['edge', 'face'] as const) {
        const indexed = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
        try {
          const explorer = new oc.TopExp_Explorer(shape.wrapped, kind === 'edge' ? oc.TopAbs_ShapeEnum.TopAbs_EDGE : oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
          try {
            while (explorer.More()) {
              const raw = explorer.Current();
              try {
                const identity = `${kind}:${indexed.Add(raw)}`;
                const existing = this.indices.get(identity);
                if (!existing) {
                  const key = `${kind}-${crypto.randomUUID()}`;
                  const entry: Entry = kind === 'edge' ? { kind, key, shape: new Edge(oc.TopoDS.Edge(raw)) } : { kind, key, shape: new Face(oc.TopoDS.Face(raw)) };
                  this.entries.set(key, entry); this.indices.set(identity, entry);
                }
              } finally { raw.Nullify(); raw.delete(); }
              explorer.Next();
            }
          } finally { explorer.delete(); }
        } finally { indexed.delete(); }
      }
    } catch (error) { this.dispose(); throw error; }
  }
  get count() { return this.entries.size; }
  private descriptor(entry: Entry): CadTopologyDescriptor {
    if (this.disposed) throw new CadError('STALE_BUILD', 'The topology snapshot has been disposed. Rebuild the current document.');
    if (entry.kind === 'edge') return entry.descriptor ??= describeEdge(entry);
    return entry.descriptor ??= describeFace(entry);
  }
  private picked(picks: readonly CadTopologyPick[]): Entry[] {
    return picks.map(pick => {
      const entry = this.entries.get(pick.key);
      if (!entry || entry.kind !== pick.kind) throw new CadError('STALE_BUILD', 'A topology pick does not belong to this body and build. Rebuild and select again.');
      return entry;
    });
  }
  meshGroups(mesh: ShapeMesh, edgeMesh: ShapeEdgeMesh): { faceGroups: CadMeshTopologyGroup[]; edgeGroups: CadMeshTopologyGroup[] } {
    const keyFor = (kind: Entry['kind'], index: number) => {
      const entry = this.indices.get(`${kind}:${index}`);
      if (!entry) throw new CadError('topology-mapping', 'The kernel preview contains topology absent from the exact body.');
      return entry.key;
    };
    return { faceGroups: mesh.faceGroups.filter(group => group.count > 0).map(group => ({ start: group.start, count: group.count, key: keyFor('face', group.faceId) })),
      edgeGroups: edgeMesh.edgeGroups.filter(group => group.count > 0).map(group => ({ start: group.start, count: group.count, key: keyFor('edge', group.edgeId) })) };
  }
  inspect(request: CadTopologyInspectRequest, buildId: string): CadTopologyInspectResult {
    const selection = request.selection;
    const all = selection.kind === 'page' ? [...this.entries.values()].filter(entry => entry.kind === selection.topology) : this.picked(selection.picks);
    const offset = selection.kind === 'page' ? selection.offset : 0; const limit = selection.kind === 'page' ? selection.limit : all.length;
    if (offset > all.length) throw new CadError('topology-page', 'The topology page offset is beyond the available elements.');
    return { bodyId: request.bodyId, buildId, descriptors: all.slice(offset, offset + limit).map(entry => this.descriptor(entry)), total: all.length,
      nextOffset: offset + limit < all.length ? offset + limit : null };
  }
  selectedEdges(selection: CadEdgeSelection, parameters: Readonly<Record<string, number>>): Edge[] {
    const resolved = resolveCadEdgeSelection(parseCadEdgeSelection(selection, parameters), parameters);
    const matches = new Map<string, Edge>();
    for (const query of resolved.queries) {
      const found: Extract<Entry, { kind: 'edge' }>[] = [];
      for (const entry of this.entries.values()) if (entry.kind === 'edge') {
        const descriptor = this.descriptor(entry);
        if (descriptor.kind === 'edge' && query.predicates.every(predicate => edgeMatches(descriptor, predicate))) found.push(entry);
      }
      exactCount(found.length, query.expectedCount);
      for (const entry of found) {
        const descriptor = this.descriptor(entry);
        if (descriptor.kind !== 'edge' || descriptor.curveType === 'other' || descriptor.length <= CAD_PRECISION.minimumLengthMm) throw new CadError('unsupported-selection', 'Selected edge operations currently require non-degenerate lines or circular arcs.');
        matches.set(entry.key, entry.shape);
      }
    }
    exactCount(matches.size, resolved.expectedCount);
    return [...matches.values()];
  }
  selectedFace(query: CadFaceQuery, parameters: Readonly<Record<string, number>>): Face {
    const resolved = resolveCadFaceQuery(parseCadFaceQuery(query, parameters), parameters);
    const found: Extract<Entry, { kind: 'face' }>[] = [];
    for (const entry of this.entries.values()) if (entry.kind === 'face') {
      const descriptor = this.descriptor(entry);
      if (descriptor.kind === 'face' && resolved.predicates.every(predicate => faceMatches(descriptor, predicate))) found.push(entry);
    }
    exactCount(found.length, resolved.expectedCount);
    const first = found[0];
    if (resolved.expectedCount !== 1 || !first || this.descriptor(first).kind !== 'face' || first.shape.geomType !== 'PLANE') throw new CadError('unsupported-selection', 'Inward shell requires exactly one planar opening.');
    return first.shape;
  }
  resolvePicks(request: CadTopologyResolvePicksRequest, buildId: string, parameters: Readonly<Record<string, number>>): CadTopologyResolvePicksResult {
    const entries = this.picked(request.picks);
    if (request.purpose === 'shell') {
      const descriptor = entries[0] && this.descriptor(entries[0]);
      if (entries.length !== 1 || !descriptor || descriptor.kind !== 'face' || descriptor.surfaceType !== 'plane') throw new CadError('unsupported-selection', 'Select one planar face for the shell opening.');
      const opening: CadFaceQuery = { kind: 'faces', expectedCount: 1, predicates: [{ kind: 'plane', normal: descriptor.normal, offset: descriptor.offset },
        { kind: 'centroid', point: descriptor.centroid }, { kind: 'area', value: descriptor.area }] };
      this.selectedFace(opening, parameters);
      return { bodyId: request.bodyId, buildId, purpose: 'shell', opening };
    }
    const queries: CadEdgeQuery[] = entries.map(entry => {
      const descriptor = this.descriptor(entry);
      if (descriptor.kind !== 'edge' || descriptor.curveType === 'other' || descriptor.length <= CAD_PRECISION.minimumLengthMm) throw new CadError('unsupported-selection', 'Select non-degenerate line or circular edges for fillet/chamfer.');
      if (descriptor.curveType === 'line') return { kind: 'edges', expectedCount: 1, predicates: [{ kind: 'line-endpoints', start: descriptor.start, end: descriptor.end }, { kind: 'length', value: descriptor.length }] };
      return { kind: 'edges', expectedCount: 1, predicates: [{ kind: 'circle', center: descriptor.center, axis: descriptor.axis, radius: descriptor.radius },
        { kind: 'length', value: descriptor.length }, ...(!descriptor.closed ? [{ kind: 'arc-points' as const, start: descriptor.start, end: descriptor.end, midpoint: descriptor.midpoint }] : [])] };
    });
    const selection = { queries, expectedCount: entries.length };
    this.selectedEdges(selection, parameters);
    return { bodyId: request.bodyId, buildId, purpose: request.purpose, selection };
  }
  /** How this body's edges and faces meet, read on first request and kept with the build. */
  adjacency(bodyId: string, buildId: string): CadTopologyAdjacency {
    if (this.disposed) throw new CadError('STALE_BUILD', 'The topology snapshot has been disposed. Rebuild the current document.');
    return { bodyId, buildId, ...(this.adjacencyData ??= readAdjacency([...this.entries.values()])) };
  }
  private adjacencyData?: Omit<CadTopologyAdjacency, 'bodyId' | 'buildId'>;
  dispose() { if (this.disposed) return; this.disposed = true; for (const entry of this.entries.values()) cadKernelDisposeShape(entry.shape); this.entries.clear(); this.indices.clear(); }
}
