import type { CadProfile } from '@/domain/cad/cadDocument';
import { CadError } from '@/domain/cad/cadError';
import {
  copyCadConstructionPoint, createCadConstructionLine, createCadOpenCurveSegments, createCadPathProfile, createCadThreePointArc,
  MAX_CAD_PATH_CONSTRUCTION_EDGES, type CadConstructedArc, type CadConstructionPoint, type CadPathConstructionStep
} from '@/domain/cad/cadPathConstruction';
import { cadPathClosureTolerance, type ResolvedCadPathSegment } from '@/domain/cad/cadSketchGeometry';

export type CadPathDrawingMode = 'line' | 'arc';
export type CadPathDraftSegment = (Extract<ResolvedCadPathSegment, { kind: 'line' }>
  | (CadConstructedArc & { readonly end: CadConstructionPoint; readonly through: CadConstructionPoint })) & { readonly endPointId?: string };
export type CadPathDraft =
  | { readonly kind: 'idle'; readonly mode: CadPathDrawingMode }
  | { readonly kind: 'ready'; readonly start: CadConstructionPoint; readonly startPointId?: string; readonly segments: readonly CadPathDraftSegment[]; readonly mode: CadPathDrawingMode }
  | { readonly kind: 'arc-through'; readonly start: CadConstructionPoint; readonly startPointId?: string; readonly segments: readonly CadPathDraftSegment[]; readonly end: CadConstructionPoint; readonly endPointId?: string };
export type CadPathDrawingAction =
  | { readonly kind: 'point'; readonly point: CadConstructionPoint; readonly existingPointId?: string }
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

/** Only committed segments are retained. Arc endpoints remain logical picks, not rounded circle samples. */
export function updateCadPathDraft(draft: CadPathDraft, action: CadPathDrawingAction): CadPathDraft {
  const mode = draft.kind === 'arc-through' ? 'arc' : draft.mode;
  const startReference = draft.kind !== 'idle' && draft.startPointId !== undefined ? { startPointId: draft.startPointId } : {};
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
      const point = copyCadConstructionPoint(action.point);
      if (draft.kind === 'idle') return Object.freeze({ kind: 'ready', start: point,
        ...(action.existingPointId !== undefined ? { startPointId: action.existingPointId } : {}), segments: Object.freeze([]), mode });
      if (draft.segments.length >= MAX_CAD_PATH_CONSTRUCTION_EDGES) throw new CadError('construction-limit', 'A path can contain at most 2048 edges including its closing edge.');
      const start = cadPathDraftEndpoint(draft);
      if (draft.kind === 'ready' && mode === 'arc') {
        const uncertainty = cadPathClosureTolerance([{ x: start[0], y: start[1] }, { x: point[0], y: point[1] }]);
        if (Math.hypot(point[0] - start[0], point[1] - start[1]) <= uncertainty) throw new CadError('degenerate-arc', 'Choose an arc endpoint distinct from its start.');
        return Object.freeze({ kind: 'arc-through', start: draft.start, ...startReference, segments: draft.segments, end: point,
          ...(action.existingPointId !== undefined ? { endPointId: action.existingPointId } : {}) });
      }
      const segment: CadPathDraftSegment = draft.kind === 'arc-through'
        ? Object.freeze({ ...createCadThreePointArc({ start, end: draft.end, through: point }), end: draft.end, through: point,
          ...(draft.endPointId !== undefined ? { endPointId: draft.endPointId } : {}) })
        : Object.freeze({ ...createCadConstructionLine(start, point), ...(action.existingPointId !== undefined ? { endPointId: action.existingPointId } : {}) });
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

/** A reference curve keeps the authored direction and never gains a closing edge. */
export function finishCadCurveDraft(draft: CadPathDraft): readonly ResolvedCadPathSegment[] {
  if (draft.kind === 'idle') throw new CadError('empty-curve', 'Place the first curve point before finishing.');
  if (draft.kind === 'arc-through') throw new CadError('incomplete-arc', 'Finish the arc through point or undo its endpoint before finishing.');
  const steps: readonly CadPathConstructionStep[] = draft.segments.map(segment => segment.kind === 'line'
    ? { kind: 'line', end: segment.end } : { kind: 'arc', end: segment.end, through: segment.through });
  return createCadOpenCurveSegments(draft.start, steps);
}
