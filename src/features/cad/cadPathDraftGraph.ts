import { CadError } from '@/domain/cad/cadError';
import { createCadFreshSketchDrawing, type CadFreshSketchPick } from '@/domain/cad/cadFreshSketchGraph';
import { createCadThreePointArc, type CadConstructionPoint } from '@/domain/cad/cadPathConstruction';
import type { CadSketchGraph } from '@/domain/cad/cadSketchGraph';
import type { CadPathDraft, CadPathDraftPick } from './cadPathDrawing';

function samePoint(a: CadConstructionPoint, b: CadConstructionPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Compile live authored joints, never recover topology from encoded profile samples.
 * Every drawn point is new: snapped attachments become removable relations, and only
 * consecutive segments and a closed chain's final exact return share a point.
 * Return an append payload that leaves the existing graph unchanged.
 */
export function createCadPathDraftGraph({ draft, closed, construction, createId, existingGraph, parameters = {} }: {
  readonly draft: CadPathDraft;
  readonly closed: boolean;
  readonly construction: boolean;
  readonly createId: () => string;
  readonly existingGraph?: CadSketchGraph;
  readonly parameters?: Readonly<Record<string, number>>;
}): CadSketchGraph {
  if (draft.kind === 'arc-through') throw new CadError('incomplete-arc', 'Finish the arc through point before accepting its graph.');
  if (draft.kind === 'idle' || !draft.segments.length) throw new CadError('empty-path', 'Draw at least one segment before accepting its graph.');
  const pick = (point: CadConstructionPoint, attached: CadPathDraftPick | undefined): CadFreshSketchPick => {
    if (attached && !samePoint(attached.point, point)) throw new CadError('invalid-path-draft-pick', 'A point attachment must keep its drawn position.');
    return attached ?? { kind: 'position', point };
  };
  let current = draft.start;
  const steps = draft.segments.map(segment => {
    if (segment.kind === 'line') {
      if (!samePoint(segment.start, current)) throw new CadError('discontinuous-path-draft', 'A path line must start at its preceding authored endpoint.');
    } else {
      // Recheck the original constructor's precision gate without replacing the live support.
      const checked = createCadThreePointArc({ start: current, end: segment.end, through: segment.through });
      if (!samePoint(checked.center, segment.center) || checked.radius !== segment.radius
          || checked.startAngle !== segment.startAngle || checked.sweep !== segment.sweep)
        throw new CadError('invalid-path-draft-arc', 'The live arc support must match its authored start, end and through points.');
    }
    current = segment.end;
    return segment.kind === 'line' ? { kind: 'line' as const, end: pick(segment.end, segment.endPick) }
      : { kind: 'arc' as const, end: pick(segment.end, segment.endPick), through: segment.through };
  });
  return createCadFreshSketchDrawing({ drawing: { kind: 'polyline', start: pick(draft.start, draft.startPick), steps, closed },
    construction, createId, existingGraph, parameters }).geometry;
}
