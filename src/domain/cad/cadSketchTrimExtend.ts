import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema, CadNumberSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from './cadSketchGraph';
import { isCadImportData } from './cadImportData';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds } from './cadSketchGraphReferences';
import { resolveCadSketchGraphJoints, resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { evaluateCadScalar } from './cadExpression';
import { classifyLineRayPathSegmentIntersection, classifyParameterizedPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { createArcSegment, createLineSegment, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { ArcPathSegment, CirclePathSegment, LinePathSegment, PathSegment, Point2 } from '@/domain/path-intel/types';

const strict = { additionalProperties: false }, id = CadIdentifierSchema;
const parameter = Type.Number({ minimum: 0, maximum: 1 });
const boundary = Type.Object({ entityId: id, index: Type.Integer({ minimum: 0, maximum: 1 }), parameter,
  position: Type.Tuple([CadNumberSchema, CadNumberSchema]), endpointPointId: Type.Optional(id) }, strict);
export const CadSketchTrimTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('delete'), entityId: id, parameter }, strict),
  Type.Object({ kind: Type.Literal('end'), entityId: id, parameter, end: Type.Union([Type.Literal('start'), Type.Literal('end')]),
    boundary, cutPointId: id }, strict),
  Type.Object({ kind: Type.Literal('middle'), entityId: id, parameter, boundaries: Type.Tuple([boundary, boundary]),
    cutPointIds: Type.Tuple([id, id]), newEntityId: id, supportRelationId: id }, strict),
  Type.Object({ kind: Type.Literal('circle'), entityId: id, parameter, boundaries: Type.Tuple([boundary, boundary]),
    cutPointIds: Type.Tuple([id, id]) }, strict)
]);
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type CadSketchTrimTarget = Immutable<Static<typeof CadSketchTrimTargetSchema>>;
export type CadSketchEndTrimTarget = Extract<CadSketchTrimTarget, { kind: 'end' }>;
export type CadSketchMiddleTrimTarget = Extract<CadSketchTrimTarget, { kind: 'middle' }>;
export type CadSketchCircleTrimTarget = Extract<CadSketchTrimTarget, { kind: 'circle' }>;
export const CadSketchExtendTargetSchema = Type.Object({ kind: Type.Literal('line'), entityId: id,
  end: Type.Union([Type.Literal('start'), Type.Literal('end')]),
  boundary: Type.Object({ ...boundary.properties, parameter: Type.Number() }, strict), endPointId: id }, strict);
export type CadSketchExtendTarget = Immutable<Static<typeof CadSketchExtendTargetSchema>>;
export interface CadSketchLineExtendPreparation {
  readonly target: Omit<CadSketchExtendTarget, 'endPointId'>;
  readonly added: LinePathSegment;
  readonly extended: LinePathSegment;
  readonly boundary: PathSegment;
  readonly point: readonly [number, number];
}
export interface CadSketchExtendResult {
  readonly graph: CadSketchGraph;
  readonly retainedEntityId: string;
  readonly endPointId: string;
}
export interface CadSketchEndTrimPreparation {
  readonly target: Extract<CadSketchTrimTarget, { kind: 'delete' }> | Omit<CadSketchEndTrimTarget, 'cutPointId'>;
  readonly removed: PathSegment;
  readonly survivor: PathSegment | null;
  readonly boundary: PathSegment | null;
  readonly point: readonly [number, number] | null;
}
interface MiddleTrimContacts {
  readonly target: Omit<CadSketchMiddleTrimTarget, 'cutPointIds' | 'newEntityId' | 'supportRelationId'>;
  readonly cuts: readonly [{ readonly boundary: PathSegment; readonly point: readonly [number, number] },
    { readonly boundary: PathSegment; readonly point: readonly [number, number] }];
}
export type CadSketchMiddleTrimPreparation = MiddleTrimContacts & (
  { readonly removed: LinePathSegment; readonly survivors: readonly [LinePathSegment, LinePathSegment] }
  | { readonly removed: ArcPathSegment; readonly survivors: readonly [ArcPathSegment, ArcPathSegment] });
export interface CadSketchCircleTrimPreparation {
  readonly target: Omit<CadSketchCircleTrimTarget, 'cutPointIds'>;
  readonly removed: ArcPathSegment;
  readonly survivor: ArcPathSegment;
  readonly cuts: CadSketchMiddleTrimPreparation['cuts'];
}
export type CadSketchTrimPreparation = CadSketchEndTrimPreparation | CadSketchMiddleTrimPreparation | CadSketchCircleTrimPreparation;
export interface CadSketchEndTrimResult {
  readonly graph: CadSketchGraph;
  readonly retainedEntityId: string | null;
  readonly removedEntityId: string | null;
  readonly cutPointId: string | null;
}
export interface CadSketchMiddleTrimResult {
  readonly graph: CadSketchGraph;
  readonly retainedEntityId: string;
  readonly removedEntityId: null;
  readonly cutPointIds: readonly [string, string];
  readonly newEntityId: string;
}
export type CadSketchCircleTrimResult = Omit<CadSketchMiddleTrimResult, 'newEntityId'>;
export type CadSketchTrimResult = CadSketchEndTrimResult | CadSketchMiddleTrimResult | CadSketchCircleTrimResult;
export class CadSketchTrimDependencyError extends CadError {
  readonly relationIds: readonly string[];
  readonly pointIds: readonly string[];
  constructor(relationIds: readonly string[], pointIds: readonly string[]) {
    super('dependent-sketch-trim', 'Remove or recreate the relations and endpoint drivers affected by this trim before trimming.');
    this.relationIds = Object.freeze([...relationIds]); this.pointIds = Object.freeze([...pointIds]);
  }
}
export class CadSketchExtendDependencyError extends CadError {
  readonly relationIds: readonly string[];
  readonly pointIds: readonly string[];
  constructor(relationIds: readonly string[], pointIds: readonly string[]) {
    super('dependent-sketch-extend', 'Remove or recreate the relations and endpoint drivers affected by this extension before extending.');
    this.relationIds = Object.freeze([...relationIds]); this.pointIds = Object.freeze([...pointIds]);
  }
}
interface Source {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>;
}
type OpenSegment = Exclude<PathSegment, { kind: 'circle' }>;
type SourceLine = Extract<CadSketchGraph['entities'][number], { kind: 'line' }>;
type Witness = CadSketchEndTrimTarget['boundary'];
interface Event { witness: Witness; boundary: PathSegment; point: Point2 }
type BoundaryQuery = { kind: 'trim'; segment: PathSegment } | { kind: 'extend'; segment: LinePathSegment; end: 'start' | 'end' };
const fullTurn = 2 * Math.PI;
const precision = (operation: 'trim' | 'extend' = 'trim') => new CadError(`sketch-${operation}-precision`,
  operation === 'trim' ? 'This intersection cannot leave an exact nondegenerate trim at these coordinates.' : 'This intersection cannot produce an exact nondegenerate line extension at these coordinates.');
const ambiguous = (operation: 'trim' | 'extend' = 'trim') => new CadError(`ambiguous-sketch-${operation}`,
  `${operation === 'trim' ? 'Trim' : 'Extend'} needs a unique transverse intersection; overlapping, tangent or undeclared coincident boundaries need explicit repair.`);
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
/** Circle Trim's fixed +X/CCW phase. A cursor direction is not a support-membership certificate. */
export function cadSketchCircleTrimParameter(segment: CirclePathSegment, point: Readonly<Point2>): number | null {
  const x = point.x - segment.center.x, y = point.y - segment.center.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 && y === 0) return null;
  const signed = Math.atan2(y, x) / fullTurn, phase = signed < 0 ? 1 + signed : signed;
  if (y !== 0 && phase === 0) return null;
  return phase < 1 ? phase === 0 ? 0 : phase : null;
}
function extent(segment: PathSegment): Point2[] {
  return [{ x: segment.bounds.minX, y: segment.bounds.minY }, { x: segment.bounds.maxX, y: segment.bounds.maxY }];
}
function assertEndpointRange(point: Point2, operation: 'trim' | 'extend'): void {
  if (!Value.Check(boundary.properties.position, [point.x, point.y])) throw precision(operation);
}
function tangent(segment: PathSegment, point: Readonly<Point2>, operation: 'trim' | 'extend' = 'trim'): Point2 {
  const vector = segment.kind === 'line' ? { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y }
    : { x: -(point.y - segment.center.y), y: point.x - segment.center.x };
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length <= 1e-7) throw precision(operation);
  return { x: vector.x / length, y: vector.y / length };
}
function sameEndpointPair(edge: Pick<SourceLine, 'startPointId' | 'endPointId'>, pair: readonly string[]): boolean {
  return pair.length === 2 && (edge.startPointId === pair[0] && edge.endPointId === pair[1] || edge.startPointId === pair[1] && edge.endPointId === pair[0]);
}
function retainedLineDirection(graph: CadSketchGraph, line: SourceLine, relation: CadSketchGraphRelation): boolean {
  if (relation.kind === 'parallel' || relation.kind === 'perpendicular' || relation.kind === 'collinear') return true;
  if (relation.kind !== 'horizontal' && relation.kind !== 'vertical') return false;
  return !sameEndpointPair(line, relation.pointIds) || !graph.entities.some(other => other.id !== line.id
    && other.kind !== 'circle' && sameEndpointPair(other, relation.pointIds));
}
function assertDependencies(graph: CadSketchGraph, entityId: string, detached: readonly string[], operation: 'trim' | 'extend' = 'trim', retainedLine?: SourceLine) {
  const owners = graph.relations.filter(relation => (cadSketchRelationEntityIds(relation).includes(entityId)
    || cadSketchRelationPointIds(graph, relation).some(id => detached.includes(id)))
    && !(retainedLine && retainedLineDirection(graph, retainedLine, relation)));
  const drivers = detached.filter(id => graph.points.find(point => point.id === id)?.position.some(value => typeof value === 'string')
    || owners.some(relation => cadSketchRelationPointIds(graph, relation).includes(id)));
  if (owners.length || drivers.length) throw operation === 'trim' ? new CadSketchTrimDependencyError(owners.map(relation => relation.id), drivers)
    : new CadSketchExtendDependencyError(owners.map(relation => relation.id), drivers);
}
function assertMiddleDependencies(graph: CadSketchGraph, entityId: string): void {
  const owners = graph.relations.filter(relation => cadSketchRelationEntityIds(relation).includes(entityId)
    && relation.kind !== 'parallel' && relation.kind !== 'perpendicular' && relation.kind !== 'collinear');
  if (owners.length) throw new CadSketchTrimDependencyError(owners.map(relation => relation.id), []);
}
function assertCircleDependencies(graph: CadSketchGraph, entity: Extract<CadSketchGraph['entities'][number], { kind: 'circle' }>): void {
  if (typeof entity.radius === 'string') throw new CadError('driven-sketch-trim-radius', "Edit or release this circle's radius expression before trimming.");
  const owners = graph.relations.filter(relation => cadSketchRelationEntityIds(relation).includes(entity.id));
  if (owners.length) throw new CadSketchTrimDependencyError(owners.map(relation => relation.id), []);
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
function checkCircleArc(circle: Pick<CirclePathSegment, 'center' | 'radius'>, arc: ArcPathSegment, expected: number, tolerance: number): void {
  const a = { x: arc.start.x - circle.center.x, y: arc.start.y - circle.center.y }, b = { x: arc.end.x - circle.center.x, y: arc.end.y - circle.center.y };
  const cross = a.x * b.y - a.y * b.x, dot = a.x * b.x + a.y * b.y;
  if (!(expected > 0 && expected < fullTurn) || !(arc.sweepRadians > 0 && arc.sweepRadians < fullTurn)
    || Math.abs(arc.radius - circle.radius) > tolerance || Math.abs(distance(arc.center, arc.start) - circle.radius) > tolerance
    || Math.abs(distance(arc.center, arc.end) - circle.radius) > tolerance
    || Math.abs(arc.sweepRadians - expected) >= Math.PI || Math.abs(arc.sweepRadians - expected) * circle.radius > tolerance
    || cross > 0 && arc.sweepRadians >= Math.PI || cross < 0 && arc.sweepRadians <= Math.PI || cross === 0 && dot >= 0) throw precision();
}
function circlePieces(circle: CirclePathSegment, previous: Event, next: Event): readonly [ArcPathSegment, ArcPathSegment] {
  const span = next.witness.parameter - previous.witness.parameter, sweep = (span > 0 ? span : 1 + span) * fullTurn;
  const tolerance = cadPathClosureTolerance([circle.center, previous.point, next.point]);
  if (distance(previous.point, next.point) <= Math.max(1e-7, tolerance)) throw precision();
  const common = { id: circle.id, source: circle.source, center: circle.center, clockwise: false };
  const removed = createArcSegment({ ...common, start: previous.point, end: next.point });
  const survivor = createArcSegment({ ...common, start: next.point, end: previous.point });
  checkCircleArc(circle, removed, sweep, tolerance); checkCircleArc(circle, survivor, fullTurn - sweep, tolerance);
  if (Math.abs(removed.sweepRadians + survivor.sweepRadians - fullTurn) * circle.radius > tolerance) throw precision();
  return [removed, survivor];
}
function checkMiddleArcPiece(source: ArcPathSegment, piece: ArcPathSegment, expected: number, tolerance: number): void {
  const a = { x: piece.start.x - source.center.x, y: piece.start.y - source.center.y }, b = { x: piece.end.x - source.center.x, y: piece.end.y - source.center.y };
  const direction = source.clockwise ? -1 : 1, cross = direction * (a.x * b.y - a.y * b.x), dot = a.x * b.x + a.y * b.y;
  const sweep = direction * piece.sweepRadians;
  if (!(direction * expected > 0 && direction * expected < fullTurn) || !(sweep > 0 && sweep < fullTurn) || piece.clockwise !== source.clockwise
    || distance(piece.center, source.center) > tolerance || Math.abs(piece.radius - source.radius) > tolerance
    || Math.abs(distance(piece.center, piece.start) - source.radius) > tolerance || Math.abs(distance(piece.center, piece.end) - source.radius) > tolerance
    || Math.abs(piece.sweepRadians - expected) >= Math.PI || Math.abs(piece.sweepRadians - expected) * source.radius > tolerance
    || cross > 0 && sweep >= Math.PI || cross < 0 && sweep <= Math.PI || cross === 0 && dot >= 0) throw precision();
}
function middleArcPieces(segment: ArcPathSegment, left: Event, right: Event) {
  const make = (start: Point2, end: Point2) => createArcSegment({ id: segment.id, source: segment.source, center: segment.center,
    clockwise: segment.clockwise, start, end });
  const before = make(segment.start, left.point), removed = make(left.point, right.point), after = make(right.point, segment.end);
  const expected = [segment.sweepRadians * left.witness.parameter, segment.sweepRadians * (right.witness.parameter - left.witness.parameter),
    segment.sweepRadians * (1 - right.witness.parameter)];
  const tolerance = cadPathClosureTolerance([segment.center, segment.start, left.point, right.point, segment.end]);
  for (const [index, piece] of [before, removed, after].entries()) checkMiddleArcPiece(segment, piece, expected[index], tolerance);
  if (Math.abs(before.sweepRadians + removed.sweepRadians + after.sweepRadians - segment.sweepRadians) * segment.radius > tolerance) throw precision();
  return { removed, survivors: [before, after] as const };
}

function boundaryEvents(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, segments: readonly PathSegment[], query: BoundaryQuery): Event[] {
  const { segment } = query, operation = query.kind;
  const numericPoints = new Map(graph.points.map(point => [point.id, { x: evaluateCadScalar(point.position[0], parameters), y: evaluateCadScalar(point.position[1], parameters) }]));
  const joint = resolveCadSketchGraphJoints(graph, numericPoints), events: Event[] = [];
  for (const other of segments) {
    if (other.id === segment.id) continue;
    const tolerance = cadPathClosureTolerance([...extent(segment), ...extent(other)]);
    const result = query.kind === 'trim' ? classifyParameterizedPathSegmentIntersection(segment, other, tolerance)
      : classifyLineRayPathSegmentIntersection(query.segment, other, query.end, tolerance);
    if (result.kind === 'overlap') throw ambiguous(operation);
    if (result.kind !== 'points') continue;
    const hits = result.points.map(hit => ({ hit, parameter: segment.kind === 'circle' ? cadSketchCircleTrimParameter(segment, hit.point) : hit.leftParameter }))
      .sort((a, b) => (a.parameter ?? -1) - (b.parameter ?? -1));
    for (const [index, candidate] of hits.entries()) {
      const { hit, parameter: t } = candidate;
      if (t === null || !Number.isFinite(t)) throw precision(operation);
      if (query.kind === 'trim' ? t < 0 || t > 1 : query.end === 'start' ? t > 0 : t < 1) throw precision(operation);
      const point = segment.kind === 'circle' ? hit.point : at(segment, t);
      if (distance(point, hit.point) > tolerance) throw precision(operation);
      if (segment.kind === 'circle' && Math.abs(distance(point, segment.center) - segment.radius) > tolerance) throw precision(operation);
      if (other.kind === 'circle') {
        if (Math.abs(distance(point, other.center) - other.radius) > tolerance) throw precision(operation);
      } else if (hit.rightParameter === null || hit.rightParameter < 0 || hit.rightParameter > 1
        || distance(point, at(other, hit.rightParameter)) > tolerance) throw precision(operation);
      const u = tangent(segment, point, operation), v = tangent(other, point, operation);
      if (Math.abs(u.x * v.y - u.y * v.x) <= 64 * Number.EPSILON) throw ambiguous(operation);
      if (query.kind === 'trim' ? segment.kind !== 'circle' && (t === 0 || t === 1) : t === (query.end === 'start' ? 0 : 1)) continue;
      const boundaryEntity = graph.entities.find(item => item.id === other.id);
      const endpointPointId = boundaryEntity && boundaryEntity.kind !== 'circle'
        ? hit.rightParameter === 0 ? boundaryEntity.startPointId : hit.rightParameter === 1 ? boundaryEntity.endPointId : undefined : undefined;
      const exact = endpointPointId ? numericPoints.get(endpointPointId) : point;
      if (!exact || distance(exact, point) > tolerance) throw precision(operation);
      events.push({ witness: { entityId: other.id, index, parameter: t, position: [exact.x, exact.y],
        ...(endpointPointId ? { endpointPointId } : {}) }, boundary: other, point: exact });
    }
  }
  events.sort((a, b) => a.witness.parameter - b.witness.parameter || (a.boundary.id < b.boundary.id ? -1 : a.boundary.id > b.boundary.id ? 1 : 0));
  const unique: Event[] = [];
  const sameContact = (a: Event, b: Event): boolean => {
    if (distance(a.point, b.point) > cadPathClosureTolerance([a.point, b.point])) return false;
    const left = a.witness.endpointPointId, right = b.witness.endpointPointId;
    if (!left || !right || joint(left) !== joint(right)) throw ambiguous(operation);
    return true;
  };
  for (const event of events) {
    const previous = unique.at(-1);
    if (previous && sameContact(previous, event)) continue;
    unique.push(event);
  }
  if (segment.kind === 'circle' && unique.length > 1 && sameContact(unique[0], unique[unique.length - 1])) unique.pop();
  return unique;
}

function replaceEndpoint(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, entityId: string, end: 'start' | 'end',
  witness: Witness, pointId: string, operation: 'trim' | 'extend'): CadSketchGraph {
  const endpoint = witness.endpointPointId;
  if (endpoint !== undefined && pointId !== endpoint) throw new CadError(`invalid-sketch-${operation}-point`, 'Use the exact witnessed boundary endpoint identity.');
  const source = graph.entities.find(entity => entity.id === entityId), line = source?.kind === 'line' ? source : null;
  // A surviving line explicitly transfers only its own endpoint-pair axis relation.
  // Adjacent axis operands keep the detached old point; scalar/attachment drivers never transfer.
  const relations = line ? graph.relations.map((relation): CadSketchGraphRelation => {
    if ((relation.kind !== 'horizontal' && relation.kind !== 'vertical') || !sameEndpointPair(line, relation.pointIds)) return relation;
    const old = end === 'start' ? line.startPointId : line.endPointId;
    return { ...relation, pointIds: [relation.pointIds[0] === old ? pointId : relation.pointIds[0], relation.pointIds[1] === old ? pointId : relation.pointIds[1]] };
  }) : graph.relations;
  const candidate = parseCadSketchGraph({ ...graph, relations,
    points: endpoint === undefined ? [...graph.points, { id: pointId, position: witness.position }] : graph.points,
    entities: graph.entities.map(entity => entity.id === entityId ? { ...entity, [end === 'start' ? 'startPointId' : 'endPointId']: pointId } : entity) });
  compileCadSketchGraph(candidate, parameters);
  return candidate;
}

/** One clicked span, with no inferred cutter attachment or coordinate healing. */
export function prepareCadSketchTrim({ graph: input, parameters, entityId, parameter: pick }: Source & {
  readonly entityId: string; readonly parameter: number;
}): CadSketchTrimPreparation {
  if (!Number.isFinite(pick) || pick < 0 || pick > 1) throw new CadError('invalid-sketch-trim', 'Choose a finite source parameter from zero to one.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === entityId);
  if (!entity) throw new CadError('invalid-sketch-trim-target', 'Trim needs an existing graph edge.');
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entityId);
  if (!segment) throw new CadError('invalid-sketch-trim-target', 'Trim needs an existing graph edge.');
  const unique = boundaryEvents(graph, parameters, geometry.segments, { kind: 'trim', segment });
  if (entity.kind === 'circle') assertCircleDependencies(graph, entity);
  if (!unique.length) {
    if (entity.kind !== 'circle') assertDependencies(graph, entityId, [entity.startPointId, entity.endPointId]);
    const result: CadSketchEndTrimPreparation = { target: { kind: 'delete', entityId, parameter: pick }, removed: segment,
      survivor: null, boundary: null, point: null };
    freezeData(result); return result;
  }
  if (segment.kind === 'circle') {
    if (unique.length < 2) throw ambiguous();
    const phase = pick === 1 ? 0 : pick, cursor = { x: segment.center.x + segment.radius * Math.cos(phase * fullTurn),
      y: segment.center.y + segment.radius * Math.sin(phase * fullTurn) };
    for (const event of unique) {
      const delta = Math.abs(phase - event.witness.parameter);
      if (Math.min(delta, 1 - delta) * segment.length <= cadPathClosureTolerance([cursor, event.point]))
        throw new CadError('ambiguous-sketch-trim', 'Choose the portion to remove, away from its intersection.');
    }
    const after = unique.findIndex(event => event.witness.parameter > phase), nextIndex = after < 0 ? 0 : after;
    const previous = unique[(nextIndex + unique.length - 1) % unique.length], next = unique[nextIndex];
    assertEndpointRange(previous.point, 'trim'); assertEndpointRange(next.point, 'trim');
    const [removed, survivor] = circlePieces(segment, previous, next);
    const result: CadSketchCircleTrimPreparation = { target: { kind: 'circle', entityId, parameter: pick,
      boundaries: [previous.witness, next.witness] }, removed, survivor,
      cuts: [{ boundary: previous.boundary, point: [previous.point.x, previous.point.y] }, { boundary: next.boundary, point: [next.point.x, next.point.y] }] };
    freezeData(result); return result;
  }
  if (entity.kind === 'circle') throw precision();
  for (const event of unique) if (Math.abs(pick - event.witness.parameter) * segment.length <= cadPathClosureTolerance([at(segment, pick), event.point]))
    throw new CadError('ambiguous-sketch-trim', 'Choose the portion to remove, away from its intersection.');
  const first = unique[0], last = unique[unique.length - 1];
  const end = pick < first.witness.parameter ? 'start' : pick > last.witness.parameter ? 'end' : null;
  if (!end) {
    const after = unique.findIndex(event => event.witness.parameter > pick), left = unique[after - 1], right = unique[after];
    assertEndpointRange(left.point, 'trim'); assertEndpointRange(right.point, 'trim'); assertMiddleDependencies(graph, entityId);
    const minimum = Math.max(1e-7, cadPathClosureTolerance([segment.start, left.point, right.point, segment.end]));
    if (distance(segment.start, left.point) <= minimum || distance(left.point, right.point) <= minimum || distance(right.point, segment.end) <= minimum) throw precision();
    const contacts: MiddleTrimContacts = {
      target: { kind: 'middle', entityId, parameter: pick, boundaries: [left.witness, right.witness] },
      cuts: [{ boundary: left.boundary, point: [left.point.x, left.point.y] }, { boundary: right.boundary, point: [right.point.x, right.point.y] }]
    };
    const result: CadSketchMiddleTrimPreparation = segment.kind === 'line' ? { ...contacts,
      removed: createLineSegment({ ...segment, start: left.point, end: right.point }),
      survivors: [createLineSegment({ ...segment, end: left.point }), createLineSegment({ ...segment, start: right.point })] }
      : { ...contacts, ...middleArcPieces(segment, left, right) };
    freezeData(result); return result;
  }
  const event = end === 'start' ? first : last;
  assertEndpointRange(event.point, 'trim');
  assertDependencies(graph, entityId, [end === 'start' ? entity.startPointId : entity.endPointId], 'trim', entity.kind === 'line' ? entity : undefined);
  const pieces = partition(segment, event.point, event.witness.parameter);
  const result: CadSketchEndTrimPreparation = { target: { kind: 'end', entityId, parameter: pick, end, boundary: event.witness },
    removed: pieces[end === 'start' ? 0 : 1], survivor: pieces[end === 'start' ? 1 : 0], boundary: event.boundary,
    point: [event.point.x, event.point.y] };
  freezeData(result); return result;
}

/** Recheck the exact preview witness; never retarget a changed source to another intersection. */
export function trimCadSketchEntity({ graph: input, parameters, trim }: Source & { readonly trim: CadSketchTrimTarget }): CadSketchTrimResult {
  if (!isCadImportData(trim) || !Value.Check(CadSketchTrimTargetSchema, trim)) throw new CadError('invalid-sketch-trim', 'Choose one complete trim request.');
  const graph = parseCadSketchGraph(input), prepared = prepareCadSketchTrim({ graph, parameters, entityId: trim.entityId, parameter: trim.parameter });
  const target = trim.kind === 'delete' ? trim : trim.kind === 'end'
    ? { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, end: trim.end, boundary: trim.boundary }
    : { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, boundaries: trim.boundaries };
  if (!Value.Equal(prepared.target, target)) throw new CadError('stale-sketch-trim', 'The trim boundary changed. Choose the portion again.');
  if (trim.kind === 'delete') return Object.freeze({ graph: parseCadSketchGraph({ ...graph, entities: graph.entities.filter(entity => entity.id !== trim.entityId) }),
    retainedEntityId: null, removedEntityId: trim.entityId, cutPointId: null });
  if (trim.kind === 'circle') {
    const circle = graph.entities.find(entity => entity.id === trim.entityId);
    if (!circle || circle.kind !== 'circle' || !('survivor' in prepared) || prepared.survivor?.kind !== 'arc') throw precision();
    for (const [index, witness] of trim.boundaries.entries()) if (witness.endpointPointId !== undefined && trim.cutPointIds[index] !== witness.endpointPointId)
      throw new CadError('invalid-sketch-trim-point', 'Use the exact witnessed boundary endpoint identity.');
    const joint = resolveCadSketchPointIdentities(graph), keys = trim.boundaries.map((witness, index) => witness.endpointPointId === undefined
      ? trim.cutPointIds[index] : joint(trim.cutPointIds[index]));
    if (keys[0] === keys[1] || keys.includes(joint(circle.centerPointId))) throw new CadError('invalid-sketch-trim-point', 'The circle cuts and center need distinct point identities.');
    const candidate = parseCadSketchGraph({ ...graph,
      points: [...graph.points, ...trim.boundaries.flatMap((witness, index) => witness.endpointPointId === undefined ? [{ id: trim.cutPointIds[index], position: witness.position }] : [])],
      entities: graph.entities.map(entity => entity.id === circle.id ? { id: circle.id, kind: 'arc', construction: circle.construction,
        centerPointId: circle.centerPointId, startPointId: trim.cutPointIds[1], endPointId: trim.cutPointIds[0], direction: 'ccw' } : entity) });
    const actual = compileCadSketchGraph(candidate, parameters).segments.find(segment => segment.id === circle.id);
    if (actual?.kind !== 'arc') throw precision();
    const source = { center: prepared.survivor.center, radius: evaluateCadScalar(circle.radius, parameters) };
    checkCircleArc(source, actual, prepared.survivor.sweepRadians, cadPathClosureTolerance([actual.center, actual.start, actual.end]));
    return Object.freeze({ graph: candidate, retainedEntityId: circle.id, removedEntityId: null,
      cutPointIds: Object.freeze([trim.cutPointIds[0], trim.cutPointIds[1]] satisfies [string, string]) });
  }
  if (trim.kind === 'middle') {
    const source = graph.entities.find(entity => entity.id === trim.entityId);
    if (!source || source.kind === 'circle') throw new CadError('invalid-sketch-trim-target', 'Middle trim needs an existing line or open arc.');
    for (const [index, witness] of trim.boundaries.entries()) if (witness.endpointPointId !== undefined && trim.cutPointIds[index] !== witness.endpointPointId)
      throw new CadError('invalid-sketch-trim-point', 'Use the exact witnessed boundary endpoint identity.');
    if (source.kind === 'arc') {
      const joint = resolveCadSketchPointIdentities(graph), outer = [source.centerPointId, source.startPointId, source.endPointId].map(joint);
      const cuts = trim.boundaries.map((witness, index) => witness.endpointPointId === undefined ? trim.cutPointIds[index] : joint(trim.cutPointIds[index]));
      if (cuts[0] === cuts[1] || cuts.some(cut => outer.includes(cut))) throw new CadError('invalid-sketch-trim-point', 'Arc cuts need distinct identities from the original center and endpoints.');
    }
    const support: CadSketchGraphRelation = source.kind === 'line' ? { id: trim.supportRelationId, kind: 'collinear', lineIds: [source.id, trim.newEntityId] }
      : { id: trim.supportRelationId, kind: 'equal-radius', curveIds: [source.id, trim.newEntityId] };
    const candidate = parseCadSketchGraph({ ...graph,
      points: [...graph.points, ...trim.boundaries.flatMap((witness, index) => witness.endpointPointId === undefined ? [{ id: trim.cutPointIds[index], position: witness.position }] : [])],
      entities: graph.entities.flatMap(entity => entity.id === source.id ? [{ ...source, endPointId: trim.cutPointIds[0] },
        { ...source, id: trim.newEntityId, startPointId: trim.cutPointIds[1] }] : [entity]), relations: [...graph.relations, support] });
    const compiled = compileCadSketchGraph(candidate, parameters);
    if (source.kind === 'arc' && 'survivors' in prepared) for (const [index, expected] of prepared.survivors.entries()) {
      const actual = compiled.segments.find(segment => segment.id === (index === 0 ? source.id : trim.newEntityId));
      if (expected.kind !== 'arc' || actual?.kind !== 'arc') throw precision();
      checkMiddleArcPiece(expected, actual, expected.sweepRadians, cadPathClosureTolerance([expected.center, expected.start, expected.end]));
    }
    return Object.freeze({ graph: candidate, retainedEntityId: source.id, removedEntityId: null,
      cutPointIds: Object.freeze([trim.cutPointIds[0], trim.cutPointIds[1]] satisfies [string, string]), newEntityId: trim.newEntityId });
  }
  const candidate = replaceEndpoint(graph, parameters, trim.entityId, trim.end, trim.boundary, trim.cutPointId, 'trim');
  return Object.freeze({ graph: candidate, retainedEntityId: trim.entityId, removedEntityId: null, cutPointId: trim.cutPointId });
}

/** Extend one endpoint along its exact source support; cutters remain finite and untouched. */
export function prepareCadSketchLineExtend({ graph: input, parameters, entityId, end }: Source & { readonly entityId: string; readonly end: 'start' | 'end' }): CadSketchLineExtendPreparation {
  if (end !== 'start' && end !== 'end') throw new CadError('invalid-sketch-extend', 'Choose the start or end of one line.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === entityId);
  if (!entity || entity.kind !== 'line') throw new CadError('invalid-sketch-extend-target', 'This extension supports an existing line endpoint.');
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entityId);
  if (!segment || segment.kind !== 'line') throw new CadError('invalid-sketch-extend-target', 'This extension supports an existing line endpoint.');
  assertDependencies(graph, entityId, [end === 'start' ? entity.startPointId : entity.endPointId], 'extend', entity);
  const events = boundaryEvents(graph, parameters, geometry.segments, { kind: 'extend', segment, end });
  const event = end === 'start' ? events.at(-1) : events[0];
  if (!event) throw new CadError('missing-sketch-extend-boundary', 'No finite boundary intersects this line beyond the selected endpoint.');
  assertEndpointRange(event.point, 'extend');
  const original = end === 'start' ? segment.start : segment.end;
  if (distance(original, event.point) <= Math.max(1e-7, cadPathClosureTolerance([segment.start, segment.end, event.point]))) throw precision('extend');
  const extended = createLineSegment({ ...segment, [end]: event.point });
  const added = createLineSegment({ ...segment, start: end === 'start' ? event.point : original, end: end === 'start' ? original : event.point });
  const result: CadSketchLineExtendPreparation = { target: { kind: 'line', entityId, end, boundary: event.witness }, added, extended,
    boundary: event.boundary, point: [event.point.x, event.point.y] };
  freezeData(result); return result;
}
export function extendCadSketchEntity({ graph: input, parameters, extend }: Source & { readonly extend: CadSketchExtendTarget }): CadSketchExtendResult {
  if (!isCadImportData(extend) || !Value.Check(CadSketchExtendTargetSchema, extend)) throw new CadError('invalid-sketch-extend', 'Choose one complete line-extension request.');
  const graph = parseCadSketchGraph(input), prepared = prepareCadSketchLineExtend({ graph, parameters, entityId: extend.entityId, end: extend.end });
  const { endPointId, ...target } = extend;
  if (!Value.Equal(prepared.target, target)) throw new CadError('stale-sketch-extend', 'The extension boundary changed. Choose the endpoint again.');
  const candidate = replaceEndpoint(graph, parameters, extend.entityId, extend.end, extend.boundary, endPointId, 'extend');
  return Object.freeze({ graph: candidate, retainedEntityId: extend.entityId, endPointId });
}
