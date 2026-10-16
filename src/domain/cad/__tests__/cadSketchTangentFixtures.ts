import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadDocument } from '../cadDocument';

export const tangentJoint = { id: 'tangent', kind: 'tangent-joint', endpoints: [
  { entityId: 'line', pointId: 'j' }, { entityId: 'arc', pointId: 'j' }
] } as const;
export function tangentPart(mode: 'free' | 'driven' | 'cusp' | 'wrong' = 'driven') {
  const positions = mode === 'free' ? [[-10, -2], [0, 0], [1, 5], [6, 6]]
    : mode === 'cusp' ? [['-10', '0'], ['0', '0'], ['0', '-5'], ['5', '-5']]
    : mode === 'wrong' ? [['-10', '0'], ['0', '0'], ['3', '4'], ['7', '1']]
    : [[' -10 ', '0'], [' 0 ', '0'], [0, 5], [5, ' bendRadius ']];
  return parseCadDocument({ ...createCadDocument('Tangent arc', 'tangent-arc'), schemaVersion: 2, parameters: { bendRadius: 5, retained: 7 }, features: [{
    id: 'sketch', name: 'Line and arc', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: ['a', 'j', 'c', 'e'].map((id, index) => ({ id, position: positions[index] })),
      entities: [{ id: 'line', kind: 'line', construction: false, startPointId: 'a', endPointId: 'j' },
        { id: 'arc', kind: 'arc', construction: false, centerPointId: 'c', startPointId: 'j', endPointId: 'e', direction: 'ccw' }],
      relations: mode === 'driven' ? [{ id: 'radius', kind: 'radial-size', entityId: 'arc', quantity: 'radius', value: ' bendRadius ' }] : []
    }
  }] });
}
export function tangentSketch(document: CadDocument) { const sketch = document.features[0];
  if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing tangent fixture.'); return { ...sketch, graph: sketch.graph }; }
