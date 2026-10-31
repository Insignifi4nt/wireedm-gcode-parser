import type { CadSketchGraphEntity, CadSketchGraphPoint } from '../../cadSketchGraph';
import { assertCadSketchMidpointIdentities } from '../../cadSketchMidpointRelations';
import { assertCadSketchPointOnLineIdentities } from '../../cadSketchPointOnLineRelations';
import { assertCadSketchPointOnCurveIdentities } from '../../cadSketchPointOnCurveRelations';
import { assertCadSketchSymmetryIdentities, resolveCadSketchSymmetryOperands } from '../../cadSketchSymmetryRelations';
import { resolveCadSketchTangentJoint } from '../../cadSketchTangentRelations';
import { CAD_SKETCH_MIDPOINT_OPERANDS, CAD_SKETCH_POINT_ON_CURVE_OPERANDS, CAD_SKETCH_POINT_ON_LINE_OPERANDS, CAD_SKETCH_SYMMETRY_OPERANDS } from '../cadSketchOperandSignatures';
import type { CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { CAD_SKETCH_POINT_PAIR_OPERANDS, LINE_SLOT, POINT_SLOT, ROUND_SLOT, chainedPair, sortedIds } from './kindParts';

// Points that lie on, or in a set place on, other geometry. Their parse checks resolve exact identities: proximity never stands in for one.

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;
type Round = Extract<CadSketchGraphEntity, { kind: 'arc' | 'circle' }>;

export const coincident: CadSketchRelationDefinition<'coincident'> = {
  kind: 'coincident', family: 'incidence', name: 'Coincident',
  stored: CAD_SKETCH_POINT_PAIR_OPERANDS,
  operands: relation => relation.pointIds,
  withOperands: (relation, [first, second]) => ({ ...relation, pointIds: [first, second] }),
  key: relation => `coincident ${sortedIds(relation.pointIds)}`,
  offers: [
    { signature: chainedPair(POINT_SLOT), plan: (planner, [a, b]) => planner.coincide([a.id, b.id]) },
    // Two arcs or circles share their centre: a Coincident between the centres, which reads as Concentric.
    { signature: chainedPair(ROUND_SLOT), plan: (planner, [a, b]) => planner.concentric(planner.entity(a.id) as Round, planner.entity(b.id) as Round) }
  ],
  agent: { exposed: true, summary: 'Two points share one position. Between two arc or circle centres it reads as Concentric.' }
};

export const midpoint: CadSketchRelationDefinition<'midpoint'> = {
  kind: 'midpoint', family: 'incidence', name: 'Midpoint',
  stored: CAD_SKETCH_MIDPOINT_OPERANDS,
  operands: relation => [relation.pointId, relation.lineId],
  withOperands: (relation, [pointId, lineId]) => ({ ...relation, pointId, lineId }),
  key: relation => `midpoint ${relation.pointId} ${relation.lineId}`,
  validate: (graph, _, [point, line]) => { assertCadSketchMidpointIdentities(graph, point as CadSketchGraphPoint, line as Line); },
  offers: [{ signature: { slots: [POINT_SLOT, LINE_SLOT] }, plan: (planner, [point, line]) => planner.place({ kind: 'midpoint', pointId: point.id, lineId: line.id }) }],
  agent: { exposed: true, summary: 'A point stays at the middle of a line.' }
};

export const pointOnLine: CadSketchRelationDefinition<'point-on-line'> = {
  kind: 'point-on-line', family: 'incidence', name: 'Point on line',
  stored: CAD_SKETCH_POINT_ON_LINE_OPERANDS,
  operands: relation => [relation.pointId, relation.lineId],
  withOperands: (relation, [pointId, lineId]) => ({ ...relation, pointId, lineId }),
  key: relation => `point-on-line ${relation.pointId} ${relation.lineId}`,
  validate: (graph, _, [point, line]) => { assertCadSketchPointOnLineIdentities(graph, point as CadSketchGraphPoint, line as Line); },
  offers: [{ signature: { slots: [POINT_SLOT, LINE_SLOT] }, plan: (planner, [point, line]) => planner.place({ kind: 'point-on-line', pointId: point.id, lineId: line.id }) }],
  agent: { exposed: true, summary: 'A point stays on the infinite line through a line.' }
};

export const pointOnCurve: CadSketchRelationDefinition<'point-on-curve'> = {
  kind: 'point-on-curve', family: 'incidence', name: 'Point on curve',
  stored: CAD_SKETCH_POINT_ON_CURVE_OPERANDS,
  operands: relation => [relation.pointId, relation.curveId],
  withOperands: (relation, [pointId, curveId]) => ({ ...relation, pointId, curveId }),
  key: relation => `point-on-curve ${relation.pointId} ${relation.curveId}`,
  validate: (graph, _, [point, curve]) => { assertCadSketchPointOnCurveIdentities(graph, point as CadSketchGraphPoint, curve as Round); },
  offers: [{ signature: { slots: [POINT_SLOT, ROUND_SLOT] }, plan: (planner, [point, curve]) => planner.place({ kind: 'point-on-curve', pointId: point.id, curveId: curve.id }) }],
  agent: { exposed: true, summary: 'A point stays on the full circle of an arc or circle.' }
};

const mirrored = { role: 'Point or circle', accepts: ['point', 'circle'] } as const;
export const symmetric: CadSketchRelationDefinition<'symmetric'> = {
  kind: 'symmetric', family: 'incidence', name: 'Symmetric points',
  stored: CAD_SKETCH_SYMMETRY_OPERANDS,
  operands: relation => [...relation.pointIds, relation.lineId],
  withOperands: (relation, [first, second, lineId]) => ({ ...relation, pointIds: [first, second], lineId }),
  key: relation => `symmetric ${relation.lineId} ${sortedIds(relation.pointIds)}`,
  validate: (graph, _, [first, second, line]) => { assertCadSketchSymmetryIdentities(graph, first as CadSketchGraphPoint, second as CadSketchGraphPoint, line as Line); },
  // The two points, then the axis line's ends: the mirror pair and the axis it is mirrored about.
  pointIds: (graph, relation) => {
    const { line } = resolveCadSketchSymmetryOperands(graph, relation);
    return [...relation.pointIds, line.startPointId, line.endPointId];
  },
  // A circle stands for its centre.
  offers: [{ signature: { slots: [mirrored, mirrored, { role: 'Axis line', accepts: ['line'] }], unordered: [[0, 1]] },
    plan: (planner, [a, b, line]) => planner.mirror([a, b], planner.entity(line.id) as Line) }],
  agent: { exposed: true, summary: 'Two points mirror each other about a line.' }
};

const tangentCurve = (role: string) => ({ role, accepts: ['line', 'arc'] }) as const;
export const tangentJoint: CadSketchRelationDefinition<'tangent-joint'> = {
  kind: 'tangent-joint', family: 'incidence', name: 'Tangent',
  // Each curve with the end it joins at.
  stored: { slots: [tangentCurve('First curve'), { role: 'First joint end', accepts: ['point'], end: true },
    tangentCurve('Second curve'), { role: 'Second joint end', accepts: ['point'], end: true }], unordered: [[0, 2]] },
  operands: relation => relation.endpoints.flatMap(endpoint => [endpoint.entityId, endpoint.pointId]),
  withOperands: (relation, [first, firstPoint, second, secondPoint]) => ({ ...relation,
    endpoints: [{ ...relation.endpoints[0], entityId: first, pointId: firstPoint }, { ...relation.endpoints[1], entityId: second, pointId: secondPoint }] }),
  key: relation => `tangent-joint ${sortedIds(relation.endpoints.map(endpoint => `${endpoint.entityId}@${endpoint.pointId}`))}`,
  mentions: (relation, names) => relation.endpoints.map(endpoint => `${names.entity(endpoint.entityId)} at ${names.point(endpoint.pointId)}`),
  validate: (graph, relation) => { resolveCadSketchTangentJoint(graph, relation); },
  // A line and an arc join at the one pair of their ends that share a place. Each joint end follows its curve's pick, so the picks keep
  // their own order, and two lines or two arcs take none.
  offers: [{ signature: { slots: [tangentCurve('First curve'), tangentCurve('Second curve')] }, plan: (planner, [a, b]) => {
    const first = planner.entity(a.id)!, second = planner.entity(b.id)!;
    return first.kind === second.kind ? null : planner.tangent(first, second);
  } }],
  agent: { exposed: true, summary: 'A line and an arc that share an endpoint join smoothly there.' }
};
