import { describe, expect, it } from 'vitest';
import { CAD_DEFAULT_SKETCH_VIEW, cadViewStateFor, createCadViewState, parseCadSketchViewChoices, reduceCadViewState, type CadSketchBackground } from './cadViewState';

describe('CAD view state', () => {
  it('opens a sketch with the remembered choices, remembers each choice made in it, and keeps them after leaving', () => {
    const part = createCadViewState();
    expect(part.context).toEqual({ kind: 'part' });
    expect(part.remembered).toEqual({ background: 'dimmed', cutBySketchPlane: false });
    const open = reduceCadViewState(part, { kind: 'enter-sketch', featureId: 'top' });
    expect(open.context).toEqual({ kind: 'sketch', featureId: 'top', background: 'dimmed', cutBySketchPlane: false, pickScope: 'sketch' });
    const hidden = reduceCadViewState(open, { kind: 'set-sketch-background', background: 'hidden' });
    const cut = reduceCadViewState(hidden, { kind: 'set-cut-by-sketch-plane', cut: true });
    expect(cut.context).toMatchObject({ featureId: 'top', background: 'hidden', cutBySketchPlane: true });
    expect(cut.remembered).toEqual({ background: 'hidden', cutBySketchPlane: true });
    const left = reduceCadViewState(cut, { kind: 'leave-sketch' });
    expect(left).toEqual({ context: { kind: 'part' }, remembered: { background: 'hidden', cutBySketchPlane: true } });
    expect(reduceCadViewState(left, { kind: 'enter-sketch', featureId: 'side' }).context).toMatchObject({ featureId: 'side', background: 'hidden', cutBySketchPlane: true });
    expect(open.remembered).toBe(CAD_DEFAULT_SKETCH_VIEW);
  });

  it('returns the same state for an action that changes nothing', () => {
    const part = createCadViewState();
    expect(reduceCadViewState(part, { kind: 'leave-sketch' })).toBe(part);
    // A choice outside a sketch has no sketch to apply to.
    expect(reduceCadViewState(part, { kind: 'set-sketch-background', background: 'normal' })).toBe(part);
    expect(reduceCadViewState(part, { kind: 'set-cut-by-sketch-plane', cut: true })).toBe(part);
    const open = reduceCadViewState(part, { kind: 'enter-sketch', featureId: 'top' });
    expect(reduceCadViewState(open, { kind: 'enter-sketch', featureId: 'top' })).toBe(open);
    expect(reduceCadViewState(open, { kind: 'set-sketch-background', background: 'dimmed' })).toBe(open);
    expect(reduceCadViewState(open, { kind: 'set-cut-by-sketch-plane', cut: false })).toBe(open);
    expect(reduceCadViewState(open, { kind: 'set-sketch-background', background: 'ghost' as CadSketchBackground })).toBe(open);
    expect(Object.isFrozen(open) && Object.isFrozen(open.context)).toBe(true);
  });

  it('derives the shown state from the open sketch and the remembered choices', () => {
    const remembered = { background: 'normal', cutBySketchPlane: true } as const;
    expect(cadViewStateFor(null, remembered)).toEqual({ context: { kind: 'part' }, remembered });
    expect(cadViewStateFor('top', remembered).context).toEqual({ kind: 'sketch', featureId: 'top', background: 'normal', cutBySketchPlane: true, pickScope: 'sketch' });
  });

  it('reads stored choices field by field and ignores records it cannot read', () => {
    expect(parseCadSketchViewChoices({ background: 'normal', cutBySketchPlane: true })).toEqual({ background: 'normal', cutBySketchPlane: true });
    expect(parseCadSketchViewChoices({ background: 'hidden' })).toEqual({ background: 'hidden', cutBySketchPlane: false });
    expect(parseCadSketchViewChoices({ background: 'x-ray', cutBySketchPlane: true })).toEqual({ background: 'dimmed', cutBySketchPlane: true });
    expect(parseCadSketchViewChoices({ background: 3, cutBySketchPlane: 'yes' })).toBeUndefined();
    expect(parseCadSketchViewChoices('dimmed')).toBeUndefined();
    expect(parseCadSketchViewChoices(null)).toBeUndefined();
  });
});
