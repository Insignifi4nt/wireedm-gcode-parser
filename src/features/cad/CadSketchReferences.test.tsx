import { act, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadWorkbench } from './CadWorkbench';
import { CadSession } from './cadSession';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import type { CadViewportReference } from './cadViewportReferences';

// Exercise the real Workbench selection/edit/capture bridge without a GPU in jsdom.
vi.mock('./CadViewport', () => ({ CadViewport: function ReferenceViewport(props: {
  references: readonly CadViewportReference[]; referenceVersion: string; meshes: readonly { featureId: string }[];
  interactionLocked: boolean; onSelect(id: string): void;
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
}) {
  const live = useRef(props); live.current = props;
  const controls = useMemo<CadRenderedViewControls>(() => ({
    getState: () => ({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 0,
      referenceVersion: live.current.referenceVersion, referenceFeatureIds: Object.freeze([...new Set(live.current.references.map(reference => reference.featureId))].sort()) }),
    fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(),
    capture: async () => ({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' }),
  }), []);
  useLayoutEffect(() => { props.onControlsReady?.(controls); return () => props.onControlsReady?.(null, controls); }, [props.onControlsReady, controls]);
  return <div aria-label="3D model viewport" data-solid-count={props.meshes.length}>
    {props.references.map(reference => <button key={reference.referenceId} disabled={props.interactionLocked} onClick={() => props.onSelect(reference.featureId)}
      data-world-reference={reference.referenceId} data-construction={reference.construction}>World {reference.referenceId}</button>)}
    {props.meshes.map(mesh => <button key={mesh.featureId} disabled={props.interactionLocked} onClick={() => props.onSelect(mesh.featureId)}>Body {mesh.featureId}</button>)}
  </div>;
} }));

let root: Root; let container: HTMLDivElement; let session: CadSession; let controls: CadWorkbenchViewportControls | null;
const capture = vi.fn(async () => undefined);
beforeEach(() => {
  controls = null; capture.mockClear(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const section: CadSketchFeature = { id: 'section', name: 'Section', kind: 'sketch', plane: 'XZ', offset: 4, suppressed: false,
  profiles: [{ id: 'rectangle', name: 'Rectangle', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } },
    { id: 'guide', name: 'Guide', construction: true, geometry: { kind: 'circle', x: 0, y: 0, radius: 1 } }] };
const other: CadSketchFeature = { ...section, id: 'other', name: 'Other', offset: 40, profiles: [section.profiles[0]] };
const solidBuild: CadBuildResult = { buildId: 'native-build', durationMs: 0, diagnostics: [], meshes: [{ featureId: 'pad', name: 'Pad', positions: [], normals: [], indices: [], edges: [], faceGroups: [], edgeGroups: [], volume: 1000,
  bounds: { min: [0, -9, 0], max: [20, -4, 10] } }] };
async function mount(document: CadDocument, build: CadBuildResult | null = null, stale = false) {
  session = new CadSession(document);
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={state.document} documentVersion={state.version} buildVersion={build ? stale ? 'old-document' : state.version : null} build={build} buildState={build ? 'ready' : 'idle'}
      dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo} onEdit={edit => { session.edit([edit]); }} onUndo={() => session.undo()} onRedo={() => session.redo()}
      onWorkflowChange={session.setWorkflowOpen} onSave={async () => undefined} onBack={vi.fn()} onNewDocument={vi.fn()} onOpenDocument={vi.fn()} onImportDocument={async () => undefined}
      onExportDocument={vi.fn()} onExportSolid={async () => undefined} onExportDxf={async () => undefined} onSendToCam={async () => undefined} onCaptureViewport={capture}
      onViewportControlsReady={value => { controls = value; }} />;
  }
  await act(async () => root.render(<Harness />));
}
function button(label: string) {
  const result = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === label || button.textContent?.trim() === label);
  if (!result) throw new Error(`Missing button ${label}`); return result;
}
async function click(label: string) { await act(async () => button(label).click()); }
function currentControls() { if (!controls) throw new Error('Viewport controls unavailable'); return controls; }
function referenceIds() { return [...container.querySelectorAll('[data-world-reference]')].map(element => element.getAttribute('data-world-reference')); }
function widthInput() {
  const result = [...container.querySelectorAll('label')].find(label => label.querySelector('span')?.childNodes[0]?.textContent === 'Width')?.querySelector('input');
  if (!result) throw new Error('Width input missing'); return result;
}
async function inputWidth(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { const input = widthInput(); setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('world Sketch reference Workbench integration', () => {
  it('shows and captures real Sketch outlines without a native build, including construction and multiple profiles', async () => {
    await mount({ ...createCadDocument(), features: [section, other] }); const before = session.getSnapshot();
    expect(referenceIds()).toEqual(['section/rectangle', 'section/guide', 'other/rectangle']);
    expect(container.querySelector('[data-world-reference="section/guide"]')?.getAttribute('data-construction')).toBe('true');
    expect(currentControls().getState()).toMatchObject({ view: { referenceVersion: before.version, referenceFeatureIds: ['other', 'section'] } });
    const receipt = await currentControls().capture(new AbortController().signal);
    expect(receipt).toMatchObject({ documentVersion: before.version, buildVersion: null, contentSource: 'cad-draft', image: { source: '3d' } });
    await click('File'); expect(button('Capture view PNG').disabled).toBe(false); expect(button('Export STEP').disabled).toBe(true);
    await click('Capture view PNG'); expect(capture).toHaveBeenCalledOnce(); expect(session.getSnapshot()).toEqual(before);
  });

  it('matches tree and world selection, reveals only selected solid sources, and stamps an empty reference batch', async () => {
    await mount({ ...createCadDocument(), features: [section, other, { id: 'pad', name: 'Pad', kind: 'extrude', suppressed: false, sketchId: section.id, distance: 5, symmetric: false, operation: 'new', targetId: null }] }, solidBuild);
    const before = session.getSnapshot(); expect(referenceIds()).toEqual([]);
    await click('Body pad'); expect(referenceIds()).toEqual(['section/rectangle', 'section/guide']);
    expect(container.querySelector('.cad-tree-row.is-selected')?.textContent).toContain('Pad');
    await currentControls().capture(new AbortController().signal);
    await click('World section/rectangle'); expect(container.querySelector('.cad-tree-row.is-selected')?.textContent).toContain('Section');
    await click('Other'); expect(referenceIds()).toEqual(['other/rectangle']);
    await act(async () => currentControls().apply({ kind: 'select-feature', featureId: null }));
    expect(referenceIds()).toEqual([]); expect(currentControls().getState()).toMatchObject({ view: { referenceVersion: before.version, referenceFeatureIds: [] } });
    await currentControls().capture(new AbortController().signal); expect(session.getSnapshot()).toEqual(before);
  });

  it('keeps property drafts locked against world/tree selection and installs updated accepted geometry only after Apply', async () => {
    await mount({ ...createCadDocument(), features: [section, other] }); await click('World section/rectangle'); await click('Edit sketch');
    const profile = [...container.querySelectorAll<HTMLButtonElement>('.cad-tree-profile')].find(entry => entry.textContent === 'Rectangle');
    if (!profile) throw new Error('Rectangle tree profile missing'); await act(async () => profile.click());
    const before = session.getSnapshot(); await inputWidth('25'); expect(session.getSnapshot().workflowOpen).toBe(true);
    expect(button('Other').disabled).toBe(true); expect(() => currentControls().apply({ kind: 'select-feature', featureId: other.id })).toThrow(/Apply or cancel/);
    expect(widthInput().value).toBe('25'); expect(session.getSnapshot().document).toBe(before.document);
    await click('Cancel'); expect(session.getSnapshot().version).toBe(before.version); expect(widthInput().value).toBe('20');
    await inputWidth('25'); await click('Apply'); await click('Finish sketch');
    const accepted = session.getSnapshot(); expect(accepted.version).not.toBe(before.version); expect(accepted.canUndo).toBe(true);
    expect(currentControls().getState()).toMatchObject({ view: { referenceVersion: accepted.version, referenceFeatureIds: ['other', 'section'] } });
    await currentControls().capture(new AbortController().signal);
  });

  it('never displays a previous solid build after switching to a Sketch-only document', async () => {
    await mount({ ...createCadDocument(), features: [section] }, solidBuild, true);
    expect(container.querySelector('[aria-label="3D model viewport"]')?.getAttribute('data-solid-count')).toBe('0');
    const receipt = await currentControls().capture(new AbortController().signal); expect(receipt.buildVersion).toBeNull();
    expect(receipt.viewState.view).toMatchObject({ referenceFeatureIds: ['section'], referenceVersion: session.getSnapshot().version });
  });
});
