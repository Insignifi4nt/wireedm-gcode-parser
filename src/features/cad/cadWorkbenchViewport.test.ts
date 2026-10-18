import { describe, expect, it, vi } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { createCadWorkbenchViewportControls, type CadViewportBindings } from './cadWorkbenchViewport';
import { CadViewportCommandSchema, type CadRenderedViewState } from './cadViewportControls';
import type { CadSketchGraphPickFilter } from './cadSketchGraphSelection';
import type { EditorPreviewCapture } from '@/features/webmcp/previewCapture';

const png: EditorPreviewCapture = { source: '3d', dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 100, height: 100 };

function setup(mode: 'solid' | 'sketch' | 'curve' = 'solid') {
  let state: CadRenderedViewState = mode === 'solid' ? { mode, available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 1 }
    : { mode, available: true, plane: 'XY', gridVisible: true, snapEnabled: true, gridStepMm: 5, centerMm: [0, 0], heightSpanMm: 160, revision: 1 };
  const capture = vi.fn(async (_signal: AbortSignal) => ({ ...png, source: mode === 'solid' ? '3d' : '2d' } satisfies EditorPreviewCapture));
  const bindings: CadViewportBindings = {
    document: createCadDocument('Measured part', 'part'), documentVersion: 'version-1', dirty: true,
    selectedFeatureId: null, selectedProfileId: null, selectedSketchGeometrySet: [], sketchId: mode === 'sketch' ? 'sketch-1' : null, curveId: mode === 'curve' ? 'curve-1' : null,
    selectedReferencePlane: null, awaitingSketchPlane: false,
    workflowOpen: false, busy: false, buildVersion: mode === 'solid' ? 'version-1' : null,
    buildState: mode === 'solid' ? 'ready' : 'idle', visibleBodyIds: [], visibleReferenceIds: [], visibleReferencePlanes: [],
    buildId: mode === 'solid' ? 'build-1' : null, pickMode: 'body', topologySelection: null, meshes: [],
    rendered: { getState: () => Object.freeze(state), fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture },
    selectFeature: vi.fn(), selectReferencePlane: vi.fn(), editSketch: vi.fn(), editCurve: vi.fn(), selectProfile: vi.fn(), selectSketchGeometrySet: vi.fn(), finishSketch: vi.fn(), finishCurve: vi.fn(), selectTopology: vi.fn(), setPickMode: vi.fn(), updateView: (action) => action(),
  };
  let current = bindings;
  return { controls: createCadWorkbenchViewportControls(() => current), capture,
    update: (change: Partial<CadViewportBindings>) => { current = { ...current, ...change }; },
    updateView: (change: CadRenderedViewState) => { state = change; }, bindings };
}

describe('shared CAD viewport controls', () => {
  const graphSketch = { id: 'sketch-1', name: 'Outline', kind: 'sketch' as const, plane: 'XY' as const, offset: 0, suppressed: false, profiles: [],
    graph: { points: [{ id: 'a', position: [0, 0] as const }, { id: 'b', position: [10, 0] as const }],
      entities: [{ id: 'ab', kind: 'line' as const, construction: false, startPointId: 'a', endPointId: 'b' }], relations: [] } };
  it('routes sketch screen filters without changing accepted source or selection and keeps exact-ID picks independent', () => {
    const context = setup('sketch'), rendered = context.bindings.rendered;
    if (!rendered) throw new Error('Sketch renderer missing');
    const document = { ...context.bindings.document, schemaVersion: 2 as const, features: [graphSketch] };
    const view = { mode: 'sketch' as const, available: true, plane: 'XY' as const, gridVisible: true, snapEnabled: true,
      gridStepMm: 5, centerMm: [0, 0] as const, heightSpanMm: 160, revision: 1 };
    const setSketchPickFilter = vi.fn((filter: CadSketchGraphPickFilter) => context.updateView({ ...view, sketchPickFilter: filter }));
    context.update({ document, selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }], rendered: { ...rendered, setSketchPickFilter } });
    for (const filter of ['auto', 'edges', 'points'] as const) {
      context.controls.apply({ kind: 'set-sketch-pick-filter', filter });
      expect(setSketchPickFilter).toHaveBeenLastCalledWith(filter);
      expect(context.controls.getState()).toMatchObject({ documentVersion: 'version-1', selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }], view: { sketchPickFilter: filter } });
    }
    expect(context.bindings.selectSketchGeometrySet).not.toHaveBeenCalled();
    context.controls.apply({ kind: 'select-sketch-geometry', selection: { kind: 'entity', id: 'ab' } });
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenLastCalledWith([{ kind: 'entity', id: 'ab' }]);
    context.controls.apply({ kind: 'set-sketch-pick-filter', filter: 'edges' });
    context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'b' }] });
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenLastCalledWith([{ kind: 'point', id: 'b' }]);
    expect(document.features[0]).toBe(graphSketch);
  });
  it.each(['faces', 'point', '', null, ['points']].map(filter => ({ filter })))('rejects an unsupported sketch pick filter at the command boundary: $filter', ({ filter }) => {
    expect(Value.Check(CadViewportCommandSchema, { kind: 'set-sketch-pick-filter', filter })).toBe(false);
  });
  it('rejects sketch filter requests outside the active available editor or during guarded work', () => {
    const context = setup('sketch'), rendered = context.bindings.rendered;
    if (!rendered) throw new Error('Sketch renderer missing');
    const document = { ...context.bindings.document, schemaVersion: 2 as const, features: [graphSketch] };
    const setSketchPickFilter = vi.fn();
    const supported = { ...rendered, setSketchPickFilter };
    const cases: readonly [Partial<CadViewportBindings>, string][] = [
      [{ sketchId: null }, 'WRONG_VIEW'],
      [{ document: { ...document, features: [{ ...graphSketch, suppressed: true }] } }, 'WRONG_VIEW'],
      [{ curveId: 'curve-1' }, 'WRONG_VIEW'],
      [{ rendered: null }, 'VIEW_UNAVAILABLE'],
      [{ rendered: { ...supported, getState: () => ({ mode: 'sketch', available: false, plane: 'XY', gridVisible: true,
        snapEnabled: true, gridStepMm: 5, centerMm: [0, 0], heightSpanMm: 160, revision: 1 }) } }, 'VIEW_UNAVAILABLE'],
      [{ rendered: { ...supported, setSketchPickFilter: undefined } }, 'VIEW_UNAVAILABLE'],
      [{ rendered: { ...supported, getState: () => ({ mode: 'solid', available: true, view: 'Top', gridVisible: true, zoom: 1, revision: 1 }) } }, 'WRONG_VIEW'],
      [{ workflowOpen: true }, 'WORKFLOW_OPEN'], [{ busy: true }, 'BUSY'],
    ];
    for (const [change, code] of cases) {
      context.update({ ...context.bindings, document, rendered: supported, ...change });
      expect(() => context.controls.apply({ kind: 'set-sketch-pick-filter', filter: 'points' })).toThrowError(expect.objectContaining({ code }));
    }
    expect(setSketchPickFilter).not.toHaveBeenCalled();
  });
  it('captures the observed sketch filter and rejects a filter change even when camera and selection stay the same', async () => {
    const context = setup('sketch');
    const view = { mode: 'sketch' as const, available: true, plane: 'XY' as const, gridVisible: true, snapEnabled: true,
      gridStepMm: 5, centerMm: [0, 0] as const, heightSpanMm: 160, revision: 1, sketchPickFilter: 'points' as const };
    context.updateView(view);
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ viewState: { view: { sketchPickFilter: 'points' } } });
    context.capture.mockImplementationOnce(async () => { context.updateView({ ...view, sketchPickFilter: 'edges' }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('selects graph points and edges by category only in the active sketch and blocks pending workflows', () => {
    const context = setup('sketch'); context.update({ document: { ...context.bindings.document, schemaVersion: 2, features: [graphSketch] } });
    for (const selection of [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }, null] as const) {
      context.controls.apply({ kind: 'select-sketch-geometry', selection });
      expect(context.bindings.selectSketchGeometrySet).toHaveBeenLastCalledWith(selection ? [selection] : []);
    }
    for (const selection of [{ kind: 'point', id: 'ab' }, { kind: 'entity', id: 'a' }, { kind: 'point', id: 'missing' }] as const) {
      expect(() => context.controls.apply({ kind: 'select-sketch-geometry', selection })).toThrow('active sketch');
    }
    context.update({ selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }] });
    expect(context.controls.getState()).toMatchObject({ selectedSketchGeometry: { kind: 'point', id: 'a' }, selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }] });
    context.update({ workflowOpen: true });
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry', selection: null })).toThrow('Apply or cancel');
    context.update({ workflowOpen: false, sketchId: null });
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry', selection: null })).toThrow('sketch editor');
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenCalledTimes(3);
  });
  it('replaces the ordered graph selection atomically and owns the published request', () => {
    const context = setup('sketch');
    const document = { ...context.bindings.document, schemaVersion: 2 as const, features: [graphSketch] };
    context.update({ document });
    const command = { kind: 'select-sketch-geometry-set' as const, selections: [{ kind: 'entity' as const, id: 'ab' }, { kind: 'point' as const, id: 'a' }] };
    context.controls.apply(command);
    const selected = vi.mocked(context.bindings.selectSketchGeometrySet).mock.calls[0][0];
    command.selections[0].id = 'foreign'; command.selections.reverse();
    expect(selected).toEqual([{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'a' }]);
    expect(Object.isFrozen(selected)).toBe(true);
    expect(selected.every(Object.isFrozen)).toBe(true);
    for (const selections of [
      [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'a' }],
      [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'foreign' }],
    ] as const) {
      expect(() => context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [...selections] })).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    }
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'a' }] })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenCalledOnce();
    expect(document.features[0]).toBe(graphSketch);
    context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [] });
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenLastCalledWith([]);
    context.update({ workflowOpen: true });
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [] })).toThrowError(expect.objectContaining({ code: 'WORKFLOW_OPEN' }));
    context.update({ workflowOpen: false, busy: true });
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [] })).toThrowError(expect.objectContaining({ code: 'BUSY' }));
    context.update({ busy: false, sketchId: null });
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry-set', selections: [] })).toThrowError(expect.objectContaining({ code: 'WRONG_VIEW' }));
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenCalledTimes(2);
  });
  it('projects the scalar only from a singleton and owns the complete state set', () => {
    const context = setup('sketch');
    const selections = [{ kind: 'point' as const, id: 'a' }, { kind: 'entity' as const, id: 'ab' }];
    context.update({ selectedSketchGeometrySet: selections });
    const snapshot = context.controls.getState();
    expect(snapshot.selectedSketchGeometry).toBeUndefined();
    selections[1].id = 'changed';
    expect(snapshot.selectedSketchGeometrySet).toEqual([{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }]);
    expect(Object.isFrozen(snapshot.selectedSketchGeometrySet)).toBe(true);
    expect(snapshot.selectedSketchGeometrySet.every(Object.isFrozen)).toBe(true);
    context.update({ selectedSketchGeometrySet: [] });
    expect(context.controls.getState()).toMatchObject({ selectedSketchGeometrySet: [] });
    expect(context.controls.getState().selectedSketchGeometry).toBeUndefined();
  });
  it('accepts the complete 64-target request and rejects oversize commands before publishing', () => {
    const context = setup('sketch');
    const points = Array.from({ length: 65 }, (_, index) => ({ id: `p${index}`, position: [index, 0] as const }));
    context.update({ document: { ...context.bindings.document, schemaVersion: 2,
      features: [{ ...graphSketch, graph: { points, entities: [], relations: [] } }] } });
    const selections = points.map(point => ({ kind: 'point' as const, id: point.id }));
    context.controls.apply({ kind: 'select-sketch-geometry-set', selections: selections.slice(0, 64) });
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenLastCalledWith(selections.slice(0, 64));
    expect(() => context.controls.apply({ kind: 'select-sketch-geometry-set', selections })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(context.bindings.selectSketchGeometrySet).toHaveBeenCalledOnce();
  });
  it('captures graph-only reference sketches without a solid build and rejects a changed point selection', async () => {
    const context = setup(); context.update({ document: { ...context.bindings.document, schemaVersion: 2, features: [graphSketch] },
      visibleReferenceIds: [graphSketch.id], buildState: 'idle', buildVersion: null, buildId: null });
    context.updateView({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 1,
      referenceVersion: 'version-1', referenceFeatureIds: [graphSketch.id] });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ buildVersion: null });
    const sketch = setup('sketch'); sketch.update({ selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }, { kind: 'point', id: 'b' }] });
    sketch.capture.mockImplementationOnce(async () => { sketch.update({ selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }] }); return png; });
    await expect(sketch.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('pins set order during capture while ignoring equivalent atom property order', async () => {
    const context = setup('sketch');
    context.update({ selectedSketchGeometrySet: [{ kind: 'point', id: 'a' }, { kind: 'entity', id: 'ab' }] });
    context.capture.mockImplementationOnce(async () => {
      context.update({ selectedSketchGeometrySet: [{ id: 'a', kind: 'point' }, { id: 'ab', kind: 'entity' }] }); return png;
    });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ sketchId: 'sketch-1' });
    context.capture.mockImplementationOnce(async () => {
      context.update({ selectedSketchGeometrySet: [{ kind: 'entity', id: 'ab' }, { kind: 'point', id: 'a' }] }); return png;
    });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('selects only principal or active datum planes as view state and refuses geometry-editor or workflow requests', () => {
    const context = setup(); const datum = { id: 'mount', name: 'Mount', kind: 'datum-plane' as const, suppressed: false,
      definition: { kind: 'world' as const, basePlane: 'XZ' as const, origin: [0, 0, 0] as const, rotation: [0, 0, 0] as const } };
    context.update({ document: { ...context.bindings.document, features: [datum] } });
    for (const plane of ['XY', 'XZ', 'YZ', { kind: 'datum-plane', featureId: 'mount' }, null] as const) {
      context.controls.apply({ kind: 'select-reference-plane', plane }); expect(context.bindings.selectReferencePlane).toHaveBeenLastCalledWith(plane);
    }
    const calls = vi.mocked(context.bindings.selectReferencePlane).mock.calls.length;
    context.update({ document: { ...context.bindings.document, features: [{ ...datum, suppressed: true }] } });
    expect(() => context.controls.apply({ kind: 'select-reference-plane', plane: { kind: 'datum-plane', featureId: 'mount' } })).toThrow('active datum');
    context.update({ sketchId: 'sketch' }); expect(() => context.controls.apply({ kind: 'select-reference-plane', plane: 'XY' })).toThrow('Finish sketch');
    context.update({ sketchId: null, workflowOpen: true, awaitingSketchPlane: true });
    expect(context.controls.getState()).toMatchObject({ awaitingSketchPlane: true });
    expect(() => context.controls.apply({ kind: 'select-reference-plane', plane: 'XY' })).toThrow('Apply or cancel');
    expect(vi.mocked(context.bindings.selectReferencePlane).mock.calls).toHaveLength(calls);
  });
  it('captures actual principal-plane resources without a solid build and rejects stale plane installation or changed selection', async () => {
    const context = setup(); context.update({ buildState: 'idle', buildVersion: null, buildId: null, selectedReferencePlane: 'XY', visibleReferencePlanes: ['XY', 'XZ', 'YZ'] });
    const view = { mode: 'solid' as const, available: true, view: 'Isometric' as const, gridVisible: true, zoom: 1, revision: 2,
      referenceVersion: 'version-1', referenceFeatureIds: [] };
    context.updateView({ ...view, referencePlanes: ['XY'] });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    context.updateView({ ...view, referencePlanes: ['XY', 'XZ', 'YZ'] });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ buildVersion: null, viewState: { selectedReferencePlane: 'XY' } });
    context.capture.mockImplementationOnce(async () => { context.update({ selectedReferencePlane: 'XZ' }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
    context.update({ visibleReferencePlanes: [], buildState: 'ready', buildVersion: 'version-1' });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
  });
  it('preserves sub-0.01 Fit zoom in read/capture identity and still rejects a camera change during capture', async () => {
    const context = setup();
    const view = { mode: 'solid' as const, available: true, view: 'Isometric' as const, gridVisible: true, zoom: 0.000013, revision: 2 };
    context.updateView(view);
    expect(context.controls.getState().view).toMatchObject({ zoom: view.zoom });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ viewState: { view: { zoom: view.zoom } } });
    context.capture.mockImplementationOnce(async () => { context.updateView({ ...view, zoom: 0.0000131 }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  const datum = { id: 'mounting_plane', name: 'Mounting plane', kind: 'datum-plane' as const, suppressed: false,
    definition: { kind: 'world' as const, basePlane: 'XY' as const, origin: [12, -8, 4] as const, rotation: [30, 0, 15] as const } };
  it('captures datum-only references without a kernel build only after their exact installation', async () => {
    const context = setup();
    context.update({ document: { ...createCadDocument('Mounting plane', 'part'), features: [datum] },
      visibleReferenceIds: [datum.id], buildState: 'idle', buildVersion: null, buildId: null });
    const view = { mode: 'solid' as const, available: true, view: 'Isometric' as const, gridVisible: true, zoom: 1, revision: 2 };
    for (const provenance of [{}, { referenceVersion: 'old', referenceFeatureIds: [datum.id] },
      { referenceVersion: 'version-1', referenceFeatureIds: [] }, { referenceVersion: 'version-1', referenceFeatureIds: ['another_plane'] }]) {
      context.updateView({ ...view, ...provenance });
      await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    }
    expect(context.capture).not.toHaveBeenCalled();
    context.updateView({ ...view, referenceVersion: 'version-1', referenceFeatureIds: Object.freeze([datum.id]) });
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ buildVersion: null,
      viewState: { buildState: 'idle', view: { referenceVersion: 'version-1', referenceFeatureIds: [datum.id] } } });
    context.update({ workflowOpen: true });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'WORKFLOW_OPEN' });
    context.update({ workflowOpen: false });
    context.capture.mockImplementationOnce(async () => { context.update({ visibleReferenceIds: [] }); return png; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
  it('does not use a suppressed datum or an installed glyph to bypass a pending solid build', async () => {
    const context = setup();
    const base = createCadDocument('Mounting plane', 'part');
    context.updateView({ mode: 'solid', available: true, referenceVersion: 'version-1', referenceFeatureIds: [], view: 'Isometric', gridVisible: true, zoom: 1, revision: 1 });
    context.update({ document: { ...base, features: [{ ...datum, suppressed: true }] }, buildState: 'idle', buildVersion: null, buildId: null });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    context.update({ document: { ...base, features: [datum,
      { id: 'section', name: 'Section', kind: 'sketch', plane: { kind: 'datum-plane', featureId: datum.id }, offset: 0, suppressed: false, profiles: [] },
      { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: 'section', distance: 10, symmetric: false, operation: 'new', targetId: null }] },
      visibleReferenceIds: [datum.id], buildState: 'building' });
    context.updateView({ mode: 'solid', available: true, referenceVersion: 'version-1', referenceFeatureIds: [datum.id], view: 'Isometric', gridVisible: true, zoom: 1, revision: 2 });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_STATE' });
    expect(context.capture).not.toHaveBeenCalled();
  });
  it('retains typed datum identity in a local capture and rejects placement changes during capture', async () => {
    const context = setup('sketch');
    const view = { mode: 'sketch' as const, available: true, plane: Object.freeze({ kind: 'datum-plane' as const, featureId: datum.id }),
      gridVisible: true, snapEnabled: true, gridStepMm: 5, centerMm: [0, 0] as const, heightSpanMm: 160, revision: 1 };
    context.updateView(view);
    await expect(context.controls.capture(new AbortController().signal)).resolves.toMatchObject({ viewState: { view: { plane: { kind: 'datum-plane', featureId: datum.id } } } });
    context.capture.mockImplementationOnce(async () => { context.updateView({ ...view, plane: 'XY', revision: 2 }); return { ...png, source: '2d' }; });
    await expect(context.controls.capture(new AbortController().signal)).rejects.toMatchObject({ code: 'STALE_VIEW' });
  });
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
