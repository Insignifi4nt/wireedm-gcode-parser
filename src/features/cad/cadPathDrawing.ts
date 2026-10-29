import type { CadProfile } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import type { CadFreshSketchInference, CadFreshSketchPick } from '@/domain/cad/cadFreshSketchGraph';
import {
  copyCadConstructionPoint, createCadConstructionLine, createCadOpenCurveSegments, createCadPathProfile, createCadThreePointArc,
  MAX_CAD_PATH_CONSTRUCTION_EDGES, type CadConstructedArc, type CadConstructionPoint, type CadPathConstructionStep
} from '@/domain/cad/cadPathConstruction';
import { cadPathClosureTolerance, type ResolvedCadPathSegment } from '@/domain/cad/cadSketchGeometry';

export type CadPathDrawingMode = 'line' | 'arc';
/** A snap that attaches a draft point to other geometry with a removable relation once the draft is accepted. */
export type CadPathDraftPick = Exclude<CadFreshSketchPick, { kind: 'position' }>;
export type CadPathDraftSegment = ((Extract<ResolvedCadPathSegment, { kind: 'line' }> & { readonly inferred?: CadFreshSketchInference })
  | (CadConstructedArc & { readonly end: CadConstructionPoint; readonly through: CadConstructionPoint })) & { readonly endPick?: CadPathDraftPick };
export type CadPathDraft =
  | { readonly kind: 'idle'; readonly mode: CadPathDrawingMode }
  | { readonly kind: 'ready'; readonly start: CadConstructionPoint; readonly startPick?: CadPathDraftPick; readonly segments: readonly CadPathDraftSegment[]; readonly mode: CadPathDrawingMode }
  | { readonly kind: 'arc-through'; readonly start: CadConstructionPoint; readonly startPick?: CadPathDraftPick; readonly segments: readonly CadPathDraftSegment[]; readonly end: CadConstructionPoint; readonly endPick?: CadPathDraftPick };
export type CadPathDrawingAction =
  /**
   * `pick` attaches the point; an arc's through point only shapes the arc, so its pick is ignored. `inferred` keeps a line
   * ending exactly level or plumb with its start horizontal or vertical; any other point ignores it.
   */
  | { readonly kind: 'point'; readonly point: CadConstructionPoint; readonly pick?: CadFreshSketchPick; readonly inferred?: CadFreshSketchInference }
  | { readonly kind: 'mode'; readonly mode: CadPathDrawingMode }
  | { readonly kind: 'undo-last' }
  | { readonly kind: 'cancel' };
export type CadPathDrawingPreview =
  | { readonly kind: 'none' }
  | { readonly kind: 'line'; readonly segment: Extract<ResolvedCadPathSegment, { kind: 'line' }> }
  | { readonly kind: 'arc'; readonly segment: CadConstructedArc }
  | { readonly kind: 'invalid'; readonly message: string; readonly start: CadConstructionPoint; readonly end: CadConstructionPoint; readonly through: CadConstructionPoint };

function checkedMode(mode: CadPathDrawingMode): CadPathDrawingMode {
  if (mode !== 'line' && mode !== 'arc') throw new CadError('invalid-construction', 'Path drawing mode must be line or arc.');
  return mode;
}
export function createCadPathDraft(mode: CadPathDrawingMode = 'line'): CadPathDraft {
  return Object.freeze({ kind: 'idle', mode: checkedMode(mode) });
}
export function cadPathDraftEndpoint(draft: Exclude<CadPathDraft, { kind: 'idle' }>): CadConstructionPoint {
  return draft.segments.length ? draft.segments[draft.segments.length - 1].end : draft.start;
}

/** A chain click that returns to its start closes it once the closed chain can bound an area. */
export function closesCadPathChain(draft: CadPathDraft): boolean {
  if (draft.kind !== 'ready' || draft.segments.length < 2) return false;
  const end = cadPathDraftEndpoint(draft);
  return end[0] === draft.start[0] && end[1] === draft.start[1] && (draft.segments.length > 2 || draft.segments.some(segment => segment.kind === 'arc'));
}

/**
 * The completed segments a chain keeps when it finishes open: the rubber band and a pending arc endpoint are dropped.
 * Null while no segment is complete, so there is nothing to save.
 */
export function completedCadPathChain(draft: CadPathDraft): Extract<CadPathDraft, { kind: 'ready' }> | null {
  if (draft.kind === 'idle' || !draft.segments.length) return null;
  if (draft.kind === 'ready') return draft;
  return Object.freeze({ kind: 'ready', start: draft.start, ...(draft.startPick !== undefined ? { startPick: draft.startPick } : {}), segments: draft.segments, mode: 'arc' });
}

/** Every pending attachment, in drawing order. */
export function cadPathDraftPicks(draft: CadPathDraft): readonly CadPathDraftPick[] {
  if (draft.kind === 'idle') return [];
  const picks = [draft.startPick, ...draft.segments.map(segment => segment.endPick), draft.kind === 'arc-through' ? draft.endPick : undefined];
  return picks.filter((pick): pick is CadPathDraftPick => pick !== undefined);
}

/** Every pending horizontal or vertical relation, in drawing order. */
export function cadPathDraftInferences(draft: CadPathDraft): readonly CadFreshSketchInference[] {
  return draft.kind === 'idle' ? [] : draft.segments.flatMap(segment => segment.kind === 'line' && segment.inferred ? [segment.inferred] : []);
}

/** The same drawn points with every pending attachment and inferred relation released. */
export function releaseCadPathDraftPicks(draft: CadPathDraft): CadPathDraft {
  if (draft.kind === 'idle' || !cadPathDraftPicks(draft).length && !cadPathDraftInferences(draft).length) return draft;
  const segments = Object.freeze(draft.segments.map(entry => {
    const { endPick: _released, ...segment } = entry;
    if (segment.kind !== 'line') return Object.freeze(segment);
    const { inferred: _dropped, ...line } = segment; return Object.freeze(line);
  }));
  if (draft.kind === 'ready') return Object.freeze({ kind: 'ready', start: draft.start, segments, mode: draft.mode });
  return Object.freeze({ kind: 'arc-through', start: draft.start, segments, end: draft.end });
}

function attachment(point: CadConstructionPoint, pick: CadFreshSketchPick | undefined): { readonly pick?: CadPathDraftPick } {
  if (!pick || pick.kind === 'position') return {};
  if (pick.point[0] !== point[0] || pick.point[1] !== point[1]) throw new CadError('invalid-construction', 'A point attachment must keep the picked position.');
  return { pick };
}

function inference(start: CadConstructionPoint, end: CadConstructionPoint, inferred: CadFreshSketchInference | undefined): { readonly inferred?: CadFreshSketchInference } {
  if (!inferred) return {};
  if (inferred.kind === 'horizontal' ? start[1] !== end[1] : inferred.kind === 'vertical' ? start[0] !== end[0] : true)
    throw new CadError('invalid-construction', 'An inferred horizontal or vertical relation needs a line drawn exactly level or plumb.');
  return { inferred: Object.freeze({ kind: inferred.kind, relationId: inferred.relationId }) };
}

/** Only committed segments are retained. Arc endpoints remain logical picks, not rounded circle samples. */
export function updateCadPathDraft(draft: CadPathDraft, action: CadPathDrawingAction): CadPathDraft {
  const mode = draft.kind === 'arc-through' ? 'arc' : draft.mode;
  const startReference = draft.kind !== 'idle' && draft.startPick !== undefined ? { startPick: draft.startPick } : {};
  switch (action.kind) {
    case 'cancel': return createCadPathDraft(mode);
    case 'mode': {
      if (draft.kind === 'arc-through') throw new CadError('incomplete-arc', 'Finish the arc through point or undo its endpoint before changing mode.');
      return Object.freeze({ ...draft, mode: checkedMode(action.mode) });
    }
    case 'undo-last': {
      if (draft.kind === 'idle') return draft;
      if (draft.kind === 'arc-through') return Object.freeze({ kind: 'ready', start: draft.start, ...startReference, segments: draft.segments, mode: 'arc' });
      if (!draft.segments.length) return createCadPathDraft(mode);
      return Object.freeze({ ...draft, segments: Object.freeze(draft.segments.slice(0, -1)) });
    }
    case 'point': {
      const point = copyCadConstructionPoint(action.point), { pick } = draft.kind === 'arc-through' ? {} : attachment(point, action.pick);
      if (draft.kind === 'idle') return Object.freeze({ kind: 'ready', start: point, ...(pick ? { startPick: pick } : {}), segments: Object.freeze([]), mode });
      if (draft.segments.length >= MAX_CAD_PATH_CONSTRUCTION_EDGES) throw new CadError('construction-limit', 'A path can contain at most 2048 edges including its closing edge.');
      const start = cadPathDraftEndpoint(draft);
      if (draft.kind === 'ready' && mode === 'arc') {
        const uncertainty = cadPathClosureTolerance([{ x: start[0], y: start[1] }, { x: point[0], y: point[1] }]);
        if (Math.hypot(point[0] - start[0], point[1] - start[1]) <= uncertainty) throw new CadError('degenerate-arc', 'Choose an arc endpoint distinct from its start.');
        return Object.freeze({ kind: 'arc-through', start: draft.start, ...startReference, segments: draft.segments, end: point, ...(pick ? { endPick: pick } : {}) });
      }
      const segment: CadPathDraftSegment = draft.kind === 'arc-through'
        ? Object.freeze({ ...createCadThreePointArc({ start, end: draft.end, through: point }), end: draft.end, through: point,
          ...(draft.endPick !== undefined ? { endPick: draft.endPick } : {}) })
        : Object.freeze({ ...createCadConstructionLine(start, point), ...(pick ? { endPick: pick } : {}), ...inference(start, point, action.inferred) });
      return Object.freeze({ kind: 'ready', start: draft.start, ...startReference, segments: Object.freeze([...draft.segments, segment]), mode });
    }
    default: { const exhaustive: never = action; throw new CadError('invalid-construction', `Unsupported drawing action: ${String(exhaustive)}`); }
  }
}

/** Constant work per pointer move: never inspect or regenerate the committed chain. */
export function previewCadPathDraft(draft: CadPathDraft, cursor: CadConstructionPoint): CadPathDrawingPreview {
  if (draft.kind === 'idle') return { kind: 'none' };
  const start = cadPathDraftEndpoint(draft);
  try {
    if (draft.kind === 'arc-through') return { kind: 'arc', segment: createCadThreePointArc({ start, end: draft.end, through: cursor }) };
    return { kind: 'line', segment: createCadConstructionLine(start, cursor) };
  } catch (error) {
    if (!(error instanceof CadError)) throw error;
    return { kind: 'invalid', message: error.message, start, end: draft.kind === 'arc-through' ? draft.end : cursor, through: cursor };
  }
}

/** Application validates this candidate alongside the existing sketch before resetting the draft. */
export function closeCadPathDraft(draft: CadPathDraft): Extract<CadProfile, { kind: 'path' }> {
  if (draft.kind === 'idle') throw new CadError('empty-path', 'Place the first path point before closing.');
  if (draft.kind === 'arc-through') throw new CadError('incomplete-arc', 'Finish the arc through point or undo its endpoint before closing.');
  const steps: readonly CadPathConstructionStep[] = draft.segments.map(segment => segment.kind === 'line'
    ? { kind: 'line', end: segment.end } : { kind: 'arc', end: segment.end, through: segment.through });
  return createCadPathProfile(draft.start, steps);
}

/**
 * The closed profile a sketch without connected edges keeps: lines alone stay an editable polygon, as the earlier
 * Polyline tool saved them, and any arc keeps the whole contour as a path.
 */
export function closeCadPolylineProfile(draft: CadPathDraft): Extract<CadProfile, { kind: 'path' | 'polygon' }> {
  if (draft.kind !== 'ready' || draft.segments.some(segment => segment.kind !== 'line')) return closeCadPathDraft(draft);
  const ends = draft.segments.map(segment => segment.end), last = ends[ends.length - 1];
  const vertices = [draft.start, ...last && last[0] === draft.start[0] && last[1] === draft.start[1] ? ends.slice(0, -1) : ends];
  if (vertices.length < 3) throw new CadError('invalid-construction', 'A closed profile needs at least three vertices.');
  return Object.freeze({ kind: 'polygon', points: Object.freeze(vertices) });
}

/** A reference curve keeps the authored direction and never gains a closing edge. */
export function finishCadCurveDraft(draft: CadPathDraft): readonly ResolvedCadPathSegment[] {
  if (draft.kind === 'idle') throw new CadError('empty-curve', 'Place the first curve point before finishing.');
  if (draft.kind === 'arc-through') throw new CadError('incomplete-arc', 'Finish the arc through point or undo its endpoint before finishing.');
  const steps: readonly CadPathConstructionStep[] = draft.segments.map(segment => segment.kind === 'line'
    ? { kind: 'line', end: segment.end } : { kind: 'arc', end: segment.end, through: segment.through });
  return createCadOpenCurveSegments(draft.start, steps);
}
