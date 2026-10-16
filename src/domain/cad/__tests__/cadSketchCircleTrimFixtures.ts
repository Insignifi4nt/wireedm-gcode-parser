import { createCadDocument, parseCadDocument } from '../cadSchema';

export function circleTrimPart() {
  return parseCadDocument({ ...createCadDocument('Circle cap trim', 'circle-cap-trim'), schemaVersion: 2, parameters: {}, features: [{
    id: 'sketch', name: 'D blank', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [], graph: {
      points: [{ id: 'center', position: ['0.000', ' 0 '] }, { id: 'a', position: ['-8.000', '6.000'] }, { id: 'b', position: ['8.000', '6.000'] }],
      entities: [{ id: 'disk', kind: 'circle', centerPointId: 'center', radius: 10, construction: false },
        { id: 'chord', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false }], relations: []
    }
  }] });
}

export const lowerDAreaMm2 = 100 * Math.PI - (100 * Math.acos(.6) - 48);
