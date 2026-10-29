import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchPointOnCurveRelation, CadSketchGraphIssue } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { evaluateCadScalar } from './cadExpression';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';

/** An authored point and the full supporting circle of an arc or circle, without a center or endpoint identity or projection. */
export function resolveCadSketchPointOnCurveOperands(graph: CadSketchGraph, relation: Pick<CadSketchPointOnCurveRelation, 'pointId' | 'curveId'>) {
  const point = graph.points.find(point => point.id === relation.pointId), curve = graph.entities.find(entity => entity.id === relation.curveId);
  if (!point) throw new CadError('missing-sketch-point', 'Point on curve needs an existing sketch point.');
  if (curve?.kind !== 'arc' && curve?.kind !== 'circle') throw new CadError('invalid-sketch-point-on-curve', 'Point on curve needs an existing arc or circle.');
  const identity = resolveCadSketchPointIdentities(graph), own = curve.kind === 'arc' ? [curve.centerPointId, curve.startPointId, curve.endPointId] : [curve.centerPointId];
  if (own.some(id => identity(id) === identity(point.id)))
    throw new CadError('invalid-sketch-point-on-curve', 'The point must be distinct from the curve center, its arc endpoints and their declared coincident aliases.');
  return { point, curve };
}

/** Radial distance from the supporting circle in world millimeters, independent of native status. */
export function checkCadSketchPointOnCurveRelation(graph: CadSketchGraph, relation: CadSketchPointOnCurveRelation, points: ReadonlyMap<string, Point2>,
  parameters: Readonly<Record<string, number>>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    const { curve } = resolveCadSketchPointOnCurveOperands(graph, relation), center = points.get(curve.centerPointId), point = points.get(relation.pointId);
    if (!center || !point) return []; // Owning coordinate checks report unavailable positions.
    const operands = [point, center];
    let radius: number;
    if (curve.kind === 'circle') {
      try { radius = evaluateCadScalar(curve.radius, parameters); } catch { return []; } // The circle's own check reports an unavailable radius.
    } else {
      const start = points.get(curve.startPointId);
      if (!start) return [];
      radius = Math.hypot(start.x - center.x, start.y - center.y); operands.push(start);
    }
    const residualMm = Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - radius);
    return !Number.isFinite(residualMm) || residualMm > cadSketchDriverTolerance(operands)
      ? [{ source, code: 'relation-residual', message: 'The point does not lie on its curve support.', ...(Number.isFinite(residualMm) ? { residualMm } : {}) }] : [];
  } catch (error) { return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid point on curve.' }]; }
}
