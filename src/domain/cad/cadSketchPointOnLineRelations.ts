import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphPoint, CadSketchPointOnLineRelation, CadSketchGraphIssue } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { CAD_SKETCH_POINT_ON_LINE_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';
import { cadSketchLineDirection } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';

/** An authored point and infinite line support, without an endpoint identity or projection. */
export function resolveCadSketchPointOnLineOperands(graph: CadSketchGraph, relation: Pick<CadSketchPointOnLineRelation, 'pointId' | 'lineId'>) {
  const [point, line] = resolveCadSketchOperands(graph, CAD_SKETCH_POINT_ON_LINE_OPERANDS, [relation.pointId, relation.lineId]) as readonly [CadSketchGraphPoint, Extract<CadSketchGraphEntity, { kind: 'line' }>];
  return assertCadSketchPointOnLineIdentities(graph, point, line);
}
/** The point stays apart from both ends of its guide and from the points joined to them. */
export function assertCadSketchPointOnLineIdentities(graph: CadSketchGraph, point: CadSketchGraphPoint, line: Extract<CadSketchGraphEntity, { kind: 'line' }>) {
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
