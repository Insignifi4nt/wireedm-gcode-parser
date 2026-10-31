import { checkCadSketchEqualRelation, resolveCadSketchRadiusPair } from '../../cadSketchEqualRelations';
import { CAD_SKETCH_LINE_PAIR_OPERANDS, CAD_SKETCH_RADIUS_PAIR_OPERANDS } from '../cadSketchOperandSignatures';
import type { CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { LINE_SLOT, ROUND_SLOT, chainedPair, sortedIds } from './kindParts';
import { directedLinePair } from './orientation';

// Two lines of one length, or two arcs or circles of one radius.

export const equalLength: CadSketchRelationDefinition<'equal-length'> = {
  kind: 'equal-length', family: 'equality', name: 'Equal length',
  stored: CAD_SKETCH_LINE_PAIR_OPERANDS,
  operands: relation => relation.lineIds,
  withOperands: (relation, [first, second]) => ({ ...relation, lineIds: [first, second] }),
  key: relation => `equal-length ${sortedIds(relation.lineIds)}`,
  offers: [{ signature: chainedPair(LINE_SLOT), plan: (planner, [a, b]) => planner.equal(planner.entity(a.id)!, planner.entity(b.id)!) }],
  lower: (relation, context) => {
    const [a, b] = directedLinePair(context, relation.lineIds);
    context.emit('equal-length', [...context.support(a), ...context.support(b)]);
  },
  check: (graph, relation, points, parameters) => checkCadSketchEqualRelation(graph, relation, points, parameters),
  agent: { exposed: true, summary: 'Two lines keep the same length.',
    meaning: 'Keeps two line lengths equal.' }
};
export const equalRadius: CadSketchRelationDefinition<'equal-radius'> = {
  kind: 'equal-radius', family: 'equality', name: 'Equal radius',
  stored: CAD_SKETCH_RADIUS_PAIR_OPERANDS,
  operands: relation => relation.curveIds,
  withOperands: (relation, [first, second]) => ({ ...relation, curveIds: [first, second] }),
  key: relation => `equal-radius ${sortedIds(relation.curveIds)}`,
  offers: [{ signature: chainedPair(ROUND_SLOT), plan: (planner, [a, b]) => planner.equal(planner.entity(a.id)!, planner.entity(b.id)!) }],
  lower: (relation, context) => {
    const [a, b] = resolveCadSketchRadiusPair(context.graph, relation.curveIds);
    context.equalSizes(context.size(a), context.size(b));
  },
  check: (graph, relation, points, parameters) => checkCadSketchEqualRelation(graph, relation, points, parameters),
  agent: { exposed: true, summary: 'Two arcs or circles keep the same radius.',
    meaning: 'Keeps two circle or arc radii equal.' }
};
