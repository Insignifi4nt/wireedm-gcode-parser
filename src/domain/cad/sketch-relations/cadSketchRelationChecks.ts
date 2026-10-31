import { evaluateCadScalar } from '../cadExpression';
import type { CadSketchGraph, CadSketchGraphIssue } from '../cadSketchGraph';
import { validateCadSketchExternalReference } from '../cadSketchExternalReferences';
import { resolveCadSketchMidpointOperands } from '../cadSketchMidpointRelations';
import { cadSketchDriverTolerance } from '../cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';
import type { CadSketchRelationOf } from './cadSketchRelationTypes';

// The graph checks of relations that measure points directly, which their definitions name. Each reads only numeric points: a
// relation with a point that is not numeric leaves it to that point's own check.

type Points = ReadonlyMap<string, Point2>;
type Parameters = Readonly<Record<string, number>>;
const issue = (relation: { readonly id: string }, code: CadSketchGraphIssue['code'], message: string, residualMm?: number): CadSketchGraphIssue =>
  ({ source: { kind: 'relation', id: relation.id }, code, message, ...(residualMm === undefined ? {} : { residualMm }) });
/** A residual beyond its tolerance, which the operands set. */
const residualIssues = (relation: { readonly id: string }, residual: number, tolerance: number): CadSketchGraphIssue[] =>
  residual > tolerance ? [issue(relation, 'relation-residual', 'Sketch geometry does not satisfy its driving relation.', residual)] : [];

/**
 * Two points measured against each other, within the driver tolerance or, for points that coincide, the closure tolerance.
 */
export function checkCadSketchPointPair(relation: { readonly id: string; readonly pointIds: readonly [string, string] }, points: Points,
  residual: (a: Point2, b: Point2) => number, tolerance: (operands: Point2[]) => number = cadSketchDriverTolerance): CadSketchGraphIssue[] {
  const a = points.get(relation.pointIds[0]), b = points.get(relation.pointIds[1]);
  if (!a || !b) return [];
  return residualIssues(relation, residual(a, b), tolerance([a, b]));
}

/** A distance that is never negative, between two points. */
export function checkCadSketchPointDistance(relation: CadSketchRelationOf<'distance'>, points: Points, parameters: Parameters): CadSketchGraphIssue[] {
  const a = points.get(relation.pointIds[0]), b = points.get(relation.pointIds[1]);
  if (!a || !b) return [];
  const value = evaluateCadScalar(relation.value, parameters);
  if (value < 0) return [issue(relation, 'invalid-distance', 'Point distance must not be negative.')];
  return residualIssues(relation, Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - value), cadSketchDriverTolerance([a, b]));
}

/** A point at the middle of its line. */
export function checkCadSketchMidpoint(graph: CadSketchGraph, relation: CadSketchRelationOf<'midpoint'>, points: Points): CadSketchGraphIssue[] {
  const { line } = resolveCadSketchMidpointOperands(graph, relation);
  const a = points.get(line.startPointId), b = points.get(line.endPointId), point = points.get(relation.pointId);
  if (!a || !b || !point) return [];
  const target = { x: a.x + (b.x - a.x) / 2, y: a.y + (b.y - a.y) / 2 };
  return residualIssues(relation, Math.hypot(point.x - target.x, point.y - target.y), cadSketchDriverTolerance([a, b, point, target]));
}

/** A point held at `target`, which reads its driving values when the point is numeric. */
export function checkCadSketchHeldPoint(relation: { readonly id: string; readonly pointId: string }, points: Points, target: (point: Point2) => Point2): CadSketchGraphIssue[] {
  const point = points.get(relation.pointId);
  if (!point) return [];
  const held = target(point);
  return residualIssues(relation, Math.hypot(point.x - held.x, point.y - held.y), cadSketchDriverTolerance([point, held]));
}

/** A linked reference keeps the edge it owns; the document parser checks it against its source. */
export function checkCadSketchExternalReferenceOwnership(graph: CadSketchGraph, relation: CadSketchRelationOf<'external-reference'>): CadSketchGraphIssue[] {
  try { validateCadSketchExternalReference(graph, relation); }
  catch (error) { return [issue(relation, 'relation-residual', error instanceof Error ? error.message : 'Invalid reference ownership.')]; }
  return [];
}
