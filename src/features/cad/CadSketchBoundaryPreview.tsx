import type { CadEdit } from '@/domain/cad/cadOperations';
import { CadSketchExtendDependencyError, CadSketchTrimDependencyError, cadSketchCircleTrimParameter, prepareCadSketchTrim, prepareCadSketchLineExtend,
  type CadSketchTrimPreparation, type CadSketchLineExtendPreparation } from '@/domain/cad/cadSketchTrimExtend';
import { cadSketchGraphBoundary } from '@/domain/cad/compileCadSketchGeometry';
import { nearestPointOnSegment } from '@/domain/path-editor/pathPointInference';
import type { PathSegment } from '@/domain/path-intel/types';
import type { prepareCadSketchGraphInteraction } from './cadSketchGraphInteraction';
import type { SketchPoint } from './cadSketchInteraction';
import { cadArcSvgPath } from './cadSketchSvg';
import { describeCadSketchConstraintSource } from './cadSketchConstraintFeedback';

type Unavailable = { readonly kind: 'unavailable'; readonly reason: string };
export type CadSketchTrimPreview = Unavailable
  | { readonly kind: 'ready'; readonly edit: Extract<CadEdit, { kind: 'trim-sketch-entity' }>;
      readonly geometry: CadSketchTrimPreparation; readonly help: string };
export type CadSketchExtendPreview = { readonly label: string } & (Unavailable
  | { readonly kind: 'ready'; readonly edit: Extract<CadEdit, { kind: 'extend-sketch-entity' }>;
      readonly geometry: CadSketchLineExtendPreparation; readonly help: string });

function unavailable(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, cause: unknown, fallback: string): Unavailable {
  if (cause instanceof CadSketchTrimDependencyError || cause instanceof CadSketchExtendDependencyError) {
    const sources = [...cause.relationIds.map(id => ({ kind: 'relation' as const, id })), ...cause.pointIds.map(id => ({ kind: 'point' as const, id }))];
    const labels = sources.slice(0, 3).map(source => describeCadSketchConstraintSource(prepared.graph, source).label), omitted = sources.length - labels.length;
    return { kind: 'unavailable', reason: `${cause.message} ${labels.join('; ')}${omitted ? `; ${omitted} more` : ''}` };
  }
  return { kind: 'unavailable', reason: cause instanceof Error ? cause.message : fallback };
}

function contactHelp(boundary: { readonly endpointPointId?: string }, action: 'Trim' | 'Extend'): string {
  return boundary.endpointPointId ? `${action} to the highlighted boundary endpoint and share that exact point.`
    : 'Intersection cut: a one-time numeric endpoint. It will not follow later changes to the cutting edge.';
}

/** The pinned analytic query supplies both the visible removal and the submitted witness. */
export function prepareCadSketchTrimPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, cursor: SketchPoint): CadSketchTrimPreview {
  const segment = prepared.geometry.segments.find(segment => segment.id === entityId);
  if (!segment) return { kind: 'unavailable', reason: 'The selected edge no longer exists.' };
  const parameter = segment.kind === 'circle' ? cadSketchCircleTrimParameter(segment, { x: cursor[0], y: cursor[1] })
    : nearestPointOnSegment(segment, { segmentId: entityId, reversed: false }, { x: cursor[0], y: cursor[1] }).t;
  if (parameter === null) return { kind: 'unavailable', reason: 'Right-click the circle span you want to remove.' };
  try {
    const geometry = prepareCadSketchTrim({ graph: prepared.graph, parameters: prepared.parameters, entityId, parameter });
    const target = geometry.target, trim = target.kind === 'delete' ? target : target.kind === 'end'
      ? { ...target, cutPointId: target.boundary.endpointPointId ?? crypto.randomUUID() }
      : target.kind === 'circle' ? { ...target, cutPointIds: [target.boundaries[0].endpointPointId ?? crypto.randomUUID(), target.boundaries[1].endpointPointId ?? crypto.randomUUID()] as const }
      : { ...target, cutPointIds: [target.boundaries[0].endpointPointId ?? crypto.randomUUID(), target.boundaries[1].endpointPointId ?? crypto.randomUUID()] as const,
        newEntityId: crypto.randomUUID(), supportRelationId: crypto.randomUUID() };
    const help = target.kind === 'delete' ? 'No cutting boundary. Trim removes this whole edge and retains its original points.'
      : target.kind === 'end' ? contactHelp(target.boundary, 'Trim') : target.kind === 'circle'
        ? 'Remove the highlighted circle span and keep its complementary arc. ' + (target.boundaries.every(boundary => boundary.endpointPointId)
          ? 'Both cuts share their boundary endpoints.' : target.boundaries.some(boundary => boundary.endpointPointId)
            ? 'One cut shares a boundary endpoint; the other is a numeric contact without attachment.' : 'Both cuts are numeric contacts without attachment.') + ' No radius constraint is added.'
        : target.boundaries.map((boundary, index) =>
        `${index ? 'End-side' : 'Start-side'} cut: ${boundary.endpointPointId ? 'shared boundary endpoint' : 'one-time numeric contact, no attachment'}.`).join(' ')
        + ' Both survivors keep a Collinear relation.';
    return { kind: 'ready', edit: { kind: 'trim-sketch-entity', sketchId, trim }, geometry, help };
  } catch (cause) {
    return unavailable(prepared, cause, 'This edge cannot be trimmed here.');
  }
}

/** The pointer chooses an explicit source end; the analytic ray query chooses its finite boundary. */
export function prepareCadSketchExtendPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, cursor: SketchPoint): CadSketchExtendPreview {
  const segment = prepared.geometry.segments.find(segment => segment.id === entityId);
  if (!segment || segment.kind !== 'line') return { kind: 'unavailable', label: 'Extend', reason: 'Extend supports a line endpoint. Arc and circle extension are not supported yet.' };
  const parameter = nearestPointOnSegment(segment, { segmentId: entityId, reversed: false }, { x: cursor[0], y: cursor[1] }).t;
  if (parameter === .5) return { kind: 'unavailable', label: 'Extend', reason: 'Right-click nearer the end you want to extend.' };
  return prepareCadSketchExtendEndPreview(prepared, sketchId, entityId, parameter < .5 ? 'start' : 'end');
}

/** Keyboard actions own the source line and an explicit end, without a pointer parameter. */
export function prepareCadSketchExtendEndPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, end: 'start' | 'end'): CadSketchExtendPreview {
  const label = `Extend ${end}`;
  try {
    const geometry = prepareCadSketchLineExtend({ graph: prepared.graph, parameters: prepared.parameters, entityId, end });
    const extend = { ...geometry.target, endPointId: geometry.target.boundary.endpointPointId ?? crypto.randomUUID() };
    return { kind: 'ready', label, edit: { kind: 'extend-sketch-entity', sketchId, extend }, geometry, help: contactHelp(extend.boundary, 'Extend') };
  } catch (cause) { return { ...unavailable(prepared, cause, 'This line cannot be extended from this end.'), label }; }
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
  const geometry = preview.geometry, trim = preview.edit.trim;
  const survivors = 'survivors' in geometry ? geometry.survivors : geometry.survivor ? [geometry.survivor] : [];
  const cuts = 'cuts' in geometry ? geometry.cuts : geometry.boundary && geometry.point ? [{ boundary: geometry.boundary, point: geometry.point }] : [];
  const cutPointIds = 'cutPointIds' in trim ? trim.cutPointIds : trim.kind === 'end' ? [trim.cutPointId] : [];
  return <g className="cad-sketch-trim-preview" pointerEvents="none" aria-label="Trim preview">
    <title>{preview.help}</title>
    {cuts.map((cut, index) => <Stroke key={index} segment={cut.boundary} center={center} className="is-boundary" />)}
    {survivors.map((survivor, index) => <Stroke key={index} segment={survivor} center={center} className="is-retained" />)}
    <Stroke segment={geometry.removed} center={center} className="is-removed" />
    {cuts.map((cut, index) => <circle key={index} className="is-cut" data-cad-sketch-trim-point={cutPointIds[index]}
      cx={cut.point[0] - center[0]} cy={cut.point[1] - center[1]} r={4 * mmPerPixel} />)}
  </g>;
}

export function CadSketchExtendPreview({ preview, center, mmPerPixel }: {
  preview: Extract<CadSketchExtendPreview, { kind: 'ready' }>; center: SketchPoint; mmPerPixel: number;
}) {
  const { added, extended, boundary, point } = preview.geometry;
  return <g className="cad-sketch-trim-preview" pointerEvents="none" aria-label="Extend preview">
    <title>{preview.help}</title>
    <Stroke segment={boundary} center={center} className="is-boundary" />
    <Stroke segment={extended} center={center} className="is-retained" />
    <Stroke segment={added} center={center} className="is-added" />
    <circle className="is-cut" data-cad-sketch-extend-point={preview.edit.extend.endPointId}
      cx={point[0] - center[0]} cy={point[1] - center[1]} r={4 * mmPerPixel} />
  </g>;
}
