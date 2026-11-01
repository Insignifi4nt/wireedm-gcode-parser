import { describe, expect, it } from 'vitest';
import { CadError } from '@/domain/cad/cadError';
import type { CadConstructionPoint } from '@/domain/cad/cadPathConstruction';
import { cadPathDraftInferences, cadPathDraftPicks, closeCadPathDraft, closesCadPathChain, completedCadPathChain, closeCadPolylineProfile, createCadPathDraft, finishCadCurveDraft, previewCadPathDraft, releaseCadPathDraftPicks, updateCadPathDraft,
  type CadPathDraft, type CadPathDraftPick } from './cadPathDrawing';

const join = (point: CadConstructionPoint, sourcePointId: string): CadPathDraftPick => ({ kind: 'coincident', point, sourcePointId, relationId: `join-${sourcePointId}` });

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
  it('keeps a line-only legacy polyline an editable polygon and any arc contour a path', () => {
    const draw = (points: readonly CadConstructionPoint[]) => points.reduce<CadPathDraft>((draft, point) => updateCadPathDraft(draft, { kind: 'point', point }), createCadPathDraft());
    expect(closeCadPolylineProfile(draw([[0, 0], [20, 0], [20, 10]]))).toEqual({ kind: 'polygon', points: [[0, 0], [20, 0], [20, 10]] });
    expect(closeCadPolylineProfile(draw([[0, 0], [20, 0], [20, 10], [0, 0]]))).toEqual({ kind: 'polygon', points: [[0, 0], [20, 0], [20, 10]] });
    expect(() => closeCadPolylineProfile(draw([[0, 0], [20, 0]]))).toThrow('three');
    expect(() => closeCadPolylineProfile(draw([[0, 0], [20, 0], [0, 0]]))).toThrow('three');
    let arc = updateCadPathDraft(draw([[0, 0], [20, 0]]), { kind: 'mode', mode: 'arc' });
    arc = updateCadPathDraft(updateCadPathDraft(arc, { kind: 'point', point: [0, 0] }), { kind: 'point', point: [10, 10] });
    expect(closeCadPolylineProfile(arc)).toMatchObject({ kind: 'path', segments: [{ kind: 'line' }, { kind: 'arc' }] });
  });
  it('copies points so event-owned arrays cannot mutate the draft', () => {
    const point: [number, number] = [1, 2];
    const draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point }); point[0] = 42;
    expect(draft).toMatchObject({ start: [1, 2] });
    if (draft.kind === 'idle') throw new Error('Expected anchor'); expect(Object.isFrozen(draft.start)).toBe(true);
  });

  it('retains deliberately picked endpoint attachments through modes and undo while ignoring arc through-point picks', () => {
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [5, 0], pick: join([5, 0], 'start') });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [10, 0], pick: join([10, 0], 'line-end') });
    draft = updateCadPathDraft(draft, { kind: 'mode', mode: 'arc' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [10, 10], pick: join([10, 10], 'arc-end') });
    expect(draft).toMatchObject({ startPick: join([5, 0], 'start'), endPick: join([10, 10], 'arc-end'), segments: [{ endPick: join([10, 0], 'line-end') }] });
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    expect(draft).toMatchObject({ kind: 'ready', startPick: join([5, 0], 'start'), segments: [{ endPick: join([10, 0], 'line-end') }] });
    expect(draft).not.toHaveProperty('endPick');
    draft = updateCadPathDraft(draft, { kind: 'point', point: [10, 10], pick: join([10, 10], 'arc-end') });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [15, 5], pick: join([15, 5], 'through-only') });
    expect(draft).toMatchObject({ kind: 'ready', segments: [{ endPick: join([10, 0], 'line-end') }, { endPick: join([10, 10], 'arc-end') }] });
    expect(JSON.stringify(draft)).not.toContain('through-only');
    expect(cadPathDraftPicks(draft).map(pick => pick.kind === 'coincident' && pick.sourcePointId)).toEqual(['start', 'line-end', 'arc-end']);
    const curve = finishCadCurveDraft(draft);
    expect(curve).toHaveLength(2); expect(JSON.stringify(curve)).not.toContain('Pick');
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    expect(draft).toMatchObject({ startPick: join([5, 0], 'start'), segments: [{ endPick: join([10, 0], 'line-end') }] });
    expect(updateCadPathDraft(draft, { kind: 'cancel' })).toEqual({ kind: 'idle', mode: 'arc' });
  });

  it('keeps plain positions unattached, rejects a moved pick and releases every attachment without moving a point', () => {
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0], pick: { kind: 'position', point: [0, 0] } });
    expect(draft).not.toHaveProperty('startPick');
    const before = JSON.stringify(draft);
    expect(() => updateCadPathDraft(draft, { kind: 'point', point: [10, 0], pick: join([10, 1e-9], 'moved') })).toThrow(CadError);
    expect(JSON.stringify(draft)).toBe(before);
    draft = updateCadPathDraft(draft, { kind: 'point', point: [10, 0], pick: { kind: 'on-line', point: [10, 0], lineId: 'edge', relationId: 'on-edge' } });
    draft = updateCadPathDraft(draft, { kind: 'mode', mode: 'arc' });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [10, 10], pick: { kind: 'fixed', point: [10, 10], targetId: '@origin', relationIds: [] } });
    expect(cadPathDraftPicks(draft).map(pick => pick.kind)).toEqual(['on-line', 'fixed']);
    const released = releaseCadPathDraftPicks(draft);
    expect(cadPathDraftPicks(released)).toEqual([]); expect(JSON.stringify(released)).not.toContain('Pick');
    expect(released).toMatchObject({ kind: 'arc-through', start: [0, 0], end: [10, 10], segments: [{ kind: 'line', start: [0, 0], end: [10, 0] }] });
    expect(releaseCadPathDraftPicks(released)).toBe(released);
  });
  it('keeps the inferred relation of a line until undo or release, and only on a line ending exactly level or plumb', () => {
    let draft = updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0], inferred: { kind: 'vertical', relationId: 'ignored' } });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [5, 0], inferred: { kind: 'horizontal', relationId: 'h' }, pick: join([5, 0], 'b') });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [5, 5], inferred: { kind: 'vertical', relationId: 'v' } });
    expect(cadPathDraftInferences(draft)).toEqual([{ kind: 'horizontal', relationId: 'h' }, { kind: 'vertical', relationId: 'v' }]);
    const before = JSON.stringify(draft);
    expect(() => updateCadPathDraft(draft, { kind: 'point', point: [9, 5.001], inferred: { kind: 'horizontal', relationId: 'off' } })).toThrow('exactly level or plumb');
    expect(() => updateCadPathDraft(draft, { kind: 'point', point: [9, 9], inferred: { kind: 'vertical', relationId: 'off' } })).toThrow(CadError);
    expect(JSON.stringify(draft)).toBe(before);
    // An arc and its through point never keep one.
    const arc = updateCadPathDraft(updateCadPathDraft(updateCadPathDraft(draft, { kind: 'mode', mode: 'arc' }), { kind: 'point', point: [0, 5], inferred: { kind: 'horizontal', relationId: 'a' } }),
      { kind: 'point', point: [2.5, 7], inferred: { kind: 'horizontal', relationId: 't' } });
    expect(cadPathDraftInferences(arc)).toEqual(cadPathDraftInferences(draft));
    expect(cadPathDraftInferences(updateCadPathDraft(draft, { kind: 'undo-last' }))).toEqual([{ kind: 'horizontal', relationId: 'h' }]);
    const released = releaseCadPathDraftPicks(draft);
    expect(cadPathDraftInferences(released)).toEqual([]); expect(cadPathDraftPicks(released)).toEqual([]);
    expect(released.kind !== 'idle' && released.segments.map(segment => segment.end)).toEqual([[5, 0], [5, 5]]);
    // A draft with only inferred relations is released too.
    expect(cadPathDraftInferences(releaseCadPathDraftPicks(updateCadPathDraft(updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [0, 0] }),
      { kind: 'point', point: [0, 4], inferred: { kind: 'vertical', relationId: 'only' } })))).toEqual([]);
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

describe('line chains', () => {
  const chain = (points: readonly CadConstructionPoint[], mode: 'line' | 'arc' = 'line') =>
    points.reduce<CadPathDraft>((draft, point) => updateCadPathDraft(draft, { kind: 'point', point }), createCadPathDraft(mode));
  it('continues every segment from the previous end and closes only on a return to the start that bounds an area', () => {
    const draft = chain([[0, 0], [10, 0], [10, 10]]);
    if (draft.kind !== 'ready') throw new Error('Expected a ready chain');
    expect(draft.segments.map(segment => segment.kind === 'line' ? [segment.start, segment.end] : segment.kind)).toEqual([[[0, 0], [10, 0]], [[10, 0], [10, 10]]]);
    expect(closesCadPathChain(draft)).toBe(false);
    expect(closesCadPathChain(updateCadPathDraft(draft, { kind: 'point', point: [0, 0] }))).toBe(true);
    // Two lines back to the start bound nothing, and a near miss is no return.
    expect(closesCadPathChain(chain([[0, 0], [10, 0], [0, 0]]))).toBe(false);
    expect(closesCadPathChain(updateCadPathDraft(draft, { kind: 'point', point: [0, 1e-9] }))).toBe(false);
    // One line and one arc back to the start already bound an area.
    let arc = updateCadPathDraft(chain([[0, 0], [10, 0]]), { kind: 'mode', mode: 'arc' });
    arc = updateCadPathDraft(updateCadPathDraft(arc, { kind: 'point', point: [0, 0] }), { kind: 'point', point: [5, 5] });
    expect(closesCadPathChain(arc)).toBe(true);
  });
  it('finishes open with the completed segments only, dropping a pending arc endpoint, and has nothing to finish without a segment', () => {
    expect(completedCadPathChain(createCadPathDraft())).toBeNull();
    expect(completedCadPathChain(chain([[0, 0]]))).toBeNull();
    // An arc endpoint waiting for its through point is not a segment yet.
    expect(completedCadPathChain(chain([[0, 0], [10, 0]], 'arc'))).toBeNull();
    const ready = chain([[0, 0], [10, 0], [10, 10]]);
    expect(completedCadPathChain(ready)).toBe(ready);
    let pending = updateCadPathDraft(updateCadPathDraft(chain([[5, 5]]), { kind: 'point', point: [10, 0], pick: join([10, 0], 'line-end') }), { kind: 'mode', mode: 'arc' });
    pending = updateCadPathDraft(pending, { kind: 'point', point: [20, 0], pick: join([20, 0], 'arc-end') });
    const withStart = updateCadPathDraft(updateCadPathDraft(createCadPathDraft(), { kind: 'point', point: [5, 5], pick: join([5, 5], 'start') }), { kind: 'point', point: [10, 0] });
    expect(completedCadPathChain(withStart)).toBe(withStart);
    const finished = completedCadPathChain(pending);
    expect(finished).toEqual({ kind: 'ready', start: [5, 5], segments: [expect.objectContaining({ kind: 'line', end: [10, 0], endPick: join([10, 0], 'line-end') })], mode: 'arc' });
    expect(JSON.stringify(finished)).not.toContain('arc-end'); expect(Object.isFrozen(finished)).toBe(true);
    // The kept start attachment survives a dropped arc endpoint.
    const attached = updateCadPathDraft(updateCadPathDraft(withStart, { kind: 'mode', mode: 'arc' }), { kind: 'point', point: [20, 0] });
    expect(completedCadPathChain(attached)).toMatchObject({ kind: 'ready', startPick: join([5, 5], 'start'), segments: [{ kind: 'line' }] });
  });
  it('undoes the last segment back to its start point and switches modes between segments', () => {
    let draft = chain([[0, 0], [10, 0], [10, 10]]);
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    expect(draft).toMatchObject({ kind: 'ready', segments: [{ end: [10, 0] }] }); expect(completedCadPathChain(draft)).toBe(draft);
    draft = updateCadPathDraft(draft, { kind: 'undo-last' });
    expect(draft).toMatchObject({ kind: 'ready', start: [0, 0], segments: [] }); expect(completedCadPathChain(draft)).toBeNull();
    draft = updateCadPathDraft(updateCadPathDraft(draft, { kind: 'mode', mode: 'arc' }), { kind: 'point', point: [10, 0] });
    draft = updateCadPathDraft(draft, { kind: 'point', point: [5, 5] });
    draft = updateCadPathDraft(updateCadPathDraft(draft, { kind: 'mode', mode: 'line' }), { kind: 'point', point: [10, 10] });
    expect(draft).toMatchObject({ kind: 'ready', mode: 'line', segments: [{ kind: 'arc', end: [10, 0] }, { kind: 'line', start: [10, 0], end: [10, 10] }] });
  });
});
