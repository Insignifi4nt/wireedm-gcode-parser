import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { evaluateCadScalar } from '@/domain/cad/cadExpression';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { CadSession } from './cadSession';
import { createCadFeaturePreviewCoordinator, type CadFeaturePreviewState } from './cadFeaturePreview';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
const document: CadDocument = { ...createCadDocument('Preview block', 'preview_block'), parameters: { depth: 10 }, features: [
  { kind: 'sketch', id: 'outline', name: 'Outline', suppressed: false, plane: 'XY', offset: 0, profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }] },
  { kind: 'extrude', id: 'pad', name: 'Pad', suppressed: false, sketchId: 'outline', distance: 'depth', symmetric: false, operation: 'new', targetId: null }
] };
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error('Deferred missing'); };
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve };
}
const built = (buildId: string): CadBuildResult => ({ buildId, meshes: [], diagnostics: [], durationMs: 8 });
function fixture(input = document) {
  const session = new CadSession(input), before = session.getSnapshot();
  let storage = createBrowserCacheAdapter(localStorage, { namespace: 'feature-preview-test' }), open = true;
  const kernel = { build: vi.fn<(document: CadDocument, signal?: AbortSignal) => Promise<CadBuildResult>>(), dispose: vi.fn() }, createKernel = vi.fn(async () => kernel);
  const states: CadFeaturePreviewState[] = [];
  const preview = createCadFeaturePreviewCoordinator({ createKernel, onChange: state => states.push(state), assertCurrent(version) {
    if (!open) throw new Error('CAD closed'); session.assertVersion(version); session.assertWorkflowClosed('editor');
    return { document: session.getSnapshot().document, storage };
  } });
  function candidate(distance: string, owner = 'editor_1') {
    const feature = before.document.features[1]; if (feature.kind !== 'extrude') throw new Error('Expected Pad');
    preview.update({ kind: 'candidate', owner, expectedVersion: before.version, edits: [{ kind: 'update-feature', feature: { ...feature, distance } }] });
  }
  return { session, before, preview, states, kernel, createKernel, candidate, close: () => { open = false; }, switchStorage: () => { storage = createBrowserCacheAdapter(localStorage, { namespace: 'other-preview-store' }); } };
}
it('previews one correlated parameter/feature batch through the entire document while preserving every binding and accepted history', async () => {
  const outline = document.features[0], pad = document.features[1];
  if (outline.kind !== 'sketch' || pad.kind !== 'extrude') throw new Error('Expected fixture inputs');
  const h = fixture({ ...document, features: [...document.features,
    { ...outline, id: 'follower', name: 'Following sketch', offset: 'depth / 2' },
    { ...pad, id: 'secondary', name: 'Secondary Pad', sketchId: 'follower', distance: 'depth * 3' }
  ] });
  h.kernel.build.mockResolvedValue(built('correlated'));
  const feature = h.before.document.features[1];
  const edits = [{ kind: 'update-feature', feature }, { kind: 'set-parameter', name: 'depth', value: 20 }] as const;
  h.preview.update({ kind: 'candidate', owner: 'editor_1', expectedVersion: h.before.version, edits });
  await vi.advanceTimersByTimeAsync(200);
  const candidate = h.kernel.build.mock.calls[0][0];
  expect(candidate.parameters).toEqual({ depth: 20 });
  expect(candidate.features).toEqual(h.before.document.features);
  const follower = candidate.features[2], secondary = candidate.features[3];
  if (follower.kind !== 'sketch' || secondary.kind !== 'extrude') throw new Error('Expected correlated sources');
  expect(evaluateCadScalar(follower.offset, candidate.parameters)).toBe(10);
  expect(evaluateCadScalar(secondary.distance, candidate.parameters)).toBe(60);
  expect(h.states.at(-1)).toMatchObject({ kind: 'ready', definitionKey: JSON.stringify(edits), document: candidate });
  expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
it('keeps a last valid parameter preview while a newer shared value rejects, without accepting a late native result for identical feature JSON', async () => {
  const h = fixture(), late = deferred<CadBuildResult>(); h.kernel.build.mockResolvedValueOnce(built('valid')).mockReturnValueOnce(late.promise);
  const feature = h.before.document.features[1];
  const update = (value: number) => h.preview.update({ kind: 'candidate', owner: 'editor_1', expectedVersion: h.before.version,
    edits: [{ kind: 'update-feature', feature }, { kind: 'set-parameter', name: 'depth', value }] });
  update(20); await vi.advanceTimersByTimeAsync(200);
  const valid = h.states.at(-1); if (!valid || valid.kind !== 'ready') throw new Error('Expected valid parameter preview');
  const { kind: _kind, ...snapshot } = valid;
  update(30); await vi.advanceTimersByTimeAsync(200);
  expect(h.states.at(-1)).toMatchObject({ kind: 'building', lastValid: snapshot });
  expect(h.states.at(-1)).not.toHaveProperty('definitionKey', valid.definitionKey);
  update(0);
  expect(h.states.at(-1)).toMatchObject({ kind: 'error', stage: 'validation', lastValid: snapshot });
  late.resolve(built('obsolete')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.at(-1)).toMatchObject({ kind: 'error', stage: 'validation', lastValid: snapshot });
  expect(h.kernel.build).toHaveBeenCalledTimes(2); expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
it('assembles a valid expression-preserving candidate without mutating accepted data, history or save identity', async () => {
  const h = fixture(); h.kernel.build.mockResolvedValue(built('candidate-build'));
  h.session.markSaved({ document: h.before.document, savedVersion: 'accepted-save', updatedAt: '2026-10-14T00:00:00Z' }, h.before.version);
  const accepted = h.session.getSnapshot();
  h.candidate('depth * 2'); expect(h.createKernel).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(200);
  expect(h.kernel.build).toHaveBeenCalledOnce();
  expect(h.kernel.build.mock.calls[0][0]).toMatchObject({ parameters: { depth: 10 }, features: [expect.anything(), { distance: 'depth * 2' }] });
  expect(h.states.at(-1)).toMatchObject({ kind: 'ready', owner: 'editor_1', baseVersion: accepted.version, result: { buildId: 'candidate-build' } });
  expect(h.session.getSnapshot()).toBe(accepted); expect(h.session.getSnapshot()).toMatchObject({ dirty: false, canUndo: false, savedVersion: 'accepted-save' });
  h.preview.update({ kind: 'clear', owner: 'editor_1' }); await vi.advanceTimersByTimeAsync(0);
  expect(h.kernel.dispose).toHaveBeenCalledOnce(); expect(h.states.at(-1)).toEqual({ kind: 'idle' }); expect(h.session.getSnapshot()).toBe(accepted);
});
it('coalesces typing before and during native work without terminating its worker or publishing obsolete shapes', async () => {
  const h = fixture(), first = deferred<CadBuildResult>(), second = deferred<CadBuildResult>();
  h.kernel.build.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  h.candidate('depth'); h.candidate('depth * 2'); h.candidate('depth * 3'); await vi.advanceTimersByTimeAsync(200);
  expect(h.kernel.build).toHaveBeenCalledOnce(); expect(h.kernel.build.mock.calls[0][0].features[1]).toHaveProperty('distance', 'depth * 3');
  h.candidate('depth * 4'); await vi.advanceTimersByTimeAsync(50); h.candidate('depth * 5'); await vi.advanceTimersByTimeAsync(200);
  expect(h.kernel.build).toHaveBeenCalledOnce(); expect(h.kernel.dispose).not.toHaveBeenCalled();
  first.resolve(built('obsolete')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.some(state => state.kind === 'ready')).toBe(false); expect(h.kernel.build).toHaveBeenCalledTimes(2);
  expect(h.kernel.build.mock.calls[1][0].features[1]).toHaveProperty('distance', 'depth * 5');
  second.resolve(built('latest')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.at(-1)).toMatchObject({ kind: 'ready', result: { buildId: 'latest' } }); expect(h.createKernel).toHaveBeenCalledOnce();
  expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
it('rejects invalid expressions before allocating native work and suppresses an older successful result', async () => {
  const h = fixture(), response = deferred<CadBuildResult>(); h.kernel.build.mockReturnValue(response.promise);
  h.candidate('depth * 2'); await vi.advanceTimersByTimeAsync(200);
  h.candidate('unknownDepth'); expect(h.states.at(-1)).toMatchObject({ kind: 'error', stage: 'validation' });
  response.resolve(built('obsolete')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.some(state => state.kind === 'ready')).toBe(false); expect(h.kernel.build).toHaveBeenCalledOnce();
  expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
it('allows a corrected draft to retry a rejected lazy worker load without discarding its owner', async () => {
  const h = fixture(); h.createKernel.mockRejectedValueOnce(new Error('Temporary worker load failure'));
  h.kernel.build.mockResolvedValue(built('retry'));
  h.candidate('depth * 2'); await vi.advanceTimersByTimeAsync(200);
  expect(h.states.at(-1)).toMatchObject({ kind: 'error', stage: 'kernel' });
  h.candidate('depth * 3'); await vi.advanceTimersByTimeAsync(200);
  expect(h.states.at(-1)).toMatchObject({ kind: 'ready', owner: 'editor_1', result: { buildId: 'retry' } });
  expect(h.createKernel).toHaveBeenCalledTimes(2); expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
it('retains the last valid owner snapshot while a newer candidate builds, then clears it immediately on Cancel', async () => {
  const h = fixture(), next = deferred<CadBuildResult>(); h.kernel.build.mockResolvedValueOnce(built('valid')).mockReturnValueOnce(next.promise);
  h.candidate('depth * 2'); await vi.advanceTimersByTimeAsync(200);
  const valid = h.states.at(-1); if (!valid || valid.kind !== 'ready') throw new Error('Expected first valid preview');
  h.candidate('depth * 3');
  expect(h.states.at(-1)).toMatchObject({ kind: 'waiting', lastValid: { candidateId: valid.candidateId, document: valid.document, result: valid.result } });
  await vi.advanceTimersByTimeAsync(200);
  expect(h.states.at(-1)).toMatchObject({ kind: 'building', lastValid: { candidateId: valid.candidateId, result: { buildId: 'valid' } } });
  h.preview.update({ kind: 'clear', owner: 'editor_1' }); next.resolve(built('late')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.at(-1)).toEqual({ kind: 'idle' }); expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
it.each(['version', 'storage', 'close', 'workflow'] as const)('discards native results after the accepted %s changes', async cause => {
  const h = fixture(), response = deferred<CadBuildResult>(); h.kernel.build.mockReturnValue(response.promise);
  h.candidate('depth * 2'); await vi.advanceTimersByTimeAsync(200);
  if (cause === 'version') h.session.edit([{ kind: 'rename-document', name: 'New accepted part' }]);
  if (cause === 'storage') h.switchStorage();
  if (cause === 'close') h.close();
  if (cause === 'workflow') h.session.setWorkflowOpen(true, 'section');
  const accepted = h.session.getSnapshot(); response.resolve(built('obsolete')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.some(state => state.kind === 'ready')).toBe(false); expect(h.states.at(-1)).toEqual({ kind: 'idle' });
  expect(h.kernel.dispose).toHaveBeenCalledOnce(); expect(h.session.getSnapshot()).toBe(accepted); h.preview.dispose();
});
it('keeps new owners independent of late old responses and cleanup, and cancels only its isolated client', async () => {
  const h = fixture(), old = deferred<CadBuildResult>(); h.kernel.build.mockReturnValueOnce(old.promise).mockResolvedValueOnce(built('new-owner'));
  h.candidate('depth * 2'); await vi.advanceTimersByTimeAsync(200);
  const signal = h.kernel.build.mock.calls[0][1]; h.candidate('depth * 3', 'editor_2');
  expect(signal?.aborted).toBe(true); h.preview.update({ kind: 'clear', owner: 'editor_1' }); await vi.advanceTimersByTimeAsync(200);
  expect(h.states.at(-1)).toMatchObject({ kind: 'ready', owner: 'editor_2', result: { buildId: 'new-owner' } });
  old.resolve(built('late-old')); await vi.advanceTimersByTimeAsync(0);
  expect(h.states.at(-1)).toMatchObject({ kind: 'ready', owner: 'editor_2', result: { buildId: 'new-owner' } });
  expect(h.createKernel).toHaveBeenCalledTimes(2); expect(h.kernel.dispose).toHaveBeenCalledOnce(); expect(h.session.getSnapshot()).toBe(h.before); h.preview.dispose();
});
