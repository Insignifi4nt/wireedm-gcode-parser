import { evaluateCadScalar } from '../../cadExpression';
import { checkCadSketchHeldPoint } from '../cadSketchRelationChecks';
import type { CadSketchGraphEntity } from '../../cadSketchGraph';
import type { CadSketchRelationDefinition, CadSketchRelationPlan, CadSketchRelationPlanner } from '../cadSketchRelationTypes';
import { CAD_SKETCH_POINT_OPERANDS } from './kindParts';

// A point held where it is, or every point of a line or an arc, which holds the whole edge.

/**
 * Each point of a line or an arc fixed as one point would be. A point already fixed, or one whose coordinates follow expressions or are
 * held already, adds nothing, as such a coordinate adds nothing to a point's Fix; the edge is refused only when every point is. Points that
 * Coincident joins are one point, fixed once.
 */
function fixEdge(planner: CadSketchRelationPlanner, edge: Extract<CadSketchGraphEntity, { kind: 'line' | 'arc' }>): CadSketchRelationPlan {
  const ids = edge.kind === 'line' ? [edge.startPointId, edge.endPointId] : [edge.centerPointId, edge.startPointId, edge.endPointId];
  const joined = new Set<string>(), plans = ids.filter(id => !joined.has(planner.identity(id)) && joined.add(planner.identity(id))).map(id => planner.fix(id));
  const relations = plans.flatMap(plan => plan.state === 'available' ? plan.relations : []);
  if (relations.length) return { state: 'available', relations };
  const held = [...new Set(plans.flatMap(plan => plan.state === 'applied' ? plan.relationIds : []))];
  if (held.length) return { state: 'applied', relationIds: held, reason: 'This edge is already fixed.' };
  return plans.find(plan => plan.state === 'blocked')!;
}

export const fixedPoint: CadSketchRelationDefinition<'fixed-point'> = {
  kind: 'fixed-point', family: 'fix', name: 'Fixed point',
  stored: CAD_SKETCH_POINT_OPERANDS,
  operands: relation => [relation.pointId],
  withOperands: (relation, [pointId]) => ({ ...relation, pointId }),
  scalars: {
    keys: ['position.0', 'position.1'],
    quantity: { 'position.0': 'length', 'position.1': 'length' },
    read: relation => relation.position,
    write: (relation, [x, y]) => ({ ...relation, position: [x, y] })
  },
  key: relation => `fixed-point ${relation.pointId}`,
  // The point is held where it is: as one fixed point, or as a fixed axis for each numeric coordinate that nothing holds yet, since a
  // coordinate written as an expression already follows it. A point joined to a fixed one is fixed already.
  // A circle is left out: its radius is no point, so fixing its centre would leave it free to grow.
  offers: [{ signature: { slots: [{ role: 'Point, line or arc', accepts: ['point', 'line', 'arc'], needs: ['movable'] }], expand: 'each' },
    plan: (planner, [pick]) => { const edge = pick.kind === 'entity' ? planner.entity(pick.id) : undefined; return edge && (edge.kind === 'line' || edge.kind === 'arc') ? fixEdge(planner, edge) : planner.fix(pick.id); } }],
  lower: (relation, context) => {
    context.hold(relation.pointId, 0, context.value(relation.id, 'position.0'));
    context.hold(relation.pointId, 1, context.value(relation.id, 'position.1'));
  },
  check: (_, relation, points, parameters) => checkCadSketchHeldPoint(relation, points,
    () => ({ x: evaluateCadScalar(relation.position[0], parameters), y: evaluateCadScalar(relation.position[1], parameters) })),
  agent: { exposed: true, summary: 'A point keeps a set position.',
    meaning: 'Fixes a point at its driving X and Y coordinates.' }
};
