import type { CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { CAD_SKETCH_POINT_OPERANDS, POINT_SLOT } from './kindParts';

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
  // The point is held where it is: as one fixed point, or as a fixed axis for each numeric coordinate that nothing holds yet, since a
  // coordinate written as an expression already follows it. A point joined to a fixed one is fixed already.
  offers: [{ signature: { slots: [POINT_SLOT], expand: 'each' }, plan: (planner, [point]) => planner.fix(point.id) }],
  agent: { exposed: true, summary: 'A point keeps a set position.' }
};
