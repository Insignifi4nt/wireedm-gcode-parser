import { describe, expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { createCadWorkbenchViewportControls, type CadViewportBindings } from './cadWorkbenchViewport';
import type { CadRenderedViewState } from './cadViewportControls';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';

const png: EditorPreviewCapture = { source: '3d', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 100, height: 100 };

function setup(mode: 'solid' | 'sketch' = 'solid') {
  let state: CadRenderedViewState = mode === 'solid' ? { mode, available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 1 }
    : { mode, available: true, plane: 'XY', gridVisible: true, snapEnabled: true, gridStepMm: 5, centerMm: [0, 0], heightSpanMm: 160, revision: 1 };
  const capture = vi.fn(async (_signal: AbortSignal) => ({ ...png, source: mode === 'solid' ? '3d' : '2d' } satisfies EditorPreviewCapture));
  const bindings: CadViewportBindings = {
    document: createCadDocument('Measured part', 'part'), documentVersion: 'version-1', dirty: true,
    selectedFeatureId: null, selectedProfileId: null, sketchId: mode === 'sketch' ? 'sketch-1' : null,
    workflowOpen: false, busy: false, buildVersion: mode === 'solid' ? 'version-1' : null,
    buildState: mode === 'solid' ? 'ready' : 'idle', visibleBodyIds: [],
    rendered: { getState: () => Object.freeze(state), fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture },
    selectFeature: vi.fn(), editSketch: vi.fn(), selectProfile: vi.fn(), finishSketch: vi.fn(), updateView: (action) => action(),
  };
  let current = bindings;
  return { controls: createCadWorkbenchViewportControls(() => current), capture,
    update: (change: Partial<CadViewportBindings>) => { current = { ...current, ...change }; },
    updateView: (change: CadRenderedViewState) => { state = change; }, bindings };
}

describe('shared CAD viewport controls', () => {
  it('captures unsaved 3D CAD draft provenance with a frozen bounded view snapshot', async () => {
    const context = setup();
    const capture = await context.controls.capture(new AbortController().signal);
    expect(capture).toMatchObject({ contentSource: 'cad-draft', documentId: 'part', documentVersion: 'version-1', dirty: true, buildVersion: 'version-1', image: { source: '3d' }, viewState: { view: { view: 'Isometric' } } });
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.isFrozen(capture.viewState)).toBe(true);
    expect(Object.isFrozen(capture.viewState.visibleBodyIds)).toBe(true);
  });

  it('rejects a stale or rebuilding solid source before reading pixels', async () => {
    const context = setup();
    context.update({ buildVersion: 'older' });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    context.update({ buildVersion: 'version-1', buildState: 'building' });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(context.capture).not.toHaveBeenCalled();
  });

  it('captures the actual sketch draft independently of solid build status', async () => {
    const context = setup('sketch');
    context.update({ buildVersion: 'old-solid', buildState: 'building' });
    context.capture.mockImplementationOnce(async () => { context.update({ buildState: 'ready', buildVersion: 'version-1' }); return { ...png, source: '2d' }; });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ sketchId: 'sketch-1', buildVersion: null, image: { source: '2d' }, contentSource: 'cad-draft' });
  });

  it('rejects changed draft or camera state during asynchronous capture', async () => {
    const context = setup();
    context.capture.mockImplementationOnce(async () => { context.update({ documentVersion: 'version-2' }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    context.update({ documentVersion: 'version-1' });
    context.capture.mockImplementationOnce(async () => { context.updateView({ mode: 'solid', available: true, view: 'Custom', gridVisible: true, zoom: 2, revision: 2 }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });

  it('allows the caller capture lock while rejecting cancellation and pending edits', async () => {
    const context = setup();
    context.capture.mockImplementationOnce(async () => { context.update({ busy: true }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ contentSource: 'cad-draft' });
    context.update({ busy: false, workflowOpen: true });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' });
    expect(() => context.controls.apply({ kind: 'fit' })).toThrow('Apply or cancel');
    const abort = new AbortController(); abort.abort();
    await expect(context.controls.capture(abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('routes named view and grid through the same renderer operations and validates selected IDs', () => {
    const context = setup();
    context.controls.apply({ kind: 'set-view', view: 'Top' });
    expect(context.bindings.rendered?.setView).toHaveBeenCalledWith('Top');
    context.controls.apply({ kind: 'set-grid', visible: false });
    expect(context.bindings.rendered?.setGrid).toHaveBeenCalledWith(false);
    expect(() => context.controls.apply({ kind: 'select-feature', featureId: 'missing' })).toThrow('does not exist');
    expect(() => setup('sketch').controls.apply({ kind: 'set-view', view: 'Front' })).toThrow('Finish sketch');
  });
});
