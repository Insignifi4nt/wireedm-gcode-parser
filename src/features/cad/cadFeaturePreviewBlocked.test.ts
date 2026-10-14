import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadDocument } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { createBrowserCacheAdapter } from '@/domain/storage/browserCacheAdapter';
import { CadSession } from './cadSession';
import { cadFeatureCandidateEdits, createCadFeaturePreviewCoordinator, type CadFeaturePreviewState } from './cadFeaturePreview';

beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
const initial: CadDocument = { ...createCadDocument(), features: [
  { id: 'sketch', name: 'Outline', kind: 'sketch', suppressed: false, plane: 'XY', offset: 0, profiles: [
    { id: 'circle', name: 'Circle', construction: false, geometry: { kind: 'circle', x: 0, y: 0, radius: 10 } }
  ] },
  { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }
] };
const result = (name: string): CadBuildResult => ({ buildId: name, meshes: [], diagnostics: [], durationMs: 0 });
function harness() {
  const session = new CadSession(initial), states: CadFeaturePreviewState[] = [];
  let storage = createBrowserCacheAdapter(localStorage, { namespace: 'blocked-preview' }), resolveThirty: ((result: CadBuildResult) => void) | undefined;
  const build = vi.fn(async (document: CadDocument) => document.features[1].kind === 'extrude' && document.features[1].distance === 30
    ? new Promise<CadBuildResult>(resolve => { resolveThirty = resolve; }) : result('current'));
  const dispose = vi.fn(), createKernel = vi.fn(async () => ({ build, dispose }));
  const preview = createCadFeaturePreviewCoordinator({ debounceMs: 0, createKernel, onChange: state => states.push(state),
    assertCurrent: version => { if (session.getSnapshot().version !== version) throw new Error('Stale part'); return { document: session.getSnapshot().document, storage }; } });
  const pad = initial.features[1]; if (pad.kind !== 'extrude') throw new Error('Expected Pad');
  const command = (distance: number, owner = 'editor') => ({ owner, expectedVersion: session.getSnapshot().version,
    edits: cadFeatureCandidateEdits({ isNew: false, feature: { ...pad, distance } }) });
  return { session, states, preview, build, dispose, createKernel, command, resolveThirty: () => resolveThirty?.(result('obsolete-thirty')),
    switchStorage: () => { storage = createBrowserCacheAdapter(localStorage, { namespace: 'replacement-store' }); } };
}
it('suppresses an in-flight obsolete build while blocked, then resumes the latest full candidate on the same client', async () => {
  const h = harness();
  try {
    h.preview.update({ kind: 'candidate', ...h.command(20) }); await vi.runOnlyPendingTimersAsync();
    const ready = h.states.at(-1); expect(ready?.kind).toBe('ready');
    h.preview.update({ kind: 'candidate', ...h.command(30) }); await vi.runOnlyPendingTimersAsync();
    h.preview.update({ kind: 'blocked', ...h.command(30), message: 'Complete the number' });
    const blocked = h.states.at(-1); expect(blocked).toMatchObject({ kind: 'error', stage: 'validation', lastValid: { result: { buildId: 'current' } } });
    h.preview.update({ kind: 'candidate', ...h.command(25) }); await vi.runOnlyPendingTimersAsync();
    h.resolveThirty(); await vi.runOnlyPendingTimersAsync();
    expect(h.states.filter(state => state.kind === 'ready').map(state => state.result.buildId)).toEqual(['current', 'current']);
    expect(h.build).toHaveBeenCalledTimes(3); expect(h.createKernel).toHaveBeenCalledTimes(1); expect(h.dispose).not.toHaveBeenCalled();
  } finally { h.preview.dispose(); }
});
it.each(['base', 'storage'] as const)('drops retained geometry and disposes its client when a blocked request crosses the %s boundary', async boundary => {
  const h = harness();
  try {
    h.preview.update({ kind: 'candidate', ...h.command(20) }); await vi.runOnlyPendingTimersAsync();
    const stale = h.command(20);
    if (boundary === 'base') h.session.edit([{ kind: 'rename-document', name: 'Changed part' }]); else h.switchStorage();
    h.preview.update({ kind: 'blocked', ...stale, message: 'Complete the number' }); await Promise.resolve();
    const state = h.states.at(-1); expect(state).toMatchObject({ kind: 'error', stage: 'validation' }); expect(state).not.toHaveProperty('lastValid');
    expect(h.dispose).toHaveBeenCalledTimes(1);
    h.preview.update({ kind: 'candidate', ...h.command(25) }); await vi.runOnlyPendingTimersAsync();
    expect(h.states.at(-1)).toMatchObject({ kind: 'ready', baseVersion: h.session.getSnapshot().version }); expect(h.createKernel).toHaveBeenCalledTimes(2);
  } finally { h.preview.dispose(); }
});
