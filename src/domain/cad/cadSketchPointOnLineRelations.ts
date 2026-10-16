import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchPointOnLineRelation, CadSketchGraphIssue } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { cadSketchLineDirection } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';

/** An authored point and infinite line support, without an endpoint identity or projection. */
export function resolveCadSketchPointOnLineOperands(graph: CadSketchGraph, relation: Pick<CadSketchPointOnLineRelation, 'pointId' | 'lineId'>) {
  const point = graph.points.find(point => point.id === relation.pointId), line = graph.entities.find(entity => entity.id === relation.lineId);
  if (!point) throw new CadError('missing-sketch-point', 'Point on line needs an existing sketch point.');
  if (line?.kind !== 'line') throw new CadError('invalid-sketch-point-on-line', 'Point on line needs an existing straight guide.');
  const identity = resolveCadSketchPointIdentities(graph);
  if (new Set([point.id, line.startPointId, line.endPointId].map(identity)).size !== 3)
    throw new CadError('invalid-sketch-point-on-line', 'The point must be distinct from both guide endpoints and their declared coincident aliases.');
  return { point, line };
}

/** Signed normalized support distance in world millimeters, independent of native status. */
export function checkCadSketchPointOnLineRelation(graph: CadSketchGraph, relation: CadSketchPointOnLineRelation, points: ReadonlyMap<string, Point2>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    const { line } = resolveCadSketchPointOnLineOperands(graph, relation), axis = cadSketchLineDirection(line, points), point = points.get(relation.pointId);
    if (!axis || !point) return []; // Owning coordinate checks report unavailable positions.
    const residualMm = Math.abs(axis.x * (point.y - axis.start.y) - axis.y * (point.x - axis.start.x));
    return !Number.isFinite(residualMm) || residualMm > cadSketchDriverTolerance([point, axis.start, axis.end])
      ? [{ source, code: 'relation-residual', message: 'The point does not lie on its guide support.', ...(Number.isFinite(residualMm) ? { residualMm } : {}) }] : [];
  } catch (error) { return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid point on line.' }]; }
}
