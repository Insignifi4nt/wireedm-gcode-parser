import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphPoint, CadSketchSymmetricRelation, CadSketchGraphIssue } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { CAD_SKETCH_SYMMETRY_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';
import { cadSketchLineDirection } from './cadSketchLineRelations';
import { cadSketchDriverTolerance } from './cadSketchPrecision';
import { isCadSketchVirtualAxisId } from './sketch-relations/cadSketchVirtualElements';
import type { Point2 } from '@/domain/path-intel/types';

/** Source identities, never position/proximity, determine the pair and its axis. */
export function resolveCadSketchSymmetryOperands(graph: CadSketchGraph, relation: Pick<CadSketchSymmetricRelation, 'pointIds' | 'lineId'>) {
  const [first, second, line] = resolveCadSketchOperands(graph, CAD_SKETCH_SYMMETRY_OPERANDS, [...relation.pointIds, relation.lineId]) as readonly [CadSketchGraphPoint, CadSketchGraphPoint, Extract<CadSketchGraphEntity, { kind: 'line' }>];
  return assertCadSketchSymmetryIdentities(graph, first, second, line);
}
/**
 * The two points and the axis line's ends are four identities: no two of them the same point or joined. An axis has no ends of its own,
 * only the origin it starts at and a sample along it, so about an axis the two points are the identities.
 */
export function assertCadSketchSymmetryIdentities(graph: CadSketchGraph, first: CadSketchGraphPoint, second: CadSketchGraphPoint, line: Extract<CadSketchGraphEntity, { kind: 'line' }>) {
  const identity = resolveCadSketchPointIdentities(graph);
  const ids = [first.id, second.id, ...isCadSketchVirtualAxisId(line.id) ? [] : [line.startPointId, line.endPointId]];
  if (new Set(ids.map(identity)).size !== ids.length)
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
