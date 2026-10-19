import { userFacingMessage } from '@/lib/userMessage';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { CadSketchSplitDependencyError, splitCadSketchEntity } from '@/domain/cad/cadSketchSplit';
import { compileCadSketchGraph } from '@/domain/cad/cadSketchGraphGeometry';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { nearestPointOnSegment } from '@/domain/path-editor/pathPointInference';
import type { PathSegment } from '@/domain/path-intel/types';
import type { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import type { SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { describeCadSketchConstraintSource } from './cadSketchConstraintFeedback';

export type CadSketchSplitPreview = { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'ready'; readonly edit: Extract<CadEdit, { kind: 'split-sketch-entity' }>;
      readonly point: SketchPoint; readonly pieces: readonly PathSegment[] };

/** The menu pins one exact source-oriented cut. Rendering never changes that request. */
export function prepareCadSketchSplitPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, cursor: SketchPoint): CadSketchSplitPreview {
  const segment = prepared.geometry.segments.find(segment => segment.id === entityId);
  if (!segment || segment.kind === 'circle') return { kind: 'unavailable', reason: 'Split supports a line or open arc. A circle needs two cut locations.' };
  const parameter = nearestPointOnSegment(segment, { segmentId: entityId, reversed: false }, { x: cursor[0], y: cursor[1] }).t;
  const ids = { entityId, parameter, splitPointId: crypto.randomUUID(), newEntityId: crypto.randomUUID() };
  const split = segment.kind === 'line' ? { ...ids, kind: 'line' as const, supportRelationId: crypto.randomUUID() }
    : { ...ids, kind: 'arc' as const };
  try {
    const result = splitCadSketchEntity({ graph: prepared.graph, parameters: prepared.parameters, split });
    const geometry = compileCadSketchGraph(result.graph, prepared.parameters);
    const point = result.graph.points.find(point => point.id === split.splitPointId);
    // The constructor's numeric joint owns both the marker and edit.
    if (!point || typeof point.position[0] !== 'number' || typeof point.position[1] !== 'number') throw new Error('The split point is unavailable.');
    return { kind: 'ready', edit: { kind: 'split-sketch-entity', sketchId, split }, point: [point.position[0], point.position[1]],
      pieces: geometry.segments.filter(piece => piece.id === entityId || piece.id === split.newEntityId) };
  } catch (cause) {
    if (cause instanceof CadSketchSplitDependencyError) {
      const labels = cause.relationIds.slice(0, 3).map(id => describeCadSketchConstraintSource(prepared.graph, { kind: 'relation', id }).label);
      const omitted = cause.relationIds.length - labels.length;
      return { kind: 'unavailable', reason: `${cause.message} ${labels.join('; ')}${omitted ? `; ${omitted} more` : ''}` };
    }
    return { kind: 'unavailable', reason: userFacingMessage(cause, 'This edge cannot be split here.') };
  }
}

export function CadSketchSplitPreview({ preview, center, mmPerPixel }: {
  preview: Extract<CadSketchSplitPreview, { kind: 'ready' }>; center: SketchPoint; mmPerPixel: number;
}) {
  return <g className="cad-sketch-split-preview" pointerEvents="none" aria-label="Split preview: both pieces remain">
    {preview.pieces.map(segment => {
      const boundary = cadSketchGraphBoundary(segment), className = segment.id === preview.edit.split.entityId ? 'is-retained' : 'is-new';
      return boundary.type === 'line' ? <line key={segment.id} className={className} x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]}
        x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
        : boundary.type === 'arc' ? <path key={segment.id} className={className} d={cadArcSvgPath(boundary, center)} /> : null;
    })}
    <circle data-cad-sketch-split-point={preview.edit.split.splitPointId} cx={preview.point[0] - center[0]} cy={preview.point[1] - center[1]} r={4 * mmPerPixel}>
      <title>Split point · Both pieces remain</title>
    </circle>
  </g>;
}
