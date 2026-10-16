import { createCadDocument, parseCadDocument } from '../cadSchema';
import type { CadSketchEndTrimTarget } from '../cadSketchTrimExtend';
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
