import { resolveCadSketchCornerTopology } from '../../cadSketchCornerGeometry';
import { validateCadSketchExternalReference } from '../../cadSketchExternalReferences';
import { cadSketchLinearPatternInstances, validateCadSketchLinearPattern } from '../../cadSketchLinearPattern';
import type { CadSketchOperandSignature, CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import { sortedIds } from './kindParts';

// Relations that made geometry and keep it: a pattern's copies, a linked reference's construction edge and a corner's arc or chamfer
// line. Tools create them with that geometry, so none is offered from a selection.

export const linearPattern: CadSketchRelationDefinition<'linear-pattern'> = {
  kind: 'linear-pattern', family: 'composite', name: 'Linear pattern',
  stored: { slots: [{ role: 'Seed circle', accepts: ['circle'] }, { role: 'Seed centre', accepts: ['point'], end: true }] },
  operands: ({ seed }) => [seed.entityId, seed.centerPointId],
  withOperands: (relation, [entityId, centerPointId]) => ({ ...relation, seed: { ...relation.seed, entityId, centerPointId } }),
  scalars: { keys: ['spacing'], read: relation => [relation.spacing], write: (relation, [spacing]) => ({ ...relation, spacing }) },
  // The copies in range and not omitted.
  owns: relation => {
    const active = cadSketchLinearPatternInstances(relation).filter(member => member.active);
    return { pointIds: active.map(member => member.pointId), entityIds: active.map(member => member.entityId) };
  },
  key: relation => `linear-pattern ${relation.seed.entityId}`,
  validate: (graph, relation) => { validateCadSketchLinearPattern(graph, relation); },
  agent: { exposed: true, summary: 'Copies of a circle repeat at a set spacing along X or Y.' }
};

export const externalReference: CadSketchRelationDefinition<'external-reference'> = {
  kind: 'external-reference', family: 'composite', name: 'Linked reference',
  // Its source lives in another sketch; here it keeps one construction edge that follows that source.
  stored: { slots: [] },
  operands: () => [],
  withOperands: relation => relation,
  owns: relation => ({ pointIds: [], entityIds: [relation.entityId] }),
  key: relation => `external-reference ${relation.entityId}`,
  mentions: (relation, names) => [names.entity(relation.entityId)],
  validate: (graph, relation) => { validateCadSketchExternalReference(graph, relation); },
  agent: { exposed: true, summary: 'A construction line or circle follows an edge of another sketch.' }
};

const CORNER = {
  slots: [{ role: 'Corner point', accepts: ['point'] }, { role: 'First line', accepts: ['line'] }, { role: 'Second line', accepts: ['line'] }]
} as const satisfies CadSketchOperandSignature;
export const filletCorner: CadSketchRelationDefinition<'fillet-corner'> = {
  kind: 'fillet-corner', family: 'composite', name: 'Fillet',
  stored: CORNER,
  operands: relation => [relation.pointId, ...relation.lineIds],
  withOperands: (relation, [pointId, first, second]) => ({ ...relation, pointId, lineIds: [first, second] }),
  scalars: { keys: ['value'], read: relation => [relation.value], write: (relation, [value]) => ({ ...relation, value }) },
  owns: relation => ({ pointIds: [], entityIds: [relation.arcId] }),
  key: relation => `fillet-corner ${relation.pointId} ${sortedIds(relation.lineIds)}`,
  mentions: (relation, names) => [names.point(relation.pointId)],
  validate: (graph, relation) => { resolveCadSketchCornerTopology(graph, relation); },
  agent: { exposed: true, summary: 'An arc of a set radius rounds the corner where two lines meet.' }
};
export const chamferCorner: CadSketchRelationDefinition<'chamfer-corner'> = {
  kind: 'chamfer-corner', family: 'composite', name: 'Chamfer',
  stored: CORNER,
  operands: relation => [relation.pointId, ...relation.lineIds],
  withOperands: (relation, [pointId, first, second]) => ({ ...relation, pointId, lineIds: [first, second] }),
  scalars: { keys: ['values.0', 'values.1'], read: relation => relation.values, write: (relation, [first, second]) => ({ ...relation, values: [first, second] }) },
  owns: relation => ({ pointIds: [], entityIds: [relation.chamferId] }),
  key: relation => `chamfer-corner ${relation.pointId} ${sortedIds(relation.lineIds)}`,
  mentions: (relation, names) => [names.point(relation.pointId)],
  validate: (graph, relation) => { resolveCadSketchCornerTopology(graph, relation); },
  agent: { exposed: true, summary: 'A line cuts the corner where two lines meet, set back by two lengths.' }
};
