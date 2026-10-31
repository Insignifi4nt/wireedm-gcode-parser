import type { CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { CAD_SKETCH_POINT_OPERANDS, POINT_SLOT, refusal } from './kindParts';

// A point held where it is.

export const fixedPoint: CadSketchRelationDefinition<'fixed-point'> = {
  kind: 'fixed-point', family: 'fix', name: 'Fixed point',
  stored: CAD_SKETCH_POINT_OPERANDS,
  operands: relation => [relation.pointId],
  withOperands: (relation, [pointId]) => ({ ...relation, pointId }),
  scalars: {
    keys: ['position.0', 'position.1'],
    read: relation => relation.position,
    write: (relation, [x, y]) => ({ ...relation, position: [x, y] })
  },
  key: relation => `fixed-point ${relation.pointId}`,
  // The point is held at its current coordinates, which must be numbers: a coordinate written as an expression already follows it.
  offers: [{ signature: { slots: [POINT_SLOT], expand: 'each' }, build: ({ point }, [pick]) => {
    const [x, y] = point(pick.id)!.position;
    return typeof x === 'number' && typeof y === 'number' ? { kind: 'fixed-point', pointId: pick.id, position: [x, y] }
      : refusal('invalid-sketch-fixed-point', 'A coordinate written as an expression already follows it, so the point cannot be fixed where it is.');
  } }],
  agent: { exposed: true, summary: 'A point keeps a set position.' }
};
