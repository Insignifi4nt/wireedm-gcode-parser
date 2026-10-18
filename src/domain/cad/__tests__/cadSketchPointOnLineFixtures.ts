import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadDocument } from '../cadDocument';
export const pointOnLineRelation = { id: 'on-guide', kind: 'point-on-line', pointId: 'p', lineId: 'guide' } as const;
export function pointOnLinePart(fixed = false, reversed = false) {
  return parseCadDocument({ ...createCadDocument('Sliding bore', 'sliding-bore'), schemaVersion: 2, parameters: { height: 20, retained: 7 }, features: [{
    id: 'sketch', name: 'Bore and guide', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'a', position: ['0.000', '0'] }, { id: 'b', position: ['40.00', ' height '] }, { id: 'p', position: fixed ? ['10', '9'] : [10, 9] }],
      entities: [{ id: 'guide', kind: 'line', construction: true, startPointId: reversed ? 'b' : 'a', endPointId: reversed ? 'a' : 'b' },
        { id: 'bore', kind: 'circle', construction: false, centerPointId: 'p', radius: '3.000' }], relations: []
    }
  }] });
}
export function pointOnLineSketch(document: CadDocument) { const sketch = document.features[0];
  if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing point/line fixture.'); return { ...sketch, graph: sketch.graph }; }
