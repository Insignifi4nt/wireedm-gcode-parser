import { describe, expect, it, vi } from 'vitest';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { createCadWorkbenchViewportControls, type CadViewportBindings } from './cadWorkbenchViewport';
import type { CadRenderedViewState } from './cadViewportControls';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';

const png: EditorPreviewCapture = { source: '3d', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 100, height: 100 };

function setup(mode: 'solid' | 'sketch' | 'curve' = 'solid') {
  let state: CadRenderedViewState = mode === 'solid' ? { mode, available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 1 }
    : { mode, available: true, plane: 'XY', gridVisible: true, snapEnabled: true, gridStepMm: 5, centerMm: [0, 0], heightSpanMm: 160, revision: 1 };
  const capture = vi.fn(async (_signal: AbortSignal) => ({ ...png, source: mode === 'solid' ? '3d' : '2d' } satisfies EditorPreviewCapture));
  const bindings: CadViewportBindings = {
    document: createCadDocument('Measured part', 'part'), documentVersion: 'version-1', dirty: true,
    selectedFeatureId: null, selectedProfileId: null, sketchId: mode === 'sketch' ? 'sketch-1' : null, curveId: mode === 'curve' ? 'curve-1' : null,
    workflowOpen: false, busy: false, buildVersion: mode === 'solid' ? 'version-1' : null,
    buildState: mode === 'solid' ? 'ready' : 'idle', visibleBodyIds: [], visibleReferenceIds: [],
    buildId: mode === 'solid' ? 'build-1' : null, pickMode: 'body', topologySelection: null, meshes: [],
    rendered: { getState: () => Object.freeze(state), fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture },
    selectFeature: vi.fn(), editSketch: vi.fn(), editCurve: vi.fn(), selectProfile: vi.fn(), finishSketch: vi.fn(), finishCurve: vi.fn(), selectTopology: vi.fn(), setPickMode: vi.fn(), updateView: (action) => action(),
  };
  let current = bindings;
  return { controls: createCadWorkbenchViewportControls(() => current), capture,
    update: (change: Partial<CadViewportBindings>) => { current = { ...current, ...change }; },
    updateView: (change: CadRenderedViewState) => { state = change; }, bindings };
}

describe('shared CAD viewport controls', () => {
  const referenceDocument = { ...createCadDocument('Reference', 'part'), features: [{
    id: 'curve-1', name: 'Rail', kind: 'curve' as const, plane: 'XY' as const, offset: 0, suppressed: false,
    segments: [{ kind: 'line' as const, start: [0, 0] as const, end: [20, 0] as const }]
  }] };
  it('captures installed reference geometry without a native solid build and rejects stale uploads', async () => {
    const context = setup();
    context.update({ document: referenceDocument, visibleReferenceIds: ['curve-1'], buildState: 'idle', buildVersion: null, buildId: null });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(context.capture).not.toHaveBeenCalled();
    context.updateView({ mode: 'solid', available: true, referenceVersion: 'version-1', referenceFeatureIds: ['curve-1'], view: 'Isometric', gridVisible: true, zoom: 1, revision: 2 });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ buildVersion: null, curveId: null,
      viewState: { buildState: 'idle', view: { referenceVersion: 'version-1' } }, image: { source: '3d' } });
    context.capture.mockImplementationOnce(async () => {
      context.updateView({ mode: 'solid', available: true, referenceVersion: 'version-2', referenceFeatureIds: ['curve-1'], view: 'Isometric', gridVisible: true, zoom: 1, revision: 3 }); return png;
    });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('still requires a current solid build when reference curves share a solid document', async () => {
    const context = setup();
    context.update({ document: { ...referenceDocument, features: [...referenceDocument.features,
      { id: 'sketch', name: 'Sketch', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [] },
      { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'sketch', distance: 10, symmetric: false, operation: 'new', targetId: null }] }, buildState: 'building', buildVersion: 'old' });
    context.updateView({ mode: 'solid', available: true, referenceVersion: 'version-1', view: 'Isometric', gridVisible: true, zoom: 1, revision: 2 });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(context.capture).not.toHaveBeenCalled();
  });
  const sketchReference = { id: 'section', name: 'Section', kind: 'sketch' as const, plane: 'YZ' as const, offset: 12, suppressed: false,
    profiles: [{ id: 'boundary', name: 'Boundary', construction: false, geometry: { kind: 'circle' as const, x: 0, y: 0, radius: 3 } }] };
  it('captures installed world-space sketch outlines without a solid build and rejects an old selection layer', async () => {
    const context = setup();
    context.update({ document: { ...createCadDocument('Sections', 'part'), features: [sketchReference] },
      visibleReferenceIds: ['section'], buildState: 'idle', buildVersion: null, buildId: null });
    const view = { mode: 'solid' as const, available: true, referenceVersion: 'version-1', view: 'Isometric' as const, gridVisible: false, zoom: 1, revision: 2 };
    for (const referenceFeatureIds of [undefined, [], ['old-section']]) {
      context.updateView({ ...view, referenceFeatureIds });
      await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    }
    expect(context.capture).not.toHaveBeenCalled();
    context.updateView({ ...view, referenceFeatureIds: Object.freeze(['section']) });
    const captured = await context.controls.capture(new AbortController().signal);
    expect(captured).toMatchObject({ buildVersion: null, sketchId: null, curveId: null, image: { source: '3d' },
      viewState: { buildState: 'idle', view: { referenceVersion: 'version-1', referenceFeatureIds: ['section'] } } });
    if (captured.viewState.view?.mode !== 'solid') throw new Error('Expected world-space sketch capture');
    expect(Object.isFrozen(captured.viewState.view.referenceFeatureIds)).toBe(true);
  });
  it('requires a completed empty reference upload when a solid hides its source sketches', async () => {
    const context = setup();
    context.update({ document: { ...createCadDocument('Solid', 'part'), features: [sketchReference,
      { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'section', distance: 10, symmetric: false, operation: 'new', targetId: null }] },
      visibleReferenceIds: [] });
    const view = { mode: 'solid' as const, available: true, view: 'Isometric' as const, gridVisible: true, zoom: 1, revision: 2 };
    context.updateView({ ...view, referenceVersion: 'version-1', referenceFeatureIds: ['section'] });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    context.updateView({ ...view, referenceVersion: 'older', referenceFeatureIds: [] });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(context.capture).not.toHaveBeenCalled();
    context.updateView({ ...view, referenceVersion: 'version-1', referenceFeatureIds: [] });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ buildVersion: 'version-1' });
    context.capture.mockImplementationOnce(async () => { context.update({ visibleReferenceIds: ['section'] }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('does not mistake empty or suppressed sketches for an installed reference scene', async () => {
    for (const feature of [{ ...sketchReference, profiles: [] }, { ...sketchReference, suppressed: true }]) {
      const context = setup();
      context.update({ document: { ...createCadDocument('Empty', 'part'), features: [feature] }, buildState: 'idle', buildVersion: null, buildId: null });
      context.updateView({ mode: 'solid', available: true, referenceVersion: 'version-1', referenceFeatureIds: [], view: 'Isometric', gridVisible: true, zoom: 1, revision: 2 });
      await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
      expect(context.capture).not.toHaveBeenCalled();
    }
  });
  it('identifies planar Curve captures and routes editor commands without sketch profiles or solid topology', async () => {
    const context = setup('curve'); context.update({ document: referenceDocument });
    context.controls.apply({ kind: 'edit-curve', curveId: 'curve-1' });
    expect(context.bindings.editCurve).toHaveBeenCalledWith('curve-1');
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ curveId: 'curve-1', sketchId: null, buildVersion: null, image: { source: '2d' }, viewState: { view: { mode: 'curve' } } });
    expect(() => context.controls.apply({ kind: 'select-profile', profileId: null })).toThrow('sketch editor');
    expect(() => context.controls.apply({ kind: 'set-pick-mode', mode: 'edge' })).toThrow('solid viewport');
    expect(() => context.controls.apply({ kind: 'edit-curve', curveId: 'missing' })).toThrow('active curve');
    context.controls.apply({ kind: 'finish-curve' }); expect(context.bindings.finishCurve).toHaveBeenCalledOnce();
  });
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

  it('rejects capture when topology highlights or the worker build identity change', async () => {
    const context = setup();
    context.capture.mockImplementationOnce(async () => { context.update({ buildId: 'rebuilt-2' }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
    context.update({ buildId: 'build-1' });
    context.capture.mockImplementationOnce(async () => { context.update({ topologySelection: { bodyId: 'body', documentVersion: 'version-1', buildId: 'build-1', picks: [{ kind: 'edge', key: 'selected' }] } }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
    context.update({ topologySelection: null });
    context.capture.mockImplementationOnce(async () => { context.updateView({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 2, hoveredTopology: { bodyId: 'body', pick: { kind: 'face', key: 'hovered' } } }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });

  it('validates declarative topology picks against the current mesh and exposes frozen selection provenance', () => {
    const context = setup();
    const mesh = { featureId: 'body', name: 'Body', positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [{ start: 0, count: 2, key: 'edge' }], volume: 0, bounds: { min: [0, 0, 0], max: [1, 1, 1] } } satisfies CadViewportBindings['meshes'][number];
    context.update({ meshes: [mesh] });
    const selection = { bodyId: 'body', buildId: 'build-1', documentVersion: 'version-1', picks: [{ kind: 'edge', key: 'edge' }] } satisfies NonNullable<CadViewportBindings['topologySelection']>;
    context.controls.apply({ kind: 'select-topology', selection, additive: false });
    expect(context.bindings.selectTopology).toHaveBeenCalledWith(selection, false);
    expect(() => context.controls.apply({ kind: 'select-topology', selection: { ...selection, buildId: 'older' }, additive: false })).toThrow('solid build changed');
    expect(() => context.controls.apply({ kind: 'select-topology', selection: { ...selection, picks: [{ kind: 'edge', key: 'foreign' }] }, additive: false })).toThrow('does not belong');
    context.controls.apply({ kind: 'set-pick-mode', mode: 'edge' });
    expect(context.bindings.setPickMode).toHaveBeenCalledWith('edge');
    context.update({ topologySelection: selection });
    const state = context.controls.getState();
    expect(Object.isFrozen(state.topologySelection?.picks)).toBe(true);
    expect(state.topologySelection).toEqual(selection);
    context.controls.apply({ kind: 'clear-topology' });
    expect(context.bindings.selectTopology).toHaveBeenLastCalledWith(null, false);
  });
});
