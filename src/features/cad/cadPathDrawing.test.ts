import { describe, expect, it } from 'vitest';
import { CadError } from '@/domain/cad/cadError';
import { closeCadPathDraft, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, updateCadPathDraft, type CadPathDraft } from './cadPathDrawing';

describe('pending mixed path drawing', () => {
  it('finishes an open curve without closure, strips transient picks and retains failed drafts', () => {
    let draft = updateCadPathDraft(createCadPathDraft('arc'), { kind: 'point', point: [5, 0] });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 5] });
    const pending = JSON.stringify(draft); expect(() => finishCadCurveDraft(draft)).toThrow('through point'); expect(JSON.stringify(draft)).toBe(pending);
    draft = updateCadPathDraft(draft, { kind: 'point', point: [-5, 0] }); const original = JSON.stringify(draft);
    expect(finishCadCurveDraft(draft)).toMatchObject([{ kind: 'arc', radius: 5, sweep: -270 }]);
    expect(finishCadCurveDraft(draft)[0]).not.toHaveProperty('through'); expect(JSON.stringify(draft)).toBe(original);
    let closed = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0] });
    for (const point of [[5, 0], [5, 5], [0, 0]] as const) closed = updateCadPathDraft(closed, { kind: 'point', point });
    const before = JSON.stringify(closed); expect(() => finishCadCurveDraft(closed)).toThrow('open'); expect(JSON.stringify(closed)).toBe(before);
  });
  it('captures an arc endpoint then its through point and keeps logical endpoints', () => {
    let draft = createCadPathDraft('arc');
    draft = updateCadPathDraft(draft, { kind: 'point', point: [5, 0] });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [-5, 0] });
    expect(draft.kind).toBe('arc-through');
    expect(previewCadPathDraft(draft, [0, 5]).kind).toBe('arc');
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 5] });
    if (draft.kind !== 'ready') throw new Error('Expected ready draft');
    expect(draft.segments[0]).toMatchObject({ kind: 'arc', end: [-5, 0], through: [0, 5], sweep: 180 });
    const profile = closeCadPathDraft(draft);
    expect(profile.segments).toHaveLength(2);
    expect(profile.segments[1]).toEqual({ kind: 'line', start: [-5, 0], end: [5, 0] });
    expect(draft.segments).toHaveLength(1); expect(Object.isFrozen(draft.segments)).toBe(true);
    expect('end' in profile.segments[0]).toBe(false);
  });
  it('changes mode between segments while undoing an incomplete arc before a committed segment', () => {
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0] });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [5, 0] });
    draft = updateCadPathDraft(draft, { kind: 'mode', mode: 'arc' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [0, 5] });
    const original = JSON.stringify(draft);
    expect(() => updateCadPathDraft(draft, { kind: 'mode', mode: 'line' })).toThrow('Finish the arc');
    expect(() => closeCadPathDraft(draft)).toThrow('Finish the arc'); expect(JSON.stringify(draft)).toBe(original);
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    expect(draft).toMatchObject({ kind: 'ready', mode: 'arc', segments: [{ kind: 'line' }] });
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    expect(draft).toMatchObject({ kind: 'ready', mode: 'arc', segments: [] });
    expect(updateCadPathDraft(draft, { kind: 'undo-last' })).toEqual({ kind: 'idle', mode: 'arc' });
    expect(updateCadPathDraft(draft, { kind: 'cancel' })).toEqual({ kind: 'idle', mode: 'arc' });
  });
  it('preserves the pending draft on invalid through points and invalid closure', () => {
    let draft = updateCadPathDraft(createCadPathDraft('arc'), { kind: 'point', point: [0, 0] });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [2, 0] });
    const original = JSON.stringify(draft);
    expect(previewCadPathDraft(draft, [1, 0]).kind).toBe('invalid');
    expect(() => updateCadPathDraft(draft, { kind: 'point', point: [1, 0] })).toThrow(CadError);
    expect(JSON.stringify(draft)).toBe(original);
    let crossing = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0] });
    for (const point of [[5, 5], [0, 5], [5, 0]] as const) crossing = updateCadPathDraft(crossing, { kind: 'point', point });
    const before = JSON.stringify(crossing); expect(() => closeCadPathDraft(crossing)).toThrow(CadError); expect(JSON.stringify(crossing)).toBe(before);
  });
  it('copies points so event-owned arrays cannot mutate the draft', () => {
    const point: [number, number] = [1, 2];
    const draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point }); point[0] = 42;
    expect(draft).toMatchObject({ start: [1, 2] });
    if (draft.kind === 'idle') throw new Error('Expected anchor'); expect(Object.isFrozen(draft.start)).toBe(true);
  });
  it('computes hover previews without traversing or regenerating previous segments', () => {
    // The endpoint lookup is the only allowed read of a large committed chain.
    const segments = new Proxy([{ kind: 'line' as const, start: [0, 0] as const, end: [5, 0] as const }], {
      get(target, key, receiver) { if (key !== 'length' && key !== '0') throw new Error('Traversed committed chain'); return Reflect.get(target, key, receiver); }
    });
    const draft: CadPathDraft = { kind: 'ready', start: [0, 0], segments, mode: 'line' };
    expect(previewCadPathDraft(draft, [5, 5])).toEqual({ kind: 'line', segment: { kind: 'line', start: [5, 0], end: [5, 5] } });
    expect(previewCadPathDraft(createCadPathDraft(), [1, 1])).toEqual({ kind: 'none' });
  });
  it('bounds committed edges and counts a required closure without clearing a full draft', () => {
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0] });
    for (let index = 1; index <= 2048; index++) draft = updateCadPathDraft(draft, { kind: 'point', point: [index, index % 2] });
    const original = JSON.stringify(draft);
    expect(() => updateCadPathDraft(draft, { kind: 'point', point: [2049, 1] })).toThrow('2048');
    expect(() => closeCadPathDraft(draft)).toThrow('2048'); expect(JSON.stringify(draft)).toBe(original);
  });
});
