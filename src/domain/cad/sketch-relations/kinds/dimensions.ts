import { CadError } from '../../cadError';
import type { CadSketchGraphEntity, CadSketchGraphPoint } from '../../cadSketchGraph';
import { cadSketchAngleRaysOnLines } from '../../cadSketchAngleRelations';
import { assertCadSketchPointLineDistanceIdentities, assertCadSketchPointLineDistanceValue } from '../../cadSketchPointLineDistanceRelations';
import { resolveCadSketchReferenceDimension } from '../../cadSketchReferenceDimensions';
import { CAD_SKETCH_ANGLE_OPERANDS, CAD_SKETCH_POINT_LINE_DISTANCE_OPERANDS, CAD_SKETCH_RADIAL_OPERANDS } from '../cadSketchOperandSignatures';
import type { CadSketchOperandSignature, CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { CAD_SKETCH_POINT_OPERANDS, CAD_SKETCH_POINT_PAIR_OPERANDS, LINE_SLOT, POINT_SLOT, ROUND_SLOT, sortedIds } from './kindParts';

// Relations that hold a value: lengths, angles and sizes. Dimensions take their value from the person who places them, so none is
// offered from a selection.

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;
type Round = Extract<CadSketchGraphEntity, { kind: 'arc' | 'circle' }>;
const value = {
  keys: ['value'],
  read: (relation: { readonly value: string | number }) => [relation.value],
  write: <R extends { readonly value: string | number }>(relation: R, [next]: readonly (string | number)[]): R => ({ ...relation, value: next })
};

export const distance: CadSketchRelationDefinition<'distance'> = {
  kind: 'distance', family: 'dimension', name: 'Distance',
  stored: CAD_SKETCH_POINT_PAIR_OPERANDS,
  operands: relation => relation.pointIds,
  withOperands: (relation, [first, second]) => ({ ...relation, pointIds: [first, second] }),
  scalars: value,
  key: relation => `distance ${sortedIds(relation.pointIds)}`,
  agent: { exposed: true, summary: 'Two points keep a set distance apart.' }
};

export const pointLineDistance: CadSketchRelationDefinition<'point-line-distance'> = {
  kind: 'point-line-distance', family: 'dimension', name: 'Point to line distance',
  stored: CAD_SKETCH_POINT_LINE_DISTANCE_OPERANDS,
  operands: relation => [relation.pointId, relation.lineId],
  withOperands: (relation, [pointId, lineId]) => ({ ...relation, pointId, lineId }),
  scalars: value,
  // The side is part of what the value says, as an angle's sector is.
  key: relation => `point-line-distance ${relation.pointId} ${relation.lineId}`,
  validate: (graph, relation, [point, line]) => {
    assertCadSketchPointLineDistanceIdentities(graph, point as CadSketchGraphPoint, line as Line);
    assertCadSketchPointLineDistanceValue(relation);
  },
  agent: { exposed: true, summary: 'A point keeps a set distance from a line, on one side of it.' }
};

export const axisDistance: CadSketchRelationDefinition<'axis-distance'> = {
  kind: 'axis-distance', family: 'dimension', name: 'Axis distance',
  nameOf: relation => relation.axis === 'x' ? 'Horizontal distance' : 'Vertical distance',
  // Measured from the first point to the second along the axis.
  stored: { slots: [{ role: 'From point', accepts: ['point'] }, { role: 'To point', accepts: ['point'] }] },
  directed: true,
  operands: relation => relation.pointIds,
  withOperands: (relation, [first, second]) => ({ ...relation, pointIds: [first, second] }),
  scalars: value,
  key: relation => `axis-distance ${relation.axis} ${relation.pointIds.join(' ')}`,
  agent: { exposed: true, summary: 'One point keeps a set horizontal or vertical distance from another.' }
};

export const fixedAxis: CadSketchRelationDefinition<'fixed-axis'> = {
  kind: 'fixed-axis', family: 'dimension', name: 'Distance',
  stored: CAD_SKETCH_POINT_OPERANDS,
  operands: relation => [relation.pointId],
  withOperands: (relation, [pointId]) => ({ ...relation, pointId }),
  scalars: value,
  key: relation => `fixed-axis ${relation.axis} ${relation.pointId}`,
  // A distance from an axis names the axis among its operands, as a distance between two lines names both. An X coordinate is a
  // distance from the Y axis.
  mentions: (relation, names) => [names.point(relation.pointId), relation.axis === 'x' ? 'Y axis' : 'X axis'],
  agent: { exposed: true, summary: 'A point keeps a set distance from the X or Y axis; at 0 it lies on that axis.' }
};

export const lineAngle: CadSketchRelationDefinition<'line-angle'> = {
  kind: 'line-angle', family: 'dimension', name: 'Angle',
  stored: CAD_SKETCH_ANGLE_OPERANDS,
  operands: relation => relation.rays.flatMap(ray => [ray.lineId, ray.towardPointId]),
  withOperands: (relation, [first, firstToward, second, secondToward]) => ({ ...relation,
    rays: [{ ...relation.rays[0], lineId: first, towardPointId: firstToward }, { ...relation.rays[1], lineId: second, towardPointId: secondToward }] }),
  scalars: value,
  // One angle between two lines, stored from either; its rays and sense choose the sector the value measures.
  key: relation => `line-angle ${sortedIds(relation.rays.map(ray => ray.lineId))}`,
  validate: (_, relation, [first, , second]) => { cadSketchAngleRaysOnLines([first as Line, second as Line], relation.rays); },
  agent: { exposed: true, summary: 'Two lines keep a set angle between them.' }
};

export const radialSize: CadSketchRelationDefinition<'radial-size'> = {
  kind: 'radial-size', family: 'dimension', name: 'Radial size',
  nameOf: relation => relation.quantity === 'radius' ? 'Radius' : 'Diameter',
  stored: CAD_SKETCH_RADIAL_OPERANDS,
  operands: relation => [relation.entityId],
  withOperands: (relation, [entityId]) => ({ ...relation, entityId }),
  scalars: value,
  // A radius and a diameter hold one size.
  key: relation => `radial-size ${relation.entityId}`,
  validate: (_, __, [entity]) => {
    const round = entity as Round;
    if (round.kind === 'circle' && typeof round.radius === 'string')
      throw new CadError('already-driven-sketch-radius', 'Edit or explicitly release the existing circle-radius expression before adding a radial dimension.');
  },
  agent: { exposed: true, summary: 'An arc or circle keeps a set radius or diameter.' }
};

const REFERENCE_LINE_LENGTH = { slots: [LINE_SLOT] } as const satisfies CadSketchOperandSignature;
const REFERENCE_POINT_LINE = { slots: [POINT_SLOT, LINE_SLOT] } as const satisfies CadSketchOperandSignature;
const REFERENCE_RADIAL = { slots: [ROUND_SLOT] } as const satisfies CadSketchOperandSignature;
export const referenceDimension: CadSketchRelationDefinition<'reference-dimension'> = {
  kind: 'reference-dimension', family: 'dimension', name: 'Reference dimension',
  // A reference reads what it measures and drives nothing, so it has no value to change.
  stored: ({ measurement }) => measurement.kind === 'line-length' ? REFERENCE_LINE_LENGTH : measurement.kind === 'point-distance' ? CAD_SKETCH_POINT_PAIR_OPERANDS
    : measurement.kind === 'point-line-distance' ? REFERENCE_POINT_LINE : REFERENCE_RADIAL,
  operands: ({ measurement }) => measurement.kind === 'point-distance' ? measurement.pointIds
    : measurement.kind === 'point-line-distance' ? [measurement.pointId, measurement.lineId] : [measurement.entityId],
  withOperands: (relation, [first, second]) => {
    const measurement = relation.measurement;
    return { ...relation, measurement: measurement.kind === 'point-distance' ? { ...measurement, pointIds: [first, second] }
      : measurement.kind === 'point-line-distance' ? { ...measurement, pointId: first, lineId: second } : { ...measurement, entityId: first } };
  },
  key: ({ measurement }) => `reference-dimension ${measurement.kind} ${measurement.kind === 'point-distance' ? sortedIds(measurement.pointIds)
    : measurement.kind === 'point-line-distance' ? `${measurement.pointId} ${measurement.lineId}` : measurement.entityId}`,
  validate: (graph, relation) => { resolveCadSketchReferenceDimension(graph, relation); },
  agent: { exposed: true, summary: 'A measurement shown on the sketch without driving it.' }
};
