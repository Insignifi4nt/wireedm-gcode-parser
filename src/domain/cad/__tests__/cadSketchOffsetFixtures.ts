import { createCadDocument, parseCadDocument } from '../cadSchema';

export function offsetCirclePart() {
  return parseCadDocument({ ...createCadDocument('Detached offset', 'offset-part'), parameters: { radius: 10 }, features: [{
    id: 'sketch', name: 'Bore', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: ' radius ' } }]
  }] });
}

export function offsetGraphPart(curved = false) {
  return parseCadDocument({ ...createCadDocument('Offset source', 'offset-source'), schemaVersion: 2, parameters: { span: 20, capX: 5 }, features: [{
    id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: curved ? {
      points: [{ id: 'a', position: [-5, -3] }, { id: 'b', position: [5, -3] }, { id: 'c', position: [5, 3] }, { id: 'd', position: [-5, 3] },
        { id: 'right', position: [' capX ', 0] }, { id: 'left', position: [-5, 0] }],
      entities: [{ id: 'ab', kind: 'line', construction: false, startPointId: 'a', endPointId: 'b' },
        { id: 'bc', kind: 'arc', construction: false, startPointId: 'b', endPointId: 'c', centerPointId: 'right', direction: 'ccw' },
        { id: 'cd', kind: 'line', construction: false, startPointId: 'c', endPointId: 'd' },
        { id: 'da', kind: 'arc', construction: false, startPointId: 'd', endPointId: 'a', centerPointId: 'left', direction: 'ccw' }], relations: []
    } : {
      points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: [' span ', 0] }, { id: 'c', position: [' span ', 10] }, { id: 'd', position: [0, 10] }],
      entities: ['a', 'b', 'c', 'd'].map((id, index) => ({ id: ['ab', 'bc', 'cd', 'da'][index], kind: 'line', construction: false,
        startPointId: id, endPointId: ['b', 'c', 'd', 'a'][index] })), relations: []
    }
  }] });
}

export function offsetSlotPart() {
  return parseCadDocument({ ...createCadDocument('Slot offset', 'slot-offset'), parameters: { length: 20 }, features: [{
    id: 'sketch', name: 'Rotated slot', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0,
    profiles: [{ id: 'slot', name: 'Slot', construction: false,
      geometry: { kind: 'slot', x: 17, y: -4, length: ' length ', width: 6, angle: 30 } }]
  }] });
}
