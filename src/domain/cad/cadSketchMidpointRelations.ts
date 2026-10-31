import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchGraphEntity, CadSketchGraphPoint, CadSketchMidpointRelation } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';
import { CAD_SKETCH_MIDPOINT_OPERANDS, resolveCadSketchOperands } from './sketch-relations/cadSketchOperandSignatures';

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;

/** References express finite-line intent; proximity never establishes an operand identity. */
export function resolveCadSketchMidpointOperands(graph: CadSketchGraph, relation: Pick<CadSketchMidpointRelation, 'pointId' | 'lineId'>) {
  const [point, line] = resolveCadSketchOperands(graph, CAD_SKETCH_MIDPOINT_OPERANDS, [relation.pointId, relation.lineId]) as readonly [CadSketchGraphPoint, Line];
  return assertCadSketchMidpointIdentities(graph, point, line);
}
/** The midpoint stays apart from both ends of its line and from the points joined to them. */
export function assertCadSketchMidpointIdentities(graph: CadSketchGraph, point: CadSketchGraphPoint, line: Line) {
  const identity = resolveCadSketchPointIdentities(graph), start = identity(line.startPointId), end = identity(line.endPointId), middle = identity(point.id);
  if (start === end || middle === start || middle === end)
    throw new CadError('invalid-sketch-midpoint', 'A midpoint must be distinct from both line endpoints and their declared coincident aliases.');
  return { point, line };
}
