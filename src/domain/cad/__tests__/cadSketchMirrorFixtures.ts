import { createCadDocument, parseCadDocument } from '../cadSchema';
import { prepareCadSketchCells } from '../cadSketchRegionInspection';

export const mirrorBoreRequest = { entityIds: ['bore'], axisLineId: 'axis', idPrefix: 'mirror' } as const;
export const mixedMirrorRequest = { entityIds: ['chord', 'bore', 'arc'], axisLineId: 'axis', idPrefix: 'copy' } as const;
export function pairedBoreMirrorPart(consumed = false) {
  const document = parseCadDocument({ ...createCadDocument('Paired bores', 'paired-bores'), schemaVersion: 2,
    parameters: { plateWidth: 60, plateHeight: 30, boreDiameter: 6 }, features: [{
      id: 'sketch', kind: 'sketch', name: 'Bore plate', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
        points: [{ id: 'a', position: ['0.000', '0.000'] }, { id: 'b', position: [' plateWidth ', '0.000'] },
          { id: 'c', position: [' plateWidth ', ' plateHeight '] }, { id: 'd', position: ['0.000', ' plateHeight '] },
          { id: 'bore-center', position: ['15', '15'] }, { id: 'axis-a', position: ['30', '0'] }, { id: 'axis-b', position: ['30', '30'] }],
        entities: [{ id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
          { id: 'bc', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
          { id: 'cd', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
          { id: 'da', kind: 'line', startPointId: 'd', endPointId: 'a', construction: false },
          { id: 'bore', kind: 'circle', centerPointId: 'bore-center', radius: ' boreDiameter / 2 ', construction: false },
          { id: 'axis', kind: 'line', startPointId: 'axis-a', endPointId: 'axis-b', construction: true }], relations: []
      }
    }] });
  if (!consumed) return document;
  const sketch = document.features[0]; if (sketch.kind !== 'sketch') throw new Error('Bore source missing.');
  const catalog = prepareCadSketchCells(sketch, document.parameters, 'graph-cells'), body = catalog.pick({ x: 5, y: 5 });
  if (!body) throw new Error('Bore plate material missing.');
  return parseCadDocument({ ...document, features: [...document.features, { id: 'pad', kind: 'extrude', name: 'Bored plate', sketchId: 'sketch',
    distance: 5, symmetric: false, operation: 'new', targetId: null, suppressed: false, regionSelection: catalog.pack([body.id]) }] });
}
export function mixedMirrorPart() {
  return parseCadDocument({ ...createCadDocument('Mixed mirror', 'mixed-mirror'), schemaVersion: 2, parameters: { boreRadius: 1 }, features: [{
    id: 'sketch', kind: 'sketch', name: 'Joined arc and bore', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'a', position: [10, 0] }, { id: 'a-close', position: [10, 0] }, { id: 'b', position: [0, 10] },
        { id: 'bore-center', position: ['6.000', ' 6 '] }, { id: 'o', position: ['0.000', ' 0 '] }, { id: 'outside-alias', position: [10, 0] },
        { id: 'axis-a', position: ['30.000', '0.000'] }, { id: 'axis-b', position: ['30.000', '15.000'] }],
      entities: [{ id: 'arc', kind: 'arc', centerPointId: 'o', startPointId: 'a', endPointId: 'b', direction: 'ccw', construction: false },
        { id: 'bore', kind: 'circle', centerPointId: 'bore-center', radius: ' boreRadius ', construction: false },
        { id: 'chord', kind: 'line', startPointId: 'b', endPointId: 'a-close', construction: false },
        { id: 'axis', kind: 'line', startPointId: 'axis-a', endPointId: 'axis-b', construction: true }],
      relations: [{ id: 'source-joint-0', kind: 'coincident', pointIds: ['a', 'outside-alias'] },
        { id: 'source-joint-1', kind: 'coincident', pointIds: ['outside-alias', 'a-close'] }]
    }
  }] });
}
