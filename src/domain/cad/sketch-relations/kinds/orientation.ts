import type { CadSketchGraphEntity } from '../../cadSketchGraph';
import { CAD_SKETCH_LINE_PAIR_OPERANDS } from '../cadSketchOperandSignatures';
import type { CadSketchOfferContext, CadSketchRefusal, CadSketchRelationDefinition } from '../cadSketchRelationTypes';
import type { CadSketchGraphSelection } from '../../cadSketchGraphSelection';
import { CAD_SKETCH_POINT_PAIR_OPERANDS, LINE_SLOT, POINT_SLOT, chainedPair, refusal, sortedIds } from './kindParts';

// Directions: a line, or two points, level or upright, and two lines that keep one direction, a right angle or one line between them.

type Line = Extract<CadSketchGraphEntity, { kind: 'line' }>;
// A line aligns its own ends; two points align with each other.
const LINE_EACH = { slots: [LINE_SLOT], expand: 'each' } as const;
const POINT_PAIR = { slots: [POINT_SLOT, POINT_SLOT], unordered: [[0, 1]] } as const;
const lineEnds = ({ entity }: CadSketchOfferContext, [pick]: readonly CadSketchGraphSelection[]) => {
  const line = entity(pick.id) as Line;
  return [line.startPointId, line.endPointId] as const;
};
// Points joined in one place cannot align with each other.
const joined = ({ identity }: CadSketchOfferContext, { pointIds: [a, b] }: { readonly pointIds: readonly [string, string] }): CadSketchRefusal | undefined =>
  identity(a) === identity(b) ? refusal('invalid-sketch-alignment', 'These points are already joined.') : undefined;

export const horizontal: CadSketchRelationDefinition<'horizontal'> = {
  kind: 'horizontal', family: 'orientation', name: 'Horizontal',
  stored: CAD_SKETCH_POINT_PAIR_OPERANDS,
  operands: relation => relation.pointIds,
  withOperands: (relation, [first, second]) => ({ ...relation, pointIds: [first, second] }),
  key: relation => `horizontal ${sortedIds(relation.pointIds)}`,
  offers: [
    { signature: LINE_EACH, build: (context, picks) => ({ kind: 'horizontal', pointIds: lineEnds(context, picks) }) },
    { signature: POINT_PAIR, build: (_, [a, b]) => ({ kind: 'horizontal', pointIds: [a.id, b.id] }), refuse: joined }
  ],
  agent: { exposed: true, summary: 'Two points, such as the ends of a line, stay level.' }
};
export const vertical: CadSketchRelationDefinition<'vertical'> = {
  kind: 'vertical', family: 'orientation', name: 'Vertical',
  stored: CAD_SKETCH_POINT_PAIR_OPERANDS,
  operands: relation => relation.pointIds,
  withOperands: (relation, [first, second]) => ({ ...relation, pointIds: [first, second] }),
  key: relation => `vertical ${sortedIds(relation.pointIds)}`,
  offers: [
    { signature: LINE_EACH, build: (context, picks) => ({ kind: 'vertical', pointIds: lineEnds(context, picks) }) },
    { signature: POINT_PAIR, build: (_, [a, b]) => ({ kind: 'vertical', pointIds: [a.id, b.id] }), refuse: joined }
  ],
  agent: { exposed: true, summary: 'Two points, such as the ends of a line, stay upright.' }
};

const LINE_PAIR = chainedPair(LINE_SLOT);
export const parallel: CadSketchRelationDefinition<'parallel'> = {
  kind: 'parallel', family: 'orientation', name: 'Parallel',
  stored: CAD_SKETCH_LINE_PAIR_OPERANDS,
  operands: relation => relation.lineIds,
  withOperands: (relation, [first, second]) => ({ ...relation, lineIds: [first, second] }),
  key: relation => `parallel ${sortedIds(relation.lineIds)}`,
  offers: [{ signature: LINE_PAIR, build: (_, [a, b]) => ({ kind: 'parallel', lineIds: [a.id, b.id] }) }],
  agent: { exposed: true, summary: 'Two lines keep the same direction.' }
};
export const perpendicular: CadSketchRelationDefinition<'perpendicular'> = {
  kind: 'perpendicular', family: 'orientation', name: 'Perpendicular',
  stored: CAD_SKETCH_LINE_PAIR_OPERANDS,
  operands: relation => relation.lineIds,
  withOperands: (relation, [first, second]) => ({ ...relation, lineIds: [first, second] }),
  key: relation => `perpendicular ${sortedIds(relation.lineIds)}`,
  offers: [{ signature: LINE_PAIR, build: (_, [a, b]) => ({ kind: 'perpendicular', lineIds: [a.id, b.id] }) }],
  agent: { exposed: true, summary: 'Two lines meet at a right angle.' }
};
export const collinear: CadSketchRelationDefinition<'collinear'> = {
  kind: 'collinear', family: 'orientation', name: 'Collinear',
  stored: CAD_SKETCH_LINE_PAIR_OPERANDS,
  operands: relation => relation.lineIds,
  withOperands: (relation, [first, second]) => ({ ...relation, lineIds: [first, second] }),
  key: relation => `collinear ${sortedIds(relation.lineIds)}`,
  offers: [{ signature: LINE_PAIR, build: (_, [a, b]) => ({ kind: 'collinear', lineIds: [a.id, b.id] }) }],
  agent: { exposed: true, summary: 'Two lines lie on one infinite line.' }
};
