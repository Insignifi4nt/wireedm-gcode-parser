import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadDocument } from '../cadDocument';
import { prepareCadSketchTrim, type CadSketchMiddleTrimTarget } from '../cadSketchTrimExtend';

export function middleArcTrimPart(fixedEndpoints = false) {
  const endpoint = (id: string, x: number, y: number) => ({ id, position: fixedEndpoints ? [String(x), String(y)] : [x, y] });
  return parseCadDocument({ ...createCadDocument('Middle arc trim', 'middle-arc-trim'), schemaVersion: 2, parameters: { retained: 7 }, features: [{
    id: 'sketch', name: 'D blank', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'center', position: ['0.000', ' 0 '] }, endpoint('a', -8, 6), endpoint('b', 8, 6), endpoint('p', -6, -8), endpoint('q', 6, -8),
        { id: 'guide-p', position: ['-6.000', ' 0 '] }, { id: 'guide-q', position: ['6.000', ' 0 '] }],
      entities: [{ id: 'arc', kind: 'arc', centerPointId: 'center', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false },
        { id: 'top', kind: 'line', startPointId: 'b', endPointId: 'a', construction: false },
        { id: 'bottom', kind: 'line', startPointId: 'p', endPointId: 'q', construction: false },
        { id: 'left-guide', kind: 'line', startPointId: 'p', endPointId: 'guide-p', construction: true },
        { id: 'right-guide', kind: 'line', startPointId: 'q', endPointId: 'guide-q', construction: true }], relations: []
    }
  }] });
}

export function middleArcTrimTarget(document: CadDocument): CadSketchMiddleTrimTarget {
  const sketch = document.features[0]; if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Middle arc source missing.');
  const query = prepareCadSketchTrim({ graph: sketch.graph, parameters: document.parameters, entityId: 'arc', parameter: .5 });
  if (query.target.kind !== 'middle') throw new Error('Expected middle arc target.');
  return { ...query.target, cutPointIds: ['p', 'q'], newEntityId: 'after', supportRelationId: 'common-radius' };
}

export const clippedDAreaMm2 = 50 * Math.PI + 96;
