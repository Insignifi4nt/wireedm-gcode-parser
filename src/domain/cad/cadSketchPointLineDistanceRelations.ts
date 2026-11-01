import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphIssue, CadSketchGraphPoint, CadSketchGraphRelation, CadSketchPointLineDistanceRelation } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { CAD_SKETCH_POINT_LINE_DISTANCE_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema } from './cadPrimitives';
import { checkCadSketchLineRelation, cadSketchLineDirection, resolveCadSketchLinePair } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import { cadSketchLineSupportIntersection } from './cadSketchAngleRelations';
import type { Point2 } from '@/domain/path-intel/types';
import { cadRoundoff } from '@/domain/precision/cadPrecision';
import { CadSketchPositions } from './sketch-relations/cadSketchVirtualElements';

const positive = 'Point to line distance must be a positive length; use Point on line for zero.';

/** An authored point and an infinite line support, without an endpoint identity or projection. */
export function resolveCadSketchPointLineDistanceOperands(graph: CadSketchGraph, relation: Pick<CadSketchPointLineDistanceRelation, 'pointId' | 'lineId'>) {
  const [point, line] = resolveCadSketchOperands(graph, CAD_SKETCH_POINT_LINE_DISTANCE_OPERANDS, [relation.pointId, relation.lineId]) as readonly [CadSketchGraphPoint, Extract<CadSketchGraphEntity, { kind: 'line' }>];
  return assertCadSketchPointLineDistanceIdentities(graph, point, line);
}
/** The point stays apart from both ends of its line and from the points joined to them. */
export function assertCadSketchPointLineDistanceIdentities(graph: CadSketchGraph, point: CadSketchGraphPoint, line: Extract<CadSketchGraphEntity, { kind: 'line' }>) {
  const identity = resolveCadSketchPointIdentities(graph);
  if (new Set([point.id, line.startPointId, line.endPointId].map(identity)).size !== 3)
    throw new CadError('invalid-sketch-point-line-distance', 'The point must be distinct from both line endpoints and their declared coincident aliases.');
  return { point, line };
}

/** Operands and a literal value; an expression's value is checked where it is evaluated. */
export function validateCadSketchPointLineDistance(graph: CadSketchGraph, relation: CadSketchPointLineDistanceRelation) {
  const operands = resolveCadSketchPointLineDistanceOperands(graph, relation);
  assertCadSketchPointLineDistanceValue(relation);
  return operands;
}
/** A literal distance is positive; an expression's value is checked where it is evaluated. */
export function assertCadSketchPointLineDistanceValue(relation: Pick<CadSketchPointLineDistanceRelation, 'value'>) {
  if (typeof relation.value === 'number' && !(relation.value > 0)) throw new CadError('invalid-distance', positive);
}

/** The driven length, positive and finite. */
export function cadSketchPointLineDistanceTarget(relation: Pick<CadSketchPointLineDistanceRelation, 'value'>, parameters: Readonly<Record<string, number>>): number {
  return cadSketchPointLineDistanceLength(evaluateCadScalar(relation.value, parameters));
}
/** An evaluated driving length, which must be positive and finite. */
export function cadSketchPointLineDistanceLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new CadError('invalid-distance', positive);
  return value;
}

/** +1 for a point held left of the line's start-to-end direction, -1 for one held right. */
export const cadSketchPointLineSideSign = (side: CadSketchPointLineDistanceRelation['side']) => side === 'left' ? 1 : -1;
/** The side a signed distance lies on; a point on the support counts as left. */
export const cadSketchPointLineSide = (signedMm: number): CadSketchPointLineDistanceRelation['side'] => signedMm < 0 ? 'right' : 'left';

/** Distance from `point` to the support through `axis`, positive to the left of its start to its end. */
export function cadSketchSignedPointLineDistance(point: Point2, axis: { readonly x: number; readonly y: number; readonly start: Point2 }): number {
  return axis.x * (point.y - axis.start.y) - axis.y * (point.x - axis.start.x);
}

/** Support distance in world millimeters on the relation's side, independent of native status. */
export function checkCadSketchPointLineDistanceRelation(graph: CadSketchGraph, relation: CadSketchPointLineDistanceRelation,
  points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  let target: number;
  try { target = cadSketchPointLineDistanceTarget(relation, parameters); } catch (error) {
    return [{ source, code: error instanceof CadError && error.code === 'invalid-distance' ? 'invalid-distance' : 'invalid-expression',
      message: error instanceof Error ? error.message : 'Invalid point to line distance.' }];
  }
  try {
    const { line } = resolveCadSketchPointLineDistanceOperands(graph, relation), axis = cadSketchLineDirection(line, points), point = points.get(relation.pointId);
    if (!axis || !point) return []; // Owning coordinate checks report unavailable positions.
    const residualMm = Math.abs(cadSketchPointLineSideSign(relation.side) * cadSketchSignedPointLineDistance(point, axis) - target);
    return !Number.isFinite(residualMm) || residualMm > cadSketchDriverTolerance([point, axis.start, axis.end])
      ? [{ source, code: 'relation-residual', message: `The point is not at its distance on the ${relation.side} of the line.`, ...(Number.isFinite(residualMm) ? { residualMm } : {}) }] : [];
  } catch (error) { return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid point to line distance.' }]; }
}

/**
 * The line a relation's side or placement is taken along, from its start to its end, and what else fixes that frame: a point to line
 * distance, driving or reference, takes its side and its placement from its line, and a line's reference length its placement.
 */
function orientedLineOf(relation: CadSketchGraphRelation): { readonly lineId: string; readonly frame: string } | null {
  if (relation.kind === 'point-line-distance') return { lineId: relation.lineId, frame: `distance:${relation.pointId}` };
  if (relation.kind !== 'reference-dimension') return null;
  const measurement = relation.measurement;
  return measurement.kind === 'point-line-distance' ? { lineId: measurement.lineId, frame: `reference:${measurement.pointId}` }
    : measurement.kind === 'line-length' ? { lineId: measurement.entityId, frame: 'length' } : null;
}

/**
 * An edit that turns a retained line around keeps each distance it carries over on the same physical side, and each dimension
 * placed along it where it was drawn. A distance whose line and side the edit left as they were takes the other side, and a
 * point to line distance or a line's reference length whose placement the edit left as it was is turned round with the line,
 * when the line's start and end swapped places, by point ID or declared Coincident identity before or after the edit, so an end
 * moved onto a point it was joined to is the same end. The two snapshots' joins are read separately and never chained, which
 * could merge two distinct ends. Positions play no part, so the result does not depend on the order of edits in a batch or on
 * geometry not yet solved. A side or placement the edit changes is kept as given; a later edit can state either for the new direction.
 */
export function keepCadSketchLineSides(previous: CadSketchGraph, next: CadSketchGraph): CadSketchGraph {
  if (previous === next || !next.relations.some(relation => orientedLineOf(relation))) return next;
  const carried = new Map(previous.relations.flatMap(relation => orientedLineOf(relation) ? [[relation.id, relation] as const] : []));
  const lines = (graph: CadSketchGraph) => new Map(graph.entities.flatMap(entity => entity.kind === 'line' ? [[entity.id, entity] as const] : []));
  const wereLines = lines(previous), nowLines = lines(next);
  let joins: readonly ((a: string, b: string) => boolean)[] | undefined, changed = false;
  const relations = next.relations.map(relation => {
    const oriented = orientedLineOf(relation), prior = carried.get(relation.id), was = prior && orientedLineOf(prior);
    if (!oriented || was?.lineId !== oriented.lineId || was.frame !== oriented.frame) return relation;
    const before = wereLines.get(oriented.lineId), after = nowLines.get(oriented.lineId);
    const keepsSide = relation.kind === 'point-line-distance' && prior?.kind === 'point-line-distance' && prior.side === relation.side;
    const placement = 'annotation' in relation ? relation.annotation : undefined, priorPlacement = prior && 'annotation' in prior ? prior.annotation : undefined;
    const keepsPlacement = placement?.kind === 'linear' && priorPlacement?.kind === 'linear' && placement.offset === priorPlacement.offset && placement.along === priorPlacement.along;
    if (!keepsSide && !keepsPlacement || !before || !after || before.startPointId === after.startPointId && before.endPointId === after.endPointId) return relation;
    // Joins on either side of the edit count, so an end the edit replaced with a point once joined to it, even one it then
    // removed with its Coincident, is still the same end.
    joins ??= [previous, next].map(graph => {
      const ids = new Set(graph.points.map(point => point.id));
      const identity = resolveCadSketchPointIdentities({ points: graph.points, entities: [],
        relations: graph.relations.filter(relation => relation.kind === 'coincident' && relation.pointIds.every(id => ids.has(id))) });
      return (a: string, b: string) => a === b || ids.has(a) && ids.has(b) && identity(a) === identity(b);
    });
    const [joinedBefore, joinedAfter] = joins, same = (a: string, b: string) => joinedBefore(a, b) || joinedAfter(a, b);
    const [wasStart, wasEnd, start, end] = [before.startPointId, before.endPointId, after.startPointId, after.endPointId];
    // Ends joined to each other have no direction to keep, and an end that matches both old ends is no clear swap.
    if (joinedBefore(wasStart, wasEnd) || joinedAfter(start, end) || !same(start, wasEnd) || !same(end, wasStart) || same(start, wasStart) || same(end, wasEnd)) return relation;
    changed = true;
    // Turned round with its line, a placement's offset is to the other side of it and its text the same way along it from the other end.
    const turned = keepsPlacement && placement?.kind === 'linear' ? { annotation: { kind: 'linear' as const, offset: -placement.offset, along: Math.min(1e4, Math.max(-1e4, 1 - placement.along)) } } : {};
    return { ...relation, ...turned, ...(keepsSide && relation.kind === 'point-line-distance' ? { side: relation.side === 'left' ? 'right' as const : 'left' as const } : {}) } as typeof relation;
  });
  return changed ? { ...next, relations } : next;
}

interface CreationInput {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>; readonly relationId: string;
}
function numericPoints(input: CreationInput, pointIds: readonly string[]): ReadonlyMap<string, Point2> {
  if (!Value.Check(CadIdentifierSchema, input.relationId)) throw new CadError('invalid-sketch-point-line-distance', 'Choose a valid distance relation identity.');
  return new CadSketchPositions(input.graph.points.filter(point => pointIds.includes(point.id)).map(point => [point.id,
    { x: evaluateCadScalar(point.position[0], input.parameters), y: evaluateCadScalar(point.position[1], input.parameters) }]));
}

/** A driving distance at the point's current distance and side of the support; a point on the support has none to drive. */
export function createCadSketchPointLineDistance(input: CreationInput & { readonly pointId: string; readonly lineId: string }): CadSketchPointLineDistanceRelation {
  const { point, line } = resolveCadSketchPointLineDistanceOperands(input.graph, input);
  const points = numericPoints(input, [point.id, line.startPointId, line.endPointId]), axis = cadSketchLineDirection(line, points), at = points.get(point.id);
  if (!axis || !at) throw new CadError('missing-sketch-point', 'The distance needs numeric source points.');
  const signed = cadSketchSignedPointLineDistance(at, axis), value = Math.abs(signed);
  if (!(value > cadSketchDriverTolerance([at, axis.start, axis.end])))
    throw new CadError('invalid-distance', 'The point lies on the line. Use Point on line to keep it there.');
  return { id: input.relationId, kind: 'point-line-distance', pointId: point.id, lineId: line.id, side: cadSketchPointLineSide(signed), value };
}

type Direction = NonNullable<ReturnType<typeof cadSketchLineDirection>>;
/** An angle's corner that cannot be placed because it lies farther along the lines than the sketch reaches, not because the lines sit far out. */
function cornerTooFar(a: Direction, b: Direction): boolean {
  try { cadSketchLineSupportIntersection(a, b); return false; } catch (error) { if (!(error instanceof CadError && error.code === 'sketch-angle-precision')) throw error; }
  const along = Math.abs((a.x * (b.start.y - a.start.y) - a.y * (b.start.x - a.start.x)) / (a.x * b.y - a.y * b.x));
  const reach = Math.max(a.length, b.length, ...[a.start, a.end, b.start, b.end].flatMap(point => [Math.abs(point.x), Math.abs(point.y)]));
  return !(along <= reach);
}

/**
 * Two lines an angle cannot measure: the distance from an endpoint of the second line to the first line's support,
 * or null when an angle measures them. `parallel` is set when their directions are too close for an angle to intersect
 * them, or when they already meet the accuracy a Parallel relation accepts. Lines a hair further off, whose angle's
 * corner lies too far along them to place, take the distance without being parallel.
 */
export function createCadSketchLinePairDistance(input: CreationInput & { readonly lineIds: readonly [string, string] }): { readonly relation: CadSketchPointLineDistanceRelation; readonly parallel: boolean } | null {
  const [first, second] = resolveCadSketchLinePair(input.graph, input.lineIds);
  const points = numericPoints(input, [first.startPointId, first.endPointId, second.startPointId, second.endPointId]);
  const a = cadSketchLineDirection(first, points), b = cadSketchLineDirection(second, points);
  if (!a || !b) throw new CadError('missing-sketch-point', 'The distance needs numeric source points.');
  const parallel = Math.abs(a.x * b.y - a.y * b.x) <= cadRoundoff(32)
    || !checkCadSketchLineRelation(input.graph, { id: input.relationId, kind: 'parallel', lineIds: input.lineIds }, points).length;
  if (!parallel && !cornerTooFar(a, b)) return null;
  const identity = resolveCadSketchPointIdentities(input.graph), shared = new Set([first.startPointId, first.endPointId].map(identity));
  const pointId = [second.startPointId, second.endPointId].find(id => !shared.has(identity(id)));
  const on = (id: string) => Math.abs(cadSketchSignedPointLineDistance(points.get(id)!, a)) <= cadSketchDriverTolerance([points.get(id)!, a.start, a.end]);
  if (!pointId || on(pointId)) throw new CadError('invalid-distance', 'These lines lie on one line. Use Collinear to keep them there.');
  return { relation: createCadSketchPointLineDistance({ ...input, pointId, lineId: first.id }), parallel };
}
