import { CadError } from './cadError';
import type { CadSketchGraph, CadSketchMidpointRelation } from './cadSketchGraph';
import { resolveCadSketchPointIdentities } from './cadSketchGraphJoints';

/** References express finite-line intent; proximity never establishes an operand identity. */
export function resolveCadSketchMidpointOperands(graph: CadSketchGraph, relation: Pick<CadSketchMidpointRelation, 'pointId' | 'lineId'>) {
  const point = graph.points.find(point => point.id === relation.pointId);
  const line = graph.entities.find(entity => entity.id === relation.lineId);
  if (!point) throw new CadError('missing-sketch-point', 'The midpoint relation needs an existing point.');
  if (!line || line.kind !== 'line') throw new CadError('invalid-sketch-midpoint', 'The midpoint relation needs an existing line.');
  const identity = resolveCadSketchPointIdentities(graph), start = identity(line.startPointId), end = identity(line.endPointId), middle = identity(point.id);
  if (start === end || middle === start || middle === end)
    throw new CadError('invalid-sketch-midpoint', 'A midpoint must be distinct from both line endpoints and their declared coincident aliases.');
  return { point, line };
}
