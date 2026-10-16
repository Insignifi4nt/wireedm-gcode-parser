import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadDocument } from '../cadDocument';
import { parseCadSketchGraph } from '../cadSketchGraph';

export const dPlacement = { selections: [{ kind: 'entity', id: 'arc' }, { kind: 'entity', id: 'chord' }],
  anchor: [0, 0], target: [30, 20], angleDegrees: 90 } as const;
export function placementPart() {
  return parseCadDocument({ ...createCadDocument('Editable D detail', 'd-placement'), schemaVersion: 2, parameters: { angle: 0, targetX: 30 }, features: [
    { id: 'legacy', kind: 'sketch', name: 'Original', suppressed: false, plane: 'XY', offset: 0, profiles: [
      { id: 'original', name: 'Exact source', construction: true, geometry: { kind: 'circle', x: ' 0.000 ', y: ' 0 ', radius: ' 10.00 ' } }] },
    { id: 'sketch', kind: 'sketch', name: 'Editable detail', suppressed: false, plane: 'XY', offset: ' 5.00 ', profiles: [], graph: {
      points: [{ id: 'o', position: [0, 0] }, { id: 'a', position: [-8, 6] }, { id: 'b', position: [8, 6] }, { id: 'outside', position: [100, 100] }],
      entities: [{ id: 'arc', kind: 'arc', construction: false, centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw' },
        { id: 'chord', kind: 'line', construction: false, startPointId: 'b', endPointId: 'a' }], relations: []
    } }
  ] });
}
export function placementSketch(document: CadDocument) { const sketch = document.features.find(feature => feature.id === 'sketch');
  if (sketch?.kind !== 'sketch' || !sketch.graph) throw new Error('Missing placement fixture.'); return { ...sketch, graph: sketch.graph }; }
export function placementMixedGraph() {
  return parseCadSketchGraph({ points: [
    { id: 'a', position: [-10, 0] }, { id: 'j', position: [0, 0] }, { id: 'arc-j', position: [0, 0] },
    { id: 'c', position: [0, 5] }, { id: 'e', position: [5, 5] }, { id: 't', position: [-10, 5] }
  ], entities: [
    { id: 'bottom', kind: 'line', construction: false, startPointId: 'a', endPointId: 'j' },
    { id: 'arc', kind: 'arc', construction: false, centerPointId: 'c', startPointId: 'arc-j', endPointId: 'e', direction: 'ccw' },
    { id: 'top', kind: 'line', construction: false, startPointId: 'e', endPointId: 't' },
    { id: 'left', kind: 'line', construction: false, startPointId: 't', endPointId: 'a' }
  ], relations: [{ id: 'joint', kind: 'coincident', pointIds: ['j', 'arc-j'] }] });
}
