import { CadError } from './cadError';
import { evaluateCadScalar } from './cadExpression';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphPoint, CadSketchSymmetricRelation, CadSketchGraphIssue, CadSketchSymmetricPointsRelation,
  CadSketchSymmetricCurvesRelation } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { CAD_SKETCH_CURVE_SYMMETRY_OPERANDS, CAD_SKETCH_SYMMETRY_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';
import { cadSketchLineDirection } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import { cadSketchVirtualPosition, isCadSketchVirtualAxisId } from './sketch-relations/cadSketchVirtualElements';
import type { Point2 } from '@/domain/path-intel/types';
import { CAD_PRECISION } from '@/domain/precision/cadPrecision';

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;
/** A line, arc or circle that Symmetric mirrors onto another of its kind. */
export type CadSketchMirroredCurve = Extract<CadSketchGraphEntity, { kind: 'line' | 'arc' | 'circle' }>;

/** Whether a Symmetric mirrors two lines, arcs or circles rather than two points. */
export const isCadSketchCurveSymmetry = <R extends object>(relation: R): relation is Extract<R, { readonly curveIds: unknown }> => 'curveIds' in relation;

/**
 * Which of a Symmetric's picks it mirrors about: the one axis, since an axis is never mirrored; else the one line among points, arcs or
 * circles, or the one construction line among lines; else the last line picked. Undefined when no pick is a line or an axis.
 */
export function cadSketchMirrorIndex(picks: readonly (object | undefined)[]): number | undefined {
  const kind = (pick: object | undefined) => pick && 'kind' in pick ? pick.kind : undefined;
  const lines = picks.flatMap((pick, index) => kind(pick) === 'line' || kind(pick) === 'axis' ? [index] : []), axes = lines.filter(index => kind(picks[index]) === 'axis');
  if (axes.length) return axes[axes.length - 1];
  if (lines.length < 2) return lines[0];
  const construction = lines.filter(index => (picks[index] as { readonly construction?: boolean }).construction === true);
  return construction.length === 1 ? construction[0] : lines[lines.length - 1];
}

/** Source identities, never position/proximity, determine the pair and its axis. */
export function resolveCadSketchSymmetryOperands(graph: CadSketchGraph, relation: Pick<CadSketchSymmetricPointsRelation, 'pointIds' | 'lineId'>) {
  const [first, second, line] = resolveCadSketchOperands(graph, CAD_SKETCH_SYMMETRY_OPERANDS, [...relation.pointIds, relation.lineId]) as readonly [CadSketchGraphPoint, CadSketchGraphPoint, Line];
  return assertCadSketchSymmetryIdentities(graph, first, second, line);
}
/**
 * The two points and the axis line's ends are four identities: no two of them the same point or joined. An axis has no ends of its own,
 * only the origin it starts at and a sample along it, so about an axis the two points are the identities.
 */
export function assertCadSketchSymmetryIdentities(graph: CadSketchGraph, first: CadSketchGraphPoint, second: CadSketchGraphPoint, line: Line) {
  const identity = resolveCadSketchPointIdentities(graph);
  const ids = [first.id, second.id, ...isCadSketchVirtualAxisId(line.id) ? [] : [line.startPointId, line.endPointId]];
  if (new Set(ids.map(identity)).size !== ids.length)
    throw new CadError('invalid-sketch-symmetry', 'Symmetric points and axis endpoints need four distinct declared identities.');
  return { points: [first, second] as const, line };
}

/** Two points a mirror maps onto each other. A pair of one identity is `self`: that point lies on the mirror. */
export interface CadSketchMirrorPair { readonly pointIds: readonly [string, string]; readonly self: boolean }

const MIXED = 'Choose two points, two lines, two arcs or two circles to mirror.';
const refuse = (message: string) => new CadError('invalid-sketch-symmetry', message);
const ordered = (pair: readonly [string, string]) => pair[0] < pair[1] ? `${pair[0]} ${pair[1]}` : `${pair[1]} ${pair[0]}`;

/**
 * The point pairs two mirrored curves can take, which the relation does not store, read from identities alone: one pairing, or for lines
 * apart both, starts with starts first. Circles pair their centres. Arcs pair their centres, and their ends by direction: a mirror turns
 * an arc's sweep, so arcs of one direction pair each start with the other's end and arcs of opposite directions pair start with start.
 * Lines pair an end they share with itself. Every pairing reads the curves alike in either stored order, so an arc's ends come self
 * pairs first, then by id.
 */
export function cadSketchMirrorPairings(curves: readonly [CadSketchMirroredCurve, CadSketchMirroredCurve], identity: (pointId: string) => string): readonly (readonly CadSketchMirrorPair[])[] {
  const [a, b] = curves;
  const pair = (pointIds: readonly [string, string]): CadSketchMirrorPair => ({ pointIds, self: identity(pointIds[0]) === identity(pointIds[1]) });
  if (a.kind === 'circle' && b.kind === 'circle') return [[pair([a.centerPointId, b.centerPointId])]];
  if (a.kind === 'arc' && b.kind === 'arc') {
    const ends = (a.direction === b.direction ? [[a.startPointId, b.endPointId], [a.endPointId, b.startPointId]] as const
      : [[a.startPointId, b.startPointId], [a.endPointId, b.endPointId]] as const).map(ids => pair(ids));
    return [[pair([a.centerPointId, b.centerPointId]), ...ends.sort((p, q) => Number(q.self) - Number(p.self) || (ordered(p.pointIds) < ordered(q.pointIds) ? -1 : 1))]];
  }
  if (a.kind !== 'line' || b.kind !== 'line') throw refuse(MIXED);
  const straight = [pair([a.startPointId, b.startPointId]), pair([a.endPointId, b.endPointId])];
  const crossed = [pair([a.startPointId, b.endPointId]), pair([a.endPointId, b.startPointId])];
  return straight.some(item => item.self) ? [straight] : crossed.some(item => item.self) ? [crossed] : [straight, crossed];
}
/**
 * The point pairs of two mirrored curves: their one pairing, or for lines apart the pairing whose ends lie nearer each other's mirror
 * images in `points`, the geometry before an edit, starts with starts when both are as near.
 */
export function cadSketchMirrorPairs(curves: readonly [CadSketchMirroredCurve, CadSketchMirroredCurve], mirror: Pick<Line, 'startPointId' | 'endPointId'>,
  identity: (pointId: string) => string, points: ReadonlyMap<string, Point2>): readonly CadSketchMirrorPair[] {
  const pairings = cadSketchMirrorPairings(curves, identity);
  if (pairings.length === 1) return pairings[0];
  const [straight, crossed] = pairings;
  const at = (pointId: string) => {
    const position = points.get(pointId) ?? cadSketchVirtualPosition(pointId);
    if (!position) throw refuse(`Sketch point "${pointId}" has no position to pair its mirror image from.`);
    return position;
  };
  const start = at(mirror.startPointId), end = at(mirror.endPointId), dx = end.x - start.x, dy = end.y - start.y, length = dx * dx + dy * dy;
  if (!(length > 0)) throw refuse('A symmetry axis needs two distinct ends.');
  const gap = (pairs: readonly CadSketchMirrorPair[]) => pairs.reduce((sum, { pointIds: [p, q] }) => {
    const from = at(p), to = at(q), along = ((from.x - start.x) * dx + (from.y - start.y) * dy) / length;
    const x = 2 * (start.x + along * dx) - from.x - to.x, y = 2 * (start.y + along * dy) - from.y - to.y;
    return sum + x * x + y * y;
  }, 0);
  return gap(crossed) < gap(straight) * (1 - CAD_PRECISION.mirrorPairingTieRelative) ? crossed : straight;
}

/** Source identities, never position/proximity, decide which curves mirror and about what; their point pairs follow from them. */
export function resolveCadSketchCurveSymmetryOperands(graph: CadSketchGraph, relation: Pick<CadSketchSymmetricCurvesRelation, 'curveIds' | 'lineId'>) {
  const [first, second, line] = resolveCadSketchOperands(graph, CAD_SKETCH_CURVE_SYMMETRY_OPERANDS, [...relation.curveIds, relation.lineId]) as readonly [CadSketchMirroredCurve, CadSketchMirroredCurve, Line];
  return assertCadSketchCurveSymmetry(graph, first, second, line);
}
/**
 * Two curves of one kind that can mirror each other: circles on two centres, lines that share at most one end, arcs whose shared ends
 * their directions pair with themselves and that share not all three points. A point at an end of the axis line lies on the mirror, so
 * it mirrors onto itself only, as a point that both curves share.
 */
export function assertCadSketchCurveSymmetry(graph: CadSketchGraph, first: CadSketchMirroredCurve, second: CadSketchMirroredCurve, line: Line) {
  if (first.kind !== second.kind) throw refuse(MIXED);
  const identity = resolveCadSketchPointIdentities(graph), ends = new Set(isCadSketchVirtualAxisId(line.id) ? [] : [line.startPointId, line.endPointId].map(identity));
  const pointsOf = (curve: CadSketchMirroredCurve) => curve.kind === 'line' ? [curve.startPointId, curve.endPointId]
    : curve.kind === 'arc' ? [curve.centerPointId, curve.startPointId, curve.endPointId] : [curve.centerPointId];
  const shared = pointsOf(first).flatMap(p => pointsOf(second).filter(q => identity(p) === identity(q)).map(q => [p, q] as const));
  let known: readonly CadSketchMirrorPair[] | undefined;
  if (first.kind === 'circle') {
    if (shared.length) throw refuse('These circles share a center, so they cannot mirror each other.');
    known = cadSketchMirrorPairings([first, second], identity)[0];
  } else if (first.kind === 'line') {
    if (shared.length > 1) throw refuse('These lines share both ends, so they cannot mirror each other.');
    // Lines apart pair by position, so none of their ends pairs with itself.
    if (shared.length) known = cadSketchMirrorPairings([first, second], identity)[0];
  } else {
    known = cadSketchMirrorPairings([first, second], identity)[0];
    if (known.every(pair => pair.self)) throw refuse('These arcs share their center and both ends, so they cannot mirror each other.');
    const selfPairs = new Set(known.filter(pair => pair.self).map(pair => ordered(pair.pointIds)));
    if (shared.some(pair => !selfPairs.has(ordered(pair))))
      throw refuse('These arcs share a point that the mirror cannot map onto itself. Mirrored arcs run in opposite senses.');
  }
  const onMirror = [...pointsOf(first), ...pointsOf(second)].filter(pointId => ends.has(identity(pointId)));
  if (onMirror.some(pointId => !known?.some(pair => pair.self && pair.pointIds.includes(pointId))))
    throw refuse('A point at an end of the axis line can only mirror onto itself, so both curves need to share it.');
  return { curves: [first, second] as const, line, identity };
}

const residualIssue = (relation: CadSketchSymmetricRelation, message: string, residualMm: number): CadSketchGraphIssue[] =>
  [{ source: { kind: 'relation', id: relation.id }, code: 'relation-residual', message, ...(Number.isFinite(residualMm) ? { residualMm } : {}) }];
type Axis = NonNullable<ReturnType<typeof cadSketchLineDirection>>;
/** How far two points are from reflecting in the axis: along it, and their midpoint across it, in world millimetres. */
function reflectionResidual(first: Point2, second: Point2, axis: Axis) {
  const tangent = (second.x - first.x) * axis.x + (second.y - first.y) * axis.y;
  const normal = ((first.x - axis.start.x) + (second.x - axis.start.x)) * -axis.y + ((first.y - axis.start.y) + (second.y - axis.start.y)) * axis.x;
  return Math.hypot(tangent, normal);
}
/** Whether two points reflect in the infinite line of the axis, within the driver tolerance at their scale, as the relation check asks. */
export function cadSketchPointsReflect(first: Point2, second: Point2, axis: Axis): boolean {
  return reflectionResidual(first, second, axis) <= cadSketchDriverTolerance([first, second, axis.start, axis.end]);
}
/** The mirror image of a point in the infinite line of the axis. */
export function cadSketchMirrorImage(point: Point2, axis: Axis): Point2 {
  const along = (point.x - axis.start.x) * axis.x + (point.y - axis.start.y) * axis.y;
  return { x: 2 * (axis.start.x + along * axis.x) - point.x, y: 2 * (axis.start.y + along * axis.y) - point.y };
}

/** Why a solve is refused when it met a mirror of curves only by collapsing them, which the graph checks never accept. */
export const CAD_SKETCH_MIRROR_COLLAPSE = 'Symmetric could only be met from here by collapsing the mirrored curves. Move the curves or the mirror line nearer to a mirror image first.';
/**
 * Whether a solution's graph check issues collapse a curve Symmetric's curves or its mirror line: a line or arc whose ends meet, or a
 * radius that is no longer valid, in any curve Symmetric `graph` stores.
 */
export function cadSketchMirrorCollapsed(graph: CadSketchGraph, issues: readonly CadSketchGraphIssue[]): boolean {
  const collapsed = new Set(issues.filter(issue => issue.source.kind === 'entity' && (issue.code === 'degenerate-entity' || issue.code === 'invalid-radius')).map(issue => issue.source.id));
  return collapsed.size > 0 && graph.relations.some(relation => relation.kind === 'symmetric' && isCadSketchCurveSymmetry(relation) && [...relation.curveIds, relation.lineId].some(id => collapsed.has(id)));
}

/** Reflection in the infinite line support; both components are physical world millimeters. */
export function checkCadSketchSymmetricRelation(graph: CadSketchGraph, relation: CadSketchSymmetricRelation, points: ReadonlyMap<string, Point2>,
  parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    if (isCadSketchCurveSymmetry(relation)) return checkCurveSymmetry(graph, relation, points, parameters);
    const { line } = resolveCadSketchSymmetryOperands(graph, relation), axis = cadSketchLineDirection(line, points);
    const first = points.get(relation.pointIds[0]), second = points.get(relation.pointIds[1]);
    if (!axis || !first || !second) return []; // Owning point checks report missing/invalid coordinates.
    const residualMm = reflectionResidual(first, second, axis);
    return !Number.isFinite(residualMm) || residualMm > cadSketchDriverTolerance([first, second, axis.start, axis.end])
      ? residualIssue(relation, 'The points do not reflect across their symmetry axis.', residualMm) : [];
  } catch (error) {
    return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid point symmetry.' }];
  }
}
/** Each point pair reflects, and mirrored circles keep one radius. */
function checkCurveSymmetry(graph: CadSketchGraph, relation: CadSketchSymmetricCurvesRelation, points: ReadonlyMap<string, Point2>, parameters: Readonly<Record<string, number>>) {
  const { curves, line, identity } = resolveCadSketchCurveSymmetryOperands(graph, relation), axis = cadSketchLineDirection(line, points);
  const ids = curves.flatMap(curve => curve.kind === 'circle' ? [curve.centerPointId] : curve.kind === 'line' ? [curve.startPointId, curve.endPointId]
    : [curve.centerPointId, curve.startPointId, curve.endPointId]), at = ids.map(id => points.get(id));
  if (!axis || at.some(position => !position)) return []; // Owning point checks report missing/invalid coordinates.
  let residualMm = 0;
  for (const { pointIds: [p, q] } of cadSketchMirrorPairs(curves, line, identity, points)) residualMm = Math.max(residualMm, reflectionResidual(points.get(p)!, points.get(q)!, axis));
  const [a, b] = curves;
  if (a.kind === 'circle' && b.kind === 'circle') residualMm = Math.max(residualMm, Math.abs(evaluateCadScalar(a.radius, parameters) - evaluateCadScalar(b.radius, parameters)));
  return !Number.isFinite(residualMm) || residualMm > cadSketchDriverTolerance([...at as Point2[], axis.start, axis.end])
    ? residualIssue(relation, `The ${a.kind}s do not reflect across their symmetry axis.`, residualMm) : [];
}
