/**
 * What the CAD view shows around the geometry being edited. It is display state: it lives with the device preferences, never in a
 * CAD document, and changing it rebuilds nothing. A section view and a selection filter join it later.
 */
export type CadSketchBackground = 'normal' | 'dimmed' | 'hidden';
/** Where picks land while a sketch is open. Only the open sketch for now; picking other geometry arrives with projections. */
export type CadSketchPickScope = 'sketch';
/** The sketch view choices a user makes, which every sketch opened later starts with. */
export interface CadSketchViewChoices { readonly background: CadSketchBackground; readonly cutBySketchPlane: boolean }
export type CadViewContext = { readonly kind: 'part' } | {
  readonly kind: 'sketch';
  readonly featureId: string;
  readonly background: CadSketchBackground;
  readonly cutBySketchPlane: boolean;
  readonly pickScope: CadSketchPickScope;
};
export interface CadViewState {
  readonly context: CadViewContext;
  /** The last sketch view choices, kept while no sketch is open so the next one starts with them. */
  readonly remembered: CadSketchViewChoices;
}
export type CadViewAction =
  | { readonly kind: 'enter-sketch'; readonly featureId: string }
  | { readonly kind: 'leave-sketch' }
  | { readonly kind: 'set-sketch-background'; readonly background: CadSketchBackground }
  | { readonly kind: 'set-cut-by-sketch-plane'; readonly cut: boolean };

/** A new sketch shows the part dimmed behind it, uncut, and picks only in itself. */
export const CAD_DEFAULT_SKETCH_VIEW: CadSketchViewChoices = Object.freeze({ background: 'dimmed', cutBySketchPlane: false });
export const CAD_SKETCH_BACKGROUNDS: readonly CadSketchBackground[] = Object.freeze(['normal', 'dimmed', 'hidden']);
const PART_CONTEXT: CadViewContext = Object.freeze({ kind: 'part' });

export function createCadViewState(remembered: CadSketchViewChoices = CAD_DEFAULT_SKETCH_VIEW): CadViewState {
  return Object.freeze({ context: PART_CONTEXT, remembered });
}

function sketchContext(featureId: string, choices: CadSketchViewChoices): CadViewContext {
  return Object.freeze({ kind: 'sketch', featureId, background: choices.background, cutBySketchPlane: choices.cutBySketchPlane, pickScope: 'sketch' });
}

/** Changing a choice outside a sketch does nothing; a choice made inside one is remembered for the next. */
export function reduceCadViewState(state: CadViewState, action: CadViewAction): CadViewState {
  const { context } = state;
  switch (action.kind) {
    case 'enter-sketch':
      return context.kind === 'sketch' && context.featureId === action.featureId ? state : Object.freeze({ ...state, context: sketchContext(action.featureId, state.remembered) });
    case 'leave-sketch':
      return context.kind === 'part' ? state : Object.freeze({ ...state, context: PART_CONTEXT });
    case 'set-sketch-background': {
      if (context.kind !== 'sketch' || context.background === action.background || !CAD_SKETCH_BACKGROUNDS.includes(action.background)) return state;
      const remembered = Object.freeze({ ...state.remembered, background: action.background });
      return Object.freeze({ context: sketchContext(context.featureId, { background: action.background, cutBySketchPlane: context.cutBySketchPlane }), remembered });
    }
    case 'set-cut-by-sketch-plane': {
      if (context.kind !== 'sketch' || context.cutBySketchPlane === action.cut) return state;
      const remembered = Object.freeze({ ...state.remembered, cutBySketchPlane: action.cut });
      return Object.freeze({ context: sketchContext(context.featureId, { background: context.background, cutBySketchPlane: action.cut }), remembered });
    }
  }
}

/** The state the workbench shows: the open sketch, if any, with the remembered choices. */
export function cadViewStateFor(sketchId: string | null, remembered: CadSketchViewChoices): CadViewState {
  const state = createCadViewState(remembered);
  return sketchId === null ? state : reduceCadViewState(state, { kind: 'enter-sketch', featureId: sketchId });
}

/** Stored choices from a preference record; anything missing or unsupported falls back to the default for that choice alone. */
export function parseCadSketchViewChoices(value: unknown): CadSketchViewChoices | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const background = 'background' in value && CAD_SKETCH_BACKGROUNDS.includes(value.background as CadSketchBackground) ? value.background as CadSketchBackground : undefined;
  const cut = 'cutBySketchPlane' in value && typeof value.cutBySketchPlane === 'boolean' ? value.cutBySketchPlane : undefined;
  if (background === undefined && cut === undefined) return undefined;
  return Object.freeze({ background: background ?? CAD_DEFAULT_SKETCH_VIEW.background, cutBySketchPlane: cut ?? CAD_DEFAULT_SKETCH_VIEW.cutBySketchPlane });
}
