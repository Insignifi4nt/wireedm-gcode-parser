import type { CadEdit } from '@/domain/cad/cadOperations';
import { CadSketchTrimDependencyError, prepareCadSketchEndTrim, type CadSketchEndTrimPreparation } from '@/domain/cad/cadSketchTrimExtend';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { nearestPointOnSegment } from '@/domain/path-editor/pathPointInference';
import type { PathSegment } from '@/domain/path-intel/types';
import type { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import type { SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { describeCadSketchConstraintSource } from './cadSketchConstraintFeedback';

export type CadSketchTrimPreview = { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'ready'; readonly edit: Extract<CadEdit, { kind: 'trim-sketch-entity' }>;
      readonly geometry: CadSketchEndTrimPreparation; readonly help: string };

/** The pinned analytic query supplies both the visible removal and the submitted witness. */
export function prepareCadSketchTrimPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, cursor: SketchPoint): CadSketchTrimPreview {
  const segment = prepared.geometry.segments.find(segment => segment.id === entityId);
  if (!segment || segment.kind === 'circle') return { kind: 'unavailable', reason: 'Trim supports a line or open arc. Trimming a circle needs two cut locations.' };
  const parameter = nearestPointOnSegment(segment, { segmentId: entityId, reversed: false }, { x: cursor[0], y: cursor[1] }).t;
  try {
    const geometry = prepareCadSketchEndTrim({ graph: prepared.graph, parameters: prepared.parameters, entityId, parameter });
    const target = geometry.target, trim = target.kind === 'delete' ? target : { ...target, cutPointId: target.boundary.endpointPointId ?? crypto.randomUUID() };
    const help = target.kind === 'delete' ? 'No cutting boundary. Trim removes this whole edge and retains its original points.'
      : target.boundary.endpointPointId ? 'Trim to the highlighted boundary endpoint and share that exact point.'
        : 'Intersection cut: a one-time numeric endpoint. It will not follow later changes to the cutting edge.';
    return { kind: 'ready', edit: { kind: 'trim-sketch-entity', sketchId, trim }, geometry, help };
  } catch (cause) {
    if (cause instanceof CadSketchTrimDependencyError) {
      const sources = [...cause.relationIds.map(id => ({ kind: 'relation' as const, id })), ...cause.pointIds.map(id => ({ kind: 'point' as const, id }))];
      const labels = sources.slice(0, 3).map(source => describeCadSketchConstraintSource(prepared.graph, source).label), omitted = sources.length - labels.length;
      return { kind: 'unavailable', reason: `${cause.message} ${labels.join('; ')}${omitted ? `; ${omitted} more` : ''}` };
    }
    return { kind: 'unavailable', reason: cause instanceof Error ? cause.message : 'This edge cannot be trimmed here.' };
  }
}

function Stroke({ segment, center, className }: { segment: PathSegment; center: SketchPoint; className: string }) {
  const boundary = cadSketchGraphBoundary(segment);
  return boundary.type === 'line' ? <line className={className} x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]}
    x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
    : boundary.type === 'arc' ? <path className={className} d={cadArcSvgPath(boundary, center)} />
      : <circle className={className} cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />;
}

export function CadSketchTrimPreview({ preview, center, mmPerPixel }: {
  preview: Extract<CadSketchTrimPreview, { kind: 'ready' }>; center: SketchPoint; mmPerPixel: number;
}) {
  const { removed, survivor, boundary, point } = preview.geometry, trim = preview.edit.trim;
  return <g className="cad-sketch-trim-preview" pointerEvents="none" aria-label="Trim preview">
    <title>{preview.help}</title>
    {boundary && <Stroke segment={boundary} center={center} className="is-boundary" />}
    {survivor && <Stroke segment={survivor} center={center} className="is-retained" />}
    <Stroke segment={removed} center={center} className="is-removed" />
    {point && trim.kind === 'end' && <circle className="is-cut" data-cad-sketch-trim-point={trim.cutPointId}
      cx={point[0] - center[0]} cy={point[1] - center[1]} r={4 * mmPerPixel} />}
  </g>;
}
