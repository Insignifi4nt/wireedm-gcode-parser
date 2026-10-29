import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import type { CadSketchGraph, CadSketchGraphIssue, CadSketchPointLineDistanceRelation } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { Value } from '@sinclair/typebox/value';
import { CadIdentifierSchema } from './cadPrimitives';
import { checkCadSketchLineRelation, cadSketchLineDirection, resolveCadSketchLinePair } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import { cadSketchLineSupportIntersection } from './cadSketchAngleRelations';
import type { Point2 } from '@/domain/path-intel/types';

const positive = 'Point to line distance must be a positive length; use Point on line for zero.';

/** An authored point and an infinite line support, without an endpoint identity or projection. */
export function resolveCadSketchPointLineDistanceOperands(graph: CadSketchGraph, relation: Pick<CadSketchPointLineDistanceRelation, 'pointId' | 'lineId'>) {
  const point = graph.points.find(point => point.id === relation.pointId), line = graph.entities.find(entity => entity.id === relation.lineId);
  if (!point) throw new CadError('missing-sketch-point', 'Point to line distance needs an existing sketch point.');
  if (line?.kind !== 'line') throw new CadError('invalid-sketch-point-line-distance', 'Point to line distance needs an existing straight line.');
  const identity = resolveCadSketchPointIdentities(graph);
  if (new Set([point.id, line.startPointId, line.endPointId].map(identity)).size !== 3)
    throw new CadError('invalid-sketch-point-line-distance', 'The point must be distinct from both line endpoints and their declared coincident aliases.');
  return { point, line };
}

/** Operands and a literal value; an expression's value is checked where it is evaluated. */
export function validateCadSketchPointLineDistance(graph: CadSketchGraph, relation: CadSketchPointLineDistanceRelation) {
  const operands = resolveCadSketchPointLineDistanceOperands(graph, relation);
  if (typeof relation.value === 'number' && !(relation.value > 0)) throw new CadError('invalid-distance', positive);
  return operands;
}

/** The driven length, positive and finite. */
export function cadSketchPointLineDistanceTarget(relation: Pick<CadSketchPointLineDistanceRelation, 'value'>, parameters: Readonly<Record<string, number>>): number {
  const value = evaluateCadScalar(relation.value, parameters);
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

interface CreationInput {
  readonly graph: CadSketchGraph; readonly parameters: Readonly<Record<string, number>>; readonly relationId: string;
}
function numericPoints(input: CreationInput, pointIds: readonly string[]): ReadonlyMap<string, Point2> {
  if (!Value.Check(CadIdentifierSchema, input.relationId)) throw new CadError('invalid-sketch-point-line-distance', 'Choose a valid distance relation identity.');
  return new Map(input.graph.points.filter(point => pointIds.includes(point.id)).map(point => [point.id,
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
  const parallel = Math.abs(a.x * b.y - a.y * b.x) <= 32 * Number.EPSILON
    || !checkCadSketchLineRelation(input.graph, { id: input.relationId, kind: 'parallel', lineIds: input.lineIds }, points).length;
  if (!parallel && !cornerTooFar(a, b)) return null;
  const identity = resolveCadSketchPointIdentities(input.graph), shared = new Set([first.startPointId, first.endPointId].map(identity));
  const pointId = [second.startPointId, second.endPointId].find(id => !shared.has(identity(id)));
  const on = (id: string) => Math.abs(cadSketchSignedPointLineDistance(points.get(id)!, a)) <= cadSketchDriverTolerance([points.get(id)!, a.start, a.end]);
  if (!pointId || on(pointId)) throw new CadError('invalid-distance', 'These lines lie on one line. Use Collinear to keep them there.');
  return { relation: createCadSketchPointLineDistance({ ...input, pointId, lineId: first.id }), parallel };
}
