import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchSymmetricRelation, CadSketchGraphIssue } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { cadSketchLineDirection } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import type { Point2 } from '@/domain/path-intel/types';

/** Source identities, never position/proximity, determine the pair and its axis. */
export function resolveCadSketchSymmetryOperands(graph: CadSketchGraph, relation: Pick<CadSketchSymmetricRelation, 'pointIds' | 'lineId'>) {
  const first = graph.points.find(point => point.id === relation.pointIds[0]), second = graph.points.find(point => point.id === relation.pointIds[1]);
  const line = graph.entities.find(entity => entity.id === relation.lineId);
  if (!first || !second) throw new CadError('missing-sketch-point', 'Symmetry needs two existing sketch points.');
  if (line?.kind !== 'line') throw new CadError('invalid-sketch-symmetry', 'Symmetry needs an existing straight axis line.');
  const identity = resolveCadSketchPointIdentities(graph);
  if (new Set([first.id, second.id, line.startPointId, line.endPointId].map(identity)).size !== 4)
    throw new CadError('invalid-sketch-symmetry', 'Symmetric points and axis endpoints need four distinct declared identities.');
  return { points: [first, second] as const, line };
}

/** Reflection in the infinite line support; both components are physical world millimeters. */
export function checkCadSketchSymmetricRelation(graph: CadSketchGraph, relation: CadSketchSymmetricRelation, points: ReadonlyMap<string, Point2>): CadSketchGraphIssue[] {
  const source = { kind: 'relation', id: relation.id } as const;
  try {
    const { line } = resolveCadSketchSymmetryOperands(graph, relation), axis = cadSketchLineDirection(line, points);
    const first = points.get(relation.pointIds[0]), second = points.get(relation.pointIds[1]);
    if (!axis || !first || !second) return []; // Owning point checks report missing/invalid coordinates.
    const tangent = (second.x - first.x) * axis.x + (second.y - first.y) * axis.y;
    const normal = ((first.x - axis.start.x) + (second.x - axis.start.x)) * -axis.y
      + ((first.y - axis.start.y) + (second.y - axis.start.y)) * axis.x;
    const residualMm = Math.hypot(tangent, normal);
    return !Number.isFinite(residualMm) || residualMm > cadSketchDriverTolerance([first, second, axis.start, axis.end])
      ? [{ source, code: 'relation-residual', message: 'The points do not reflect across their symmetry axis.', ...(Number.isFinite(residualMm) ? { residualMm } : {}) }] : [];
  } catch (error) {
    return [{ source, code: 'relation-residual', message: error instanceof Error ? error.message : 'Invalid point symmetry.' }];
  }
}
