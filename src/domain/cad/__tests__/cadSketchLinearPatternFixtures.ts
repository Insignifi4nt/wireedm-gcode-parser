import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadDocument } from '../cadDocument';
import type { CadSketchLinearPattern } from '../cadSketchGraph';

export const circleRow = { id: 'row', kind: 'linear-pattern', seed: { kind: 'circle', entityId: 'seed', centerPointId: 'center' },
  idPrefix: 'holes', direction: '+x', count: 4, spacing: ' pitch ', omittedInstances: [] } as const satisfies CadSketchLinearPattern;
export function circleRowPart(free = false) { return parseCadDocument({ ...createCadDocument('Circle row', 'circle-row'), schemaVersion: 2,
  parameters: { pitch: 15, diameter: 6 }, features: [{ id: 'sketch', kind: 'sketch', name: 'Bores', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
    points: [{ id: 'center', position: free ? [10, 10] : ['10.000', '10'] }],
    entities: [{ id: 'seed', kind: 'circle', construction: false, centerPointId: 'center', radius: free ? 3 : ' diameter / 2 ' }], relations: []
  } }] }); }
export function rowSketch(document: CadDocument) { const sketch = document.features[0];
  if (sketch.kind !== 'sketch' || !sketch.graph) throw new Error('Missing row graph.'); return { ...sketch, graph: sketch.graph }; }
