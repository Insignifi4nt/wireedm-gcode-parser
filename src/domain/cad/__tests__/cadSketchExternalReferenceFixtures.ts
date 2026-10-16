import { createCadDocument, parseCadDocument } from '../cadSchema';
import { applyCadEdits } from '../cadOperations';

export const lineUseReference = { kind: 'use-sketch-entity', sketchId: 'plate', sourceSketchId: 'layout', sourceEntityId: 'line', idPrefix: 'ref' } as const;
export const lineMidpoint = { kind: 'set-sketch-relation', sketchId: 'plate', relation: { id: 'follow-midpoint', kind: 'midpoint', pointId: 'hole-center', lineId: 'ref_e0' } } as const;

export function lineReferencePart(linked = false, consumed = false) {
  const source = parseCadDocument({ ...createCadDocument('Referenced bore', 'referenced-bore'), schemaVersion: 2,
    parameters: { span: 40, sourceOffset: 0, targetOffset: 5 }, parameterGroups: [{ id: 'layout-sizes', name: 'Layout' }],
    parameterMetadata: { span: { groupId: 'layout-sizes', source: { kind: 'manual' } } }, features: [
      { id: 'layout', kind: 'sketch', name: 'Layout', suppressed: false, plane: 'XY', offset: ' sourceOffset ', profiles: [], graph: {
        points: [{ id: 'a', position: ['0.000', 10] }, { id: 'b', position: [' span ', 10] }],
        entities: [{ id: 'line', kind: 'line', startPointId: 'a', endPointId: 'b', construction: true }], relations: [] } },
      { id: 'plate', kind: 'sketch', name: 'Plate and bore', suppressed: false, plane: 'XY', offset: ' targetOffset ', profiles: [], graph: {
        points: [{ id: 'a', position: ['0', '0'] }, { id: 'b', position: ['80', '0'] }, { id: 'c', position: ['80', '20'] }, { id: 'd', position: ['0', '20'] },
          { id: 'hole-center', position: [20, 10] }],
        entities: [{ id: 'ab', kind: 'line', startPointId: 'a', endPointId: 'b', construction: false },
          { id: 'bc', kind: 'line', startPointId: 'b', endPointId: 'c', construction: false },
          { id: 'cd', kind: 'line', startPointId: 'c', endPointId: 'd', construction: false },
          { id: 'da', kind: 'line', startPointId: 'd', endPointId: 'a', construction: false },
          { id: 'hole', kind: 'circle', centerPointId: 'hole-center', radius: 3, construction: false }],
        relations: [{ id: 'hole-radius', kind: 'radial-size', entityId: 'hole', quantity: 'radius', value: 3 }] } },
      ...(consumed ? [{ id: 'pad', kind: 'extrude', name: 'Raised plate', suppressed: false, sketchId: 'plate', distance: 5,
        symmetric: false, operation: 'new', targetId: null }] : [])
    ] });
  return linked ? applyCadEdits(source, [lineUseReference, lineMidpoint]) : source;
}

export const circleUseReference = { kind: 'use-sketch-entity', sketchId: 'target', sourceSketchId: 'source', sourceEntityId: 'circle', idPrefix: 'ref' } as const;
export const circleFollowingRelations = [
  { kind: 'set-sketch-relation', sketchId: 'target', relation: { id: 'same-center', kind: 'coincident', pointIds: ['ref_c0', 'bore-center'] } },
  { kind: 'set-sketch-relation', sketchId: 'target', relation: { id: 'same-radius', kind: 'equal-radius', curveIds: ['ref_e0', 'bore'] } }
] as const;
export function circleReferencePart(linked = false) {
  const source = parseCadDocument({ ...createCadDocument('Circle reference', 'circle-reference'), schemaVersion: 2, parameters: { sourceSize: 3 }, features: [
    { id: 'source', kind: 'sketch', name: 'Source circle', suppressed: false, plane: 'XY', offset: 0, profiles: [], graph: {
      points: [{ id: 'source-center', position: [' 2 * sourceSize + 4 ', ' sourceSize + 4 '] }],
      entities: [{ id: 'circle', kind: 'circle', construction: true, centerPointId: 'source-center', radius: ' sourceSize ' }], relations: [] } },
    { id: 'target', kind: 'sketch', name: 'Following bore', suppressed: false, plane: 'XY', offset: 5, profiles: [], graph: {
      points: [{ id: 'bore-center', position: [10, 7] }], entities: [{ id: 'bore', kind: 'circle', construction: false, centerPointId: 'bore-center', radius: 3 }], relations: [] } }
  ] });
  return linked ? applyCadEdits(source, [circleUseReference, ...circleFollowingRelations]) : source;
}
