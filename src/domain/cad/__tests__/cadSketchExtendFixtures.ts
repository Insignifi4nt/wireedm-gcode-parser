import { parseCadDocument } from '../cadSchema';
import type { CadSketchExtendTarget } from '../cadSketchTrimExtend';
import { trimPart } from './cadSketchTrimFixtures';

export const lineExtend: CadSketchExtendTarget = { kind: 'line', entityId: 'ab', end: 'start',
  boundary: { entityId: 'cutter', index: 0, parameter: -.25, position: [-5, 0] }, endPointId: 'extension' };

export function extendPart(consumed = false) {
  const source = trimPart(consumed);
  return parseCadDocument({ ...source, features: source.features.map(feature => feature.kind === 'sketch' && feature.graph
    ? { ...feature, graph: { ...feature.graph, points: feature.graph.points.map(point => point.id === 'cut-a' || point.id === 'cut-b'
      ? { ...point, position: [-5, point.position[1]] } : point) } } : feature) });
}
