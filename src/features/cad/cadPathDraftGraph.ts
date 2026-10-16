import { CadError } from '@/domain/cad/cadError';
import { copyCadConstructionPoint, createCadThreePointArc, MAX_CAD_PATH_CONSTRUCTION_EDGES, type CadConstructionPoint } from '@/domain/cad/cadPathConstruction';
import { checkCadSketchGraph, parseCadSketchGraph, type CadSketchGraph, type CadSketchGraphEntity, type CadSketchGraphPoint } from '@/domain/cad/cadSketchGraph';
import type { CadPathDraft } from './cadPathDrawing';

function samePoint(a: CadConstructionPoint, b: CadConstructionPoint): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/**
 * Compile live authored joints, never recover topology from encoded profile samples.
 * Only a closed chain's final exact return shares its start ID. Other visits stay distinct.
 */
export function createCadPathDraftGraph({ draft, closed, construction, createId }: {
  readonly draft: CadPathDraft;
  readonly closed: boolean;
  readonly construction: boolean;
  readonly createId: () => string;
}): CadSketchGraph {
  if (draft.kind === 'arc-through') throw new CadError('incomplete-arc', 'Finish the arc through point before accepting its graph.');
  if (draft.kind === 'idle' || !draft.segments.length) throw new CadError('empty-path', 'Draw at least one segment before accepting its graph.');
  const last = draft.segments[draft.segments.length - 1], needsClosing = closed && !samePoint(last.end, draft.start);
  if (draft.segments.length + Number(needsClosing) > MAX_CAD_PATH_CONSTRUCTION_EDGES)
    throw new CadError('construction-limit', 'A path can contain at most 2048 edges including its closing edge.');
  const points: CadSketchGraphPoint[] = [], entities: CadSketchGraphEntity[] = [];
  function point(position: CadConstructionPoint) {
    const value = { id: createId(), position: copyCadConstructionPoint(position) };
    points.push(value); return value;
  }
  const first = point(draft.start);
  let current = first;
  for (let index = 0; index < draft.segments.length; index++) {
    const segment = draft.segments[index];
    const end = closed && index === draft.segments.length - 1 && samePoint(segment.end, draft.start) ? first : point(segment.end);
    if (segment.kind === 'line') {
      if (!samePoint(segment.start, current.position)) throw new CadError('discontinuous-path-draft', 'A path line must start at its preceding authored endpoint.');
      entities.push({ id: createId(), kind: 'line', construction, startPointId: current.id, endPointId: end.id });
    } else {
      // Recheck the original constructor's precision gate without replacing the live support.
      const checked = createCadThreePointArc({ start: current.position, end: segment.end, through: segment.through });
      if (!samePoint(checked.center, segment.center) || checked.radius !== segment.radius
          || checked.startAngle !== segment.startAngle || checked.sweep !== segment.sweep)
        throw new CadError('invalid-path-draft-arc', 'The live arc support must match its authored start, end and through points.');
      const center = point(segment.center);
      entities.push({ id: createId(), kind: 'arc', construction, centerPointId: center.id, startPointId: current.id,
        endPointId: end.id, direction: segment.sweep < 0 ? 'cw' : 'ccw' });
    }
    current = end;
  }
  if (needsClosing) entities.push({ id: createId(), kind: 'line', construction, startPointId: current.id, endPointId: first.id });
  const graph = parseCadSketchGraph({ points, entities, relations: [] }), issue = checkCadSketchGraph(graph, {})[0];
  if (issue) throw new CadError('invalid-path-draft-graph', `${issue.source.id}: ${issue.message}`);
  return graph;
}
