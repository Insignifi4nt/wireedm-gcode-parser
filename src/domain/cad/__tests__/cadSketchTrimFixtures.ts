import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadSketchEndTrimTarget, CadSketchMiddleTrimTarget } from '../cadSketchTrimExtend';
import { prepareCadSketchCells } from '../cadSketchRegionInspection';
import { dxf } from './cadSketchRegionFixtures';

export const endTrim: CadSketchEndTrimTarget = { kind: 'end', entityId: 'ab', parameter: .1, end: 'start',
  boundary: { entityId: 'cutter', index: 0, parameter: .25, position: [5, 0] }, cutPointId: 'cut' };

export function trimPart(consumed = false) {
  const source = parseCadDocument({ ...createCadDocument('End trim', 'end-trim'), schemaVersion: 2, parameters: { span: 20, retained: 7 }, features: [{
    id: 'sketch', kind: 'sketch', name: 'Two blanks', plane: 'XY', offset: 0, suppressed: false, profiles: [],
    source: { format: 'dxf', fileName: 'exact.dxf', text: dxf, units: 'mm' }, graph: {
      points: [{ id: 'a', position: [0, 0] }, { id: 'b', position: [' span ', 0] }, { id: 'c', position: [' span ', 10] }, { id: 'd', position: [0, 10] },
        { id: 'e', position: [40, 0] }, { id: 'f', position: [60, 0] }, { id: 'g', position: [60, 10] }, { id: 'h', position: [40, 10] },
        { id: 'cut-a', position: [5, -5] }, { id: 'cut-b', position: [5, 5] }],
      entities: [...['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, index) => ({ id: ['ab', 'bc', 'cd', 'da', 'ef', 'fg', 'gh', 'he'][index],
        kind: 'line', construction: false, startPointId: id, endPointId: ['b', 'c', 'd', 'a', 'f', 'g', 'h', 'e'][index] })),
        { id: 'cutter', kind: 'line', construction: true, startPointId: 'cut-a', endPointId: 'cut-b' }], relations: [] }
  }] });
  const sketch = source.features[0]; if (sketch.kind !== 'sketch') throw new Error('Trim fixture sketch missing.');
  return consumed ? parseCadDocument({ ...source, features: [...source.features, { id: 'pad', kind: 'extrude', name: 'Both blanks', sketchId: 'sketch',
    suppressed: false, distance: ' retained ', symmetric: false, operation: 'new', targetId: null,
    regionSelection: prepareCadSketchCells(sketch, source.parameters).cells.map(cell => cell.reference) }] }) : source;
}

export const middleTrim: CadSketchMiddleTrimTarget = { kind: 'middle', entityId: 'ab', parameter: .5,
  boundaries: [{ entityId: 'cutter', index: 0, parameter: .25, position: [5, 0], endpointPointId: 'cut-b' },
    { entityId: 'cutter-right', index: 0, parameter: .75, position: [15, 0], endpointPointId: 'right-b' }],
  cutPointIds: ['cut-b', 'right-b'], newEntityId: 'ab-right', supportRelationId: 'common-support' };

export function middleTrimPart(consumed = false) {
  const base = trimPart(), feature = base.features[0];
  if (feature.kind !== 'sketch' || !feature.graph) throw new Error('Middle trim fixture sketch missing.');
  const source = parseCadDocument({ ...base, parameters: { ...base.parameters, originX: 0 }, features: [{ ...feature, graph: {
    ...feature.graph, points: [...feature.graph.points.map(point => point.id === 'a' ? { ...point, position: [' originX ', 0] }
      : point.id === 'b' || point.id === 'c' ? { ...point, position: [20, point.position[1]] }
        : point.id === 'cut-b' ? { ...point, position: [5, 0] } : point),
      { id: 'right-a', position: [15, -5] }, { id: 'right-b', position: [15, 0] }],
    entities: [...feature.graph.entities, { id: 'cutter-right', kind: 'line', construction: true, startPointId: 'right-a', endPointId: 'right-b' }],
    relations: [{ id: 'bottom', kind: 'horizontal', pointIds: ['a', 'b'] }, { id: 'right', kind: 'vertical', pointIds: ['b', 'c'] },
      { id: 'top', kind: 'horizontal', pointIds: ['c', 'd'] }, { id: 'left', kind: 'vertical', pointIds: ['d', 'a'] },
      { id: 'span', kind: 'distance', pointIds: ['a', 'b'], value: ' span ' }, { id: 'base-y', kind: 'fixed-axis', pointId: 'a', axis: 'y', value: ' 0 ' }]
  } }] });
  const sketch = source.features[0]; if (sketch.kind !== 'sketch') throw new Error('Middle sketch missing.');
  return consumed ? parseCadDocument({ ...source, features: [...source.features, { id: 'pad', kind: 'extrude', name: 'Both blanks', sketchId: 'sketch',
    suppressed: false, distance: ' retained ', symmetric: false, operation: 'new', targetId: null,
    regionSelection: prepareCadSketchCells(sketch, source.parameters).cells.map(cell => cell.reference) }] }) : source;
}
