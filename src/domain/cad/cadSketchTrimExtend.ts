import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema, CadNumberSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { parseCadSketchGraph, type CadSketchGraph } from './cadSketchGraph';
import { isCadImportData } from './cadImportData';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds } from './cadSketchGraphReferences';
import { resolveCadSketchGraphJoints } from './cadSketchGraphJoints';
import { evaluateCadScalar } from './cadExpression';
import { classifyParameterizedPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { createArcSegment, createLineSegment, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { PathSegment, Point2 } from '@/domain/path-intel/types';

const strict = { additionalProperties: false }, id = CadIdentifierSchema;
const parameter = Type.Number({ minimum: 0, maximum: 1 });
const boundary = Type.Object({ entityId: id, index: Type.Integer({ minimum: 0, maximum: 1 }), parameter,
  position: Type.Tuple([CadNumberSchema, CadNumberSchema]), endpointPointId: Type.Optional(id) }, strict);
export const CadSketchTrimTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('delete'), entityId: id, parameter }, strict),
  Type.Object({ kind: Type.Literal('end'), entityId: id, parameter, end: Type.Union([Type.Literal('start'), Type.Literal('end')]),
    boundary, cutPointId: id }, strict)
]);
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type CadSketchTrimTarget = Immutable<Static<typeof CadSketchTrimTargetSchema>>;
export type CadSketchEndTrimTarget = Extract<CadSketchTrimTarget, { kind: 'end' }>;
export interface CadSketchEndTrimPreparation {
  readonly target: Extract<CadSketchTrimTarget, { kind: 'delete' }> | Omit<CadSketchEndTrimTarget, 'cutPointId'>;
  readonly removed: PathSegment;
  readonly survivor: PathSegment | null;
  readonly boundary: PathSegment | null;
  readonly point: readonly [number, number] | null;
}
export interface CadSketchTrimResult {
  readonly graph: CadSketchGraph;
  readonly retainedEntityId: string | null;
  readonly removedEntityId: string | null;
  readonly cutPointId: string | null;
}
export class CadSketchTrimDependencyError extends CadError {
  readonly relationIds: readonly string[];
  readonly pointIds: readonly string[];
  constructor(relationIds: readonly string[], pointIds: readonly string[]) {
    super('dependent-sketch-trim', 'Remove or recreate the relations and endpoint drivers affected by this trim before trimming.');
    this.relationIds = Object.freeze([...relationIds]); this.pointIds = Object.freeze([...pointIds]);
  }
}
interface Source {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>;
}
type OpenSegment = Exclude<PathSegment, { kind: 'circle' }>;
type Witness = CadSketchEndTrimTarget['boundary'];
interface Event { witness: Witness; boundary: PathSegment; point: Point2 }
const precision = () => new CadError('sketch-trim-precision', 'This intersection cannot leave an exact nondegenerate end trim at these coordinates.');
const ambiguous = () => new CadError('ambiguous-sketch-trim', 'Trim needs a unique transverse intersection; overlapping, tangent or undeclared coincident boundaries need explicit repair.');
function freezeData(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freezeData(child);
  Object.freeze(value);
}
function at(segment: OpenSegment, t: number): Point2 {
  return segment.kind === 'line' ? { x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t }
    : pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, t);
}
function distance(a: Readonly<Point2>, b: Readonly<Point2>): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function extent(segment: PathSegment): Point2[] {
  return [{ x: segment.bounds.minX, y: segment.bounds.minY }, { x: segment.bounds.maxX, y: segment.bounds.maxY }];
}
function tangent(segment: PathSegment, point: Readonly<Point2>): Point2 {
  const vector = segment.kind === 'line' ? { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
    : { x: -(point.y - segment.center.y), y: point.x - segment.center.x };
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-7) throw precision();
  return { x: vector.x / length, y: vector.y / length };
}
function assertDependencies(graph: CadSketchGraph, entityId: string, detached: readonly string[]) {
  const owners = graph.relations.filter(relation => cadSketchRelationEntityIds(relation).includes(entityId)
    || cadSketchRelationPointIds(graph, relation).some(id => detached.includes(id)));
  const drivers = detached.filter(id => graph.points.find(point => point.id === id)?.position.some(value => typeof value === 'string')
    || owners.some(relation => cadSketchRelationPointIds(graph, relation).includes(id)));
  if (owners.length || drivers.length) throw new CadSketchTrimDependencyError(owners.map(relation => relation.id), drivers);
}
function partition(segment: OpenSegment, point: Point2, t: number): readonly [OpenSegment, OpenSegment] {
  const minimum = Math.max(1e-7, cadPathClosureTolerance([segment.start, point, segment.end]));
  if (distance(segment.start, point) <= minimum || distance(point, segment.end) <= minimum) throw precision();
  if (segment.kind === 'line') return [createLineSegment({ ...segment, end: point }), createLineSegment({ ...segment, start: point })];
  const first = createArcSegment({ ...segment, end: point, sweepRadians: undefined });
  const second = createArcSegment({ ...segment, start: point, sweepRadians: undefined });
  const firstSweep = segment.sweepRadians * t;
  const expected = [firstSweep, segment.sweepRadians - firstSweep];
  const tolerance = cadPathClosureTolerance([segment.center, segment.start, segment.end, point]);
  const pieces = [first, second];
  if (pieces.some((piece, i) => Math.abs(piece.radius - segment.radius) > tolerance
      || Math.abs(distance(piece.center, piece.end) - piece.radius) > tolerance
      || Math.abs(piece.sweepRadians - expected[i]) >= Math.PI
      || Math.abs(piece.sweepRadians - expected[i]) * segment.radius > tolerance
      || Math.sign(Math.abs(piece.sweepRadians) - Math.PI) !== Math.sign(Math.abs(expected[i]) - Math.PI))
    || Math.abs(first.sweepRadians + second.sweepRadians - segment.sweepRadians) * segment.radius > tolerance) throw precision();
  return [first, second];
}

/** One clicked outer span, with no inferred interior attachment or relation transfer. */
export function prepareCadSketchEndTrim({ graph: input, parameters, entityId, parameter: pick }: Source & {
  readonly entityId: string; readonly parameter: number;
}): CadSketchEndTrimPreparation {
  if (!Number.isFinite(pick) || pick < 0 || pick > 1) throw new CadError('invalid-sketch-trim', 'Choose a finite source parameter from zero to one.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === entityId);
  if (!entity || entity.kind === 'circle') throw new CadError('invalid-sketch-trim-target', 'End trim supports a line or open arc.');
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entityId);
  if (!segment || segment.kind === 'circle') throw new CadError('invalid-sketch-trim-target', 'End trim supports a line or open arc.');
  const numericPoints = new Map(graph.points.map(point => [point.id, { x: evaluateCadScalar(point.position[0], parameters), y: evaluateCadScalar(point.position[1], parameters) }]));
  const joint = resolveCadSketchGraphJoints(graph, numericPoints), events: Event[] = [];
  for (const other of geometry.segments) {
    if (other.id === entityId) continue;
    const tolerance = cadPathClosureTolerance([...extent(segment), ...extent(other)]);
    const result = classifyParameterizedPathSegmentIntersection(segment, other, tolerance);
    if (result.kind === 'overlap') throw ambiguous();
    if (result.kind !== 'points') continue;
    const hits = [...result.points].sort((a, b) => (a.leftParameter ?? -1) - (b.leftParameter ?? -1));
    for (const [index, hit] of hits.entries()) {
      const t = hit.leftParameter;
      if (t === null) throw precision();
      if (t < 0 || t > 1) throw precision();
      const point = at(segment, t);
      if (distance(point, hit.point) > tolerance) throw precision();
      if (other.kind === 'circle') {
        if (Math.abs(distance(point, other.center) - other.radius) > tolerance) throw precision();
      } else if (hit.rightParameter === null || hit.rightParameter < 0 || hit.rightParameter > 1
        || distance(point, at(other, hit.rightParameter)) > tolerance) throw precision();
      const u = tangent(segment, point), v = tangent(other, point);
      if (Math.abs(u.x * v.y - u.y * v.x) <= 64 * Number.EPSILON) throw ambiguous();
      if (t === 0 || t === 1) continue;
      const boundaryEntity = graph.entities.find(item => item.id === other.id);
      const endpointPointId = boundaryEntity && boundaryEntity.kind !== 'circle'
        ? hit.rightParameter === 0 ? boundaryEntity.startPointId : hit.rightParameter === 1 ? boundaryEntity.endPointId : undefined : undefined;
      const exact = endpointPointId ? numericPoints.get(endpointPointId) : point;
      if (!exact || distance(exact, point) > tolerance) throw precision();
      events.push({ witness: { entityId: other.id, index, parameter: t, position: [exact.x, exact.y],
        ...(endpointPointId ? { endpointPointId } : {}) }, boundary: other, point: exact });
    }
  }
  events.sort((a, b) => a.witness.parameter - b.witness.parameter || (a.boundary.id < b.boundary.id ? -1 : a.boundary.id > b.boundary.id ? 1 : 0));
  const unique: Event[] = [];
  for (const event of events) {
    const previous = unique.at(-1);
    if (previous && distance(previous.point, event.point) <= cadPathClosureTolerance([previous.point, event.point])) {
      const a = previous.witness.endpointPointId, b = event.witness.endpointPointId;
      if (!a || !b || joint(a) !== joint(b)) throw ambiguous();
      continue;
    }
    unique.push(event);
  }
  if (!unique.length) {
    assertDependencies(graph, entityId, [entity.startPointId, entity.endPointId]);
    const result: CadSketchEndTrimPreparation = { target: { kind: 'delete', entityId, parameter: pick }, removed: segment,
      survivor: null, boundary: null, point: null };
    freezeData(result); return result;
  }
  for (const event of unique) if (Math.abs(pick - event.witness.parameter) * segment.length <= cadPathClosureTolerance([at(segment, pick), event.point]))
    throw new CadError('ambiguous-sketch-trim', 'Choose the portion to remove, away from its intersection.');
  const first = unique[0], last = unique[unique.length - 1];
  const end = pick < first.witness.parameter ? 'start' : pick > last.witness.parameter ? 'end' : null;
  if (!end) throw new CadError('unsupported-sketch-trim-middle', 'Middle trim is not supported yet. Split explicitly before editing both surviving pieces.');
  const event = end === 'start' ? first : last;
  assertDependencies(graph, entityId, [end === 'start' ? entity.startPointId : entity.endPointId]);
  const pieces = partition(segment, event.point, event.witness.parameter);
  const result: CadSketchEndTrimPreparation = { target: { kind: 'end', entityId, parameter: pick, end, boundary: event.witness },
    removed: pieces[end === 'start' ? 0 : 1], survivor: pieces[end === 'start' ? 1 : 0], boundary: event.boundary,
    point: [event.point.x, event.point.y] };
  freezeData(result); return result;
}

/** Recheck the exact preview witness; never retarget a changed source to another intersection. */
export function trimCadSketchEntity({ graph: input, parameters, trim }: Source & { readonly trim: CadSketchTrimTarget }): CadSketchTrimResult {
  if (!isCadImportData(trim) || !Value.Check(CadSketchTrimTargetSchema, trim)) throw new CadError('invalid-sketch-trim', 'Choose one complete end-trim request.');
  const graph = parseCadSketchGraph(input), prepared = prepareCadSketchEndTrim({ graph, parameters, entityId: trim.entityId, parameter: trim.parameter });
  const target = trim.kind === 'delete' ? trim : { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, end: trim.end, boundary: trim.boundary };
  if (!Value.Equal(prepared.target, target)) throw new CadError('stale-sketch-trim', 'The trim boundary changed. Choose the portion again.');
  if (trim.kind === 'delete') return Object.freeze({ graph: parseCadSketchGraph({ ...graph, entities: graph.entities.filter(entity => entity.id !== trim.entityId) }),
    retainedEntityId: null, removedEntityId: trim.entityId, cutPointId: null });
  const endpoint = trim.boundary.endpointPointId;
  if (endpoint !== undefined && trim.cutPointId !== endpoint) throw new CadError('invalid-sketch-trim-point', 'Use the exact witnessed boundary endpoint identity.');
  const candidate = parseCadSketchGraph({ ...graph,
    points: endpoint === undefined ? [...graph.points, { id: trim.cutPointId, position: trim.boundary.position }] : graph.points,
    entities: graph.entities.map(entity => entity.id === trim.entityId ? { ...entity, [trim.end === 'start' ? 'startPointId' : 'endPointId']: trim.cutPointId } : entity) });
  compileCadSketchGraph(candidate, parameters);
  return Object.freeze({ graph: candidate, retainedEntityId: trim.entityId, removedEntityId: null, cutPointId: trim.cutPointId });
}
