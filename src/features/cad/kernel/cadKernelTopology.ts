import { Edge, Face, HASH_CODE_MAX, getOC, type Shape3D, type ShapeEdgeMesh, type ShapeMesh, type Vector } from 'replicad';
import type { gp_Dir, gp_Pnt } from 'replicad-opencascadejs';
import { CadError } from '../../../domain/cad/cadError';
import type { CadMeshTopologyGroup } from '../../../domain/cad/cadDocument';
import {
  parseCadEdgeSelection, parseCadFaceQuery, resolveCadEdgeSelection, resolveCadFaceQuery,
  type CadTopologyDescriptor, type CadTopologyInspectRequest, type CadTopologyInspectResult,
  type CadTopologyResolvePicksRequest, type CadTopologyResolvePicksResult, type CadTopologyPick,
  type CadVector3, type CadEdgeQuery, type CadFaceQuery, type ResolvedCadEdgePredicate, type ResolvedCadFacePredicate,
  type CadEdgeSelection,
  MAX_CAD_TOPOLOGY_PER_BODY,
} from '../../../domain/cad/cadTopology';
type EdgeDescriptor = Extract<CadTopologyDescriptor, { kind: 'edge' }>;
type FaceDescriptor = Extract<CadTopologyDescriptor, { kind: 'face' }>;
type Entry = { kind: 'edge'; key: string; shape: Edge; descriptor?: EdgeDescriptor }
  | { kind: 'face'; key: string; shape: Face; descriptor?: FaceDescriptor };
const dot = (a: CadVector3, b: CadVector3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: CadVector3, b: CadVector3): CadVector3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: CadVector3, b: CadVector3): CadVector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: CadVector3) => Math.hypot(...a);
const parallel = (a: CadVector3, b: CadVector3) => norm(cross(a, b)) <= 1e-10;
const tolerance = (...values: number[]) => Math.max(1e-7, 8 * Number.EPSILON * Math.max(1, ...values.map(Math.abs)));
const sameNumber = (a: number, b: number) => Math.abs(a - b) <= tolerance(a, b);
const samePoint = (a: CadVector3, b: CadVector3) => norm(subtract(a, b)) <= tolerance(...a, ...b);
const tuple = (point: gp_Pnt | gp_Dir): CadVector3 => [point.X(), point.Y(), point.Z()];
function vectorTuple(vector: Vector): CadVector3 { try { return vector.toTuple(); } finally { vector.delete(); } }

function boundsOf(shape: Edge | Face): CadTopologyDescriptor['bounds'] {
  const box = shape.boundingBox;
  try { const [min, max] = box.bounds; return { min, max }; } finally { box.delete(); }
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
    const start = vectorTuple(curve.startPoint); const end = vectorTuple(curve.endPoint);
    if (nativeType === 'LINE') return { ...base, curveType: 'line', start, end };
    const adaptor = new (getOC()).BRepAdaptor_Curve(entry.shape.wrapped);
    try {
      const circle = adaptor.Circle(); const center = circle.Location(); const axis = circle.Axis(); const direction = axis.Direction();
      try {
        return { ...base, curveType: 'circle', start, end, midpoint: vectorTuple(curve.pointAt(.5)),
          center: tuple(center), axis: tuple(direction), radius: circle.Radius(), closed: curve.isClosed };
      } finally { direction.delete(); axis.delete(); center.delete(); circle.delete(); }
    } finally { adaptor.delete(); }
  } finally { curve.delete(); }
}
function describeFace(entry: Extract<Entry, { kind: 'face' }>): FaceDescriptor {
  const { measure: area, centroid } = propertiesOf(entry.shape, true);
  const base = { key: entry.key, kind: entry.kind, area, centroid, bounds: boundsOf(entry.shape) };
  const surface = entry.shape.surface;
  try {
    const nativeType = surface.surfaceType;
    if (nativeType !== 'PLANE' && nativeType !== 'CYLINDRE') return { ...base, surfaceType: 'other', nativeType };
    const adaptor = new (getOC()).BRepAdaptor_Surface(entry.shape.wrapped, false);
    try {
      if (nativeType === 'PLANE') {
        const plane = adaptor.Plane(); const origin = plane.Location();
        try {
          // A reflected surface may reverse its parameter-frame handedness.
          // The plane axis plus TopAbs orientation alone then points inward.
          // BRepGProp evaluates the oriented surface normal in world coordinates.
          const rawNormal = vectorTuple(entry.shape.normalAt());
          const magnitude = norm(rawNormal);
          if (!Number.isFinite(magnitude) || magnitude <= Number.EPSILON) throw new CadError('unsupported-selection', 'The planar face has no reliable oriented normal.');
          const normal: CadVector3 = [rawNormal[0] / magnitude, rawNormal[1] / magnitude, rawNormal[2] / magnitude];
          return { ...base, surfaceType: 'plane', normal, offset: dot(normal, tuple(origin)) };
        } finally { origin.delete(); plane.delete(); }
      }
      const cylinder = adaptor.Cylinder(); const origin = cylinder.Location(); const axis = cylinder.Axis(); const direction = axis.Direction();
      try { return { ...base, surfaceType: 'cylinder', origin: tuple(origin), axis: tuple(direction), radius: cylinder.Radius() }; }
      finally { direction.delete(); axis.delete(); origin.delete(); cylinder.delete(); }
    } finally { adaptor.delete(); }
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
      return length > 1e-7 && parallel([direction[0] / length, direction[1] / length, direction[2] / length], predicate.direction);
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
    case 'area': return Math.abs(face.area - predicate.value) <= Math.max(1e-7, 1e-7 * Math.sqrt(Math.max(face.area, predicate.value)), tolerance(face.area, predicate.value));
    case 'plane': return face.surfaceType === 'plane' && norm(subtract(face.normal, predicate.normal)) <= 1e-10 && sameNumber(face.offset, predicate.offset);
    case 'cylinder': return face.surfaceType === 'cylinder' && parallel(face.axis, predicate.axis) && sameNumber(face.radius, predicate.radius)
      && norm(cross(subtract(face.origin, predicate.origin), predicate.axis)) <= tolerance(...face.origin, ...predicate.origin);
    default: { const exhaustive: never = predicate; return exhaustive; }
  }
}
function exactCount(actual: number, expected: number) {
  if (actual !== expected) throw new CadError(actual === 0 ? 'selection-empty' : 'selection-count-mismatch',
    `The geometric selector matched ${actual} element(s), but requires exactly ${expected}. Revise the selector; ambiguous matches are never chosen automatically.`);
}

/** One bounded topology inventory owns native handles; descriptors are computed on demand. */
export class CadKernelTopology {
  private readonly entries = new Map<string, Entry>();
  private readonly hashes = new Map<string, Entry>();
  private disposed = false;
  constructor(shape: Shape3D) {
    const oc = getOC();
    try {
      for (const kind of ['edge', 'face'] as const) {
        const explorer = new oc.TopExp_Explorer(shape.wrapped, kind === 'edge' ? oc.TopAbs_ShapeEnum.TopAbs_EDGE : oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
        try {
          while (explorer.More()) {
            const raw = explorer.Current();
            try {
              const hash = `${kind}:${oc.ReplicadShapeHasher.HashCode(raw, HASH_CODE_MAX)}`;
              const existing = this.hashes.get(hash);
              if (existing && !existing.shape.wrapped.IsSame(raw)) throw new CadError('topology-id-collision', 'Two different topology elements have the same kernel hash. Picking is unavailable for this model.');
              if (!existing) {
                if (this.entries.size >= MAX_CAD_TOPOLOGY_PER_BODY) throw new CadError('topology-limit', `Each body may contain at most ${MAX_CAD_TOPOLOGY_PER_BODY} distinct faces and edges. Simplify the model.`);
                const key = `${kind}-${crypto.randomUUID()}`;
                const entry: Entry = kind === 'edge' ? { kind, key, shape: new Edge(oc.TopoDS.Edge(raw)) } : { kind, key, shape: new Face(oc.TopoDS.Face(raw)) };
                this.entries.set(key, entry); this.hashes.set(hash, entry);
              }
            } finally { raw.delete(); }
            explorer.Next();
          }
        } finally { explorer.delete(); }
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
    const keyFor = (kind: Entry['kind'], hash: number) => {
      const entry = this.hashes.get(`${kind}:${hash}`);
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
        if (descriptor.kind !== 'edge' || descriptor.curveType === 'other' || descriptor.length <= 1e-7) throw new CadError('unsupported-selection', 'Selected edge operations currently require non-degenerate lines or circular arcs.');
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
      if (descriptor.kind !== 'edge' || descriptor.curveType === 'other' || descriptor.length <= 1e-7) throw new CadError('unsupported-selection', 'Select non-degenerate line or circular edges for fillet/chamfer.');
      if (descriptor.curveType === 'line') return { kind: 'edges', expectedCount: 1, predicates: [{ kind: 'line-endpoints', start: descriptor.start, end: descriptor.end }, { kind: 'length', value: descriptor.length }] };
      return { kind: 'edges', expectedCount: 1, predicates: [{ kind: 'circle', center: descriptor.center, axis: descriptor.axis, radius: descriptor.radius },
        { kind: 'length', value: descriptor.length }, ...(!descriptor.closed ? [{ kind: 'arc-points' as const, start: descriptor.start, end: descriptor.end, midpoint: descriptor.midpoint }] : [])] };
    });
    const selection = { queries, expectedCount: entries.length };
    this.selectedEdges(selection, parameters);
    return { bodyId: request.bodyId, buildId, purpose: request.purpose, selection };
  }
  dispose() { if (this.disposed) return; this.disposed = true; for (const entry of this.entries.values()) entry.shape.delete(); this.entries.clear(); this.hashes.clear(); }
}
