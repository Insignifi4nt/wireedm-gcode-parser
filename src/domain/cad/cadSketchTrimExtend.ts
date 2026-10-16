import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema, CadNumberSchema } from './cadPrimitives';
import { CadError } from './cadError';
import { parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphRelation } from './cadSketchGraph';
import { isCadImportData } from './cadImportData';
import { compileCadSketchGraph } from './cadSketchGraphGeometry';
import { cadPathClosureTolerance } from './cadAnalyticSegments';
import { cadSketchRelationEntityIds, cadSketchRelationPointIds } from './cadSketchGraphReferences';
import { resolveCadSketchGraphJoints } from './cadSketchGraphJoints';
import { evaluateCadScalar } from './cadExpression';
import { classifyLineRayPathSegmentIntersection, classifyParameterizedPathSegmentIntersection } from '@/domain/path-intel/intersections';
import { createArcSegment, createLineSegment, pointOnArcAtParameter } from '@/domain/path-intel/segments';
import type { LinePathSegment, PathSegment, Point2 } from '@/domain/path-intel/types';

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
type BoundaryQuery = { kind: 'trim'; segment: OpenSegment } | { kind: 'extend'; segment: LinePathSegment; end: 'start' | 'end' };
const precision = (operation: 'trim' | 'extend' = 'trim') => new CadError(`sketch-${operation}-precision`,
  operation === 'trim' ? 'This intersection cannot leave an exact nondegenerate end trim at these coordinates.' : 'This intersection cannot produce an exact nondegenerate line extension at these coordinates.');
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
  if (relation.kind === 'parallel' || relation.kind === 'perpendicular') return true;
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
    const hits = [...result.points].sort((a, b) => (a.leftParameter ?? -1) - (b.leftParameter ?? -1));
    for (const [index, hit] of hits.entries()) {
      const t = hit.leftParameter;
      if (t === null || !Number.isFinite(t)) throw precision(operation);
      if (query.kind === 'trim' ? t < 0 || t > 1 : query.end === 'start' ? t > 0 : t < 1) throw precision(operation);
      const point = at(segment, t);
      if (distance(point, hit.point) > tolerance) throw precision(operation);
      if (other.kind === 'circle') {
        if (Math.abs(distance(point, other.center) - other.radius) > tolerance) throw precision(operation);
      } else if (hit.rightParameter === null || hit.rightParameter < 0 || hit.rightParameter > 1
        || distance(point, at(other, hit.rightParameter)) > tolerance) throw precision(operation);
      const u = tangent(segment, point, operation), v = tangent(other, point, operation);
      if (Math.abs(u.x * v.y - u.y * v.x) <= 64 * Number.EPSILON) throw ambiguous(operation);
      if (query.kind === 'trim' ? t === 0 || t === 1 : t === (query.end === 'start' ? 0 : 1)) continue;
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
  for (const event of events) {
    const previous = unique.at(-1);
    if (previous && distance(previous.point, event.point) <= cadPathClosureTolerance([previous.point, event.point])) {
      const a = previous.witness.endpointPointId, b = event.witness.endpointPointId;
      if (!a || !b || joint(a) !== joint(b)) throw ambiguous(operation);
      continue;
    }
    unique.push(event);
  }
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

/** One clicked outer span, with no inferred interior attachment or relation transfer. */
export function prepareCadSketchEndTrim({ graph: input, parameters, entityId, parameter: pick }: Source & {
  readonly entityId: string; readonly parameter: number;
}): CadSketchEndTrimPreparation {
  if (!Number.isFinite(pick) || pick < 0 || pick > 1) throw new CadError('invalid-sketch-trim', 'Choose a finite source parameter from zero to one.');
  const graph = parseCadSketchGraph(input), entity = graph.entities.find(item => item.id === entityId);
  if (!entity || entity.kind === 'circle') throw new CadError('invalid-sketch-trim-target', 'End trim supports a line or open arc.');
  const geometry = compileCadSketchGraph(graph, parameters), segment = geometry.segments.find(item => item.id === entityId);
  if (!segment || segment.kind === 'circle') throw new CadError('invalid-sketch-trim-target', 'End trim supports a line or open arc.');
  const unique = boundaryEvents(graph, parameters, geometry.segments, { kind: 'trim', segment });
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
  if (!isCadImportData(trim) || !Value.Check(CadSketchTrimTargetSchema, trim)) throw new CadError('invalid-sketch-trim', 'Choose one complete end-trim request.');
  const graph = parseCadSketchGraph(input), prepared = prepareCadSketchEndTrim({ graph, parameters, entityId: trim.entityId, parameter: trim.parameter });
  const target = trim.kind === 'delete' ? trim : { kind: trim.kind, entityId: trim.entityId, parameter: trim.parameter, end: trim.end, boundary: trim.boundary };
  if (!Value.Equal(prepared.target, target)) throw new CadError('stale-sketch-trim', 'The trim boundary changed. Choose the portion again.');
  if (trim.kind === 'delete') return Object.freeze({ graph: parseCadSketchGraph({ ...graph, entities: graph.entities.filter(entity => entity.id !== trim.entityId) }),
    retainedEntityId: null, removedEntityId: trim.entityId, cutPointId: null });
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
