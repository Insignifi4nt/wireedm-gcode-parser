import { CAD_SKETCH_LINE_PAIR_OPERANDS, CAD_SKETCH_RADIUS_PAIR_OPERANDS } from '../cadSketchOperandSignatures';
import type { CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { LINE_SLOT, ROUND_SLOT, chainedPair, sortedIds } from './kindParts';

// Two lines of one length, or two arcs or circles of one radius.

export const equalLength: CadSketchRelationDefinition<'equal-length'> = {
  kind: 'equal-length', family: 'equality', name: 'Equal length',
  stored: CAD_SKETCH_LINE_PAIR_OPERANDS,
  operands: relation => relation.lineIds,
  withOperands: (relation, [first, second]) => ({ ...relation, lineIds: [first, second] }),
  key: relation => `equal-length ${sortedIds(relation.lineIds)}`,
  offers: [{ signature: chainedPair(LINE_SLOT), plan: (planner, [a, b]) => planner.equal(planner.entity(a.id)!, planner.entity(b.id)!) }],
  agent: { exposed: true, summary: 'Two lines keep the same length.' }
};
export const equalRadius: CadSketchRelationDefinition<'equal-radius'> = {
  kind: 'equal-radius', family: 'equality', name: 'Equal radius',
  stored: CAD_SKETCH_RADIUS_PAIR_OPERANDS,
  operands: relation => relation.curveIds,
  withOperands: (relation, [first, second]) => ({ ...relation, curveIds: [first, second] }),
  key: relation => `equal-radius ${sortedIds(relation.curveIds)}`,
  offers: [{ signature: chainedPair(ROUND_SLOT), plan: (planner, [a, b]) => planner.equal(planner.entity(a.id)!, planner.entity(b.id)!) }],
  agent: { exposed: true, summary: 'Two arcs or circles keep the same radius.' }
};
