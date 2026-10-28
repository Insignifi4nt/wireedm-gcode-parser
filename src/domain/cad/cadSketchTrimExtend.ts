import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema, CadNumberSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from './cadSketchGraph';
import { isCadImportData } from './cadImportData';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { cadPathClosureTolerance, cadPathTangentContact } from './cadAnalyticSegments';
import { cadSketchEntityPointIds, cadSketchRelationEntityIds, cadSketchRelationPointIds } from './cadSketchGraphReferences';
import { resolveCadSketchGraphJoints, resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { evaluateCadScalar } from './cadExpression';
import { classifyLineRayPathSegmentIntersection, classifyParameterizedPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { createArcSegment, createCircleSegment, createLineSegment, distance, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { ArcPathSegment, CirclePathSegment, LinePathSegment, PathSegment, Point2 } from '@/domain/path-intel/types';
import { deepFreezeCadData } from './cadDeepFreeze';

const strict = { additionalProperties: false }, id = CadIdentifierSchema;
const parameter = Type.Number({ minimum: 0, maximum: 1 });
const boundary = Type.Object({ entityId: id, index: Type.Integer({ minimum: 0, maximum: 1 }), parameter,
  position: Type.Tuple([CadNumberSchema, CadNumberSchema]), endpointPointId: Type.Optional(id) }, strict);
// The relations a trim removes with its piece; a request that omits them confirms that none are removed.
const removedRelationIds = Type.Optional(Type.Array(id, { uniqueItems: true }));
// A fresh point-on-line relation that keeps a cut on the interior of a cutting line; null leaves that cut numeric.
const attachRelationIds = Type.Optional(Type.Tuple([Type.Union([id, Type.Null()]), Type.Union([id, Type.Null()])]));
export const CadSketchTrimTargetSchema = Type.Union([
  Type.Object({ kind: Type.Literal('delete'), entityId: id, parameter, removedRelationIds }, strict),
  Type.Object({ kind: Type.Literal('end'), entityId: id, parameter, end: Type.Union([Type.Literal('start'), Type.Literal('end')]),
    boundary, cutPointId: id, removedRelationIds, attachRelationId: Type.Optional(id) }, strict),
  Type.Object({ kind: Type.Literal('middle'), entityId: id, parameter, boundaries: Type.Tuple([boundary, boundary]),
    cutPointIds: Type.Tuple([id, id]), newEntityId: id, supportRelationId: id, removedRelationIds, attachRelationIds }, strict),
  Type.Object({ kind: Type.Literal('circle'), entityId: id, parameter, boundaries: Type.Tuple([boundary, boundary]),
    cutPointIds: Type.Tuple([id, id]), removedRelationIds, attachRelationIds }, strict)
]);
type Immutable<T> = { readonly [K in keyof T]: Immutable<T[K]> };
export type CadSketchTrimTarget = Immutable<Static<typeof CadSketchTrimTargetSchema>>;
export type CadSketchEndTrimTarget = Extract<CadSketchTrimTarget, { kind: 'end' }>;
export type CadSketchMiddleTrimTarget = Extract<CadSketchTrimTarget, { kind: 'middle' }>;
export type CadSketchCircleTrimTarget = Extract<CadSketchTrimTarget, { kind: 'circle' }>;
export const CadSketchExtendTargetSchema = Type.Object({ kind: Type.Union([Type.Literal('line'), Type.Literal('arc')]), entityId: id,
  end: Type.Union([Type.Literal('start'), Type.Literal('end')]),
  boundary: Type.Object({ ...boundary.properties, parameter: Type.Number() }, strict), endPointId: id }, strict);
export type CadSketchExtendTarget = Immutable<Static<typeof CadSketchExtendTargetSchema>>;
export type CadSketchLineExtendTarget = CadSketchExtendTarget & { readonly kind: 'line' };
export type CadSketchArcExtendTarget = CadSketchExtendTarget & { readonly kind: 'arc' };
interface ExtendContact {
  readonly boundary: PathSegment;
  readonly point: readonly [number, number];
}
export interface CadSketchLineExtendPreparation extends ExtendContact {
  readonly target: Omit<CadSketchLineExtendTarget, 'endPointId'>;
  readonly added: LinePathSegment;
  readonly extended: LinePathSegment;
}
export interface CadSketchArcExtendPreparation extends ExtendContact {
  readonly target: Omit<CadSketchArcExtendTarget, 'endPointId'>;
  readonly added: ArcPathSegment;
  readonly extended: ArcPathSegment;
}
export type CadSketchExtendPreparation = CadSketchLineExtendPreparation | CadSketchArcExtendPreparation;
export interface CadSketchExtendResult {
  readonly graph: CadSketchGraph;
  readonly retainedEntityId: string;
  readonly endPointId: string;
}
export interface CadSketchEndTrimPreparation {
  readonly target: Extract<CadSketchTrimTarget, { kind: 'delete' }> | Omit<CadSketchEndTrimTarget, 'cutPointId' | 'attachRelationId'>;
  readonly removed: PathSegment;
  readonly survivor: PathSegment | null;
  readonly boundary: PathSegment | null;
  readonly point: readonly [number, number] | null;
  /** The cutting line a fresh cut point can stay on, or null for an existing endpoint, a curved cutter or no cut. */
  readonly attachLineId: string | null;
}
interface MiddleTrimContacts {
  readonly target: Omit<CadSketchMiddleTrimTarget, 'cutPointIds' | 'newEntityId' | 'supportRelationId' | 'attachRelationIds'>;
  readonly cuts: readonly [{ readonly boundary: PathSegment; readonly point: readonly [number, number] },
    { readonly boundary: PathSegment; readonly point: readonly [number, number] }];
  readonly attachLineIds: readonly [string | null, string | null];
}
export type CadSketchMiddleTrimPreparation = MiddleTrimContacts & (
  { readonly removed: LinePathSegment; readonly survivors: readonly [LinePathSegment, LinePathSegment] }
  | { readonly removed: ArcPathSegment; readonly survivors: readonly [ArcPathSegment, ArcPathSegment] });
export interface CadSketchCircleTrimPreparation {
  readonly target: Omit<CadSketchCircleTrimTarget, 'cutPointIds' | 'attachRelationIds'>;
  readonly removed: ArcPathSegment;
  readonly survivor: ArcPathSegment;
  readonly cuts: CadSketchMiddleTrimPreparation['cuts'];
  readonly attachLineIds: CadSketchMiddleTrimPreparation['attachLineIds'];
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
abstract class CadSketchEditDependencyError extends CadError {
  readonly relationIds: readonly string[];
  readonly pointIds: readonly string[];
  constructor(code: string, message: string, relationIds: readonly string[], pointIds: readonly string[]) {
    super(code, message);
    this.relationIds = Object.freeze([...relationIds]); this.pointIds = Object.freeze([...pointIds]);
  }
}
export class CadSketchTrimDependencyError extends CadSketchEditDependencyError {
  constructor(relationIds: readonly string[], pointIds: readonly string[]) {
    super('dependent-sketch-trim', 'Remove or recreate the relations and endpoint drivers affected by this trim before trimming.', relationIds, pointIds);
  }
}
export class CadSketchExtendDependencyError extends CadSketchEditDependencyError {
  constructor(relationIds: readonly string[], pointIds: readonly string[]) {
    super('dependent-sketch-extend', 'Remove or recreate the relations and endpoint drivers affected by this extension before extending.', relationIds, pointIds);
  }
}
interface Source {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>;
}
type OpenSegment = Exclude<PathSegment, { kind: 'circle' }>;
type SourceEdge = Exclude<CadSketchGraph['entities'][number], { kind: 'circle' }>;
type SourceLine = Extract<CadSketchGraph['entities'][number], { kind: 'line' }>;
type Witness = CadSketchEndTrimTarget['boundary'];
/** `tangent` marks a contact Trim cannot cut at; it may only bound a piece nobody asks to remove. */
interface Event { witness: Witness; boundary: PathSegment; point: Point2; tangent?: true }
type BoundaryQuery = { kind: 'trim'; segment: PathSegment } | { kind: 'extend'; segment: OpenSegment; end: 'start' | 'end' };
const fullTurn = 2 * Math.PI;
const precision = (operation: 'trim' | 'extend' = 'trim') => new CadError(`sketch-${operation}-precision`,
  operation === 'trim' ? 'This intersection cannot leave an exact nondegenerate trim at these coordinates.' : 'This intersection cannot produce an exact nondegenerate extension at these coordinates.');
const ambiguous = (operation: 'trim' | 'extend' = 'trim') => new CadError(`ambiguous-sketch-${operation}`,
  `${operation === 'trim' ? 'Trim' : 'Extend'} needs a unique transverse intersection; overlapping, tangent or undeclared coincident boundaries need explicit repair.`);
function at(segment: OpenSegment, t: number): Point2 {
  return segment.kind === 'line' ? { x: segment.start.x + (segment.end.x - segment.start.x) * t,
    y: segment.start.y + (segment.end.y - segment.start.y) * t }
    : pointOnArcAtParameter(segment, { segmentId: segment.id, reversed: false }, t);
}
function arcOutwardParameter(segment: ArcPathSegment, point: Readonly<Point2>, end: 'start' | 'end'): number {
  const endpoint = end === 'start' ? segment.start : segment.end;
  const a = { x: endpoint.x - segment.center.x, y: endpoint.y - segment.center.y }, b = { x: point.x - segment.center.x, y: point.y - segment.center.y };
  const sense = (segment.clockwise ? -1 : 1) * (end === 'start' ? -1 : 1), cross = sense * (a.x * b.y - a.y * b.x);
  let angle = Math.atan2(cross, a.x * b.x + a.y * b.y);
  if (angle < 0) angle += fullTurn;
  const t = end === 'start' ? -angle / Math.abs(segment.sweepRadians) : 1 + angle / Math.abs(segment.sweepRadians);
  if (!Number.isFinite(t) || angle === fullTurn || angle === 0 && cross !== 0 || angle > 0 && t === (end === 'start' ? 0 : 1)) throw precision('extend');
  return t === 0 ? 0 : t;
}
/** Circle Trim's fixed +X/CCW phase. A cursor direction is not a support-membership certificate. */
export function cadSketchCircleTrimParameter(segment: CirclePathSegment, point: Readonly<Point2>): number | null {
  const x = point.x - segment.center.x, y = point.y - segment.center.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === 0 && y === 0) return null;
  const signed = Math.atan2(y, x) / fullTurn, phase = signed < 0 ? 1 + signed : signed;
  if (y !== 0 && phase === 0) return null;
  return phase < 1 ? phase === 0 ? 0 : phase : null;
}
/** Where `point` lies along a trim source (a circle by its fixed phase), or null off it. */
function trimParameter(segment: PathSegment, point: Point2, tolerance: number): number | null {
  if (segment.kind === 'circle') return Math.abs(distance(point, segment.center) - segment.radius) <= tolerance ? cadSketchCircleTrimParameter(segment, point) : null;
  let t: number;
  if (segment.kind === 'line') {
    const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
    t = ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / (dx * dx + dy * dy);
  } else {
    const a = { x: segment.start.x - segment.center.x, y: segment.start.y - segment.center.y }, b = { x: point.x - segment.center.x, y: point.y - segment.center.y };
    let angle = Math.atan2((segment.clockwise ? -1 : 1) * (a.x * b.y - a.y * b.x), a.x * b.x + a.y * b.y);
    if (angle < 0) angle += fullTurn;
    t = angle / Math.abs(segment.sweepRadians);
  }
  return Number.isFinite(t) && t >= 0 && t <= 1 && distance(at(segment, t), point) <= tolerance ? t : null;
}
function extent(segment: PathSegment): Point2[] {
  return [{ x: segment.bounds.minX, y: segment.bounds.minY }, { x: segment.bounds.maxX, y: segment.bounds.maxY }];
}
function assertEndpointRange(point: Point2, operation: 'trim' | 'extend'): void {
  if (!Value.Check(boundary.properties.position, [point.x, point.y])) throw precision(operation);
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
function retainedArcRadius(entity: SourceEdge, relation: CadSketchGraphRelation): boolean {
  return entity.kind === 'arc' && (relation.kind === 'radial-size' && relation.entityId === entity.id
    || relation.kind === 'equal-radius' && relation.curveIds.includes(entity.id));
}
function assertDependencies(graph: CadSketchGraph, entityId: string, detached: readonly string[], operation: 'trim' | 'extend' = 'trim', retained?: SourceEdge) {
  const owners = graph.relations.filter(relation => (cadSketchRelationEntityIds(relation).includes(entityId)
    || cadSketchRelationPointIds(graph, relation).some(id => detached.includes(id)))
    && !(relation.kind === 'reference-dimension' && (retained || !cadSketchRelationEntityIds(relation).includes(entityId)))
    && !(retained && (retained.kind === 'line' ? retainedLineDirection(graph, retained, relation) : retainedArcRadius(retained, relation))));
  const drivers = detached.filter(id => graph.points.find(point => point.id === id)?.position.some(value => typeof value === 'string')
    || owners.some(relation => cadSketchRelationPointIds(graph, relation).includes(id)));
  if (owners.length || drivers.length) throw operation === 'trim' ? new CadSketchTrimDependencyError(owners.map(relation => relation.id), drivers)
    : new CadSketchExtendDependencyError(owners.map(relation => relation.id), drivers);
}
type SourceEntity = CadSketchGraph['entities'][number];
/** What a trim does to its source: removes it, moves one end, removes an interior span, or opens a circle. */
type TrimShape = { readonly kind: 'delete' } | { readonly kind: 'end'; readonly end: 'start' | 'end' } | { readonly kind: 'middle' } | { readonly kind: 'circle' };
/** The points a relation names directly, rather than through the entities it names. */
function relationPointOperands(relation: CadSketchGraphRelation): readonly string[] {
  switch (relation.kind) {
    case 'coincident': case 'horizontal': case 'vertical': case 'distance': case 'axis-distance': case 'symmetric': return relation.pointIds;
    case 'fixed-point': case 'fixed-axis': case 'midpoint': case 'point-on-line': case 'fillet-corner': case 'chamfer-corner': return [relation.pointId];
    case 'reference-dimension': return relation.measurement.kind === 'point-distance' ? relation.measurement.pointIds : [];
    case 'tangent-joint': return relation.endpoints.map(endpoint => endpoint.pointId);
    case 'line-angle': return relation.rays.map(ray => ray.towardPointId);
    default: return [];
  }
}
function namesEntity(relation: CadSketchGraphRelation, entityId: string): boolean {
  return cadSketchRelationEntityIds(relation).includes(entityId) || relation.kind === 'line-angle' && relation.rays.some(ray => ray.lineId === entityId);
}
/** A fillet or chamfer corner whose rounding meets `pointId`, or that rounds `entityId` itself. */
function cornerAt(graph: CadSketchGraph, relation: CadSketchGraphRelation, entityId: string, pointId: string): boolean {
  if (relation.kind !== 'fillet-corner' && relation.kind !== 'chamfer-corner') return false;
  const corner = graph.entities.find(item => item.id === (relation.kind === 'fillet-corner' ? relation.arcId : relation.chamferId));
  return corner?.id === entityId || relation.pointId === pointId || Boolean(corner && cadSketchEntityPointIds(corner).includes(pointId));
}
/**
 * The relations and points that only describe the piece a trim removes; everything else stays. A point leaves with the
 * source only when no remaining edge uses it or a point coincident with it, and its relations leave with it. Relations of
 * the source itself stay while its support does, except those its changed extent would redefine. Pattern and
 * preceding-sketch owners generate the source, so they must be detached first.
 */
function trimRemovals(graph: CadSketchGraph, entity: SourceEntity, shape: TrimShape): { readonly relationIds: readonly string[]; readonly pointIds: readonly string[] } {
  const owners = graph.relations.filter(relation => (relation.kind === 'linear-pattern' || relation.kind === 'external-reference') && namesEntity(relation, entity.id));
  if (owners.length) throw new CadSketchTrimDependencyError(owners.map(relation => relation.id), []);
  const old = entity.kind === 'circle' ? null : shape.kind === 'end' ? shape.end === 'start' ? entity.startPointId : entity.endPointId : null;
  const leaving = shape.kind === 'delete' ? cadSketchEntityPointIds(entity) : old ? [old] : [];
  const used = new Set(graph.entities.flatMap(item => item.id === entity.id ? shape.kind === 'delete' ? [] : cadSketchEntityPointIds(item).filter(id => id !== old) : cadSketchEntityPointIds(item)));
  const identity = resolveCadSketchPointIdentities(graph), live = new Set([...used].map(identity));
  const orphans = new Set(leaving.filter(id => !used.has(id) && !live.has(identity(id))));
  const line = entity.kind === 'line' ? entity : null;
  const ownAxis = (relation: CadSketchGraphRelation) => line !== null && (relation.kind === 'horizontal' || relation.kind === 'vertical') && sameEndpointPair(line, relation.pointIds);
  const removed = graph.relations.filter(relation => {
    const named = namesEntity(relation, entity.id);
    if (shape.kind === 'delete') {
      if (named) return true;
      if (ownAxis(relation) && 'pointIds' in relation && !graph.entities.some(other => other.id !== entity.id && other.kind !== 'circle' && sameEndpointPair(other, relation.pointIds))) return true;
    } else if (shape.kind === 'end' && old) {
      if (named && (relation.kind === 'midpoint' || relation.kind === 'equal-length')) return true;
      if (relation.kind === 'tangent-joint' && relation.endpoints.some(endpoint => endpoint.entityId === entity.id && endpoint.pointId === old)) return true;
      if (named && cornerAt(graph, relation, entity.id, old)) return true;
      // Its own axis relation and a ray toward the moved end follow that end to the cut.
      if (ownAxis(relation)) return false;
      if (relation.kind === 'line-angle') return relation.rays.some(ray => !(ray.lineId === entity.id && ray.towardPointId === old) && orphans.has(ray.towardPointId));
    } else if (shape.kind === 'middle') {
      if (named && (relation.kind === 'midpoint' || relation.kind === 'equal-length')) return true;
      if (named && (relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') && cornerAt(graph, relation, entity.id, '')) return true;
    }
    return relationPointOperands(relation).some(id => orphans.has(id));
  });
  return { relationIds: removed.map(relation => relation.id), pointIds: [...orphans] };
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
function circlePieces(circle: CirclePathSegment, previous: Event, next: Event): readonly [ArcPathSegment, ArcPathSegment] {
  const span = next.witness.parameter - previous.witness.parameter, sweep = (span > 0 ? span : 1 + span) * fullTurn;
  const tolerance = cadPathClosureTolerance([circle.center, previous.point, next.point]);
  if (distance(previous.point, next.point) <= Math.max(1e-7, tolerance)) throw precision();
  const common = { id: circle.id, source: circle.source, center: circle.center, clockwise: false }, source = { ...common, radius: circle.radius };
  const removed = createArcSegment({ ...common, start: previous.point, end: next.point });
  const survivor = createArcSegment({ ...common, start: next.point, end: previous.point });
  checkArcPiece(source, removed, sweep, tolerance); checkArcPiece(source, survivor, fullTurn - sweep, tolerance);
  if (Math.abs(removed.sweepRadians + survivor.sweepRadians - fullTurn) * circle.radius > tolerance) throw precision();
  return [removed, survivor];
}
/** A circle checks its pieces as a counterclockwise source arc. */
function checkArcPiece(source: Pick<ArcPathSegment, 'center' | 'radius' | 'clockwise'>, piece: ArcPathSegment, expected: number, tolerance: number, operation: 'trim' | 'extend' = 'trim'): void {
  const a = { x: piece.start.x - source.center.x, y: piece.start.y - source.center.y }, b = { x: piece.end.x - source.center.x, y: piece.end.y - source.center.y };
  const direction = source.clockwise ? -1 : 1, cross = direction * (a.x * b.y - a.y * b.x), dot = a.x * b.x + a.y * b.y;
  const sweep = direction * piece.sweepRadians;
  if (!(direction * expected > 0 && direction * expected < fullTurn) || !(sweep > 0 && sweep < fullTurn) || piece.clockwise !== source.clockwise
    || distance(piece.center, source.center) > tolerance || Math.abs(piece.radius - source.radius) > tolerance
    || Math.abs(distance(piece.center, piece.start) - source.radius) > tolerance || Math.abs(distance(piece.center, piece.end) - source.radius) > tolerance
    || Math.abs(piece.sweepRadians - expected) >= Math.PI || Math.abs(piece.sweepRadians - expected) * source.radius > tolerance
    || cross > 0 && sweep >= Math.PI || cross < 0 && sweep <= Math.PI || cross === 0 && dot >= 0) throw precision(operation);
}
function middleArcPieces(segment: ArcPathSegment, left: Event, right: Event) {
  const make = (start: Point2, end: Point2) => createArcSegment({ id: segment.id, source: segment.source, center: segment.center,
    clockwise: segment.clockwise, start, end });
  const before = make(segment.start, left.point), removed = make(left.point, right.point), after = make(right.point, segment.end);
  const expected = [segment.sweepRadians * left.witness.parameter, segment.sweepRadians * (right.witness.parameter - left.witness.parameter),
    segment.sweepRadians * (1 - right.witness.parameter)];
  const tolerance = cadPathClosureTolerance([segment.center, segment.start, left.point, right.point, segment.end]);
  for (const [index, piece] of [before, removed, after].entries()) checkArcPiece(segment, piece, expected[index], tolerance);
  if (Math.abs(before.sweepRadians + removed.sweepRadians + after.sweepRadians - segment.sweepRadians) * segment.radius > tolerance) throw precision();
  return { removed, survivors: [before, after] as const };
}

function boundaryEvents(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, segments: readonly PathSegment[], query: BoundaryQuery): Event[] {
  const { segment } = query, operation = query.kind;
  const numericPoints = new Map(graph.points.map(point => [point.id, { x: evaluateCadScalar(point.position[0], parameters), y: evaluateCadScalar(point.position[1], parameters) }]));
  const joint = resolveCadSketchGraphJoints(graph, numericPoints), events: Event[] = [];
  const support = query.kind === 'extend' && segment.kind === 'arc'
    ? createCircleSegment({ id: segment.id, source: segment.source, center: segment.center, radius: segment.radius }) : null;
  const endpointIds = (id: string) => { const entity = graph.entities.find(item => item.id === id); return entity && entity.kind !== 'circle' ? [entity.startPointId, entity.endPointId] : []; };
  /** The arrangement's tangency rule, so trims and cells agree at every sketch position; declared joints are topology. */
  const undeclaredTangent = (reach: PathSegment, other: PathSegment, tolerance: number) => {
    const contact = cadPathTangentContact(reach, other, tolerance), own = endpointIds(segment.id);
    return contact && !endpointIds(other.id).some(id => own.some(mine => joint(mine) === joint(id)) && numericPoints.has(id) && distance(numericPoints.get(id)!, contact) <= tolerance) ? contact : null;
  };
  const assertTransverse = (reach: PathSegment, other: PathSegment, tolerance: number) => {
    if (undeclaredTangent(reach, other, tolerance)) throw ambiguous(operation);
  };
  /** Whether a trim contact is the source's own end. A far boundary widens the shared tolerance, so a contact only that wide
   * tolerance places at an end is too uncertain to skip or cut at, unless a boundary line declares that end of a source line
   * as its own: two distinct lines meet only once, so no other crossing can hide beside it. */
  const ownEnd = (point: Point2, tolerance: number, other: PathSegment): boolean => {
    if (segment.kind === 'circle') return false;
    const gap = Math.min(distance(point, segment.start), distance(point, segment.end));
    if (gap <= cadPathClosureTolerance([...extent(segment), point])) return true;
    if (gap > tolerance) return false;
    const own = endpointIds(segment.id);
    if (segment.kind === 'line' && other.kind === 'line' && endpointIds(other.id)
      .some(id => own.some(mine => joint(mine) === joint(id)) && numericPoints.has(id) && distance(numericPoints.get(id)!, point) <= tolerance)) return true;
    throw precision(operation);
  };
  /** A contact strictly inside the source, away from its own ends; trims only. */
  const inside = (point: Point2, tolerance: number, other: PathSegment): number | null => {
    const t = trimParameter(segment, point, tolerance);
    return t === null || ownEnd(point, tolerance, other) ? null : t;
  };
  for (const other of segments) {
    if (other.id === segment.id) continue;
    const tolerance = cadPathClosureTolerance([...extent(support ?? segment), ...extent(other)]);
    const result = query.kind === 'extend' && query.segment.kind === 'line' ? classifyLineRayPathSegmentIntersection(query.segment, other, query.end, tolerance)
      : classifyParameterizedPathSegmentIntersection(support ?? segment, other, tolerance);
    if (result.kind === 'overlap') {
      if (query.kind !== 'trim') throw ambiguous(operation);
      // A shared stretch has no crossing of its own: the overlapping edge's own ends inside the source bound its pieces.
      const owner = graph.entities.find(item => item.id === other.id);
      if (owner && owner.kind !== 'circle') for (const [index, pointId] of [owner.startPointId, owner.endPointId].entries()) {
        const point = numericPoints.get(pointId), t = point ? inside(point, tolerance, other) : null;
        if (point && t !== null) events.push({ witness: { entityId: other.id, index, parameter: t, position: [point.x, point.y], endpointPointId: pointId }, boundary: other, point });
      }
      continue;
    }
    if (query.kind === 'trim') {
      // A tangent contact cannot be cut at, but it only blocks the pieces it bounds.
      const contact = undeclaredTangent(segment, other, tolerance), t = contact ? inside(contact, tolerance, other) : null;
      if (contact && t !== null) events.push({ witness: { entityId: other.id, index: 0, parameter: t, position: [contact.x, contact.y] }, boundary: other, point: contact, tangent: true });
      if (contact) continue;
    // A line extension's span is only known per hit; arc supports also catch rounded near-misses.
    } else if (segment.kind !== 'line') assertTransverse(support ?? segment, other, tolerance);
    if (result.kind !== 'points') continue;
    const hits = result.points.map(hit => ({ hit, parameter: query.kind === 'extend' && segment.kind === 'arc' ? arcOutwardParameter(segment, hit.point, query.end)
      : segment.kind === 'circle' ? cadSketchCircleTrimParameter(segment, hit.point) : hit.leftParameter }))
      .sort((a, b) => (a.parameter ?? -1) - (b.parameter ?? -1));
    for (const [index, candidate] of hits.entries()) {
      const { hit, parameter: t } = candidate;
      if (t === null || !Number.isFinite(t)) throw precision(operation);
      // A contact at the source's own end is not a cut, however rounding places it along a rotated edge.
      if (query.kind === 'trim' && ownEnd(hit.point, tolerance, other)) continue;
      if (query.kind === 'trim' ? t < 0 || t > 1 : query.end === 'start' ? t > 0 : t < 1) throw precision(operation);
      const total = query.kind === 'extend' && segment.kind === 'arc' ? Math.abs(segment.sweepRadians) * (query.end === 'start' ? 1 - t : t) : null;
      if (total !== null && total > fullTurn) continue;
      const point = segment.kind === 'circle' || support ? hit.point : at(segment, t);
      if (distance(point, hit.point) > tolerance) throw precision(operation);
      if ((segment.kind === 'circle' || support) && segment.kind !== 'line' && Math.abs(distance(point, segment.center) - segment.radius) > tolerance) throw precision(operation);
      const boundaryEntity = graph.entities.find(item => item.id === other.id);
      // A boundary's own end touching the source stays that end, however rounding places it along a rotated edge.
      const right = query.kind !== 'trim' || other.kind === 'circle' || hit.rightParameter === null ? hit.rightParameter
        : distance(hit.point, other.start) <= tolerance ? 0 : distance(hit.point, other.end) <= tolerance ? 1 : hit.rightParameter;
      const endpointPointId = boundaryEntity && boundaryEntity.kind !== 'circle'
        ? right === 0 ? boundaryEntity.startPointId : right === 1 ? boundaryEntity.endPointId : undefined : undefined;
      if (query.kind === 'extend' && segment.kind === 'arc') {
        const entity = graph.entities.find(entity => entity.id === segment.id);
        if (!entity || entity.kind !== 'arc') throw precision(operation);
        const current = query.end === 'start' ? segment.start : segment.end, opposite = query.end === 'start' ? segment.end : segment.start;
        const same = (position: Point2, id: string): boolean => {
          if (point.x === position.x && point.y === position.y || endpointPointId !== undefined && joint(endpointPointId) === joint(id)) return true;
          if (other.kind !== 'line' || boundaryEntity?.kind !== 'line' || hit.rightParameter === null) return false;
          const parameter = hit.rightParameter;
          const dx = other.end.x - other.start.x, dy = other.end.y - other.start.y;
          const closest = -((other.start.x - segment.center.x) * dx + (other.start.y - segment.center.y) * dy) / (dx * dx + dy * dy);
          // A declared common endpoint names one analytic root, not its nearby sibling.
          return [boundaryEntity.startPointId, boundaryEntity.endPointId].some((pointId, index) => {
            const saved = numericPoints.get(pointId);
            return joint(pointId) === joint(id) && saved !== undefined && distance(saved, point) <= tolerance
              && Math.sign(index - closest) === Math.sign(parameter - closest);
          });
        };
        if (same(opposite, query.end === 'start' ? entity.endPointId : entity.startPointId)) continue;
        if (total === fullTurn) throw precision(operation);
        if (t === (query.end === 'start' ? 0 : 1)) {
          if (same(current, query.end === 'start' ? entity.startPointId : entity.endPointId)) continue;
          throw precision(operation);
        }
      }
      if (other.kind === 'circle') {
        if (Math.abs(distance(point, other.center) - other.radius) > tolerance) throw precision(operation);
      } else if (right === null || right < 0 || right > 1 || distance(point, at(other, right)) > tolerance) throw precision(operation);
      if (query.kind === 'extend' && segment.kind === 'line') assertTransverse(createLineSegment({ ...segment, [query.end]: point }), other, tolerance);
      if (query.kind === 'trim' ? segment.kind !== 'circle' && (t === 0 || t === 1) : segment.kind === 'line' && t === (query.end === 'start' ? 0 : 1)) continue;
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
    // Trim cuts once where several boundaries meet; Extend still needs them to share one declared joint.
    if (operation === 'trim') return true;
    const left = a.witness.endpointPointId, right = b.witness.endpointPointId;
    if (!left || !right || joint(left) !== joint(right)) throw ambiguous(operation);
    return true;
  };
  // The cut keeps an existing endpoint's identity when one is there, else the lowest boundary; a tangent member blocks it.
  const merge = (kept: Event, other: Event): Event => {
    const chosen = !kept.witness.endpointPointId && other.witness.endpointPointId ? other : kept;
    return kept.tangent || other.tangent ? { ...chosen, tangent: true } : chosen;
  };
  for (const event of events) {
    const previous = unique.at(-1);
    if (previous && sameContact(previous, event)) { unique[unique.length - 1] = merge(previous, event); continue; }
    unique.push(event);
  }
  if (segment.kind === 'circle' && unique.length > 1 && sameContact(unique[0], unique[unique.length - 1])) {
    // The seam cut may keep the witness just below one, so restore parameter order around the circle.
    unique[0] = merge(unique[0], unique.pop()!);
    unique.sort((a, b) => a.witness.parameter - b.witness.parameter);
  }
  return unique;
}

/** Drop detached points nothing uses; a point a relation still names stays explicit. */
function withoutDetachedPoints(graph: CadSketchGraph, detached: readonly string[]): CadSketchGraph {
  const used = new Set([...graph.entities.flatMap(cadSketchEntityPointIds), ...graph.relations.flatMap(relation => cadSketchRelationPointIds(graph, relation))]);
  const removed = new Set(detached.filter(id => !used.has(id)));
  return removed.size ? parseCadSketchGraph({ ...graph, points: graph.points.filter(point => !removed.has(point.id)) }) : graph;
}

function replaceEndpoint(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, entityId: string, end: 'start' | 'end',
  witness: Witness, pointId: string, operation: 'trim' | 'extend'): CadSketchGraph {
  const endpoint = witness.endpointPointId;
  if (endpoint !== undefined && pointId !== endpoint) throw new CadError(`invalid-sketch-${operation}-point`, 'Use the exact witnessed boundary endpoint identity.');
  const source = graph.entities.find(entity => entity.id === entityId), line = source?.kind === 'line' ? source : null;
  // A surviving line explicitly transfers only its own endpoint-pair axis relation, unless another edge shares that pair.
  // Adjacent axis operands keep the detached old point; scalar/attachment drivers never transfer.
  const relations = line ? graph.relations.map((relation): CadSketchGraphRelation => {
    if ((relation.kind !== 'horizontal' && relation.kind !== 'vertical') || !sameEndpointPair(line, relation.pointIds)
      || graph.entities.some(other => other.id !== line.id && other.kind !== 'circle' && sameEndpointPair(other, relation.pointIds))) return relation;
    const old = end === 'start' ? line.startPointId : line.endPointId;
    return { ...relation, pointIds: [relation.pointIds[0] === old ? pointId : relation.pointIds[0], relation.pointIds[1] === old ? pointId : relation.pointIds[1]] };
  }) : graph.relations;
  const candidate = parseCadSketchGraph({ ...graph, relations,
    points: endpoint === undefined ? [...graph.points, { id: pointId, position: witness.position }] : graph.points,
    entities: graph.entities.map(entity => entity.id === entityId ? { ...entity, [end === 'start' ? 'startPointId' : 'endPointId']: pointId } : entity) });
  compileCadSketchGraph(candidate, parameters);
  return withoutDetachedPoints(candidate, source && source.kind !== 'circle' ? [end === 'start' ? source.startPointId : source.endPointId] : []);
}

/** Relations that leave with the removed piece; omitted when there are none so plain trims keep their request shape. */
const removals = ({ relationIds }: { readonly relationIds: readonly string[] }) => relationIds.length ? { removedRelationIds: [...relationIds] } : {};

/** One clicked span between its nearest cuts; only the relations of the removed piece go with it. */
export function prepareCadSketchTrim({ graph: input, parameters, entityId, parameter: pick }: Source & {
  readonly entityId: string; readonly parameter: number;
}): CadSketchTrimPreparation {
  if (!Number.isFinite(pick) || pick < 0 || pick > 1) throw new CadError('invalid-sketch-trim', 'Choose a finite source parameter from zero to one.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === entityId);
  if (!entity) throw new CadError('invalid-sketch-trim-target', 'Trim needs an existing graph edge.');
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entityId);
  if (!segment) throw new CadError('invalid-sketch-trim-target', 'Trim needs an existing graph edge.');
  const unique = boundaryEvents(graph, parameters, geometry.segments, { kind: 'trim', segment });
  const bounds = (...events: Event[]) => {
    if (events.some(event => event.tangent)) throw new CadError('tangent-sketch-trim', 'Trim cannot cut where an edge only touches this one. Choose a piece between crossing edges.');
    for (const event of events) assertEndpointRange(event.point, 'trim');
  };
  // A fresh cut inside a cutting line can stay on that line; curved cutters have no such relation yet.
  const attachLine = (event: Event) => event.witness.endpointPointId === undefined && event.boundary.kind === 'line' ? event.boundary.id : null;
  if (!unique.length) {
    const result: CadSketchEndTrimPreparation = { target: { kind: 'delete', entityId, parameter: pick, ...removals(trimRemovals(graph, entity, { kind: 'delete' })) }, removed: segment,
      survivor: null, boundary: null, point: null, attachLineId: null };
    deepFreezeCadData(result); return result;
  }
  if (segment.kind === 'circle') {
    if (entity.kind !== 'circle') throw precision();
    if (unique.length < 2) throw new CadError('ambiguous-sketch-trim', 'Trim needs two crossing edges to remove part of a circle.');
    if (typeof entity.radius === 'string') throw new CadError('driven-sketch-trim-radius', "Edit or release this circle's radius expression before trimming.");
    const phase = pick === 1 ? 0 : pick, cursor = { x: segment.center.x + segment.radius * Math.cos(phase * fullTurn),
      y: segment.center.y + segment.radius * Math.sin(phase * fullTurn) };
    for (const event of unique) {
      const delta = Math.abs(phase - event.witness.parameter);
      if (Math.min(delta, 1 - delta) * segment.length <= cadPathClosureTolerance([cursor, event.point]))
        throw new CadError('ambiguous-sketch-trim', 'Choose the portion to remove, away from its intersection.');
    }
    const after = unique.findIndex(event => event.witness.parameter > phase), nextIndex = after < 0 ? 0 : after;
    const previous = unique[(nextIndex + unique.length - 1) % unique.length], next = unique[nextIndex];
    bounds(previous, next);
    const [removed, survivor] = circlePieces(segment, previous, next);
    const result: CadSketchCircleTrimPreparation = { target: { kind: 'circle', entityId, parameter: pick,
      boundaries: [previous.witness, next.witness], ...removals(trimRemovals(graph, entity, { kind: 'circle' })) }, removed, survivor,
      cuts: [{ boundary: previous.boundary, point: [previous.point.x, previous.point.y] }, { boundary: next.boundary, point: [next.point.x, next.point.y] }],
      attachLineIds: [attachLine(previous), attachLine(next)] };
    deepFreezeCadData(result); return result;
  }
  if (entity.kind === 'circle') throw precision();
  for (const event of unique) if (Math.abs(pick - event.witness.parameter) * segment.length <= cadPathClosureTolerance([at(segment, pick), event.point]))
    throw new CadError('ambiguous-sketch-trim', 'Choose the portion to remove, away from its intersection.');
  const first = unique[0], last = unique[unique.length - 1];
  const end = pick < first.witness.parameter ? 'start' : pick > last.witness.parameter ? 'end' : null;
  if (!end) {
    const after = unique.findIndex(event => event.witness.parameter > pick), left = unique[after - 1], right = unique[after];
    bounds(left, right);
    const minimum = Math.max(1e-7, cadPathClosureTolerance([segment.start, left.point, right.point, segment.end]));
    if (distance(segment.start, left.point) <= minimum || distance(left.point, right.point) <= minimum || distance(right.point, segment.end) <= minimum) throw precision();
    const contacts: MiddleTrimContacts = {
      target: { kind: 'middle', entityId, parameter: pick, boundaries: [left.witness, right.witness], ...removals(trimRemovals(graph, entity, { kind: 'middle' })) },
      cuts: [{ boundary: left.boundary, point: [left.point.x, left.point.y] }, { boundary: right.boundary, point: [right.point.x, right.point.y] }],
      attachLineIds: [attachLine(left), attachLine(right)]
    };
    const result: CadSketchMiddleTrimPreparation = segment.kind === 'line' ? { ...contacts,
      removed: createLineSegment({ ...segment, start: left.point, end: right.point }),
      survivors: [createLineSegment({ ...segment, end: left.point }), createLineSegment({ ...segment, start: right.point })] }
      : { ...contacts, ...middleArcPieces(segment, left, right) };
    deepFreezeCadData(result); return result;
  }
  const event = end === 'start' ? first : last;
  bounds(event);
  const pieces = partition(segment, event.point, event.witness.parameter);
  const result: CadSketchEndTrimPreparation = { target: { kind: 'end', entityId, parameter: pick, end, boundary: event.witness, ...removals(trimRemovals(graph, entity, { kind: 'end', end })) },
    removed: pieces[end === 'start' ? 0 : 1], survivor: pieces[end === 'start' ? 1 : 0], boundary: event.boundary,
    point: [event.point.x, event.point.y], attachLineId: attachLine(event) };
  deepFreezeCadData(result); return result;
}

/** Recheck the exact preview witness and removals; never retarget a changed source to another intersection. */
export function trimCadSketchEntity({ graph: input, parameters, trim }: Source & { readonly trim: CadSketchTrimTarget }): CadSketchTrimResult {
  if (!isCadImportData(trim) || !Value.Check(CadSketchTrimTargetSchema, trim)) throw new CadError('invalid-sketch-trim', 'Choose one complete trim request.');
  const graph = parseCadSketchGraph(input), prepared = prepareCadSketchTrim({ graph, parameters, entityId: trim.entityId, parameter: trim.parameter });
  const removedRelationIds = trim.removedRelationIds ?? [], confirmed = removals({ relationIds: removedRelationIds });
  const target = trim.kind === 'delete' ? { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, ...confirmed } : trim.kind === 'end'
    ? { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, end: trim.end, boundary: trim.boundary, ...confirmed }
    : { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, boundaries: trim.boundaries, ...confirmed };
  if (!Value.Equal(prepared.target, target)) {
    const expected = prepared.target.removedRelationIds ?? [];
    if (Value.Equal({ ...prepared.target, removedRelationIds: undefined }, { ...target, removedRelationIds: undefined }))
      throw new CadError('unconfirmed-sketch-trim-removals', `This trim removes ${expected.length === 1 ? 'one relation' : `${expected.length} relations`} with its piece${expected.length ? `: ${expected.join(', ')}` : ''}. Send exactly these IDs as removedRelationIds to confirm.`);
    throw new CadError('stale-sketch-trim', 'The trim boundary changed. Choose the portion again.');
  }
  const source = graph.entities.find(entity => entity.id === trim.entityId)!, removed = new Set(removedRelationIds);
  const kept = graph.relations.filter(relation => !removed.has(relation.id));
  const attach = (relationId: string | null | undefined, lineId: string | null, pointId: string): CadSketchGraphRelation[] => {
    if (relationId === undefined || relationId === null) return [];
    if (lineId === null) throw new CadError('invalid-sketch-trim-attachment', 'Only a new cut inside a cutting line can stay on that line.');
    return [{ id: relationId, kind: 'point-on-line', pointId, lineId }];
  };
  if (trim.kind === 'delete') {
    const orphans = new Set(trimRemovals(graph, source, { kind: 'delete' }).pointIds);
    return Object.freeze({ graph: withoutDetachedPoints(parseCadSketchGraph({ points: graph.points.filter(point => !orphans.has(point.id)),
      entities: graph.entities.filter(entity => entity.id !== trim.entityId), relations: kept }), cadSketchEntityPointIds(source)),
    retainedEntityId: null, removedEntityId: trim.entityId, cutPointId: null });
  }
  const attachments = (ids: readonly [string | null, string | null] | undefined, cutPointIds: readonly [string, string]) => 'attachLineIds' in prepared
    ? ids?.flatMap((relationId, index) => attach(relationId, prepared.attachLineIds[index], cutPointIds[index])) ?? [] : [];
  if (trim.kind === 'circle') {
    const circle = source;
    if (circle.kind !== 'circle' || !('survivor' in prepared) || prepared.survivor?.kind !== 'arc') throw precision();
    for (const [index, witness] of trim.boundaries.entries()) if (witness.endpointPointId !== undefined && trim.cutPointIds[index] !== witness.endpointPointId)
      throw new CadError('invalid-sketch-trim-point', 'Use the exact witnessed boundary endpoint identity.');
    const joint = resolveCadSketchPointIdentities(graph), keys = trim.boundaries.map((witness, index) => witness.endpointPointId === undefined
      ? trim.cutPointIds[index] : joint(trim.cutPointIds[index]));
    if (keys[0] === keys[1] || keys.includes(joint(circle.centerPointId))) throw new CadError('invalid-sketch-trim-point', 'The circle cuts and center need distinct point identities.');
    const candidate = parseCadSketchGraph({ ...graph,
      points: [...graph.points, ...trim.boundaries.flatMap((witness, index) => witness.endpointPointId === undefined ? [{ id: trim.cutPointIds[index], position: witness.position }] : [])],
      entities: graph.entities.map(entity => entity.id === circle.id ? { id: circle.id, kind: 'arc', construction: circle.construction,
        centerPointId: circle.centerPointId, startPointId: trim.cutPointIds[1], endPointId: trim.cutPointIds[0], direction: 'ccw' } : entity),
      relations: [...kept, ...attachments(trim.attachRelationIds, trim.cutPointIds)] });
    const actual = compileCadSketchGraph(candidate, parameters).segments.find(segment => segment.id === circle.id);
    if (actual?.kind !== 'arc') throw precision();
    const support = { center: prepared.survivor.center, radius: evaluateCadScalar(circle.radius, parameters), clockwise: false };
    checkArcPiece(support, actual, prepared.survivor.sweepRadians, cadPathClosureTolerance([actual.center, actual.start, actual.end]));
    return Object.freeze({ graph: candidate, retainedEntityId: circle.id, removedEntityId: null,
      cutPointIds: Object.freeze([trim.cutPointIds[0], trim.cutPointIds[1]] satisfies [string, string]) });
  }
  if (source.kind === 'circle') throw new CadError('invalid-sketch-trim-target', 'Trim a circle as a circle.');
  if (trim.kind === 'middle') {
    for (const [index, witness] of trim.boundaries.entries()) if (witness.endpointPointId !== undefined && trim.cutPointIds[index] !== witness.endpointPointId)
      throw new CadError('invalid-sketch-trim-point', 'Use the exact witnessed boundary endpoint identity.');
    if (source.kind === 'arc') {
      const joint = resolveCadSketchPointIdentities(graph), outer = [source.centerPointId, source.startPointId, source.endPointId].map(joint);
      const cuts = trim.boundaries.map((witness, index) => witness.endpointPointId === undefined ? trim.cutPointIds[index] : joint(trim.cutPointIds[index]));
      if (cuts[0] === cuts[1] || cuts.some(cut => outer.includes(cut))) throw new CadError('invalid-sketch-trim-point', 'Arc cuts need distinct identities from the original center and endpoints.');
    }
    const support: CadSketchGraphRelation = source.kind === 'line' ? { id: trim.supportRelationId, kind: 'collinear', lineIds: [source.id, trim.newEntityId] }
      : { id: trim.supportRelationId, kind: 'equal-radius', curveIds: [source.id, trim.newEntityId] };
    // Joints, corners and rays at the source's end now belong to the end-side piece.
    const end = source.endPointId, moved = (lineId: string) => lineId === source.id ? trim.newEntityId : lineId;
    const relations = kept.map((relation): CadSketchGraphRelation => {
      if (relation.kind === 'tangent-joint') return { ...relation, endpoints: [relation.endpoints[0], relation.endpoints[1]].map(endpoint =>
        endpoint.entityId === source.id && endpoint.pointId === end ? { ...endpoint, entityId: trim.newEntityId } : endpoint) as [typeof relation.endpoints[0], typeof relation.endpoints[1]] };
      if ((relation.kind === 'fillet-corner' || relation.kind === 'chamfer-corner') && relation.lineIds.includes(source.id) && cornerAt(graph, relation, '', end)) {
        const lineIds = [moved(relation.lineIds[0]), moved(relation.lineIds[1])], swap = lineIds[0] > lineIds[1];
        const ordered: [string, string] = swap ? [lineIds[1], lineIds[0]] : [lineIds[0], lineIds[1]];
        return relation.kind === 'fillet-corner' ? { ...relation, lineIds: ordered }
          : { ...relation, lineIds: ordered, values: swap ? [relation.values[1], relation.values[0]] : relation.values };
      }
      if (relation.kind === 'line-angle') return { ...relation, rays: [relation.rays[0], relation.rays[1]].map(ray =>
        ray.lineId === source.id && ray.towardPointId === end ? { ...ray, lineId: trim.newEntityId } : ray) as [typeof relation.rays[0], typeof relation.rays[1]] };
      return relation;
    });
    const candidate = parseCadSketchGraph({ ...graph,
      points: [...graph.points, ...trim.boundaries.flatMap((witness, index) => witness.endpointPointId === undefined ? [{ id: trim.cutPointIds[index], position: witness.position }] : [])],
      entities: graph.entities.flatMap(entity => entity.id === source.id ? [{ ...source, endPointId: trim.cutPointIds[0] },
        { ...source, id: trim.newEntityId, startPointId: trim.cutPointIds[1] }] : [entity]),
      relations: [...relations, support, ...attachments(trim.attachRelationIds, trim.cutPointIds)] });
    const compiled = compileCadSketchGraph(candidate, parameters);
    if (source.kind === 'arc' && 'survivors' in prepared) for (const [index, expected] of prepared.survivors.entries()) {
      const actual = compiled.segments.find(segment => segment.id === (index === 0 ? source.id : trim.newEntityId));
      if (expected.kind !== 'arc' || actual?.kind !== 'arc') throw precision();
      checkArcPiece(expected, actual, expected.sweepRadians, cadPathClosureTolerance([expected.center, expected.start, expected.end]));
    }
    return Object.freeze({ graph: candidate, retainedEntityId: source.id, removedEntityId: null,
      cutPointIds: Object.freeze([trim.cutPointIds[0], trim.cutPointIds[1]] satisfies [string, string]), newEntityId: trim.newEntityId });
  }
  // A ray toward the moved end follows it to the cut.
  const old = trim.end === 'start' ? source.startPointId : source.endPointId;
  const relations = kept.map((relation): CadSketchGraphRelation => relation.kind === 'line-angle' ? { ...relation, rays: [relation.rays[0], relation.rays[1]].map(ray =>
    ray.lineId === source.id && ray.towardPointId === old ? { ...ray, towardPointId: trim.cutPointId } : ray) as [typeof relation.rays[0], typeof relation.rays[1]] } : relation);
  const candidate = replaceEndpoint({ ...graph, relations: [...relations, ...attach(trim.attachRelationId, 'attachLineId' in prepared ? prepared.attachLineId : null, trim.cutPointId)] },
    parameters, trim.entityId, trim.end, trim.boundary, trim.cutPointId, 'trim');
  return Object.freeze({ graph: candidate, retainedEntityId: trim.entityId, removedEntityId: null, cutPointId: trim.cutPointId });
}

/** Extend one endpoint along its exact source support; cutters remain finite and untouched. */
export function prepareCadSketchExtend({ graph: input, parameters, entityId, end }: Source & { readonly entityId: string; readonly end: 'start' | 'end' }): CadSketchExtendPreparation {
  if (end !== 'start' && end !== 'end') throw new CadError('invalid-sketch-extend', 'Choose the start or end of one edge.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === entityId);
  if (entity?.kind === 'line') return prepareLineExtend(graph, parameters, entity, end);
  if (!entity || entity.kind !== 'arc') throw new CadError('invalid-sketch-extend-target', 'Extend needs an existing line or open arc.');
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entityId);
  if (!segment || segment.kind !== 'arc') throw precision('extend');
  assertDependencies(graph, entityId, [end === 'start' ? entity.startPointId : entity.endPointId], 'extend', entity);
  const events = boundaryEvents(graph, parameters, geometry.segments, { kind: 'extend', segment, end }), event = end === 'start' ? events.at(-1) : events[0];
  if (!event) throw new CadError('missing-sketch-extend-boundary', 'No finite boundary intersects the unused circular support beyond this endpoint.');
  assertEndpointRange(event.point, 'extend');
  const current = end === 'start' ? segment.start : segment.end, opposite = end === 'start' ? segment.end : segment.start;
  const tolerance = cadPathClosureTolerance([segment.center, segment.start, segment.end, event.point]), minimum = Math.max(1e-7, tolerance);
  if (distance(current, event.point) <= minimum || distance(opposite, event.point) <= minimum) throw precision('extend');
  if (event.witness.endpointPointId !== undefined) {
    const joint = resolveCadSketchPointIdentities(graph), key = joint(event.witness.endpointPointId);
    if (key === joint(entity.centerPointId) || key === joint(end === 'start' ? entity.endPointId : entity.startPointId)) throw precision('extend');
  }
  const make = (start: Point2, finish: Point2) => createArcSegment({ id: segment.id, source: segment.source, center: segment.center,
    start, end: finish, clockwise: segment.clockwise });
  const extended = make(end === 'start' ? event.point : segment.start, end === 'end' ? event.point : segment.end);
  const added = make(end === 'start' ? event.point : current, end === 'start' ? current : event.point);
  const expected = segment.sweepRadians * (end === 'start' ? 1 - event.witness.parameter : event.witness.parameter);
  checkArcPiece(segment, extended, expected, tolerance, 'extend'); checkArcPiece(segment, added, expected - segment.sweepRadians, tolerance, 'extend');
  const result: CadSketchArcExtendPreparation = { target: { kind: 'arc', entityId, end, boundary: event.witness }, added, extended,
    boundary: event.boundary, point: [event.point.x, event.point.y] };
  deepFreezeCadData(result); return result;
}

function prepareLineExtend(graph: CadSketchGraph, parameters: Readonly<Record<string, number>>, entity: SourceLine, end: 'start' | 'end'): CadSketchLineExtendPreparation {
  const entityId = entity.id;
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
  deepFreezeCadData(result); return result;
}
export function extendCadSketchEntity({ graph: input, parameters, extend }: Source & { readonly extend: CadSketchExtendTarget }): CadSketchExtendResult {
  if (!isCadImportData(extend) || !Value.Check(CadSketchExtendTargetSchema, extend)) throw new CadError('invalid-sketch-extend', 'Choose one complete line or arc extension request.');
  const graph = parseCadSketchGraph(input), source = graph.entities.find(entity => entity.id === extend.entityId);
  if (!source || source.kind !== extend.kind) throw new CadError('invalid-sketch-extend-target', 'The extension source must retain its requested kind.');
  const prepared = prepareCadSketchExtend({ graph, parameters, entityId: extend.entityId, end: extend.end });
  const { endPointId, ...target } = extend;
  if (!Value.Equal(prepared.target, target)) throw new CadError('stale-sketch-extend', 'The extension boundary changed. Choose the endpoint again.');
  if (source.kind === 'arc') {
    if (extend.boundary.endpointPointId !== undefined && endPointId !== extend.boundary.endpointPointId)
      throw new CadError('invalid-sketch-extend-point', 'Use the exact witnessed boundary endpoint identity.');
    const joint = resolveCadSketchPointIdentities(graph), key = extend.boundary.endpointPointId === undefined ? endPointId : joint(endPointId);
    if (key === joint(source.centerPointId) || key === joint(extend.end === 'start' ? source.endPointId : source.startPointId))
      throw new CadError('invalid-sketch-extend-point', 'The arc endpoint needs a distinct identity from its center and opposite endpoint.');
  }
  const candidate = replaceEndpoint(graph, parameters, extend.entityId, extend.end, extend.boundary, endPointId, 'extend');
  if (prepared.extended.kind === 'arc') {
    const actual = compileCadSketchGraph(candidate, parameters).segments.find(segment => segment.id === extend.entityId), expected = prepared.extended;
    if (actual?.kind !== 'arc') throw precision('extend');
    checkArcPiece(expected, actual, expected.sweepRadians, cadPathClosureTolerance([expected.center, expected.start, expected.end]), 'extend');
  }
  return Object.freeze({ graph: candidate, retainedEntityId: extend.entityId, endPointId });
}
