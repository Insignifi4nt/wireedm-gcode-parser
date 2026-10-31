import { userFacingMessage } from '@/lib/userMessage';
import type { CadEdit } from '@/domain/cad/cadOperations';
import { CadSketchExtendDependencyError, CadSketchTrimDependencyError, cadSketchCircleTrimParameter, prepareCadSketchTrim, prepareCadSketchExtend,
  type CadSketchTrimAttachment, type CadSketchTrimPreparation, type CadSketchExtendPreparation } from '@/domain/cad/cadSketchTrimExtend';
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
      readonly geometry: CadSketchExtendPreparation; readonly help: string });

function unavailable(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, cause: unknown, fallback: string): Unavailable {
  if (cause instanceof CadSketchTrimDependencyError || cause instanceof CadSketchExtendDependencyError) {
    const sources = [...cause.relationIds.map(id => ({ kind: 'relation' as const, id })), ...cause.pointIds.map(id => ({ kind: 'point' as const, id }))];
    const labels = sources.slice(0, 3).map(source => describeCadSketchConstraintSource(prepared.graph, source).label), omitted = sources.length - labels.length;
    return { kind: 'unavailable', reason: `${cause.message} ${labels.join('; ')}${omitted ? `; ${omitted} more` : ''}` };
  }
  return { kind: 'unavailable', reason: userFacingMessage(cause, fallback) };
}

function contactHelp(boundary: { readonly endpointPointId?: string }, action: 'Trim' | 'Extend'): string {
  return boundary.endpointPointId ? `${action} to the highlighted boundary endpoint and share that exact point.`
    : 'Intersection cut: a one-time numeric endpoint. It will not follow later changes to the cutting edge.';
}

/** How one cut joins its boundary: an existing endpoint, or a new point kept on the cutting line or curve. */
function cutHelp(boundary: { readonly endpointPointId?: string }, attachment: CadSketchTrimAttachment | null): string {
  return boundary.endpointPointId ? 'shares the boundary endpoint' : attachment?.kind === 'point-on-curve' ? 'stays on the cutting curve' : 'stays on the cutting line';
}

/** Relations that only described the removed piece leave with it; name the first few. */
function removalHelp(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, relationIds: readonly string[] | undefined): string {
  if (!relationIds?.length) return '';
  const labels = relationIds.slice(0, 3).map(id => describeCadSketchConstraintSource(prepared.graph, { kind: 'relation', id }).label);
  const omitted = relationIds.length - labels.length;
  return ` Also removes ${labels.join('; ')}${omitted ? `; ${omitted} more` : ''}.`;
}

const attachments = (cuts: readonly [CadSketchTrimAttachment | null, CadSketchTrimAttachment | null]) => cuts.some(Boolean)
  ? { attachRelationIds: [cuts[0] ? crypto.randomUUID() : null, cuts[1] ? crypto.randomUUID() : null] as [string | null, string | null] } : {};

/** The pinned analytic query supplies both the visible removal and the submitted witness. */
export function prepareCadSketchTrimPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, cursor: SketchPoint): CadSketchTrimPreview {
  const segment = prepared.geometry.segments.find(segment => segment.id === entityId);
  if (!segment) return { kind: 'unavailable', reason: 'The selected edge no longer exists.' };
  const parameter = segment.kind === 'circle' ? cadSketchCircleTrimParameter(segment, { x: cursor[0], y: cursor[1] })
    : nearestPointOnSegment(segment, { segmentId: entityId, reversed: false }, { x: cursor[0], y: cursor[1] }).t;
  if (parameter === null) return { kind: 'unavailable', reason: 'Point at the circle span you want to remove.' };
  try {
    const geometry = prepareCadSketchTrim({ graph: prepared.graph, parameters: prepared.parameters, entityId, parameter });
    const target = geometry.target, removed = removalHelp(prepared, target.removedRelationIds);
    if (target.kind === 'delete') return { kind: 'ready', edit: { kind: 'trim-sketch-entity', sketchId, trim: target }, geometry,
      help: `No cutting boundary. Trim removes this whole edge.${removed}` };
    if (target.kind === 'end' && 'attachment' in geometry) return { kind: 'ready', edit: { kind: 'trim-sketch-entity', sketchId, trim: { ...target,
      cutPointId: target.boundary.endpointPointId ?? crypto.randomUUID(), ...(geometry.attachment ? { attachRelationId: crypto.randomUUID() } : {}) } },
    geometry, help: `Trim to the highlighted boundary. The cut ${cutHelp(target.boundary, geometry.attachment)}.${removed}` };
    if (target.kind === 'end' || !('attachments' in geometry)) throw new Error('Trim preparation changed shape.');
    const cutPointIds = [target.boundaries[0].endpointPointId ?? crypto.randomUUID(), target.boundaries[1].endpointPointId ?? crypto.randomUUID()] as const;
    const [first, second] = target.boundaries.map((boundary, index) => cutHelp(boundary, geometry.attachments[index]));
    if (target.kind === 'circle') return { kind: 'ready', edit: { kind: 'trim-sketch-entity', sketchId, trim: { ...target, cutPointIds,
      ...attachments(geometry.attachments) } }, geometry,
    help: `Remove the highlighted circle span and keep its complementary arc. One cut ${first}; the other ${second}. No radius constraint is added.${removed}` };
    return { kind: 'ready', edit: { kind: 'trim-sketch-entity', sketchId, trim: { ...target, cutPointIds, newEntityId: crypto.randomUUID(),
      supportRelationId: crypto.randomUUID(), ...attachments(geometry.attachments) } }, geometry,
    help: `The start-side cut ${first}; the end-side cut ${second}.`
      + (segment.kind === 'arc' ? ' Both survivors share their center and keep an Equal radius relation.' : ' Both survivors keep a Collinear relation.') + removed };
  } catch (cause) {
    return unavailable(prepared, cause, 'This edge cannot be trimmed here.');
  }
}

/** The pointer chooses an explicit source end; the analytic query chooses its finite boundary. */
export function prepareCadSketchExtendPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, cursor: SketchPoint): CadSketchExtendPreview {
  const segment = prepared.geometry.segments.find(segment => segment.id === entityId);
  if (!segment || segment.kind === 'circle') return { kind: 'unavailable', label: 'Extend', reason: 'Extend needs the end of a line or arc.' };
  const parameter = nearestPointOnSegment(segment, { segmentId: entityId, reversed: false }, { x: cursor[0], y: cursor[1] }).t;
  if (parameter === .5) return { kind: 'unavailable', label: 'Extend', reason: 'Right-click nearer the end you want to extend.' };
  return prepareCadSketchExtendEndPreview(prepared, sketchId, entityId, parameter < .5 ? 'start' : 'end');
}

/** Keyboard actions own the source edge and an explicit end, without a pointer parameter. */
export function prepareCadSketchExtendEndPreview(prepared: ReturnType<typeof prepareCadSketchGraphInteraction>, sketchId: string,
  entityId: string, end: 'start' | 'end'): CadSketchExtendPreview {
  const label = `Extend ${end}`;
  try {
    const geometry = prepareCadSketchExtend({ graph: prepared.graph, parameters: prepared.parameters, entityId, end });
    const extend = { ...geometry.target, endPointId: geometry.target.boundary.endpointPointId ?? crypto.randomUUID() };
    return { kind: 'ready', label, edit: { kind: 'extend-sketch-entity', sketchId, extend }, geometry, help: contactHelp(extend.boundary, 'Extend') };
  } catch (cause) { return { ...unavailable(prepared, cause, 'This edge cannot be extended from this end.'), label }; }
}

function Stroke({ segment, center, className }: { segment: PathSegment; center: SketchPoint; className: string }) {
  const boundary = cadSketchGraphBoundary(segment);
  return boundary.type === 'line' ? <line className={className} x1={boundary.start.x - center[0]} y1={boundary.start.y - center[1]}
    x2={boundary.end.x - center[0]} y2={boundary.end.y - center[1]} />
    : boundary.type === 'arc' ? <path className={className} d={cadArcSvgPath(boundary, center)} />
      : <circle className={className} cx={boundary.center.x - center[0]} cy={boundary.center.y - center[1]} r={boundary.radius} />;
}

/**
 * The strokes of a trim, extend or split preview, each with its role class. Outlined, over a part shown plainly behind the sketch,
 * every stroke first gets a dark under-stroke with the same role and dashes, all beneath the strokes so none cuts a neighbour.
 */
export function CadSketchPreviewStrokes({ strokes, center, outlined }: {
  strokes: readonly (readonly [segment: PathSegment, className: string])[]; center: SketchPoint; outlined: boolean;
}) {
  return <>
    {outlined && strokes.map(([segment, className], index) => <Stroke key={`halo-${index}`} segment={segment} center={center} className={`${className} cad-sketch-halo`} />)}
    {strokes.map(([segment, className], index) => <Stroke key={index} segment={segment} center={center} className={className} />)}
  </>;
}

export function CadSketchTrimPreview({ preview, center, mmPerPixel, outlined = false }: {
  preview: Extract<CadSketchTrimPreview, { kind: 'ready' }>; center: SketchPoint; mmPerPixel: number; outlined?: boolean;
}) {
  const geometry = preview.geometry, trim = preview.edit.trim;
  const survivors = 'survivors' in geometry ? geometry.survivors : geometry.survivor ? [geometry.survivor] : [];
  const cuts = 'cuts' in geometry ? geometry.cuts : geometry.boundary && geometry.point ? [{ boundary: geometry.boundary, point: geometry.point }] : [];
  const cutPointIds = 'cutPointIds' in trim ? trim.cutPointIds : trim.kind === 'end' ? [trim.cutPointId] : [];
  return <g className="cad-sketch-trim-preview" pointerEvents="none" aria-label="Trim preview">
    <title>{preview.help}</title>
    <CadSketchPreviewStrokes center={center} outlined={outlined} strokes={[...cuts.map(cut => [cut.boundary, 'is-boundary'] as const),
      ...survivors.map(survivor => [survivor, 'is-retained'] as const), [geometry.removed, 'is-removed']]} />
    {cuts.map((cut, index) => <circle key={index} className="is-cut" data-cad-sketch-trim-point={cutPointIds[index]}
      cx={cut.point[0] - center[0]} cy={cut.point[1] - center[1]} r={4 * mmPerPixel} />)}
  </g>;
}

export function CadSketchExtendPreview({ preview, center, mmPerPixel, outlined = false }: {
  preview: Extract<CadSketchExtendPreview, { kind: 'ready' }>; center: SketchPoint; mmPerPixel: number; outlined?: boolean;
}) {
  const { added, extended, boundary, point } = preview.geometry;
  return <g className="cad-sketch-trim-preview" pointerEvents="none" aria-label="Extend preview">
    <title>{preview.help}</title>
    <CadSketchPreviewStrokes center={center} outlined={outlined} strokes={[[boundary, 'is-boundary'], [extended, 'is-retained'], [added, 'is-added']]} />
    <circle className="is-cut" data-cad-sketch-extend-point={preview.edit.extend.endPointId}
      cx={point[0] - center[0]} cy={point[1] - center[1]} r={4 * mmPerPixel} />
  </g>;
}
