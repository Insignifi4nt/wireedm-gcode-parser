import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadDocument } from '../cadDocument';

export const symmetricRelation = { id: 'symmetry', kind: 'symmetric', pointIds: ['left', 'right'], lineId: 'axis' } as const;
export function symmetryPart({ free = false, oblique = false, reversed = false, incompatible = false } = {}) {
  return parseCadDocument({ ...createCadDocument('Paired bores', 'paired-bores'), schemaVersion: 2, parameters: { leftX: 15, retained: 7 }, features: [{
    id: 'sketch', name: 'Bores and guide', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'axis-a', position: oblique ? ['0', '0'] : ['35.000', '0'] }, { id: 'axis-b', position: oblique ? ['20', '20'] : ['35.000', '20'] },
        { id: 'left', position: free ? [15, 10] : [' leftX ', '10.000'] }, { id: 'right', position: incompatible ? ['49.00', '11.0'] : oblique ? [9, 16] : [49, 11] }],
      entities: [{ id: 'axis', kind: 'line', construction: true, startPointId: reversed ? 'axis-b' : 'axis-a', endPointId: reversed ? 'axis-a' : 'axis-b' },
        { id: 'left-bore', kind: 'circle', construction: false, centerPointId: 'left', radius: '3.000' },
        { id: 'right-bore', kind: 'circle', construction: false, centerPointId: 'right', radius: '4.00' }], relations: []
    }
  }] });
}
export function symmetrySketch(document: CadDocument) { const sketch = document.features[0];
  if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing symmetry graph.'); return { ...sketch, graph: sketch.graph }; }
