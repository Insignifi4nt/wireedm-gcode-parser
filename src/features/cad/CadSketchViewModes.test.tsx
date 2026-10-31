import { act, useEffect, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadBuildResult, CadDocument, CadSketchFeature } from '@/domain/cad/cadDocument';
import { createCadDocument } from '@/domain/cad/cadSchema';
import { CadWorkbench } from './CadWorkbench';
import { CadSession } from './cadSession';
import type { CadSketchBackgroundView } from './CadViewport';
import type { CadRenderedViewControls, CadWorkbenchViewportControls } from './cadViewportControls';
import type { CadViewportReference } from './cadViewportReferences';
import { CAD_PREFERENCES_KEY } from './cadPreferences';

interface ViewportProps {
  readonly hidden?: boolean; readonly sketchView?: CadSketchBackgroundView | null; readonly references: readonly CadViewportReference[]; readonly meshes: readonly unknown[];
  onControlsReady?(controls: CadRenderedViewControls | null, released?: CadRenderedViewControls): void;
}
// The 3D view itself is covered by its own tests and the browser spec; here it records what the workbench hands it.
const viewport = vi.hoisted(() => ({ renders: [] as ViewportProps[], views: 0 }));
vi.mock('./CadViewport', () => ({ CadViewport: function RecordingViewport(props: ViewportProps) {
  viewport.renders.push(props);
  const controls = useMemo<CadRenderedViewControls>(() => ({ getState: () => ({ mode: 'solid', available: true, view: 'Isometric', gridVisible: true, zoom: 1, revision: 0 }),
    fit: vi.fn(), setGrid: vi.fn(), setView: vi.fn(), capture: async () => ({ dataUrl: 'data:image/png;base64,AA==', width: 800, height: 600, source: '3d' }) }), []);
  useLayoutEffect(() => { if (props.hidden) return; props.onControlsReady?.(controls); return () => props.onControlsReady?.(null, controls); }, [props.onControlsReady, controls, props.hidden]);
  const camera = props.sketchView?.camera;
  useEffect(() => camera?.subscribe(() => { viewport.views += 1; }), [camera]);
  return props.hidden ? <div className="cad-viewport" hidden={!props.sketchView} data-background={props.sketchView?.background ?? 'hidden'} /> : <div aria-label="3D model viewport" />;
} }));

let root: Root; let container: HTMLDivElement; let session: CadSession; let controls: CadWorkbenchViewportControls | null;
beforeEach(() => {
  controls = null; viewport.renders.length = 0; viewport.views = 0; localStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

const top: CadSketchFeature = { id: 'top', name: 'Top', kind: 'sketch', plane: 'XY', offset: 10, suppressed: false,
  profiles: [{ id: 'boss', name: 'Boss', construction: false, geometry: { kind: 'rectangle', x: 0, y: 0, width: 20, height: 10, cornerRadius: 0 } }] };
function part(): CadDocument {
  return { ...createCadDocument(), features: [
    { id: 'base', name: 'Base', kind: 'sketch', plane: 'XY', offset: 0, suppressed: false, profiles: [{ id: 'plate', name: 'Plate', construction: false, role: 'outer', geometry: { kind: 'rectangle', x: 0, y: 0, width: 50, height: 40, cornerRadius: 0 } }] },
    { id: 'pad', name: 'Pad 1', kind: 'extrude', suppressed: false, sketchId: 'base', distance: 10, symmetric: false, operation: 'new', targetId: null },
    top,
  ] };
}
const build: CadBuildResult = { buildId: 'build', durationMs: 0, diagnostics: [], meshes: [{ featureId: 'pad', name: 'Pad 1', positions: [0, 0, 10, 50, 0, 10, 50, 40, 10], normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
  indices: [0, 1, 2], edges: [], faceGroups: [], edgeGroups: [], volume: 20_000, bounds: { min: [-25, -20, 0], max: [25, 20, 10] } }] };
async function mount(document: CadDocument) {
  session = new CadSession(document);
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <CadWorkbench document={state.document} documentVersion={state.version} buildVersion={state.version} build={build} buildState="ready"
      dirty={state.dirty} canUndo={state.canUndo} canRedo={state.canRedo} onEditMany={edits => { session.edit(edits); }} onEdit={edit => { session.edit([edit]); }} onUndo={() => session.undo()} onRedo={() => session.redo()}
      onWorkflowChange={session.setWorkflowOpen} onSave={async () => undefined} onBack={vi.fn()} onNewDocument={vi.fn()} onOpenDocument={vi.fn()} onImportDocument={async () => undefined}
      onExportDocument={vi.fn()} onExportSolid={async () => undefined} onOpenDxfExport={async () => undefined} onSendToCam={async () => undefined}
      onViewportControlsReady={value => { controls = value; }} />;
  }
  await act(async () => root.render(<Harness />));
}
function workbench() { if (!controls) throw new Error('Viewport controls unavailable'); return controls; }
async function openSketch(sketchId: string) { await act(async () => workbench().apply({ kind: 'edit-sketch', sketchId })); }
async function finishSketch() { await act(async () => workbench().apply({ kind: 'finish-sketch' })); }
const latest = () => { const props = viewport.renders.at(-1); if (!props) throw new Error('Viewport not rendered'); return props; };
function canvas() {
  const element = container.querySelector<SVGSVGElement>('[aria-label="Sketch drawing canvas"]');
  if (!element) throw new Error('Sketch canvas missing');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400, toJSON: () => ({}) });
  return element;
}
function backgroundChoice() {
  const group = container.querySelector('[role="group"][aria-label="Part behind the sketch"]');
  const select = group?.querySelector('select'), cut = group?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!select || !cut) throw new Error('Sketch view choices missing');
  return { select, cut };
}
async function chooseBackground(value: string) {
  await act(async () => { const { select } = backgroundChoice(); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function toggleCut() { await act(async () => backgroundChoice().cut.click()); }
const stored = () => JSON.parse(localStorage.getItem(CAD_PREFERENCES_KEY) ?? 'null')?.sketchView;
const instruction = () => (container.querySelector('p.cad-sr-only')?.textContent ?? '').split(' Keyboard:')[0];
const pointer = (type: string, x: number, y: number, buttons = 0) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons, pointerId: 1, isPrimary: true });

describe('sketch view modes in the workbench', () => {
  it('shows the part dimmed behind an open sketch, switches it from the View drawer and opens the next sketch with the last choice', async () => {
    await mount(part());
    expect(latest()).toMatchObject({ hidden: false, sketchView: null });
    await openSketch('top');
    const shown = latest();
    expect(shown.hidden).toBe(true);
    expect(shown.sketchView).toMatchObject({ background: 'dimmed', cutBySketchPlane: false, placement: { offsetMm: 10, frame: { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] } } });
    // Other sketches stay as references; the open sketch draws itself and planes stay out of its way.
    expect(shown.references.map(reference => reference.referenceId)).toEqual(['base/plate']);
    expect(container.querySelector('.cad-center')?.classList.contains('has-sketch-background')).toBe(true);
    expect(backgroundChoice().select.value).toBe('dimmed');
    await chooseBackground('normal');
    expect(latest().sketchView).toMatchObject({ background: 'normal' });
    expect(stored()).toEqual({ background: 'normal', cutBySketchPlane: false });
    await chooseBackground('hidden');
    expect(latest()).toMatchObject({ hidden: true, sketchView: null });
    expect(container.querySelector('.cad-center')?.classList.contains('has-sketch-background')).toBe(false);
    expect(backgroundChoice().cut.disabled).toBe(true);
    await chooseBackground('dimmed'); await toggleCut();
    expect(latest().sketchView).toMatchObject({ background: 'dimmed', cutBySketchPlane: true });
    expect(stored()).toEqual({ background: 'dimmed', cutBySketchPlane: true });
    const document = session.getSnapshot().document;
    // Leaving shows the part on its own again; the choice is a device preference, not part of the document.
    await finishSketch();
    expect(latest()).toMatchObject({ hidden: false, sketchView: null });
    expect(container.querySelector('[role="group"][aria-label="Part behind the sketch"]')).toBeNull();
    expect(session.getSnapshot().document).toBe(document);
    await openSketch('base');
    expect(latest().sketchView).toMatchObject({ background: 'dimmed', cutBySketchPlane: true, placement: { offsetMm: 0 } });
    expect(latest().references.map(reference => reference.referenceId)).toEqual(['top/boss']);
  });

  it('publishes no view and hands the viewport nothing new while the pointer hovers, drags or draws in the sketch, and one view per zoom step', async () => {
    await mount(part());
    await openSketch('top');
    const surface = canvas();
    const settled = latest(), views = viewport.views, rendersBefore = viewport.renders.length;
    expect(settled.sketchView?.camera.current()).not.toBeNull();
    await act(async () => { for (let step = 0; step < 12; step++) surface.dispatchEvent(pointer('pointermove', 100 + step * 25, 120 + step * 10)); });
    // A box drag in Select.
    await act(async () => {
      surface.dispatchEvent(pointer('pointerdown', 40, 40, 1));
      for (let step = 1; step < 10; step++) surface.dispatchEvent(pointer('pointermove', 40 + step * 30, 40 + step * 20, 1));
      surface.dispatchEvent(pointer('pointerup', 310, 220));
    });
    // Line draws its preview under the pointer, then a drag draws and saves a line.
    const line = [...container.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'Line' || button.textContent?.trim() === 'Line');
    if (!line) throw new Error('Line tool missing');
    await act(async () => line.click());
    expect(instruction()).toBe('Click the line start, or drag to draw one line.');
    await act(async () => { for (let step = 0; step < 12; step++) surface.dispatchEvent(pointer('pointermove', 300 - step * 20, 200 - step * 5)); });
    const before = session.getSnapshot().version;
    await act(async () => { surface.dispatchEvent(pointer('pointerdown', 100, 100, 1)); });
    for (let step = 1; step <= 8; step++) await act(async () => { surface.dispatchEvent(pointer('pointermove', 100 + step * 25, 100 + step * 12, 1)); });
    await act(async () => { surface.dispatchEvent(pointer('pointerup', 300, 196)); });
    await act(async () => { surface.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 300, clientY: 196, button: 0, detail: 1 })); });
    expect(session.getSnapshot().version).not.toBe(before);
    expect(viewport.views).toBe(views);
    for (const props of viewport.renders.slice(rendersBefore)) {
      expect(props.sketchView).toBe(settled.sketchView);
      expect(props.references).toBe(settled.references);
      expect(props.meshes).toBe(settled.meshes);
    }
    const span = settled.sketchView?.camera.current()?.span ?? 0;
    await act(async () => { surface.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: 300, clientY: 200 })); });
    expect(viewport.views).toBe(views + 1);
    expect(settled.sketchView?.camera.current()?.span).toBeGreaterThan(span);
  });
});
