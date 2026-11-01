import type { CadScalar } from '../cadDocument';
import { CadError } from '../cadError';
import type { CadSketchGraph } from '../cadSketchGraph';
import type { CadSketchRelationIntent } from './cadSketchRelationTypes';
import { CAD_SKETCH_ORIGIN_ID, cadSketchAxisNormal, cadSketchVirtualSubject, isCadSketchVirtualAxisId, type CadSketchVirtualAxisId, type CadSketchVirtualId } from './cadSketchVirtualElements';

// A condition on the origin or an axis that an existing kind already keeps is stored as that kind, so a sketch holds one form of it:
// the planner plans that form, keys and "already applied" find it, and a parse refuses the other. Only conditions no kind keeps, such
// as a mirror about an axis or a distance from the origin, are stored with the origin or an axis as an operand. Like the signatures,
// this module imports nothing that imports the sketch graph.

type Axis = 'x' | 'y';
/**
 * How an existing kind keeps a condition on the origin or an axis: coordinates held at a value, as a point at the origin, on an axis,
 * level with the origin, mirroring the origin about an axis or at a set distance from either is; or a line kept level or upright, as one parallel or square to an axis is.
 */
export type CadSketchCanonicalForm =
  | { readonly kind: 'hold'; readonly pointIds: readonly string[]; readonly axes: readonly Axis[]; readonly value: CadScalar; readonly target: CadSketchVirtualId;
    /** The line whose ends are held, for a line on an axis. */
    readonly lineId?: string }
  | { readonly kind: 'align'; readonly align: 'horizontal' | 'vertical'; readonly pair: readonly [string, string]; readonly target: CadSketchVirtualAxisId };

const negated = (value: CadScalar): CadScalar => typeof value === 'number' ? (value === 0 ? 0 : -value) : `-(${value})`;
/** The other id of a pair that names `virtual` once, or undefined. */
function besides(ids: readonly [string, string], virtual: (id: string) => boolean): readonly [string, string] | undefined {
  return virtual(ids[0]) && !virtual(ids[1]) ? [ids[1], ids[0]] : virtual(ids[1]) && !virtual(ids[0]) ? [ids[0], ids[1]] : undefined;
}
const isOrigin = (id: string) => id === CAD_SKETCH_ORIGIN_ID;
const hold = (pointIds: readonly string[], axes: readonly Axis[], value: CadScalar, target: CadSketchVirtualId): CadSketchCanonicalForm => ({ kind: 'hold', pointIds, axes, value, target });

/**
 * The form the sketch stores the relation in, when it names the origin or an axis and another kind keeps what it holds; null when it
 * is stored as it is. A line is read from the graph for its ends, and a line the graph lacks gives null, for the operand checks to refuse.
 */
export function cadSketchCanonicalForm(graph: CadSketchGraph, relation: CadSketchRelationIntent): CadSketchCanonicalForm | null {
  switch (relation.kind) {
    case 'coincident': case 'horizontal': case 'vertical': {
      const pair = besides(relation.pointIds, isOrigin);
      return pair ? hold([pair[0]], relation.kind === 'coincident' ? ['x', 'y'] : [relation.kind === 'horizontal' ? 'y' : 'x'], 0, CAD_SKETCH_ORIGIN_ID) : null;
    }
    case 'point-on-line':
      return isCadSketchVirtualAxisId(relation.lineId) ? hold([relation.pointId], [cadSketchAxisNormal(relation.lineId)], 0, relation.lineId) : null;
    case 'axis-distance': {
      // The second point's coordinate less the first's is the value, so a point measured to the origin is held at its negation.
      const pair = besides(relation.pointIds, isOrigin);
      return pair ? hold([pair[0]], [relation.axis], relation.pointIds[1] === pair[0] ? relation.value : negated(relation.value), CAD_SKETCH_ORIGIN_ID) : null;
    }
    case 'point-line-distance': {
      // Signed to the left of the axis as it runs from the origin: +Y of the H axis and -X of the V axis.
      if (!isCadSketchVirtualAxisId(relation.lineId)) return null;
      const across = cadSketchAxisNormal(relation.lineId), left = (relation.side === 'left') === (across === 'y');
      return hold([relation.pointId], [across], left ? relation.value : negated(relation.value), relation.lineId);
    }
    case 'symmetric': {
      // Only the origin mirrors the origin about an axis through it. Mirrored curves are stored, so none is the origin or an axis.
      if (!('pointIds' in relation)) return null;
      const pair = besides(relation.pointIds, isOrigin);
      return pair && isCadSketchVirtualAxisId(relation.lineId) ? hold([pair[0]], ['x', 'y'], 0, CAD_SKETCH_ORIGIN_ID) : null;
    }
    case 'parallel': case 'perpendicular': case 'collinear': {
      const pair = besides(relation.lineIds, isCadSketchVirtualAxisId), line = pair && graph.entities.find(entity => entity.id === pair[0]);
      if (!pair || line?.kind !== 'line') return null;
      const axis = pair[1] as CadSketchVirtualAxisId, across = cadSketchAxisNormal(axis), ends = [line.startPointId, line.endPointId] as const;
      if (relation.kind === 'collinear') return { kind: 'hold', pointIds: ends, axes: [across], value: 0, target: axis, lineId: line.id };
      // A line parallel to the H axis keeps one Y, as a level line does, and one square to it one X.
      const level = (across === 'y') === (relation.kind === 'parallel');
      return { kind: 'align', align: level ? 'horizontal' : 'vertical', pair: ends, target: axis };
    }
    default: return null;
  }
}

/** The relations that store a canonical form: a fixed axis for each held coordinate, or one level or upright pair. */
export function cadSketchCanonicalRelations(form: CadSketchCanonicalForm): readonly CadSketchRelationIntent[] {
  if (form.kind === 'align') return [{ kind: form.align, pointIds: form.pair }];
  return form.pointIds.flatMap(pointId => form.axes.map(axis => ({ kind: 'fixed-axis' as const, pointId, axis, value: form.value })));
}

/** The parse error for a relation stored in another form than its canonical one, naming the relations that store it. */
export function cadSketchCanonicalRefusal(relation: { readonly id: string; readonly kind: string }, form: CadSketchCanonicalForm): CadError {
  const kept = form.kind === 'align' ? `a ${form.align} relation on the line's ends "${form.pair[0]}" and "${form.pair[1]}"`
    : `fixed-axis ${form.pointIds.flatMap(pointId => form.axes.map(axis => `${axis} = ${form.value} on "${pointId}"`)).join(', ')}`;
  return new CadError('non-canonical-sketch-relation', `Sketch relation "${relation.id}" (${relation.kind} with ${cadSketchVirtualSubject(form.target)}) is stored as ${kept}.`);
}
