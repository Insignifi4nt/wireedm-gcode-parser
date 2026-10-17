import { cadAnalyticSegments, cadPathClosureTolerance, type ResolvedCadPathSegment } from './cadAnalyticSegments';
import type { CadSketchGraph, CadSketchGraphEntity } from './cadSketchGraph';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { evaluateCadScalar } from './cadExpression';
import { classifyPathSegmentIntersection, expandBounds, spatialCellSizeForSegments } from '@/domain/path-intel/intersections';
import { closedPathContainsPoint } from '@/domain/path-intel/pathContainment';
import { arcBounds, arcParameterAtPoint, createArcSegment, createLineSegment, normalizeAngle, pointOnArcAtParameter, pointOnCircle, signedAreaOfPath } from '@/domain/path-intel/segments';
import { SpatialHash } from '@/domain/path-intel/spatialIndex';
import type { OrientedSegmentRef, PathSegment, Point2 } from '@/domain/path-intel/types';
import { deepFreezeCadData } from './cadDeepFreeze';

export type CadSketchArrangementEvent =
  | { readonly kind: 'point'; readonly pointId: string }
  | { readonly kind: 'intersection'; readonly entityIds: readonly [string, string]; readonly branch: 'single' | 'first' | 'second' | 'left' | 'right' | 'tangent' | 'start' | 'end' }
  | { readonly kind: 'circle-seam'; readonly entityId: string };
export interface CadSketchArrangementSourceRef {
  readonly entityId: string;
  /** Authored line/arc parameter, or CCW circle turns. A wrap may exceed one turn. */
  readonly from: number;
  readonly to: number;
  readonly fromEvents: readonly CadSketchArrangementEvent[];
  readonly toEvents: readonly CadSketchArrangementEvent[];
}
export interface CadSketchArrangementBoundary {
  readonly key: string;
  readonly sourceRefs: readonly CadSketchArrangementSourceRef[];
  readonly path: readonly ResolvedCadPathSegment[];
  readonly signedArea: number;
}
export interface CadSketchArrangementCell {
  /** Topological descriptor, not an ordinal or coordinate hash. Not yet a persisted reference format. */
  readonly key: string;
  readonly geometryKey: string;
  readonly outer: CadSketchArrangementBoundary;
  readonly holes: readonly CadSketchArrangementBoundary[];
  readonly area: number;
}
export interface CadSketchArrangementIssue {
  readonly code: 'overlap' | 'ambiguous-tangency' | 'precision' | 'non-simple-boundary';
  readonly entityIds: readonly string[];
  readonly message: string;
}
export interface CadSketchArrangement {
  readonly cells: readonly CadSketchArrangementCell[];
  readonly sources: readonly { readonly entityId: string; readonly knots: readonly {
    readonly parameter: number; readonly events: readonly CadSketchArrangementEvent[]
  }[] }[];
  /** Any uncertainty withholds all cells. The authoritative graph is never repaired. */
  readonly issues: readonly CadSketchArrangementIssue[];
}
type IntersectionBranch = Extract<CadSketchArrangementEvent, { kind: 'intersection' }>['branch'];
interface Vertex {
  point: Point2; parent: Vertex | null; events: Map<string, CadSketchArrangementEvent>; branches: Map<string, IntersectionBranch>;
  eventSnapshot: readonly CadSketchArrangementEvent[] | null; keySnapshot: string | null; outgoing: HalfEdge[];
}
interface Knot { parameter: number; vertex: Vertex }
interface Source { entity: CadSketchGraphEntity; segment: PathSegment; knots: Knot[] }
interface Edge { id: number; source: Source; from: Knot; to: Knot; segment: PathSegment }
interface HalfEdge { edge: Edge; reversed: boolean; origin: Vertex; target: Vertex; angle: number; next: HalfEdge | null }
interface Walk { boundary: CadSketchArrangementBoundary; halves: HalfEdge[]; component: number }
const turn = 2 * Math.PI;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y);
const boundsPoints = (segment: PathSegment) => [{ x: segment.bounds.minX, y: segment.bounds.minY }, { x: segment.bounds.maxX, y: segment.bounds.maxY }];
function root(vertex: Vertex): Vertex {
  let owner = vertex;
  while (owner.parent) owner = owner.parent;
  while (vertex.parent) { const previous = vertex.parent; vertex.parent = owner; vertex = previous; }
  return owner;
}
function events(vertex: Vertex): readonly CadSketchArrangementEvent[] {
  const owner = root(vertex);
  owner.eventSnapshot ??= [...owner.events].sort(([a], [b]) => compare(a, b)).map(([, event]) => event);
  return owner.eventSnapshot;
}
function vertexKey(vertex: Vertex): string {
  const owner = root(vertex);
  owner.keySnapshot ??= JSON.stringify(events(owner));
  return owner.keySnapshot;
}
function unionMap<T>(left: Map<string, T>, right: Map<string, T>): Map<string, T> {
  const target = left.size >= right.size ? left : right, source = target === left ? right : left;
  for (const [key, value] of source) target.set(key, value);
  return target;
}
function canonicalRotation(tokens: readonly string[]): string {
  let best: string | undefined;
  const minimum = [...tokens].sort(compare)[0];
  for (let index = 0; index < tokens.length; index++) if (tokens[index] === minimum) {
    const value = JSON.stringify([...tokens.slice(index), ...tokens.slice(0, index)]);
    if (best === undefined || value < best) best = value;
  }
  return best ?? '[]';
}
function at(segment: PathSegment, parameter: number): Point2 {
  if (segment.kind === 'circle') return pointOnCircle(segment.center, segment.radius, parameter * turn);
  if (parameter === 0) return segment.start;
  if (parameter === 1) return segment.end;
  return segment.kind === 'arc' ? pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, parameter)
    : { x: segment.start.x + (segment.end.x - segment.start.x) * parameter, y: segment.start.y + (segment.end.y - segment.start.y) * parameter };
}
function parameterAt(segment: PathSegment, point: Point2): number | null {
  if (segment.kind !== 'circle') {
    if (distance(point, segment.start) === 0) return 0;
    if (distance(point, segment.end) === 0) return 1;
  }
  if (segment.kind === 'circle') return normalizeAngle(Math.atan2(point.y - segment.center.y, point.x - segment.center.x)) / turn;
  if (segment.kind === 'arc') return arcParameterAtPoint(segment, { segmentId: segment.id, reversed: false }, point);
  const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
  const value = Math.abs(dx) >= Math.abs(dy) ? (point.x - segment.start.x) / dx : (point.y - segment.start.y) / dy;
  return value >= 0 && value <= 1 ? value : null;
}
function crossingEvent(left: PathSegment, right: PathSegment, point: Point2): CadSketchArrangementEvent {
  const entityIds: readonly [string, string] = [left.id, right.id];
  if (left.kind === 'line' && right.kind === 'line') return { kind: 'intersection', entityIds, branch: 'single' };
  const line = left.kind === 'line' ? left : right.kind === 'line' ? right : null;
  const circular = left.kind !== 'line' ? left : right.kind !== 'line' ? right : null;
  if (line && circular) {
    const dx = line.end.x - line.start.x, dy = line.end.y - line.start.y;
    const side = (point.x - circular.center.x) * dx + (point.y - circular.center.y) * dy;
    return { kind: 'intersection', entityIds, branch: side < 0 ? 'first' : side > 0 ? 'second' : 'tangent' };
  }
  if (left.kind !== 'line' && right.kind !== 'line') {
    const dx = right.center.x - left.center.x, dy = right.center.y - left.center.y;
    if (dx === 0 && dy === 0) return { kind: 'intersection', entityIds, branch: distance(point, left.start) <= distance(point, left.end) ? 'start' : 'end' };
    const side = dx * (point.y - left.center.y) - dy * (point.x - left.center.x);
    return { kind: 'intersection', entityIds, branch: side > 0 ? 'left' : side < 0 ? 'right' : 'tangent' };
  }
  return { kind: 'intersection', entityIds, branch: 'single' };
}
function subsegment(source: PathSegment, from: number, to: number, id: string): PathSegment {
  const start = at(source, from), end = at(source, to);
  if (source.kind === 'line') return createLineSegment({ id, source: source.source, start, end });
  if (source.kind === 'circle' && from === 0 && to === 1) return { ...source, id };
  const angle = (source.kind === 'circle' ? 0 : source.startAngleRadians) + from * (source.kind === 'circle' ? turn : source.sweepRadians);
  const sweep = (to - from) * (source.kind === 'circle' ? turn : source.sweepRadians);
  return { ...createArcSegment({ id, source: source.source, start, end, center: source.center, radius: source.radius, sweepRadians: sweep, clockwise: sweep < 0 }),
    startAngleRadians: angle, endAngleRadians: angle + sweep, bounds: arcBounds(source.center, source.radius, angle, sweep, start, end) };
}
function outgoingAngle(source: PathSegment, parameter: number, reversed: boolean): number {
  if (source.kind === 'line') return Math.atan2((source.end.y - source.start.y) * (reversed ? -1 : 1), (source.end.x - source.start.x) * (reversed ? -1 : 1));
  const sweep = source.kind === 'circle' ? turn : source.sweepRadians;
  return (source.kind === 'circle' ? 0 : source.startAngleRadians) + sweep * parameter + Math.sign(sweep) * (reversed ? -1 : 1) * Math.PI / 2;
}
function encoded(half: HalfEdge): ResolvedCadPathSegment {
  const segment = half.edge.segment, reversed = half.reversed;
  if (segment.kind === 'line') {
    const start = reversed ? segment.end : segment.start, end = reversed ? segment.start : segment.end;
    return { kind: 'line', start: [start.x, start.y], end: [end.x, end.y] };
  }
  const angle = segment.kind === 'circle' ? 0 : segment.startAngleRadians;
  const sweep = segment.kind === 'circle' ? turn : segment.sweepRadians;
  return { kind: 'arc', center: [segment.center.x, segment.center.y], radius: segment.radius,
    startAngle: (angle + (reversed ? sweep : 0)) * 180 / Math.PI, sweep: (reversed ? -sweep : sweep) * 180 / Math.PI };
}

/**
 * Transient analytic noding and left-face extraction; no source repair or polygonization.
 * Keys follow source/event topology, including crossing order. Adding even an open-tail event can
 * conservatively invalidate a key. They are not a persisted selector or a topology migration API.
 * Ambiguous contacts/overlaps/precision withhold all cells, including otherwise unaffected components.
 */
export function deriveCadSketchArrangement(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>): CadSketchArrangement {
  const entities = new Map(graph.entities.map(entity => [entity.id, entity]));
  const sources: Source[] = compileCadSketchGraph(graph, parameters).segments.flatMap(segment => {
    const entity = entities.get(segment.id);
    return entity && !entity.construction ? [{ entity, segment, knots: [] }] : [];
  });
  const issues: CadSketchArrangementIssue[] = [];
  const issue = (code: CadSketchArrangementIssue['code'], entityIds: string[], message: string) => issues.push({ code, entityIds: [...new Set(entityIds)].sort(compare), message });
  const finish = (cells: CadSketchArrangementCell[] = []): CadSketchArrangement => {
    const result = { cells: issues.length ? [] : cells, issues, sources: sources.map(source => ({ entityId: source.entity.id,
      knots: source.knots.map(knot => ({ parameter: knot.parameter, events: events(knot.vertex) })) })) }; deepFreezeCadData(result); return result;
  };
  const vertex = (point: Point2, event: CadSketchArrangementEvent): Vertex => ({ point, parent: null, events: new Map([[JSON.stringify(event), event]]),
    branches: event.kind === 'intersection' ? new Map([[JSON.stringify(event.entityIds), event.branch]]) : new Map(), eventSnapshot: null, keySnapshot: null, outgoing: [] });
  const pointVertices = new Map(graph.points.map(point => [point.id, vertex({
    x: evaluateCadScalar(point.position[0], parameters), y: evaluateCadScalar(point.position[1], parameters)
  }, { kind: 'point', pointId: point.id })]));
  for (const source of sources) if (source.entity.kind !== 'circle') {
    const ids = [source.entity.startPointId, source.entity.endPointId];
    for (const parameter of [0, 1]) {
      const id = ids[parameter];
      const node = pointVertices.get(id) ?? vertex(at(source.segment, parameter), { kind: 'point', pointId: id });
      pointVertices.set(id, node); source.knots.push({ parameter, vertex: node });
    }
  }
  const join = (a: Vertex, b: Vertex) => {
    a = root(a); b = root(b);
    if (a === b) return;
    const related = () => [...a.events.values(), ...b.events.values()].flatMap(event => event.kind === 'intersection' ? [...event.entityIds] : event.kind === 'circle-seam' ? [event.entityId] : []);
    if (distance(a.point, b.point) > cadPathClosureTolerance([a.point, b.point])) { issue('precision', related(), 'Intersection events cannot be represented as one roundoff-consistent node.'); return; }
    const small = a.branches.size <= b.branches.size ? a.branches : b.branches, large = small === a.branches ? b.branches : a.branches;
    for (const [pair, branch] of small) if (large.has(pair) && large.get(pair) !== branch) {
      issue('precision', related(), 'Distinct analytic intersection branches cannot be resolved as separate nodes.'); return;
    }
    b.parent = a; a.events = unionMap(a.events, b.events); a.branches = unionMap(a.branches, b.branches);
    a.eventSnapshot = null; a.keySnapshot = null;
  };
  // Accepted explicit coincidence declares a transient joint, while keeping both saved identities
  // and each source support unchanged. The graph compiler already checked its world-mm residual.
  for (const relation of graph.relations) if (relation.kind === 'coincident') {
    const a = pointVertices.get(relation.pointIds[0]), b = pointVertices.get(relation.pointIds[1]);
    if (a && b) join(a, b);
  }
  const endpointIds = (source: Source) => source.entity.kind === 'circle' ? [] : [source.entity.startPointId, source.entity.endPointId];
  const coincidenceGroups = new Map<Vertex, { id: string; point: Point2 }[]>();
  for (const [id, node] of pointVertices) {
    const owner = root(node), members = coincidenceGroups.get(owner) ?? [];
    members.push({ id, point: node.point }); coincidenceGroups.set(owner, members);
  }
  for (const members of coincidenceGroups.values()) {
    if (members.length < 2) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { point } of members) { minX = Math.min(minX, point.x); minY = Math.min(minY, point.y); maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y); }
    if (Math.hypot(maxX - minX, maxY - minY) <= cadPathClosureTolerance(members.map(member => member.point))) continue;
    let unresolved = false;
    for (let left = 0; left < members.length && !unresolved; left++) for (let right = left + 1; right < members.length; right++) {
      if (distance(members[left].point, members[right].point) > cadPathClosureTolerance([members[left].point, members[right].point])) { unresolved = true; break; }
    }
    if (unresolved) {
      const ids = new Set(members.map(member => member.id));
      issue('precision', sources.filter(source => endpointIds(source).some(id => ids.has(id))).map(source => source.entity.id), 'A coincidence component spans more than one roundoff-consistent joint.');
    }
  }
  if (issues.length) return finish();
  const declaredJoints = new Map<string, string>(), jointKeys = new Map<Vertex, string>();
  for (const [id, node] of pointVertices) {
    const owner = root(node), key = jointKeys.get(owner) ?? vertexKey(owner);
    jointKeys.set(owner, key); declaredJoints.set(id, key);
  }
  const knot = (source: Source, parameter: number, node: Vertex): Vertex => {
    const existing = source.knots.find(item => {
      const difference = Math.abs(item.parameter - parameter);
      return (source.segment.kind === 'circle' ? Math.min(difference, 1 - difference) : difference) <= 32 * Number.EPSILON
        || distance(at(source.segment, item.parameter), at(source.segment, parameter)) <= cadPathClosureTolerance([node.point, item.vertex.point]);
    });
    if (existing) {
      const exactEndpoint = (parameter === 0 || parameter === 1) && distance(at(source.segment, parameter), node.point) === 0;
      if (root(existing.vertex) !== root(node) && !exactEndpoint) {
        issue('precision', [source.entity.id], 'Distinct or multiway analytic events cannot be identified by nearby parameters or coordinates.');
        return root(existing.vertex);
      }
      join(existing.vertex, node); return root(existing.vertex);
    }
    source.knots.push({ parameter, vertex: node }); return node;
  };
  const segments = sources.map(source => source.segment);
  const broadEpsilon = cadPathClosureTolerance(segments.flatMap(boundsPoints));
  const spatial = new SpatialHash<Source>({ cellSize: spatialCellSizeForSegments(segments, broadEpsilon) });
  for (const source of sources) {
    for (const other of spatial.queryBounds(expandBounds(source.segment.bounds, broadEpsilon))) {
      const epsilon = cadPathClosureTolerance([...boundsPoints(source.segment), ...boundsPoints(other.segment)]);
      // Broad-phase roundoff bounds must not become a physical coincidence/healing tolerance.
      const relation = classifyPathSegmentIntersection(other.segment, source.segment, 0);
      if (relation.kind === 'overlap') { issue('overlap', [other.entity.id, source.entity.id], 'Overlapping analytic loci require an explicit source-ownership decision.'); continue; }
      for (const candidate of relation.points) {
        const candidateEvent = crossingEvent(other.segment, source.segment, candidate);
        const declaredEndpoint = endpointIds(other).some((id, left) => endpointIds(source).some((otherId, right) =>
          declaredJoints.get(id) === declaredJoints.get(otherId)
            && JSON.stringify(crossingEvent(other.segment, source.segment, at(other.segment, left))) === JSON.stringify(candidateEvent)
            && distance(at(other.segment, left), candidate) <= epsilon && distance(at(source.segment, right), candidate) <= epsilon));
        if (declaredEndpoint) continue;
        const point = candidate;
        const nearbyEndpoint = [other, source].some(item => endpointIds(item).some((_, index) => {
          const endpoint = at(item.segment, index), gap = distance(endpoint, point);
          return gap > 0 && gap <= epsilon;
        }));
        if (nearbyEndpoint) { issue('precision', [other.entity.id, source.entity.id], 'A distinct analytic event is unresolved beside an endpoint.'); continue; }
        const left = parameterAt(other.segment, point), right = parameterAt(source.segment, point);
        if (left === null || right === null || distance(at(other.segment, left), point) > epsilon || distance(at(source.segment, right), point) > epsilon) {
          issue('precision', [other.entity.id, source.entity.id], 'An analytic intersection cannot be reproduced within source roundoff precision.'); continue;
        }
        const node = vertex(point, candidateEvent);
        join(knot(other, left, node), knot(source, right, node));
      }
    }
    spatial.insertBounds(source.segment.bounds, source);
  }
  if (issues.length) return finish();
  const edges: Edge[] = [];
  for (const source of sources) {
    if (source.knots.length === 0) source.knots.push({ parameter: 0, vertex: vertex(source.segment.start, { kind: 'circle-seam', entityId: source.entity.id }) });
    source.knots.sort((a, b) => a.parameter - b.parameter);
    const count = source.segment.kind === 'circle' ? source.knots.length : source.knots.length - 1;
    for (let index = 0; index < count; index++) {
      const from = source.knots[index], next = source.knots[(index + 1) % source.knots.length];
      const to = { ...next, parameter: next.parameter + (index + 1 === source.knots.length ? 1 : 0) };
      const id = edges.length, segment = subsegment(source.segment, from.parameter, to.parameter, `arrangement_${id}`);
      if (segment.kind !== 'circle' && segment.length <= cadPathClosureTolerance(boundsPoints(segment))) { issue('precision', [source.entity.id], 'Intersection events create an unresolved analytic edge.'); continue; }
      const edge: Edge = { id, source, from, to, segment };
      const forward: HalfEdge = { edge, reversed: false, origin: root(from.vertex), target: root(to.vertex), angle: normalizeAngle(outgoingAngle(source.segment, from.parameter, false)), next: null };
      const backward: HalfEdge = { edge, reversed: true, origin: root(to.vertex), target: root(from.vertex), angle: normalizeAngle(outgoingAngle(source.segment, to.parameter, true)), next: null };
      edges.push(edge); root(from.vertex).outgoing.push(forward); root(to.vertex).outgoing.push(backward);
    }
  }
  if (issues.length) return finish();
  const vertices = [...new Set(edges.flatMap(edge => [root(edge.from.vertex), root(edge.to.vertex)]))];
  for (const node of vertices) {
    node.outgoing.sort((a, b) => a.angle - b.angle);
    for (let index = 0; index < node.outgoing.length; index++) {
      const left = node.outgoing[index], right = node.outgoing[(index + 1) % node.outgoing.length];
      if (left === right) continue;
      const delta = normalizeAngle(right.angle - left.angle);
      if (Math.min(delta, turn - delta) <= 64 * Number.EPSILON) issue('ambiguous-tangency', [left.edge.source.entity.id, right.edge.source.entity.id], 'Tangent outgoing edges have no unambiguous angular order.');
    }
  }
  if (issues.length) return finish();
  interface Frame { node: Vertex; parent: Frame | null; parentEdge: number; time: number; low: number; cursor: number }
  const bridges = new Set<number>(), discovered = new Map<Vertex, Frame>();
  let clock = 0;
  for (const node of vertices) if (!discovered.has(node)) {
    const first: Frame = { node, parent: null, parentEdge: -1, time: ++clock, low: clock, cursor: 0 };
    const stack = [first]; discovered.set(node, first);
    while (stack.length) {
      const current = stack[stack.length - 1], half = current.node.outgoing[current.cursor++];
      if (!half) {
        stack.pop();
        if (current.parent) {
          current.parent.low = Math.min(current.parent.low, current.low);
          if (current.low > current.parent.time) bridges.add(current.parentEdge);
        }
        continue;
      }
      if (half.edge.id === current.parentEdge) continue;
      const seen = discovered.get(half.target);
      if (seen) current.low = Math.min(current.low, seen.time);
      else {
        const child: Frame = { node: half.target, parent: current, parentEdge: half.edge.id, time: ++clock, low: clock, cursor: 0 };
        discovered.set(half.target, child); stack.push(child);
      }
    }
  }
  for (const node of vertices) node.outgoing = node.outgoing.filter(half => !bridges.has(half.edge.id));
  for (const node of vertices) for (const half of node.outgoing) {
    const outgoing = half.target.outgoing, index = outgoing.findIndex(candidate => candidate.edge === half.edge && candidate.reversed !== half.reversed);
    half.next = outgoing[(index + outgoing.length - 1) % outgoing.length];
  }
  const byId = new Map(edges.map(edge => [edge.segment.id, edge.segment]));
  const visited = new Set<HalfEdge>(), walks: Walk[] = [], componentByVertex = new Map<Vertex, number>();
  for (const node of vertices) {
    if (componentByVertex.has(node) || !node.outgoing.length) continue;
    const id = componentByVertex.size, queue = [node]; componentByVertex.set(node, id);
    for (let index = 0; index < queue.length; index++) for (const half of queue[index].outgoing) if (!componentByVertex.has(half.target)) {
      componentByVertex.set(half.target, id); queue.push(half.target);
    }
  }
  for (const node of vertices) for (const first of node.outgoing) {
    if (visited.has(first)) continue;
    const halves: HalfEdge[] = []; let half: HalfEdge | null = first;
    while (half && !visited.has(half)) { visited.add(half); halves.push(half); half = half.next; }
    if (half !== first) { issue('precision', halves.map(item => item.edge.source.entity.id), 'The transient face walk did not close.'); continue; }
    const refs: OrientedSegmentRef[] = halves.map(item => ({ segmentId: item.edge.segment.id, reversed: item.reversed }));
    const area = signedAreaOfPath(refs, byId), path = halves.map(encoded);
    const encodedPath = cadAnalyticSegments(path).segments;
    if (!Number.isFinite(area) || encodedPath.some((segment, index) => distance(segment.end, encodedPath[(index + 1) % encodedPath.length].start) > cadPathClosureTolerance([segment.end, encodedPath[(index + 1) % encodedPath.length].start]))) {
      issue('precision', halves.map(item => item.edge.source.entity.id), 'A face boundary cannot reproduce its analytic joints within saved path precision.'); continue;
    }
    const sourceRefs = halves.map((item): CadSketchArrangementSourceRef => ({ entityId: item.edge.source.entity.id,
      from: item.reversed ? item.edge.to.parameter : item.edge.from.parameter, to: item.reversed ? item.edge.from.parameter : item.edge.to.parameter,
      fromEvents: events(item.origin), toEvents: events(item.target) }));
    const key = canonicalRotation(halves.map(item => JSON.stringify([item.edge.source.entity.id, vertexKey(item.origin), vertexKey(item.target), item.reversed])));
    walks.push({ halves, component: componentByVertex.get(node) ?? -1, boundary: { key, sourceRefs, path, signedArea: area } });
  }
  if (issues.length) return finish();
  const positive = walks.filter(walk => walk.boundary.signedArea > 0), holes = new Map<Walk, Walk[]>();
  for (const hole of walks.filter(walk => walk.boundary.signedArea < 0)) {
    const sample = hole.halves[0]?.origin.point;
    if (!sample) continue;
    const owner = positive.filter(candidate => candidate.component !== hole.component && closedPathContainsPoint(
      candidate.halves.map(half => ({ segmentId: half.edge.segment.id, reversed: half.reversed })), sample, byId
    )).sort((a, b) => a.boundary.signedArea - b.boundary.signedArea)[0];
    if (owner) { const list = holes.get(owner) ?? []; list.push(hole); holes.set(owner, list); }
  }
  const cells = positive.map((walk): CadSketchArrangementCell => {
    const inner = (holes.get(walk) ?? []).sort((a, b) => compare(a.boundary.key, b.boundary.key));
    for (const boundary of [walk, ...inner]) if (new Set(boundary.halves.map(half => half.origin)).size !== boundary.halves.length) issue('non-simple-boundary', boundary.halves.map(half => half.edge.source.entity.id), 'A bounded cell has a self-touching boundary.');
    return { key: JSON.stringify([walk.boundary.key, inner.map(item => item.boundary.key)]), geometryKey: JSON.stringify([walk.boundary.path, inner.map(item => item.boundary.path)]),
      outer: walk.boundary, holes: inner.map(item => item.boundary), area: walk.boundary.signedArea + inner.reduce((sum, item) => sum + item.boundary.signedArea, 0) };
  }).sort((a, b) => compare(a.key, b.key));
  return finish(cells);
}
